begin;
-- A multi-table Realtime channel cannot subscribe to an unpublished relation.
do $$ declare relation_name text; begin
 foreach relation_name in array array['parliament_commission_houses','parliament_commission_supports'] loop
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=relation_name) then
   execute format('alter publication supabase_realtime add table public.%I',relation_name);
  end if;
 end loop;
end $$;

-- Read-triggered maintenance must be idempotent: unchanged roles produce no WAL,
-- profile broadcasts or session hydration. Incompatible roles never regain a seat.
create or replace function public.refresh_parliament_leadership_terms()
returns jsonb language plpgsql security definer set search_path='' as $$
declare term record; expected_role text; base_role text;
begin
 for term in
  select t.*,m.user_id,m.term_end_date as member_end,p.role,p.deleted_at
  from public.parliament_leadership_terms t join public.parliament_members m on m.id=t.member_id
  join public.profiles p on p.id=m.user_id where t.status='active'
 loop
  expected_role:=public.get_parliament_leadership_role_label(term.house_id,term.position);
  base_role:=public.get_parliament_base_role_label(term.house_id);
  if term.term_end_date<current_date or term.member_end<current_date or term.deleted_at is not null
    or term.role not in(base_role,expected_role) then
   update public.parliament_leadership_terms set status='completed',concluded_at=coalesce(concluded_at,now()) where id=term.id and status='active';
   if term.role=expected_role then
    update public.profiles set role=case when term.member_end<current_date then 'Cidadão' else base_role end,updated_at=now() where id=term.user_id and role=expected_role;
   end if;
  elsif term.role is distinct from expected_role then
   update public.profiles set role=expected_role,updated_at=now() where id=term.user_id and role is distinct from expected_role;
  end if;
 end loop;
 return jsonb_build_object('success',true);
end $$;

-- Presidency eligibility is an institutional fact, not a citizenship search filter.
create function public.get_impeachment_presidents()
returns table(id uuid,full_name text,avatar_url text)
language sql stable security definer set search_path='' as $$
 select p.id,p.full_name,p.avatar_url from public.profiles p
 where auth.uid() is not null and p.role='Presidente' and p.deleted_at is null
 order by p.full_name,p.id;
$$;
revoke all on function public.get_impeachment_presidents() from public,anon;
grant execute on function public.get_impeachment_presidents() to authenticated;

