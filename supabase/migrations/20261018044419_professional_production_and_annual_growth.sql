begin;
alter table public.professional_work_sessions add column production_snapshot jsonb;
insert into public.system_settings(key,value,description) values('company_activity_rules','{"production_seconds":300,"manual_capacity_fraction":0.2,"growth_stable_margin":3}','Produção manual usa receitas e estoque existentes. Comparação empresarial por sete dias reais.') on conflict do nothing;

CREATE OR REPLACE FUNCTION private.professional_activity_catalog(p_family text)
 RETURNS TABLE(activity_key text, title text, description text, execution_mode text, duration_seconds integer)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  with families(family,routine,description,routine_seconds,focus,focus_seconds) as(values
    ('technology','Revisar solicitações','Organizar as solicitações e prioridades da equipe de tecnologia.',45,'Validar uma entrega',60),
    ('food','Preparar a estação','Organizar utensílios e ingredientes para o próximo serviço.',40,'Conferir pedidos',60),
    ('transport','Inspecionar o veículo','Conferir as condições operacionais antes da próxima rota.',45,'Planejar o trajeto',75),
    ('quality','Preparar a inspeção','Separar as amostras e organizar os instrumentos de medição.',35,'Avaliar um lote',60),
    ('sales','Organizar atendimento','Revisar o catálogo e preparar o atendimento aos clientes.',30,'Negociar uma oferta',60),
    ('logistics','Organizar o estoque','Conferir os setores do estoque e preparar a reposição.',45,'Planejar reposição',75),
    ('health','Preparar atendimento','Organizar as fichas e os recursos para o atendimento no RP.',40,'Priorizar atendimentos',60),
    ('finance','Conferir registros','Organizar lançamentos e documentos da rotina financeira.',45,'Analisar propostas',75)
  ) select task.* from families f cross join lateral(values
    ('routine',f.routine,f.description,'timed',f.routine_seconds),
    ('challenge','Desafio da função','Resolva uma tarefa da sua área e confira a resposta antes de entregar.','interactive',10),
    ('focus',f.focus,'Execute a tarefa e confira o resultado ao final do período de trabalho.','hybrid',f.focus_seconds),
    ('production','Executar lote de produção','Consome os insumos reais da receita, utiliza capacidade da empresa e entrega produtos ao estoque.','timed',300),
    ('planning','Planejamento e controle','Organize prioridades, confira recursos e valide a estratégia da sua área.','hybrid',90)
  ) task(activity_key,title,description,execution_mode,duration_seconds) where f.family=p_family;
