
-- Prospective player workforce sustainability. Existing wages, balances and history remain intact.
CREATE OR REPLACE FUNCTION private.player_workforce_efficiency(p_staff numeric,p_min integer,p_skill numeric,p_region numeric,p_boost numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path='' AS $f$
 SELECT greatest(0,least(10, (CASE WHEN greatest(0,p_staff)/greatest(1,p_min)<=1 THEN greatest(0,p_staff)/greatest(1,p_min)
 ELSE least(3,1+(greatest(0,p_staff)/greatest(1,p_min)-1)*.5) END)
 *greatest(.7,least(1.82,coalesce(p_skill,0)))*greatest(0,coalesce(p_region,0))*(1+greatest(0,coalesce(p_boost,0)))))
$f$;
REVOKE ALL ON FUNCTION private.player_workforce_efficiency(numeric,integer,numeric,numeric,numeric) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.player_company_financial_diagnostic(p_business uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $f$
DECLARE b public.businesses%rowtype; t public.business_types%rowtype; r public.economic_regions%rowtype; recipe public.business_recipes%rowtype;
 cash numeric; debt numeric; weekly numeric; staff_count integer; qualified numeric; overhead numeric; required numeric; revenue numeric; expenses numeric; days integer; capacity numeric; sales numeric; stock numeric; d date:=(statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
 missing jsonb; warnings jsonb:='[]'::jsonb;
BEGIN
 SELECT * INTO b FROM public.businesses WHERE id=p_business AND control_kind='player';
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO t FROM public.business_types WHERE id=b.business_type_id;
 SELECT * INTO r FROM public.economic_regions WHERE code=b.region_code;
 SELECT * INTO recipe FROM public.business_recipes WHERE business_type_id=t.id ORDER BY id LIMIT 1;
 SELECT coalesce(balance,0) INTO cash FROM public.accounts WHERE id=b.bank_account_id;
 SELECT count(*) FILTER(WHERE fired_at IS NULL),coalesce(sum(salary) FILTER(WHERE fired_at IS NULL),0),coalesce(sum(wage_due+CASE WHEN fired_at IS NULL THEN round(salary/7*greatest(0,d-coalesce(last_accrued_on,hired_at::date)),2) ELSE 0 END),0),
 coalesce(avg((1+least(.40,greatest(0,qualification_level-1)*.025))*(.7+satisfaction*.006)) FILTER(WHERE fired_at IS NULL),0)
 INTO staff_count,weekly,debt,qualified FROM public.business_employees WHERE business_id=b.id;
 overhead:=round(coalesce(t.daily_overhead,0)*(1.25-(coalesce(r.energy,0)+coalesce(r.roads,0))/400)*.7,2)*7;
 required:=debt+weekly+overhead;
 SELECT count(*) INTO days FROM public.business_daily_operations WHERE business_id=b.id AND operation_date>=d-7 AND operation_date<d;
 SELECT coalesce(sum(amount) FILTER(WHERE type='revenue'),0),-coalesce(sum(amount) FILTER(WHERE type IN('expense','monthly_cost','tax')),0) INTO revenue,expenses
 FROM public.business_transactions WHERE business_id=b.id AND accounting_date>=d-7 AND accounting_date<d;
 capacity:=round(coalesce(t.base_daily_capacity,0)*private.player_workforce_efficiency(staff_count+CASE WHEN b.owner_operates THEN .25 ELSE 0 END,t.min_employees,qualified,
 (.65+(coalesce(r.roads,0)+coalesce(r.energy,0)+coalesce(r.telecom,0)+coalesce(r.industry,0)+coalesce(r.ports,0)+coalesce(r.airports,0))/2000),0)*coalesce(recipe.output_quantity,0),3);
 sales:=private.company_observed_sales(b.id,recipe.output_resource,d)/greatest(1,least(7,d-b.created_at::date));
 SELECT coalesce(quantity,0) INTO stock FROM public.business_inventory WHERE business_id=b.id AND resource_code=recipe.output_resource;
 SELECT coalesce(jsonb_agg(jsonb_build_object('resource_code',i.key,'needed_at_capacity',round(capacity/greatest(coalesce(recipe.output_quantity,1),.001)*i.value::numeric,3),'stock',coalesce(inv.quantity,0)) ORDER BY i.key),'[]') INTO missing
 FROM jsonb_each_text(coalesce(recipe.inputs,'{}')) i LEFT JOIN public.business_inventory inv ON inv.business_id=b.id AND inv.resource_code=i.key
 WHERE coalesce(inv.quantity,0)<capacity/greatest(coalesce(recipe.output_quantity,1),.001)*i.value::numeric;
 IF coalesce(cash,0)<debt THEN warnings:=warnings||jsonb_build_array('payroll_debt_uncovered');END IF;
 IF coalesce(cash,0)<required THEN warnings:=warnings||jsonb_build_array('insufficient_weekly_reserve');END IF;
 IF staff_count<coalesce(t.min_employees,0) THEN warnings:=warnings||jsonb_build_array('below_reference_staff');END IF;
 IF staff_count>coalesce(t.min_employees,0) THEN warnings:=warnings||jsonb_build_array('diminishing_staff_returns');END IF;
 IF days>0 AND revenue<expenses THEN warnings:=warnings||jsonb_build_array('recent_ledger_loss');END IF;
 IF capacity>0 AND sales<capacity*.25 AND days>=3 THEN warnings:=warnings||jsonb_build_array('low_observed_demand');END IF;
 IF jsonb_array_length(missing)>0 THEN warnings:=warnings||jsonb_build_array('input_shortage_at_capacity');END IF;
 RETURN jsonb_build_object('model','player_workforce_v1','cash',coalesce(cash,0),'wages_due',debt,'weekly_payroll',weekly,'weekly_minimum_overhead',overhead,
 'minimum_cash_reserve',required,'available_for_new_weekly_wages',greatest(0,coalesce(cash,0)-required),
 'reserve_shortfall',greatest(0,required-coalesce(cash,0)),'active_staff',staff_count,'reference_staff',t.min_employees,
 'daily_output_capacity',capacity,'observed_daily_sales',round(sales,3),'output_stock',coalesce(stock,0),'days_observed',days,
 'recent_revenue',revenue,'recent_expenses',expenses,'recent_net_result',revenue-expenses,
 'inputs_at_capacity',missing,'warnings',warnings,'forecast_not_guarantee',true);
END $f$;
REVOKE ALL ON FUNCTION private.player_company_financial_diagnostic(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.assert_player_hiring_reserve(p_business uuid,p_weekly_wage numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE b public.businesses%rowtype; d jsonb; required numeric;
BEGIN
 SELECT * INTO b FROM public.businesses WHERE id=p_business FOR UPDATE;
 IF b.control_kind IS DISTINCT FROM 'player' THEN RETURN; END IF;
 IF p_weekly_wage IS NULL OR p_weekly_wage<=0 OR p_weekly_wage::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Salário inválido.';END IF;
 PERFORM id FROM public.accounts WHERE id=b.bank_account_id FOR UPDATE;
 d:=private.player_company_financial_diagnostic(b.id);
 required:=(d->>'minimum_cash_reserve')::numeric+p_weekly_wage;
 IF coalesce((d->>'cash')::numeric,0)<required THEN
 RAISE EXCEPTION 'Caixa insuficiente para contratar: reserve R$ % (salários devidos, próxima semana da equipe e manutenção mínima). Disponível: R$ %. A vaga pode permanecer aberta até a regularização.',round(required,2),round(coalesce((d->>'cash')::numeric,0),2);
 END IF;
END $f$;
REVOKE ALL ON FUNCTION private.assert_player_hiring_reserve(uuid,numeric) FROM PUBLIC,anon,authenticated;

DO $patch$
DECLARE d text; old text;
BEGIN
 d:=pg_get_functiondef('private.simulate_company_day(uuid,date)'::regprocedure);
 old:='(1+least(.3,(qualification_level-1)*.02))*(.7+satisfaction*.006)';
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'Skill calculation changed';END IF;
 d:=replace(d,old,'(1+CASE WHEN b.control_kind=''player'' THEN least(.40,greatest(0,qualification_level-1)*.025) ELSE least(.3,(qualification_level-1)*.02) END)*(.7+satisfaction*.006)');
 old:='units:=round(kind.base_daily_capacity*work_efficiency,3);';
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'Capacity calculation changed';END IF;
 d:=replace(d,old,$s$
 IF b.control_kind='player' THEN
  work_efficiency:=private.player_workforce_efficiency(headcount+CASE WHEN b.owner_operates THEN .25 ELSE 0 END,kind.min_employees,skill,
   (.65+(region.roads+region.energy+region.telecom+region.industry+region.ports+region.airports)/2000),coalesce(boost,0));
 END IF;
 units:=round(kind.base_daily_capacity*work_efficiency,3);$s$);
 old:=$s$'balance_model','observed_sales_variable_overhead_v1')$s$;
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'Previous balance migration missing';END IF;
 d:=replace(d,old,$s$'balance_model','observed_sales_variable_overhead_v1','workforce_model',CASE WHEN b.control_kind='player' THEN 'player_workforce_v1' ELSE 'existing_npc' END)$s$);
 EXECUTE d;

 d:=pg_get_functiondef('public.manage_company_workforce(uuid,text,jsonb,uuid)'::regprocedure);
 old:=$s$  person_name:=(array['Ana'$s$;
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'NPC hiring definition changed';END IF;
 d:=replace(d,old,$s$  PERFORM private.assert_player_hiring_reserve(b.id,wage);
  person_name:=(array['Ana'$s$);
 old:=$s$   insert into public.business_employees(business_id,profile_id,name,role,salary,is_npc,role_template_id,skill_area,experience,qualification_level,last_accrued_on)$s$;
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'Citizen hiring definition changed';END IF;
 d:=replace(d,old,'   PERFORM private.assert_player_hiring_reserve(b.id,v.salary);'||chr(10)||old);
 -- Do not move accrual cursor backward if today's operating cycle already ran.
 old:='last_accrued_on=current_date where id=e.id;';
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'Employment accrual definition changed';END IF;
 d:=replace(d,old,'last_accrued_on=greatest(coalesce(e.last_accrued_on,e.hired_at::date),current_date) where id=e.id;');
 EXECUTE d;

 d:=pg_get_functiondef('public.get_company_management(uuid)'::regprocedure);
 old:=' return result;';
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'Management RPC changed';END IF;
 d:=replace(d,old,$s$ IF b.control_kind='player' THEN result:=result||jsonb_build_object('workforce_diagnostic',private.player_company_financial_diagnostic(b.id));END IF;
 return result;$s$);
 EXECUTE d;
END $patch$;
