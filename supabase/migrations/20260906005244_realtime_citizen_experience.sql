-- Reuse the existing commerce, party and notification domains.
-- No reset or removal of player data is performed by this migration.
alter table public.products add column if not exists seller_type text
  generated always as (case when business_id is null then 'citizen' else 'business' end) stored;
alter table public.commerce_orders alter column business_id drop not null;
alter table public.commerce_orders add column if not exists seller_id uuid references public.profiles(id);
update public.commerce_orders o set seller_id=a.user_id from public.accounts a
where a.id=o.seller_account_id and o.seller_id is null;
create index if not exists commerce_orders_seller_recent_idx on public.commerce_orders(seller_id,created_at desc);
drop policy if exists commerce_orders_contextual_read on public.commerce_orders;
create policy commerce_orders_contextual_read on public.commerce_orders for select to authenticated using(
  buyer_id=(select auth.uid()) or seller_id=(select auth.uid()) or public.economic_has_role(array['Admin'])
);

CREATE OR REPLACE FUNCTION public.save_business_product(p_product_id uuid, p_business_id uuid, p_name text, p_description text, p_price numeric, p_image_url text, p_product_type text, p_subscription_interval text, p_category text, p_stock integer, p_promotion_price numeric, p_promotion_expires_at timestamp with time zone)
 RETURNS products
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid();v_business public.businesses%rowtype;v_product public.products%rowtype;
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if not exists(select 1 from public.profiles where id=v_actor and onboarding_completed and deleted_at is null) then
    raise exception 'CITIZENSHIP_REQUIRED';
  end if;
  if p_business_id is not null then
    select * into v_business from public.businesses where id=p_business_id for share;
    if not found or v_business.owner_id is distinct from v_actor then raise exception 'BUSINESS_OWNERSHIP_REQUIRED'; end if;
    if v_business.status not in('active','pending') then raise exception 'BUSINESS_NOT_ACTIVE'; end if;
    if v_business.bank_account_id is null then raise exception 'BUSINESS_BANK_ACCOUNT_REQUIRED'; end if;
  elsif not exists(select 1 from public.accounts where user_id=v_actor) then
    raise exception 'BANK_ACCOUNT_REQUIRED';
  end if;
  if length(btrim(coalesce(p_name,'')))<3 or length(btrim(coalesce(p_description,'')))<5 then raise exception 'PRODUCT_DETAILS_INCOMPLETE'; end if;
  if p_price is null or p_price<=0 or p_price::text in('NaN','Infinity','-Infinity') then raise exception 'INVALID_PRODUCT_PRICE'; end if;
  if p_product_type is null or p_product_type not in('one-time','subscription') then raise exception 'INVALID_PRODUCT_TYPE'; end if;
  if p_product_type='one-time' and (p_stock is null or p_stock<0 or (p_product_id is null and p_stock<1)) then raise exception 'INVALID_PRODUCT_STOCK'; end if;
  if p_product_type='subscription' and (p_subscription_interval is null or p_subscription_interval not in('7 days','30 days')) then raise exception 'INVALID_SUBSCRIPTION_INTERVAL'; end if;
  if p_promotion_price is not null and (p_promotion_price::text in('NaN','Infinity','-Infinity') or p_promotion_price<=0 or p_promotion_price>=p_price or p_promotion_expires_at is null) then
    raise exception 'INVALID_PROMOTION';
  end if;
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
  v_total numeric;v_seller_net numeric;v_transaction uuid;v_order public.commerce_orders%rowtype;v_invoice uuid;v_buyer_name text;
begin
  if v_buyer is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
  select * into v_order from public.commerce_orders where idempotency_key=p_idempotency_key;
  if found then
    if v_order.buyer_id is distinct from v_buyer then raise exception 'IDEMPOTENCY_KEY_FORBIDDEN'; end if;
    if v_order.product_id is distinct from p_product_id or v_order.payment_method is distinct from p_payment_method or v_order.card_id is distinct from p_card_id then raise exception 'IDEMPOTENCY_PAYLOAD_MISMATCH'; end if;
    return jsonb_build_object('success',v_order.status='completed','message','Compra já processada.','transaction_id',v_order.transaction_id,'order_id',v_order.id); end if;
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
  v_consumption_rate:=coalesce(public.get_government_rule('consumption_tax_rate'),0);
  v_corporate_rate:=case when v_product.business_id is null then 0 else coalesce(public.get_government_rule('corporate_tax_rate'),0) end;
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
    jsonb_build_object('platform','Negócios Livres','business_id',v_business.id,'product_id',v_product.id,'seller_type',v_product.seller_type,'seller_id',v_product.seller_id,'seller_name',(select full_name from public.profiles where id=v_product.seller_id),
      'base_price',v_base,'consumption_tax',v_consumption_tax,'corporate_tax',v_corporate_tax,'seller_net',v_seller_net,'card_id',p_card_id),
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
$function$
;

