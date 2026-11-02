BEGIN;
-- Incident GOVRP 2026-11-02: Supabase Auth and PostgREST return 503/504.
-- Temporarily reduce non-election background polling and pg_cron log cleanup
-- IO without changing the business rule, disabling the election schedulers,
-- modifying citizen balances, or dropping data.
CREATE TABLE IF NOT EXISTS private.rp_cron_incident_originals (
  incident text NOT NULL,
  jobid bigint NOT NULL,
  jobname text NOT NULL,
  original_schedule text NOT NULL,
  original_active boolean NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (incident, jobid)
);
REVOKE ALL ON TABLE private.rp_cron_incident_originals FROM PUBLIC,anon,authenticated;

DO $$
DECLARE j record;
BEGIN
  FOR j IN
    SELECT jobid,jobname,schedule,active,
      CASE jobname
        WHEN 'govrp-justice-deadlines' THEN '* * * * *'
        WHEN 'govrp-legal-validity' THEN '* * * * *'
        WHEN 'govrp-legal-benefits' THEN '* * * * *'
        WHEN 'govrp-cron-history-prune' THEN '*/30 * * * *'
        WHEN 'govrp-stock-quotes' THEN '*/5 * * * *'
        WHEN 'govrp-happiness-condition' THEN '*/15 * * * *'
      END AS throttled_schedule,
      CASE jobname
        WHEN 'govrp-justice-deadlines' THEN '5 seconds'
        WHEN 'govrp-legal-validity' THEN '5 seconds'
        WHEN 'govrp-legal-benefits' THEN '10 seconds'
        WHEN 'govrp-cron-history-prune' THEN '*/5 * * * *'
        WHEN 'govrp-stock-quotes' THEN '* * * * *'
        WHEN 'govrp-happiness-condition' THEN '*/5 * * * *'
      END AS expected_schedule
    FROM cron.job
    WHERE jobname IN (
      'govrp-justice-deadlines','govrp-legal-validity',
      'govrp-legal-benefits','govrp-cron-history-prune',
      'govrp-stock-quotes','govrp-happiness-condition'
    )
  LOOP
    IF j.schedule IS DISTINCT FROM j.expected_schedule
       AND j.schedule IS DISTINCT FROM j.throttled_schedule THEN
      RAISE EXCEPTION 'Unexpected % schedule %. Review before throttling.',
        j.jobname,j.schedule;
    END IF;
    INSERT INTO private.rp_cron_incident_originals
      (incident,jobid,jobname,original_schedule,original_active)
    VALUES ('2026-11-02-supabase-io',j.jobid,j.jobname,j.expected_schedule,j.active)
    ON CONFLICT DO NOTHING;
    IF j.active AND j.schedule IS DISTINCT FROM j.throttled_schedule THEN
      PERFORM cron.alter_job(job_id:=j.jobid,schedule:=j.throttled_schedule);
    END IF;
  END LOOP;
END $$;
COMMIT;
