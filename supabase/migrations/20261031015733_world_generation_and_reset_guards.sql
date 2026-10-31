BEGIN;
CREATE FUNCTION private.reset_worker_context() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT request_id::text=current_setting('govrp.reset_worker',true) FROM private.rp_reset_runtime WHERE id),false)
$$;
CREATE FUNCTION private.guard_world_mutation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE state private.rp_reset_runtime%rowtype;claims jsonb:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;headers jsonb:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;role_name text:=claims->>'role';b text;k text;BEGIN
 IF NOT pg_try_advisory_xact_lock_shared(725104,2) THEN RAISE EXCEPTION 'O universo está em manutenção. Aguarde a preparação do novo mundo.' USING errcode='55000';END IF;
 SELECT * INTO state FROM private.rp_reset_runtime WHERE id;
 IF private.reset_worker_context() THEN RETURN NULL;END IF;
 IF role_name='authenticated' AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Esta conta não possui mais acesso ao universo.' USING errcode='42501';END IF;
 IF state.maintenance THEN RAISE EXCEPTION 'O universo está em manutenção. Aguarde a preparação do novo mundo.' USING errcode='55000';END IF;
 IF state.enforce_generation AND role_name IN('authenticated','service_role') AND headers->>'x-govrp-world-generation' IS DISTINCT FROM state.generation_id::text THEN RAISE EXCEPTION 'Esta ação pertence a uma sessão anterior do universo. Aguarde a atualização da sessão e tente novamente.' USING errcode='55000';END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION private.guard_world_runtime_setting() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF (TG_OP='DELETE' AND OLD.key='world_runtime') OR (TG_OP<>'DELETE' AND NEW.key='world_runtime' AND (pg_trigger_depth()<2 OR NEW.value IS DISTINCT FROM public.get_world_runtime())) THEN RAISE EXCEPTION 'O estado de manutenção é controlado pelo processo de reset.' USING errcode='42501';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
CREATE TRIGGER protect_world_runtime BEFORE INSERT OR UPDATE OR DELETE ON public.system_settings FOR EACH ROW EXECUTE FUNCTION private.guard_world_runtime_setting();
CREATE FUNCTION private.guard_admin_reset_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE identity uuid;BEGIN
 identity:=CASE WHEN TG_TABLE_SCHEMA='auth' THEN OLD.id ELSE OLD.id END;
 IF EXISTS(SELECT 1 FROM private.platform_admins WHERE user_id=identity) THEN
  IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND NEW.deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'A identidade administrativa está protegida. O reset não pode remover esta conta ou concessão.' USING errcode='42501';END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
