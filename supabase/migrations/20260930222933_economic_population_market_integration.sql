begin;
alter table public.documents alter column user_id drop not null;
alter table public.documents add constraint documents_entity_holder check(user_id is not null or (type='CNPJ' and metadata->>'entity_kind'='population_company' and metadata->>'business_id' is not null));
alter table public.business_inventory add column price_policy text not null default 'automatic' check(price_policy in('automatic','manual'));
create or replace function private.regularize_population_company(p_business_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare b public.businesses%rowtype;kind public.business_types%rowtype;doc uuid;fee numeric;quote jsonb;cash numeric;
begin
 select * into b from public.businesses where id=p_business_id and control_kind='population' for update;
 if b.id is null or b.cnpj_document_id is not null then return;end if;
 select * into kind from public.business_types where id=b.business_type_id;
 quote:=public.quote_legal_levies('license',0,true,kind.economic_sector_id,kind.id);
 if (quote->>'restricted')::boolean then return;end if;
 fee:=(quote->>'buyer_tax')::numeric;select balance into cash from public.accounts where id=b.bank_account_id for update;
 if cash<fee then return;end if;
 insert into public.documents(user_id,type,document_number,is_valid,full_name,metadata) values(null,'CNPJ',public.generate_unique_document_number('CNPJ'),true,b.name,jsonb_build_object('entity_kind','population_company','business_id',b.id,'business_type_id',kind.id,'activity_name',kind.name,'company_name',b.name)) returning id into doc;
 update public.businesses set cnpj_document_id=doc,metadata=metadata||jsonb_build_object('cnpj_regularization_required',false) where id=b.id;
 if fee>0 then
  update public.accounts set balance=balance-fee,updated_at=now() where id=b.bank_account_id;
  update public.government_finances set treasury_balance=treasury_balance+fee,updated_at=now() where id=1;
  insert into public.transactions(from_account_id,amount,type,description,metadata) values(b.bank_account_id,fee,'service_fee','Regularização da empresa da população',quote||jsonb_build_object('business_id',b.id,'treasury_credit',true));
  insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key) values(b.id,'tax',-fee,'Licenciamento da empresa da população',quote,'population-registration');
 end if;
end $$;
create or replace function private.transfer_company_document() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.owner_id is distinct from old.owner_id and new.cnpj_document_id is not null and new.owner_id is not null then
  update public.documents set user_id=new.owner_id,metadata=metadata||jsonb_build_object('business_id',new.id,'ownership_transferred_at',now(),'previous_holder',old.owner_id) where id=new.cnpj_document_id and type='CNPJ';
 end if;return new;
