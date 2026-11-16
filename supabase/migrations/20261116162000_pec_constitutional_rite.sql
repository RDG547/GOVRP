-- Constitutional PEC rite from the effective GOVRP Constitution v2.0, Art. 24, 27 and 66.

-- PEC: 3/5 in each legislative house; automatic promulgation and gazette after approval.

-- Presidential review is limited to ordinary bills. Preserve other qualified majorities.

BEGIN;

CREATE OR REPLACE FUNCTION private.snapshot_voting_electorate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
   NEW.rule_snapshot:=NEW.rule_snapshot||jsonb_build_object('approval_basis','seats','numerator',3,'denominator',5,'label','Maioria qualificada (3/5)');
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
END $function$;


CREATE OR REPLACE FUNCTION private.finalize_bill_voting(p_voting_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.parliament_votings%rowtype; bill public.bills%rowtype; seats integer; voted integer; yes integer; no integer; approved boolean; other_house uuid; other_result record; next_status text; ordinary_voted integer; chair_voted boolean; required integer; full_house integer; deliberation integer;
begin
 select * into v from public.parliament_votings where id=p_voting_id for update;
 if not found or v.type<>'bill' then raise exception 'Votação legislativa não encontrada.'; end if;
 if v.status='closed' then return coalesce(v.result,'{}')||jsonb_build_object('finalized',true,'message','Votação já encerrada.'); end if;
 select * into bill from public.bills where id=v.related_id for update;
 if bill.type='IMPEACHMENT' then return private.finalize_impeachment(p_voting_id); end if;
 if lower(coalesce(bill.status,'')) in ('sancionado','promulgado','rejeitado','vetado','arquivado','sustado') then
  update public.parliament_votings set status='closed',tie_break_pending=false,result=jsonb_build_object('approved',approved,'yes',yes,'no',no,'seats',full_house,'required',required,'deliberation_required',deliberation,'present',voted) where id=v.id;
  return jsonb_build_object('finalized',true,'message','Votação encerrada; decisão institucional preservada.');
 end if;
 select cardinality(v.eligible_member_ids) into seats;
 full_house:=coalesce((v.rule_snapshot->>'house_members')::int,seats);
 deliberation:=coalesce((v.rule_snapshot->>'deliberation_required')::int,1);
 select count(*),count(*) filter(where vote='Aprovar'),count(*) filter(where vote='Rejeitar'),count(*) filter(where member_id=any(v.eligible_member_ids)),coalesce(bool_or(member_id=v.chair_member_id),false)
 into voted,yes,no,ordinary_voted,chair_voted from public.parliament_voting_votes where voting_id=v.id;
 if v.tie_break_pending and not chair_voted and clock_timestamp()<v.end_date then return jsonb_build_object('finalized',false,'tie_break_pending',true); end if;
 if not v.tie_break_pending and clock_timestamp()<v.end_date and (seats=0 or ordinary_voted<seats) then return jsonb_build_object('finalized',false); end if;
 if not v.tie_break_pending and yes=no and voted>=deliberation and coalesce((v.rule_snapshot->>'tie_break')::boolean,false)
 and exists(select 1 from public.parliament_members m where m.id=v.chair_member_id and m.id=public.get_active_parliament_member_id(m.user_id,m.house_id) and private.is_house_president(m.user_id,m.house_id)) then
  update public.parliament_votings set tie_break_pending=true,end_date=clock_timestamp()+make_interval(hours=>(v.rule_snapshot->>'tie_break_hours')::int) where id=v.id;
  insert into public.notifications(user_id,type,content,link,metadata) select user_id,'parliament_tie_break','A votação de '||bill.title||' aguarda seu voto de desempate.','/services/parliament/panel',jsonb_build_object('voting_id',v.id) from public.parliament_members where id=v.chair_member_id;
  return jsonb_build_object('finalized',false,'tie_break_pending',true);
 end if;
 required:=case when v.rule_snapshot->>'approval_basis'='seats' then
 case when v.rule_snapshot->>'numerator'='1' and v.rule_snapshot->>'denominator'='2' then floor(full_house/2.0)+1 else ceil(full_house*(v.rule_snapshot->>'numerator')::numeric/(v.rule_snapshot->>'denominator')::numeric) end else 1 end;
 approved:=voted>=deliberation AND case when v.rule_snapshot->>'approval_basis'='seats' then yes>=greatest(required,1) else yes>no and yes>0 end;
 next_status:=case when approved and bill.type='PDL' and (bill.suspends_decree_id is not null or bill.institutional_data ? 'overrides_veto_bill_id') then 'Promulgado' when approved then 'Aguardando sanção presidencial' else 'Rejeitado' end;
 if (bill.type IN('PEC','Proposta de Emenda Constitucional') or coalesce((bill.institutional_data->>'requires_bicameral')::boolean,false)) and approved then
  select pv.id,pv.status,pv.house_id,pv.result
  into other_result from public.parliament_votings pv left join public.parliament_voting_votes pvv on pvv.voting_id=pv.id
  where pv.related_id=bill.id and pv.type='bill' and pv.house_id<>v.house_id group by pv.id order by pv.created_at desc limit 1;
  if found and other_result.status='closed' then next_status:=case when coalesce((other_result.result->>'approved')::boolean,false) then CASE WHEN bill.type IN('PEC','Proposta de Emenda Constitucional') THEN 'Promulgado' WHEN bill.institutional_data ? 'overrides_veto_bill_id' THEN 'Promulgado' ELSE 'Aguardando sanção presidencial' END else 'Rejeitado' end;
  else
   next_status:='Em votação (2ª Casa)';
   if other_result.id is null then
    select id into other_house from public.parliament_houses where id<>v.house_id order by case when id in ('a1b2c3d4-e5f6-7890-1234-567890abcdef','fedcba09-8765-4321-0987-654321fedcba') then 0 else 1 end,id limit 1;
    if other_house is null then raise exception 'A proposta constitucional exige duas Casas legislativas.'; end if;
    insert into public.parliament_votings(house_id,type,related_id,title,description,status,end_date) values(other_house,'bill',bill.id,'[2ª Casa] '||bill.title,CASE WHEN bill.institutional_data->>'salary_role' IS NOT NULL THEN 'Reajuste salarial: deliberação da segunda Casa antes da sanção presidencial.' ELSE 'Deliberação constitucional na segunda Casa.' END,'active',clock_timestamp()+interval '24 hours');
   end if;
  end if;
 end if;
 update public.bills set status=next_status,updated_at=clock_timestamp() where id=bill.id;
 update public.parliament_votings set status='closed',tie_break_pending=false,result=jsonb_build_object('approved',approved,'yes',yes,'no',no,'seats',full_house,'required',required,'deliberation_required',deliberation,'present',voted) where id=v.id;
 insert into public.notifications(user_id,type,content,link,metadata)
 select m.user_id,'parliament_voting_result',
 case when vote.vote='Abster' then 'Votação encerrada: o projeto "'||bill.title||'", no qual você registrou abstenção, foi '
 when (vote.vote='Aprovar' and approved) or (vote.vote='Rejeitar' and not approved) then 'Boa notícia! O projeto "'||bill.title||'", em que você votou '||case vote.vote when 'Aprovar' then 'a favor' else 'contra' end||', foi '
 else 'Resultado da votação: o projeto "'||bill.title||'", em que você votou '||case vote.vote when 'Aprovar' then 'a favor' else 'contra' end||', foi ' end
 ||case when approved then 'aprovado' else 'rejeitado' end||' pela sua Casa Legislativa.',
 '/services/parliament',jsonb_build_object('voting_id',v.id,'bill_id',bill.id,'vote',vote.vote,'approved',approved,'tone',case when vote.vote='Abster' then 'neutral' when (vote.vote='Aprovar')=approved then 'positive' else 'institutional' end)
 from public.parliament_voting_votes vote join public.parliament_members m on m.id=vote.member_id where vote.voting_id=v.id
 and not exists(select 1 from public.notifications n where n.user_id=m.user_id and n.type='parliament_voting_result' and n.metadata->>'voting_id'=v.id::text);
 return jsonb_build_object('finalized',true,'approved',approved,'message','Votação encerrada. '||next_status||'.');
end $function$;


CREATE OR REPLACE FUNCTION public.review_presidential_bill(p_bill_id uuid, p_action text, p_reason text DEFAULT ''::text, p_partial_scope text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 IF v_action NOT IN ('sanction','veto_total','veto_partial') THEN
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
 v_is_pec:=upper(coalesce(v_bill.type,'')) LIKE '%PEC%' OR v_bill.type='Proposta de Emenda Constitucional';
 IF v_is_pec THEN
   RAISE EXCEPTION 'PECs são deliberadas pelo Congresso e não admitem sanção, veto ou promulgação presidencial.' USING ERRCODE='42501';
 END IF;
 v_result_status:=CASE v_action
  WHEN 'sanction' THEN 'Sancionado'
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
$function$;


CREATE OR REPLACE FUNCTION public.update_bill_status(p_bill_id uuid, p_new_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid:=auth.uid(); bill public.bills%rowtype; voting public.parliament_votings%rowtype; finalized jsonb; qualified boolean; houses integer;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING errcode='42501'; END IF;
 SELECT * INTO bill FROM public.bills WHERE id=p_bill_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'BILL_NOT_FOUND'; END IF;
 IF bill.type='IMPEACHMENT' THEN RAISE EXCEPTION 'O impeachment é decidido pela votação institucional da Câmara.'; END IF;
 IF bill.type='PDL' AND bill.suspends_decree_id IS NOT NULL THEN RAISE EXCEPTION 'A sustação é decidida pela votação legislativa, sem sanção presidencial.'; END IF;
 qualified:=bill.type IN('PEC','Proposta de Emenda Constitucional');
 IF p_new_status IN('Aguardando sanção presidencial','Aguardando promulgação presidencial','Rejeitado') THEN
  IF NOT(public.is_parliament_governance_manager(actor,bill.house_id) OR public.get_active_parliament_member_id(actor,bill.house_id) IS NOT NULL) THEN RAISE EXCEPTION 'PARLIAMENT_AUTHORITY_REQUIRED' USING errcode='42501'; END IF;
  SELECT * INTO voting FROM public.parliament_votings WHERE related_id=bill.id AND type='bill' ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'BILL_VOTING_NOT_FOUND'; END IF;
  finalized:=private.finalize_bill_voting(voting.id);
  IF NOT coalesce((finalized->>'finalized')::boolean,false) THEN RAISE EXCEPTION 'BILL_VOTING_NOT_READY'; END IF;
  SELECT * INTO bill FROM public.bills WHERE id=p_bill_id;
  IF bill.status IS DISTINCT FROM p_new_status THEN RAISE EXCEPTION 'O resultado da votação não permite esta transição. Consulte a tramitação atual.'; END IF;
  RETURN;
 ELSIF p_new_status IN('Sancionado','Promulgado','Vetado integralmente','Vetado parcialmente') THEN
  SELECT * INTO bill FROM public.bills WHERE id=p_bill_id FOR UPDATE;
  IF NOT public.economic_has_role(ARRAY['Admin','Presidente']) THEN RAISE EXCEPTION 'EXECUTIVE_AUTHORITY_REQUIRED' USING errcode='42501'; END IF;
  IF bill.status=p_new_status THEN RETURN; END IF;
  IF bill.status NOT IN('Aguardando sanção presidencial','Aguardando promulgação presidencial','Aprovado') THEN RAISE EXCEPTION 'BILL_NOT_AWAITING_EXECUTIVE_DECISION'; END IF;
  IF qualified THEN RAISE EXCEPTION 'PEC é deliberada e promulgada pelo Congresso, sem decisão presidencial.' USING ERRCODE='42501'; END IF;
  IF NOT qualified AND p_new_status='Promulgado' THEN RAISE EXCEPTION 'Escolha sanção ou veto para este projeto de lei.'; END IF;
  SELECT count(DISTINCT house_id) INTO houses FROM public.parliament_votings WHERE related_id=bill.id AND type='bill' AND status='closed' AND coalesce((result->>'approved')::boolean,false);
  IF houses<(CASE WHEN qualified OR coalesce((bill.institutional_data->>'requires_bicameral')::boolean,false) THEN 2 ELSE 1 END) THEN RAISE EXCEPTION 'A medida exige deliberação legislativa concluída e aprovada nas Casas competentes.'; END IF;
 ELSE RAISE EXCEPTION 'INVALID_BILL_STATUS'; END IF;
 UPDATE public.bills SET status=p_new_status,updated_at=clock_timestamp() WHERE id=bill.id;
 IF p_new_status IN('Sancionado','Promulgado') THEN
  INSERT INTO public.dou_entries(title,summary,content,published_at,type,source_id)
  SELECT bill.title,CASE WHEN p_new_status='Sancionado' THEN 'Lei sancionada pela Presidência da República.' ELSE 'Norma promulgada e publicada oficialmente.' END,coalesce(nullif(bill.full_text,''),bill.summary),clock_timestamp(),bill.type,bill.id
  WHERE NOT EXISTS(SELECT 1 FROM public.dou_entries WHERE source_id=bill.id);
 END IF;
END $function$;


-- Apply the Constitutional quorum to active PEC votings without rewriting settled results.
UPDATE public.parliament_votings v
SET rule_snapshot =
  jsonb_set(
    jsonb_set(
      jsonb_set(coalesce(v.rule_snapshot,'{}'::jsonb),'{numerator}','3'::jsonb,true),
      '{denominator}','5'::jsonb,true),
    '{label}',to_jsonb('Maioria qualificada (3/5)'::text),true)
WHERE v.status='active' AND v.type='bill'
  AND EXISTS (
    SELECT 1 FROM public.bills b
    WHERE b.id=v.related_id AND b.type IN('PEC','Proposta de Emenda Constitucional')
  );

COMMIT;