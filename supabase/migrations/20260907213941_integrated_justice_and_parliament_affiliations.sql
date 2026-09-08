-- The current affiliation is authoritative; preserve the old mandate snapshot.
ALTER TABLE public.parliament_members ADD COLUMN IF NOT EXISTS elected_party_id uuid REFERENCES public.political_parties(id) ON DELETE SET NULL;
UPDATE public.parliament_members SET elected_party_id=party_id WHERE elected_party_id IS NULL AND party_id IS NOT NULL;
CREATE OR REPLACE FUNCTION private.sync_current_parliament_party()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ids uuid[];
BEGIN
 ids:=CASE WHEN TG_OP='DELETE' THEN ARRAY[OLD.user_id] WHEN TG_OP='INSERT' THEN ARRAY[NEW.user_id] ELSE ARRAY[OLD.user_id,NEW.user_id] END;
 UPDATE public.parliament_members pm SET party_id=(SELECT m.party_id FROM public.party_members m WHERE m.user_id=pm.user_id ORDER BY m.joined_at DESC,m.id LIMIT 1)
 WHERE pm.user_id=ANY(ids) AND pm.party_id IS DISTINCT FROM (SELECT m.party_id FROM public.party_members m WHERE m.user_id=pm.user_id ORDER BY m.joined_at DESC,m.id LIMIT 1);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.sync_current_parliament_party() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS parliament_current_affiliation ON public.party_members;
CREATE TRIGGER parliament_current_affiliation AFTER INSERT OR UPDATE OR DELETE ON public.party_members FOR EACH ROW EXECUTE FUNCTION private.sync_current_parliament_party();
UPDATE public.parliament_members pm SET party_id=(SELECT m.party_id FROM public.party_members m WHERE m.user_id=pm.user_id ORDER BY m.joined_at DESC,m.id LIMIT 1)
WHERE pm.party_id IS DISTINCT FROM (SELECT m.party_id FROM public.party_members m WHERE m.user_id=pm.user_id ORDER BY m.joined_at DESC,m.id LIMIT 1);

-- The subject UI and the criminal lifecycle refer to the same suspect. Preserve
-- confidentiality; a cleared subject remains in the audit but is not chargeable.
CREATE OR REPLACE FUNCTION private.sync_investigation_subject_party()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid;
BEGIN
 IF NEW.subject_status='cleared' THEN RETURN NEW; END IF;
 SELECT coalesce(auth.uid(),i.lead_officer_id,i.created_by) INTO actor FROM public.criminal_investigations i WHERE i.id=NEW.investigation_id FOR UPDATE;
 UPDATE public.investigation_parties SET is_confidential=NEW.is_secret,notes=NEW.notes
 WHERE investigation_id=NEW.investigation_id AND profile_id=NEW.profile_id AND party_type='suspect';
 IF NOT FOUND THEN
   INSERT INTO public.investigation_parties(investigation_id,profile_id,party_type,notes,is_confidential,added_by)
   VALUES(NEW.investigation_id,NEW.profile_id,'suspect',NEW.notes,NEW.is_secret,actor);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.sync_investigation_subject_party() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS investigation_subject_party ON public.investigation_subjects;
CREATE TRIGGER investigation_subject_party AFTER INSERT OR UPDATE ON public.investigation_subjects FOR EACH ROW EXECUTE FUNCTION private.sync_investigation_subject_party();
-- Existing cases are repaired as data links only, without progressing a case.
INSERT INTO public.investigation_parties(investigation_id,profile_id,party_type,notes,is_confidential,added_by)
SELECT s.investigation_id,s.profile_id,'suspect',s.notes,s.is_secret,coalesce(i.lead_officer_id,i.created_by)
FROM public.investigation_subjects s JOIN public.criminal_investigations i ON i.id=s.investigation_id
WHERE s.subject_status<>'cleared' AND NOT EXISTS(SELECT 1 FROM public.investigation_parties p WHERE p.investigation_id=s.investigation_id AND p.profile_id=s.profile_id AND p.party_type='suspect');

CREATE OR REPLACE FUNCTION public.resolve_investigation(p_investigation_id uuid, p_outcome text, p_conclusion text, p_recommended_action text DEFAULT NULL::text)
 RETURNS criminal_investigations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_old public.criminal_investigations%rowtype;
  v_new public.criminal_investigations%rowtype;
