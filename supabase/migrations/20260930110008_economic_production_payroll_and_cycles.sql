begin;
alter table public.business_transactions add column accounting_date date not null default current_date;
create index business_ledger_period on public.business_transactions(business_id,accounting_date,type);
create table public.business_supply_orders(id uuid primary key default gen_random_uuid(),buyer_business_id uuid not null references public.businesses(id),seller_business_id uuid not null references public.businesses(id),resource_code text not null references public.economic_resources(code),quantity numeric not null check(quantity>0),unit_price numeric not null check(unit_price>0),total numeric not null check(total>0),tax_snapshot jsonb not null,transaction_id uuid not null references public.transactions(id),actor_id uuid references public.profiles(id),idempotency_key uuid not null unique,created_at timestamptz not null default now(),check(buyer_business_id<>seller_business_id));
create table public.business_supply_contracts(id uuid primary key default gen_random_uuid(),buyer_business_id uuid not null references public.businesses(id),seller_business_id uuid not null references public.businesses(id),resource_code text not null references public.economic_resources(code),daily_quantity numeric not null check(daily_quantity>0 and daily_quantity<=1000000),max_unit_price numeric not null check(max_unit_price>0 and max_unit_price<=100000000),ends_at timestamptz not null,status text not null default 'active' check(status in('active','cancelled','expired')),last_processed_on date,created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),check(buyer_business_id<>seller_business_id));
create unique index one_active_supply_contract on public.business_supply_contracts(buyer_business_id,seller_business_id,resource_code) where status='active';
create table public.business_daily_operations(business_id uuid not null references public.businesses(id),operation_date date not null,produced_quantity numeric not null default 0,sold_quantity numeric not null default 0,revenue numeric not null default 0,payroll_accrued numeric not null default 0,input_cost numeric not null default 0,overhead numeric not null default 0,productivity numeric not null default 0,status text not null,metadata jsonb not null default '{}',primary key(business_id,operation_date));
create table public.business_national_cycles(cycle_start date primary key,cycle_end date not null,revenue numeric not null,profit numeric not null,employment bigint not null,output numeric not null,company_count bigint not null,by_region jsonb not null,created_at timestamptz not null default now());
insert into public.accounts(account_kind,account_number,agency_number,user_id,balance) values('population','POPULATION-ECONOMY','0003',null,0) on conflict(account_number) do nothing;
-- Finite initial consumer endowment, transferred from the existing RP treasury and audited.
do $$ declare budget numeric; reserve uuid; tx uuid;
begin
 select id into reserve from public.accounts where account_kind='population';
 select least(2000000,greatest(0,treasury_balance)*.05) into budget from public.government_finances where id=1 for update;
 if coalesce(budget,0)>0 then
  budget:=round(budget,2);
  update public.government_finances set treasury_balance=treasury_balance-budget,updated_at=now() where id=1;
  update public.accounts set balance=balance+budget where id=reserve;
  insert into public.transactions(to_account_id,amount,type,description,metadata,idempotency_key) values(reserve,budget,'population_endowment','Dotação inicial da economia produtiva da população',jsonb_build_object('treasury_debit',true,'kind','economic_expansion_initial_endowment'),md5('economic-expansion-initial-endowment')::uuid) returning id into tx;
  insert into public.domain_events(event_type,source_domain,source_table,source_id,payload,idempotency_key) values('population_economy_funded','economy','transactions',tx,jsonb_build_object('amount',budget),'population-economy-initial-funding');
 end if;
