-- Administrative oversight is separate from criminal proceedings and impeachment.
CREATE TABLE private.mp_oversight_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 protocol text NOT NULL UNIQUE,
 target_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 target_name text NOT NULL, target_role text NOT NULL,
 reporter_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
 opened_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
 title text NOT NULL CHECK(length(title) BETWEEN 5 AND 200),
 description text NOT NULL CHECK(length(description) BETWEEN 40 AND 20000),
 category text NOT NULL CHECK(category IN('corruption','abuse','omission','public_funds','legality','other')),
 status text NOT NULL DEFAULT 'submitted' CHECK(status IN('submitted','open','rejected','closed','referred_pic','referred_external')),
 legal_basis text, outcome text, investigation_id uuid UNIQUE REFERENCES public.criminal_investigations(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(), opened_at timestamptz, closed_at timestamptz
);
CREATE TABLE private.mp_oversight_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL REFERENCES private.mp_oversight_cases(id) ON DELETE RESTRICT,
 recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 sent_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind IN('requisition','recommendation','referral')),
 body text NOT NULL CHECK(length(body) BETWEEN 40 AND 20000),
 legal_basis text NOT NULL CHECK(length(legal_basis) BETWEEN 10 AND 2000),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','answered','cancelled')),
 due_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 response text, answered_at timestamptz, cancelled_at timestamptz,
 CHECK((status='answered')=(response IS NOT NULL AND answered_at IS NOT NULL))
);
CREATE TABLE private.mp_oversight_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL REFERENCES private.mp_oversight_cases(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 action text NOT NULL, description text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.mp_oversight_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.mp_oversight_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.mp_oversight_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.mp_oversight_cases,private.mp_oversight_messages,private.mp_oversight_events FROM PUBLIC,anon,authenticated;
CREATE INDEX mp_oversight_case_reporter ON private.mp_oversight_cases(reporter_id,created_at DESC);
CREATE INDEX mp_oversight_case_target ON private.mp_oversight_cases(target_id,created_at DESC);
CREATE INDEX mp_oversight_messages_recipient ON private.mp_oversight_messages(recipient_id,created_at DESC);
CREATE INDEX mp_oversight_messages_case ON private.mp_oversight_messages(case_id,created_at DESC);
CREATE INDEX mp_oversight_events_case ON private.mp_oversight_events(case_id,created_at DESC);

-- Only publicly identifiable RP offices are listed. No intelligence agents or real personal data.
CREATE FUNCTION private.mp_oversight_public_role(p_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN p.role='Ministro' AND NOT EXISTS(SELECT 1 FROM public.ministers m WHERE m.user_id=p.id AND m.status='active') THEN NULL
 WHEN p.role IN('Juiz Federal','Presidente do STF','Procurador-Geral da República') AND NOT EXISTS(SELECT 1 FROM public.institutional_terms t WHERE t.profile_id=p.id AND t.status='active' AND t.starts_at<=now() AND (t.ends_at IS NULL OR t.ends_at>now()) AND (CASE WHEN p.role='Procurador-Geral da República' THEN t.office_key='public_prosecutor' ELSE t.office_key LIKE 'supreme_court_%' END)) THEN NULL
 WHEN public.canonical_official_role(p.role) IN('Presidente','Vice-Presidente','Ministro','Deputado','Senador','Presidente da Câmara dos Deputados','Vice-Presidente da Câmara dos Deputados','Presidente do Senado','Presidente do Senado Federal','Vice-Presidente do Senado Federal','Juiz Federal','Presidente do STF','Promotor','Procurador-Geral da República','Diretor-Geral de Polícia','Policial','Professor','Defensor Público','Militar','Comandante-Geral das Forças Armadas','Agente Penitenciário','Diretor Penitenciário','Presidente do Banco Nacional','Presidente do Portal Eleitoral','Comandante da Agência de Inteligência') THEN public.canonical_official_role(p.role)
 ELSE NULL END
 FROM public.profiles p WHERE p.id=p_id AND p.deleted_at IS NULL;
$$;
REVOKE ALL ON FUNCTION private.mp_oversight_public_role(uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION private.mp_oversight_is_manager(p_case private.mp_oversight_cases) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND public.justice_has_role(ARRAY['Promotor']) AND p_case.target_id IS DISTINCT FROM auth.uid() AND p_case.reporter_id IS DISTINCT FROM auth.uid();
$$;
REVOKE ALL ON FUNCTION private.mp_oversight_is_manager(private.mp_oversight_cases) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION private.mp_oversight_log(p_case uuid,p_action text,p_description text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO private.mp_oversight_events(case_id,actor_id,action,description) VALUES(p_case,auth.uid(),p_action,p_description);
 PERFORM public.justice_write_audit('mp.oversight.'||p_action,'mp_oversight_case',p_case,NULL,jsonb_build_object('action',p_action),p_description);
END $$;
REVOKE ALL ON FUNCTION private.mp_oversight_log(uuid,text,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.get_mp_oversight() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); is_mp boolean; admin_preview boolean;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=actor AND deleted_at IS NULL) OR NOT public.can_access_platform() THEN RAISE EXCEPTION 'Acesso não autorizado.' USING errcode='42501'; END IF;
 is_mp:=public.justice_has_role(ARRAY['Promotor']);
 -- Technical admin may inspect the screen in preview, without editing or viewing confidential contents.
 admin_preview:=public.is_admin(actor) AND EXISTS(SELECT 1 FROM private.admin_development_modes WHERE user_id=actor AND mode='simulate' AND simulated_role IN('Promotor','Procurador-Geral da República') AND NOT execute_real);
 RETURN jsonb_build_object('can_manage',is_mp OR admin_preview,'preview_only',admin_preview AND NOT is_mp,
 'officials',coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.full_name) FROM (SELECT p.id,p.full_name,private.mp_oversight_public_role(p.id) AS role FROM public.profiles p WHERE p.deleted_at IS NULL AND p.id<>actor AND private.mp_oversight_public_role(p.id) IS NOT NULL) o),'[]'::jsonb),
 'cases',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at DESC) FROM (SELECT c.* FROM private.mp_oversight_cases c WHERE is_mp AND private.mp_oversight_is_manager(c) ORDER BY c.created_at DESC LIMIT 100)c),'[]'::jsonb),
 'representations',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at DESC) FROM (SELECT protocol,title,target_name,target_role,category,description,status,created_at,closed_at FROM private.mp_oversight_cases WHERE reporter_id=actor ORDER BY created_at DESC LIMIT 100)c),'[]'::jsonb),
 'messages',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.created_at DESC) FROM (SELECT m.id,m.case_id,c.protocol,c.target_role,m.kind,m.body,m.legal_basis,m.status,m.due_at,m.response,m.answered_at,m.created_at FROM private.mp_oversight_messages m JOIN private.mp_oversight_cases c ON c.id=m.case_id WHERE m.recipient_id=actor ORDER BY m.created_at DESC LIMIT 100)m),'[]'::jsonb),
 'managed_messages',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.created_at DESC) FROM (SELECT m.* FROM private.mp_oversight_messages m JOIN private.mp_oversight_cases c ON c.id=m.case_id WHERE is_mp AND private.mp_oversight_is_manager(c) ORDER BY m.created_at DESC LIMIT 500)m),'[]'::jsonb),
 'events',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC) FROM (SELECT e.* FROM private.mp_oversight_events e JOIN private.mp_oversight_cases c ON c.id=e.case_id WHERE is_mp AND private.mp_oversight_is_manager(c) ORDER BY e.created_at DESC LIMIT 500)e),'[]'::jsonb));
