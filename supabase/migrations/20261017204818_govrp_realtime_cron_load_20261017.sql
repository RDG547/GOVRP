-- GOVRP: eliminate no-op election writes and duplicate scheduler jobs.
-- The BEFORE trigger update_election_status() normalizes statuses to English,
-- so compare against the exact same state machine to avoid no-op updates.
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

-- All these jobs were duplicate executions of the retained
-- update_election_status_every_minute or govrp-justice-deadlines jobs.
-- Deactivation is reversible and retains scheduling definitions.
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

-- pg_cron never automatically removes its multi-million-row run history.
-- Delete in bounded, non-blocking batches, retaining at least 7 days.
-- It may take several days to work through the existing backlog.
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