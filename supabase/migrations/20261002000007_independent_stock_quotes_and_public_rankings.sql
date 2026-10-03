begin;
insert into public.system_settings(key,value,description) values('stock_market_session','{"is_open":true,"quote_interval_seconds":60}','Bolsa de Valores: negociação contínua do RP, com possibilidade de pausa institucional.') on conflict do nothing;
create or replace function private.stock_market_is_open() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select (value->>'is_open')::boolean from public.system_settings where key='stock_market_session'),true);
$$;
revoke all on function private.stock_market_is_open() from public,anon,authenticated;
create or replace function private.refresh_stock_prices() returns void language plpgsql security definer set search_path='' as $$
declare o public.investment_options%rowtype;b public.businesses%rowtype;confidence numeric;revenue numeric;profit numeric;prior_revenue numeric;debt numeric;anchor numeric;delta numeric;next_price numeric;demand numeric;sector_margin numeric;growth numeric;signal numeric;index_value numeric;previous numeric;bucket timestamptz:=date_trunc('minute',clock_timestamp());
begin
 perform pg_advisory_xact_lock(hashtext('govrp:stock-market'));
 if not private.stock_market_is_open() then return;end if;
 select consumer_confidence into confidence from public.economic_state where id=true;
 for o in select * from public.investment_options where asset_type='stock' and is_active order by id for update loop
  if exists(select 1 from public.stock_price_history where investment_id=o.id and captured_at>=bucket and reason='fundamentals') then continue;end if;
  select * into b from public.businesses where id=o.business_id;
  select coalesce(sum(amount) filter(where type='revenue' and accounting_date>=current_date-6),0),coalesce(sum(amount) filter(where type in('revenue','expense','tax') and accounting_date>=current_date-6),0),coalesce(sum(amount) filter(where type='revenue' and accounting_date<current_date-6),0) into revenue,profit,prior_revenue from public.business_transactions where business_id=b.id and accounting_date>=current_date-13;
  if revenue=0 and profit=0 then select coalesce((select gross_revenue from public.business_balance_cycles where business_id=b.id order by cycle_start_at desc limit 1),0),coalesce((select net_result from public.business_balance_cycles where business_id=b.id order by cycle_start_at desc limit 1),0) into revenue,profit;end if;
  select coalesce(sum(wage_due),0) into debt from public.business_employees where business_id=b.id;
  select coalesce(sum(t.amount) filter(where t.type in('revenue','expense','tax'))/greatest(1,sum(t.amount) filter(where t.type='revenue')),0) into sector_margin from public.business_transactions t join public.businesses peer on peer.id=t.business_id where peer.economic_sector_id=b.economic_sector_id and t.accounting_date>=current_date-6;
  anchor:=greatest(.01,b.market_value/greatest(1,o.total_shares));
  demand:=coalesce((select sum(case when operation_type='buy' then quantity else -quantity end)/greatest(1,o.floated_shares) from public.investment_operations where investment_id=o.id and executed_at>=clock_timestamp()-interval '1 hour'),0);
  growth:=case when prior_revenue>0 then (revenue-prior_revenue)/prior_revenue else 0 end;
  -- Smooth bounded response avoids every company saturating at the same +/-2% cut-off.
  signal:=.45*ln(greatest(.01,anchor/o.current_unit_price))+.9*tanh((profit/greatest(1,revenue))::double precision)-1.2*tanh((debt/greatest(1,b.market_value))::double precision)
   +.15*tanh(growth::double precision)+.1*tanh(sector_margin::double precision)+.6*tanh((demand*10)::double precision)
   +.08*(coalesce(confidence,50)-50)/50*(.5+coalesce(b.employees,0)::numeric/(100+coalesce(b.employees,0)))
   +.05*(b.reputation-50)/50+case when b.operational_status in('closed','insolvent') then -.8 when b.operational_status in('cash_shortage','missing_inputs') then -.15 else 0 end;
  delta:=.0015*tanh(signal::double precision);
  next_price:=round(greatest(.01,o.current_unit_price*(1+delta)),6);
  update public.investment_options set current_unit_price=next_price,previous_close=case when (price_updated_at at time zone 'America/Sao_Paulo')::date<(clock_timestamp() at time zone 'America/Sao_Paulo')::date then current_unit_price else coalesce(previous_close,current_unit_price) end,price_updated_at=clock_timestamp() where id=o.id;
  insert into public.stock_price_history(investment_id,price,captured_at,reason,metadata) values(o.id,next_price,clock_timestamp(),'fundamentals',jsonb_build_object('market_value',b.market_value,'revenue',revenue,'profit',profit,'wage_debt',debt,'growth',growth,'sector_margin',sector_margin,'confidence',confidence,'net_demand',demand,'anchor',anchor,'variation',delta,'model','individual-v2'));
 end loop;
 select 1000*sum(current_unit_price*total_shares)/nullif(sum(initial_unit_price*total_shares),0) into index_value from public.investment_options where asset_type='stock' and is_active;
 if index_value is not null and not exists(select 1 from public.stock_index_history where captured_at>=bucket) then
  select value into previous from public.stock_index_history order by captured_at desc,id desc limit 1;
  insert into public.stock_index_history(value,previous_value,captured_at) values(index_value,coalesce(previous,index_value),clock_timestamp());
 end if;