-- Preserve ballots and election/mandate history when an admin removes a candidacy.
alter table public.candidates add column removed_at timestamptz;
create function public.admin_manage_candidacy(p_candidate_id uuid,p_action text,p_changes jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare candidate public.candidates%rowtype;
begin
 if not coalesce(public.is_admin(auth.uid()),false) then raise exception 'Somente Admin pode administrar candidaturas.' using errcode='42501'; end if;
 select * into candidate from public.candidates where id=p_candidate_id for update;
 if not found then raise exception 'Candidatura não encontrada.'; end if;
 if p_action='delete' then
  if candidate.removed_at is not null then return jsonb_build_object('success',true); end if;
  update public.candidates set removed_at=now(),status='Withdrawn' where id=candidate.id;
 elsif p_action='edit' then
  if candidate.removed_at is not null then raise exception 'Esta candidatura foi excluída.'; end if;
  if length(btrim(coalesce(p_changes->>'political_name','')))<2 then raise exception 'Informe o nome político do candidato.'; end if;
  update public.candidates set political_name=btrim(p_changes->>'political_name'),bio=coalesce(p_changes->>'bio',''),proposals=coalesce(p_changes->>'proposals',''),admin_feedback=nullif(p_changes->>'admin_feedback','') where id=candidate.id;
 else raise exception 'Ação administrativa inválida.'; end if;
 perform public.justice_write_audit('candidacy.'||p_action,'candidate',candidate.id,to_jsonb(candidate),jsonb_build_object('action',p_action,'changes',p_changes),'Ação administrativa; votos e mandatos históricos preservados.');
 return jsonb_build_object('success',true);
end $$;
revoke all on function public.admin_manage_candidacy(uuid,text,jsonb) from public,anon;
grant execute on function public.admin_manage_candidacy(uuid,text,jsonb) to authenticated;
create function private.prevent_removed_candidacy_reactivation() returns trigger language plpgsql set search_path='' as $$
begin
 if old.removed_at is not null and (new.removed_at is null or new.status is distinct from 'Withdrawn') then raise exception 'Esta candidatura foi excluída e não pode ser reativada.'; end if;
 return new;
end $$;
revoke all on function private.prevent_removed_candidacy_reactivation() from public,anon,authenticated;
create trigger protect_removed_candidacy before update on public.candidates for each row execute function private.prevent_removed_candidacy_reactivation();

-- A deleted party leaves its immutable financial ledger and snapshots, not an
-- active political structure. Treasury IDs remain stable for existing transactions.
alter table public.party_treasuries add column party_snapshot jsonb, add column archived_at timestamptz;
alter table public.party_treasuries drop constraint party_treasuries_party_id_fkey;
alter table public.party_history add column party_snapshot jsonb;
alter table public.party_history alter column party_id drop not null;
alter table public.party_history drop constraint party_history_party_id_fkey;
alter table public.party_history add constraint party_history_party_id_fkey foreign key(party_id) references public.political_parties(id) on delete set null;
alter table public.candidates add column party_snapshot jsonb;
alter table public.candidates drop constraint candidates_party_id_fkey;
alter table public.candidates add constraint candidates_party_id_fkey foreign key(party_id) references public.political_parties(id) on delete set null;
alter table public.parliament_members add column elected_party_snapshot jsonb;
alter table public.parliament_members drop constraint parliament_members_party_id_fkey;
alter table public.parliament_members add constraint parliament_members_party_id_fkey foreign key(party_id) references public.political_parties(id) on delete set null;

create function public.admin_permanently_delete_party(p_party_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare party public.political_parties%rowtype; snapshot jsonb;
begin
 if not coalesce(public.is_admin(auth.uid()),false) then raise exception 'Somente Admin pode excluir permanentemente um partido.' using errcode='42501'; end if;
 select * into party from public.political_parties where id=p_party_id for update;
 if not found then return; end if;
 if party.status is distinct from 'Encerrado' or exists(select 1 from public.party_members where party_id=p_party_id) then raise exception 'Encerre o partido antes de excluí-lo permanentemente.'; end if;
 snapshot:=to_jsonb(party);
 insert into public.party_history(party_id,actor_id,event_type,summary,previous_state,party_snapshot)
 values(party.id,auth.uid(),'permanently_deleted','Estrutura partidária excluída; registros financeiros e eleitorais preservados.',snapshot,snapshot);
 update public.party_history set party_snapshot=coalesce(party_snapshot,snapshot) where party_id=party.id;
 update public.party_treasuries set party_snapshot=snapshot,archived_at=now() where party_id=party.id;
 update public.candidates set party_snapshot=coalesce(party_snapshot,snapshot) where party_id=party.id;
 update public.parliament_members set elected_party_snapshot=coalesce(elected_party_snapshot,snapshot) where elected_party_id=party.id;
 perform public.justice_write_audit('party.permanently_deleted','political_party',party.id,snapshot,'{}','Exclusão administrativa de partido encerrado; histórico preservado.');
 delete from public.political_parties where id=party.id;
end $$;
revoke all on function public.admin_permanently_delete_party(uuid) from public,anon;
grant execute on function public.admin_permanently_delete_party(uuid) to authenticated;
CREATE OR REPLACE FUNCTION private.assign_candidate_electoral_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_digits integer; v_prefix text; v_min integer; v_max integer;
begin
  -- Deleting a closed party only detaches its FK; the ballot number is historical.
  if tg_op='UPDATE' and old.party_id is not null and new.party_id is null
    and new.party_snapshot->>'id'=old.party_id::text
    and new.election_id=old.election_id and new.electoral_number=old.electoral_number then return new; end if;
  v_digits:=private.election_number_digits(new.election_id);
  if v_digits is null then raise exception 'Eleição não encontrada.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('candidate-number:'||new.election_id::text,0));
  if tg_op='UPDATE' and old.electoral_number is not null and new.electoral_number is distinct from old.electoral_number and exists(select 1 from public.elections where id=new.election_id and (status in ('Voting','Finished') or voting_start_date<=clock_timestamp())) then raise exception 'O número não pode mudar depois do início da votação.'; end if;
  if new.party_id is not null then
    select electoral_number into v_prefix from public.political_parties where id=new.party_id;
  else
    v_prefix:='0'; -- Independent candidacies keep the existing constitutional eligibility rule.
  end if;
  if v_prefix is null then raise exception 'O partido precisa de número eleitoral.'; end if;
  v_min:=(v_prefix||repeat('0',v_digits-length(v_prefix)))::integer;
  v_max:=(v_prefix||repeat('9',v_digits-length(v_prefix)))::integer;
  if new.electoral_number is null then
    select lpad(n::text,v_digits,'0') into new.electoral_number from generate_series(v_min,v_max) n where not exists(select 1 from public.candidates c where c.election_id=new.election_id and c.electoral_number=lpad(n::text,v_digits,'0') and c.id<>new.id and lower(coalesce(c.status,'')) not in ('rejected','rejeitado','cancelled','cancelado','cancelada','withdrawn')) order by n limit 1;
  end if;
  if not coalesce(new.electoral_number ~ ('^[0-9]{'||v_digits||'}$') and left(new.electoral_number,length(v_prefix))=v_prefix,false) then raise exception 'Use % dígitos começando por %.',v_digits,v_prefix; end if;
  if exists(select 1 from public.candidates c where c.election_id=new.election_id and c.electoral_number=new.electoral_number and c.id<>new.id and lower(coalesce(c.status,'')) not in ('rejected','rejeitado','cancelled','cancelado','cancelada','withdrawn')) then raise exception 'Este número já está reservado nesta eleição.'; end if;
  return new;
end; $function$;


notify pgrst,'reload schema';
commit;
