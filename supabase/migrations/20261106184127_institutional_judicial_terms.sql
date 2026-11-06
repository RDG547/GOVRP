BEGIN;
ALTER TABLE public.criminal_cases ADD COLUMN IF NOT EXISTS court_name text NOT NULL DEFAULT 'Supremo Tribunal Federal';
ALTER TABLE public.executive_office_definitions ADD COLUMN IF NOT EXISTS is_assignable boolean NOT NULL DEFAULT true;
UPDATE public.executive_office_definitions SET is_assignable=false,required_for_formation=false,description='Competência temporária dos dois juízes designados por rodízio eleitoral; não admite nomeação presidencial.' WHERE office_key='electoral_portal_president';
-- Independent mandates were not represented by government-bound invitations.
-- Invitations and Senate votes remain the existing canonical workflows.
CREATE TABLE IF NOT EXISTS public.institutional_terms(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),office_key text NOT NULL REFERENCES public.executive_office_definitions(office_key),
 profile_id uuid NOT NULL REFERENCES public.profiles(id),invitation_id uuid UNIQUE REFERENCES public.minister_invitations(id),
 appointed_by uuid REFERENCES public.profiles(id),government_id uuid REFERENCES public.government_terms(id),
 starts_at timestamptz NOT NULL DEFAULT clock_timestamp(),ends_at timestamptz,starts_at_rp timestamptz NOT NULL DEFAULT public.rp_now(),ends_at_rp timestamptz,
 ended_at timestamptz,end_reason text,previous_role text NOT NULL DEFAULT 'Cidadão',status text NOT NULL DEFAULT 'active' CHECK(status IN('active','resigned','expired','removed','dismissed')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),CHECK(ends_at IS NULL OR ends_at>starts_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS institutional_active_seat ON public.institutional_terms(office_key) WHERE status='active';
CREATE UNIQUE INDEX IF NOT EXISTS institutional_active_person ON public.institutional_terms(profile_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS institutional_term_calendar ON public.institutional_terms(ends_at) WHERE status='active';
ALTER TABLE public.institutional_terms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS institutional_terms_public_read ON public.institutional_terms;
CREATE POLICY institutional_terms_public_read ON public.institutional_terms FOR SELECT TO authenticated USING(true);
REVOKE ALL ON public.institutional_terms FROM anon,authenticated;
GRANT SELECT ON public.institutional_terms TO authenticated;

ALTER TABLE public.minister_invitations ADD COLUMN IF NOT EXISTS institutional_stage text;
ALTER TABLE public.minister_invitations ADD COLUMN IF NOT EXISTS hearing_notes jsonb NOT NULL DEFAULT '[]';
ALTER TABLE public.minister_invitations ADD COLUMN IF NOT EXISTS senate_voting_id uuid REFERENCES public.parliament_votings(id);
ALTER TABLE public.minister_invitations ADD COLUMN IF NOT EXISTS hearing_closed_at timestamptz;
ALTER TABLE public.public_integrity_cases ADD COLUMN IF NOT EXISTS institutional_term_id uuid REFERENCES public.institutional_terms(id);
ALTER TABLE public.public_integrity_cases ADD COLUMN IF NOT EXISTS defense_deadline_at timestamptz;
ALTER TABLE public.public_integrity_cases ADD COLUMN IF NOT EXISTS senate_voting_id uuid REFERENCES public.parliament_votings(id);

ALTER TABLE public.executive_office_definitions DROP CONSTRAINT IF EXISTS executive_office_definitions_role_label_key;
INSERT INTO public.executive_office_definitions(office_key,role_label,description,required_for_formation,sort_order,government_bound)
SELECT 'supreme_court_'||n,'Juiz','STF · vaga '||n||' · indicação, aceite, sabatina e aprovação do Senado; mandato independente de 8 anos RP / 2 meses reais.',true,50+n,false FROM generate_series(1,5)n ON CONFLICT(office_key) DO NOTHING;
INSERT INTO public.executive_office_definitions(office_key,role_label,description,required_for_formation,sort_order,government_bound)
VALUES('public_prosecutor','Promotor','Ministério Público · convite presidencial com aceite do indicado.',true,60,false) ON CONFLICT(office_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.judicial_electoral_assignments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),cohort_key text NOT NULL,election_ids uuid[] NOT NULL,term_id uuid NOT NULL REFERENCES public.institutional_terms(id),
 profile_id uuid NOT NULL REFERENCES public.profiles(id),starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),ended_at timestamptz,UNIQUE(cohort_key,term_id),CHECK(ends_at>starts_at)
);
CREATE INDEX IF NOT EXISTS judicial_electoral_windows ON public.judicial_electoral_assignments(profile_id,starts_at,ends_at) WHERE ended_at IS NULL;
ALTER TABLE public.judicial_electoral_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS judicial_electoral_public_read ON public.judicial_electoral_assignments;
CREATE POLICY judicial_electoral_public_read ON public.judicial_electoral_assignments FOR SELECT TO authenticated USING(true);
REVOKE ALL ON public.judicial_electoral_assignments FROM anon,authenticated;
GRANT SELECT ON public.judicial_electoral_assignments TO authenticated;

CREATE OR REPLACE FUNCTION public.is_electoral_judge(p_user_id uuid,p_election_id uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.judicial_electoral_assignments a JOIN public.institutional_terms t ON t.id=a.term_id JOIN public.profiles p ON p.id=t.profile_id
 WHERE a.profile_id=p_user_id AND t.status='active' AND t.ends_at>clock_timestamp() AND p.deleted_at IS NULL AND p.role IN('Juiz','Presidente do STF') AND a.ended_at IS NULL
 AND clock_timestamp()>=a.starts_at AND clock_timestamp()<a.ends_at AND (p_election_id IS NULL OR p_election_id=ANY(a.election_ids)))
