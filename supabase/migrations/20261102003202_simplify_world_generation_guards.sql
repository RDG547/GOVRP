BEGIN;

-- The reset engine deletes/reinitializes RP state. Generation IDs are kept
-- exclusively for cache invalidation and pending-job invalidation, NOT as
-- a compulsory browser header or Storage upload metadata on every write.
-- The maintenance barrier and reset advisory lock remain in place.

CREATE OR REPLACE FUNCTION private.guard_world_mutation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  state private.rp_reset_runtime%rowtype;
  claims jsonb := coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
BEGIN
  IF NOT pg_try_advisory_xact_lock_shared(725104,2) THEN
    RAISE EXCEPTION 'O GOVRP está em manutenção. Tente novamente após a conclusão do reset.'
      USING ERRCODE='55000';
  END IF;
  SELECT * INTO state FROM private.rp_reset_runtime WHERE id;
  IF state.id IS NULL THEN
    RAISE EXCEPTION 'O estado do GOVRP está indisponível.' USING ERRCODE='55000';
  END IF;
  IF private.reset_worker_context() THEN RETURN NULL; END IF;
  IF state.maintenance THEN
    RAISE EXCEPTION 'O GOVRP está em manutenção. Tente novamente após a conclusão do reset.'
      USING ERRCODE='55000';
  END IF;
  -- An already-running transaction cannot write into a newly reset world.
  -- A normal NEW transaction needs neither a generation header nor a cache RPC.
  IF transaction_timestamp() < state.generation_started_at THEN
    RAISE EXCEPTION 'A operação foi iniciada antes do último reset. Execute-a novamente.'
      USING ERRCODE='55000';
  END IF;
  IF claims->>'role' = 'authenticated' AND NOT EXISTS(
    SELECT 1 FROM auth.users
    WHERE id=auth.uid() AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Esta conta não possui mais acesso.' USING ERRCODE='42501';
  END IF;
  RETURN NULL;
END $$;

-- Keep the Storage reset maintenance gate. This does not demand that a
-- browser supply metadata.world_generation. Existing bucket/owner RLS policies
-- remain authoritative. Delayed pre-reset transactions are still rejected.
CREATE OR REPLACE FUNCTION private.guard_storage_generation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  state private.rp_reset_runtime%rowtype;
  claims jsonb := coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
  role_name text := claims->>'role';
  bucket text;
  object_key text;
BEGIN
  bucket := CASE WHEN TG_OP='DELETE' THEN OLD.bucket_id ELSE NEW.bucket_id END;
  object_key := CASE WHEN TG_OP='DELETE' THEN OLD.name ELSE NEW.name END;

  IF NOT pg_try_advisory_xact_lock_shared(725104,2) THEN
    RAISE EXCEPTION 'O GOVRP está em manutenção.' USING ERRCODE='55000';
  END IF;
  SELECT * INTO state FROM private.rp_reset_runtime WHERE id;
  IF state.id IS NULL THEN
    RAISE EXCEPTION 'O estado do GOVRP está indisponível.' USING ERRCODE='55000';
  END IF;

  IF bucket='rp-reset-backups' AND
      (role_name='service_role' OR private.reset_worker_context()) THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF bucket='support-attachments' THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF state.maintenance THEN
    IF TG_OP='DELETE' AND role_name='service_role'
      AND EXISTS(
        SELECT 1 FROM private.rp_reset_assets a
        JOIN private.rp_reset_requests r ON r.id=a.request_id
        WHERE a.request_id=state.request_id
          AND a.bucket_id=bucket AND a.object_name=object_key
          AND (a.status='archived'
            OR (a.status='deletable' AND NOT private.reset_backup_enabled(r.id)))
          AND r.current_phase='storage'
      ) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'O GOVRP está em manutenção.' USING ERRCODE='55000';
  END IF;

  IF transaction_timestamp() < state.generation_started_at THEN
    RAISE EXCEPTION 'Operação de arquivo iniciada antes do último reset.'
      USING ERRCODE='55000';
  END IF;

  IF role_name='authenticated' AND NOT EXISTS(
    SELECT 1 FROM auth.users WHERE id=auth.uid() AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Esta conta não possui mais acesso.' USING ERRCODE='42501';
  END IF;

  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

COMMIT;