end $$;
select cron.schedule('govrp-stock-quotes','* * * * *','select private.refresh_stock_prices()');
create or replace function public.get_stock_candles(p_investment_id uuid default null,p_range text default '7D',p_interval text default '1h') returns jsonb language plpgsql stable security definer set search_path='' as $$
declare since timestamptz; span interval; result jsonb;
begin
 if auth.uid() is null then raise exception 'Entre para consultar as cotações.' using errcode='42501';end if;
 since:=case p_range when '1D' then now()-interval '1 day' when '7D' then now()-interval '7 days' when '1M_RP' then public.rp_date_to_real_date(public.rp_now()-interval '1 month') else null end;
 span:=case p_interval when '1m' then interval '1 minute' when '5m' then interval '5 minutes' when '15m' then interval '15 minutes' when '1h' then interval '1 hour' when '1D' then interval '1 day' else null end;
 if since is null or span is null then raise exception 'Selecione um período disponível.';end if;
 with quotes as (
  select id,captured_at,price from public.stock_price_history where p_investment_id is not null and investment_id=p_investment_id and captured_at>=since
  union all select id,captured_at,value from public.stock_index_history where p_investment_id is null and captured_at>=since
 ), candles as (
  select date_bin(span,captured_at,'2000-01-01'::timestamptz) as captured_at,(array_agg(price order by captured_at,id))[1] as open,max(price) as high,min(price) as low,(array_agg(price order by captured_at desc,id desc))[1] as close,count(*) as samples from quotes group by 1
 ), displayed as (select * from candles order by captured_at desc limit 240)
 select jsonb_build_object('candles',(select coalesce(jsonb_agg(to_jsonb(d) order by captured_at),'[]') from displayed d),'total_candles',(select count(*) from candles),'available_intervals',(select coalesce(jsonb_agg(label order by ord),'[]') from (values('1m',interval '1 minute',1),('5m',interval '5 minutes',2),('15m',interval '15 minutes',3),('1h',interval '1 hour',4),('1D',interval '1 day',5)) v(label,step,ord) where (select count(distinct date_bin(step,captured_at,'2000-01-01'::timestamptz)) from quotes)>=2)) into result;
 return result;
