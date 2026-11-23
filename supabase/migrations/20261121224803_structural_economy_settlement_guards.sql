BEGIN;
-- Atomic prospective settlements; legal quotes remain authoritative.
-- Behavioral demand weights, not tax or official price changes.
CREATE OR REPLACE FUNCTION private.household_category(p_resource text,p_service boolean)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE
 WHEN p_resource IN ('food','drinks','bread','bread_kg','meals','retail_food','milk','meat','fish','rice','beans','beef','chicken','eggs','mineral_water','cooking_oil','sugar') THEN 'food'
 WHEN p_resource IN ('medicine','retail_medicine','health','lab') THEN 'health'
 WHEN p_resource='education' THEN 'education'
 WHEN p_resource IN ('energy','gas') THEN 'energy'
 WHEN p_resource IN ('taxi','bus','aviation','shipping','transport_km','gasoline','diesel','retail_vehicles') THEN 'transport'
 WHEN p_resource IN ('construction','construction_hour','cleaning') THEN 'housing'
 WHEN p_resource='retail_clothing' THEN 'clothing'
 WHEN p_service OR p_resource='retail_electronics' THEN 'services' ELSE NULL END
$$;
CREATE OR REPLACE FUNCTION private.household_resource_weights(p_day date)
RETURNS TABLE(resource_code text,category text,weight numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH available AS (
  SELECT r.code,private.household_category(r.code,r.is_service) category FROM public.economic_resources r
  WHERE EXISTS(SELECT 1 FROM public.business_inventory i JOIN public.businesses b ON b.id=i.business_id
   WHERE i.resource_code=r.code AND b.status='active' AND i.available_for_sale AND i.selling_price>0
    AND private.unreserved_company_stock(i.business_id,r.code,p_day)>0)
 ), weighted AS (
  SELECT code,category,(CASE category WHEN 'food' THEN .30 WHEN 'health' THEN .10 WHEN 'education' THEN .08
   WHEN 'energy' THEN .08 WHEN 'transport' THEN .10 WHEN 'housing' THEN .15 WHEN 'clothing' THEN .05 ELSE .14 END)
   /count(*) OVER(PARTITION BY category) w FROM available WHERE category IS NOT NULL
 ) SELECT code,category,w/sum(w) OVER() FROM weighted
$$;
REVOKE ALL ON FUNCTION private.household_category(text,boolean),private.household_resource_weights(date) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION private.trade_company_resource(p_buyer uuid, p_seller uuid, p_resource text, p_quantity numeric, p_max_price numeric, p_key uuid, p_actor uuid,p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.businesses%rowtype; s public.businesses%rowtype; stock public.business_inventory%rowtype; a public.accounts%rowtype; q jsonb; total numeric; net numeric; amount numeric; order_row public.business_supply_orders%rowtype; tx uuid; reserved_contract uuid;
begin
 if p_day is null or p_day>current_date or p_day<current_date-30 then raise exception 'Data operacional inválida.';end if;
 if p_quantity::text in ('NaN','Infinity','-Infinity') or p_max_price::text in ('NaN','Infinity','-Infinity') then raise exception 'Quantidade e preço devem ser finitos.';end if;
 perform pg_advisory_xact_lock(hashtext('govrp:stock-market'));
 perform pg_advisory_xact_lock(hashtextextended('govrp:company-economy',0));
 if p_buyer is null or p_seller is null or p_buyer=p_seller or p_key is null or p_quantity is null or p_quantity<=0 or p_quantity>1000000 or p_quantity<>round(p_quantity,3) or p_max_price is null or p_max_price<=0 then raise exception 'Confira as empresas, quantidade e preço máximo do fornecimento.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_key::text,0));
 select * into order_row from public.business_supply_orders where idempotency_key=p_key;
 if found then
  if order_row.buyer_business_id<>p_buyer or order_row.seller_business_id<>p_seller or order_row.actor_id is distinct from p_actor or order_row.resource_code<>p_resource or order_row.quantity<>p_quantity then raise exception 'Esta identificação já pertence a outro fornecimento.';end if;
  return to_jsonb(order_row);
 end if;
 perform id from public.businesses where id in(p_buyer,p_seller) order by id for update;
 select * into b from public.businesses where id=p_buyer and status='active';select * into s from public.businesses where id=p_seller and status='active';
 if b.id is null or s.id is null then raise exception 'Comprador e fornecedor precisam estar ativos.';end if;
 select * into stock from public.business_inventory where business_id=s.id and resource_code=p_resource for update;
 if stock.resource_code is null or not stock.available_for_sale or stock.quantity<p_quantity or stock.selling_price is null or stock.selling_price>p_max_price then raise exception 'O preço ou estoque do fornecedor mudou. Confira a oferta.';end if;

 select c.id into reserved_contract from public.business_supply_contracts c
 where c.buyer_business_id=p_buyer and c.seller_business_id=p_seller and c.resource_code=p_resource
  and c.status='active' and c.ends_at>(p_day::timestamp at time zone 'America/Sao_Paulo')
  and p_quantity<=c.daily_quantity and md5('supply-contract:'||c.id||':'||p_day)::uuid=p_key;
 if private.unreserved_company_stock(p_seller,p_resource,p_day,reserved_contract)<p_quantity then
  raise exception 'Estoque reservado para contratos ou anúncios.';end if;
 amount:=round(stock.selling_price*p_quantity,2);
 if amount<=0 then raise exception 'Fornecimento inferior à unidade monetária.';end if;
 q:=public.quote_legal_levies('purchase',amount,true,s.economic_sector_id,'Insumos',NULL,s.region_code);
 if (q->>'restricted')::boolean then raise exception 'Fornecimento restrito por norma vigente.';end if;
 total:=(q->>'total_debited')::numeric;net:=(q->>'net_amount')::numeric;
 perform id from public.accounts where id in(b.bank_account_id,s.bank_account_id) order by id for update;
 select * into a from public.accounts where id=b.bank_account_id;
 if a.id is null or total is null or net is null or total<net or net<0 or not exists(select 1 from public.accounts where id=s.bank_account_id and business_id=s.id) then raise exception 'Contas ou cotação inválidas.';end if;
 if a.balance<total then raise exception 'O caixa da empresa não cobre este fornecimento.';end if;
 update public.accounts set balance=balance-total,updated_at=now() where id=b.bank_account_id;
 update public.accounts set balance=balance+net,updated_at=now() where id=s.bank_account_id;
 update public.government_finances set treasury_balance=treasury_balance+total-net,updated_at=now() where id=1;
 if not found then raise exception 'Tesouro indisponível para recolhimento.';end if;
 update public.business_inventory set quantity=quantity-p_quantity,updated_at=now() where business_id=s.id and resource_code=p_resource;
 insert into public.business_inventory(business_id,resource_code,quantity,unit_cost) values(b.id,p_resource,p_quantity,total/p_quantity)
 on conflict(business_id,resource_code) do update set unit_cost=(public.business_inventory.quantity*public.business_inventory.unit_cost+total)/(public.business_inventory.quantity+p_quantity),quantity=public.business_inventory.quantity+p_quantity,updated_at=now();
 insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key) values(b.bank_account_id,s.bank_account_id,amount,'business_supply','Fornecimento: '||s.name||' → '||b.name,q||jsonb_build_object('buyer_kind','business','is_simulated',b.control_kind='population' OR s.control_kind='population','final_consumption',false,'buyer_business_id',b.id,'seller_business_id',s.id,'resource_code',p_resource,'quantity',p_quantity,'operation_date',p_day),p_key) returning id into tx;
 insert into public.business_supply_orders(buyer_business_id,seller_business_id,resource_code,quantity,unit_price,total,tax_snapshot,transaction_id,actor_id,idempotency_key) values(b.id,s.id,p_resource,p_quantity,stock.selling_price,total,q,tx,p_actor,p_key) returning * into order_row;
 insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key) values(b.id,'other',-total,'Aquisição de insumos: '||p_resource,jsonb_build_object('kind','inventory_purchase','transaction_id',tx),'supply-buyer:'||p_key),(s.id,'revenue',amount,'Fornecimento para '||b.name,jsonb_build_object('kind','b2b_sale','transaction_id',tx),'supply-seller:'||p_key);
 if (q->>'seller_tax')::numeric>0 then insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key) values(s.id,'tax',-(q->>'seller_tax')::numeric,'Tributos sobre fornecimento',q,'supply-tax:'||p_key);end if;
 if total>net then insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,business_id,amount,occurred_at_rp,metadata) values('consumption_tax','transactions',tx::text,p_actor,s.id,total-net,public.rp_now(),q);end if;
 return to_jsonb(order_row);
