begin;

-- Identidade pública: preserva a capitalização escolhida e impede colisões
-- que diferem apenas entre maiúsculas e minúsculas.
create unique index if not exists profiles_username_case_insensitive_key
  on public.profiles (lower(username));

create or replace function public.save_citizen_identity(
  p_full_name text,
  p_username text,
  p_date_of_birth date,
  p_character_bio text default null,
  p_avatar_url text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := regexp_replace(btrim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
  v_username text := btrim(trim(leading '@' from btrim(coalesce(p_username, ''))));
  v_bio text := nullif(btrim(coalesce(p_character_bio, '')), '');
  v_profile public.profiles%rowtype;
begin
  if v_user_id is null then raise exception 'Usuário não autenticado.'; end if;
  if not exists (
    select 1 from private.account_identities ai where ai.user_id = v_user_id
      and ai.real_full_name is not null and ai.real_date_of_birth is not null
      and ai.email is not null and ai.phone is not null
  ) then raise exception 'Complete os dados privados da conta antes de criar o cidadão.'; end if;
  if char_length(v_name) not between 5 and 80
     or v_name !~ '^[[:alpha:][:space:]''’\-]+$' then
    raise exception 'Use apenas letras, espaços, hífen e apóstrofo no nome civil.';
  end if;
  if v_username !~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,19}$' then
    raise exception 'O nome de usuário deve ter de 3 a 20 caracteres: letras, números, ponto, hífen ou sublinhado.';
  end if;
  if exists(select 1 from public.profiles p where lower(p.username)=lower(v_username) and p.id<>v_user_id) then
    raise exception 'Este nome de usuário já está em uso.';
  end if;
  if p_date_of_birth is null
     or p_date_of_birth > current_date
     or p_date_of_birth < current_date - interval '120 years' then
    raise exception 'A data de nascimento do cidadão deve ser válida e ter no máximo 120 anos.';
  end if;
  if v_bio is not null and char_length(v_bio) > 300 then
    raise exception 'A biografia pode ter no máximo 300 caracteres.';
  end if;

  v_name := initcap(lower(v_name));
  update public.profiles
  set full_name = v_name,
      username = v_username,
      date_of_birth = p_date_of_birth,
      character_bio = v_bio,
      avatar_url = coalesce(nullif(btrim(p_avatar_url), ''), avatar_url),
      username_is_generated = false,
      citizen_profile_confirmed_at = clock_timestamp(),
      onboarding_step = 'origin',
      onboarding_updated_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = v_user_id and onboarding_completed = false
  returning * into v_profile;

  if v_profile.id is null then raise exception 'Onboarding indisponível ou já concluído.'; end if;
  perform public.record_citizen_lifecycle_event(
    v_user_id, 'character_created', v_name || ' teve sua identidade civil registrada.',
    jsonb_build_object('username', v_username), 'character-created:' || v_user_id, v_user_id
  );
  return v_profile;
exception
  when unique_violation then raise exception 'Este nome de usuário já está em uso.';
end;
$$;

revoke all on function public.save_citizen_identity(text,text,date,text,text) from public,anon;
grant execute on function public.save_citizen_identity(text,text,date,text,text) to authenticated,service_role;

-- Exclusão lógica de tickets: some da fila e do cidadão sem apagar o histórico.
alter table public.support_tickets
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists deletion_reason text;

create index if not exists support_tickets_active_queue_idx
  on public.support_tickets(status,priority,last_message_at desc)
  where deleted_at is null;

drop policy if exists support_tickets_participant_read on public.support_tickets;
create policy support_tickets_participant_read
  on public.support_tickets for select to authenticated
  using (
    public.get_user_role((select auth.uid()))='Admin'
    or (requester_id=(select auth.uid()) and deleted_at is null)
  );

drop policy if exists support_ticket_messages_participant_read on public.support_ticket_messages;
create policy support_ticket_messages_participant_read
  on public.support_ticket_messages for select to authenticated
  using (exists(
    select 1 from public.support_tickets ticket
    where ticket.id=ticket_id
      and (
        public.get_user_role((select auth.uid()))='Admin'
        or (ticket.requester_id=(select auth.uid()) and ticket.deleted_at is null)
      )
  ));

create or replace function public.block_archived_support_ticket_change()
returns trigger language plpgsql set search_path='' as $$
begin
  if old.deleted_at is not null then
    raise exception 'Este ticket foi excluído e não pode mais ser alterado.' using errcode='55000';
  end if;
  return new;
end;
$$;

drop trigger if exists support_ticket_archive_guard on public.support_tickets;
create trigger support_ticket_archive_guard
before update on public.support_tickets
for each row execute function public.block_archived_support_ticket_change();

create or replace function public.block_message_on_archived_ticket()
returns trigger language plpgsql set search_path='' as $$
begin
  if exists(select 1 from public.support_tickets t where t.id=new.ticket_id and t.deleted_at is not null) then
    raise exception 'Este ticket foi excluído e não aceita novas mensagens.' using errcode='55000';
  end if;
  return new;
end;
$$;

drop trigger if exists support_message_archive_guard on public.support_ticket_messages;
create trigger support_message_archive_guard
before insert or update on public.support_ticket_messages
for each row execute function public.block_message_on_archived_ticket();

create or replace function public.admin_archive_support_ticket(
  p_ticket_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_admin_id uuid:=auth.uid();
  v_ticket public.support_tickets%rowtype;
begin
  if public.get_user_role(v_admin_id)<>'Admin' then
    raise exception 'Acesso permitido apenas à administração.' using errcode='42501';
  end if;
  select * into v_ticket from public.support_tickets where id=p_ticket_id for update;
  if not found then raise exception 'Ticket não encontrado.'; end if;
  if v_ticket.deleted_at is not null then return jsonb_build_object('success',true,'already_deleted',true); end if;

  update public.support_tickets
  set deleted_at=clock_timestamp(),deleted_by=v_admin_id,
      deletion_reason=nullif(left(btrim(coalesce(p_reason,'')),500),''),
      status='closed',closed_at=coalesce(closed_at,clock_timestamp()),updated_at=clock_timestamp()
  where id=p_ticket_id;

  insert into public.security_audit_log(action,target_table,target_id,actor_id,actor_role,old_data,new_data,metadata)
  values('support_ticket_archived','support_tickets',p_ticket_id::text,v_admin_id,'Admin',
    to_jsonb(v_ticket),
    jsonb_build_object('deleted_at',clock_timestamp(),'deleted_by',v_admin_id,'reason',nullif(btrim(coalesce(p_reason,'')),'')),
    jsonb_build_object('public_id',v_ticket.public_id));

  return jsonb_build_object('success',true,'message','Ticket excluído da fila ativa.');
end;
$$;

revoke all on function public.admin_archive_support_ticket(uuid,text) from public,anon;
grant execute on function public.admin_archive_support_ticket(uuid,text) to authenticated,service_role;

-- Histórico nacional: mantém paginação no servidor e acrescenta filtro de moeda.
drop function if exists public.get_admin_transaction_history(integer,integer,text,text,text,date,date,numeric,numeric,uuid,uuid,text);
create or replace function public.get_admin_transaction_history(
  p_page integer default 1,
  p_page_size integer default 25,
  p_search text default null,
  p_type text default null,
  p_status text default null,
  p_currency text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_min_amount numeric default null,
  p_max_amount numeric default null,
  p_sender_id uuid default null,
  p_recipient_id uuid default null,
  p_sort text default 'newest'
)
returns table(
  id uuid,created_at timestamptz,type text,description text,amount numeric,currency text,status text,
  sender_user_id uuid,sender_name text,sender_username text,sender_account_id uuid,sender_account_number text,
  recipient_user_id uuid,recipient_name text,recipient_username text,recipient_account_id uuid,recipient_account_number text,
  fee_amount numeric,tax_amount numeric,reference text,idempotency_key uuid,metadata jsonb,total_count bigint
)
language plpgsql stable security definer set search_path='' as $$
declare
  v_limit integer:=least(100,greatest(5,coalesce(p_page_size,25)));
  v_offset integer:=(greatest(1,coalesce(p_page,1))-1)*least(100,greatest(5,coalesce(p_page_size,25)));
  v_sort text:=case when p_sort in ('newest','oldest','amount_desc','amount_asc') then p_sort else 'newest' end;
begin
  if not public.economic_has_role(array['Admin']) then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  return query
  select transaction.id,transaction.created_at,transaction.type,transaction.description,transaction.amount,
    transaction.currency,transaction.status,sender.id,coalesce(nullif(sender.full_name,''),nullif(sender.username,'')),
    sender.username,sender_account.id,sender_account.account_number::text,recipient.id,
    coalesce(nullif(recipient.full_name,''),nullif(recipient.username,'')),recipient.username,
    recipient_account.id,recipient_account.account_number::text,
    case when coalesce(transaction.metadata->>'fee_amount','')~'^-?[0-9]+(\.[0-9]+)?$' then (transaction.metadata->>'fee_amount')::numeric
      when coalesce(transaction.metadata->>'fee','')~'^-?[0-9]+(\.[0-9]+)?$' then (transaction.metadata->>'fee')::numeric else 0 end,
    case when coalesce(transaction.metadata->>'tax_amount','')~'^-?[0-9]+(\.[0-9]+)?$' then (transaction.metadata->>'tax_amount')::numeric
      when coalesce(transaction.metadata->>'tax','')~'^-?[0-9]+(\.[0-9]+)?$' then (transaction.metadata->>'tax')::numeric else 0 end,
    coalesce(transaction.metadata->>'reference',transaction.metadata->>'source_reference',transaction.metadata->>'order_id',transaction.metadata->>'business_id'),
    transaction.idempotency_key,transaction.metadata,count(*) over()
  from public.transactions transaction
  left join public.accounts sender_account on sender_account.id=transaction.from_account_id
  left join public.profiles sender on sender.id=sender_account.user_id
  left join public.accounts recipient_account on recipient_account.id=transaction.to_account_id
  left join public.profiles recipient on recipient.id=recipient_account.user_id
  where (p_type is null or p_type='' or transaction.type=p_type)
    and (p_status is null or p_status='' or lower(transaction.status)=lower(p_status))
    and (p_currency is null or p_currency='' or upper(transaction.currency)=upper(p_currency))
    and (p_date_from is null or transaction.created_at>=p_date_from::timestamptz)
    and (p_date_to is null or transaction.created_at<(p_date_to+1)::timestamptz)
    and (p_min_amount is null or transaction.amount>=p_min_amount)
    and (p_max_amount is null or transaction.amount<=p_max_amount)
    and (p_sender_id is null or sender.id=p_sender_id)
    and (p_recipient_id is null or recipient.id=p_recipient_id)
    and (p_search is null or btrim(p_search)='' or transaction.description ilike '%'||btrim(p_search)||'%'
      or transaction.id::text ilike '%'||btrim(p_search)||'%' or transaction.idempotency_key::text ilike '%'||btrim(p_search)||'%'
      or sender.id::text ilike '%'||btrim(p_search)||'%' or sender.full_name ilike '%'||btrim(p_search)||'%'
      or sender.username ilike '%'||btrim(p_search)||'%' or sender_account.account_number::text ilike '%'||btrim(p_search)||'%'
      or recipient.id::text ilike '%'||btrim(p_search)||'%' or recipient.full_name ilike '%'||btrim(p_search)||'%'
      or recipient.username ilike '%'||btrim(p_search)||'%' or recipient_account.account_number::text ilike '%'||btrim(p_search)||'%')
  order by case when v_sort='newest' then transaction.created_at end desc,
    case when v_sort='oldest' then transaction.created_at end asc,
    case when v_sort='amount_desc' then transaction.amount end desc,
    case when v_sort='amount_asc' then transaction.amount end asc,transaction.id desc
  limit v_limit offset v_offset;
end;
$$;

revoke all on function public.get_admin_transaction_history(integer,integer,text,text,text,text,date,date,numeric,numeric,uuid,uuid,text) from public,anon;
grant execute on function public.get_admin_transaction_history(integer,integer,text,text,text,text,date,date,numeric,numeric,uuid,uuid,text) to authenticated,service_role;

notify pgrst,'reload schema';
commit;
