-- GOV.RP economy: non-mutating, admin-only diagnostic snapshot.
-- No financial balance, policy, calibration or inventory writes.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_economy_integrity_snapshot()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $diagnostics$
BEGIN
  IF auth.uid() IS NULL OR NOT public.economic_has_role(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'Painel restrito à Administração.' USING errcode = '42501';
  END IF;

  RETURN jsonb_build_object(
    'checked_at', now(),
    'accounting', private.economy_accounting_reconciliation_snapshot(),
    'financial', jsonb_build_object(
      'negative_accounts', (SELECT count(*) FROM public.accounts WHERE balance < 0),
      'account_total', (SELECT count(*) FROM public.accounts)
    ),
    'enterprise', jsonb_build_object(
      'active_businesses', (SELECT count(*) FROM public.businesses WHERE status = 'active'),
      'negative_inventory_lines', (SELECT count(*) FROM public.business_inventory WHERE quantity < 0),
      'daily_revenue', (SELECT coalesce(sum(revenue),0) FROM public.business_daily_operations),
      'daily_payroll_accrued', (SELECT coalesce(sum(payroll_accrued),0) FROM public.business_daily_operations),
      'daily_input_cost', (SELECT coalesce(sum(input_cost),0) FROM public.business_daily_operations),
      'daily_overhead', (SELECT coalesce(sum(overhead),0) FROM public.business_daily_operations),
      'operating_result', (SELECT coalesce(sum(revenue - payroll_accrued - input_cost - overhead),0)
        FROM public.business_daily_operations)
    ),
    'market', jsonb_build_object(
      'business_inventory_quantity', (SELECT coalesce(sum(quantity),0) FROM public.business_inventory),
      'national_physical_stock', (SELECT coalesce(sum(quantity),0) FROM public.national_market_stock),
      'completed_purchases', (SELECT count(*) FROM public.national_market_purchases),
      'population_consumptions', (SELECT count(*) FROM public.national_market_consumption)
    ),
    'fiscal', jsonb_build_object(
      'macroeconomic_simulation_expenses', (SELECT coalesce(sum(amount),0)
        FROM public.government_expenditures WHERE source_table='automatic_stabilizers'),
      'other_recorded_expenses', (SELECT coalesce(sum(amount),0)
        FROM public.government_expenditures WHERE source_table IS DISTINCT FROM 'automatic_stabilizers'),
      'recorded_revenues', (SELECT coalesce(sum(amount),0) FROM public.government_revenues)
    ),
    'macro', jsonb_build_object(
      'base_annual_gdp_calibration', (SELECT value FROM public.economic_calibrations WHERE key='baseline_annual_gdp'),
      'current_annualized_base_gdp', (SELECT base_monthly_gdp * 12 FROM public.economic_state WHERE id=true),
      'population_calibration', (SELECT value FROM public.economic_calibrations WHERE key='baseline_population'),
      'current_population', (SELECT coalesce(sum(population_count),0) FROM public.country_population_segments)
    ),
    'jobs_investments', jsonb_build_object(
      'salary_payments', (SELECT count(*) FROM public.salary_payments),
      'stock_assets', (SELECT count(*) FROM public.investment_options WHERE asset_type='stock'),
      'stock_prices', (SELECT count(*) FROM public.stock_price_history),
      'fixed_income_assets', (SELECT count(*) FROM public.investment_options WHERE asset_type='fixed_income')
    ),
    'alerts', jsonb_build_object(
      'active', (SELECT count(*) FROM public.economic_alerts WHERE status='active'),
      'resolved', (SELECT count(*) FROM public.economic_alerts WHERE status='resolved')
    )
  );
END;
$diagnostics$;

REVOKE ALL ON FUNCTION public.get_economy_integrity_snapshot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_economy_integrity_snapshot() TO authenticated;

COMMIT;