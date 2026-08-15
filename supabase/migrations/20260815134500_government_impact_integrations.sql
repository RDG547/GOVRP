-- Integra fatos mensuráveis do RP à popularidade e aos indicadores históricos.

create or replace function public.manage_government_ministry(p_ministry_id uuid,p_name text,p_acronym text,p_description text,p_responsibilities text[],p_annual_budget numeric,p_is_active boolean)
returns public.government_ministries language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); result public.government_ministries%rowtype; previous public.government_ministries%rowtype; treasury numeric:=0; cost_ratio numeric:=0; impact numeric:=0;
begin
  if public.get_user_role(actor) not in('Presidente','Admin') then raise exception 'Apenas a Presidência pode gerir ministérios.'; end if;
  if length(trim(coalesce(p_name,'')))<4 or p_annual_budget<0 then raise exception 'Dados ministeriais inválidos.'; end if;
  select treasury_balance into treasury from public.government_finances where id=1;
  cost_ratio:=case when treasury>0 then p_annual_budget/treasury else 1 end;
  if p_ministry_id is null then
    insert into public.government_ministries(name,acronym,description,responsibilities,annual_budget,is_active,created_by,efficiency_score)
    values(trim(p_name),upper(nullif(trim(p_acronym),'')),trim(p_description),coalesce(p_responsibilities,'{}'),p_annual_budget,coalesce(p_is_active,true),actor,50) returning * into result;
    impact:=-least(4,greatest(.2,cost_ratio*25));
    perform public.apply_government_impact('administration','ministry_created','Criação de '||result.name||' com custo anual de '||to_char(result.annual_budget,'FM999G999G999G990D00')||'.',impact,0,'government_ministries',result.id::text,jsonb_build_object('annualBudget',result.annual_budget,'treasuryRatio',cost_ratio,'efficiency',result.efficiency_score));
  else
    select * into previous from public.government_ministries where id=p_ministry_id for update;
    if not found then raise exception 'Ministério não encontrado.'; end if;
    update public.government_ministries set name=trim(p_name),acronym=upper(nullif(trim(p_acronym),'')),description=trim(p_description),responsibilities=coalesce(p_responsibilities,'{}'),annual_budget=p_annual_budget,is_active=coalesce(p_is_active,true),updated_at=clock_timestamp() where id=p_ministry_id returning * into result;
    impact:=case when not result.is_active and previous.is_active then .15 when result.annual_budget>previous.annual_budget then -least(2,(result.annual_budget-previous.annual_budget)/greatest(treasury,1)*20) when result.annual_budget<previous.annual_budget then least(1,(previous.annual_budget-result.annual_budget)/greatest(treasury,1)*10) else 0 end;
    if impact<>0 then perform public.apply_government_impact('administration','ministry_restructured','Estrutura ou orçamento de '||result.name||' alterado.',impact,0,'government_ministries',result.id::text,jsonb_build_object('previousBudget',previous.annual_budget,'annualBudget',result.annual_budget,'active',result.is_active)); end if;
  end if;
  return result;
end; $$;

create or replace function public.record_minister_event(p_minister_id uuid,p_event_type text,p_summary text,p_metadata jsonb default '{}'::jsonb)
returns public.ministers language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); reputation_delta numeric; performance_delta numeric; result public.ministers%rowtype;
begin
  if public.get_user_role(actor) not in('Presidente','Admin') then raise exception 'Somente a Presidência pode registrar resultados ministeriais.'; end if;
  if length(trim(coalesce(p_summary,'')))<10 then raise exception 'Descreva o acontecimento.'; end if;
  select x.reputation,x.performance into reputation_delta,performance_delta from (values
    ('policy_success',3::numeric,5::numeric),('policy_failure',-3::numeric,-5::numeric),('administrative_delivery',2::numeric,3::numeric),
    ('scandal',-10::numeric,-5::numeric),('investigation',-5::numeric,-2::numeric),('acquitted',3::numeric,0::numeric),('conviction',-20::numeric,-10::numeric)
  ) as x(kind,reputation,performance) where x.kind=p_event_type;
  if reputation_delta is null then raise exception 'Tipo de acontecimento ministerial inválido.'; end if;
  update public.ministers set reputation_score=least(100,greatest(0,reputation_score+reputation_delta)),performance_score=least(100,greatest(0,performance_score+performance_delta)) where id=p_minister_id and status='active' returning * into result;
  if result.id is null then raise exception 'Ministro ativo não encontrado.'; end if;
  insert into public.minister_history(minister_profile_id,ministry_id,event_type,summary,reputation_delta,performance_delta,actor_id,metadata)
  values(result.user_id,result.ministry_id,p_event_type,trim(p_summary),reputation_delta,performance_delta,actor,coalesce(p_metadata,'{}'));
  perform public.apply_government_impact('politics','minister_'||p_event_type,trim(p_summary),reputation_delta/5,performance_delta/10,'ministers',result.id::text,jsonb_build_object('eventType',p_event_type,'reputationDelta',reputation_delta,'performanceDelta',performance_delta)||coalesce(p_metadata,'{}'));
  return result;
