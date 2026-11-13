-- Empresa e Mercado Nacional: equilíbrio da demanda real, rodízio de compras e
-- acesso voluntário a insumos físicos existentes, sem dinheiro nem estoque artificiais.
-- Mudanças valem para próximos ciclos, sem reprocessar histórico ou saldos.
BEGIN;

CREATE OR REPLACE FUNCTION private.simulate_population_demand(p_day date)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare resource public.economic_resources%rowtype; offer record; population public.accounts%rowtype; macro public.economic_state%rowtype; total_budget numeric; budget numeric; spent numeric:=0; v_quantity numeric; total numeric; net numeric; amount numeric; q jsonb; tx uuid; score_sum numeric;retail_share numeric:=.3;population_scale numeric:=1;inflation numeric:=0;employment numeric:=1; resource_count integer; player_count integer; npc_count integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('govrp:population-demand:'||p_day,0));
 if exists(select 1 from private.population_demand_runs where operation_date=p_day) then return 0;end if;
 select * into population from public.accounts where account_kind='population' for update;
 select * into macro from public.economic_state where id=true;
 total_budget:=least(50000,greatest(0,population.balance)*.1)*(.5+coalesce(macro.consumer_confidence,50)/100);
 select least(1,greatest(.01,coalesce(sum(population_count),0)::numeric/200000000)) into population_scale from public.country_population_segments where country_code='BR';
 select greatest(0,coalesce((economic_current->>'inflation')::numeric,0)),greatest(.05,1-coalesce((economic_current->>'unemployment')::numeric,0)/100) into inflation,employment from public.country_rp_states where country_code='BR';
 total_budget:=round(total_budget*population_scale*coalesce(employment,1)/(1+coalesce(inflation,0)/100),2);
 perform private.procure_national_market(p_day); spent:=private.consume_national_market(p_day,total_budget); -- Allocate household purchasing power only to categories that currently have genuine offers.
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