CREATE OR REPLACE FUNCTION public.respond_to_affiliation_request(p_request_id uuid, p_is_approved boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare request public.party_affiliation_requests%rowtype; actor_role public.party_role; party_name text; applicant_name text;
begin
  select * into request from public.party_affiliation_requests where id=p_request_id for update;
  if not found or request.status<>'pending' then return json_build_object('success',false,'message','Solicitação indisponível.'); end if;
  select role into actor_role from public.party_members where party_id=request.party_id and user_id=auth.uid();
  if auth.uid() is null or (coalesce(actor_role::text,'') not in('Dono','Presidente','Vice-Presidente') and public.get_user_role(auth.uid()) is distinct from 'Admin') then return json_build_object('success',false,'message','Sem permissão para decidir esta solicitação.'); end if;
  select name into party_name from public.political_parties where id=request.party_id;
  select coalesce(full_name,username,'Cidadão') into applicant_name from public.profiles where id=request.user_id;
  if p_is_approved then
    if exists(select 1 from public.party_members where user_id=request.user_id) then return json_build_object('success',false,'message','O solicitante já está filiado a outro partido.'); end if;
    insert into public.party_members(party_id,user_id,role) values(request.party_id,request.user_id,'Membro');
    update public.profiles set party_affiliation=request.party_id where id=request.user_id;
  end if;
  update public.party_affiliation_requests set status=case when p_is_approved then 'approved' else 'rejected' end where id=request.id;
  insert into public.party_history(party_id,actor_id,event_type,summary,current_state)
  values(request.party_id,auth.uid(),case when p_is_approved then 'affiliation_approved' else 'affiliation_rejected' end,'Solicitação de '||applicant_name||case when p_is_approved then ' aprovada.' else ' rejeitada.' end,jsonb_build_object('userId',request.user_id));
  insert into public.notifications(user_id,sender_id,type,content,link) values(request.user_id,auth.uid(),'party_affiliation_decided','Sua solicitação para '||party_name||case when p_is_approved then ' foi aprovada.' else ' foi rejeitada.' end,'/services/political-parties/'||request.party_id);
  return json_build_object('success',true,'message',case when p_is_approved then 'Membro aprovado.' else 'Solicitação rejeitada.' end);
end; $function$
;

-- Requests may only be changed through the authorized affiliation RPCs.
revoke insert,update,delete on public.party_affiliation_requests from authenticated,anon;
drop policy if exists "Users can create and view their own requests" on public.party_affiliation_requests;
drop policy if exists affiliation_request_owner_read on public.party_affiliation_requests;
create policy affiliation_request_owner_read on public.party_affiliation_requests for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists "Party leaders can view requests for their party" on public.party_affiliation_requests;
drop policy if exists affiliation_request_leadership_read on public.party_affiliation_requests;
create policy affiliation_request_leadership_read on public.party_affiliation_requests for select to authenticated using(
  exists(select 1 from public.political_parties p where p.id=party_id and (select auth.uid()) in(p.owner_id,p.president_id,p.vice_president_id))
  or public.get_user_role((select auth.uid()))='Admin'
);

-- A real membership insertion creates a persistent, private welcome event.
create unique index if not exists notifications_party_welcome_membership_idx
  on public.notifications((metadata->>'membership_id')) where type='party_membership_confirmed';
create or replace function private.notify_party_membership_confirmed()
returns trigger language plpgsql security definer set search_path='' as $$
declare p public.political_parties%rowtype;
begin
  select * into p from public.political_parties where id=new.party_id;
  insert into public.notifications(user_id,type,content,link,metadata)
  values(new.user_id,'party_membership_confirmed','Sua filiação ao partido '||p.name||' foi confirmada.',
    '/services/political-parties/'||p.id,
    jsonb_build_object('membership_id',new.id,'party_id',p.id,'party_name',p.name,'party_acronym',p.acronym,'logo_url',p.logo_url));
  return new;
end; $$;
revoke all on function private.notify_party_membership_confirmed() from public,anon,authenticated;
drop trigger if exists party_membership_welcome on public.party_members;
create trigger party_membership_welcome after insert on public.party_members for each row execute function private.notify_party_membership_confirmed();

-- A harmless public revision invalidates public party portraits after a profile change.
-- Clients never need to subscribe to private profile fields.
alter table public.political_parties add column if not exists public_updated_at timestamptz default clock_timestamp();
create or replace function private.touch_public_party_profiles()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (new.full_name,new.username,new.avatar_url,new.role,new.titles,new.onboarding_completed,new.deleted_at)
      is distinct from (old.full_name,old.username,old.avatar_url,old.role,old.titles,old.onboarding_completed,old.deleted_at) then
    update public.political_parties p set public_updated_at=clock_timestamp()
    where new.id in(p.founder_id,p.owner_id,p.president_id,p.vice_president_id)
       or exists(select 1 from public.party_members m where m.party_id=p.id and m.user_id=new.id);
  end if;
  return new;
end; $$;
revoke all on function private.touch_public_party_profiles() from public,anon,authenticated;
drop trigger if exists public_party_profile_changed on public.profiles;
create trigger public_party_profile_changed after update on public.profiles for each row execute function private.touch_public_party_profiles();

-- Publications carry only existing RLS-protected domain rows.
do $$ declare t text; begin
  foreach t in array array['political_parties','party_members','party_affiliation_requests','bill_suggestions','user_services','businesses','products','accounts','cards','credit_card_applications','card_invoices','card_invoice_items','loan_applications','notifications','posts','likes','comments','followers','x_messages','x_conversations','x_conversation_participants','news_articles','dou_entries','national_media_briefs','police_occurrences','criminal_investigations','criminal_cases','judicial_requests','warrants','prison_terms','police_fines','fine_appeals','fine_hearing_requests','citizen_justice_requests','public_integrity_cases','investigation_subjects','case_timeline_events','case_documents','hearings','appeals','sentences','investigation_parties','case_parties','parliament_members','bills','bill_votings','plebiscites','parliament_commissions','parliament_leadership_terms','transactions','user_investments','investment_operations','investment_portfolio_snapshots','investment_options','product_reviews','government_rules','news_categories'] loop
    if exists(select 1 from pg_publication where pubname='supabase_realtime') and to_regclass('public.'||t) is not null and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I',t);
    end if;
  end loop;
end; $$;
notify pgrst,'reload schema';

create or replace function public.acknowledge_party_welcome(p_notification_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  update public.notifications set metadata=jsonb_set(coalesce(metadata,'{}'),'{celebration_seen_at}',to_jsonb(clock_timestamp())),is_read=true
  where id=p_notification_id and user_id=auth.uid() and type='party_membership_confirmed' and metadata->>'celebration_seen_at' is null;
  return found;
end; $$;
revoke all on function public.acknowledge_party_welcome(uuid) from public,anon;
grant execute on function public.acknowledge_party_welcome(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.get_products_with_final_price()
 RETURNS TABLE(id uuid, seller_id uuid, name text, description text, price numeric, image_url text, created_at timestamp with time zone, product_type text, subscription_interval text, subscription_price numeric, metadata jsonb, category text, stock integer, promotion_price numeric, promotion_expires_at timestamp with time zone, sales_count integer, subscribers_count integer, tax_rate numeric, final_price numeric, seller json)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select product.id,product.seller_id,product.name,product.description,product.price,product.image_url,product.created_at,
    product.product_type,product.subscription_interval,product.subscription_price,product.metadata,product.category,product.stock,
    product.promotion_price,product.promotion_expires_at,product.sales_count,product.subscribers_count,
    coalesce(public.get_government_rule('consumption_tax_rate'),0),
    (case when product.promotion_price is not null and product.promotion_expires_at>clock_timestamp() then product.promotion_price else product.price end)
      *(1+coalesce(public.get_government_rule('consumption_tax_rate'),0)),
    json_build_object('id',seller.id,'full_name',seller.full_name,'x_handle',seller.x_handle,'role',seller.role,
      'seller_type',product.seller_type,'business_id',business.id,'business_name',business.name,'business_status',business.status,
      'documents',(select json_agg(json_build_object('type',document.type,'document_number',document.document_number,'metadata',json_build_object('company_name',business.name))) from public.documents document where document.user_id=seller.id and document.type='CNPJ' and document.metadata->>'business_id'=business.id::text))
  from public.products product
  join public.profiles seller on seller.id=product.seller_id
  left join public.businesses business on business.id=product.business_id
  where seller.onboarding_completed and seller.deleted_at is null and (product.business_id is null or business.status='active')
$function$

;

-- The immutable audit record preserves authorship even when notifications are deleted.
-- Return only fields that the author may see, never internal triage/evidence/subjects.
create or replace function public.get_my_police_occurrences()
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(row_data order by created_at desc),'[]') from (
    select o.created_at,jsonb_build_object(
      'id',o.id,'protocol_number',o.protocol_number,'title',o.title,
      'description',o.description,'details',o.details,'status',o.status,
      'priority',o.priority,'created_at',o.created_at,'updated_at',o.updated_at,
      'history',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'content',case when a.action='occurrence.created' then 'Ocorrência recebida.' else 'Situação: '||coalesce(a.new_state->>'status','Atualizada')||'.' end,'created_at',a.created_at,'status',a.new_state->>'status') order by a.created_at)
        from public.justice_audit_log a where a.entity_type='police_occurrence' and a.entity_id=o.id
          and a.action in('occurrence.created','occurrence.status_changed')),'[]')
    ) row_data
    from public.police_occurrences o where auth.uid() is not null and (
      o.user_id=auth.uid() or o.reported_by=auth.uid() or exists(
        select 1 from public.justice_audit_log a where a.actor_id=auth.uid() and a.action='occurrence.created' and a.entity_type='police_occurrence' and a.entity_id=o.id
      )
    ) order by o.created_at desc limit 100
  ) own_occurrences;
