begin;
alter table public.investment_options add column business_id uuid unique references public.businesses(id),add column total_shares numeric(24,8),add column floated_shares numeric(24,8),add column available_shares numeric(24,8),add column initial_unit_price numeric(20,6),add column previous_close numeric(20,6),add column listed_at timestamptz,add column listing_metadata jsonb not null default '{}';
alter table public.investment_options add constraint stock_supply_bounds check(asset_type<>'stock' or (business_id is not null and total_shares>0 and floated_shares>0 and floated_shares<=total_shares and available_shares>=0 and available_shares<=floated_shares));
create unique index investment_symbol_unique on public.investment_options(upper(asset_symbol)) where asset_type='stock' and asset_symbol is not null and asset_symbol<>'';
alter table public.accounts drop constraint accounts_account_kind_check,drop constraint accounts_holder_check;
alter table public.accounts add column investment_id uuid unique references public.investment_options(id);
alter table public.accounts add constraint accounts_account_kind_check check(account_kind in('personal','business','population','investment_reserve')),
add constraint accounts_holder_check check((account_kind='personal' and user_id is not null and business_id is null and investment_id is null) or (account_kind='business' and user_id is null and business_id is not null and investment_id is null) or (account_kind='population' and user_id is null and business_id is null and investment_id is null) or (account_kind='investment_reserve' and user_id is null and business_id is null and investment_id is not null));
create table public.stock_price_history(id bigint generated always as identity primary key,investment_id uuid not null references public.investment_options(id),price numeric(20,6) not null check(price>0),captured_at timestamptz not null default now(),reason text not null,metadata jsonb not null default '{}');
create index stock_price_time on public.stock_price_history(investment_id,captured_at desc);
create table public.stock_index_history(id bigint generated always as identity primary key,index_code text not null default 'GOVX',value numeric(20,6) not null,previous_value numeric(20,6),captured_at timestamptz not null default now());
create index stock_index_time on public.stock_index_history(captured_at desc);
create table public.company_dividends(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.businesses(id),investment_id uuid not null references public.investment_options(id),amount numeric(20,2) not null check(amount>0),per_share numeric(24,8) not null,declared_by uuid references public.profiles(id),idempotency_key uuid not null unique,created_at timestamptz not null default now());
create table public.stock_dividend_receipts(id uuid primary key default gen_random_uuid(),dividend_id uuid not null references public.company_dividends(id),user_id uuid not null references public.profiles(id),amount numeric(20,2) not null,quantity_snapshot numeric(24,8) not null,created_at timestamptz not null default now(),unique(dividend_id,user_id));
alter table public.stock_price_history enable row level security;
alter table public.stock_index_history enable row level security;
alter table public.company_dividends enable row level security;
alter table public.stock_dividend_receipts enable row level security;
create policy stock_prices_read on public.stock_price_history for select to authenticated using(true);
create policy stock_index_read on public.stock_index_history for select to authenticated using(true);
create policy dividends_read on public.company_dividends for select to authenticated using(true);
create policy dividend_receipts_own on public.stock_dividend_receipts for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.stock_price_history,public.stock_index_history,public.company_dividends,public.stock_dividend_receipts from public,anon,authenticated;
grant select on public.stock_price_history,public.stock_index_history,public.company_dividends,public.stock_dividend_receipts to authenticated;
-- Legacy holdings keep their quantities and cost history. Redemptions now draw from an explicit Treasury-funded reserve.
do $$ declare o public.investment_options%rowtype; a uuid; funding numeric; treasury numeric;begin
 for o in select * from public.investment_options order by id loop
  insert into public.accounts(account_kind,investment_id,account_number,agency_number,balance) values('investment_reserve',o.id,'BNV-'||replace(o.id::text,'-',''),'0003',0) returning id into a;
  select treasury_balance into treasury from public.government_finances where id=1 for update;
  select least(greatest(0,treasury),greatest(10000,coalesce(sum(quantity*o.current_unit_price),0)*1.2)) into funding from public.user_investments where investment_id=o.id;
  if funding>0 then
   update public.government_finances set treasury_balance=treasury_balance-funding,updated_at=now() where id=1;
   update public.accounts set balance=funding,updated_at=now() where id=a;
   insert into public.transactions(to_account_id,amount,type,description,metadata) values(a,funding,'investment_reserve_funding','Reserva financeira da aplicação: '||o.name,jsonb_build_object('treasury_debit',true,'investment_id',o.id));
  end if;
 end loop;
