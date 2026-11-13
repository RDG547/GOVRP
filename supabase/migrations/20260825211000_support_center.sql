begin;

create sequence if not exists public.support_ticket_number_seq;

create or replace function public.next_support_ticket_number()
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select 'SUP-' || to_char(clock_timestamp(), 'YYYY') || '-' ||
         lpad(nextval('public.support_ticket_number_seq')::text, 6, '0');
$$;

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default public.next_support_ticket_number(),
  requester_id uuid references public.profiles(id) on delete set null,
  requester_name text not null,
  requester_email text not null,
  requester_phone text,
  request_type text not null default 'support',
  subject text not null,
  status text not null default 'open',
  priority text not null default 'normal',
  assigned_to uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  attachment_path text,
  last_message_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint support_tickets_type_check check (request_type in ('support', 'contact')),
  constraint support_tickets_status_check check (status in ('open', 'in_progress', 'waiting_user', 'resolved', 'closed')),
  constraint support_tickets_priority_check check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint support_tickets_subject_length check (char_length(btrim(subject)) between 3 and 160),
  constraint support_tickets_requester_name_length check (char_length(btrim(requester_name)) between 2 and 120)
);

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  sender_kind text not null,
  body text not null,
  attachment_path text,
  created_at timestamptz not null default clock_timestamp(),
  constraint support_ticket_messages_sender_kind_check check (sender_kind in ('citizen', 'admin', 'guest', 'system')),
  constraint support_ticket_messages_body_length check (char_length(btrim(body)) between 1 and 5000)
);

create index if not exists support_tickets_requester_recent_idx
  on public.support_tickets (requester_id, last_message_at desc);
create index if not exists support_tickets_admin_queue_idx
  on public.support_tickets (status, priority, last_message_at desc);
create index if not exists support_ticket_messages_thread_idx
  on public.support_ticket_messages (ticket_id, created_at asc, id asc);

alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;

drop policy if exists support_tickets_participant_read on public.support_tickets;
create policy support_tickets_participant_read
  on public.support_tickets for select to authenticated
  using (requester_id = auth.uid() or public.get_user_role(auth.uid()) = 'Admin');

drop policy if exists support_ticket_messages_participant_read on public.support_ticket_messages;
create policy support_ticket_messages_participant_read
  on public.support_ticket_messages for select to authenticated
  using (exists (
    select 1 from public.support_tickets ticket
    where ticket.id = ticket_id
      and (ticket.requester_id = auth.uid() or public.get_user_role(auth.uid()) = 'Admin')
  ));

revoke all on public.support_tickets from public, anon, authenticated;
revoke all on public.support_ticket_messages from public, anon, authenticated;
grant select on public.support_tickets to authenticated;
grant select on public.support_ticket_messages to authenticated;
grant all on public.support_tickets, public.support_ticket_messages to service_role;