begin
  if not public.justice_has_role(array['Admin', 'Delegado']) then raise exception 'ROLE_NOT_AUTHORIZED'; end if;
  if p_outcome not in ('indict', 'no_indictment') then raise exception 'INVALID_INVESTIGATION_OUTCOME'; end if;
  if length(btrim(coalesce(p_conclusion, ''))) < 40 then raise exception 'CONCLUSION_TOO_SHORT'; end if;

  select * into v_old from public.criminal_investigations where id = p_investigation_id for update;
  if not found then raise exception 'INVESTIGATION_NOT_FOUND'; end if;
  if v_old.status='sent_to_prosecutor' and p_outcome='indict' and v_old.conclusion=btrim(p_conclusion) then return v_old; end if;
  if v_old.status not in ('open', 'in_progress', 'delegate_review', 'complement_requested') then
    raise exception 'INVESTIGATION_ALREADY_RESOLVED';
  end if;

  if p_outcome = 'indict' then
    if not exists (
      select 1 from public.investigation_parties
      where investigation_id = p_investigation_id and party_type = 'suspect'
        and not exists(select 1 from public.investigation_subjects s where s.investigation_id=p_investigation_id and s.profile_id=public.investigation_parties.profile_id and s.subject_status='cleared')
    ) then raise exception 'INVESTIGATION_REQUIRES_SUSPECT'; end if;
    if not exists (
      select 1 from public.case_evidence
      where investigation_id = p_investigation_id and status = 'sealed'
    ) then raise exception 'INVESTIGATION_REQUIRES_SEALED_EVIDENCE'; end if;
  end if;

  update public.criminal_investigations
  set status = case when p_outcome = 'indict' then 'sent_to_prosecutor' else 'archived' end,
      conclusion = btrim(p_conclusion),
      recommended_action = case when p_outcome = 'indict'
        then coalesce(nullif(btrim(coalesce(p_recommended_action, '')), ''), 'criminal_charge')
        else 'no_indictment' end,
      closed_at = case when p_outcome = 'no_indictment' then clock_timestamp() else null end,
      updated_at = clock_timestamp()
  where id = p_investigation_id
  returning * into v_new;

  update public.police_occurrences
  set status = case when p_outcome = 'indict' then 'Concluída' else 'Arquivada' end,
      updated_at = clock_timestamp()
  where id = v_old.occurrence_id;

  insert into public.investigation_events (
    investigation_id, event_type, title, description, actor_id, metadata
  ) values (
    p_investigation_id,
    case when p_outcome = 'indict' then 'indictment' else 'no_indictment' end,
    case when p_outcome = 'indict' then 'Relatório final com indiciamento' else 'Investigação arquivada sem indiciamento' end,
    btrim(p_conclusion), v_actor,
    jsonb_build_object('outcome', p_outcome, 'recommended_action', v_new.recommended_action)
  );

  perform public.justice_write_audit(
    'investigation.' || p_outcome, 'criminal_investigation', p_investigation_id,
    to_jsonb(v_old), to_jsonb(v_new), p_conclusion
  );
  if p_outcome='indict' then
    update public.investigation_subjects set subject_status='indicted' where investigation_id=p_investigation_id and subject_status<>'cleared';
    perform public.justice_notify(p.id,'investigation_referred','Nova investigação foi remetida ao Ministério Público.','/services/justice',jsonb_build_object('investigation_id',p_investigation_id))
    from public.profiles p where p.role in('Promotor','Admin') and p.deleted_at is null;
    perform public.justice_notify(s.profile_id,'investigation_indicted','Você foi formalmente indiciado em uma investigação.','/services/justice?view=citizen',jsonb_build_object('investigation_id',p_investigation_id))
    from public.investigation_subjects s where s.investigation_id=p_investigation_id and s.subject_status='indicted' and not s.is_secret;
  end if;
  return v_new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.archive_referred_investigation(p_investigation_id uuid,p_reason text)
