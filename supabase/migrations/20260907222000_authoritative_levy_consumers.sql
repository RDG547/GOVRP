BEGIN;

CREATE OR REPLACE FUNCTION public.propose_parliament_bill(p_title text, p_summary text, p_full_text text, p_type text, p_house_id uuid DEFAULT NULL::uuid)
 RETURNS bills
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); actor_role text; resolved_house uuid; result public.bills%rowtype;
begin
  select role into actor_role from public.profiles where id=actor;
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  if length(trim(coalesce(p_title,'')))<5 or length(trim(coalesce(p_summary,'')))<15 then raise exception 'Título e resumo precisam ser completos.'; end if;
  if actor_role IS NULL OR actor_role NOT IN('Admin','Presidente','Deputado','Senador') then raise exception 'PARLIAMENT_AUTHORITY_REQUIRED'; end if;
  if actor_role IN('Admin','Presidente') then
    resolved_house:=p_house_id;
  else
    select pm.house_id into resolved_house from public.parliament_members pm
    where pm.user_id=actor and pm.term_start_date<=current_date and pm.term_end_date>=current_date
      and (p_house_id is null or pm.house_id=p_house_id)
    order by pm.term_end_date desc limit 1;
  end if;
  if resolved_house is null or not exists(select 1 from public.parliament_houses where id=resolved_house) then raise exception 'Casa legislativa não autorizada para este mandato.'; end if;
  if actor_role NOT IN('Admin','Presidente') and not exists(select 1 from public.parliament_members where user_id=actor and house_id=resolved_house and term_start_date<=current_date and term_end_date>=current_date) then raise exception 'O projeto deve tramitar na Casa do mandato do parlamentar.'; end if;
  insert into public.bills(title,summary,full_text,type,author_id,house_id,author_role,status)
  values(trim(p_title),trim(p_summary),nullif(trim(p_full_text),''),p_type,actor,resolved_house,actor_role,'Em tramitação') returning * into result;
  insert into public.notifications(user_id,sender_id,type,content,link)
  select pm.user_id,actor,'parliament_bill_proposed','Novo projeto em sua Casa: '||result.title,'/services/parliament/panel'
  from public.parliament_members pm where pm.house_id=resolved_house and pm.term_start_date<=current_date and pm.term_end_date>=current_date and pm.user_id<>actor;
  return result;
end; $function$;


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
  v_total numeric;v_seller_net numeric;v_transaction uuid;v_order public.commerce_orders%rowtype;v_invoice uuid;v_buyer_name text; v_levies jsonb;
