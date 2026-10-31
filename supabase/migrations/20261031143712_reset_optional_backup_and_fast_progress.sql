BEGIN;

-- Keep this choice in the existing request metadata so in-flight checkpoints and
-- their schema fingerprints remain valid. Missing choice means the old safe default.
CREATE OR REPLACE FUNCTION private.reset_backup_enabled(p_request_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((preview->>'create_backup')::boolean,true) FROM private.rp_reset_requests WHERE id=p_request_id
$$;
DROP FUNCTION IF EXISTS public.admin_configure_reset_request(uuid,text,boolean);
CREATE OR REPLACE FUNCTION public.admin_configure_reset_request(p_request_id uuid,p_mode text,p_remove_common_accounts boolean DEFAULT false,p_create_backup boolean DEFAULT true) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET jit=off AS $$
DECLARE actor uuid:=private.assert_reset_operator();BEGIN
 IF p_mode NOT IN('universe','launch') OR p_remove_common_accounts AND p_mode<>'launch' THEN RAISE EXCEPTION 'A exclusão de contas comuns exige o modo de lançamento.';END IF;
 UPDATE private.rp_reset_requests SET reset_mode=p_mode,remove_common_accounts=p_remove_common_accounts,
 preview=preview||jsonb_build_object('create_backup',coalesce(p_create_backup,true))
 WHERE id=p_request_id AND requested_by=actor AND scope='full_rp' AND status='draft' AND expires_at>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'Prepare uma prévia válida antes de configurar o reset.';END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_configure_reset_request(uuid,text,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_configure_reset_request(uuid,text,boolean,boolean) TO authenticated;
-- These are file references of protected records, not a copy of their contents.
CREATE OR REPLACE FUNCTION private.reset_retain_asset_references(p_request_id uuid,p_schema text,p_table text,p_payload jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb;m text[];path text;BEGIN
 FOR r IN SELECT * FROM jsonb_array_elements(p_payload) LOOP
  FOR m IN SELECT regexp_matches(r::text,$url$https?://[^[:space:]"]+/storage/v1/object/(?:public|authenticated|sign)/([^[:space:]"?]+)$url$,'g') LOOP
   path:=m[1];
   UPDATE private.rp_reset_assets SET status='retained' WHERE request_id=p_request_id AND bucket_id=split_part(path,'/',1) AND object_name=substr(path,strpos(path,'/')+1);
  END LOOP;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION private.plan_controlled_reset(p_request_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer:=0;t record;fk record;cols text;predicate text;BEGIN
 INSERT INTO private.rp_reset_steps(request_id,ordinal,phase,operation) VALUES(p_request_id,n,'draining','{}');n:=n+1;
 FOR t IN SELECT * FROM private.reset_catalog() WHERE backup AND (private.reset_backup_enabled(p_request_id) OR strategy='keep' OR table_name='profiles') AND to_regclass(format('%I.%I',schema_name,table_name)) IS NOT NULL ORDER BY schema_name,table_name LOOP
  INSERT INTO private.rp_reset_steps(request_id,ordinal,phase,schema_name,table_name) VALUES(p_request_id,n,CASE WHEN private.reset_backup_enabled(p_request_id) THEN 'backing_up' ELSE 'preserving' END,t.schema_name,t.table_name);n:=n+1;
 END LOOP;
 INSERT INTO private.rp_reset_steps(request_id,ordinal,phase,operation) VALUES(p_request_id,n,'backup_verification','{}');n:=n+1;
 -- Detach nullable references to disappearing records, not FK constraints themselves.
 FOR fk IN SELECT k.oid,k.conrelid,k.conkey,pn.nspname parent_schema,pc.relname parent_table,n.nspname child_schema,c.relname child_table,array_agg(a.attname ORDER BY u.ord) names FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class pc ON pc.oid=k.confrelid JOIN pg_namespace pn ON pn.oid=pc.relnamespace JOIN private.reset_catalog()rp ON rp.schema_name=pn.nspname AND rp.table_name=pc.relname CROSS JOIN LATERAL unnest(k.conkey) WITH ORDINALITY u(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=u.attnum WHERE k.contype='f' AND rp.strategy IN('clear','mixed') AND n.nspname IN('public','private') GROUP BY k.oid,k.conrelid,k.conkey,pn.nspname,pc.relname,n.nspname,c.relname HAVING private.reset_fk_detachable(k.oid) ORDER BY n.nspname,c.relname,k.oid LOOP
  INSERT INTO private.rp_reset_steps(request_id,ordinal,phase,schema_name,table_name,operation) VALUES(p_request_id,n,'detaching',fk.child_schema,fk.child_table,jsonb_build_object('columns',fk.names,'constraint_oid',fk.oid));n:=n+1;
 END LOOP;
 DROP TABLE IF EXISTS pg_temp.controlled_reset_order;
 CREATE TEMP TABLE controlled_reset_order(schema_name text,table_name text,strategy text,relation oid PRIMARY KEY) ON COMMIT DROP;
 INSERT INTO controlled_reset_order SELECT schema_name,table_name,strategy,to_regclass(format('%I.%I',schema_name,table_name)) FROM private.reset_catalog() WHERE strategy IN('clear','mixed');
 WHILE EXISTS(SELECT 1 FROM controlled_reset_order) LOOP
  cols:=NULL;
  FOR t IN SELECT r.* FROM controlled_reset_order r WHERE NOT EXISTS(SELECT 1 FROM pg_constraint k JOIN controlled_reset_order child ON child.relation=k.conrelid WHERE k.contype='f' AND k.confrelid=r.relation AND NOT private.reset_fk_detachable(k.oid)) ORDER BY r.schema_name,r.table_name LOOP
   INSERT INTO private.rp_reset_steps(request_id,ordinal,phase,schema_name,table_name,operation) VALUES(p_request_id,n,'clearing',t.schema_name,t.table_name,jsonb_build_object('predicate',private.reset_predicate(t.table_name),'truncate_safe',t.strategy='clear' AND NOT EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f' AND confrelid=t.relation AND conrelid<>confrelid)));n:=n+1;DELETE FROM controlled_reset_order WHERE relation=t.relation;cols:='progress';
  END LOOP;
  IF cols IS NULL THEN RAISE EXCEPTION 'Existe um ciclo de dependências não anuláveis que precisa ser revisado antes do reset.';END IF;
 END LOOP;
 INSERT INTO private.rp_reset_steps(request_id,ordinal,phase) VALUES(p_request_id,n,'profiles');n:=n+1;
 INSERT INTO private.rp_reset_steps(request_id,ordinal,phase) VALUES(p_request_id,n,'initializing');n:=n+1;
 INSERT INTO private.rp_reset_steps(request_id,ordinal,phase) VALUES(p_request_id,n,'storage');n:=n+1;
 INSERT INTO private.rp_reset_steps(request_id,ordinal,phase) VALUES(p_request_id,n,'accounts');n:=n+1;
 INSERT INTO private.rp_reset_steps(request_id,ordinal,phase,schema_name,table_name) SELECT p_request_id,n+row_number() OVER(ORDER BY schema_name,table_name)::integer,'validating',schema_name,table_name FROM private.reset_catalog() WHERE strategy IN('clear','mixed') OR (strategy='reset' AND table_name<>'profiles');
 SELECT coalesce(max(ordinal),0)+1 INTO n FROM private.rp_reset_steps WHERE request_id=p_request_id;
 INSERT INTO private.rp_reset_steps(request_id,ordinal,phase,schema_name,table_name,operation)
 SELECT p_request_id,n+row_number() OVER(ORDER BY schema_name,table_name)::integer,'validating',schema_name,table_name,'{"preserve":true}'::jsonb FROM private.reset_catalog() WHERE backup AND strategy='keep' AND table_name NOT LIKE 'rp_reset_%';
 SELECT coalesce(max(ordinal),0)+1 INTO n FROM private.rp_reset_steps WHERE request_id=p_request_id;
 FOR fk IN SELECT k.oid FROM pg_constraint k JOIN pg_namespace ns ON ns.oid=k.connamespace WHERE k.contype='f' AND ns.nspname IN('public','private','economy_private') ORDER BY k.oid LOOP
  INSERT INTO private.rp_reset_steps(request_id,ordinal,phase,operation) VALUES(p_request_id,n,'checking_relations',jsonb_build_object('constraint_oid',fk.oid));n:=n+1;
 END LOOP;
 INSERT INTO private.rp_reset_steps(request_id,ordinal,phase) VALUES(p_request_id,n,'final_validation');
END $$;
CREATE OR REPLACE FUNCTION public.admin_claim_reset_worker(p_request_id uuid,p_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE req private.rp_reset_requests%rowtype;lease uuid:=gen_random_uuid();BEGIN req:=private.assert_reset_worker(p_request_id,p_token);IF req.lease_until>clock_timestamp() OR NOT pg_try_advisory_xact_lock(725104,2) OR NOT pg_try_advisory_xact_lock(725104,3) THEN RETURN jsonb_build_object('busy',true);END IF;SELECT * INTO req FROM private.rp_reset_requests WHERE id=req.id FOR NO KEY UPDATE NOWAIT;IF req.lease_until>clock_timestamp() THEN RETURN jsonb_build_object('busy',true);END IF;IF req.lease_id IS NOT NULL THEN INSERT INTO private.rp_reset_job_events(request_id,kind,details) VALUES(req.id,'expired_worker_recovered',jsonb_build_object('phase',req.current_phase));END IF;UPDATE private.rp_reset_requests SET lease_id=lease,lease_until=clock_timestamp()+interval '45 seconds',attempts=attempts+1 WHERE id=req.id;RETURN jsonb_build_object('lease',lease,'generation',req.generation_before,'request_id',req.id);EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('busy',true);END $$;
CREATE OR REPLACE FUNCTION public.admin_process_reset_batch(p_request_id uuid,p_token text,p_lease uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE req private.rp_reset_requests%rowtype;step private.rp_reset_steps%rowtype;t record;data jsonb;cursor_row jsonb;pk text[];key_expr text;cursor_expr text;order_expr text;q text;payload jsonb;rows_count bigint;chunk bigint;chunk_no integer;done boolean:=false;triggers jsonb;assignments text;predicate text;started timestamptz:=clock_timestamp();err_message text;err_detail text;err_context text;err_state text;asset private.rp_reset_assets%rowtype;target uuid;expected jsonb;actual text;backup_enabled boolean;join_sql text;not_null_sql text;bad boolean;metadata jsonb;fk record;BEGIN
 req:=private.assert_reset_worker(p_request_id,p_token,p_lease);backup_enabled:=coalesce((req.preview->>'create_backup')::boolean,true);
 IF NOT pg_try_advisory_xact_lock(725104,2) THEN RETURN jsonb_build_object('waiting',true,'phase','draining');END IF;
 PERFORM set_config('govrp.reset_worker',req.id::text,true);PERFORM set_config('lock_timeout','750ms',true);
 SELECT * INTO step FROM private.rp_reset_steps WHERE request_id=req.id AND status<>'completed' ORDER BY ordinal LIMIT 1 FOR UPDATE;
 IF step.id IS NULL THEN RAISE EXCEPTION 'A execução não possui etapa final de validação.';END IF;
 UPDATE private.rp_reset_requests SET current_phase=step.phase,status=CASE WHEN step.phase IN('backup_verification','backing_up','preserving') THEN 'backing_up' WHEN step.phase IN('profiles','initializing') THEN 'initializing' WHEN step.phase IN('validating','checking_relations','final_validation') THEN 'validating' ELSE step.phase END,lease_until=clock_timestamp()+interval '45 seconds' WHERE id=req.id AND (current_phase IS DISTINCT FROM step.phase OR lease_until<clock_timestamp()+interval '15 seconds');
 UPDATE private.rp_reset_steps SET status='running',started_at=coalesce(started_at,clock_timestamp()),attempts=attempts+1 WHERE id=step.id;
 BEGIN
  IF step.phase IN('draining','backup_verification','final_validation') AND req.schema_fingerprint IS DISTINCT FROM private.reset_schema_fingerprint() THEN RAISE EXCEPTION 'O esquema do banco mudou durante a execução. A manutenção será mantida para revisão.';END IF;
  IF step.phase='draining' THEN
   IF NOT private.reset_background_jobs_drained(req.id) THEN RETURN jsonb_build_object('waiting',true,'phase','draining','reason','Aguardando o encerramento das automações anteriores.');END IF;
   UPDATE private.rp_reset_requests SET user_ids=(SELECT coalesce(array_agg(id ORDER BY id),'{}') FROM auth.users WHERE deleted_at IS NULL) WHERE id=req.id;
   INSERT INTO private.rp_reset_assets(request_id,bucket_id,object_name,original_metadata,status) SELECT req.id,bucket_id,name,to_jsonb(o),CASE WHEN bucket_id='support-attachments' THEN 'retained' WHEN bucket_id IN('product-images','profiles','x-avatars','headers','stories','post-images','post-videos','avatars','x-message-attachments') OR (bucket_id='public-assets' AND name~'^(campaign-photos|company-logos|party-headers|party-logos|catalog-photos)/') THEN 'candidate' ELSE 'unclassified' END FROM storage.objects o WHERE bucket_id<>'rp-reset-backups';
   IF NOT backup_enabled THEN
    INSERT INTO private.rp_reset_targets(request_id,schema_name,table_name,row_id) SELECT req.id,'public','products',id FROM public.products WHERE NOT private.is_reset_system_offer(id) ON CONFLICT DO NOTHING;
    INSERT INTO private.rp_reset_targets(request_id,schema_name,table_name,row_id) SELECT req.id,'public','investment_options',id FROM public.investment_options WHERE business_id IS NOT NULL ON CONFLICT DO NOTHING;
   END IF;
   done:=true;
  ELSIF step.phase IN('backing_up','preserving') THEN
   IF step.operation ? 'pending_chunk' THEN RETURN jsonb_build_object('task',private.reset_chunk_packet((step.operation->>'pending_chunk')::bigint));END IF;
   SELECT array_agg(a.attname ORDER BY k.ord) INTO pk FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum WHERE i.indrelid=to_regclass(format('%I.%I',step.schema_name,step.table_name)) AND i.indisprimary;
   cursor_row:=step.cursor_value::jsonb;
   IF pk IS NULL THEN
    q:=format('SELECT coalesce(jsonb_agg(v.payload),''[]''),(jsonb_agg(v.cursor)->-1) FROM (SELECT to_jsonb(r) payload,r.ctid::text cursor FROM %I.%I r WHERE ($1::text IS NULL OR r.ctid>($1::jsonb->>''ctid'')::tid) ORDER BY r.ctid LIMIT 200)v',step.schema_name,step.table_name);
    EXECUTE q INTO payload,data USING step.cursor_value;cursor_row:=jsonb_build_object('ctid',data);
   ELSE
    SELECT string_agg(format('r.%I',c),','),string_agg(format('(jsonb_populate_record(NULL::%I.%I,$1)).%I',step.schema_name,step.table_name,c),',') INTO key_expr,cursor_expr FROM unnest(pk)c;
    q:=format('SELECT coalesce(jsonb_agg(v.payload),''[]'') FROM (SELECT to_jsonb(r) payload FROM %I.%I r WHERE ($1::jsonb IS NULL OR ROW(%s)>ROW(%s)) ORDER BY %s LIMIT 200)v',step.schema_name,step.table_name,key_expr,cursor_expr,key_expr);
    EXECUTE q INTO payload USING cursor_row;cursor_row:=payload->-1;
   END IF;
   IF pk IS NOT NULL THEN SELECT jsonb_object_agg(key,value) INTO cursor_row FROM jsonb_each(coalesce(cursor_row,'{}')) WHERE key=ANY(pk);END IF;rows_count:=jsonb_array_length(payload);SELECT coalesce(max(c.chunk_no),0)+1 INTO chunk_no FROM private.rp_reset_backup_chunks c WHERE c.request_id=req.id AND c.schema_name=step.schema_name AND c.table_name=step.table_name;
   IF NOT backup_enabled THEN
    IF step.table_name<>'profiles' THEN PERFORM private.reset_retain_asset_references(req.id,step.schema_name,step.table_name,payload);END IF;
    SELECT string_agg(format('%L,r.%I',c,c),',') INTO key_expr FROM unnest(pk)c;
    IF key_expr IS NULL THEN RAISE EXCEPTION 'A tabela protegida %.% precisa de chave primária para conferir a preservação.',step.schema_name,step.table_name;END IF;
    IF step.schema_name='public' AND step.table_name='profiles' THEN key_expr:=key_expr||',''citizen_id'',r.citizen_id';END IF;
    EXECUTE format('SELECT coalesce(jsonb_agg(jsonb_build_object(%s)),''[]'') FROM jsonb_populate_recordset(NULL::%I.%I,$1)r',key_expr,step.schema_name,step.table_name) INTO metadata USING payload;
    INSERT INTO private.rp_reset_backup_chunks(request_id,schema_name,table_name,chunk_no,payload,digest,row_count,verified) VALUES(req.id,step.schema_name,step.table_name,chunk_no,metadata,encode(extensions.digest(metadata::text,'sha256'),'hex'),rows_count,true);
    UPDATE private.rp_reset_steps SET cursor_value=CASE WHEN rows_count=0 THEN cursor_value ELSE cursor_row::text END WHERE id=step.id;
    done:=rows_count=0;
   ELSE
   INSERT INTO private.rp_reset_backup_chunks(request_id,schema_name,table_name,chunk_no,payload,digest,row_count) VALUES(req.id,step.schema_name,step.table_name,chunk_no,payload,encode(extensions.digest(payload::text,'sha256'),'hex'),rows_count) RETURNING id INTO chunk;
   IF step.table_name IN('products','investment_options') AND step.schema_name='public' THEN INSERT INTO private.rp_reset_targets(request_id,schema_name,table_name,row_id) SELECT req.id,'public',step.table_name,(r->>'id')::uuid FROM jsonb_array_elements(payload)r WHERE (step.table_name='products' AND NOT private.is_reset_system_offer((r->>'id')::uuid)) OR (step.table_name='investment_options' AND r->>'business_id' IS NOT NULL) ON CONFLICT DO NOTHING;END IF;
   UPDATE private.rp_reset_steps SET operation=operation||jsonb_build_object('pending_chunk',chunk,'pending_cursor',cursor_row,'pending_count',rows_count) WHERE id=step.id;
   RETURN jsonb_build_object('task',private.reset_chunk_packet(chunk));
   END IF;
  ELSIF step.phase='backup_verification' THEN
   IF backup_enabled THEN
   FOR t IN SELECT * FROM private.rp_reset_backup_chunks WHERE request_id=req.id AND NOT verified ORDER BY id LIMIT 10 LOOP IF t.object_name IS NULL OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='rp-reset-backups' AND name=t.object_name) OR encode(extensions.digest(t.payload::text,'sha256'),'hex') IS DISTINCT FROM t.digest THEN RAISE EXCEPTION 'Um bloco de backup falhou na verificação de integridade.';END IF;UPDATE private.rp_reset_backup_chunks SET verified=true WHERE id=t.id;END LOOP;
   IF EXISTS(SELECT 1 FROM private.rp_reset_backup_chunks WHERE request_id=req.id AND NOT verified) THEN RETURN jsonb_build_object('waiting',true,'phase',step.phase);END IF;
   UPDATE private.rp_reset_assets a SET status=CASE WHEN a.status='candidate' THEN 'pending' WHEN a.status='unclassified' AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id=a.bucket_id AND o.name=a.object_name AND nullif(o.owner_id,'') IS NOT NULL) THEN 'pending' ELSE 'retained' END WHERE request_id=req.id AND status IN('candidate','unclassified');
   SELECT * INTO asset FROM private.rp_reset_assets WHERE request_id=req.id AND status='pending' ORDER BY id LIMIT 1;
   IF asset.id IS NOT NULL THEN RETURN jsonb_build_object('task',jsonb_build_object('kind','archive_asset','id',asset.id,'bucket',asset.bucket_id,'name',asset.object_name,'backup_name',req.id::text||'/'||asset.id::text));END IF;
   SELECT encode(extensions.digest(coalesce(string_agg(c.schema_name||'.'||c.table_name||':'||c.chunk_no||':'||c.digest,'|' ORDER BY c.schema_name,c.table_name,c.chunk_no),''),'sha256'),'hex') INTO actual FROM private.rp_reset_backup_chunks c WHERE request_id=req.id;
   UPDATE private.rp_launch_backups SET digest=actual,snapshot=snapshot||jsonb_build_object('state','verified','verified_at',clock_timestamp(),'chunks',(SELECT count(*) FROM private.rp_reset_backup_chunks WHERE request_id=req.id),'records',(SELECT sum(row_count) FROM private.rp_reset_backup_chunks WHERE request_id=req.id)) WHERE request_id=req.id;
   ELSE
    UPDATE private.rp_reset_assets a SET status=CASE WHEN status='candidate' OR (status='unclassified' AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id=a.bucket_id AND o.name=a.object_name AND nullif(o.owner_id,'') IS NOT NULL)) THEN 'deletable' ELSE 'retained' END WHERE request_id=req.id AND status IN('candidate','unclassified');
    UPDATE private.rp_launch_backups SET snapshot=snapshot||jsonb_build_object('state','skipped','reason','Dispensado expressamente pelo administrador; apenas chaves de integridade foram registradas.') WHERE request_id=req.id;
   END IF;done:=true;
  ELSIF step.phase='detaching' THEN
   IF backup_enabled AND NOT EXISTS(SELECT 1 FROM private.rp_launch_backups WHERE request_id=req.id AND snapshot->>'state'='verified') THEN RAISE EXCEPTION 'O backup precisa estar verificado antes da limpeza.';END IF;
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
   SELECT * INTO asset FROM private.rp_reset_assets WHERE request_id=req.id AND (status='archived' OR (NOT backup_enabled AND status='deletable')) ORDER BY id LIMIT 1;IF asset.id IS NOT NULL THEN RETURN jsonb_build_object('task',jsonb_build_object('kind','delete_asset','id',asset.id,'bucket',asset.bucket_id,'name',asset.object_name,'backup_name',asset.backup_name,'digest',asset.digest,'backup_required',backup_enabled));END IF;done:=true;
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
  ELSIF step.phase='checking_relations' THEN
   SELECT k.*,n.nspname,c.relname,rn.nspname parent_schema,rc.relname parent_table INTO fk FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class rc ON rc.oid=k.confrelid JOIN pg_namespace rn ON rn.oid=rc.relnamespace WHERE k.oid=(step.operation->>'constraint_oid')::oid AND k.contype='f';
   IF fk.oid IS NULL THEN RAISE EXCEPTION 'Uma relação foi alterada durante o reset.';END IF;
   SELECT string_agg(format('c.%I=p.%I',ca.attname,pa.attname),' AND '),string_agg(format('c.%I IS NOT NULL',ca.attname),' AND ') INTO join_sql,not_null_sql FROM unnest(fk.conkey,fk.confkey)u(child_num,parent_num) JOIN pg_attribute ca ON ca.attrelid=fk.conrelid AND ca.attnum=u.child_num JOIN pg_attribute pa ON pa.attrelid=fk.confrelid AND pa.attnum=u.parent_num;
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I c WHERE %s AND NOT EXISTS(SELECT 1 FROM %I.%I p WHERE %s))',fk.nspname,fk.relname,not_null_sql,fk.parent_schema,fk.parent_table,join_sql) INTO bad;
   IF bad THEN RAISE EXCEPTION 'A relação % em %.% contém referências órfãs.',fk.conname,fk.nspname,fk.relname;END IF;
   UPDATE private.rp_reset_steps SET result=jsonb_build_object('valid',true,'constraint_oid',fk.oid) WHERE id=step.id;done:=true;
  ELSIF step.phase='final_validation' THEN
   data:=private.validate_controlled_reset(req.id);IF NOT coalesce((data->>'valid')::boolean,false) THEN RAISE EXCEPTION 'A verificação final encontrou inconsistências. A manutenção será mantida.';END IF;
   UPDATE private.rp_reset_requests SET status='validated',last_error=NULL,validated_at=clock_timestamp(),result=data||jsonb_build_object('success',true,'request_id',req.id,'scope','full_rp','backup_id',(SELECT id FROM private.rp_launch_backups WHERE request_id=req.id)) WHERE id=req.id;
   UPDATE private.rp_reset_runtime SET generation_id=req.generation_after,generation_started_at=clock_timestamp(),changed_at=clock_timestamp(),enforce_generation=true WHERE id AND request_id=req.id;PERFORM cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='govrp-controlled-reset-worker';done:=true;
  END IF;
  UPDATE private.rp_reset_steps SET status=CASE WHEN done THEN 'completed' ELSE 'running' END,processed=processed+coalesce(rows_count,0),completed_at=CASE WHEN done THEN clock_timestamp() ELSE NULL END,elapsed_ms=elapsed_ms+extract(epoch FROM clock_timestamp()-started)*1000 WHERE id=step.id;
  RETURN jsonb_build_object('phase',step.phase,'step_completed',done,'validated',step.phase='final_validation' AND done);
 EXCEPTION WHEN query_canceled OR lock_not_available OR OTHERS THEN
  GET STACKED DIAGNOSTICS err_message=MESSAGE_TEXT,err_detail=PG_EXCEPTION_DETAIL,err_context=PG_EXCEPTION_CONTEXT,err_state=RETURNED_SQLSTATE;
  data:=jsonb_build_object('message',err_message,'detail',err_detail,'context',err_context,'sqlstate',err_state,'phase',step.phase,'table',step.schema_name||'.'||step.table_name,'at',clock_timestamp());UPDATE private.rp_reset_steps SET status='failed',last_error=data WHERE id=step.id;UPDATE private.rp_reset_requests SET status='failed',last_error=data,lease_until=NULL,lease_id=NULL WHERE id=req.id;INSERT INTO private.rp_reset_job_events(request_id,step_id,kind,details) VALUES(req.id,step.id,'step_failed',data);PERFORM cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='govrp-controlled-reset-worker';RETURN jsonb_build_object('failed',true,'message','A etapa foi interrompida. A manutenção e o checkpoint foram preservados.');
 END;
END $$;
CREATE OR REPLACE FUNCTION public.admin_ack_reset_task(p_request_id uuid,p_token text,p_lease uuid,p_kind text,p_id text,p_data jsonb DEFAULT '{}') RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE req private.rp_reset_requests%rowtype;step private.rp_reset_steps%rowtype;c private.rp_reset_backup_chunks%rowtype;ref jsonb;triggers jsonb;BEGIN
 req:=private.assert_reset_worker(p_request_id,p_token,p_lease);PERFORM set_config('govrp.reset_worker',req.id::text,true);
 SELECT * INTO step FROM private.rp_reset_steps WHERE request_id=req.id AND status<>'completed' ORDER BY ordinal LIMIT 1 FOR UPDATE;
 IF p_kind='backup_chunk' THEN
  SELECT * INTO c FROM private.rp_reset_backup_chunks WHERE id=p_id::bigint AND request_id=req.id;
  IF c.id IS NULL OR step.phase<>'backing_up' OR step.operation->>'pending_chunk' IS DISTINCT FROM p_id OR c.digest IS DISTINCT FROM p_data->>'digest' THEN RAISE EXCEPTION 'O checkpoint não corresponde ao bloco de backup.';END IF;
  IF p_data->>'backup_name' IS DISTINCT FROM c.request_id::text||'/database/'||c.schema_name||'/'||c.table_name||'/'||c.chunk_no::text||'.json' OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='rp-reset-backups' AND name=p_data->>'backup_name') THEN RAISE EXCEPTION 'A cópia física do bloco de backup ainda não foi confirmada.';END IF;
  UPDATE private.rp_reset_backup_chunks SET object_name=p_data->>'backup_name' WHERE id=c.id;
  FOR ref IN SELECT * FROM jsonb_array_elements(coalesce(p_data->'referenced','[]')) LOOP UPDATE private.rp_reset_assets SET status='pending' WHERE request_id=req.id AND bucket_id=ref->>'bucket' AND object_name=ref->>'name' AND status IN('candidate','unclassified');END LOOP;
  FOR ref IN SELECT * FROM jsonb_array_elements(coalesce(p_data->'retained','[]')) LOOP UPDATE private.rp_reset_assets SET status='retained' WHERE request_id=req.id AND bucket_id=ref->>'bucket' AND object_name=ref->>'name';END LOOP;
  UPDATE private.rp_reset_steps SET status=CASE WHEN c.row_count=0 THEN 'completed' ELSE 'running' END,cursor_value=CASE WHEN c.row_count=0 THEN cursor_value ELSE (operation->'pending_cursor')::text END,operation=operation-'pending_chunk'-'pending_cursor'-'pending_count',processed=processed+c.row_count,completed_at=CASE WHEN c.row_count=0 THEN clock_timestamp() ELSE NULL END WHERE id=step.id;
 ELSIF p_kind='archive_asset' THEN
  IF step.phase<>'backup_verification' OR coalesce(p_data->>'digest','')!~'^[0-9a-f]{64}$' OR (p_data->>'bytes')::bigint<0 THEN RAISE EXCEPTION 'O arquivo não possui cópia íntegra confirmada.';END IF;
  UPDATE private.rp_reset_assets SET status='archived',backup_name=p_data->>'backup_name',digest=p_data->>'digest',bytes=(p_data->>'bytes')::bigint WHERE request_id=req.id AND id=p_id::bigint AND status='pending';
 ELSIF p_kind='delete_asset' THEN
  IF step.phase<>'storage' THEN RAISE EXCEPTION 'A limpeza de arquivos não está autorizada nesta etapa.';END IF;
  UPDATE private.rp_reset_assets a SET status='deleted' WHERE request_id=req.id AND id=p_id::bigint AND (status='archived' OR (status='deletable' AND NOT private.reset_backup_enabled(req.id))) AND NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id=a.bucket_id AND o.name=a.object_name) AND (NOT private.reset_backup_enabled(req.id) OR EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='rp-reset-backups' AND o.name=a.backup_name));
  IF NOT FOUND THEN RAISE EXCEPTION 'A cópia ou a exclusão do arquivo ainda não foi confirmada.';END IF;
 ELSIF p_kind='delete_account' THEN
  IF step.phase<>'accounts' OR NOT req.remove_common_accounts OR p_id::uuid<>ALL(req.user_ids) OR EXISTS(SELECT 1 FROM private.platform_admins WHERE user_id=p_id::uuid) OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_id::uuid AND deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'A exclusão protegida desta conta não foi confirmada.';END IF;
  DELETE FROM auth.sessions WHERE user_id=p_id::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.donations WHERE donor_id=p_id::uuid) AND NOT EXISTS(SELECT 1 FROM public.support_tickets WHERE requester_id=p_id::uuid) THEN DELETE FROM private.account_identities WHERE user_id=p_id::uuid;DELETE FROM public.users WHERE auth_user_id=p_id::uuid;END IF;
  triggers:=private.reset_change_triggers('public','profiles');
  UPDATE public.profiles SET deleted_at=clock_timestamp(),anonymized_at=clock_timestamp(),deletion_reason='Conta comum removida no reset de lançamento.' WHERE id=p_id::uuid AND NOT EXISTS(SELECT 1 FROM private.platform_admins WHERE user_id=p_id::uuid);
  PERFORM private.reset_change_triggers('public','profiles',triggers);
  INSERT INTO private.rp_reset_targets(request_id,schema_name,table_name,row_id) VALUES(req.id,'auth','deleted_account_ack',p_id::uuid) ON CONFLICT DO NOTHING;
 ELSE RAISE EXCEPTION 'Tarefa de manutenção inválida.';END IF;
END $$;
CREATE OR REPLACE FUNCTION private.validate_controlled_reset(p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE req private.rp_reset_requests%rowtype;admins jsonb;fk record;join_sql text;not_null_sql text;bad boolean;orphans jsonb:='[]';issues jsonb:='[]';baseline jsonb;BEGIN
 SELECT * INTO req FROM private.rp_reset_requests WHERE id=p_request_id;
 SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY user_id),'[]') INTO admins FROM private.platform_admins a;
 IF admins IS DISTINCT FROM req.admin_snapshot OR EXISTS(SELECT 1 FROM private.platform_admins a LEFT JOIN auth.users u ON u.id=a.user_id LEFT JOIN public.profiles p ON p.id=a.user_id WHERE u.id IS NULL OR u.deleted_at IS NOT NULL OR p.id IS NULL OR p.deleted_at IS NOT NULL OR p.role<>'Admin' OR NOT public.is_admin(a.user_id)) THEN issues:=issues||jsonb_build_array('As identidades e concessões administrativas não correspondem ao snapshot protegido.');END IF;
 IF EXISTS(SELECT 1 FROM public.profiles WHERE deleted_at IS NULL AND (role NOT IN('Admin','Cidadão') OR coalesce(array_length(titles,1),0)>0 OR onboarding_completed)) THEN issues:=issues||jsonb_build_array('Restaram cargos, personagens ou permissões institucionais anteriores.');END IF;
 IF EXISTS(SELECT 1 FROM private.rp_reset_backup_chunks b CROSS JOIN LATERAL jsonb_array_elements(b.payload)x JOIN public.profiles p ON p.id=(x->>'id')::uuid WHERE b.request_id=req.id AND b.schema_name='public' AND b.table_name='profiles' AND p.deleted_at IS NULL AND p.citizen_id=(x->>'citizen_id')::uuid) THEN issues:=issues||jsonb_build_array('Um identificador de personagem anterior permaneceu ativo.');END IF;
 IF private.reset_backup_enabled(req.id) AND (NOT EXISTS(SELECT 1 FROM private.rp_launch_backups WHERE request_id=req.id AND snapshot->>'state'='verified') OR EXISTS(SELECT 1 FROM private.rp_reset_backup_chunks WHERE request_id=req.id AND (NOT verified OR object_name IS NULL OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='rp-reset-backups' AND o.name=object_name)))) THEN issues:=issues||jsonb_build_array('O backup não está integralmente verificado.');END IF;
 IF EXISTS(SELECT 1 FROM private.rp_reset_assets WHERE request_id=req.id AND status NOT IN('retained','deleted')) THEN issues:=issues||jsonb_build_array('Há arquivos pendentes de preservação ou limpeza.');END IF;
 IF req.remove_common_accounts AND EXISTS(SELECT 1 FROM auth.users u WHERE u.id=ANY(req.user_ids) AND u.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM private.platform_admins a WHERE a.user_id=u.id)) THEN issues:=issues||jsonb_build_array('Há contas comuns que ainda possuem acesso.');END IF;
 IF req.remove_common_accounts AND EXISTS(SELECT 1 FROM unnest(req.user_ids)u(id) WHERE NOT EXISTS(SELECT 1 FROM private.platform_admins a WHERE a.user_id=u.id) AND (NOT EXISTS(SELECT 1 FROM private.rp_reset_targets ack WHERE ack.request_id=req.id AND ack.schema_name='auth' AND ack.table_name='deleted_account_ack' AND ack.row_id=u.id) OR EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=u.id AND p.deleted_at IS NULL) OR EXISTS(SELECT 1 FROM auth.sessions s WHERE s.user_id=u.id))) THEN issues:=issues||jsonb_build_array('Há contas com encerramento, sessões ou anonimização ainda pendentes.');END IF;
 IF EXISTS(SELECT 1 FROM cron.job j JOIN private.rp_reset_job_schedules s ON s.job_id=j.jobid WHERE s.request_id=req.id AND j.active) THEN issues:=issues||jsonb_build_array('Uma automação do mundo foi reativada antes da validação.');END IF;
 IF req.preview->'trigger_snapshot' IS DISTINCT FROM (SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'trigger',g.tgname,'enabled',g.tgenabled) ORDER BY n.nspname,c.relname,g.tgname) FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT g.tgisinternal AND n.nspname IN('public','private','auth','storage')) THEN issues:=issues||jsonb_build_array('Uma trigger não retornou ao estado original.');END IF;
 IF req.schema_fingerprint IS DISTINCT FROM private.reset_schema_fingerprint() OR (private.reset_audit()->>'blocked')::boolean THEN issues:=issues||jsonb_build_array('A cobertura do catálogo não corresponde ao esquema atual.');END IF;
 IF NOT EXISTS(SELECT 1 FROM private.rp_reset_steps WHERE request_id=req.id AND phase='checking_relations') OR EXISTS(SELECT 1 FROM private.rp_reset_steps WHERE request_id=req.id AND phase='checking_relations' AND (status<>'completed' OR coalesce((result->>'valid')::boolean,false)=false)) THEN
  issues:=issues||jsonb_build_array('A conferência das relações ainda não foi concluída.');
 END IF;
 IF jsonb_array_length(orphans)>0 THEN issues:=issues||jsonb_build_array('Foram encontradas referências órfãs.');END IF;
 IF NOT EXISTS(SELECT 1 FROM public.business_types) OR NOT EXISTS(SELECT 1 FROM public.economic_resources) OR (SELECT count(*) FROM public.parliament_houses)<2 OR NOT EXISTS(SELECT 1 FROM public.penal_code) OR NOT EXISTS(SELECT 1 FROM public.state_enterprises WHERE is_system) OR NOT EXISTS(SELECT 1 FROM public.country_rp_states WHERE country_code='BR' AND is_playable) OR NOT EXISTS(SELECT 1 FROM public.system_settings WHERE key='bank_policy') OR NOT EXISTS(SELECT 1 FROM public.government_finances WHERE id=1 AND treasury_balance=0 AND loans_balance=0 AND corporate_card_used=0) THEN issues:=issues||jsonb_build_array('A inicialização dos catálogos, instituições ou da economia está incompleta.');END IF;
 RETURN jsonb_build_object('valid',jsonb_array_length(issues)=0,'issues',issues,'orphans',orphans,'preserved_admins',jsonb_array_length(admins),'admin_ids',(SELECT jsonb_agg(a->'user_id') FROM jsonb_array_elements(admins)a),'tables_verified',(SELECT count(*) FROM private.reset_catalog()),'modules_verified',(SELECT count(DISTINCT module) FROM private.reset_catalog()),'jobs_verified',(SELECT count(*) FROM private.rp_reset_job_schedules WHERE request_id=req.id),'auth_accounts_preserved',NOT req.remove_common_accounts,'validation_at',clock_timestamp());
