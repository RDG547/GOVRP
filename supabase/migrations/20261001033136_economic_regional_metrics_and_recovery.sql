begin;
create or replace function public.get_regional_economy() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Entre para consultar o território.' using errcode='42501';end if;
 return jsonb_build_object('regions',(
  with company_stats as (
   select b.region_code,count(*) companies from public.businesses b where b.status='active' group by b.region_code
  ), employment as (
   select b.region_code,count(*) jobs,count(distinct e.profile_id) citizens from public.business_employees e join public.businesses b on b.id=e.business_id where e.fired_at is null group by b.region_code
  ), seeking as (
   select b.region_code,count(distinct a.profile_id) people from public.business_applications a join public.business_vacancies v on v.id=a.vacancy_id join public.businesses b on b.id=v.business_id where a.status='pending' and v.status='open' and not exists(select 1 from public.business_employees e where e.profile_id=a.profile_id and e.fired_at is null) group by b.region_code
  ), accounting as (
   select b.region_code,coalesce(sum(t.amount) filter(where t.type='revenue'),0) sales,coalesce(sum(t.amount) filter(where t.type='expense' and t.metadata->>'kind' in('input_consumption','overhead')),0) intermediate from public.business_transactions t join public.businesses b on b.id=t.business_id where t.accounting_date>=current_date-6 and t.accounting_date<=current_date group by b.region_code
  ), housing as (
   select r.code,count(h.id) homes from public.economic_regions r left join public.citizen_residences h on h.state in(r.code,r.name) group by r.code
  )
  select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('companies',coalesce(c.companies,0),'jobs',coalesce(e.jobs,0),'weekly_output',coalesce(a.sales,0),'weekly_gdp',coalesce(a.sales+a.intermediate,0),'registered_jobseekers',coalesce(s.people,0),'registered_workforce',coalesce(e.citizens,0)+coalesce(s.people,0),'registered_unemployment',round(100.0*coalesce(s.people,0)/nullif(coalesce(e.citizens,0)+coalesce(s.people,0),0),1),'housing',h.homes) order by r.name),'[]') from public.economic_regions r left join company_stats c on c.region_code=r.code left join employment e on e.region_code=r.code left join seeking s on s.region_code=r.code left join accounting a on a.region_code=r.code join housing h on h.code=r.code
 ),'projects',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'region_code',region_code,'kind',infrastructure_kind,'status',status,'progress',progress,'budget',approved_budget,'spent',spent_amount,'completion',expected_completion_at,'operational',regional_operational,'maintenance_weekly',maintenance_weekly,'capacity',healthcare_capacity) order by created_at desc),'[]') from public.government_projects where infrastructure_kind is not null));
end $$;
create or replace function public.resume_company_operations(p_business_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare b public.businesses%rowtype;cash numeric;debt numeric;wages numeric;headcount integer;minimum integer;overhead numeric;
begin
 select * into b from public.businesses where id=p_business_id for update;
 if auth.uid() is null or b.owner_id is distinct from auth.uid() then raise exception 'Somente o proprietário pode reestruturar a empresa.' using errcode='42501';end if;
 if b.status<>'active' or not exists(select 1 from public.documents where id=b.cnpj_document_id and is_valid) then raise exception 'Regularize a empresa e seu CNPJ antes de retomar a operação.';end if;
 if b.operational_status not in('closed','insolvent') then raise exception 'Esta empresa não está encerrada nem em insolvência.';end if;
 select coalesce(sum(wage_due),0),coalesce(sum(salary) filter(where fired_at is null),0),count(*) filter(where fired_at is null) into debt,wages,headcount from public.business_employees where business_id=b.id;
 select min_employees,daily_overhead into minimum,overhead from public.business_types where id=b.business_type_id;
 select balance into cash from public.accounts where id=b.bank_account_id for update;
 if debt>0 then raise exception 'Pague os salários devidos antes de retomar a operação.';end if;
 if headcount<minimum then raise exception 'Contrate a equipe mínima de % trabalhadores antes de retomar.',minimum;end if;
 if cash<wages+7*overhead then raise exception 'O caixa precisa cobrir uma semana de salários e custos operacionais.';end if;
 update public.businesses set operational_status='starting',updated_at=now() where id=b.id;
 insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key) values('company_operations_resumed','economy','businesses',b.id,auth.uid(),jsonb_build_object('previous_status',b.operational_status,'cash',cash,'headcount',headcount,'loss_cycles_preserved',b.loss_cycles),'company-resumed:'||gen_random_uuid());
end $$;
revoke all on function public.resume_company_operations(uuid) from public,anon;
grant execute on function public.resume_company_operations(uuid) to authenticated;
-- Publish only an invalidation signal. Employment, applications and balances retain their RLS.
create trigger company_workforce_market_changed after insert or update or delete on public.business_employees for each statement execute function private.broadcast_company_market();
create trigger company_applications_market_changed after insert or update or delete on public.business_applications for each statement execute function private.broadcast_company_market();
create trigger company_finances_market_changed after insert or update or delete on public.business_transactions for each statement execute function private.broadcast_company_market();
notify pgrst,'reload schema';
commit;
