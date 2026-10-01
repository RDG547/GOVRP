begin;
create or replace function public.get_company_market() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'owner_id',b.owner_id,'business_type_id',b.business_type_id,'name',b.name,'description',b.description,'sale_price',b.sale_price,'sale_listed_at',b.sale_listed_at,'market_value',b.market_value,'employees',b.employees,'region_code',b.region_code,'control_kind',b.control_kind,'owner',jsonb_build_object('full_name',coalesce(p.full_name,'Capital da população'))) order by b.sale_listed_at desc),'[]'::jsonb)
 from public.businesses b left join public.profiles p on p.id=b.owner_id where auth.uid() is not null and b.is_for_sale and b.sale_price>0 and b.status<>'closed'
$$;
create or replace function public.set_company_sale(p_business_id uuid,p_price numeric,p_for_sale boolean) returns void language plpgsql security definer set search_path='' as $$
declare b public.businesses%rowtype;
begin
 select * into b from public.businesses where id=p_business_id for update;
 if auth.uid() is null or b.owner_id is distinct from auth.uid() then raise exception 'Somente o proprietário pode vender a empresa.' using errcode='42501';end if;
 if p_for_sale is null or (p_for_sale and (p_price is null or p_price<=0 or p_price>100000000000 or p_price<>round(p_price,2))) then raise exception 'Informe um preço de venda válido.';end if;
 update public.businesses set is_for_sale=p_for_sale,sale_price=case when p_for_sale then p_price end,sale_listed_at=case when p_for_sale then now() end,updated_at=now() where id=b.id;
 insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key) values('company_sale_listing_changed','economy','businesses',b.id,auth.uid(),jsonb_build_object('for_sale',p_for_sale,'price',p_price),'company-listing:'||gen_random_uuid());
end $$;
revoke update on public.businesses from authenticated,anon;
grant update(name,description) on public.businesses to authenticated;
create or replace function private.broadcast_company_market() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform realtime.send(jsonb_build_object('changed',true),'company-market-changed','company-market',false);
 return coalesce(new,old);
end $$;
revoke all on function private.broadcast_company_market() from public,anon,authenticated;
create trigger company_supply_market_changed after insert or update or delete on public.business_inventory for each statement execute function private.broadcast_company_market();
create trigger company_jobs_market_changed after insert or update or delete on public.business_vacancies for each statement execute function private.broadcast_company_market();
create or replace function public.get_company_supply_operations(p_business_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.can_manage_company(p_business_id) then raise exception 'Acesso restrito à gestão.' using errcode='42501';end if;
 return jsonb_build_object('contracts',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('supplier_name',s.name,'buyer_name',b.name,'resource_name',r.name)) from public.business_supply_contracts c join public.businesses s on s.id=c.seller_business_id join public.businesses b on b.id=c.buyer_business_id join public.economic_resources r on r.code=c.resource_code where c.buyer_business_id=p_business_id or c.seller_business_id=p_business_id),'[]'::jsonb),'orders',coalesce((select jsonb_agg(to_jsonb(o)) from(select * from public.business_supply_orders where buyer_business_id=p_business_id or seller_business_id=p_business_id order by created_at desc limit 50)o),'[]'::jsonb),'days',coalesce((select jsonb_agg(to_jsonb(d)) from(select * from public.business_daily_operations where business_id=p_business_id order by operation_date desc limit 30)d),'[]'::jsonb));