end $$;
create or replace function private.execute_investment_trade(p_investment_id uuid,p_operation_type text,p_quantity numeric,p_idempotency_key uuid,p_expected_price numeric) returns jsonb language plpgsql security definer set search_path='' as $$
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
 if option.asset_type='stock' and (p_quantity<>trunc(p_quantity) or p_expected_price is null) then raise exception 'Negocie ações inteiras pela BNV, confirmando a cotação atual.';end if;
 if p_expected_price is not null and p_expected_price<>option.current_unit_price then raise exception 'A cotação mudou. Confira o novo valor antes de confirmar.';end if;
 amount:=round(p_quantity*option.current_unit_price,2);if amount<=0 then raise exception 'Valor da operação abaixo de um centavo.';end if;
 select * into account from public.accounts where user_id=actor and account_kind='personal';
 select * into reserve from public.accounts where investment_id=option.id and account_kind='investment_reserve';
 if account.id is null then raise exception 'Abra uma conta no Banco Nacional.';end if;
 if reserve.id is null then raise exception 'Esta aplicação aguarda a constituição de sua reserva financeira.';end if;
 perform id from public.accounts where id in(account.id,reserve.id) order by id for update;
 select * into account from public.accounts where id=account.id;select * into reserve from public.accounts where id=reserve.id;
 select * into holding from public.user_investments where user_id=actor and investment_id=option.id for update;
 if p_operation_type='buy' then
  if amount<option.minimum_amount then raise exception 'O valor está abaixo da aplicação mínima.';end if;
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
end $$;
create or replace function public.trade_investment(p_investment_id uuid,p_operation_type text,p_quantity numeric,p_idempotency_key uuid) returns jsonb language sql security definer set search_path='' as $$ select private.execute_investment_trade(p_investment_id,p_operation_type,p_quantity,p_idempotency_key,null) $$;
create or replace function public.trade_stock(p_investment_id uuid,p_operation_type text,p_quantity numeric,p_idempotency_key uuid,p_expected_price numeric) returns jsonb language plpgsql security definer set search_path='' as $$
begin if not exists(select 1 from public.investment_options where id=p_investment_id and asset_type='stock') then raise exception 'Selecione uma ação listada na BNV.';end if;return private.execute_investment_trade(p_investment_id,p_operation_type,p_quantity,p_idempotency_key,p_expected_price);end $$;
create or replace function private.list_company_stock(p_business_id uuid,p_symbol text,p_total_shares bigint,p_offered_percent numeric,p_price numeric,p_actor uuid,p_bootstrap boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare b public.businesses%rowtype; cash numeric; offering numeric; liquidity numeric; float_count bigint; population public.accounts%rowtype; reserve uuid; option uuid; cycle_count integer; profitable numeric; current_staff integer;
begin
 perform pg_advisory_xact_lock(hashtext('govrp:stock-market'));
 select * into b from public.businesses where id=p_business_id and status='active' for update;
 if b.id is null or (not p_bootstrap and b.owner_id is distinct from p_actor) or (p_bootstrap and b.control_kind<>'population') then raise exception 'Somente o proprietário pode abrir capital.' using errcode='42501';end if;
 if exists(select 1 from public.investment_options where business_id=b.id) then raise exception 'Esta empresa já possui ações listadas.';end if;
 if p_symbol is null or upper(p_symbol)!~'^[A-Z]{3,5}[0-9]$' or p_total_shares is null or p_total_shares not between 1000 and 100000000 or p_offered_percent is null or p_offered_percent not between 5 and 49 or p_price is null or p_price<.01 or p_price>1000000 or p_price<>round(p_price,2) then raise exception 'Informe ticker (3 a 5 letras e um número), quantidade entre mil e 100 milhões, oferta de 5%% a 49%% e preço com centavos.';end if;
 select count(*),coalesce(sum(net_result),0) into cycle_count,profitable from public.business_balance_cycles where business_id=b.id;
 select count(*) into current_staff from public.business_employees where business_id=b.id and fired_at is null;
 if b.market_value<1000000 or current_staff<20 or (not p_bootstrap and cycle_count<2) or b.operational_status in('closed','insolvent') or exists(select 1 from public.business_employees where business_id=b.id and wage_due>salary) or not exists(select 1 from public.documents where id=b.cnpj_document_id and type='CNPJ' and is_valid and (expires_at is null or expires_at>now())) then raise exception 'A abertura exige valor de R$ 1 milhão, 20 trabalhadores, dois balanços completos, CNPJ válido e salários regulares.';end if;
 if p_price*p_total_shares<b.market_value*.5 or p_price*p_total_shares>b.market_value*1.5 then raise exception 'O valor total das ações deve ficar entre 50%% e 150%% da avaliação atual da empresa.';end if;
 float_count:=floor(p_total_shares*p_offered_percent/100);offering:=round(float_count*p_price,2);liquidity:=round(offering*.25,2);
 select * into population from public.accounts where account_kind='population';
 perform id from public.accounts where id in(population.id,b.bank_account_id) order by id for update;select * into population from public.accounts where id=population.id;
 if population.balance<offering+liquidity then raise exception 'O fundo de mercado não possui caixa para subscrever esta oferta. Reduza o percentual ou aguarde liquidez.';end if;
 insert into public.investment_options(name,description,risk_level,annual_return_rate,minimum_amount,is_active,asset_symbol,asset_type,current_unit_price,business_id,total_shares,floated_shares,available_shares,initial_unit_price,previous_close,listed_at,listing_metadata) values(b.name,'Participação econômica na empresa. A compra de ações não concede controle administrativo.','high',0,p_price,true,upper(p_symbol),'stock',p_price,b.id,p_total_shares,float_count,float_count,p_price,p_price,now(),jsonb_build_object('offered_percent',p_offered_percent,'valuation_at_listing',b.market_value,'initial_subscribed_capital',offering,'bootstrap',p_bootstrap,'listed_by',p_actor)) returning id into option;
 insert into public.accounts(account_kind,investment_id,account_number,agency_number,balance) values('investment_reserve',option,'BNV-'||replace(option::text,'-',''),'0003',liquidity) returning id into reserve;
 update public.accounts set balance=balance-offering-liquidity,updated_at=now() where id=population.id;
 update public.accounts set balance=balance+offering,updated_at=now() where id=b.bank_account_id;
 insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata) values(population.id,b.bank_account_id,offering,'company_capital','Subscrição de capital na BNV: '||b.name,jsonb_build_object('business_id',b.id,'investment_id',option,'kind','ipo_capital')),(population.id,reserve,liquidity,'investment_reserve_funding','Reserva de liquidez: '||upper(p_symbol),jsonb_build_object('investment_id',option));
 insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key) values(b.id,'other',offering,'Capital recebido na abertura de capital',jsonb_build_object('kind','ipo_capital','investment_id',option),'ipo:'||option);
 insert into public.stock_price_history(investment_id,price,reason,metadata) values(option,p_price,'listing',jsonb_build_object('bootstrap',p_bootstrap));
 insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key) values('company_stock_listed','economy','investment_options',option,p_actor,jsonb_build_object('business_id',b.id,'name',b.name,'ticker',upper(p_symbol),'price',p_price,'offered_shares',float_count),'stock-listing:'||b.id);
 return option;