end $$;
alter table public.business_supply_orders enable row level security;
alter table public.business_supply_contracts enable row level security;
alter table public.business_daily_operations enable row level security;
alter table public.business_national_cycles enable row level security;
create policy supply_orders_read on public.business_supply_orders for select to authenticated using(private.can_manage_company(buyer_business_id) or private.can_manage_company(seller_business_id));
create policy supply_contracts_read on public.business_supply_contracts for select to authenticated using(private.can_manage_company(buyer_business_id) or private.can_manage_company(seller_business_id));
create policy daily_operations_read on public.business_daily_operations for select to authenticated using(private.can_manage_company(business_id));
create policy national_company_cycles_read on public.business_national_cycles for select to authenticated using(true);
revoke all on public.business_supply_orders,public.business_supply_contracts,public.business_daily_operations,public.business_national_cycles from anon,authenticated;
grant select on public.business_supply_orders,public.business_supply_contracts,public.business_daily_operations,public.business_national_cycles to authenticated;
create or replace function public.offer_company_resource(p_business_id uuid,p_resource_code text,p_price numeric,p_available boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.can_manage_company(p_business_id) then raise exception 'Somente a gestão pode anunciar o estoque.' using errcode='42501';end if;
 if p_available is null or p_price is null or p_price<=0 or p_price>100000000 or p_price<>round(p_price,2) then raise exception 'Informe um preço unitário válido.';end if;
 update public.business_inventory set selling_price=p_price,available_for_sale=p_available,updated_at=now() where business_id=p_business_id and resource_code=p_resource_code;
 if not found then raise exception 'Este recurso não está no estoque da empresa.';end if;
end $$;
create or replace function public.get_company_suppliers() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('business_id',b.id,'company_name',b.name,'region_code',b.region_code,'reputation',b.reputation,'resource_code',i.resource_code,'resource_name',r.name,'unit',r.unit,'quantity',i.quantity,'unit_price',i.selling_price) order by r.name,i.selling_price),'[]'::jsonb)
 from public.business_inventory i join public.businesses b on b.id=i.business_id join public.economic_resources r on r.code=i.resource_code where auth.uid() is not null and i.available_for_sale and i.quantity>0 and i.selling_price>0 and b.status='active'
$$;
create or replace function private.trade_company_resource(p_buyer uuid,p_seller uuid,p_resource text,p_quantity numeric,p_max_price numeric,p_key uuid,p_actor uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.businesses%rowtype; s public.businesses%rowtype; stock public.business_inventory%rowtype; a public.accounts%rowtype; q jsonb; total numeric; net numeric; amount numeric; order_row public.business_supply_orders%rowtype; tx uuid;
begin
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
 amount:=round(stock.selling_price*p_quantity,2);
 q:=public.quote_legal_levies('purchase',amount,true,s.economic_sector_id,'Insumos');
 if (q->>'restricted')::boolean then raise exception 'Fornecimento restrito por norma vigente.';end if;
 total:=(q->>'total_debited')::numeric;net:=(q->>'net_amount')::numeric;
 perform id from public.accounts where id in(b.bank_account_id,s.bank_account_id) order by id for update;
 select * into a from public.accounts where id=b.bank_account_id;
 if a.balance<total then raise exception 'O caixa da empresa não cobre este fornecimento.';end if;
 update public.accounts set balance=balance-total,updated_at=now() where id=b.bank_account_id;
 update public.accounts set balance=balance+net,updated_at=now() where id=s.bank_account_id;
 update public.government_finances set treasury_balance=treasury_balance+total-net,updated_at=now() where id=1;
 update public.business_inventory set quantity=quantity-p_quantity,updated_at=now() where business_id=s.id and resource_code=p_resource;
 insert into public.business_inventory(business_id,resource_code,quantity,unit_cost) values(b.id,p_resource,p_quantity,total/p_quantity)
 on conflict(business_id,resource_code) do update set unit_cost=(public.business_inventory.quantity*public.business_inventory.unit_cost+total)/(public.business_inventory.quantity+p_quantity),quantity=public.business_inventory.quantity+p_quantity,updated_at=now();
 insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key) values(b.bank_account_id,s.bank_account_id,amount,'business_supply','Fornecimento: '||s.name||' → '||b.name,q||jsonb_build_object('buyer_business_id',b.id,'seller_business_id',s.id,'resource_code',p_resource,'quantity',p_quantity),p_key) returning id into tx;
 insert into public.business_supply_orders(buyer_business_id,seller_business_id,resource_code,quantity,unit_price,total,tax_snapshot,transaction_id,actor_id,idempotency_key) values(b.id,s.id,p_resource,p_quantity,stock.selling_price,total,q,tx,p_actor,p_key) returning * into order_row;
 insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key) values(b.id,'other',-total,'Aquisição de insumos: '||p_resource,jsonb_build_object('kind','inventory_purchase','transaction_id',tx),'supply-buyer:'||p_key),(s.id,'revenue',amount,'Fornecimento para '||b.name,jsonb_build_object('kind','b2b_sale','transaction_id',tx),'supply-seller:'||p_key);
 if (q->>'seller_tax')::numeric>0 then insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key) values(s.id,'tax',-(q->>'seller_tax')::numeric,'Tributos sobre fornecimento',q,'supply-tax:'||p_key);end if;
 if total>net then insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,business_id,amount,occurred_at_rp,metadata) values('consumption_tax','transactions',tx::text,p_actor,s.id,total-net,public.rp_now(),q);end if;
 return to_jsonb(order_row);
