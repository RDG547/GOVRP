BEGIN;

CREATE OR REPLACE FUNCTION public.file_criminal_charges(p_investigation_id uuid, p_defendant_id uuid, p_title text, p_facts text, p_charges jsonb)
 RETURNS criminal_cases
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_case public.criminal_cases%rowtype;
  v_charge jsonb;
  v_penal public.penal_code%rowtype; v_fact_at timestamptz; v_snapshot jsonb;
begin
  if not public.justice_has_role(array['Admin', 'Promotor']) then
    raise exception 'ROLE_NOT_AUTHORIZED';
  end if;
  perform public.process_due_legal_effects();
  perform id from public.criminal_investigations where id=p_investigation_id for update;
  select c.* into v_case from public.criminal_cases c join public.case_parties p on p.case_id=c.id where c.investigation_id=p_investigation_id and p.profile_id=p_defendant_id and p.party_type='defendant';
  if found then if v_case.summary=btrim(p_facts) and v_case.prosecutor_id=auth.uid() then return v_case; end if; raise exception 'INVESTIGATION_ALREADY_CHARGED'; end if;
  if length(trim(coalesce(p_facts, ''))) < 40 then raise exception 'FACTS_TOO_SHORT'; end if;
  if jsonb_typeof(p_charges) IS DISTINCT FROM 'array' or jsonb_array_length(p_charges) = 0 then
    raise exception 'AT_LEAST_ONE_CHARGE_REQUIRED';
  end if;
  if not exists (
    select 1 from public.criminal_investigations
    where id = p_investigation_id and status = 'sent_to_prosecutor'
  ) then raise exception 'INVESTIGATION_NOT_READY_FOR_CHARGES'; end if;
  if not exists (
    select 1 from public.investigation_parties
    where investigation_id = p_investigation_id
      and profile_id = p_defendant_id and party_type = 'suspect'
  ) then raise exception 'DEFENDANT_NOT_INVESTIGATION_SUSPECT'; end if;

  if exists(select 1 from public.investigation_subjects where investigation_id=p_investigation_id and profile_id=p_defendant_id and subject_status='cleared') then raise exception 'DEFENDANT_NOT_INVESTIGATION_SUSPECT'; end if;
  select coalesce(o.occurred_at,i.opened_at) into v_fact_at from public.criminal_investigations i left join public.police_occurrences o on o.id=i.occurrence_id where i.id=p_investigation_id;
  insert into public.criminal_cases(
    case_number, investigation_id, prosecutor_id, status, title, summary, filed_at, facts_occurred_at
  )
  values (
    public.justice_next_number('GOV'), p_investigation_id, (select auth.uid()),
    'charge_filed', trim(p_title), trim(p_facts), now(),v_fact_at
  )
  returning * into v_case;

  insert into public.case_parties(case_id, profile_id, party_type, representation_status)
  values
    (v_case.id, p_defendant_id, 'defendant', 'pending'),
    (v_case.id, (select auth.uid()), 'prosecutor', 'active');

  for v_charge in select * from jsonb_array_elements(p_charges)
  loop
    select * into v_penal from public.penal_code
    where id = (v_charge->>'penal_code_id')::uuid;
    if not found then raise exception 'INVALID_PENAL_CODE'; end if;

    v_snapshot:=public.penal_rule_at(v_penal.id,v_fact_at);
    if not coalesce((v_snapshot->>'active')::boolean,false) then raise exception 'INVALID_PENAL_CODE'; end if;
    insert into public.case_charges(
      case_id, defendant_id, penal_code_id, charge_description,
      aggravating_factors, mitigating_factors, requested_sentence, attempted, legal_snapshot
    )
    values (
      v_case.id, p_defendant_id, v_penal.id,
      coalesce(nullif(trim(v_charge->>'description'), ''), v_penal.name),
      coalesce(v_charge->'aggravating_factors', '[]'::jsonb),
      coalesce(v_charge->'mitigating_factors', '[]'::jsonb),
      nullif(v_charge->>'requested_sentence', '')::numeric,
      coalesce((v_charge->>'attempted')::boolean, false),v_snapshot
    );
  end loop;

  perform public.justice_assign_case_judge(v_case.id);
  select * into v_case from public.criminal_cases where id = v_case.id;

  perform public.justice_write_audit(
    'case.charges_filed', 'criminal_case', v_case.id,
    null, to_jsonb(v_case), p_facts
  );

  return v_case;