$function$
;
alter function public.start_professional_activity(uuid,text) set schema private;
alter function private.start_professional_activity(uuid,text) rename to start_professional_activity_core;
revoke all on function private.start_professional_activity_core(uuid,text) from public,anon,authenticated;
alter function public.finish_professional_activity(uuid,jsonb) set schema private;
alter function private.finish_professional_activity(uuid,jsonb) rename to finish_professional_activity_core;
revoke all on function private.finish_professional_activity_core(uuid,jsonb) from public,anon,authenticated;
create function public.start_professional_activity(p_business_id uuid,p_activity_key text default 'challenge') returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.businesses%rowtype;kind public.business_types%rowtype;recipe public.business_recipes%rowtype;region public.economic_regions%rowtype;s public.professional_work_sessions%rowtype;previous public.professional_work_sessions%rowtype;item record;units numeric;daily_cap numeric;reserved numeric;available numeric;unit_cost numeric;cost numeric:=0;overhead numeric;cash numeric;population uuid;cfg jsonb;level integer;resources jsonb:='{}';result jsonb;
begin
 if auth.uid() is null then raise exception 'Entre para trabalhar.' using errcode='42501';end if;
 perform id from public.profiles where id=auth.uid() for update;
 select * into b from public.businesses where id=p_business_id for update;
 -- Expired jobs return unprocessed materials, once. Paid operational costs remain historical.
 for previous in select * from public.professional_work_sessions where user_id=auth.uid() and expires_at<=clock_timestamp() and production_snapshot is not null and completed_at is null and production_snapshot->>'refunded' is distinct from 'true' for update loop
  for item in select key,value from jsonb_each(previous.production_snapshot->'inputs') loop
   insert into public.business_inventory(business_id,resource_code,quantity,unit_cost) values(previous.business_id,item.key,(item.value->>'quantity')::numeric,(item.value->>'unit_cost')::numeric)
   on conflict(business_id,resource_code) do update set unit_cost=(public.business_inventory.quantity*public.business_inventory.unit_cost+excluded.quantity*excluded.unit_cost)/nullif(public.business_inventory.quantity+excluded.quantity,0),quantity=public.business_inventory.quantity+excluded.quantity,updated_at=clock_timestamp();
  end loop;
  update public.professional_work_sessions set status='expired',production_snapshot=production_snapshot||'{"refunded":true}' where id=previous.id;
 end loop;
 result:=private.start_professional_activity_core(p_business_id,p_activity_key);
 select * into s from public.professional_work_sessions where id=(result->>'id')::uuid for update;
 if s.activity_key<>'production' or s.production_snapshot is not null then return result;end if;
 select value into cfg from public.system_settings where key='company_activity_rules';
 select * into kind from public.business_types where id=b.business_type_id;
 select * into recipe from public.business_recipes where business_type_id=b.business_type_id order by id limit 1;
 select * into region from public.economic_regions where code=b.region_code;
 if recipe.id is null or b.operational_status in ('closed','insolvent') then raise exception 'A empresa precisa estar operacional e possuir uma receita de produção.';end if;
 select coalesce(qualification_level,1) into level from public.business_employees where id=s.employee_id;
 daily_cap:=greatest(.001,kind.base_daily_capacity*(cfg->>'manual_capacity_fraction')::numeric*(.7+coalesce(region.energy,0)/500+coalesce(region.industry,0)/1000));
 select coalesce(sum((production_snapshot->>'units')::numeric),0) into reserved from public.professional_work_sessions where business_id=b.id and production_snapshot is not null and production_snapshot->>'refunded' is distinct from 'true' and started_at>=date_trunc('day',clock_timestamp() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
 units:=trunc(least(daily_cap-reserved,daily_cap/5*(1+least(.3,greatest(0,coalesce(level,1)-1)*.02))*least(1.25,greatest(.75,b.productivity_index/100))),3);
 if units<=0 then raise exception 'A capacidade diária de produção manual desta empresa foi utilizada.';end if;
 for item in select key,value::numeric required from jsonb_each_text(recipe.inputs) order by key loop
  select i.quantity,i.unit_cost into available,unit_cost from public.business_inventory i where i.business_id=b.id and i.resource_code=item.key for update;
  if coalesce(available,0)<units*item.required then raise exception 'Insumos insuficientes: adquira os recursos da receita antes de iniciar o lote.';end if;
  resources:=resources||jsonb_build_object(item.key,jsonb_build_object('quantity',units*item.required,'unit_cost',unit_cost));
  cost:=cost+units*item.required*unit_cost;
  update public.business_inventory set quantity=quantity-units*item.required,updated_at=clock_timestamp() where business_id=b.id and resource_code=item.key;
 end loop;
 overhead:=greatest(.01,round(kind.daily_overhead*units/greatest(kind.base_daily_capacity,1),2));
 select id into population from public.accounts where account_kind='population';
 perform id from public.accounts where id in (b.bank_account_id,population) order by id for update;
 select balance into cash from public.accounts where id=b.bank_account_id;
 if cash is null or cash<overhead or population is null then raise exception 'O caixa empresarial não cobre energia e custos operacionais deste lote.';end if;
 update public.accounts set balance=balance-overhead,updated_at=clock_timestamp() where id=b.bank_account_id;
 update public.accounts set balance=balance+overhead,updated_at=clock_timestamp() where id=population;
 insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key) values(b.bank_account_id,population,overhead,'company_operating_cost','Energia e operação de lote profissional',jsonb_build_object('business_id',b.id,'session_id',s.id),md5('professional-overhead:'||s.id)::uuid);
 insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key) values(b.id,'expense',-overhead,'Energia e operação de lote profissional',jsonb_build_object('session_id',s.id),'professional-overhead:'||s.id);
 update public.professional_work_sessions set duration_seconds=(cfg->>'production_seconds')::int,production_snapshot=jsonb_build_object('recipe_id',recipe.id,'output_resource',recipe.output_resource,'units',units,'output_quantity',round(units*recipe.output_quantity,3),'inputs',resources,'input_cost',cost,'overhead',overhead,'refunded',false) where id=s.id returning * into s;
 return to_jsonb(s)||jsonb_build_object('server_now',clock_timestamp());
