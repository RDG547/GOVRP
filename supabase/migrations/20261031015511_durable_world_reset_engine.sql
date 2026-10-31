BEGIN;
-- Preserve the existing request/backup identities and their historical records.
ALTER TABLE private.rp_reset_requests ADD COLUMN status text NOT NULL DEFAULT 'draft',ADD COLUMN reset_mode text NOT NULL DEFAULT 'universe',ADD COLUMN remove_common_accounts boolean NOT NULL DEFAULT false,ADD COLUMN generation_before uuid,ADD COLUMN generation_after uuid,ADD COLUMN admin_snapshot jsonb NOT NULL DEFAULT '[]',ADD COLUMN schema_fingerprint text,ADD COLUMN worker_token text,ADD COLUMN lease_id uuid,ADD COLUMN lease_until timestamptz,ADD COLUMN started_at timestamptz,ADD COLUMN validated_at timestamptz,ADD COLUMN reopened_at timestamptz,ADD COLUMN last_error jsonb,ADD COLUMN current_phase text,ADD COLUMN attempts integer NOT NULL DEFAULT 0;
UPDATE private.rp_reset_requests SET status=CASE WHEN completed_at IS NOT NULL THEN 'completed' ELSE 'expired' END;
ALTER TABLE private.rp_reset_requests ADD CONSTRAINT reset_request_status CHECK(status IN('draft','expired','draining','backing_up','detaching','clearing','initializing','storage','accounts','validating','validated','failed','completed','cancelled')),ADD CONSTRAINT reset_request_mode CHECK(reset_mode IN('universe','launch'));
CREATE UNIQUE INDEX rp_reset_single_active ON private.rp_reset_requests((true)) WHERE status IN('draining','backing_up','detaching','clearing','initializing','storage','accounts','validating','validated','failed');
CREATE TABLE private.rp_reset_runtime(id boolean PRIMARY KEY DEFAULT true CHECK(id),generation_id uuid NOT NULL DEFAULT gen_random_uuid(),maintenance boolean NOT NULL DEFAULT false,request_id uuid REFERENCES private.rp_reset_requests(id),changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),generation_started_at timestamptz NOT NULL DEFAULT clock_timestamp(),enforce_generation boolean NOT NULL DEFAULT false,worker_endpoint text NOT NULL DEFAULT 'https://govrp.vercel.app/api/admin/reset-worker');
CREATE TABLE private.rp_reset_steps(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,request_id uuid NOT NULL REFERENCES private.rp_reset_requests(id),ordinal integer NOT NULL,phase text NOT NULL,schema_name text,table_name text,operation jsonb NOT NULL DEFAULT '{}',status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','running','completed','failed')),cursor_value text,processed bigint NOT NULL DEFAULT 0,attempts integer NOT NULL DEFAULT 0,started_at timestamptz,completed_at timestamptz,elapsed_ms numeric NOT NULL DEFAULT 0,last_error jsonb,result jsonb NOT NULL DEFAULT '{}',UNIQUE(request_id,ordinal));
CREATE INDEX reset_steps_pending ON private.rp_reset_steps(request_id,ordinal) WHERE status<>'completed';
CREATE TABLE private.rp_reset_backup_chunks(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,request_id uuid NOT NULL REFERENCES private.rp_reset_requests(id),schema_name text NOT NULL,table_name text NOT NULL,chunk_no integer NOT NULL,payload jsonb NOT NULL,digest text NOT NULL,row_count integer NOT NULL,verified boolean NOT NULL DEFAULT false,object_name text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(request_id,schema_name,table_name,chunk_no));
CREATE TABLE private.rp_reset_assets(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,request_id uuid NOT NULL REFERENCES private.rp_reset_requests(id),bucket_id text NOT NULL,object_name text NOT NULL,original_metadata jsonb NOT NULL DEFAULT '{}',backup_name text,status text NOT NULL DEFAULT 'pending',digest text,bytes bigint,last_error jsonb,UNIQUE(request_id,bucket_id,object_name));
CREATE TABLE private.rp_reset_targets(request_id uuid NOT NULL REFERENCES private.rp_reset_requests(id),schema_name text NOT NULL,table_name text NOT NULL,row_id uuid NOT NULL,PRIMARY KEY(request_id,schema_name,table_name,row_id));
CREATE TABLE private.rp_reset_job_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,request_id uuid NOT NULL REFERENCES private.rp_reset_requests(id),step_id bigint REFERENCES private.rp_reset_steps(id),kind text NOT NULL,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE private.rp_reset_job_schedules(request_id uuid NOT NULL REFERENCES private.rp_reset_requests(id),job_id bigint NOT NULL,job_name text NOT NULL,command text NOT NULL,schedule text NOT NULL,was_active boolean NOT NULL,PRIMARY KEY(request_id,job_id));
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['rp_reset_runtime','rp_reset_steps','rp_reset_backup_chunks','rp_reset_assets','rp_reset_targets','rp_reset_job_events','rp_reset_job_schedules'] LOOP EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC,anon,authenticated',t);END LOOP;END $$;
-- Administrative grants belong to Auth identities, never to a disposable character.
ALTER TABLE private.platform_admins DROP CONSTRAINT platform_admins_user_id_fkey;
ALTER TABLE private.platform_admins ADD CONSTRAINT platform_admins_user_id_fkey FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
CREATE FUNCTION private.reset_catalog() RETURNS TABLE(schema_name text,table_name text,classification text,strategy text,module text,backup boolean) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT 'public',p.table_name,CASE WHEN p.table_name IN('donations','donation_webhook_events','support_tickets','support_ticket_messages','security_audit_log') THEN 'D' WHEN p.table_name='users' THEN 'C' WHEN p.reset_mode='clear' THEN 'A' ELSE 'B' END,
 CASE WHEN p.table_name IN('products','investment_options') THEN 'mixed' ELSE p.reset_mode END,
 CASE WHEN p.table_name~'^(x_|post|comment|likes|followers|repost|stories|trends|messages|notifications)' THEN 'Comunicação' WHEN p.table_name~'(election|candidac|electoral|voting)' THEN 'Eleições' WHEN p.table_name~'^(parliament|bill|law|decree|dou|constitution|legal_)' THEN 'Parlamento e normas' WHEN p.table_name~'^(agies)' THEN 'AGIES' WHEN p.table_name~'(justice|criminal|case_|police|prison|sentence|judicial|warrant|fine|appeal|investigation|hearing|penal)' THEN 'Justiça e segurança' WHEN p.table_name~'(part(y|ies)|coalition|alliance)' THEN 'Partidos' WHEN p.table_name~'(business|company|employee|job_|professional|procurement)' THEN 'Empresas e trabalho' WHEN p.table_name~'(account|card|invoice|loan|bank|transaction|payment|bill_of|investment|stock|dividend|currency|exchange)' THEN 'Banco e mercados' WHEN p.table_name~'(residence|housing|lease|room)' THEN 'Moradia' WHEN p.table_name~'(product|cart|market|order|sale|subscription|commerce)' THEN 'Comércio' WHEN p.table_name~'(government|minister|executive|presiden|official)' THEN 'Governo' WHEN p.table_name~'(country|economic|population|price_|infrastructure|region)' THEN 'Economia e infraestrutura' WHEN p.table_name~'(citizen|user_|achievement|inventory|check_in|social)' OR p.table_name='profiles' THEN 'Cidadãos' WHEN p.table_name~'(donation|support|audit|security)' THEN 'Registros protegidos' ELSE 'Serviços e configurações' END,true FROM private.rp_reset_policy()p
 UNION ALL SELECT 'private',t.name,t.classification,t.strategy,'Controle e dados privados',t.backup FROM (VALUES
 ('account_identities','C','keep',true),('admin_development_modes','C','keep',true),('platform_admins','C','keep',true),('deleted_user_snapshots','D','keep',false),('rp_reset_requests','B','keep',false),('rp_launch_backups','B','keep',false),('rp_reset_runtime','B','keep',false),('rp_reset_steps','B','keep',false),('rp_reset_backup_chunks','B','keep',false),('rp_reset_assets','B','keep',false),('rp_reset_targets','B','keep',false),('rp_reset_job_events','B','keep',false),('rp_reset_job_schedules','B','keep',false),
 ('agies_task_answers','A','clear',true),('business_daily_effort','A','clear',true),('citizen_need_actions','A','clear',true),('company_operations','A','clear',true),('infrastructure_maintenance','A','clear',true),('population_demand_runs','A','clear',true),('professional_work_answers','A','clear',true),('recurring_billing_cycles','A','clear',true))t(name,classification,strategy,backup)
 UNION ALL SELECT n.nspname,c.relname,CASE WHEN n.nspname='auth' THEN 'C' ELSE 'B' END,'managed',CASE n.nspname WHEN 'auth' THEN 'Autenticação' WHEN 'storage' THEN 'Arquivos' ELSE 'Agendamentos' END,n.nspname='auth' AND c.relname IN('users','identities') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('auth','storage','cron') AND c.relkind IN('r','p');
$$;
CREATE FUNCTION private.reset_schema_fingerprint() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT encode(extensions.digest(coalesce(string_agg(x.item,'|' ORDER BY x.item),''),'sha256'),'hex') FROM (
 SELECT 'table:'||n.nspname||'.'||c.relname||':'||a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'') item FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname IN('public','private','economy_private') AND c.relkind IN('r','p')
 UNION ALL SELECT 'fk:'||n.nspname||'.'||c.relname||':'||k.conname||':'||pg_get_constraintdef(k.oid) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private','economy_private') AND k.contype='f')x;
$$;
CREATE FUNCTION public.get_world_runtime() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT jsonb_build_object('generation_id',generation_id,'maintenance',maintenance,'changed_at',changed_at,'generation_started_at',generation_started_at,'enforce_generation',enforce_generation) FROM private.rp_reset_runtime WHERE id $$;
REVOKE ALL ON FUNCTION public.get_world_runtime() FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.get_world_runtime() TO anon,authenticated,service_role;
CREATE FUNCTION private.publish_world_runtime() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN INSERT INTO public.system_settings(key,value) VALUES('world_runtime',public.get_world_runtime()) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=clock_timestamp();RETURN NEW;END $$;
CREATE TRIGGER publish_world_runtime AFTER INSERT OR UPDATE ON private.rp_reset_runtime FOR EACH ROW EXECUTE FUNCTION private.publish_world_runtime();
INSERT INTO private.rp_reset_runtime(id) VALUES(true);
CREATE FUNCTION private.assert_reset_operator(p_recent boolean DEFAULT false) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE actor uuid:=private.assert_reset_admin();BEGIN IF p_recent AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=actor AND last_sign_in_at>=clock_timestamp()-interval '30 minutes') THEN RAISE EXCEPTION 'Confirme novamente seu login antes de iniciar, retomar ou reabrir um reset.' USING errcode='42501';END IF;RETURN actor;END $$;
CREATE FUNCTION private.reset_audit() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE result jsonb;unknowns jsonb;unknown_buckets jsonb;BEGIN
 SELECT coalesce(jsonb_agg(n.nspname||'.'||c.relname),'[]') INTO unknowns FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private','economy_private') AND c.relkind IN('r','p') AND NOT EXISTS(SELECT 1 FROM private.reset_catalog()p WHERE p.schema_name=n.nspname AND p.table_name=c.relname);
 SELECT jsonb_build_object('tables',coalesce(jsonb_agg(jsonb_build_object('schema',p.schema_name,'table',p.table_name,'classification',p.classification,'strategy',p.strategy,'module',p.module,'estimated_rows',greatest(c.reltuples::bigint,0),'bytes',pg_total_relation_size(c.oid),'backup',p.backup) ORDER BY p.schema_name,p.table_name),'[]'),'table_count',count(*),'module_count',count(DISTINCT p.module),'estimated_records',coalesce(sum(greatest(c.reltuples::bigint,0)) FILTER(WHERE p.classification='A' OR p.strategy='reset'),0)) INTO result FROM private.reset_catalog()p JOIN pg_class c ON c.oid=to_regclass(format('%I.%I',p.schema_name,p.table_name));
 SELECT coalesce(jsonb_agg(id),'[]') INTO unknown_buckets FROM storage.buckets WHERE id<>ALL(ARRAY['product-images','profiles','x-avatars','headers','stories','post-images','post-videos','public-assets','avatars','x-message-attachments','support-attachments','rp-reset-backups']);
 RETURN result||jsonb_build_object('unknown_buckets',unknown_buckets,'unknown_tables',unknowns,'blocked',jsonb_array_length(unknowns)>0 OR jsonb_array_length(unknown_buckets)>0,'schema_fingerprint',private.reset_schema_fingerprint(),'admins',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.user_id,'granted_at',a.granted_at,'auth_valid',u.id IS NOT NULL AND u.deleted_at IS NULL,'profile_valid',p.id IS NOT NULL AND p.deleted_at IS NULL) ORDER BY a.user_id),'[]') FROM private.platform_admins a LEFT JOIN auth.users u ON u.id=a.user_id LEFT JOIN public.profiles p ON p.id=a.user_id),'auth_accounts',(SELECT count(*) FROM auth.users WHERE deleted_at IS NULL),'jobs',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',jobid,'name',jobname,'schedule',schedule,'active',active)),'[]') FROM cron.job WHERE jobname<>'govrp-controlled-reset-worker'),'storage',(SELECT coalesce(jsonb_agg(jsonb_build_object('bucket',b.id,'objects',(SELECT count(*) FROM storage.objects o WHERE o.bucket_id=b.id))),'[]') FROM storage.buckets b WHERE b.id<>'rp-reset-backups'),'views',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private','economy_private') AND c.relkind IN('v','m')),'triggers',(SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname IN('public','private','economy_private')));