end $$;
revoke all on function private.trade_company_resource(uuid,uuid,text,numeric,numeric,uuid,uuid) from public,anon,authenticated;
create or replace function public.buy_company_resource(p_business_id uuid,p_supplier_id uuid,p_resource_code text,p_quantity numeric,p_max_unit_price numeric,p_idempotency_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not private.can_manage_company(p_business_id) then raise exception 'Somente a gestão pode comprar insumos para a empresa.' using errcode='42501';end if;
 return private.trade_company_resource(p_business_id,p_supplier_id,p_resource_code,p_quantity,p_max_unit_price,p_idempotency_key,auth.uid());
end $$;
create or replace function public.configure_supply_contract(p_business_id uuid,p_supplier_id uuid,p_resource_code text,p_daily_quantity numeric,p_max_unit_price numeric,p_duration_days integer) returns uuid language plpgsql security definer set search_path='' as $$
declare cid uuid;
begin
 if not private.can_manage_company(p_business_id) then raise exception 'Somente a gestão pode contratar fornecimento.' using errcode='42501';end if;
 if p_business_id=p_supplier_id or p_duration_days is null or p_duration_days not between 1 and 90 or p_daily_quantity is null or p_daily_quantity<=0 or p_daily_quantity>1000000 or p_max_unit_price is null or p_max_unit_price<=0 or p_max_unit_price>100000000 then raise exception 'Confira quantidade, preço máximo e duração (1 a 90 dias).';end if;
 if not exists(select 1 from public.business_inventory where business_id=p_supplier_id and resource_code=p_resource_code and available_for_sale and selling_price<=p_max_unit_price) then raise exception 'Este fornecedor não oferece o recurso nas condições indicadas.';end if;
 insert into public.business_supply_contracts(buyer_business_id,seller_business_id,resource_code,daily_quantity,max_unit_price,ends_at,created_by) values(p_business_id,p_supplier_id,p_resource_code,p_daily_quantity,p_max_unit_price,now()+make_interval(days=>p_duration_days),auth.uid())
 on conflict(buyer_business_id,seller_business_id,resource_code) where status='active' do update set daily_quantity=excluded.daily_quantity,max_unit_price=excluded.max_unit_price,ends_at=excluded.ends_at returning id into cid;
 return cid;
end $$;
create or replace function public.cancel_supply_contract(p_contract_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.business_supply_contracts set status='cancelled' where id=p_contract_id and (private.can_manage_company(buyer_business_id) or private.can_manage_company(seller_business_id));
 if not found then raise exception 'Contrato indisponível para sua gestão.' using errcode='42501';end if;
end $$;
create or replace function private.pay_company_wages(p_business_id uuid) returns numeric language plpgsql security definer set search_path='' as $$
declare b public.businesses%rowtype; employee public.business_employees%rowtype; payer public.accounts%rowtype; receiver uuid; paid numeric:=0; payment numeric; tx uuid; k uuid;
begin
 select * into b from public.businesses where id=p_business_id for update;
 if b.id is null then return 0;end if;
 -- Lock all payout accounts in a stable order before processing the payroll.
 perform a.id from public.accounts a where a.id=b.bank_account_id or a.account_kind='population' or a.user_id in(select profile_id from public.business_employees where business_id=b.id and wage_due>0) order by a.id for update;
 for employee in select * from public.business_employees where business_id=b.id and wage_due>0 order by hired_at,id for update loop
  select * into payer from public.accounts where id=b.bank_account_id;
  select id into receiver from public.accounts where case when employee.is_npc then account_kind='population' else user_id=employee.profile_id end;
  if receiver is null or payer.balance<=0 then
   update public.business_employees set satisfaction=greatest(0,satisfaction-5) where id=employee.id;
   continue;
  end if;
  payment:=least(payer.balance,employee.wage_due);k:=gen_random_uuid();
  update public.accounts set balance=balance-payment,updated_at=now() where id=payer.id;
  update public.accounts set balance=balance+payment,updated_at=now() where id=receiver;
  insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key) values(payer.id,receiver,payment,'company_salary','Salário: '||b.name,jsonb_build_object('business_id',b.id,'employee_id',employee.id,'gross_amount',payment,'net_amount',payment,'total_debited',payment,'tax_amount',0,'remaining_due',employee.wage_due-payment),k) returning id into tx;
  insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key) values(b.id,'other',-payment,'Pagamento salarial: '||employee.name,jsonb_build_object('kind','payroll_payment','transaction_id',tx),'payroll:'||tx);
  update public.business_employees set wage_due=wage_due-payment,last_paid_at=now(),satisfaction=least(100,greatest(0,satisfaction+case when payment=employee.wage_due then 3 else -2 end)) where id=employee.id;
  if employee.profile_id is not null then insert into public.notifications(user_id,type,content,link,metadata) values(employee.profile_id,'company_salary_paid','Você recebeu R$ '||payment||' de '||b.name||case when payment<employee.wage_due then '. O saldo pendente permanece registrado.' else '.' end,'/services/my-work',jsonb_build_object('transaction_id',tx));end if;
  paid:=paid+payment;
 end loop;
 return paid;
