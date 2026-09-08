BEGIN;
-- Reuse the existing idempotent deadline processor even when no citizen is online.
SELECT cron.schedule('govrp-justice-deadlines','5 seconds','select public.close_completed_sentences()');
COMMIT;