end;
$function$;


CREATE OR REPLACE FUNCTION public.issue_criminal_sentence(p_case_id uuid, p_defendant_id uuid, p_result text, p_legal_reasoning text, p_final_sentence_units numeric, p_fine_amount numeric DEFAULT 0, p_prison_regime text DEFAULT 'closed'::text, p_special_justification text DEFAULT NULL::text)
 RETURNS sentences
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_case public.criminal_cases%rowtype;
  v_decision public.judicial_decisions%rowtype;
  v_sentence public.sentences%rowtype;
  v_min numeric;
  v_max numeric;
  v_base numeric;
  v_seconds integer;
  v_outside_limits boolean;
begin
  if not public.justice_has_role(array['Admin', 'Juiz']) then raise exception 'ROLE_NOT_AUTHORIZED'; end if;
  if p_final_sentence_units IS NULL OR p_final_sentence_units<=0 OR p_final_sentence_units::text IN('NaN','Infinity','-Infinity') OR p_fine_amount IS NULL OR p_fine_amount<0 OR p_fine_amount::text IN('NaN','Infinity','-Infinity') then raise exception 'INVALID_SENTENCE_VALUE'; end if;
  if p_result not in ('conviction', 'partial_conviction') then raise exception 'INVALID_SENTENCE_RESULT'; end if;
  if length(trim(coalesce(p_legal_reasoning, ''))) < 80 then raise exception 'LEGAL_REASONING_TOO_SHORT'; end if;

  select * into v_case from public.criminal_cases where id = p_case_id for update;
  if not found then raise exception 'CASE_NOT_FOUND'; end if;
  if v_case.status<>'awaiting_sentence' then raise exception 'CASE_NOT_READY_FOR_SENTENCE'; end if;
  if v_case.judge_id is distinct from (select auth.uid())
     and not public.justice_has_role(array['Admin']) then
    raise exception 'ONLY_ASSIGNED_JUDGE_CAN_SENTENCE';
  end if;
  if exists (
    select 1 from public.case_parties cp
    where cp.case_id = p_case_id and cp.profile_id = (select auth.uid())
      and cp.party_type <> 'judge'
  ) then raise exception 'JUDGE_CONFLICT_OF_INTEREST'; end if;

  select
    sum((cc.legal_snapshot->>'minimum')::numeric),
    sum((cc.legal_snapshot->>'maximum')::numeric),
    sum(((cc.legal_snapshot->>'minimum')::numeric + (cc.legal_snapshot->>'maximum')::numeric) / 2)
  into v_min, v_max, v_base
  from public.case_charges cc
  join public.penal_code pc on pc.id = cc.penal_code_id
  where cc.case_id = p_case_id and cc.defendant_id = p_defendant_id
    and cc.status in ('admitted');

  if v_min is null then raise exception 'NO_ADMITTED_CHARGES'; end if;
  v_outside_limits := p_final_sentence_units < v_min or p_final_sentence_units > v_max;
  if v_outside_limits and length(trim(coalesce(p_special_justification, ''))) < 40 then
    raise exception 'OUTSIDE_LIMITS_REQUIRES_SPECIAL_JUSTIFICATION';
  end if;

  v_seconds := public.calculate_sentence_duration(p_final_sentence_units, 1);

  insert into public.judicial_decisions(
    case_id, decision_type, judge_id, summary, legal_reasoning, result, is_final
  )
  values (
    p_case_id, 'sentence', (select auth.uid()),
    'Sentença condenatória', trim(p_legal_reasoning), p_result, false
  )
  returning * into v_decision;

  insert into public.sentences(
    case_id, decision_id, defendant_id, judge_id, sentence_type,
    base_sentence_units, final_sentence_units, real_duration_seconds,
    fine_amount, prison_regime, legal_snapshot
  )
  values (
    p_case_id, v_decision.id, p_defendant_id, (select auth.uid()),
    case when p_fine_amount > 0 then 'mixed' else 'custodial' end,
    v_base, p_final_sentence_units, v_seconds,
    greatest(0, p_fine_amount), p_prison_regime,(select jsonb_agg(legal_snapshot) from public.case_charges where case_id=p_case_id and defendant_id=p_defendant_id and status='admitted')
  )
  returning * into v_sentence;

  update public.case_charges
  set status = 'convicted'
  where case_id = p_case_id and defendant_id = p_defendant_id
    and status in ('admitted');

  update public.criminal_cases
  set status = 'convicted', final_decision = 'Condenação ainda sujeita a recurso'
  where id = p_case_id;

  insert into public.justice_deadlines(
    case_id, deadline_type, responsible_profile_id, rp_due_at, real_due_at
  )
  values (
    p_case_id, 'appeal',
    p_defendant_id,
    public.rp_now() + interval '5 days',
    now() + make_interval(secs => public.rp_duration_to_real_seconds(5, 'day'))
  );

  perform public.justice_notify(
    p_defendant_id, 'justice_sentence_issued',
    'Sentença emitida no processo ' || v_case.case_number || '. O prazo de recurso está aberto.',
    '/services/justice?view=citizen',
    jsonb_build_object('case_id', p_case_id, 'sentence_id', v_sentence.id)
  );

  perform public.justice_write_audit(
    'sentence.issued', 'sentence', v_sentence.id,
    null, to_jsonb(v_sentence),
    coalesce(p_special_justification, p_legal_reasoning)
  );

  return v_sentence;
