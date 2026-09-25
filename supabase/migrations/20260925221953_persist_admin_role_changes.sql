begin;
set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- All administrative clients use the existing RPC. A name/title edit is not a
-- new appointment; a removal to Cidadão is an administrative decision as well.
create or replace function public.admin_update_user(
  p_user_id uuid, p_full_name text, p_username text, p_role text, p_titles text[]
) returns json language plpgsql security definer set search_path = '' as $$
declare
  previous public.profiles%rowtype;
  updated public.profiles%rowtype;
  next_role text := public.canonical_official_role(btrim(p_role));
  changed boolean;
  previous_context text := current_setting('govrp.admin_role_change', true);
begin
  if auth.uid() is null or not coalesce(public.is_admin(auth.uid()), false) then
    raise exception 'Apenas administradores podem executar esta ação.' using errcode = '42501';
  end if;
  if nullif(btrim(p_full_name), '') is null or nullif(btrim(p_username), '') is null or nullif(next_role, '') is null then
    raise exception 'Informe nome, nome de usuário e cargo.' using errcode = '22023';
  end if;
  select * into previous from public.profiles where id = p_user_id and deleted_at is null for update;
  if not found then raise exception 'Usuário não encontrado.' using errcode = '22023'; end if;
  changed := previous.role is distinct from next_role;
  perform set_config('govrp.admin_role_change', p_user_id::text, true);
  update public.profiles set
    full_name = btrim(p_full_name), username = btrim(p_username), role = next_role,
    titles = coalesce(p_titles, '{}'::text[]),
    manual_role_override = case when changed then true else previous.manual_role_override end,
    role_assigned_at = case when changed then clock_timestamp() else previous.role_assigned_at end,
    role_assigned_by = case when changed then auth.uid() else previous.role_assigned_by end,
    updated_at = clock_timestamp()
  where id = p_user_id returning * into updated;
  perform set_config('govrp.admin_role_change', coalesce(previous_context, ''), true);
  return json_build_object('success', true, 'message', 'Usuário atualizado com sucesso.', 'user',
    json_build_object('id', updated.id, 'full_name', updated.full_name, 'username', updated.username,
      'role', updated.role, 'titles', updated.titles, 'manual_role_override', updated.manual_role_override));
end $$;
revoke all on function public.admin_update_user(uuid,text,text,text,text[]) from public,anon;
grant execute on function public.admin_update_user(uuid,text,text,text,text[]) to authenticated;

-- Preserve explicit removals and protect against an older deployed synchronizer
-- that tries to clear the assignment timestamp while replaying an election.
create or replace function public.protect_manual_admin_role() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_setting('govrp.admin_role_change', true) = new.id::text then return new; end if;
  if old.manual_role_override and not new.manual_role_override
     and new.role in ('Presidente','Vice-Presidente','Deputado','Senador')
     and new.role_assigned_at is null then
    new.role := old.role;
    new.manual_role_override := old.manual_role_override;
    new.role_assigned_at := old.role_assigned_at;
    new.role_assigned_by := old.role_assigned_by;
    return new;
  end if;
  if old.manual_role_override
     and old.role in ('Presidente','Vice-Presidente','Deputado','Senador','Ministro')
     and new.role in ('Usuario','Usuário','Cidadao','Cidadão')
     and new.manual_role_override
     and new.role_assigned_at is not distinct from old.role_assigned_at
     and not public.election_supersedes_manual_role(old.role, old.role_assigned_at) then
    new.role := old.role;
    new.role_assigned_at := old.role_assigned_at;
    new.role_assigned_by := old.role_assigned_by;
    return new;
  end if;
  if new.role is distinct from old.role and new.role is not null
     and new.role not in ('Usuario','Usuário','Cidadao','Cidadão')
     and not new.manual_role_override
     and not exists (select 1 from public.election_office_assignments a
       where a.profile_id = new.id and a.office_role = new.role and a.status = 'active'
         and a.term_starts_at <= clock_timestamp() and a.term_ends_at > clock_timestamp()) then
    new.manual_role_override := true;
    new.role_assigned_at := clock_timestamp();
  end if;
  if new.manual_role_override and new.role_assigned_at is null then
    new.role_assigned_at := clock_timestamp();
  end if;
  return new;
end $$;
revoke all on function public.protect_manual_admin_role() from public,anon,authenticated;

