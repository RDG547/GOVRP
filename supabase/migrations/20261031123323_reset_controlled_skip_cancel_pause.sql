BEGIN;

-- A reset operator can request a transition, but only the worker applies it
-- between leases. This prevents changing a plan while an upload is in flight.
CREATE OR REPLACE FUNCTION public.admin_request_reset_control(
  p_request_id uuid, p_action text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  actor uuid := private.assert_reset_operator(true);
  req private.rp_reset_requests%rowtype;
  has_writes boolean;
BEGIN
  IF p_action NOT IN ('skip_backup','cancel','pause') THEN
    RAISE EXCEPTION 'Ação de controle inválida.';
  END IF;
  SELECT * INTO req FROM private.rp_reset_requests
  WHERE id=p_request_id FOR NO KEY UPDATE;
  IF req.id IS NULL OR req.scope <> 'full_rp'
     OR req.status NOT IN ('draining','backing_up','detaching','clearing',
                           'initializing','storage','accounts','validating') THEN
    RAISE EXCEPTION 'Não existe uma execução ativa compatível com este comando.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM private.rp_reset_runtime
                 WHERE id AND maintenance AND request_id=req.id) THEN
    RAISE EXCEPTION 'O reset não possui manutenção ativa.';
  END IF;
  IF req.preview ? 'reset_control_action' THEN
    RAISE EXCEPTION 'Já existe um comando de controle aguardando o worker.';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM private.rp_reset_steps
    WHERE request_id=req.id
      AND phase IN ('detaching','clearing','profiles','initializing','storage',
                    'accounts','validating','checking_relations','final_validation')
      AND status <> 'pending'
  ) INTO has_writes;
  IF p_action IN ('skip_backup','cancel') AND has_writes THEN
    RAISE EXCEPTION 'A limpeza já começou. Somente a pausa segura está disponível.';
  END IF;
  IF p_action='skip_backup' AND NOT private.reset_backup_enabled(req.id) THEN
    RAISE EXCEPTION 'O backup já foi dispensado para esta execução.';
  END IF;
  IF p_action='pause' AND NOT has_writes THEN
    RAISE EXCEPTION 'Antes da limpeza, escolha Cancelar Reset.';
  END IF;
  UPDATE private.rp_reset_requests
  SET preview=preview || jsonb_build_object('reset_control_action',p_action,
       'reset_control_requested_by',actor::text,'reset_control_requested_at',clock_timestamp())
  WHERE id=req.id;
  INSERT INTO private.rp_reset_job_events(request_id,kind,details)
  VALUES(req.id,'operator_control_requested',
         jsonb_build_object('actor',actor,'action',p_action));
  -- Keep dispatch alive so the worker can apply the request after its lease.
  PERFORM cron.alter_job(jobid,active:=true)
  FROM cron.job WHERE jobname='govrp-controlled-reset-worker';
  RETURN jsonb_build_object('accepted',true,'action',p_action,'state','queued',
                            'request_id',req.id);
END $$;

REVOKE ALL ON FUNCTION public.admin_request_reset_control(uuid,text)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_request_reset_control(uuid,text)
 TO authenticated;

