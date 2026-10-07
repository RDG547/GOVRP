begin;
CREATE OR REPLACE FUNCTION public.buy_product(p_product_id uuid, p_payment_method text, p_card_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin return public.buy_product(p_product_id,p_payment_method,p_card_id,gen_random_uuid())::json; end;
$function$
;
CREATE OR REPLACE FUNCTION public.buy_product(p_product_id uuid, p_payment_method text, p_card_id uuid, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_buyer uuid:=auth.uid();v_product public.products%rowtype;v_business public.businesses%rowtype;
  v_buyer_account public.accounts%rowtype;v_seller_account public.accounts%rowtype;v_card public.cards%rowtype;
  v_base numeric;v_consumption_rate numeric;v_corporate_rate numeric;v_consumption_tax numeric;v_corporate_tax numeric;
  v_total numeric;v_seller_net numeric;v_transaction uuid;v_order public.commerce_orders%rowtype;v_invoice uuid;v_buyer_name text; v_levies jsonb; v_market public.state_enterprises%rowtype; v_market_account uuid; v_market_owner uuid; v_commission numeric; v_commission_snapshot jsonb;
begin
  if v_buyer is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
  select * into v_order from public.commerce_orders where idempotency_key=p_idempotency_key;
  if found then
    if v_order.buyer_id is distinct from v_buyer then raise exception 'IDEMPOTENCY_KEY_FORBIDDEN'; end if;
    if v_order.product_id is distinct from p_product_id or v_order.payment_method is distinct from p_payment_method or v_order.card_id is distinct from p_card_id then raise exception 'IDEMPOTENCY_PAYLOAD_MISMATCH'; end if;
    return jsonb_build_object('success',v_order.status='completed','message','Compra já processada.','transaction_id',v_order.transaction_id,'order_id',v_order.id,'total',v_order.total_amount,'tax',v_order.consumption_tax+v_order.corporate_tax); end if;
  perform public.process_due_legal_effects();
  perform 1 from public.state_enterprises where service_key='marketplace' for share;
  select * into v_product from public.products where id=p_product_id for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  if v_product.state_enterprise_id is not null then return private.buy_state_product(p_product_id,p_payment_method,p_card_id,p_idempotency_key); end if;
  perform private.assert_citizen_service('/services/business');
  if v_product.moderation_status<>'approved' or v_product.archived_at is not null then raise exception 'PRODUCT_NOT_AVAILABLE'; end if;
  select * into v_market from public.state_enterprises where service_key='marketplace' for share;
  if not found or not v_market.is_active then raise exception 'MARKETPLACE_UNAVAILABLE'; end if;
  v_market:=private.marketplace_seller_policy(v_market,v_product.business_id,true);
  if v_market.active_listing_fee_enabled and v_market.active_listing_fee_amount>0 and (v_product.listing_status='awaiting_renewal' or v_product.listing_paid_until<=clock_timestamp()) then raise exception 'LISTING_RENEWAL_REQUIRED';end if;
  if v_market.is_privatized then
    select coalesce(b.owner_id,v_market.privatization_buyer_id),b.bank_account_id into v_market_owner,v_market_account from public.businesses b where b.id=v_market.operating_business_id;
    if v_market_owner is null then v_market_owner:=v_market.privatization_buyer_id; end if;
    if v_market_account is null then select id into v_market_account from public.accounts where user_id=v_market_owner; end if;
    if v_market_account is null then raise exception 'MARKETPLACE_RECEIVING_ACCOUNT_REQUIRED'; end if;
  end if;

  if v_product.product_type='subscription' and exists(select 1 from public.user_subscriptions where user_id=v_buyer and product_id=v_product.id and status='active') then raise exception 'SUBSCRIPTION_ALREADY_ACTIVE';end if;
  if v_product.seller_id=v_buyer then raise exception 'OWN_PRODUCT_PURCHASE_DENIED'; end if;
  if v_product.business_id is not null then
    select * into v_business from public.businesses where id=v_product.business_id for update;
    if not found or v_business.status is distinct from 'active' then raise exception 'BUSINESS_NOT_ACTIVE'; end if;
    if v_business.owner_id is distinct from v_product.seller_id then raise exception 'SELLER_OWNERSHIP_CHANGED'; end if;
  end if;
  -- Consistent account lock order avoids opposing purchases deadlocking.
  perform id from public.accounts
    where user_id=v_buyer or (v_product.business_id is null and user_id=v_product.seller_id)
       or id=v_business.bank_account_id or id=v_market_account order by id for update;
  if v_product.business_id is null then
    select * into v_seller_account from public.accounts where user_id=v_product.seller_id;
  else
    select * into v_seller_account from public.accounts where id=v_business.bank_account_id;
  end if;
  if not found then raise exception 'SELLER_BANK_ACCOUNT_REQUIRED'; end if;
  if v_product.product_type='one-time' and coalesce(v_product.stock,0)<=0 then raise exception 'PRODUCT_OUT_OF_STOCK'; end if;
  v_base:=case when v_product.promotion_price is not null and v_product.promotion_expires_at>clock_timestamp() then v_product.promotion_price else v_product.price end;
  v_levies:=public.quote_legal_levies('purchase',v_base,v_product.business_id is not null,coalesce(v_product.economic_sector_id,v_business.economic_sector_id),v_product.category);
  if (v_levies->>'restricted')::boolean then raise exception 'ACTIVITY_RESTRICTED_BY_LAW'; end if;
  v_consumption_tax:=(v_levies->>'buyer_tax')::numeric;v_corporate_tax:=(v_levies->>'seller_tax')::numeric;
  v_total:=(v_levies->>'total_debited')::numeric;v_seller_net:=(v_levies->>'net_amount')::numeric;
  v_commission:=round(case when v_market.commission_type='percentage' then v_base*v_market.commission_value/100 else v_market.commission_value end+v_market.fixed_sale_fee,2);
  if v_commission>v_seller_net then raise exception 'COMMISSION_EXCEEDS_PROCEEDS'; end if;
  v_seller_net:=v_seller_net-v_commission;
  v_commission_snapshot:=jsonb_build_object('enterprise_id',v_market.id,'type',v_market.commission_type,'value',v_market.commission_value,'fixed_sale_fee',v_market.fixed_sale_fee,'percentage_amount',case when v_market.commission_type='percentage' then round(v_base*v_market.commission_value/100,2) else 0 end,'base_amount',v_base,'amount',v_commission,'seller_type',case when v_product.business_id is null then 'PF' else 'PJ' end,'private',v_market.is_privatized,'recipient_account_id',v_market_account);
  v_levies:=v_levies||jsonb_build_object('net_amount',v_seller_net,'commission_amount',v_commission,'commission_snapshot',v_commission_snapshot);


  if p_payment_method='balance' then
    select * into v_buyer_account from public.accounts where user_id=v_buyer for update;
    if not found then raise exception 'BUYER_BANK_ACCOUNT_REQUIRED'; end if;
    if v_buyer_account.balance<v_total then raise exception 'INSUFFICIENT_BALANCE'; end if;
    update public.accounts set balance=balance-v_total,updated_at=clock_timestamp() where id=v_buyer_account.id;
  elsif p_payment_method='card' then
    select * into v_card from public.cards where id=p_card_id and user_id=v_buyer and is_active and card_type='credit' for update;
    if not found then raise exception 'INVALID_CARD'; end if;
    if v_card.card_limit-v_card.used_limit<v_total then raise exception 'INSUFFICIENT_CARD_LIMIT'; end if;
    update public.cards set used_limit=used_limit+v_total where id=v_card.id;
  else raise exception 'INVALID_PAYMENT_METHOD'; end if;

  update public.accounts set balance=balance+v_seller_net,updated_at=clock_timestamp() where id=v_seller_account.id;
  if v_market.is_privatized and v_commission>0 then update public.accounts set balance=balance+v_commission,updated_at=clock_timestamp() where id=v_market_account; end if;
  insert into public.government_finances(id) values(1) on conflict(id) do nothing;
  update public.government_finances set treasury_balance=treasury_balance+v_consumption_tax+v_corporate_tax+case when not v_market.is_privatized then v_commission else 0 end,updated_at=clock_timestamp() where id=1;
  insert into public.transactions(from_account_id,to_account_id,amount,description,type,metadata,idempotency_key)
  values(v_buyer_account.id,v_seller_account.id,v_total,'Compra: '||v_product.name,
    case when p_payment_method='card' then 'purchase_card' else 'purchase' end,
    jsonb_build_object('platform','Negócios Livres','business_id',v_business.id,'product_id',v_product.id,'seller_type',v_product.seller_type,'seller_id',v_product.seller_id,'seller_name',(select full_name from public.profiles where id=v_product.seller_id),
      'base_price',v_base,'consumption_tax',v_consumption_tax,'corporate_tax',v_corporate_tax,'seller_net',v_seller_net,'card_id',p_card_id)||v_levies,
    p_idempotency_key) returning id into v_transaction;
  insert into public.commerce_orders(
    idempotency_key,buyer_id,seller_id,business_id,product_id,buyer_account_id,seller_account_id,card_id,payment_method,
    base_amount,consumption_tax,corporate_tax,total_amount,seller_net_amount,transaction_id,status,completed_at,marketplace_enterprise_id,commission_amount,commission_snapshot
  ) values(p_idempotency_key,v_buyer,v_product.seller_id,v_business.id,v_product.id,v_buyer_account.id,v_seller_account.id,p_card_id,p_payment_method,
    v_base,v_consumption_tax,v_corporate_tax,v_total,v_seller_net,v_transaction,'completed',clock_timestamp(),v_market.id,v_commission,v_commission_snapshot) returning * into v_order;
  if v_product.business_id is not null then
  insert into public.business_transactions(business_id,type,amount,description) values(v_business.id,'revenue',v_base,'Venda: '||v_product.name);
  if v_corporate_tax>0 then insert into public.business_transactions(business_id,type,amount,description) values(v_business.id,'tax',-v_corporate_tax,'Imposto da venda: '||v_product.name); end if;
  update public.businesses set monthly_revenue=monthly_revenue+v_base,updated_at=clock_timestamp() where id=v_business.id;
  end if;

  if v_commission>0 then
    if v_product.business_id is not null then insert into public.business_transactions(business_id,type,amount,description) values(v_business.id,'expense',-v_commission,'Comissão Negócios Livre: '||v_product.name); end if;
    if v_market.is_privatized then
      insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata) values(null,v_market_account,v_commission,'marketplace_commission','Comissão de venda no Negócios Livre',jsonb_build_object('commerce_order_id',v_order.id,'gross_amount',v_commission,'net_amount',v_commission,'tax_amount',0,'commission_snapshot',v_commission_snapshot));
    else
      insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,amount,occurred_at_rp,metadata) values('fee','commerce_orders',v_order.id::text,v_product.seller_id,v_commission,public.rp_now(),jsonb_build_object('kind','marketplace_commission','transaction_id',v_transaction,'snapshot',v_commission_snapshot));
    end if;
  end if;
  if v_consumption_tax>0 then insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,business_id,amount,occurred_at_rp,metadata)
    values('consumption_tax','commerce_orders',v_order.id::text,v_buyer,v_business.id,v_consumption_tax,public.rp_now(),jsonb_build_object('transactionId',v_transaction)); end if;
  if v_corporate_tax>0 then insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,business_id,amount,occurred_at_rp,metadata)
    values('corporate_tax','commerce_orders',v_order.id::text,v_business.owner_id,v_business.id,v_corporate_tax,public.rp_now(),jsonb_build_object('transactionId',v_transaction)); end if;

  if v_product.product_type='subscription' then
    insert into public.user_subscriptions(user_id,product_id,seller_id,status,last_payment_date,next_payment_date)
    values(v_buyer,v_product.id,v_product.seller_id,'active',clock_timestamp(),clock_timestamp()+(v_product.subscription_interval)::interval);
    update public.products set subscribers_count=coalesce(subscribers_count,0)+1 where id=v_product.id;
  else
    insert into public.user_inventory(user_id,product_id,quantity,acquired_at,metadata) values(v_buyer,v_product.id,1,clock_timestamp(),jsonb_build_object('consumable_effects',v_product.consumable_effects,'transaction_id',v_transaction,'origin','Negócios Livres','purchase_price',v_base));
    update public.products set stock=stock-1,sales_count=coalesce(sales_count,0)+1 where id=v_product.id;
  end if;
  if p_payment_method='card' then
    select id into v_invoice from public.card_invoices where card_id=v_card.id and status='open' order by created_at desc limit 1 for update;
    if v_invoice is null then
      insert into public.card_invoices(card_id,user_id,closing_date,due_date,amount,status)
      values(v_card.id,v_buyer,current_date+30,current_date+40,v_total,'open') returning id into v_invoice;
    else update public.card_invoices set amount=amount+v_total,updated_at=clock_timestamp() where id=v_invoice; end if;
    insert into public.card_invoice_items(invoice_id,transaction_id,description,amount) values(v_invoice,v_transaction,'Compra: '||v_product.name,v_total);
  end if;
  select full_name into v_buyer_name from public.profiles where id=v_buyer;
  insert into public.notifications(user_id,sender_id,type,content,link)
  values(v_product.seller_id,v_buyer,'product_sold',coalesce(v_buyer_name,'Um cidadão')||' comprou: '||v_product.name,'/dashboard?tab=products');
  insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key,status,processed_at)
  values('commerce_purchase_completed','economy','commerce_orders',v_order.id,v_buyer,
    jsonb_build_object('businessId',v_business.id,'productId',v_product.id,'total',v_total,'tax',v_consumption_tax+v_corporate_tax,'transactionId',v_transaction),
    'commerce-purchase:'||p_idempotency_key,'processed',clock_timestamp());
  return jsonb_build_object('success',true,'message','Compra realizada com sucesso!','transaction_id',v_transaction,'order_id',v_order.id,
    'total',v_total,'tax',v_consumption_tax+v_corporate_tax);