begin
  if v_buyer is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
  select * into v_order from public.commerce_orders where idempotency_key=p_idempotency_key;
  if found then
    if v_order.buyer_id is distinct from v_buyer then raise exception 'IDEMPOTENCY_KEY_FORBIDDEN'; end if;
    if v_order.product_id is distinct from p_product_id or v_order.payment_method is distinct from p_payment_method or v_order.card_id is distinct from p_card_id then raise exception 'IDEMPOTENCY_PAYLOAD_MISMATCH'; end if;
    return jsonb_build_object('success',v_order.status='completed','message','Compra já processada.','transaction_id',v_order.transaction_id,'order_id',v_order.id); end if;
  perform public.process_due_legal_effects();
  select * into v_product from public.products where id=p_product_id for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  if v_product.seller_id=v_buyer then raise exception 'OWN_PRODUCT_PURCHASE_DENIED'; end if;
  if v_product.business_id is not null then
    select * into v_business from public.businesses where id=v_product.business_id for share;
    if not found or v_business.status is distinct from 'active' then raise exception 'BUSINESS_NOT_ACTIVE'; end if;
    if v_business.owner_id is distinct from v_product.seller_id then raise exception 'SELLER_OWNERSHIP_CHANGED'; end if;
  end if;
  -- Consistent account lock order avoids opposing purchases deadlocking.
  perform id from public.accounts
    where user_id=v_buyer or (v_product.business_id is null and user_id=v_product.seller_id)
       or id=v_business.bank_account_id order by id for update;
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

  if p_payment_method='balance' then
    select * into v_buyer_account from public.accounts where user_id=v_buyer for update;
    if not found then raise exception 'BUYER_BANK_ACCOUNT_REQUIRED'; end if;
    if v_buyer_account.balance<v_total then raise exception 'INSUFFICIENT_BALANCE'; end if;
    update public.accounts set balance=balance-v_total,updated_at=clock_timestamp() where id=v_buyer_account.id;
  elsif p_payment_method='card' then
    select * into v_card from public.cards where id=p_card_id and user_id=v_buyer and is_active for update;
    if not found then raise exception 'INVALID_CARD'; end if;
    if v_card.card_limit-v_card.used_limit<v_total then raise exception 'INSUFFICIENT_CARD_LIMIT'; end if;
    update public.cards set used_limit=used_limit+v_total where id=v_card.id;
  else raise exception 'INVALID_PAYMENT_METHOD'; end if;

  update public.accounts set balance=balance+v_seller_net,updated_at=clock_timestamp() where id=v_seller_account.id;
  insert into public.government_finances(id) values(1) on conflict(id) do nothing;
  update public.government_finances set treasury_balance=treasury_balance+v_consumption_tax+v_corporate_tax,updated_at=clock_timestamp() where id=1;
  insert into public.transactions(from_account_id,to_account_id,amount,description,type,metadata,idempotency_key)
  values(v_buyer_account.id,v_seller_account.id,v_total,'Compra: '||v_product.name,
    case when p_payment_method='card' then 'purchase_card' else 'purchase' end,
    jsonb_build_object('platform','Negócios Livres','business_id',v_business.id,'product_id',v_product.id,'seller_type',v_product.seller_type,'seller_id',v_product.seller_id,'seller_name',(select full_name from public.profiles where id=v_product.seller_id),
      'base_price',v_base,'consumption_tax',v_consumption_tax,'corporate_tax',v_corporate_tax,'seller_net',v_seller_net,'card_id',p_card_id)||v_levies,
    p_idempotency_key) returning id into v_transaction;
  insert into public.commerce_orders(
    idempotency_key,buyer_id,seller_id,business_id,product_id,buyer_account_id,seller_account_id,card_id,payment_method,
    base_amount,consumption_tax,corporate_tax,total_amount,seller_net_amount,transaction_id,status,completed_at
  ) values(p_idempotency_key,v_buyer,v_product.seller_id,v_business.id,v_product.id,v_buyer_account.id,v_seller_account.id,p_card_id,p_payment_method,
    v_base,v_consumption_tax,v_corporate_tax,v_total,v_seller_net,v_transaction,'completed',clock_timestamp()) returning * into v_order;
  if v_product.business_id is not null then
  insert into public.business_transactions(business_id,type,amount,description) values(v_business.id,'revenue',v_base,'Venda: '||v_product.name);
  if v_corporate_tax>0 then insert into public.business_transactions(business_id,type,amount,description) values(v_business.id,'tax',-v_corporate_tax,'Imposto da venda: '||v_product.name); end if;
  update public.businesses set monthly_revenue=monthly_revenue+v_base,updated_at=clock_timestamp() where id=v_business.id;
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
    insert into public.user_inventory(user_id,product_id,quantity,acquired_at) values(v_buyer,v_product.id,1,clock_timestamp());
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
$function$;


