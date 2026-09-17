begin;
alter table public.prison_terms add column if not exists custody_origin text not null default 'judicial' check(custody_origin in ('judicial','administrative'));
alter table public.prison_terms add column if not exists administrative_reason text;
alter table public.prison_terms add column if not exists administrative_actor_id uuid references public.profiles(id) on delete set null;
alter table public.prison_terms alter column expected_release_at drop not null;
alter table public.prison_terms drop constraint prison_terms_check;
alter table public.prison_terms add constraint prison_terms_check check ((custody_origin='judicial' and num_nonnulls(sentence_id,arrest_id)>=1 and expected_release_at is not null) or (custody_origin='administrative' and sentence_id is null and arrest_id is null and length(btrim(administrative_reason))>=20));
create or replace function public.admin_set_citizen_custody(p_user_id uuid,p_action text,p_reason text,p_release_at timestamptz default null,p_expected_term_id uuid default null)
returns public.prison_terms language plpgsql security definer set search_path='' as $$
declare term public.prison_terms%rowtype; facility uuid; old_state jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_admin(auth.uid()),false) then raise exception 'Apenas administradores podem alterar a custódia administrativa.'; end if;
  if length(btrim(coalesce(p_reason,'')))<20 then raise exception 'Descreva o motivo com pelo menos 20 caracteres.'; end if;
  if p_action not in ('admit','release') or p_action is null then raise exception 'Selecione prender ou libertar.'; end if;
  perform id from public.profiles where id=p_user_id and deleted_at is null for update;
  if not found then raise exception 'Cidadão não encontrado.'; end if;
  select * into term from public.prison_terms where inmate_id=p_user_id and custody_status in ('awaiting_intake','provisional','serving') order by admitted_at desc limit 1 for update;
  if term.id is not null and term.custody_origin<>'administrative' then raise exception 'Existe custódia judicial ativa. Consulte a sentença e utilize o fluxo judicial de libertação.'; end if;
  if p_action='admit' then
    if term.id is not null then raise exception 'Este cidadão já está em custódia administrativa.'; end if;
    if p_release_at is not null and (p_release_at<=clock_timestamp() or p_release_at>clock_timestamp()+interval '10 years') then raise exception 'Defina uma data futura, em até dez anos, para libertação.'; end if;
    select f.id into facility from public.prison_facilities f where is_active and (select count(*) from public.prison_terms t where t.facility_id=f.id and t.custody_status in('awaiting_intake','provisional','serving'))<f.capacity order by f.id limit 1 for update;
    if facility is null then raise exception 'Nenhuma unidade prisional ativa possui vaga.'; end if;
    insert into public.prison_terms(inmate_id,facility_id,expected_release_at,custody_status,security_level,original_duration_seconds,custody_origin,administrative_reason,administrative_actor_id)
    values(p_user_id,facility,p_release_at,'provisional','low',case when p_release_at is null then 2147483647 else greatest(1,ceil(extract(epoch from(p_release_at-clock_timestamp())))::integer) end,'administrative',btrim(p_reason),auth.uid()) returning * into term;
    insert into public.prison_events(prison_term_id,event_type,title,description) values(term.id,'admission','Custódia administrativa',btrim(p_reason));
    perform public.justice_notify(p_user_id,'justice_prison_admission','Você foi colocado em custódia administrativa.'||case when p_release_at is null then ' Prazo indeterminado; depende de liberação administrativa.' else ' Libertação prevista: '||to_char(p_release_at at time zone 'America/Sao_Paulo','DD/MM/YYYY "às" HH24:MI')||' (Brasília).' end,'/services/prison',jsonb_build_object('prison_term_id',term.id,'origin','administrative','release_at',p_release_at));
  else
    if term.id is null or term.id is distinct from p_expected_term_id then raise exception 'A situação prisional mudou. Confira a custódia atual antes de confirmar.'; end if;
    old_state:=to_jsonb(term);
    update public.prison_terms set custody_status='released',actual_release_at=clock_timestamp(),release_reason=btrim(p_reason) where id=term.id returning * into term;
    insert into public.prison_events(prison_term_id,event_type,title,description) values(term.id,'release','Libertação administrativa',btrim(p_reason));
    perform public.justice_notify(p_user_id,'justice_release_order','Você foi libertado da custódia administrativa.','/services/prison',jsonb_build_object('prison_term_id',term.id,'origin','administrative'));
  end if;
  perform public.justice_write_audit('prison.admin_'||p_action,'prison_term',term.id,old_state,to_jsonb(term),btrim(p_reason));
  return term;
end; $$;
revoke all on function public.admin_set_citizen_custody(uuid,text,text,timestamptz,uuid) from public,anon;
grant execute on function public.admin_set_citizen_custody(uuid,text,text,timestamptz,uuid) to authenticated;

