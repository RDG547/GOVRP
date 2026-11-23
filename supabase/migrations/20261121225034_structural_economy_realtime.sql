BEGIN;
-- Existing policies remain authoritative; no grants or public broadcasts added.
DO $$ DECLARE item text; BEGIN
 FOREACH item IN ARRAY ARRAY['economic_periods','economic_engine_runs','business_recipes'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=item AND c.relrowsecurity) THEN
   RAISE EXCEPTION 'RLS obrigatório antes da publicação de %',item;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=item) THEN
   EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',item);
  END IF;
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
