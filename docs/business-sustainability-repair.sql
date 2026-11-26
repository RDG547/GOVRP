
-- Business sustainability v1. Prospective only; no historical replay or capital injection.
CREATE OR REPLACE FUNCTION private.unreserved_company_stock(p_business uuid,p_resource text,p_day date,p_contract uuid DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT greatest(0,coalesce((SELECT quantity FROM public.business_inventory WHERE business_id=p_business AND resource_code=p_resource),0)
 -coalesce((SELECT sum(daily_quantity) FROM public.business_supply_contracts WHERE seller_business_id=p_business AND resource_code=p_resource AND status='active'
 AND ends_at>(p_day::timestamp AT TIME ZONE 'America/Sao_Paulo') AND created_at<((p_day+1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
 AND (last_processed_on IS NULL OR last_processed_on<p_day) AND id IS DISTINCT FROM p_contract),0)
 -CASE WHEN EXISTS(SELECT 1 FROM public.businesses WHERE id=p_business AND control_kind='population' AND owner_id IS NULL) THEN 0
 ELSE coalesce((SELECT sum(stock) FROM public.products WHERE business_id=p_business AND resource_code=p_resource AND moderation_status='approved' AND archived_at IS NULL AND stock>0),0) END)
$fn$;
-- NPC listings are a projection of the same stock, not a second inventory. Keep player reservations.
REVOKE ALL ON FUNCTION private.unreserved_company_stock(uuid,text,date,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.company_utilization_overhead(p_full numeric,p_units numeric,p_capacity numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
 SELECT round(greatest(0,coalesce(p_full,0))*(.70+.30*greatest(0,least(1,coalesce(p_units/nullif(p_capacity,0),0)))),2)
$fn$;
REVOKE ALL ON FUNCTION private.company_utilization_overhead(numeric,numeric,numeric) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.company_observed_sales(p_business uuid,p_resource text,p_day date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT coalesce(sum(CASE WHEN jsonb_typeof(t.metadata->'quantity')='number' THEN greatest(0,(t.metadata->>'quantity')::numeric)
 WHEN t.metadata ? 'product_id' AND p.resource_code=p_resource THEN 1 ELSE 0 END),0)
 FROM public.transactions t LEFT JOIN public.products p ON p.id::text=t.metadata->>'product_id'
 WHERE t.created_at>=((p_day-7)::timestamp AT TIME ZONE 'America/Sao_Paulo')
 AND t.created_at<(p_day::timestamp AT TIME ZONE 'America/Sao_Paulo')
 AND t.type IN('business_supply','population_purchase','purchase','purchase_card')
 AND (t.metadata->>'seller_business_id'=p_business::text OR t.metadata->>'business_id'=p_business::text)
 AND coalesce(t.metadata->>'resource_code',p.resource_code)=p_resource
 AND t.amount>0
$fn$;
REVOKE ALL ON FUNCTION private.company_observed_sales(uuid,text,date) FROM PUBLIC,anon,authenticated;

-- A new firm may rely on proven purchases and funded unmet input demand, not universal full-capacity sales.
CREATE OR REPLACE FUNCTION private.company_entry_demand(p_resource text,p_day date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 WITH observed AS (
 SELECT coalesce(sum(CASE WHEN jsonb_typeof(t.metadata->'quantity')='number' THEN greatest(0,(t.metadata->>'quantity')::numeric)
 WHEN t.metadata ? 'product_id' AND p.resource_code=p_resource THEN 1 ELSE 0 END),0)/7 qty
 FROM public.transactions t LEFT JOIN public.products p ON p.id::text=t.metadata->>'product_id'
 WHERE t.created_at>=((p_day-7)::timestamp AT TIME ZONE 'America/Sao_Paulo') AND t.created_at<(p_day::timestamp AT TIME ZONE 'America/Sao_Paulo')
 AND t.type IN('business_supply','population_purchase','purchase','purchase_card') AND t.amount>0
 AND coalesce(t.metadata->>'resource_code',p.resource_code)=p_resource
 -- Do not count stock acquisition by the state as proof of final demand.
 AND NOT (t.type='business_supply' AND t.metadata->>'buyer_kind'='government')
 ), funded AS (
 SELECT coalesce(sum(least(greatest(0,coalesce(t.base_daily_capacity,0)*(r.inputs->>p_resource)::numeric
 -coalesce(i.quantity,0)),greatest(0,a.balance-coalesce(w.due,0)-t.daily_overhead)/greatest(.01,e.base_price*3*1.5))),0) qty
 FROM public.businesses b JOIN public.business_types t ON t.id=b.business_type_id JOIN public.business_recipes r ON r.business_type_id=t.id
 JOIN public.accounts a ON a.id=b.bank_account_id JOIN public.economic_resources e ON e.code=p_resource
 LEFT JOIN public.business_inventory i ON i.business_id=b.id AND i.resource_code=p_resource
 LEFT JOIN LATERAL(SELECT sum(wage_due) due FROM public.business_employees WHERE business_id=b.id)w ON true
 WHERE b.status='active' AND b.operational_status<>'closed' AND b.employees>0 AND r.inputs ? p_resource
 ), offers AS (
 SELECT coalesce(sum(private.unreserved_company_stock(b.id,i.resource_code,p_day)),0) qty
 FROM public.business_inventory i JOIN public.businesses b ON b.id=i.business_id
 WHERE i.resource_code=p_resource AND i.available_for_sale AND i.selling_price>0 AND b.status='active' AND b.operational_status<>'closed'
 )
 SELECT greatest(0,(SELECT qty FROM observed)+(SELECT qty FROM funded)-(SELECT qty FROM offers)/7)
$fn$;
REVOKE ALL ON FUNCTION private.company_entry_demand(text,date) FROM PUBLIC,anon,authenticated;

DO $patch$
DECLARE d text; a integer; b integer; old text; repl text;
BEGIN
 -- Never manually increase a projected listing; the inventory trigger owns its quantity.
 d:=pg_get_functiondef('private.sync_population_marketplace(uuid)'::regprocedure);
 a:=strpos(d,' FOR offer IN SELECT p.id product_id'); b:=strpos(d,' FOR offer IN SELECT b.id,b.name');
 IF a=0 OR b<=a THEN RAISE EXCEPTION 'Marketplace projection definition changed';END IF;
 d:=left(d,a-1)||substring(d from b);
 d:=replace(d,$s$'energy','food','drinks','bread','meals','retail_food','retail_electronics','retail_clothing','retail_medicine','retail_vehicles'$s$,$s$'energy','food','drinks','bread','meals','milk','meat','fish','rice','beans','beef','chicken','eggs','mineral_water','cooking_oil','sugar','retail_food','retail_electronics','retail_clothing','retail_medicine','retail_vehicles'$s$);
 EXECUTE d;
 -- A marketplace checkout against a shared NPC stock must not consume an outstanding contract.
 d:=pg_get_functiondef('private.sync_physical_listing_stock()'::regprocedure);
 old:=$s$if amount is null or amount<delta then raise exception 'O estoque desta oferta foi atualizado. Confira a disponibilidade.';end if;$s$;
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'Physical settlement definition changed';END IF;
 repl:=old||$s$
  IF delta>0 AND EXISTS(SELECT 1 FROM public.businesses WHERE id=new.business_id AND control_kind='population' AND owner_id IS NULL)
   AND private.unreserved_company_stock(new.business_id,new.resource_code,(statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date)<delta THEN
    RAISE EXCEPTION 'Estoque reservado para fornecimento contratado.';
  END IF;$s$;
 EXECUTE replace(d,old,repl);

 d:=pg_get_functiondef('private.simulate_company_day(uuid,date)'::regprocedure);
 old:='reserved_wages numeric; supply_quote jsonb;';
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'Production declaration changed';END IF;
 d:=replace(d,old,old||' physical_capacity numeric;');
 old:='units:=round(kind.base_daily_capacity*work_efficiency,3);';
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'Production capacity changed';END IF;
 d:=replace(d,old,old||' physical_capacity:=units;');
 old:=$s$select coalesce(sum(sold_quantity),0)/greatest(1,least(7,p_day-b.created_at::date)) into forecast
 from public.business_daily_operations where business_id=b.id and operation_date>=p_day-7 and operation_date<p_day;
 if p_day-b.created_at::date<7 then forecast:=greatest(forecast,units*recipe.output_quantity*.5);end if;$s$;
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'Production forecast changed';END IF;
 d:=replace(d,old,$s$forecast:=private.company_observed_sales(b.id,recipe.output_resource,p_day)/greatest(1,least(7,p_day-b.created_at::date));
 -- Small first-day launch batch; subsequent production reacts to actual demand and real orders.
 if p_day-b.created_at::date=0 then forecast:=greatest(forecast,units*recipe.output_quantity*.25);
 elsif p_day-b.created_at::date<7 then forecast:=greatest(forecast,units*recipe.output_quantity*.125);end if;$s$);
 old:='overhead:=round(kind.daily_overhead*(1.25-(region.energy+region.roads)/400),2);';
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'Overhead calculation changed';END IF;
 d:=replace(d,old,'overhead:=private.company_utilization_overhead(kind.daily_overhead*(1.25-(region.energy+region.roads)/400),units,physical_capacity);');
 -- Round the physical output before charging activity-based overhead.
 d:=replace(d,'overhead:=private.company_utilization_overhead','if round(units*recipe.output_quantity,3)<=0 then units:=0;end if;'||chr(10)||' overhead:=private.company_utilization_overhead');
 old:=$s$'output_stock_before',output_stock)$s$;
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'Production metadata changed';END IF;
 d:=replace(d,old,$s$'output_stock_before',output_stock,'physical_capacity',physical_capacity,'balance_model','observed_sales_variable_overhead_v1')$s$);
 EXECUTE d;

 d:=pg_get_functiondef('private.manage_autonomous_enterprises(date)'::regprocedure);
 old:='IF candidate.capital_required>budget OR candidate.capital_required<=0 THEN CONTINUE;END IF;';
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'NPC entry guard changed';END IF;
 d:=replace(d,old,old||$s$
  -- Require conservative revenue coverage using the actual market and legal quote.
  IF NOT EXISTS(SELECT 1 FROM (SELECT private.economy_sector_viability(candidate.business_type_id,candidate.region_code) v) x
   WHERE least(.75,private.company_entry_demand(candidate.resource_code,p_day)/greatest(.001,(v->>'daily_output')::numeric))*(v->>'suggested_daily_net_sales')::numeric
     >=(v->>'fixed_daily_cost')::numeric+least(.75,private.company_entry_demand(candidate.resource_code,p_day)/greatest(.001,(v->>'daily_output')::numeric))*(v->>'input_daily_cost')::numeric
  ) THEN CONTINUE;END IF;$s$);
 EXECUTE d;
 -- Do not raise prices merely because a firm has unsold goods. Use real sales and cap automatic weekly movements.
 d:=pg_get_functiondef('private.adjust_population_company(uuid,numeric)'::regprocedure);
 old:=$s$select coalesce(sum(sold_quantity)/nullif(sum(produced_quantity),0),0) into sold_ratio from public.business_daily_operations where business_id=b.id and operation_date>=current_date-6;$s$;
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'NPC pricing forecast changed';END IF;
 d:=replace(d,old,$s$select least(1,private.company_observed_sales(b.id,r.output_resource,current_date)/greatest(.001,coalesce((select sum(produced_quantity) from public.business_daily_operations where business_id=b.id and operation_date>=current_date-7 and operation_date<current_date),0)+coalesce((select quantity from public.business_inventory where business_id=b.id and resource_code=r.output_resource),0))) into sold_ratio from public.business_recipes r where r.business_type_id=kind.id order by r.id limit 1;
 sold_ratio:=coalesce(sold_ratio,0);$s$);
 old:=$s$if p_net<0 then
  new_price:=greatest(new_price,least(b.price_multiplier*1.1,(private.economy_sector_viability(kind.id,b.region_code)->>'suggested_price_multiplier')::numeric));$s$;
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'NPC price adjustment changed';END IF;
 d:=replace(d,old,$s$if p_net<0 and sold_ratio>.65 then
  new_price:=greatest(new_price,least(3,b.price_multiplier*1.05,(private.economy_sector_viability(kind.id,b.region_code)->>'suggested_price_multiplier')::numeric));$s$);
 -- Physical listing price follows automatic NPC inventory pricing; manual player prices untouched.
 old:='perform private.regularize_population_company(b.id);';
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'NPC adjustment end changed';END IF;
 d:=replace(d,old,$s$update public.products p set price=i.selling_price from public.business_inventory i where p.business_id=b.id and i.business_id=b.id and p.resource_code=i.resource_code and i.price_policy='automatic' and i.selling_price>0 and p.price is distinct from i.selling_price and p.archived_at is null;
 perform private.regularize_population_company(b.id);$s$);
 EXECUTE d;
 -- National consumption shares the same finite budget across stocked resources instead of exhausting it alphabetically.
 d:=pg_get_functiondef('private.consume_national_market(date,numeric)'::regprocedure);
 old:='FOR row IN SELECT r.*,e.is_service FROM public.national_market_references r JOIN public.economic_resources e ON e.code=r.resource_code ORDER BY r.resource_code LOOP';
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'National consumption loop changed';END IF;
 d:=replace(d,old,$s$FOR row IN
 WITH available AS (
 SELECT r.*,e.is_service,CASE private.household_category(r.resource_code,e.is_service) WHEN 'food' THEN 3 WHEN 'health' THEN 2 WHEN 'education' THEN 2 WHEN 'energy' THEN 2 ELSE 1 END::numeric AS priority
 FROM public.national_market_references r JOIN public.economic_resources e ON e.code=r.resource_code
 WHERE (CASE WHEN e.is_service THEN coalesce((SELECT sum(service_remaining) FROM public.national_market_purchases WHERE resource_code=r.resource_code AND service_remaining>0),0)
 ELSE coalesce((SELECT quantity FROM public.national_market_stock WHERE resource_code=r.resource_code),0) END)>0
 AND NOT EXISTS(SELECT 1 FROM public.national_market_consumption WHERE operation_date=p_day AND resource_code=r.resource_code)
 ) SELECT available.*,priority/sum(priority) OVER() AS budget_share FROM available ORDER BY priority DESC,md5(p_day::text||resource_code),resource_code LOOP$s$);
 old:=$s$qty:=least(held,trunc(demand,3),trunc(greatest(0,least(p_budget-spent,buyer.balance-spent))/row.unit_price,3));
  spending_limit:=greatest(0,least(p_budget-spent,buyer.balance-spent));$s$;
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'National consumption budget changed';END IF;
 d:=replace(d,old,$s$spending_limit:=greatest(0,least(p_budget-spent,buyer.balance-spent,trunc(p_budget*row.budget_share,2)));
  qty:=least(held,trunc(demand,3),trunc(spending_limit/row.unit_price,3));$s$);
 EXECUTE d;
END $patch$;