end $$;
revoke all on function private.pay_company_wages(uuid) from public,anon,authenticated;
create or replace function public.pay_company_payroll(p_business_id uuid) returns numeric language plpgsql security definer set search_path='' as $$
begin
 if not private.can_manage_company(p_business_id) then raise exception 'Somente a gestão pode pagar a folha.' using errcode='42501';end if;
 return private.pay_company_wages(p_business_id);
end $$;
create table private.business_daily_effort(business_id uuid not null references public.businesses(id),effort_date date not null,boost numeric not null default 0 check(boost between 0 and .2),primary key(business_id,effort_date));
revoke all on private.business_daily_effort from public,anon,authenticated;
create or replace function private.simulate_company_day(p_business_id uuid,p_day date) returns void language plpgsql security definer set search_path='' as $$
declare b public.businesses%rowtype; kind public.business_types%rowtype; region public.economic_regions%rowtype; recipe public.business_recipes%rowtype; employee public.business_employees%rowtype; item record; supplier record; contract record; cash numeric; available numeric; cost numeric:=0; wages numeric:=0; wage numeric; overhead numeric:=0; units numeric; work_efficiency numeric; skill numeric; headcount integer; boost numeric; resource_price numeric; population_account uuid; produced numeric:=0; result_status text:='operating'; input_quantity numeric; unit_cost numeric; tx uuid; contract_key uuid;
begin
 if p_day>current_date or p_day<current_date-30 then raise exception 'Data de simulação fora do período operacional.';end if;
 select * into b from public.businesses where id=p_business_id for update;
 if b.id is null or b.status<>'active' or exists(select 1 from public.business_daily_operations where business_id=b.id and operation_date=p_day) then return;end if;
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
 work_efficiency:=least(2,(headcount+case when b.owner_operates and b.control_kind='player' then .25 else 0 end)/greatest(kind.min_employees,1)::numeric)*greatest(.7,skill)*(.65+(region.roads+region.energy+region.telecom)/1000)*(1+coalesce(boost,0));
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
  on conflict(business_id,resource_code) do update set unit_cost=(public.business_inventory.quantity*public.business_inventory.unit_cost+cost+wages+overhead)/(public.business_inventory.quantity+produced),quantity=public.business_inventory.quantity+produced,selling_price=coalesce(public.business_inventory.selling_price,excluded.selling_price),updated_at=now();
  if cost>0 then insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key,accounting_date) values(b.id,'expense',-round(cost,2),'Insumos consumidos na produção',jsonb_build_object('kind','input_consumption','recipe_id',recipe.id),'inputs:'||p_day,p_day);end if;
 end if;
 insert into public.business_daily_operations(business_id,operation_date,produced_quantity,payroll_accrued,input_cost,overhead,productivity,status,metadata) values(b.id,p_day,produced,wages,round(cost,2),overhead,work_efficiency*100,result_status,jsonb_build_object('region_code',region.code,'headcount',headcount,'recipe_id',recipe.id,'effort_boost',coalesce(boost,0)));
 update public.businesses set employees=headcount,operational_status=result_status,productivity_index=least(300,work_efficiency*100),last_simulated_on=p_day,updated_at=now() where id=b.id;
