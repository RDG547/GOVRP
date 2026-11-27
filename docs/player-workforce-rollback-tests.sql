
DO $test$
DECLARE firm record; diag jsonb; passed int:=0; blocked int:=0; solvent int:=0; denied boolean; prev jsonb;
BEGIN
 IF private.player_workforce_efficiency(0,5,1,1,0)<>0 OR private.player_workforce_efficiency(5,5,1,1,0)<>1 OR private.player_workforce_efficiency(10,5,1,1,0)<>1.5 OR private.player_workforce_efficiency(100,5,1,1,0)<>3 OR private.player_workforce_efficiency(5,5,1.4,1,0)<=private.player_workforce_efficiency(5,5,1,1,0) THEN RAISE EXCEPTION 'Productivity scenarios failed';END IF;
 FOR firm IN SELECT id FROM public.businesses WHERE control_kind='player' AND status='active' ORDER BY id LOOP
 diag:=private.player_company_financial_diagnostic(firm.id);
 IF diag IS NULL OR (diag->>'minimum_cash_reserve')::numeric<(diag->>'wages_due')::numeric OR (diag->>'available_for_new_weekly_wages')::numeric<0 THEN RAISE EXCEPTION 'Invalid diagnostics';END IF;
 IF (diag->>'available_for_new_weekly_wages')::numeric>=275 THEN
  PERFORM private.assert_player_hiring_reserve(firm.id,275); solvent:=solvent+1;
 ELSE
  denied:=false;
  BEGIN PERFORM private.assert_player_hiring_reserve(firm.id,275);
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Caixa insuficiente para contratar:%' THEN RAISE;END IF;denied:=true;END;
  IF NOT denied THEN RAISE EXCEPTION 'Unfunded hiring not blocked';END IF;blocked:=blocked+1;
 END IF;
 passed:=passed+1;
 END LOOP;
 IF passed=0 OR solvent=0 OR blocked=0 THEN RAISE EXCEPTION 'Coverage incomplete';END IF;
 IF has_function_privilege('anon','private.player_company_financial_diagnostic(uuid)','EXECUTE') OR has_function_privilege('authenticated','private.assert_player_hiring_reserve(uuid,numeric)','EXECUTE') THEN RAISE EXCEPTION 'Private helper exposed';END IF;
END $test$;
SELECT count(*) AS firms_tested,count(*) FILTER(WHERE (d->>'available_for_new_weekly_wages')::numeric<275) AS blocked_at_275,count(*) FILTER(WHERE (d->>'available_for_new_weekly_wages')::numeric>=275) AS covered_at_275 FROM (SELECT private.player_company_financial_diagnostic(id)d FROM public.businesses WHERE control_kind='player' AND status='active')x;