exception when others then
  raise;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_products_with_final_price()
 RETURNS TABLE(id uuid, seller_id uuid, name text, description text, price numeric, image_url text, created_at timestamp with time zone, product_type text, subscription_interval text, subscription_price numeric, metadata jsonb, category text, stock integer, promotion_price numeric, promotion_expires_at timestamp with time zone, sales_count integer, subscribers_count integer, tax_rate numeric, final_price numeric, seller json)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select product.id,product.seller_id,product.name,product.description,product.price,product.image_url,product.created_at,
    product.product_type,product.subscription_interval,product.subscription_price,coalesce(product.metadata,'{}')||jsonb_build_object('stock_depleted_at',product.stock_depleted_at,'quote',levy.value,'consumable_effects',product.consumable_effects),product.category,product.stock,
    product.promotion_price,product.promotion_expires_at,product.sales_count,product.subscribers_count,
    case when price_data.base>0 then (levy.value->>'buyer_tax')::numeric/price_data.base else 0 end,
    (levy.value->>'total_debited')::numeric,
    json_build_object('id',seller.id,'full_name',seller.full_name,'x_handle',seller.x_handle,'role',seller.role,
      'seller_type',product.seller_type,'business_id',business.id,'business_name',business.name,'business_status',business.status,'business_logo_url',business.logo_url,'business_font_key',business.font_key,'business_brand_color',business.brand_color,'activity_restricted',(levy.value->>'restricted')::boolean,
      'documents',(select json_agg(json_build_object('type',document.type,'document_number',document.document_number,'metadata',json_build_object('company_name',business.name))) from public.documents document where document.user_id=seller.id and document.type='CNPJ' and document.metadata->>'business_id'=business.id::text))
  from public.products product
  join public.profiles seller on seller.id=product.seller_id
  left join public.businesses business on business.id=product.business_id
  cross join lateral (select case when product.promotion_price is not null and product.promotion_expires_at>statement_timestamp() then product.promotion_price else product.price end AS base) price_data
  cross join lateral (select public.quote_legal_levies('purchase',price_data.base,product.business_id is not null,coalesce(product.economic_sector_id,business.economic_sector_id),product.category) AS value) levy
  where seller.deleted_at is null and product.archived_at is null and product.moderation_status='approved' and exists(select 1 from public.state_enterprises ms where ms.service_key='marketplace' and ms.is_active and (not (private.marketplace_seller_policy(ms,product.business_id,true)).active_listing_fee_enabled or (private.marketplace_seller_policy(ms,product.business_id,true)).active_listing_fee_amount=0 or (product.listing_status='active' and (product.listing_paid_until is null or product.listing_paid_until>statement_timestamp()))))
    and (seller.onboarding_completed or seller.onboarding_mode='legacy_migration')
    and (product.business_id is null or business.status='active')
  order by product.created_at desc, product.id desc