-- Keep election results immutable, but end incompatible current offices in the
-- same transaction as the administrative decision. Mesa retains its base mandate.
create function private.reconcile_admin_electoral_assignments() returns trigger
language plpgsql security definer set search_path = '' as $$
declare assignment record; changed boolean := false;
begin
  for assignment in
    update public.election_office_assignments set status = 'revoked', ended_at = clock_timestamp(),
      metadata = metadata || jsonb_build_object('end_reason', 'admin_role_changed', 'new_role', new.role, 'admin_id', new.role_assigned_by)
    where profile_id = new.id and status = 'active'
      and not (office_role = any(public.official_role_capabilities(new.role) || case
        when new.role in ('Presidente da Câmara dos Deputados','Vice-Presidente da Câmara dos Deputados') then array['Deputado']
        when new.role in ('Presidente do Senado','Vice-Presidente do Senado Federal') then array['Senador']
        else '{}'::text[] end))
    returning *
  loop
    changed := true;
    insert into public.election_audit_log(election_id,actor_id,actor_role,action,entity_type,entity_id,before_state,after_state)
    values(assignment.election_id,new.role_assigned_by,'Admin','admin_role_reassigned','office_assignment',assignment.id::text,
      jsonb_build_object('status','active','office_role',assignment.office_role),
      jsonb_build_object('status','revoked','new_role',new.role,'reason','admin_role_changed'));
  end loop;
  if changed then perform private.refresh_office_assignment_snapshot(); end if;
  return new;
end $$;
revoke all on function private.reconcile_admin_electoral_assignments() from public,anon,authenticated;
create trigger admin_electoral_assignment_changed after update of role,manual_role_override,role_assigned_at on public.profiles
for each row when (new.manual_role_override and
  (old.role is distinct from new.role or old.role_assigned_at is distinct from new.role_assigned_at))
execute function private.reconcile_admin_electoral_assignments();

-- The legacy cron must use the same idempotent settlement as the current calendar.
create or replace function public.notify_election_results() returns void
language plpgsql set search_path = '' as $$
begin
  perform private.process_electoral_calendar();
end $$;
revoke all on function public.notify_election_results() from public,anon,authenticated;
grant execute on function public.notify_election_results() to service_role;

-- Recover only a proven immediate reversal: the last role event replayed an old
-- election, cleared the timestamp, and immediately followed the Admin's decision.
-- Any subsequent role decision or newer election makes a citizen ineligible.
do $$
declare reversal record; restored integer := 0;
begin
  for reversal in
    select p.id, a.id as admin_event_id, a.payload, a.created_at
    from public.profiles p
    join lateral (select * from public.domain_events where source_id=p.id and event_type='role_changed' order by id desc limit 1) r on true
    join lateral (select * from public.domain_events where source_id=p.id and event_type='role_changed' and id<r.id order by id desc limit 1) a on true
    where p.deleted_at is null and not p.manual_role_override and p.role_assigned_at is null
      and r.payload->>'origin'='election' and r.payload->>'role_assigned_at' is null
      and a.payload->>'origin'='administration' and a.payload->>'role_assigned_at' is not null
      and p.role=r.payload->>'new_role' and r.payload->>'previous_role'=a.payload->>'new_role'
      and a.payload->>'new_role' in ('Cidadão','Presidente','Vice-Presidente','Deputado','Senador')
      and r.created_at between a.created_at and a.created_at+interval '5 minutes'
      and (r.payload->>'term_start_at')::timestamptz < (a.payload->>'role_assigned_at')::timestamptz
      and not exists(select 1 from public.election_office_assignments e where e.profile_id=p.id and e.term_starts_at>a.created_at)
    for update of p
  loop
    perform set_config('govrp.admin_role_change', reversal.id::text, true);
    perform set_config('govrp.role_change_reason', 'Restauração da alteração administrativa revertida indevidamente pela sincronização eleitoral', true);
    update public.profiles set role=reversal.payload->>'new_role',manual_role_override=true,
      role_assigned_at=(reversal.payload->>'role_assigned_at')::timestamptz,
      role_assigned_by=nullif(reversal.payload->>'actor_id','')::uuid,updated_at=clock_timestamp()
    where id=reversal.id;
    insert into public.security_audit_log(action,target_table,target_id,metadata)
    values('admin_role_reversal_repaired','profiles',reversal.id::text,jsonb_build_object('original_event_id',reversal.admin_event_id));
    restored := restored+1;
  end loop;
  perform set_config('govrp.admin_role_change', '', true);
  perform set_config('govrp.role_change_reason', '', true);
  raise notice 'Alterações administrativas restauradas: %', restored;
end $$;

commit;