end $$;
revoke all on function private.simulate_company_day(uuid,date) from public,anon,authenticated;
create table private.population_demand_runs(operation_date date primary key,spent numeric not null default 0,created_at timestamptz not null default now());
revoke all on private.population_demand_runs from public,anon,authenticated;
create or replace function private.simulate_population_demand(p_day date) returns numeric language plpgsql security definer set search_path='' as $$
declare resource public.economic_resources%rowtype; offer record; population public.accounts%rowtype; macro public.economic_state%rowtype; total_budget numeric; budget numeric; spent numeric:=0; v_quantity numeric; total numeric; net numeric; amount numeric; q jsonb; tx uuid; score_sum numeric; resource_count integer; player_count integer; npc_count integer;
begin
 if exists(select 1 from private.population_demand_runs where operation_date=p_day) then return 0;end if;
 select * into population from public.accounts where account_kind='population' for update;
 select * into macro from public.economic_state where id=true;
 total_budget:=least(50000,greatest(0,population.balance)*.1)*(.5+coalesce(macro.consumer_confidence,50)/100);
 select count(*) into resource_count from public.economic_resources where is_service or code in('energy','food','drinks','bread','meals','retail_food','retail_electronics','retail_clothing','retail_medicine','retail_vehicles');
 for resource in select * from public.economic_resources where is_service or code in('energy','food','drinks','bread','meals','retail_food','retail_electronics','retail_clothing','retail_medicine','retail_vehicles') order by code loop
  budget:=total_budget/greatest(resource_count,1);
  select count(*) filter(where b.control_kind='player'),count(*) filter(where b.control_kind='population') into player_count,npc_count from public.business_inventory i join public.businesses b on b.id=i.business_id where i.resource_code=resource.code and i.quantity>0 and i.available_for_sale and i.selling_price>0 and b.status='active';
  select sum((.5+b.reputation/100)/power(greatest(i.selling_price/resource.base_price,.1),1.6)*case when player_count=0 or npc_count=0 then 1 else case when b.control_kind='player' then coalesce(macro.player_share,.2)/player_count else coalesce(macro.simulated_share,.8)/npc_count end end) into score_sum from public.business_inventory i join public.businesses b on b.id=i.business_id where i.resource_code=resource.code and i.quantity>0 and i.available_for_sale and i.selling_price>0 and b.status='active';
  for offer in select i.*,b.bank_account_id,b.economic_sector_id,b.owner_id,b.name,b.control_kind,(.5+b.reputation/100)/power(greatest(i.selling_price/resource.base_price,.1),1.6)*case when player_count=0 or npc_count=0 then 1 else case when b.control_kind='player' then coalesce(macro.player_share,.2)/player_count else coalesce(macro.simulated_share,.8)/npc_count end end score from public.business_inventory i join public.businesses b on b.id=i.business_id where i.resource_code=resource.code and i.quantity>0 and i.available_for_sale and i.selling_price>0 and b.status='active' order by b.id for update of i loop
   v_quantity:=least(offer.quantity,trunc(budget*offer.score/greatest(score_sum,.00001)/offer.selling_price/1.25,3));
   if v_quantity<=0 then continue;end if;
   amount:=round(v_quantity*offer.selling_price,2);if amount<=0 then continue;end if;
   q:=public.quote_legal_levies('purchase',amount,true,offer.economic_sector_id,resource.name);
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
 insert into private.population_demand_runs(operation_date,spent) values(p_day,spent);
 return spent;
