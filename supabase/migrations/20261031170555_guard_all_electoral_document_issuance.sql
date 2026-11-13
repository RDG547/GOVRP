BEGIN;
-- A trigger protects every document-issuance RPC, including legacy routes.
CREATE OR REPLACE FUNCTION private.guard_verified_electoral_document()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.type <> 'Título de Eleitor' OR NEW.is_valid IS DISTINCT FROM TRUE THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.type='Título de Eleitor' AND OLD.is_valid IS TRUE
     AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
     AND NEW.issued_at IS NOT DISTINCT FROM OLD.issued_at
     AND NEW.type IS NOT DISTINCT FROM OLD.type THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users au JOIN public.profiles p ON p.id=au.id
    WHERE au.id=NEW.user_id AND au.deleted_at IS NULL
      AND au.email_confirmed_at IS NOT NULL
      AND au.created_at <= clock_timestamp()-interval '24 hours'
      AND p.onboarding_completed IS TRUE AND p.deleted_at IS NULL
      AND NEW.issued_at >= au.email_confirmed_at
  ) THEN
    RAISE EXCEPTION 'O Título de Eleitor exige e-mail confirmado, cidadania concluída e 24 horas de cadastro.'
    USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS verified_electoral_document_required ON public.documents;
CREATE TRIGGER verified_electoral_document_required
BEFORE INSERT OR UPDATE OF type,is_valid,issued_at,user_id ON public.documents
FOR EACH ROW EXECUTE FUNCTION private.guard_verified_electoral_document();
COMMIT;