CREATE OR REPLACE FUNCTION public.execute_transfer(p_sender_id uuid, p_recipient_id uuid, p_amount numeric, p_description text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_sender public.accounts%rowtype;v_recipient public.accounts%rowtype;v_transaction uuid;v_existing public.transactions%rowtype;v_tax_settings jsonb;v_tax numeric:=0;v_total numeric;v_sender_name text;v_quote jsonb;
begin
  if auth.uid() is null or p_sender_id is distinct from auth.uid() then raise exception 'TRANSFER_SENDER_FORBIDDEN'; end if;
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
  select * into v_existing from public.transactions where idempotency_key=p_idempotency_key;
  if found then
    if not exists(select 1 from public.accounts where id=v_existing.from_account_id and user_id=auth.uid()) then raise exception 'IDEMPOTENCY_KEY_FORBIDDEN'; end if;
    if v_existing.amount is distinct from p_amount or v_existing.type<>'transfer' or not exists(select 1 from public.accounts where id=v_existing.to_account_id and user_id=p_recipient_id) then raise exception 'IDEMPOTENCY_PAYLOAD_MISMATCH'; end if;
    return jsonb_build_object('success',true,'message','Transferência já processada.','transaction_id',v_existing.id); end if;
  if p_sender_id=p_recipient_id or p_amount IS NULL or p_recipient_id IS NULL or p_amount<0.01 or p_amount::text IN('NaN','Infinity','-Infinity') or p_amount<>round(p_amount,2) then raise exception 'INVALID_TRANSFER'; end if;
  perform public.process_due_legal_effects();
  perform id from public.accounts where user_id in(p_sender_id,p_recipient_id) order by id for update;
  select * into v_sender from public.accounts where user_id=p_sender_id;
  select * into v_recipient from public.accounts where user_id=p_recipient_id;
  if v_sender.id is null or v_recipient.id is null then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  v_quote:=public.quote_legal_levies('transfer',p_amount,false);
  if (v_quote->>'restricted')::boolean then raise exception 'ACTIVITY_RESTRICTED_BY_LAW'; end if;
  v_tax:=(v_quote->>'buyer_tax')::numeric;
  v_total:=p_amount+v_tax;if v_sender.balance<v_total then raise exception 'INSUFFICIENT_BALANCE'; end if;
  update public.accounts set balance=balance-v_total,updated_at=clock_timestamp() where id=v_sender.id;
  update public.accounts set balance=balance+p_amount,updated_at=clock_timestamp() where id=v_recipient.id;
  if v_tax>0 then
    insert into public.government_finances(id) values(1) on conflict(id) do nothing;
    update public.government_finances set treasury_balance=treasury_balance+v_tax,updated_at=clock_timestamp() where id=1;
  end if;
  insert into public.transactions(from_account_id,to_account_id,amount,description,type,metadata,idempotency_key)
  values(v_sender.id,v_recipient.id,p_amount,coalesce(nullif(btrim(p_description),''),'Transferência'),'transfer',v_quote,p_idempotency_key)
  returning id into v_transaction;
  if v_tax>0 then insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,amount,occurred_at_rp,metadata)
    values('financial','transactions',v_transaction::text,p_sender_id,v_tax,public.rp_now(),jsonb_build_object('kind','transaction_tax')); end if;
  select full_name into v_sender_name from public.profiles where id=p_sender_id;
  insert into public.notifications(user_id,sender_id,type,content,link) values(p_recipient_id,p_sender_id,'transfer_received','Você recebeu uma transferência de '||to_char(p_amount,'FM999G999G990D00')||' de '||coalesce(v_sender_name,'Cidadão'),'/services/bank');
  insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key,status,processed_at)
  values('bank_transfer_completed','economy','transactions',v_transaction,p_sender_id,jsonb_build_object('recipientId',p_recipient_id,'amount',p_amount,'tax',v_tax),
    'bank-transfer:'||p_idempotency_key,'processed',clock_timestamp());
  return jsonb_build_object('success',true,'message','Transferência realizada com sucesso!','transaction_id',v_transaction);
end;
$function$;


CREATE OR REPLACE FUNCTION public.register_business_authoritative(p_owner_id uuid, p_business_type_id text, p_company_name text, p_description text, p_idempotency_key uuid)
 RETURNS businesses
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account public.accounts%rowtype;
  v_type public.business_types%rowtype;
  v_business public.businesses%rowtype;
  v_fee numeric;
  v_transaction uuid; v_quote jsonb;
