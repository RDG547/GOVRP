BEGIN;

CREATE TABLE public.public_competitions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 5 AND 200),
 role text NOT NULL CHECK(role IN ('Defensor Público','Promotor','Agente Secreto','Professor','Policial','Militar','Agente Penitenciário')),
 vacancies integer NOT NULL CHECK(vacancies BETWEEN 1 AND 10000),
 notice_url text NOT NULL CHECK(notice_url ~ '^https://'),
 registration_starts_at timestamptz NOT NULL,
 registration_ends_at timestamptz NOT NULL,
 exam_starts_at timestamptz NOT NULL,
 exam_ends_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','finished','cancelled')),
 results_url text CHECK(results_url IS NULL OR results_url ~ '^https://'),
 results_published_at timestamptz,
 created_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 version integer NOT NULL DEFAULT 1,
 CHECK(registration_starts_at < registration_ends_at AND registration_ends_at <= exam_starts_at AND exam_starts_at < exam_ends_at),
 CHECK(isfinite(registration_starts_at) AND isfinite(registration_ends_at) AND isfinite(exam_starts_at) AND isfinite(exam_ends_at))
);
CREATE INDEX public_competitions_listing ON public.public_competitions(status,created_at DESC);
-- Exam URLs never enter the public table or its Realtime payloads.
CREATE TABLE private.public_competition_exams (
 competition_id uuid PRIMARY KEY REFERENCES public.public_competitions(id),
 forms_url text NOT NULL CHECK(forms_url ~ '^https://(forms\.gle/|docs\.google\.com/forms/)')
);
ALTER TABLE private.public_competition_exams ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.public_competition_exams FROM PUBLIC,anon,authenticated;

CREATE TABLE public.public_competition_applications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 competition_id uuid NOT NULL REFERENCES public.public_competitions(id),
 profile_id uuid NOT NULL REFERENCES public.profiles(id),
 status text NOT NULL DEFAULT 'registered' CHECK(status IN ('registered','approved','rejected')),
 registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 decided_at timestamptz,
 decided_by uuid REFERENCES public.profiles(id),
 decision_reason text,
 identity_confirmed boolean NOT NULL DEFAULT false,
 criteria_confirmed boolean NOT NULL DEFAULT false,
 UNIQUE(competition_id,profile_id)
);
CREATE INDEX competition_applicant_lookup ON public.public_competition_applications(profile_id,competition_id);
CREATE TABLE public.public_careers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 profile_id uuid NOT NULL REFERENCES public.profiles(id),
 role text NOT NULL CHECK(role IN ('Defensor Público','Promotor','Agente Secreto','Professor','Policial','Militar','Agente Penitenciário')),
 application_id uuid UNIQUE REFERENCES public.public_competition_applications(id),
 source text NOT NULL CHECK(source IN ('competition','legacy','recovery')),
 acquired_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(profile_id,role)
);
-- A career is retained when the citizen temporarily exercises another office.
INSERT INTO public.public_careers(profile_id,role,source,acquired_at)
SELECT id,role,'legacy',coalesce(role_assigned_at,created_at,clock_timestamp()) FROM public.profiles
WHERE role IN ('Defensor Público','Promotor','Agente Secreto','Professor','Policial','Militar','Agente Penitenciário') AND deleted_at IS NULL;

ALTER TABLE public.public_competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_competition_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_careers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.public_competitions,public.public_competition_applications,public.public_careers FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.public_competitions,public.public_competition_applications,public.public_careers TO authenticated;
CREATE POLICY competitions_read ON public.public_competitions FOR SELECT TO authenticated
 USING(status <> 'draft' OR public.has_full_admin_access());
CREATE POLICY applications_read ON public.public_competition_applications FOR SELECT TO authenticated
 USING(profile_id=(SELECT auth.uid()) OR public.has_full_admin_access());
CREATE POLICY careers_read ON public.public_careers FOR SELECT TO authenticated
 USING(profile_id=(SELECT auth.uid()) OR public.has_full_admin_access());

