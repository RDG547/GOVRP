BEGIN;
-- Profitable, unlisted population-owned firms may return part of retained
-- earnings to their actual investor. No transfer if wages or reserves are short.
CREATE OR REPLACE FUNCTION private.return_population_earnings(p_business uuid,p_cycle uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.businesses%rowtype; wallet uuid; cash numeric; wages numeric; reserve numeric;
 profit numeric; amount numeric; debit numeric; credit numeric; q jsonb; tx uuid; cycle public.business_balance_cycles%rowtype;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('govrp:stock-market'));
 PERFORM pg_advisory_xact_lock(hashtextextended('govrp:company-economy',0));
 SELECT * INTO b FROM public.businesses WHERE id=p_business FOR UPDATE;
 IF b.id IS NULL OR b.control_kind<>'population' OR b.owner_id IS NOT NULL
  OR NOT coalesce((b.metadata->>'structural_reform')::boolean,false) THEN RETURN 0;END IF;
 IF EXISTS(SELECT 1 FROM public.investment_options WHERE business_id=b.id AND asset_type='stock') THEN RETURN 0;END IF;
 SELECT * INTO cycle FROM public.business_balance_cycles WHERE id=p_cycle AND business_id=b.id;
 IF cycle.id IS NULL OR cycle.net_result<=0 THEN RETURN 0;END IF;
 IF EXISTS(SELECT 1 FROM public.business_transactions WHERE business_id=b.id AND operation_key='population-return:'||p_cycle) THEN RETURN 0;END IF;
 SELECT coalesce(sum(wage_due),0) INTO wages FROM public.business_employees WHERE business_id=b.id;
 IF wages>0 THEN RETURN 0;END IF;
 SELECT id INTO wallet FROM public.accounts WHERE account_kind='population';
 IF wallet IS NULL THEN RAISE EXCEPTION 'Conta da população indisponível.';END IF;
 PERFORM id FROM public.accounts WHERE id IN (wallet,b.bank_account_id) ORDER BY id FOR UPDATE;
 SELECT balance INTO cash FROM public.accounts WHERE id=b.bank_account_id;
 SELECT coalesce(sum(net_result),0)+coalesce((SELECT sum(t.amount) FROM public.business_transactions t
  WHERE t.business_id=b.id AND t.metadata->>'kind' IN ('owner_withdrawal','population_earnings_return')),0)
 INTO profit FROM public.business_balance_cycles WHERE business_id=b.id;
 SELECT greatest(coalesce(sum(payroll_accrued+input_cost+overhead),0),
   (SELECT coalesce(sum(salary),0) FROM public.business_employees WHERE business_id=b.id AND fired_at IS NULL)
   +7*(SELECT daily_overhead FROM public.business_types WHERE id=b.business_type_id)) INTO reserve
 FROM public.business_daily_operations WHERE business_id=b.id AND operation_date>=(statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date-6;
 amount:=trunc(greatest(0,least(profit*.25,cycle.net_result*.25,cash-reserve)),2);
 IF amount<=0 THEN RETURN 0;END IF;
 q:=public.quote_legal_levies('transfer',amount,false,b.economic_sector_id,NULL,NULL,b.region_code);
 IF coalesce((q->>'restricted')::boolean,false) THEN RETURN 0;END IF;
 debit:=(q->>'total_debited')::numeric;credit:=(q->>'net_amount')::numeric;
 IF debit IS NULL OR credit IS NULL OR debit<credit OR credit<0 OR cash-debit<reserve THEN RETURN 0;END IF;
 UPDATE public.accounts SET balance=balance-debit,updated_at=now() WHERE id=b.bank_account_id;
 UPDATE public.accounts SET balance=balance+credit,updated_at=now() WHERE id=wallet;
 IF debit>credit THEN
  UPDATE public.government_finances SET treasury_balance=treasury_balance+debit-credit,updated_at=now() WHERE id=1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tesouro indisponível para recolhimento.';END IF;
 END IF;
 INSERT INTO public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key)
 VALUES(b.bank_account_id,wallet,amount,'company_withdrawal','Retorno de lucro à população: '||b.name,
 q||jsonb_build_object('business_id',b.id,'cycle_id',p_cycle,'kind','population_earnings_return','economic_classification','financial_transfer',
  'working_capital_reserve',reserve,'profit_available',profit),md5('population-return:'||p_cycle)::uuid) RETURNING id INTO tx;
 INSERT INTO public.business_transactions(business_id,type,amount,description,metadata,operation_key)
 VALUES(b.id,'other',-amount,'Retorno de lucro à população',jsonb_build_object('kind','population_earnings_return','transaction_id',tx),'population-return:'||p_cycle);
 IF debit>amount THEN INSERT INTO public.business_transactions(business_id,type,amount,description,metadata,operation_key)
  VALUES(b.id,'tax',amount-debit,'Tributo sobre retorno à população',q,'population-return-tax:'||p_cycle);END IF;
 IF debit>credit THEN INSERT INTO public.government_revenues(revenue_type,source_table,source_id,business_id,amount,occurred_at_rp,metadata)
  VALUES('financial','transactions',tx::text,b.id,debit-credit,public.rp_now(),q);END IF;
 UPDATE public.businesses SET market_value=greatest(0,market_value-debit),updated_at=now() WHERE id=b.id;
 RETURN credit;
END $$;
REVOKE ALL ON FUNCTION private.return_population_earnings(uuid,uuid) FROM PUBLIC,anon,authenticated;



-- Weekly integration using the existing accounting cycle.
CREATE OR REPLACE FUNCTION private.close_company_fiscal_cycle(p_business_id uuid, p_until timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 update public.businesses set market_value=valuation,size_class=new_size,last_fiscal_cycle_at=start_at+interval '7 days',loss_cycles=case when net<0 then loss_cycles+1 else 0 end,operational_status=case when metadata ? 'autonomous_exit_at' then 'closed' when net<0 and loss_cycles>=2 then 'insolvent' else operational_status end,reputation=greatest(0,least(100,reputation+case when debt>0 then -5 when net>0 then 2 else -2 end)),monthly_revenue=revenue,updated_at=now() where id=b.id;
 if b.owner_id is not null then
  insert into public.notifications(user_id,type,content,link,metadata) values(b.owner_id,'business_balance',b.name||' fechou o exercício com '||case when net>=0 then 'lucro' else 'prejuízo' end||' de R$ '||abs(net)||'.','/services/companies/'||b.id,jsonb_build_object('popup_pending',true,'popup_shown_at',null,'cycle_id',cycle.id,'cycle_start_at',start_at,'business_id',b.id,'business_name',b.name,'result_type',cycle.result_type,'gross_revenue',revenue,'operating_cost',expenses,'net_result',net));
  if new_size<>b.size_class then insert into public.notifications(user_id,type,content,link) values(b.owner_id,'company_size_changed','O porte de '||b.name||' foi atualizado conforme os resultados e a equipe.','/services/companies/'||b.id);end if;
 end if;
 insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key) values('company_fiscal_cycle_closed','economy','business_balance_cycles',cycle.id,b.owner_id,to_jsonb(cycle),'company-fiscal-cycle:'||b.id||':'||start_at);
 perform private.adjust_population_company(b.id,net);
 perform private.return_population_earnings(b.id,cycle.id);
 return to_jsonb(cycle);
end $function$;

COMMIT;
