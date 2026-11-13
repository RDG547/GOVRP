-- GOVRP: invoice settlement must run in the trusted database scheduler.
-- Clients do not hold EXECUTE on public.close_due_invoices() by design.
-- The existing process-card-invoices job at 01:00 collects card transactions;
-- this separate 02:00 job applies due-date interest once, using the existing
-- interest_applied_at idempotency guard. No rate or invoice formula is changed.
BEGIN;

DO $schedule_authoritative_invoice_closure$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'pg_cron is required for scheduled invoice closure';
  END IF;
  IF to_regprocedure('public.close_due_invoices()') IS NULL THEN
    RAISE EXCEPTION 'Authoritative invoice closure function is missing';
  END IF;
  IF has_function_privilege('authenticated', 'public.close_due_invoices()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.close_due_invoices()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Invoice closure must not be executable by citizen/anonymous roles';
  END IF;
  PERFORM cron.schedule(
    'govrp-close-due-card-invoices',
    '0 2 * * *',
    'SELECT public.close_due_invoices();'
  );
END;
$schedule_authoritative_invoice_closure$;

COMMIT;
