begin;
alter table public.government_projects add column region_code text references public.economic_regions(code), add column infrastructure_kind text check(infrastructure_kind in('roads','energy','ports','airports','telecom','industry','health')),add column construction_days integer check(construction_days between 1 and 90),add column infrastructure_gain numeric check(infrastructure_gain between 0 and 20),add column maintenance_weekly numeric not null default 0 check(maintenance_weekly>=0),add column maintenance_paid_until timestamptz,add column regional_operational boolean not null default false,add column healthcare_capacity integer not null default 0 check(healthcare_capacity between 0 and 10000);
alter table public.economic_regions add column industry numeric not null default 40 check(industry between 0 and 100),add column infrastructure_baseline jsonb;
update public.economic_regions set infrastructure_baseline=jsonb_build_object('roads',roads,'energy',energy,'ports',ports,'airports',airports,'telecom',telecom,'industry',industry);
create index government_projects_region on public.government_projects(region_code,status);
create table private.infrastructure_maintenance(project_id uuid not null references public.government_projects(id),period_start date not null,amount numeric not null,primary key(project_id,period_start));
revoke all on private.infrastructure_maintenance from public,anon,authenticated;
create or replace function public.propose_regional_infrastructure(p_region_code text,p_kind text,p_name text,p_budget numeric,p_duration_days integer) returns uuid language plpgsql security definer set search_path='' as $$
declare project uuid; region public.economic_regions%rowtype; sector uuid;
begin
 if auth.uid() is null or not public.economic_has_role(array['Admin','Presidente','Ministro','Ministro da Fazenda','Ministro da Economia']) then raise exception 'Seu cargo não permite propor obras públicas.' using errcode='42501';end if;
 select * into region from public.economic_regions where code=p_region_code;
 if region.code is null or p_kind is null or p_kind not in('roads','energy','ports','airports','telecom','industry','health') then raise exception 'Selecione um estado e uma infraestrutura disponíveis.';end if;
 if p_kind='ports' and not region.coastal then raise exception 'Este projeto portuário exige um estado com acesso ao litoral.';end if;
 if p_budget is null or p_budget<10000 or p_budget>50000000 or p_budget<>round(p_budget,2) or p_duration_days is null or p_duration_days not between 1 and 90 or length(trim(p_name)) not between 5 and 140 then raise exception 'Informe um nome de 5 a 140 caracteres, orçamento entre R$ 10 mil e R$ 50 milhões e prazo de 1 a 90 dias reais.';end if;
 select id into sector from public.economic_sectors where is_active order by case when name ilike '%saúde%' and p_kind='health' then 0 when name ilike '%constru%' then 1 else 2 end,code limit 1;
 project:=public.propose_government_project(trim(p_name),'Obra regional de '||region.name||'. Efeitos após conclusão; manutenção semanal de 1% do orçamento.',case when p_kind='health' then 'Saúde' else 'Infraestrutura' end,sector,case when p_kind='health' then 'health' else 'infrastructure' end,p_budget,public.real_date_to_rp_date(now()+make_interval(days=>p_duration_days)),0,0,0);
 update public.government_projects set region_code=p_region_code,infrastructure_kind=p_kind,construction_days=p_duration_days,infrastructure_gain=least(20,p_budget/10000),maintenance_weekly=round(p_budget*.01,2),healthcare_capacity=case when p_kind='health' then least(10000,floor(p_budget/100)) else 0 end where id=project;
 return project;