end; $$;
revoke all on function public.record_minister_impact(uuid,text,numeric,numeric,jsonb) from public,anon,authenticated;
grant execute on function public.record_minister_impact(uuid,text,numeric,numeric,jsonb) to service_role;
grant execute on function public.record_minister_event(uuid,text,text,jsonb) to authenticated,service_role;

create or replace function public.record_bill_popularity_impact()
returns trigger language plpgsql security definer set search_path='' as $$
declare impact numeric:=0; event_name text;
begin
  if new.status is not distinct from old.status then return new; end if;
  impact:=case lower(new.status) when 'aprovado' then 1.2 when 'sancionado' then 1.5 when 'promulgado' then 1.5 when 'rejeitado' then -.8 when 'vetado' then -.5 when 'arquivado' then -.2 else 0 end;
  if impact<>0 then
    event_name:='bill_'||regexp_replace(lower(new.status),'[^a-z0-9]+','_','g');
    perform public.apply_government_impact('politics',event_name,'Projeto "'||new.title||'": '||new.status||'.',impact,0,'bills',new.id::text,jsonb_build_object('billType',new.type,'status',new.status));
    insert into public.national_indicator_points(country_code,indicator_code,value,unit,domain,source_type,source_table,source_id,metadata)
    select 'BR','congress_approval',least(100,greatest(0,50+coalesce(sum(applied_delta),0))),'%','politics','player_action','bills',new.id::text,clock_timestamp(),jsonb_build_object('status',new.status)
    from public.government_popularity_events where domain='politics';
  end if;
  return new;
end; $$;
drop trigger if exists bills_popularity_impact on public.bills;
create trigger bills_popularity_impact after update of status on public.bills for each row execute function public.record_bill_popularity_impact();

create or replace function public.record_public_safety_indicators()
returns trigger language plpgsql security definer set search_path='' as $$
declare total_count numeric; resolved_count numeric; resolution_rate numeric; impact numeric:=0;
begin
  select count(*),count(*) filter(where status in('Concluída','Arquivada')) into total_count,resolved_count from public.police_occurrences;
  resolution_rate:=case when total_count=0 then 0 else round(resolved_count*100/total_count,4) end;
  insert into public.national_indicator_points(country_code,indicator_code,value,unit,domain,source_type,source_table,source_id,metadata)
  values('BR','reported_crime_occurrences',total_count,'ocorrências','security','rp_simulation','police_occurrences',new.id::text,clock_timestamp(),jsonb_build_object('status',new.status)),
        ('BR','police_resolution_rate',resolution_rate,'%','security','rp_simulation','police_occurrences',new.id::text||':resolution',clock_timestamp(),jsonb_build_object('resolved',resolved_count,'total',total_count));
  if tg_op='INSERT' and new.priority in('high','urgent') then impact:=case when new.priority='urgent' then -1 else -.4 end;
  elsif tg_op='UPDATE' and new.status is distinct from old.status and new.status='Concluída' then impact:=.7;
  elsif tg_op='UPDATE' and new.status is distinct from old.status and new.status='Arquivada' then impact:=.1; end if;
  if impact<>0 then perform public.apply_government_impact('security','public_safety_update','Atualização da segurança pública: '||new.status||'.',0,impact,'police_occurrences',new.id::text,jsonb_build_object('priority',new.priority,'resolutionRate',resolution_rate)); end if;
  return new;
end; $$;
drop trigger if exists police_occurrences_national_impact on public.police_occurrences;
create trigger police_occurrences_national_impact after insert or update of status on public.police_occurrences for each row execute function public.record_public_safety_indicators();

create or replace function public.record_government_project_impact()
returns trigger language plpgsql security definer set search_path='' as $$
declare impact numeric:=0;
begin
  if new.status is not distinct from old.status then return new; end if;
  impact:=case lower(new.status) when 'completed' then least(4,greatest(.5,coalesce(new.quality_score,50)/30)) when 'cancelled' then -1.5 when 'suspended' then -1 else 0 end;
  if impact<>0 then perform public.apply_government_impact('infrastructure','government_project_'||lower(new.status),'Projeto público "'||new.name||'": '||new.status||'.',impact,0,'government_projects',new.id::text,jsonb_build_object('quality',new.quality_score,'budget',new.approved_budget,'progress',new.progress)); end if;
  return new;
end; $$;
drop trigger if exists government_projects_popularity_impact on public.government_projects;
create trigger government_projects_popularity_impact after update of status on public.government_projects for each row execute function public.record_government_project_impact();