end $$;
create or replace function public.open_company_capital(p_business_id uuid,p_symbol text,p_total_shares bigint,p_offered_percent numeric,p_price numeric) returns uuid language plpgsql security definer set search_path='' as $$
begin if auth.uid() is null then raise exception 'Entre para abrir capital.' using errcode='42501';end if;return private.list_company_stock(p_business_id,p_symbol,p_total_shares,p_offered_percent,p_price,auth.uid(),false);end $$;
create or replace function public.distribute_company_dividend(p_business_id uuid,p_amount numeric,p_idempotency_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.businesses%rowtype;o public.investment_options%rowtype;d public.company_dividends%rowtype;h record;profit numeric;cash numeric;payment numeric;distributed numeric:=0;retained numeric;target uuid;population uuid;reserve uuid;
begin
 if auth.uid() is null or p_amount is null or p_amount<=0 or p_amount>1000000000 or p_amount<>round(p_amount,2) or p_idempotency_key is null then raise exception 'Informe um valor positivo para distribuir.';end if;
 perform pg_advisory_xact_lock(hashtext('govrp:stock-market'));
 select * into d from public.company_dividends where idempotency_key=p_idempotency_key;
 if found then if d.declared_by<>auth.uid() or d.business_id<>p_business_id or d.amount<>p_amount then raise exception 'Este identificador pertence a outra distribuição.';end if;return to_jsonb(d);end if;
 select * into b from public.businesses where id=p_business_id for update;
 if b.owner_id is distinct from auth.uid() then raise exception 'Somente o proprietário pode distribuir dividendos.' using errcode='42501';end if;
 select * into o from public.investment_options where business_id=b.id and asset_type='stock' for update;
 if o.id is null then raise exception 'A empresa precisa estar listada na BNV.';end if;
 select coalesce(sum(net_result),0)-(select coalesce(sum(amount),0) from public.company_dividends where business_id=b.id) into profit from public.business_balance_cycles where business_id=b.id;
 if profit<p_amount or exists(select 1 from public.business_employees where business_id=b.id and wage_due>0) then raise exception 'A distribuição exige lucro acumulado suficiente e salários quitados.';end if;
 select id into population from public.accounts where account_kind='population';select id into reserve from public.accounts where investment_id=o.id;
 if exists(select 1 from public.user_investments u where investment_id=o.id and quantity>0 and not exists(select 1 from public.accounts a where a.user_id=u.user_id and a.account_kind='personal')) then raise exception 'Um acionista precisa regularizar a conta bancária antes da distribuição.';end if;
 perform id from public.accounts where id in(b.bank_account_id,population,reserve) or user_id=b.owner_id or user_id in(select user_id from public.user_investments where investment_id=o.id and quantity>0) order by id for update;
 select balance into cash from public.accounts where id=b.bank_account_id;if cash<p_amount then raise exception 'O caixa da empresa é insuficiente.';end if;
 insert into public.company_dividends(business_id,investment_id,amount,per_share,declared_by,idempotency_key) values(b.id,o.id,p_amount,p_amount/o.total_shares,auth.uid(),p_idempotency_key) returning * into d;
 update public.accounts set balance=balance-p_amount,updated_at=now() where id=b.bank_account_id;
 for h in select * from public.user_investments where investment_id=o.id and quantity>0 order by user_id loop
  payment:=floor(p_amount*h.quantity/o.total_shares*100)/100;if payment<=0 then continue;end if;
  select id into target from public.accounts where user_id=h.user_id and account_kind='personal';
  update public.accounts set balance=balance+payment,updated_at=now() where id=target;distributed:=distributed+payment;
  insert into public.stock_dividend_receipts(dividend_id,user_id,amount,quantity_snapshot) values(d.id,h.user_id,payment,h.quantity);
  insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata) values(b.bank_account_id,target,payment,'stock_dividend','Dividendos de '||o.asset_symbol,jsonb_build_object('dividend_id',d.id,'quantity',h.quantity,'investment_id',o.id));
  insert into public.notifications(user_id,type,content,link,metadata) values(h.user_id,'stock_dividend','Você recebeu R$ '||payment||' em dividendos de '||o.asset_symbol||'.','/services/stock-exchange',jsonb_build_object('dividend_id',d.id));
 end loop;
 payment:=floor(p_amount*o.available_shares/o.total_shares*100)/100;
 if payment>0 then update public.accounts set balance=balance+payment,updated_at=now() where id=reserve;distributed:=distributed+payment;insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata) values(b.bank_account_id,reserve,payment,'stock_dividend','Dividendos das ações em oferta',jsonb_build_object('dividend_id',d.id));end if;
 retained:=p_amount-distributed;select id into target from public.accounts where user_id=b.owner_id and account_kind='personal';
 if target is null then raise exception 'O proprietário precisa regularizar sua conta bancária.';end if;
 if retained>0 then update public.accounts set balance=balance+retained,updated_at=now() where id=target;insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata) values(b.bank_account_id,target,retained,'stock_dividend','Dividendos da participação do controlador',jsonb_build_object('dividend_id',d.id,'controller_shares',o.total_shares-o.floated_shares));end if;
 insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key) values(b.id,'other',-p_amount,'Dividendos distribuídos',jsonb_build_object('kind','dividend','dividend_id',d.id),'dividend:'||d.id);
 insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key) values('company_dividend_paid','economy','company_dividends',d.id,auth.uid(),jsonb_build_object('business_id',b.id,'amount',p_amount,'ticker',o.asset_symbol),'dividend:'||d.id);
 return to_jsonb(d);
