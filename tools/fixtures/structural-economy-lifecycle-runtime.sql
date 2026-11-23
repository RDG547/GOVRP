CREATE OR REPLACE FUNCTION private.adjust_population_company(p_business_id uuid, p_net numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.businesses%rowtype;kind public.business_types%rowtype;role public.business_role_templates%rowtype;employee public.business_employees%rowtype;cash numeric;headcount integer;wages numeric;sold_ratio numeric;new_price numeric;
begin
 select * into b from public.businesses where id=p_business_id and control_kind='population' for update;if not found then return;end if;
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
 update public.businesses set employees=(select count(*) from public.business_employees where business_id=b.id and fired_at is null),price_multiplier=new_price,operational_status=case when loss_cycles>=6 and cash<wages/7 then 'closed' else operational_status end,is_for_sale=case when loss_cycles>=3 then true else is_for_sale end,sale_price=case when loss_cycles>=3 then greatest(1,market_value*.8) else sale_price end,metadata=metadata||jsonb_build_object('last_population_decision',jsonb_build_object('at',now(),'net_result',p_net,'sold_ratio',sold_ratio,'price_multiplier',new_price)),updated_at=now() where id=b.id;
 update public.business_inventory i set selling_price=round(r.base_price*new_price,2),updated_at=now() from public.economic_resources r where i.business_id=b.id and i.resource_code=r.code and i.price_policy='automatic';
 perform private.regularize_population_company(b.id);
end $function$;
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
END $function$;
CREATE OR REPLACE FUNCTION private.simulate_retail_demand(p_day date, p_budget numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE a uuid;offer record;i integer;spent numeric:=0;result jsonb;key uuid;BEGIN
 IF p_budget IS NULL OR p_budget<=0 THEN RETURN 0;END IF;
 SELECT id INTO a FROM public.accounts WHERE account_kind='population' ORDER BY id LIMIT 1;
 IF a IS NULL THEN RETURN 0;END IF;
 -- Stable daily rotation avoids always favoring the first company, while price,
 -- stock, moderation, legal restrictions and finite cash remain authoritative.
 FOR offer IN SELECT p.id,p.stock,p.price FROM public.products p JOIN public.businesses b ON b.id=p.business_id
 WHERE b.status='active' AND p.product_type='one-time' AND p.is_final_good AND p.stock>0 AND p.price>0 AND p.moderation_status='approved' AND p.archived_at IS NULL
 ORDER BY p.price/power(greatest(b.reputation,1),.2),md5(p_day::text||p.id::text) LIMIT 12 LOOP
  FOR i IN 1..least(5,offer.stock) LOOP
   IF spent>=p_budget THEN EXIT;END IF;
   key:=md5('retail-population:'||p_day||':'||offer.id||':'||i)::uuid;
   BEGIN
    result:=private.buy_product_authoritative(NULL,offer.id,'balance',NULL,key,NULL,a,'population',p_budget-spent);
    spent:=spent+(result->>'total')::numeric;
   EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'GOVRP retail demand %, product % refused [%]: %',p_day,offer.id,sqlstate,sqlerrm;
    EXIT;
   END;
  END LOOP;
 END LOOP;
 RETURN spent;
END $function$;
CREATE OR REPLACE FUNCTION private.supply_population_company_from_marketplace(p_business_id uuid,p_resource text,p_quantity numeric,p_day date) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.businesses%rowtype;offer record;n int:=0;i int;limit_units int;cash numeric;reserved numeric;budget numeric;result jsonb;spent numeric:=0;BEGIN
 IF auth.uid() IS NOT NULL AND NOT public.has_full_admin_access() THEN RETURN 0;END IF;
 SELECT * INTO b FROM public.businesses WHERE id=p_business_id AND control_kind='population' AND owner_id IS NULL AND status='active';
 IF b.id IS NULL OR p_quantity<1 THEN RETURN 0;END IF;
 SELECT balance INTO cash FROM public.accounts WHERE id=b.bank_account_id;
 SELECT coalesce(sum(wage_due),0) INTO reserved FROM public.business_employees WHERE business_id=b.id;
 budget:=greatest(0,cash-reserved)*.2;limit_units:=least(20,floor(p_quantity)::int);
 FOR offer IN SELECT p.id,p.stock FROM public.products p JOIN public.businesses seller ON seller.id=p.business_id JOIN public.economic_resources r ON r.code=p.resource_code
 WHERE p.business_id<>b.id AND p.resource_code=p_resource AND p.product_type='one-time' AND p.stock>0 AND p.moderation_status='approved' AND p.archived_at IS NULL AND seller.status='active' AND p.price<=r.base_price*3
 ORDER BY p.price,seller.reputation DESC,p.id LIMIT 5 LOOP
  FOR i IN 1..least(offer.stock,limit_units-n) LOOP
   IF n>=limit_units OR spent>=budget THEN RETURN spent;END IF;
   BEGIN
    result:=private.buy_product_authoritative(NULL,offer.id,'balance',NULL,md5('npc-retail-supply:'||b.id||':'||p_day||':'||offer.id||':'||i)::uuid,NULL,b.bank_account_id,'business',budget-spent);
    spent:=spent+(result->>'total')::numeric;n:=n+1;
   EXCEPTION WHEN OTHERS THEN RAISE LOG 'GOVRP NPC marketplace supply refused for company % [%]: %',b.id,sqlstate,sqlerrm;EXIT;END;
  END LOOP;
 END LOOP;RETURN spent;
END $$;
