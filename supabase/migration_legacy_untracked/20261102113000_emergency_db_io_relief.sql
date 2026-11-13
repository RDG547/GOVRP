-- Cancelled incident mitigation (2026-11-02).
-- This migration was NOT successfully applied while the database was unable
-- to open connections. An isolated manual change briefly slowed only
-- govrp-cron-history-prune, and that job has already been restored to 5 min.
-- No gameplay, justice, law, or election schedule should be changed by a
-- future automated migration run.
BEGIN;
SELECT 1 AS unchanged_cron_schedules;
COMMIT;