end $$;
create or replace function private.refresh_stock_prices() returns void language plpgsql security definer set search_path='' as $$
declare o public.investment_options%rowtype;b public.businesses%rowtype;confidence numeric;inflation numeric;profit numeric;debt numeric;anchor numeric;target numeric;next_price numeric;demand numeric;index_value numeric;previous numeric;
begin
 perform pg_advisory_xact_lock(hashtext('govrp:stock-market'));
 select consumer_confidence into confidence from public.economic_state where id=true;
 for o in select * from public.investment_options where asset_type='stock' and is_active order by id for update loop
  if exists(select 1 from public.stock_price_history where investment_id=o.id and captured_at>=date_trunc('hour',now()) and reason='fundamentals') then continue;end if;
  select * into b from public.businesses where id=o.business_id;
  select coalesce(sum(net_result),0) into profit from(select net_result from public.business_balance_cycles where business_id=b.id order by cycle_start_at desc limit 4)s;
  select coalesce(sum(wage_due),0) into debt from public.business_employees where business_id=b.id;
  anchor:=greatest(.01,b.market_value/o.total_shares);demand:=1+.1*(.5-o.available_shares/o.floated_shares);
  target:=greatest(.01,anchor*greatest(.5,least(1.5,1+profit/greatest(1,b.market_value)-debt/greatest(1,b.market_value)))*greatest(.8,least(1.2,1+(coalesce(confidence,50)-50)/250))*demand*case when b.operational_status in('closed','insolvent') then .7 else 1 end);
  next_price:=round(greatest(.01,o.current_unit_price*greatest(.98,least(1.02,1+(target/o.current_unit_price-1)*.1))),6);
  update public.investment_options set current_unit_price=next_price,previous_close=case when price_updated_at::date<current_date then current_unit_price else coalesce(previous_close,current_unit_price) end,price_updated_at=now() where id=o.id;
  insert into public.stock_price_history(investment_id,price,reason,metadata) values(o.id,next_price,'fundamentals',jsonb_build_object('market_value',b.market_value,'profit',profit,'wage_debt',debt,'confidence',confidence,'available_shares',o.available_shares,'target',target));
 end loop;
 select 1000*sum(current_unit_price*total_shares)/nullif(sum(initial_unit_price*total_shares),0) into index_value from public.investment_options where asset_type='stock' and is_active;
 if index_value is not null and not exists(select 1 from public.stock_index_history where captured_at>=date_trunc('hour',now())) then
  select value into previous from public.stock_index_history order by captured_at desc,id desc limit 1;insert into public.stock_index_history(value,previous_value) values(index_value,coalesce(previous,index_value));
 end if;