end $$;
CREATE OR REPLACE FUNCTION public.approve_government_project(p_project_id uuid, p_justification text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare project_row public.government_projects%rowtype;
  treasury numeric;
begin
  if auth.uid() is null or not public.economic_has_role(array['Admin','Presidente']) then
    raise exception 'Aprovação restrita à Presidência ou Administração.' using errcode='42501';
  end if;
  select * into project_row from public.government_projects where id=p_project_id for update;
  if not found or project_row.status not in ('proposed','pending_parliament') then
    raise exception 'Projeto não está disponível para aprovação.';
  end if;
  select treasury_balance into treasury from public.government_finances where id=1 for update;
  if treasury<project_row.approved_budget then
    raise exception 'Tesouro sem recursos para reservar o orçamento.';
  end if;
  update public.government_projects
  set status='funded',reserved_amount=approved_budget,approved_by=auth.uid(),
      approved_at=now(),started_at=now(),expected_completion_at=case when construction_days is not null then now()+make_interval(days=>construction_days) else expected_completion_at end,updated_at=now()
  where id=p_project_id;
  update public.government_finances
  set treasury_balance=treasury_balance-project_row.approved_budget,updated_at=now()
  where id=1;
  perform economy_private.audit('approve_government_project','government_project',p_project_id::text,
    to_jsonb(project_row),to_jsonb((select p from public.government_projects p where p.id=p_project_id)),
    p_justification,auth.uid());
  return jsonb_build_object('project_id',p_project_id,'status','funded',
    'reserved_amount',project_row.approved_budget);
end;
$function$;

CREATE OR REPLACE FUNCTION economy_private.process_project(p_project_id uuid, p_installment numeric DEFAULT NULL::numeric, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare project_row public.government_projects%rowtype;
  installment numeric;
  new_spent numeric;
  new_progress numeric;
  expenditure_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('govrp:economy:project:'||p_project_id::text));
  select * into project_row from public.government_projects where id=p_project_id for update;
  if not found or project_row.status not in ('funded','in_progress','delayed') then
    raise exception 'Projeto não está em execução.';
  end if;
  installment := least(
    coalesce(p_installment,project_row.approved_budget*.1),
    project_row.approved_budget-project_row.spent_amount
  );
  if project_row.infrastructure_kind is not null then
    installment:=least(installment,greatest(0,round(project_row.approved_budget*least(1,greatest(0,extract(epoch from (now()-project_row.started_at))/greatest(1,extract(epoch from (project_row.expected_completion_at-project_row.started_at))))),2)-project_row.spent_amount));
  end if;
  if installment<=0 then
    return jsonb_build_object('project_id',p_project_id,'status',project_row.status,'progress',project_row.progress);
  end if;
  new_spent:=project_row.spent_amount+installment;
  new_progress:=least(100,new_spent/project_row.approved_budget*100);
  insert into public.government_expenditures(
    expenditure_type,ministry,project_id,source_table,source_id,sector_id,
    amount,productive_share,occurred_at_rp,metadata
  )
  values (
    'government_project',project_row.ministry,p_project_id,'government_projects',
    p_project_id::text||':'||to_char(new_spent,'FM999999999999990D00'),
    project_row.sector_id,installment,1,public.rp_now(),
    jsonb_build_object('quality_score',project_row.quality_score,'progress',new_progress)
  )
  returning id into expenditure_id;
  if project_row.infrastructure_kind is not null then
    update public.accounts set balance=balance+installment,updated_at=now() where account_kind='population';
  end if;
  update public.government_projects
  set spent_amount=new_spent,progress=new_progress,
      status=case when new_progress>=100 then 'completed' else 'in_progress' end,
      completed_at=case when new_progress>=100 then now() else completed_at end,
      regional_operational=case when new_progress>=100 and infrastructure_kind is not null then true else regional_operational end,
      maintenance_paid_until=case when new_progress>=100 and infrastructure_kind is not null then now()+interval '7 days' else maintenance_paid_until end,
      updated_at=now()
  where id=p_project_id;
  return jsonb_build_object('project_id',p_project_id,'installment',installment,
    'spent_amount',new_spent,'progress',new_progress,'expenditure_id',expenditure_id);
end;
$function$;


create or replace function private.refresh_regional_infrastructure() returns void language plpgsql security definer set search_path='' as $$
begin
 update public.economic_regions r set roads=least(100,(r.infrastructure_baseline->>'roads')::numeric+coalesce(p.roads,0)),energy=least(100,(r.infrastructure_baseline->>'energy')::numeric+coalesce(p.energy,0)),ports=least(100,(r.infrastructure_baseline->>'ports')::numeric+coalesce(p.ports,0)),airports=least(100,(r.infrastructure_baseline->>'airports')::numeric+coalesce(p.airports,0)),telecom=least(100,(r.infrastructure_baseline->>'telecom')::numeric+coalesce(p.telecom,0)),industry=least(100,(r.infrastructure_baseline->>'industry')::numeric+coalesce(p.industry,0)),updated_at=now()
 from (select x.code,sum(g.infrastructure_gain) filter(where g.infrastructure_kind='roads') roads,sum(g.infrastructure_gain) filter(where g.infrastructure_kind='energy') energy,sum(g.infrastructure_gain) filter(where g.infrastructure_kind='ports') ports,sum(g.infrastructure_gain) filter(where g.infrastructure_kind='airports') airports,sum(g.infrastructure_gain) filter(where g.infrastructure_kind='telecom') telecom,sum(g.infrastructure_gain) filter(where g.infrastructure_kind='industry') industry from public.economic_regions x left join public.government_projects g on g.region_code=x.code and g.status='completed' and g.regional_operational group by x.code) p where r.code=p.code;
end $$;
create or replace function private.process_regional_infrastructure() returns void language plpgsql security definer set search_path='' as $$
declare p public.government_projects%rowtype; treasury numeric; period date;
begin
 perform pg_advisory_xact_lock(hashtext('govrp:regional-infrastructure'));
 for p in select * from public.government_projects where infrastructure_kind is not null and status in('funded','in_progress','delayed') order by id loop perform economy_private.process_project(p.id,null,null);end loop;
 for p in select * from public.government_projects where infrastructure_kind is not null and status='completed' and coalesce(maintenance_paid_until,now())<=now() order by id for update loop
  period:=current_date; select treasury_balance into treasury from public.government_finances where id=1 for update;
  if treasury>=p.maintenance_weekly then
   insert into private.infrastructure_maintenance(project_id,period_start,amount) values(p.id,period,p.maintenance_weekly) on conflict do nothing;
   if found then
    update public.government_finances set treasury_balance=treasury_balance-p.maintenance_weekly,updated_at=now() where id=1;
    update public.accounts set balance=balance+p.maintenance_weekly,updated_at=now() where account_kind='population';
    insert into public.government_expenditures(expenditure_type,ministry,project_id,source_table,source_id,sector_id,amount,productive_share,occurred_at_rp,metadata) values('infrastructure',p.ministry,p.id,'government_projects',p.id||':'||period,p.sector_id,p.maintenance_weekly,1,public.rp_now(),jsonb_build_object('region_code',p.region_code));
    update public.government_projects set regional_operational=true,maintenance_paid_until=now()+interval '7 days',updated_at=now() where id=p.id;
   end if;
  else update public.government_projects set regional_operational=false,updated_at=now() where id=p.id and regional_operational;end if;
 end loop;
 perform private.refresh_regional_infrastructure();
end $$;
create or replace function private.regional_project_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.infrastructure_kind is not null and (new.status is distinct from old.status or new.regional_operational is distinct from old.regional_operational) then
  perform private.refresh_regional_infrastructure();
  if new.status='completed' and old.status<>'completed' then insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key) values('regional_infrastructure_completed','economy','government_projects',new.id,new.approved_by,jsonb_build_object('name',new.name,'region_code',new.region_code,'kind',new.infrastructure_kind,'gain',new.infrastructure_gain),'regional-completion:'||new.id);end if;
 end if;return new;