end $$;
revoke all on function public.get_stock_candles(uuid,text,text) from public,anon;
grant execute on function public.get_stock_candles(uuid,text,text) to authenticated;
CREATE OR REPLACE FUNCTION private.execute_investment_trade(p_investment_id uuid, p_operation_type text, p_quantity numeric, p_idempotency_key uuid, p_expected_price numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); option public.investment_options%rowtype; account public.accounts%rowtype; reserve public.accounts%rowtype;holding public.user_investments%rowtype;operation public.investment_operations%rowtype;amount numeric(20,2);new_quantity numeric(24,8);new_average numeric(20,6);realized numeric(20,2):=0;transaction_id uuid;portfolio_cost numeric;portfolio_value numeric;
begin
 if actor is null then raise exception 'Entre para negociar investimentos.' using errcode='42501';end if;
 if p_operation_type is null or p_operation_type not in('buy','sell') or p_quantity is null or p_quantity<=0 or p_quantity>1000000000 or p_quantity<>round(p_quantity,8) or p_idempotency_key is null then raise exception 'Informe uma quantidade válida com até oito casas decimais.';end if;
 perform pg_advisory_xact_lock(hashtext('govrp:stock-market'));
 select * into operation from public.investment_operations where idempotency_key=p_idempotency_key;
 if found then
  if operation.user_id<>actor or operation.investment_id<>p_investment_id or operation.operation_type<>p_operation_type or operation.quantity<>p_quantity then raise exception 'Este identificador pertence a outra operação.';end if;
  return jsonb_build_object('success',true,'message','Operação já processada.','operation',to_jsonb(operation));
 end if;
 select * into option from public.investment_options where id=p_investment_id and is_active for update;
 if not found then raise exception 'Este investimento está indisponível.';end if;
 if option.asset_type='stock' and not private.stock_market_is_open() then raise exception 'O mercado está fechado. Consulte o histórico e aguarde a reabertura.';end if;
 if option.asset_type='stock' and (p_quantity<>trunc(p_quantity) or p_expected_price is null) then raise exception 'Negocie ações inteiras pela Bolsa de Valores, confirmando a cotação atual.';end if;
 if p_expected_price is not null and p_expected_price<>option.current_unit_price then raise exception 'A cotação mudou. Confira o novo valor antes de confirmar.';end if;
 amount:=round(p_quantity*option.current_unit_price,2);if amount<=0 then raise exception 'Valor da operação abaixo de um centavo.';end if;
 select * into account from public.accounts where user_id=actor and account_kind='personal';
 select * into reserve from public.accounts where investment_id=option.id and account_kind='investment_reserve';
 if account.id is null then raise exception 'Abra uma conta no Banco Nacional.';end if;
 if reserve.id is null and option.asset_type<>'stock' then insert into public.accounts(account_kind,investment_id,account_number,agency_number,balance) values('investment_reserve',option.id,'BNV-'||replace(option.id::text,'-',''),'0003',0) returning * into reserve;end if;
 if reserve.id is null then raise exception 'Esta aplicação aguarda a constituição de sua reserva financeira.';end if;
 perform id from public.accounts where id in(account.id,reserve.id) order by id for update;
 select * into account from public.accounts where id=account.id;select * into reserve from public.accounts where id=reserve.id;
 select * into holding from public.user_investments where user_id=actor and investment_id=option.id for update;
 if p_operation_type='buy' then
  if option.asset_type<>'stock' and amount<option.minimum_amount then raise exception 'O valor está abaixo da aplicação mínima.';end if;
  if account.balance<amount then raise exception 'Saldo insuficiente na conta pessoal.';end if;
  if option.asset_type='stock' and option.available_shares<p_quantity then raise exception 'Não há ações suficientes na oferta disponível.';end if;
  update public.accounts set balance=balance-amount,updated_at=now() where id=account.id;
  update public.accounts set balance=balance+amount,updated_at=now() where id=reserve.id;
  if holding.id is null then
   insert into public.user_investments(user_id,investment_id,amount_invested,quantity,average_unit_price,start_date,updated_at) values(actor,option.id,amount,p_quantity,option.current_unit_price,now(),now()) returning * into holding;
  else
   new_quantity:=holding.quantity+p_quantity;new_average:=round((holding.amount_invested+amount)/new_quantity,6);
   update public.user_investments set quantity=new_quantity,average_unit_price=new_average,amount_invested=amount_invested+amount,is_active=true,updated_at=now() where id=holding.id returning * into holding;
  end if;
  update public.investment_options set available_shares=available_shares-p_quantity where id=option.id and asset_type='stock';
  insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key) values(account.id,reserve.id,amount,'investment_buy','Compra de '||coalesce(nullif(option.asset_symbol,''),option.name),jsonb_build_object('investmentId',option.id,'quantity',p_quantity,'unitPrice',option.current_unit_price,'fees',0),p_idempotency_key) returning id into transaction_id;
 else
  if holding.id is null or holding.quantity<p_quantity then raise exception 'Você não possui a quantidade informada para venda.';end if;
  if reserve.balance<amount then raise exception 'Liquidez insuficiente nesta oferta. Reduza a quantidade ou aguarde novas negociações.';end if;
  realized:=round(amount-p_quantity*holding.average_unit_price,2);new_quantity:=holding.quantity-p_quantity;
  update public.accounts set balance=balance-amount,updated_at=now() where id=reserve.id;
  update public.accounts set balance=balance+amount,updated_at=now() where id=account.id;
  update public.user_investments set quantity=new_quantity,amount_invested=case when new_quantity=0 then 0 else greatest(0,amount_invested-round(p_quantity*average_unit_price,2)) end,is_active=new_quantity>0,realized_result=realized_result+realized,updated_at=now() where id=holding.id returning * into holding;
  update public.investment_options set available_shares=available_shares+p_quantity where id=option.id and asset_type='stock';
  insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key) values(reserve.id,account.id,amount,'investment_sell','Venda de '||coalesce(nullif(option.asset_symbol,''),option.name),jsonb_build_object('investmentId',option.id,'quantity',p_quantity,'unitPrice',option.current_unit_price,'realizedResult',realized,'fees',0),p_idempotency_key) returning id into transaction_id;
 end if;
 insert into public.investment_operations(idempotency_key,user_id,investment_id,holding_id,operation_type,quantity,unit_price,gross_amount,realized_result,transaction_id,metadata) values(p_idempotency_key,actor,option.id,holding.id,p_operation_type,p_quantity,option.current_unit_price,amount,realized,transaction_id,jsonb_build_object('reserve_account_id',reserve.id,'fees',0)) returning * into operation;
 select coalesce(sum(ui.amount_invested),0),coalesce(sum(ui.quantity*io.current_unit_price),0) into portfolio_cost,portfolio_value from public.user_investments ui join public.investment_options io on io.id=ui.investment_id where ui.user_id=actor and ui.is_active;
 insert into public.investment_portfolio_snapshots(user_id,total_cost,market_value,unrealized_result) values(actor,round(portfolio_cost,2),round(portfolio_value,2),round(portfolio_value-portfolio_cost,2));
 return jsonb_build_object('success',true,'message',case when p_operation_type='buy' then 'Compra concluída.' else 'Venda concluída.' end,'operation',to_jsonb(operation),'holding',to_jsonb(holding));
