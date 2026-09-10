begin;
create or replace function public.get_my_legal_summary()
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null then raise exception 'Autenticação necessária.' using errcode='42501'; end if;
 select jsonb_build_object(
 'cases',coalesce((select jsonb_agg(to_jsonb(c)) from (
  select c.id,c.case_number,c.title,c.status from public.criminal_cases c where exists(select 1 from public.case_parties cp where cp.case_id=c.id and cp.profile_id=auth.uid()) order by c.updated_at desc limit 30) c),'[]'),
 'deadlines',coalesce((select jsonb_agg(to_jsonb(d)) from (
  select id,case_id,deadline_type,real_due_at from public.justice_deadlines where responsible_profile_id=auth.uid() and status='open' order by real_due_at limit 30) d),'[]'),
 'fines',coalesce((select jsonb_agg(to_jsonb(f)) from (
  select id,reason,amount,status,due_date from public.police_fines where user_id=auth.uid() order by created_at desc limit 30) f),'[]'),
 'notices',coalesce((select jsonb_agg(to_jsonb(n)) from (
  select id,content,link,created_at,is_read from public.notifications where user_id=auth.uid() and type like 'justice_%' order by created_at desc limit 20) n),'[]'),
 'security',public.get_my_security_status()) into result;
 return result;
end; $$;
revoke all on function public.get_my_legal_summary() from public,anon;
grant execute on function public.get_my_legal_summary() to authenticated;

create or replace function private.assert_electoral_management()
returns void language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and deleted_at is null and role in('Admin','Presidente do Portal Eleitoral')) then raise exception 'Esta função exige autoridade de gestão eleitoral.' using errcode='42501'; end if;
end; $$;
create or replace function public.manage_electoral_calendar(p_election_id uuid,p_data jsonb)
returns public.elections language plpgsql security definer set search_path='' as $$
declare old_row public.elections%rowtype; result public.elections%rowtype; d public.elections%rowtype;
begin
 perform private.assert_electoral_management();
 if jsonb_typeof(p_data) is distinct from 'object' or p_data-array['name','description','election_type_id','candidacy_start_date','candidacy_end_date','voting_start_date','voting_end_date']<>'{}' then raise exception 'Informe apenas os dados do calendário eleitoral.'; end if;
 d:=jsonb_populate_record(null::public.elections,p_data);
 if d.name is null or length(btrim(d.name))<5 or d.election_type_id is null or d.candidacy_start_date is null or d.candidacy_end_date is null or d.voting_start_date is null or d.voting_end_date is null
 or d.candidacy_start_date<=clock_timestamp() or d.candidacy_end_date<=d.candidacy_start_date or d.voting_start_date<=d.candidacy_end_date or d.voting_end_date<=d.voting_start_date then raise exception 'Defina datas futuras, em ordem: início e fim de candidaturas, início e fim da votação.'; end if;
 if p_election_id is not null then
  select * into old_row from public.elections where id=p_election_id for update;
  if not found or old_row.candidacy_start_date<=clock_timestamp() or exists(select 1 from public.candidates where election_id=p_election_id) or exists(select 1 from public.votes where election_id=p_election_id) then raise exception 'O calendário de uma eleição iniciada ou com candidaturas não pode ser alterado por esta ação.'; end if;
  update public.elections set name=d.name,description=d.description,election_type_id=d.election_type_id,candidacy_start_date=d.candidacy_start_date,candidacy_end_date=d.candidacy_end_date,voting_start_date=d.voting_start_date,voting_end_date=d.voting_end_date where id=p_election_id returning * into result;
 else
  insert into public.elections(name,description,election_type_id,candidacy_start_date,candidacy_end_date,voting_start_date,voting_end_date,status) values(d.name,d.description,d.election_type_id,d.candidacy_start_date,d.candidacy_end_date,d.voting_start_date,d.voting_end_date,'Scheduled') returning * into result;
 end if;
 perform economy_private.audit('electoral_calendar_managed','elections',result.id::text,to_jsonb(old_row),to_jsonb(result),'Organização institucional do calendário eleitoral.',auth.uid());
 return result;
