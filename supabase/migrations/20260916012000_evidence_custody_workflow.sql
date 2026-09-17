create or replace function public.record_investigation_evidence(
  p_investigation_id uuid,
  p_evidence_type text,
  p_title text,
  p_description text,
  p_file_url text default null,
  p_evidence_hash text default null,
  p_seal boolean default false
)
returns public.case_evidence
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_investigation public.criminal_investigations%rowtype;
  v_evidence public.case_evidence%rowtype;
  v_status public.justice_evidence_status;
begin
  if not public.justice_has_role(array['Admin', 'Policial', 'Police', 'Delegado']) then
    raise exception 'ROLE_NOT_AUTHORIZED';
  end if;
  if length(btrim(coalesce(p_title, ''))) < 5 then raise exception 'EVIDENCE_TITLE_TOO_SHORT'; end if;
  if length(btrim(coalesce(p_description, ''))) < 10 then raise exception 'EVIDENCE_DESCRIPTION_TOO_SHORT'; end if;

  select * into v_investigation from public.criminal_investigations
  where id = p_investigation_id for update;
  if not found then raise exception 'INVESTIGATION_NOT_FOUND'; end if;
  if v_investigation.status not in ('open', 'in_progress', 'delegate_review', 'complement_requested') then
    raise exception 'INVESTIGATION_NOT_EDITABLE';
  end if;
  if v_investigation.lead_officer_id is distinct from v_actor
     and v_investigation.delegate_id is distinct from v_actor
     and not public.justice_has_role(array['Admin', 'Delegado']) then
    raise exception 'INVESTIGATION_NOT_ASSIGNED';
  end if;
  if p_seal and not public.justice_has_role(array['Admin', 'Delegado']) then
    raise exception 'ONLY_DELEGATE_CAN_SEAL_EVIDENCE';
  end if;

  v_status := case when p_seal then 'sealed'::public.justice_evidence_status else 'collected'::public.justice_evidence_status end;
  insert into public.case_evidence (
    investigation_id, evidence_type, title, description, file_url,
    submitted_by, sealed_at, evidence_hash, status, metadata
  ) values (
    p_investigation_id, btrim(p_evidence_type), btrim(p_title), btrim(p_description),
    nullif(btrim(coalesce(p_file_url, '')), ''), v_actor,
    case when p_seal then clock_timestamp() else null end,
    encode(extensions.digest(concat_ws('|',p_investigation_id::text,btrim(p_title),btrim(p_description),coalesce(p_file_url,'')),'sha256'),'hex'), v_status,
    jsonb_build_object('recorded_authoritatively', true)
  ) returning * into v_evidence;

  update public.criminal_investigations
  set status = case when status = 'open' then 'in_progress' else status end,
      updated_at = clock_timestamp()
  where id = p_investigation_id;

  insert into public.investigation_events (
    investigation_id, event_type, title, description, actor_id, metadata
  ) values (
    p_investigation_id, case when p_seal then 'evidence_sealed' else 'evidence_collected' end,
    btrim(p_title), btrim(p_description), v_actor,
    jsonb_build_object('evidence_id', v_evidence.id, 'status', v_status)
  );

  perform public.justice_write_audit(
    'investigation.evidence_recorded', 'case_evidence', v_evidence.id,
    null, to_jsonb(v_evidence), p_description
  );
  insert into public.evidence_custody_events(evidence_id,event_type,actor_id,justification)
  values(v_evidence.id,case when p_seal then 'sealed' else 'created' end,v_actor,btrim(p_description));
  return v_evidence;
end;
$$;

create or replace function public.seal_case_evidence(p_evidence_id uuid,p_justification text)
returns public.case_evidence language plpgsql security definer set search_path='' as $$
declare before_row public.case_evidence%rowtype; after_row public.case_evidence%rowtype;
begin
 if not public.justice_has_role(array['Admin','Delegado','Promotor','Juiz','Perito']) then raise exception 'ROLE_NOT_AUTHORIZED'; end if;
 if length(trim(coalesce(p_justification,'')))<10 then raise exception 'JUSTIFICATION_REQUIRED'; end if;
 select * into before_row from public.case_evidence where id=p_evidence_id for update;
 if not found then raise exception 'EVIDENCE_NOT_FOUND'; end if;
 if not (coalesce(public.justice_can_access_investigation(before_row.investigation_id),false) or coalesce(public.justice_can_access_case(before_row.criminal_case_id),false)) then raise exception 'CASE_ACCESS_DENIED'; end if;
 if before_row.status='sealed' then return before_row; end if;
 update public.case_evidence set status='sealed',sealed_at=clock_timestamp(),evidence_hash=encode(extensions.digest(concat_ws('|',id::text,version::text,title,description,coalesce(file_url,'')),'sha256'),'hex') where id=p_evidence_id returning * into after_row;
 insert into public.evidence_custody_events(evidence_id,event_type,actor_id,justification) values(p_evidence_id,'sealed',auth.uid(),trim(p_justification));
 if before_row.investigation_id is not null then
  insert into public.investigation_events(investigation_id,event_type,title,description,actor_id,metadata) values(before_row.investigation_id,'evidence_sealed','Prova lacrada',before_row.title,auth.uid(),jsonb_build_object('evidence_id',p_evidence_id));
 end if;
 perform public.justice_write_audit('evidence.sealed','case_evidence',p_evidence_id,to_jsonb(before_row),to_jsonb(after_row),p_justification);
 return after_row;
end $$;
revoke all on function public.seal_case_evidence(uuid,text) from public,anon;
grant execute on function public.seal_case_evidence(uuid,text) to authenticated;
notify pgrst,'reload schema';
