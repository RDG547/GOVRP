BEGIN;
-- Extend the existing case, decision, fine, appeal and treasury ledgers.
ALTER TABLE public.police_fines ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.police_fines
 ADD COLUMN target_type text NOT NULL DEFAULT 'citizen' CHECK(target_type IN('citizen','business','party')),
 ADD COLUMN target_business_id uuid REFERENCES public.businesses(id),
 ADD COLUMN target_party_id uuid REFERENCES public.political_parties(id),
 ADD COLUMN case_id uuid REFERENCES public.criminal_cases(id),
 ADD COLUMN decision_id uuid REFERENCES public.judicial_decisions(id),
 ADD COLUMN legal_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
 ADD COLUMN issuance_key uuid UNIQUE,
 ADD COLUMN refund_transaction_id uuid REFERENCES public.transactions(id),
 ADD CONSTRAINT fine_target_identity CHECK(
  (target_type='citizen' AND user_id IS NOT NULL AND target_business_id IS NULL AND target_party_id IS NULL) OR
  (target_type='business' AND user_id IS NULL AND target_business_id IS NOT NULL AND target_party_id IS NULL) OR
  (target_type='party' AND user_id IS NULL AND target_party_id IS NOT NULL AND target_business_id IS NULL));
CREATE INDEX fines_business_target ON public.police_fines(target_business_id,created_at DESC) WHERE target_business_id IS NOT NULL;
CREATE INDEX fines_party_target ON public.police_fines(target_party_id,created_at DESC) WHERE target_party_id IS NOT NULL;
ALTER TABLE public.judicial_decisions ADD COLUMN legal_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
 ADD COLUMN target_type text CHECK(target_type IN('citizen','business','party')), ADD COLUMN target_id uuid,
 ADD COLUMN sanction_kind text, ADD COLUMN sanction_until timestamptz, ADD COLUMN execution_status text,
 ADD COLUMN operation_key uuid UNIQUE;
ALTER TABLE public.case_parties ALTER COLUMN profile_id DROP NOT NULL;
ALTER TABLE public.case_parties ADD COLUMN business_id uuid REFERENCES public.businesses(id),
 ADD COLUMN political_party_id uuid REFERENCES public.political_parties(id),
 ADD CONSTRAINT case_party_identity CHECK(num_nonnulls(profile_id,business_id,political_party_id)=1);
