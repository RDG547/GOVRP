BEGIN;
-- Balanced, prospective investment yield. No immediate payment or principal rewrite.
SELECT pg_advisory_xact_lock(hashtext('govrp:stock-market'));
CREATE OR REPLACE FUNCTION private.balanced_investment_daily_rate(p_mode text,p_annual numeric,p_risk text,p_confidence numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
 SELECT CASE
 WHEN p_mode='treasury' THEN least(.0005::numeric,power(1+greatest(0,least(.15,coalesce(p_annual,0))),1::numeric/365)-1)
 WHEN p_mode='variable' THEN greatest(-.0005::numeric,least(.0005::numeric,
   (power(1+greatest(0,least(.20,coalesce(p_annual,0))),1::numeric/365)-1)
   *greatest(-1,least(1,(coalesce(p_confidence,50)-50)/50))
   *CASE p_risk WHEN 'very-high' THEN 1 WHEN 'high' THEN .7 ELSE .4 END))
 ELSE 0::numeric END
$fn$;
REVOKE ALL ON FUNCTION private.balanced_investment_daily_rate(text,numeric,text,numeric) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION private.refresh_balanced_investments()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE o public.investment_options%rowtype; reserve public.accounts%rowtype;
 ts timestamptz:=clock_timestamp(); mode text; last_at timestamptz; qty numeric; old_price numeric;
 target_price numeric; next_price numeric; rate numeric; confidence numeric; treasury numeric;
 funding numeric; cap numeric; tx uuid; changed integer:=0;
BEGIN
 -- Existing stock lock serializes the quote, trade and reserve settlement.
 PERFORM pg_advisory_xact_lock(hashtext('govrp:stock-market'));
 SELECT (business_confidence+consumer_confidence)/2 INTO confidence FROM public.economic_state WHERE id=true;
 FOR o IN SELECT * FROM public.investment_options WHERE is_active AND asset_type='fixed_income'
   AND listing_metadata->>'balanced_yield_mode' IN ('treasury','variable') ORDER BY id FOR UPDATE LOOP
  mode:=o.listing_metadata->>'balanced_yield_mode';
  -- No retroactive catch-up, no accelerated RP clock, no more than one 24-hour step.
  last_at:=greatest(coalesce((o.listing_metadata->>'balanced_yield_at')::timestamptz,ts),coalesce(o.price_updated_at,ts));
  IF ts<last_at+interval '24 hours' THEN CONTINUE;END IF;
  SELECT coalesce(sum(quantity),0) INTO qty FROM public.user_investments WHERE investment_id=o.id AND is_active AND quantity>0;
  old_price:=o.current_unit_price;
  rate:=private.balanced_investment_daily_rate(mode,o.annual_return_rate,o.risk_level,confidence);
  UPDATE public.investment_options SET listing_metadata=listing_metadata||jsonb_build_object('balanced_yield_at',ts)
   WHERE id=o.id;
  IF qty<=0 OR old_price<=0 OR rate=0 THEN CONTINUE;END IF;
  SELECT * INTO reserve FROM public.accounts WHERE investment_id=o.id AND account_kind='investment_reserve' FOR UPDATE;
  -- Do not conceal old principal shortfalls or use one fund's principal to pay another.
  IF reserve.id IS NULL OR reserve.balance<round(qty*old_price,2) THEN CONTINUE;END IF;
  target_price:=greatest(.01,trunc(old_price*(1+rate),6));
  next_price:=old_price;funding:=0;
  IF mode='treasury' AND target_price>old_price THEN
   -- Public securities are backed by the existing Treasury, not a minted reward.
   -- At most R$50 per security per real day (two eligible securities = R$100/day).
   SELECT treasury_balance INTO treasury FROM public.government_finances WHERE id=1 FOR UPDATE;
   cap:=least(50,greatest(0,coalesce(treasury,0)));
   next_price:=greatest(old_price,least(target_price,trunc((reserve.balance+cap)/qty,6)));
   funding:=greatest(0,ceil(qty*next_price*100)/100-reserve.balance);
   IF next_price>old_price AND funding>0 THEN
    IF funding>cap THEN RAISE EXCEPTION 'Investment yield exceeds daily budget';END IF;
    UPDATE public.government_finances SET treasury_balance=treasury_balance-funding,updated_at=ts
     WHERE id=1 AND treasury_balance>=funding;
    IF NOT FOUND THEN RAISE EXCEPTION 'Treasury funding unavailable';END IF;
    UPDATE public.accounts SET balance=balance+funding,updated_at=ts WHERE id=reserve.id;
    INSERT INTO public.transactions(to_account_id,amount,type,description,metadata,idempotency_key)
    VALUES(reserve.id,funding,'investment_reserve_funding','Juros de títulos públicos: '||o.name,
      jsonb_build_object('treasury_debit',true,'investment_id',o.id,'kind','balanced_investment_interest','real_day',ts::date,'annual_basis','365_real_days'),
      md5('balanced-yield:'||o.id||':'||last_at::text)::uuid) RETURNING id INTO tx;
    INSERT INTO public.government_expenditures(expenditure_type,source_table,source_id,amount,productive_share,occurred_at_real,occurred_at_rp,metadata)
    VALUES('debt_interest','transactions',tx::text,funding,0,ts,public.rp_now(),
      jsonb_build_object('investment_id',o.id,'kind','balanced_investment_interest','fiscal_classification','interest'));
   END IF;
  ELSIF mode='variable' THEN
   -- Variable legacy products have no verified independent income stream.
   -- They may lose value or recover, but upward revaluation must be covered by their OWN reserve.
   next_price:=CASE WHEN target_price<old_price THEN target_price
     ELSE greatest(old_price,least(target_price,trunc(reserve.balance/qty,6))) END;
  END IF;
  IF next_price=old_price THEN CONTINUE;END IF;
  UPDATE public.investment_options SET previous_close=old_price,current_unit_price=next_price,price_updated_at=ts
   WHERE id=o.id;
  INSERT INTO public.stock_price_history(investment_id,price,captured_at,reason,metadata)
  VALUES(o.id,next_price,ts,'balanced_investment_daily',jsonb_build_object('mode',mode,'rate',rate,'funding',funding,'annual_basis','365_real_days','previous_price',old_price,'confidence',confidence));
  changed:=changed+1;
 END LOOP;
 IF changed>0 THEN
  INSERT INTO public.investment_portfolio_snapshots(user_id,total_cost,market_value,unrealized_result,captured_at)
  SELECT h.user_id,round(sum(h.amount_invested),2),round(sum(h.quantity*i.current_unit_price),2),
    round(sum(h.quantity*i.current_unit_price-h.amount_invested),2),ts
  FROM public.user_investments h JOIN public.investment_options i ON i.id=h.investment_id
  WHERE h.is_active AND h.quantity>0 GROUP BY h.user_id;
 END IF;
 RETURN changed;
END
$fn$;
REVOKE ALL ON FUNCTION private.refresh_balanced_investments() FROM PUBLIC,anon,authenticated;
-- Mark only the existing named catalog products. Existing principal, quantities,
-- sale records and balances are untouched. The first quote is due after 24 real hours.
UPDATE public.investment_options SET listing_metadata=coalesce(listing_metadata,'{}'::jsonb)||
 jsonb_build_object('balanced_yield_mode',CASE WHEN name IN ('Tesouro GOV.RP','Tesouro GOV.RP Selic') THEN 'treasury' ELSE 'variable' END,
 'balanced_yield_at',clock_timestamp(),'balanced_yield_basis','365_real_days','balanced_yield_daily_cap',.0005)
WHERE is_active AND asset_type='fixed_income'
 AND name IN ('Tesouro GOV.RP','Tesouro GOV.RP Selic','Fundo de Desenvolvimento Nacional','Fundo Imobiliário Praça Central',
 'Fundo Soberano Arrojado','Cripto GOVCOIN','Ações da LifeInvader (LFI)','Ações Estratégicas Estatais')
 AND NOT (coalesce(listing_metadata,'{}'::jsonb)?'balanced_yield_at');
CREATE OR REPLACE FUNCTION private.refresh_stock_prices()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.investment_options%rowtype;b public.businesses%rowtype;confidence numeric;revenue numeric;profit numeric;prior_revenue numeric;debt numeric;anchor numeric;delta numeric;next_price numeric;demand numeric;sector_margin numeric;growth numeric;signal numeric;index_value numeric;previous numeric;bucket timestamptz:=date_trunc('minute',clock_timestamp());
begin
 perform pg_advisory_xact_lock(hashtext('govrp:stock-market'));
 perform private.refresh_balanced_investments();
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
end $function$
;
REVOKE ALL ON FUNCTION private.refresh_stock_prices() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION private.execute_investment_trade(p_investment_id uuid, p_operation_type text, p_quantity numeric, p_idempotency_key uuid, p_expected_price numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); option public.investment_options%rowtype; account public.accounts%rowtype; reserve public.accounts%rowtype;holding public.user_investments%rowtype;operation public.investment_operations%rowtype;amount numeric(20,2);new_quantity numeric(24,8);new_average numeric(20,6);realized numeric(20,2):=0;transaction_id uuid;portfolio_cost numeric;portfolio_value numeric; allocated_cost numeric;
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
 -- Round financial units against the trader, not the reserve. Fractional trades
 -- cannot manufacture cents by repeatedly splitting orders.
 if option.asset_type='stock' then amount:=round(p_quantity*option.current_unit_price,2);
 elsif p_operation_type='buy' then amount:=ceil(p_quantity*option.current_unit_price*100)/100;
 else amount:=trunc(p_quantity*option.current_unit_price,2);end if;
 if amount<=0 then raise exception 'Valor da operação abaixo de um centavo.';end if;
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
  new_quantity:=holding.quantity-p_quantity;
  allocated_cost:=case when new_quantity=0 then holding.amount_invested
    else least(holding.amount_invested,round(holding.amount_invested*p_quantity/holding.quantity,2)) end;
  realized:=amount-allocated_cost;
  update public.accounts set balance=balance-amount,updated_at=now() where id=reserve.id;
  update public.accounts set balance=balance+amount,updated_at=now() where id=account.id;
  update public.user_investments set quantity=new_quantity,amount_invested=case when new_quantity=0 then 0 else greatest(0,amount_invested-allocated_cost) end,is_active=new_quantity>0,realized_result=realized_result+realized,updated_at=now() where id=holding.id returning * into holding;
  update public.investment_options set available_shares=available_shares+p_quantity where id=option.id and asset_type='stock';
  insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key) values(reserve.id,account.id,amount,'investment_sell','Venda de '||coalesce(nullif(option.asset_symbol,''),option.name),jsonb_build_object('investmentId',option.id,'quantity',p_quantity,'unitPrice',option.current_unit_price,'realizedResult',realized,'fees',0),p_idempotency_key) returning id into transaction_id;
 end if;
 insert into public.investment_operations(idempotency_key,user_id,investment_id,holding_id,operation_type,quantity,unit_price,gross_amount,realized_result,transaction_id,metadata) values(p_idempotency_key,actor,option.id,holding.id,p_operation_type,p_quantity,option.current_unit_price,amount,realized,transaction_id,jsonb_build_object('reserve_account_id',reserve.id,'fees',0)) returning * into operation;
 select coalesce(sum(ui.amount_invested),0),coalesce(sum(ui.quantity*io.current_unit_price),0) into portfolio_cost,portfolio_value from public.user_investments ui join public.investment_options io on io.id=ui.investment_id where ui.user_id=actor and ui.is_active;
 insert into public.investment_portfolio_snapshots(user_id,total_cost,market_value,unrealized_result) values(actor,round(portfolio_cost,2),round(portfolio_value,2),round(portfolio_value-portfolio_cost,2));
 return jsonb_build_object('success',true,'message',case when p_operation_type='buy' then 'Compra concluída.' else 'Venda concluída.' end,'operation',to_jsonb(operation),'holding',to_jsonb(holding));
