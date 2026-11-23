-- Existing account/payroll functions captured for isolated execution; not new application logic.
CREATE OR REPLACE FUNCTION public.assign_business_bank_account()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a uuid;
begin
 if new.economic_sector_id is null then select economic_sector_id into new.economic_sector_id from public.business_types where id=new.business_type_id;end if;
 select id into a from public.accounts where business_id=new.id;
 if a is null then
  insert into public.accounts(user_id,business_id,account_kind,account_number,agency_number,balance)
  values(null,new.id,'business','PJ-'||replace(new.id::text,'-',''),'0002',0) returning id into a;
  if new.bank_account_id is not null then
   new.metadata:=coalesce(new.metadata,'{}')||jsonb_build_object('legacy_personal_account_id',new.bank_account_id,'cash_separated_at',clock_timestamp());
  end if;
 end if;
 new.bank_account_id:=a;
 return new;
end $function$
;
CREATE TRIGGER businesses_assign_bank_account BEFORE INSERT ON public.businesses FOR EACH ROW EXECUTE FUNCTION public.assign_business_bank_account();
CREATE OR REPLACE FUNCTION private.pay_company_wages(p_business_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.businesses%rowtype; employee public.business_employees%rowtype; payer public.accounts%rowtype; receiver uuid; paid numeric:=0; payment numeric; tx uuid; k uuid;
begin
 select * into b from public.businesses where id=p_business_id for update;
 if b.id is null then return 0;end if;
 -- Lock all payout accounts in a stable order before processing the payroll.
 perform a.id from public.accounts a where a.id=b.bank_account_id or a.account_kind='population' or a.user_id in(select profile_id from public.business_employees where business_id=b.id and wage_due>0) order by a.id for update;
 for employee in select * from public.business_employees where business_id=b.id and wage_due>0 order by hired_at,id for update loop
  select * into payer from public.accounts where id=b.bank_account_id;
  select id into receiver from public.accounts where case when employee.is_npc then account_kind='population' else user_id=employee.profile_id end;
  if receiver is null or payer.balance<=0 then
   update public.business_employees set satisfaction=greatest(0,satisfaction-5) where id=employee.id;
   continue;
  end if;
  payment:=least(payer.balance,employee.wage_due);k:=gen_random_uuid();
  update public.accounts set balance=balance-payment,updated_at=now() where id=payer.id;
  update public.accounts set balance=balance+payment,updated_at=now() where id=receiver;
  insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key) values(payer.id,receiver,payment,'company_salary','Salário: '||b.name,jsonb_build_object('business_id',b.id,'employee_id',employee.id,'gross_amount',payment,'net_amount',payment,'total_debited',payment,'tax_amount',0,'remaining_due',employee.wage_due-payment),k) returning id into tx;
  insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key) values(b.id,'other',-payment,'Pagamento salarial: '||employee.name,jsonb_build_object('kind','payroll_payment','transaction_id',tx),'payroll:'||tx);
  update public.business_employees set wage_due=wage_due-payment,last_paid_at=now(),satisfaction=least(100,greatest(0,satisfaction+case when payment=employee.wage_due then 3 else -2 end)) where id=employee.id;
  if employee.profile_id is not null then insert into public.notifications(user_id,type,content,link,metadata) values(employee.profile_id,'company_salary_paid','Você recebeu R$ '||payment||' de '||b.name||case when payment<employee.wage_due then '. O saldo pendente permanece registrado.' else '.' end,'/services/my-work',jsonb_build_object('transaction_id',tx));end if;
  paid:=paid+payment;
 end loop;
 return paid;
end $function$
;

-- Schema-only documents; identifier generation is the external test boundary.
CREATE TABLE public.documents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,type text NOT NULL,
document_number text NOT NULL UNIQUE,is_valid boolean,full_name text,metadata jsonb);
CREATE FUNCTION public.generate_unique_document_number(text) RETURNS text LANGUAGE sql AS 'SELECT gen_random_uuid()::text';
CREATE OR REPLACE FUNCTION private.regularize_population_company(p_business_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.businesses%rowtype;kind public.business_types%rowtype;doc uuid;fee numeric;quote jsonb;cash numeric;
begin
 select * into b from public.businesses where id=p_business_id and control_kind='population' for update;
 if b.id is null or b.cnpj_document_id is not null then return;end if;
 select * into kind from public.business_types where id=b.business_type_id;
 quote:=public.quote_legal_levies('license',0,true,kind.economic_sector_id,kind.id,NULL,b.region_code);
 if (quote->>'restricted')::boolean then return;end if;
 fee:=(quote->>'buyer_tax')::numeric;select balance into cash from public.accounts where id=b.bank_account_id for update;
 if cash<fee then return;end if;
 insert into public.documents(user_id,type,document_number,is_valid,full_name,metadata) values(null,'CNPJ',public.generate_unique_document_number('CNPJ'),true,b.name,jsonb_build_object('entity_kind','population_company','business_id',b.id,'business_type_id',kind.id,'activity_name',kind.name,'company_name',b.name)) returning id into doc;
 update public.businesses set cnpj_document_id=doc,metadata=metadata||jsonb_build_object('cnpj_regularization_required',false) where id=b.id;
 if fee>0 then
  update public.accounts set balance=balance-fee,updated_at=now() where id=b.bank_account_id;
  update public.government_finances set treasury_balance=treasury_balance+fee,updated_at=now() where id=1;
  insert into public.transactions(from_account_id,amount,type,description,metadata) values(b.bank_account_id,fee,'service_fee','Regularização da empresa da população',quote||jsonb_build_object('business_id',b.id,'treasury_credit',true));
  insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key) values(b.id,'tax',-fee,'Licenciamento da empresa da população',quote,'population-registration');
 end if;
end $function$;
