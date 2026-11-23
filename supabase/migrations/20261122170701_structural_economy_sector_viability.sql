BEGIN;
-- Sector-specific estimates use the existing recipe, workforce, regional
-- infrastructure and current laws. No catalog price, salary or law is changed.
CREATE OR REPLACE FUNCTION private.economy_sector_viability(p_type text,p_region text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.business_types%rowtype; r public.business_recipes%rowtype; region public.economic_regions%rowtype;
 output public.economic_resources%rowtype; input record; supply record; wage numeric; capacity numeric;
 fixed_cost numeric; input_cost numeric:=0; q jsonb; sales jsonb; license jsonb; inputs jsonb:='[]';
 available boolean:=true; startup_available boolean:=true; available_quantity numeric; restricted boolean:=false; input_amount numeric; input_quantity numeric; net numeric;
 price_low numeric:=1; price_high numeric:=3; price_mid numeric; recommended numeric:=1; priced_sales jsonb; step integer;
 target_net numeric; margin_rate numeric;
BEGIN
 SELECT * INTO t FROM public.business_types WHERE id=p_type AND is_active;
 SELECT * INTO r FROM public.business_recipes WHERE business_type_id=t.id ORDER BY id LIMIT 1;
 SELECT * INTO region FROM public.economic_regions WHERE code=p_region;
 IF t.id IS NULL OR r.id IS NULL OR region.code IS NULL THEN RAISE EXCEPTION 'Tipo empresarial, receita ou região inválidos.';END IF;
 SELECT * INTO output FROM public.economic_resources WHERE code=r.output_resource;
 SELECT min(base_weekly_salary) INTO wage FROM public.business_role_templates WHERE business_type_id=t.id AND NOT can_manage;
 capacity:=round(t.base_daily_capacity*1.12*(.65+(region.roads+region.energy+region.telecom+region.industry+region.ports+region.airports)/2000),3);
 fixed_cost:=round(coalesce(wage,0)*t.min_employees/7+t.daily_overhead*(1.25-(region.energy+region.roads)/400),2);
 FOR input IN SELECT i.key resource_code,i.value::numeric quantity,e.name,e.base_price
  FROM jsonb_each_text(r.inputs) i JOIN public.economic_resources e ON e.code=i.key LOOP
  SELECT i.selling_price,b.economic_sector_id,b.region_code INTO supply FROM public.business_inventory i
   JOIN public.businesses b ON b.id=i.business_id WHERE i.resource_code=input.resource_code
    AND b.status='active' AND i.available_for_sale AND i.selling_price>0
    AND private.unreserved_company_stock(b.id,input.resource_code,(statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date)>0
   ORDER BY i.selling_price,b.id LIMIT 1;
  input_quantity:=capacity*input.quantity;
  input_amount:=round(input_quantity*coalesce(supply.selling_price,input.base_price),2);
  q:=public.quote_legal_levies('purchase',input_amount,true,supply.economic_sector_id,input.name,NULL,coalesce(supply.region_code,p_region));
  input_cost:=input_cost+input_amount+coalesce((q->>'buyer_tax')::numeric,0);
  restricted:=restricted OR coalesce((q->>'restricted')::boolean,false);
  available_quantity:=coalesce((SELECT sum(private.unreserved_company_stock(b.id,input.resource_code,
   (statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date)) FROM public.business_inventory i JOIN public.businesses b ON b.id=i.business_id
   WHERE i.resource_code=input.resource_code AND b.status='active' AND i.available_for_sale AND i.selling_price>0),0);
  available:=available AND input_quantity<=available_quantity;
  startup_available:=startup_available AND input_quantity*.25<=available_quantity;
  inputs:=inputs||jsonb_build_array(jsonb_build_object('resource_code',input.resource_code,'quantity',input_quantity,
   'unit_price',coalesce(supply.selling_price,input.base_price),'buyer_tax',coalesce((q->>'buyer_tax')::numeric,0),'cost',input_amount+coalesce((q->>'buyer_tax')::numeric,0)));
 END LOOP;
 sales:=public.quote_legal_levies('purchase',round(capacity*r.output_quantity*output.base_price,2),true,t.economic_sector_id,output.name,NULL,p_region);
 license:=public.quote_legal_levies('license',0,true,t.economic_sector_id,t.id,NULL,p_region);
 net:=coalesce((sales->>'net_amount')::numeric,0);
 restricted:=restricted OR coalesce((sales->>'restricted')::boolean,false) OR coalesce((license->>'restricted')::boolean,false);
 margin_rate:=CASE WHEN lower(t.risk_level) LIKE '%alto%' THEN .15 WHEN lower(t.risk_level) LIKE '%baixo%' THEN .05 ELSE .10 END;
 target_net:=(fixed_cost+input_cost)*(1+margin_rate);
 priced_sales:=sales;
 IF net<target_net THEN
  FOR step IN 1..16 LOOP
   price_mid:=(price_low+price_high)/2;
   q:=public.quote_legal_levies('purchase',round(capacity*r.output_quantity*round(output.base_price*price_mid,2),2),true,t.economic_sector_id,output.name,NULL,p_region);
   IF coalesce((q->>'net_amount')::numeric,0)>=target_net AND NOT coalesce((q->>'restricted')::boolean,false) THEN price_high:=price_mid;ELSE price_low:=price_mid;END IF;
  END LOOP;
  recommended:=least(3,ceil(price_high*10000)/10000);
  priced_sales:=public.quote_legal_levies('purchase',round(capacity*r.output_quantity*round(output.base_price*recommended,2),2),true,t.economic_sector_id,output.name,NULL,p_region);
 END IF;
 RETURN jsonb_build_object('business_type_id',t.id,'name',t.name,'category',t.category,'resource_code',r.output_resource,
  'region_code',p_region,'daily_output',round(capacity*r.output_quantity,3),'fixed_daily_cost',fixed_cost,
  'input_daily_cost',round(input_cost,2),'estimated_daily_cost',round(fixed_cost+input_cost,2),'estimated_daily_net_sales',net,
  'estimated_daily_margin',round(net-fixed_cost-input_cost,2),
  'break_even_utilization',CASE WHEN net>input_cost THEN round(fixed_cost/(net-input_cost)*100,2) ELSE NULL END,
  'capital_required',round((fixed_cost+input_cost)*7+coalesce((license->>'buyer_tax')::numeric,0),2),
  'suggested_price_multiplier',recommended,'suggested_unit_price',round(output.base_price*recommended,2),
  'suggested_daily_net_sales',(priced_sales->>'net_amount')::numeric,
  'suggested_daily_margin',round((priced_sales->>'net_amount')::numeric-fixed_cost-input_cost,2),
  'target_margin_rate',margin_rate,'pricing_is_company_offer_not_official_reference',true,
  'inputs_available',available,'startup_inputs_available',startup_available,'inputs',inputs,'legal_restriction',restricted,'staffing_available',wage>0,
  'method','recipe_minimum_staff_regional_capacity_tax_inclusive','assumes_all_output_sold',true);
END $$;
REVOKE ALL ON FUNCTION private.economy_sector_viability(text,text) FROM PUBLIC,anon,authenticated;

CREATE TABLE private.autonomous_supply_observations(
 operation_date date NOT NULL,resource_code text NOT NULL,required_daily numeric NOT NULL,
 available_stock numeric NOT NULL,starved_companies bigint NOT NULL,PRIMARY KEY(operation_date,resource_code)
);
ALTER TABLE private.autonomous_supply_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.autonomous_supply_observations FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_economic_sector_viability(p_business_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.businesses%rowtype;
BEGIN
 SELECT * INTO b FROM public.businesses WHERE id=p_business_id;
 IF auth.uid() IS NULL OR (b.owner_id IS DISTINCT FROM auth.uid() AND NOT coalesce(public.economic_has_role(ARRAY['Admin']),false)) THEN
  RAISE EXCEPTION 'Acesso permitido ao proprietário ou à Administração.' USING errcode='42501';
 END IF;
 IF b.id IS NULL THEN RAISE EXCEPTION 'Empresa inexistente.';END IF;
 RETURN private.economy_sector_viability(b.business_type_id,b.region_code)||jsonb_build_object('business_id',b.id,
  'note','Estimativa para equipe mínima e preços de referência; não substitui os custos efetivos da sua empresa nem garante vendas.');
END $$;
REVOKE ALL ON FUNCTION public.get_economic_sector_viability(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_economic_sector_viability(uuid) TO authenticated;
-- Autonomous manager and candidate definitions are appended below.
CREATE OR REPLACE FUNCTION private.autonomous_entry_candidates()
RETURNS TABLE(business_type_id text,resource_code text,region_code text,capital_required numeric,
 estimated_daily_cost numeric,estimated_daily_net_sales numeric,inputs_available boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH RECURSIVE needed(resource_code) AS (
  SELECT code FROM public.economic_resources WHERE code IN ('food','energy','bread','meals','retail_food','retail_medicine','retail_clothing')
  UNION
  SELECT input.key FROM needed n JOIN public.business_recipes r ON r.output_resource=n.resource_code
   CROSS JOIN LATERAL jsonb_each_text(r.inputs) input
 ), estimates AS MATERIALIZED (
 SELECT t.id,private.economy_sector_viability(t.id,(SELECT code FROM public.economic_regions ORDER BY population DESC,code LIMIT 1)) info
 FROM public.business_types t WHERE t.is_active AND EXISTS(SELECT 1 FROM public.business_recipes r WHERE r.business_type_id=t.id)
 ), candidate AS (
 SELECT DISTINCT ON (r.output_resource) t.id business_type_id,r.output_resource resource_code,
  v.info->>'region_code' region_code,(v.info->>'capital_required')::numeric capital_required,
  (v.info->>'estimated_daily_cost')::numeric daily_cost,(v.info->>'startup_inputs_available')::boolean inputs_available,
  (v.info->>'suggested_daily_net_sales')::numeric net_sales
 FROM public.business_types t JOIN public.business_recipes r ON r.business_type_id=t.id
 JOIN public.economic_resources e ON e.code=r.output_resource
 JOIN estimates v ON v.id=t.id
 WHERE t.is_active AND (v.info->>'staffing_available')::boolean AND NOT (v.info->>'legal_restriction')::boolean AND t.base_daily_capacity>0 AND (v.info->>'suggested_daily_margin')::numeric>0
  AND (EXISTS(SELECT 1 FROM public.businesses b JOIN public.business_recipes consumer ON consumer.business_type_id=b.business_type_id
    WHERE b.status='active' AND consumer.inputs ? r.output_resource)
   OR e.is_service OR EXISTS(SELECT 1 FROM needed n WHERE n.resource_code=e.code)
   OR e.code IN ('food','energy','bread','drinks','meals','retail_food','retail_medicine','retail_clothing'))
  AND (NOT EXISTS(SELECT 1 FROM public.businesses b JOIN public.business_recipes producer ON producer.business_type_id=b.business_type_id
    WHERE b.status='active' AND producer.output_resource=r.output_resource)
   OR (SELECT count(*) FROM private.autonomous_supply_observations o WHERE o.resource_code=r.output_resource
    AND o.operation_date BETWEEN (statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date-2
     AND (statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date
    AND o.starved_companies>0 AND o.available_stock<o.required_daily)=3)
  AND (SELECT count(*) FROM public.businesses npc JOIN public.business_recipes nr ON nr.business_type_id=npc.business_type_id
   WHERE npc.control_kind='population' AND npc.status='active' AND nr.output_resource=r.output_resource)<2
  AND NOT EXISTS(SELECT 1 FROM public.businesses npc JOIN public.business_recipes nr ON nr.business_type_id=npc.business_type_id
   WHERE npc.control_kind='population' AND nr.output_resource=r.output_resource AND npc.created_at>statement_timestamp()-interval '14 days')
 ORDER BY r.output_resource,(v.info->>'startup_inputs_available')::boolean DESC,(v.info->>'capital_required')::numeric,t.id
 ) SELECT business_type_id,resource_code,region_code,capital_required,round(daily_cost,2),round(net_sales,2),inputs_available
 FROM candidate WHERE net_sales>daily_cost AND daily_cost>0
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
  IF (b.operational_status='closed' OR coalesce((SELECT balance FROM public.accounts WHERE id=b.bank_account_id),0)<=0)
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
 INSERT INTO private.autonomous_supply_observations(operation_date,resource_code,required_daily,available_stock,starved_companies)
 SELECT p_day,d.resource_code,d.required_daily,d.available_stock,(SELECT count(*) FROM public.businesses consumer
  JOIN public.business_recipes recipe ON recipe.business_type_id=consumer.business_type_id
  WHERE consumer.status='active' AND consumer.operational_status='missing_inputs' AND recipe.inputs ? d.resource_code)
 FROM private.economy_supply_diagnostics() d ON CONFLICT DO NOTHING;
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
  UPDATE public.businesses SET employees=kind.min_employees,market_value=candidate.capital_required,
   price_multiplier=(private.economy_sector_viability(kind.id,candidate.region_code)->>'suggested_price_multiplier')::numeric
   WHERE id=b.id;
  budget:=budget-candidate.capital_required;capital:=capital+candidate.capital_required;entries:=entries+1;
 END LOOP;
 v_result:=jsonb_build_object('status','completed','entries',entries,'capital_transferred',capital,'consumer_reserve_ratio',config.population_reserve_ratio);
 UPDATE private.autonomous_economy_runs SET completed_at=clock_timestamp(),created_count=entries,capital_transferred=capital,result=v_result WHERE operation_date=p_day;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION private.manage_autonomous_enterprises(date) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.adjust_population_company(p_business_id uuid, p_net numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.businesses%rowtype;kind public.business_types%rowtype;role public.business_role_templates%rowtype;employee public.business_employees%rowtype;cash numeric;headcount integer;wages numeric;sold_ratio numeric;new_price numeric;
begin
 select * into b from public.businesses where id=p_business_id and control_kind='population' and status='active' and operational_status<>'closed' for update;if not found then return;end if;
 select * into kind from public.business_types where id=b.business_type_id;select balance into cash from public.accounts where id=b.bank_account_id;
 select count(*),coalesce(sum(salary),0) into headcount,wages from public.business_employees where business_id=b.id and fired_at is null;
 select coalesce(sum(sold_quantity)/nullif(sum(produced_quantity),0),0) into sold_ratio from public.business_daily_operations where business_id=b.id and operation_date>=current_date-6;
 select * into role from public.business_role_templates where business_type_id=kind.id and not can_manage order by id limit 1;
 if p_net>0 and cash>wages*3+role.base_weekly_salary*3 and headcount<least(1000,kind.min_employees*20) and sold_ratio>.65 then
  insert into public.business_employees(business_id,name,role,role_template_id,skill_area,salary,is_npc,qualification_level,last_accrued_on) values(b.id,'Profissional '||(headcount+1)||' · '||b.region_code,role.name,role.id,role.skill_area,role.base_weekly_salary,true,1,current_date);
 elsif p_net<0 and headcount>greatest(1,floor(kind.min_employees*.5)) then
  select * into employee from public.business_employees where business_id=b.id and is_npc and fired_at is null order by qualification_level,id limit 1 for update;
  if found then update public.business_employees set fired_at=now() where id=employee.id;end if;
 end if;
 new_price:=greatest(.5,least(3,b.price_multiplier*case when sold_ratio<.3 then .95 when sold_ratio>.9 then 1.02 else 1 end));
 if p_net<0 then
  new_price:=greatest(new_price,least(b.price_multiplier*1.1,(private.economy_sector_viability(kind.id,b.region_code)->>'suggested_price_multiplier')::numeric));
 end if;
 update public.businesses set employees=(select count(*) from public.business_employees where business_id=b.id and fired_at is null),price_multiplier=new_price,operational_status=case when loss_cycles>=6 and cash<wages/7 then 'closed' else operational_status end,is_for_sale=case when loss_cycles>=3 then true else is_for_sale end,sale_price=case when loss_cycles>=3 then greatest(1,market_value*.8) else sale_price end,metadata=metadata||jsonb_build_object('last_population_decision',jsonb_build_object('at',now(),'net_result',p_net,'sold_ratio',sold_ratio,'price_multiplier',new_price)),updated_at=now() where id=b.id;
 update public.business_inventory i set selling_price=round(r.base_price*new_price,2),updated_at=now() from public.economic_resources r where i.business_id=b.id and i.resource_code=r.code and i.price_policy='automatic';
 perform private.regularize_population_company(b.id);
end $function$;
CREATE OR REPLACE FUNCTION public.get_autonomous_economy_preview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(public.economic_has_role(ARRAY['Admin']),false) THEN RAISE EXCEPTION 'Acesso administrativo obrigatório.' USING errcode='42501';END IF;
 RETURN jsonb_build_object('config',(SELECT to_jsonb(c) FROM private.autonomous_economy_config c WHERE id=true),
  'candidates',(SELECT coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('registration_included',true)),'[]')
   FROM private.autonomous_entry_candidates() c JOIN public.business_types t ON t.id=c.business_type_id),
  'sector_viability',(SELECT coalesce(jsonb_agg(private.economy_sector_viability(t.id,(SELECT code FROM public.economic_regions ORDER BY population DESC,code LIMIT 1)) ORDER BY t.id),'[]')
   FROM public.business_types t WHERE t.is_active AND EXISTS(SELECT 1 FROM public.business_recipes r WHERE r.business_type_id=t.id)),
  'population_savings',(SELECT balance FROM public.accounts WHERE account_kind='population'),
  'runs',(SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT * FROM private.autonomous_economy_runs ORDER BY operation_date DESC LIMIT 14) x));
END $$;
REVOKE ALL ON FUNCTION public.get_autonomous_economy_preview() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_autonomous_economy_preview() TO authenticated;
-- Activation is deliberately absent from the public API until staging passes.

COMMIT;