end $function$;

REVOKE ALL ON FUNCTION private.trade_company_resource(uuid,uuid,text,numeric,numeric,uuid,uuid,date) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION private.trade_company_resource(p_buyer uuid,p_seller uuid,p_resource text,p_quantity numeric,p_max_price numeric,p_key uuid,p_actor uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT private.trade_company_resource(p_buyer,p_seller,p_resource,p_quantity,p_max_price,p_key,p_actor,
  (statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date)
$$;
CREATE OR REPLACE FUNCTION private.simulate_company_day(p_business_id uuid, p_day date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.businesses%rowtype; kind public.business_types%rowtype; region public.economic_regions%rowtype; recipe public.business_recipes%rowtype; employee public.business_employees%rowtype; item record; supplier record; contract record; cash numeric; available numeric; cost numeric:=0; wages numeric:=0; wage numeric; overhead numeric:=0; units numeric; work_efficiency numeric; skill numeric; headcount integer; boost numeric; resource_price numeric; population_account uuid; produced numeric:=0; result_status text:='operating'; input_quantity numeric; unit_cost numeric; tx uuid; contract_key uuid; forecast numeric; output_stock numeric; contracted numeric; planned_units numeric;
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
  for item in select key,value::numeric required from jsonb_each_text(recipe.inputs) loop
   select coalesce(quantity,0) into available from public.business_inventory where business_id=b.id and resource_code=item.key;
   perform private.supply_population_company_from_marketplace(b.id,item.key,greatest(0,units*item.required-coalesce(available,0))*.25,p_day);
  end loop;

  for item in select key,value::numeric required from jsonb_each_text(recipe.inputs) loop
   select coalesce(quantity,0) into available from public.business_inventory where business_id=b.id and resource_code=item.key;
   input_quantity:=greatest(0,round(units*item.required-coalesce(available,0),3));
   if input_quantity>0 then
    for supplier in select i.*,r.base_price from public.business_inventory i join public.businesses s on s.id=i.business_id join public.economic_resources r on r.code=i.resource_code where i.resource_code=item.key and i.business_id<>b.id and s.status='active' and i.available_for_sale and i.quantity>0 and i.selling_price<=r.base_price*2 order by i.selling_price,i.business_id limit 3 loop
     select balance into cash from public.accounts where id=b.bank_account_id;
     input_quantity:=least(input_quantity,private.unreserved_company_stock(supplier.business_id,item.key,p_day),supplier.quantity,trunc(greatest(0,cash-wages-kind.daily_overhead)/greatest(supplier.selling_price*1.5,.01),3));
     if input_quantity<=0 then continue;end if;
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
end $function$;
CREATE OR REPLACE FUNCTION private.simulate_population_demand(p_day date)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare resource public.economic_resources%rowtype; offer record; population public.accounts%rowtype; macro public.economic_state%rowtype; total_budget numeric; budget numeric; spent numeric:=0; v_quantity numeric; total numeric; net numeric; amount numeric; q jsonb; tx uuid; score_sum numeric;retail_share numeric:=.3;population_scale numeric:=1;inflation numeric:=0;employment numeric:=1; resource_count integer; player_count integer; npc_count integer; active_direct_offers boolean:=false; market_share numeric:=.5; direct_budget numeric;
begin
 if p_day is null or p_day>current_date or p_day<current_date-30 then raise exception 'Data operacional inválida.';end if;
 perform pg_advisory_xact_lock(hashtext('govrp:stock-market'));
 perform pg_advisory_xact_lock(hashtextextended('govrp:company-economy',0));
 perform pg_advisory_xact_lock(hashtextextended('govrp:population-demand:'||p_day,0));
 if exists(select 1 from private.population_demand_runs where operation_date=p_day) then return 0;end if;
 select * into population from public.accounts where account_kind='population' for update;
 select * into macro from public.economic_state where id=true;
 total_budget:=least(50000,greatest(0,population.balance)*.1)*(.5+coalesce(macro.consumer_confidence,50)/100);
 select least(1,greatest(.01,coalesce(sum(population_count),0)::numeric/200000000)) into population_scale from public.country_population_segments where country_code='BR';
 select greatest(0,coalesce((economic_current->>'inflation')::numeric,0)),greatest(.05,1-coalesce((economic_current->>'unemployment')::numeric,0)/100) into inflation,employment from public.country_rp_states where country_code='BR';
 total_budget:=round(total_budget*population_scale*coalesce(employment,1)/(1+coalesce(inflation,0)/100),2);
 perform private.procure_national_market(p_day);
 -- Protect the fraction of household demand the administration assigned to players.
 -- If no genuine direct company offers exist, the National Market may use the full budget.
 select exists(
   select 1 from public.business_inventory i
   join public.businesses b on b.id=i.business_id
   join public.economic_resources e on e.code=i.resource_code
   where b.status='active' and i.quantity>0 and i.available_for_sale and i.selling_price>0
     and (e.is_service or e.code in('energy','food','drinks','bread','meals','retail_food',
                                   'retail_electronics','retail_clothing','retail_medicine','retail_vehicles'))
 ) into active_direct_offers;
 market_share:=case when coalesce(macro.simulated_share,0)+coalesce(macro.player_share,0)>0
   then greatest(0,least(1,coalesce(macro.simulated_share,0)/
        (coalesce(macro.simulated_share,0)+coalesce(macro.player_share,0))))
   else .5 end;
 spent:=private.consume_national_market(p_day,round(total_budget*
   case when active_direct_offers then market_share else 1 end,2)); -- Allocate household purchasing power only to categories that currently have genuine offers.
 -- Previously empty categories received an equal share, starving the actual sellers.
 direct_budget:=greatest(0,total_budget-spent)*(1-retail_share);
 for resource in select e.* from public.economic_resources e join private.household_resource_weights(p_day) w on w.resource_code=e.code order by w.weight desc,e.code loop
  select direct_budget*w.weight into budget from private.household_resource_weights(p_day) w where w.resource_code=resource.code;
  select count(*) filter(where b.control_kind='player'),count(*) filter(where b.control_kind='population') into player_count,npc_count from public.business_inventory i join public.businesses b on b.id=i.business_id where i.resource_code=resource.code and i.quantity>0 and i.available_for_sale and i.selling_price>0 and b.status='active';
  select sum((.5+b.reputation/100)/power(greatest(i.selling_price/resource.base_price,.1),1.6)) into score_sum from public.business_inventory i join public.businesses b on b.id=i.business_id where i.resource_code=resource.code and i.quantity>0 and i.available_for_sale and i.selling_price>0 and b.status='active';
  for offer in select i.*,b.bank_account_id,b.economic_sector_id,b.region_code,b.owner_id,b.name,b.control_kind,(.5+b.reputation/100)/power(greatest(i.selling_price/resource.base_price,.1),1.6) score from public.business_inventory i join public.businesses b on b.id=i.business_id where i.resource_code=resource.code and i.quantity>0 and i.available_for_sale and i.selling_price>0 and b.status='active' order by b.id for update of i loop
   v_quantity:=least(private.unreserved_company_stock(offer.business_id,resource.code,p_day),offer.quantity,trunc(budget*offer.score/greatest(score_sum,.00001)/offer.selling_price/1.25,3));
   if v_quantity<=0 then continue;end if;
   amount:=round(v_quantity*offer.selling_price,2);if amount<=0 then continue;end if;
   q:=public.quote_legal_levies('purchase',amount,true,offer.economic_sector_id,resource.name,NULL,offer.region_code);
   if (q->>'restricted')::boolean then continue;end if;
   total:=(q->>'total_debited')::numeric;net:=(q->>'net_amount')::numeric;
   select * into population from public.accounts where account_kind='population';
   if total>population.balance or spent+total>total_budget then continue;end if;
   if not exists(select 1 from public.accounts where id=offer.bank_account_id and business_id=offer.business_id) then raise exception 'Conta do fornecedor indisponível.';end if;
   update public.accounts set balance=balance-total,updated_at=now() where id=population.id;
   update public.accounts set balance=balance+net,updated_at=now() where id=offer.bank_account_id;
   update public.government_finances set treasury_balance=treasury_balance+total-net,updated_at=now() where id=1;
   if not found then raise exception 'Tesouro indisponível para recolhimento.';end if;
   update public.business_inventory set quantity=public.business_inventory.quantity-v_quantity,updated_at=now() where business_id=offer.business_id and resource_code=resource.code;
   insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key) values(population.id,offer.bank_account_id,amount,'population_purchase','Consumo da população: '||offer.name,q||jsonb_build_object('business_id',offer.business_id,'resource_code',resource.code,'quantity',v_quantity,'operation_date',p_day),md5('population-demand:'||p_day||':'||offer.business_id||':'||resource.code)::uuid) returning id into tx;
   insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key,accounting_date) values(offer.business_id,'revenue',amount,'Venda para a população: '||resource.name,jsonb_build_object('kind','population_sale','transaction_id',tx,'quantity',v_quantity),'population-sale:'||p_day||':'||resource.code,p_day);
   if (q->>'seller_tax')::numeric>0 then insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key,accounting_date) values(offer.business_id,'tax',-(q->>'seller_tax')::numeric,'Tributos sobre consumo da população',q,'population-tax:'||p_day||':'||resource.code,p_day);end if;
   if total>net then insert into public.government_revenues(revenue_type,source_table,source_id,business_id,amount,occurred_at_rp,metadata) values('consumption_tax','transactions',tx::text,offer.business_id,total-net,public.rp_now(),q);end if;
   update public.business_daily_operations set sold_quantity=sold_quantity+v_quantity,revenue=revenue+amount where business_id=offer.business_id and operation_date=p_day;
   spent:=spent+total;
  end loop;
 end loop;
 spent:=spent+private.simulate_retail_demand(p_day,greatest(0,total_budget-spent));
 insert into private.population_demand_runs(operation_date,spent) values(p_day,spent);
 return spent;
