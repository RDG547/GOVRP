BEGIN;
-- Keep the private reporter identity separate from every police/public payload.
CREATE TABLE IF NOT EXISTS private.police_occurrence_reporters(occurrence_id uuid PRIMARY KEY REFERENCES public.police_occurrences(id) ON DELETE CASCADE,profile_id uuid NOT NULL REFERENCES public.profiles(id));
ALTER TABLE private.police_occurrence_reporters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.police_occurrence_reporters FROM PUBLIC,anon,authenticated;
INSERT INTO private.police_occurrence_reporters(occurrence_id,profile_id)
SELECT DISTINCT ON(o.id)o.id,coalesce(o.reported_by,o.user_id,a.actor_id) FROM public.police_occurrences o LEFT JOIN public.justice_audit_log a ON a.entity_id=o.id AND a.entity_type='police_occurrence' AND a.action='occurrence.created'
WHERE coalesce(o.reported_by,o.user_id,a.actor_id) IS NOT NULL ORDER BY o.id,a.created_at;
CREATE INDEX IF NOT EXISTS police_occurrence_reporter_lookup ON private.police_occurrence_reporters(profile_id,occurrence_id);
CREATE OR REPLACE FUNCTION private.owns_police_occurrence(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT EXISTS(SELECT 1 FROM private.police_occurrence_reporters WHERE occurrence_id=p_id AND profile_id=(SELECT auth.uid())) $$;
REVOKE ALL ON FUNCTION private.owns_police_occurrence(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.owns_police_occurrence(uuid) TO authenticated;
-- Preserve every event, timestamp and action; redact identifying fields only.
ALTER TABLE public.justice_audit_log DISABLE TRIGGER justice_audit_immutable;
UPDATE public.justice_audit_log a SET actor_id=NULL,actor_role=NULL,ip_hash=NULL,request_id=gen_random_uuid(),previous_state=previous_state-'user_id'-'reported_by',new_state=new_state-'user_id'-'reported_by' FROM public.police_occurrences o WHERE a.entity_type='police_occurrence' AND a.entity_id=o.id AND (o.anonymous OR o.is_anonymous);
ALTER TABLE public.justice_audit_log ENABLE TRIGGER justice_audit_immutable;

ALTER TABLE public.case_evidence ADD COLUMN IF NOT EXISTS occurrence_id uuid REFERENCES public.police_occurrences(id);
ALTER TABLE public.case_evidence ALTER COLUMN submitted_by DROP NOT NULL;
ALTER TABLE public.case_evidence DROP CONSTRAINT case_evidence_check;
ALTER TABLE public.case_evidence DROP CONSTRAINT IF EXISTS case_evidence_check;
ALTER TABLE public.case_evidence ADD CONSTRAINT case_evidence_check CHECK(investigation_id IS NOT NULL OR criminal_case_id IS NOT NULL OR occurrence_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS case_evidence_occurrence ON public.case_evidence(occurrence_id) WHERE occurrence_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS private.justice_evidence_uploads(
 id uuid PRIMARY KEY,path text NOT NULL UNIQUE,profile_id uuid NOT NULL REFERENCES public.profiles(id),filename text NOT NULL,mime text NOT NULL,
 bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 4194304),sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),
 evidence_id uuid UNIQUE REFERENCES public.case_evidence(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.justice_evidence_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.justice_evidence_uploads FROM PUBLIC,anon,authenticated;
CREATE INDEX IF NOT EXISTS justice_upload_owner ON private.justice_evidence_uploads(profile_id,created_at);
INSERT INTO storage.buckets(id,name,public,file_size_limit) VALUES('justice-evidence','justice-evidence',false,4194304) ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=4194304;

CREATE OR REPLACE FUNCTION public.register_police_evidence_upload(p_id uuid,p_profile_id uuid,p_path text,p_filename text,p_mime text,p_bytes int,p_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_profile_id AND deleted_at IS NULL AND onboarding_completed) THEN RAISE EXCEPTION 'Conclua sua cidadania antes de anexar provas.';END IF;
 IF p_path !~ ('^'||p_id::text||'/[a-z0-9-]+\.[a-z0-9]+$') OR length(p_filename)>180 THEN RAISE EXCEPTION 'Arquivo inválido.';END IF;
 IF (SELECT count(*) FROM private.justice_evidence_uploads WHERE profile_id=p_profile_id AND created_at>clock_timestamp()-interval '1 hour')>=30 THEN RAISE EXCEPTION 'Limite de 30 anexos por hora atingido. Aguarde para enviar mais arquivos.';END IF;
 INSERT INTO private.justice_evidence_uploads(id,path,profile_id,filename,mime,bytes,sha256) VALUES(p_id,p_path,p_profile_id,p_filename,p_mime,p_bytes,p_sha256);
 RETURN jsonb_build_object('id',p_id,'name',p_filename,'mime',p_mime,'bytes',p_bytes);
END $$;
REVOKE ALL ON FUNCTION public.register_police_evidence_upload(uuid,uuid,text,text,text,int,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_police_evidence_upload(uuid,uuid,text,text,text,int,text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_police_evidence_file(p_evidence_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.case_evidence%rowtype;u private.justice_evidence_uploads%rowtype;BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para consultar a prova.' USING errcode='42501';END IF;
 SELECT * INTO e FROM public.case_evidence WHERE id=p_evidence_id;
 IF e.id IS NULL OR NOT((e.occurrence_id IS NOT NULL AND (private.owns_police_occurrence(e.occurrence_id) OR public.justice_has_role(ARRAY['Admin','Policial','Diretor-Geral de Polícia','Promotor','Juiz']))) OR (e.investigation_id IS NOT NULL AND public.justice_can_access_investigation(e.investigation_id)) OR (e.criminal_case_id IS NOT NULL AND public.justice_can_access_case(e.criminal_case_id))) THEN RAISE EXCEPTION 'Você não possui acesso a esta prova.' USING errcode='42501';END IF;
 IF e.confidentiality_level NOT IN('public','restricted') AND NOT public.justice_has_role(ARRAY['Admin','Diretor-Geral de Polícia','Promotor','Juiz']) AND NOT EXISTS(SELECT 1 FROM public.criminal_investigations WHERE id=e.investigation_id AND (lead_officer_id=auth.uid() OR delegate_id=auth.uid())) THEN RAISE EXCEPTION 'Esta prova possui sigilo adicional.' USING errcode='42501';END IF;
 SELECT * INTO u FROM private.justice_evidence_uploads WHERE evidence_id=e.id;
 IF u.id IS NULL THEN RAISE EXCEPTION 'O arquivo não está disponível neste armazenamento.';END IF;
 RETURN jsonb_build_object('path',u.path,'name',e.title,'mime',u.mime,'bytes',u.bytes,'sha256',u.sha256);
END $$;
REVOKE ALL ON FUNCTION public.get_police_evidence_file(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_police_evidence_file(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.normalize_occurrence_people(p_people jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE item jsonb;p public.profiles%rowtype;r jsonb:='[]';selected_id uuid;kind text;BEGIN
 IF jsonb_typeof(coalesce(p_people,'[]'))<>'array' OR jsonb_array_length(coalesce(p_people,'[]'))>50 THEN RAISE EXCEPTION 'Selecione até 50 pessoas por campo.';END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(coalesce(p_people,'[]')) LOOP
  IF jsonb_typeof(item)='string' THEN
   IF length(item#>>'{}')>500 THEN RAISE EXCEPTION 'A descrição de cada pessoa deve ter até 500 caracteres.';END IF;
   r:=r||jsonb_build_array(jsonb_build_object('description',item#>>'{}','identified',false));CONTINUE;
  END IF;
  kind:=coalesce(item->>'kind','involved');IF kind NOT IN('involved','suspect','witness') THEN RAISE EXCEPTION 'Participação inválida.';END IF;
  BEGIN selected_id:=(item->>'profile_id')::uuid;EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Selecione um cidadão válido.';END;
  SELECT * INTO p FROM public.profiles WHERE public.profiles.id=selected_id AND deleted_at IS NULL;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Um dos cidadãos selecionados não está mais disponível.';END IF;
  r:=r||jsonb_build_array(jsonb_build_object('profile_id',p.id,'name',p.full_name,'username',p.username,'avatar_url',p.avatar_url,'kind',kind,'identified',true));
 END LOOP;RETURN r;
END $$;
REVOKE ALL ON FUNCTION private.normalize_occurrence_people(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.create_police_occurrence(p_title text,p_description text,p_occurrence_type text,p_location text,p_occurred_at timestamptz,p_anonymous boolean,p_priority text,p_involved_people jsonb,p_witnesses jsonb,p_evidence jsonb)
RETURNS public.police_occurrences LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();r public.police_occurrences%rowtype;ref jsonb;u private.justice_evidence_uploads%rowtype;e public.case_evidence%rowtype;refs jsonb:='[]';BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Entre para registrar o boletim.' USING errcode='42501';END IF;
 PERFORM public.assert_admin_real_action(actor);
 IF length(btrim(coalesce(p_title,'')))<5 OR length(p_title)>200 THEN RAISE EXCEPTION 'Informe um título entre 5 e 200 caracteres.';END IF;
 IF length(btrim(coalesce(p_description,'')))<20 OR length(p_description)>30000 THEN RAISE EXCEPTION 'Descreva os fatos entre 20 e 30.000 caracteres.';END IF;
 IF p_priority IS NULL OR p_priority NOT IN('low','normal','high','urgent') THEN RAISE EXCEPTION 'Selecione uma prioridade válida.';END IF;
 IF jsonb_typeof(coalesce(p_evidence,'[]'))<>'array' OR jsonb_array_length(coalesce(p_evidence,'[]'))>20 THEN RAISE EXCEPTION 'Inclua até 20 provas ou referências.';END IF;
 INSERT INTO public.police_occurrences(protocol_number,title,description,details,occurrence_type,type,location,occurred_at,reported_by,user_id,anonymous,is_anonymous,priority,status,confidentiality_level,involved_people,witnesses,evidence)
 VALUES(public.justice_next_number('BO'),btrim(p_title),btrim(p_description),btrim(p_description),btrim(p_occurrence_type),btrim(p_occurrence_type),nullif(btrim(p_location),''),coalesce(p_occurred_at,clock_timestamp()),CASE WHEN coalesce(p_anonymous,false) THEN NULL ELSE actor END,CASE WHEN coalesce(p_anonymous,false) THEN NULL ELSE actor END,coalesce(p_anonymous,false),coalesce(p_anonymous,false),p_priority,'Pendente','restricted',private.normalize_occurrence_people(p_involved_people),private.normalize_occurrence_people(p_witnesses),'[]') RETURNING * INTO r;
 INSERT INTO private.police_occurrence_reporters(occurrence_id,profile_id) VALUES(r.id,actor);
 FOR ref IN SELECT * FROM jsonb_array_elements(coalesce(p_evidence,'[]')) LOOP
  IF jsonb_typeof(ref)='string' THEN
   IF length(ref#>>'{}')>2000 THEN RAISE EXCEPTION 'Uma referência deve ter até 2.000 caracteres.';END IF;
   refs:=refs||jsonb_build_array(jsonb_build_object('reference',ref#>>'{}'));CONTINUE;
  END IF;
  SELECT * INTO u FROM private.justice_evidence_uploads WHERE id=(ref->>'upload_id')::uuid AND profile_id=actor AND evidence_id IS NULL AND created_at>clock_timestamp()-interval '24 hours' FOR UPDATE;
  IF u.id IS NULL THEN RAISE EXCEPTION 'Um dos anexos expirou, já foi utilizado ou não pertence à sua conta.' USING errcode='42501';END IF;
  INSERT INTO public.case_evidence(occurrence_id,evidence_type,title,submitted_by,status,confidentiality_level,evidence_hash,metadata)
  VALUES(r.id,'document',CASE WHEN coalesce(p_anonymous,false) THEN 'Anexo '||(jsonb_array_length(refs)+1)||'.'||regexp_replace(u.path,'^.*\.','') ELSE u.filename END,CASE WHEN coalesce(p_anonymous,false) THEN NULL ELSE actor END,'collected','restricted',u.sha256,jsonb_build_object('private_file',true,'mime',u.mime,'bytes',u.bytes)) RETURNING * INTO e;
  UPDATE private.justice_evidence_uploads SET evidence_id=e.id WHERE id=u.id;
  refs:=refs||jsonb_build_array(jsonb_build_object('evidence_id',e.id,'name',e.title,'mime',u.mime,'bytes',u.bytes));
 END LOOP;
 UPDATE public.police_occurrences SET evidence=refs WHERE id=r.id RETURNING * INTO r;
 PERFORM public.justice_write_audit('occurrence.created','police_occurrence',r.id,NULL,to_jsonb(r)-'user_id'-'reported_by','Boletim de ocorrência registrado.');
 PERFORM public.justice_notify(actor,'justice_occurrence_created','Boletim '||r.protocol_number||' recebido.','/services/justice?view=citizen',jsonb_build_object('occurrence_id',r.id,'protocol_number',r.protocol_number));
 RETURN r;
END $$;


CREATE OR REPLACE FUNCTION public.get_my_police_occurrences()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(row_data order by created_at desc),'[]') from (
    select o.created_at,jsonb_build_object(
      'id',o.id,'protocol_number',o.protocol_number,'title',o.title,
      'description',o.description,'details',o.details,'status',o.status,
      'priority',o.priority,'created_at',o.created_at,'updated_at',o.updated_at,'anonymous',o.anonymous,'involved_people',o.involved_people,'witnesses',o.witnesses,'evidence',o.evidence,
      'history',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'content',case when a.action='occurrence.created' then 'Ocorrência recebida.' else 'Situação: '||coalesce(a.new_state->>'status','Atualizada')||'.' end,'created_at',a.created_at,'status',a.new_state->>'status') order by a.created_at)
        from public.justice_audit_log a where a.entity_type='police_occurrence' and a.entity_id=o.id
          and a.action in('occurrence.created','occurrence.status_changed')),'[]')
    ) row_data
    from public.police_occurrences o where auth.uid() is not null and (
      o.user_id=auth.uid() or o.reported_by=auth.uid() or private.owns_police_occurrence(o.id)
    ) order by o.created_at desc limit 100
  ) own_occurrences;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_police_occurrences_page(p_limit integer DEFAULT 20, p_before_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  page_size integer := least(100, greatest(1, coalesce(p_limit,20)));
  items jsonb;
  has_more boolean;
  last_item jsonb;
  active_count bigint;
begin
  if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'INVALID_PAGE_CURSOR';
  end if;
  select coalesce(jsonb_agg(row_data order by created_at desc,id desc),'[]'::jsonb)
  into items from (
    select o.created_at,o.id,jsonb_build_object(
      'id',o.id,'protocol_number',o.protocol_number,'title',o.title,
      'description',o.description,'details',o.details,'status',o.status,
      'priority',o.priority,'created_at',o.created_at,'updated_at',o.updated_at,'anonymous',o.anonymous,'involved_people',o.involved_people,'witnesses',o.witnesses,'evidence',o.evidence,
      'history',coalesce((select jsonb_agg(jsonb_build_object(
        'id',a.id,'content',case when a.action='occurrence.created' then 'Ocorrência recebida.'
          else 'Situação: '||coalesce(a.new_state->>'status','Atualizada')||'.' end,
        'created_at',a.created_at,'status',a.new_state->>'status') order by a.created_at,a.id)
        from public.justice_audit_log a where a.entity_type='police_occurrence' and a.entity_id=o.id
          and a.action in('occurrence.created','occurrence.status_changed')),'[]'::jsonb)
    ) row_data
    from public.police_occurrences o
    where (o.user_id=auth.uid() or o.reported_by=auth.uid() or private.owns_police_occurrence(o.id)) and (p_before_created_at is null or (o.created_at,o.id)<(p_before_created_at,p_before_id))
    order by o.created_at desc,o.id desc limit page_size+1
  ) own_occurrences;
  has_more := jsonb_array_length(items)>page_size;
  if has_more then items := items - page_size; end if;
  last_item := items -> -1;
  select count(*) into active_count from public.police_occurrences o
  where o.status not in('Arquivada','Duplicada') and (o.user_id=auth.uid() or o.reported_by=auth.uid() or private.owns_police_occurrence(o.id));
  return jsonb_build_object('items',items,'active_count',active_count,'next_cursor',case when has_more then
    jsonb_build_object('created_at',last_item->>'created_at','id',last_item->>'id') else null end);
end; $function$;
CREATE OR REPLACE FUNCTION private.redact_anonymous_occurrence_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF new.entity_type='police_occurrence' AND EXISTS(SELECT 1 FROM public.police_occurrences WHERE id=new.entity_id AND (anonymous OR is_anonymous)) THEN
  IF new.action='occurrence.created' OR EXISTS(SELECT 1 FROM private.police_occurrence_reporters WHERE occurrence_id=new.entity_id AND profile_id=new.actor_id) THEN new.actor_id:=NULL;new.actor_role:=NULL;new.ip_hash:=NULL;new.request_id:=gen_random_uuid();END IF;
  new.previous_state:=new.previous_state-'user_id'-'reported_by';new.new_state:=new.new_state-'user_id'-'reported_by';
 END IF;RETURN new;
END $$;
DROP TRIGGER IF EXISTS protect_anonymous_occurrence_audit ON public.justice_audit_log;
CREATE TRIGGER protect_anonymous_occurrence_audit BEFORE INSERT OR UPDATE ON public.justice_audit_log FOR EACH ROW EXECUTE FUNCTION private.redact_anonymous_occurrence_audit();
REVOKE ALL ON FUNCTION private.redact_anonymous_occurrence_audit() FROM PUBLIC,anon,authenticated,service_role;

ALTER POLICY "Contextual case evidence access" ON public.case_evidence USING (
 ((criminal_case_id IS NOT NULL AND public.justice_can_access_case(criminal_case_id)) OR (investigation_id IS NOT NULL AND public.justice_can_access_investigation(investigation_id)) OR (occurrence_id IS NOT NULL AND (private.owns_police_occurrence(occurrence_id) OR public.justice_has_role(ARRAY['Admin','Policial','Delegado','Promotor','Juiz']))))
 AND (confidentiality_level IN('public','restricted') OR public.justice_has_role(ARRAY['Admin','Delegado','Promotor','Juiz']) OR EXISTS(SELECT 1 FROM public.criminal_investigations WHERE id=investigation_id AND (lead_officer_id=auth.uid() OR delegate_id=auth.uid())))
);

-- Police can read the identified reporter's RP identity without exposing OOC
-- documents or retrieving the private identity behind an anonymous report.
CREATE OR REPLACE FUNCTION public.get_occurrence_reporter(p_occurrence_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',p.id,'full_name',p.full_name,'avatar_url',p.avatar_url,'username',p.username,'cpf',p.cpf)
 FROM public.police_occurrences o JOIN public.profiles p ON p.id=coalesce(o.reported_by,o.user_id)
 WHERE o.id=p_occurrence_id AND NOT o.anonymous AND NOT o.is_anonymous AND public.justice_has_role(ARRAY['Admin','Policial','Delegado','Promotor','Juiz'])
$$;
REVOKE ALL ON FUNCTION public.get_occurrence_reporter(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_occurrence_reporter(uuid) TO authenticated;

-- Attach existing BO proofs to the investigation instead of copying them.
CREATE OR REPLACE FUNCTION private.link_occurrence_evidence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.case_evidence SET investigation_id=new.id WHERE occurrence_id=new.occurrence_id AND investigation_id IS NULL;
 RETURN new;
END $$;
DROP TRIGGER IF EXISTS link_occurrence_evidence ON public.criminal_investigations;
CREATE TRIGGER link_occurrence_evidence AFTER INSERT ON public.criminal_investigations FOR EACH ROW EXECUTE FUNCTION private.link_occurrence_evidence();
REVOKE ALL ON FUNCTION private.link_occurrence_evidence() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.create_police_occurrence(p_title text,p_description text,p_occurrence_type text,p_location text DEFAULT NULL,p_occurred_at timestamptz DEFAULT now(),p_anonymous boolean DEFAULT false,p_priority text DEFAULT 'normal') RETURNS public.police_occurrences
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT public.create_police_occurrence(p_title,p_description,p_occurrence_type,p_location,p_occurred_at,p_anonymous,p_priority,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb) $$;

CREATE OR REPLACE FUNCTION private.criminal_certificate_report(p_profile_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('rule','effective_convictions_only','records',coalesce(jsonb_agg(jsonb_build_object(
 'id',r.id,'crime',r.crime,'case_number',c.case_number,'recorded_at',r.created_at,'record_status',r.record_status,
 'case_status',c.status,'sentence_status',s.status,'sentence_type',s.sentence_type,'sentence_units',s.final_sentence_units,
 'imposed_seconds',s.real_duration_seconds,'credit_seconds',s.provisional_time_credit_seconds,'legal_snapshot',s.legal_snapshot,
 'served_seconds',least(coalesce(s.real_duration_seconds,0),coalesce((SELECT sum(greatest(0,extract(epoch FROM least(coalesce(pt.actual_release_at,clock_timestamp()),coalesce(pt.expected_release_at,clock_timestamp()),clock_timestamp())-pt.admitted_at))) FROM public.prison_terms pt WHERE pt.sentence_id=s.id AND pt.custody_status<>'awaiting_intake'),0)),
 'custody',(SELECT coalesce(jsonb_agg(jsonb_build_object('status',pt.custody_status,'admitted_at',pt.admitted_at,'expected_release_at',pt.expected_release_at,'actual_release_at',pt.actual_release_at,'release_reason',pt.release_reason) ORDER BY pt.admitted_at),'[]') FROM public.prison_terms pt WHERE pt.sentence_id=s.id),
 'fines',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'amount',f.amount,'status',f.status,'paid_at',f.paid_at,'payment_transaction_id',f.payment_transaction_id,'refund_transaction_id',f.refund_transaction_id,'snapshot',f.payment_snapshot) ORDER BY f.created_at),'[]') FROM public.police_fines f WHERE f.user_id=r.user_id AND f.sentence_id=s.id)
 ) ORDER BY r.created_at DESC),'[]'),'result',CASE WHEN count(*)>0 THEN 'positive' ELSE 'nothing_found' END)
 FROM public.criminal_records r LEFT JOIN public.sentences s ON s.id=r.sentence_id LEFT JOIN public.criminal_cases c ON c.id=r.case_id
 WHERE r.user_id=p_profile_id AND r.is_active AND r.record_status='conviction' AND (r.effects_expire_at IS NULL OR r.effects_expire_at>clock_timestamp()) AND (s.id IS NULL OR s.status NOT IN('annulled','revoked'))
$$;
REVOKE ALL ON FUNCTION private.criminal_certificate_report(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.issue_criminal_clearance_certificate() RETURNS public.documents
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.documents%rowtype;report jsonb;actor uuid:=auth.uid();num text;BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Entre para emitir o atestado.' USING errcode='42501';END IF;
 PERFORM public.assert_admin_real_action(actor);
 PERFORM id FROM public.profiles WHERE id=actor AND onboarding_completed AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conclua sua cidadania para emitir o atestado.';END IF;
 report:=private.criminal_certificate_report(actor)||jsonb_build_object('generatedAt',clock_timestamp());
 SELECT * INTO r FROM public.documents WHERE user_id=actor AND type='Atestado de Antecedentes' AND is_valid AND expires_at>clock_timestamp() AND issued_at>clock_timestamp()-interval '1 minute' ORDER BY issued_at DESC LIMIT 1;
 IF r.id IS NOT NULL THEN UPDATE public.documents SET metadata=metadata||report WHERE id=r.id RETURNING * INTO r;RETURN r;END IF;
 UPDATE public.documents SET is_valid=false WHERE user_id=actor AND type='Atestado de Antecedentes' AND is_valid;
 num:='AAC-'||to_char(public.rp_now(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
 INSERT INTO public.documents(user_id,type,document_number,issued_at,expires_at,is_valid,metadata,qr_code_data,full_name)
 SELECT actor,'Atestado de Antecedentes',num,clock_timestamp(),clock_timestamp()+interval '90 days',true,report,'GOVRP:AAC:'||num,p.full_name FROM public.profiles p WHERE id=actor RETURNING * INTO r;
 RETURN r;
END $$;

CREATE OR REPLACE FUNCTION private.refresh_criminal_certificate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pid uuid;payload jsonb:=CASE WHEN tg_op='DELETE' THEN to_jsonb(old) ELSE to_jsonb(new) END;BEGIN
 pid:=coalesce((payload->>'defendant_id')::uuid,(payload->>'inmate_id')::uuid,(payload->>'user_id')::uuid);
 IF pid IS NOT NULL THEN
 UPDATE public.documents SET metadata=metadata||private.criminal_certificate_report(pid)||jsonb_build_object('generatedAt',clock_timestamp(),'judicial_update_at',clock_timestamp()) WHERE user_id=pid AND type='Atestado de Antecedentes' AND is_valid AND expires_at>clock_timestamp();
 END IF;RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS certificate_record_changed ON public.criminal_records;
CREATE TRIGGER certificate_record_changed AFTER INSERT OR UPDATE OR DELETE ON public.criminal_records FOR EACH ROW EXECUTE FUNCTION private.refresh_criminal_certificate();
DROP TRIGGER IF EXISTS certificate_sentence_changed ON public.sentences;
CREATE TRIGGER certificate_sentence_changed AFTER INSERT OR UPDATE OR DELETE ON public.sentences FOR EACH ROW EXECUTE FUNCTION private.refresh_criminal_certificate();
DROP TRIGGER IF EXISTS certificate_custody_changed ON public.prison_terms;
CREATE TRIGGER certificate_custody_changed AFTER INSERT OR UPDATE OR DELETE ON public.prison_terms FOR EACH ROW EXECUTE FUNCTION private.refresh_criminal_certificate();
DROP TRIGGER IF EXISTS certificate_fine_changed ON public.police_fines;
CREATE TRIGGER certificate_fine_changed AFTER INSERT OR UPDATE OR DELETE ON public.police_fines FOR EACH ROW EXECUTE FUNCTION private.refresh_criminal_certificate();
REVOKE ALL ON FUNCTION private.refresh_criminal_certificate() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.canonical_official_role(p_role text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select case p_role when 'Delegado' then 'Diretor-Geral de Polícia' when 'Presidente da Câmara' then 'Presidente da Câmara dos Deputados' when 'Vice-Presidente do Senado' then 'Vice-Presidente do Senado Federal' when 'Diretor da Polícia Federal' then 'Diretor-Geral de Polícia' when 'Comandante das Forças Armadas' then 'Comandante-Geral das Forças Armadas' else p_role end;
$function$;

UPDATE public.profiles SET role='Diretor-Geral de Polícia',updated_at=clock_timestamp() WHERE role='Delegado' AND deleted_at IS NULL;
UPDATE public.system_settings s SET value=jsonb_set(s.value,'{roles}',(SELECT jsonb_agg(r ORDER BY (r->>'amount')::numeric DESC) FROM jsonb_array_elements(s.value->'roles')r WHERE r->>'role'<>'Delegado')),updated_at=clock_timestamp() WHERE s.key='official_salaries' AND EXISTS(SELECT 1 FROM jsonb_array_elements(s.value->'roles')r WHERE r->>'role'='Diretor-Geral de Polícia');
UPDATE public.system_settings s SET value=jsonb_set(s.value,'{roles}',(SELECT jsonb_agg(CASE WHEN r->>'role'='Delegado' THEN jsonb_set(r,'{role}','"Diretor-Geral de Polícia"') ELSE r END) FROM jsonb_array_elements(s.value->'roles')r)),updated_at=clock_timestamp() WHERE s.key='official_salaries' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s.value->'roles')r WHERE r->>'role'='Diretor-Geral de Polícia');

-- The reporter sees only the citizen RPC projection. Internal triage notes
-- remain police-only; anonymous reporters receive a private status event.
CREATE OR REPLACE FUNCTION private.notify_anonymous_occurrence_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner_id uuid;BEGIN
 IF new.status IS NOT DISTINCT FROM old.status OR NOT coalesce(new.anonymous,new.is_anonymous,false) THEN RETURN new;END IF;
 SELECT profile_id INTO owner_id FROM private.police_occurrence_reporters WHERE occurrence_id=new.id;
 IF owner_id IS NOT NULL THEN
  PERFORM public.justice_notify(owner_id,'justice_occurrence_updated','O boletim '||new.protocol_number||' teve sua situação atualizada.','/services/justice?view=citizen',jsonb_build_object('occurrence_id',new.id,'status',new.status));
 END IF;RETURN new;
END $$;
DROP TRIGGER IF EXISTS anonymous_occurrence_status_changed ON public.police_occurrences;
CREATE TRIGGER anonymous_occurrence_status_changed AFTER UPDATE OF status ON public.police_occurrences FOR EACH ROW EXECUTE FUNCTION private.notify_anonymous_occurrence_status();
REVOKE ALL ON FUNCTION private.notify_anonymous_occurrence_status() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