$$;
REVOKE ALL ON FUNCTION public.is_electoral_judge(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_electoral_judge(uuid,uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION private.institutional_notice(p_user_id uuid,p_kind text,p_content text,p_source uuid,p_metadata jsonb DEFAULT '{}') RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF p_user_id IS NULL THEN RETURN;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.notifications WHERE user_id=p_user_id AND type=p_kind AND metadata->>'institutional_source'=p_source::text) THEN
 INSERT INTO public.notifications(user_id,type,content,link,metadata) VALUES(p_user_id,p_kind,p_content,'/services/justice',coalesce(p_metadata,'{}')||jsonb_build_object('institutional_source',p_source,'popup_pending',true));END IF;
END $$;

CREATE OR REPLACE FUNCTION private.maintain_institutional_calendar() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t record;v record;e record;chosen record;needed int;BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtext('govrp:institutional-calendar')) THEN RETURN;END IF;
 PERFORM pg_advisory_xact_lock(hashtext('govrp:executive:appointments'));
 FOR t IN SELECT id FROM public.institutional_terms WHERE status='active' AND ends_at<=clock_timestamp() ORDER BY ends_at FOR UPDATE SKIP LOCKED LOOP
  PERFORM private.end_institutional_term(t.id,'expired',NULL);
 END LOOP;
 FOR v IN SELECT id FROM public.parliament_votings WHERE type IN('institutional_appointment','judicial_impeachment') AND status='active' AND end_date<=clock_timestamp() ORDER BY end_date FOR UPDATE SKIP LOCKED LOOP
  PERFORM private.finish_institutional_vote(v.id);
 END LOOP;
 UPDATE public.judicial_electoral_assignments SET ended_at=ends_at WHERE ended_at IS NULL AND ends_at<=clock_timestamp();
 -- Simultaneous elections share the same two officials. Overlapping different
 -- windows use separate officials and keep their own rotation history.
 FOR e IN SELECT md5(voting_start_date::text||'/'||voting_end_date::text) cohort,
 array_agg(id ORDER BY id) ids,voting_start_date-interval '7 days' start_at,voting_end_date+interval '1 day' end_at
 FROM public.elections WHERE lower(coalesce(status,'')) NOT IN('cancelled','canceled','cancelada')
 AND clock_timestamp()>=voting_start_date-interval '7 days' AND clock_timestamp()<voting_end_date+interval '1 day'
 GROUP BY voting_start_date,voting_end_date ORDER BY voting_start_date LOOP
  UPDATE public.judicial_electoral_assignments SET election_ids=e.ids WHERE cohort_key=e.cohort AND ended_at IS NULL;
  SELECT greatest(0,2-count(*))::int INTO needed FROM public.judicial_electoral_assignments a JOIN public.institutional_terms it ON it.id=a.term_id WHERE a.cohort_key=e.cohort AND a.ended_at IS NULL AND it.status='active';
  FOR chosen IN SELECT it.id,it.profile_id FROM public.institutional_terms it JOIN public.profiles p ON p.id=it.profile_id
  WHERE it.status='active' AND it.office_key LIKE 'supreme_court_%' AND it.ends_at>clock_timestamp() AND p.role IN('Juiz','Presidente do STF') AND p.deleted_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM public.judicial_electoral_assignments a WHERE a.term_id=it.id AND (a.cohort_key=e.cohort OR a.ended_at IS NULL AND a.starts_at<e.end_at AND a.ends_at>e.start_at))
  ORDER BY (SELECT max(created_at) FROM public.judicial_electoral_assignments WHERE profile_id=it.profile_id) ASC NULLS FIRST,it.starts_at,it.id LIMIT needed LOOP
   INSERT INTO public.judicial_electoral_assignments(cohort_key,election_ids,term_id,profile_id,starts_at,ends_at) VALUES(e.cohort,e.ids,chosen.id,chosen.profile_id,e.start_at,e.end_at);
   PERFORM private.institutional_notice(chosen.profile_id,'electoral_duty_assigned','Você foi designado para a administração do Portal Eleitoral durante esta janela. Seu cargo principal continua sendo Juiz.',e.ids[1],jsonb_build_object('starts_at',e.start_at,'ends_at',e.end_at,'election_ids',e.ids));
  END LOOP;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.get_judicial_governance() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para consultar o STF.' USING errcode='42501';END IF;
 RETURN jsonb_build_object('server_now',clock_timestamp(),'electoral_access',public.is_electoral_judge(auth.uid()),
 'seats',(SELECT coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object('term',to_jsonb(t),'holder',CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('id',p.id,'full_name',p.full_name,'avatar_url',p.avatar_url,'username',p.username) END) ORDER BY o.sort_order),'[]') FROM public.executive_office_definitions o LEFT JOIN public.institutional_terms t ON t.office_key=o.office_key AND t.status='active' LEFT JOIN public.profiles p ON p.id=t.profile_id WHERE o.office_key LIKE 'supreme_court_%' OR o.office_key='public_prosecutor'),
 'nominations',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'office_key',i.office_key,'candidate_id',i.candidate_id,'candidate_name',p.full_name,'candidate_avatar',p.avatar_url,'invited_by',i.invited_by,'status',i.status,'stage',i.institutional_stage,'hearing_notes',i.hearing_notes,'voting_id',i.senate_voting_id,'created_at',i.created_at) ORDER BY i.created_at DESC),'[]') FROM public.minister_invitations i JOIN public.profiles p ON p.id=i.candidate_id WHERE (i.office_key LIKE 'supreme_court_%' OR i.office_key='public_prosecutor') AND (i.status='accepted' OR i.candidate_id=auth.uid() OR public.get_authority_role(auth.uid()) IN('Admin','Presidente')) AND i.created_at>clock_timestamp()-interval '1 year'),
 'electoral_assignments',(SELECT coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('name',p.full_name) ORDER BY a.starts_at DESC),'[]') FROM public.judicial_electoral_assignments a JOIN public.profiles p ON p.id=a.profile_id WHERE a.ends_at>clock_timestamp()-interval '1 year'),
 'impeachments',(SELECT coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('events',(SELECT coalesce(jsonb_agg(to_jsonb(ev) ORDER BY ev.created_at),'[]') FROM public.public_integrity_case_events ev WHERE ev.case_id=c.id)) ORDER BY c.created_at DESC),'[]') FROM public.public_integrity_cases c WHERE c.institutional_term_id IS NOT NULL),
 'votes',(SELECT coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('votes',(SELECT coalesce(jsonb_agg(jsonb_build_object('member_id',vv.member_id,'user_id',m.user_id,'name',p.full_name,'vote',vv.vote)),'[]') FROM public.parliament_voting_votes vv JOIN public.parliament_members m ON m.id=vv.member_id JOIN public.profiles p ON p.id=m.user_id WHERE vv.voting_id=v.id)) ORDER BY v.created_at DESC),'[]') FROM public.parliament_votings v WHERE v.type IN('institutional_appointment','judicial_impeachment')),
 'senate_member_id',public.get_active_parliament_member_id(auth.uid(),'fedcba09-8765-4321-0987-654321fedcba'),
 'senate_president',private.is_house_president(auth.uid(),'fedcba09-8765-4321-0987-654321fedcba'));
END $$;
REVOKE ALL ON FUNCTION public.get_judicial_governance() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_judicial_governance() TO authenticated;

CREATE OR REPLACE FUNCTION private.finish_institutional_vote(p_voting_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.parliament_votings%rowtype;i public.minister_invitations%rowtype;c public.public_integrity_cases%rowtype;n int;y int;total int;required int;approved boolean;BEGIN
 SELECT * INTO v FROM public.parliament_votings WHERE id=p_voting_id FOR UPDATE;
 IF v.type NOT IN('institutional_appointment','judicial_impeachment') THEN RAISE EXCEPTION 'Votação institucional inválida.';END IF;
 IF v.status='closed' THEN RETURN v.result;END IF;
 total:=cardinality(v.eligible_member_ids);
 SELECT count(*),count(*) FILTER(WHERE vote='Aprovar') INTO n,y FROM public.parliament_voting_votes WHERE voting_id=v.id AND member_id=ANY(v.eligible_member_ids);
 IF clock_timestamp()<v.end_date AND n<total THEN RETURN jsonb_build_object('finalized',false);END IF;
 required:=CASE WHEN v.type='institutional_appointment' THEN floor(total/2.0)::int+1 ELSE ceil(total*2.0/3)::int END;
 approved:=total>0 AND y>=greatest(1,required);
 UPDATE public.parliament_votings SET status='closed',result=jsonb_build_object('approved',approved,'yes',y,'present',n,'seats',total,'required',required,'finalized',true) WHERE id=v.id RETURNING * INTO v;
 IF v.type='institutional_appointment' THEN
  SELECT * INTO i FROM public.minister_invitations WHERE id=v.related_id AND senate_voting_id=v.id FOR UPDATE;
  IF i.id IS NULL OR i.status<>'accepted' OR i.institutional_stage<>'voting' THEN RAISE EXCEPTION 'A indicação não corresponde à votação.';END IF;
  IF approved THEN PERFORM private.activate_institutional_appointment(i.id);
  ELSE
   UPDATE public.minister_invitations SET institutional_stage='rejected' WHERE id=i.id;
   INSERT INTO public.news_articles(title,content,author_id,source_event_type,source_event_id) VALUES('Senado rejeita indicação de '||(SELECT full_name FROM public.profiles WHERE id=i.candidate_id)||' ao STF','Indicação presidencial de '||(SELECT full_name FROM public.profiles WHERE id=i.invited_by)||' submetida à sabatina e votação. Resultado: '||y||' votos favoráveis de '||total||' senadores; '||required||' exigidos para aprovação. A indicação foi rejeitada em '||clock_timestamp()::text||'. Não houve posse e a vaga permanece disponível.',i.invited_by,'judicial_appointment_rejected',i.id::text);
   PERFORM private.institutional_notice(i.candidate_id,'institutional_appointment_rejected','O Senado rejeitou sua indicação ao STF. Seu cargo anterior foi preservado.',i.id,jsonb_build_object('result',v.result));
   PERFORM private.institutional_notice(i.invited_by,'institutional_appointment_rejected','O Senado rejeitou a indicação ao STF. A vaga continua disponível.',i.id,jsonb_build_object('result',v.result,'office_key',i.office_key));
  END IF;
 ELSE
  SELECT * INTO c FROM public.public_integrity_cases WHERE id=v.related_id AND senate_voting_id=v.id FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Processo de responsabilidade não encontrado.';END IF;
  IF approved THEN PERFORM private.end_institutional_term(c.institutional_term_id,'removed',NULL);END IF;
  UPDATE public.public_integrity_cases SET status=CASE WHEN approved THEN 'convicted' ELSE 'acquitted' END,updated_at=clock_timestamp() WHERE id=c.id;
  INSERT INTO public.public_integrity_case_events(case_id,previous_status,new_status,summary) VALUES(c.id,c.status,CASE WHEN approved THEN 'convicted' ELSE 'acquitted' END,'Decisão do Senado: '||CASE WHEN approved THEN 'perda do mandato' ELSE 'pedido rejeitado; mandato preservado' END||'. Votos favoráveis: '||y||'; exigidos: '||required||'.');
 END IF;
 RETURN v.result;
END $$;

CREATE OR REPLACE FUNCTION public.manage_judicial_hearing(p_invitation_id uuid,p_action text,p_text text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.minister_invitations%rowtype;members uuid[];v public.parliament_votings%rowtype;senate uuid;senator boolean;BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para participar da sabatina.' USING errcode='42501';END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
 SELECT * INTO i FROM public.minister_invitations WHERE id=p_invitation_id FOR UPDATE;
 IF i.id IS NULL OR i.office_key NOT LIKE 'supreme_court_%' OR i.status<>'accepted' THEN RAISE EXCEPTION 'A sabatina exige uma indicação aceita.';END IF;
 SELECT id INTO senate FROM public.parliament_houses WHERE id='fedcba09-8765-4321-0987-654321fedcba';
 senator:=public.get_active_parliament_member_id(auth.uid(),senate) IS NOT NULL;
 IF p_action IN('question','answer') THEN
  IF i.institutional_stage<>'hearing' THEN RAISE EXCEPTION 'A sabatina já foi encerrada.';END IF;
  IF NOT((p_action='question' AND (senator OR public.has_full_admin_access())) OR (p_action='answer' AND i.candidate_id=auth.uid())) THEN RAISE EXCEPTION 'Você não possui competência para esta manifestação.' USING errcode='42501';END IF;
  IF length(btrim(p_text))<10 OR length(p_text)>10000 THEN RAISE EXCEPTION 'Escreva entre 10 e 10.000 caracteres.';END IF;
  UPDATE public.minister_invitations SET hearing_notes=hearing_notes||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'kind',p_action,'actor_id',auth.uid(),'text',btrim(p_text),'at',clock_timestamp())) WHERE id=i.id;
 ELSIF p_action='open_vote' THEN
  IF NOT(private.is_house_president(auth.uid(),senate) OR public.has_full_admin_access()) THEN RAISE EXCEPTION 'A Presidência do Senado encerra a sabatina e abre a votação.' USING errcode='42501';END IF;
  IF i.senate_voting_id IS NOT NULL THEN RETURN jsonb_build_object('success',true,'voting_id',i.senate_voting_id);END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(i.hearing_notes)n WHERE n->>'kind'='question') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(i.hearing_notes)n WHERE n->>'kind'='answer') THEN RAISE EXCEPTION 'Registre ao menos uma pergunta e a manifestação do indicado antes da votação.';END IF;
  SELECT array_agg(m.id ORDER BY m.id) INTO members FROM public.parliament_members m WHERE m.house_id=senate AND m.id=public.get_active_parliament_member_id(m.user_id,senate);
  IF coalesce(cardinality(members),0)=0 THEN RAISE EXCEPTION 'O Senado não possui membros em exercício para deliberar.';END IF;
  INSERT INTO public.parliament_votings(house_id,title,description,type,related_id,status,end_date,eligible_member_ids,rule_snapshot)
  VALUES(senate,'Indicação ao STF: '||(SELECT full_name FROM public.profiles WHERE id=i.candidate_id),'Aprovação exige maioria absoluta dos senadores em exercício registrados na abertura.','institutional_appointment',i.id,'active',clock_timestamp()+interval '24 hours',members,jsonb_build_object('approval_basis','seats','numerator',1,'denominator',2,'house_members',cardinality(members),'absolute_majority',true)) RETURNING * INTO v;
  UPDATE public.minister_invitations SET institutional_stage='voting',hearing_closed_at=clock_timestamp(),senate_voting_id=v.id WHERE id=i.id;
 ELSE RAISE EXCEPTION 'Ação de sabatina inválida.';END IF;
 PERFORM public.justice_write_audit('judicial_hearing.'||p_action,'minister_invitation',i.id,NULL,jsonb_build_object('voting_id',v.id),'Sabatina do STF.');
 RETURN jsonb_build_object('success',true,'voting_id',v.id);
