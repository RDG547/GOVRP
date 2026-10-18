begin;
-- Public ballot identities and participation are released only after closing.
drop policy if exists "Public can view votes if election is public" on public.votes;
create policy public_votes_after_close on public.votes for select to authenticated using(exists(select 1 from public.elections e join public.election_types t on t.id=e.election_type_id where e.id=votes.election_id and t.is_public_vote and e.voting_end_date<clock_timestamp()));

create or replace function private.repair_stale_electoral_cleanup() returns integer language plpgsql security definer set search_path='' as $$
declare g public.government_terms%rowtype;pres public.election_office_assignments%rowtype;vice public.election_office_assignments%rowtype;transition timestamptz;repaired integer:=0;
begin
 perform pg_advisory_xact_lock(hashtext('govrp:presidential-succession'));
 for g in select * from public.government_terms where ended_at is null and source='vice_succession' and term_ends_at>clock_timestamp() for update loop
  transition:=nullif(g.leadership_history->-1->>'at','')::timestamptz;
  if g.leadership_history->-1->>'reason'<>'Vacância presidencial' or transition is null or jsonb_array_length(g.leadership_history)<>2 then continue;end if;
  select * into pres from public.election_office_assignments where election_id=g.election_id and profile_id=g.original_president_id and office_role='Presidente' and term_ends_at=g.term_ends_at and status='revoked' order by assigned_at desc limit 1;
  select * into vice from public.election_office_assignments where election_id=g.election_id and profile_id=g.head_id and office_role='Vice-Presidente' order by assigned_at desc limit 1;
  if pres.id is null or vice.id is null or not exists(select 1 from public.profiles where id=g.original_president_id and role='Cidadão' and not manual_role_override and deleted_at is null) then continue;end if;
  -- A later no-vote election caused the legacy service cleanup to erase a still-current mandate.
  if not exists(select 1 from public.elections old_e join public.elections later on later.election_type_id=old_e.election_type_id join public.election_settlements s on s.election_id=later.id where old_e.id=g.election_id and later.voting_end_date>old_e.voting_end_date and later.voting_end_date<=transition and later.voting_end_date>transition-interval '1 hour' and s.status='no_votes') then continue;end if;
  if not exists(select 1 from public.security_audit_log a where a.target_id=g.original_president_id::text and a.action='profile_privileges_changed' and a.actor_id is null and a.old_data->>'role'='Presidente' and a.new_data->>'role'='Cidadão' and a.created_at between transition-interval '30 seconds' and transition+interval '30 seconds') then continue;end if;
  perform set_config('govrp.executive_transition','replacing',true);
  perform set_config('govrp.role_change_reason','Correção auditada de remoção indevida pela sincronização eleitoral legada.',true);
  update public.government_terms set head_id=g.original_president_id,source='election',leadership_history=leadership_history||jsonb_build_array(jsonb_build_object('at',clock_timestamp(),'head_id',g.original_president_id,'previous_head_id',g.head_id,'reason','Correção de sincronização legada: eleição posterior sem votos não encerra mandato vigente.','source','migration_launch_repair')) where id=g.id;
  update public.election_office_assignments set status='revoked',ended_at=clock_timestamp(),metadata=metadata||'{"reason":"Correção de sucessão técnica indevida"}' where election_id=g.election_id and profile_id=g.head_id and office_role='Presidente' and status='active';
  update public.election_office_assignments set status='active',ended_at=null,metadata=metadata||'{"legacy_cleanup_repaired":true}' where id in (pres.id,vice.id);
  update public.profiles set role='Vice-Presidente',manual_role_override=false,role_assigned_at=clock_timestamp(),titles=array_remove(coalesce(titles,'{}'),'Presidente') where id=g.head_id and role='Presidente';
  update public.profiles set role='Presidente',manual_role_override=false,role_assigned_at=clock_timestamp(),titles=array_remove(coalesce(titles,'{}'),'Vice-Presidente') where id=g.original_president_id and role='Cidadão';
  perform set_config('govrp.executive_transition','',true);
  perform public.justice_write_audit('executive.legacy_cleanup_repaired','government',g.id,to_jsonb(g),jsonb_build_object('head_id',g.original_president_id,'vice_id',g.head_id,'term_ends_at',g.term_ends_at),'Correção da causa identificada nos logs: sincronização de eleição posterior sem votos. O término do mandato foi preservado.');
  repaired:=repaired+1;
 end loop;
 perform private.refresh_office_assignment_snapshot();return repaired;