$$;
revoke all on function public.get_my_police_occurrences() from public,anon;
grant execute on function public.get_my_police_occurrences() to authenticated;
create index if not exists notifications_occurrence_owner_idx on public.notifications(user_id,(metadata->>'occurrence_id'),created_at)
  where type in('justice_occurrence_created','justice_occurrence_status_changed');

create or replace function private.notify_occurrence_status_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid;
begin
  if new.status is not distinct from old.status then return new; end if;
  recipient:=coalesce(new.user_id,new.reported_by);
  if recipient is null then
    select a.actor_id into recipient from public.justice_audit_log a
    where a.action='occurrence.created' and a.entity_type='police_occurrence' and a.entity_id=new.id order by a.created_at limit 1;
  end if;
  perform public.justice_write_audit('occurrence.status_changed','police_occurrence',new.id,jsonb_build_object('status',old.status),jsonb_build_object('status',new.status),'Atualização do andamento público da ocorrência');
  if recipient is not null then
    perform public.justice_notify(recipient,'justice_occurrence_status_changed',
      'Ocorrência '||new.protocol_number||': '||new.status||'.','/services/justice?view=citizen',
      jsonb_build_object('occurrence_id',new.id,'protocol_number',new.protocol_number,'status',new.status,'previous_status',old.status));
  end if;
  return new;
end; $$;
revoke all on function private.notify_occurrence_status_change() from public,anon,authenticated;
drop trigger if exists occurrence_status_notification on public.police_occurrences;
create trigger occurrence_status_notification after update of status on public.police_occurrences
  for each row execute function private.notify_occurrence_status_change();

create index if not exists justice_audit_occurrence_owner_idx on public.justice_audit_log(actor_id,entity_id) where action='occurrence.created' and entity_type='police_occurrence';

-- Campaign management remains administrative; police powers no longer publish campaigns.
CREATE OR REPLACE FUNCTION public.manage_public_safety_campaign(p_campaign_id uuid, p_title text, p_summary text, p_content text, p_category text, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_is_published boolean)
 RETURNS public_safety_campaigns
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result public.public_safety_campaigns%rowtype;
begin
  if not public.justice_has_role(array['Admin']) then raise exception 'Sem competência para publicar campanhas.'; end if;
  if length(trim(coalesce(p_title,'')))<5 or length(trim(coalesce(p_content,'')))<20 then raise exception 'Conteúdo insuficiente.'; end if;
  if p_ends_at is not null and p_ends_at<=p_starts_at then raise exception 'Período inválido.'; end if;
  if p_campaign_id is null then
    insert into public.public_safety_campaigns(title,summary,content,category,starts_at,ends_at,is_published,created_by)
    values(trim(p_title),trim(p_summary),trim(p_content),trim(p_category),coalesce(p_starts_at,clock_timestamp()),p_ends_at,p_is_published,auth.uid()) returning * into result;
  else
    update public.public_safety_campaigns set title=trim(p_title),summary=trim(p_summary),content=trim(p_content),category=trim(p_category),starts_at=coalesce(p_starts_at,starts_at),ends_at=p_ends_at,is_published=p_is_published,updated_at=clock_timestamp() where id=p_campaign_id returning * into result;
  end if;
  return result;
end; $function$

;

