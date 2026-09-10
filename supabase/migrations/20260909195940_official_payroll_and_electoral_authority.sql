begin;
insert into public.system_settings(key,value,description) values('official_salaries','{"version": 1, "roles": [{"role": "Presidente", "title": "Presidente da República", "amount": 35000, "previous_amount": 35000, "version": 1, "valid_from": "2026-09-09T00:00:00Z"}, {"role": "Vice-Presidente", "title": "Vice-Presidente", "amount": 24500, "previous_amount": 24500, "version": 1, "valid_from": "2026-09-09T00:00:00Z"}, {"role": "Deputado", "title": "Deputado Federal", "amount": 10500, "previous_amount": 10500, "version": 1, "valid_from": "2026-09-09T00:00:00Z"}, {"role": "Senador", "title": "Senador", "amount": 17500, "previous_amount": 17500, "version": 1, "valid_from": "2026-09-09T00:00:00Z"}, {"role": "Presidente do Senado", "title": "Presidente do Senado", "amount": 24500, "previous_amount": 24500, "version": 1, "valid_from": "2026-09-09T00:00:00Z"}, {"role": "Presidente da Câmara dos Deputados", "title": "Presidente da Câmara dos Deputados", "amount": 21000, "previous_amount": 21000, "version": 1, "valid_from": "2026-09-09T00:00:00Z"}, {"role": "Vice-Presidente da Câmara dos Deputados", "title": "Vice-Presidente da Câmara dos Deputados", "amount": 10500, "previous_amount": 10500, "version": 1, "valid_from": "2026-09-09T00:00:00Z"}, {"role": "Vice-Presidente do Senado Federal", "title": "Vice-Presidente do Senado Federal", "amount": 17500, "previous_amount": 17500, "version": 1, "valid_from": "2026-09-09T00:00:00Z"}, {"role": "Presidente do Banco Nacional", "title": "Presidente do Banco Nacional", "amount": 21000, "previous_amount": 21000, "version": 1, "valid_from": "2026-09-09T00:00:00Z"}, {"role": "Ministro", "title": "Ministro de Estado", "amount": 17500, "previous_amount": 17500, "version": 1, "valid_from": "2026-09-09T00:00:00Z"}, {"role": "Presidente do STF", "title": "Presidente do STF", "amount": 24500, "previous_amount": 24500, "version": 1, "valid_from": "2026-09-09T00:00:00Z"}, {"role": "Presidente do Portal Eleitoral", "title": "Presidente do Portal Eleitoral", "amount": 21000, "previous_amount": 21000, "version": 1, "valid_from": "2026-09-09T00:00:00Z"}, {"role": "Juiz", "title": "Juiz", "amount": 17500, "previous_amount": 17500, "version": 1, "valid_from": "2026-09-09T00:00:00Z"}, {"role": "Promotor", "title": "Promotor", "amount": 14000, "previous_amount": 14000, "version": 1, "valid_from": "2026-09-09T00:00:00Z"}, {"role": "Delegado", "title": "Delegado", "amount": 14000, "previous_amount": 14000, "version": 1, "valid_from": "2026-09-09T00:00:00Z"}, {"role": "Defensor Público", "title": "Defensor Público", "amount": 14000, "previous_amount": 14000, "version": 1, "valid_from": "2026-09-09T00:00:00Z"}, {"role": "Policial", "title": "Policial", "amount": 7000, "previous_amount": 7000, "version": 1, "valid_from": "2026-09-09T00:00:00Z"}, {"role": "Diretor-Geral de Polícia", "title": "Diretor-Geral de Polícia", "amount": 21000, "previous_amount": 21000, "version": 1, "valid_from": "2026-09-09T00:00:00Z"}, {"role": "Militar", "title": "Militar", "amount": 7000, "previous_amount": 7000, "version": 1, "valid_from": "2026-09-09T00:00:00Z"}, {"role": "Comandante-Geral das Forças Armadas", "title": "Comandante-Geral das Forças Armadas", "amount": 21000, "previous_amount": 21000, "version": 1, "valid_from": "2026-09-09T00:00:00Z"}, {"role": "Agente Secreto", "title": "Agente Secreto", "amount": 10500, "previous_amount": 10500, "version": 1, "valid_from": "2026-09-09T00:00:00Z"}, {"role": "Comandante da Agência de Inteligência", "title": "Comandante da Agência de Inteligência", "amount": 21000, "previous_amount": 21000, "version": 1, "valid_from": "2026-09-09T00:00:00Z"}, {"role": "Agente Penitenciário", "title": "Agente Penitenciário", "amount": 7000, "previous_amount": 7000, "version": 1, "valid_from": "2026-09-09T00:00:00Z"}, {"role": "Diretor Penitenciário", "title": "Diretor Penitenciário", "amount": 14000, "previous_amount": 14000, "version": 1, "valid_from": "2026-09-09T00:00:00Z"}, {"role": "Professor", "title": "Professor", "amount": 7000, "previous_amount": 7000, "version": 1, "valid_from": "2026-09-09T00:00:00Z"}]}'::jsonb,'Remuneração semanal dos cargos oficiais; vigência e versões auditadas.') on conflict do nothing;
alter table public.salary_payments add column payroll_window_start timestamptz, add column salary_snapshot jsonb not null default '{}';
create unique index salary_payment_citizen_week on public.salary_payments(user_id,payroll_window_start) where payroll_window_start is not null;
insert into public.executive_office_definitions(office_key,role_label,description,required_for_formation,sort_order)
 values('electoral_portal_president','Presidente do Portal Eleitoral','Organiza o calendário e analisa candidaturas dentro das regras eleitorais. Não altera votos ou resultados.',false,5) on conflict do nothing;


