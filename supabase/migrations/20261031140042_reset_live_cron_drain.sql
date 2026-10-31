BEGIN;
-- pg_stat_activity is bounded by live connections. Do not scan the unbounded
-- cron execution history to establish that old world work has drained.
CREATE OR REPLACE FUNCTION private.reset_background_jobs_drained(p_request_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT EXISTS(SELECT 1 FROM pg_stat_activity a
 WHERE a.datname=current_database() AND a.pid<>pg_backend_pid() AND a.state<>'idle'
 AND (a.application_name='pg_cron' OR a.backend_type='pg_cron worker')
 AND NOT EXISTS(SELECT 1 FROM cron.job j WHERE j.jobname IN('govrp-controlled-reset-worker','govrp-cron-history-prune') AND a.query=j.command))
$$;
CREATE OR REPLACE FUNCTION private.guard_world_mutation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE state private.rp_reset_runtime%rowtype;claims jsonb:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;headers jsonb:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;role_name text:=claims->>'role';b text;k text;BEGIN
 IF NOT pg_try_advisory_xact_lock_shared(725104,2) THEN RAISE EXCEPTION 'O universo está em manutenção. Aguarde a preparação do novo mundo.' USING errcode='55000';END IF;
 SELECT * INTO state FROM private.rp_reset_runtime WHERE id;
 IF private.reset_worker_context() THEN RETURN NULL;END IF;
 IF role_name='authenticated' AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Esta conta não possui mais acesso ao universo.' USING errcode='42501';END IF;
 IF state.maintenance THEN RAISE EXCEPTION 'O universo está em manutenção. Aguarde a preparação do novo mundo.' USING errcode='55000';END IF;
 IF state.enforce_generation AND role_name IS NULL AND transaction_timestamp()<state.generation_started_at THEN RAISE EXCEPTION 'Esta operação automática pertence a uma geração anterior do universo.' USING errcode='55000';END IF;
 IF state.enforce_generation AND role_name IN('anon','authenticated','service_role') AND headers->>'x-govrp-world-generation' IS DISTINCT FROM state.generation_id::text THEN RAISE EXCEPTION 'Esta ação pertence a uma sessão anterior do universo. Aguarde a atualização da sessão e tente novamente.' USING errcode='55000';END IF;
 RETURN NULL;
END $$;
COMMIT;