create or replace function public.create_support_ticket(
  p_requester_name text,
  p_requester_email text,
  p_requester_phone text,
  p_request_type text,
  p_subject text,
  p_message text,
  p_attachment_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ticket public.support_tickets%rowtype;
begin
  if coalesce(p_request_type, 'support') not in ('support', 'contact') then
    raise exception 'Tipo de atendimento inválido.';
  end if;
  if coalesce(p_request_type, 'support') = 'support' and v_user_id is null then
    raise exception 'Entre na sua conta para abrir e acompanhar um ticket de suporte.';
  end if;
  if char_length(btrim(coalesce(p_requester_name, ''))) not between 2 and 120 then
    raise exception 'Informe seu nome.';
  end if;
  if btrim(coalesce(p_requester_email, '')) !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Informe um e-mail válido.';
  end if;
  if char_length(btrim(coalesce(p_subject, ''))) not between 3 and 160 then
    raise exception 'O assunto deve ter entre 3 e 160 caracteres.';
  end if;
  if char_length(btrim(coalesce(p_message, ''))) not between 10 and 5000 then
    raise exception 'Descreva a solicitação com pelo menos 10 caracteres.';
  end if;

  insert into public.support_tickets (
    requester_id, requester_name, requester_email, requester_phone,
    request_type, subject, attachment_path
  ) values (
    v_user_id,
    btrim(p_requester_name),
    lower(btrim(p_requester_email)),
    nullif(btrim(p_requester_phone), ''),
    coalesce(p_request_type, 'support'),
    btrim(p_subject),
    nullif(btrim(p_attachment_path), '')
  ) returning * into v_ticket;

  insert into public.support_ticket_messages (
    ticket_id, sender_id, sender_kind, body, attachment_path
  ) values (
    v_ticket.id,
    v_user_id,
    case when v_user_id is null then 'guest' else 'citizen' end,
    btrim(p_message),
    nullif(btrim(p_attachment_path), '')
  );

  insert into public.notifications (user_id, type, content, link, metadata)
  select profile.id,
         'support_ticket',
         'Novo ticket ' || v_ticket.public_id || ': ' || v_ticket.subject,
         '/admin-dashboard/support',
         jsonb_build_object('ticket_id', v_ticket.id, 'public_id', v_ticket.public_id)
  from public.profiles profile
  where profile.role = 'Admin' and profile.deleted_at is null;

  return jsonb_build_object(
    'success', true,
    'ticket_id', v_ticket.id,
    'public_id', v_ticket.public_id,
    'message', 'Solicitação ' || v_ticket.public_id || ' aberta com sucesso.'
  );
end;
$$;

revoke all on function public.create_support_ticket(text,text,text,text,text,text,text) from public;
grant execute on function public.create_support_ticket(text,text,text,text,text,text,text) to anon, authenticated, service_role;

create or replace function public.reply_to_support_ticket(
  p_ticket_id uuid,
  p_message text,
  p_attachment_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_is_admin boolean := public.get_user_role(v_user_id) = 'Admin';
  v_ticket public.support_tickets%rowtype;
begin
  if v_user_id is null then raise exception 'É necessário estar autenticado.'; end if;
  if char_length(btrim(coalesce(p_message, ''))) not between 1 and 5000 then
    raise exception 'A mensagem deve ter entre 1 e 5.000 caracteres.';
  end if;

  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if not found then raise exception 'Ticket não encontrado.'; end if;
  if not v_is_admin and v_ticket.requester_id is distinct from v_user_id then
    raise exception 'Você não pode responder a este ticket.';
  end if;
  if v_ticket.status = 'closed' then raise exception 'Este ticket está encerrado.'; end if;

  insert into public.support_ticket_messages (ticket_id, sender_id, sender_kind, body, attachment_path)
  values (p_ticket_id, v_user_id, case when v_is_admin then 'admin' else 'citizen' end,
          btrim(p_message), nullif(btrim(p_attachment_path), ''));

  update public.support_tickets
  set last_message_at = clock_timestamp(),
      updated_at = clock_timestamp(),
      status = case
        when v_is_admin then 'waiting_user'
        when status in ('resolved', 'waiting_user') then 'in_progress'
        else status
      end,
      assigned_to = case when v_is_admin then coalesce(assigned_to, v_user_id) else assigned_to end,
      accepted_at = case when v_is_admin then coalesce(accepted_at, clock_timestamp()) else accepted_at end,
      resolved_at = case when not v_is_admin and status = 'resolved' then null else resolved_at end
  where id = p_ticket_id;

  if v_is_admin and v_ticket.requester_id is not null then
    insert into public.notifications (user_id, sender_id, type, content, link, metadata)
    values (
      v_ticket.requester_id, v_user_id, 'support_reply',
      'A equipe respondeu ao ticket ' || v_ticket.public_id || '.',
      '/support?ticket=' || v_ticket.public_id,
      jsonb_build_object('ticket_id', p_ticket_id, 'public_id', v_ticket.public_id)
    );
  elsif not v_is_admin then
    insert into public.notifications (user_id, sender_id, type, content, link, metadata)
    select profile.id, v_user_id, 'support_reply',
           'Nova resposta no ticket ' || v_ticket.public_id || '.',
           '/admin-dashboard/support',
           jsonb_build_object('ticket_id', p_ticket_id, 'public_id', v_ticket.public_id)
    from public.profiles profile
    where profile.deleted_at is null
      and (profile.id = v_ticket.assigned_to or (v_ticket.assigned_to is null and profile.role = 'Admin'));
  end if;

  return jsonb_build_object('success', true, 'message', 'Mensagem enviada.');
end;
$$;

revoke all on function public.reply_to_support_ticket(uuid,text,text) from public, anon;
grant execute on function public.reply_to_support_ticket(uuid,text,text) to authenticated, service_role;

create or replace function public.admin_manage_support_ticket(
  p_ticket_id uuid,
  p_status text default null,
  p_priority text default null,
  p_assigned_to uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_ticket public.support_tickets%rowtype;
  v_status text;
  v_priority text;
  v_assignee uuid;
begin
  if public.get_user_role(v_admin_id) <> 'Admin' then raise exception 'Acesso negado.'; end if;
  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if not found then raise exception 'Ticket não encontrado.'; end if;

  v_status := coalesce(p_status, v_ticket.status);
  v_priority := coalesce(p_priority, v_ticket.priority);
  v_assignee := coalesce(p_assigned_to, v_ticket.assigned_to, v_admin_id);
  if v_status not in ('open', 'in_progress', 'waiting_user', 'resolved', 'closed') then raise exception 'Status inválido.'; end if;
  if v_priority not in ('low', 'normal', 'high', 'urgent') then raise exception 'Prioridade inválida.'; end if;
  if public.get_user_role(v_assignee) <> 'Admin' then raise exception 'O responsável precisa ser administrador.'; end if;

  update public.support_tickets
  set status = v_status,
      priority = v_priority,
      assigned_to = v_assignee,
      accepted_at = coalesce(accepted_at, clock_timestamp()),
      resolved_at = case when v_status = 'resolved' then coalesce(resolved_at, clock_timestamp()) else null end,
      closed_at = case when v_status = 'closed' then coalesce(closed_at, clock_timestamp()) else null end,
      updated_at = clock_timestamp()
  where id = p_ticket_id;

  if v_ticket.requester_id is not null and (v_ticket.status is distinct from v_status or v_ticket.assigned_to is null) then
    insert into public.notifications (user_id, sender_id, type, content, link, metadata)
    values (
      v_ticket.requester_id, v_admin_id, 'support_status',
      'O ticket ' || v_ticket.public_id || ' foi atualizado para ' ||
        case v_status when 'open' then 'aberto' when 'in_progress' then 'em atendimento'
          when 'waiting_user' then 'aguardando sua resposta' when 'resolved' then 'resolvido' else 'encerrado' end || '.',
      '/support?ticket=' || v_ticket.public_id,
      jsonb_build_object('ticket_id', p_ticket_id, 'public_id', v_ticket.public_id, 'status', v_status)
    );
  end if;

  return jsonb_build_object('success', true, 'message', 'Ticket atualizado com sucesso.');
end;
$$;

revoke all on function public.admin_manage_support_ticket(uuid,text,text,uuid) from public, anon;
grant execute on function public.admin_manage_support_ticket(uuid,text,text,uuid) to authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'support_tickets') then
      alter publication supabase_realtime add table public.support_tickets;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'support_ticket_messages') then
      alter publication supabase_realtime add table public.support_ticket_messages;
    end if;
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