end $$;
create trigger company_document_holder after update of owner_id on public.businesses for each row execute function private.transfer_company_document();
create or replace function private.adjust_population_company(p_business_id uuid,p_net numeric) returns void language plpgsql security definer set search_path='' as $$
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
end $$;
CREATE OR REPLACE FUNCTION private.simulate_company_day(p_business_id uuid, p_day date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.businesses%rowtype; kind public.business_types%rowtype; region public.economic_regions%rowtype; recipe public.business_recipes%rowtype; employee public.business_employees%rowtype; item record; supplier record; contract record; cash numeric; available numeric; cost numeric:=0; wages numeric:=0; wage numeric; overhead numeric:=0; units numeric; work_efficiency numeric; skill numeric; headcount integer; boost numeric; resource_price numeric; population_account uuid; produced numeric:=0; result_status text:='operating'; input_quantity numeric; unit_cost numeric; tx uuid; contract_key uuid;
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
 if headcount<kind.min_employees then result_status:='understaffed';end if;
 -- Agreed standing orders are capped by quantity, price and expiry; no unrestricted auto-debit.
 for contract in select * from public.business_supply_contracts where buyer_business_id=b.id and status='active' and ends_at>p_day::timestamptz and (last_processed_on is null or last_processed_on<p_day) for update loop
  begin
   contract_key:=md5('supply-contract:'||contract.id||':'||p_day)::uuid;
   perform private.trade_company_resource(b.id,contract.seller_business_id,contract.resource_code,contract.daily_quantity,contract.max_unit_price,contract_key,contract.created_by);
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
   input_quantity:=greatest(0,round(units*item.required-coalesce(available,0),3));
   if input_quantity>0 then
    for supplier in select i.*,r.base_price from public.business_inventory i join public.businesses s on s.id=i.business_id join public.economic_resources r on r.code=i.resource_code where i.resource_code=item.key and i.business_id<>b.id and s.status='active' and i.available_for_sale and i.quantity>0 and i.selling_price<=r.base_price*2 order by i.selling_price,i.business_id limit 3 loop
     select balance into cash from public.accounts where id=b.bank_account_id;
     input_quantity:=least(input_quantity,supplier.quantity,round(greatest(0,cash-wages-kind.daily_overhead)/greatest(supplier.selling_price*1.5,.01),3));
     if input_quantity<=0 then exit;end if;
     begin perform private.trade_company_resource(b.id,supplier.business_id,item.key,input_quantity,supplier.selling_price,md5('npc-supply:'||b.id||':'||supplier.business_id||':'||item.key||':'||p_day)::uuid,null);
     exception when others then raise log 'GOVRP population supply % failed [%]: %',b.id,sqlstate,sqlerrm;end;
     exit;
    end loop;
   end if;
  end loop;
 end if;
 -- Every input limits physical production. Missing input never creates imaginary sales.
 for item in select key,value::numeric required from jsonb_each_text(recipe.inputs) loop
  select quantity into available from public.business_inventory where business_id=b.id and resource_code=item.key for update;
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
 insert into public.business_daily_operations(business_id,operation_date,produced_quantity,payroll_accrued,input_cost,overhead,productivity,status,metadata) values(b.id,p_day,produced,wages,round(cost,2),overhead,work_efficiency*100,result_status,jsonb_build_object('region_code',region.code,'headcount',headcount,'recipe_id',recipe.id,'effort_boost',coalesce(boost,0)));
 update public.businesses set employees=headcount,operational_status=case when loss_cycles>=3 and result_status='operating' then 'insolvent' else result_status end,productivity_index=least(300,work_efficiency*100),last_simulated_on=p_day,updated_at=now() where id=b.id;
end $function$;
CREATE OR REPLACE FUNCTION private.close_company_fiscal_cycle(p_business_id uuid, p_until timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.businesses%rowtype; revenue numeric; expenses numeric; wages numeric; taxes numeric; supplies numeric; net numeric; cash numeric; stock numeric; debt numeric; valuation numeric; previous_size text; new_size text; cycle public.business_balance_cycles%rowtype; start_at timestamptz;
begin
 select * into b from public.businesses where id=p_business_id for update;
 if b.id is null or p_until<b.last_fiscal_cycle_at+interval '7 days' then return null;end if;
 start_at:=b.last_fiscal_cycle_at;
 select coalesce(sum(amount) filter(where type='revenue'),0),-coalesce(sum(amount) filter(where type in('expense','monthly_cost','tax')),0),-coalesce(sum(amount) filter(where metadata->>'kind'='payroll_accrual'),0),-coalesce(sum(amount) filter(where type='tax'),0),-coalesce(sum(amount) filter(where metadata->>'kind'='input_consumption'),0) into revenue,expenses,wages,taxes,supplies from public.business_transactions where business_id=b.id and accounting_date>=start_at::date and accounting_date<(start_at+interval '7 days')::date;
 net:=revenue-expenses;
 select balance into cash from public.accounts where id=b.bank_account_id;
 select coalesce(sum(quantity*unit_cost),0) into stock from public.business_inventory where business_id=b.id;
 select coalesce(sum(wage_due),0) into debt from public.business_employees where business_id=b.id;
 valuation:=round(greatest(0,cash+stock-debt+greatest(0,net)*4+b.reputation*b.employees*20),2);
 new_size:=case when valuation>=20000000 and b.employees>=150 then 'national' when valuation>=5000000 and b.employees>=50 then 'large' when valuation>=1000000 and b.employees>=20 then 'medium' when valuation>=100000 and b.employees>=5 then 'small' else 'micro' end;
 insert into public.business_balance_cycles(business_id,owner_id,account_id,cycle_start_at,gross_revenue,operating_cost,net_result,result_type,metadata) values(b.id,b.owner_id,b.bank_account_id,start_at,revenue,expenses,net,case when net>=0 then 'profit' else 'loss' end,jsonb_build_object('period_end',start_at+interval '7 days','wages',wages,'taxes',taxes,'inputs',supplies,'cash_balance',cash,'inventory_value',stock,'wage_due',debt,'market_value',valuation,'size_class',new_size,'engine_version','2.0.0','profit_is_not_credited_again',true)) on conflict(business_id,cycle_start_at) where business_id is not null do nothing returning * into cycle;
 if cycle.id is null then return null;end if;
 update public.businesses set market_value=valuation,size_class=new_size,last_fiscal_cycle_at=start_at+interval '7 days',loss_cycles=case when net<0 then loss_cycles+1 else 0 end,operational_status=case when net<0 and loss_cycles>=2 then 'insolvent' else operational_status end,reputation=greatest(0,least(100,reputation+case when debt>0 then -5 when net>0 then 2 else -2 end)),monthly_revenue=revenue,updated_at=now() where id=b.id;
 if b.owner_id is not null then
  insert into public.notifications(user_id,type,content,link,metadata) values(b.owner_id,'business_balance',b.name||' fechou o exercício com '||case when net>=0 then 'lucro' else 'prejuízo' end||' de R$ '||abs(net)||'.','/services/companies/'||b.id,jsonb_build_object('popup_pending',true,'popup_shown_at',null,'cycle_id',cycle.id,'cycle_start_at',start_at,'business_id',b.id,'business_name',b.name,'result_type',cycle.result_type,'gross_revenue',revenue,'operating_cost',expenses,'net_result',net));
  if new_size<>b.size_class then insert into public.notifications(user_id,type,content,link) values(b.owner_id,'company_size_changed','O porte de '||b.name||' foi atualizado conforme os resultados e a equipe.','/services/companies/'||b.id);end if;
 end if;
 insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key) values('company_fiscal_cycle_closed','economy','business_balance_cycles',cycle.id,b.owner_id,to_jsonb(cycle),'company-fiscal-cycle:'||b.id||':'||start_at);
 perform private.adjust_population_company(b.id,net);
 return to_jsonb(cycle);
end $function$;
CREATE OR REPLACE FUNCTION public.offer_company_resource(p_business_id uuid, p_resource_code text, p_price numeric, p_available boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not private.can_manage_company(p_business_id) then raise exception 'Somente a gestão pode anunciar o estoque.' using errcode='42501';end if;
 if p_available is null or p_price is null or p_price<=0 or p_price>100000000 or p_price<>round(p_price,2) then raise exception 'Informe um preço unitário válido.';end if;
 update public.business_inventory set price_policy='manual',selling_price=p_price,available_for_sale=p_available,updated_at=now() where business_id=p_business_id and resource_code=p_resource_code;
 if not found then raise exception 'Este recurso não está no estoque da empresa.';end if;
end $function$;
CREATE OR REPLACE FUNCTION public.configure_company_operations(p_business_id uuid, p_region_code text, p_owner_operates boolean, p_price_multiplier numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.businesses%rowtype;
begin
 select * into b from public.businesses where id=p_business_id for update;
 if auth.uid() is null or b.owner_id is distinct from auth.uid() then raise exception 'Somente o proprietário pode definir a sede e a estratégia.' using errcode='42501';end if;
 if not exists(select 1 from public.economic_regions where code=p_region_code) or p_price_multiplier is null or p_price_multiplier not between .5 and 3 or p_owner_operates is null then raise exception 'Confira a sede, participação na operação e política de preços.';end if;
 update public.businesses set region_code=p_region_code,owner_operates=p_owner_operates,price_multiplier=p_price_multiplier,updated_at=now() where id=b.id;
 update public.business_inventory i set selling_price=round(r.base_price*p_price_multiplier,2),updated_at=now() from public.economic_resources r where i.business_id=b.id and i.resource_code=r.code and i.price_policy='automatic';
 insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key) values('company_strategy_changed','economy','businesses',b.id,auth.uid(),jsonb_build_object('region',p_region_code,'owner_operates',p_owner_operates,'price_multiplier',p_price_multiplier),'company-strategy:'||gen_random_uuid());
end $function$;
CREATE OR REPLACE FUNCTION public.get_business_catalog(p_region_code text DEFAULT 'DF'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare region public.economic_regions%rowtype; macro numeric; result jsonb;
begin
 if auth.uid() is null then raise exception 'Entre para consultar atividades empresariais.' using errcode='42501';end if;
 select * into region from public.economic_regions where code=p_region_code;
 if region.code is null then raise exception 'Selecione um estado válido para a estimativa.';end if;
 select coalesce((to_jsonb(s)->>'business_confidence')::numeric,50) into macro from public.economic_state s limit 1;
 macro:=greatest(.5,least(1.5,.8+coalesce(macro,50)/250));
 select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('registration_fee',(fee->>'buyer_tax')::numeric,'registration_quote',fee,'activity_restricted',(fee->>'restricted')::boolean,'estimate_low',round(estimate*.7,2),'estimate_high',round(estimate*1.3,2),'estimated_for_region',region.code,'estimate_period_days',7,'estimate_workforce',t.min_employees) order by t.name),'[]'::jsonb) into result
 from public.business_types t
 cross join lateral(select public.quote_legal_levies('license',0,true,t.economic_sector_id,t.id) fee) levy
 cross join lateral(select count(*) competitors from public.businesses b where b.business_type_id=t.id and b.status='active' and b.region_code=region.code) c
 cross join lateral(select coalesce(sum((input.value::numeric)*r.base_price),0) cost from public.business_recipes recipe cross join lateral jsonb_each_text(recipe.inputs) input join public.economic_resources r on r.code=input.key where recipe.business_type_id=t.id) input_cost
 cross join lateral(select coalesce((select r.base_price from public.business_recipes recipe join public.economic_resources r on r.code=recipe.output_resource where recipe.business_type_id=t.id limit 1),0) price) output
 cross join lateral(select 7*(t.base_daily_capacity*(output.price-input_cost.cost)*macro*(.75+(region.energy+region.roads+region.telecom)/1200)/(1+c.competitors*.03)-t.min_employees*300.0/7-t.daily_overhead) estimate) estimates
 where t.is_active;
 return result;
end $function$;
CREATE OR REPLACE FUNCTION economy_private.run_operational_engine()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  run_id uuid;
  rp_at timestamptz:=public.rp_now();
  offset_month integer;
  period_row public.economic_periods%rowtype;
  activity_result jsonb;
  status_result jsonb;
  price_result jsonb;
  currency_result jsonb;
  closed_months integer:=0;
  closed_quarters integer:=0;
  closed_years integer:=0;
  result jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('govrp:economy:operational'));
  perform pg_advisory_xact_lock(hashtext('govrp:stock-market'));
  insert into public.economic_engine_runs(run_type,engine_version,status)
  values ('operational','1.0.0','running')
  returning id into run_id;

  for offset_month in 0..3 loop
    perform economy_private.ensure_periods(rp_at-(offset_month||' months')::interval);
  end loop;

  perform private.process_regional_infrastructure();
  perform private.run_company_economy();
  perform private.process_residence_leases();
  perform private.refresh_stock_prices();
  status_result:=economy_private.refresh_policy_and_shock_statuses();
  activity_result:=economy_private.update_activity_mix();
  currency_result:=public.recalculate_currency_market('BR','operational:'||to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD-HH24'),true);
  price_result:=economy_private.process_operational_prices(run_id);

  for period_row in
    select * from public.economic_periods
    where period_type='month' and status in ('open','failed') and ends_at<=now()
    order by ends_at
  loop
    perform economy_private.close_month(period_row.id,true,null);
    closed_months:=closed_months+1;
  end loop;

  for period_row in
    select * from public.economic_periods
    where period_type='quarter' and status in ('open','failed') and ends_at<=now()
    order by ends_at
  loop
    perform economy_private.close_quarter(period_row.id,true,null);
    closed_quarters:=closed_quarters+1;
  end loop;

  for period_row in
    select * from public.economic_periods
    where period_type='year' and status in ('open','failed') and ends_at<=now()
    order by ends_at
  loop
    perform economy_private.close_year(period_row.id,true,null);
    closed_years:=closed_years+1;
  end loop;

  update public.economic_state
  set last_operational_run_at=now(),updated_at=now()
  where id=true;

  result:=jsonb_build_object(
    'run_id',run_id,'rp_at',rp_at,'activity',activity_result,
    'statuses',status_result,'prices',price_result,'currency',currency_result,
    'closed_months',closed_months,
    'closed_quarters',closed_quarters,
    'closed_years',closed_years
  );
  update public.economic_engine_runs
  set status='completed',finished_at=now(),results=result,
      output_hash=encode(extensions.digest(result::text,'sha256'),'hex')
  where id=run_id;
  return result;
exception
  when others then
    if run_id is not null then
      update public.economic_engine_runs
      set status='failed',finished_at=now(),
          errors=jsonb_build_array(jsonb_build_object('sqlstate',sqlstate,'message',sqlerrm))
      where id=run_id;
    end if;
    raise;
end;
$function$;
CREATE OR REPLACE FUNCTION public.sync_global_monetary_policy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  economic_policy jsonb := '{}'::jsonb;
  bank_policy jsonb := '{}'::jsonb;
  previous_monthly numeric;
  current_monthly numeric;
  loan_spread numeric;
  card_spread numeric;
  debt_spread numeric;
begin
  select coalesce(setting.value, '{}'::jsonb)
    into economic_policy
  from public.system_settings setting
  where setting.key = 'economic_policy';

  select coalesce(setting.value, '{}'::jsonb)
    into bank_policy
  from public.system_settings setting
  where setting.key = 'bank_policy';

  economic_policy := coalesce(economic_policy, '{}'::jsonb) || jsonb_build_object(
    'selic_rate', new.current_selic,
    'updated_at', now(),
    'updated_by', auth.uid()
  );

  previous_monthly := round(
    (power(1 + coalesce(old.current_selic, new.current_selic) / 100, 1.0 / 12.0) - 1) * 100,
    2
  );
  current_monthly := round(
    (power(1 + new.current_selic / 100, 1.0 / 12.0) - 1) * 100,
    2
  );

  loan_spread := coalesce(
    nullif(bank_policy->>'loan_interest_spread', '')::numeric,
    greatest(0, coalesce(nullif(bank_policy->>'loan_interest_rate', '')::numeric, 2.5) - previous_monthly)
  );
  card_spread := coalesce(
    nullif(bank_policy->>'credit_card_revolving_spread', '')::numeric,
    greatest(0, coalesce(nullif(bank_policy->>'credit_card_revolving_rate', '')::numeric, 8.9) - previous_monthly)
  );
  debt_spread := coalesce(
    nullif(bank_policy->>'government_debt_interest_spread', '')::numeric,
    greatest(0, coalesce(nullif(bank_policy->>'government_debt_interest_rate', '')::numeric, 1.75) - previous_monthly)
  );

  bank_policy := coalesce(bank_policy, '{}'::jsonb) || jsonb_build_object(
    'loan_interest_spread', loan_spread,
    'credit_card_revolving_spread', card_spread,
    'government_debt_interest_spread', debt_spread,
    'loan_interest_rate', round(current_monthly + loan_spread, 2),
    'credit_card_revolving_rate', round(current_monthly + card_spread, 2),
    'government_debt_interest_rate', round(current_monthly + debt_spread, 2),
    'selic_reference', new.current_selic,
    'updated_at', now()
  );

  insert into public.system_settings (key, value, description, updated_at)
  values (
    'economic_policy',
    economic_policy,
    'Política monetária nacional sincronizada com o motor econômico.',
    now()
  )
  on conflict (key) do update
  set value = excluded.value,
      description = excluded.description,
      updated_at = excluded.updated_at;

  insert into public.system_settings (key, value, description, updated_at)
  values (
    'bank_policy',
    bank_policy,
    'Política de juros e crédito sincronizada com a Selic nacional.',
    now()
  )
  on conflict (key) do update
  set value = excluded.value,
      description = excluded.description,
      updated_at = excluded.updated_at;

  update public.investment_options option
  set annual_return_rate = round(greatest(
    -0.95,
    (
      new.current_selic * case option.risk_level
        when 'low' then 0.90
        when 'high' then 1.20
        when 'very-high' then 1.35
        else 1.05
      end
      + case option.risk_level
        when 'low' then -0.40
        when 'high' then 2.20
        when 'very-high' then 4.50
        else 0.80
      end
    ) / 100
  ), 6)
  where option.id is not null and option.asset_type<>'stock';

  return new;
end;
$function$;


create or replace function public.get_my_investment_totals() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('cost',coalesce(sum(h.amount_invested),0),'market_value',coalesce(sum(h.quantity*o.current_unit_price),0),'realized_result',coalesce(sum(h.realized_result),0)) from public.user_investments h join public.investment_options o on o.id=h.investment_id where h.user_id=auth.uid()
$$;
-- A capped bootstrap uses at most 1% of the Treasury, preserving a finite population reserve.
do $$
declare treasury numeric;funding numeric;capital numeric;reserve public.accounts%rowtype;b public.businesses%rowtype;role public.business_role_templates%rowtype;kind text;symbol text;headcount integer;i integer;
begin
 select treasury_balance into treasury from public.government_finances where id=1 for update;
 funding:=round(least(20000000,greatest(0,treasury)*.01),2);
 select * into reserve from public.accounts where account_kind='population' for update;
 if funding>=4000000 and reserve.id is not null then
  update public.government_finances set treasury_balance=treasury_balance-funding,updated_at=now() where id=1;
  update public.accounts set balance=balance+funding,updated_at=now() where id=reserve.id;
  insert into public.transactions(to_account_id,amount,type,description,metadata,idempotency_key) values(reserve.id,funding,'population_capital_funding','Fundo inicial de empresas e liquidez da população',jsonb_build_object('treasury_debit',true,'allocation_limit','1%','economic_expansion',true),md5('economic-expansion-stock-bootstrap')::uuid);
  capital:=floor(least(5000000,funding/3/1.32));
  for kind,symbol in select * from(values('tecnologia','TECH3'),('solar','SOLR3'),('transportadora','LOGI3'))x(kind,symbol) loop
   select * into b from public.businesses where id=md5('govrp-population-business:'||kind)::uuid and control_kind='population' for update;if not found then continue;end if;
   update public.accounts set balance=balance-capital,updated_at=now() where id=reserve.id;
   update public.accounts set balance=balance+capital,updated_at=now() where id=b.bank_account_id;
   insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata) values(reserve.id,b.bank_account_id,capital,'company_capital','Capitalização inicial: '||b.name,jsonb_build_object('business_id',b.id,'kind','population_capital'));
   insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key) values(b.id,'other',capital,'Capital inicial para expansão da companhia','{"kind":"capital"}','population-stock-capital');
   select * into role from public.business_role_templates where business_type_id=kind and not can_manage order by id limit 1;
   select count(*) into headcount from public.business_employees where business_id=b.id and fired_at is null;
   for i in headcount+1..50 loop insert into public.business_employees(business_id,name,role,role_template_id,skill_area,salary,is_npc,qualification_level,last_accrued_on) values(b.id,'Profissional '||i||' · '||b.region_code,role.name,role.id,role.skill_area,role.base_weekly_salary,true,1,current_date);end loop;
   update public.businesses set market_value=capital,size_class=case when capital>=5000000 then 'large' else 'medium' end,employees=50,is_for_sale=false,metadata=metadata||jsonb_build_object('bootstrap_capital',capital,'bootstrap_at',now()) where id=b.id;
   perform private.regularize_population_company(b.id);
   if exists(select 1 from public.businesses where id=b.id and cnpj_document_id is not null) then perform private.list_company_stock(b.id,symbol,100000,25,round(capital/100000,2),null,true);end if;
  end loop;
  insert into public.domain_events(event_type,source_domain,source_table,source_id,payload,idempotency_key) values('population_companies_capitalized','economy','accounts',reserve.id,jsonb_build_object('funding',funding,'company_count',3,'finite_liquidity',true),'population-stock-bootstrap');
 end if;
 for b in select * from public.businesses where control_kind='population' and cnpj_document_id is null order by id loop perform private.regularize_population_company(b.id);end loop;
 perform private.refresh_stock_prices();
end $$;
revoke all on function private.regularize_population_company(uuid),private.transfer_company_document(),private.adjust_population_company(uuid,numeric) from public,anon,authenticated;
revoke all on function public.get_my_investment_totals() from public,anon;
grant execute on function public.get_my_investment_totals() to authenticated;
notify pgrst,'reload schema';
commit;
