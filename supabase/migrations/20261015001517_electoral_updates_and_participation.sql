begin;
CREATE OR REPLACE FUNCTION public.cast_ballot(p_election_id uuid, p_number text, p_kind text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_voter uuid := auth.uid();
  v_election public.elections%rowtype;
  v_candidate public.candidates%rowtype;
  v_vote_id uuid;
begin
  if p_kind not in ('candidate','blank','null') or p_kind is null then raise exception 'Selecione um voto válido, em branco ou nulo.'; end if;
  if v_voter is null then raise exception 'Entre na sua conta para votar.'; end if;

  if not exists (
    select 1 from public.profiles profile
    where profile.id = v_voter
      and profile.deleted_at is null
      and (profile.onboarding_completed or profile.role <> 'Usuário')
  ) then
    raise exception 'Seu cidadão ainda não está habilitado para votar.';
  end if;

  if not exists (
    select 1 from public.documents document
    where document.user_id = v_voter
      and document.type = 'Título de Eleitor'
      and document.is_valid
      and (document.expires_at is null or document.expires_at >= clock_timestamp())
  ) and not exists (
    select 1 from public.profiles profile
    where profile.id = v_voter and nullif(btrim(profile.titulo_eleitor), '') is not null
  ) then
    raise exception 'Emita seu título de eleitor no DIC antes de votar.';
  end if;

  select * into v_election
  from public.elections
  where id = p_election_id
  for share;

  if not found then raise exception 'Eleição não encontrada.'; end if;
  if lower(coalesce(v_election.status, '')) <> 'voting'
     or clock_timestamp() < v_election.voting_start_date
     or clock_timestamp() > v_election.voting_end_date then
    raise exception 'Esta eleição não está aberta para votação.';
  end if;

  if not public.can_vote_in_election(p_election_id) then raise exception 'Você não integra o eleitorado desta eleição.' using errcode='42501';end if;
  if p_kind in ('candidate','null') then
    if p_number is null or p_number !~ ('^[0-9]{'||private.election_number_digits(p_election_id)||'}$') then raise exception 'Digite o número completo.'; end if;
    select * into v_candidate from public.candidates where electoral_number=p_number and election_id=p_election_id and status='Approved' for share;
    if p_kind='candidate' and not found then raise exception 'Candidato não encontrado ou candidatura não aprovada.'; end if;
    if p_kind='null' and found then raise exception 'Este número corresponde a um candidato válido. Confira seu voto.'; end if;
  end if;
  insert into public.votes (
    election_id, voter_id, candidate_id, is_valid, validation_source,
    validated_at, integrity_metadata, ballot_kind
  ) values (
    p_election_id, v_voter, v_candidate.id, true, 'cast_ballot',
    clock_timestamp(), jsonb_build_object('authenticated_voter', true), p_kind
  ) returning id into v_vote_id;

  insert into public.election_audit_log (
    election_id, actor_id, actor_role, action, entity_type, entity_id, after_state
  ) values (
    p_election_id, v_voter, public.get_user_role(v_voter), 'vote_cast', 'vote', v_vote_id::text,
    jsonb_build_object('validation_source', 'cast_ballot')
  );

  return json_build_object('success', true, 'message', 'Voto computado com sucesso!');
exception
  when unique_violation then
    raise exception 'Você já votou nesta eleição.';
end;
$function$

;
CREATE OR REPLACE FUNCTION public.search_executive_candidates(p_office_key text, p_query text DEFAULT ''::text, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if auth.uid() is null or not coalesce(public.get_user_role(auth.uid()) in ('Admin','Presidente'),false) then raise exception 'A consulta exige autoridade presidencial.' using errcode='42501'; end if;
 if p_office_key is null or (p_office_key<>'minister' and not exists(select 1 from public.executive_office_definitions where office_key=p_office_key)) then raise exception 'Selecione um cargo válido.'; end if;
 if p_offset is null or p_offset<0 or p_offset>1000000 then raise exception 'Página inválida.'; end if;
 select coalesce(jsonb_agg(to_jsonb(c)), '[]') into result from (
  select p.id,p.full_name,p.username,p.avatar_url,p.role,exists(select 1 from public.minister_invitations inv where inv.candidate_id=p.id and inv.status='pending' and inv.expires_at>clock_timestamp()) invitation_pending,count(*) over() as total_count from public.profiles p
  where private.is_executive_candidate(p.id,p_office_key)
   and (coalesce(btrim(p_query),'')='' or position(lower(btrim(p_query)) in lower(concat_ws(' ',p.full_name,p.username,p.x_handle,p.x_username)))>0)
  order by p.full_name,p.id limit 51 offset p_offset
 ) c;
 return jsonb_build_object('candidates',case when jsonb_array_length(result)>50 then result-50 else result end,'has_more',jsonb_array_length(result)>50);
end; $function$

;
create or replace function private.publish_candidacy_review() returns trigger language plpgsql security definer set search_path='' as $$
declare headline text; body text; election_name text; vice_name text; article_id uuid; candidate_name text;
begin
 if new.status not in('Approved','Rejected') or new.status is not distinct from old.status then return new;end if;
 select name into election_name from public.elections where id=new.election_id;
 select full_name into vice_name from public.profiles where id=new.vice_candidate_id;
 candidate_name:=coalesce(new.political_name,new.identity_snapshot->>'name','Candidato');
 headline:=case when new.vice_candidate_id is not null then 'Chapa de ' else 'Candidatura de ' end||candidate_name||case when new.status='Approved' then ' é aprovada' else ' é rejeitada pela Justiça Eleitoral' end;
 body:=candidate_name||case when new.status='Approved' then ' teve a candidatura aprovada para ' else ' teve a candidatura rejeitada para ' end||coalesce(election_name,'a eleição')||'.'||case when vice_name is not null then ' Vice-Presidente na chapa: '||vice_name||'.' else '' end||case when new.electoral_number is not null then ' Número eleitoral: '||new.electoral_number||'.' else '' end||' Decisão registrada em '||to_char(clock_timestamp() at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||'.';
 -- Administrative feedback is private to the ticket; it is never copied into news.
 article_id:=md5('candidacy-review:'||new.id::text||':'||new.status)::uuid;
 insert into public.news_articles(id,author_id,title,content,source_event_type,source_event_id)
 values(article_id,coalesce(auth.uid(),new.user_id),headline,body,'electoral_candidacy_reviewed',new.id) on conflict(id) do nothing;
 if new.vice_candidate_id is not null and new.vice_candidate_id<>new.user_id then
  insert into public.notifications(user_id,type,content,link,metadata)
  values(new.vice_candidate_id,case when new.status='Approved' then 'candidacy_approved' else 'candidacy_rejected' end,
   case when new.status='Approved' then 'Sua chapa foi aprovada. Você foi confirmado como candidato a Vice-Presidente na chapa de '||candidate_name||'.' else 'A chapa de '||candidate_name||', na qual você concorre a Vice-Presidente, foi rejeitada. Consulte a fundamentação.' end,
   '/services/elections',jsonb_build_object('candidate_id',new.id,'reason',new.admin_feedback,'role','Vice-Presidente'));
 end if;
 return new;
end $$;
revoke all on function private.publish_candidacy_review() from public,anon,authenticated;
create trigger publish_candidacy_review after update of status on public.candidates for each row execute function private.publish_candidacy_review();

create or replace function private.real_election_participation(p_election_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 with election as(select * from public.elections where id=p_election_id),
 electorate as(
  select p.id from public.profiles p join auth.users u on u.id=p.id cross join election e
  where p.deleted_at is null and (p.onboarding_completed or p.role<>'Usuário')
  and (nullif(btrim(p.titulo_eleitor),'') is not null or exists(select 1 from public.documents d where d.user_id=p.id and d.type='Título de Eleitor' and d.is_valid and (d.expires_at is null or d.expires_at>=least(clock_timestamp(),e.voting_end_date))))
  and (e.election_mode='direct' or (p.id=any(e.electorate_ids) and exists(select 1 from public.parliament_members m where m.user_id=p.id and m.id=public.get_active_parliament_member_id(m.user_id,m.house_id))))
 ), ballots as(select v.* from public.votes v join auth.users u on u.id=v.voter_id where v.election_id=p_election_id and v.is_valid),
 totals as(select count(distinct voter_id) participants,count(*) filter(where ballot_kind='candidate') valid_votes,count(*) filter(where ballot_kind='blank') blank_votes,count(*) filter(where ballot_kind='null') null_votes from ballots),
 roll as(select id from electorate union select voter_id from ballots)
 select jsonb_build_object('eligible',(select count(*) from roll),'participants',participants,'valid_votes',valid_votes,'blank_votes',blank_votes,'null_votes',null_votes,'abstentions',greatest(0,(select count(*) from roll)-participants),'real_users_only',true,'captured_at',clock_timestamp()) from totals;
$$;
revoke all on function private.real_election_participation(uuid) from public,anon,authenticated;
alter table public.election_settlements add column real_participation jsonb not null default '{}';
create or replace function private.snapshot_election_participation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.real_participation='{}' then new.real_participation:=private.real_election_participation(new.election_id);end if;
 if tg_op='UPDATE' and old.real_participation<>'{}' then new.real_participation:=old.real_participation;end if;
 return new;
end $$;
revoke all on function private.snapshot_election_participation() from public,anon,authenticated;
create trigger snapshot_election_participation before insert or update on public.election_settlements for each row execute function private.snapshot_election_participation();
-- Old elections lack an electoral roll at closing. Mark this limitation explicitly.
update public.election_settlements set real_participation=private.real_election_participation(election_id)||'{"legacy_eligible_estimate":true}';
create or replace function public.get_election_participation(p_election_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;e public.elections%rowtype;
begin
 if auth.uid() is null then raise exception 'Entre para consultar os resultados.' using errcode='42501';end if;
 select * into e from public.elections where id=p_election_id;if e.id is null then return null;end if;
 select real_participation into result from public.election_settlements where election_id=e.id;
 if result is null or result='{}' then result:=private.real_election_participation(e.id);end if;
 if clock_timestamp()<e.voting_end_date then result:=(result-'abstentions')||'{"in_progress":true}';end if;
 return result;
end $$;
revoke all on function public.get_election_participation(uuid) from public,anon;
grant execute on function public.get_election_participation(uuid) to authenticated;

create or replace function private.guard_pending_minister_invitation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='pending' and (tg_op='INSERT' or new.candidate_id is distinct from old.candidate_id or old.status<>'pending') then
  perform pg_advisory_xact_lock(hashtextextended('minister-invite:'||new.candidate_id::text,0));
  if exists(select 1 from public.minister_invitations where candidate_id=new.candidate_id and id<>new.id and status='pending' and expires_at>clock_timestamp()) then raise exception 'Este cidadão já possui convite e está aguardando resposta.' using errcode='23505';end if;
 end if;
 return new;
end $$;
revoke all on function private.guard_pending_minister_invitation() from public,anon,authenticated;
create trigger guard_pending_minister_invitation before insert or update on public.minister_invitations for each row execute function private.guard_pending_minister_invitation();

CREATE OR REPLACE FUNCTION public.get_election_result_bundle(p_notification_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n public.notifications%rowtype;e public.elections%rowtype;sections jsonb;ids jsonb;
begin
 select * into n from public.notifications where id=p_notification_id and user_id=auth.uid() and type='election_result_published';
 if n.id is null then raise exception 'Resultado não disponível para esta conta.' using errcode='42501';end if;
 select * into e from public.elections where id::text=n.metadata->>'election_id';
 select coalesce(jsonb_agg(jsonb_build_object('id',el.id,'name',el.name,'office',coalesce(st.office_role,t.name),'status',st.status,'participation',public.get_election_participation(el.id),
  'winners',coalesce((select jsonb_agg(coalesce(case when w->>'office_role'='Vice-Presidente' then c.vice_identity_snapshot else c.identity_snapshot end,'{}')||jsonb_build_object('ticket_id',c.id,'office_role',w->>'office_role','votes',w->'votes','percentage',case when st.total_valid_votes>0 then round((w->>'votes')::numeric/st.total_valid_votes*100,2) else 0 end,'electoral_number',c.electoral_number)) from jsonb_array_elements(st.result) w join public.candidates c on c.id=(w->>'candidate_id')::uuid),'[]'::jsonb)) order by case when coalesce(st.office_role,t.name)='Presidente' then 0 when coalesce(st.office_role,t.name)='Senador' then 1 else 2 end),'[]'::jsonb) into sections
 from public.elections el join public.election_types t on t.id=el.election_type_id left join public.election_settlements st on st.election_id=el.id
 where (el.id=e.id or (st.election_id is not null and el.voting_start_date=e.voting_start_date and el.voting_end_date=e.voting_end_date and el.extraordinary=e.extraordinary));
 select coalesce(jsonb_agg(no.id),'[]'::jsonb) into ids from public.notifications no where no.user_id=auth.uid() and no.type='election_result_published' and (no.id=n.id or no.metadata->>'election_id'=n.metadata->>'election_id' or no.metadata->>'election_id' in(select s->>'id' from jsonb_array_elements(sections)s));
 return jsonb_build_object('sections',sections,'notification_ids',ids);
end $function$

;
notify pgrst,'reload schema';
commit;
