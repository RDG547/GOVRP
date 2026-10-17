-- Keep legal-effect processing automatic and near-real-time, without running
-- the database scheduler every single second on idle periods.
-- Five seconds is the maximum expected scheduler delay; the realtime stream
-- still immediately broadcasts committed changes to open clients.
DO $do$
DECLARE legal_job_id bigint;
BEGIN
  SELECT jobid INTO legal_job_id
  FROM cron.job
  WHERE jobname = 'govrp-legal-validity' AND active
  LIMIT 1;
  IF legal_job_id IS NOT NULL THEN
    PERFORM cron.alter_job(legal_job_id, schedule => '5 seconds');
  END IF;
END;
$do$;