end $$;

create function public.finish_professional_activity(p_session_id uuid,p_answer jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.professional_work_sessions%rowtype;b public.businesses%rowtype;result jsonb;produced numeric;cost numeric;price numeric;cfg jsonb;xp_before integer;adjusted integer;
begin
 if auth.uid() is null then raise exception 'Entre para concluir a atividade.' using errcode='42501';end if;
 perform id from public.profiles where id=auth.uid() for update;
 select * into s from public.professional_work_sessions where id=p_session_id and user_id=auth.uid() for update;
 if s.id is null then raise exception 'Atividade indisponível.';end if;
 if s.status='completed' then return to_jsonb(s);end if;
 perform id from public.businesses where id=s.business_id for update;
 result:=private.finish_professional_activity_core(p_session_id,p_answer);
 if s.production_snapshot is not null then
  produced:=trunc((s.production_snapshot->>'output_quantity')::numeric*greatest(.5,(result->>'score')::numeric/100),3);
  cost:=(s.production_snapshot->>'input_cost')::numeric+(s.production_snapshot->>'overhead')::numeric;
  select base_price into price from public.economic_resources where code=s.production_snapshot->>'output_resource';
  insert into public.business_inventory(business_id,resource_code,quantity,unit_cost,selling_price,available_for_sale) values(s.business_id,s.production_snapshot->>'output_resource',produced,cost/nullif(produced,0),price,true)
  on conflict(business_id,resource_code) do update set unit_cost=(public.business_inventory.quantity*public.business_inventory.unit_cost+cost)/nullif(public.business_inventory.quantity+produced,0),quantity=public.business_inventory.quantity+produced,updated_at=clock_timestamp();
  if (s.production_snapshot->>'input_cost')::numeric>0 then insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key) values(s.business_id,'expense',-(s.production_snapshot->>'input_cost')::numeric,'Insumos consumidos no lote profissional',jsonb_build_object('session_id',s.id,'kind','input_consumption'),'professional-inputs:'||s.id);end if;
  update public.professional_work_sessions set production_snapshot=production_snapshot||jsonb_build_object('produced',produced,'collected_at',clock_timestamp()) where id=s.id;
 end if;
 if exists(select 1 from public.citizen_needs where user_id=auth.uid() and rp_depression_since is not null) then
  select value into cfg from public.system_settings where key='citizen_happiness';xp_before:=(result->>'experience_earned')::int;adjusted:=floor(xp_before*(cfg->>'productivity_factor')::numeric);
  update public.professional_work_sessions set experience_earned=adjusted where id=s.id;
  update public.citizen_professional_experience set experience=greatest(0,experience-(xp_before-adjusted)) where profile_id=auth.uid() and skill_area=s.skill_area;
  update public.business_employees set experience=e.experience,qualification_level=least(20,1+e.experience/100) from public.citizen_professional_experience e where public.business_employees.id=s.employee_id and e.profile_id=auth.uid() and e.skill_area=s.skill_area;
 end if;
 select to_jsonb(t) into result from public.professional_work_sessions t where id=s.id;
 return result;