CREATE OR REPLACE FUNCTION private.procure_national_market(p_day date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE row record;population numeric;BEGIN
 SELECT coalesce(sum(population_count),0) INTO population FROM public.country_population_segments WHERE country_code='BR';
 UPDATE public.national_market_references r
 SET unit_price=round(greatest(.01,least(r.base_price*2,greatest(
   r.base_price*.5,
   coalesce((SELECT avg(i.unit_cost)*1.1 FROM public.business_inventory i WHERE i.resource_code=r.resource_code AND i.quantity>0),r.base_price),
   r.base_price*(1+least(.25,greatest(-.25,
     (population*r.per_capita_daily-coalesce((SELECT sum(s.quantity) FROM public.national_market_stock s WHERE s.resource_code=r.resource_code),0))
       /greatest(1,population*r.per_capita_daily)*.1
   )))
 ))),2),updated_at=clock_timestamp(),version=version+1
 WHERE r.automatic_price;
 FOR row IN SELECT i.business_id,i.resource_code FROM public.business_inventory i JOIN public.businesses b ON b.id=i.business_id WHERE b.status='active' AND b.national_market_auto AND i.quantity>0 AND i.available_for_sale ORDER BY md5(p_day::text||':'||i.business_id::text||':'||i.resource_code),i.business_id,i.resource_code LOOP
  PERFORM private.buy_national_production(row.business_id,row.resource_code,md5('national-auto:'||p_day||':'||row.business_id||':'||row.resource_code)::uuid,NULL);
 END LOOP;
END $function$
;

CREATE OR REPLACE FUNCTION public.get_national_production_catalog(p_business uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para consultar o Mercado Nacional.' USING errcode='42501';END IF;
 RETURN jsonb_build_object('budget',(SELECT a.balance FROM public.accounts a JOIN public.state_enterprises s ON s.id=a.state_enterprise_id WHERE s.service_key='national_market' AND a.account_kind='national_market'),
 'references',(SELECT coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('name',e.name,'unit',e.unit,'is_service',e.is_service,'stock',coalesce(s.quantity,0)) ORDER BY e.name),'[]') FROM public.national_market_references r JOIN public.economic_resources e ON e.code=r.resource_code LEFT JOIN public.national_market_stock s ON s.resource_code=r.resource_code),
 'offers',(SELECT coalesce(jsonb_agg(jsonb_build_object('business_id',b.id,'company_name',b.name,'resource_code',e.code,'name',e.name,'unit',e.unit,'is_service',e.is_service,'quantity',CASE WHEN i.available_for_sale THEN coalesce(i.quantity,0) ELSE 0 END,'unit_price',r.unit_price,'automatic',b.national_market_auto) ORDER BY b.name,e.name),'[]') FROM public.businesses b JOIN public.business_recipes recipe ON recipe.business_type_id=b.business_type_id JOIN public.economic_resources e ON e.code=recipe.output_resource LEFT JOIN public.business_inventory i ON i.business_id=b.id AND i.resource_code=e.code LEFT JOIN public.national_market_references r ON r.resource_code=e.code WHERE b.status='active' AND (p_business IS NULL OR b.id=p_business)),
 'input_needs',(SELECT coalesce(jsonb_agg(jsonb_build_object(
    'business_id',b.id,'company_name',b.name,'resource_code',e.code,'name',e.name,'unit',e.unit,
    'required_per_unit',input.value::numeric,
    'market_stock',coalesce(stock.quantity,0),
    'wholesale_available',greatest(0,trunc((coalesce(stock.quantity,0)+coalesce(daily.sold_qty,0))*0.25,3)-coalesce(daily.sold_qty,0)),
    'company_stock',coalesce(inventory.quantity,0),
    'unit_price',round(greatest(ref.unit_price,coalesce(stock.unit_cost,0)*1.05),2)
  ) ORDER BY b.name,e.name),'[]'::jsonb)
  FROM public.businesses b
  JOIN public.business_recipes recipe ON recipe.business_type_id=b.business_type_id
  JOIN LATERAL jsonb_each_text(recipe.inputs) input ON true
  JOIN public.economic_resources e ON e.code=input.key AND NOT e.is_service
  JOIN public.national_market_references ref ON ref.resource_code=e.code
  LEFT JOIN public.national_market_stock stock ON stock.resource_code=e.code
  LEFT JOIN public.business_inventory inventory ON inventory.business_id=b.id AND inventory.resource_code=e.code
  LEFT JOIN LATERAL (
    SELECT coalesce(sum((t.metadata->>'quantity')::numeric),0) sold_qty
    FROM public.transactions t
    WHERE t.type='business_supply'
      AND t.metadata->>'national_market_input'='true'
      AND t.metadata->>'resource_code'=e.code
      AND t.created_at>=date_trunc('day',statement_timestamp())
      AND t.created_at<date_trunc('day',statement_timestamp())+interval '1 day'
  ) daily ON true
  WHERE b.status='active' AND b.owner_id=auth.uid()
    AND (p_business IS NULL OR b.id=p_business)),
 'purchases',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC),'[]') FROM (SELECT p.id,p.business_id,p.resource_code,p.quantity,p.unit_price,p.gross_amount,p.net_amount,p.is_service,p.created_at FROM public.national_market_purchases p WHERE (p_business IS NULL OR p.business_id=p_business) AND (public.has_full_admin_access() OR EXISTS(SELECT 1 FROM public.businesses b WHERE b.id=p.business_id AND b.owner_id=auth.uid())) ORDER BY p.created_at DESC LIMIT 100)x));
END $function$
;

