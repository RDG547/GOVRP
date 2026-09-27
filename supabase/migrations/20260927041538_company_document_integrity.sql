BEGIN;
-- Personal documents remain unique; each commercial activity can have its own CNPJ.
DROP INDEX public.documents_user_id_type_unique_idx;
CREATE UNIQUE INDEX documents_user_id_type_unique_idx ON public.documents(user_id,type)
 WHERE is_valid AND type <> 'CNPJ';
-- Issuance, fees and official metadata are exclusively written by validated RPCs.
DROP POLICY "Users can insert their own documents" ON public.documents;
REVOKE INSERT, UPDATE, DELETE ON public.documents FROM authenticated, anon;

CREATE FUNCTION private.protect_company_registration() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user IN ('authenticated','anon') AND
   (NEW.cnpj_document_id,NEW.metadata,NEW.business_type_id,NEW.owner_id,NEW.bank_account_id)
   IS DISTINCT FROM
   (OLD.cnpj_document_id,OLD.metadata,OLD.business_type_id,OLD.owner_id,OLD.bank_account_id) THEN
  RAISE EXCEPTION 'Use a operação oficial para alterar o registro ou o CNPJ da empresa.' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION private.protect_company_registration() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER protect_company_registration BEFORE UPDATE ON public.businesses
 FOR EACH ROW EXECUTE FUNCTION private.protect_company_registration();
COMMIT;
