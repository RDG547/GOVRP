begin;

-- Uma instalação nova precisa nascer com o Tesouro disponível; ambientes
-- antigos que já possuem o registro permanecem inalterados.
insert into public.government_finances(id) values(1) on conflict(id) do nothing;

-- Uma instalação vazia também precisa aceitar o primeiro produto; estes itens
-- são somente a base categórica e não substituem observações reais de preço.
insert into public.price_basket_items(code,name,category,weight,base_price,current_price,source_type,is_essential)
values
  ('food','Alimentos','Alimentos',0.20,100,100,'observed',true),
  ('clothing','Vestuário','Vestuário',0.10,100,100,'observed',false),
  ('health','Saúde','Saúde',0.15,100,100,'observed',true),
  ('education','Educação','Educação',0.15,100,100,'observed',true),
  ('leisure','Lazer','Lazer',0.10,100,100,'observed',false),
  ('housing','Habitação','Habitação',0.20,100,100,'observed',true),
  ('other','Outros','Outros',0.10,100,100,'observed',false)
on conflict(code) do nothing;

alter table public.businesses
  add column if not exists bank_account_id uuid references public.accounts(id) on delete restrict,
  add column if not exists registration_idempotency_key uuid unique;
alter table public.products
  add column if not exists business_id uuid references public.businesses(id) on delete restrict;
alter table public.transactions
  add column if not exists idempotency_key uuid unique,
  add column if not exists status text not null default 'completed',
  add column if not exists currency text not null default 'BRL';

update public.businesses business
set bank_account_id=account.id
from public.accounts account
where business.bank_account_id is null and account.user_id=business.owner_id;

update public.products product
set business_id=(
  select business.id from public.businesses business
  where business.owner_id=product.seller_id and business.status in('active','pending')
  order by case business.status when 'active' then 0 else 1 end,business.created_at
  limit 1
)
where product.business_id is null;

create index if not exists products_business_recent_idx on public.products(business_id,created_at desc);
create index if not exists transactions_recent_idx on public.transactions(created_at desc,id desc);

create table if not exists public.commerce_orders(
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  buyer_account_id uuid references public.accounts(id) on delete restrict,
  seller_account_id uuid not null references public.accounts(id) on delete restrict,
  card_id uuid references public.cards(id) on delete restrict,
  payment_method text not null check(payment_method in('balance','card')),
  base_amount numeric(15,2) not null check(base_amount>0),
  consumption_tax numeric(15,2) not null check(consumption_tax>=0),
  corporate_tax numeric(15,2) not null check(corporate_tax>=0),
  total_amount numeric(15,2) not null check(total_amount>0),
  seller_net_amount numeric(15,2) not null check(seller_net_amount>=0),
  transaction_id uuid references public.transactions(id) on delete restrict,
  status text not null default 'completed' check(status in('processing','completed','refunded','failed')),
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz
);
create index if not exists commerce_orders_buyer_recent_idx on public.commerce_orders(buyer_id,created_at desc);
create index if not exists commerce_orders_business_recent_idx on public.commerce_orders(business_id,created_at desc);
alter table public.commerce_orders enable row level security;
drop policy if exists commerce_orders_contextual_read on public.commerce_orders;
create policy commerce_orders_contextual_read on public.commerce_orders for select to authenticated using(
  buyer_id=auth.uid()
  or exists(select 1 from public.businesses business where business.id=commerce_orders.business_id and business.owner_id=auth.uid())
  or public.economic_has_role(array['Admin'])
);

create or replace function public.assign_business_bank_account()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.bank_account_id is null then
    select id into new.bank_account_id from public.accounts where user_id=new.owner_id limit 1;
  end if;
  return new;
end;
$$;
drop trigger if exists businesses_assign_bank_account on public.businesses;
create trigger businesses_assign_bank_account before insert or update of owner_id on public.businesses
for each row execute function public.assign_business_bank_account();

create or replace function public.register_business_authoritative(
  p_owner_id uuid,p_business_type_id text,p_company_name text,p_description text,p_idempotency_key uuid
)
returns public.businesses
language plpgsql security definer set search_path='' as $$
declare
  v_account public.accounts%rowtype;
  v_type public.business_types%rowtype;
  v_business public.businesses%rowtype;
  v_fee numeric;
  v_transaction uuid;