END $$;

CREATE FUNCTION public.create_mp_oversight(p_target uuid,p_title text,p_description text,p_category text,p_direct boolean DEFAULT false,p_legal_basis text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); r private.mp_oversight_cases%rowtype; role_name text; target_name text;
BEGIN
 IF actor IS NULL OR NOT public.can_access_platform() OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=actor AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Acesso não autorizado.' USING errcode='42501'; END IF;
 PERFORM public.assert_admin_real_action(actor);
 IF p_target IS NULL OR p_target=actor THEN RAISE EXCEPTION 'Selecione outra autoridade pública.'; END IF;
 role_name:=private.mp_oversight_public_role(p_target);
 SELECT full_name INTO target_name FROM public.profiles WHERE id=p_target AND deleted_at IS NULL;
 IF role_name IS NULL OR target_name IS NULL THEN RAISE EXCEPTION 'Selecione autoridade pública em exercício.'; END IF;
 IF p_category IS NULL OR p_category NOT IN('corruption','abuse','omission','public_funds','legality','other') OR length(btrim(coalesce(p_title,''))) NOT BETWEEN 5 AND 200 OR length(btrim(coalesce(p_description,''))) NOT BETWEEN 40 AND 20000 THEN RAISE EXCEPTION 'Informe categoria, título e descrição fundamentada dos fatos.'; END IF;
 IF coalesce(p_direct,false) AND (NOT public.justice_has_role(ARRAY['Promotor']) OR length(btrim(coalesce(p_legal_basis,''))) NOT BETWEEN 10 AND 2000) THEN RAISE EXCEPTION 'Instauração de ofício exige competência do MP e base legal.' USING errcode='42501'; END IF;
 -- Throttle duplicate representations from the same account, without exposing other reports.
 PERFORM pg_advisory_xact_lock(hashtextextended('mp-oversight:'||actor::text,0));
 IF NOT coalesce(p_direct,false) AND (SELECT count(*) FROM private.mp_oversight_cases WHERE reporter_id=actor AND created_at>clock_timestamp()-interval '1 day')>=5 THEN RAISE EXCEPTION 'Limite de cinco representações em 24 horas.'; END IF;
 INSERT INTO private.mp_oversight_cases(protocol,target_id,target_name,target_role,reporter_id,opened_by,title,description,category,status,legal_basis,opened_at)
 VALUES(public.justice_next_number('FIS'),p_target,target_name,role_name,CASE WHEN p_direct THEN NULL ELSE actor END,CASE WHEN p_direct THEN actor END,btrim(p_title),btrim(p_description),p_category,CASE WHEN p_direct THEN 'open' ELSE 'submitted' END,CASE WHEN p_direct THEN btrim(p_legal_basis) END,CASE WHEN p_direct THEN clock_timestamp() END) RETURNING * INTO r;
 PERFORM private.mp_oversight_log(r.id,CASE WHEN p_direct THEN 'opened' ELSE 'submitted' END,CASE WHEN p_direct THEN 'Procedimento instaurado de ofício.' ELSE 'Representação recebida sob acesso restrito.' END);
 IF NOT coalesce(p_direct,false) THEN PERFORM public.justice_notify(p.id,'mp_oversight_representation','Nova representação administrativa aguarda análise do Ministério Público.','/services/justice?view=authority',jsonb_build_object('oversight_id',r.id)) FROM public.profiles p WHERE p.deleted_at IS NULL AND p.id NOT IN(actor,p_target) AND p.role IN('Promotor','Procurador-Geral da República'); END IF;
 RETURN jsonb_build_object('id',r.id,'protocol',r.protocol,'status',r.status);