end;
$function$;


CREATE OR REPLACE FUNCTION public.decide_charge_admission(p_case_id uuid, p_admitted boolean, p_reason text)
 RETURNS criminal_cases
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_old public.criminal_cases%rowtype;
  v_new public.criminal_cases%rowtype;
  v_defendant uuid;
begin
  if not public.justice_has_role(array['Admin', 'Juiz']) then raise exception 'ROLE_NOT_AUTHORIZED'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 40 then raise exception 'LEGAL_REASONING_TOO_SHORT'; end if;
  select * into v_old from public.criminal_cases where id = p_case_id for update;
  if not found then raise exception 'CASE_NOT_FOUND'; end if;
  if v_old.status <> 'judicial_review' then raise exception 'CASE_NOT_AWAITING_ADMISSION'; end if;
  if v_old.judge_id is distinct from v_actor and not public.justice_has_role(array['Admin']) then
    raise exception 'ONLY_ASSIGNED_JUDGE_CAN_DECIDE';
  end if;
  select profile_id into v_defendant from public.case_parties
  where case_id = p_case_id and party_type = 'defendant' order by created_at limit 1;

  insert into public.judicial_decisions(
    case_id, decision_type, judge_id, summary, legal_reasoning, result, is_final
  ) values (
    p_case_id, 'charge_admission', v_actor,
    case when p_admitted then 'Denúncia recebida' else 'Denúncia rejeitada' end,
    btrim(p_reason), case when p_admitted then 'admitted' else 'rejected' end, not p_admitted
  );

  update public.case_charges set status = case when p_admitted then 'admitted' else 'dismissed' end
  where case_id = p_case_id and status = 'filed';
  update public.criminal_cases
  set status = case
        when p_admitted then 'initial_defense'::public.justice_case_status
        else 'archived'::public.justice_case_status
      end,
      final_decision = case when p_admitted then null else 'Denúncia rejeitada' end,
      closed_at = case when p_admitted then null else clock_timestamp() end,
      updated_at = clock_timestamp()
  where id = p_case_id returning * into v_new;

  if p_admitted and v_defendant is not null then
    insert into public.justice_deadlines(case_id,deadline_type,responsible_profile_id,rp_due_at,real_due_at)
    values(p_case_id,'initial_defense',v_defendant,public.rp_now()+interval '5 days',clock_timestamp()+make_interval(secs=>public.rp_duration_to_real_seconds(5,'day')));
  end if;
  if p_admitted then perform public.justice_notify(v_defendant,'justice_charges_admitted','Uma denúncia criminal foi recebida contra você. O prazo de defesa está aberto.','/services/justice?view=citizen',jsonb_build_object('case_id',p_case_id)); end if;
  perform public.justice_write_audit('case.charge_admission','criminal_case',p_case_id,to_jsonb(v_old),to_jsonb(v_new),p_reason);
  return v_new;
end;
$function$;


