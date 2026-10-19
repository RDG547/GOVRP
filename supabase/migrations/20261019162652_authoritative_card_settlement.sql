begin;
alter table public.card_invoice_items add column entry_kind text not null default 'charge' check(entry_kind in('charge','payment','credit')),add column voided_at timestamptz,add column reconciliation_note text;
alter table public.card_invoices add column opening_amount numeric(15,2) not null default 0,add column charges_total numeric(15,2) not null default 0,add column payments_total numeric(15,2) not null default 0,add column credits_total numeric(15,2) not null default 0;

create function private.refresh_card_balances(p_card uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform id from public.cards where id=p_card for update;
 with totals as(select i.id,i.opening_amount+coalesce(sum(it.amount) filter(where it.entry_kind='charge'),0) charges,coalesce(sum(it.amount) filter(where it.entry_kind='payment'),0) payments,coalesce(sum(it.amount) filter(where it.entry_kind='credit'),0) credits from public.card_invoices i left join public.card_invoice_items it on it.invoice_id=i.id and it.voided_at is null where i.card_id=p_card group by i.id), balances as(select t.*,greatest(0,t.charges+coalesce(i.interest_amount,0)-t.payments-t.credits) due from totals t join public.card_invoices i on i.id=t.id)
 update public.card_invoices i set charges_total=b.charges,payments_total=b.payments,credits_total=b.credits,amount=b.due,status=case when b.due=0 then 'paid' when i.due_date<current_date then 'overdue' when i.closing_date<current_date then 'closed' else 'open' end,updated_at=clock_timestamp() from balances b where b.id=i.id and (i.charges_total,i.payments_total,i.credits_total,i.amount,i.status) is distinct from (b.charges,b.payments,b.credits,b.due,case when b.due=0 then 'paid' when i.due_date<current_date then 'overdue' when i.closing_date<current_date then 'closed' else 'open' end);
 update public.cards set used_limit=coalesce((select sum(amount) from public.card_invoices where card_id=p_card),0) where id=p_card and used_limit is distinct from coalesce((select sum(amount) from public.card_invoices where card_id=p_card),0);
end $$;
revoke all on function private.refresh_card_balances(uuid) from public,anon,authenticated;

-- Preserve every old entry and transaction. Classification and opening balances
-- make missing historical detail explicit rather than silently forgiving debt.
update public.card_invoice_items it set entry_kind='payment',reconciliation_note='Pagamento anteriormente classificado como compra.' from public.transactions t where it.transaction_id=t.id and t.type in('card_payment','invoice_payment');
with ranked as(select id,row_number() over(partition by invoice_id,transaction_id order by created_at,id) n from public.card_invoice_items where transaction_id is not null) update public.card_invoice_items it set voided_at=clock_timestamp(),reconciliation_note='Duplicata do mesmo lançamento; original preservado.' from ranked r where r.id=it.id and r.n>1;
create unique index card_invoice_transaction_once on public.card_invoice_items(invoice_id,transaction_id,entry_kind) where transaction_id is not null and voided_at is null;
update public.card_invoices i set opening_amount=greatest(0,i.amount-coalesce(i.interest_amount,0)) where i.amount>0 and not exists(select 1 from public.card_invoice_items it where it.invoice_id=i.id);

create function private.reconcile_card_history(p_card uuid) returns void language plpgsql security definer set search_path='' as $$
declare c public.cards%rowtype;i public.card_invoices%rowtype;t public.transactions%rowtype;pid uuid;remaining numeric;payable numeric;before_state jsonb;old_limit numeric;documented numeric;
begin
 select * into c from public.cards where id=p_card for update;old_limit:=c.used_limit;
 select jsonb_agg(to_jsonb(x)) into before_state from public.card_invoices x where x.card_id=c.id;
 -- Import only real card charges; payments can never enter this set.
 for t in select tx.* from public.transactions tx where tx.metadata->>'card_id'=c.id::text and tx.type in('purchase_card','subscription_payment_card','purchase') and not exists(select 1 from public.card_invoice_items it where it.transaction_id=tx.id and it.entry_kind='charge' and it.voided_at is null) order by tx.created_at,tx.id loop
  select id into pid from public.card_invoices where card_id=c.id and closing_date>=t.created_at::date order by closing_date,id limit 1;
  if pid is null then insert into public.card_invoices(card_id,user_id,closing_date,due_date,amount,status) values(c.id,c.user_id,current_date+30,current_date+40,0,'open') returning id into pid;end if;
  insert into public.card_invoice_items(invoice_id,transaction_id,description,amount,created_at,reconciliation_note) values(pid,t.id,t.description,t.amount,t.created_at,'Compra vinculada pelo identificador original da transação.');
 end loop;
 -- A prior administrative settlement remains a credit, with its original row.
 for i in select * from public.card_invoices where card_id=c.id and status='paid' and amount=0 loop
  select greatest(0,i.opening_amount+coalesce(sum(case when entry_kind='charge' then amount else -amount end),0)+coalesce(i.interest_amount,0)) into payable from public.card_invoice_items where invoice_id=i.id and voided_at is null;
  if payable>0 and not exists(select 1 from public.transactions where metadata->>'card_id'=c.id::text and type in('card_payment','invoice_payment')) then insert into public.card_invoice_items(invoice_id,description,amount,entry_kind,reconciliation_note) values(i.id,'Quitação administrativa anterior preservada',payable,'credit','Saldo já estava quitado antes da conciliação; não recriar dívida.');end if;
 end loop;
 perform private.refresh_card_balances(c.id);
 for t in select tx.* from public.transactions tx where tx.metadata->>'card_id'=c.id::text and tx.type in('card_payment','invoice_payment') order by tx.created_at,tx.id loop
  select greatest(0,t.amount-coalesce(sum(it.amount),0)) into remaining from public.card_invoice_items it where it.transaction_id=t.id and it.entry_kind='payment' and it.voided_at is null;
  if remaining<=0 then continue;end if;
  for i in select inv.* from public.card_invoices inv where card_id=c.id and amount>0 and (inv.created_at<=t.created_at or exists(select 1 from public.card_invoice_items it where it.invoice_id=inv.id and it.entry_kind='charge' and it.created_at<=t.created_at)) and (t.metadata->>'invoice_id' is null or inv.id::text=t.metadata->>'invoice_id') order by due_date,created_at,id for update loop
   payable:=least(remaining,i.amount);insert into public.card_invoice_items(invoice_id,transaction_id,description,amount,entry_kind,created_at,reconciliation_note) values(i.id,t.id,t.description,payable,'payment',t.created_at,'Pagamento original conciliado; nenhuma nova cobrança.');remaining:=remaining-payable;perform private.refresh_card_balances(c.id);exit when remaining<=0;
  end loop;
 end loop;
 -- Remove only interest proven to have been assessed on already-paid principal.
 update public.card_invoices inv set interest_amount=least(inv.interest_amount,round(greatest(0,inv.opening_amount+coalesce((select sum(case when it.entry_kind='charge' then it.amount else -it.amount end) from public.card_invoice_items it where it.invoice_id=inv.id and it.voided_at is null and it.created_at<=inv.interest_applied_at),0))*coalesce(inv.interest_rate,0)/100,2)) where inv.card_id=c.id and inv.interest_applied_at is not null and exists(select 1 from public.card_invoice_items it where it.invoice_id=inv.id and it.entry_kind='payment' and it.created_at<=inv.interest_applied_at);
 perform private.refresh_card_balances(c.id);
 select coalesce(sum(amount),0) into documented from public.card_invoices where card_id=c.id;
 if old_limit>documented then
  insert into public.card_invoices(card_id,user_id,closing_date,due_date,amount,status,opening_amount) values(c.id,c.user_id,current_date+30,current_date+40,old_limit-documented,'open',old_limit-documented);
 end if;
 perform private.refresh_card_balances(c.id);
 perform economy_private.audit('card_ledger_reconciled','cards',c.id::text,jsonb_build_object('used_limit',old_limit,'invoices',before_state),jsonb_build_object('used_limit',(select used_limit from public.cards where id=c.id),'invoices',(select jsonb_agg(to_jsonb(x)) from public.card_invoices x where x.card_id=c.id)),'Conciliação de compras, pagamentos e encargos por identificadores persistidos; sem débito ou exclusão de transações.',auth.uid());
end $$;
revoke all on function private.reconcile_card_history(uuid) from public,anon,authenticated;
do $$ declare c record;begin for c in select id from public.cards order by id loop perform private.reconcile_card_history(c.id);end loop;end $$;

create function private.on_card_entry() returns trigger language plpgsql security definer set search_path='' as $$
declare cid uuid;begin select card_id into cid from public.card_invoices where id=coalesce(new.invoice_id,old.invoice_id);perform private.refresh_card_balances(cid);return coalesce(new,old);end $$;
create trigger card_entry_balance after insert or update or delete on public.card_invoice_items for each row execute function private.on_card_entry();
create constraint trigger card_entry_final_balance after insert or update or delete on public.card_invoice_items deferrable initially deferred for each row execute function private.on_card_entry();
revoke all on function private.on_card_entry() from public,anon,authenticated;

create function private.settle_card_payment(p_card uuid,p_invoice uuid,p_amount numeric,p_key uuid,p_owner uuid,p_full boolean default false) returns json language plpgsql security definer set search_path='' as $$
declare c public.cards%rowtype;i public.card_invoices%rowtype;a public.accounts%rowtype;t public.transactions%rowtype;total numeric;remaining numeric;piece numeric;key uuid:=coalesce(p_key,gen_random_uuid());
begin
 if p_owner is null then raise exception 'Entre para pagar sua fatura.' using errcode='42501';end if;
 if p_key is not null then perform pg_advisory_xact_lock(hashtextextended('card-payment:'||p_key,0));end if;
 select * into c from public.cards where id=p_card and user_id=p_owner for update;if c.id is null then raise exception 'Cartão não encontrado ou não pertence a você.' using errcode='42501';end if;
 if p_key is not null then
  select * into t from public.transactions where idempotency_key=p_key;
  if t.id is not null then if t.metadata->>'invoice_id' is distinct from p_invoice::text or (not p_full and t.amount is distinct from p_amount) or t.metadata->>'card_id' is distinct from c.id::text or t.type not in('card_payment','invoice_payment') or not exists(select 1 from public.accounts where id=t.from_account_id and user_id=p_owner) then raise exception 'Identificação de pagamento já utilizada.';end if;return json_build_object('success',true,'idempotent',true,'transaction_id',t.id,'message','Este pagamento já foi confirmado.');end if;
 end if;
 select coalesce(sum(amount),0) into total from public.card_invoices where card_id=c.id and (p_invoice is null or id=p_invoice);
 if p_full then p_amount:=total;end if;
 if p_amount is null or p_amount::text in('NaN','Infinity','-Infinity') or p_amount<>round(p_amount,2) or p_amount<=0 or p_amount>total then return json_build_object('success',false,'message','Informe um valor positivo de até o saldo devedor real.');end if;
 select * into a from public.accounts where user_id=p_owner and coalesce(account_kind,'personal')='personal' order by id limit 1 for update;
 if a.id is null or a.balance<p_amount then return json_build_object('success',false,'message','Saldo em conta insuficiente para pagar a fatura.');end if;
 insert into public.transactions(from_account_id,amount,type,description,metadata,idempotency_key) values(a.id,p_amount,case when p_invoice is null then 'card_payment' else 'invoice_payment' end,'Pagamento de fatura de cartão',jsonb_build_object('card_id',c.id,'invoice_id',p_invoice,'amount',p_amount),key) returning * into t;
 update public.accounts set balance=balance-p_amount,updated_at=clock_timestamp() where id=a.id;
 remaining:=p_amount;
 for i in select * from public.card_invoices where card_id=c.id and amount>0 and (p_invoice is null or id=p_invoice) order by due_date,created_at,id for update loop
  piece:=least(remaining,i.amount);insert into public.card_invoice_items(invoice_id,transaction_id,description,amount,entry_kind) values(i.id,t.id,'Pagamento recebido',piece,'payment');remaining:=remaining-piece;exit when remaining<=0;
 end loop;
 perform private.refresh_card_balances(c.id);
 return json_build_object('success',true,'transaction_id',t.id,'message','Pagamento confirmado. Saldo devedor e limite atualizados.');
end $$;
revoke all on function private.settle_card_payment(uuid,uuid,numeric,uuid,uuid,boolean) from public,anon,authenticated;
drop function public.pay_card_bill(uuid,numeric);
create function public.pay_card_bill(p_card_id uuid,p_amount_to_pay numeric,p_idempotency_key uuid default null) returns json language plpgsql security definer set search_path='' as $$begin return private.settle_card_payment(p_card_id,null,p_amount_to_pay,p_idempotency_key,auth.uid());end $$;
drop function public.pay_card_invoice(uuid,boolean,numeric);
create function public.pay_card_invoice(p_invoice_id uuid,p_pay_full boolean,p_amount_to_pay numeric,p_idempotency_key uuid default null) returns json language plpgsql security definer set search_path='' as $$declare cid uuid;begin select card_id into cid from public.card_invoices where id=p_invoice_id and user_id=auth.uid();return private.settle_card_payment(cid,p_invoice_id,p_amount_to_pay,p_idempotency_key,auth.uid(),p_pay_full);end $$;
revoke all on function public.pay_card_bill(uuid,numeric,uuid),public.pay_card_invoice(uuid,boolean,numeric,uuid) from public,anon;
grant execute on function public.pay_card_bill(uuid,numeric,uuid),public.pay_card_invoice(uuid,boolean,numeric,uuid) to authenticated;

create or replace function public.process_card_transactions_for_invoice() returns void language plpgsql security definer set search_path='' as $$
declare c public.cards%rowtype;t public.transactions%rowtype;pid uuid;
begin
 for c in select * from public.cards where is_active order by id for update loop
  for t in select x.* from public.transactions x where x.metadata->>'card_id'=c.id::text and x.type in('purchase_card','subscription_payment_card','purchase') and not exists(select 1 from public.card_invoice_items it where it.transaction_id=x.id and it.voided_at is null) order by x.created_at,x.id loop
   select id into pid from public.card_invoices where card_id=c.id and closing_date>=current_date order by closing_date,id limit 1;
   if pid is null then insert into public.card_invoices(card_id,user_id,closing_date,due_date,amount) values(c.id,c.user_id,current_date+30,current_date+40,0) returning id into pid;end if;
   insert into public.card_invoice_items(invoice_id,transaction_id,description,amount,created_at) values(pid,t.id,t.description,t.amount,t.created_at);
  end loop;
 end loop;
end $$;
revoke all on function public.process_card_transactions_for_invoice() from public,anon,authenticated;grant execute on function public.process_card_transactions_for_invoice() to service_role;
create or replace function public.close_due_invoices() returns jsonb language plpgsql security definer set search_path='' as $$
declare c record;rate numeric;affected integer;
begin
 rate:=coalesce((public.get_bank_policy()->>'credit_card_revolving_rate')::numeric,8.9);
 for c in select id from public.cards order by id for update loop perform private.refresh_card_balances(c.id);end loop;
 update public.card_invoices set interest_rate=rate,interest_amount=round(amount*rate/100,2),interest_applied_at=clock_timestamp() where amount>0 and due_date<current_date and interest_applied_at is null;
 get diagnostics affected=row_count;
 for c in select id from public.cards order by id for update loop perform private.refresh_card_balances(c.id);end loop;
 return jsonb_build_object('success',true,'affected_count',affected);
end $$;
revoke all on function public.close_due_invoices() from public,anon,authenticated;grant execute on function public.close_due_invoices() to service_role;
create or replace function public.cancel_credit_card(p_card_id uuid) returns json language plpgsql security definer set search_path='' as $$declare c public.cards%rowtype;begin
 if auth.uid() is null then raise exception 'Entre para cancelar seu cartão.' using errcode='42501';end if;
 select * into c from public.cards where id=p_card_id and user_id=auth.uid() for update;
 if c.id is null then return json_build_object('success',false,'message','Cartão não encontrado ou não pertence a você.');end if;
 if not c.is_active then return json_build_object('success',true,'message','Este cartão já foi cancelado.');end if;
 if c.used_limit>0 or exists(select 1 from public.card_invoices where card_id=c.id and amount>0) then return json_build_object('success',false,'message','Pague o saldo devedor e as obrigações pendentes antes de cancelar.');end if;
 update public.cards set is_active=false where id=c.id;perform economy_private.audit('card_cancelled','cards',c.id::text,null,jsonb_build_object('is_active',false),'Cancelamento sem obrigações financeiras pendentes.',auth.uid());return json_build_object('success',true,'message','Cartão cancelado. Histórico preservado.');end $$;
create or replace function public.admin_pay_invoice(p_invoice_id uuid) returns json language plpgsql security definer set search_path='' as $$declare i public.card_invoices%rowtype;begin
 if not public.is_admin(auth.uid()) then raise exception 'Acesso administrativo necessário.' using errcode='42501';end if;
 select * into i from public.card_invoices where id=p_invoice_id;
 perform id from public.cards where id=i.card_id for update;
 select * into i from public.card_invoices where id=p_invoice_id for update;
 if i.id is null or i.amount<=0 then return json_build_object('success',false,'message','Fatura indisponível ou já quitada.');end if;
 perform id from public.cards where id=i.card_id for update;
 insert into public.card_invoice_items(invoice_id,description,amount,entry_kind,reconciliation_note) values(i.id,'Crédito administrativo auditado',i.amount,'credit','Quitação administrativa autorizada por '||auth.uid());
 perform economy_private.audit('invoice_administrative_credit','card_invoices',i.id::text,to_jsonb(i),jsonb_build_object('amount',i.amount),'Quitação administrativa; sem cobrança fictícia na conta do titular.',auth.uid());return json_build_object('success',true,'message','Crédito administrativo registrado com auditoria.');end $$;
create or replace function public.get_users_with_pending_invoices() returns table(id uuid,full_name text) language plpgsql security definer set search_path='' as $$begin
 if not public.is_admin(auth.uid()) then raise exception 'Acesso administrativo necessário.' using errcode='42501';end if;
 return query select distinct p.id,p.full_name from public.profiles p join public.card_invoices i on i.user_id=p.id where i.amount>0;end $$;
create or replace function public.get_invoice_items(p_invoice_id uuid) returns table(id uuid,transaction_id uuid,description text,amount numeric,created_at timestamptz) language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null then raise exception 'Entre para consultar a fatura.' using errcode='42501';end if;
 return query select it.id,it.transaction_id,it.description,case when it.entry_kind='charge' then it.amount else -it.amount end,it.created_at from public.card_invoice_items it join public.card_invoices i on i.id=it.invoice_id where i.id=p_invoice_id and i.user_id=auth.uid() and it.voided_at is null order by it.created_at,it.id;end $$;
commit;
