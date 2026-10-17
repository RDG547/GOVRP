-- Applied in Supabase Roleplay on 2026-10-17 as govrp_realtime_cron_load_20261017.
-- Keep this idempotent so migrations can also be replayed in a new environment.
-- Stop rewriting elections when the lifecycle status did not change.
CREATE OR REPLACE PROCEDURE public.refresh_all_election_status()
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $procedure$
BEGIN
  UPDATE public.elections
     SET status = CASE
       WHEN now() < candidacy_start_date THEN 'Scheduled'
       WHEN now() < candidacy_end_date THEN 'Candidacy'
       WHEN now() < voting_start_date THEN 'Scheduled'
       WHEN now() < voting_end_date THEN 'Voting'
       ELSE 'Finished'
     END
   WHERE status IS DISTINCT FROM CASE
       WHEN now() < candidacy_start_date THEN 'Scheduled'
       WHEN now() < candidacy_end_date THEN 'Candidacy'
       WHEN now() < voting_start_date THEN 'Scheduled'
       WHEN now() < voting_end_date THEN 'Voting'
       ELSE 'Finished'
     END;
END;
$procedure$;

-- The retained jobs are update_election_status_every_minute (each minute)
-- and govrp-justice-deadlines (every 5 seconds).
-- Keep redundant definitions disabled so an operator can reverse this.
DO $do$
DECLARE duplicate_job record;
BEGIN
  FOR duplicate_job IN
    SELECT jobid FROM cron.job
    WHERE active AND jobname IN (
      'Atualizar Status das Eleições',
      'update-election-statuses',
      'refresh_elections_job',
      'govrp-justice-due-events'
    )
  LOOP
    PERFORM cron.alter_job(duplicate_job.jobid, active => false);
  END LOOP;
END;
$do$;

-- Built-in pg_cron history is never automatically cleaned up. Safely prune
-- no more than 10,000 old records per run, retaining at least seven days.
-- Backlog recovery is intentionally gradual to prevent an outage from cleanup.
SELECT cron.schedule(
  'govrp-cron-history-prune',
  '*/5 * * * *',
  $cleanup$
    WITH old_runs AS (
      SELECT runid
      FROM cron.job_run_details
      WHERE COALESCE(end_time, start_time) < now() - INTERVAL '7 days'
      ORDER BY runid
      LIMIT 10000
    )
    DELETE FROM cron.job_run_details AS h
    USING old_runs AS old
    WHERE h.runid = old.runid;
  $cleanup$
);
