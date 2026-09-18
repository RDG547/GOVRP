begin;
-- Rates were published, but their historical series also drives the rolling 24-hour quote.
do $$
begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='country_rp_exchange_history') then
  alter publication supabase_realtime add table public.country_rp_exchange_history;
 end if;
end $$;
commit;