begin
  if auth.role()<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
  select * into v_business from public.businesses where registration_idempotency_key=p_idempotency_key;
  if found then if v_business.owner_id IS DISTINCT FROM p_owner_id then raise exception 'IDEMPOTENCY_KEY_FORBIDDEN'; end if; return v_business; end if;
  if length(btrim(coalesce(p_company_name,'')))<5 or length(btrim(coalesce(p_description,'')))<15 then
    raise exception 'BUSINESS_DETAILS_INCOMPLETE';
  end if;
  select * into v_type from public.business_types where id=p_business_type_id and is_active for share;
  if not found then raise exception 'BUSINESS_TYPE_NOT_AVAILABLE'; end if;
  perform public.process_due_legal_effects();
  select * into v_account from public.accounts where user_id=p_owner_id for update;
  if not found then raise exception 'BANK_ACCOUNT_REQUIRED'; end if;
  v_quote:=public.quote_legal_levies('license',0,true,v_type.economic_sector_id);
  if (v_quote->>'restricted')::boolean then raise exception 'ACTIVITY_RESTRICTED_BY_LAW'; end if;
  v_fee:=(v_quote->>'buyer_tax')::numeric;
  if v_account.balance<v_fee then raise exception 'INSUFFICIENT_BALANCE'; end if;

  insert into public.government_finances(id) values(1) on conflict(id) do nothing;
  insert into public.businesses(
    owner_id,business_type_id,name,description,status,employees,monthly_revenue,
    bank_account_id,registration_idempotency_key,economic_sector_id
  ) values(
    p_owner_id,p_business_type_id,btrim(p_company_name),btrim(p_description),'pending',
    v_type.min_employees,0,v_account.id,p_idempotency_key,v_type.economic_sector_id
  ) returning * into v_business;
  update public.accounts set balance=balance-v_fee,updated_at=clock_timestamp() where id=v_account.id;
  update public.government_finances set treasury_balance=treasury_balance+v_fee,updated_at=clock_timestamp() where id=1;
  insert into public.transactions(from_account_id,amount,description,type,metadata,idempotency_key)
  values(v_account.id,v_fee,'Taxa de registro empresarial: '||v_business.name,'service_fee',
    jsonb_build_object('business_id',v_business.id,'business_type_id',p_business_type_id,'fee_type','business_registration','treasury_credit',true)||v_quote,
    p_idempotency_key) returning id into v_transaction;
  insert into public.business_transactions(business_id,type,amount,description)
  values(v_business.id,'registration',-v_fee,'Taxa de registro: '||v_business.name);
  if v_fee>0 then insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,business_id,amount,occurred_at_rp,metadata)
  values('fee','transactions',v_transaction::text,p_owner_id,v_business.id,v_fee,public.rp_now(),jsonb_build_object('kind','business_registration')); end if;
  insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key,status,processed_at)
  values('business_registered','economy','businesses',v_business.id,p_owner_id,
    jsonb_build_object('businessName',v_business.name,'fee',v_fee,'transactionId',v_transaction),
    'business-registration:'||p_idempotency_key,'processed',clock_timestamp());
  return v_business;
end;
$function$;