$function$
;

CREATE OR REPLACE FUNCTION private.validate_citizen_product()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare k text; v jsonb;
begin
 if current_user not in('postgres','supabase_admin','service_role') and (new.state_enterprise_id is not null or new.residence_spec is not null) then raise exception 'Somente a gestão autorizada pode cadastrar ofertas estatais e imóveis.' using errcode='42501'; end if;
 if jsonb_typeof(new.consumable_effects)<>'object' then raise exception 'Defina os efeitos do consumível corretamente.'; end if;
 if new.consumable_effects ?| array['health','social'] then
   if new.category<>'Bebidas' or new.product_type<>'one-time' or new.consumable_effects<>'{"thirst":15,"social":8,"health":-3}'::jsonb then raise exception 'Bebidas alcoólicas usam os efeitos balanceados: sede +15, socialização +8 e saúde -3.' using errcode='22023';end if;
   return new;
 end if;
 for k,v in select * from jsonb_each(new.consumable_effects) loop
   if k not in('hunger','thirst') or jsonb_typeof(v)<>'number' or v::numeric<=0 or v::numeric>60 then raise exception 'Consumíveis podem recuperar até 60 pontos de fome ou sede.'; end if;
 end loop;
 if new.consumable_effects<>'{}' and (new.product_type<>'one-time' or new.category not in('Alimentos','Bebidas')) then raise exception 'Consumíveis devem ser produtos de alimentos ou bebidas com quantidade em estoque.'; end if;
 return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.citizen_need_action(p_action text, p_reference_id uuid, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n public.citizen_needs%rowtype; item public.user_inventory%rowtype; effects jsonb; cfg jsonb; residence public.citizen_residences%rowtype; previous private.citizen_need_actions%rowtype; result jsonb;
begin
 if auth.uid() is null or p_idempotency_key is null then raise exception 'Autenticação e identificação da ação são necessárias.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
 select * into previous from private.citizen_need_actions where idempotency_key=p_idempotency_key;
 if found then
   if previous.user_id<>auth.uid() or previous.action<>p_action or previous.reference_id is distinct from p_reference_id then raise exception 'Esta ação já foi usada em outra operação.'; end if;
   return previous.result;
 end if;
 n:=private.refresh_citizen_needs(auth.uid());
 if n.user_id is null then raise exception 'Conclua sua cidadania antes de cuidar das necessidades.'; end if;
 select value into cfg from public.system_settings where key='citizen_needs';
 if n.sleep_started_at is not null and p_action<>'wake' then raise exception 'Acorde antes de realizar outra atividade.'; end if;
 if p_action='wake' then
   n.sleep_started_at:=null;n.sleep_due_at:=null;n.sleep_start_value:=null;n.sleep_residence_id:=null;
 elsif p_action='consume' then
   perform private.assert_citizen_service('/services/inventory');
   select * into item from public.user_inventory where id=p_reference_id and user_id=auth.uid() and quantity>0 for update;
   if not found then raise exception 'Este item não está disponível no seu inventário.'; end if;
   select coalesce(item.metadata->'consumable_effects',consumable_effects) into effects from public.products where id=item.product_id;
   if effects is null or effects='{}' then raise exception 'Este produto não é consumível.'; end if;
   if (coalesce((effects->>'hunger')::numeric,0)=0 or n.hunger>=100) and (coalesce((effects->>'thirst')::numeric,0)=0 or n.thirst>=100) and (coalesce((effects->>'social')::numeric,0)=0 or n.social>=100) then raise exception 'Suas necessidades de alimentação e bebida já estão completas.'; end if;
   if coalesce((effects->>'health')::numeric,0)<0 and n.health+(effects->>'health')::numeric<25 then raise exception 'Sua saúde está muito baixa para esta bebida. Procure atendimento no SNS antes de consumir.';end if;
   update public.user_inventory set quantity=quantity-1 where id=item.id;
   n.hunger:=greatest(0,least(100,n.hunger+coalesce((effects->>'hunger')::numeric,0)));n.thirst:=greatest(0,least(100,n.thirst+coalesce((effects->>'thirst')::numeric,0)));
   n.social:=greatest(0,least(100,n.social+coalesce((effects->>'social')::numeric,0)));n.health:=greatest(25,least(100,n.health+coalesce((effects->>'health')::numeric,0)));
 elsif p_action in('bath','sleep') then
   perform private.assert_citizen_service('/services/national-housing');
   select * into residence from public.citizen_residences where id=p_reference_id and private.can_use_residence(id,auth.uid());
   if not found then raise exception 'Você precisa ser proprietário ou ter um aluguel ativo e pago para usar esta residência.' using errcode='42501'; end if;
   if p_action='bath' then
     if n.last_bath_rp+make_interval(hours=>coalesce((cfg->>'bath_cooldown_rp_hours')::integer,8))>public.rp_now() then raise exception 'Você já tomou banho recentemente. Aguarde o intervalo do RP.'; end if;
     n.hygiene:=least(100,n.hygiene+residence.hygiene_recovery);n.last_bath_rp:=public.rp_now();
   else
     if n.last_sleep_rp+make_interval(hours=>coalesce((cfg->>'sleep_cooldown_rp_hours')::integer,12))>public.rp_now() then raise exception 'Você já descansou recentemente. Aguarde o intervalo do RP.'; end if;
     if n.sleep>=100 then raise exception 'Seu cidadão já está descansado.'; end if;
     n.last_sleep_rp:=public.rp_now();n.sleep_started_at:=clock_timestamp();n.sleep_start_value:=n.sleep;n.sleep_residence_id:=residence.id;
     n.sleep_due_at:=n.sleep_started_at+make_interval(secs=>greatest(1,residence.sleep_minutes*60*(100-n.sleep)/100)::double precision);
   end if;
 else raise exception 'Escolha consumir, tomar banho ou dormir.'; end if;
 update public.citizen_needs set hunger=n.hunger,thirst=n.thirst,social=n.social,health=n.health,hygiene=n.hygiene,sleep=n.sleep,last_bath_rp=n.last_bath_rp,last_sleep_rp=n.last_sleep_rp,sleep_started_at=n.sleep_started_at,sleep_due_at=n.sleep_due_at,sleep_start_value=n.sleep_start_value,sleep_residence_id=n.sleep_residence_id,updated_at=clock_timestamp(),alert_bands=(select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(n.alert_bands) where coalesce((to_jsonb(n)->>key)::numeric,0)<40) where user_id=auth.uid() returning * into n;
 result:=to_jsonb(n)||jsonb_build_object('server_now',clock_timestamp(),'rp_now',public.rp_now());
 insert into private.citizen_need_actions(user_id,action,reference_id,idempotency_key,result) values(auth.uid(),p_action,p_reference_id,p_idempotency_key,result);
 return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.get_business_catalog(p_region_code text DEFAULT 'DF'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare region public.economic_regions%rowtype; region_count numeric:=1; macro numeric; result jsonb;
begin
 if auth.uid() is null then raise exception 'Entre para consultar atividades empresariais.' using errcode='42501';end if;
 if p_region_code is null then
   select avg(energy),avg(roads),avg(telecom),greatest(1,count(*)) into region.energy,region.roads,region.telecom,region_count from public.economic_regions;
 else
   select * into region from public.economic_regions where code=p_region_code;
   if region.code is null then raise exception 'Selecione um estado válido para a estimativa.';end if;
 end if;
 select coalesce((to_jsonb(s)->>'business_confidence')::numeric,50) into macro from public.economic_state s limit 1;
 macro:=greatest(.5,least(1.5,.8+coalesce(macro,50)/250));
 select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('registration_fee',(fee->>'buyer_tax')::numeric,'registration_quote',fee,'activity_restricted',(fee->>'restricted')::boolean,'estimate_low',round(estimate*.7,2),'estimate_high',round(estimate*1.3,2),'estimated_for_region',region.code,'estimate_period_days',7,'estimate_workforce',t.min_employees) order by t.name),'[]'::jsonb) into result
 from public.business_types t
 cross join lateral(select public.quote_legal_levies('license',0,true,t.economic_sector_id,t.id) fee) levy
 cross join lateral(select count(*)/region_count competitors from public.businesses b where b.business_type_id=t.id and b.status='active' and (p_region_code is null or b.region_code=region.code)) c
 cross join lateral(select coalesce(sum((input.value::numeric)*r.base_price),0) cost from public.business_recipes recipe cross join lateral jsonb_each_text(recipe.inputs) input join public.economic_resources r on r.code=input.key where recipe.business_type_id=t.id) input_cost
 cross join lateral(select coalesce((select r.base_price from public.business_recipes recipe join public.economic_resources r on r.code=recipe.output_resource where recipe.business_type_id=t.id limit 1),0) price) output
 cross join lateral(select 7*(t.base_daily_capacity*(output.price-input_cost.cost)*macro*(.75+(region.energy+region.roads+region.telecom)/1200)/(1+c.competitors*.03)-t.min_employees*300.0/7-t.daily_overhead) estimate) estimates
 where t.is_active;
 return result;