CREATE TRIGGER protect_admin_auth_identity BEFORE DELETE OR UPDATE OF deleted_at ON auth.users FOR EACH ROW EXECUTE FUNCTION private.guard_admin_reset_identity();
CREATE TRIGGER protect_admin_character_identity BEFORE DELETE OR UPDATE OF deleted_at ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.guard_admin_reset_identity();
CREATE FUNCTION private.guard_admin_grant_during_reset() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN IF EXISTS(SELECT 1 FROM private.rp_reset_runtime WHERE id AND maintenance) THEN RAISE EXCEPTION 'As concessões administrativas permanecem protegidas durante o reset.' USING errcode='42501';END IF;IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;END $$;
CREATE TRIGGER preserve_admin_grants_during_reset BEFORE INSERT OR UPDATE OR DELETE ON private.platform_admins FOR EACH ROW EXECUTE FUNCTION private.guard_admin_grant_during_reset();
CREATE FUNCTION private.guard_registration_during_reset() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN IF NOT pg_try_advisory_xact_lock_shared(725104,2) THEN RAISE EXCEPTION 'Novos cadastros estarão disponíveis após a preparação.' USING errcode='55000';END IF;IF EXISTS(SELECT 1 FROM private.rp_reset_runtime WHERE id AND maintenance) AND NOT private.reset_worker_context() THEN RAISE EXCEPTION 'O universo está em manutenção. Novos cadastros estarão disponíveis após a preparação.' USING errcode='55000';END IF;RETURN NEW;END $$;
CREATE TRIGGER pause_registration_during_reset BEFORE INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION private.guard_registration_during_reset();
CREATE FUNCTION private.guard_storage_generation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE state private.rp_reset_runtime%rowtype;claims jsonb:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;role_name text:=claims->>'role';bucket text;object_key text;BEGIN
 bucket:=CASE WHEN TG_OP='DELETE' THEN OLD.bucket_id ELSE NEW.bucket_id END;object_key:=CASE WHEN TG_OP='DELETE' THEN OLD.name ELSE NEW.name END;
 IF NOT pg_try_advisory_xact_lock_shared(725104,2) THEN RAISE EXCEPTION 'Os arquivos do universo estão em manutenção.' USING errcode='55000';END IF;
 SELECT * INTO state FROM private.rp_reset_runtime WHERE id;
 IF bucket='rp-reset-backups' AND (role_name='service_role' OR private.reset_worker_context()) THEN IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;END IF;
 IF NOT pg_try_advisory_xact_lock_shared(725104,2) THEN RAISE EXCEPTION 'Os arquivos do universo estão em manutenção.' USING errcode='55000';END IF;
 IF bucket='support-attachments' THEN IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;END IF;
 IF state.maintenance THEN
  IF TG_OP='DELETE' AND role_name='service_role' AND EXISTS(SELECT 1 FROM private.rp_reset_assets a JOIN private.rp_reset_requests r ON r.id=a.request_id WHERE a.request_id=state.request_id AND a.bucket_id=bucket AND a.object_name=object_key AND a.status='archived' AND r.current_phase='storage') THEN RETURN OLD;END IF;
  RAISE EXCEPTION 'Os arquivos do universo estão em manutenção.' USING errcode='55000';
 END IF;
 IF role_name='authenticated' AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Esta conta não possui mais acesso ao universo.' USING errcode='42501';END IF;
 IF state.enforce_generation AND (role_name IS NOT NULL OR session_user NOT IN('postgres','supabase_admin')) AND (CASE WHEN TG_OP='DELETE' THEN OLD.user_metadata->>'world_generation' ELSE NEW.user_metadata->>'world_generation' END) IS DISTINCT FROM state.generation_id::text THEN RAISE EXCEPTION 'Este arquivo pertence a uma geração anterior do universo. Tente novamente pela sessão atual.' USING errcode='55000';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
CREATE POLICY reset_backup_private ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated USING(bucket_id<>'rp-reset-backups') WITH CHECK(bucket_id<>'rp-reset-backups');
CREATE TRIGGER guard_reset_storage BEFORE INSERT OR UPDATE OR DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION private.guard_storage_generation();
-- Statement triggers acquire a shared transaction barrier before every gameplay write.
-- A worker obtains the exclusive barrier only after in-flight writes have drained.
DO $$DECLARE t record;BEGIN FOR t IN SELECT * FROM private.reset_catalog() WHERE schema_name IN('public','private') AND classification NOT IN('C','D') AND table_name NOT LIKE 'rp_reset_%' AND table_name<>'rp_launch_backups' LOOP
 EXECUTE format('CREATE TRIGGER world_generation_barrier BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION private.guard_world_mutation()',t.schema_name,t.table_name);
 END LOOP;
 -- Characters are resettable but their Auth/technical identities are retained.
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.profiles'::regclass AND tgname='world_generation_barrier') THEN CREATE TRIGGER world_generation_barrier BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.profiles FOR EACH STATEMENT EXECUTE FUNCTION private.guard_world_mutation();END IF;
END $$;
DO $$DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname IN('reset_worker_context','guard_world_mutation','guard_world_runtime_setting','guard_admin_reset_identity','guard_admin_grant_during_reset','guard_registration_during_reset','guard_storage_generation') LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);END LOOP;END $$;
COMMIT;