end $$;
create trigger regional_project_effects after update on public.government_projects for each row execute function private.regional_project_changed();
create or replace function public.get_regional_economy() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Entre para consultar o território.' using errcode='42501';end if;
 return jsonb_build_object('regions',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('companies',(select count(*) from public.businesses b where b.region_code=r.code and b.status='active'),'jobs',(select count(*) from public.business_employees e join public.businesses b on b.id=e.business_id where b.region_code=r.code and e.fired_at is null),'weekly_output',(select coalesce(sum(t.amount),0) from public.business_transactions t join public.businesses b on b.id=t.business_id where b.region_code=r.code and t.type='revenue' and t.accounting_date>=current_date-6),'housing',(select count(*) from public.citizen_residences h where h.state in(r.code,r.name))) order by r.name),'[]') from public.economic_regions r),'projects',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'region_code',region_code,'kind',infrastructure_kind,'status',status,'progress',progress,'budget',approved_budget,'spent',spent_amount,'completion',expected_completion_at,'operational',regional_operational,'maintenance_weekly',maintenance_weekly,'capacity',healthcare_capacity) order by created_at desc),'[]') from public.government_projects where infrastructure_kind is not null));
end $$;
create or replace function public.get_company_rankings() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Entre para consultar o ranking.' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(to_jsonb(r)),'[]') from(select b.id,b.name,b.region_code,b.control_kind,b.market_value,b.size_class,b.logo_url,b.brand_color,t.name as sector,coalesce(fin.revenue,0) revenue,coalesce(fin.profit,0) profit,(select count(*) from public.business_employees e where e.business_id=b.id and e.fired_at is null) jobs,(select coalesce(sum(produced_quantity),0) from public.business_daily_operations d where d.business_id=b.id and d.operation_date>=current_date-6) production from public.businesses b join public.business_types t on t.id=b.business_type_id left join lateral(select sum(amount) filter(where type='revenue') revenue,sum(amount) filter(where type in('revenue','expense','tax')) profit from public.business_transactions where business_id=b.id and accounting_date>=current_date-6) fin on true where b.status='active' order by b.market_value desc,b.id limit 500) r);
end $$;
insert into public.system_settings(key,value) values('national_health_policy','{"daily_budget":5000,"cost_per_visit":25,"recovery":20,"daily_capacity":200}') on conflict(key) do nothing;
create table public.healthcare_visits(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id),project_id uuid references public.government_projects(id),region_code text not null references public.economic_regions(code),idempotency_key uuid not null unique,health_before numeric not null,health_after numeric not null,cost numeric not null,created_at timestamptz not null default now());
create index healthcare_visit_daily on public.healthcare_visits(created_at,user_id);
alter table public.healthcare_visits enable row level security;
create policy healthcare_visits_own on public.healthcare_visits for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.healthcare_visits from anon,authenticated;grant select on public.healthcare_visits to authenticated;
create or replace function public.configure_national_health(p_daily_budget numeric,p_daily_capacity integer,p_recovery numeric) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.economic_has_role(array['Admin','Presidente','Ministro da Saúde']) then raise exception 'Seu cargo não permite alterar a política de saúde.' using errcode='42501';end if;
 if p_daily_budget is null or p_daily_budget<0 or p_daily_budget>10000000 or p_daily_capacity is null or p_daily_capacity not between 0 and 100000 or p_recovery is null or p_recovery not between 5 and 50 then raise exception 'Informe orçamento, capacidade e recuperação dentro dos limites do serviço.';end if;
 update public.system_settings set value=jsonb_build_object('daily_budget',round(p_daily_budget,2),'daily_capacity',p_daily_capacity,'cost_per_visit',round(p_recovery*1.25,2),'recovery',p_recovery) where key='national_health_policy';
 insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload) values('health_policy_changed','government','system_settings',null,auth.uid(),jsonb_build_object('daily_budget',p_daily_budget,'daily_capacity',p_daily_capacity,'recovery',p_recovery));