end $$;
create or replace function public.get_stock_market() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Entre para consultar a BNV.' using errcode='42501';end if;
 return jsonb_build_object('assets',(select coalesce(jsonb_agg(to_jsonb(x) order by asset_symbol),'[]') from(select o.*,b.name company_name,b.logo_url,b.brand_color,b.region_code,b.size_class,b.control_kind,b.owner_id,t.name sector,(select coalesce(sum(gross_amount),0) from public.investment_operations where investment_id=o.id and executed_at>=current_date) volume_today,(select gross_revenue from public.business_balance_cycles where business_id=b.id order by cycle_start_at desc limit 1) last_revenue,(select net_result from public.business_balance_cycles where business_id=b.id order by cycle_start_at desc limit 1) last_profit,(select balance from public.accounts where investment_id=o.id) liquidity from public.investment_options o join public.businesses b on b.id=o.business_id join public.business_types t on t.id=b.business_type_id where o.asset_type='stock' and o.is_active)x),'index',(select to_jsonb(h) from public.stock_index_history h order by captured_at desc,id desc limit 1),'holdings',(select coalesce(jsonb_agg(to_jsonb(h)),'[]') from public.user_investments h join public.investment_options o on o.id=h.investment_id where h.user_id=auth.uid() and o.asset_type='stock'),'receipts',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from(select * from public.stock_dividend_receipts where user_id=auth.uid() order by created_at desc limit 50)r),'rules',jsonb_build_object('minimum_value',1000000,'minimum_staff',20,'minimum_cycles',2,'minimum_offer_percent',5,'maximum_offer_percent',49,'fees',0));