END $$;
REVOKE ALL ON FUNCTION public.manage_judicial_hearing(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manage_judicial_hearing(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.manage_judicial_impeachment(p_action text,p_term_id uuid DEFAULT NULL,p_case_id uuid DEFAULT NULL,p_text text DEFAULT '',p_evidence jsonb DEFAULT '[]') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.institutional_terms%rowtype;c public.public_integrity_cases%rowtype;senate uuid:='fedcba09-8765-4321-0987-654321fedcba';members uuid[];v uuid;BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para continuar.' USING errcode='42501';END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
 IF length(btrim(p_text))<20 OR length(p_text)>20000 THEN RAISE EXCEPTION 'Apresente fundamentação entre 20 e 20.000 caracteres.';END IF;
 IF p_action='open' THEN
  IF public.get_active_parliament_member_id(auth.uid(),senate) IS NULL AND NOT public.has_full_admin_access() THEN RAISE EXCEPTION 'A instauração exige mandato no Senado.' USING errcode='42501';END IF;
  SELECT * INTO t FROM public.institutional_terms WHERE id=p_term_id AND office_key LIKE 'supreme_court_%' AND status='active' FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Mandato judicial ativo não encontrado.';END IF;
  IF EXISTS(SELECT 1 FROM public.public_integrity_cases WHERE institutional_term_id=t.id AND status='judicial_process') THEN RAISE EXCEPTION 'Já existe processo de responsabilidade em andamento para este mandato.';END IF;
  IF jsonb_typeof(p_evidence)<>'array' OR jsonb_array_length(p_evidence)=0 THEN RAISE EXCEPTION 'Apresente as provas e referências que fundamentam o pedido.';END IF;
  INSERT INTO public.public_integrity_cases(title,summary,status,accused_profiles,evidence,source_type,source_id,created_by,institutional_term_id,defense_deadline_at)
  VALUES('Responsabilidade de magistrado do STF',btrim(p_text),'judicial_process',ARRAY[t.profile_id],p_evidence,'judicial_impeachment',t.id::text,auth.uid(),t.id,clock_timestamp()+interval '24 hours') RETURNING * INTO c;
  PERFORM private.institutional_notice(t.profile_id,'judicial_defense_required','Foi instaurado processo de responsabilidade sobre seu mandato. Apresente sua defesa antes da deliberação do Senado.',c.id,jsonb_build_object('case_id',c.id,'defense_deadline',c.defense_deadline_at));
 ELSE
  SELECT * INTO c FROM public.public_integrity_cases WHERE id=p_case_id AND institutional_term_id IS NOT NULL FOR UPDATE;
  IF c.id IS NULL OR c.status<>'judicial_process' THEN RAISE EXCEPTION 'Processo de responsabilidade em andamento não encontrado.';END IF;
  IF p_action='defense' THEN
   IF NOT(auth.uid()=ANY(c.accused_profiles)) THEN RAISE EXCEPTION 'A defesa deve ser apresentada pelo magistrado acusado.' USING errcode='42501';END IF;
   IF clock_timestamp()>c.defense_deadline_at OR c.senate_voting_id IS NOT NULL THEN RAISE EXCEPTION 'O prazo para defesa foi encerrado.';END IF;
  ELSIF p_action='open_vote' THEN
   IF NOT(private.is_house_president(auth.uid(),senate) OR public.has_full_admin_access()) THEN RAISE EXCEPTION 'A abertura da votação exige a Presidência do Senado.' USING errcode='42501';END IF;
   IF c.senate_voting_id IS NOT NULL THEN RETURN jsonb_build_object('success',true,'voting_id',c.senate_voting_id);END IF;
   IF clock_timestamp()<c.defense_deadline_at THEN RAISE EXCEPTION 'Aguarde o término do prazo de defesa.';END IF;
   SELECT array_agg(m.id ORDER BY m.id) INTO members FROM public.parliament_members m WHERE house_id=senate AND m.id=public.get_active_parliament_member_id(m.user_id,senate);
   IF coalesce(cardinality(members),0)=0 THEN RAISE EXCEPTION 'O Senado não possui membros em exercício.';END IF;
   INSERT INTO public.parliament_votings(house_id,title,description,type,related_id,status,end_date,eligible_member_ids,rule_snapshot)
   VALUES(senate,'Responsabilidade judicial: '||c.case_number,btrim(p_text),'judicial_impeachment',c.id,'active',clock_timestamp()+interval '24 hours',members,jsonb_build_object('approval_basis','seats','numerator',2,'denominator',3,'house_members',cardinality(members))) RETURNING id INTO v;
   UPDATE public.public_integrity_cases SET senate_voting_id=v,updated_at=clock_timestamp() WHERE id=c.id;
  ELSE RAISE EXCEPTION 'Ação inválida.';END IF;
 END IF;
 INSERT INTO public.public_integrity_case_events(case_id,previous_status,new_status,summary,actor_id) VALUES(c.id,c.status,CASE WHEN p_action='defense' THEN 'defense' ELSE c.status END,btrim(p_text),auth.uid());
 PERFORM public.justice_write_audit('judicial_impeachment.'||p_action,'public_integrity_case',c.id,NULL,jsonb_build_object('term_id',c.institutional_term_id,'voting_id',v),'Procedimento de responsabilidade judicial.');
 RETURN jsonb_build_object('success',true,'case_id',c.id,'voting_id',v);
END $$;
REVOKE ALL ON FUNCTION public.manage_judicial_impeachment(text,uuid,uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manage_judicial_impeachment(text,uuid,uuid,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION private.end_institutional_term(p_term_id uuid,p_reason text,p_actor uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.institutional_terms%rowtype;head uuid;cfg jsonb;BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('govrp:executive:appointments'));
 SELECT * INTO t FROM public.institutional_terms WHERE id=p_term_id FOR UPDATE;
 IF t.id IS NULL OR t.status<>'active' THEN RETURN;END IF;
 IF p_reason NOT IN('resigned','expired','removed','dismissed') THEN RAISE EXCEPTION 'Motivo de vacância inválido.';END IF;
 UPDATE public.institutional_terms SET status=p_reason,ended_at=clock_timestamp(),end_reason=p_reason WHERE id=t.id;
 UPDATE public.judicial_electoral_assignments SET ended_at=clock_timestamp() WHERE term_id=t.id AND ended_at IS NULL;
 PERFORM set_config('govrp.role_change_reason','Encerramento do exercício institucional: '||p_reason,true);
 UPDATE public.profiles SET role='Cidadão',titles=array_remove(array_remove(array_remove(array_remove(coalesce(titles,'{}'),'Juiz'),'Presidente do STF'),'Promotor'),'Presidente do Portal Eleitoral'),manual_role_override=false,role_assigned_at=clock_timestamp(),role_assigned_by=p_actor,updated_at=clock_timestamp() WHERE id=t.profile_id AND (role=(SELECT role_label FROM public.executive_office_definitions WHERE office_key=t.office_key) OR (t.office_key LIKE 'supreme_court_%' AND role='Presidente do STF'));
 UPDATE public.profiles SET titles=array_remove(array_remove(array_remove(array_remove(coalesce(titles,'{}'),'Juiz'),'Presidente do STF'),'Promotor'),'Presidente do Portal Eleitoral') WHERE id=t.profile_id AND role NOT IN('Juiz','Presidente do STF','Promotor');
 SELECT value INTO cfg FROM public.system_settings WHERE key='executive_governance' FOR UPDATE;
 UPDATE public.system_settings SET value=jsonb_set(coalesce(cfg,'{}'),'{specialAppointments}',coalesce(cfg->'specialAppointments','{}')-t.office_key),updated_at=clock_timestamp() WHERE key='executive_governance';
 SELECT head_id INTO head FROM public.government_terms WHERE ended_at IS NULL AND term_ends_at>clock_timestamp() ORDER BY term_starts_at DESC LIMIT 1;
 PERFORM private.institutional_notice(head,'institutional_vacancy','Uma vaga de '||CASE WHEN t.office_key LIKE 'supreme_court_%' THEN 'Juiz do STF' ELSE 'Promotor' END||' ficou disponível. Indique um cidadão para iniciar a nomeação.',t.id,jsonb_build_object('office_key',t.office_key,'former_occupant',t.profile_id,'former_name',(SELECT full_name FROM public.profiles WHERE id=t.profile_id),'reason',p_reason,'vacant_at',clock_timestamp(),'link','/dashboard/president'));
 PERFORM private.institutional_notice(t.profile_id,'institutional_term_ended','Seu exercício institucional foi encerrado. As permissões foram atualizadas e o histórico foi preservado.',t.id,jsonb_build_object('reason',p_reason));
 PERFORM public.justice_write_audit('institutional_term.'||p_reason,'institutional_term',t.id,to_jsonb(t),jsonb_build_object('reason',p_reason,'actor',p_actor),'Vacância institucional registrada.');
END $$;

CREATE OR REPLACE FUNCTION public.resign_judicial_term(p_term_id uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.institutional_terms WHERE id=p_term_id AND profile_id=auth.uid() AND status='active') THEN RAISE EXCEPTION 'Este mandato não pertence à sua conta.' USING errcode='42501';END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
 IF length(btrim(coalesce(p_reason,'')))<10 THEN RAISE EXCEPTION 'Fundamente sua renúncia em ao menos 10 caracteres.';END IF;
 PERFORM private.end_institutional_term(p_term_id,'resigned',auth.uid());
 PERFORM economy_private.audit('judicial_resignation','institutional_terms',p_term_id::text,NULL,NULL,p_reason,auth.uid());
 RETURN jsonb_build_object('success',true);
END $$;
REVOKE ALL ON FUNCTION public.resign_judicial_term(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resign_judicial_term(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION private.activate_institutional_appointment(p_invitation_id uuid) RETURNS public.institutional_terms
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.minister_invitations%rowtype;t public.institutional_terms%rowtype;p public.profiles%rowtype;v public.parliament_votings%rowtype;office public.executive_office_definitions%rowtype;entry jsonb;cfg jsonb;BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('govrp:executive:appointments'));
 SELECT * INTO i FROM public.minister_invitations WHERE id=p_invitation_id FOR UPDATE;
 SELECT * INTO t FROM public.institutional_terms WHERE invitation_id=i.id;
 IF t.id IS NOT NULL THEN RETURN t;END IF;
 SELECT * INTO office FROM public.executive_office_definitions WHERE office_key=i.office_key;
 IF i.status<>'accepted' OR i.office_key NOT LIKE 'supreme_court_%' AND i.office_key<>'public_prosecutor' THEN RAISE EXCEPTION 'A indicação precisa de aceite válido.';END IF;
 IF i.office_key LIKE 'supreme_court_%' THEN
  SELECT * INTO v FROM public.parliament_votings WHERE id=i.senate_voting_id;
  IF v.id IS NULL OR v.type<>'institutional_appointment' OR v.status<>'closed' OR NOT coalesce((v.result->>'approved')::boolean,false) THEN RAISE EXCEPTION 'A posse exige aprovação válida do Senado.';END IF;
 END IF;
 SELECT * INTO p FROM public.profiles WHERE id=i.candidate_id AND deleted_at IS NULL FOR UPDATE;
 IF p.id IS NULL OR EXISTS(SELECT 1 FROM public.institutional_terms WHERE status='active' AND (profile_id=p.id OR office_key=i.office_key)) THEN RAISE EXCEPTION 'A vaga ou a elegibilidade do indicado mudou.';END IF;
 INSERT INTO public.institutional_terms(office_key,profile_id,invitation_id,appointed_by,government_id,ends_at,ends_at_rp,previous_role)
 VALUES(i.office_key,p.id,i.id,i.invited_by,i.government_id,CASE WHEN i.office_key LIKE 'supreme_court_%' THEN clock_timestamp()+interval '2 months' END,CASE WHEN i.office_key LIKE 'supreme_court_%' THEN public.rp_now()+interval '8 years' END,p.role) RETURNING * INTO t;
 PERFORM set_config('govrp.role_change_reason','Posse institucional após o procedimento de indicação.',true);
 UPDATE public.profiles SET role=office.role_label,manual_role_override=false,role_assigned_at=t.starts_at,role_assigned_by=i.invited_by,updated_at=clock_timestamp() WHERE id=p.id;
 entry:=jsonb_build_object('user_id',p.id,'appointed_at',t.starts_at,'appointed_by',i.invited_by,'term_id',t.id,'ends_at',t.ends_at,'previous_role',p.role,'government_id',i.government_id);
 SELECT value INTO cfg FROM public.system_settings WHERE key='executive_governance' FOR UPDATE;
 INSERT INTO public.system_settings(key,value) VALUES('executive_governance',jsonb_set(coalesce(cfg,'{}'),'{specialAppointments}',coalesce(cfg->'specialAppointments','{}')||jsonb_build_object(i.office_key,entry))) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=clock_timestamp();
 UPDATE public.minister_invitations SET institutional_stage='appointed' WHERE id=i.id;
 PERFORM private.institutional_notice(p.id,'institutional_appointment_approved','Sua nomeação para '||CASE WHEN i.office_key LIKE 'supreme_court_%' THEN 'Juiz do STF' ELSE office.role_label END||' foi concluída. Você tomou posse.',i.id,jsonb_build_object('term_id',t.id,'ends_at',t.ends_at,'senate_result',v.result));
 PERFORM private.institutional_notice(i.invited_by,'institutional_appointment_approved',p.full_name||' tomou posse após a conclusão da indicação.',i.id,jsonb_build_object('term_id',t.id,'senate_result',v.result));
 INSERT INTO public.news_articles(title,content,author_id,source_event_type,source_event_id)
 VALUES('Posse: '||p.full_name||' no '||CASE WHEN i.office_key LIKE 'supreme_court_%' THEN 'STF' ELSE 'Ministério Público' END,'Indicação de '||p.full_name||' pelo Presidente '||coalesce((SELECT full_name FROM public.profiles WHERE id=i.invited_by),'da República')||'. '||CASE WHEN i.office_key LIKE 'supreme_court_%' THEN 'Sabatina encerrada em '||i.hearing_closed_at::text||'. Senado: '||coalesce(v.result->>'yes','0')||' votos favoráveis; '||coalesce(v.result->>'required','0')||' exigidos, em um colégio de '||coalesce(v.result->>'seats','0')||' senadores. ' ELSE 'Convite aceito para o Ministério Público. ' END||'Posse em '||t.starts_at::text||CASE WHEN t.ends_at IS NOT NULL THEN '. Mandato de oito anos RP, com encerramento em '||t.ends_at::text ELSE '.' END,i.invited_by,'institutional_appointment',t.id::text);
 INSERT INTO public.dou_entries(title,summary,content,type,source_id,legal_metadata) VALUES('Nomeação: '||office.role_label,p.full_name||' tomou posse.','Nomeação após procedimento institucional.','Nomeacao e Exoneracao',i.id,jsonb_build_object('term_id',t.id,'senate_result',v.result));
 PERFORM public.justice_write_audit('institutional_term.appointed','institutional_term',t.id,NULL,to_jsonb(t),'Posse institucional válida.');
 RETURN t;
END $$;

CREATE OR REPLACE FUNCTION private.maintain_minister_invitations()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 update public.minister_invitations i set status=case when expires_at<=clock_timestamp() then 'expired' else 'cancelled' end,responded_at=clock_timestamp()
 where status='pending' and (exists(select 1 from public.executive_office_definitions where office_key=i.office_key AND NOT is_assignable) or expires_at<=clock_timestamp() or (coalesce((select government_bound from public.executive_office_definitions where office_key=i.office_key),true) and not exists(select 1 from public.government_terms g where g.id=i.government_id and g.ended_at is null and g.term_ends_at>clock_timestamp() and g.head_id=i.invited_by and public.get_user_role(g.head_id)='Presidente')));
end $function$;

CREATE OR REPLACE FUNCTION private.is_executive_candidate(p_user_id uuid, p_office_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.profiles p where p.id=p_user_id and p.deleted_at is null and (p.onboarding_completed or p.onboarding_mode='legacy_migration')
  and p.role not in('Admin','Presidente','Vice-Presidente')
  and (p_office_key not like 'supreme_court_%' and p_office_key<>'public_prosecutor' or (not exists(select 1 from public.institutional_terms where profile_id=p.id and status='active') and not exists(select 1 from public.election_office_assignments where profile_id=p.id and status='active')))
  and not exists(select 1 from public.system_settings s cross join lateral jsonb_each(coalesce(s.value->'specialAppointments','{}')) a
    where s.key='executive_governance' and a.key<>p_office_key and a.value->>'user_id'=p.id::text)
  and not exists(select 1 from public.ministers m where m.user_id=p.id and m.status='active'));
$function$;

CREATE OR REPLACE FUNCTION private.apply_executive_appointment(p_office_key text, p_user_id uuid, p_note text, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cfg jsonb; office public.executive_office_definitions%rowtype; previous jsonb; target public.profiles%rowtype; entry jsonb; event_id uuid:=gen_random_uuid();
begin
 if p_office_key like 'supreme_court_%' or p_office_key='public_prosecutor' then raise exception 'Este cargo exige o procedimento institucional de indicação e aceite, e aprovação do Senado quando cabível.';end if;

 perform pg_advisory_xact_lock(hashtext('govrp:executive:appointments'));
 select * into office from public.executive_office_definitions where office_key=p_office_key AND is_assignable;
 if not found then raise exception 'Escolha um cargo executivo válido.'; end if;
 select coalesce(value,'{}') into cfg from public.system_settings where key='executive_governance' for update;
 cfg:=coalesce(cfg,'{}');previous:=cfg->'specialAppointments'->p_office_key;
 if p_user_id is not null then
   select * into target from public.profiles where id=p_user_id and (onboarding_completed or onboarding_mode='legacy_migration') and deleted_at is null for update;
   if not found or not private.is_executive_candidate(p_user_id,p_office_key) then raise exception 'Escolha um cidadão elegível para a nomeação.'; end if;
   if previous->>'user_id'=p_user_id::text then return previous; end if;
   if exists(select 1 from jsonb_each(coalesce(cfg->'specialAppointments','{}')) a where a.key<>p_office_key and a.value->>'user_id'=p_user_id::text) then raise exception 'Este cidadão já ocupa outra nomeação estratégica.'; end if;
 end if;
 if previous->>'user_id' is not null then
   update public.profiles set role=coalesce(previous->>'previous_role','Cidadão'),manual_role_override=false,role_assigned_at=clock_timestamp(),role_assigned_by=p_actor_id,updated_at=clock_timestamp() where id=(previous->>'user_id')::uuid and role=office.role_label;
 end if;
 if p_user_id is null then cfg:=jsonb_set(cfg,'{specialAppointments}',coalesce(cfg->'specialAppointments','{}')-p_office_key);
 else
   entry:=jsonb_build_object('user_id',p_user_id,'appointed_at',clock_timestamp(),'appointed_by',p_actor_id,'previous_role',target.role,'note',p_note,'government_id',(select id from public.government_terms where ended_at is null));
   cfg:=jsonb_set(cfg,'{specialAppointments}',coalesce(cfg->'specialAppointments','{}')||jsonb_build_object(p_office_key,entry));
   update public.profiles set role=office.role_label,manual_role_override=false,role_assigned_at=clock_timestamp(),role_assigned_by=p_actor_id,updated_at=clock_timestamp() where id=p_user_id;
 end if;
 insert into public.system_settings(key,value) values('executive_governance',cfg) on conflict(key) do update set value=excluded.value;
 insert into public.dou_entries(title,summary,content,type,source_id,legal_metadata)
 values(case when p_user_id is null then 'Exoneração: ' else 'Nomeação: ' end||office.role_label,
   case when p_user_id is null then 'O cargo foi desocupado.' else target.full_name||' assume o cargo.' end,
   coalesce(p_note,''),'Nomeacao e Exoneracao',event_id,jsonb_build_object('office_key',p_office_key,'actor_id',p_actor_id,'user_id',p_user_id,'previous',previous));
 perform economy_private.audit('executive_appointment_changed','system_settings',p_office_key,previous,entry,coalesce(p_note,'Nomeação executiva.'),p_actor_id);
 return coalesce(entry,'{}');
end; $function$;

CREATE OR REPLACE FUNCTION public.manage_executive_appointment(p_office_key text, p_user_id uuid DEFAULT NULL::uuid, p_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare g public.government_terms%rowtype;i public.minister_invitations%rowtype;
begin
 if auth.uid() is null or (public.get_user_role(auth.uid()) is distinct from 'Presidente' and not public.has_full_admin_access()) then raise exception 'A nomeação exige autoridade presidencial.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtext('govrp:presidential-succession'));
 perform pg_advisory_xact_lock(hashtext('govrp:executive:appointments'));
 perform private.maintain_minister_invitations();
 select * into g from public.government_terms where ended_at is null and term_ends_at>clock_timestamp() and (head_id=auth.uid() or public.has_full_admin_access()) for update;
 if g.id is null then raise exception 'Não há Governo vigente para esta nomeação.';end if;
 if not exists(select 1 from public.executive_office_definitions where office_key=p_office_key AND is_assignable) then raise exception 'Selecione um cargo executivo válido.';end if;
 if p_office_key like 'supreme_court_%' or p_office_key='public_prosecutor' then
  if p_user_id is null then raise exception 'Mandatos institucionais independentes não podem ser exonerados pela Presidência.';end if;
  if exists(select 1 from public.institutional_terms where office_key=p_office_key and status='active') then raise exception 'A vaga já está ocupada por mandato independente.';end if;
  if exists(select 1 from public.minister_invitations where office_key=p_office_key and status='accepted' and institutional_stage in('hearing','voting')) then raise exception 'Esta vaga já possui indicação em análise pelo Senado.';end if;
 end if;
 if p_user_id is null then
  update public.minister_invitations set status='cancelled',responded_at=clock_timestamp() where government_id=g.id and office_key=p_office_key and status='pending';
  return private.apply_executive_appointment(p_office_key,null,p_note,auth.uid());
 end if;
 if not private.is_executive_candidate(p_user_id,p_office_key) then raise exception 'Este cidadão não está elegível para a nomeação.';end if;
 select * into i from public.minister_invitations where office_key=p_office_key and status='pending' and (government_id=g.id or p_office_key like 'supreme_court_%' or p_office_key='public_prosecutor') for update;
 if i.candidate_id=p_user_id then return jsonb_build_object('success',true,'invitation',to_jsonb(i),'message','Convite aguardando resposta.');end if;
 update public.minister_invitations set status='cancelled',responded_at=clock_timestamp() where id=i.id;
 insert into public.minister_invitations(government_id,office_key,candidate_id,invited_by) values(g.id,p_office_key,p_user_id,g.head_id) returning * into i;
 return jsonb_build_object('success',true,'invitation',to_jsonb(i),'message','Convite enviado. O cargo será atribuído somente após o aceite.');
end $function$;

CREATE OR REPLACE FUNCTION public.respond_minister_invitation(p_invitation_id uuid, p_accept boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare i public.minister_invitations%rowtype;
begin
 if auth.uid() is null or p_accept is null then raise exception 'Entre para responder ao convite.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtext('govrp:presidential-succession'));
 perform pg_advisory_xact_lock(hashtext('govrp:executive:appointments'));
 select * into i from public.minister_invitations where id=p_invitation_id and candidate_id=auth.uid() for update;
 if i.id is null then raise exception 'Este convite não pertence à sua conta.' using errcode='42501';end if;
 if i.office_key is null then return private.respond_ministry_invitation(i.id,p_accept);end if;
 if i.status<>'pending' then return jsonb_build_object('success',i.status in ('accepted','declined'),'status',i.status,'message','Este convite já foi encerrado.');end if;
 perform private.maintain_minister_invitations();select * into i from public.minister_invitations where id=i.id;
 if i.status<>'pending' then return jsonb_build_object('success',false,'status',i.status,'message','O convite expirou ou o Governo foi encerrado.');end if;
 if i.office_key like 'supreme_court_%' or i.office_key='public_prosecutor' then
  if p_accept and not private.is_executive_candidate(auth.uid(),i.office_key) then raise exception 'Sua elegibilidade mudou desde o envio do convite.';end if;
  update public.minister_invitations set status=case when p_accept then 'accepted' else 'declined' end,responded_at=clock_timestamp(),institutional_stage=case when not p_accept then 'declined' when i.office_key='public_prosecutor' then 'accepted' else 'hearing' end where id=i.id;
  if p_accept and i.office_key='public_prosecutor' then perform private.activate_institutional_appointment(i.id);end if;
  if p_accept and i.office_key like 'supreme_court_%' then
   insert into public.notifications(user_id,type,content,link,metadata) select distinct m.user_id,'judicial_hearing_required','Nova indicação ao STF aguarda sabatina no Senado.','/services/parliament/panel',jsonb_build_object('invitation_id',i.id) from public.parliament_members m where m.house_id='fedcba09-8765-4321-0987-654321fedcba' and m.id=public.get_active_parliament_member_id(m.user_id,m.house_id);
  end if;
  return jsonb_build_object('success',true,'status',case when p_accept then 'accepted' else 'declined' end,'message',case when not p_accept then 'Convite recusado.' when i.office_key like 'supreme_court_%' then 'Indicação aceita. Você participará da sabatina antes da votação do Senado.' else 'Convite aceito. Sua posse foi registrada.' end);
 end if;
 if p_accept then
  perform private.apply_executive_appointment(i.office_key,auth.uid(),'Nomeação efetivada após aceite do convite '||i.id,i.invited_by);
 end if;
 update public.minister_invitations set status=case when p_accept then 'accepted' else 'declined' end,responded_at=clock_timestamp() where id=i.id;
 return jsonb_build_object('success',true,'status',case when p_accept then 'accepted' else 'declined' end,'message',case when p_accept then 'Convite aceito. Suas funções foram atualizadas.' else 'Convite recusado.' end);
end $function$;

CREATE OR REPLACE FUNCTION public.cast_parliament_vote(p_voting_id uuid, p_member_id uuid, p_vote text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid:=(select auth.uid());
  v_voting public.parliament_votings%rowtype;
  v_member public.parliament_members%rowtype;
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  if p_vote not in ('Aprovar','Rejeitar','Abster') then raise exception 'INVALID_VOTE'; end if;

  if exists(select 1 from public.parliament_votings where id=p_voting_id and type in('institutional_appointment','judicial_impeachment')) then perform pg_advisory_xact_lock(hashtext('govrp:executive:appointments'));end if;
  select * into v_voting from public.parliament_votings where id=p_voting_id for update;
  if not found then raise exception 'VOTING_NOT_FOUND'; end if;
  if v_voting.status<>'active' or clock_timestamp()>v_voting.end_date then
    raise exception 'Esta votação já foi encerrada.';
  end if;

  select * into v_member from public.parliament_members
  where id=p_member_id and user_id=v_actor and house_id=v_voting.house_id
    and id=public.get_active_parliament_member_id(v_actor,v_voting.house_id);
  if not found then raise exception 'ACTIVE_HOUSE_MEMBER_REQUIRED' using errcode='42501'; end if;

  if exists(select 1 from public.bills b where b.id=v_voting.related_id and b.type='IMPEACHMENT' and not (b.institutional_data->'eligible_member_ids' @> jsonb_build_array(v_member.id))) then raise exception 'Seu mandato não integrava o colégio de votação registrado na abertura.' using errcode='42501'; end if;

  if v_voting.type in('institutional_appointment','judicial_impeachment') and not(v_member.id=any(v_voting.eligible_member_ids)) then raise exception 'Seu mandato não integrava o colégio de votação registrado na abertura.' using errcode='42501';end if;
  if v_voting.type='bill' then
    if v_voting.tie_break_pending then
      if v_member.id is distinct from v_voting.chair_member_id or not private.is_house_president(v_actor,v_voting.house_id) or p_vote='Abster' then raise exception 'Esta votação aguarda o voto de desempate da Presidência da Casa.' using errcode='42501'; end if;
    elsif not(v_member.id=any(v_voting.eligible_member_ids)) then
      raise exception 'A Presidência da Casa vota apenas no desempate nesta matéria, ou o mandato não integrava o colégio de votação.' using errcode='42501';
    end if;
  end if;
  insert into public.parliament_voting_votes(voting_id,member_id,vote)
  values(p_voting_id,v_member.id,p_vote);

  if v_voting.type='bill' then perform private.finalize_bill_voting(v_voting.id); elsif v_voting.type in('institutional_appointment','judicial_impeachment') then perform private.finish_institutional_vote(v_voting.id);end if;
  return json_build_object('success',true,'message','Seu voto foi computado com sucesso!');
exception
  when unique_violation then
    raise exception 'PARLIAMENT_VOTE_ALREADY_CAST';
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_presidential_formation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f public.presidential_formation%rowtype; offices jsonb; ministries jsonb; cfg jsonb; remaining integer;
begin
 if auth.uid() is null or coalesce(public.get_user_role(auth.uid()),'')<>'Presidente' then return null; end if;
 perform private.maintain_minister_invitations();
 insert into public.presidential_formation(user_id,government_id) select auth.uid(),id from public.government_terms where ended_at is null and head_id=auth.uid() on conflict do nothing;
 select * into f from public.presidential_formation where user_id=auth.uid() and ended_at is null for update;
 select value into cfg from public.system_settings where key='executive_governance';
 select coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object('appointment',cfg->'specialAppointments'->o.office_key,'invitation',(select to_jsonb(i) from public.minister_invitations i where (i.government_id=f.government_id or not o.government_bound) and i.office_key=o.office_key order by created_at desc limit 1)) order by sort_order),'[]') into offices from public.executive_office_definitions o where required_for_formation;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'holder_id',a.user_id,'invitation',(select to_jsonb(i) from public.minister_invitations i where i.government_id=f.government_id and i.ministry_id=m.id order by created_at desc limit 1)) order by m.name),'[]') into ministries
 from public.government_ministries m left join lateral (select user_id from public.ministers where ministry_id=m.id and status='active' order by appointed_at desc limit 1) a on true where m.is_active;
 select count(*) into remaining from jsonb_array_elements(offices) o where o->'appointment'->>'user_id' is null;
 remaining:=remaining+(select count(*) from jsonb_array_elements(ministries) m where m->>'holder_id' is null);
 if f.status='pending' then update public.presidential_formation set status='in_progress' where id=f.id returning * into f; end if;
 return to_jsonb(f)||jsonb_build_object('offices',offices,'ministries',ministries,'remaining',remaining,'awaiting',(select count(*) from public.minister_invitations where (government_id=f.government_id or office_key like 'supreme_court_%' or office_key='public_prosecutor') and ((status='pending' and expires_at>clock_timestamp()) or (status='accepted' and institutional_stage in('hearing','voting')))),'revision',(select max(coalesce(responded_at,created_at)) from public.minister_invitations where government_id=f.government_id),'government',(select to_jsonb(g) from public.government_terms g where g.ended_at is null and g.head_id=auth.uid()));
end; $function$;

CREATE OR REPLACE FUNCTION private.process_electoral_calendar()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare election record; epoch timestamptz;
begin
 perform private.maintain_institutional_calendar();
 select (value->>'started_at')::timestamptz into epoch from public.system_settings where key='electoral_notification_epoch';
 for election in select e.id from public.elections e where lower(coalesce(e.status,'')) not in ('cancelled','canceled','cancelada') and e.voting_end_date>=epoch and e.status is distinct from case when now()<e.candidacy_start_date then 'Scheduled' when now()<e.candidacy_end_date then 'Candidacy' when now()<e.voting_start_date then 'Scheduled' when now()<e.voting_end_date then 'Voting' else 'Finished' end for update skip locked loop
  update public.elections set status=status where id=election.id;
 end loop;
 for election in select e.id from public.elections e where lower(coalesce(e.status,'')) not in ('cancelled','canceled','cancelada') and e.voting_end_date>=epoch and e.voting_end_date<clock_timestamp() and not exists(select 1 from public.election_settlements s where s.election_id=e.id) order by e.voting_end_date for update skip locked loop
  begin perform private.settle_election_offices(election.id); perform private.refresh_office_assignment_snapshot();
  exception when others then raise warning 'Falha na apuração da eleição %: % (%)',election.id,sqlerrm,sqlstate; end;
 end loop;
 for election in select g.id from public.government_terms g where g.ended_at is null and g.is_interim and g.term_ends_at>clock_timestamp()+interval '2 minutes'
 and (g.extraordinary_election_id is null and g.call_deadline<=clock_timestamp() or exists(select 1 from public.election_settlements s where s.election_id=g.extraordinary_election_id and s.status in ('no_votes','tied'))) for update skip locked loop
  begin perform private.call_extraordinary_election(election.id);
  exception when others then raise warning 'Convocação extraordinária pendente: % (%)',sqlerrm,sqlstate;end;
 end loop;
end $function$;

-- Register current judges without modifying their existing cases or history.
DO $backfill$
DECLARE p record;n int:=0;seat_key text;cfg jsonb;BEGIN
 IF (SELECT count(*) FROM public.profiles WHERE role IN('Juiz','Presidente do STF') AND deleted_at IS NULL)>5 THEN RAISE EXCEPTION 'Há mais de cinco juízes ativos; concilie os mandatos antes de aplicar a alteração.';END IF;
 SELECT value INTO cfg FROM public.system_settings WHERE key='executive_governance' FOR UPDATE;
 FOR p IN SELECT * FROM public.profiles WHERE role IN('Juiz','Presidente do STF','Promotor') AND deleted_at IS NULL ORDER BY role,role_assigned_at NULLS LAST,id LOOP
  IF p.role IN('Juiz','Presidente do STF') THEN n:=n+1;seat_key:='supreme_court_'||n;ELSE seat_key:='public_prosecutor';END IF;
  INSERT INTO public.institutional_terms(office_key,profile_id,starts_at,ends_at,starts_at_rp,ends_at_rp)
  VALUES(seat_key,p.id,clock_timestamp(),CASE WHEN p.role IN('Juiz','Presidente do STF') THEN clock_timestamp()+interval '2 months' END,public.rp_now(),CASE WHEN p.role IN('Juiz','Presidente do STF') THEN public.rp_now()+interval '8 years' END) ON CONFLICT DO NOTHING;
  cfg:=jsonb_set(coalesce(cfg,'{}'),'{specialAppointments}',coalesce(cfg->'specialAppointments','{}')||jsonb_build_object(seat_key,jsonb_build_object('user_id',p.id,'appointed_at',clock_timestamp(),'migrated_existing_office',true)));
 END LOOP;
 UPDATE public.system_settings SET value=cfg,updated_at=clock_timestamp() WHERE key='executive_governance' AND cfg IS NOT NULL;
END $backfill$;

-- Explicit owner instruction: five seats and fixed terms; other articles remain intact.
UPDATE public.country_constitutions SET title='CONSTITUIÇÃO DO GOV.RP',updated_at=clock_timestamp() WHERE country_code='BR' AND status='active';
UPDATE public.constitution_articles a SET body=CASE
 WHEN a.article_number='Art. 30.' THEN 'O Supremo Tribunal Federal é a instância judicial única do GOV.RP, composto por cinco Ministros, nomeados pelo Presidente da República após aceite do indicado, sabatina pública e aprovação pela maioria absoluta do Senado Federal. Cada Ministro exercerá mandato individual de oito anos RP, correspondente a dois meses reais, contado da posse, vedada a exoneração unilateral pelo Poder Executivo.'
 WHEN a.article_number='Art. 32.' THEN replace(a.body,'dois terços do Congresso Nacional','dois terços do Senado Federal')
 WHEN a.article_number='Art. 33.' THEN 'A magistratura do GOV.RP é exercida pelos Ministros do Supremo Tribunal Federal durante o mandato previsto no art. 30, asseguradas a independência funcional, a imparcialidade, o devido processo legal, o contraditório e a ampla defesa. A vaga será aberta por renúncia, término do mandato ou perda do cargo após processo de responsabilidade com prazo de defesa e aprovação de dois terços do Senado Federal. A vacância não extingue processos, decisões ou o histórico judicial.' END,updated_at=clock_timestamp()
FROM public.constitution_sections s JOIN public.country_constitutions c ON c.id=s.constitution_id WHERE a.section_id=s.id AND c.country_code='BR' AND c.status='active' AND a.article_number IN('Art. 30.','Art. 32.','Art. 33.');
INSERT INTO public.constitution_amendments(constitution_id,amendment_number,title,summary,published_at) SELECT id,'Adequação institucional 2026-11','Composição e mandatos do STF','Artigos 30, 32 e 33: cinco vagas, indicação e sabatina, mandato de oito anos RP / dois meses reais e responsabilidade no Senado com defesa.',clock_timestamp() FROM public.country_constitutions WHERE country_code='BR' AND status='active' AND NOT EXISTS(SELECT 1 FROM public.constitution_amendments a WHERE a.constitution_id=country_constitutions.id AND a.amendment_number='Adequação institucional 2026-11');

DO $publication$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
  IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='institutional_terms') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.institutional_terms;END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='judicial_electoral_assignments') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.judicial_electoral_assignments;END IF;
 END IF;
END $publication$;
REVOKE ALL ON FUNCTION private.institutional_notice(uuid,text,text,uuid,jsonb),private.end_institutional_term(uuid,text,uuid),private.activate_institutional_appointment(uuid),private.finish_institutional_vote(uuid),private.maintain_institutional_calendar() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.assert_electoral_management()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and deleted_at is null and (public.has_full_admin_access() or public.is_electoral_judge(id))) then raise exception 'Esta função exige autoridade de gestão eleitoral.' using errcode='42501'; end if;
end; $function$;

CREATE OR REPLACE FUNCTION public.get_pending_office_notification()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select to_jsonb(pending) from (
  select n.id,n.content,n.link,n.created_at,n.type,n.metadata from public.notifications n
  where n.user_id=(select auth.uid()) and n.type in('role_changed','election_candidacy_open','election_voting_open','election_result_published','institutional_result','institutional_vacancy','electoral_duty_assigned','judicial_defense_required')
   and n.metadata->>'popup_shown_at' is null
   and not (n.type='election_result_published' and exists(select 1 from public.election_result_receipts r where r.user_id=n.user_id and r.election_id::text=n.metadata->>'election_id'))
  order by n.created_at,n.id limit 1
 ) pending;
$function$;

CREATE OR REPLACE FUNCTION public.acknowledge_role_change(p_notification_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n public.notifications%rowtype; ids uuid[]:=array[p_notification_id];
begin
 if auth.uid() is null then raise exception 'Entre na sua conta para confirmar a leitura.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtext('govrp:notification:'||auth.uid()::text));
 select * into n from public.notifications where id=p_notification_id and user_id=auth.uid() and type in('role_changed','office_awarded','election_candidacy_open','election_voting_open','election_result_published','institutional_result','institutional_vacancy','electoral_duty_assigned','judicial_defense_required');
 if n.id is null then return false;end if;
 if n.type='election_result_published' then
  select array_agg(distinct id) into ids from (
   select p_notification_id as id union all select value::uuid from jsonb_array_elements_text(public.get_election_result_bundle(p_notification_id)->'notification_ids')
  )x;
  insert into public.election_result_receipts(user_id,election_id)
   select auth.uid(),e.id from public.notifications no join public.elections e on e.id::text=no.metadata->>'election_id'
    where no.id=any(ids) and no.user_id=auth.uid() on conflict do nothing;
 end if;
 update public.notifications set metadata=coalesce(metadata,'{}')||jsonb_build_object('popup_shown_at',coalesce(metadata->>'popup_shown_at',clock_timestamp()::text),'popup_pending',false),is_read=true
 where id=any(ids) and user_id=auth.uid();
 return true;
end $function$;
-- Administrative role changes must use the same seat/term registry. They are
-- audited overrides; an executive nomination still requires the Senate flow.
CREATE OR REPLACE FUNCTION private.sync_institutional_role() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.institutional_terms%rowtype;seat text;cfg jsonb;BEGIN
 IF tg_op='UPDATE' AND old.role IS NOT DISTINCT FROM new.role THEN RETURN new;END IF;
 IF new.role NOT IN('Juiz','Presidente do STF','Promotor') AND (tg_op='INSERT' OR old.role NOT IN('Juiz','Presidente do STF','Promotor')) THEN RETURN new;END IF;
 PERFORM pg_advisory_xact_lock(hashtext('govrp:executive:appointments'));
 FOR t IN SELECT it.* FROM public.institutional_terms it JOIN public.executive_office_definitions d ON d.office_key=it.office_key WHERE it.profile_id=new.id AND it.status='active' AND d.role_label IS DISTINCT FROM new.role AND NOT(d.role_label='Juiz' AND new.role='Presidente do STF') FOR UPDATE OF it LOOP
  PERFORM private.end_institutional_term(t.id,'dismissed',auth.uid());
 END LOOP;
 IF new.role NOT IN('Juiz','Presidente do STF','Promotor') OR EXISTS(SELECT 1 FROM public.institutional_terms WHERE profile_id=new.id AND status='active') THEN RETURN new;END IF;
 IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'A atribuição deste cargo exige indicação institucional aprovada ou administração autorizada.' USING errcode='42501';END IF;
 IF auth.uid() IS NOT NULL THEN PERFORM public.assert_admin_real_action(auth.uid());END IF;
 SELECT d.office_key INTO seat FROM public.executive_office_definitions d WHERE d.role_label=CASE WHEN new.role='Presidente do STF' THEN 'Juiz' ELSE new.role END AND NOT EXISTS(SELECT 1 FROM public.institutional_terms it WHERE it.office_key=d.office_key AND it.status='active') ORDER BY d.sort_order LIMIT 1;
 IF seat IS NULL THEN RAISE EXCEPTION 'Não há vaga institucional disponível para este cargo.';END IF;
 INSERT INTO public.institutional_terms(office_key,profile_id,appointed_by,ends_at,ends_at_rp,previous_role)
 VALUES(seat,new.id,auth.uid(),CASE WHEN new.role IN('Juiz','Presidente do STF') THEN clock_timestamp()+interval '2 months' END,CASE WHEN new.role IN('Juiz','Presidente do STF') THEN public.rp_now()+interval '8 years' END,CASE WHEN tg_op='UPDATE' THEN old.role ELSE 'Cidadão' END) RETURNING * INTO t;
 SELECT value INTO cfg FROM public.system_settings WHERE key='executive_governance' FOR UPDATE;
 INSERT INTO public.system_settings(key,value) VALUES('executive_governance',jsonb_set(coalesce(cfg,'{}'),'{specialAppointments}',coalesce(cfg->'specialAppointments','{}')||jsonb_build_object(seat,jsonb_build_object('user_id',new.id,'term_id',t.id,'appointed_at',t.starts_at,'ends_at',t.ends_at,'administrative',true,'appointed_by',auth.uid())))) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=clock_timestamp();
 PERFORM public.justice_write_audit('institutional_term.administrative_override','institutional_term',t.id,NULL,to_jsonb(t),'Atribuição administrativa de cargo com limite de vagas e mandato.');
 RETURN new;
END $$;
DROP TRIGGER IF EXISTS sync_institutional_role ON public.profiles;
CREATE TRIGGER sync_institutional_role AFTER INSERT OR UPDATE OF role ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.sync_institutional_role();
REVOKE ALL ON FUNCTION private.sync_institutional_role() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.admin_update_user(p_user_id uuid, p_full_name text, p_username text, p_role text, p_titles text[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform pg_advisory_xact_lock(hashtext('govrp:presidential-succession'));
  perform pg_advisory_xact_lock(hashtext('govrp:executive:appointments'));
  select * into previous from public.profiles where id = p_user_id and deleted_at is null for update;
  if not found then raise exception 'Usuário não encontrado.' using errcode = '22023'; end if;
  if next_role='Admin' or 'Admin'=any(coalesce(p_titles,'{}')) then raise exception 'Configure a administração técnica separadamente do cargo e dos títulos do personagem.';end if;
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
end $function$;

CREATE OR REPLACE FUNCTION private.notify_minister_invitation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ministry text; candidate text; president text; head uuid;
begin
 select name into ministry from public.government_ministries where id=new.ministry_id;
 if ministry is null then select role_label into ministry from public.executive_office_definitions where office_key=new.office_key;end if;
 select full_name into candidate from public.profiles where id=new.candidate_id;
 select full_name into president from public.profiles where id=new.invited_by;
 select head_id into head from public.government_terms where id=new.government_id and ended_at is null;
 if head is null and exists(select 1 from public.executive_office_definitions where office_key=new.office_key and not government_bound) then select head_id into head from public.government_terms where ended_at is null and term_ends_at>clock_timestamp() order by term_starts_at desc limit 1;end if;
 if tg_op='INSERT' then
  insert into public.notifications(user_id,sender_id,type,content,link,metadata) values(new.candidate_id,new.invited_by,'minister_invitation',
   'O Presidente '||president||' convidou você para assumir o '||ministry||'.','/dashboard',jsonb_build_object('invitation_id',new.id,'expires_at',new.expires_at));
 elsif new.status is distinct from old.status then
  if head is not null then
   insert into public.notifications(user_id,sender_id,type,content,link,metadata) values(head,auth.uid(),'minister_invitation_response',
    case new.status when 'accepted' then candidate||' aceitou o convite para o '||ministry||'.' when 'declined' then candidate||' recusou o convite para o '||ministry||'.' when 'expired' then 'O convite para '||candidate||' assumir o '||ministry||' expirou.' else 'O convite para o '||ministry||' foi cancelado.' end,
    '/dashboard/president',jsonb_build_object('invitation_id',new.id,'status',new.status));
  end if;
  if new.status in('declined','expired','cancelled') then
   update public.presidential_formation set completed_at=null,status='in_progress' where government_id=new.government_id and ended_at is null;
  end if;
 end if;
 perform economy_private.audit('minister_invitation_'||new.status,'minister_invitation',new.id::text,case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new),'Fluxo de convite ministerial.',auth.uid());
 return new;
end $function$;

CREATE OR REPLACE FUNCTION public.official_role_capabilities(p_role text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select case public.canonical_official_role(p_role)
 when 'Presidente do STF' then array['Presidente do STF','Juiz']
 when 'Diretor-Geral de Polícia' then array['Diretor-Geral de Polícia','Policial','Delegado']
 when 'Comandante-Geral das Forças Armadas' then array['Comandante-Geral das Forças Armadas','Militar']
 when 'Comandante da Agência de Inteligência' then array['Comandante da Agência de Inteligência','Agente Secreto']
 else array[public.canonical_official_role(p_role)] end;
$function$;
CREATE OR REPLACE FUNCTION public.justice_has_role(p_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select (public.is_admin(auth.uid()) and 'admin'=any(select lower(unnest(p_roles)))) or (public.is_acting_president(auth.uid()) and 'presidente'=any(select lower(unnest(p_roles)))) or exists(select 1 from public.profiles p cross join lateral unnest(array[p.role]||coalesce(p.titles,'{}')) r
 cross join lateral unnest(public.official_role_capabilities(r)) cap
 where p.id=(select auth.uid()) and p.deleted_at is null and lower(cap)<>'admin' and lower(cap)=any(select lower(unnest(p_roles)))
 and (lower(cap)<>'juiz' or (p.role IN('Juiz','Presidente do STF') and exists(select 1 from public.institutional_terms where profile_id=p.id and status='active' and office_key like 'supreme_court_%' and ends_at>clock_timestamp())))
 and (lower(cap)<>'promotor' or (p.role='Promotor' and exists(select 1 from public.institutional_terms where profile_id=p.id and status='active' and office_key='public_prosecutor')))
 and (lower(cap) not in('delegado','diretor-geral de polícia') or public.canonical_official_role(p.role)='Diretor-Geral de Polícia')
 and (lower(cap) not in('policial','police') or public.canonical_official_role(p.role) in('Diretor-Geral de Polícia','Policial','Police')))
;
$function$;
COMMIT;
