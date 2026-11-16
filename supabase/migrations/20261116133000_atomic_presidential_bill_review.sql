-- Register a presidential sanction, promulgation or veto in one transaction.
-- Prior frontend used separate update_bill_status + upsert(system_settings) +
-- Diário Oficial writes. The upsert could fail at the protected appointments
-- field AFTER the project had already changed status.
--
-- This RPC preserves protected appointments exactly and makes the decision
-- status, audit, and official publication all-or-nothing.
BEGIN;

CREATE OR REPLACE FUNCTION public.review_presidential_bill(
 p_bill_id uuid,
 p_action text,
 p_reason text DEFAULT '',
 p_partial_scope text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $fn$
DECLARE
 v_actor uuid:=auth.uid();
 v_bill public.bills%rowtype;
 v_action text:=lower(btrim(coalesce(p_action,'')));
 v_result_status text;
 v_reason text:=btrim(coalesce(p_reason,''));
 v_scope text:=btrim(coalesce(p_partial_scope,''));
 v_settings jsonb;
 v_previous jsonb;
 v_actions jsonb;
 v_existing jsonb;
 v_record jsonb;
 v_recovered boolean:=false;
 v_is_pec boolean;
 v_type text;
 v_summary text;
 v_content text;
BEGIN
 IF v_actor IS NULL OR NOT public.economic_has_role(ARRAY['Admin','Presidente']) THEN
   RAISE EXCEPTION 'Somente a Presidência pode sancionar, promulgar ou vetar.'
     USING ERRCODE='42501';
 END IF;
 IF p_bill_id IS NULL THEN RAISE EXCEPTION 'Selecione o projeto legislativo.';END IF;
 IF v_action NOT IN ('sanction','promulgate','veto_total','veto_partial') THEN
   RAISE EXCEPTION 'Ação presidencial inválida.';
 END IF;
 IF length(v_reason)>5000 OR length(v_scope)>5000 THEN
   RAISE EXCEPTION 'Fundamentação ou escopo do veto excedem o limite de 5.000 caracteres.';
 END IF;
 IF v_action IN('veto_total','veto_partial') AND v_reason='' THEN
   RAISE EXCEPTION 'Informe a fundamentação obrigatória para o veto.';
 END IF;
 IF v_action='veto_partial' AND v_scope='' THEN
   RAISE EXCEPTION 'Informe os trechos atingidos pelo veto parcial.';
 END IF;

 SELECT * INTO v_bill FROM public.bills WHERE id=p_bill_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Projeto legislativo não encontrado.';END IF;
 v_is_pec:=upper(coalesce(v_bill.type,'')) LIKE '%PEC%';
 IF v_is_pec AND v_action<>'promulgate' THEN
   RAISE EXCEPTION 'Emenda constitucional aprovada exige promulgação, sem sanção ou veto.';
 END IF;
 IF NOT v_is_pec AND v_action='promulgate' THEN
   RAISE EXCEPTION 'Escolha sanção ou veto para projetos de lei.';
 END IF;
 v_result_status:=CASE v_action
  WHEN 'sanction' THEN 'Sancionado'
  WHEN 'promulgate' THEN 'Promulgado'
  WHEN 'veto_total' THEN 'Vetado integralmente'
  ELSE 'Vetado parcialmente' END;

 -- Lock before writing history, preserving concurrent institutional appointments.
 SELECT s.value INTO v_settings
 FROM public.system_settings s
 WHERE s.key='executive_governance'
 FOR UPDATE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Configuração institucional do Executivo indisponível.';
 END IF;
 IF jsonb_typeof(coalesce(v_settings->'billActions','[]'::jsonb))<>'array' THEN
   RAISE EXCEPTION 'Histórico presidencial inválido; solicite revisão administrativa.';
 END IF;

 SELECT item INTO v_existing
 FROM jsonb_array_elements(coalesce(v_settings->'billActions','[]'::jsonb)) AS item
 WHERE item->>'bill_id'=p_bill_id::text
   AND item->>'action'=v_action
 LIMIT 1;

 -- Repeated submits are idempotent.
 IF v_existing IS NOT NULL THEN
   IF v_bill.status=v_result_status THEN RETURN v_existing; END IF;
   RAISE EXCEPTION 'Este ato já foi registrado. Atualize o painel para ver a tramitação.';
 END IF;

 IF v_bill.status=v_result_status THEN
   -- Recovery path for the previously half-written veto decisions.
   -- Require a previous status change BY THE SAME current president.
   IF NOT EXISTS(
      SELECT 1 FROM public.bill_status_history h
      WHERE h.bill_id=p_bill_id AND h.status=v_result_status
        AND h.actor_id=v_actor
   ) THEN
     RAISE EXCEPTION 'O ato anterior não pode ser regularizado sem auditoria do responsável.'
       USING ERRCODE='42501';
   END IF;
   v_recovered:=true;
 ELSE
   -- Existing authoritative RPC still verifies parliamentary approval,
   -- current status, executive role and permitted constitutional transitions.
   PERFORM public.update_bill_status(p_bill_id,v_result_status);
 END IF;

 -- Vetoes must retain the actual explanation supplied by the president.
 -- Sanction/promulgation is already published by update_bill_status.
 IF v_action IN('veto_total','veto_partial') THEN
   v_type:='Veto Presidencial';
   v_summary:=v_reason;
   v_content:=CASE WHEN v_action='veto_partial'
     THEN 'Veto parcial aos dispositivos: '||v_scope||E'\nFundamentação: '||v_reason
     ELSE 'Veto integral. Fundamentação: '||v_reason END;
   IF NOT EXISTS(
      SELECT 1 FROM public.dou_entries d
      WHERE d.source_id=p_bill_id AND d.type=v_type
   ) THEN
     INSERT INTO public.dou_entries(
       title,summary,content,type,source_id,legal_metadata
     ) VALUES (
       CASE WHEN v_action='veto_total' THEN 'Veto total: ' ELSE 'Veto parcial: ' END
         ||v_bill.title,
       v_summary,v_content,v_type,p_bill_id,
       jsonb_build_object('action',v_action,'actor_id',v_actor,
         'partial_scope',v_scope,'recovered_from_incomplete_record',v_recovered)
     );
   END IF;
 END IF;

 v_record:=jsonb_build_object(
  'id',gen_random_uuid(),
  'bill_id',p_bill_id,
  'bill_title',v_bill.title,
  'action',v_action,
  'resulting_status',v_result_status,
  'actor_id',v_actor,
  'created_at',clock_timestamp(),
  'reason',v_reason,
  'partial_scope',v_scope,
  'recovered',v_recovered
 );

 SELECT coalesce(jsonb_agg(previous_item.value ORDER BY previous_item.position),'[]'::jsonb)
 INTO v_previous
 FROM (
   SELECT item.value,item.position
   FROM jsonb_array_elements(coalesce(v_settings->'billActions','[]'::jsonb))
      WITH ORDINALITY AS item(value,position)
   ORDER BY item.position LIMIT 29
 ) previous_item;

 v_actions:=jsonb_build_array(v_record)||coalesce(v_previous,'[]'::jsonb);
 UPDATE public.system_settings s
 SET value=jsonb_set(coalesce(v_settings,'{}'::jsonb),'{billActions}',v_actions,true),
     updated_at=clock_timestamp()
 WHERE s.key='executive_governance';

 RETURN v_record;
END
$fn$;

REVOKE ALL ON FUNCTION public.review_presidential_bill(uuid,text,text,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.review_presidential_bill(uuid,text,text,text)
 TO authenticated;

COMMIT;