end $$;
create or replace function public.get_stock_history(p_investment_id uuid default null,p_range text default '7D') returns jsonb language plpgsql stable security definer set search_path='' as $$
declare since timestamptz;
begin
 if auth.uid() is null then raise exception 'Entre para consultar cotações.' using errcode='42501';end if;
 since:=case p_range when '1D' then now()-interval '1 day' when '7D' then now()-interval '7 days' when '1M_RP' then public.rp_date_to_real_date(public.rp_now()-interval '1 month') else now()-interval '7 days' end;
 if p_investment_id is null then return (select coalesce(jsonb_agg(to_jsonb(h) order by captured_at),'[]') from(select captured_at,value as price from public.stock_index_history where captured_at>=since order by captured_at desc limit 1000)h);end if;
 return (select coalesce(jsonb_agg(to_jsonb(h) order by captured_at),'[]') from(select captured_at,price from public.stock_price_history where investment_id=p_investment_id and captured_at>=since order by captured_at desc limit 1000)h);
end $$;
revoke all on function private.execute_investment_trade(uuid,text,numeric,uuid,numeric),private.list_company_stock(uuid,text,bigint,numeric,numeric,uuid,boolean),private.refresh_stock_prices() from public,anon,authenticated;
revoke all on function public.trade_stock(uuid,text,numeric,uuid,numeric),public.open_company_capital(uuid,text,bigint,numeric,numeric),public.distribute_company_dividend(uuid,numeric,uuid),public.get_stock_market(),public.get_stock_history(uuid,text),public.trade_investment(uuid,text,numeric,uuid) from public,anon;
grant execute on function public.trade_stock(uuid,text,numeric,uuid,numeric),public.open_company_capital(uuid,text,bigint,numeric,numeric),public.distribute_company_dividend(uuid,numeric,uuid),public.get_stock_market(),public.get_stock_history(uuid,text),public.trade_investment(uuid,text,numeric,uuid) to authenticated;
alter publication supabase_realtime add table public.stock_price_history,public.stock_index_history,public.company_dividends,public.stock_dividend_receipts;
notify pgrst,'reload schema';
commit;