END $$;

CREATE FUNCTION public.move_mp_oversight(p_id uuid,p_action text,p_reason text,p_legal_basis text DEFAULT NULL,p_days integer DEFAULT NULL,p_recipient uuid DEFAULT NULL,p_facts_at timestamptz DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); c private.mp_oversight_cases%rowtype; m private.mp_oversight_messages%rowtype; pic public.criminal_investigations%rowtype; recipient uuid; kind text; new_status text; recipient_role text;
BEGIN
 IF actor IS NULL OR NOT public.can_access_platform() OR NOT public.justice_has_role(ARRAY['Promotor']) THEN RAISE EXCEPTION 'Ação reservada ao Ministério Público.' USING errcode='42501'; END IF;
 PERFORM public.assert_admin_real_action(actor);
 SELECT * INTO c FROM private.mp_oversight_cases WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT private.mp_oversight_is_manager(c) THEN RAISE EXCEPTION 'Procedimento indisponível ou conflito de interesse.' USING errcode='42501'; END IF;
 IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 40 AND 20000 THEN RAISE EXCEPTION 'Fundamente a ação com 40 a 20.000 caracteres.'; END IF;
 IF p_action IN('open','requisition','recommendation','refer_pic','refer_external') AND length(btrim(coalesce(p_legal_basis,''))) NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'Informe a base legal do RP.'; END IF;
 IF c.status='submitted' THEN
  IF p_action='open' THEN UPDATE private.mp_oversight_cases SET status='open',opened_by=actor,opened_at=clock_timestamp(),legal_basis=btrim(p_legal_basis) WHERE id=c.id RETURNING * INTO c;
  ELSIF p_action='reject' THEN UPDATE private.mp_oversight_cases SET status='rejected',outcome=btrim(p_reason),closed_at=clock_timestamp() WHERE id=c.id RETURNING * INTO c;
  ELSE RAISE EXCEPTION 'Analise a representação primeiro.'; END IF;
 ELSIF c.status='open' THEN
  CASE p_action
  WHEN 'note' THEN NULL;
  WHEN 'requisition','recommendation','refer_external' THEN
   IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Informe prazo de 1 a 30 dias reais.'; END IF;
   recipient:=CASE WHEN p_action='refer_external' THEN p_recipient ELSE c.target_id END;
   recipient_role:=private.mp_oversight_public_role(recipient);
   IF recipient_role IS NULL OR recipient=actor THEN RAISE EXCEPTION 'Destinatário público indisponível.'; END IF;
   IF p_action='refer_external' AND (recipient=c.target_id OR recipient=c.reporter_id OR recipient_role NOT IN('Diretor-Geral de Polícia','Juiz Federal','Presidente do STF','Presidente da Câmara dos Deputados','Presidente do Senado','Presidente do Senado Federal')) THEN RAISE EXCEPTION 'Selecione autoridade competente de outro órgão, sem conflito.'; END IF;
   kind:=CASE WHEN p_action='refer_external' THEN 'referral' ELSE p_action END;
   INSERT INTO private.mp_oversight_messages(case_id,recipient_id,sent_by,kind,body,legal_basis,due_at) VALUES(c.id,recipient,actor,kind,btrim(p_reason),btrim(p_legal_basis),clock_timestamp()+make_interval(days=>p_days)) RETURNING * INTO m;
   PERFORM public.justice_notify(recipient,'mp_oversight_message','Você recebeu uma comunicação administrativa do Ministério Público.','/services/justice?view=citizen',jsonb_build_object('oversight_message_id',m.id));
   IF p_action='refer_external' THEN new_status:='referred_external'; END IF;
  WHEN 'refer_pic' THEN
   IF p_facts_at IS NULL OR p_facts_at>clock_timestamp() OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=c.target_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Informe data passada dos fatos e investigado ativo.'; END IF;
   pic:=public.open_mp_investigation('Encaminhamento do procedimento administrativo '||c.protocol||'. '||btrim(p_reason),p_facts_at);
   PERFORM public.move_mp_investigation(pic.id,'subject',p_reason,c.target_id,NULL,'under_review',false);
   UPDATE private.mp_oversight_cases SET investigation_id=pic.id WHERE id=c.id RETURNING * INTO c;
   new_status:='referred_pic';
  WHEN 'close' THEN new_status:='closed';
  ELSE RAISE EXCEPTION 'Ação inválida para o procedimento aberto.';
  END CASE;
  IF new_status IS NOT NULL THEN
   -- Prior unanswered administrative messages are closed explicitly; a referral remains available to its addressee.
   UPDATE private.mp_oversight_messages SET status='cancelled',cancelled_at=clock_timestamp() WHERE case_id=c.id AND status='pending' AND (m.id IS NULL OR id<>m.id);
   UPDATE private.mp_oversight_cases SET status=new_status,outcome=btrim(p_reason),closed_at=clock_timestamp() WHERE id=c.id RETURNING * INTO c;
  END IF;
 ELSE RAISE EXCEPTION 'Procedimento encerrado; preserve o histórico.';
 END IF;
 PERFORM private.mp_oversight_log(c.id,p_action,btrim(p_reason));
 IF c.reporter_id IS NOT NULL AND p_action IN('open','reject','close','refer_pic','refer_external') THEN PERFORM public.justice_notify(c.reporter_id,'mp_oversight_status','Sua representação administrativa recebeu uma atualização.','/services/justice?view=citizen',jsonb_build_object('oversight_protocol',c.protocol)); END IF;
 RETURN jsonb_build_object('id',c.id,'protocol',c.protocol,'status',c.status,'investigation_id',c.investigation_id,'message_id',m.id);