end $$;
create or replace function public.get_national_health() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Entre para acessar o SNS.' using errcode='42501';end if;
 return jsonb_build_object('policy',(select value from public.system_settings where key='national_health_policy'),'attended_today',(select count(*) from public.healthcare_visits where created_at>=current_date),'spent_today',(select coalesce(sum(cost),0) from public.healthcare_visits where created_at>=current_date),'units',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'region_code',region_code,'status',status,'capacity',healthcare_capacity,'operational',regional_operational,'progress',progress,'quality',quality_score)),'[]') from public.government_projects where infrastructure_kind='health'),'visits',(select coalesce(jsonb_agg(to_jsonb(v) order by created_at desc),'[]') from(select * from public.healthcare_visits where user_id=auth.uid() order by created_at desc limit 20)v),'can_manage',public.economic_has_role(array['Admin','Presidente','Ministro da Saúde']));
end $$;
create or replace function public.request_healthcare(p_region_code text,p_project_id uuid,p_idempotency_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare policy jsonb; visit public.healthcare_visits%rowtype; unit public.government_projects%rowtype; state public.citizen_needs%rowtype; cost numeric; treasury numeric; capacity integer; current_count integer;
begin
 if auth.uid() is null then raise exception 'Entre para solicitar atendimento.' using errcode='42501';end if;
 if p_idempotency_key is null or not exists(select 1 from public.economic_regions where code=p_region_code) then raise exception 'Selecione o estado para o atendimento.';end if;
 perform pg_advisory_xact_lock(hashtext('govrp:sns:daily'));
 select * into visit from public.healthcare_visits where idempotency_key=p_idempotency_key;
 if found then if visit.user_id<>auth.uid() or visit.region_code<>p_region_code or visit.project_id is distinct from p_project_id then raise exception 'Esta identificação pertence a outro atendimento.';end if;return to_jsonb(visit);end if;
 perform public.get_citizen_needs();select * into state from public.citizen_needs where user_id=auth.uid() for update;
 if state.health>=100 then raise exception 'Sua saúde já está recuperada.';end if;
 if exists(select 1 from public.healthcare_visits where user_id=auth.uid() and created_at>now()-interval '4 hours') then raise exception 'Aguarde quatro horas entre atendimentos do SNS.';end if;
 select value into policy from public.system_settings where key='national_health_policy';cost:=(policy->>'cost_per_visit')::numeric;
 if p_project_id is not null then
  select * into unit from public.government_projects where id=p_project_id and region_code=p_region_code and infrastructure_kind='health' and status='completed' and regional_operational;
  if not found then raise exception 'Esta unidade ainda não está disponível para atendimento.';end if;capacity:=unit.healthcare_capacity;
 else capacity:=(policy->>'daily_capacity')::integer;end if;
 select count(*) into current_count from public.healthcare_visits where project_id is not distinct from p_project_id and created_at>=current_date;
 if current_count>=capacity then raise exception 'A capacidade de atendimento de hoje foi preenchida. Procure outra unidade ou retorne amanhã.';end if;
 if (select coalesce(sum(v.cost),0) from public.healthcare_visits v where created_at>=current_date)+cost>(policy->>'daily_budget')::numeric then raise exception 'O orçamento diário do SNS foi utilizado. O governo precisa reforçar a dotação.';end if;
 select treasury_balance into treasury from public.government_finances where id=1 for update;
 if treasury<cost then raise exception 'O SNS aguarda recursos do Tesouro para novos atendimentos.';end if;
 update public.government_finances set treasury_balance=treasury_balance-cost,updated_at=now() where id=1;
 update public.accounts set balance=balance+cost,updated_at=now() where account_kind='population';
 insert into public.healthcare_visits(user_id,project_id,region_code,idempotency_key,health_before,health_after,cost) values(auth.uid(),p_project_id,p_region_code,p_idempotency_key,state.health,least(100,state.health+(policy->>'recovery')::numeric),cost) returning * into visit;
 update public.citizen_needs set health=visit.health_after,updated_at=now() where user_id=auth.uid();
 insert into public.government_expenditures(expenditure_type,ministry,source_table,source_id,amount,productive_share,occurred_at_rp,metadata) values('health','Saúde','healthcare_visits',visit.id::text,cost,1,public.rp_now(),jsonb_build_object('region_code',p_region_code));
 insert into public.notifications(user_id,type,content,link,metadata) values(auth.uid(),'healthcare','Seu atendimento no SNS foi concluído. Sua saúde foi atualizada.','/services/health',jsonb_build_object('visit_id',visit.id));
 return to_jsonb(visit);
end $$;
revoke all on function private.refresh_regional_infrastructure(),private.process_regional_infrastructure(),private.regional_project_changed() from public,anon,authenticated;
revoke all on function public.propose_regional_infrastructure(text,text,text,numeric,integer),public.get_regional_economy(),public.get_company_rankings(),public.configure_national_health(numeric,integer,numeric),public.get_national_health(),public.request_healthcare(text,uuid,uuid) from public,anon;
grant execute on function public.propose_regional_infrastructure(text,text,text,numeric,integer),public.get_regional_economy(),public.get_company_rankings(),public.configure_national_health(numeric,integer,numeric),public.get_national_health(),public.request_healthcare(text,uuid,uuid) to authenticated;
alter publication supabase_realtime add table public.healthcare_visits;
CREATE OR REPLACE FUNCTION economy_private.run_operational_engine()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  run_id uuid;
  rp_at timestamptz:=public.rp_now();
  offset_month integer;
  period_row public.economic_periods%rowtype;
  activity_result jsonb;
  status_result jsonb;
  price_result jsonb;
  currency_result jsonb;
  closed_months integer:=0;
  closed_quarters integer:=0;
  closed_years integer:=0;
  result jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('govrp:economy:operational'));
  insert into public.economic_engine_runs(run_type,engine_version,status)
  values ('operational','1.0.0','running')
  returning id into run_id;

  for offset_month in 0..3 loop
    perform economy_private.ensure_periods(rp_at-(offset_month||' months')::interval);
  end loop;

  perform private.process_regional_infrastructure();
  perform private.run_company_economy();
  perform private.process_residence_leases();
  status_result:=economy_private.refresh_policy_and_shock_statuses();
  activity_result:=economy_private.update_activity_mix();
  currency_result:=public.recalculate_currency_market('BR','operational:'||to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD-HH24'),true);
  price_result:=economy_private.process_operational_prices(run_id);

  for period_row in
    select * from public.economic_periods
    where period_type='month' and status in ('open','failed') and ends_at<=now()
    order by ends_at
  loop
    perform economy_private.close_month(period_row.id,true,null);
    closed_months:=closed_months+1;
  end loop;

  for period_row in
    select * from public.economic_periods
    where period_type='quarter' and status in ('open','failed') and ends_at<=now()
    order by ends_at
  loop
    perform economy_private.close_quarter(period_row.id,true,null);
    closed_quarters:=closed_quarters+1;
  end loop;

  for period_row in
    select * from public.economic_periods
    where period_type='year' and status in ('open','failed') and ends_at<=now()
    order by ends_at
  loop
    perform economy_private.close_year(period_row.id,true,null);
    closed_years:=closed_years+1;
  end loop;

  update public.economic_state
  set last_operational_run_at=now(),updated_at=now()
  where id=true;

  result:=jsonb_build_object(
    'run_id',run_id,'rp_at',rp_at,'activity',activity_result,
    'statuses',status_result,'prices',price_result,'currency',currency_result,
    'closed_months',closed_months,
    'closed_quarters',closed_quarters,
    'closed_years',closed_years
  );
  update public.economic_engine_runs
  set status='completed',finished_at=now(),results=result,
      output_hash=encode(extensions.digest(result::text,'sha256'),'hex')
  where id=run_id;
  return result;
exception
  when others then
    if run_id is not null then
      update public.economic_engine_runs
      set status='failed',finished_at=now(),
          errors=jsonb_build_array(jsonb_build_object('sqlstate',sqlstate,'message',sqlerrm))
      where id=run_id;
    end if;
    raise;
end;
$function$;


notify pgrst,'reload schema';
commit;