CREATE OR REPLACE FUNCTION public.get_products_with_final_price()
 RETURNS TABLE(id uuid, seller_id uuid, name text, description text, price numeric, image_url text, created_at timestamp with time zone, product_type text, subscription_interval text, subscription_price numeric, metadata jsonb, category text, stock integer, promotion_price numeric, promotion_expires_at timestamp with time zone, sales_count integer, subscribers_count integer, tax_rate numeric, final_price numeric, seller json)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select product.id,product.seller_id,product.name,product.description,product.price,product.image_url,product.created_at,
    product.product_type,product.subscription_interval,product.subscription_price,product.metadata,product.category,product.stock,
    product.promotion_price,product.promotion_expires_at,product.sales_count,product.subscribers_count,
    case when price_data.base>0 then (levy.value->>'buyer_tax')::numeric/price_data.base else 0 end,
    (levy.value->>'total_debited')::numeric,
    json_build_object('id',seller.id,'full_name',seller.full_name,'x_handle',seller.x_handle,'role',seller.role,
      'seller_type',product.seller_type,'business_id',business.id,'business_name',business.name,'business_status',business.status,'activity_restricted',(levy.value->>'restricted')::boolean,
      'documents',(select json_agg(json_build_object('type',document.type,'document_number',document.document_number,'metadata',json_build_object('company_name',business.name))) from public.documents document where document.user_id=seller.id and document.type='CNPJ' and document.metadata->>'business_id'=business.id::text))
  from public.products product
  join public.profiles seller on seller.id=product.seller_id
  left join public.businesses business on business.id=product.business_id
  cross join lateral (select case when product.promotion_price is not null and product.promotion_expires_at>statement_timestamp() then product.promotion_price else product.price end AS base) price_data
  cross join lateral (select public.quote_legal_levies('purchase',price_data.base,product.business_id is not null,coalesce(product.economic_sector_id,business.economic_sector_id),product.category) AS value) levy
  where seller.deleted_at is null
    and (seller.onboarding_completed or seller.onboarding_mode='legacy_migration')
    and (product.business_id is null or business.status='active')
  order by product.created_at desc, product.id desc
$function$;


CREATE OR REPLACE FUNCTION public.generate_transaction_receipt(p_transaction_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    receipt_data RECORD;
    current_user_id UUID := auth.uid();
    is_involved BOOLEAN;
    is_admin_user BOOLEAN;
    seller_cnpj_details JSONB;
    recipient_user_id UUID;
    total_amount NUMERIC;
BEGIN
    SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = current_user_id AND role = 'Admin') INTO is_admin_user;

    SELECT EXISTS (
        SELECT 1
        FROM public.transactions t
        LEFT JOIN public.accounts a_from ON t.from_account_id = a_from.id
        LEFT JOIN public.accounts a_to ON t.to_account_id = a_to.id
        WHERE t.id = p_transaction_id AND (a_from.user_id = current_user_id OR a_to.user_id = current_user_id)
    ) INTO is_involved;

    IF NOT is_involved AND NOT is_admin_user THEN
        RETURN jsonb_build_object('success', false, 'message', 'Você não tem permissão para ver este comprovante.');
    END IF;

    SELECT
        t.id,
        t.amount, -- This is the base amount
        t.description,
        t.type,
        t.created_at,
        t.metadata,
        CASE WHEN sender_acc.user_id=current_user_id THEN 'sent' ELSE 'received' END AS direction,
        COALESCE((t.metadata->>'tax_amount')::numeric, 0) as tax_amount, -- get tax from metadata
        sender_p.full_name as sender_name,
        sender_p.role as sender_role,
        sender_acc.transfer_key as sender_key,
        sender_acc.cpf as sender_cpf,
        sender_acc.agency_number as sender_agency,
        sender_acc.account_number as sender_account,
        recipient_p.full_name as recipient_name,
        recipient_p.role as recipient_role,
        recipient_acc.transfer_key as recipient_key,
        recipient_acc.cpf as recipient_cpf,
        recipient_acc.agency_number as recipient_agency,
        recipient_acc.account_number as recipient_account,
        recipient_acc.user_id as recipient_user_id
    INTO receipt_data
    FROM public.transactions t
    LEFT JOIN public.accounts sender_acc ON t.from_account_id = sender_acc.id
    LEFT JOIN public.profiles sender_p ON sender_acc.user_id = sender_p.id
    LEFT JOIN public.accounts recipient_acc ON t.to_account_id = recipient_acc.id
    LEFT JOIN public.profiles recipient_p ON recipient_acc.user_id = recipient_p.id
    WHERE t.id = p_transaction_id;

    IF receipt_data IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Comprovante não encontrado.');
    END IF;

    total_amount := coalesce((receipt_data.metadata->>'total_debited')::numeric,receipt_data.amount);

    IF receipt_data.recipient_role = 'PJ' THEN
        SELECT jsonb_build_object(
            'cnpj', d.document_number,
            'business_name', d.metadata->>'business_name',
            'trade_name', d.metadata->>'trade_name'
        )
        INTO seller_cnpj_details
        FROM public.documents d
        WHERE d.user_id = receipt_data.recipient_user_id
        AND d.type = 'CNPJ'
        LIMIT 1;

        receipt_data.metadata := jsonb_set(COALESCE(receipt_data.metadata, '{}'::jsonb), '{seller_cnpj_details}', seller_cnpj_details);
    END IF;

    RETURN jsonb_build_object('success', true, 'total_amount', total_amount) || jsonb_strip_nulls(to_jsonb(receipt_data));
