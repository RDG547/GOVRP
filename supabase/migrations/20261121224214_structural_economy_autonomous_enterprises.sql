BEGIN;
-- Pilot is intentionally disabled until staging verifies complete production,
-- legal registration and fiscal circulation. Installing this migration moves no money.
CREATE TABLE private.autonomous_economy_config (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),enabled boolean NOT NULL DEFAULT false,
 max_active integer NOT NULL DEFAULT 32 CHECK(max_active BETWEEN 1 AND 64),
 max_entries_per_day integer NOT NULL DEFAULT 2 CHECK(max_entries_per_day BETWEEN 1 AND 4),
 population_reserve_ratio numeric NOT NULL DEFAULT .75 CHECK(population_reserve_ratio BETWEEN .5 AND .95),
 updated_at timestamptz NOT NULL DEFAULT now(),updated_by uuid REFERENCES public.profiles(id),
 justification text NOT NULL DEFAULT 'Aguardando homologação e validação administrativa.'
);
INSERT INTO private.autonomous_economy_config(id) VALUES(true);
ALTER TABLE private.autonomous_economy_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.autonomous_economy_config FROM PUBLIC,anon,authenticated;
CREATE TABLE private.autonomous_economy_runs (
 operation_date date PRIMARY KEY,started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 completed_at timestamptz,created_count integer NOT NULL DEFAULT 0,capital_transferred numeric NOT NULL DEFAULT 0,
 result jsonb NOT NULL DEFAULT '{}'
);
ALTER TABLE private.autonomous_economy_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.autonomous_economy_runs FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.autonomous_entry_candidates()
RETURNS TABLE(business_type_id text,resource_code text,region_code text,capital_required numeric,
 estimated_daily_cost numeric,estimated_daily_net_sales numeric,inputs_available boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH RECURSIVE needed(resource_code) AS (
  SELECT code FROM public.economic_resources WHERE code IN ('food','energy','bread','meals','retail_food','retail_medicine','retail_clothing')
  UNION
  SELECT input.key FROM needed n JOIN public.business_recipes r ON r.output_resource=n.resource_code
   CROSS JOIN LATERAL jsonb_each_text(r.inputs) input
 ), candidate AS (
 SELECT DISTINCT ON (r.output_resource) t.id business_type_id,r.output_resource resource_code,
  (SELECT code FROM public.economic_regions ORDER BY population DESC,code LIMIT 1) region_code,
  t.min_employees,t.base_daily_capacity,r.output_quantity,
  public.quote_legal_levies('license',0,true,t.economic_sector_id,t.id,NULL,
    (SELECT code FROM public.economic_regions ORDER BY population DESC,code LIMIT 1)) registration_quote,
  t.daily_overhead+coalesce(w.salary,0)*t.min_employees/7+coalesce(i.input_cost,0)*t.base_daily_capacity daily_cost,
  coalesce(i.available,true) inputs_available,
  public.quote_legal_levies('purchase',round(t.base_daily_capacity*r.output_quantity*e.base_price,2),
   true,t.economic_sector_id,e.name,NULL,NULL) quote
 FROM public.business_types t JOIN public.business_recipes r ON r.business_type_id=t.id
 JOIN public.economic_resources e ON e.code=r.output_resource
 LEFT JOIN LATERAL (SELECT min(base_weekly_salary) salary FROM public.business_role_templates
  WHERE business_type_id=t.id AND NOT can_manage) w ON true
 LEFT JOIN LATERAL (
  SELECT sum(input.value::numeric*coalesce(offers.price,resource.base_price)) input_cost,
   bool_and(coalesce(offers.quantity,0)>=input.value::numeric*t.base_daily_capacity) available
  FROM jsonb_each_text(r.inputs) input JOIN public.economic_resources resource ON resource.code=input.key
  LEFT JOIN LATERAL (SELECT sum(private.unreserved_company_stock(inv.business_id,input.key,
    (statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date)) quantity,min(inv.selling_price) price
   FROM public.business_inventory inv JOIN public.businesses supplier ON supplier.id=inv.business_id
   WHERE inv.resource_code=input.key AND inv.available_for_sale AND inv.selling_price>0
    AND supplier.status='active' AND inv.quantity>0) offers ON true
 ) i ON true
 WHERE t.is_active AND w.salary>0 AND t.base_daily_capacity>0
  AND (EXISTS(SELECT 1 FROM public.businesses b JOIN public.business_recipes consumer ON consumer.business_type_id=b.business_type_id
    WHERE b.status='active' AND consumer.inputs ? r.output_resource)
   OR e.is_service OR EXISTS(SELECT 1 FROM needed n WHERE n.resource_code=e.code)
   OR e.code IN ('food','energy','bread','drinks','meals','retail_food','retail_medicine','retail_clothing'))
  AND NOT EXISTS(SELECT 1 FROM public.businesses b JOIN public.business_recipes producer ON producer.business_type_id=b.business_type_id
    WHERE b.status='active' AND producer.output_resource=r.output_resource)
 ORDER BY r.output_resource,t.daily_overhead+coalesce(w.salary,0)*t.min_employees/7,t.id
 ) SELECT business_type_id,resource_code,region_code,round(daily_cost*7+coalesce((registration_quote->>'buyer_tax')::numeric,0),2),round(daily_cost,2),
  round((quote->>'net_amount')::numeric,2),inputs_available
 FROM candidate WHERE NOT coalesce((quote->>'restricted')::boolean,false)
  AND NOT coalesce((registration_quote->>'restricted')::boolean,false)
  AND (quote->>'net_amount')::numeric>daily_cost AND daily_cost>0
 ORDER BY inputs_available DESC,
  CASE WHEN resource_code='energy' THEN 0 WHEN EXISTS(SELECT 1 FROM needed n WHERE n.resource_code=candidate.resource_code) THEN 1 ELSE 2 END,
  4,resource_code
$$;
REVOKE ALL ON FUNCTION private.autonomous_entry_candidates() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.manage_autonomous_enterprises(p_day date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE config private.autonomous_economy_config%rowtype; candidate record; b public.businesses%rowtype;
 wallet public.accounts%rowtype; worker_role public.business_role_templates%rowtype;
 kind public.business_types%rowtype; entries integer:=0; workers integer; version integer; capital numeric:=0;
 budget numeric; tx uuid; v_result jsonb;
BEGIN
 IF p_day IS NULL OR p_day<>(statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date THEN
  RAISE EXCEPTION 'Gestão autônoma somente no dia operacional atual.';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtext('govrp:stock-market'));
 PERFORM pg_advisory_xact_lock(hashtextextended('govrp:company-economy',0));
 SELECT * INTO config FROM private.autonomous_economy_config WHERE id=true;
 IF NOT config.enabled THEN RETURN jsonb_build_object('status','disabled');END IF;
 SELECT r.result INTO v_result FROM private.autonomous_economy_runs r WHERE operation_date=p_day;
 IF FOUND THEN RETURN v_result||jsonb_build_object('idempotent',true);END IF;
 INSERT INTO private.autonomous_economy_runs(operation_date) VALUES(p_day);
 -- No deletion or debt forgiveness. A closed NPC keeps its inventory, cash,
 -- payroll liabilities and full ledger for liquidation / administrative review.
 FOR b IN SELECT * FROM public.businesses WHERE control_kind='population' AND status='active'
  AND loss_cycles>=4 AND created_at<statement_timestamp()-interval '28 days' ORDER BY id FOR UPDATE LOOP
  IF coalesce((SELECT balance FROM public.accounts WHERE id=b.bank_account_id),0)<=0
   AND NOT EXISTS(SELECT 1 FROM public.business_supply_contracts WHERE status='active'
     AND ends_at>statement_timestamp() AND (buyer_business_id=b.id OR seller_business_id=b.id)) THEN
   UPDATE public.business_employees SET fired_at=clock_timestamp() WHERE business_id=b.id AND fired_at IS NULL;
   UPDATE public.businesses SET operational_status='closed',status='suspended',employees=0,
    metadata=metadata||jsonb_build_object('autonomous_exit_at',clock_timestamp(),'liabilities_preserved',true) WHERE id=b.id;
  END IF;
 END LOOP;
 SELECT * INTO wallet FROM public.accounts WHERE account_kind='population' FOR UPDATE;
 IF wallet.id IS NULL THEN RAISE EXCEPTION 'Conta demográfica indisponível.';END IF;
 budget:=trunc(greatest(0,wallet.balance)*(1-config.population_reserve_ratio),2);
 FOR candidate IN SELECT * FROM private.autonomous_entry_candidates() WHERE inputs_available LOOP
  EXIT WHEN entries>=config.max_entries_per_day OR
   (SELECT count(*) FROM public.businesses WHERE control_kind='population' AND status='active')>=config.max_active OR
   (SELECT count(*) FROM public.businesses WHERE control_kind='population')>=256;
  IF candidate.capital_required>budget OR candidate.capital_required<=0 THEN CONTINUE;END IF;
  SELECT * INTO kind FROM public.business_types WHERE id=candidate.business_type_id;
  SELECT * INTO worker_role FROM public.business_role_templates WHERE business_type_id=kind.id AND NOT can_manage ORDER BY base_weekly_salary,id LIMIT 1;
  SELECT count(*)+1 INTO version FROM public.businesses WHERE control_kind='population' AND business_type_id=kind.id;
  INSERT INTO public.businesses(owner_id,control_kind,business_type_id,name,description,status,region_code,owner_operates,metadata)
  VALUES(NULL,'population',kind.id,kind.name||' · População '||version,
   'Empresa autônoma financiada pela poupança da população.','active',candidate.region_code,false,
   jsonb_build_object('simulation_managed',true,'structural_reform',true,'capital_source','population_savings')) RETURNING * INTO b;
  IF b.bank_account_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=b.bank_account_id AND business_id=b.id) THEN
   RAISE EXCEPTION 'Conta empresarial não foi criada pela arquitetura existente.';
  END IF;
  PERFORM id FROM public.accounts WHERE id IN(wallet.id,b.bank_account_id) ORDER BY id FOR UPDATE;
  UPDATE public.accounts SET balance=balance-candidate.capital_required,updated_at=clock_timestamp()
   WHERE id=wallet.id AND balance>=candidate.capital_required;
  IF NOT FOUND THEN RAISE EXCEPTION 'Poupança disponível insuficiente.';END IF;
  UPDATE public.accounts SET balance=balance+candidate.capital_required,updated_at=clock_timestamp() WHERE id=b.bank_account_id;
  INSERT INTO public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key)
  VALUES(wallet.id,b.bank_account_id,candidate.capital_required,'company_capital','Capital da população: '||b.name,
   jsonb_build_object('business_id',b.id,'kind','population_capital','operation_date',p_day),md5('npc-entry:'||b.id)::uuid) RETURNING id INTO tx;
  INSERT INTO public.business_transactions(business_id,type,amount,description,metadata,operation_key,accounting_date)
  VALUES(b.id,'other',candidate.capital_required,'Capital da população',jsonb_build_object('kind','capital','transaction_id',tx),'npc-entry:'||b.id,p_day);
  -- Reuse the established entity registration, including the current legal fee.
  -- Any failed registration rolls back capital, account, employees and company.
  PERFORM private.regularize_population_company(b.id);
  IF NOT EXISTS(SELECT 1 FROM public.businesses WHERE id=b.id AND cnpj_document_id IS NOT NULL) THEN
   RAISE EXCEPTION 'Regularização da empresa autônoma não concluída.';
  END IF;
  FOR workers IN 1..kind.min_employees LOOP
   INSERT INTO public.business_employees(business_id,name,role,salary,is_npc,role_template_id,skill_area,qualification_level,experience,last_accrued_on)
   VALUES(b.id,'Profissional '||workers,worker_role.name,worker_role.base_weekly_salary,true,worker_role.id,worker_role.skill_area,1,0,p_day);
  END LOOP;
  UPDATE public.businesses SET employees=kind.min_employees,market_value=candidate.capital_required WHERE id=b.id;
  budget:=budget-candidate.capital_required;capital:=capital+candidate.capital_required;entries:=entries+1;
 END LOOP;
 v_result:=jsonb_build_object('status','completed','entries',entries,'capital_transferred',capital,'consumer_reserve_ratio',config.population_reserve_ratio);
 UPDATE private.autonomous_economy_runs SET completed_at=clock_timestamp(),created_count=entries,capital_transferred=capital,result=v_result WHERE operation_date=p_day;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION private.manage_autonomous_enterprises(date) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_autonomous_economy_preview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(public.economic_has_role(ARRAY['Admin']),false) THEN RAISE EXCEPTION 'Acesso administrativo obrigatório.' USING errcode='42501';END IF;
 RETURN jsonb_build_object('config',(SELECT to_jsonb(c) FROM private.autonomous_economy_config c WHERE id=true),
  'candidates',(SELECT coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('registration_included',true)),'[]')
   FROM private.autonomous_entry_candidates() c JOIN public.business_types t ON t.id=c.business_type_id),
  'population_savings',(SELECT balance FROM public.accounts WHERE account_kind='population'),
  'runs',(SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT * FROM private.autonomous_economy_runs ORDER BY operation_date DESC LIMIT 14) x));
END $$;
REVOKE ALL ON FUNCTION public.get_autonomous_economy_preview() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_autonomous_economy_preview() TO authenticated;
-- Activation is deliberately absent from the public API until staging passes.
COMMIT;