CREATE OR REPLACE FUNCTION private.reset_apply_requested_control(
  p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  req private.rp_reset_requests%rowtype;
  action_name text;
  has_writes boolean;
  old_phase text;
  sched record;
BEGIN
  SELECT * INTO req FROM private.rp_reset_requests
  WHERE id=p_request_id FOR NO KEY UPDATE;
  action_name:=req.preview->>'reset_control_action';
  IF action_name IS NULL THEN
    RETURN jsonb_build_object('applied',false);
  END IF;
  IF NOT private.reset_worker_context() THEN
    RAISE EXCEPTION 'Apenas o worker pode efetivar um controle de reset.';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM private.rp_reset_steps
    WHERE request_id=req.id
      AND phase IN ('detaching','clearing','profiles','initializing','storage',
                    'accounts','validating','checking_relations','final_validation')
      AND status <> 'pending'
  ) INTO has_writes;

  IF action_name='skip_backup' THEN
    IF has_writes THEN
      RAISE EXCEPTION 'Não é possível dispensar o backup após iniciar a limpeza.';
    END IF;
    UPDATE private.rp_reset_requests
    SET preview=(preview-'reset_control_action')
                 || jsonb_build_object('create_backup',false)
    WHERE id=req.id;

    -- Complete the unneeded backup tasks; re-plan protected identities.
    UPDATE private.rp_reset_steps s
    SET status='completed',completed_at=clock_timestamp(),
        result=result || jsonb_build_object('skipped','Backup dispensado pelo administrador.'),
        operation=operation-'pending_chunk'-'pending_cursor'-'pending_count'
    WHERE request_id=req.id AND phase='backing_up' AND status<>'completed'
      AND NOT EXISTS(
        SELECT 1 FROM private.reset_catalog() c
        WHERE c.schema_name=s.schema_name AND c.table_name=s.table_name
          AND (c.strategy='keep' OR c.table_name='profiles')
      );
    UPDATE private.rp_reset_steps
    SET phase='preserving',status='pending',
        operation=operation-'pending_chunk'-'pending_cursor'-'pending_count'
    WHERE request_id=req.id AND phase='backing_up' AND status<>'completed';

    UPDATE private.rp_reset_steps
    SET status='completed',completed_at=clock_timestamp(),
        result=result || jsonb_build_object('skipped','Verificação de backup dispensada.')
    WHERE request_id=req.id AND phase='backup_verification' AND status<>'completed';

    INSERT INTO private.rp_reset_targets(request_id,schema_name,table_name,row_id)
    SELECT req.id,'public','products',id FROM public.products
    WHERE NOT private.is_reset_system_offer(id)
    ON CONFLICT DO NOTHING;
    INSERT INTO private.rp_reset_targets(request_id,schema_name,table_name,row_id)
    SELECT req.id,'public','investment_options',id
    FROM public.investment_options WHERE business_id IS NOT NULL
    ON CONFLICT DO NOTHING;

    UPDATE private.rp_reset_assets
    SET status='deletable'
    WHERE request_id=req.id AND status IN ('candidate','unclassified','pending');
    UPDATE private.rp_launch_backups
    SET snapshot=snapshot || jsonb_build_object('state','skipped',
       'reason','O administrador dispensou o backup durante a execução.')
    WHERE request_id=req.id;
    INSERT INTO private.rp_reset_job_events(request_id,kind,details)
    VALUES(req.id,'backup_dispensed_while_running',jsonb_build_object('automatic',false));
  ELSIF action_name='cancel' THEN
    IF has_writes THEN
      RAISE EXCEPTION 'O reset já alterou o mundo. Utilize Pausar e Retomar.';
    END IF;
    -- Do not re-enable jobs that were modified externally during maintenance.
    FOR sched IN SELECT * FROM private.rp_reset_job_schedules
                 WHERE request_id=req.id LOOP
      IF NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobid=sched.job_id
                     AND j.command=sched.command AND j.schedule=sched.schedule) THEN
        RAISE EXCEPTION 'O agendamento mudou durante o reset: %.',sched.job_name;
      END IF;
    END LOOP;
    PERFORM cron.alter_job(s.job_id,active:=s.was_active)
    FROM private.rp_reset_job_schedules s WHERE s.request_id=req.id;
    UPDATE private.rp_reset_requests
    SET status='cancelled',lease_id=NULL,lease_until=NULL,
        preview=preview-'reset_control_action'
    WHERE id=req.id;
    UPDATE private.rp_reset_runtime
    SET maintenance=false,request_id=NULL,changed_at=clock_timestamp()
    WHERE id AND request_id=req.id;
    PERFORM cron.alter_job(jobid,active:=false)
    FROM cron.job WHERE jobname='govrp-controlled-reset-worker';
    INSERT INTO private.rp_reset_job_events(request_id,kind,details)
    VALUES(req.id,'reset_cancelled_before_cleanup','{}');
  ELSIF action_name='pause' THEN
    UPDATE private.rp_reset_requests
    SET status='paused',lease_id=NULL,lease_until=NULL,
        preview=preview-'reset_control_action'
    WHERE id=req.id;
    PERFORM cron.alter_job(jobid,active:=false)
    FROM cron.job WHERE jobname='govrp-controlled-reset-worker';
    INSERT INTO private.rp_reset_job_events(request_id,kind,details)
    VALUES(req.id,'reset_paused_with_maintenance','{}');
  ELSE
    RAISE EXCEPTION 'Comando de controle desconhecido.';
  END IF;
  RETURN jsonb_build_object('applied',true,'action',action_name,
                            'request_id',req.id);