begin
  if auth.role()<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  select * into v_business from public.businesses where registration_idempotency_key=p_idempotency_key;
  if found then return v_business; end if;
  if length(btrim(coalesce(p_company_name,'')))<5 or length(btrim(coalesce(p_description,'')))<15 then
    raise exception 'BUSINESS_DETAILS_INCOMPLETE';
  end if;
  select * into v_type from public.business_types where id=p_business_type_id and is_active for share;
  if not found then raise exception 'BUSINESS_TYPE_NOT_AVAILABLE'; end if;
  select * into v_account from public.accounts where user_id=p_owner_id for update;
  if not found then raise exception 'BANK_ACCOUNT_REQUIRED'; end if;
  v_fee:=coalesce(public.get_government_rule('business_license_fee'),v_type.registration_fee);
  if v_fee<=0 then raise exception 'INVALID_BUSINESS_LICENSE_FEE'; end if;
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
    jsonb_build_object('business_id',v_business.id,'business_type_id',p_business_type_id,'fee_type','business_registration','treasury_credit',true),
    p_idempotency_key) returning id into v_transaction;
  insert into public.business_transactions(business_id,type,amount,description)
  values(v_business.id,'registration',-v_fee,'Taxa de registro: '||v_business.name);
  insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,business_id,amount,occurred_at_rp,metadata)
  values('fee','transactions',v_transaction::text,p_owner_id,v_business.id,v_fee,public.rp_now(),jsonb_build_object('kind','business_registration'));
  insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key,status,processed_at)
  values('business_registered','economy','businesses',v_business.id,p_owner_id,
    jsonb_build_object('businessName',v_business.name,'fee',v_fee,'transactionId',v_transaction),
    'business-registration:'||p_idempotency_key,'processed',clock_timestamp());
  return v_business;
end;
$$;

create or replace function public.save_business_product(
  p_product_id uuid,p_business_id uuid,p_name text,p_description text,p_price numeric,
  p_image_url text,p_product_type text,p_subscription_interval text,p_category text,p_stock integer,
  p_promotion_price numeric,p_promotion_expires_at timestamptz
)
returns public.products
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_business public.businesses%rowtype;v_product public.products%rowtype;
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  select * into v_business from public.businesses where id=p_business_id for share;
  if not found or v_business.owner_id is distinct from v_actor then raise exception 'BUSINESS_OWNERSHIP_REQUIRED'; end if;
  if v_business.status not in('active','pending') then raise exception 'BUSINESS_NOT_ACTIVE'; end if;
  if v_business.bank_account_id is null then raise exception 'BUSINESS_BANK_ACCOUNT_REQUIRED'; end if;
  if length(btrim(coalesce(p_name,'')))<3 or length(btrim(coalesce(p_description,'')))<5 then raise exception 'PRODUCT_DETAILS_INCOMPLETE'; end if;
  if p_price<=0 then raise exception 'INVALID_PRODUCT_PRICE'; end if;
  if p_product_type not in('one-time','subscription') then raise exception 'INVALID_PRODUCT_TYPE'; end if;
  if p_product_type='one-time' and coalesce(p_stock,0)<1 then raise exception 'INVALID_PRODUCT_STOCK'; end if;
  if p_product_type='subscription' and p_subscription_interval not in('7 days','30 days') then raise exception 'INVALID_SUBSCRIPTION_INTERVAL'; end if;
  if p_product_id is null then
    insert into public.products(
      seller_id,business_id,name,description,price,image_url,product_type,subscription_interval,
      subscription_price,category,stock,promotion_price,promotion_expires_at
    ) values(
      v_actor,p_business_id,btrim(p_name),btrim(p_description),p_price,nullif(btrim(coalesce(p_image_url,'')),''),
      p_product_type,case when p_product_type='subscription' then p_subscription_interval end,
      case when p_product_type='subscription' then p_price end,btrim(p_category),
      case when p_product_type='one-time' then p_stock end,p_promotion_price,p_promotion_expires_at
    ) returning * into v_product;
  else
    update public.products set business_id=p_business_id,name=btrim(p_name),description=btrim(p_description),price=p_price,
      image_url=nullif(btrim(coalesce(p_image_url,'')),''),product_type=p_product_type,
      subscription_interval=case when p_product_type='subscription' then p_subscription_interval end,
      subscription_price=case when p_product_type='subscription' then p_price end,category=btrim(p_category),
      stock=case when p_product_type='one-time' then p_stock end,promotion_price=p_promotion_price,
      promotion_expires_at=p_promotion_expires_at
    where id=p_product_id and seller_id=v_actor returning * into v_product;
    if not found then raise exception 'PRODUCT_NOT_FOUND_OR_FORBIDDEN'; end if;
  end if;
  return v_product;
