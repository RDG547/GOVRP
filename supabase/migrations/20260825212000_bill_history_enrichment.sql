begin;

create or replace function public.record_bill_voting_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.type <> 'bill' or new.related_id is null then return new; end if;

  if tg_op = 'INSERT' then
    insert into public.bill_status_history (
      bill_id, status, event_label, occurred_at, actor_id, metadata
    )
    select
      new.related_id, 'Em votação', 'Votação aberta', new.created_at, null,
      jsonb_build_object('source', 'parliament_voting', 'voting_id', new.id, 'house_id', new.house_id)
    where exists (select 1 from public.bills bill where bill.id = new.related_id)
      and not exists (
        select 1 from public.bill_status_history history
        where history.bill_id = new.related_id
          and history.metadata->>'voting_id' = new.id::text
          and history.event_label = 'Votação aberta'
      );
  elsif new.status = 'closed' and old.status is distinct from new.status then
    insert into public.bill_status_history (
      bill_id, status, event_label, occurred_at, actor_id, metadata
    )
    select
      new.related_id,
      coalesce((select bill.status from public.bills bill where bill.id = new.related_id), 'Votação encerrada'),
      'Votação encerrada',
      clock_timestamp(),
      auth.uid(),
      jsonb_build_object('source', 'parliament_voting_closed', 'voting_id', new.id, 'house_id', new.house_id)
    where not exists (
      select 1 from public.bill_status_history history
      where history.bill_id = new.related_id
        and history.metadata->>'voting_id' = new.id::text
        and history.event_label = 'Votação encerrada'
    );
  end if;

  return new;
end;
$$;

revoke all on function public.record_bill_voting_history() from public, anon, authenticated;

drop trigger if exists parliament_votings_record_bill_history on public.parliament_votings;
create trigger parliament_votings_record_bill_history
after insert or update of status on public.parliament_votings
for each row execute function public.record_bill_voting_history();

create or replace function public.record_bill_gazette_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.bill_status_history (
    bill_id, status, event_label, occurred_at, actor_id, metadata
  )
  select
    bill.id,
    bill.status,
    'Publicado no Diário Oficial',
    new.published_at,
    null,
    jsonb_build_object('source', 'dou_entry', 'dou_entry_id', new.id, 'gazette_type', new.type)
  from public.bills bill
  where bill.id = new.source_id
    and not exists (
      select 1 from public.bill_status_history history
      where history.bill_id = bill.id
        and history.metadata->>'dou_entry_id' = new.id::text
    );
  return new;
end;
$$;

revoke all on function public.record_bill_gazette_history() from public, anon, authenticated;

drop trigger if exists dou_entries_record_bill_history on public.dou_entries;
create trigger dou_entries_record_bill_history
after insert on public.dou_entries
for each row execute function public.record_bill_gazette_history();

-- Reconstruct only from timestamps that already exist in authoritative tables.
insert into public.bill_status_history (
  bill_id, status, event_label, occurred_at, actor_id, metadata
)
select
  voting.related_id,
  'Em votação',
  'Votação aberta',
  voting.created_at,
  null,
  jsonb_build_object('source', 'historical_parliament_voting', 'voting_id', voting.id, 'house_id', voting.house_id)
from public.parliament_votings voting
join public.bills bill on bill.id = voting.related_id
where voting.type = 'bill'
  and not exists (
    select 1 from public.bill_status_history history
    where history.bill_id = voting.related_id
      and history.metadata->>'voting_id' = voting.id::text
      and history.event_label = 'Votação aberta'
  );

insert into public.bill_status_history (
  bill_id, status, event_label, occurred_at, actor_id, metadata
)
select
  voting.related_id,
  bill.status,
  'Votação encerrada',
  voting.end_date,
  null,
  jsonb_build_object('source', 'historical_voting_end_date', 'voting_id', voting.id, 'house_id', voting.house_id)
from public.parliament_votings voting
join public.bills bill on bill.id = voting.related_id
where voting.type = 'bill'
  and voting.status = 'closed'
  and voting.end_date is not null
  and not exists (
    select 1 from public.bill_status_history history
    where history.bill_id = voting.related_id
      and history.metadata->>'voting_id' = voting.id::text
      and history.event_label = 'Votação encerrada'
  );

insert into public.bill_status_history (
  bill_id, status, event_label, occurred_at, actor_id, metadata
)
select
  bill.id,
  bill.status,
  'Publicado no Diário Oficial',
  entry.published_at,
  null,
  jsonb_build_object('source', 'historical_dou_entry', 'dou_entry_id', entry.id, 'gazette_type', entry.type)
from public.dou_entries entry
join public.bills bill on bill.id = entry.source_id
where not exists (
  select 1 from public.bill_status_history history
  where history.bill_id = bill.id
    and history.metadata->>'dou_entry_id' = entry.id::text
);

notify pgrst, 'reload schema';

commit;