alter table public.accounts add column if not exists bank_welcome_completed boolean not null default true;
alter table public.accounts alter column bank_welcome_completed set default false;
update public.accounts a set bank_welcome_completed=false from public.profiles p
where a.user_id=p.id and p.onboarding_completed=false and a.bank_welcome_completed;
create or replace function public.complete_bank_welcome()
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  update public.accounts set bank_welcome_completed=true where user_id=auth.uid();
  if not found then raise exception 'BANK_ACCOUNT_REQUIRED'; end if;
  return true;
end; $$;
revoke all on function public.complete_bank_welcome() from public,anon;
grant execute on function public.complete_bank_welcome() to authenticated;

CREATE OR REPLACE FUNCTION public.get_my_citizen_onboarding()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null then raise exception 'Usuário não autenticado.'; end if;

  select jsonb_build_object(
    'settings', jsonb_build_object('initial_bank_balance',1000) || coalesce((select value::jsonb from public.system_settings where key='citizen_onboarding'),'{}'::jsonb),
    'profile', to_jsonb(p) - 'email' - 'phone',
    'account_identity', (
      select to_jsonb(ai) - 'created_at' - 'updated_at'
      from private.account_identities ai where ai.user_id = v_user_id
    ),
    'documents', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.issued_at)
      from public.documents d where d.user_id = v_user_id and d.is_valid = true
    ), '[]'::jsonb),
    'bank_account', (
      select to_jsonb(a) from public.accounts a where a.user_id = v_user_id limit 1
    ),
    'lifecycle_events', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.created_at)
      from public.citizen_lifecycle_events e where e.user_id = v_user_id
    ), '[]'::jsonb)
  ) into v_result
  from public.profiles p
  where p.id = v_user_id;

  if v_result is null then raise exception 'Perfil não encontrado.'; end if;
  return v_result;
end;
$function$

;