end;
$$;

create or replace function public.buy_product(
  p_product_id uuid,p_payment_method text,p_card_id uuid,p_idempotency_key uuid
)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_buyer uuid:=auth.uid();v_product public.products%rowtype;v_business public.businesses%rowtype;
  v_buyer_account public.accounts%rowtype;v_seller_account public.accounts%rowtype;v_card public.cards%rowtype;
  v_base numeric;v_consumption_rate numeric;v_corporate_rate numeric;v_consumption_tax numeric;v_corporate_tax numeric;
  v_total numeric;v_seller_net numeric;v_transaction uuid;v_order public.commerce_orders%rowtype;v_invoice uuid;v_buyer_name text;
begin
  if v_buyer is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  select * into v_order from public.commerce_orders where idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('success',v_order.status='completed','message','Compra já processada.','transaction_id',v_order.transaction_id,'order_id',v_order.id); end if;
  select * into v_product from public.products where id=p_product_id for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  if v_product.seller_id=v_buyer then raise exception 'OWN_PRODUCT_PURCHASE_DENIED'; end if;
  if v_product.business_id is null then raise exception 'PRODUCT_WITHOUT_BUSINESS'; end if;
  select * into v_business from public.businesses where id=v_product.business_id for share;
  if v_business.status<>'active' then raise exception 'BUSINESS_NOT_ACTIVE'; end if;
  select * into v_seller_account from public.accounts where id=v_business.bank_account_id for update;
  if not found then raise exception 'BUSINESS_BANK_ACCOUNT_REQUIRED'; end if;
  if v_product.product_type='one-time' and coalesce(v_product.stock,0)<=0 then raise exception 'PRODUCT_OUT_OF_STOCK'; end if;
  v_base:=case when v_product.promotion_price is not null and v_product.promotion_expires_at>clock_timestamp() then v_product.promotion_price else v_product.price end;
  v_consumption_rate:=coalesce(public.get_government_rule('consumption_tax_rate'),0);
  v_corporate_rate:=coalesce(public.get_government_rule('corporate_tax_rate'),0);
  v_consumption_tax:=round(v_base*v_consumption_rate,2);v_corporate_tax:=round(v_base*v_corporate_rate,2);
  v_total:=v_base+v_consumption_tax;v_seller_net:=greatest(0,v_base-v_corporate_tax);

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
    jsonb_build_object('platform','Negócios Livres','business_id',v_business.id,'product_id',v_product.id,
      'base_price',v_base,'consumption_tax',v_consumption_tax,'corporate_tax',v_corporate_tax,'seller_net',v_seller_net,'card_id',p_card_id),
    p_idempotency_key) returning id into v_transaction;
  insert into public.commerce_orders(
    idempotency_key,buyer_id,business_id,product_id,buyer_account_id,seller_account_id,card_id,payment_method,
    base_amount,consumption_tax,corporate_tax,total_amount,seller_net_amount,transaction_id,status,completed_at
  ) values(p_idempotency_key,v_buyer,v_business.id,v_product.id,v_buyer_account.id,v_seller_account.id,p_card_id,p_payment_method,
    v_base,v_consumption_tax,v_corporate_tax,v_total,v_seller_net,v_transaction,'completed',clock_timestamp()) returning * into v_order;
  insert into public.business_transactions(business_id,type,amount,description) values(v_business.id,'revenue',v_base,'Venda: '||v_product.name);
  if v_corporate_tax>0 then insert into public.business_transactions(business_id,type,amount,description) values(v_business.id,'tax',-v_corporate_tax,'Imposto da venda: '||v_product.name); end if;
  update public.businesses set monthly_revenue=monthly_revenue+v_base,updated_at=clock_timestamp() where id=v_business.id;

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
  values(v_business.owner_id,v_buyer,'product_sold',coalesce(v_buyer_name,'Um cidadão')||' comprou: '||v_product.name,'/dashboard?tab=products');
  insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key,status,processed_at)
  values('commerce_purchase_completed','economy','commerce_orders',v_order.id,v_buyer,
    jsonb_build_object('businessId',v_business.id,'productId',v_product.id,'total',v_total,'tax',v_consumption_tax+v_corporate_tax,'transactionId',v_transaction),
    'commerce-purchase:'||p_idempotency_key,'processed',clock_timestamp());
  return jsonb_build_object('success',true,'message','Compra realizada com sucesso!','transaction_id',v_transaction,'order_id',v_order.id,
    'total',v_total,'tax',v_consumption_tax+v_corporate_tax);
