begin;

create table if not exists public.bill_status_history (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id) on delete cascade,
  status text not null,
  event_label text not null,
  occurred_at timestamptz not null default clock_timestamp(),
  actor_id uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists bill_status_history_bill_timeline_idx
  on public.bill_status_history (bill_id, occurred_at asc, id asc);

alter table public.bill_status_history enable row level security;

drop policy if exists bill_status_history_public_read on public.bill_status_history;
create policy bill_status_history_public_read
  on public.bill_status_history
  for select
  to anon, authenticated
  using (true);

revoke all on table public.bill_status_history from public, anon, authenticated;
grant select on table public.bill_status_history to anon, authenticated;
grant all on table public.bill_status_history to service_role;

create or replace function public.bill_status_event_label(p_status text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case lower(trim(coalesce(p_status, '')))
    when 'proposto' then 'Projeto proposto'
    when 'recebido' then 'Projeto recebido'
    when 'em análise' then 'Análise iniciada'
    when 'em tramitação' then 'Iniciada tramitação'
    when 'encaminhado' then 'Projeto encaminhado'
    when 'em votação' then 'Votação iniciada'
    when 'em votação (2ª casa)' then 'Encaminhado para votação na 2ª Casa'
    when 'aprovado' then 'Projeto aprovado'
    when 'rejeitado' then 'Projeto rejeitado'
    when 'arquivado' then 'Projeto arquivado'
    when 'aguardando sanção presidencial' then 'Encaminhado para sanção presidencial'
    when 'aguardando promulgação presidencial' then 'Encaminhado para promulgação'
    when 'sancionado' then 'Projeto sancionado'
    when 'vetado integralmente' then 'Projeto vetado integralmente'
    when 'vetado parcialmente' then 'Projeto vetado parcialmente'
    when 'promulgado' then 'Projeto promulgado'
    when 'devolvido' then 'Projeto devolvido'
    else coalesce(nullif(trim(p_status), ''), 'Situação atualizada')
  end;
$$;

revoke all on function public.bill_status_event_label(text) from public, anon, authenticated;
grant execute on function public.bill_status_event_label(text) to service_role;

create or replace function public.record_bill_status_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.bill_status_history (
      bill_id,
      status,
      event_label,
      occurred_at,
      actor_id,
      metadata
    ) values (
      new.id,
      coalesce(nullif(new.status, ''), 'Proposto'),
      'Projeto proposto',
      coalesce(new.created_at, clock_timestamp()),
      new.author_id,
      jsonb_build_object('source', 'bill_created')
    );
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.bill_status_history (
      bill_id,
      status,
      event_label,
      occurred_at,
      actor_id,
      metadata
    ) values (
      new.id,
      new.status,
      public.bill_status_event_label(new.status),
      clock_timestamp(),
      auth.uid(),
      jsonb_build_object('source', 'status_change', 'previous_status', old.status)
    );
  end if;

  return new;
end;
$$;

revoke all on function public.record_bill_status_history() from public, anon, authenticated;

drop trigger if exists bills_record_status_history on public.bills;
create trigger bills_record_status_history
after insert or update of status on public.bills
for each row execute function public.record_bill_status_history();

insert into public.bill_status_history (
  bill_id,
  status,
  event_label,
  occurred_at,
  actor_id,
  metadata
)
select
  bill.id,
  coalesce(nullif(bill.status, ''), 'Proposto'),
  'Projeto proposto',
  bill.created_at,
  bill.author_id,
  jsonb_build_object('source', 'historical_created_at')
from public.bills bill
where not exists (
  select 1
  from public.bill_status_history history
  where history.bill_id = bill.id
    and history.event_label = 'Projeto proposto'
);

insert into public.bill_status_history (
  bill_id,
  status,
  event_label,
  occurred_at,
  actor_id,
  metadata
)
select
  bill.id,
  bill.status,
  public.bill_status_event_label(bill.status),
  bill.updated_at,
  null,
  jsonb_build_object('source', 'historical_updated_at')
from public.bills bill
where bill.updated_at > bill.created_at
  and lower(trim(coalesce(bill.status, ''))) not in ('', 'proposto')
  and not exists (
    select 1
    from public.bill_status_history history
    where history.bill_id = bill.id
      and history.status = bill.status
      and history.occurred_at = bill.updated_at
  );

commit;