end $function$;
CREATE OR REPLACE FUNCTION public.get_stock_market()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null then raise exception 'Entre para consultar a Bolsa de Valores.' using errcode='42501';end if;
 return jsonb_build_object('market_open',private.stock_market_is_open(),'session_description','Negociação contínua do RP; pausas institucionais suspendem ordens e novas cotações.','quote_interval_seconds',60,'assets',(select coalesce(jsonb_agg(to_jsonb(x) order by asset_symbol),'[]') from(select o.*,b.name company_name,b.logo_url,b.brand_color,b.region_code,b.size_class,b.control_kind,b.owner_id,t.name sector,(select coalesce(sum(gross_amount),0) from public.investment_operations where investment_id=o.id and executed_at>=current_date) volume_today,(select gross_revenue from public.business_balance_cycles where business_id=b.id order by cycle_start_at desc limit 1) last_revenue,(select net_result from public.business_balance_cycles where business_id=b.id order by cycle_start_at desc limit 1) last_profit,(select balance from public.accounts where investment_id=o.id) liquidity from public.investment_options o join public.businesses b on b.id=o.business_id join public.business_types t on t.id=b.business_type_id where o.asset_type='stock' and o.is_active)x),'index',(select to_jsonb(h) from public.stock_index_history h order by captured_at desc,id desc limit 1),'holdings',(select coalesce(jsonb_agg(to_jsonb(h)),'[]') from public.user_investments h join public.investment_options o on o.id=h.investment_id where h.user_id=auth.uid() and o.asset_type='stock'),'receipts',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from(select * from public.stock_dividend_receipts where user_id=auth.uid() order by created_at desc limit 50)r),'rules',jsonb_build_object('minimum_value',1000000,'minimum_staff',20,'minimum_cycles',2,'minimum_offer_percent',5,'maximum_offer_percent',49,'fees',0));
end $function$;
CREATE OR REPLACE FUNCTION public.get_company_rankings()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null then raise exception 'Entre para consultar o ranking.' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(to_jsonb(r)),'[]') from(select b.id,b.name,b.region_code,b.control_kind,coalesce(o.current_unit_price*o.total_shares,b.market_value) as market_value,case when o.previous_close>0 then (o.current_unit_price/o.previous_close-1)*100 else null end as variation,b.size_class,b.logo_url,b.brand_color,t.name as sector,coalesce(fin.revenue,0) revenue,coalesce(fin.profit,0) profit,(select count(*) from public.business_employees e where e.business_id=b.id and e.fired_at is null) jobs,(select coalesce(sum(produced_quantity),0) from public.business_daily_operations d where d.business_id=b.id and d.operation_date>=current_date-6) production from public.businesses b left join public.investment_options o on o.business_id=b.id and o.asset_type='stock' and o.is_active join public.business_types t on t.id=b.business_type_id left join lateral(select sum(amount) filter(where type='revenue') revenue,sum(amount) filter(where type in('revenue','expense','tax')) profit from public.business_transactions where business_id=b.id and accounting_date>=current_date-6) fin on true where b.status='active' order by coalesce(o.current_unit_price*o.total_shares,b.market_value) desc,b.id limit 500) r);
end $function$;

notify pgrst,'reload schema';
commit;