end $$;
revoke all on function private.simulate_population_demand(date) from public,anon,authenticated;
create or replace function private.close_company_fiscal_cycle(p_business_id uuid,p_until timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
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
 return to_jsonb(cycle);
end $$;
revoke all on function private.close_company_fiscal_cycle(uuid,timestamptz) from public,anon,authenticated;
create or replace function private.run_company_economy() returns jsonb language plpgsql security definer set search_path='' as $$
declare b record; company_row public.businesses%rowtype; start_day date; day date; result jsonb; cycles integer:=0; processed integer:=0; sold numeric:=0; period_start date:=date_trunc('week',now())::date-7;
begin
 perform pg_advisory_xact_lock(hashtextextended('govrp:company-economy',0));
 -- A common lock order keeps payroll, capital and B2B settlement atomic with the hourly engine.
 perform id from public.businesses order by id for update;
 perform id from public.accounts order by id for update;
 select greatest(current_date-6,coalesce(min(coalesce(last_simulated_on+1,created_at::date)),current_date)) into start_day from public.businesses where status='active' and region_code is not null;
 for day in select generate_series(start_day,current_date,interval '1 day')::date loop
  for b in select id from public.businesses where status='active' and region_code is not null and created_at::date<=day and (last_simulated_on is null or last_simulated_on<day) order by id loop
   perform private.simulate_company_day(b.id,day);processed:=processed+1;
  end loop;
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
 return jsonb_build_object('success',true,'processed_company_days',processed,'closed_cycles',cycles,'population_spending',sold,'processed_at',now());
end $$;
revoke all on function private.run_company_economy() from public,anon,authenticated;
create or replace function public.process_company_economy() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.role()<>'service_role' then raise exception 'Operação exclusiva da automação econômica.' using errcode='42501';end if;
 return private.run_company_economy();
end $$;
revoke all on function public.process_company_economy() from public,anon,authenticated;
grant execute on function public.process_company_economy() to service_role;
-- Population companies share the same businesses, cash, employees, stock and ledger as citizens.
do $$ declare kind public.business_types%rowtype; region record; role public.business_role_templates%rowtype; b public.businesses%rowtype; reserve public.accounts%rowtype; capital numeric; i integer:=0; remaining integer; worker integer;
begin
 select count(*) into remaining from public.business_types t where t.is_active and exists(select 1 from public.business_recipes where business_type_id=t.id);
 for kind in select * from public.business_types t where t.is_active and exists(select 1 from public.business_recipes where business_type_id=t.id) order by t.id loop
  select * into region from public.economic_regions order by code offset (i%27) limit 1;
  insert into public.businesses(id,owner_id,control_kind,business_type_id,name,description,status,region_code,owner_operates,metadata)
  values(md5('govrp-population-business:'||kind.id)::uuid,null,'population',kind.id,kind.name||' de '||region.capital,'Empresa da população, com caixa, equipe, insumos e resultados próprios.','active',region.code,false,jsonb_build_object('simulation_managed',true,'cnpj_regularization_required',true)) on conflict(id) do nothing returning * into b;
  if b.id is null then continue;end if;
  select * into reserve from public.accounts where account_kind='population' for update;
  capital:=round(least(10000+kind.min_employees*1000,greatest(0,reserve.balance)*.65/greatest(remaining,1)),2);
  if capital>0 then
   update public.accounts set balance=balance-capital where id=reserve.id;
   update public.accounts set balance=balance+capital where id=b.bank_account_id;
   insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key) values(reserve.id,b.bank_account_id,capital,'company_capital','Capital inicial da população: '||b.name,jsonb_build_object('business_id',b.id,'kind','population_capital'),md5('population-capital:'||b.id)::uuid);
   insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key) values(b.id,'other',capital,'Capital inicial da população','{"kind":"capital"}','population-capital');
  end if;
  select * into role from public.business_role_templates where business_type_id=kind.id and not can_manage order by id limit 1;
  for worker in 1..kind.min_employees loop
   insert into public.business_employees(business_id,name,role,salary,is_npc,role_template_id,skill_area,qualification_level,experience,last_accrued_on) values(b.id,'Profissional '||worker||' de '||region.capital,role.name,role.base_weekly_salary,true,role.id,role.skill_area,1+worker%3,(worker%3)*100,current_date);
  end loop;
  update public.businesses set employees=kind.min_employees,market_value=capital,is_for_sale=true,sale_price=greatest(1000,capital+kind.min_employees*1000),sale_listed_at=now() where id=b.id;
  remaining:=remaining-1;i:=i+1;
 end loop;
end $$;
revoke all on function public.offer_company_resource(uuid,text,numeric,boolean),public.get_company_suppliers(),public.buy_company_resource(uuid,uuid,text,numeric,numeric,uuid),public.configure_supply_contract(uuid,uuid,text,numeric,numeric,integer),public.cancel_supply_contract(uuid),public.pay_company_payroll(uuid) from public,anon;
grant execute on function public.offer_company_resource(uuid,text,numeric,boolean),public.get_company_suppliers(),public.buy_company_resource(uuid,uuid,text,numeric,numeric,uuid),public.configure_supply_contract(uuid,uuid,text,numeric,numeric,integer),public.cancel_supply_contract(uuid),public.pay_company_payroll(uuid) to authenticated;
alter publication supabase_realtime add table public.business_supply_orders,public.business_supply_contracts,public.business_daily_operations,public.business_national_cycles;