end $function$;
CREATE OR REPLACE FUNCTION private.run_company_economy()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b record; company_row public.businesses%rowtype; start_day date; day date; result jsonb; cycles integer:=0; processed integer:=0; sold numeric:=0; period_start date:=date_trunc('week',now())::date-7;
begin
 perform pg_advisory_xact_lock(hashtext('govrp:stock-market'));
 perform pg_advisory_xact_lock(hashtextextended('govrp:company-economy',0));
 perform private.manage_autonomous_enterprises((statement_timestamp() at time zone 'America/Sao_Paulo')::date);
 -- A common lock order keeps payroll, capital and B2B settlement atomic with the hourly engine.
 perform id from public.businesses order by id for update;
 perform id from public.accounts order by id for update;
 select greatest(current_date-6,coalesce(min(coalesce(last_simulated_on+1,created_at::date)),current_date)) into start_day from public.businesses where status='active' and region_code is not null;
 for day in select generate_series(start_day,current_date,interval '1 day')::date loop
  for b in select id from public.businesses where status='active' and region_code is not null and created_at::date<=day and (last_simulated_on is null or last_simulated_on<day) order by id loop
   perform private.simulate_company_day(b.id,day);processed:=processed+1;
  end loop;
  perform private.sync_population_marketplace();
  sold:=sold+private.simulate_population_demand(day);
 end loop;
 for company_row in select * from public.businesses where status in('active','suspended') order by id loop
  if company_row.last_fiscal_cycle_at+interval '7 days'<=now() then
   perform private.pay_company_wages(company_row.id);
   while company_row.last_fiscal_cycle_at+interval '7 days'<=now() loop
    result:=private.close_company_fiscal_cycle(company_row.id,now());
    exit when result is null;
    cycles:=cycles+1;
    select * into company_row from public.businesses where id=company_row.id;
   end loop;
  end if;
 end loop;
 update public.business_supply_contracts set status='expired' where status='active' and ends_at<=now();
 insert into public.business_national_cycles(cycle_start,cycle_end,revenue,profit,employment,output,company_count,by_region)
 select period_start,period_start+7,coalesce(sum(d.revenue),0),coalesce(sum(d.revenue-d.payroll_accrued-d.input_cost-d.overhead),0),(select count(*) from public.business_employees where fired_at is null),coalesce(sum(d.produced_quantity),0),(select count(*) from public.businesses where status='active'),coalesce((select jsonb_object_agg(region_code,stats) from(select biz.region_code,jsonb_build_object('revenue',sum(x.revenue),'output',sum(x.produced_quantity),'companies',count(distinct biz.id)) stats from public.business_daily_operations x join public.businesses biz on biz.id=x.business_id where x.operation_date>=period_start and x.operation_date<period_start+7 and biz.region_code is not null group by biz.region_code) regions),'{}'::jsonb) from public.business_daily_operations d where d.operation_date>=period_start and d.operation_date<period_start+7
 on conflict(cycle_start) do nothing;
 perform private.close_state_enterprise_cycles();
 return jsonb_build_object('success',true,'processed_company_days',processed,'closed_cycles',cycles,'population_spending',sold,'processed_at',now());
end $function$;

COMMIT;