END $$;
CREATE FUNCTION public.admin_analyze_rp_reset() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN PERFORM private.assert_reset_operator();RETURN private.reset_audit();END $$;
REVOKE ALL ON FUNCTION public.admin_analyze_rp_reset() FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.admin_analyze_rp_reset() TO authenticated;
-- These are the deterministic IDs of the existing official product seeds.
CREATE FUNCTION private.is_reset_system_offer(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_id IN(SELECT ('f2100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,15)n UNION ALL SELECT ('f2100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(21,23)n UNION ALL SELECT ('f2200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,5)n UNION ALL SELECT md5('govrp-housing:'||r.code||':'||tier)::uuid FROM public.economic_regions r CROSS JOIN generate_series(1,3)tier UNION ALL SELECT md5('govrp:catalog:soap')::uuid UNION ALL SELECT md5('govrp:catalog:mansion:DF')::uuid)
$$;
REVOKE ALL ON FUNCTION private.is_reset_system_offer(uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION private.reset_predicate(p_table text,p_alias text DEFAULT 'r') RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT CASE p_table WHEN 'products' THEN 'NOT private.is_reset_system_offer('||p_alias||'.id)' WHEN 'investment_options' THEN p_alias||'.business_id IS NOT NULL' ELSE 'true' END $$;
-- Fast full previews never enumerate historical keys. Partial resets keep the existing relational planner.
ALTER FUNCTION private.build_rp_reset_plan(text,uuid[]) RENAME TO build_rp_reset_plan_atomic;
CREATE FUNCTION private.build_rp_reset_plan(p_scope text,p_user_ids uuid[]) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$ DECLARE audit jsonb;BEGIN IF p_scope<>'full_rp' THEN RETURN private.build_rp_reset_plan_atomic(p_scope,p_user_ids);END IF;audit:=private.reset_audit();IF (audit->>'blocked')::boolean THEN RAISE EXCEPTION 'Existem tabelas sem classificação de reset. Consulte o diagnóstico antes de continuar.';END IF;RETURN audit||jsonb_build_object('users',cardinality(p_user_ids),'total_records',audit->'estimated_records','records_are_estimates',true,'records',(SELECT jsonb_object_agg(t->>'schema'||'.'||(t->>'table'),t->'estimated_rows') FROM jsonb_array_elements(audit->'tables')t));END $$;
-- Keep current validation of trusted country references and of the selected account scope.
CREATE OR REPLACE FUNCTION public.admin_prepare_rp_reset(p_scope text, p_user_ids uuid[] DEFAULT '{}'::uuid[], p_reason text DEFAULT ''::text, p_country_snapshots jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=private.assert_reset_admin(); v_ids uuid[]; v_preview jsonb; v_id uuid; s jsonb; k text;
begin
  if p_scope is null or p_scope not in ('selected_users','all_users','full_rp') then raise exception 'Escopo de reset inválido.'; end if;
  p_reason:=trim(coalesce(p_reason,''));
  if char_length(p_reason)>500 then raise exception 'O motivo deve ter no máximo 500 caracteres.'; end if;
  if p_scope='selected_users' then
    select array_agg(distinct x order by x) into v_ids from unnest(p_user_ids) x where x is not null;
    if coalesce(cardinality(v_ids),0)=0 or exists(
      select 1 from unnest(v_ids) x where not exists(select 1 from public.profiles where id=x and deleted_at is null)
    ) then raise exception 'Selecione contas ativas e válidas.'; end if;
  else
    if coalesce(cardinality(p_user_ids),0)>0 then raise exception 'O reset global não aceita uma seleção parcial.'; end if;
    select coalesce(array_agg(id order by id),'{}') into v_ids from public.profiles where deleted_at is null;
  end if;
  if p_scope='full_rp' then
    if jsonb_typeof(p_country_snapshots) is distinct from 'array' or jsonb_array_length(p_country_snapshots)=0 then
      raise exception 'Consulte os indicadores reais antes de resetar o RP.';
    end if;
    if exists(select 1 from jsonb_array_elements(p_country_snapshots) x group by x->>'country_code' having count(*)>1)
      or exists(select 1 from public.country_rp_states c where c.is_playable and not exists(
        select 1 from jsonb_array_elements(p_country_snapshots) x where x->>'country_code'=c.country_code))
      or exists(select 1 from jsonb_array_elements(p_country_snapshots) x where x->>'country_code'<>'BR'
        and not exists(select 1 from public.country_rp_states c where c.is_playable and c.country_code=x->>'country_code'))
      or not exists(select 1 from jsonb_array_elements(p_country_snapshots) x where x->>'country_code'='BR') then
      raise exception 'A referência real precisa incluir o Brasil e todos os países ativos, sem duplicatas.';
    end if;
    for s in select * from jsonb_array_elements(p_country_snapshots) loop
      if coalesce(s->>'country_code','') !~ '^[A-Z]{2}$' or nullif(trim(s->>'country_name'),'') is null
        or jsonb_typeof(s->'economy') is distinct from 'object'
        or jsonb_typeof(s->'demographics') is distinct from 'object'
        or jsonb_typeof(s->'politics') is distinct from 'object'
        or (s->>'fetched_at')::timestamptz is null
        or (s->>'fetched_at')::timestamptz < clock_timestamp()-interval '30 minutes'
        or (s->>'fetched_at')::timestamptz > clock_timestamp()+interval '1 minute' then
        raise exception 'A fotografia real está incompleta ou expirada.';
      end if;
      foreach k in array array['gdp','growth','inflation','unemployment','exchangeUsd','exchangeEur'] loop
        if jsonb_typeof(s->'economy'->k) is distinct from 'number' then raise exception 'Indicador real ausente: %.',k; end if;
      end loop;
      if (s->'economy'->>'gdp')::numeric<=0 or (s->'economy'->>'exchangeUsd')::numeric<=0
        or (s->'economy'->>'exchangeEur')::numeric<=0
        or coalesce((s->'demographics'->>'population')::numeric,0)<=0
        or s->'economy'->>'gdpCurrency' is distinct from 'USD'
        or coalesce(jsonb_array_length(s->'economy'->'referenceSources'),0)=0 then
        raise exception 'Os valores de referência reais são inválidos.';
      end if;
      if s->>'country_code'='BR' then
        if jsonb_typeof(s->'economy'->'selic') is distinct from 'number'
          or (s->'economy'->>'selic')::numeric not between 0 and 100 then raise exception 'A Selic real é obrigatória e deve ser válida.'; end if;
        foreach k in array array['USD','EUR','GBP','JPY','CNY'] loop
          if jsonb_typeof(s->'exchange_rates'->k) is distinct from 'number' or (s->'exchange_rates'->>k)::numeric<=0 then
            raise exception 'Cotação real ausente: %.',k;
          end if;
        end loop;
      end if;
    end loop;
  else p_country_snapshots:='[]'; end if;
  v_preview:=private.build_rp_reset_plan(p_scope,v_ids);
  insert into private.rp_reset_requests(requested_by,scope,user_ids,reason,country_snapshots,preview)
  values(v_actor,p_scope,v_ids,trim(p_reason),p_country_snapshots,v_preview) returning id into v_id;
  return v_preview || jsonb_build_object('request_id',v_id,'scope',p_scope,'expires_in_seconds',900,
    'confirmation',CASE WHEN p_scope='full_rp' THEN 'RESETAR GOVRP' ELSE 'RESETAR' END);
end; $function$

;

CREATE FUNCTION public.admin_configure_reset_request(p_request_id uuid,p_mode text,p_remove_common_accounts boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE actor uuid:=private.assert_reset_operator();BEGIN IF p_mode NOT IN('universe','launch') OR p_remove_common_accounts AND p_mode<>'launch' THEN RAISE EXCEPTION 'A exclusão de contas comuns exige o modo de lançamento.';END IF;UPDATE private.rp_reset_requests SET reset_mode=p_mode,remove_common_accounts=p_remove_common_accounts WHERE id=p_request_id AND requested_by=actor AND scope='full_rp' AND status='draft' AND expires_at>clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'Prepare uma prévia válida antes de configurar o reset.';END IF;END $$;
REVOKE ALL ON FUNCTION public.admin_configure_reset_request(uuid,text,boolean) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.admin_configure_reset_request(uuid,text,boolean) TO authenticated;
DO $$DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname IN('reset_catalog','reset_schema_fingerprint','publish_world_runtime','assert_reset_operator','reset_audit','reset_predicate','build_rp_reset_plan') LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);END LOOP;END $$;
COMMIT;
