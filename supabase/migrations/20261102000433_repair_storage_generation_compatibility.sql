BEGIN;
-- Some old browser/PWA uploads do not set user_metadata.world_generation.
-- Permit a narrowly scoped compatibility path ONLY for a new INSERT from a
-- non-deleted authenticated user with a fresh session issued after this world
-- began. Explicit stale generations, deleted users, updates and deletes stay
-- blocked. Existing Storage RLS owner/bucket policies still apply.
CREATE OR REPLACE FUNCTION private.guard_storage_generation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  state private.rp_reset_runtime%rowtype;
  claims jsonb:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
  role_name text:=claims->>'role';
  bucket text;
  object_key text;
  submitted_generation text;
  issued_at timestamptz;
BEGIN
  bucket:=CASE WHEN TG_OP='DELETE' THEN OLD.bucket_id ELSE NEW.bucket_id END;
  object_key:=CASE WHEN TG_OP='DELETE' THEN OLD.name ELSE NEW.name END;
  IF NOT pg_try_advisory_xact_lock_shared(725104,2) THEN
    RAISE EXCEPTION 'Os arquivos do universo estão em manutenção.' USING errcode='55000';
  END IF;
  SELECT * INTO state FROM private.rp_reset_runtime WHERE id;
  IF state.id IS NULL THEN
    RAISE EXCEPTION 'O estado do universo não está disponível.' USING errcode='55000';
  END IF;
  IF bucket='rp-reset-backups' AND (role_name='service_role' OR private.reset_worker_context()) THEN
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
    RAISE EXCEPTION 'Os arquivos do universo estão em manutenção.' USING errcode='55000';
  END IF;
  IF role_name='authenticated' AND NOT EXISTS(
    SELECT 1 FROM auth.users WHERE id=auth.uid() AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Esta conta não possui mais acesso ao universo.' USING errcode='42501';
  END IF;
  IF state.enforce_generation
     AND (role_name IS NOT NULL OR session_user NOT IN('postgres','supabase_admin')) THEN
    submitted_generation:=CASE WHEN TG_OP='DELETE'
      THEN OLD.user_metadata->>'world_generation'
      ELSE NEW.user_metadata->>'world_generation'
    END;
    IF submitted_generation IS DISTINCT FROM state.generation_id::text THEN
      -- Compatibility for older browsers with current, verified JWT sessions.
      -- A conflicting explicit value NEVER gets normalized to the new world.
      IF TG_OP='INSERT'
         AND submitted_generation IS NULL
         AND role_name='authenticated'
         AND bucket IN ('post-images','post-videos','avatars','x-avatars','headers','stories','public-assets','product-images')
         AND auth.uid() IS NOT NULL
         AND claims->>'iat' ~ '^[0-9]{10,}$'
      THEN
        issued_at:=to_timestamp((claims->>'iat')::bigint);
        IF issued_at >= state.generation_started_at
           AND issued_at <= clock_timestamp()+interval '5 minutes' THEN
          NEW.user_metadata:=coalesce(NEW.user_metadata,'{}'::jsonb)
            || jsonb_build_object('world_generation',state.generation_id::text);
          RETURN NEW;
        END IF;
      END IF;
      RAISE EXCEPTION 'Este arquivo pertence a uma geração anterior do universo. Atualize sua sessão.' USING errcode='55000';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
COMMIT;