end $function$
;

alter table public.commerce_orders add column checkout_id uuid, add column checkout_request jsonb;
create index commerce_orders_checkout_idx on public.commerce_orders(checkout_id) where checkout_id is not null;
create or replace function public.checkout_marketplace_cart(p_items jsonb,p_payment_method text,p_card_id uuid,p_checkout_id uuid,p_expected_total numeric) returns jsonb
language plpgsql security definer set search_path='' as $$
declare normalized jsonb; intent jsonb; previous public.commerce_orders%rowtype; item record; quantity integer; result jsonb; order_id uuid; total numeric; ids uuid[]; ids_business uuid[]; market public.state_enterprises%rowtype; market_account uuid; child_key uuid;
begin
 if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED';end if;
 perform private.assert_citizen_service('/services/business');
 if p_checkout_id is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED';end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'INVALID_CART';end if;
 if jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>50 then raise exception 'INVALID_CART';end if;
 if p_payment_method is null or p_payment_method not in('balance','card') or (p_payment_method='balance' and p_card_id is not null) then raise exception 'INVALID_PAYMENT_METHOD';end if;
 if p_expected_total is null or p_expected_total<0 or p_expected_total::text in('NaN','Infinity','-Infinity') then raise exception 'CART_PRICE_CHANGED';end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item.value)<>'object' or jsonb_typeof(item.value->'product_id') is distinct from 'string' or jsonb_typeof(item.value->'quantity') is distinct from 'number'
     or coalesce(item.value->>'product_id','')!~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'INVALID_CART';end if;
  if (item.value->>'quantity')::numeric<1 or (item.value->>'quantity')::numeric>100 or trunc((item.value->>'quantity')::numeric)<>(item.value->>'quantity')::numeric then raise exception 'INVALID_CART';end if;
 end loop;
 if (select count(distinct (v->>'product_id')::uuid) from jsonb_array_elements(p_items) v)<>jsonb_array_length(p_items)
 or (select sum((v->>'quantity')::numeric) from jsonb_array_elements(p_items) v)>100 then raise exception 'INVALID_CART';end if;
 select jsonb_agg(jsonb_build_object('product_id',(v->>'product_id')::uuid,'quantity',(v->>'quantity')::integer) order by (v->>'product_id')::uuid),array_agg((v->>'product_id')::uuid)
 into normalized,ids from jsonb_array_elements(p_items) v;
 intent:=jsonb_build_object('items',normalized,'method',p_payment_method,'card_id',p_card_id,'expected_total',p_expected_total);
 perform pg_advisory_xact_lock(hashtextextended('cart:'||p_checkout_id::text,0));
 select * into previous from public.commerce_orders where checkout_id=p_checkout_id limit 1;
 if found then
   if previous.buyer_id is distinct from auth.uid() then raise exception 'IDEMPOTENCY_KEY_FORBIDDEN';end if;
   if previous.checkout_request is distinct from intent then raise exception 'IDEMPOTENCY_PAYLOAD_MISMATCH';end if;
 else
   perform public.process_due_legal_effects();
   select * into market from public.state_enterprises where service_key='marketplace' for share;
   -- Lock the entire cart before invoking the existing purchase pipeline. A failure
   -- anywhere rolls back money, stock, subscriptions, invoices and notifications.
   perform id from public.products where id=any(ids) order by id for update;
   if (select count(*) from public.products where id=any(ids))<>cardinality(ids) then raise exception 'PRODUCT_NOT_FOUND';end if;
   if exists(select 1 from public.products where id=any(ids) and state_enterprise_id is not null) then raise exception 'INVALID_CART';end if;
   select array_agg(distinct business_id) into ids_business from public.products where id=any(ids) and business_id is not null;
   perform id from public.businesses where id=any(ids_business) order by id for update;
   if market.is_privatized then
     select coalesce(b.bank_account_id,(select a.id from public.accounts a where a.user_id=coalesce(b.owner_id,market.privatization_buyer_id))) into market_account from public.businesses b where b.id=market.operating_business_id;
     if market_account is null then select id into market_account from public.accounts where user_id=market.privatization_buyer_id;end if;
   end if;
   perform a.id from public.accounts a where a.user_id=auth.uid() or a.id=market_account
     or a.id in(select bank_account_id from public.businesses where id=any(ids_business))
     or a.user_id in(select seller_id from public.products where id=any(ids) and business_id is null) order by a.id for update;
   for item in select (v->>'product_id')::uuid product_id,(v->>'quantity')::integer quantity from jsonb_array_elements(normalized) v loop
     if item.quantity<>1 and exists(select 1 from public.products where id=item.product_id and product_type='subscription') then raise exception 'SUBSCRIPTION_QUANTITY_INVALID';end if;
     for quantity in 1..item.quantity loop
       child_key:=md5(p_checkout_id::text||':'||item.product_id::text||':'||quantity::text)::uuid;
       result:=public.buy_product(item.product_id,p_payment_method,p_card_id,child_key);
       if not coalesce((result->>'success')::boolean,false) then raise exception 'CART_PURCHASE_FAILED';end if;
       order_id:=(result->>'order_id')::uuid;
       update public.commerce_orders set checkout_id=p_checkout_id,checkout_request=intent where id=order_id and buyer_id=auth.uid();
     end loop;
   end loop;
   select sum(total_amount) into total from public.commerce_orders where checkout_id=p_checkout_id;
   if total is distinct from p_expected_total then raise exception 'CART_PRICE_CHANGED';end if;
 end if;
 select jsonb_build_object('success',true,'checkout_id',p_checkout_id,'total',sum(o.total_amount),'base_amount',sum(o.base_amount),'buyer_tax',sum(o.consumption_tax),
   'orders',jsonb_agg(jsonb_build_object('id',o.id,'product_id',o.product_id,'base_amount',o.base_amount,'buyer_tax',o.consumption_tax,'total',o.total_amount,'levies',t.metadata->'levies') order by o.created_at,o.id))
 into result from public.commerce_orders o join public.transactions t on t.id=o.transaction_id where o.checkout_id=p_checkout_id and o.buyer_id=auth.uid();
 return result;
end $$;
revoke all on function public.checkout_marketplace_cart(jsonb,text,uuid,uuid,numeric) from public,anon;
grant execute on function public.checkout_marketplace_cart(jsonb,text,uuid,uuid,numeric) to authenticated;
notify pgrst,'reload schema';
commit;