end $$;
revoke all on function public.start_professional_activity(uuid,text),public.finish_professional_activity(uuid,jsonb) from public,anon;
grant execute on function public.start_professional_activity(uuid,text),public.finish_professional_activity(uuid,jsonb) to authenticated;

create function private.capture_business_growth() returns trigger language plpgsql security definer set search_path='' as $$
declare previous public.business_balance_cycles%rowtype;b public.businesses%rowtype;production numeric;headcount integer;score numeric;margin numeric;metrics jsonb;comparison jsonb;
begin
 if new.business_id is null then return new;end if;
 select * into b from public.businesses where id=new.business_id;
 select count(*) into headcount from public.business_employees where business_id=b.id and fired_at is null;
 select coalesce(sum(produced_quantity),0) into production from public.business_daily_operations where business_id=b.id and operation_date>=new.cycle_start_at::date and operation_date<(new.cycle_start_at+interval '7 days')::date;
 production:=production+coalesce((select sum((production_snapshot->>'produced')::numeric) from public.professional_work_sessions where business_id=b.id and status='completed' and completed_at>=new.cycle_start_at and completed_at<new.cycle_start_at+interval '7 days'),0);
 metrics:=jsonb_build_object('revenue',new.gross_revenue,'profit',new.net_result,'valuation',new.metadata->'market_value','production',production,'employees',headcount,'assets',coalesce((new.metadata->>'cash_balance')::numeric,0)+coalesce((new.metadata->>'inventory_value')::numeric,0),'debt',coalesce((new.metadata->>'wage_due')::numeric,0),'work_in_progress',(select coalesce(sum((production_snapshot->>'input_cost')::numeric),0) from public.professional_work_sessions where business_id=b.id and status='active' and production_snapshot is not null));
 select * into previous from public.business_balance_cycles where business_id=b.id and cycle_start_at<new.cycle_start_at order by cycle_start_at desc limit 1;
 if previous.id is null then comparison:=jsonb_build_object('status','first_period','label','Primeiro período — sem comparação anterior','score_percent',null);
 else
  score:=round(100*(.4*(new.gross_revenue-previous.gross_revenue)/greatest(abs(previous.gross_revenue),1)+.4*(new.net_result-previous.net_result)/greatest(abs(previous.gross_revenue),abs(previous.net_result),1)+.1*(production-coalesce((previous.metadata->'metrics'->>'production')::numeric,production))/greatest(coalesce((previous.metadata->'metrics'->>'production')::numeric,production),1)+.1*(headcount-coalesce((previous.metadata->'metrics'->>'employees')::numeric,headcount))/greatest(coalesce((previous.metadata->'metrics'->>'employees')::numeric,headcount),1)),2);
  select coalesce((value->>'growth_stable_margin')::numeric,3) into margin from public.system_settings where key='company_activity_rules';
  comparison:=jsonb_build_object('previous_cycle_id',previous.id,'previous_metrics',previous.metadata->'metrics','score_percent',score,'stable_margin',margin,'status',case when score>margin then 'growth' when score< -margin then 'retraction' else 'stable' end,'label',case when score>margin then 'Crescimento' when score< -margin then 'Retração' else 'Estabilidade' end,'method','40% receita + 40% resultado operacional + 10% produção + 10% equipe; aportes e empréstimos não são receita');
 end if;
 new.metadata:=new.metadata||jsonb_build_object('metrics',metrics,'growth',comparison,'period_real_days',7);
 return new;
end $$;
create trigger capture_business_growth before insert on public.business_balance_cycles for each row execute function private.capture_business_growth();
revoke all on function private.capture_business_growth() from public,anon,authenticated;

commit;