CREATE OR REPLACE FUNCTION public.decide_case_appeal(p_appeal_id uuid, p_outcome text, p_decision text)
 RETURNS appeals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid(); v_appeal public.appeals%rowtype; v_original_judge uuid; v_case_status public.justice_case_status; v_sentence public.sentences%rowtype;
begin
  if not public.justice_has_role(array['Admin','Juiz']) then raise exception 'ROLE_NOT_AUTHORIZED'; end if;
  if p_outcome not in ('granted','partially_granted','denied') then raise exception 'INVALID_APPEAL_OUTCOME'; end if;
  if length(btrim(coalesce(p_decision,''))) < 60 then raise exception 'APPEAL_DECISION_TOO_SHORT'; end if;
  select * into v_appeal from public.appeals where id=p_appeal_id for update;
  if not found then raise exception 'APPEAL_NOT_FOUND'; end if;
  if v_appeal.status not in('filed','under_review') then raise exception 'APPEAL_ALREADY_DECIDED'; end if;
  if v_appeal.reviewing_judge_id IS DISTINCT FROM v_actor and not public.justice_has_role(array['Admin']) then raise exception 'ONLY_ASSIGNED_APPEAL_JUDGE'; end if;
  select judge_id into v_original_judge from public.judicial_decisions where id=v_appeal.decision_id;
  if v_original_judge=v_actor and not public.justice_has_role(array['Admin']) then raise exception 'APPEAL_REQUIRES_DIFFERENT_JUDGE'; end if;
  v_case_status:=case when p_outcome='granted' then 'instruction'::public.justice_case_status else 'final'::public.justice_case_status end;
  update public.appeals set status=p_outcome,reviewing_judge_id=v_actor,decision=btrim(p_decision),decided_at=clock_timestamp()
  where id=p_appeal_id returning * into v_appeal;
  insert into public.judicial_decisions(case_id,decision_type,judge_id,summary,legal_reasoning,result,is_final)
  values(v_appeal.case_id,'appeal',v_actor,'Julgamento de recurso',btrim(p_decision),p_outcome,p_outcome<>'granted');
  if p_outcome in ('denied','partially_granted') then
    for v_sentence in
      update public.sentences set status='final'
      where case_id=v_appeal.case_id and status='appealed'
      returning *
    loop
      perform public.justice_admit_sentence(v_sentence.id);
      v_case_status := 'execution';
    end loop;
  end if;
  if p_outcome='granted' then update public.sentences set status='cancelled' where case_id=v_appeal.case_id and status='appealed'; end if;
  perform public.justice_notify(v_appeal.filed_by,'justice_appeal_decided','O recurso do seu processo foi julgado. Consulte a decisão.','/services/justice?view=citizen',jsonb_build_object('case_id',v_appeal.case_id));
  update public.criminal_cases
  set status=v_case_status,
      final_decision=btrim(p_decision),
      closed_at=case when v_case_status='final' then clock_timestamp() else null end,
      updated_at=clock_timestamp()
  where id=v_appeal.case_id;
  perform public.justice_write_audit('appeal.decided','appeal',v_appeal.id,null,to_jsonb(v_appeal),p_decision);
  return v_appeal;
end;
$function$;


CREATE OR REPLACE FUNCTION public.close_completed_sentences()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_deadline record;
  v_sentence public.sentences%rowtype;
  v_term record;
  v_finalized integer := 0;
  v_released integer := 0;
  v_expired_warrants integer := 0;