END;
$function$;


CREATE OR REPLACE FUNCTION public.issue_document_request(p_document_type text, p_metadata jsonb DEFAULT NULL::jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    current_user_id UUID := auth.uid();
    doc_fee numeric;
    user_account record; quote jsonb;
    new_doc_number text;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(current_user_id::text||':document:'||coalesce(p_document_type,''),0));
    IF p_document_type IS NULL OR p_document_type NOT IN('CNH','Passport','CPF','RG','CTD','CNPJ','Título de Eleitor','Certificado de Reservista','Certidão de Casamento','Registro Profissional') THEN RAISE EXCEPTION 'INVALID_DOCUMENT_TYPE'; END IF;
    -- Prevent issuing duplicate documents, except for CNPJ which can have multiple.
    IF EXISTS (SELECT 1 FROM public.documents WHERE user_id = current_user_id AND type = p_document_type AND p_document_type <> 'CNPJ') THEN
      RETURN json_build_object('success', false, 'message', 'Você já possui este documento.');
    END IF;

    -- Check if user has a bank account to pay fees.
    PERFORM public.process_due_legal_effects();
    quote:=public.quote_legal_levies('document',0,false,NULL,NULL,p_document_type);
    doc_fee:=(quote->>'buyer_tax')::numeric;
    SELECT * INTO user_account FROM public.accounts WHERE user_id = current_user_id FOR UPDATE;
    IF user_account IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Você precisa de uma conta bancária para solicitar documentos.');
    END IF;

    -- Check for sufficient balance.
    IF user_account.balance < doc_fee THEN
        RETURN json_build_object('success', false, 'message', 'Saldo insuficiente para pagar a taxa de emissão.');
    END IF;

    -- Generate a unique number for the new document.
    new_doc_number := public.generate_unique_document_number(p_document_type);

    -- Insert the new document record.
    INSERT INTO public.documents (user_id, type, document_number, issued_at, expires_at, is_valid, metadata)
    VALUES (
        current_user_id,
        p_document_type,
        new_doc_number,
        now(),
        CASE
            WHEN p_document_type = 'CNH' THEN now() + interval '5 years'
            WHEN p_document_type = 'Passport' THEN now() + interval '10 years'
            ELSE NULL
        END,
        true,
        p_metadata -- Store additional data like business names for CNPJ
    );

    -- Deduct fee if applicable and record the transaction.
    IF doc_fee > 0 THEN
        UPDATE public.accounts SET balance = balance - doc_fee WHERE id = user_account.id;
        INSERT INTO public.transactions (from_account_id, amount, description, type, metadata)
        VALUES (user_account.id, doc_fee, 'Taxa de emissão de ' || p_document_type, 'service_fee',quote);
        INSERT INTO public.government_finances(id) VALUES(1) ON CONFLICT DO NOTHING;
        UPDATE public.government_finances SET treasury_balance=treasury_balance+doc_fee WHERE id=1;
    END IF;

    -- Notify the user.
    INSERT INTO public.notifications (user_id, type, content, link)
    VALUES (current_user_id, 'document_issued', 'Seu documento ' || p_document_type || ' foi emitido com sucesso!', '/dashboard');

    RETURN json_build_object('success', true, 'message', 'Documento emitido com sucesso!');
END;
$function$;