-- Bounded, authorized post hydration for incremental updates.
CREATE OR REPLACE FUNCTION public.get_x_posts(p_post_ids uuid[] DEFAULT NULL, p_author_id uuid DEFAULT NULL, p_before timestamptz DEFAULT NULL)
 RETURNS TABLE(id uuid, user_id uuid, content text, created_at timestamp with time zone, parent_post_id uuid, likes_count integer, comments_count integer, views_count integer, reposts_count integer, image_url text, author json, is_liked_by_user boolean, is_reposted_by_user boolean, original_post json, quote_content text, metadata jsonb, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
SELECT
    p.id,
    p.user_id,
    p.content,
    p.created_at,
    p.parent_post_id,
    p.likes_count,
    p.comments_count,
    p.views_count,
    p.reposts_count,
    p.image_url,
    json_build_object(
        'id', u.id,
        'username', u.username,
        'full_name', u.full_name,
        'avatar_url', u.avatar_url,
        'x_avatar_url', u.x_avatar_url,
        'x_username', u.x_username,
        'x_handle', u.x_handle,
        'role', u.role,
        'titles', u.titles
    ) as author,
    EXISTS(SELECT 1 FROM public.likes l WHERE l.post_id = p.id AND l.user_id = auth.uid()) as is_liked_by_user,
    EXISTS(SELECT 1 FROM public.posts rp WHERE rp.original_post_id = p.id AND rp.user_id = auth.uid()) as is_reposted_by_user,
    (
      SELECT json_build_object(
        'id', op.id,
        'content', op.content,
        'created_at', op.created_at,
        'image_url', op.image_url,
        'author', json_build_object(
          'id', op_author.id,
          'x_username', op_author.x_username,
          'x_handle', op_author.x_handle,
          'x_avatar_url', op_author.x_avatar_url
        )
      )
      FROM public.posts op
      JOIN public.profiles op_author ON op.user_id = op_author.id
      WHERE op.id = p.original_post_id
    ) as original_post,
    p.quote_content,
    p.metadata,
    p.updated_at
FROM
    public.posts p
JOIN
    public.profiles u ON p.user_id = u.id
WHERE
    p.parent_post_id IS NULL
    AND (p_post_ids IS NULL OR p.id = ANY(p_post_ids))
    AND (p_author_id IS NULL OR p.user_id = p_author_id)
    AND (p_before IS NULL OR p.created_at < p_before)
ORDER BY
    p.created_at DESC, p.id DESC LIMIT 100;
$function$;
REVOKE ALL ON FUNCTION public.get_x_posts(uuid[],uuid,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_x_posts(uuid[],uuid,timestamptz) TO authenticated;

-- Public invalidation carries no profile payload, credentials or OOC identity.
CREATE OR REPLACE VIEW public.public_citizen_profiles WITH (security_invoker=true) AS
SELECT id,citizen_id,username,full_name,avatar_url,character_bio,date_of_birth,
 residence_country_code,residence_country_name,residence_state_code,residence_state_name,
 residence_city_code,residence_city_name,role,titles,occupation,education_level,
 party_affiliation,reputation_points,x_handle,x_username,x_bio,x_avatar_url,
 citizenship_created_at,x_header_url
FROM public.profiles WHERE onboarding_completed=true;

CREATE OR REPLACE FUNCTION private.broadcast_public_profile_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (NEW.onboarding_completed OR OLD.onboarding_completed)
    AND ROW(NEW.full_name,NEW.avatar_url,NEW.role,NEW.titles,NEW.x_username,NEW.x_handle,NEW.x_avatar_url,NEW.x_header_url,NEW.x_bio,NEW.onboarding_completed)
    IS DISTINCT FROM ROW(OLD.full_name,OLD.avatar_url,OLD.role,OLD.titles,OLD.x_username,OLD.x_handle,OLD.x_avatar_url,OLD.x_header_url,OLD.x_bio,OLD.onboarding_completed)
    AND to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
   PERFORM realtime.send(jsonb_build_object('id',NEW.id),'public-profile-changed','citizen-public-profile',false);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.broadcast_public_profile_change() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS public_profile_change_broadcast ON public.profiles;
CREATE TRIGGER public_profile_change_broadcast AFTER UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION private.broadcast_public_profile_change();

CREATE OR REPLACE FUNCTION public.send_x_message(p_recipient_id uuid, p_content text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_conversation_id uuid; v_message public.x_messages%rowtype;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 IF p_recipient_id=v_actor THEN RETURN json_build_object('success',false,'message','Escolha outro participante.'); END IF;
 IF length(btrim(coalesce(p_content,''))) NOT BETWEEN 1 AND 4000 THEN
  RETURN json_build_object('success',false,'message','A mensagem deve ter entre 1 e 4.000 caracteres.'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_actor AND onboarding_completed AND x_handle IS NOT NULL)
 OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_recipient_id AND onboarding_completed AND x_handle IS NOT NULL) THEN
  RETURN json_build_object('success',false,'message','Participante indisponível no X.'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(least(v_actor::text,p_recipient_id::text)||greatest(v_actor::text,p_recipient_id::text),0));
 SELECT a.conversation_id INTO v_conversation_id FROM public.x_conversation_participants a
 JOIN public.x_conversation_participants b ON a.conversation_id=b.conversation_id
 WHERE a.user_id=v_actor AND b.user_id=p_recipient_id ORDER BY a.conversation_id LIMIT 1;
 IF v_conversation_id IS NULL THEN
  INSERT INTO public.x_conversations DEFAULT VALUES RETURNING id INTO v_conversation_id;
  INSERT INTO public.x_conversation_participants(conversation_id,user_id) VALUES(v_conversation_id,v_actor),(v_conversation_id,p_recipient_id);
 END IF;
 INSERT INTO public.x_messages(conversation_id,sender_id,content) VALUES(v_conversation_id,v_actor,btrim(p_content)) RETURNING * INTO v_message;
 INSERT INTO public.notifications(user_id,sender_id,type,content,link)
 VALUES(p_recipient_id,v_actor,'x_dm','enviou uma nova mensagem.','/services/x/messages/'||v_conversation_id);
 RETURN json_build_object('success',true,'conversation_id',v_conversation_id,'message',row_to_json(v_message));
END $$;
REVOKE ALL ON FUNCTION public.send_x_message(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.send_x_message(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_x_conversation(p_conversation_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.x_conversation_participants WHERE conversation_id=p_conversation_id AND user_id=auth.uid()) THEN
 RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
 DELETE FROM public.x_conversations WHERE id=p_conversation_id;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.delete_x_conversation(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_x_conversation(uuid) TO authenticated;

-- Daily editions use the publication day in Brazil, including every published source.
CREATE OR REPLACE FUNCTION public.get_daily_news(p_date date DEFAULT NULL, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH feed AS (
  SELECT 'article:'||a.id::text id,a.title,a.content,a.image_url,a.created_at published_at,
   'article'::text source_type,coalesce(c.name,'Notícias') category,a.id article_id,
   coalesce(p.full_name,p.username,'Redação GOVRP') author
  FROM public.news_articles a LEFT JOIN public.news_categories c ON c.id=a.category_id
  LEFT JOIN public.public_citizen_profiles p ON p.id=a.author_id
  UNION ALL
  SELECT 'gazette:'||d.id::text,d.title,d.content,NULL::text,d.published_at,'official_gazette',coalesce(d.type,'Diário Oficial'),NULL::uuid,'Diário Oficial da União'
  FROM public.dou_entries d
  UNION ALL
  SELECT 'brief:'||b.id::text,b.title,b.facts,NULL::text,b.published_at,'national_event',b.category,NULL::uuid,'Agência Nacional GOVRP'
  FROM public.national_media_briefs b WHERE b.status='published'
 ), dated AS (
  SELECT f.*,(published_at AT TIME ZONE 'America/Sao_Paulo')::date edition_date FROM feed f WHERE published_at<=now()
 ), chosen AS (SELECT coalesce(p_date,(now() AT TIME ZONE 'America/Sao_Paulo')::date) AS edition_day),
 edition AS (SELECT d.* FROM dated d,chosen c WHERE d.edition_date=c.edition_day),
 page AS (SELECT * FROM edition ORDER BY published_at DESC,id LIMIT 50 OFFSET greatest(0,coalesce(p_offset,0)))
 SELECT jsonb_build_object('date',c.edition_day,'total',(SELECT count(*) FROM edition),
  'previous_date',(SELECT max(edition_date) FROM dated WHERE edition_date<c.edition_day),
  'next_date',(SELECT min(edition_date) FROM dated WHERE edition_date>c.edition_day),
  'items',coalesce((SELECT jsonb_agg(to_jsonb(page) ORDER BY published_at DESC,id) FROM page),'[]'::jsonb))
 FROM chosen c
$$;
REVOKE ALL ON FUNCTION public.get_daily_news(date,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_daily_news(date,integer) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_bill_suggestion_targets()
RETURNS TABLE(id uuid,name text,avatar_url text,role text,party_name text,party_acronym text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH roles AS (
  SELECT p.id,p.role FROM public.profiles p WHERE p.onboarding_completed
   AND p.role IN('Deputado','Senador') AND p.manual_role_override
   AND NOT public.election_supersedes_manual_role(p.role,p.role_assigned_at)
  UNION
  SELECT m.user_id,CASE WHEN h.name ILIKE '%senado%' THEN 'Senador' ELSE 'Deputado' END
   FROM public.parliament_members m JOIN public.parliament_houses h ON h.id=m.house_id
   WHERE m.term_start_date<=current_date AND (m.term_end_date IS NULL OR m.term_end_date>=current_date)
  UNION
  SELECT (assignment->>'user_id')::uuid,assignment->>'office_role'
   FROM public.system_settings s CROSS JOIN LATERAL jsonb_array_elements(coalesce(s.value::jsonb->'active_assignments','[]'::jsonb)) assignment
   WHERE s.key='election_office_sync' AND assignment->>'office_role' IN('Deputado','Senador')
    AND nullif(assignment->>'user_id','') IS NOT NULL
    AND (nullif(assignment->>'term_start_at','') IS NULL OR (assignment->>'term_start_at')::timestamptz<=now())
    AND (nullif(assignment->>'term_end_at','') IS NULL OR (assignment->>'term_end_at')::timestamptz>now())
 )
 SELECT DISTINCT ON(p.id) p.id,coalesce(nullif(p.full_name,''),p.username),p.avatar_url,r.role,party.name,party.acronym
 FROM roles r JOIN public.public_citizen_profiles p ON p.id=r.id
 LEFT JOIN public.party_members member ON member.user_id=p.id
 LEFT JOIN public.political_parties party ON party.id=member.party_id
 ORDER BY p.id,r.role DESC
$$;
REVOKE ALL ON FUNCTION public.get_bill_suggestion_targets() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_bill_suggestion_targets() TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_bill_suggestion(p_title text, p_suggestion text, p_target_type text, p_target_id uuid, p_bill_type text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); result public.bill_suggestions%rowtype;
begin
  if actor is null then return json_build_object('success',false,'message','Faça login para enviar a sugestão.'); end if;
  if p_target_type not in('parliamentarian','party','house') then return json_build_object('success',false,'message','Tipo de destinatário inválido.'); end if;
  if p_bill_type not in('PL','PLC','PEC','PDL','PR','MP') then return json_build_object('success',false,'message','Tipo de projeto inválido.'); end if;
  if length(trim(coalesce(p_title,'')))<5 or length(trim(coalesce(p_suggestion,'')))<20 then return json_build_object('success',false,'message','Descreva melhor a proposta.'); end if;
  if p_target_type='house' and not exists(select 1 from public.parliament_houses where id=p_target_id) then return json_build_object('success',false,'message','Casa legislativa inválida.'); end if;
  if p_target_type='party' and not exists(select 1 from public.political_parties where id=p_target_id) then return json_build_object('success',false,'message','Partido inválido.'); end if;
  if p_target_type='parliamentarian' and not exists(select 1 from public.get_bill_suggestion_targets() target where target.id=p_target_id) then return json_build_object('success',false,'message','Este cidadão não ocupa um cargo parlamentar válido.'); end if;
  insert into public.bill_suggestions(title,suggestion,author_id,target_type,target_id,status,bill_type)
  values(trim(p_title),trim(p_suggestion),actor,p_target_type,p_target_id,'Pendente',p_bill_type) returning * into result;
  return json_build_object('success',true,'message','Sua sugestão foi enviada e os destinatários foram notificados.','suggestion',to_jsonb(result));
end; $function$;

CREATE OR REPLACE FUNCTION public.revoke_judicial_warrant(p_warrant_id uuid,p_reason text)
RETURNS public.warrants LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous public.warrants%rowtype; result public.warrants%rowtype;
BEGIN
 IF NOT public.justice_has_role(ARRAY['Admin','Juiz']) THEN RAISE EXCEPTION 'ROLE_NOT_AUTHORIZED'; END IF;
 IF length(btrim(coalesce(p_reason,'')))<20 THEN RAISE EXCEPTION 'DECISION_REASON_TOO_SHORT'; END IF;
 SELECT * INTO previous FROM public.warrants WHERE id=p_warrant_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'WARRANT_NOT_FOUND'; END IF;
 IF previous.status<>'issued' OR previous.expires_at<=now() THEN RAISE EXCEPTION 'WARRANT_NOT_ACTIVE'; END IF;
 IF previous.target_profile_id=auth.uid() THEN RAISE EXCEPTION 'JUDGE_CONFLICT_OF_INTEREST'; END IF;
 IF NOT public.justice_has_role(ARRAY['Admin']) AND previous.issued_by<>auth.uid()
 AND NOT EXISTS(SELECT 1 FROM public.criminal_cases WHERE id=previous.case_id AND judge_id=auth.uid()) THEN
 RAISE EXCEPTION 'ONLY_ASSIGNED_JUDGE_CAN_DECIDE'; END IF;
 UPDATE public.warrants SET status='revoked',revoked_by=auth.uid(),revocation_reason=btrim(p_reason)
 WHERE id=p_warrant_id RETURNING * INTO result;
 PERFORM public.justice_write_audit('warrant.revoked','warrant',result.id,to_jsonb(previous),to_jsonb(result),p_reason);
 PERFORM public.justice_notify(previous.issued_by,'justice_warrant_revoked','O mandado '||previous.warrant_number||' foi revogado.','/services/justice?view=authority',jsonb_build_object('warrant_id',previous.id));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.revoke_judicial_warrant(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.revoke_judicial_warrant(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION private.set_civil_document_issuer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.type IN('CPF','RG') THEN NEW.metadata=coalesce(NEW.metadata,'{}'::jsonb)||jsonb_build_object('issuing_authority','Departamento de Identificação Civil — DIC','issuer','DIC'); END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.set_civil_document_issuer() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS civil_document_issuer ON public.documents;
CREATE TRIGGER civil_document_issuer BEFORE INSERT OR UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION private.set_civil_document_issuer();
UPDATE public.documents SET metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('issuing_authority','Departamento de Identificação Civil — DIC','issuer','DIC')
WHERE type IN('CPF','RG') AND (metadata->>'issuer' IS DISTINCT FROM 'DIC' OR metadata->>'issuing_authority' IS DISTINCT FROM 'Departamento de Identificação Civil — DIC');

-- A public fine is owed to the treasury, not a hard-coded citizen account.
CREATE OR REPLACE FUNCTION public.generate_bill_for_fine()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 NEW.bill_code:='FINE-'||replace(gen_random_uuid()::text,'-','');
 INSERT INTO public.bills_of_exchange(issuer_id,payer_id,bill_code,amount,due_date,status,description)
 VALUES(NULL,NEW.user_id,NEW.bill_code,NEW.amount,NEW.due_date,'pending','Multa: '||NEW.reason);
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.pay_fine(p_fine_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid:=auth.uid(); fine public.police_fines%rowtype; account public.accounts%rowtype;
  days_overdue int:=0; interest numeric(15,2):=0; total numeric(15,2); transaction_id uuid;
begin
  select * into fine from public.police_fines where id=p_fine_id and user_id=actor for update;
  if not found then return json_build_object('success',false,'message','Multa não encontrada ou não pertence a você.'); end if;
  if fine.status='Paga' then
    return json_build_object('success',true,'message','Esta multa já foi paga.','receipt',fine.payment_snapshot);
  end if;
  if fine.status not in('Pendente','Vencida') then return json_build_object('success',false,'message','Esta multa não está disponível para pagamento.'); end if;
  if fine.due_date is not null and fine.due_date<clock_timestamp() then days_overdue:=greatest(0,floor(extract(epoch from(clock_timestamp()-fine.due_date))/86400)::int); end if;
  interest:=round(fine.amount*0.0033*days_overdue,2); total:=round(fine.amount+interest,2);
  select * into account from public.accounts where user_id=actor for update;
  if not found or account.balance<total then return json_build_object('success',false,'message','Saldo insuficiente para pagar a multa e os juros.'); end if;
  update public.accounts set balance=balance-total,updated_at=clock_timestamp() where id=account.id;
  update public.government_finances set treasury_balance=treasury_balance+total,updated_at=clock_timestamp() where id=1;
  insert into public.transactions(from_account_id,amount,description,type,metadata)
  values(account.id,total,'Pagamento da multa '||fine.fine_code,'fine_payment',jsonb_build_object('fineId',fine.id,'fineCode',fine.fine_code,'baseAmount',fine.amount,'interestAmount',interest,'daysOverdue',days_overdue))
  returning id into transaction_id;
  update public.police_fines set status='Paga',paid_at=clock_timestamp(),updated_at=clock_timestamp(),payment_transaction_id=transaction_id,
    payment_snapshot=jsonb_build_object('fineCode',fine.fine_code,'transactionId',transaction_id,'baseAmount',fine.amount,'interestAmount',interest,'totalAmount',total,'paidAt',clock_timestamp())
  where id=fine.id;
  update public.bills_of_exchange set status='paid',updated_at=clock_timestamp() where bill_code=fine.bill_code and payer_id=actor;
  perform public.justice_write_audit('fine.paid','police_fine',fine.id,to_jsonb(fine),jsonb_build_object('status','Paga','transactionId',transaction_id),'Pagamento atômico de multa');
  return json_build_object('success',true,'message','Multa paga com sucesso.','receipt',jsonb_build_object('fineCode',fine.fine_code,'transactionId',transaction_id,'baseAmount',fine.amount,'interestAmount',interest,'totalAmount',total));
end; $function$;

CREATE OR REPLACE FUNCTION public.pay_boleto(p_bill_code text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid:=(select auth.uid());
  v_bill public.bills_of_exchange%rowtype;
  v_source public.accounts%rowtype;
  v_target_id uuid;
  v_fine_id uuid;
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  select id into v_fine_id from public.police_fines where bill_code=p_bill_code and user_id=v_actor;
  if v_fine_id is not null then return public.pay_fine(v_fine_id); end if;
  select * into v_bill from public.bills_of_exchange where bill_code=p_bill_code for update;
  if not found then return json_build_object('success',false,'message','Boleto inexistente.'); end if;
  if v_bill.payer_id is not null and v_bill.payer_id<>v_actor then raise exception 'BILL_PAYER_MISMATCH' using errcode='42501'; end if;
  if v_bill.status='paid' then return json_build_object('success',false,'message','Este boleto já foi pago.'); end if;
  if v_bill.status<>'pending' then return json_build_object('success',false,'message','Este boleto não pode ser pago.'); end if;

  select * into v_source from public.accounts where user_id=v_actor order by created_at limit 1 for update;
  if not found then return json_build_object('success',false,'message','Conta bancária não encontrada.'); end if;
  if v_source.balance<v_bill.amount then return json_build_object('success',false,'message','Saldo insuficiente para realizar o pagamento.'); end if;
  select id into v_target_id from public.accounts where user_id=v_bill.issuer_id order by created_at limit 1 for update;

  update public.accounts set balance=balance-v_bill.amount where id=v_source.id;
  if v_target_id is not null then update public.accounts set balance=balance+v_bill.amount where id=v_target_id; end if;
  update public.bills_of_exchange set status='paid',updated_at=clock_timestamp() where id=v_bill.id;
  insert into public.transactions(
    from_account_id,to_account_id,amount,description,type,status,currency,idempotency_key,metadata
  ) values(
    v_source.id,v_target_id,v_bill.amount,'Pagamento de Boleto: '||coalesce(v_bill.description,v_bill.bill_code),
    'bill_payment','completed','BRL',v_bill.id,jsonb_build_object('bill_code',v_bill.bill_code,'bill_id',v_bill.id)
  ) on conflict(idempotency_key) do nothing;
  return json_build_object('success',true,'message','Boleto pago com sucesso!');
end;
$function$;

CREATE OR REPLACE FUNCTION public.issue_fine(p_user_id uuid, p_reason text, p_amount numeric, p_due_date timestamp with time zone)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); fine public.police_fines%rowtype; actor_name text;
begin
  if not public.justice_has_role(array['Admin','Policial','Police','Delegado','Juiz']) then
    return json_build_object('success',false,'message','Acesso não autorizado para emitir multas.');
  end if;
  if p_amount is null or p_amount<=0 or p_amount::text in('NaN','Infinity','-Infinity') then return json_build_object('success',false,'message','O valor da multa deve ser positivo.'); end if;
  if p_due_date is null or p_due_date<=now() then return json_build_object('success',false,'message','Escolha um vencimento futuro.'); end if;
  if nullif(trim(p_reason),'') is null then return json_build_object('success',false,'message','Informe o motivo da multa.'); end if;
  if not exists(select 1 from public.profiles where id=p_user_id) then return json_build_object('success',false,'message','Cidadão não encontrado.'); end if;
  select full_name into actor_name from public.profiles where id=actor;
  insert into public.police_fines(user_id,officer_id,reason,amount,status,due_date,fine_code,issuer_snapshot)
  values(p_user_id,actor,trim(p_reason),round(p_amount,2),'Pendente',p_due_date,'',jsonb_build_object('id',actor,'name',actor_name,'role',public.get_user_role(actor)))
  returning * into fine;
  insert into public.notifications(user_id,sender_id,type,content,link)
  values(p_user_id,actor,'fine_issued','Você recebeu a multa '||fine.fine_code||' no valor de R$ '||to_char(fine.amount,'FM999G999G990D00'),'/services/justice?view=citizen');
  perform public.justice_write_audit('fine.issued','police_fine',fine.id,null,to_jsonb(fine),'Multa emitida');
  return json_build_object('success',true,'message','Multa emitida com sucesso.','fine',to_jsonb(fine),'fine_code',fine.fine_code);
end; $function$;

CREATE OR REPLACE FUNCTION public.request_welcome_credit_card(p_brand text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); application public.credit_card_applications%rowtype;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
 IF p_brand IS NULL OR p_brand NOT IN('visa','mastercard') THEN RAISE EXCEPTION 'Bandeira inválida.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE user_id=actor) THEN RAISE EXCEPTION 'Abra sua conta antes de solicitar o cartão.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':card:'||p_brand,0));
 IF EXISTS(SELECT 1 FROM public.cards WHERE user_id=actor AND brand=p_brand AND is_active) THEN
 RETURN jsonb_build_object('success',true,'status','active'); END IF;
 SELECT * INTO application FROM public.credit_card_applications WHERE user_id=actor AND brand=p_brand AND status IN('Pendente','pending') ORDER BY created_at DESC LIMIT 1;
 IF NOT FOUND THEN
 INSERT INTO public.credit_card_applications(user_id,brand,status) VALUES(actor,p_brand,'Pendente') RETURNING * INTO application;
 END IF;
 RETURN jsonb_build_object('success',true,'status','pending','application_id',application.id);
END $$;
REVOKE ALL ON FUNCTION public.request_welcome_credit_card(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_welcome_credit_card(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.decide_judicial_request(p_request_id uuid, p_approved boolean, p_decision_reason text, p_warrant_duration_rp_days numeric DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare old_request public.judicial_requests%rowtype; decided public.judicial_requests%rowtype; issued public.warrants%rowtype; warrant_kind text; real_seconds bigint;
begin
  if not public.justice_has_role(array['Admin','Juiz']) then raise exception 'ROLE_NOT_AUTHORIZED'; end if;
  if length(trim(coalesce(p_decision_reason,'')))<20 then raise exception 'DECISION_REASON_TOO_SHORT'; end if;
  select * into old_request from public.judicial_requests where id=p_request_id for update;
  if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
  if old_request.status<>'pending' then raise exception 'REQUEST_ALREADY_DECIDED'; end if;
  if old_request.requested_by=auth.uid() or old_request.target_profile_id=auth.uid() then raise exception 'JUDGE_CONFLICT_OF_INTEREST'; end if;
  update public.judicial_requests set status=(case when p_approved then 'approved' else 'denied' end)::public.justice_request_status,
    decided_by=auth.uid(),decision_reason=trim(p_decision_reason),decided_at=clock_timestamp() where id=p_request_id returning * into decided;
  if p_approved and decided.request_type in('arrest_warrant','search_warrant') then
    warrant_kind:=case when decided.request_type='arrest_warrant' then 'arrest' else 'search' end; real_seconds:=public.rp_duration_to_real_seconds(p_warrant_duration_rp_days,'day');
    insert into public.warrants(warrant_number,warrant_type,target_profile_id,case_id,investigation_id,request_id,issued_by,expires_at,status)
    values(public.justice_next_number('MAN'),warrant_kind,decided.target_profile_id,decided.case_id,decided.investigation_id,decided.id,auth.uid(),clock_timestamp()+make_interval(secs=>real_seconds),'issued') returning * into issued;
  end if;
  perform public.justice_notify(decided.requested_by,case when p_approved then 'justice_request_approved' else 'justice_request_denied' end,case when p_approved then 'Seu pedido judicial foi aprovado.' else 'Seu pedido judicial foi negado.' end,'/services/justice?view=authority',jsonb_build_object('request_id',decided.id,'warrant_id',issued.id));
  perform public.justice_write_audit('judicial_request.decided','judicial_request',decided.id,to_jsonb(old_request),to_jsonb(decided),p_decision_reason);
  return jsonb_build_object('request',to_jsonb(decided),'warrant',to_jsonb(issued));
end; $function$;

CREATE OR REPLACE FUNCTION public.validate_and_get_bill(p_bill_code text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE bill public.bills_of_exchange%rowtype; fine public.police_fines%rowtype; actor uuid:=auth.uid(); total numeric; days_overdue integer;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING errcode='42501'; END IF;
 SELECT * INTO bill FROM public.bills_of_exchange WHERE bill_code=p_bill_code;
 IF NOT FOUND OR (bill.payer_id IS NOT NULL AND bill.payer_id<>actor AND NOT public.user_can_manage_national_bank(actor)) THEN
  RETURN json_build_object('success',false,'status','invalid','message','Boleto inexistente.'); END IF;
 IF bill.status<>'pending' THEN RETURN json_build_object('success',false,'status',bill.status,'message','Este boleto não está disponível para pagamento.'); END IF;
 total:=bill.amount;
 SELECT * INTO fine FROM public.police_fines WHERE bill_code=p_bill_code;
 IF FOUND THEN
  IF fine.status NOT IN('Pendente','Vencida') THEN RETURN json_build_object('success',false,'status','invalid','message','Esta multa não está disponível para pagamento.'); END IF;
  days_overdue:=greatest(0,floor(extract(epoch FROM(now()-fine.due_date))/86400)::integer);
  total:=round(fine.amount+round(fine.amount*0.0033*days_overdue,2),2);
 END IF;
 RETURN json_build_object('success',true,'status','valid','message','Boleto válido e pendente.','amount',total,'description',bill.description,'due_date',bill.due_date);
END $$;
NOTIFY pgrst,'reload schema';
