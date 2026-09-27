BEGIN;
CREATE OR REPLACE FUNCTION private.broadcast_public_company_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_data jsonb:=to_jsonb(new); previous_data jsonb:=to_jsonb(old); business_id text;
BEGIN
 FOR business_id IN SELECT DISTINCT value FROM unnest(CASE WHEN tg_table_name='businesses'
   THEN ARRAY[current_data->>'id',previous_data->>'id']
   ELSE ARRAY[current_data->'metadata'->>'business_id',previous_data->'metadata'->>'business_id'] END) value WHERE value IS NOT NULL LOOP
  PERFORM realtime.send(jsonb_build_object('id',business_id),'public-company-changed','company-public-identity',false);
 END LOOP;
 RETURN coalesce(new,old);
END; $$;
REVOKE ALL ON FUNCTION private.broadcast_public_company_change() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER public_company_changed AFTER INSERT OR UPDATE OR DELETE ON public.businesses FOR EACH ROW EXECUTE FUNCTION private.broadcast_public_company_change();
CREATE TRIGGER public_company_document_changed AFTER INSERT OR UPDATE OR DELETE ON public.documents FOR EACH ROW EXECUTE FUNCTION private.broadcast_public_company_change();
COMMIT;
