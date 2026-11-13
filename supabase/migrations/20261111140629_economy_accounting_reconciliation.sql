BEGIN;

-- GOV.RP: non-monetary reconciliation. Existing balances and government spending are never modified.
-- Healthcare visits already move Treasury -> population. This trigger writes ONLY the missing audit entry.
CREATE OR REPLACE FUNCTION private.record_healthcare_visit_financial_entry()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $healthcare$
DECLARE v_population uuid;
BEGIN
  IF NEW.cost <= 0 THEN RETURN NEW; END IF;
  SELECT id INTO v_population
  FROM public.accounts WHERE account_kind = 'population'
  ORDER BY created_at DESC LIMIT 1;
  IF v_population IS NULL THEN
    RAISE EXCEPTION 'Conta demográfica indisponível para contabilização do atendimento.';
  END IF;

  INSERT INTO public.transactions(
    from_account_id, to_account_id, amount, type, description,
    created_at, metadata, idempotency_key
  ) VALUES (
    NULL, v_population, NEW.cost, 'public_healthcare_outlay',
    'Registro do repasse público para atendimento de saúde',
    NEW.created_at,
    jsonb_build_object(
      'source_table','healthcare_visits','source_id',NEW.id,
      'healthcare_visit_id',NEW.id,'region_code',NEW.region_code,
      'treasury_debit',true,'accounting_only',true,'balance_already_moved',true,
      'does_not_directly_change_gdp',true
    ),
    md5('govrp-healthcare-ledger:' || NEW.id::text)::uuid
  ) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN NEW;
END;
$healthcare$;
REVOKE ALL ON FUNCTION private.record_healthcare_visit_financial_entry() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS healthcare_financial_entry_after_insert ON public.healthcare_visits;
CREATE TRIGGER healthcare_financial_entry_after_insert
AFTER INSERT ON public.healthcare_visits FOR EACH ROW
EXECUTE FUNCTION private.record_healthcare_visit_financial_entry();

-- Backfill only real healthcare visits for the current population account and
-- only when a corresponding governmental expense was recorded. No balance write.
INSERT INTO public.transactions(
  from_account_id,to_account_id,amount,type,description,created_at,metadata,idempotency_key
)
SELECT
  NULL,a.id,h.cost,'public_healthcare_outlay',
  'Registro histórico do repasse público para atendimento de saúde',
  h.created_at,
  jsonb_build_object(
    'source_table','healthcare_visits','source_id',h.id,
    'healthcare_visit_id',h.id,'region_code',h.region_code,
    'treasury_debit',true,'accounting_only',true,'historical_backfill',true,
    'balance_already_moved',true,'does_not_directly_change_gdp',true
  ),
  md5('govrp-healthcare-ledger:' || h.id::text)::uuid
FROM public.healthcare_visits h
JOIN public.accounts a ON a.account_kind='population' AND h.created_at>=a.created_at
WHERE h.cost>0
AND EXISTS (
  SELECT 1 FROM public.government_expenditures e
  WHERE e.expenditure_type='health'
    AND e.source_table='healthcare_visits'
    AND e.source_id=h.id::text
    AND e.amount=h.cost
)
ON CONFLICT (idempotency_key) DO NOTHING;

-- Individual business finance ledgers are authoritative for sales.
-- National-market and direct-demographic sales already add to daily revenue
-- inside their purchasing routines: do not add those a second time.
CREATE OR REPLACE FUNCTION private.include_business_sale_in_daily_revenue()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $sale$
BEGIN
  IF NEW.type <> 'revenue'
     OR NEW.amount = 0
     OR coalesce(NEW.metadata->>'kind','') IN ('national_market_sale','population_sale')
  THEN RETURN NEW; END IF;

  UPDATE public.business_daily_operations
  SET revenue = revenue + NEW.amount
  WHERE business_id=NEW.business_id AND operation_date=NEW.accounting_date;
  RETURN NEW;
END;
$sale$;
REVOKE ALL ON FUNCTION private.include_business_sale_in_daily_revenue() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS business_sale_daily_revenue_after_insert ON public.business_transactions;
CREATE TRIGGER business_sale_daily_revenue_after_insert
AFTER INSERT ON public.business_transactions FOR EACH ROW
EXECUTE FUNCTION private.include_business_sale_in_daily_revenue();

-- Sales may precede the daily production simulation: carry these ledger
-- entries forward when the daily row is first created, never create a
-- placeholder daily row that would suppress production processing.
CREATE OR REPLACE FUNCTION private.initial_business_daily_revenue()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $initial$
BEGIN
  IF NEW.revenue = 0 THEN
    SELECT coalesce(sum(t.amount),0) INTO NEW.revenue
    FROM public.business_transactions t
    WHERE t.business_id=NEW.business_id
      AND t.accounting_date=NEW.operation_date
      AND t.type='revenue';
  END IF;
  RETURN NEW;
END;
$initial$;
REVOKE ALL ON FUNCTION private.initial_business_daily_revenue() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS business_daily_revenue_before_insert ON public.business_daily_operations;
CREATE TRIGGER business_daily_revenue_before_insert
BEFORE INSERT ON public.business_daily_operations FOR EACH ROW
EXECUTE FUNCTION private.initial_business_daily_revenue();