RETURNS public.criminal_investigations LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.criminal_investigations%rowtype;
BEGIN
 IF NOT public.justice_has_role(ARRAY['Admin','Promotor']) THEN RAISE EXCEPTION 'ROLE_NOT_AUTHORIZED'; END IF;
 IF length(btrim(coalesce(p_reason,'')))<40 THEN RAISE EXCEPTION 'CONCLUSION_TOO_SHORT'; END IF;
 SELECT * INTO r FROM public.criminal_investigations WHERE id=p_investigation_id FOR UPDATE;
 IF r.status IS DISTINCT FROM 'sent_to_prosecutor' THEN RAISE EXCEPTION 'INVESTIGATION_NOT_WITH_PROSECUTOR'; END IF;
 IF EXISTS(SELECT 1 FROM public.criminal_cases WHERE investigation_id=r.id) THEN RAISE EXCEPTION 'INVESTIGATION_ALREADY_CHARGED'; END IF;
 UPDATE public.criminal_investigations SET status='archived',conclusion=btrim(p_reason),closed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=r.id RETURNING * INTO r;
 INSERT INTO public.investigation_events(investigation_id,event_type,title,description,actor_id) VALUES(r.id,'prosecutor_archived','Arquivamento pelo Ministério Público',p_reason,auth.uid());
 PERFORM public.justice_write_audit('investigation.prosecutor_archived','criminal_investigation',r.id,null,to_jsonb(r),p_reason);
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.archive_referred_investigation(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.archive_referred_investigation(uuid,text) TO authenticated;


-- A definitive sentence creates an enforceable warrant. Custody starts only
-- when police executes it; existing provisional custody is converted in place.
ALTER TABLE public.warrants ADD COLUMN IF NOT EXISTS sentence_id uuid REFERENCES public.sentences(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS warrants_sentence_once ON public.warrants(sentence_id) WHERE sentence_id IS NOT NULL;
CREATE OR REPLACE FUNCTION private.admit_final_sentence(p_sentence_id uuid)
 RETURNS prison_terms
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_sentence public.sentences%rowtype;
  v_facility public.prison_facilities%rowtype;
  v_cell_id uuid;
  v_security text;
  v_term public.prison_terms%rowtype;
  v_seconds integer;
begin
  select * into v_sentence from public.sentences where id = p_sentence_id for update;
  if not found then raise exception 'SENTENCE_NOT_FOUND'; end if;
  if v_sentence.status not in ('final', 'serving') then raise exception 'SENTENCE_NOT_FINAL'; end if;
  if exists (
    select 1 from public.prison_terms
    where inmate_id = v_sentence.defendant_id
      and custody_status in ('awaiting_intake', 'provisional', 'serving')
  ) then raise exception 'INMATE_ALREADY_IN_CUSTODY'; end if;

  v_security := case v_sentence.prison_regime
    when 'maximum_security' then 'maximum'
    when 'closed' then 'high'
    when 'semi_open' then 'medium'
    else 'low'
  end;
  -- Serializes admissions, including provisional custody, before checking capacity.
  perform pg_advisory_xact_lock(hashtextextended('govrp-prison-admissions',0));
  v_seconds := greatest(
    60,
    v_sentence.real_duration_seconds - v_sentence.provisional_time_credit_seconds
  );

  select * into v_facility
  from public.prison_facilities f
  where f.is_active
    and f.security_level = v_security
    and (
      select count(*) from public.prison_terms pt
      where pt.facility_id = f.id
        and pt.custody_status in ('awaiting_intake', 'provisional', 'serving')
    ) < f.capacity
  order by f.name
  limit 1;

  if not found then
    select * into v_facility
    from public.prison_facilities f
    where f.is_active
      and (
        select count(*) from public.prison_terms pt
        where pt.facility_id = f.id
          and pt.custody_status in ('awaiting_intake', 'provisional', 'serving')
      ) < f.capacity
    order by case f.security_level
      when 'maximum' then 4 when 'high' then 3 when 'medium' then 2 else 1 end desc
    limit 1;
  end if;
  if not found then raise exception 'NO_PRISON_CAPACITY'; end if;

  select c.id into v_cell_id
  from public.prison_cells c
  join public.prison_wings w on w.id = c.wing_id
  where w.facility_id = v_facility.id and c.is_active and w.is_active
    and (
      select count(*) from public.prison_terms pt
      where pt.cell_id = c.id
        and pt.custody_status in ('awaiting_intake', 'provisional', 'serving')
    ) < c.capacity
  order by c.code
  limit 1;

  insert into public.prison_terms(
    sentence_id, inmate_id, facility_id, cell_id, expected_release_at,
    custody_status, security_level, original_duration_seconds, remaining_units
  )
  values (
    v_sentence.id, v_sentence.defendant_id, v_facility.id, v_cell_id,
    now() + make_interval(secs => v_seconds), 'serving', v_security,
    v_seconds, v_sentence.final_sentence_units
  )
  returning * into v_term;

  update public.sentences
  set status = 'serving', starts_at = now(),
      ends_at = v_term.expected_release_at
  where id = v_sentence.id;

  insert into public.prison_events(
    prison_term_id, event_type, title, description, registered_by
  )
  values (
    v_term.id, 'admission', 'Entrada na unidade',
    'Custódia iniciada por sentença definitiva.', (select auth.uid())
  );

  perform public.justice_notify(
    v_sentence.defendant_id, 'justice_prison_admission',
    'Sua custódia foi iniciada. A área prisional está disponível.',
    '/services/prison',
    jsonb_build_object('prison_term_id', v_term.id)
  );
  return v_term;
end;
$function$;

REVOKE ALL ON FUNCTION private.admit_final_sentence(uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.justice_admit_sentence(p_sentence_id uuid)
RETURNS public.prison_terms LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.sentences%rowtype; t public.prison_terms%rowtype; w public.warrants%rowtype; investigation uuid;
BEGIN
 SELECT * INTO s FROM public.sentences WHERE id=p_sentence_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SENTENCE_NOT_FOUND'; END IF;
 IF s.status NOT IN('final','serving') THEN RAISE EXCEPTION 'SENTENCE_NOT_FINAL'; END IF;
 SELECT * INTO t FROM public.prison_terms WHERE sentence_id=s.id ORDER BY admitted_at DESC LIMIT 1;
 IF FOUND THEN RETURN t; END IF;
 SELECT * INTO t FROM public.prison_terms WHERE inmate_id=s.defendant_id AND custody_status IN('provisional','serving','awaiting_intake') FOR UPDATE;
 IF FOUND THEN
   IF t.sentence_id IS NOT NULL THEN RAISE EXCEPTION 'INMATE_ALREADY_IN_CUSTODY'; END IF;
   UPDATE public.prison_terms SET sentence_id=s.id,custody_status='serving',
     expected_release_at=clock_timestamp()+make_interval(secs=>greatest(60,s.real_duration_seconds-extract(epoch from(clock_timestamp()-t.admitted_at))::integer)),
     original_duration_seconds=s.real_duration_seconds,remaining_units=s.final_sentence_units WHERE id=t.id RETURNING * INTO t;
   UPDATE public.sentences SET status='serving',starts_at=clock_timestamp(),ends_at=t.expected_release_at WHERE id=s.id;
   RETURN t;
 END IF;
 SELECT investigation_id INTO investigation FROM public.criminal_cases WHERE id=s.case_id;
 INSERT INTO public.warrants(warrant_number,warrant_type,target_profile_id,case_id,investigation_id,issued_by,expires_at,sentence_id)
 VALUES(public.justice_next_number('MAN'),'arrest',s.defendant_id,s.case_id,investigation,s.judge_id,
   clock_timestamp()+make_interval(secs=>public.rp_duration_to_real_seconds(30,'day')),s.id)
 ON CONFLICT(sentence_id) WHERE sentence_id IS NOT NULL DO NOTHING RETURNING * INTO w;
 IF w.id IS NOT NULL THEN
   PERFORM public.justice_notify(p.id,'sentence_warrant_issued','Mandado de prisão disponível para cumprimento.','/services/justice',jsonb_build_object('warrant_id',w.id,'case_id',s.case_id))
   FROM public.profiles p WHERE p.role IN('Admin','Policial','Police','Delegado') AND p.deleted_at IS NULL;
   PERFORM public.justice_write_audit('sentence.warrant_issued','warrant',w.id,null,to_jsonb(w),'Expedição para cumprimento de sentença definitiva');
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.justice_admit_sentence(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.justice_admit_sentence(uuid) TO service_role;

CREATE OR REPLACE FUNCTION "public"."execute_arrest_warrant"("p_warrant_id" "uuid", "p_location" "text", "p_description" "text") RETURNS "public"."arrests"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_warrant public.warrants%rowtype;
  v_arrest public.arrests%rowtype;
  v_facility public.prison_facilities%rowtype;
  v_term_seconds bigint;
  v_term public.prison_terms%rowtype;
begin
  if not public.justice_has_role(array['Admin', 'Policial', 'Police', 'Delegado']) then
    raise exception 'ROLE_NOT_AUTHORIZED';
  end if;
  select * into v_warrant from public.warrants where id = p_warrant_id for update;
  if not found then raise exception 'WARRANT_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended('govrp-prison-admissions',0));
  if v_warrant.status='executed' then
    select * into v_arrest from public.arrests where warrant_id=v_warrant.id order by arrested_at limit 1;
    return v_arrest;
  end if;
  if v_warrant.warrant_type<>'arrest' then raise exception 'WARRANT_IS_NOT_ARREST'; end if;
  if v_warrant.target_profile_id=auth.uid() then raise exception 'SELF_ARREST_DENIED'; end if;
  if length(btrim(coalesce(p_location,'')))<3 or length(btrim(coalesce(p_description,'')))<20 then raise exception 'ARREST_DETAILS_REQUIRED'; end if;
  if v_warrant.status <> 'issued' then raise exception 'WARRANT_NOT_ACTIVE'; end if;
  if v_warrant.expires_at <= now() then
    update public.warrants set status = 'expired' where id = p_warrant_id;
    raise exception 'WARRANT_EXPIRED';
  end if;

  insert into public.arrests(
    arrest_number, arrest_type, suspect_id, officer_id, warrant_id,
    investigation_id, case_id, alleged_crime, description, location,
    expires_at
  )
  values (
    public.justice_next_number('PRI'), 'warrant', v_warrant.target_profile_id,
    (select auth.uid()), v_warrant.id, v_warrant.investigation_id, v_warrant.case_id,
    'Prisão autorizada por mandado ' || v_warrant.warrant_number,
    trim(p_description), trim(p_location), v_warrant.expires_at
  )
  returning * into v_arrest;

  update public.warrants
  set status = 'executed', executed_by = (select auth.uid()), executed_at = now()
  where id = p_warrant_id;

  if v_warrant.sentence_id is not null then
    v_term:=private.admit_final_sentence(v_warrant.sentence_id);
    update public.prison_terms set arrest_id=v_arrest.id where id=v_term.id;
  else
    if exists(select 1 from public.prison_terms where inmate_id=v_arrest.suspect_id and custody_status in('provisional','serving','awaiting_intake')) then raise exception 'INMATE_ALREADY_IN_CUSTODY'; end if;
  select * into v_facility from public.prison_facilities f
  where is_active and (select count(*) from public.prison_terms pt where pt.facility_id=f.id and pt.custody_status in('awaiting_intake','provisional','serving'))<f.capacity
  order by case security_level
    when 'high' then 1 when 'maximum' then 2 else 3 end
  limit 1;
  if not found then raise exception 'NO_PRISON_CAPACITY'; end if;

  v_term_seconds := greatest(600, extract(epoch from (v_warrant.expires_at - now()))::bigint);
  insert into public.prison_terms(
    arrest_id, inmate_id, facility_id, expected_release_at,
    custody_status, security_level, original_duration_seconds
  )
  values (
    v_arrest.id, v_arrest.suspect_id, v_facility.id, v_warrant.expires_at,
    'provisional', v_facility.security_level, v_term_seconds
  );
  end if;

  perform public.justice_notify(
    v_arrest.suspect_id, 'justice_arrest_executed',
    'Você foi preso em cumprimento ao mandado ' || v_warrant.warrant_number || '.',
    '/services/prison',
    jsonb_build_object('arrest_id', v_arrest.id, 'warrant_id', v_warrant.id)
  );
  perform public.justice_write_audit(
    'warrant.executed', 'warrant', v_warrant.id,
    to_jsonb(v_warrant), jsonb_build_object('status', 'executed', 'arrest_id', v_arrest.id),
    p_description
  );
  return v_arrest;
end;
$$;



NOTIFY pgrst,'reload schema';
