BEGIN;
-- Reduce the IO cost of cleaning pg_cron history without weakening gameplay
-- deadlines, shortening the seven-day retention, or modifying extension tables.
-- The previous query scanned hundreds of thousands of retained runs every
-- five minutes to find the ~300 entries that had just become eligible.
-- pg_cron's runid primary key provides an efficient oldest-first window.
DO $migration$
DECLARE cleanup_job record;
BEGIN
  SELECT jobid, schedule, active, command
    INTO cleanup_job
    FROM cron.job
   WHERE jobname='govrp-cron-history-prune';
  IF cleanup_job.jobid IS NULL THEN
    RAISE EXCEPTION 'Job govrp-cron-history-prune não encontrado; nenhuma alteração aplicada.';
  END IF;
  IF cleanup_job.schedule IS DISTINCT FROM '*/5 * * * *' THEN
    RAISE EXCEPTION 'A frequência do histórico foi alterada; revisar antes de otimizar.';
  END IF;

  PERFORM cron.alter_job(
    job_id := cleanup_job.jobid,
    command := $cron$
      WITH oldest AS MATERIALIZED (
        SELECT runid, COALESCE(end_time,start_time) AS finished_at, status
          FROM cron.job_run_details
         ORDER BY runid
         LIMIT 1200
      ), expired AS (
        SELECT runid FROM oldest
         WHERE finished_at < now() - INTERVAL '7 days'
           AND status IN ('succeeded','failed')
      )
      DELETE FROM cron.job_run_details AS h
        USING expired AS old
       WHERE h.runid = old.runid;
    $cron$
  );
END
$migration$;
COMMIT;