create or replace function private.payroll_week(p_at timestamptz)
returns timestamptz language sql immutable set search_path='' as $$
 select case when p_at < (date_trunc('week',p_at at time zone 'America/Sao_Paulo')+interval '9 hours') at time zone 'America/Sao_Paulo'
 then (date_trunc('week',p_at at time zone 'America/Sao_Paulo')-interval '7 days'+interval '9 hours') at time zone 'America/Sao_Paulo'
 else (date_trunc('week',p_at at time zone 'America/Sao_Paulo')+interval '9 hours') at time zone 'America/Sao_Paulo' end;
$$;
create or replace function public.configure_official_salary(p_role text,p_amount numeric,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg jsonb; entry jsonb; previous jsonb; index integer; effective timestamptz;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role='Admin' and deleted_at is null) then raise exception 'Somente a administração pode configurar a remuneração.' using errcode='42501'; end if;
 if p_amount is null or p_amount::text in('NaN','Infinity','-Infinity') or p_amount<0 or p_amount>1000000 or p_amount<>round(p_amount,2) then raise exception 'Informe um valor de zero a um milhão, com até duas casas decimais.'; end if;
 select value into cfg from public.system_settings where key='official_salaries' for update;
 select value,ordinality::integer-1 into previous,index from jsonb_array_elements(cfg->'roles') with ordinality where value->>'role'=p_role;
 if previous is null then raise exception 'Selecione um cargo remunerado do catálogo oficial.'; end if;
 if p_expected_version is null or (previous->>'version')::integer<>p_expected_version then raise exception 'A remuneração foi alterada. Atualize os valores antes de salvar.'; end if;
 effective:=private.payroll_week(clock_timestamp())+interval '7 days';
 entry:=previous||jsonb_build_object('previous_amount',case when (previous->>'valid_from')::timestamptz>clock_timestamp() then (previous->>'previous_amount')::numeric else (previous->>'amount')::numeric end,'amount',p_amount,'valid_from',effective,'version',p_expected_version+1,'updated_by',auth.uid(),'updated_at',clock_timestamp());
 cfg:=jsonb_set(cfg,array['roles',index::text],entry);
 update public.system_settings set value=cfg,updated_at=clock_timestamp() where key='official_salaries';
 perform economy_private.audit('official_salary_configured','system_settings',p_role,previous,entry,'Configuração de salário para o próximo ciclo semanal.',auth.uid());
 return entry;
end; $$;
create or replace function private.guard_salary_settings()
returns trigger language plpgsql set search_path='' as $$
begin
 if coalesce(new.key,old.key)='official_salaries' and current_user not in('postgres','supabase_admin','service_role') then raise exception 'Use a configuração validada de salários.' using errcode='42501'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end; $$;
create trigger guard_salary_settings before insert or update or delete on public.system_settings for each row execute function private.guard_salary_settings();
create or replace function public.process_official_payroll()
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg jsonb; recipients jsonb; recipient jsonb; week_start timestamptz:=private.payroll_week(clock_timestamp());
 treasury numeric; total numeric:=0; count integer:=0; payment uuid; batch uuid:=gen_random_uuid(); amount numeric;
begin
 if coalesce(auth.role(),'')<>'service_role' and not exists(select 1 from public.profiles where id=auth.uid() and role='Admin' and deleted_at is null) then raise exception 'A rotina salarial exige autorização administrativa.' using errcode='42501'; end if;
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
alter function public.configure_official_salary(text,numeric,integer) owner to postgres;
alter function public.process_official_payroll() owner to postgres;
revoke all on function public.configure_official_salary(text,numeric,integer),public.process_official_payroll() from public,anon;
grant execute on function public.configure_official_salary(text,numeric,integer) to authenticated;
grant execute on function public.process_official_payroll() to authenticated,service_role;
revoke all on function private.payroll_week(timestamptz),private.guard_salary_settings() from public,anon,authenticated;

commit;