CREATE FUNCTION private.require_competition_admin() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF auth.uid() IS NULL OR NOT public.has_full_admin_access() THEN RAISE EXCEPTION 'A gestão de concursos exige administração autorizada.' USING errcode='42501';END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
END $$;
REVOKE ALL ON FUNCTION private.require_competition_admin() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.save_public_competition(p_id uuid,p_expected_version integer,p_data jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.public_competitions%rowtype; next_role text; form_url text;
BEGIN
 PERFORM private.require_competition_admin();
 IF p_id IS NOT NULL THEN
  SELECT * INTO c FROM public.public_competitions WHERE id=p_id FOR UPDATE;
  IF c.id IS NULL OR c.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'O concurso foi alterado. Atualize os dados antes de salvar.';END IF;
  IF c.status IN ('finished','cancelled') THEN RAISE EXCEPTION 'Este concurso foi encerrado.';END IF;
 END IF;
 next_role:=p_data->>'role';form_url:=btrim(p_data->>'forms_url');
 IF NOT EXISTS(SELECT 1 FROM public.system_settings s CROSS JOIN LATERAL jsonb_array_elements(s.value->'roles')r WHERE s.key='official_salaries' AND r->>'role'=next_role) THEN RAISE EXCEPTION 'Cargo sem remuneração no catálogo oficial.';END IF;
 IF c.status='published' AND EXISTS(SELECT 1 FROM public.public_competition_applications WHERE competition_id=c.id) THEN
  IF next_role IS DISTINCT FROM c.role OR (p_data->>'vacancies')::integer<c.vacancies OR (p_data->>'registration_ends_at')::timestamptz<c.registration_ends_at OR (p_data->>'exam_starts_at')::timestamptz IS DISTINCT FROM c.exam_starts_at OR (p_data->>'exam_ends_at')::timestamptz IS DISTINCT FROM c.exam_ends_at THEN
   RAISE EXCEPTION 'Com inscrições existentes, preserve cargo, período de prova e vagas; não reduza o prazo de inscrições.';
  END IF;
 END IF;
 IF c.id IS NULL THEN
  INSERT INTO public.public_competitions(name,role,vacancies,notice_url,registration_starts_at,registration_ends_at,exam_starts_at,exam_ends_at,created_by)
  VALUES(btrim(p_data->>'name'),next_role,(p_data->>'vacancies')::integer,p_data->>'notice_url',(p_data->>'registration_starts_at')::timestamptz,(p_data->>'registration_ends_at')::timestamptz,(p_data->>'exam_starts_at')::timestamptz,(p_data->>'exam_ends_at')::timestamptz,auth.uid()) RETURNING id INTO p_id;
 ELSE
  UPDATE public.public_competitions SET name=btrim(p_data->>'name'),role=next_role,vacancies=(p_data->>'vacancies')::integer,notice_url=p_data->>'notice_url',registration_starts_at=(p_data->>'registration_starts_at')::timestamptz,registration_ends_at=(p_data->>'registration_ends_at')::timestamptz,exam_starts_at=(p_data->>'exam_starts_at')::timestamptz,exam_ends_at=(p_data->>'exam_ends_at')::timestamptz,version=version+1,updated_at=clock_timestamp() WHERE id=p_id;
 END IF;
 INSERT INTO private.public_competition_exams VALUES(p_id,form_url) ON CONFLICT(competition_id) DO UPDATE SET forms_url=excluded.forms_url;
 PERFORM economy_private.audit('competition_saved','public_competitions',p_id::text,to_jsonb(c),p_data-'forms_url','Edição de concurso público.',auth.uid());
 RETURN p_id;
END $$;

CREATE FUNCTION public.transition_public_competition(p_id uuid,p_expected_version integer,p_status text,p_results_url text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.public_competitions%rowtype;
BEGIN
 PERFORM private.require_competition_admin();
 SELECT * INTO c FROM public.public_competitions WHERE id=p_id FOR UPDATE;
 IF c.id IS NULL OR c.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'O concurso foi alterado. Atualize os dados.';END IF;
 IF p_status='results' THEN
  IF c.status NOT IN('published','finished') OR clock_timestamp()<c.exam_ends_at OR nullif(btrim(p_results_url),'') IS NULL THEN RAISE EXCEPTION 'Publique os resultados após o encerramento da prova, com o documento oficial.';END IF;
  UPDATE public.public_competitions SET results_url=p_results_url,results_published_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE id=p_id;
 ELSE
  IF NOT ((c.status='draft' AND p_status IN('published','cancelled')) OR (c.status='published' AND p_status IN('finished','cancelled'))) THEN RAISE EXCEPTION 'Transição de concurso inválida.';END IF;
  IF p_status='published' AND c.registration_ends_at<=clock_timestamp() THEN RAISE EXCEPTION 'Defina um prazo futuro para as inscrições.';END IF;
  IF p_status='finished' AND (clock_timestamp()<c.exam_ends_at OR EXISTS(SELECT 1 FROM public.public_competition_applications WHERE competition_id=p_id AND status='registered')) THEN RAISE EXCEPTION 'Encerre a prova e avalie todos os candidatos antes de finalizar.';END IF;
  IF p_status='cancelled' AND EXISTS(SELECT 1 FROM public.public_competition_applications WHERE competition_id=p_id AND status='approved') THEN RAISE EXCEPTION 'Um concurso com efetivações não pode ser cancelado.';END IF;
  UPDATE public.public_competitions SET status=p_status,version=version+1,updated_at=clock_timestamp() WHERE id=p_id;
 END IF;
 PERFORM economy_private.audit('competition_'||p_status,'public_competitions',p_id::text,to_jsonb(c),jsonb_build_object('results_url',p_results_url),'Decisão administrativa sobre concurso.',auth.uid());
END $$;

CREATE FUNCTION public.register_public_competition(p_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.public_competitions%rowtype;a uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para se inscrever.' USING errcode='42501';END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
 SELECT * INTO c FROM public.public_competitions WHERE id=p_id FOR SHARE;
 IF c.id IS NULL OR c.status<>'published' OR clock_timestamp()<c.registration_starts_at OR clock_timestamp()>=c.registration_ends_at THEN RAISE EXCEPTION 'As inscrições não estão abertas.';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND deleted_at IS NULL AND onboarding_completed) THEN RAISE EXCEPTION 'Conclua seu cadastro de cidadão.';END IF;
 INSERT INTO public.public_competition_applications(competition_id,profile_id) VALUES(p_id,auth.uid()) ON CONFLICT(competition_id,profile_id) DO NOTHING RETURNING id INTO a;
 IF a IS NULL THEN SELECT id INTO a FROM public.public_competition_applications WHERE competition_id=p_id AND profile_id=auth.uid();END IF;
 RETURN a;
END $$;

CREATE FUNCTION public.get_public_competition_exam(p_id uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE link text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para acessar a prova.' USING errcode='42501';END IF;
 SELECT e.forms_url INTO link FROM private.public_competition_exams e JOIN public.public_competitions c ON c.id=e.competition_id
 WHERE c.id=p_id AND c.status='published' AND clock_timestamp()>=c.exam_starts_at AND clock_timestamp()<c.exam_ends_at
 AND EXISTS(SELECT 1 FROM public.public_competition_applications a WHERE a.competition_id=c.id AND a.profile_id=auth.uid());
 IF link IS NULL THEN RAISE EXCEPTION 'A prova está disponível apenas para inscritos durante o período autorizado.' USING errcode='42501';END IF;
 RETURN link;
END $$;

CREATE FUNCTION public.get_public_competition_admin(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM private.require_competition_admin();
 RETURN jsonb_build_object('forms_url',(SELECT forms_url FROM private.public_competition_exams WHERE competition_id=p_id),
 'applications',(SELECT coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('name',p.full_name,'username',p.username,'current_role',p.role) ORDER BY a.registered_at),'[]') FROM public.public_competition_applications a JOIN public.profiles p ON p.id=a.profile_id WHERE a.competition_id=p_id));
END $$;

CREATE FUNCTION private.guard_public_career() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF TG_OP='UPDATE' AND new.role IS NOT DISTINCT FROM old.role THEN RETURN new;END IF;
 IF new.role IN ('Defensor Público','Promotor','Agente Secreto','Professor','Policial','Militar','Agente Penitenciário') AND NOT EXISTS(SELECT 1 FROM public.public_careers WHERE profile_id=new.id AND role=new.role) THEN
  RAISE EXCEPTION 'O ingresso neste cargo exige aprovação em concurso público.' USING errcode='42501';
 END IF;
 RETURN new;
END $$;
CREATE TRIGGER guard_public_career BEFORE INSERT OR UPDATE OF role ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.guard_public_career();
REVOKE ALL ON FUNCTION private.guard_public_career() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.decide_public_competition(p_application_id uuid,p_approve boolean,p_identity_confirmed boolean,p_criteria_confirmed boolean,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.public_competition_applications%rowtype;c public.public_competitions%rowtype;p public.profiles%rowtype;salary numeric;approved_count integer;previous_context text;
BEGIN
 PERFORM private.require_competition_admin();
 IF p_approve IS NULL OR length(btrim(coalesce(p_reason,'')))<10 OR length(p_reason)>4000 THEN RAISE EXCEPTION 'Registre uma justificativa entre 10 e 4.000 caracteres.';END IF;
 -- Same institution lock order as existing role and executive transitions.
 PERFORM pg_advisory_xact_lock(hashtext('govrp:presidential-succession'));
 PERFORM pg_advisory_xact_lock(hashtext('govrp:executive:appointments'));
 SELECT competition_id INTO a.competition_id FROM public.public_competition_applications WHERE id=p_application_id;
 SELECT * INTO c FROM public.public_competitions WHERE id=a.competition_id FOR UPDATE;
 SELECT * INTO a FROM public.public_competition_applications WHERE id=p_application_id FOR UPDATE;
 IF a.id IS NULL THEN RAISE EXCEPTION 'Inscrição não encontrada.';END IF;
 IF a.status=(CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END) THEN RETURN jsonb_build_object('status',a.status,'already_decided',true);END IF;
 IF a.status<>'registered' OR c.status<>'published' OR clock_timestamp()<c.exam_ends_at THEN RAISE EXCEPTION 'A decisão exige inscrição pendente e prova encerrada em concurso publicado.';END IF;
 IF p_approve THEN
  IF p_identity_confirmed IS DISTINCT FROM true OR p_criteria_confirmed IS DISTINCT FROM true THEN RAISE EXCEPTION 'Confirme a identidade na prova e o cumprimento dos critérios do edital.';END IF;
  SELECT count(*) INTO approved_count FROM public.public_competition_applications WHERE competition_id=c.id AND status='approved';
  IF approved_count>=c.vacancies THEN RAISE EXCEPTION 'Todas as vagas foram preenchidas.';END IF;
  SELECT * INTO p FROM public.profiles WHERE id=a.profile_id FOR UPDATE;
  IF p.deleted_at IS NOT NULL OR NOT p.onboarding_completed OR p.role NOT IN('Cidadão','Usuário',c.role) THEN RAISE EXCEPTION 'A situação funcional atual do candidato é incompatível com a efetivação.';END IF;
  IF EXISTS(SELECT 1 FROM public.public_careers WHERE profile_id=p.id AND role=c.role) THEN RAISE EXCEPTION 'O candidato já pertence a esta carreira.';END IF;
  SELECT CASE WHEN (r->>'valid_from')::timestamptz>clock_timestamp() THEN (r->>'previous_amount')::numeric ELSE (r->>'amount')::numeric END INTO salary
  FROM public.system_settings s CROSS JOIN LATERAL jsonb_array_elements(s.value->'roles')r WHERE s.key='official_salaries' AND r->>'role'=c.role;
  IF salary IS NULL THEN RAISE EXCEPTION 'Cargo sem remuneração oficial.';END IF;
  INSERT INTO public.public_careers(profile_id,role,application_id,source) VALUES(p.id,c.role,a.id,'competition');
  previous_context:=current_setting('govrp.admin_role_change',true);
  PERFORM set_config('govrp.admin_role_change',p.id::text,true);
  UPDATE public.profiles SET role=c.role,manual_role_override=false,role_assigned_at=clock_timestamp(),role_assigned_by=auth.uid(),updated_at=clock_timestamp() WHERE id=p.id;
  PERFORM set_config('govrp.admin_role_change',coalesce(previous_context,''),true);
  -- Reuse the persistent role notification and acknowledgement queue.
  UPDATE public.notifications SET content='PARABÉNS! VOCÊ FOI APROVADO! Sua aprovação para '||c.role||' foi confirmada. Você está efetivado.',
   link='/services/public-competitions/'||c.id,metadata=metadata||jsonb_build_object('competition_id',c.id,'application_id',a.id,'competition_approved',true,'weekly_salary',salary,'new_role',c.role,'popup_pending',true)
  WHERE id=(SELECT id FROM public.notifications WHERE user_id=p.id AND type='role_changed' AND metadata->>'new_role'=c.role AND created_at>=transaction_timestamp() ORDER BY created_at DESC LIMIT 1);
  IF NOT FOUND THEN
   INSERT INTO public.notifications(user_id,type,content,link,metadata) VALUES(p.id,'role_changed','PARABÉNS! VOCÊ FOI APROVADO! Sua aprovação para '||c.role||' foi confirmada. Você está efetivado.','/services/public-competitions/'||c.id,jsonb_build_object('competition_id',c.id,'application_id',a.id,'competition_approved',true,'weekly_salary',salary,'new_role',c.role,'popup_pending',true));
  END IF;
 END IF;
 UPDATE public.public_competition_applications SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,decided_at=clock_timestamp(),decided_by=auth.uid(),decision_reason=btrim(p_reason),identity_confirmed=coalesce(p_identity_confirmed,false),criteria_confirmed=coalesce(p_criteria_confirmed,false) WHERE id=a.id;
 UPDATE public.public_competitions SET updated_at=clock_timestamp(),version=version+1 WHERE id=c.id;
 PERFORM economy_private.audit('competition_decision','public_competition_applications',a.id::text,to_jsonb(a),jsonb_build_object('approved',p_approve,'identity_confirmed',p_identity_confirmed,'criteria_confirmed',p_criteria_confirmed),p_reason,auth.uid());
 RETURN jsonb_build_object('status',CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,'role',c.role,'weekly_salary',salary);
END $$;

CREATE FUNCTION public.recover_public_career(p_profile_id uuid,p_role text,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM private.require_competition_admin();
 IF length(btrim(coalesce(p_reason,'')))<40 THEN RAISE EXCEPTION 'Registre a fundamentação da recuperação técnica (mínimo de 40 caracteres).';END IF;
 INSERT INTO public.public_careers(profile_id,role,source) VALUES(p_profile_id,p_role,'recovery') ON CONFLICT(profile_id,role) DO NOTHING;
 PERFORM economy_private.audit('public_career_recovery','profiles',p_profile_id::text,NULL,jsonb_build_object('role',p_role),p_reason,auth.uid());
END $$;

REVOKE ALL ON FUNCTION public.save_public_competition(uuid,integer,jsonb),public.transition_public_competition(uuid,integer,text,text),public.register_public_competition(uuid),public.get_public_competition_exam(uuid),public.get_public_competition_admin(uuid),public.decide_public_competition(uuid,boolean,boolean,boolean,text),public.recover_public_career(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_public_competition(uuid,integer,jsonb),public.transition_public_competition(uuid,integer,text,text),public.register_public_competition(uuid),public.get_public_competition_exam(uuid),public.get_public_competition_admin(uuid),public.decide_public_competition(uuid,boolean,boolean,boolean,text),public.recover_public_career(uuid,text,text) TO authenticated;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('public-competitions','public-competitions',true,10485760,ARRAY['application/pdf']) ON CONFLICT(id) DO NOTHING;
CREATE POLICY competition_documents_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='public-competitions' AND public.has_full_admin_access());
CREATE POLICY competition_documents_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='public-competitions');
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['public_competitions','public_competition_applications','public_careers'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t);END IF;
 END LOOP;
END $$;
COMMIT;