END $$;

CREATE FUNCTION public.reply_mp_oversight(p_id uuid,p_response text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); m private.mp_oversight_messages%rowtype; c private.mp_oversight_cases%rowtype;
BEGIN
 IF actor IS NULL OR NOT public.can_access_platform() OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=actor AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Acesso não autorizado.' USING errcode='42501'; END IF;
 PERFORM public.assert_admin_real_action(actor);
 IF length(btrim(coalesce(p_response,''))) NOT BETWEEN 40 AND 20000 THEN RAISE EXCEPTION 'Resposta deve ter de 40 a 20.000 caracteres.'; END IF;
 SELECT * INTO m FROM private.mp_oversight_messages WHERE id=p_id AND recipient_id=actor FOR UPDATE;
 IF NOT FOUND OR m.status<>'pending' THEN RAISE EXCEPTION 'Comunicação indisponível para resposta.' USING errcode='42501'; END IF;
 SELECT * INTO c FROM private.mp_oversight_cases WHERE id=m.case_id;
 UPDATE private.mp_oversight_messages SET status='answered',response=btrim(p_response),answered_at=clock_timestamp() WHERE id=m.id RETURNING * INTO m;
 PERFORM private.mp_oversight_log(c.id,'reply',CASE WHEN m.answered_at>m.due_at THEN 'Resposta recebida após o prazo.' ELSE 'Resposta recebida no prazo.' END);
 PERFORM public.justice_notify(p.id,'mp_oversight_reply','Uma autoridade respondeu à comunicação administrativa do Ministério Público.','/services/justice?view=authority',jsonb_build_object('oversight_id',c.id)) FROM public.profiles p WHERE p.deleted_at IS NULL AND p.id<>c.target_id AND p.id IS DISTINCT FROM c.reporter_id AND p.id<>actor AND p.role IN('Promotor','Procurador-Geral da República');
 RETURN jsonb_build_object('id',m.id,'status',m.status,'late',m.answered_at>m.due_at);
END $$;
REVOKE ALL ON FUNCTION public.get_mp_oversight(),public.create_mp_oversight(uuid,text,text,text,boolean,text),public.move_mp_oversight(uuid,text,text,text,integer,uuid,timestamptz),public.reply_mp_oversight(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_mp_oversight(),public.create_mp_oversight(uuid,text,text,text,boolean,text),public.move_mp_oversight(uuid,text,text,text,integer,uuid,timestamptz),public.reply_mp_oversight(uuid,text) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