END $$;
CREATE OR REPLACE FUNCTION public.admin_validate_controlled_reset(p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN PERFORM private.assert_reset_operator();IF NOT EXISTS(SELECT 1 FROM private.rp_reset_requests WHERE id=p_request_id AND status IN('validated','completed')) THEN RETURN jsonb_build_object('valid',false,'issues',jsonb_build_array('A execução ainda não concluiu todas as etapas. Consulte o progresso e retome o checkpoint interrompido.'),'preserved_admins',(SELECT count(*) FROM private.platform_admins),'orphans','[]'::jsonb);END IF;RETURN private.validate_controlled_reset(p_request_id);END $$;

CREATE OR REPLACE FUNCTION public.admin_skip_reset_backup(p_request_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET jit=off AS $$
DECLARE actor uuid:=private.assert_reset_operator(true);req private.rp_reset_requests%rowtype;BEGIN
 IF NOT pg_try_advisory_xact_lock(725104,2) THEN RAISE EXCEPTION 'Aguarde o encerramento da etapa atual antes de alterar o backup.';END IF;
 SELECT * INTO req FROM private.rp_reset_requests WHERE id=p_request_id FOR NO KEY UPDATE;
 IF req.id IS NULL OR req.status<>'failed' OR NOT EXISTS(SELECT 1 FROM private.rp_reset_runtime WHERE id AND maintenance AND request_id=req.id) THEN RAISE EXCEPTION 'O backup só pode ser dispensado em uma execução interrompida antes da limpeza.';END IF;
 IF NOT private.reset_backup_enabled(req.id) THEN RETURN;END IF;
 IF EXISTS(SELECT 1 FROM private.rp_reset_steps WHERE request_id=req.id AND phase IN('detaching','clearing','profiles','initializing','storage','accounts','validating','checking_relations','final_validation') AND status<>'pending') THEN RAISE EXCEPTION 'A limpeza já foi iniciada. A opção de backup desta execução não pode mais ser alterada.';END IF;
 UPDATE private.rp_reset_requests SET preview=preview||jsonb_build_object('create_backup',false),lease_id=NULL,lease_until=NULL WHERE id=req.id;
 UPDATE private.rp_reset_steps s SET status='completed',completed_at=clock_timestamp(),result=result||jsonb_build_object('skipped','Backup dispensado pelo administrador.'),operation=operation-'pending_chunk'-'pending_cursor'-'pending_count'
 WHERE request_id=req.id AND phase='backing_up' AND status<>'completed' AND NOT EXISTS(SELECT 1 FROM private.reset_catalog()c WHERE c.schema_name=s.schema_name AND c.table_name=s.table_name AND (c.strategy='keep' OR c.table_name='profiles'));
 UPDATE private.rp_reset_steps SET phase='preserving',status='pending',operation=operation-'pending_chunk'-'pending_cursor'-'pending_count' WHERE request_id=req.id AND phase='backing_up' AND status<>'completed';
 INSERT INTO private.rp_reset_targets(request_id,schema_name,table_name,row_id) SELECT req.id,'public','products',id FROM public.products WHERE NOT private.is_reset_system_offer(id) ON CONFLICT DO NOTHING;
 INSERT INTO private.rp_reset_targets(request_id,schema_name,table_name,row_id) SELECT req.id,'public','investment_options',id FROM public.investment_options WHERE business_id IS NOT NULL ON CONFLICT DO NOTHING;
 INSERT INTO private.rp_reset_job_events(request_id,kind,details) VALUES(req.id,'backup_dispensed',jsonb_build_object('actor',actor,'prior_chunks_preserved',true));
END $$;
REVOKE ALL ON FUNCTION public.admin_skip_reset_backup(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_skip_reset_backup(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.admin_get_controlled_reset(p_request_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET jit=off AS $$
DECLARE req record;BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Acompanhamento disponível apenas para administradores ativos.' USING errcode='42501';END IF;
 SELECT id,status,reset_mode,remove_common_accounts,started_at,validated_at,reopened_at,current_phase,last_error,result,coalesce((preview->>'create_backup')::boolean,true) create_backup INTO req FROM private.rp_reset_requests WHERE scope='full_rp' AND (p_request_id IS NULL OR id=p_request_id) ORDER BY started_at DESC NULLS LAST,created_at DESC LIMIT 1;
 IF req.id IS NULL THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('id',req.id,'status',req.status,'reset_mode',req.reset_mode,'remove_common_accounts',req.remove_common_accounts,'create_backup',req.create_backup,'started_at',req.started_at,'validated_at',req.validated_at,'reopened_at',req.reopened_at,'current_phase',req.current_phase,
 'last_error',CASE WHEN req.last_error IS NULL THEN NULL ELSE jsonb_build_object('message',CASE WHEN req.last_error->>'sqlstate'='57014' OR req.last_error->>'message' ILIKE '%statement timeout%' THEN 'Esta etapa excedeu o tempo disponível. O checkpoint foi preservado; retome para continuar.' WHEN req.last_error->>'sqlstate'='55P03' THEN 'Esta etapa aguardou outra operação. Retome para continuar do checkpoint.' ELSE req.last_error->>'message' END,'phase',req.last_error->>'phase','table',req.last_error->>'table') END,
 'result',req.result,'steps',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'ordinal',ordinal,'phase',phase,'schema_name',schema_name,'table_name',table_name,'status',status,'processed',processed,'started_at',started_at,'completed_at',completed_at,'elapsed_ms',elapsed_ms) ORDER BY ordinal),'[]') FROM (SELECT * FROM (SELECT * FROM private.rp_reset_steps WHERE request_id=req.id AND status='completed' ORDER BY ordinal DESC LIMIT 10)a UNION ALL SELECT * FROM (SELECT * FROM private.rp_reset_steps WHERE request_id=req.id AND status<>'completed' ORDER BY ordinal LIMIT 30)b)visible),
 'progress',(SELECT jsonb_build_object('total',count(*),'completed',count(*) FILTER(WHERE status='completed'),'processed',coalesce(sum(processed),0)) FROM private.rp_reset_steps WHERE request_id=req.id),
 'backup',(SELECT jsonb_build_object('state',snapshot->>'state','records',(SELECT coalesce(sum(row_count),0) FROM private.rp_reset_backup_chunks WHERE request_id=req.id)) FROM private.rp_launch_backups WHERE request_id=req.id),
 'files',(SELECT jsonb_build_object('total',count(*),'archived',count(*)FILTER(WHERE status='archived'),'deleted',count(*)FILTER(WHERE status='deleted'),'retained',count(*)FILTER(WHERE status='retained')) FROM private.rp_reset_assets WHERE request_id=req.id));
END $$;

CREATE OR REPLACE FUNCTION public.admin_resume_controlled_reset(p_request_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE actor uuid:=private.assert_reset_operator(true);req private.rp_reset_requests%rowtype;BEGIN SELECT * INTO req FROM private.rp_reset_requests WHERE id=p_request_id FOR UPDATE;IF req.status<>'failed' OR NOT EXISTS(SELECT 1 FROM private.rp_reset_runtime WHERE id AND maintenance AND request_id=req.id) THEN RAISE EXCEPTION 'Esta execução não está aguardando recuperação.';END IF;IF req.schema_fingerprint IS DISTINCT FROM private.reset_schema_fingerprint() THEN RAISE EXCEPTION 'Revise a alteração de esquema com o operador técnico antes de retomar.';END IF;UPDATE private.rp_reset_steps SET status='pending',last_error=NULL WHERE request_id=req.id AND status='failed';UPDATE private.rp_reset_requests SET status='draining',last_error=NULL,lease_id=NULL,lease_until=NULL WHERE id=req.id;PERFORM cron.alter_job(jobid,active:=true) FROM cron.job WHERE jobname='govrp-controlled-reset-worker';INSERT INTO private.rp_reset_job_events(request_id,kind,details) VALUES(req.id,'reset_resumed',jsonb_build_object('actor',actor));END $$;
CREATE OR REPLACE FUNCTION public.admin_reopen_reset_world(p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE actor uuid:=private.assert_reset_operator(true);req private.rp_reset_requests%rowtype;validation jsonb;s record;BEGIN SELECT * INTO req FROM private.rp_reset_requests WHERE id=p_request_id FOR UPDATE;IF req.status='completed' THEN RETURN req.result;END IF;IF req.status<>'validated' THEN RAISE EXCEPTION 'O mundo só pode ser reaberto após validação integral.';END IF;validation:=private.validate_controlled_reset(req.id);IF NOT (validation->>'valid')::boolean THEN RAISE EXCEPTION 'A validação atual exige revisão. A manutenção será mantida.';END IF;PERFORM set_config('govrp.reset_worker',req.id::text,true);PERFORM set_config('request.headers',(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb||jsonb_build_object('x-govrp-world-generation',(SELECT generation_id::text FROM private.rp_reset_runtime WHERE id)))::text,true);UPDATE private.rp_reset_requests SET status='completed',completed_at=clock_timestamp(),reopened_at=clock_timestamp(),lease_id=NULL,lease_until=NULL WHERE id=req.id;UPDATE private.rp_reset_runtime SET maintenance=false,request_id=NULL,changed_at=clock_timestamp() WHERE id AND request_id=req.id;FOR s IN SELECT * FROM private.rp_reset_job_schedules WHERE request_id=req.id LOOP IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobid=s.job_id AND command=s.command AND schedule=s.schedule) THEN RAISE EXCEPTION 'Um agendamento mudou durante o reset. Revise antes de reabrir.';END IF;PERFORM cron.alter_job(s.job_id,active:=s.was_active);END LOOP;INSERT INTO private.rp_reset_job_events(request_id,kind,details) VALUES(req.id,'world_reopened',jsonb_build_object('actor',actor,'generation',req.generation_after));RETURN validation||jsonb_build_object('success',true,'request_id',req.id);END $$;
CREATE OR REPLACE FUNCTION public.admin_finish_reset_worker(p_request_id uuid,p_token text,p_lease uuid,p_error text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE req private.rp_reset_requests%rowtype;BEGIN IF NOT pg_try_advisory_xact_lock(725104,2) THEN RETURN;END IF;SELECT * INTO req FROM private.rp_reset_requests WHERE id=p_request_id FOR NO KEY UPDATE NOWAIT;IF req.lease_id IS DISTINCT FROM p_lease OR extensions.digest(p_token,'sha256') IS DISTINCT FROM extensions.digest(req.worker_token,'sha256') THEN RETURN;END IF;IF p_error IS NOT NULL AND req.status NOT IN('failed','validated','completed') THEN UPDATE private.rp_reset_requests SET status='failed',last_error=jsonb_build_object('message',left(p_error,1500),'phase',current_phase,'at',clock_timestamp()) WHERE id=req.id;UPDATE private.rp_reset_steps SET status='failed',last_error=jsonb_build_object('message',left(p_error,1500)) WHERE id=(SELECT id FROM private.rp_reset_steps WHERE request_id=req.id AND status<>'completed' ORDER BY ordinal LIMIT 1);INSERT INTO private.rp_reset_job_events(request_id,kind,details) VALUES(req.id,'worker_interrupted',jsonb_build_object('message',left(p_error,1500)));PERFORM cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='govrp-controlled-reset-worker';END IF;UPDATE private.rp_reset_requests SET lease_id=NULL,lease_until=NULL WHERE id=req.id;EXCEPTION WHEN lock_not_available THEN RETURN;END $$;
CREATE OR REPLACE FUNCTION private.guard_storage_generation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE state private.rp_reset_runtime%rowtype;claims jsonb:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;role_name text:=claims->>'role';bucket text;object_key text;BEGIN
 bucket:=CASE WHEN TG_OP='DELETE' THEN OLD.bucket_id ELSE NEW.bucket_id END;object_key:=CASE WHEN TG_OP='DELETE' THEN OLD.name ELSE NEW.name END;
 IF NOT pg_try_advisory_xact_lock_shared(725104,2) THEN RAISE EXCEPTION 'Os arquivos do universo estão em manutenção.' USING errcode='55000';END IF;
 SELECT * INTO state FROM private.rp_reset_runtime WHERE id;
 IF bucket='rp-reset-backups' AND (role_name='service_role' OR private.reset_worker_context()) THEN IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;END IF;
 IF NOT pg_try_advisory_xact_lock_shared(725104,2) THEN RAISE EXCEPTION 'Os arquivos do universo estão em manutenção.' USING errcode='55000';END IF;
 IF bucket='support-attachments' THEN IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;END IF;
 IF state.maintenance THEN
  IF TG_OP='DELETE' AND role_name='service_role' AND EXISTS(SELECT 1 FROM private.rp_reset_assets a JOIN private.rp_reset_requests r ON r.id=a.request_id WHERE a.request_id=state.request_id AND a.bucket_id=bucket AND a.object_name=object_key AND (a.status='archived' OR (a.status='deletable' AND NOT private.reset_backup_enabled(r.id))) AND r.current_phase='storage') THEN RETURN OLD;END IF;
  RAISE EXCEPTION 'Os arquivos do universo estão em manutenção.' USING errcode='55000';
 END IF;
 IF role_name='authenticated' AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Esta conta não possui mais acesso ao universo.' USING errcode='42501';END IF;
 IF state.enforce_generation AND (role_name IS NOT NULL OR session_user NOT IN('postgres','supabase_admin')) AND (CASE WHEN TG_OP='DELETE' THEN OLD.user_metadata->>'world_generation' ELSE NEW.user_metadata->>'world_generation' END) IS DISTINCT FROM state.generation_id::text THEN RAISE EXCEPTION 'Este arquivo pertence a uma geração anterior do universo. Tente novamente pela sessão atual.' USING errcode='55000';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;

-- Add receipts to a pending run without restarting it or changing its scope.
-- No gameplay data is deleted and no failed worker is resumed by this migration.
DO $$DECLARE r record;k record;n integer;BEGIN
 FOR r IN SELECT id FROM private.rp_reset_requests WHERE started_at IS NOT NULL AND status NOT IN('completed','cancelled','expired','draft') LOOP
  IF NOT EXISTS(SELECT 1 FROM private.rp_reset_steps WHERE request_id=r.id AND phase='checking_relations') THEN
   SELECT coalesce(max(ordinal),0)+1 INTO n FROM private.rp_reset_steps WHERE request_id=r.id;
   UPDATE private.rp_reset_steps SET ordinal=n+(SELECT count(*)+1 FROM pg_constraint relation_count JOIN pg_namespace ns ON ns.oid=relation_count.connamespace WHERE relation_count.contype='f' AND ns.nspname IN('public','private','economy_private')) WHERE request_id=r.id AND phase='final_validation';
   FOR k IN SELECT c.oid FROM pg_constraint c JOIN pg_namespace ns ON ns.oid=c.connamespace WHERE c.contype='f' AND ns.nspname IN('public','private','economy_private') ORDER BY c.oid LOOP
    INSERT INTO private.rp_reset_steps(request_id,ordinal,phase,operation) VALUES(r.id,n,'checking_relations',jsonb_build_object('constraint_oid',k.oid));n:=n+1;
   END LOOP;
  END IF;
 END LOOP;
END $$;
DO $$DECLARE f record;BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('private','public') AND p.proname IN('reset_backup_enabled','reset_retain_asset_references','admin_process_reset_batch','admin_claim_reset_worker','admin_ack_reset_task','admin_finish_reset_worker','validate_controlled_reset','admin_validate_controlled_reset','plan_controlled_reset','admin_start_controlled_reset','admin_resume_controlled_reset','admin_reopen_reset_world') LOOP
  EXECUTE format('ALTER FUNCTION %s SET jit=off',f.signature);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION private.reset_backup_enabled(uuid),private.reset_retain_asset_references(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
