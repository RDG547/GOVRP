BEGIN;

-- Scheduling is an independent workflow. The existing parliamentary voting
-- engine still decides eligibility, quorum, tie-breaking, and legal results.
CREATE TABLE IF NOT EXISTS public.parliament_voting_schedules(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
  house_id uuid NOT NULL REFERENCES public.parliament_houses(id),
  scheduled_by uuid NOT NULL REFERENCES public.profiles(id),
  title text NOT NULL,
  description text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled'
     CHECK (status IN ('scheduled','started','expired','cancelled')),
  voting_id uuid REFERENCES public.parliament_votings(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (ends_at>starts_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_voting_schedule
  ON public.parliament_voting_schedules(bill_id,house_id)
  WHERE status='scheduled';
CREATE INDEX IF NOT EXISTS parliament_schedule_due
  ON public.parliament_voting_schedules(starts_at)
  WHERE status='scheduled';
ALTER TABLE public.parliament_voting_schedules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.parliament_voting_schedules FROM PUBLIC,anon,authenticated;
CREATE POLICY parliament_schedules_member_read ON public.parliament_voting_schedules
 FOR SELECT TO authenticated
 USING(public.has_full_admin_access() OR
       public.get_active_parliament_member_id(auth.uid(),house_id) IS NOT NULL);
GRANT SELECT ON public.parliament_voting_schedules TO authenticated;
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='parliament_voting_schedules') THEN
   ALTER PUBLICATION supabase_realtime ADD TABLE public.parliament_voting_schedules;
 END IF;
END$$;

CREATE OR REPLACE FUNCTION private.notify_parliament_schedule_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE verb text; notice_type text;
BEGIN
 IF tg_op='INSERT' THEN
    verb:='Votação agendada para '||to_char(NEW.starts_at AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')
      ||' (Brasília): '||NEW.title||'.';
    notice_type:='parliament_voting_scheduled';
 ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status='cancelled' THEN
    verb:='Agendamento cancelado: '||NEW.title||'.';
    notice_type:='parliament_voting_schedule_cancelled';
 ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status='expired' THEN
    verb:='Prazo encerrado sem abertura de votação: '||NEW.title||'.';
    notice_type:='parliament_voting_closed';
 ELSE RETURN NEW; END IF;
 INSERT INTO public.notifications(user_id,type,content,link,metadata)
 SELECT DISTINCT m.user_id,notice_type,verb,'/services/parliament/panel',
   jsonb_build_object('schedule_id',NEW.id,'bill_id',NEW.bill_id,'house_id',NEW.house_id,
      'starts_at',NEW.starts_at,'ends_at',NEW.ends_at)
 FROM public.parliament_members m
 WHERE m.house_id=NEW.house_id AND m.id=public.get_active_parliament_member_id(m.user_id,m.house_id);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS govrp_parliament_schedule_notices ON public.parliament_voting_schedules;
CREATE TRIGGER govrp_parliament_schedule_notices AFTER INSERT OR UPDATE OF status
 ON public.parliament_voting_schedules FOR EACH ROW
 EXECUTE FUNCTION private.notify_parliament_schedule_change();

CREATE OR REPLACE FUNCTION public.schedule_parliament_bill_voting(
 p_bill_id uuid,p_house_id uuid,p_starts_at timestamptz,p_ends_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_bill public.bills%rowtype; v public.parliament_voting_schedules%rowtype;
BEGIN
 IF auth.uid() IS NULL OR (NOT private.is_house_president(auth.uid(),p_house_id) AND NOT public.has_full_admin_access())
   THEN RAISE EXCEPTION 'Somente a Presidência da Casa pode agendar votações.' USING errcode='42501'; END IF;
 IF p_starts_at IS NULL OR p_ends_at IS NULL
    OR p_starts_at < clock_timestamp()+interval '1 minute'
    OR p_starts_at > clock_timestamp()+interval '30 days'
    OR p_ends_at <= p_starts_at+interval '4 minutes'
    OR p_ends_at > p_starts_at+interval '72 hours'
   THEN RAISE EXCEPTION 'Agende de 1 minuto a 30 dias antes; a votação deve durar entre 5 minutos e 72 horas.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('parliament:schedule:'||p_bill_id::text||':'||p_house_id::text));
 SELECT * INTO v_bill FROM public.bills WHERE id=p_bill_id FOR UPDATE;
 IF v_bill.id IS NULL THEN RAISE EXCEPTION 'Projeto não encontrado.'; END IF;
 IF v_bill.house_id<>p_house_id AND v_bill.type NOT IN ('PEC','Proposta de Emenda Constitucional')
   AND NOT coalesce((v_bill.institutional_data->>'requires_bicameral')::boolean,false)
   THEN RAISE EXCEPTION 'Este projeto não pertence à sua Casa.'; END IF;
 IF v_bill.status NOT IN ('Em tramitação','Em votação (2ª Casa)','Protocolado')
   OR (v_bill.status='Protocolado' AND v_bill.type<>'IMPEACHMENT') THEN
   RAISE EXCEPTION 'Este projeto não está disponível para agendamento.';
 END IF;
 IF EXISTS(SELECT 1 FROM public.parliament_votings p
 WHERE p.related_id=p_bill_id AND p.house_id=p_house_id AND p.status='active' AND p.type='bill')
 THEN RAISE EXCEPTION 'Já existe uma votação em andamento.'; END IF;
 IF EXISTS(SELECT 1 FROM public.parliament_voting_schedules s
 WHERE s.bill_id=p_bill_id AND s.house_id=p_house_id AND s.status='scheduled')
 THEN RAISE EXCEPTION 'Este projeto já possui uma votação agendada nesta Casa.'; END IF;
 INSERT INTO public.parliament_voting_schedules(bill_id,house_id,scheduled_by,title,description,starts_at,ends_at)
 VALUES(p_bill_id,p_house_id,auth.uid(),v_bill.title,v_bill.summary,p_starts_at,p_ends_at)
 RETURNING * INTO v;
 RETURN jsonb_build_object('success',true,'schedule_id',v.id,'starts_at',v.starts_at,'ends_at',v.ends_at);
END $$;
REVOKE ALL ON FUNCTION public.schedule_parliament_bill_voting(uuid,uuid,timestamptz,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.schedule_parliament_bill_voting(uuid,uuid,timestamptz,timestamptz) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.cancel_parliament_bill_schedule(p_schedule_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE s public.parliament_voting_schedules%rowtype;
BEGIN
 SELECT * INTO s FROM public.parliament_voting_schedules WHERE id=p_schedule_id FOR UPDATE;
 IF s.id IS NULL OR s.status<>'scheduled' THEN RAISE EXCEPTION 'Agendamento não está pendente.'; END IF;
 IF auth.uid() IS NULL OR (NOT private.is_house_president(auth.uid(),s.house_id) AND NOT public.has_full_admin_access())
 THEN RAISE EXCEPTION 'Somente a Presidência da Casa pode cancelar o agendamento.' USING errcode='42501'; END IF;
 UPDATE public.parliament_voting_schedules SET status='cancelled',changed_at=clock_timestamp() WHERE id=s.id;
 RETURN jsonb_build_object('success',true);
END $$;
REVOKE ALL ON FUNCTION public.cancel_parliament_bill_schedule(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cancel_parliament_bill_schedule(uuid) TO authenticated,service_role;

-- Reuse the existing snapshot-voting trigger for exact electorates. Scheduled
-- votes receive their configured deadline *before* the open notification fires.
CREATE OR REPLACE FUNCTION private.snapshot_voting_electorate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE b public.bills%rowtype; schedule_id text; deadline text;
BEGIN
 IF NEW.type<>'bill' THEN RETURN NEW; END IF;
 schedule_id:=nullif(current_setting('govrp.parliament_schedule_id',true),'');
 deadline:=nullif(current_setting('govrp.parliament_schedule_end',true),'');
 IF EXISTS(
  SELECT 1 FROM public.parliament_voting_schedules s
  WHERE s.bill_id=NEW.related_id AND s.house_id=NEW.house_id AND s.status='scheduled'
  AND (schedule_id IS NULL OR s.id::text<>schedule_id)
 ) THEN RAISE EXCEPTION 'Esta matéria já tem votação agendada. Aguarde a abertura automática.'; END IF;
 IF deadline IS NOT NULL AND schedule_id IS NOT NULL THEN NEW.end_date:=deadline::timestamptz; END IF;
 SELECT * INTO b FROM public.bills WHERE id=NEW.related_id;
 SELECT to_jsonb(r) INTO NEW.rule_snapshot FROM public.parliament_voting_rules r
 WHERE r.key=CASE WHEN b.type IN('PEC','Proposta de Emenda Constitucional') THEN 'qualified_majority'
              WHEN b.type IN('PL','Projeto de Lei') THEN 'simple_majority' ELSE b.voting_rule END;
 IF b.type IN('PL','Projeto de Lei') THEN
   NEW.rule_snapshot:=NEW.rule_snapshot||jsonb_build_object('approval_basis','cast','numerator',1,'denominator',2);
 ELSIF b.type IN('PEC','Proposta de Emenda Constitucional') THEN
   NEW.rule_snapshot:=NEW.rule_snapshot||jsonb_build_object('approval_basis','seats','numerator',2,'denominator',3);
 END IF;
 IF b.type='IMPEACHMENT' THEN
  NEW.rule_snapshot:=NEW.rule_snapshot||jsonb_build_object(
  'numerator',coalesce((b.institutional_data->'rule_snapshot'->>'impeachment_approval_numerator')::int,2),
  'denominator',coalesce((b.institutional_data->'rule_snapshot'->>'impeachment_approval_denominator')::int,3));
 END IF;
 SELECT m.id INTO NEW.chair_member_id FROM public.parliament_members m
 WHERE m.house_id=NEW.house_id
 AND m.id=public.get_active_parliament_member_id(m.user_id,m.house_id)
 AND private.is_house_president(m.user_id,m.house_id) ORDER BY m.id LIMIT 1;
 SELECT coalesce(array_agg(m.id),'{}'::uuid[]) INTO NEW.eligible_member_ids
 FROM public.parliament_members m WHERE m.house_id=NEW.house_id
 AND m.id=public.get_active_parliament_member_id(m.user_id,m.house_id)
 AND (coalesce((NEW.rule_snapshot->>'chair_votes_normally')::boolean,false)
      OR m.id IS DISTINCT FROM NEW.chair_member_id);
 SELECT NEW.rule_snapshot||jsonb_build_object('house_members',count(*),
   'deliberation_required',floor(
    (CASE WHEN NEW.rule_snapshot->>'deliberation_basis'='house' THEN count(*)
      ELSE cardinality(NEW.eligible_member_ids) END)
    *coalesce((NEW.rule_snapshot->>'deliberation_numerator')::numeric,1)
     /coalesce((NEW.rule_snapshot->>'deliberation_denominator')::numeric,2))+1
 ) INTO NEW.rule_snapshot FROM public.parliament_members m
 WHERE m.house_id=NEW.house_id AND m.id=public.get_active_parliament_member_id(m.user_id,m.house_id);
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION private.notify_parliament_voting_open()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE notice_type text;
BEGIN
 IF NEW.status='active' AND (tg_op='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
  INSERT INTO public.notifications(user_id,type,content,link,metadata)
  SELECT DISTINCT m.user_id,'parliament_voting_open',
   'Votação iniciada na '||coalesce((SELECT name FROM public.parliament_houses WHERE id=NEW.house_id),'Casa Legislativa')
   ||': '||NEW.title||'.',
   '/services/parliament/panel',
   jsonb_build_object('voting_id',NEW.id,'bill_id',NEW.related_id,'house_id',NEW.house_id,
     'starts_at',clock_timestamp(),'ends_at',NEW.end_date)
  FROM public.parliament_members m WHERE m.house_id=NEW.house_id
   AND m.id=public.get_active_parliament_member_id(m.user_id,m.house_id)
   AND NOT EXISTS(SELECT 1 FROM public.notifications n
     WHERE n.user_id=m.user_id AND n.type='parliament_voting_open'
     AND n.metadata->>'voting_id'=NEW.id::text);
 END IF;
 IF NEW.status='closed' AND tg_op='UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
  INSERT INTO public.notifications(user_id,type,content,link,metadata)
  SELECT DISTINCT m.user_id,'parliament_voting_closed',
   'Prazo de votação encerrado: '||NEW.title||'. Confira o resultado na sua Casa.',
   '/services/parliament/panel',
   jsonb_build_object('voting_id',NEW.id,'bill_id',NEW.related_id,'house_id',NEW.house_id,'ends_at',NEW.end_date)
  FROM public.parliament_members m WHERE m.house_id=NEW.house_id
   AND m.id=public.get_active_parliament_member_id(m.user_id,m.house_id)
   AND NOT EXISTS(SELECT 1 FROM public.notifications n
     WHERE n.user_id=m.user_id AND n.type='parliament_voting_closed'
      AND n.metadata->>'voting_id'=NEW.id::text);
 END IF;
 IF NEW.status='active' AND (tg_op='INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
   AND NEW.type='bill' AND EXISTS(SELECT 1 FROM public.bills WHERE id=NEW.related_id AND type='IMPEACHMENT') THEN
  INSERT INTO public.notifications(user_id,type,content,link,metadata)
  SELECT (institutional_data->>'president_id')::uuid,'impeachment_voting',
   'A Câmara iniciou a votação do pedido de impeachment: '||title||'.',
   '/services/parliament/panel',jsonb_build_object('bill_id',id,'voting_id',NEW.id,'ends_at',NEW.end_date)
  FROM public.bills WHERE id=NEW.related_id;
 END IF;
 RETURN NEW;
END $$;

-- Mark the modal without suppressing ordinary notifications in the bell.
CREATE OR REPLACE FUNCTION public.acknowledge_parliament_vote_popup(p_notification_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
 UPDATE public.notifications n
 SET metadata=coalesce(n.metadata,'{}'::jsonb)||
   jsonb_build_object('popup_seen_at',clock_timestamp())
 WHERE n.id=p_notification_id AND n.user_id=auth.uid()
   AND n.type='parliament_voting_open'
   AND NOT (coalesce(n.metadata,'{}'::jsonb) ? 'popup_seen_at');
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.acknowledge_parliament_vote_popup(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.acknowledge_parliament_vote_popup(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION private.activate_due_parliament_votes()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE s public.parliament_voting_schedules%rowtype; v public.parliament_votings%rowtype; old_actor text;
BEGIN
 old_actor:=current_setting('request.jwt.claim.sub',true);
 FOR s IN
   SELECT * FROM public.parliament_voting_schedules WHERE status='scheduled' AND starts_at<=clock_timestamp()
   ORDER BY starts_at,id FOR UPDATE SKIP LOCKED
 LOOP
  IF s.ends_at<=clock_timestamp() THEN
   UPDATE public.parliament_voting_schedules SET status='expired',changed_at=clock_timestamp() WHERE id=s.id;
   CONTINUE;
  END IF;
  BEGIN
   IF NOT (private.is_house_president(s.scheduled_by,s.house_id)
      OR public.is_admin(s.scheduled_by))
   THEN RAISE EXCEPTION 'Autoridade da Casa não está mais vigente.'; END IF;
   PERFORM set_config('request.jwt.claim.sub',s.scheduled_by::text,true);
   PERFORM set_config('govrp.parliament_schedule_id',s.id::text,true);
   PERFORM set_config('govrp.parliament_schedule_end',s.ends_at::text,true);
   v:=public.start_parliament_bill_voting(s.bill_id,s.house_id,s.title,s.description);
   UPDATE public.parliament_voting_schedules SET status='started',voting_id=v.id,
     changed_at=clock_timestamp() WHERE id=s.id;
  EXCEPTION WHEN OTHERS THEN
   RAISE WARNING 'Agendamento % não abriu: %',s.id,SQLERRM;
   UPDATE public.parliament_voting_schedules SET status='cancelled',
     changed_at=clock_timestamp() WHERE id=s.id;
  END;
  PERFORM set_config('request.jwt.claim.sub',coalesce(old_actor,''),true);
  PERFORM set_config('govrp.parliament_schedule_id','',true);
  PERFORM set_config('govrp.parliament_schedule_end','',true);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION private.activate_due_parliament_votes() FROM PUBLIC,anon,authenticated;
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='govrp-scheduled-parliament-votes') THEN
  PERFORM cron.schedule('govrp-scheduled-parliament-votes','10 seconds','select private.activate_due_parliament_votes()');
 END IF;
END $$;

-- A veto override is a legislative PDL, subject to both houses rather than a
-- direct unauthorized mutation of a presidential decision.
CREATE OR REPLACE FUNCTION public.propose_veto_override(
 p_vetoed_bill_id uuid,p_house_id uuid,p_reason text
) RETURNS public.bills LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE target public.bills%rowtype; proposal public.bills%rowtype;
BEGIN
 IF auth.uid() IS NULL OR (NOT private.is_house_president(auth.uid(),p_house_id)
   AND NOT public.has_full_admin_access()) THEN
   RAISE EXCEPTION 'A pauta de derrubada de veto é da Presidência da Casa.' USING errcode='42501';
 END IF;
 SELECT * INTO target FROM public.bills WHERE id=p_vetoed_bill_id
  AND status IN ('Vetado integralmente','Vetado parcialmente');
 IF target.id IS NULL THEN RAISE EXCEPTION 'Selecione um projeto com veto presidencial vigente.'; END IF;
 IF length(trim(coalesce(p_reason,'')))<40 THEN RAISE EXCEPTION 'Apresente fundamentação de pelo menos 40 caracteres.'; END IF;
 IF EXISTS(SELECT 1 FROM public.bills b WHERE b.institutional_data->>'overrides_veto_bill_id'=target.id::text
    AND b.status NOT IN ('Rejeitado','Arquivado')) THEN
   RAISE EXCEPTION 'Este veto já tem proposta de derrubada em tramitação.'; END IF;
 proposal:=public.propose_parliament_bill('Derrubada do veto: '||target.title,p_reason,
    'O Congresso delibera pela derrubada do veto ao projeto '||target.title||
    '. Fundamentação: '||p_reason,'PDL',p_house_id);
 UPDATE public.bills SET institutional_data=coalesce(institutional_data,'{}'::jsonb)||
   jsonb_build_object('overrides_veto_bill_id',target.id,'requires_bicameral',true),
   updated_at=clock_timestamp() WHERE id=proposal.id RETURNING * INTO proposal;
 RETURN proposal;
END $$;
REVOKE ALL ON FUNCTION public.propose_veto_override(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.propose_veto_override(uuid,uuid,text) TO authenticated,service_role;

-- The pre-existing finalizer already handles the second-house vote for
-- requires_bicameral bills. Once both houses approve, the PDL is promulgated
-- rather than sent back for the President to sanction his own veto override.
DO $guard$
DECLARE def text; old_text text; new_text text;
BEGIN
 SELECT pg_get_functiondef('private.finalize_bill_voting(uuid)'::regprocedure) INTO def;
 old_text:='case when approved and bill.type=''PDL'' and bill.suspends_decree_id is not null then ''Promulgado''';
 new_text:='case when approved and bill.type=''PDL'' and (bill.suspends_decree_id is not null or bill.institutional_data ? ''overrides_veto_bill_id'') then ''Promulgado''';
 IF strpos(def,old_text)=0 THEN RAISE EXCEPTION 'O fluxo legislativo de sustação foi alterado; revisar finalização.'; END IF;
 def:=replace(def,old_text,new_text);
 old_text:='ELSE ''Aguardando sanção presidencial'' END';
 new_text:='WHEN bill.institutional_data ? ''overrides_veto_bill_id'' THEN ''Promulgado'' ELSE ''Aguardando sanção presidencial'' END';
 IF strpos(def,old_text)=0 THEN RAISE EXCEPTION 'O fluxo bicameral foi alterado; revisar finalização.'; END IF;
 def:=replace(def,old_text,new_text);
 EXECUTE def;
END $guard$;

CREATE OR REPLACE FUNCTION private.apply_veto_override_after_vote()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE target_id uuid;
BEGIN
 IF NEW.status='Promulgado' AND NEW.status IS DISTINCT FROM OLD.status
   AND NEW.institutional_data ? 'overrides_veto_bill_id'
 THEN
  target_id:=(NEW.institutional_data->>'overrides_veto_bill_id')::uuid;
  UPDATE public.bills SET status='Promulgado',updated_at=clock_timestamp()
  WHERE id=target_id AND status IN ('Vetado integralmente','Vetado parcialmente');
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS apply_veto_override_after_vote ON public.bills;
CREATE TRIGGER apply_veto_override_after_vote AFTER UPDATE OF status ON public.bills
FOR EACH ROW EXECUTE FUNCTION private.apply_veto_override_after_vote();

-- Atomic budget save: reject overwritten revisions and impossible totals.
CREATE OR REPLACE FUNCTION public.save_presidential_budget(
 p_areas jsonb,p_expected_areas jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE setting public.system_settings%rowtype; allocated numeric; balance numeric;
BEGIN
 IF auth.uid() IS NULL OR (public.get_user_role(auth.uid())<>'Presidente'
   AND NOT public.has_full_admin_access()) THEN
   RAISE EXCEPTION 'Apenas a Presidência pode distribuir o orçamento.' USING errcode='42501';
 END IF;
 IF jsonb_typeof(p_areas)<>'array' OR jsonb_array_length(p_areas)<>11
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_areas) a
   WHERE jsonb_typeof(a->'allocated_value')<>'number' OR
     (a->>'allocated_value')::numeric<0 OR (a->>'allocated_value')::numeric<>trunc((a->>'allocated_value')::numeric)
     OR (a->>'name') NOT IN ('Saúde','Segurança','Defesa','Educação','Tecnologia','Meio Ambiente',
       'Infraestrutura','Cultura','Relações Exteriores','Economia','Pesquisa'))
  OR (SELECT count(DISTINCT a->>'name') FROM jsonb_array_elements(p_areas) a)<>11 THEN
  RAISE EXCEPTION 'A distribuição precisa conter as 11 áreas com valores inteiros não negativos.';
 END IF;
 SELECT * INTO setting FROM public.system_settings WHERE key='government_budget' FOR UPDATE;
 IF setting.key IS NULL THEN RAISE EXCEPTION 'Configuração orçamentária ausente.'; END IF;
 IF coalesce(setting.value->'areas','[]'::jsonb) IS DISTINCT FROM coalesce(p_expected_areas,'[]'::jsonb) THEN
  RAISE EXCEPTION 'O orçamento foi alterado em outra sessão. Atualize os valores antes de salvar.';
 END IF;
 SELECT coalesce(sum((a->>'allocated_value')::numeric),0) INTO allocated FROM jsonb_array_elements(p_areas) a;
 SELECT treasury_balance INTO balance FROM public.government_finances WHERE id=1 FOR UPDATE;
 IF allocated>coalesce(balance,0) THEN RAISE EXCEPTION 'Alocação excede o saldo atual do cofre.'; END IF;
 UPDATE public.system_settings SET value=jsonb_set(coalesce(value,'{}'::jsonb),'{areas}',p_areas,true)
 WHERE key='government_budget';
 RETURN jsonb_build_object('success',true,'areas',p_areas,'total',allocated,'available',balance-allocated);
END $$;
REVOKE ALL ON FUNCTION public.save_presidential_budget(jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_presidential_budget(jsonb,jsonb) TO authenticated,service_role;

COMMIT;