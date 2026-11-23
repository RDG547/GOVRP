BEGIN;
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
 -- A company that lacked inputs during its first week must be able to
 -- discover demand after supply returns. One small weekly batch, never free.
 IF p_day-b.created_at::date>=7 AND mod(p_day-b.created_at::date,7)=0
  AND forecast=0 AND output_stock<units*recipe.output_quantity*.25
  AND (private.household_category(recipe.output_resource,false) IS NOT NULL OR contracted>0
    OR EXISTS(SELECT 1 FROM public.business_recipes r JOIN public.businesses buyer ON buyer.business_type_id=r.business_type_id
       WHERE buyer.status='active' AND r.inputs ? recipe.output_resource)) THEN
  forecast:=units*recipe.output_quantity*.125;
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
CREATE OR REPLACE FUNCTION private.sync_population_marketplace(p_business_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE offer record;market public.state_enterprises%rowtype;policy public.state_enterprises%rowtype;pid uuid;fee numeric;BEGIN
 IF auth.uid() IS NOT NULL AND NOT public.has_full_admin_access() THEN RETURN;END IF;
 SELECT * INTO market FROM public.state_enterprises WHERE service_key='marketplace' AND is_active;
 IF market.id IS NULL THEN RETURN;END IF;
 PERFORM pg_advisory_xact_lock(hashtext('govrp:stock-market'));
 FOR offer IN SELECT p.id product_id,p.business_id,p.resource_code,p.stock,i.quantity
  FROM public.products p JOIN public.businesses b ON b.id=p.business_id
  JOIN public.business_inventory i ON i.business_id=b.id AND i.resource_code=p.resource_code
  WHERE b.control_kind='population' AND b.owner_id IS NULL AND b.status='active'
   AND (p_business_id IS NULL OR b.id=p_business_id) AND p.moderation_status='approved'
   AND p.listing_status='active' AND (p.listing_paid_until IS NULL OR p.listing_paid_until>clock_timestamp())
   AND i.available_for_sale AND p.stock>=0
  ORDER BY p.id FOR UPDATE OF p,i LOOP
  -- Top up only from actual unreserved production. Reducing listing stock
  -- would invoke the settlement trigger, so never use it to cancel a reserve.
  fee:=floor((private.unreserved_company_stock(offer.business_id,offer.resource_code,
     (statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date)+offer.stock)*.25);
  IF fee>offer.stock THEN
   PERFORM set_config('govrp.physical_listing_authorized',offer.business_id::text,true);
   UPDATE public.products SET stock=fee::integer,stock_depleted_at=NULL WHERE id=offer.product_id;
   PERFORM set_config('govrp.physical_listing_authorized','',true);
  END IF;
 END LOOP;
 FOR offer IN SELECT b.id,b.name,i.resource_code,i.quantity,i.selling_price,r.name resource_name,r.is_service
 FROM public.businesses b JOIN public.business_inventory i ON i.business_id=b.id JOIN public.economic_resources r ON r.code=i.resource_code JOIN public.accounts a ON a.id=b.bank_account_id
 WHERE (p_business_id IS NULL OR b.id=p_business_id) AND b.control_kind='population' AND b.owner_id IS NULL AND b.status='active' AND i.available_for_sale AND i.quantity>=1 AND i.selling_price>0
 AND a.balance>=CASE WHEN market.active_listing_fee_enabled THEN market.active_listing_fee_amount ELSE 0 END
 AND NOT EXISTS(SELECT 1 FROM public.products WHERE business_id=b.id AND resource_code=i.resource_code)
 ORDER BY b.id,i.resource_code LIMIT 50 LOOP
  BEGIN
   IF private.unreserved_company_stock(offer.id,offer.resource_code,(statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date)<4 THEN CONTINUE;END IF;
   policy:=private.marketplace_seller_policy(market,offer.id,false);fee:=CASE WHEN policy.active_listing_fee_enabled THEN policy.active_listing_fee_amount ELSE 0 END;
   PERFORM set_config('govrp.physical_listing_authorized',offer.id::text,true);
   INSERT INTO public.products(seller_id,business_id,name,description,price,product_type,category,stock,resource_code,is_final_good,moderation_status,consumable_effects)
   VALUES(NULL,offer.id,offer.resource_name,'Oferta da empresa '||offer.name||', vinculada ao estoque produzido. Quantidade por unidade do recurso.',offer.selling_price,'one-time','Insumos',floor(private.unreserved_company_stock(offer.id,offer.resource_code,(statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date)*.25)::int,offer.resource_code,offer.is_service OR offer.resource_code IN('energy','food','drinks','bread','meals','retail_food','retail_electronics','retail_clothing','retail_medicine','retail_vehicles'),'approved','{}') RETURNING id INTO pid;
   PERFORM private.activate_marketplace_listing(pid,fee,policy.active_listing_fee_period,md5('npc-marketplace:'||offer.id||':'||offer.resource_code)::uuid);
   PERFORM set_config('govrp.physical_listing_authorized','',true);
  EXCEPTION WHEN OTHERS THEN RAISE LOG 'GOVRP NPC listing refused for company % resource % [%]: %',offer.id,offer.resource_code,sqlstate,sqlerrm;END;
 END LOOP;
END $function$;

COMMIT;
