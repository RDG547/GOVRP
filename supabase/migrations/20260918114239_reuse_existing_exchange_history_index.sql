-- The existing series index has the same country/currency/descending-time columns.
-- Keep it as the single index for the historical graph and rolling 24-hour baseline.
drop index if exists public.exchange_history_real_time_baseline;
