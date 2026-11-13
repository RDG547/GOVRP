-- Balance population demand between real National Market consumption and direct company offers.
-- Respect administrator-configured simulated/player shares; do not reprocess previous days.
BEGIN;

CREATE OR REPLACE FUNCTION private.simulate_population_demand(p_day date)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare resource public.economic_resources%rowtype; offer record; population public.accounts%rowtype; macro public.economic_state%rowtype; total_budget numeric; budget numeric; spent numeric:=0; v_quantity numeric; total numeric; net numeric; amount numeric; q jsonb; tx uuid; score_sum numeric;retail_share numeric:=.3;population_scale numeric:=1;inflation numeric:=0;employment numeric:=1; resource_count integer; player_count integer; npc_count integer; active_direct_offers boolean:=false; market_share numeric:=.5;
begin
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
 select count(*) into resource_count
 from public.economic_resources e
 where (e.is_service or e.code in('energy','food','drinks','bread','meals','retail_food','retail_electronics','retail_clothing','retail_medicine','retail_vehicles'))
   and exists(select 1 from public.business_inventory i join public.businesses b on b.id=i.business_id
              where i.resource_code=e.code and i.quantity>0 and i.available_for_sale and i.selling_price>0 and b.status='active');
 for resource in
   select e.* from public.economic_resources e
   where (e.is_service or e.code in('energy','food','drinks','bread','meals','retail_food','retail_electronics','retail_clothing','retail_medicine','retail_vehicles'))
     and exists(select 1 from public.business_inventory i join public.businesses b on b.id=i.business_id
                where i.resource_code=e.code and i.quantity>0 and i.available_for_sale and i.selling_price>0 and b.status='active')
   order by e.code
 loop
  budget:=greatest(0,total_budget-spent)*(1-retail_share)/greatest(resource_count,1);
  select count(*) filter(where b.control_kind='player'),count(*) filter(where b.control_kind='population') into player_count,npc_count from public.business_inventory i join public.businesses b on b.id=i.business_id where i.resource_code=resource.code and i.quantity>0 and i.available_for_sale and i.selling_price>0 and b.status='active';
  select sum((.5+b.reputation/100)/power(greatest(i.selling_price/resource.base_price,.1),1.6)*case when player_count=0 or npc_count=0 then 1 else case when b.control_kind='player' then coalesce(macro.player_share,.2)/player_count else coalesce(macro.simulated_share,.8)/npc_count end end) into score_sum from public.business_inventory i join public.businesses b on b.id=i.business_id where i.resource_code=resource.code and i.quantity>0 and i.available_for_sale and i.selling_price>0 and b.status='active';
  for offer in select i.*,b.bank_account_id,b.economic_sector_id,b.region_code,b.owner_id,b.name,b.control_kind,(.5+b.reputation/100)/power(greatest(i.selling_price/resource.base_price,.1),1.6)*case when player_count=0 or npc_count=0 then 1 else case when b.control_kind='player' then coalesce(macro.player_share,.2)/player_count else coalesce(macro.simulated_share,.8)/npc_count end end score from public.business_inventory i join public.businesses b on b.id=i.business_id where i.resource_code=resource.code and i.quantity>0 and i.available_for_sale and i.selling_price>0 and b.status='active' order by b.id for update of i loop
   v_quantity:=least(offer.quantity,trunc(budget*offer.score/greatest(score_sum,.00001)/offer.selling_price/1.25,3));
   if v_quantity<=0 then continue;end if;
   amount:=round(v_quantity*offer.selling_price,2);if amount<=0 then continue;end if;
   q:=public.quote_legal_levies('purchase',amount,true,offer.economic_sector_id,resource.name,NULL,offer.region_code);
   if (q->>'restricted')::boolean then continue;end if;
   total:=(q->>'total_debited')::numeric;net:=(q->>'net_amount')::numeric;
   select * into population from public.accounts where account_kind='population';
   if total>population.balance or spent+total>total_budget then continue;end if;
   update public.accounts set balance=balance-total,updated_at=now() where id=population.id;
   update public.accounts set balance=balance+net,updated_at=now() where id=offer.bank_account_id;
   update public.government_finances set treasury_balance=treasury_balance+total-net,updated_at=now() where id=1;
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
end $function$
;

COMMIT;
