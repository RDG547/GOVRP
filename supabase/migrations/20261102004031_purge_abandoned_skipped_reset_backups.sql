BEGIN;
-- The reset may be resumed without backup after several chunks have been
-- archived. These partial files are NOT a requested backup. Offer cleanup
-- only after a completed reset explicitly marked create_backup=false.
CREATE OR REPLACE FUNCTION public.admin_list_skipped_reset_backup_files(p_request_id uuid)
RETURNS text[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  actor uuid := private.assert_reset_operator(false);
  req private.rp_reset_requests%rowtype;
  paths text[];
BEGIN
  SELECT * INTO req FROM private.rp_reset_requests WHERE id=p_request_id;
  IF req.id IS NULL OR req.scope<>'full_rp'
    OR req.status<>'completed'
    OR COALESCE((req.preview->>'create_backup')::boolean,true) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'A limpeza só é permitida para reset concluído com backup dispensado.'
      USING ERRCODE='42501';
  END IF;
  IF EXISTS(
    SELECT 1 FROM private.rp_reset_runtime s WHERE s.id AND s.maintenance
  ) THEN
    RAISE EXCEPTION 'Não é possível limpar arquivos durante um reset.'
      USING ERRCODE='55000';
  END IF;
  SELECT COALESCE(array_agg(name ORDER BY name),'{}'::text[]) INTO paths
  FROM (
    SELECT o.name FROM storage.objects o
    WHERE o.bucket_id='rp-reset-backups'
      AND o.name LIKE p_request_id::text||'/%'
      AND EXISTS(
        SELECT 1 FROM private.rp_reset_backup_chunks c
        WHERE c.request_id=p_request_id AND c.object_name=o.name
      )
    ORDER BY o.name LIMIT 40
  ) files;
  RETURN paths;
END $$;

CREATE OR REPLACE FUNCTION public.admin_finalize_skipped_reset_backup_cleanup(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  actor uuid := private.assert_reset_operator(false);
  req private.rp_reset_requests%rowtype;
  deleted_rows integer;
BEGIN
  SELECT * INTO req FROM private.rp_reset_requests WHERE id=p_request_id FOR UPDATE;
  IF req.id IS NULL OR req.scope<>'full_rp'
    OR req.status<>'completed'
    OR COALESCE((req.preview->>'create_backup')::boolean,true) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Backup não dispensado ou reset incompleto.' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT 1 FROM private.rp_reset_runtime WHERE id AND maintenance) THEN
    RAISE EXCEPTION 'Existe reset em manutenção.' USING ERRCODE='55000';
  END IF;
  IF EXISTS(SELECT 1 FROM storage.objects
    WHERE bucket_id='rp-reset-backups' AND name LIKE p_request_id::text||'/%') THEN
    RAISE EXCEPTION 'Ainda existem arquivos no Storage. Conclua a remoção pela API.'
      USING ERRCODE='55000';
  END IF;

  DELETE FROM private.rp_reset_backup_chunks WHERE request_id=p_request_id;
  GET DIAGNOSTICS deleted_rows = ROW_COUNT;
  UPDATE private.rp_launch_backups
    SET snapshot=COALESCE(snapshot,'{}'::jsonb)
      || jsonb_build_object('state','purged','reason','Backup dispensado; arquivos e chunks descartados após reset.')
    WHERE request_id=p_request_id;
  INSERT INTO private.rp_reset_job_events(request_id,kind,details)
  VALUES(p_request_id,'skipped_backup_purged',
    jsonb_build_object('actor',actor,'chunks_removed',deleted_rows));
  RETURN jsonb_build_object('success',true,'chunks_removed',deleted_rows);
END $$;

REVOKE ALL ON FUNCTION public.admin_list_skipped_reset_backup_files(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_finalize_skipped_reset_backup_cleanup(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_list_skipped_reset_backup_files(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_finalize_skipped_reset_backup_cleanup(uuid) TO authenticated;
COMMIT;