create or replace function public.get_public_wanted_list()
returns table(profile_id uuid,full_name text,avatar_url text,warrant_number text,warrant_type text,issued_at timestamptz,expires_at timestamptz)
language sql stable security definer set search_path='' as $$
 select p.id,p.full_name,coalesce(nullif(p.x_avatar_url,''),p.avatar_url),w.warrant_number,w.warrant_type,w.issued_at,w.expires_at
 from public.warrants w join public.profiles p on p.id=w.target_profile_id
 left join public.criminal_cases c on c.id=w.case_id left join public.criminal_investigations i on i.id=w.investigation_id left join public.police_occurrences o on o.id=i.occurrence_id
 where w.warrant_type='arrest' and w.status='issued' and (w.expires_at is null or w.expires_at>clock_timestamp()) and p.deleted_at is null
 and coalesce(c.confidentiality_level,'public')='public' and coalesce(o.confidentiality_level,'public')='public';
$$;

create or replace function public.get_police_efficiency_metrics()
returns jsonb language sql stable security definer set search_path='' as $$
 with resolved as (
   select distinct on (i.occurrence_id) i.occurrence_id,coalesce(i.delegate_id,i.lead_officer_id) officer_id,i.opened_at,i.closed_at
   from public.criminal_investigations i join public.police_occurrences o on o.id=i.occurrence_id
   where i.closed_at is not null and o.status='Concluída' and i.closed_at>=i.opened_at order by i.occurrence_id,i.closed_at
 ), officers as (
   select officer_id from resolved union select executed_by from public.warrants where status='executed' and executed_at is not null
 ), ranking as (
   select p.id,p.full_name,p.avatar_url,
     (select count(*) from resolved r where r.officer_id=p.id) resolved_count,
     (select count(*) from public.warrants w where w.executed_by=p.id and w.status='executed' and w.executed_at is not null) executed_count,
     (select round(avg(extract(epoch from(r.closed_at-r.opened_at))/3600)::numeric,2) from resolved r where r.officer_id=p.id) average_hours
   from officers o join public.profiles p on p.id=o.officer_id where p.deleted_at is null
 ), totals as (
   select count(*) reported,count(*) filter(where status='Em investigação') investigating,count(*) filter(where status='Concluída') resolved from public.police_occurrences
 ) select jsonb_build_object('reported',t.reported,'inInvestigation',t.investigating,'resolved',t.resolved,
   'resolutionRate',case when t.reported=0 then 0 else round(100.0*t.resolved/t.reported,2) end,
   'ranking',coalesce((select jsonb_agg(to_jsonb(r)) from(select *,resolved_count+executed_count score from ranking order by resolved_count+executed_count desc,resolved_count desc,full_name limit 50)r),'[]'::jsonb)) from totals t
$$;
revoke all on function public.get_public_wanted_list(),public.get_police_efficiency_metrics() from public;
grant execute on function public.get_public_wanted_list(),public.get_police_efficiency_metrics() to authenticated,anon,service_role;
do $$begin if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='case_evidence') then alter publication supabase_realtime add table public.case_evidence; end if; end $$;
CREATE OR REPLACE FUNCTION public.decide_fine_appeal(p_appeal_id uuid, p_approved boolean, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare appeal public.fine_appeals%rowtype; fine public.police_fines%rowtype;
begin
  if not public.justice_has_role(array['Admin','Corregedor','Juiz','Delegado']) then raise exception 'Sem competência para julgar o recurso.'; end if;
  if length(trim(coalesce(p_reason,'')))<15 then raise exception 'Fundamente a decisão.'; end if;
  select * into appeal from public.fine_appeals where id=p_appeal_id for update;
  if not found or appeal.status not in('pending','under_review') then raise exception 'Recurso indisponível para decisão.'; end if;
  select * into fine from public.police_fines where id=appeal.fine_id for update;
  update public.fine_appeals set status=case when p_approved then 'approved' else 'rejected' end,reviewed_by=auth.uid(),decision_reason=trim(p_reason),reviewed_at=clock_timestamp() where id=p_appeal_id;
  if fine.status not in ('Paga','Cancelada') then update public.police_fines set status=case when p_approved then 'Cancelada' when due_date<current_date then 'Vencida' else 'Pendente' end,updated_at=clock_timestamp() where id=fine.id; end if;
  perform public.justice_notify(appeal.appellant_id,'fine_appeal_decided','O recurso da multa '||fine.fine_code||' foi '||case when p_approved then 'deferido.' else 'indeferido.' end,'/services/justice?view=citizen',jsonb_build_object('appeal_id',appeal.id,'fine_id',fine.id));
  perform public.justice_write_audit('fine.appeal_decided','fine_appeal',appeal.id,to_jsonb(appeal),jsonb_build_object('approved',p_approved,'reason',trim(p_reason)),trim(p_reason));
  return jsonb_build_object('success',true);
end; $function$;


update public.police_fines f set status=case when due_date<current_date then 'Vencida' else 'Pendente' end where f.status='Em Recurso' and exists(select 1 from public.fine_appeals a where a.fine_id=f.id and a.status='rejected');
commit;