CREATE UNIQUE INDEX case_business_party_unique ON public.case_parties(case_id,business_id) WHERE business_id IS NOT NULL;
CREATE UNIQUE INDEX case_political_party_unique ON public.case_parties(case_id,political_party_id) WHERE political_party_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.can_manage_fine_target(p_type text,p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND CASE p_type
 WHEN 'citizen' THEN p_id=auth.uid()
 WHEN 'business' THEN public.economic_has_role(ARRAY['Admin']) OR EXISTS(SELECT 1 FROM public.businesses WHERE id=p_id AND owner_id=auth.uid())
 WHEN 'party' THEN public.economic_has_role(ARRAY['Admin']) OR EXISTS(SELECT 1 FROM public.political_parties WHERE id=p_id AND auth.uid() IN(owner_id,president_id,vice_president_id))
 ELSE false END
$$;
REVOKE ALL ON FUNCTION public.can_manage_fine_target(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_manage_fine_target(text,uuid) TO authenticated;
DROP POLICY police_and_justice_manage_fines ON public.police_fines;
CREATE POLICY fine_authority_read ON public.police_fines FOR SELECT TO authenticated
 USING(public.justice_has_role(ARRAY['Admin','Policial','Police','Delegado','Juiz']));
CREATE POLICY fine_entity_manager_read ON public.police_fines FOR SELECT TO authenticated
 USING(public.can_manage_fine_target(target_type,coalesce(user_id,target_business_id,target_party_id)));
REVOKE INSERT,UPDATE,DELETE ON public.police_fines FROM authenticated,anon;

CREATE OR REPLACE FUNCTION public.generate_bill_for_fine()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF NEW.target_type<>'citizen' THEN RETURN NEW; END IF;
 NEW.bill_code:='FINE-'||replace(gen_random_uuid()::text,'-','');
 INSERT INTO public.bills_of_exchange(issuer_id,payer_id,bill_code,amount,due_date,status,description)
 VALUES(NULL,NEW.user_id,NEW.bill_code,NEW.amount,NEW.due_date,'pending','Multa: '||NEW.reason);
 RETURN NEW;
END $function$
;
CREATE OR REPLACE FUNCTION public.notify_on_new_fine() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE recipient uuid;
BEGIN
 FOR recipient IN
 SELECT NEW.user_id WHERE NEW.user_id IS NOT NULL
 UNION SELECT owner_id FROM public.businesses WHERE id=NEW.target_business_id AND owner_id IS NOT NULL
 UNION SELECT unnest(ARRAY[owner_id,president_id,vice_president_id]) FROM public.political_parties WHERE id=NEW.target_party_id
 LOOP
  IF recipient IS NOT NULL THEN
   INSERT INTO public.notifications(user_id,sender_id,type,content,link,metadata)
   VALUES(recipient,NEW.officer_id,'fine_issued','Nova multa '||NEW.fine_code||': '||public.format_currency_brl(NEW.amount)||'. Motivo: '||NEW.reason,
    CASE NEW.target_type WHEN 'business' THEN '/services/entrepreneur' WHEN 'party' THEN '/services/political-parties/'||NEW.target_party_id ELSE '/services/justice?view=citizen' END,
    jsonb_build_object('fine_id',NEW.id,'bill_code',NEW.bill_code,'case_id',NEW.case_id,'target_type',NEW.target_type,'target_id',coalesce(NEW.user_id,NEW.target_business_id,NEW.target_party_id)));
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.generate_bill_for_fine(),public.notify_on_new_fine() FROM PUBLIC,anon,authenticated;

ALTER TABLE public.business_transactions DROP CONSTRAINT business_transactions_type_check;
ALTER TABLE public.business_transactions ADD CONSTRAINT business_transactions_type_check CHECK(type IN('registration','monthly_cost','revenue','expense','tax','other','judicial_fine','judicial_refund'));
ALTER TABLE public.party_treasury_entries ALTER COLUMN donor_snapshot SET DEFAULT '{}'::jsonb;
ALTER TABLE public.party_treasury_entries DROP CONSTRAINT party_treasury_entries_kind_check, DROP CONSTRAINT party_treasury_entries_amount_check;
ALTER TABLE public.party_treasury_entries ADD CONSTRAINT party_treasury_entries_kind_check CHECK(kind IN('donation','judicial_fine','judicial_refund')),
 ADD CONSTRAINT party_treasury_entries_amount_check CHECK((kind='judicial_fine' AND amount<0) OR (kind IN('donation','judicial_refund') AND amount>0));

-- Published legal devices as of the actual date of conduct; never drafts or future acts.
CREATE OR REPLACE FUNCTION public.get_applicable_sanction_laws(p_facts_at timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.justice_has_role(ARRAY['Admin','Juiz','Promotor','Delegado','Corregedor','Policial','Police']) THEN RAISE EXCEPTION 'Você não possui acesso ao catálogo de sanções judiciais.' USING errcode='42501'; END IF;
 IF p_facts_at IS NULL OR p_facts_at>clock_timestamp() THEN RAISE EXCEPTION 'Informe uma data dos fatos válida.'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'rule_key',e.effect_key,'name',e.effect_data->>'name','definition',e.effect_data->'definition','value',e.effect_value,
 'valid_from',e.valid_from,'valid_until',e.ends_at,'source_kind',e.source_kind,'source_id',e.source_id,'title',coalesce(b.title,d.title),
 'text',coalesce(b.full_text,d.content),'number',coalesce((SELECT 'Diário Oficial nº '||publication_number FROM public.dou_entries WHERE source_id=e.source_id ORDER BY published_at DESC LIMIT 1),e.source_id::text),'version',e.activated_at) ORDER BY e.activated_at DESC)
 FROM (SELECT x.*,least(x.valid_until,(SELECT min(y.valid_from) FROM public.law_effects y WHERE y.effect_key=x.effect_key AND y.activated_at>x.activated_at AND y.activated_at IS NOT NULL AND (y.valid_until IS NULL OR y.valid_until>p_facts_at))) ends_at
 FROM public.law_effects x WHERE x.activated_at IS NOT NULL AND x.effect_data->>'kind'='sanction' AND x.effect_data->>'action'<>'revoke') e
 LEFT JOIN public.bills b ON e.source_kind='bill' AND b.id=e.source_id LEFT JOIN public.decrees d ON e.source_kind='decree' AND d.id=e.source_id
 WHERE e.valid_from<=p_facts_at AND (e.ends_at IS NULL OR e.ends_at>p_facts_at)), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.add_case_entity_party(p_case_id uuid,p_target_type text,p_target_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.criminal_cases%rowtype; result uuid;
BEGIN
 SELECT * INTO c FROM public.criminal_cases WHERE id=p_case_id FOR UPDATE;
 IF NOT FOUND OR NOT public.justice_has_role(ARRAY['Admin','Juiz','Promotor']) OR NOT coalesce(public.is_admin(auth.uid()) OR c.judge_id=auth.uid() OR c.prosecutor_id=auth.uid(),false) THEN RAISE EXCEPTION 'Você não pode vincular partes a este processo.' USING errcode='42501'; END IF;
 IF p_target_type='business' AND EXISTS(SELECT 1 FROM public.businesses WHERE id=p_target_id) THEN
  INSERT INTO public.case_parties(case_id,business_id,party_type) VALUES(c.id,p_target_id,'defendant') ON CONFLICT DO NOTHING RETURNING id INTO result;
  IF result IS NULL THEN SELECT id INTO result FROM public.case_parties WHERE case_id=c.id AND business_id=p_target_id; END IF;
 ELSIF p_target_type='party' AND EXISTS(SELECT 1 FROM public.political_parties WHERE id=p_target_id) THEN
  INSERT INTO public.case_parties(case_id,political_party_id,party_type) VALUES(c.id,p_target_id,'defendant') ON CONFLICT DO NOTHING RETURNING id INTO result;
  IF result IS NULL THEN SELECT id INTO result FROM public.case_parties WHERE case_id=c.id AND political_party_id=p_target_id; END IF;
 ELSIF p_target_type='citizen' AND EXISTS(SELECT 1 FROM public.profiles WHERE id=p_target_id AND deleted_at IS NULL) THEN
  SELECT id INTO result FROM public.case_parties WHERE case_id=c.id AND profile_id=p_target_id LIMIT 1;
  IF result IS NULL THEN INSERT INTO public.case_parties(case_id,profile_id,party_type) VALUES(c.id,p_target_id,'defendant') RETURNING id INTO result; END IF;
 ELSE RAISE EXCEPTION 'Selecione um cidadão, empresa ou partido existente.'; END IF;
 PERFORM public.justice_write_audit('case.entity_linked','criminal_case',c.id,NULL,jsonb_build_object('target_type',p_target_type,'target_id',p_target_id),'Parte institucional vinculada ao processo');
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION private.sanction_base(p_type text,p_id uuid,p_basis text)
RETURNS numeric LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE result numeric;
BEGIN
 IF p_basis='personal_balance' AND p_type='citizen' THEN SELECT balance INTO result FROM public.accounts WHERE user_id=p_id AND account_kind='personal';
 ELSIF p_basis='business_cash' AND p_type='business' THEN SELECT a.balance INTO result FROM public.businesses b JOIN public.accounts a ON a.id=b.bank_account_id WHERE b.id=p_id AND a.account_kind='business';
 ELSIF p_basis='business_revenue' AND p_type='business' THEN SELECT monthly_revenue INTO result FROM public.businesses WHERE id=p_id;
 ELSIF p_basis='party_treasury' AND p_type='party' THEN SELECT balance INTO result FROM public.party_treasuries WHERE party_id=p_id;
 ELSE RAISE EXCEPTION 'A base de cálculo não corresponde ao alvo desta sanção.'; END IF;
 RETURN greatest(coalesce(result,0),0);
END $$;
REVOKE ALL ON FUNCTION private.sanction_base(text,uuid,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.preview_judicial_sanction(p_case_id uuid,p_effect_id uuid,p_target_type text,p_target_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.criminal_cases%rowtype; law jsonb; definition jsonb; amount numeric; base numeric; recurrence int:=0;
BEGIN
 SELECT * INTO c FROM public.criminal_cases WHERE id=p_case_id;
 IF NOT FOUND OR NOT public.justice_has_role(ARRAY['Admin','Juiz']) OR NOT coalesce(public.is_admin(auth.uid()) OR c.judge_id=auth.uid(),false) THEN RAISE EXCEPTION 'Somente o juiz responsável pode aplicar sanções neste processo.' USING errcode='42501'; END IF;
 IF c.facts_occurred_at IS NULL THEN RAISE EXCEPTION 'Registre a data dos fatos no processo antes de escolher a norma aplicável.'; END IF;
 SELECT value INTO law FROM jsonb_array_elements(public.get_applicable_sanction_laws(c.facts_occurred_at)) WHERE value->>'id'=p_effect_id::text;
 IF law IS NULL THEN RAISE EXCEPTION 'Esta norma não estava vigente na data dos fatos.'; END IF;
 definition:=law->'definition';
 IF p_target_type NOT IN('citizen','business','party') OR (definition->>'audience'<>'all' AND definition->>'audience'<>p_target_type) THEN RAISE EXCEPTION 'A sanção não alcança este tipo de alvo.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.case_parties WHERE case_id=c.id AND (p_target_type='citizen' AND profile_id=p_target_id OR p_target_type='business' AND business_id=p_target_id OR p_target_type='party' AND political_party_id=p_target_id)) THEN RAISE EXCEPTION 'Vincule primeiro o alvo como parte deste processo.'; END IF;
 IF definition->>'sanction_kind' IN('fine_fixed','fine_percentage') THEN
  base:=CASE WHEN definition->>'sanction_kind'='fine_percentage' THEN private.sanction_base(p_target_type,p_target_id,definition->>'calculation_basis') ELSE NULL END;
  amount:=CASE WHEN base IS NULL THEN (law->>'value')::numeric ELSE round(base*(law->>'value')::numeric,2) END;
  IF definition ? 'recurrence_multiplier' THEN
   SELECT count(*) INTO recurrence FROM public.police_fines f JOIN public.judicial_decisions j ON j.id=f.decision_id
   WHERE f.legal_snapshot->'law'->>'rule_key'=law->>'rule_key' AND f.target_type=p_target_type AND coalesce(f.user_id,f.target_business_id,f.target_party_id)=p_target_id
    AND j.is_final AND f.status NOT IN('Cancelada','Em Recurso') AND j.case_id<>c.id AND j.issued_at<c.facts_occurred_at;
   IF recurrence>0 THEN amount:=amount*(definition->>'recurrence_multiplier')::numeric; END IF;
  END IF;
  amount:=round(greatest(coalesce((definition->>'minimum')::numeric,0),least(amount,coalesce((definition->>'maximum')::numeric,amount))),2);
  IF amount<=0 THEN RAISE EXCEPTION 'A base de cálculo não produz multa positiva. Confira a norma e a situação financeira.'; END IF;
 END IF;
 RETURN jsonb_build_object('law',law,'facts_at',c.facts_occurred_at,'target_type',p_target_type,'target_id',p_target_id,'base_amount',base,'amount',amount,'recurrence_count',recurrence,'calculated_at',clock_timestamp(),'target_snapshot',CASE p_target_type
 WHEN 'citizen' THEN (SELECT jsonb_build_object('id',id,'name',full_name,'username',username,'avatar_url',avatar_url) FROM public.profiles WHERE id=p_target_id)
 WHEN 'business' THEN (SELECT jsonb_build_object('id',b.id,'name',b.name,'business_type_id',b.business_type_id,'owner_id',b.owner_id,'owner_name',p.full_name,'cnpj',d.document_number) FROM public.businesses b LEFT JOIN public.profiles p ON p.id=b.owner_id LEFT JOIN public.documents d ON d.id=b.cnpj_document_id WHERE b.id=p_target_id)
 ELSE (SELECT jsonb_build_object('id',id,'name',name,'acronym',acronym,'logo_url',logo_url,'ideology',ideology,'orientation',orientation::text) FROM public.political_parties WHERE id=p_target_id) END);
END $$;

CREATE OR REPLACE FUNCTION public.apply_judicial_sanction(p_case_id uuid,p_effect_id uuid,p_target_type text,p_target_id uuid,p_reason text,p_due_date timestamptz,p_operation_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE snapshot jsonb; definition jsonb; decision public.judicial_decisions%rowtype; fine public.police_fines%rowtype; expires timestamptz; previous_status text;
BEGIN
 IF auth.uid() IS NULL OR p_operation_key IS NULL THEN RAISE EXCEPTION 'Entre na sua conta e identifique a decisão.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('judicial-sanction:'||p_operation_key,0));
 SELECT * INTO decision FROM public.judicial_decisions WHERE operation_key=p_operation_key;
 IF FOUND THEN
  IF decision.judge_id IS DISTINCT FROM auth.uid() OR decision.case_id IS DISTINCT FROM p_case_id OR decision.target_id IS DISTINCT FROM p_target_id OR decision.target_type IS DISTINCT FROM p_target_type OR decision.legal_snapshot->'law'->>'id' IS DISTINCT FROM p_effect_id::text OR decision.legal_reasoning IS DISTINCT FROM trim(p_reason) OR decision.legal_snapshot->>'due_at' IS DISTINCT FROM p_due_date::text THEN RAISE EXCEPTION 'Esta identificação pertence a outra decisão.'; END IF;
  SELECT * INTO fine FROM public.police_fines WHERE decision_id=decision.id;
  RETURN jsonb_build_object('success',true,'decision',to_jsonb(decision),'fine',to_jsonb(fine));
 END IF;
 PERFORM 1 FROM public.criminal_cases WHERE id=p_case_id FOR UPDATE;
 IF length(trim(coalesce(p_reason,'')))<30 THEN RAISE EXCEPTION 'Fundamente a responsabilidade e a aplicação da sanção em pelo menos 30 caracteres.'; END IF;
 snapshot:=public.preview_judicial_sanction(p_case_id,p_effect_id,p_target_type,p_target_id)||jsonb_build_object('due_at',p_due_date::text,'appeal_until',clock_timestamp()+interval '7 days'); definition:=snapshot->'law'->'definition';
 IF p_due_date IS NULL OR p_due_date<=clock_timestamp() THEN RAISE EXCEPTION 'Informe um prazo futuro para cumprimento ou pagamento.'; END IF;
 IF definition->>'sanction_kind'='regularization' THEN expires:=p_due_date; END IF;
 IF definition->>'sanction_kind'='business_suspension' THEN
  SELECT status INTO previous_status FROM public.businesses WHERE id=p_target_id FOR UPDATE;
  IF previous_status='suspended' THEN SELECT coalesce(j.legal_snapshot->>'previous_business_status','suspended') INTO previous_status FROM public.judicial_decisions j WHERE j.target_type='business' AND j.target_id=p_target_id AND j.sanction_kind='business_suspension' AND j.execution_status='active' ORDER BY j.issued_at LIMIT 1; previous_status:=coalesce(previous_status,'suspended'); END IF;
  expires:=clock_timestamp()+make_interval(days=>(definition->>'duration_days')::int);
  snapshot:=snapshot||jsonb_build_object('previous_business_status',previous_status);
  UPDATE public.businesses SET status='suspended',updated_at=clock_timestamp() WHERE id=p_target_id;
 END IF;
 INSERT INTO public.judicial_decisions(case_id,judge_id,decision_type,summary,legal_reasoning,result,legal_snapshot,target_type,target_id,sanction_kind,sanction_until,execution_status,operation_key)
 VALUES(p_case_id,auth.uid(),'legal_sanction',snapshot->'law'->>'name',trim(p_reason),'Sanção aplicada após análise judicial da responsabilidade.',snapshot,p_target_type,p_target_id,definition->>'sanction_kind',expires,CASE WHEN definition->>'sanction_kind'='regularization' THEN 'awaiting_compliance' ELSE 'active' END,p_operation_key) RETURNING * INTO decision;
 IF definition->>'sanction_kind' IN('fine_fixed','fine_percentage') THEN
  INSERT INTO public.police_fines(user_id,target_type,target_business_id,target_party_id,officer_id,reason,amount,status,due_date,fine_code,case_id,decision_id,legal_snapshot,issuance_key,issuer_snapshot)
  VALUES(CASE WHEN p_target_type='citizen' THEN p_target_id END,p_target_type,CASE WHEN p_target_type='business' THEN p_target_id END,CASE WHEN p_target_type='party' THEN p_target_id END,auth.uid(),trim(p_reason),(snapshot->>'amount')::numeric,'Pendente',p_due_date,'',p_case_id,decision.id,snapshot,p_operation_key,jsonb_build_object('id',auth.uid(),'role',public.get_user_role(auth.uid()))) RETURNING * INTO fine;
 END IF;
 PERFORM public.justice_write_audit('sanction.applied','judicial_decision',decision.id,NULL,to_jsonb(decision),trim(p_reason));
 INSERT INTO public.notifications(user_id,type,content,link,metadata)
 SELECT DISTINCT recipient,'judicial_sanction','Uma decisão judicial atualizou a situação de '||coalesce(snapshot->'law'->>'name','uma parte do processo')||'.','/services/justice?view=citizen',jsonb_build_object('case_id',p_case_id,'decision_id',decision.id,'target_type',p_target_type,'target_id',p_target_id)
 FROM (SELECT p_target_id recipient WHERE p_target_type='citizen' UNION SELECT owner_id FROM public.businesses WHERE p_target_type='business' AND id=p_target_id UNION SELECT unnest(ARRAY[owner_id,president_id,vice_president_id]) FROM public.political_parties WHERE p_target_type='party' AND id=p_target_id) recipients WHERE recipient IS NOT NULL;
 RETURN jsonb_build_object('success',true,'decision',to_jsonb(decision),'fine',to_jsonb(fine));
END $$;

-- Same fine payment endpoint, with a payer selected from the fine's immutable identity.
CREATE OR REPLACE FUNCTION public.pay_fine(p_fine_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE fine public.police_fines%rowtype; account public.accounts%rowtype; days_overdue int:=0; interest numeric; total numeric; tx uuid; balance_after numeric; receipt jsonb;
BEGIN
 SELECT * INTO fine FROM public.police_fines WHERE id=p_fine_id FOR UPDATE;
 IF fine.target_type='business' THEN PERFORM 1 FROM public.businesses WHERE id=fine.target_business_id FOR UPDATE; ELSIF fine.target_type='party' THEN PERFORM 1 FROM public.political_parties WHERE id=fine.target_party_id FOR UPDATE; END IF;
 IF fine.id IS NULL OR NOT public.can_manage_fine_target(fine.target_type,coalesce(fine.user_id,fine.target_business_id,fine.target_party_id)) THEN RETURN json_build_object('success',false,'message','Multa não encontrada ou sem autorização para este alvo.'); END IF;
 IF fine.status='Paga' THEN RETURN json_build_object('success',true,'message','Esta multa já foi paga.','receipt',fine.payment_snapshot); END IF;
 IF fine.status NOT IN('Pendente','Vencida') THEN RETURN json_build_object('success',false,'message','Esta multa não está disponível para pagamento.'); END IF;
 days_overdue:=greatest(0,floor(extract(epoch FROM(clock_timestamp()-fine.due_date))/86400)::int);
 interest:=round(fine.amount*coalesce((fine.legal_snapshot->'law'->'definition'->>'late_interest_rate')::numeric,CASE WHEN fine.legal_snapshot='{}' THEN 0.0033 ELSE 0 END)*days_overdue,2); total:=round(fine.amount+interest,2);
 IF fine.target_type='citizen' THEN SELECT * INTO account FROM public.accounts WHERE user_id=fine.user_id AND account_kind='personal' FOR UPDATE;
 ELSIF fine.target_type='business' THEN SELECT a.* INTO account FROM public.accounts a JOIN public.businesses b ON b.bank_account_id=a.id WHERE b.id=fine.target_business_id AND a.account_kind='business' FOR UPDATE OF a;
 ELSE
  SELECT balance INTO balance_after FROM public.party_treasuries WHERE party_id=fine.target_party_id FOR UPDATE;
  IF balance_after IS NULL OR balance_after<total THEN RETURN json_build_object('success',false,'message','Saldo insuficiente no caixa do partido.'); END IF;
 END IF;
 IF fine.target_type<>'party' AND (account.id IS NULL OR account.balance<total) THEN RETURN json_build_object('success',false,'message','Saldo insuficiente na conta do responsável pela multa.'); END IF;
 IF fine.target_type='party' THEN UPDATE public.party_treasuries SET balance=balance-total,updated_at=clock_timestamp() WHERE party_id=fine.target_party_id RETURNING balance INTO balance_after;
 ELSE UPDATE public.accounts SET balance=balance-total,updated_at=clock_timestamp() WHERE id=account.id RETURNING balance INTO balance_after; END IF;
 UPDATE public.government_finances SET treasury_balance=treasury_balance+total,updated_at=clock_timestamp() WHERE id=1;
 receipt:=jsonb_build_object('fineId',fine.id,'fineCode',fine.fine_code,'baseAmount',fine.amount,'interestAmount',interest,'totalAmount',total,'targetType',fine.target_type,'targetId',coalesce(fine.user_id,fine.target_business_id,fine.target_party_id),'payerAccountId',account.id,'paidAt',clock_timestamp(),'legal_snapshot',fine.legal_snapshot);
 INSERT INTO public.transactions(from_account_id,amount,description,type,metadata) VALUES(account.id,total,'Pagamento da multa '||fine.fine_code,'fine_payment',receipt) RETURNING id INTO tx;
 receipt:=receipt||jsonb_build_object('transactionId',tx);
 IF fine.target_type='party' THEN INSERT INTO public.party_treasury_entries(party_id,transaction_id,actor_id,kind,amount,balance_after,description,donor_snapshot,idempotency_key) VALUES(fine.target_party_id,tx,auth.uid(),'judicial_fine',-total,balance_after,'Pagamento da multa '||fine.fine_code,jsonb_build_object('full_name','Tesouro Nacional'),md5('party-fine:'||fine.id)::uuid);
 ELSIF fine.target_type='business' THEN INSERT INTO public.business_transactions(business_id,amount,type,description,metadata,operation_key) VALUES(fine.target_business_id,-total,'judicial_fine','Pagamento da multa '||fine.fine_code,receipt,'fine:'||fine.id); END IF;
 UPDATE public.police_fines SET status='Paga',paid_at=clock_timestamp(),payment_transaction_id=tx,payment_snapshot=receipt,updated_at=clock_timestamp() WHERE id=fine.id;
 UPDATE public.bills_of_exchange SET status='paid',updated_at=clock_timestamp() WHERE bill_code=fine.bill_code AND payer_id=fine.user_id;
 PERFORM public.justice_write_audit('fine.paid','police_fine',fine.id,to_jsonb(fine),receipt,'Pagamento da multa pelo caixa do alvo responsável');
 RETURN json_build_object('success',true,'message','Multa paga com sucesso.','receipt',receipt);
END $$;

CREATE OR REPLACE FUNCTION public.appeal_fine(p_fine_id uuid,p_reason text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE fine public.police_fines%rowtype; appeal public.fine_appeals%rowtype;
BEGIN
 IF length(trim(coalesce(p_reason,'')))<20 THEN RETURN json_build_object('success',false,'message','Explique o recurso em pelo menos 20 caracteres.'); END IF;
 SELECT * INTO fine FROM public.police_fines WHERE id=p_fine_id FOR UPDATE;
 IF fine.target_type='business' THEN PERFORM 1 FROM public.businesses WHERE id=fine.target_business_id FOR UPDATE; ELSIF fine.target_type='party' THEN PERFORM 1 FROM public.political_parties WHERE id=fine.target_party_id FOR UPDATE; END IF;
 IF fine.id IS NULL OR NOT public.can_manage_fine_target(fine.target_type,coalesce(fine.user_id,fine.target_business_id,fine.target_party_id)) OR fine.status NOT IN('Pendente','Vencida','Paga') THEN RETURN json_build_object('success',false,'message','Esta multa não pode ser contestada por você.'); END IF;
 INSERT INTO public.fine_appeals(fine_id,appellant_id,reason) VALUES(fine.id,auth.uid(),trim(p_reason)) RETURNING * INTO appeal;
 UPDATE public.police_fines SET status='Em Recurso',updated_at=clock_timestamp() WHERE id=fine.id;
 PERFORM public.justice_write_audit('fine.appealed','police_fine',fine.id,to_jsonb(fine),to_jsonb(appeal),'Recurso com cobrança suspensa até julgamento');
 RETURN json_build_object('success',true,'message','Recurso enviado. A cobrança está suspensa até a decisão.','appeal',to_jsonb(appeal));
EXCEPTION WHEN unique_violation THEN RETURN json_build_object('success',false,'message','Já existe recurso para esta multa.');
END $$;

CREATE OR REPLACE FUNCTION public.decide_fine_appeal(p_appeal_id uuid,p_approved boolean,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE appeal public.fine_appeals%rowtype; fine public.police_fines%rowtype; total numeric; tx uuid; balance_after numeric; account_id uuid;
BEGIN
 IF NOT public.justice_has_role(ARRAY['Admin','Corregedor','Juiz','Delegado']) THEN RAISE EXCEPTION 'Sem competência para julgar o recurso.'; END IF;
 IF length(trim(coalesce(p_reason,'')))<15 THEN RAISE EXCEPTION 'Fundamente a decisão.'; END IF;
 SELECT * INTO appeal FROM public.fine_appeals WHERE id=p_appeal_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Recurso não encontrado.'; END IF;
 IF appeal.status NOT IN('pending','under_review') THEN RETURN jsonb_build_object('success',true,'message','Este recurso já foi julgado.'); END IF;
 SELECT * INTO fine FROM public.police_fines WHERE id=appeal.fine_id FOR UPDATE;
 IF fine.decision_id IS NOT NULL AND NOT public.justice_has_role(ARRAY['Admin','Juiz']) THEN RAISE EXCEPTION 'Recurso de decisão judicial exige autoridade judicial.'; END IF;
 IF fine.officer_id=auth.uid() AND NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'A autoridade que aplicou a multa não pode julgar seu próprio recurso.'; END IF;
 IF p_approved AND fine.paid_at IS NOT NULL AND fine.refund_transaction_id IS NULL THEN
  total:=(fine.payment_snapshot->>'totalAmount')::numeric; account_id:=(fine.payment_snapshot->>'payerAccountId')::uuid;
  IF account_id IS NULL AND fine.target_type='citizen' THEN SELECT id INTO account_id FROM public.accounts WHERE user_id=fine.user_id AND account_kind='personal'; END IF;
  IF total IS NULL OR total<=0 THEN RAISE EXCEPTION 'O comprovante original precisa ser conferido antes da restituição.'; END IF;
  IF fine.target_type='business' THEN PERFORM 1 FROM public.businesses WHERE id=fine.target_business_id FOR UPDATE; ELSIF fine.target_type='party' THEN PERFORM 1 FROM public.political_parties WHERE id=fine.target_party_id FOR UPDATE; END IF;
  IF fine.target_type='party' THEN PERFORM 1 FROM public.party_treasuries WHERE party_id=fine.target_party_id FOR UPDATE; ELSE PERFORM 1 FROM public.accounts WHERE id=account_id FOR UPDATE; END IF;
  PERFORM 1 FROM public.government_finances WHERE id=1 FOR UPDATE;
  IF (SELECT treasury_balance FROM public.government_finances WHERE id=1)<total THEN RAISE EXCEPTION 'O Tesouro não possui saldo disponível para restituir esta multa.'; END IF;
  IF fine.target_type='party' THEN UPDATE public.party_treasuries SET balance=balance+total,updated_at=clock_timestamp() WHERE party_id=fine.target_party_id RETURNING balance INTO balance_after;
  ELSE
   IF account_id IS NULL THEN RAISE EXCEPTION 'A conta de origem do pagamento não foi localizada.'; END IF;
   UPDATE public.accounts SET balance=balance+total,updated_at=clock_timestamp() WHERE id=account_id RETURNING balance INTO balance_after;
   IF NOT FOUND THEN RAISE EXCEPTION 'A conta de origem do pagamento não foi localizada.'; END IF;
  END IF;
  UPDATE public.government_finances SET treasury_balance=treasury_balance-total,updated_at=clock_timestamp() WHERE id=1;
  INSERT INTO public.transactions(to_account_id,amount,description,type,metadata) VALUES(account_id,total,'Restituição da multa '||fine.fine_code,'fine_refund',jsonb_build_object('fineId',fine.id,'originalTransactionId',fine.payment_transaction_id,'appealId',appeal.id,'targetType',fine.target_type,'targetId',coalesce(fine.user_id,fine.target_business_id,fine.target_party_id))) RETURNING id INTO tx;
  IF fine.target_type='party' THEN INSERT INTO public.party_treasury_entries(party_id,transaction_id,actor_id,kind,amount,balance_after,description,donor_snapshot,idempotency_key) VALUES(fine.target_party_id,tx,auth.uid(),'judicial_refund',total,balance_after,'Restituição da multa '||fine.fine_code,jsonb_build_object('full_name','Tesouro Nacional'),md5('party-refund:'||fine.id)::uuid);
  ELSIF fine.target_type='business' THEN INSERT INTO public.business_transactions(business_id,amount,type,description,operation_key,metadata) VALUES(fine.target_business_id,total,'judicial_refund','Restituição da multa '||fine.fine_code,'fine-refund:'||fine.id,jsonb_build_object('transactionId',tx,'appealId',appeal.id)); END IF;
 END IF;
 UPDATE public.fine_appeals SET status=CASE WHEN p_approved THEN 'approved' ELSE 'rejected' END,reviewed_by=auth.uid(),decision_reason=trim(p_reason),reviewed_at=clock_timestamp() WHERE id=appeal.id;
 UPDATE public.police_fines SET status=CASE WHEN p_approved THEN 'Cancelada' WHEN paid_at IS NOT NULL THEN 'Paga' WHEN due_date<clock_timestamp() THEN 'Vencida' ELSE 'Pendente' END,refund_transaction_id=coalesce(tx,refund_transaction_id),updated_at=clock_timestamp() WHERE id=fine.id;
 IF p_approved THEN
  UPDATE public.bills_of_exchange SET status='cancelled',updated_at=clock_timestamp() WHERE bill_code=fine.bill_code AND payer_id=fine.user_id AND status<>'paid';
  UPDATE public.judicial_decisions SET execution_status='reversed' WHERE id=fine.decision_id;
 END IF;
 PERFORM public.justice_notify(appeal.appellant_id,'fine_appeal_decided','O recurso da multa '||fine.fine_code||' foi '||CASE WHEN p_approved THEN 'deferido.' ELSE 'indeferido.' END,'/services/justice?view=citizen',jsonb_build_object('appeal_id',appeal.id,'fine_id',fine.id,'refund_transaction_id',tx));
 PERFORM public.justice_write_audit('fine.appeal_decided','fine_appeal',appeal.id,to_jsonb(appeal),jsonb_build_object('approved',p_approved,'refund_transaction_id',tx,'reason',trim(p_reason)),trim(p_reason));
 RETURN jsonb_build_object('success',true,'refund_transaction_id',tx);
END $$;

CREATE OR REPLACE FUNCTION public.issue_fine_idempotent(p_user_id uuid,p_reason text,p_amount numeric,p_due_date timestamptz,p_key uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result json; fine public.police_fines%rowtype;
BEGIN
 IF NOT public.justice_has_role(ARRAY['Admin','Policial','Police','Delegado','Juiz']) OR p_key IS NULL THEN RAISE EXCEPTION 'Sem autorização para emitir multas.' USING errcode='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('issue-fine:'||p_key,0));
 SELECT * INTO fine FROM public.police_fines WHERE issuance_key=p_key;
 IF FOUND THEN
  IF fine.officer_id IS DISTINCT FROM auth.uid() OR fine.user_id IS DISTINCT FROM p_user_id OR fine.amount IS DISTINCT FROM p_amount OR fine.reason IS DISTINCT FROM trim(p_reason) OR fine.due_date IS DISTINCT FROM p_due_date THEN RAISE EXCEPTION 'Identificação de emissão já utilizada.'; END IF;
  RETURN json_build_object('success',true,'fine',to_jsonb(fine),'message','Multa já registrada.');
 END IF;
 result:=public.issue_fine(p_user_id,p_reason,p_amount,p_due_date);
 IF (result->>'success')::boolean THEN UPDATE public.police_fines SET issuance_key=p_key WHERE id=(result->'fine'->>'id')::uuid; END IF;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.issue_fine(p_user_id uuid, p_reason text, p_amount numeric, p_due_date timestamp with time zone)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); fine public.police_fines%rowtype; actor_name text;
begin
  if not public.justice_has_role(array['Admin','Policial','Police','Delegado','Juiz']) then
    return json_build_object('success',false,'message','Acesso não autorizado para emitir multas.');
  end if;
  if p_amount is null or p_amount<=0 or p_amount::text in('NaN','Infinity','-Infinity') then return json_build_object('success',false,'message','O valor da multa deve ser positivo.'); end if;
  if p_due_date is null or p_due_date<=now() then return json_build_object('success',false,'message','Escolha um vencimento futuro.'); end if;
  if nullif(trim(p_reason),'') is null then return json_build_object('success',false,'message','Informe o motivo da multa.'); end if;
  if not exists(select 1 from public.profiles where id=p_user_id) then return json_build_object('success',false,'message','Cidadão não encontrado.'); end if;
  select full_name into actor_name from public.profiles where id=actor;
  insert into public.police_fines(user_id,officer_id,reason,amount,status,due_date,fine_code,issuer_snapshot)
  values(p_user_id,actor,trim(p_reason),round(p_amount,2),'Pendente',p_due_date,'',jsonb_build_object('id',actor,'name',actor_name,'role',public.get_user_role(actor)))
  returning * into fine;
  perform public.justice_write_audit('fine.issued','police_fine',fine.id,null,to_jsonb(fine),'Multa emitida');
  return json_build_object('success',true,'message','Multa emitida com sucesso.','fine',to_jsonb(fine),'fine_code',fine.fine_code);
end; $function$
;

CREATE OR REPLACE FUNCTION private.expire_judicial_sanctions() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE decision public.judicial_decisions%rowtype;
BEGIN
 UPDATE public.judicial_decisions j SET is_final=true WHERE j.sanction_kind IS NOT NULL AND NOT j.is_final AND j.issued_at+interval '7 days'<=clock_timestamp() AND j.execution_status NOT IN('reversed','suspended_on_appeal') AND NOT EXISTS(SELECT 1 FROM public.police_fines f JOIN public.fine_appeals a ON a.fine_id=f.id WHERE f.decision_id=j.id AND a.status IN('pending','under_review')) AND NOT EXISTS(SELECT 1 FROM public.appeals a WHERE a.decision_id=j.id AND a.status IN('filed','under_review'));
 FOR decision IN SELECT * FROM public.judicial_decisions WHERE execution_status='active' AND sanction_until<=clock_timestamp() FOR UPDATE LOOP
  UPDATE public.judicial_decisions SET execution_status='completed' WHERE id=decision.id;
  IF decision.sanction_kind='business_suspension' AND NOT EXISTS(SELECT 1 FROM public.judicial_decisions j WHERE j.target_type='business' AND j.target_id=decision.target_id AND j.sanction_kind='business_suspension' AND j.execution_status='active' AND (j.sanction_until IS NULL OR j.sanction_until>clock_timestamp())) THEN
   UPDATE public.businesses SET status=coalesce(decision.legal_snapshot->>'previous_business_status','active'),updated_at=clock_timestamp() WHERE id=decision.target_id AND status='suspended';
  END IF;
  PERFORM public.justice_write_audit('sanction.completed','judicial_decision',decision.id,to_jsonb(decision),jsonb_build_object('execution_status','completed'),'Prazo da sanção judicial cumprido');
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION private.expire_judicial_sanctions() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_applicable_sanction_laws(timestamptz),public.add_case_entity_party(uuid,text,uuid),public.preview_judicial_sanction(uuid,uuid,text,uuid),public.apply_judicial_sanction(uuid,uuid,text,uuid,text,timestamptz,uuid),public.issue_fine_idempotent(uuid,text,numeric,timestamptz,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_applicable_sanction_laws(timestamptz),public.add_case_entity_party(uuid,text,uuid),public.preview_judicial_sanction(uuid,uuid,text,uuid),public.apply_judicial_sanction(uuid,uuid,text,uuid,text,timestamptz,uuid),public.issue_fine_idempotent(uuid,text,numeric,timestamptz,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.justice_can_access_case(p_case_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    public.justice_has_role(array['Admin'])
    or exists (
      select 1 from public.case_parties cp
      where cp.case_id = p_case_id
        and (
          cp.profile_id = (select auth.uid())
          or cp.lawyer_id = (select auth.uid())
          or public.can_manage_fine_target('business',cp.business_id)
          or public.can_manage_fine_target('party',cp.political_party_id)
        )
    )
    or exists (
      select 1
      from public.criminal_cases cc
      left join public.criminal_investigations ci on ci.id = cc.investigation_id
      where cc.id = p_case_id
        and (
          cc.prosecutor_id = (select auth.uid())
          or cc.judge_id = (select auth.uid())
          or ci.lead_officer_id = (select auth.uid())
          or ci.delegate_id = (select auth.uid())
        )
    )
    or exists (
      select 1
      from public.appeals a
      where a.case_id = p_case_id
        and a.reviewing_judge_id = (select auth.uid())
    )
    or (
      public.justice_has_role(array['Agente Penitenciário', 'Diretor Penitenciário'])
      and exists (
        select 1
        from public.sentences s
        join public.prison_terms pt on pt.sentence_id = s.id
        where s.case_id = p_case_id
          and pt.custody_status in ('awaiting_intake', 'provisional', 'serving')
      )
    )
$function$
;
NOTIFY pgrst,'reload schema';

CREATE OR REPLACE FUNCTION private.restore_business_after_sanction(p_decision_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.judicial_decisions%rowtype;
BEGIN
 SELECT * INTO j FROM public.judicial_decisions WHERE id=p_decision_id;
 IF j.sanction_kind='business_suspension' AND NOT EXISTS(SELECT 1 FROM public.judicial_decisions x WHERE x.target_type='business' AND x.target_id=j.target_id AND x.sanction_kind='business_suspension' AND x.execution_status='active' AND (x.sanction_until IS NULL OR x.sanction_until>clock_timestamp())) THEN
  UPDATE public.businesses SET status=coalesce(j.legal_snapshot->>'previous_business_status','active'),updated_at=clock_timestamp() WHERE id=j.target_id AND status='suspended';
 END IF;
END $$;
REVOKE ALL ON FUNCTION private.restore_business_after_sanction(uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.file_case_appeal(p_case_id uuid, p_decision_id uuid, p_appeal_type text, p_arguments text)
 RETURNS appeals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_appeal public.appeals%rowtype;
  v_reviewing_judge uuid; v_sanction public.judicial_decisions%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if not public.justice_can_access_case(p_case_id) then raise exception 'CASE_ACCESS_DENIED'; end if;
  if length(trim(coalesce(p_arguments, ''))) < 40 then raise exception 'APPEAL_ARGUMENTS_TOO_SHORT'; end if;
  SELECT * INTO v_sanction FROM public.judicial_decisions WHERE id=p_decision_id AND case_id=p_case_id FOR UPDATE;
  IF v_sanction.sanction_kind IS NOT NULL THEN
   IF v_sanction.sanction_kind IN('fine_fixed','fine_percentage') THEN RAISE EXCEPTION 'Recorra pela própria multa para preservar suspensão, pagamento e eventual restituição.'; END IF;
   IF NOT public.can_manage_fine_target(v_sanction.target_type,v_sanction.target_id) AND NOT EXISTS(SELECT 1 FROM public.case_parties WHERE case_id=p_case_id AND lawyer_id=auth.uid()) AND NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Somente a parte ou seu representante pode recorrer desta sanção.'; END IF;
   IF v_sanction.issued_at+interval '7 days'<=clock_timestamp() THEN RAISE EXCEPTION 'O prazo de sete dias para recorrer desta sanção terminou.'; END IF;
   IF EXISTS(SELECT 1 FROM public.appeals WHERE decision_id=p_decision_id) THEN SELECT * INTO v_appeal FROM public.appeals WHERE decision_id=p_decision_id ORDER BY created_at LIMIT 1; RETURN v_appeal; END IF;
   SELECT p.id INTO v_reviewing_judge FROM public.profiles p WHERE p.role='Juiz' AND p.deleted_at IS NULL AND p.id<>v_sanction.judge_id AND NOT EXISTS(SELECT 1 FROM public.case_parties WHERE case_id=p_case_id AND (profile_id=p.id OR lawyer_id=p.id)) ORDER BY (SELECT count(*) FROM public.appeals a WHERE a.reviewing_judge_id=p.id AND a.status IN('filed','under_review')),p.id LIMIT 1;
   IF v_reviewing_judge IS NULL THEN RAISE EXCEPTION 'Não há juiz revisor elegível disponível para esta sanção.'; END IF;
   INSERT INTO public.appeals(case_id,decision_id,filed_by,appeal_type,arguments,reviewing_judge_id) VALUES(p_case_id,p_decision_id,auth.uid(),p_appeal_type,trim(p_arguments),v_reviewing_judge) RETURNING * INTO v_appeal;
   UPDATE public.judicial_decisions SET execution_status='suspended_on_appeal' WHERE id=p_decision_id;
   PERFORM private.restore_business_after_sanction(p_decision_id);
   PERFORM public.justice_notify(v_reviewing_judge,'justice_appeal_assigned','Um recurso de sanção legal aguarda sua análise.','/services/justice?view=authority',jsonb_build_object('appeal_id',v_appeal.id,'case_id',p_case_id,'decision_id',p_decision_id));
   PERFORM public.justice_write_audit('sanction.appealed','appeal',v_appeal.id,NULL,to_jsonb(v_appeal),p_arguments);
   RETURN v_appeal;
  END IF;
  if not exists (
    select 1 from public.justice_deadlines
    where case_id = p_case_id and deadline_type = 'appeal'
      and status = 'open' and real_due_at > now()
  ) then raise exception 'APPEAL_DEADLINE_EXPIRED'; end if;

  select p.id into v_reviewing_judge
  from public.profiles p
  join public.criminal_cases cc on cc.id = p_case_id
  where lower(p.role) = 'juiz' and p.id is distinct from cc.judge_id
    and not exists (
      select 1 from public.case_parties cp
      where cp.case_id = p_case_id and (cp.profile_id = p.id or cp.lawyer_id = p.id)
    )
  order by (
    select count(*) from public.appeals a
    where a.reviewing_judge_id = p.id and a.status in ('filed', 'under_review')
  ), p.id
  limit 1;
  if v_reviewing_judge is null then raise exception 'NO_ELIGIBLE_APPEAL_JUDGE'; end if;

  insert into public.appeals(
    case_id, decision_id, filed_by, appeal_type, arguments, reviewing_judge_id
  )
  values (
    p_case_id, p_decision_id, (select auth.uid()),
    p_appeal_type, trim(p_arguments), v_reviewing_judge
  )
  returning * into v_appeal;

  update public.criminal_cases set status = 'appeal', court_level = 2 where id = p_case_id;
  update public.sentences set status = 'appealed' where case_id = p_case_id;
  update public.justice_deadlines
  set status = 'completed', completed_at = now()
  where case_id = p_case_id and deadline_type = 'appeal' and status = 'open';

  perform public.justice_notify(
    v_reviewing_judge, 'justice_appeal_assigned',
    'Um recurso foi distribuído para sua análise.',
    '/services/justice?view=authority',
    jsonb_build_object('appeal_id', v_appeal.id, 'case_id', p_case_id)
  );
  perform public.justice_write_audit(
    'appeal.filed', 'appeal', v_appeal.id,
    null, to_jsonb(v_appeal), p_arguments
  );
  return v_appeal;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.decide_case_appeal(p_appeal_id uuid, p_outcome text, p_decision text)
 RETURNS appeals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid(); v_appeal public.appeals%rowtype; v_original_judge uuid; v_case_status public.justice_case_status; v_sentence public.sentences%rowtype; v_sanction public.judicial_decisions%rowtype;
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
  SELECT * INTO v_sanction FROM public.judicial_decisions WHERE id=v_appeal.decision_id FOR UPDATE;
  IF v_sanction.sanction_kind IS NOT NULL THEN
   IF p_outcome='partially_granted' THEN RAISE EXCEPTION 'Para esta sanção, defira ou indefira o recurso. Uma nova obrigação exige decisão própria fundamentada, preservando a anterior.'; END IF;
   UPDATE public.appeals SET status=p_outcome,decision=trim(p_decision),decided_at=clock_timestamp(),reviewing_judge_id=v_actor WHERE id=v_appeal.id RETURNING * INTO v_appeal;
   UPDATE public.judicial_decisions SET is_final=true,execution_status=CASE WHEN p_outcome='granted' THEN 'reversed' WHEN sanction_kind='regularization' THEN 'awaiting_compliance' WHEN sanction_until<=clock_timestamp() THEN 'completed' ELSE 'active' END WHERE id=v_sanction.id;
   IF p_outcome='granted' OR v_sanction.sanction_until<=clock_timestamp() THEN PERFORM private.restore_business_after_sanction(v_sanction.id);
   ELSIF v_sanction.sanction_kind='business_suspension' THEN UPDATE public.businesses SET status='suspended',updated_at=clock_timestamp() WHERE id=v_sanction.target_id; END IF;
   INSERT INTO public.judicial_decisions(case_id,decision_type,judge_id,summary,legal_reasoning,result,is_final,legal_snapshot) VALUES(v_sanction.case_id,'appeal',v_actor,'Revisão de sanção prevista em lei',trim(p_decision),p_outcome,true,v_sanction.legal_snapshot);
   PERFORM public.justice_notify(v_appeal.filed_by,'justice_appeal_decided','O recurso da sanção judicial foi julgado. Consulte a decisão.','/services/justice?view=citizen',jsonb_build_object('appeal_id',v_appeal.id,'case_id',v_appeal.case_id,'decision_id',v_sanction.id));
   PERFORM public.justice_write_audit('sanction.appeal_decided','appeal',v_appeal.id,NULL,to_jsonb(v_appeal),p_decision);
   RETURN v_appeal;
  END IF;
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
$function$
;

CREATE OR REPLACE FUNCTION public.record_sanction_compliance(p_decision_id uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.judicial_decisions%rowtype; c public.criminal_cases%rowtype;
BEGIN
 SELECT * INTO j FROM public.judicial_decisions WHERE id=p_decision_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Ordem judicial não encontrada.'; END IF;
 SELECT * INTO c FROM public.criminal_cases WHERE id=j.case_id;
 IF auth.uid() IS NULL OR NOT public.justice_has_role(ARRAY['Admin','Juiz']) OR NOT coalesce(public.is_admin(auth.uid()) OR c.judge_id=auth.uid(),false) THEN RAISE EXCEPTION 'Somente o juiz responsável pode registrar o cumprimento.' USING errcode='42501'; END IF;
 IF length(trim(coalesce(p_reason,'')))<30 THEN RAISE EXCEPTION 'Fundamente o cumprimento em pelo menos 30 caracteres.'; END IF;
 IF j.sanction_kind NOT IN('warning','regularization') OR j.execution_status NOT IN('active','awaiting_compliance') THEN RAISE EXCEPTION 'A sanção não está disponível para confirmação de cumprimento.'; END IF;
 UPDATE public.judicial_decisions SET execution_status='completed' WHERE id=j.id;
 PERFORM public.justice_write_audit('sanction.compliance_recorded','judicial_decision',j.id,to_jsonb(j),jsonb_build_object('execution_status','completed'),trim(p_reason));
END $$;
REVOKE ALL ON FUNCTION public.record_sanction_compliance(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_sanction_compliance(uuid,text) TO authenticated;

CREATE INDEX judicial_sanction_target ON public.judicial_decisions(target_type,target_id,issued_at DESC) WHERE sanction_kind IS NOT NULL;
CREATE INDEX judicial_sanction_due ON public.judicial_decisions(sanction_until) WHERE execution_status='active' AND sanction_until IS NOT NULL;
CREATE INDEX fine_case_reference ON public.police_fines(case_id) WHERE case_id IS NOT NULL;
CREATE OR REPLACE FUNCTION private.protect_judicial_business_suspension() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.status='suspended' AND NEW.status<>'suspended' AND EXISTS(SELECT 1 FROM public.judicial_decisions WHERE target_type='business' AND target_id=NEW.id AND sanction_kind='business_suspension' AND execution_status='active' AND (sanction_until IS NULL OR sanction_until>clock_timestamp())) THEN RAISE EXCEPTION 'Esta empresa possui suspensão judicial vigente. Aguarde o prazo ou uma decisão no processo.'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.protect_judicial_business_suspension() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER business_judicial_suspension BEFORE UPDATE OF status ON public.businesses FOR EACH ROW EXECUTE FUNCTION private.protect_judicial_business_suspension();
CREATE UNIQUE INDEX fine_judicial_decision_unique ON public.police_fines(decision_id) WHERE decision_id IS NOT NULL;
COMMIT;