end $$;
revoke all on function public.get_company_market(),public.set_company_sale(uuid,numeric,boolean),public.get_company_supply_operations(uuid) from public,anon;
grant execute on function public.get_company_market(),public.set_company_sale(uuid,numeric,boolean),public.get_company_supply_operations(uuid) to authenticated;
CREATE OR REPLACE FUNCTION public.buy_business_listing(p_listing_type text, p_listing_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_buyer_id uuid := auth.uid();
  v_buyer_account public.accounts%rowtype;
  v_seller_account public.accounts%rowtype;
  v_business public.businesses%rowtype;
  v_enterprise public.state_enterprises%rowtype;
  v_finance public.government_finances%rowtype;
  v_price numeric(14,2);
  v_new_business_id uuid;
  v_business_type_id text;
begin
  if v_buyer_id is null then
    return jsonb_build_object('success', false, 'message', 'Sessao invalida.');
  end if;

  select * into v_buyer_account
  from public.accounts
  where user_id = v_buyer_id;

  if v_buyer_account.id is null then
    return jsonb_build_object('success', false, 'message', 'Voce precisa ter conta bancaria para comprar empresas.');
  end if;

  if p_listing_type = 'private' then
    select * into v_business
    from public.businesses
    where id = p_listing_id
      and is_for_sale = true
    for update;

    if v_business.id is null then
      return jsonb_build_object('success', false, 'message', 'Empresa privada nao encontrada ou nao esta mais a venda.');
    end if;

    if v_business.owner_id = v_buyer_id then
      return jsonb_build_object('success', false, 'message', 'Voce nao pode comprar a propria empresa.');
    end if;

    v_price := coalesce(v_business.sale_price, 0);
    if v_price <= 0 then
      return jsonb_build_object('success', false, 'message', 'Preco de venda invalido.');
    end if;


    select * into v_seller_account
    from public.accounts
    where case when v_business.control_kind='population' then account_kind='population' else user_id = v_business.owner_id end;

    if v_seller_account.id is null then
      return jsonb_build_object('success', false, 'message', 'Conta bancaria do vendedor nao encontrada.');
    end if;

    perform id from public.accounts where id in(v_buyer_account.id,v_seller_account.id) order by id for update;
    select * into v_buyer_account from public.accounts where id=v_buyer_account.id;
    if v_buyer_account.balance<v_price then return jsonb_build_object('success',false,'message','Saldo insuficiente para comprar esta empresa.');end if;

    update public.accounts
    set balance = balance - v_price,
        updated_at = now()
    where id = v_buyer_account.id;

    update public.accounts
    set balance = balance + v_price,
        updated_at = now()
    where id = v_seller_account.id;

    update public.businesses
    set previous_owner_id = owner_id,
        owner_id = v_buyer_id,
        control_kind='player',owner_operates=true,
        is_for_sale = false,
        sale_price = null,
        sale_listed_at = null,
        sold_at = now(),
        status = coalesce(nullif(status, ''), 'active')
    where id = v_business.id;

    update public.products set seller_id=v_buyer_id where business_id=v_business.id;
    insert into public.transactions (from_account_id, to_account_id, amount, type, description, created_at, metadata)
    values (
      v_buyer_account.id,
      v_seller_account.id,
      v_price,
      'business_sale',
      'Compra da empresa: ' || v_business.name,
      now(),
      jsonb_build_object('business_id', v_business.id, 'listing_type', 'private')
    );

    insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key) values('company_owner_changed','economy','businesses',v_business.id,v_buyer_id,jsonb_build_object('previous_owner_id',v_business.owner_id,'price',v_price),'company-sale:'||gen_random_uuid());
    return jsonb_build_object('success', true, 'message', 'Empresa comprada com sucesso.', 'business_id', v_business.id);
  end if;

  if p_listing_type = 'state' then
    select * into v_enterprise
    from public.state_enterprises
    where id = p_listing_id
      and privatization_status = 'for_sale'
      and coalesce(is_privatized, false) = false
    for update;

    if v_enterprise.id is null then
      return jsonb_build_object('success', false, 'message', 'Estatal nao encontrada ou privatizacao indisponivel.');
    end if;

    select * into v_buyer_account from public.accounts where id=v_buyer_account.id for update;
    v_price := coalesce(v_enterprise.privatization_price, 0);
    if v_price <= 0 then
      return jsonb_build_object('success', false, 'message', 'Preco de privatizacao invalido.');
    end if;

    if coalesce(v_buyer_account.balance, 0) < v_price then
      return jsonb_build_object('success', false, 'message', 'Saldo insuficiente para comprar esta estatal.');
    end if;

    select * into v_finance
    from public.government_finances
    order by updated_at desc
    limit 1
    for update;

    if v_finance.id is null then
      return jsonb_build_object('success', false, 'message', 'Financas do governo nao encontradas.');
    end if;

    v_business_type_id := case v_enterprise.sector
      when 'Energia Elétrica' then 'fabrica'
      when 'Água' then 'distribuidora'
      when 'Gás' then 'distribuidora'
      when 'Internet' then 'consultoria'
      when 'Telefonia' then 'consultoria'
      else 'consultoria'
    end;

    update public.accounts
    set balance = balance - v_price,
        updated_at = now()
    where id = v_buyer_account.id;

    update public.government_finances
    set treasury_balance = treasury_balance + v_price,
        updated_at = now()
    where id = v_finance.id;

    insert into public.businesses (
      owner_id,
      business_type_id,
      name,
      description,
      status,
      employees,
      monthly_revenue
    )
    values (
      v_buyer_id,
      v_business_type_id,
      v_enterprise.name,
      coalesce(v_enterprise.description, 'Empresa privatizada a partir de estatal.'),
      'active',
      0,
      0
    )
    returning id into v_new_business_id;

    update public.state_enterprises
    set is_privatized = true,
        is_active = case when v_enterprise.service_key in('marketplace','national_housing','national_market') then true else false end,
        operating_business_id=v_new_business_id,
        privatization_status = 'sold',
        privatization_buyer_id = v_buyer_id,
        privatized_at = now(),
        updated_at = now()
    where id = v_enterprise.id;

    insert into public.transactions (from_account_id, to_account_id, amount, type, description, created_at, metadata)
    values (
      v_buyer_account.id,
      null,
      v_price,
      'privatization_purchase',
      'Compra de estatal privatizada: ' || v_enterprise.name,
      now(),
      jsonb_build_object(
        'state_enterprise_id', v_enterprise.id,
        'business_id', v_new_business_id,
        'treasury_credit', true,
        'listing_type', 'state'
      )
    );

    return jsonb_build_object('success', true, 'message', 'Estatal comprada e privatizada com sucesso.', 'business_id', v_new_business_id);
  end if;

  return jsonb_build_object('success', false, 'message', 'Tipo de listagem invalido.');
end;
$function$

;
notify pgrst,'reload schema';
commit;
