BEGIN;
-- Essential supply recovery: prospective only. No monetary injection, new authorization,
-- changes to player prices, release of reserved stock, or replay of completed company days.
SELECT pg_advisory_xact_lock(hashtext('govrp:stock-market'));
SELECT pg_advisory_xact_lock(hashtextextended('govrp:company-economy',0));
CREATE OR REPLACE FUNCTION private.essential_supply_gaps(p_day date)
RETURNS TABLE(resource_code text,priority integer,required_daily numeric,available_stock numeric,shortage numeric,depth integer,missing_producer boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
WITH RECURSIVE offers AS MATERIALIZED (
 SELECT i.resource_code,sum(private.unreserved_company_stock(b.id,i.resource_code,p_day)) AS qty
 FROM public.business_inventory i JOIN public.businesses b ON b.id=i.business_id JOIN public.economic_resources e ON e.code=i.resource_code
 WHERE b.status='active' AND b.operational_status<>'closed' AND i.available_for_sale AND i.quantity>0 AND i.selling_price>0 AND i.selling_price<=e.base_price*3 GROUP BY i.resource_code
), producers AS MATERIALIZED (
 SELECT DISTINCT r.output_resource FROM public.businesses b JOIN public.business_recipes r ON r.business_type_id=b.business_type_id WHERE b.status='active' AND b.operational_status<>'closed'
), recipes AS MATERIALIZED (
 SELECT DISTINCT ON(r.output_resource) r.output_resource,r.inputs,r.output_quantity FROM public.business_recipes r JOIN public.business_types t ON t.id=r.business_type_id WHERE t.is_active AND r.output_quantity>0 ORDER BY r.output_resource,(SELECT count(*) FROM jsonb_object_keys(r.inputs)),r.id
), roots AS (
 SELECT i.key resource_code,sum(greatest(0,t.base_daily_capacity*i.value::numeric-private.unreserved_company_stock(b.id,i.key,p_day))) qty,
 max(CASE WHEN r.output_resource IN ('health','education','medicine','retail_medicine') THEN 100 ELSE 10 END) priority
 FROM public.businesses b JOIN public.business_types t ON t.id=b.business_type_id JOIN public.business_recipes r ON r.business_type_id=b.business_type_id JOIN public.accounts a ON a.id=b.bank_account_id CROSS JOIN LATERAL jsonb_each_text(r.inputs) i
 WHERE b.status='active' AND b.operational_status<>'closed' AND b.region_code IS NOT NULL AND a.balance>0 AND b.employees>0 AND t.is_active AND i.value::numeric>0 GROUP BY i.key
), chain(resource_code,qty,priority,path,depth) AS (
 SELECT resource_code,qty,priority,ARRAY[resource_code],0 FROM roots WHERE qty>0
 UNION ALL
 SELECT i.key,greatest(0,c.qty-coalesce(o.qty,0))*i.value::numeric/r.output_quantity,c.priority,c.path||i.key,c.depth+1
 FROM chain c JOIN recipes r ON r.output_resource=c.resource_code LEFT JOIN offers o ON o.resource_code=c.resource_code CROSS JOIN LATERAL jsonb_each_text(r.inputs) i
 WHERE c.qty>coalesce(o.qty,0) AND c.depth<8 AND i.value::numeric>0 AND NOT i.key=ANY(c.path) AND NOT EXISTS(SELECT 1 FROM producers p WHERE p.output_resource=c.resource_code)
), totals AS (SELECT resource_code,sum(qty) qty,max(priority) priority,max(depth) depth FROM chain GROUP BY resource_code)
 SELECT t.resource_code,t.priority,t.qty AS required_daily,coalesce(o.qty,0) available_stock,greatest(0,t.qty-coalesce(o.qty,0)) shortage,t.depth,NOT EXISTS(SELECT 1 FROM producers p WHERE p.output_resource=t.resource_code) missing_producer
 FROM totals t LEFT JOIN offers o USING(resource_code) WHERE t.qty>coalesce(o.qty,0)
$fn$;
REVOKE ALL ON FUNCTION private.essential_supply_gaps(date) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.autonomous_entry_candidates()
RETURNS TABLE(business_type_id text,resource_code text,region_code text,capital_required numeric,estimated_daily_cost numeric,estimated_daily_net_sales numeric,inputs_available boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
WITH RECURSIVE needed(resource_code) AS (
 SELECT code FROM public.economic_resources WHERE code IN ('food','energy','bread','meals','retail_food','retail_medicine','retail_clothing')
 UNION
 SELECT input.key FROM needed n JOIN public.business_recipes r ON r.output_resource=n.resource_code CROSS JOIN LATERAL jsonb_each_text(r.inputs) input
), gaps AS MATERIALIZED (
 SELECT * FROM private.essential_supply_gaps((statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date)
), estimates AS MATERIALIZED (
 SELECT t.id,private.economy_sector_viability(t.id,(SELECT code FROM public.economic_regions ORDER BY population DESC,code LIMIT 1)) info
 FROM public.business_types t WHERE t.is_active AND EXISTS(SELECT 1 FROM public.business_recipes r WHERE r.business_type_id=t.id)
), candidate AS (
 SELECT DISTINCT ON (r.output_resource) t.id business_type_id,r.output_resource resource_code,
  v.info->>'region_code' region_code,
  -- Critical entry retains seven days of payroll/overhead, all legal fees and two days of variable inputs.
  -- This is a smaller initial stock buffer, not new money or a change to the population reserve.
  round(greatest(0,(v.info->>'capital_required')::numeric
   -CASE WHEN coalesce(g.priority,0)>=100 THEN 5*(v.info->>'input_daily_cost')::numeric ELSE 0 END),2) capital_required,
  (v.info->>'estimated_daily_cost')::numeric daily_cost,
  (v.info->>'startup_inputs_available')::boolean AND NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(v.info->'inputs') x
   JOIN public.economic_resources er ON er.code=x->>'resource_code'
   WHERE coalesce((SELECT sum(private.unreserved_company_stock(s.id,i.resource_code,(statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date))
    FROM public.business_inventory i JOIN public.businesses s ON s.id=i.business_id
    WHERE s.status='active' AND s.operational_status<>'closed' AND i.resource_code=er.code AND i.available_for_sale AND i.quantity>0 AND i.selling_price>0 AND i.selling_price<=er.base_price*3),0)<(x->>'quantity')::numeric*.25
  ) inputs_available,
  (v.info->>'suggested_daily_net_sales')::numeric net_sales,coalesce(g.priority,0) priority,coalesce(g.depth,0) depth
 FROM public.business_types t JOIN public.business_recipes r ON r.business_type_id=t.id
 JOIN public.economic_resources e ON e.code=r.output_resource JOIN estimates v ON v.id=t.id LEFT JOIN gaps g ON g.resource_code=r.output_resource
 WHERE t.is_active AND (v.info->>'staffing_available')::boolean AND NOT (v.info->>'legal_restriction')::boolean AND t.base_daily_capacity>0 AND (v.info->>'suggested_daily_margin')::numeric>0
 AND (g.resource_code IS NOT NULL OR EXISTS(SELECT 1 FROM public.businesses b JOIN public.business_recipes consumer ON consumer.business_type_id=b.business_type_id WHERE b.status='active' AND consumer.inputs ? r.output_resource)
  OR e.is_service OR EXISTS(SELECT 1 FROM needed n WHERE n.resource_code=e.code) OR e.code IN ('food','energy','bread','drinks','meals','retail_food','retail_medicine','retail_clothing'))
 AND (NOT EXISTS(SELECT 1 FROM public.businesses b JOIN public.business_recipes producer ON producer.business_type_id=b.business_type_id WHERE b.status='active' AND producer.output_resource=r.output_resource)
  OR (SELECT count(*) FROM private.autonomous_supply_observations o WHERE o.resource_code=r.output_resource AND o.operation_date BETWEEN (statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date-2 AND (statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date AND o.starved_companies>0 AND o.available_stock<o.required_daily)=3)
 AND (SELECT count(*) FROM public.businesses npc JOIN public.business_recipes nr ON nr.business_type_id=npc.business_type_id WHERE npc.control_kind='population' AND npc.status='active' AND nr.output_resource=r.output_resource)<2
 AND NOT EXISTS(SELECT 1 FROM public.businesses npc JOIN public.business_recipes nr ON nr.business_type_id=npc.business_type_id WHERE npc.control_kind='population' AND nr.output_resource=r.output_resource AND npc.created_at>statement_timestamp()-interval '14 days')
 ORDER BY r.output_resource,inputs_available DESC,capital_required,t.id
), viable AS (
 SELECT * FROM candidate WHERE net_sales>daily_cost AND daily_cost>0 AND capital_required>0
)
 SELECT business_type_id,resource_code,region_code,capital_required,round(daily_cost,2),round(net_sales,2),inputs_available
 FROM viable
 WHERE priority>=100 OR NOT EXISTS(SELECT 1 FROM viable c WHERE c.priority>=100)
 ORDER BY inputs_available DESC,priority DESC,depth DESC,
 CASE WHEN resource_code='energy' THEN 0 WHEN EXISTS(SELECT 1 FROM needed n WHERE n.resource_code=viable.resource_code) THEN 1 ELSE 2 END,
 capital_required,resource_code
$fn$;
REVOKE ALL ON FUNCTION private.autonomous_entry_candidates() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.simulate_company_day(p_business_id uuid, p_day date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.businesses%rowtype; kind public.business_types%rowtype; region public.economic_regions%rowtype; recipe public.business_recipes%rowtype; employee public.business_employees%rowtype; item record; supplier record; contract record; cash numeric; available numeric; cost numeric:=0; wages numeric:=0; wage numeric; overhead numeric:=0; units numeric; work_efficiency numeric; skill numeric; headcount integer; boost numeric; resource_price numeric; population_account uuid; produced numeric:=0; result_status text:='operating'; input_quantity numeric; unit_cost numeric; tx uuid; contract_key uuid; forecast numeric; output_stock numeric; contracted numeric; planned_units numeric; shortage numeric; reserved_wages numeric; supply_quote jsonb;
begin
 if p_day>current_date or p_day<current_date-30 then raise exception 'Data de simulação fora do período operacional.';end if;
 select * into b from public.businesses where id=p_business_id for update;
 if b.id is null or b.status<>'active' or b.operational_status='closed' or exists(select 1 from public.business_daily_operations where business_id=b.id and operation_date=p_day) then return;end if;
 select * into kind from public.business_types where id=b.business_type_id;
 select * into region from public.economic_regions where code=b.region_code;
 select * into recipe from public.business_recipes where business_type_id=b.business_type_id order by id limit 1;
 if region.code is null or recipe.id is null then return;end if;
 select id into population_account from public.accounts where account_kind='population';
 for employee in select * from public.business_employees where business_id=b.id and fired_at is null and hired_at::date<=p_day order by id for update loop
  wage:=round(employee.salary/7*greatest(0,p_day+1-coalesce(employee.last_accrued_on,employee.hired_at::date)),2);
  update public.business_employees set wage_due=wage_due+wage,last_accrued_on=greatest(coalesce(last_accrued_on,hired_at::date),p_day+1),experience=experience+case when is_npc then 2 else 0 end,qualification_level=case when is_npc then least(20,1+(experience+2)/100) else qualification_level end,satisfaction=greatest(0,least(100,satisfaction+case when wage_due>salary then -3 else 0 end)) where id=employee.id;
  wages:=wages+wage;
 end loop;
 if wages>0 then insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key,accounting_date) values(b.id,'expense',-wages,'Salários trabalhados no dia',jsonb_build_object('kind','payroll_accrual','operation_date',p_day),'wage-accrual:'||p_day,p_day);end if;
 select count(*),coalesce(avg((1+least(.3,(qualification_level-1)*.02))*(.7+satisfaction*.006)),0) into headcount,skill from public.business_employees where business_id=b.id and fired_at is null and hired_at::date<=p_day;
 select coalesce(e.boost,0) into boost from private.business_daily_effort e where e.business_id=b.id and e.effort_date=p_day;
 work_efficiency:=least(10,(headcount+case when b.owner_operates and b.control_kind='player' then .25 else 0 end)/greatest(kind.min_employees,1)::numeric)*greatest(.7,skill)*(.65+(region.roads+region.energy+region.telecom+region.industry+region.ports+region.airports)/2000)*(1+coalesce(boost,0));
 units:=round(kind.base_daily_capacity*work_efficiency,3);
 -- Keep two days of observed sales, with a bounded first-week market trial.
 select coalesce(sum(sold_quantity),0)/greatest(1,least(7,p_day-b.created_at::date)) into forecast
 from public.business_daily_operations where business_id=b.id and operation_date>=p_day-7 and operation_date<p_day;
 if p_day-b.created_at::date<7 then forecast:=greatest(forecast,units*recipe.output_quantity*.5);end if;
 select coalesce(sum(daily_quantity),0) into contracted from public.business_supply_contracts
 where seller_business_id=b.id and resource_code=recipe.output_resource and status='active'
 and ends_at>(p_day::timestamp at time zone 'America/Sao_Paulo');
 select coalesce(sum(quantity),0) into output_stock from public.business_inventory
 where business_id=b.id and resource_code=recipe.output_resource;
 -- A company that lacked inputs during its first week must be able to
 -- discover demand after supply returns. One small weekly batch, never free.
 IF p_day-b.created_at::date>=7 AND mod(p_day-b.created_at::date,7)=0
  AND forecast=0 AND output_stock<units*recipe.output_quantity*.25
  AND (private.household_category(recipe.output_resource,false) IS NOT NULL OR contracted>0
    OR EXISTS(SELECT 1 FROM public.business_recipes r JOIN public.businesses buyer ON buyer.business_type_id=r.business_type_id
       WHERE buyer.status='active' AND r.inputs ? recipe.output_resource)) THEN
  forecast:=units*recipe.output_quantity*.125;
 END IF;
 -- Essential upstream suppliers react to a real unmet input requirement, including
 -- prerequisites of absent downstream firms, without assuming that a sale occurred.
 IF p_day=(statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date THEN
  SELECT g.shortage INTO shortage FROM private.essential_supply_gaps(p_day) g WHERE g.resource_code=recipe.output_resource;
  IF coalesce(shortage,0)>0 THEN
   forecast:=greatest(forecast,least(units*recipe.output_quantity*.125,shortage/2));
  END IF;
  -- Retry a small batch after a blocked input-dependent company can actually supply it.
  -- No automatic debit of a player account; owners still use purchases or approved contracts.
  IF forecast=0 AND output_stock<units*recipe.output_quantity*.25 AND recipe.inputs<>'{}'::jsonb
   AND (private.household_category(recipe.output_resource,false) IS NOT NULL OR recipe.output_resource IN ('health','education') OR contracted>0)
   AND NOT EXISTS(SELECT 1 FROM jsonb_each_text(recipe.inputs) i
     WHERE private.unreserved_company_stock(b.id,i.key,p_day)<units*.25*i.value::numeric) THEN
   forecast:=units*recipe.output_quantity*.125;
  END IF;
 END IF;
 planned_units:=greatest(0,trunc((greatest(forecast,contracted)*2-output_stock)/greatest(recipe.output_quantity,.001),3));
 units:=least(units,planned_units);
 if headcount<kind.min_employees then result_status:='understaffed';end if;
 -- Agreed standing orders are capped by quantity, price and expiry; no unrestricted auto-debit.
 for contract in select * from public.business_supply_contracts where buyer_business_id=b.id and status='active' and ends_at>p_day::timestamptz and (last_processed_on is null or last_processed_on<p_day) for update loop
  begin
   contract_key:=md5('supply-contract:'||contract.id||':'||p_day)::uuid;
   perform private.trade_company_resource(b.id,contract.seller_business_id,contract.resource_code,contract.daily_quantity,contract.max_unit_price,contract_key,contract.created_by,p_day);
  exception when others then
   if b.owner_id is not null then insert into public.notifications(user_id,type,content,link,metadata) values(b.owner_id,'company_supply_pending','Um fornecimento de '||b.name||' não foi concluído. Confira estoque, preço e caixa.','/services/companies/'||b.id,jsonb_build_object('contract_id',contract.id,'operation_date',p_day));end if;
   raise log 'GOVRP supply contract % failed [%]: %',contract.id,sqlstate,sqlerrm;
  end;
  update public.business_supply_contracts set last_processed_on=p_day where id=contract.id;
 end loop;
 -- Population businesses buy from actual available suppliers and their own finite company cash.
 if b.control_kind='population' and units>0 then
  select coalesce(sum(wage_due),0) into reserved_wages from public.business_employees where business_id=b.id and fired_at is null;
  for item in select key,value::numeric required from jsonb_each_text(recipe.inputs) loop
   select coalesce(quantity,0) into available from public.business_inventory where business_id=b.id and resource_code=item.key;
   perform private.supply_population_company_from_marketplace(b.id,item.key,greatest(0,units*item.required-coalesce(available,0))*.25,p_day);
  end loop;

  for item in select key,value::numeric required from jsonb_each_text(recipe.inputs) loop
   select coalesce(quantity,0) into available from public.business_inventory where business_id=b.id and resource_code=item.key;
   input_quantity:=greatest(0,round(units*item.required-coalesce(available,0),3));
   if input_quantity>0 then
    for supplier in select i.*,r.base_price from public.business_inventory i join public.businesses s on s.id=i.business_id join public.economic_resources r on r.code=i.resource_code where i.resource_code=item.key and i.business_id<>b.id and s.status='active' and i.available_for_sale and i.quantity>0 and i.selling_price>0 and i.selling_price<=r.base_price*3 and private.unreserved_company_stock(i.business_id,item.key,p_day)>0 order by i.selling_price,i.business_id limit 3 loop
     select balance into cash from public.accounts where id=b.bank_account_id;
     input_quantity:=least(input_quantity,private.unreserved_company_stock(supplier.business_id,item.key,p_day),supplier.quantity,trunc(greatest(0,cash-reserved_wages-kind.daily_overhead*1.25)/greatest(supplier.selling_price*1.5,.01),3));
     if input_quantity<=0 then
      input_quantity:=greatest(0,trunc(units*item.required-coalesce(available,0),3));continue;
     end if;
     supply_quote:=public.quote_legal_levies('purchase',round(supplier.selling_price*input_quantity,2),true,
       (select economic_sector_id from public.businesses where id=supplier.business_id),'Insumos',NULL,
       (select region_code from public.businesses where id=supplier.business_id));
     if coalesce((supply_quote->>'restricted')::boolean,true) OR coalesce((supply_quote->>'total_debited')::numeric,cash+1)>greatest(0,cash-reserved_wages-kind.daily_overhead*1.25) then
      input_quantity:=greatest(0,trunc(units*item.required-coalesce(available,0),3));continue;
     end if;
     begin perform private.trade_company_resource(b.id,supplier.business_id,item.key,input_quantity,supplier.selling_price,md5('npc-supply:'||b.id||':'||supplier.business_id||':'||item.key||':'||p_day)::uuid,null,p_day);
     exception when others then raise log 'GOVRP population supply % failed [%]: %',b.id,sqlstate,sqlerrm;end;
     select coalesce(quantity,0) into available from public.business_inventory where business_id=b.id and resource_code=item.key;
     input_quantity:=greatest(0,trunc(units*item.required-coalesce(available,0),3));
     if input_quantity<=0 then exit;end if;
    end loop;
   end if;
  end loop;
 end if;
 -- Every input limits physical production. Missing input never creates imaginary sales.
 for item in select key,value::numeric required from jsonb_each_text(recipe.inputs) loop
  select quantity into available from public.business_inventory where business_id=b.id and resource_code=item.key for update;
  available:=least(coalesce(available,0),private.unreserved_company_stock(b.id,item.key,p_day));
  if coalesce(available,0)<units*item.required then units:=greatest(0,trunc(coalesce(available,0)/item.required,3));result_status:='missing_inputs';end if;
 end loop;
 perform id from public.accounts where id in(b.bank_account_id,population_account) order by id for update;
 select balance into cash from public.accounts where id=b.bank_account_id;
 overhead:=round(kind.daily_overhead*(1.25-(region.energy+region.roads)/400),2);
 if cash<overhead then units:=0;overhead:=0;result_status:='cash_shortage';
 elsif overhead>0 then
  update public.accounts set balance=balance-overhead,updated_at=now() where id=b.bank_account_id;
  update public.accounts set balance=balance+overhead,updated_at=now() where id=population_account;
  insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key) values(b.bank_account_id,population_account,overhead,'company_operating_cost','Serviços operacionais: '||b.name,jsonb_build_object('business_id',b.id,'operation_date',p_day,'regional_energy',region.energy,'regional_roads',region.roads),md5('company-overhead:'||b.id||':'||p_day)::uuid);
  insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key,accounting_date) values(b.id,'expense',-overhead,'Infraestrutura e manutenção diária',jsonb_build_object('kind','overhead'),'overhead:'||p_day,p_day);
 end if;
 if round(units*recipe.output_quantity,3)<=0 then units:=0;end if;
 if units>0 then
  for item in select key,value::numeric required from jsonb_each_text(recipe.inputs) loop
   select i.unit_cost into unit_cost from public.business_inventory i where i.business_id=b.id and i.resource_code=item.key;
   cost:=cost+units*item.required*unit_cost;
   update public.business_inventory set quantity=greatest(0,quantity-units*item.required),updated_at=now() where business_id=b.id and resource_code=item.key;
  end loop;
  produced:=round(units*recipe.output_quantity,3);
  select base_price into resource_price from public.economic_resources where code=recipe.output_resource;
  insert into public.business_inventory(business_id,resource_code,quantity,unit_cost,selling_price,available_for_sale) values(b.id,recipe.output_resource,produced,round((cost+wages+overhead)/produced,4),round(resource_price*b.price_multiplier,2),true)
  on conflict(business_id,resource_code) do update set unit_cost=(public.business_inventory.quantity*public.business_inventory.unit_cost+cost+wages+overhead)/(public.business_inventory.quantity+produced),quantity=public.business_inventory.quantity+produced,selling_price=case when public.business_inventory.price_policy='automatic' then excluded.selling_price else coalesce(public.business_inventory.selling_price,excluded.selling_price) end,updated_at=now();
  if cost>0 then insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key,accounting_date) values(b.id,'expense',-round(cost,2),'Insumos consumidos na produção',jsonb_build_object('kind','input_consumption','recipe_id',recipe.id),'inputs:'||p_day,p_day);end if;
 end if;
 insert into public.business_daily_operations(business_id,operation_date,produced_quantity,payroll_accrued,input_cost,overhead,productivity,status,metadata) values(b.id,p_day,produced,wages,round(cost,2),overhead,work_efficiency*100,result_status,jsonb_build_object('region_code',region.code,'headcount',headcount,'recipe_id',recipe.id,'effort_boost',coalesce(boost,0),'daily_sales_forecast',forecast,'planned_units',planned_units,'output_stock_before',output_stock));
 update public.businesses set employees=headcount,operational_status=case when loss_cycles>=3 and result_status='operating' then 'insolvent' else result_status end,productivity_index=least(300,work_efficiency*100),last_simulated_on=p_day,updated_at=now() where id=b.id;
end $function$
;
REVOKE ALL ON FUNCTION private.simulate_company_day(uuid,date) FROM PUBLIC,anon,authenticated;

-- Verify callable definitions and invariants before committing.
DO $test$
BEGIN
 IF EXISTS(SELECT 1 FROM private.essential_supply_gaps((statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date)
   WHERE shortage<=0 OR available_stock<0 OR depth<0 OR depth>8) THEN
  RAISE EXCEPTION 'Invalid essential supply gap';
 END IF;
 IF EXISTS(SELECT resource_code FROM private.autonomous_entry_candidates() GROUP BY resource_code HAVING count(*)>1) THEN
  RAISE EXCEPTION 'Duplicate autonomous supply candidate';
 END IF;
 IF EXISTS(SELECT 1 FROM private.autonomous_entry_candidates() WHERE capital_required<=0 OR estimated_daily_cost<=0 OR estimated_daily_net_sales<=estimated_daily_cost) THEN
  RAISE EXCEPTION 'Invalid startup economics';
 END IF;
 IF has_function_privilege('anon','private.essential_supply_gaps(date)','EXECUTE') OR has_function_privilege('authenticated','private.essential_supply_gaps(date)','EXECUTE') THEN
  RAISE EXCEPTION 'Private supply function exposed';
 END IF;
END
$test$;
COMMIT;