-- A player-initiated wholesale purchase uses only ALREADY OWNED physical National Market stock.
-- No fictitious resources, imports, automatic company debt or unbacked transfers.
CREATE OR REPLACE FUNCTION public.buy_company_input_from_national_market(
  p_business uuid, p_resource text, p_quantity numeric, p_key uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $company_market$
DECLARE
 b public.businesses%rowtype;
 m public.accounts%rowtype;
 company_cash public.accounts%rowtype;
 r public.national_market_references%rowtype;
 stock public.national_market_stock%rowtype;
 previous public.transactions%rowtype;
 unit_price numeric; amount numeric; gross numeric; net numeric;
 max_wholesale numeric; daily_wholesale numeric:=0; quote jsonb; tx uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT private.can_manage_company(p_business,auth.uid()) THEN
   RAISE EXCEPTION 'A compra exige autorização de gestão empresarial.' USING errcode='42501';
 END IF;
 IF p_key IS NULL OR p_business IS NULL OR p_resource IS NULL
   OR p_quantity IS NULL OR p_quantity<=0 OR p_quantity>100
   OR p_quantity<>trunc(p_quantity,3) THEN
   RAISE EXCEPTION 'Identificação, recurso ou quantidade inválidos.';
 END IF;

 -- Match the economy motor's global ordering and protect concurrent purchases.
 PERFORM pg_advisory_xact_lock(hashtext('govrp:stock-market'));
 PERFORM pg_advisory_xact_lock(hashtextextended('govrp:company-economy',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('govrp:wholesale:'||p_key,0));

 SELECT * INTO previous FROM public.transactions WHERE idempotency_key=p_key;
 IF previous.id IS NOT NULL THEN
   IF previous.type <> 'business_supply'
      OR coalesce(previous.metadata->>'national_market_input','false') <> 'true'
      OR previous.metadata->>'business_id' IS DISTINCT FROM p_business::text
      OR previous.metadata->>'resource_code' IS DISTINCT FROM p_resource
      OR (previous.metadata->>'quantity')::numeric IS DISTINCT FROM p_quantity
      OR previous.metadata->>'actor_id' IS DISTINCT FROM auth.uid()::text
   THEN RAISE EXCEPTION 'Esta identificação pertence a uma operação diferente.'; END IF;
   RETURN jsonb_build_object('success',true,'idempotent',true,'transaction_id',previous.id,
      'quantity',p_quantity,'total_debited',previous.metadata->'total_debited');
 END IF;

 SELECT * INTO b FROM public.businesses WHERE id=p_business AND status='active' FOR UPDATE;
 IF b.id IS NULL THEN RAISE EXCEPTION 'Empresa indisponível para abastecimento.';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.business_recipes recipe
   WHERE recipe.business_type_id=b.business_type_id AND recipe.inputs ? p_resource
     AND (recipe.inputs->>p_resource)::numeric>0)
 THEN RAISE EXCEPTION 'O recurso não é insumo da atividade desta empresa.';END IF;

 SELECT * INTO r FROM public.national_market_references WHERE resource_code=p_resource FOR SHARE;
 IF r.resource_code IS NULL OR r.unit_price<=0 OR EXISTS(
   SELECT 1 FROM public.economic_resources e WHERE e.code=p_resource AND e.is_service
 ) THEN RAISE EXCEPTION 'Recurso físico indisponível no Mercado Nacional.';END IF;
 SELECT * INTO stock FROM public.national_market_stock WHERE resource_code=p_resource FOR UPDATE;
 IF stock.resource_code IS NULL OR stock.quantity<=0 THEN
   RETURN jsonb_build_object('success',false,'reason','Sem estoque físico disponível no Mercado Nacional.');
 END IF;

 -- A GLOBAL per-resource daily cap prevents repeated buys from draining reserves.
 -- Daily wholesale volume is counted from confirmed financial transactions.
 SELECT coalesce(sum((t.metadata->>'quantity')::numeric),0) INTO daily_wholesale
 FROM public.transactions t
 WHERE t.type='business_supply'
   AND t.metadata->>'national_market_input'='true'
   AND t.metadata->>'resource_code'=p_resource
   AND t.created_at>=date_trunc('day',statement_timestamp())
   AND t.created_at<date_trunc('day',statement_timestamp())+interval '1 day';
 max_wholesale:=greatest(0,trunc((stock.quantity+daily_wholesale)*0.25,3)-daily_wholesale);
 IF p_quantity>max_wholesale THEN
   RETURN jsonb_build_object('success',false,'reason','Quantidade superior à parcela disponível para fornecimento empresarial.',
       'max_quantity',max_wholesale);
 END IF;

 SELECT a.* INTO m FROM public.accounts a
 JOIN public.state_enterprises se ON se.id=a.state_enterprise_id
 WHERE a.account_kind='national_market' AND se.service_key='national_market' AND se.is_active;
 IF m.id IS NULL THEN RAISE EXCEPTION 'Conta oficial do Mercado Nacional não encontrada.';END IF;
 IF b.bank_account_id=m.id THEN RAISE EXCEPTION 'Conta compradora inválida.';END IF;
 PERFORM id FROM public.accounts WHERE id IN(b.bank_account_id,m.id) ORDER BY id FOR UPDATE;
 SELECT * INTO company_cash FROM public.accounts WHERE id=b.bank_account_id AND business_id=b.id;
 IF company_cash.id IS NULL THEN RAISE EXCEPTION 'Conta empresarial oficial indisponível.';END IF;

 -- Respect configured market reference while protecting the national stock's paid cost.
 unit_price:=round(greatest(r.unit_price,coalesce(stock.unit_cost,0)*1.05),2);
 amount:=round(p_quantity*unit_price,2);
 IF amount<=0 THEN RAISE EXCEPTION 'Quantidade inferior ao mínimo monetário.';END IF;
 quote:=public.quote_legal_levies('purchase',amount,true,NULL::uuid,'Insumos',NULL,b.region_code);
 IF coalesce((quote->>'restricted')::boolean,false) THEN
   RAISE EXCEPTION 'Operação bloqueada pela legislação vigente.';
 END IF;
 gross:=(quote->>'total_debited')::numeric;net:=(quote->>'net_amount')::numeric;
 IF gross IS NULL OR net IS NULL OR gross<=0 OR net<0 OR net>gross THEN
   RAISE EXCEPTION 'Tributação inválida para abastecimento empresarial.';
 END IF;
 IF company_cash.balance<gross THEN
   RETURN jsonb_build_object('success',false,'reason','Saldo empresarial insuficiente para produto e tributos.',
     'total_debited',gross);
 END IF;

 UPDATE public.national_market_stock SET quantity=quantity-p_quantity,updated_at=clock_timestamp()
 WHERE resource_code=p_resource AND quantity>=p_quantity;
 IF NOT FOUND THEN RAISE EXCEPTION 'Estoque físico alterado durante a compra.';END IF;
 UPDATE public.accounts SET balance=balance-gross,updated_at=clock_timestamp() WHERE id=b.bank_account_id;
 UPDATE public.accounts SET balance=balance+net,updated_at=clock_timestamp() WHERE id=m.id;
 IF gross>net THEN
   UPDATE public.government_finances
   SET treasury_balance=treasury_balance+(gross-net),updated_at=clock_timestamp() WHERE id=1;
   IF NOT FOUND THEN RAISE EXCEPTION 'Tesouro indisponível para tributos.';END IF;
 END IF;
 INSERT INTO public.business_inventory(business_id,resource_code,quantity,unit_cost)
 VALUES(b.id,p_resource,p_quantity,gross/p_quantity)
 ON CONFLICT (business_id,resource_code) DO UPDATE
 SET unit_cost=(public.business_inventory.quantity*public.business_inventory.unit_cost+gross)
              /(public.business_inventory.quantity+p_quantity),
     quantity=public.business_inventory.quantity+p_quantity,updated_at=clock_timestamp();

 INSERT INTO public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key)
 VALUES(b.bank_account_id,m.id,amount,'business_supply','Insumo do estoque físico do Mercado Nacional: '||p_resource,
   quote||jsonb_build_object('business_id',b.id,'resource_code',p_resource,'quantity',p_quantity,
      'national_market',true,'national_market_input',true,'buyer_kind','business',
      'final_consumption',false,'unit_price',unit_price,'actor_id',auth.uid()),p_key)
 RETURNING id INTO tx;
 INSERT INTO public.business_transactions(business_id,type,amount,description,metadata,operation_key)
 VALUES(b.id,'other',-gross,'Compra de insumos do Mercado Nacional: '||p_resource,
   jsonb_build_object('kind','inventory_purchase','national_market',true,
        'resource_code',p_resource,'quantity',p_quantity,'transaction_id',tx),
   'national-input:'||p_key);
 IF gross>net THEN
   INSERT INTO public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,business_id,amount,occurred_at_rp,metadata)
   VALUES('consumption_tax','transactions',tx::text,auth.uid(),b.id,gross-net,public.rp_now(),
      quote||jsonb_build_object('national_market_input',true));
 END IF;
 RETURN jsonb_build_object('success',true,'idempotent',false,'transaction_id',tx,
   'quantity',p_quantity,'unit_price',unit_price,'total_debited',gross,'net_received_by_market',net);
END
$company_market$;

REVOKE ALL ON FUNCTION public.buy_company_input_from_national_market(uuid,text,numeric,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.buy_company_input_from_national_market(uuid,text,numeric,uuid)
  TO authenticated;

COMMIT;