end $$;
revoke all on function private.repair_stale_electoral_cleanup() from public,anon,authenticated;
select private.repair_stale_electoral_cleanup();

-- Preserve historical issuer data; recover a missing brand only with deterministic evidence.
update public.cards c set brand=coalesce((select lower(coalesce(a.approved_brand,a.brand)) from public.credit_card_applications a where a.user_id=c.user_id and lower(coalesce(a.approved_brand,a.brand)) in ('visa','mastercard') and a.status in ('Approved','Aprovado') order by a.created_at desc limit 1),case when c.card_number like '4%' then 'visa' when left(c.card_number,2) between '51' and '55' then 'mastercard' end)
where nullif(btrim(c.brand),'') is null and (exists(select 1 from public.credit_card_applications a where a.user_id=c.user_id and lower(coalesce(a.approved_brand,a.brand)) in ('visa','mastercard') and a.status in ('Approved','Aprovado')) or c.card_number like '4%' or left(c.card_number,2) between '51' and '55');

create function public.configure_agies_rules(p_rules jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare previous jsonb;k text;v numeric;
begin
 perform private.assert_agies();if not private.agies_manager() then raise exception 'A configuração exige direção da AGIES.' using errcode='42501';end if;
 select value into previous from public.system_settings where key='agies_rules' for update;
 if jsonb_typeof(p_rules) is distinct from 'object' or (p_rules-array(select jsonb_object_keys(previous)))<>'{}' or (previous-array(select jsonb_object_keys(p_rules)))<>'{}' then raise exception 'Informe todos os parâmetros institucionais.';end if;
 for k,v in select key,value::numeric from jsonb_each_text(p_rules) loop if v::text in ('NaN','Infinity','-Infinity') or v<>trunc(v) or v<1 or v>1000000 then raise exception 'Use valores inteiros positivos dentro dos limites.';end if;end loop;
 if (p_rules->>'simple_hours')::int not between 1 and 72 or (p_rules->>'complex_hours')::int not between (p_rules->>'simple_hours')::int and 168 or (p_rules->>'task_seconds')::int not between 10 and 600 or (p_rules->>'daily_operations')::int>10 or (p_rules->>'concurrent_operations')::int>5 or (p_rules->>'financial_access_hours')::int>48 or (p_rules->>'maximum_tasks')::int<>5 then raise exception 'Preserve os limites de duração, simultaneidade e acesso financeiro.';end if;
 update public.system_settings set value=p_rules where key='agies_rules';
 perform private.agies_audit('rules_configured',null,'Balanceamento de inteligência institucional.',jsonb_build_object('previous',previous,'next',p_rules));return p_rules;
end $$;
revoke all on function public.configure_agies_rules(jsonb) from public,anon;
grant execute on function public.configure_agies_rules(jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.get_election_results(p_election_id uuid)
 RETURNS TABLE(candidate_id uuid, political_name text, campaign_photo_url text, party_name text, party_logo_url text, vote_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    candidate.id,
    candidate.political_name,
    coalesce(candidate.identity_snapshot->>'avatar_url',candidate.campaign_photo_url),
    coalesce(candidate.identity_snapshot->'party'->>'name',party.name),
    coalesce(candidate.identity_snapshot->'party'->>'logo_url',party.logo_url),
    count(vote.id) filter (where vote.is_valid)
  from public.candidates candidate
  left join public.votes vote
    on vote.candidate_id = candidate.id
   and vote.election_id = candidate.election_id
   and vote.is_valid
  left join public.political_parties party on party.id = candidate.party_id
  where candidate.election_id = p_election_id
    and candidate.status = 'Approved'
    and exists(select 1 from public.elections e where e.id=p_election_id and e.voting_end_date<clock_timestamp())
  group by candidate.id, party.name, party.logo_url
  order by count(vote.id) filter (where vote.is_valid) desc, candidate.created_at, candidate.id;
$function$
;
commit;
