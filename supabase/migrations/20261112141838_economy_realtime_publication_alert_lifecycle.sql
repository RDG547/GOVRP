-- GOV.RP economy: Realtime transport + lifecycle of conditional alerts.
-- No balance, price, tax, salary, inventory or legal-policy updates.
BEGIN;

DO $publication$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'government_revenues', 'government_expenditures', 'salary_payments'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = v_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
    END IF;
  END LOOP;
END;
$publication$;

CREATE OR REPLACE FUNCTION private.reconcile_economic_alert_status()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $lifecycle$
DECLARE
  v_cycle text;
  v_target numeric;
  v_inflation numeric;
  v_updated integer := 0;
BEGIN
  SELECT s.economic_cycle, s.inflation_target
    INTO v_cycle, v_target FROM public.economic_state s WHERE s.id = true;
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT coalesce(i.real_value, i.nominal_value)
    INTO v_inflation
  FROM public.economic_indicators i
  WHERE i.indicator_code = 'inflation_annual' AND i.status = 'official'
  ORDER BY i.created_at DESC, i.id DESC
  LIMIT 1;

  -- Preserve historical alerts. Resolve only conditions no longer true.
  UPDATE public.economic_alerts a
  SET status = 'resolved',
      resolved_at = now(),
      metadata = coalesce(a.metadata, '{}'::jsonb) ||
                 jsonb_build_object('resolved_by','economic_condition_lifecycle')
  WHERE a.status = 'active'
    AND (
      (a.alert_code = 'economic_cycle_deep_recession'
         AND v_cycle IS DISTINCT FROM 'deep_recession')
      OR (a.alert_code = 'economic_recovery'
         AND v_cycle IS DISTINCT FROM 'recovery')
      OR (a.alert_code = 'inflation_above_target'
         AND v_inflation IS NOT NULL AND v_target IS NOT NULL
         AND v_inflation <= v_target)
    );
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$lifecycle$;

REVOKE ALL ON FUNCTION private.reconcile_economic_alert_status() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.on_economy_state_alert_lifecycle()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $trigger$
BEGIN
  PERFORM private.reconcile_economic_alert_status();
  RETURN NEW;
END;
$trigger$;
REVOKE ALL ON FUNCTION private.on_economy_state_alert_lifecycle() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS economic_state_resolve_old_alerts ON public.economic_state;
CREATE TRIGGER economic_state_resolve_old_alerts
AFTER UPDATE OF economic_cycle, inflation_target ON public.economic_state
FOR EACH ROW
WHEN (OLD.economic_cycle IS DISTINCT FROM NEW.economic_cycle
   OR OLD.inflation_target IS DISTINCT FROM NEW.inflation_target)
EXECUTE FUNCTION private.on_economy_state_alert_lifecycle();

CREATE OR REPLACE FUNCTION private.on_inflation_indicator_alert_lifecycle()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $trigger$
BEGIN
  IF NEW.indicator_code = 'inflation_annual'
    AND NEW.status = 'official' THEN
    PERFORM private.reconcile_economic_alert_status();
  END IF;
  RETURN NEW;
END;
$trigger$;
REVOKE ALL ON FUNCTION private.on_inflation_indicator_alert_lifecycle() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS inflation_indicator_resolve_old_alerts ON public.economic_indicators;
CREATE TRIGGER inflation_indicator_resolve_old_alerts
AFTER INSERT ON public.economic_indicators
FOR EACH ROW
WHEN (NEW.indicator_code = 'inflation_annual' AND NEW.status = 'official')
EXECUTE FUNCTION private.on_inflation_indicator_alert_lifecycle();

CREATE OR REPLACE FUNCTION private.on_economic_condition_alert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $trigger$
BEGIN
  IF NEW.status = 'active'
    AND NEW.alert_code IN (
      'economic_cycle_deep_recession', 'economic_recovery', 'inflation_above_target'
    ) THEN
    -- A newer condition replaces earlier alerts without deleting their history.
    UPDATE public.economic_alerts a
    SET status = 'resolved', resolved_at = now()
    WHERE a.id <> NEW.id
      AND a.alert_code = NEW.alert_code
      AND a.status = 'active';
  END IF;
  RETURN NEW;
END;
$trigger$;
REVOKE ALL ON FUNCTION private.on_economic_condition_alert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS economic_alert_single_active_condition ON public.economic_alerts;
CREATE TRIGGER economic_alert_single_active_condition
AFTER INSERT OR UPDATE OF status, alert_code ON public.economic_alerts
FOR EACH ROW
EXECUTE FUNCTION private.on_economic_condition_alert();

-- Policy decisions are completed events, not ongoing adverse conditions.
UPDATE public.economic_alerts a
SET status = 'resolved',
    resolved_at = now()
WHERE a.status = 'active' AND a.alert_code LIKE 'policy_%';

SELECT private.reconcile_economic_alert_status();

COMMIT;