begin
  update public.warrants
  set status = 'expired'
  where status = 'issued' and expires_at <= now();
  get diagnostics v_expired_warrants = row_count;

  for v_deadline in
    select * from public.justice_deadlines
    where status = 'open' and real_due_at <= now()
    order by real_due_at
    for update skip locked
  loop
    if v_deadline.deadline_type = 'appeal'
       and not exists (
         select 1 from public.appeals
         where case_id = v_deadline.case_id
           and status in ('filed', 'under_review')
       ) then
      update public.justice_deadlines
      set status = 'expired' where id = v_deadline.id;
      update public.criminal_cases
      set status = 'final' where id = v_deadline.case_id;
      update public.judicial_decisions
      set is_final = true where case_id = v_deadline.case_id and decision_type = 'sentence';

      for v_sentence in
        update public.sentences
        set status = 'final'
        where case_id = v_deadline.case_id and status = 'appealable'
        returning *
      loop
        insert into public.criminal_records(
          user_id, crime, sentence_details, sentence_start_date, sentence_end_date,
          is_active, judge_id, case_id, sentence_id, record_status
        )
        select
          v_sentence.defendant_id,
          string_agg(pc.name, ', ' order by pc.code),
          'Condenação no processo ' || cc.case_number || ' a '
            || v_sentence.final_sentence_units || ' ano(s) RP.',
          now(), now() + make_interval(secs => v_sentence.real_duration_seconds),
          true, v_sentence.judge_id, cc.id, v_sentence.id, 'conviction'
        from public.criminal_cases cc
        join public.case_charges ch on ch.case_id = cc.id
          and ch.defendant_id = v_sentence.defendant_id and ch.status = 'convicted'
        join public.penal_code pc on pc.id = ch.penal_code_id
        where cc.id = v_sentence.case_id
        group by cc.id, cc.case_number
        on conflict do nothing;

        perform public.justice_admit_sentence(v_sentence.id);
        v_finalized := v_finalized + 1;
      end loop;
    end if;
  end loop;

  for v_term in
    select * from public.prison_terms
    where custody_status in ('provisional', 'serving')
      and expected_release_at <= now()
    order by expected_release_at
    for update skip locked
  loop
    update public.prison_terms
    set custody_status = 'released', actual_release_at = now(),
        release_reason = 'Prazo de custódia integralmente cumprido'
    where id = v_term.id;

    if v_term.sentence_id is not null then
      update public.sentences set status = 'served', ends_at = now()
      where id = v_term.sentence_id;
      update public.criminal_cases set status='served',closed_at=clock_timestamp() where id=(select case_id from public.sentences where id=v_term.sentence_id);
    end if;
    if v_term.arrest_id is not null then
      update public.arrests
      set status = 'released', released_at = now(),
          release_reason = 'Prazo de custódia integralmente cumprido'
      where id = v_term.arrest_id;
    end if;

    insert into public.prison_events(
      prison_term_id, event_type, title, description
    )
    values (
      v_term.id, 'release', 'Soltura automática',
      'Prazo de custódia integralmente cumprido'
    );

    perform public.justice_notify(
      v_term.inmate_id, 'justice_release_order',
      'Seu prazo de custódia terminou e a soltura foi executada automaticamente.',
      '/services/justice?view=citizen',
      jsonb_build_object('prison_term_id', v_term.id)
    );
    perform public.justice_write_audit(
      'prison.auto_released', 'prison_term', v_term.id,
      to_jsonb(v_term), jsonb_build_object('custody_status', 'released'),
      'Prazo de custódia integralmente cumprido'
    );
    v_released := v_released + 1;
  end loop;

  return jsonb_build_object(
    'finalized_sentences', v_finalized,
    'released_prisoners', v_released,
    'expired_warrants', v_expired_warrants
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.penal_rule_at(p_penal_id uuid,p_occurred_at timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT item FROM jsonb_array_elements(p.legal_history) WITH ORDINALITY h(item,n)
   WHERE (item->>'valid_from')::timestamptz<=p_occurred_at ORDER BY (item->>'valid_from')::timestamptz DESC,n DESC LIMIT 1),
   jsonb_build_object('minimum',p.minimum_sentence_units,'maximum',p.maximum_sentence_units,'fine',p.base_fine,'active',p.is_active,'source','baseline'))
   ||jsonb_build_object('penal_code_id',p.id,'code',p.code,'name',p.name,'facts_occurred_at',p_occurred_at)
 FROM public.penal_code p WHERE p.id=p_penal_id