end $function$
;
REVOKE ALL ON FUNCTION private.execute_investment_trade(uuid,text,numeric,uuid,numeric) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.trade_investment_quoted(p_investment_id uuid,p_operation_type text,p_quantity numeric,p_idempotency_key uuid,p_expected_price numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para negociar investimentos.' USING ERRCODE='42501';END IF;
 IF p_expected_price IS NULL OR p_expected_price<=0 THEN RAISE EXCEPTION 'Confirme a cotação atual.';END IF;
 RETURN private.execute_investment_trade(p_investment_id,p_operation_type,p_quantity,p_idempotency_key,p_expected_price);
END
$fn$;
REVOKE ALL ON FUNCTION public.trade_investment_quoted(uuid,text,numeric,uuid,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.trade_investment_quoted(uuid,text,numeric,uuid,numeric) TO authenticated,service_role;
DO $test$
BEGIN
 IF private.balanced_investment_daily_rate('treasury',.1202,'low',0)<=0
 OR private.balanced_investment_daily_rate('treasury',100,'low',100)>.0005
 OR private.balanced_investment_daily_rate('variable',.2313,'very-high',10)>=0
 OR abs(private.balanced_investment_daily_rate('variable',100,'very-high',100))>.0005
 OR private.balanced_investment_daily_rate('variable',.20,'high',50)<>0 THEN
  RAISE EXCEPTION 'Investment yield guard failed';
 END IF;
 IF has_function_privilege('anon','private.refresh_balanced_investments()','EXECUTE')
 OR has_function_privilege('authenticated','private.refresh_balanced_investments()','EXECUTE')
 OR has_function_privilege('anon','public.trade_investment_quoted(uuid,text,numeric,uuid,numeric)','EXECUTE') THEN
  RAISE EXCEPTION 'Investment execution privileges invalid';
 END IF;
END
$test$;

DO $verify$
DECLARE v_count int; v_principal numeric; v_treasury numeric; v_funding numeric; v_gain numeric; v_again int;
BEGIN
 SELECT coalesce(sum(amount_invested),0) INTO v_principal FROM public.user_investments;
 SELECT treasury_balance INTO v_treasury FROM public.government_finances WHERE id=1;
 BEGIN
  -- This subtransaction is always rolled back. No test transaction can persist.
  UPDATE public.investment_options SET listing_metadata=listing_metadata||jsonb_build_object('balanced_yield_at',clock_timestamp()-interval '25 hours'),
   price_updated_at=clock_timestamp()-interval '25 hours'
   WHERE asset_type='fixed_income' AND is_active AND listing_metadata ? 'balanced_yield_mode';
  v_count:=private.refresh_balanced_investments();
  v_again:=private.refresh_balanced_investments();
  IF v_again<>0 THEN RAISE EXCEPTION 'Daily update replayed'; END IF;
  SELECT v_treasury-treasury_balance INTO v_funding FROM public.government_finances WHERE id=1;
  IF coalesce(v_funding,0)<0 OR coalesce(v_funding,0)>100 THEN RAISE EXCEPTION 'Daily funding exceeded limit';END IF;
  IF EXISTS(SELECT 1 FROM public.investment_options o JOIN public.accounts a ON a.investment_id=o.id AND a.account_kind='investment_reserve'
    JOIN LATERAL (SELECT coalesce(sum(quantity),0) AS qty FROM public.user_investments WHERE investment_id=o.id AND is_active) h ON true
    WHERE o.listing_metadata ? 'balanced_yield_mode' AND round(h.qty*o.current_unit_price,2)>a.balance) THEN
   RAISE EXCEPTION 'Reserve insufficient after quote';END IF;
  IF (SELECT coalesce(sum(amount_invested),0) FROM public.user_investments)<>v_principal THEN RAISE EXCEPTION 'Principal was modified';END IF;
  IF EXISTS(SELECT 1 FROM public.stock_price_history WHERE reason='balanced_investment_daily'
    AND captured_at>=statement_timestamp() AND abs(price/(metadata->>'previous_price')::numeric-1)>.000501) THEN RAISE EXCEPTION 'Excess price change';END IF;
  RAISE EXCEPTION USING ERRCODE='PZ901',MESSAGE='Rollback of successful settlement rehearsal';
 EXCEPTION WHEN SQLSTATE 'PZ901' THEN NULL;
 END;
 IF (SELECT treasury_balance FROM public.government_finances WHERE id=1) IS DISTINCT FROM v_treasury THEN RAISE EXCEPTION 'Test was not rolled back';END IF;
END
$verify$;
COMMIT;