END $$;

REVOKE ALL ON FUNCTION private.reset_apply_requested_control(uuid)
 FROM PUBLIC,anon,authenticated,service_role;

-- The worker reaches this checkpoint between short jobs, never during
-- an HTTP upload/download or SQL deletion. Existing leases are honored.
CREATE OR REPLACE FUNCTION public.admin_claim_reset_worker(
  p_request_id uuid,p_token text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  req private.rp_reset_requests%rowtype;
  lease uuid:=gen_random_uuid();
  applied jsonb;
BEGIN
  req:=private.assert_reset_worker(p_request_id,p_token);
  IF req.lease_until>clock_timestamp()
     OR NOT pg_try_advisory_xact_lock(725104,2)
     OR NOT pg_try_advisory_xact_lock(725104,3) THEN
    RETURN jsonb_build_object('busy',true);
  END IF;
  SELECT * INTO req FROM private.rp_reset_requests
  WHERE id=req.id FOR NO KEY UPDATE NOWAIT;
  IF req.lease_until>clock_timestamp() THEN
    RETURN jsonb_build_object('busy',true);
  END IF;
  IF req.preview ? 'reset_control_action' THEN
    PERFORM set_config('govrp.reset_worker',req.id::text,true);
    applied:=private.reset_apply_requested_control(req.id);
    RETURN jsonb_build_object('busy',true,'control',applied);
  END IF;
  IF req.lease_id IS NOT NULL THEN
    INSERT INTO private.rp_reset_job_events(request_id,kind,details)
    VALUES(req.id,'expired_worker_recovered',
           jsonb_build_object('phase',req.current_phase));
  END IF;
  UPDATE private.rp_reset_requests
  SET lease_id=lease,lease_until=clock_timestamp()+interval '45 seconds',
      attempts=attempts+1 WHERE id=req.id;
  RETURN jsonb_build_object('lease',lease,'generation',req.generation_before,
                            'request_id',req.id);
EXCEPTION WHEN lock_not_available THEN
  RETURN jsonb_build_object('busy',true);
END $$;

REVOKE ALL ON FUNCTION public.admin_claim_reset_worker(uuid,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_claim_reset_worker(uuid,text)
 TO service_role;

CREATE OR REPLACE FUNCTION public.admin_resume_controlled_reset(
 p_request_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  actor uuid:=private.assert_reset_operator(true);
  req private.rp_reset_requests%rowtype;
BEGIN
  SELECT * INTO req FROM private.rp_reset_requests
  WHERE id=p_request_id FOR UPDATE;
  IF req.status NOT IN ('failed','paused')
     OR NOT EXISTS(SELECT 1 FROM private.rp_reset_runtime
                   WHERE id AND maintenance AND request_id=req.id) THEN
    RAISE EXCEPTION 'Esta execução não está pausada nem aguardando recuperação.';
  END IF;
  IF req.schema_fingerprint IS DISTINCT FROM private.reset_schema_fingerprint() THEN
    RAISE EXCEPTION 'Revise as alterações de esquema antes de retomar.';
  END IF;
  UPDATE private.rp_reset_steps
  SET status='pending',last_error=NULL
  WHERE request_id=req.id AND status='failed';
  UPDATE private.rp_reset_requests
  SET status='draining',last_error=NULL,lease_id=NULL,lease_until=NULL
  WHERE id=req.id;
  PERFORM cron.alter_job(jobid,active:=true)
  FROM cron.job WHERE jobname='govrp-controlled-reset-worker';
  INSERT INTO private.rp_reset_job_events(request_id,kind,details)
  VALUES(req.id,'reset_resumed',jsonb_build_object('actor',actor));
END $$;

REVOKE ALL ON FUNCTION public.admin_resume_controlled_reset(uuid)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_resume_controlled_reset(uuid)
 TO authenticated;
COMMIT;