-- Historical report repair, with cash, payroll, production quantities and
-- already-accounted national-market transactions left untouched.
DO $safety$
BEGIN
  IF EXISTS (
    WITH ledger AS (
      SELECT business_id,accounting_date,sum(amount) revenue
      FROM public.business_transactions WHERE type='revenue'
      GROUP BY business_id,accounting_date
    )
    SELECT 1
    FROM public.business_daily_operations d
    LEFT JOIN ledger l ON l.business_id=d.business_id AND l.accounting_date=d.operation_date
    WHERE d.revenue > coalesce(l.revenue,0) + 0.01
  ) THEN
    RAISE EXCEPTION 'Os resumos diários já excedem o livro-razão; revisão necessária antes da conciliação.';
  END IF;
END;
$safety$;

WITH ledger AS (
  SELECT business_id,accounting_date,sum(amount) revenue
  FROM public.business_transactions WHERE type='revenue'
  GROUP BY business_id,accounting_date
)
UPDATE public.business_daily_operations d
SET revenue = l.revenue
FROM ledger l
WHERE d.business_id=l.business_id AND d.operation_date=l.accounting_date
  AND d.revenue IS DISTINCT FROM l.revenue;

-- Reconcile completed weekly national summaries without replaying economic
-- cycles, reissuing sales, changing money or recalculating closed macro GDP.
UPDATE public.business_national_cycles n
SET
  revenue=coalesce((
    SELECT sum(d.revenue) FROM public.business_daily_operations d
    WHERE d.operation_date>=n.cycle_start AND d.operation_date<n.cycle_end
  ),0),
  profit=coalesce((
    SELECT sum(d.revenue-d.payroll_accrued-d.input_cost-d.overhead)
    FROM public.business_daily_operations d
    WHERE d.operation_date>=n.cycle_start AND d.operation_date<n.cycle_end
  ),0),
  by_region=coalesce((
    SELECT jsonb_object_agg(grouped.region_code,grouped.summary)
    FROM (
      SELECT b.region_code,jsonb_build_object(
        'revenue',sum(d.revenue),'output',sum(d.produced_quantity),
        'companies',count(distinct b.id)
      ) AS summary
      FROM public.business_daily_operations d
      JOIN public.businesses b ON b.id=d.business_id
      WHERE d.operation_date>=n.cycle_start AND d.operation_date<n.cycle_end
        AND b.region_code IS NOT NULL
      GROUP BY b.region_code
    ) grouped
  ),'{}'::jsonb)
WHERE n.cycle_end<=current_date;

-- Privileged, read-only monitoring snapshot; it never moves money.
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

  SELECT coalesce(sum(CASE WHEN t.to_account_id=v_id THEN t.amount ELSE -t.amount END),0)
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

CREATE OR REPLACE FUNCTION public.get_economy_accounting_reconciliation()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $admin$
BEGIN
  PERFORM private.require_competition_admin();
  RETURN private.economy_accounting_reconciliation_snapshot();
END;
$admin$;
REVOKE ALL ON FUNCTION public.get_economy_accounting_reconciliation() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_economy_accounting_reconciliation() TO authenticated;

-- Background check reports discrepancies, but never changes business or
-- banking data. Active alerts are deduplicated and resolved when corrected.
CREATE OR REPLACE FUNCTION private.audit_economy_accounting()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $audit$
DECLARE s jsonb; item record;
BEGIN
  s:=private.economy_accounting_reconciliation_snapshot();
  FOR item IN
    SELECT * FROM (VALUES
      ('population_ledger_difference',abs((s->>'population_difference')::numeric),
       'Divergência no livro financeiro da população'),
      ('healthcare_ledger_missing',(s->>'healthcare_unlogged_visits')::numeric,
       'Atendimentos públicos sem lançamento financeiro'),
      ('business_daily_revenue_difference',(s->>'business_daily_revenue_difference')::numeric,
       'Divergência de receita entre empresas e produção diária'),
      ('business_daily_row_missing',(s->>'business_revenue_without_daily_row_count')::numeric,
       'Receitas empresariais sem registro diário'),
      ('business_national_cycle_difference',(s->>'national_weekly_revenue_difference')::numeric,
       'Divergência no resumo nacional de receitas')
    ) AS checks(code,measure,label)
  LOOP
    IF item.measure>0 THEN
      INSERT INTO public.economic_alerts(
        alert_code,severity,title,message,entity_type,entity_id,metadata
      )
      SELECT item.code,'warning',item.label,
        'Conciliação econômica identificou divergência; nenhum saldo foi alterado.',
        'economy','accounting_reconciliation',s
      WHERE NOT EXISTS (
        SELECT 1 FROM public.economic_alerts e
        WHERE e.alert_code=item.code AND e.entity_type='economy'
          AND e.entity_id='accounting_reconciliation' AND e.status='active'
      );
    ELSE
      UPDATE public.economic_alerts
      SET status='resolved',resolved_at=now()
      WHERE alert_code=item.code AND entity_type='economy'
        AND entity_id='accounting_reconciliation' AND status='active';
    END IF;
  END LOOP;
  RETURN s;
END;
$audit$;
REVOKE ALL ON FUNCTION private.audit_economy_accounting() FROM PUBLIC,anon,authenticated;

DO $job$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='cron')
    AND NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='govrp-economic-accounting-audit')
  THEN
    PERFORM cron.schedule(
      'govrp-economic-accounting-audit',
      '37 * * * *',
      'SELECT private.audit_economy_accounting();'
    );
  END IF;
END;
$job$;

COMMIT;