exception when others then
  raise;
end;
$$;

create or replace function public.buy_product(p_product_id uuid,p_payment_method text,p_card_id uuid default null)
returns json language plpgsql security definer set search_path='' as $$
begin return public.buy_product(p_product_id,p_payment_method,p_card_id,gen_random_uuid())::json; end;
$$;

create or replace function public.execute_transfer(
  p_sender_id uuid,p_recipient_id uuid,p_amount numeric,p_description text,p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_sender public.accounts%rowtype;v_recipient public.accounts%rowtype;v_transaction uuid;v_existing public.transactions%rowtype;v_tax_settings jsonb;v_tax numeric:=0;v_total numeric;v_sender_name text;
begin
  if auth.uid() is null or p_sender_id is distinct from auth.uid() then raise exception 'TRANSFER_SENDER_FORBIDDEN'; end if;
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  select * into v_existing from public.transactions where idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('success',true,'message','Transferência já processada.','transaction_id',v_existing.id); end if;
  if p_sender_id=p_recipient_id or p_amount<0.01 then raise exception 'INVALID_TRANSFER'; end if;
  perform id from public.accounts where user_id in(p_sender_id,p_recipient_id) order by id for update;
  select * into v_sender from public.accounts where user_id=p_sender_id;
  select * into v_recipient from public.accounts where user_id=p_recipient_id;
  if v_sender.id is null or v_recipient.id is null then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  select value into v_tax_settings from public.system_settings where key='transaction_tax';
  if coalesce((v_tax_settings->>'value')::numeric,0)>0 then
    v_tax:=case when v_tax_settings->>'type'='percentage' then p_amount*(v_tax_settings->>'value')::numeric else (v_tax_settings->>'value')::numeric end;
  end if;
  v_total:=p_amount+v_tax;if v_sender.balance<v_total then raise exception 'INSUFFICIENT_BALANCE'; end if;
  update public.accounts set balance=balance-v_total,updated_at=clock_timestamp() where id=v_sender.id;
  update public.accounts set balance=balance+p_amount,updated_at=clock_timestamp() where id=v_recipient.id;
  if v_tax>0 then
    insert into public.government_finances(id) values(1) on conflict(id) do nothing;
    update public.government_finances set treasury_balance=treasury_balance+v_tax,updated_at=clock_timestamp() where id=1;
  end if;
  insert into public.transactions(from_account_id,to_account_id,amount,description,type,metadata,idempotency_key)
  values(v_sender.id,v_recipient.id,p_amount,coalesce(nullif(btrim(p_description),''),'Transferência'),'transfer',jsonb_build_object('tax_amount',v_tax,'tax_details',v_tax_settings),p_idempotency_key)
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
$$;

create or replace function public.execute_transfer(p_sender_id uuid,p_recipient_id uuid,p_amount numeric,p_description text)
returns json language plpgsql security definer set search_path='' as $$
begin return public.execute_transfer(p_sender_id,p_recipient_id,p_amount,p_description,gen_random_uuid())::json; end;
$$;

create or replace function public.get_products_with_final_price()
returns table(id uuid,seller_id uuid,name text,description text,price numeric,image_url text,created_at timestamptz,
  product_type text,subscription_interval text,subscription_price numeric,metadata jsonb,category text,stock integer,
  promotion_price numeric,promotion_expires_at timestamptz,sales_count integer,subscribers_count integer,tax_rate numeric,
  final_price numeric,seller json)
language sql stable security definer set search_path='' as $$
  select product.id,product.seller_id,product.name,product.description,product.price,product.image_url,product.created_at,
    product.product_type,product.subscription_interval,product.subscription_price,product.metadata,product.category,product.stock,
    product.promotion_price,product.promotion_expires_at,product.sales_count,product.subscribers_count,
    coalesce(public.get_government_rule('consumption_tax_rate'),0),
    (case when product.promotion_price is not null and product.promotion_expires_at>clock_timestamp() then product.promotion_price else product.price end)
      *(1+coalesce(public.get_government_rule('consumption_tax_rate'),0)),
    json_build_object('id',seller.id,'full_name',seller.full_name,'x_handle',seller.x_handle,'role',seller.role,
      'business_id',business.id,'business_name',business.name,'business_status',business.status,
      'documents',(select json_agg(document) from public.documents document where document.user_id=seller.id and document.type='CNPJ'))
  from public.products product
  join public.profiles seller on seller.id=product.seller_id
  left join public.businesses business on business.id=product.business_id
  where product.business_id is not null and business.status='active'
$$;

create or replace function public.get_admin_transaction_history(
  p_page integer default 1,p_page_size integer default 25,p_search text default null,p_type text default null
)
returns table(id uuid,created_at timestamptz,type text,description text,amount numeric,currency text,status text,
  sender_name text,recipient_name text,metadata jsonb,total_count bigint)
language plpgsql stable security definer set search_path='' as $$
declare v_limit integer:=least(100,greatest(5,coalesce(p_page_size,25)));v_offset integer:=(greatest(1,coalesce(p_page,1))-1)*least(100,greatest(5,coalesce(p_page_size,25)));
begin
  if not public.economic_has_role(array['Admin']) then raise exception 'ADMIN_REQUIRED'; end if;
  return query
  select transaction.id,transaction.created_at,transaction.type,transaction.description,transaction.amount,transaction.currency,transaction.status,
    sender.full_name,recipient.full_name,transaction.metadata,count(*) over()
  from public.transactions transaction
  left join public.accounts sender_account on sender_account.id=transaction.from_account_id
  left join public.profiles sender on sender.id=sender_account.user_id
  left join public.accounts recipient_account on recipient_account.id=transaction.to_account_id
  left join public.profiles recipient on recipient.id=recipient_account.user_id
  where (p_type is null or p_type='' or transaction.type=p_type)
    and (p_search is null or p_search='' or transaction.description ilike '%'||p_search||'%' or sender.full_name ilike '%'||p_search||'%' or recipient.full_name ilike '%'||p_search||'%' or transaction.id::text=p_search)
  order by transaction.created_at desc,transaction.id desc limit v_limit offset v_offset;
end;
$$;

drop policy if exists "Users can insert their own transactions." on public.transactions;
drop policy if exists business_transactions_insert on public.business_transactions;
drop policy if exists "Users can insert their own products." on public.products;
drop policy if exists "Users can update their own products." on public.products;
revoke insert,update,delete on public.transactions from anon,authenticated;
revoke insert,update,delete on public.business_transactions from anon,authenticated;
revoke insert,update on public.products from anon,authenticated;
revoke insert,update,delete on public.commerce_orders from anon,authenticated;
grant select on public.commerce_orders to authenticated;
grant execute on function public.save_business_product(uuid,uuid,text,text,numeric,text,text,text,text,integer,numeric,timestamptz) to authenticated,service_role;
grant execute on function public.buy_product(uuid,text,uuid,uuid) to authenticated,service_role;
revoke all on function public.buy_product(uuid,text,uuid) from anon;
grant execute on function public.buy_product(uuid,text,uuid) to authenticated,service_role;
grant execute on function public.execute_transfer(uuid,uuid,numeric,text,uuid) to authenticated,service_role;
revoke all on function public.execute_transfer(uuid,uuid,numeric,text) from anon;
grant execute on function public.execute_transfer(uuid,uuid,numeric,text) to authenticated,service_role;
revoke all on function public.register_business_authoritative(uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.register_business_authoritative(uuid,text,text,text,uuid) to service_role;
revoke all on function public.get_admin_transaction_history(integer,integer,text,text) from public,anon;
grant execute on function public.get_admin_transaction_history(integer,integer,text,text) to authenticated,service_role;

commit;
