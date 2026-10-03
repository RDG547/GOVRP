begin;
alter table public.state_enterprises add column management_settings jsonb not null default '{}';
create or replace function public.can_manage_state_enterprise(p_enterprise_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.state_enterprises e left join public.businesses b on b.id=e.operating_business_id where e.id=p_enterprise_id and
  (public.is_admin(auth.uid()) or case when e.is_privatized then coalesce(b.owner_id,e.privatization_buyer_id)=auth.uid() else public.get_user_role(auth.uid())='Presidente' or e.manager_id=auth.uid() end));
$$;
revoke all on function public.can_manage_state_enterprise(uuid) from public,anon;
grant execute on function public.can_manage_state_enterprise(uuid) to authenticated;
create or replace function public.configure_enterprise_operations(p_enterprise_id uuid,p_prices jsonb default null,p_costs jsonb default null,p_housing jsonb default null,p_apply_base_price boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare e public.state_enterprises%rowtype; k text; v jsonb; allowed text[]; before_data jsonb;
begin
 select * into e from public.state_enterprises where id=p_enterprise_id for update;
 if not coalesce(public.can_manage_state_enterprise(e.id),false) then raise exception 'Você não tem permissão para administrar esta empresa.' using errcode='42501';end if;
 before_data:=to_jsonb(e);
 allowed:=case e.sector when 'Internet' then array['Internet_Básico','Internet_Ultra','Internet_Mega'] when 'Telefonia' then array['Telefonia_Básico','Telefonia_Intermediário','Telefonia_Premium'] when 'Energia Elétrica' then array['Energia Elétrica'] when 'Água' then array['Água'] when 'Gás' then array['Gás'] else '{}'::text[] end;
 if p_prices is not null then
  if jsonb_typeof(p_prices)<>'object' then raise exception 'Informe os preços deste serviço.';end if;
  for k,v in select * from jsonb_each(p_prices) loop if not(k=any(allowed)) or jsonb_typeof(v)<>'number' or v::text::numeric not between 0 and 1000000 then raise exception 'Preço ou serviço não autorizado para esta empresa.';end if;end loop;
  insert into public.system_settings(key,value) values('basic_service_prices',p_prices) on conflict(key) do update set value=public.system_settings.value||excluded.value;
 end if;
 if p_costs is not null then
  if jsonb_typeof(p_costs)<>'object' then raise exception 'Informe os custos operacionais.';end if;
  for k,v in select * from jsonb_each(p_costs) loop if k not in('employees','infrastructure','maintenance','energy','licenses') or jsonb_typeof(v)<>'number' or v::text::numeric not between 0 and 1000000000 then raise exception 'Custo operacional inválido.';end if;end loop;
  insert into public.system_settings(key,value) values('enterprise_costs',jsonb_build_object(e.id::text,p_costs)) on conflict(key) do update set value=public.system_settings.value||excluded.value;
 end if;
 if p_housing is not null then
  if e.service_key<>'national_housing' then raise exception 'As condições habitacionais pertencem à Imobiliária Nacional.';end if;
  if jsonb_typeof(p_housing) is distinct from 'object' or jsonb_typeof(p_housing->'available_states') is distinct from 'array' or jsonb_typeof(p_housing->'sales_enabled') is distinct from 'boolean' or jsonb_typeof(p_housing->'rentals_enabled') is distinct from 'boolean' or coalesce((p_housing->>'base_price')::numeric,0) not between .01 and 1000000000 then raise exception 'Confira as modalidades, os estados e o preço-base.';end if;
  if exists(select 1 from jsonb_array_elements_text(p_housing->'available_states') x where not exists(select 1 from public.economic_regions where code=x)) then raise exception 'Selecione estados válidos.';end if;
  update public.state_enterprises set management_settings=jsonb_build_object('sales_enabled',(p_housing->>'sales_enabled')::boolean,'rentals_enabled',(p_housing->>'rentals_enabled')::boolean,'base_price',round((p_housing->>'base_price')::numeric,2),'available_states',p_housing->'available_states'),updated_at=clock_timestamp() where id=e.id;
  if p_apply_base_price then update public.products set price=round((p_housing->>'base_price')::numeric,2) where state_enterprise_id=e.id and archived_at is null and p_housing->'available_states' ? (residence_spec->>'state');end if;
 end if;
 perform economy_private.audit('state_enterprise_configured','state_enterprise',e.id::text,before_data,jsonb_build_object('prices',p_prices,'costs',p_costs,'housing',p_housing,'applied_base_price',p_apply_base_price),'Configuração operacional da empresa.',auth.uid());
end $$;
revoke all on function public.configure_enterprise_operations(uuid,jsonb,jsonb,jsonb,boolean) from public,anon;
grant execute on function public.configure_enterprise_operations(uuid,jsonb,jsonb,jsonb,boolean) to authenticated;
create or replace function private.assert_housing_offer(p_product_id uuid,p_action text) returns void language plpgsql security definer set search_path='' as $$
declare p public.products%rowtype; e public.state_enterprises%rowtype;
begin
 select * into p from public.products where id=p_product_id;
 if p.residence_spec is null then return;end if;
 select * into e from public.state_enterprises where id=p.state_enterprise_id;
 if e.management_settings ? 'available_states' and not(e.management_settings->'available_states' ? (p.residence_spec->>'state')) then raise exception 'As ofertas neste estado estão temporariamente indisponíveis.';end if;
 if p_action='sale' and (not coalesce((p.residence_spec->>'sale_enabled')::boolean,true) or not coalesce((e.management_settings->>'sales_enabled')::boolean,true)) then raise exception 'A venda deste imóvel está desabilitada.';end if;
 if p_action='rent' and (not coalesce((p.residence_spec->>'rent_enabled')::boolean,true) or not coalesce((e.management_settings->>'rentals_enabled')::boolean,true)) then raise exception 'O aluguel deste imóvel está desabilitado.';end if;
end $$;
revoke all on function private.assert_housing_offer(uuid,text) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION private.buy_state_product(p_product_id uuid, p_payment_method text, p_card_id uuid, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.products%rowtype; a public.accounts%rowtype; t uuid; inv uuid; q jsonb; total numeric; tax numeric; net numeric; o uuid; spec jsonb; service_path text; payment_card public.cards%rowtype; invoice_id uuid; enterprise public.state_enterprises%rowtype; recipient uuid;
begin
 perform private.assert_housing_offer(p_product_id,'sale');
 select * into p from public.products where id=p_product_id for update;
 service_path:=case when p.residence_spec is null then '/services/national-market' else '/services/national-housing' end;
 perform private.assert_citizen_service(service_path);
 select * into enterprise from public.state_enterprises where id=p.state_enterprise_id and is_active for share;
 if not found or p.archived_at is not null or p.moderation_status<>'approved' then raise exception 'Esta oferta está indisponível.'; end if;
 if enterprise.is_privatized then select bank_account_id into recipient from public.businesses where id=enterprise.operating_business_id and status='active';if recipient is null then raise exception 'A empresa operadora está indisponível.';end if;end if;
 if p.stock<=0 then raise exception 'PRODUCT_OUT_OF_STOCK'; end if;
 if p.price<=0 then raise exception 'A oferta precisa de um preço válido.'; end if;
 q:=public.quote_legal_levies('purchase',p.price,enterprise.is_privatized,p.economic_sector_id,p.category);
 if (q->>'restricted')::boolean then raise exception 'Esta operação está temporariamente restrita por norma vigente.'; end if;
 total:=(q->>'total_debited')::numeric;tax:=(q->>'buyer_tax')::numeric+(q->>'seller_tax')::numeric;net:=(q->>'net_amount')::numeric;
 perform id from public.accounts where user_id=auth.uid() or id=recipient order by id for update;
 select * into a from public.accounts where user_id=auth.uid();
 if not found then raise exception 'Abra sua conta no Banco Nacional antes de comprar.'; end if;
 if p_payment_method='balance' then
   if p_card_id is not null then raise exception 'INVALID_PAYMENT_METHOD'; end if;
   if a.balance<total then raise exception 'INSUFFICIENT_BALANCE'; end if;
   update public.accounts set balance=balance-total,updated_at=clock_timestamp() where id=a.id;
 elsif p_payment_method='card' then
   select * into payment_card from public.cards where id=p_card_id and user_id=auth.uid() and is_active and card_type='credit' for update;
   if not found then raise exception 'INVALID_CARD'; end if;
   if payment_card.card_limit-payment_card.used_limit<total then raise exception 'INSUFFICIENT_CARD_LIMIT'; end if;
   update public.cards set used_limit=used_limit+total where id=payment_card.id;
 else raise exception 'INVALID_PAYMENT_METHOD'; end if;
 update public.government_finances set treasury_balance=treasury_balance+case when enterprise.is_privatized then tax else total end,updated_at=clock_timestamp() where id=1;
 if recipient is not null then
 update public.accounts set balance=balance+net,updated_at=now() where id=recipient;
 insert into public.business_transactions(business_id,type,amount,description) values(enterprise.operating_business_id,'revenue',p.price,'Venda: '||p.name);
 if (q->>'seller_tax')::numeric>0 then insert into public.business_transactions(business_id,type,amount,description) values(enterprise.operating_business_id,'tax',-(q->>'seller_tax')::numeric,'Tributos: '||p.name);end if;
 end if;
 insert into public.transactions(from_account_id,to_account_id,amount,description,type,metadata,idempotency_key)
 values(case when p_payment_method='balance' then a.id else null end,recipient,total,'Compra: '||p.name,case when p_payment_method='card' then 'purchase_card' else 'purchase' end,q||jsonb_build_object('platform',case when p.residence_spec is null then 'Mercado Nacional' else 'Imobiliária Nacional' end,'state_enterprise_id',p.state_enterprise_id,'product_id',p.id,'base_price',p.price,'card_id',payment_card.id,'buyer_id',auth.uid()),p_idempotency_key) returning id into t;
 insert into public.commerce_orders(idempotency_key,buyer_id,product_id,buyer_account_id,state_enterprise_id,payment_method,card_id,base_amount,consumption_tax,corporate_tax,total_amount,seller_net_amount,transaction_id)
 values(p_idempotency_key,auth.uid(),p.id,a.id,p.state_enterprise_id,p_payment_method,payment_card.id,p.price,(q->>'buyer_tax')::numeric,(q->>'seller_tax')::numeric,total,net,t) returning id into o;
 insert into public.user_inventory(user_id,product_id,quantity,metadata) values(auth.uid(),p.id,1,jsonb_build_object('transaction_id',t,'origin',service_path,'purchase_price',p.price,'consumable_effects',p.consumable_effects)) returning id into inv;
 if p.residence_spec is not null then
   spec:=p.residence_spec;
   insert into public.citizen_residences(owner_id,inventory_id,product_id,transaction_id,name,city,state,area_sqm,purchase_price,quality,rooms,hygiene_recovery,sleep_minutes)
   values(auth.uid(),inv,p.id,t,p.name,spec->>'city',spec->>'state',(spec->>'area_sqm')::numeric,p.price,(spec->>'quality')::integer,coalesce(spec->'rooms','{"bedrooms":1,"bathrooms":1,"living_rooms":1,"kitchens":1}'),coalesce((spec->>'hygiene_recovery')::integer,100),coalesce((spec->>'sleep_minutes')::numeric,15));
   insert into public.notifications(user_id,type,content,link) values(auth.uid(),'housing_acquired','Você adquiriu '||p.name||'. Sua residência permite dormir e tomar banho.','/services/national-housing');
 end if;
 if not enterprise.is_privatized then insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,amount,occurred_at_rp,metadata)
 values('other','commerce_orders',o::text,auth.uid(),net,public.rp_now(),jsonb_build_object('state_enterprise_id',p.state_enterprise_id,'transaction_id',t));end if;
 if tax>0 then insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,amount,occurred_at_rp,metadata) values('consumption_tax','commerce_orders',o::text,auth.uid(),tax,public.rp_now(),q); end if;
 update public.products set stock=stock-1,sales_count=coalesce(sales_count,0)+1 where id=p.id;
 insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key)
 values('commerce_purchase_completed','economy','commerce_orders',o,auth.uid(),jsonb_build_object('stateEnterpriseId',p.state_enterprise_id,'productId',p.id,'total',total,'tax',tax,'transactionId',t),'commerce-purchase:'||p_idempotency_key);
 if p_payment_method='card' then
   select id into invoice_id from public.card_invoices where card_id=payment_card.id and status='open' order by created_at desc limit 1 for update;
   if invoice_id is null then
     insert into public.card_invoices(card_id,user_id,closing_date,due_date,amount,status)
     values(payment_card.id,auth.uid(),current_date+30,current_date+40,total,'open') returning id into invoice_id;
   else update public.card_invoices set amount=amount+total,updated_at=clock_timestamp() where id=invoice_id; end if;
   insert into public.card_invoice_items(invoice_id,transaction_id,description,amount) values(invoice_id,t,'Compra: '||p.name,total);
 end if;
 return jsonb_build_object('success',true,'message','Compra concluída.','transaction_id',t,'order_id',o,'total',total,'tax',tax);