CREATE OR REPLACE FUNCTION economy_private.on_business_transaction_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  business_row public.businesses%rowtype;
  classification text;
  event_type text;
begin
  select * into business_row
  from public.businesses
  where id = new.business_id;

  classification := case when new.metadata->>'kind'='payroll_accrual' then 'compensation' else case lower(new.type)
    when 'revenue' then 'gross_output'
    when 'expense' then 'intermediate_consumption'
    when 'monthly_cost' then 'intermediate_consumption'
    when 'tax' then 'income_tax'
    when 'registration' then 'capital_transfer'
    else 'not_in_gdp'
  end end;

  event_type := case classification
    when 'gross_output' then 'business_gross_output'
    when 'intermediate_consumption' then 'business_intermediate_consumption'
    else 'business_' || lower(new.type)
  end;

  perform economy_private.record_event(
    event_type,
    classification,
    'business_transactions',
    new.id::text,
    abs(new.amount),
    business_row.owner_id,
    new.business_id,
    null,
    coalesce(
      business_row.economic_sector_id,
      economy_private.resolve_sector(new.business_id, null, new.description)
    ),
    null,
    null,
    case when classification = 'income_tax' then abs(new.amount) else 0 end,
    0,
    new.created_at,
    public.real_date_to_rp_date(new.created_at),
    business_row.control_kind='population',
    1,
    jsonb_build_object('business_transaction_type', new.type),
    'business_transaction:' || new.id::text
  );

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION economy_private.classify_transaction(p_transaction_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  transaction_row public.transactions%rowtype;
  transaction_type text;
  buyer_id uuid;
  seller_id uuid;
  seller_business_id uuid;
  sector_id uuid;
  tax_value numeric := 0;
  base_value numeric;
  group_key text;
  classification text;
  output_id uuid;
  expenditure_id uuid;
  tax_id uuid;
begin
  select * into transaction_row
  from public.transactions
  where id = p_transaction_id;

  if not found then
    raise exception 'Transação não encontrada.';
  end if;

  transaction_type := lower(coalesce(transaction_row.type, 'transfer'));
  buyer_id := economy_private.account_owner(transaction_row.from_account_id);
  seller_id := economy_private.account_owner(transaction_row.to_account_id);
  select business_id into seller_business_id from public.accounts where id=transaction_row.to_account_id;
  seller_business_id := coalesce(seller_business_id,economy_private.profile_business(seller_id));
  sector_id := economy_private.resolve_sector(
    seller_business_id,
    null,
    transaction_row.description
  );
  group_key := 'transaction:' || transaction_row.id::text;

  if coalesce(transaction_row.metadata->>'tax_amount', '') ~ '^[0-9]+(\.[0-9]+)?$' then
    tax_value := greatest((transaction_row.metadata->>'tax_amount')::numeric, 0);
  end if;

  if coalesce(transaction_row.metadata->>'base_price', '') ~ '^[0-9]+(\.[0-9]+)?$' then
    base_value := greatest((transaction_row.metadata->>'base_price')::numeric, 0);
  else
    base_value := greatest(transaction_row.amount - tax_value, 0);
  end if;

  if transaction_type='population_purchase' then
    expenditure_id:=economy_private.record_event('population_consumption','household_consumption','transactions',transaction_row.id::text,transaction_row.amount,null,seller_business_id,null,sector_id,null,null,tax_value,0,transaction_row.created_at,public.real_date_to_rp_date(transaction_row.created_at),true,1,transaction_row.metadata,group_key);
    return jsonb_build_object('classification','household_consumption','expenditure_event_id',expenditure_id);
  end if;

  if transaction_type in (
    'purchase',
    'purchase_card',
    'subscription_payment',
    'subscription_payment_card',
    'service_payment'
  ) then
    expenditure_id := economy_private.record_event(
      'household_consumption',
      'household_consumption',
      'transactions',
      transaction_row.id::text,
      transaction_row.amount,
      buyer_id,
      seller_business_id,
      null,
      sector_id,
      1,
      transaction_row.amount,
      tax_value,
      0,
      transaction_row.created_at,
      public.real_date_to_rp_date(transaction_row.created_at),
      false,
      1,
      coalesce(transaction_row.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'transaction_type', transaction_type,
          'seller_profile_id', seller_id
        ),
      group_key
    );

    output_id := economy_private.record_event(
      'domestic_gross_output',
      'gross_output',
      'transactions',
      transaction_row.id::text,
      base_value,
      seller_id,
      seller_business_id,
      null,
      sector_id,
      1,
      base_value,
      0,
      0,
      transaction_row.created_at,
      public.real_date_to_rp_date(transaction_row.created_at),
      false,
      1,
      coalesce(transaction_row.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'transaction_type', transaction_type,
          'buyer_profile_id', buyer_id
        ),
      group_key
    );

    if tax_value > 0 then
      tax_id := economy_private.record_event(
        'product_tax',
        'product_tax',
        'transactions',
        transaction_row.id::text,
        tax_value,
        buyer_id,
        seller_business_id,
        null,
        sector_id,
        1,
        tax_value,
        tax_value,
        0,
        transaction_row.created_at,
        public.real_date_to_rp_date(transaction_row.created_at),
        false,
        1,
        coalesce(transaction_row.metadata, '{}'::jsonb),
        group_key
      );
    end if;

    classification := 'household_consumption';
  elsif transaction_type in ('daily_check_in_reward', 'citizen_income') then
    expenditure_id := economy_private.record_event(
      transaction_type,
      'social_transfer',
      'transactions',
      transaction_row.id::text,
      transaction_row.amount,
      coalesce(buyer_id, seller_id),
      null,
      null,
      economy_private.resolve_sector(null, 'public_admin', null),
      null,
      null,
      0,
      0,
      transaction_row.created_at,
      public.real_date_to_rp_date(transaction_row.created_at),
      false,
      1,
      coalesce(transaction_row.metadata, '{}'::jsonb),
      group_key
    );
    classification := 'social_transfer';
  elsif transaction_type = 'fine_payment' then
    expenditure_id := economy_private.record_event(
      'fine_payment',
      'not_in_gdp',
      'transactions',
      transaction_row.id::text,
      transaction_row.amount,
      buyer_id,
      null,
      null,
      economy_private.resolve_sector(null, 'public_admin', null),
      null,
      null,
      0,
      0,
      transaction_row.created_at,
      public.real_date_to_rp_date(transaction_row.created_at),
      false,
      1,
      coalesce(transaction_row.metadata, '{}'::jsonb)
        || jsonb_build_object('reason', 'fine_is_transfer'),
      group_key
    );
    classification := 'not_in_gdp';
  elsif transaction_type in ('admin_credit', 'admin_debit') then
    expenditure_id := economy_private.record_event(
      transaction_type,
      'capital_transfer',
      'transactions',
      transaction_row.id::text,
      transaction_row.amount,
      coalesce(buyer_id, seller_id),
      null,
      null,
      null,
      null,
      null,
      0,
      0,
      transaction_row.created_at,
      public.real_date_to_rp_date(transaction_row.created_at),
      false,
      1,
      coalesce(transaction_row.metadata, '{}'::jsonb),
      group_key
    );
    classification := 'capital_transfer';
  else
    expenditure_id := economy_private.record_event(
      transaction_type,
      'financial_operation',
      'transactions',
      transaction_row.id::text,
      transaction_row.amount,
      coalesce(buyer_id, seller_id),
      seller_business_id,
      null,
      sector_id,
      null,
      null,
      0,
      0,
      transaction_row.created_at,
      public.real_date_to_rp_date(transaction_row.created_at),
      false,
      1,
      coalesce(transaction_row.metadata, '{}'::jsonb)
        || jsonb_build_object('does_not_directly_change_gdp', true),
      group_key
    );
    classification := 'financial_operation';
  end if;

  return jsonb_build_object(
    'transaction_id', transaction_row.id,
    'classification', classification,
    'expenditure_event_id', expenditure_id,
    'output_event_id', output_id,
    'tax_event_id', tax_id
  );
end;
$function$
;
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
  insert into public.economic_engine_runs(run_type,engine_version,status)
  values ('operational','1.0.0','running')
  returning id into run_id;

  for offset_month in 0..3 loop
    perform economy_private.ensure_periods(rp_at-(offset_month||' months')::interval);
  end loop;

  perform private.run_company_economy();
  perform private.process_residence_leases();
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
$function$

;
notify pgrst,'reload schema';
commit;