CREATE OR REPLACE FUNCTION public.issue_document(p_request_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    request record;
    new_doc_number text;
    doc_fee numeric := 0.00; -- Taxa pode ser ajustada aqui ou em uma tabela de configurações
    user_account record; quote jsonb;
BEGIN
    -- Apenas admins podem executar
    IF NOT public.is_admin() THEN
        RETURN json_build_object('success', false, 'message', 'Acesso não autorizado.');
    END IF;

    SELECT * INTO request FROM public.document_requests WHERE id = p_request_id FOR UPDATE;

    IF request IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Solicitação não encontrada.');
    END IF;

    IF request.status <> 'Pendente' THEN
        RETURN json_build_object('success', false, 'message', 'Esta solicitação já foi processada.');
    END IF;

    -- Verificar se o usuário tem saldo para a taxa
    PERFORM public.process_due_legal_effects();
    quote:=public.quote_legal_levies('document',0,false,NULL,NULL,request.document_type);
    doc_fee:=(quote->>'buyer_tax')::numeric;
    SELECT * INTO user_account FROM public.accounts WHERE user_id = request.user_id FOR UPDATE;
    IF user_account IS NULL THEN
        UPDATE public.document_requests SET status = 'Recusado' WHERE id = p_request_id;
        RETURN json_build_object('success', false, 'message', 'Usuário não possui conta bancária para pagar a taxa.');
    END IF;

    IF user_account.balance < doc_fee THEN
        UPDATE public.document_requests SET status = 'Recusado' WHERE id = p_request_id;
        RETURN json_build_object('success', false, 'message', 'Saldo insuficiente para pagar a taxa de emissão.');
    END IF;

    -- Gerar número único
    new_doc_number := public.generate_unique_document_number(request.document_type);

    -- Inserir novo documento
    INSERT INTO public.documents (user_id, type, document_number, issued_at, expires_at, is_valid)
    VALUES (
        request.user_id,
        request.document_type,
        new_doc_number,
        now(),
        CASE
            WHEN request.document_type = 'CNH' THEN now() + interval '5 years'
            WHEN request.document_type = 'Passport' THEN now() + interval '10 years'
            ELSE NULL
        END,
        true
    );

    -- Debitar taxa
    IF doc_fee > 0 THEN
        UPDATE public.accounts SET balance = balance - doc_fee WHERE id = user_account.id;
        INSERT INTO public.transactions (from_account_id, amount, description, type, metadata)
        VALUES (user_account.id, doc_fee, 'Taxa de emissão de ' || request.document_type, 'service_fee',quote);
        INSERT INTO public.government_finances(id) VALUES(1) ON CONFLICT DO NOTHING;
        UPDATE public.government_finances SET treasury_balance=treasury_balance+doc_fee WHERE id=1;
    END IF;

    -- Atualizar status da solicitação
    UPDATE public.document_requests SET status = 'Aprovado' WHERE id = p_request_id;

    -- Notificar usuário
    INSERT INTO public.notifications (user_id, type, content, link)
    VALUES (request.user_id, 'document_issued', 'Seu documento ' || request.document_type || ' foi emitido com sucesso!', '/services/dic');

    RETURN json_build_object('success', true, 'message', 'Documento emitido com sucesso.');
END;
$function$;


CREATE OR REPLACE FUNCTION public.publish_decree_to_dou()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
    IF NEW.is_published = true AND (OLD.is_published = false OR OLD.is_published IS NULL) THEN
        INSERT INTO public.dou_entries (title, summary, content, published_at, type, source_id)
        SELECT NEW.title, 'Decreto Presidencial', NEW.content, NEW.published_at, 'Decreto', NEW.id WHERE NOT EXISTS(SELECT 1 FROM public.dou_entries WHERE source_id=NEW.id);

        -- Notificar todos os cidadãos sobre o novo decreto
        INSERT INTO public.notifications (user_id, sender_id, type, content, link)
        SELECT p.id, NEW.author_id, 'decree_published', 'Novo decreto publicado: ' || NEW.title, '/news'
        FROM public.profiles p;

    END IF;
    RETURN NEW;
END;
$function$;


NOTIFY pgrst,'reload schema';
COMMIT;
