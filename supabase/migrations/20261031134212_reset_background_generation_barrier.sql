BEGIN;
-- Drain cron transactions even before their first gameplay write.
CREATE FUNCTION private.reset_background_jobs_drained(p_request_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT EXISTS(SELECT 1 FROM cron.job_run_details d JOIN private.rp_reset_job_schedules s ON s.job_id=d.jobid AND s.request_id=p_request_id JOIN pg_stat_activity a ON a.pid=d.job_pid AND a.backend_start<=d.start_time WHERE d.status='running' AND d.end_time IS NULL AND a.state<>'idle' AND a.pid<>pg_backend_pid())
$$;
REVOKE ALL ON FUNCTION private.reset_background_jobs_drained(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.guard_world_mutation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE state private.rp_reset_runtime%rowtype;claims jsonb:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;headers jsonb:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;role_name text:=claims->>'role';b text;k text;BEGIN
 IF NOT pg_try_advisory_xact_lock_shared(725104,2) THEN RAISE EXCEPTION 'O universo está em manutenção. Aguarde a preparação do novo mundo.' USING errcode='55000';END IF;
 SELECT * INTO state FROM private.rp_reset_runtime WHERE id;
 IF private.reset_worker_context() THEN RETURN NULL;END IF;
 IF role_name='authenticated' AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Esta conta não possui mais acesso ao universo.' USING errcode='42501';END IF;
 IF state.maintenance THEN RAISE EXCEPTION 'O universo está em manutenção. Aguarde a preparação do novo mundo.' USING errcode='55000';END IF;
 IF state.enforce_generation AND role_name IN('anon','authenticated','service_role') AND headers->>'x-govrp-world-generation' IS DISTINCT FROM state.generation_id::text THEN RAISE EXCEPTION 'Esta ação pertence a uma sessão anterior do universo. Aguarde a atualização da sessão e tente novamente.' USING errcode='55000';END IF;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION public.admin_process_reset_batch(p_request_id uuid,p_token text,p_lease uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE req private.rp_reset_requests%rowtype;step private.rp_reset_steps%rowtype;t record;data jsonb;cursor_row jsonb;pk text[];key_expr text;cursor_expr text;order_expr text;q text;payload jsonb;rows_count bigint;chunk bigint;chunk_no integer;done boolean:=false;triggers jsonb;assignments text;predicate text;started timestamptz:=clock_timestamp();err_message text;err_detail text;err_context text;err_state text;asset private.rp_reset_assets%rowtype;target uuid;expected jsonb;actual text;BEGIN
 req:=private.assert_reset_worker(p_request_id,p_token,p_lease);
 IF NOT pg_try_advisory_xact_lock(725104,2) THEN RETURN jsonb_build_object('waiting',true,'phase','draining');END IF;
 PERFORM set_config('govrp.reset_worker',req.id::text,true);PERFORM set_config('lock_timeout','750ms',true);
 SELECT * INTO step FROM private.rp_reset_steps WHERE request_id=req.id AND status<>'completed' ORDER BY ordinal LIMIT 1 FOR UPDATE;
 IF step.id IS NULL THEN RAISE EXCEPTION 'A execução não possui etapa final de validação.';END IF;
 UPDATE private.rp_reset_requests SET current_phase=step.phase,status=CASE WHEN step.phase IN('backup_verification','backing_up') THEN 'backing_up' WHEN step.phase IN('profiles','initializing') THEN 'initializing' WHEN step.phase IN('validating','final_validation') THEN 'validating' ELSE step.phase END,lease_until=clock_timestamp()+interval '45 seconds' WHERE id=req.id;
 UPDATE private.rp_reset_steps SET status='running',started_at=coalesce(started_at,clock_timestamp()),attempts=attempts+1 WHERE id=step.id;
 BEGIN
  IF req.schema_fingerprint IS DISTINCT FROM private.reset_schema_fingerprint() THEN RAISE EXCEPTION 'O esquema do banco mudou durante a execução. A manutenção será mantida para revisão.';END IF;
  IF step.phase='draining' THEN
   IF NOT private.reset_background_jobs_drained(req.id) THEN RETURN jsonb_build_object('waiting',true,'phase','draining','reason','Aguardando o encerramento das automações anteriores.');END IF;
   UPDATE private.rp_reset_requests SET user_ids=(SELECT coalesce(array_agg(id ORDER BY id),'{}') FROM auth.users WHERE deleted_at IS NULL) WHERE id=req.id;
   INSERT INTO private.rp_reset_assets(request_id,bucket_id,object_name,original_metadata,status) SELECT req.id,bucket_id,name,to_jsonb(o),CASE WHEN bucket_id='support-attachments' THEN 'retained' WHEN bucket_id IN('product-images','profiles','x-avatars','headers','stories','post-images','post-videos','avatars','x-message-attachments') OR (bucket_id='public-assets' AND name~'^(campaign-photos|company-logos|party-headers|party-logos|catalog-photos)/') THEN 'candidate' ELSE 'unclassified' END FROM storage.objects o WHERE bucket_id<>'rp-reset-backups';
   done:=true;
  ELSIF step.phase='backing_up' THEN
   IF step.operation ? 'pending_chunk' THEN RETURN jsonb_build_object('task',private.reset_chunk_packet((step.operation->>'pending_chunk')::bigint));END IF;
   SELECT array_agg(a.attname ORDER BY k.ord) INTO pk FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum WHERE i.indrelid=to_regclass(format('%I.%I',step.schema_name,step.table_name)) AND i.indisprimary;
   cursor_row:=step.cursor_value::jsonb;
   IF pk IS NULL THEN
    q:=format('SELECT coalesce(jsonb_agg(v.payload),''[]''),(jsonb_agg(v.cursor)->-1) FROM (SELECT to_jsonb(r) payload,r.ctid::text cursor FROM %I.%I r WHERE ($1::text IS NULL OR r.ctid>($1::jsonb->>''ctid'')::tid) ORDER BY r.ctid LIMIT 500)v',step.schema_name,step.table_name);
    EXECUTE q INTO payload,data USING step.cursor_value;cursor_row:=jsonb_build_object('ctid',data);
   ELSE
    SELECT string_agg(format('r.%I',c),','),string_agg(format('(jsonb_populate_record(NULL::%I.%I,$1)).%I',step.schema_name,step.table_name,c),',') INTO key_expr,cursor_expr FROM unnest(pk)c;
    q:=format('SELECT coalesce(jsonb_agg(v.payload),''[]'') FROM (SELECT to_jsonb(r) payload FROM %I.%I r WHERE ($1::jsonb IS NULL OR ROW(%s)>ROW(%s)) ORDER BY %s LIMIT 500)v',step.schema_name,step.table_name,key_expr,cursor_expr,key_expr);
    EXECUTE q INTO payload USING cursor_row;cursor_row:=payload->-1;
   END IF;
   rows_count:=jsonb_array_length(payload);SELECT coalesce(max(c.chunk_no),0)+1 INTO chunk_no FROM private.rp_reset_backup_chunks c WHERE c.request_id=req.id AND c.schema_name=step.schema_name AND c.table_name=step.table_name;
   INSERT INTO private.rp_reset_backup_chunks(request_id,schema_name,table_name,chunk_no,payload,digest,row_count) VALUES(req.id,step.schema_name,step.table_name,chunk_no,payload,encode(extensions.digest(payload::text,'sha256'),'hex'),rows_count) RETURNING id INTO chunk;
   IF step.table_name IN('products','investment_options') AND step.schema_name='public' THEN INSERT INTO private.rp_reset_targets(request_id,schema_name,table_name,row_id) SELECT req.id,'public',step.table_name,(r->>'id')::uuid FROM jsonb_array_elements(payload)r WHERE (step.table_name='products' AND NOT private.is_reset_system_offer((r->>'id')::uuid)) OR (step.table_name='investment_options' AND r->>'business_id' IS NOT NULL) ON CONFLICT DO NOTHING;END IF;
   UPDATE private.rp_reset_steps SET operation=operation||jsonb_build_object('pending_chunk',chunk,'pending_cursor',cursor_row,'pending_count',rows_count) WHERE id=step.id;
   RETURN jsonb_build_object('task',private.reset_chunk_packet(chunk));
  ELSIF step.phase='backup_verification' THEN
   FOR t IN SELECT * FROM private.rp_reset_backup_chunks WHERE request_id=req.id AND NOT verified ORDER BY id LIMIT 10 LOOP IF t.object_name IS NULL OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='rp-reset-backups' AND name=t.object_name) OR encode(extensions.digest(t.payload::text,'sha256'),'hex') IS DISTINCT FROM t.digest THEN RAISE EXCEPTION 'Um bloco de backup falhou na verificação de integridade.';END IF;UPDATE private.rp_reset_backup_chunks SET verified=true WHERE id=t.id;END LOOP;
   IF EXISTS(SELECT 1 FROM private.rp_reset_backup_chunks WHERE request_id=req.id AND NOT verified) THEN RETURN jsonb_build_object('waiting',true,'phase',step.phase);END IF;
   UPDATE private.rp_reset_assets a SET status=CASE WHEN a.status='candidate' THEN 'pending' WHEN a.status='unclassified' AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id=a.bucket_id AND o.name=a.object_name AND nullif(o.owner_id,'') IS NOT NULL) THEN 'pending' ELSE 'retained' END WHERE request_id=req.id AND status IN('candidate','unclassified');
   SELECT * INTO asset FROM private.rp_reset_assets WHERE request_id=req.id AND status='pending' ORDER BY id LIMIT 1;
   IF asset.id IS NOT NULL THEN RETURN jsonb_build_object('task',jsonb_build_object('kind','archive_asset','id',asset.id,'bucket',asset.bucket_id,'name',asset.object_name,'backup_name',req.id::text||'/'||asset.id::text));END IF;
   SELECT encode(extensions.digest(coalesce(string_agg(c.schema_name||'.'||c.table_name||':'||c.chunk_no||':'||c.digest,'|' ORDER BY c.schema_name,c.table_name,c.chunk_no),''),'sha256'),'hex') INTO actual FROM private.rp_reset_backup_chunks c WHERE request_id=req.id;
   UPDATE private.rp_launch_backups SET digest=actual,snapshot=snapshot||jsonb_build_object('state','verified','verified_at',clock_timestamp(),'chunks',(SELECT count(*) FROM private.rp_reset_backup_chunks WHERE request_id=req.id),'records',(SELECT sum(row_count) FROM private.rp_reset_backup_chunks WHERE request_id=req.id)) WHERE request_id=req.id;done:=true;
  ELSIF step.phase='detaching' THEN
   IF NOT EXISTS(SELECT 1 FROM private.rp_launch_backups WHERE request_id=req.id AND snapshot->>'state'='verified') THEN RAISE EXCEPTION 'O backup precisa estar verificado antes da limpeza.';END IF;
   SELECT string_agg(format('%I=NULL',c),','),string_agg(format('r.%I IS NOT NULL',c),' OR ') INTO assignments,predicate FROM jsonb_array_elements_text(step.operation->'columns')c;
   IF step.schema_name='public' AND step.table_name='posts' AND step.operation->'columns' ? 'original_post_id' THEN assignments:=assignments||',content=CASE WHEN content=''repost'' THEN ''[Republicação do universo anterior]'' ELSE content END';END IF;
   triggers:=private.reset_change_triggers(step.schema_name,step.table_name);
   EXECUTE format('WITH batch AS(SELECT r.ctid FROM %I.%I r WHERE %s LIMIT 2000 FOR UPDATE SKIP LOCKED) UPDATE %I.%I r SET %s FROM batch b WHERE r.ctid=b.ctid',step.schema_name,step.table_name,predicate,step.schema_name,step.table_name,assignments);GET DIAGNOSTICS rows_count=ROW_COUNT;
   PERFORM private.reset_change_triggers(step.schema_name,step.table_name,triggers);
   EXECUTE format('SELECT NOT EXISTS(SELECT 1 FROM %I.%I r WHERE %s)',step.schema_name,step.table_name,predicate) INTO done;
  ELSIF step.phase='clearing' THEN
   predicate:=CASE WHEN step.table_name IN('products','investment_options') AND step.schema_name='public' THEN format('EXISTS(SELECT 1 FROM private.rp_reset_targets chosen WHERE chosen.request_id=%L::uuid AND chosen.schema_name=%L AND chosen.table_name=%L AND chosen.row_id=r.id)',req.id,step.schema_name,step.table_name) ELSE 'true' END;
   triggers:=private.reset_change_triggers(step.schema_name,step.table_name);
   IF coalesce((step.operation->>'truncate_safe')::boolean,false) THEN EXECUTE format('TRUNCATE TABLE %I.%I RESTART IDENTITY RESTRICT',step.schema_name,step.table_name);done:=true;SELECT coalesce(sum(row_count),0) INTO rows_count FROM private.rp_reset_backup_chunks WHERE request_id=req.id AND schema_name=step.schema_name AND table_name=step.table_name;
   ELSE EXECUTE format('WITH batch AS(SELECT r.ctid FROM %I.%I r WHERE %s LIMIT 2000 FOR UPDATE SKIP LOCKED) DELETE FROM %I.%I r USING batch b WHERE r.ctid=b.ctid',step.schema_name,step.table_name,predicate,step.schema_name,step.table_name);GET DIAGNOSTICS rows_count=ROW_COUNT;EXECUTE format('SELECT NOT EXISTS(SELECT 1 FROM %I.%I r WHERE %s)',step.schema_name,step.table_name,predicate) INTO done;END IF;
   IF done AND step.table_name NOT IN('products','investment_options') THEN
    FOR t IN SELECT pg_get_serial_sequence(format('%I.%I',step.schema_name,step.table_name),a.attname) seq FROM pg_attribute a WHERE a.attrelid=to_regclass(format('%I.%I',step.schema_name,step.table_name)) AND a.attnum>0 AND NOT a.attisdropped LOOP IF t.seq IS NOT NULL THEN EXECUTE format('ALTER SEQUENCE %s RESTART',t.seq);END IF;END LOOP;
   END IF;
   PERFORM private.reset_change_triggers(step.schema_name,step.table_name,triggers);
  ELSIF step.phase='profiles' THEN
   SELECT coalesce(array_agg(p.id ORDER BY p.id),'{}') INTO pk FROM (SELECT id FROM public.profiles WHERE deleted_at IS NULL AND (step.cursor_value IS NULL OR id>step.cursor_value::uuid) ORDER BY id LIMIT 200)p;
   IF cardinality(pk)=0 THEN done:=true;ELSE
    SELECT string_agg(format('%I=DEFAULT',attname),',') INTO assignments FROM pg_attribute WHERE attrelid='public.profiles'::regclass AND attnum>0 AND NOT attisdropped AND attname NOT IN('id','created_at','role','username','username_is_generated','deleted_at','anonymized_at','deletion_reason','ui_preferences');triggers:=private.reset_change_triggers('public','profiles');
    EXECUTE 'UPDATE public.profiles r SET '||assignments||',username=''u_''||left(replace(gen_random_uuid()::text,''-'',''''),18),username_is_generated=true,role=CASE WHEN EXISTS(SELECT 1 FROM private.platform_admins a WHERE a.user_id=r.id) THEN ''Admin'' ELSE ''Cidadão'' END WHERE r.id=ANY($1)' USING pk::uuid[];
    PERFORM private.reset_change_triggers('public','profiles',triggers);rows_count:=cardinality(pk);UPDATE private.rp_reset_steps SET cursor_value=pk[cardinality(pk)] WHERE id=step.id;
   END IF;
  ELSIF step.phase='initializing' THEN
   PERFORM private.seed_reset_world(req.id);
   expected:='{}';FOR t IN SELECT * FROM private.reset_catalog() WHERE table_name IN('government_rules','country_rp_economic_snapshots','country_rp_exchange_rates','products','investment_options','economic_state','government_finances','state_enterprises','government_ministries','government_popularity_state','price_basket_items','country_rp_states','country_population_segments','currency_market_states','economic_regions','penal_code','rp_time_settings','system_settings') AND schema_name='public' LOOP EXECUTE format('SELECT jsonb_build_object(''count'',count(*),''digest'',md5(coalesce(string_agg(to_jsonb(r)::text,'''' ORDER BY to_jsonb(r)::text),''''))) FROM public.%I r %s',t.table_name,CASE WHEN t.table_name='system_settings' THEN 'WHERE key<>''world_runtime''' ELSE '' END) INTO data;expected:=expected||jsonb_build_object(t.table_name,data);END LOOP;
   UPDATE private.rp_reset_requests SET preview=preview||jsonb_build_object('initialized_baseline',expected) WHERE id=req.id;done:=true;
  ELSIF step.phase='storage' THEN
   SELECT * INTO asset FROM private.rp_reset_assets WHERE request_id=req.id AND status='archived' ORDER BY id LIMIT 1;IF asset.id IS NOT NULL THEN RETURN jsonb_build_object('task',jsonb_build_object('kind','delete_asset','id',asset.id,'bucket',asset.bucket_id,'name',asset.object_name,'backup_name',asset.backup_name,'digest',asset.digest));END IF;done:=true;
  ELSIF step.phase='accounts' THEN
   IF req.remove_common_accounts THEN SELECT u.id INTO target FROM auth.users u WHERE u.id=ANY(req.user_ids) AND NOT EXISTS(SELECT 1 FROM private.platform_admins a WHERE a.user_id=u.id) AND NOT EXISTS(SELECT 1 FROM private.rp_reset_targets ack WHERE ack.request_id=req.id AND ack.schema_name='auth' AND ack.table_name='deleted_account_ack' AND ack.row_id=u.id) ORDER BY u.id LIMIT 1;IF target IS NOT NULL THEN RETURN jsonb_build_object('task',jsonb_build_object('kind','delete_account','id',target));END IF;END IF;done:=true;
  ELSIF step.phase='validating' THEN
   IF coalesce((step.operation->>'preserve')::boolean,false) AND NOT(step.schema_name='public' AND req.preview->'initialized_baseline' ? step.table_name) THEN
    SELECT * INTO t FROM private.rp_reset_backup_chunks WHERE request_id=req.id AND schema_name=step.schema_name AND table_name=step.table_name AND (step.cursor_value IS NULL OR id>step.cursor_value::bigint) ORDER BY id LIMIT 1;
    IF t.id IS NULL THEN done:=true;
    ELSE
     SELECT string_agg(format('r.%I=b.%I',a.attname,a.attname),' AND ') INTO predicate FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey)u(attnum) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=u.attnum WHERE i.indrelid=to_regclass(format('%I.%I',step.schema_name,step.table_name)) AND i.indisprimary;
     IF predicate IS NULL THEN RAISE EXCEPTION 'A tabela protegida %.% precisa de chave para validar a recuperação.',step.schema_name,step.table_name;END IF;
     q:=format('SELECT count(*) FROM jsonb_populate_recordset(NULL::%I.%I,$1)b WHERE NOT EXISTS(SELECT 1 FROM %I.%I r WHERE %s)',step.schema_name,step.table_name,step.schema_name,step.table_name,predicate);
     IF req.remove_common_accounts AND step.table_name IN('account_identities','users') THEN q:=q||CASE WHEN step.schema_name='private' THEN ' AND EXISTS(SELECT 1 FROM private.platform_admins a WHERE a.user_id=b.user_id)' ELSE ' AND EXISTS(SELECT 1 FROM private.platform_admins a WHERE a.user_id=b.auth_user_id)' END;END IF;
     EXECUTE q INTO rows_count USING t.payload;IF rows_count<>0 THEN RAISE EXCEPTION 'Faltam registros protegidos em %.%.',step.schema_name,step.table_name;END IF;
     UPDATE private.rp_reset_steps SET cursor_value=t.id::text WHERE id=step.id;
    END IF;
   ELSIF req.preview->'initialized_baseline' ? step.table_name AND step.schema_name='public' THEN EXECUTE format('SELECT jsonb_build_object(''count'',count(*),''digest'',md5(coalesce(string_agg(to_jsonb(r)::text,'''' ORDER BY to_jsonb(r)::text),''''))) FROM public.%I r %s',step.table_name,CASE WHEN step.table_name='system_settings' THEN 'WHERE key<>''world_runtime''' ELSE '' END) INTO data;IF data IS DISTINCT FROM req.preview->'initialized_baseline'->step.table_name THEN RAISE EXCEPTION 'A inicialização de % não corresponde ao baseline verificado.',step.table_name;END IF;
   ELSE predicate:=CASE WHEN step.table_name IN('products','investment_options') AND step.schema_name='public' THEN format('EXISTS(SELECT 1 FROM private.rp_reset_targets chosen WHERE chosen.request_id=%L::uuid AND chosen.schema_name=%L AND chosen.table_name=%L AND chosen.row_id=r.id)',req.id,step.schema_name,step.table_name) ELSE 'true' END;EXECUTE format('SELECT count(*) FROM %I.%I r WHERE %s',step.schema_name,step.table_name,predicate) INTO rows_count;IF rows_count<>0 THEN RAISE EXCEPTION 'A verificação encontrou registros anteriores em %.%.',step.schema_name,step.table_name;END IF;END IF;done:=true;
  ELSIF step.phase='final_validation' THEN
   data:=private.validate_controlled_reset(req.id);IF NOT coalesce((data->>'valid')::boolean,false) THEN RAISE EXCEPTION 'A verificação final encontrou inconsistências. A manutenção será mantida.';END IF;
   UPDATE private.rp_reset_requests SET status='validated',validated_at=clock_timestamp(),result=data||jsonb_build_object('success',true,'request_id',req.id,'scope','full_rp','backup_id',(SELECT id FROM private.rp_launch_backups WHERE request_id=req.id)) WHERE id=req.id;
   UPDATE private.rp_reset_runtime SET generation_id=req.generation_after,generation_started_at=clock_timestamp(),changed_at=clock_timestamp(),enforce_generation=true WHERE id AND request_id=req.id;PERFORM cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='govrp-controlled-reset-worker';done:=true;
  END IF;
  UPDATE private.rp_reset_steps SET status=CASE WHEN done THEN 'completed' ELSE 'running' END,processed=processed+coalesce(rows_count,0),completed_at=CASE WHEN done THEN clock_timestamp() ELSE NULL END,elapsed_ms=elapsed_ms+extract(epoch FROM clock_timestamp()-started)*1000 WHERE id=step.id;
  RETURN jsonb_build_object('phase',step.phase,'step_completed',done,'validated',step.phase='final_validation' AND done);
 EXCEPTION WHEN query_canceled OR lock_not_available OR OTHERS THEN
  GET STACKED DIAGNOSTICS err_message=MESSAGE_TEXT,err_detail=PG_EXCEPTION_DETAIL,err_context=PG_EXCEPTION_CONTEXT,err_state=RETURNED_SQLSTATE;
  data:=jsonb_build_object('message',err_message,'detail',err_detail,'context',err_context,'sqlstate',err_state,'phase',step.phase,'table',step.schema_name||'.'||step.table_name,'at',clock_timestamp());UPDATE private.rp_reset_steps SET status='failed',last_error=data WHERE id=step.id;UPDATE private.rp_reset_requests SET status='failed',last_error=data,lease_until=NULL,lease_id=NULL WHERE id=req.id;INSERT INTO private.rp_reset_job_events(request_id,step_id,kind,details) VALUES(req.id,step.id,'step_failed',data);PERFORM cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='govrp-controlled-reset-worker';RETURN jsonb_build_object('failed',true,'message','A etapa foi interrompida. A manutenção e o checkpoint foram preservados.');
 END;
END $$;
COMMIT;