end; $$;
create or replace function public.review_electoral_candidacy(p_candidate_id uuid,p_approved boolean,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare candidate public.candidates%rowtype; election public.elections%rowtype;
begin
 perform private.assert_electoral_management();
 if p_approved is null or length(btrim(coalesce(p_reason,'')))<20 then raise exception 'Informe uma decisão e uma fundamentação de pelo menos 20 caracteres.'; end if;
 select * into candidate from public.candidates where id=p_candidate_id for update;
 if not found then raise exception 'Candidatura indisponível.'; end if;
 select * into election from public.elections where id=candidate.election_id for update;
 if candidate.status not in('Pendente','Pending') then raise exception 'Esta candidatura já foi analisada.'; end if;
 if lower(election.status)<>'candidacy' or clock_timestamp() not between election.candidacy_start_date and election.candidacy_end_date then raise exception 'A análise deve ocorrer no período de candidaturas.'; end if;
 if election.voting_start_date<=clock_timestamp() or exists(select 1 from public.votes where election_id=election.id) then raise exception 'A votação já começou. A candidatura está protegida contra alteração administrativa.'; end if;
 if candidate.user_id=auth.uid() or candidate.vice_candidate_id=auth.uid() then raise exception 'Você não pode julgar sua própria candidatura ou chapa.' using errcode='42501'; end if;
 if p_approved and not exists(select 1 from public.profiles where id=candidate.user_id and deleted_at is null and onboarding_completed) then raise exception 'A cidadania do candidato precisa estar regular.'; end if;
 update public.candidates set status=case when p_approved then 'Approved' else 'Rejected' end,admin_feedback=btrim(p_reason) where id=candidate.id;
 insert into public.election_audit_log(election_id,actor_id,actor_role,action,entity_type,entity_id,before_state,after_state,metadata) values(election.id,auth.uid(),public.get_user_role(auth.uid()),case when p_approved then 'candidacy_approved' else 'candidacy_rejected' end,'candidate',candidate.id::text,to_jsonb(candidate),jsonb_build_object('status',case when p_approved then 'Approved' else 'Rejected' end),jsonb_build_object('feedback',p_reason));
 perform economy_private.audit('electoral_candidacy_reviewed','candidates',candidate.id::text,to_jsonb(candidate),jsonb_build_object('approved',p_approved,'reason',p_reason),'Análise institucional de candidatura.',auth.uid());
 insert into public.notifications(user_id,type,content,link,metadata) values(candidate.user_id,case when p_approved then 'candidacy_approved' else 'candidacy_rejected' end,case when p_approved then 'Sua candidatura foi aprovada.' else 'Sua candidatura foi indeferida. Consulte a fundamentação.' end,'/services/elections',jsonb_build_object('candidate_id',candidate.id,'reason',p_reason));
end; $$;
create or replace function public.get_electoral_management()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.assert_electoral_management();
 return jsonb_build_object('elections',coalesce((select jsonb_agg(to_jsonb(e)) from(select * from public.elections order by voting_start_date desc limit 100)e),'[]'),
 'candidates',coalesce((select jsonb_agg(to_jsonb(c)) from(select id,election_id,political_name,status,bio,proposals,admin_feedback,user_id,vice_candidate_id from public.candidates where status in('Pendente','Pending') order by created_at limit 200)c),'[]'));
end; $$;
alter function private.assert_electoral_management() owner to postgres;
alter function public.manage_electoral_calendar(uuid,jsonb) owner to postgres;
alter function public.review_electoral_candidacy(uuid,boolean,text) owner to postgres;
alter function public.get_electoral_management() owner to postgres;
revoke all on function private.assert_electoral_management() from public,anon,authenticated;
revoke all on function public.manage_electoral_calendar(uuid,jsonb),public.review_electoral_candidacy(uuid,boolean,text),public.get_electoral_management() from public,anon;
grant execute on function public.manage_electoral_calendar(uuid,jsonb),public.review_electoral_candidacy(uuid,boolean,text),public.get_electoral_management() to authenticated;
-- The established Admin actions share the same validations and audit trail.
create or replace function public.approve_candidacy(p_candidate_id uuid,p_feedback text)
returns json language plpgsql security definer set search_path='' as $$
begin
 perform public.review_electoral_candidacy(p_candidate_id,true,p_feedback);
 return json_build_object('success',true,'message','Candidatura aprovada.');
end; $$;
create or replace function public.reject_candidacy(p_candidate_id uuid,p_feedback text)
returns json language plpgsql security definer set search_path='' as $$
begin
 perform public.review_electoral_candidacy(p_candidate_id,false,p_feedback);
 return json_build_object('success',true,'message','Candidatura rejeitada.');
end; $$;
commit;