end; $function$;
CREATE OR REPLACE FUNCTION public.rent_residence(p_reference_id uuid, p_is_product boolean, p_expected_price numeric, p_periods integer, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.citizen_residences%rowtype; p public.products%rowtype; l public.residence_leases%rowtype; spec jsonb;
begin
 perform private.assert_citizen_service('/services/national-housing');
 if p_idempotency_key is null or p_periods is null or p_periods not between 1 and 52 or p_is_product is null then raise exception 'Confira a duração e a identificação do contrato.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
 select * into l from public.residence_leases where idempotency_key=p_idempotency_key;
 if found then
  select * into r from public.citizen_residences where id=l.residence_id;
  if l.tenant_id<>auth.uid() or l.max_periods<>p_periods or l.price is distinct from p_expected_price or (case when p_is_product then r.product_id else r.id end) is distinct from p_reference_id then raise exception 'Esta identificação já pertence a outro contrato.';end if;
  return to_jsonb(l);
 end if;
 if p_is_product then
  perform private.assert_housing_offer(p_reference_id,'rent');
  select * into p from public.products where id=p_reference_id for update;
  if p.id is null or p.stock<=0 or p.archived_at is not null or p.moderation_status<>'approved' or p.residence_spec is null or not exists(select 1 from public.state_enterprises where id=p.state_enterprise_id and is_active) then raise exception 'Este imóvel não está disponível para aluguel.';end if;
  spec:=p.residence_spec;
  if coalesce((spec->>'rent_price')::numeric,0)<=0 or (spec->>'rent_price')::numeric is distinct from p_expected_price then raise exception 'O preço do aluguel mudou. Confira a oferta atual.';end if;
  insert into public.citizen_residences(state_enterprise_id,product_id,name,city,state,area_sqm,purchase_price,quality,rooms,hygiene_recovery,sleep_minutes,listing_mode,asking_price,rent_period_days)
  values(p.state_enterprise_id,p.id,p.name,spec->>'city',spec->>'state',(spec->>'area_sqm')::numeric,p.price,(spec->>'quality')::integer,spec->'rooms',(spec->>'hygiene_recovery')::integer,(spec->>'sleep_minutes')::numeric,'rent',p_expected_price,coalesce((spec->>'rent_period_days')::integer,7)) returning * into r;
  update public.products set stock=stock-1 where id=p.id;
 else
  select * into r from public.citizen_residences where id=p_reference_id for update;
  if r.id is null or r.listing_mode<>'rent' or r.asking_price is distinct from p_expected_price then raise exception 'O anúncio mudou. Confira a oferta atual.';end if;
 end if;
 if r.owner_id=auth.uid() then raise exception 'Você já é proprietário deste imóvel.';end if;
 if exists(select 1 from public.residence_leases where residence_id=r.id and status<>'ended') then raise exception 'Este imóvel já possui um contrato de aluguel.';end if;
 insert into public.residence_leases(residence_id,tenant_id,landlord_id,state_enterprise_id,price,period_days,max_periods,idempotency_key)
 values(r.id,auth.uid(),r.owner_id,r.state_enterprise_id,r.asking_price,r.rent_period_days,p_periods,p_idempotency_key) returning * into l;
 if not private.pay_residence_lease(l.id) then raise exception 'O primeiro aluguel não pôde ser pago. Confira seu saldo e as regras vigentes.';end if;
 insert into public.notifications(user_id,type,content,link) values(auth.uid(),'housing_rented','Seu contrato de aluguel de '||r.name||' está ativo. Você já pode descansar e tomar banho.','/services/national-housing');
 if r.owner_id is not null then insert into public.notifications(user_id,type,content,link) values(r.owner_id,'housing_rented','Seu imóvel '||r.name||' foi alugado e o primeiro pagamento foi creditado.','/services/national-housing');end if;
 insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key) values('residence_leased','economy','residence_leases',l.id,auth.uid(),jsonb_build_object('residence_id',r.id,'price',l.price,'period_days',l.period_days,'max_periods',l.max_periods),'residence-lease:'||p_idempotency_key);
 select * into l from public.residence_leases where id=l.id;
 return to_jsonb(l);
end $function$;

notify pgrst,'reload schema';
commit;