$$;
REVOKE ALL ON FUNCTION public.penal_rule_at(uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.penal_rule_at(uuid,timestamptz) TO authenticated,service_role;

INSERT INTO public.government_rules(rule_key,numeric_value,description,unit,rule_kind,is_active,definition,source_kind)
SELECT 'penalty_'||replace(id::text,'-',''),maximum_sentence_units,name,'RP','penalty',is_active,
 jsonb_build_object('penal_code_id',id,'minimum',minimum_sentence_units,'maximum',maximum_sentence_units,'fine',base_fine),'system' FROM public.penal_code ON CONFLICT DO NOTHING;
-- Legacy cases explicitly retain the best known baseline. No old sentence is recomputed.
UPDATE public.case_charges c SET legal_snapshot=public.penal_rule_at(c.penal_code_id,coalesce(
 (SELECT coalesce(o.occurred_at,i.opened_at) FROM public.criminal_cases k JOIN public.criminal_investigations i ON i.id=k.investigation_id LEFT JOIN public.police_occurrences o ON o.id=i.occurrence_id WHERE k.id=c.case_id),c.created_at)) WHERE c.legal_snapshot IS NULL;
UPDATE public.sentences s SET legal_snapshot=(SELECT jsonb_agg(c.legal_snapshot) FROM public.case_charges c WHERE c.case_id=s.case_id AND c.defendant_id=s.defendant_id) WHERE s.legal_snapshot IS NULL;

CREATE OR REPLACE FUNCTION private.capture_charge_norm()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE occurred timestamptz;
BEGIN
 IF TG_OP='UPDATE' AND NEW.legal_snapshot IS DISTINCT FROM OLD.legal_snapshot THEN RAISE EXCEPTION 'LEGAL_SNAPSHOT_IS_IMMUTABLE'; END IF;
 IF TG_OP='INSERT' THEN
   SELECT coalesce(facts_occurred_at,created_at) INTO occurred FROM public.criminal_cases WHERE id=NEW.case_id;
   NEW.legal_snapshot:=public.penal_rule_at(NEW.penal_code_id,occurred);
   IF NOT coalesce((NEW.legal_snapshot->>'active')::boolean,false) THEN RAISE EXCEPTION 'INVALID_PENAL_CODE'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER case_charge_norm BEFORE INSERT OR UPDATE OF legal_snapshot ON public.case_charges FOR EACH ROW EXECUTE FUNCTION private.capture_charge_norm();

CREATE OR REPLACE FUNCTION private.assign_appeal_reviewer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.reviewing_judge_id IS NULL THEN
   SELECT p.id INTO NEW.reviewing_judge_id FROM public.profiles p JOIN public.criminal_cases c ON c.id=NEW.case_id
   WHERE p.role='Juiz' AND p.deleted_at IS NULL AND p.id<>c.judge_id
     AND NOT EXISTS(SELECT 1 FROM public.case_parties cp WHERE cp.case_id=c.id AND (cp.profile_id=p.id OR cp.lawyer_id=p.id))
   ORDER BY (SELECT count(*) FROM public.appeals a WHERE a.reviewing_judge_id=p.id AND a.status IN('filed','under_review')),p.id LIMIT 1;
   IF NEW.reviewing_judge_id IS NULL THEN RAISE EXCEPTION 'NO_ELIGIBLE_APPEAL_JUDGE'; END IF;
 END IF;
 PERFORM public.justice_notify(NEW.reviewing_judge_id,'justice_appeal_assigned','Novo recurso aguarda sua análise.','/services/justice',jsonb_build_object('case_id',NEW.case_id));
 RETURN NEW;
END $$;
CREATE TRIGGER appeal_reviewer BEFORE INSERT ON public.appeals FOR EACH ROW EXECUTE FUNCTION private.assign_appeal_reviewer();

ALTER TABLE public.police_fines ADD COLUMN IF NOT EXISTS sentence_id uuid REFERENCES public.sentences(id);
CREATE UNIQUE INDEX IF NOT EXISTS sentence_fine_once ON public.police_fines(sentence_id) WHERE sentence_id IS NOT NULL;
CREATE OR REPLACE FUNCTION private.execute_sentence_fine()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.status='final' AND NEW.fine_amount>0 THEN
   INSERT INTO public.police_fines(user_id,officer_id,reason,amount,due_date,sentence_id,issuer_snapshot)
   VALUES(NEW.defendant_id,NEW.judge_id,'Multa judicial do processo '||(SELECT case_number FROM public.criminal_cases WHERE id=NEW.case_id),NEW.fine_amount,
     clock_timestamp()+make_interval(secs=>public.rp_duration_to_real_seconds(30,'day')),NEW.id,jsonb_build_object('source','sentence','legal_snapshot',NEW.legal_snapshot)) ON CONFLICT(sentence_id) WHERE sentence_id IS NOT NULL DO NOTHING;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER sentence_fine AFTER UPDATE OF status ON public.sentences FOR EACH ROW EXECUTE FUNCTION private.execute_sentence_fine();

ALTER TABLE public.case_timeline_events ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;
ALTER TABLE public.case_timeline_events DISABLE TRIGGER case_timeline_immutable;
UPDATE public.case_timeline_events SET is_internal=true WHERE source_table IN('criminal_investigations','investigation_subjects','investigation_events','case_evidence') AND NOT is_internal;
ALTER TABLE public.case_timeline_events ENABLE TRIGGER case_timeline_immutable;
CREATE OR REPLACE FUNCTION private.classify_case_timeline()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 NEW.is_internal:=NEW.source_table IN('criminal_investigations','investigation_subjects','investigation_events','case_evidence');
 RETURN NEW;
END $$;
CREATE TRIGGER timeline_confidentiality BEFORE INSERT ON public.case_timeline_events FOR EACH ROW EXECUTE FUNCTION private.classify_case_timeline();
DROP POLICY IF EXISTS case_timeline_contextual_read ON public.case_timeline_events;
CREATE POLICY case_timeline_contextual_read ON public.case_timeline_events FOR SELECT TO authenticated USING(
 ((case_id IS NOT NULL AND public.justice_can_access_case(case_id)) OR (investigation_id IS NOT NULL AND public.justice_can_access_investigation(investigation_id)))
 AND (NOT is_internal OR public.justice_has_role(ARRAY['Admin','Policial','Police','Delegado','Promotor','Juiz']))
);

CREATE OR REPLACE FUNCTION private.append_criminal_lifecycle_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c uuid; i uuid; title text; detail text; internal boolean;
BEGIN
 IF TG_TABLE_NAME='investigation_subjects' THEN
   i:=NEW.investigation_id; title:='Pessoa vinculada à investigação'; detail:='Atualização do vínculo e da situação do investigado.';
 ELSIF TG_TABLE_NAME='investigation_events' THEN i:=NEW.investigation_id; title:=NEW.title; detail:=NEW.description;
 ELSIF TG_TABLE_NAME='prison_events' THEN
   SELECT coalesce(s.case_id,a.case_id),a.investigation_id INTO c,i FROM public.prison_terms t LEFT JOIN public.sentences s ON s.id=t.sentence_id LEFT JOIN public.arrests a ON a.id=t.arrest_id WHERE t.id=NEW.prison_term_id;
   title:=NEW.title; detail:=NEW.description;
 ELSE RETURN NEW; END IF;
 IF c IS NULL THEN SELECT id INTO c FROM public.criminal_cases WHERE investigation_id=i ORDER BY created_at LIMIT 1; END IF;
 IF c IS NOT NULL OR i IS NOT NULL THEN PERFORM public.append_case_timeline_event(c,i,TG_TABLE_NAME,title,detail,NULL,NULL,TG_TABLE_NAME,coalesce((to_jsonb(NEW)->>'id')::uuid,(to_jsonb(NEW)->>'profile_id')::uuid),'{}'); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER subject_timeline AFTER INSERT OR UPDATE OF subject_status ON public.investigation_subjects FOR EACH ROW EXECUTE FUNCTION private.append_criminal_lifecycle_event();
CREATE TRIGGER investigation_event_timeline AFTER INSERT ON public.investigation_events FOR EACH ROW EXECUTE FUNCTION private.append_criminal_lifecycle_event();
CREATE TRIGGER prison_event_timeline AFTER INSERT ON public.prison_events FOR EACH ROW EXECUTE FUNCTION private.append_criminal_lifecycle_event();

CREATE OR REPLACE FUNCTION private.notify_case_representation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.lawyer_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.lawyer_id IS DISTINCT FROM OLD.lawyer_id) THEN
   PERFORM public.justice_notify(NEW.lawyer_id,'justice_lawyer_assigned','Você foi vinculado à representação em um processo.','/services/justice',jsonb_build_object('case_id',NEW.case_id));
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER case_representation_notification AFTER INSERT OR UPDATE OF lawyer_id ON public.case_parties FOR EACH ROW EXECUTE FUNCTION private.notify_case_representation();
REVOKE ALL ON FUNCTION private.capture_charge_norm(),private.assign_appeal_reviewer(),private.execute_sentence_fine(),private.append_criminal_lifecycle_event(),private.notify_case_representation() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
