begin;
create or replace function public.process_official_payroll()
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg jsonb; recipients jsonb; recipient jsonb; week_start timestamptz:=private.payroll_week(clock_timestamp());
 treasury numeric; total numeric:=0; count integer:=0; payment uuid; batch uuid:=gen_random_uuid(); amount numeric;
begin
 if not (session_user in ('postgres','supabase_admin') and auth.uid() is null and coalesce(auth.role(),'')='') and coalesce(auth.role(),'')<>'service_role' and not exists(select 1 from public.profiles where id=auth.uid() and role='Admin' and deleted_at is null) then raise exception 'A rotina salarial exige autorização administrativa.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtext('govrp:official-payroll'));
 select value into cfg from public.system_settings where key='official_salaries' for share;
 select treasury_balance into treasury from public.government_finances where id=1 for update;
 if treasury is null then raise exception 'As finanças públicas não estão disponíveis.'; end if;
 with eligible as (
  select p.id,a.id account_id,r.value salary,
    case when (r.value->>'valid_from')::timestamptz>week_start then (r.value->>'previous_amount')::numeric else (r.value->>'amount')::numeric end amount
  from public.profiles p join public.accounts a on a.user_id=p.id
   join lateral jsonb_array_elements(cfg->'roles') r on r.value->>'role'=public.canonical_official_role(p.role)
  where p.deleted_at is null and p.onboarding_completed
   and not exists(select 1 from public.salary_payments sp where sp.user_id=p.id and sp.paid_at>=week_start)
  order by p.id for update of p,a
 ) select coalesce(jsonb_agg(to_jsonb(eligible)),'[]'),coalesce(sum(eligible.amount),0) into recipients,total from eligible where eligible.amount>0;
 if total>treasury then
  for recipient in select value from jsonb_array_elements(recipients) loop
   insert into public.notifications(user_id,type,content,link,metadata)
   select (recipient->>'id')::uuid,'salary_payment_failed','O pagamento semanal aguarda saldo suficiente no Tesouro.','/services/bank',jsonb_build_object('payroll_window_start',week_start,'expected_amount',recipient->'amount','popup_pending',true)
   where not exists(select 1 from public.notifications where user_id=(recipient->>'id')::uuid and type='salary_payment_failed' and metadata->>'payroll_window_start'=week_start::text);
  end loop;
  return jsonb_build_object('success',false,'processedCount',0,'totalAmount',total,'failedDueToFunds',true,'message','Saldo insuficiente no Tesouro. Nenhum débito foi realizado.');
 end if;
 for recipient in select value from jsonb_array_elements(recipients) loop
  amount:=(recipient->>'amount')::numeric;
  insert into public.salary_payments(user_id,role,title,amount,paid_at,payment_batch_id,payroll_window_start,salary_snapshot)
  values((recipient->>'id')::uuid,recipient->'salary'->>'role',recipient->'salary'->>'title',amount,clock_timestamp(),batch,week_start,recipient->'salary'||jsonb_build_object('paid_amount',amount)) returning id into payment;
  update public.accounts set balance=balance+amount,updated_at=clock_timestamp() where id=(recipient->>'account_id')::uuid;
  insert into public.transactions(to_account_id,amount,type,description,metadata)
  values((recipient->>'account_id')::uuid,amount,'salary_payment','Pagamento semanal: '||(recipient->'salary'->>'title'),jsonb_build_object('role',recipient->'salary'->>'role','salary_payment_id',payment,'payroll_window_start',week_start,'salary_snapshot',recipient->'salary','gross_amount',amount,'net_amount',amount,'tax_amount',0));
  insert into public.notifications(user_id,type,content,link,metadata)
  values((recipient->>'id')::uuid,'salary_payment','Seu salário semanal de '||(recipient->'salary'->>'title')||' foi depositado: R$ '||to_char(amount,'FM999999990D00')||'.','/services/bank',jsonb_build_object('salary_payment_id',payment,'payroll_window_start',week_start,'amount',amount,'role',recipient->'salary'->>'role','popup_pending',true,'popup_shown_at',null));
  count:=count+1;
 end loop;
 update public.government_finances set treasury_balance=treasury_balance-total,updated_at=clock_timestamp() where id=1;
 perform economy_private.audit('official_payroll_processed','salary_payments',batch::text,null,jsonb_build_object('count',count,'total',total,'week_start',week_start),'Pagamento semanal atômico dos cargos oficiais.',auth.uid());
 return jsonb_build_object('success',true,'processedCount',count,'totalAmount',total,'payrollWindowStart',week_start,'failedDueToFunds',false,'message','Folha semanal processada.');
end; $$;

-- Keep the existing automation entry point, with one implementation and one lock.
create or replace function public.process_weekly_salaries()
returns jsonb language sql security invoker set search_path='' as $$
 select public.process_official_payroll();
$$;
alter function public.process_weekly_salaries() owner to postgres;
revoke all on function public.process_weekly_salaries() from public,anon;
grant execute on function public.process_weekly_salaries() to authenticated,service_role;
select cron.schedule('weekly-salary-payments','0 12 * * 1','select public.process_weekly_salaries();');
notify pgrst,'reload schema';
commit;
