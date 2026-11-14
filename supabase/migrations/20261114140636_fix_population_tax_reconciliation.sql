-- GOV.RP: corrige a conciliação do débito populacional com tributos embutidos.
-- As transações de venda preservam o preço-base para a receita empresarial,
-- enquanto metadata.total_debited informa o débito efetivo do comprador.
-- Sem ajustes em contas, saldos, estoque, tributos ou lançamentos históricos.
CREATE OR REPLACE FUNCTION private.economy_accounting_reconciliation_snapshot()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $snapshot$
DECLARE
  v_id uuid; v_created timestamptz; v_balance numeric;
  v_ledger numeric:=0; v_health_count bigint:=0; v_health_sum numeric:=0;
  v_daily_count bigint:=0; v_daily_gap numeric:=0;
  v_missing_days bigint:=0; v_missing_sales numeric:=0;
  v_weekly_count bigint:=0; v_weekly_gap numeric:=0;
BEGIN
  SELECT id,balance,created_at INTO v_id,v_balance,v_created
  FROM public.accounts WHERE account_kind='population'
  ORDER BY created_at DESC LIMIT 1;

  SELECT coalesce(sum(CASE
    WHEN t.to_account_id=v_id THEN t.amount
    WHEN t.from_account_id=v_id
      AND t.type='population_purchase'
      AND jsonb_typeof(t.metadata->'total_debited')='number'
      THEN -(t.metadata->>'total_debited')::numeric
    ELSE -t.amount
  END),0)
  INTO v_ledger FROM public.transactions t
  WHERE t.to_account_id=v_id OR t.from_account_id=v_id;

  SELECT count(*),coalesce(sum(h.cost),0) INTO v_health_count,v_health_sum
  FROM public.healthcare_visits h
  WHERE h.created_at>=v_created AND h.cost>0
    AND NOT EXISTS(
      SELECT 1 FROM public.transactions t
      WHERE t.idempotency_key=md5('govrp-healthcare-ledger:'||h.id::text)::uuid
    );

  WITH l AS (
    SELECT business_id,accounting_date,sum(amount) revenue
    FROM public.business_transactions WHERE type='revenue'
    GROUP BY business_id,accounting_date
  )
  SELECT count(*) FILTER (WHERE abs(d.revenue-coalesce(l.revenue,0))>0.01),
         coalesce(sum(abs(d.revenue-coalesce(l.revenue,0))),0)
    INTO v_daily_count,v_daily_gap
  FROM public.business_daily_operations d
  LEFT JOIN l ON l.business_id=d.business_id AND l.accounting_date=d.operation_date;

  WITH l AS (
    SELECT business_id,accounting_date,sum(amount) revenue
    FROM public.business_transactions WHERE type='revenue'
    GROUP BY business_id,accounting_date
  )
  SELECT count(*),coalesce(sum(l.revenue),0)
  INTO v_missing_days,v_missing_sales
  FROM l LEFT JOIN public.business_daily_operations d
    ON d.business_id=l.business_id AND d.operation_date=l.accounting_date
  WHERE d.business_id IS NULL;

  SELECT count(*) FILTER(WHERE abs(n.revenue-coalesce(
    (SELECT sum(d.revenue) FROM public.business_daily_operations d
     WHERE d.operation_date>=n.cycle_start AND d.operation_date<n.cycle_end),0))>0.01),
    coalesce(sum(abs(n.revenue-coalesce(
    (SELECT sum(d.revenue) FROM public.business_daily_operations d
     WHERE d.operation_date>=n.cycle_start AND d.operation_date<n.cycle_end),0))),0)
  INTO v_weekly_count,v_weekly_gap
  FROM public.business_national_cycles n WHERE n.cycle_end<=current_date;

  RETURN jsonb_build_object(
    'population_wallet_present',v_id IS NOT NULL,
    'population_balance',coalesce(v_balance,0),
    'population_ledger_balance',v_ledger,
    'population_difference',round(coalesce(v_balance,0)-v_ledger,2),
    'healthcare_unlogged_visits',v_health_count,
    'healthcare_unlogged_amount',v_health_sum,
    'business_daily_mismatch_count',v_daily_count,
    'business_daily_revenue_difference',round(v_daily_gap,2),
    'business_revenue_without_daily_row_count',v_missing_days,
    'business_revenue_without_daily_row_amount',round(v_missing_sales,2),
    'national_weekly_mismatch_count',v_weekly_count,
    'national_weekly_revenue_difference',round(v_weekly_gap,2),
    'checked_at',now()
  );
END;
$snapshot$;
REVOKE ALL ON FUNCTION private.economy_accounting_reconciliation_snapshot() FROM PUBLIC,anon,authenticated;

-- Atualiza apenas o ciclo de alertas da conciliação; não movimenta valores.
DO $update_accounting_alert$
BEGIN
  PERFORM private.audit_economy_accounting();
END;
$update_accounting_alert$;
