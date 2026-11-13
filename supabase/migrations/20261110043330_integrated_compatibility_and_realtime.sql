BEGIN;
-- Extend the installed definitions. No prior version is restored.
DO $$ DECLARE body text;BEGIN
 body:=pg_get_functiondef('public.set_admin_development_mode(text,text,boolean)'::regprocedure);
 EXECUTE replace(body,quote_literal('Promotor'),quote_literal('Promotor')||','||quote_literal('Procurador-Geral da República'));
 body:=pg_get_functiondef('public.resolve_investigation(uuid,text,text,text)'::regprocedure);
 EXECUTE replace(body,quote_literal('Promotor'),quote_literal('Promotor')||','||quote_literal('Procurador-Geral da República'));
 body:=pg_get_functiondef('public.justice_has_role(text[])'::regprocedure);
 body:=replace(body,'CROSS JOIN LATERAL unnest(public.official_role_capabilities(p.role)) cap','CROSS JOIN LATERAL unnest(ARRAY[p.role]||coalesce(p.titles,''{}'')) title CROSS JOIN LATERAL unnest(public.official_role_capabilities(title)) cap');
 EXECUTE body;
 -- Reading administrative data must also work in preview mode.
 body:=pg_get_functiondef('public.get_public_competition_admin(uuid)'::regprocedure);
 EXECUTE replace(body,'PERFORM private.require_competition_admin();','IF auth.uid() IS NULL OR NOT public.has_full_admin_access() THEN RAISE EXCEPTION ''Acesso administrativo exigido.'' USING errcode=''42501'';END IF;');
END $$;

-- Keep existing legal rule IDs/keys and historical effects after a role rename.
CREATE FUNCTION private.official_salary_rule_key(p_role text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT rule_key FROM public.government_rules WHERE definition->>'operation'='official_salary' AND public.canonical_official_role(definition->>'role')=public.canonical_official_role(p_role) ORDER BY is_active DESC,updated_at DESC LIMIT 1),'official_salary_'||md5(public.canonical_official_role(p_role)))
$$;
REVOKE ALL ON FUNCTION private.official_salary_rule_key(text) FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE body text;BEGIN
 body:=pg_get_functiondef('public.propose_official_salary(text,numeric,integer,text,timestamptz)'::regprocedure);
 EXECUTE replace(body,'''official_salary_''||md5(p_role)','private.official_salary_rule_key(p_role)');
 body:=pg_get_functiondef('private.validate_legal_measure(text,jsonb,text)'::regprocedure);
 body:=replace(body,'''official_salary_''||md5(d->>''role'')','private.official_salary_rule_key(d->>''role'')');
 body:=replace(body,'r->>''role''=d->>''role''','r->>''role''=public.canonical_official_role(d->>''role'')');
 EXECUTE body;
 body:=pg_get_functiondef('private.apply_salary_legal_effect(uuid)'::regprocedure);
 EXECUTE replace(body,'value->>''role''=e.effect_data->''definition''->>''role''','value->>''role''=public.canonical_official_role(e.effect_data->''definition''->>''role'')');
END $$;

-- Share the existing safe public invalidation channel; no financial data is
-- broadcast. Subscribers fetch the RLS/RPC-authorized current state.
CREATE TRIGGER national_budget_changed AFTER UPDATE OF balance ON public.accounts FOR EACH ROW WHEN (new.account_kind='national_market') EXECUTE FUNCTION private.broadcast_company_market();
CREATE TRIGGER national_participation_changed AFTER UPDATE OF national_market_auto ON public.businesses FOR EACH STATEMENT EXECUTE FUNCTION private.broadcast_company_market();
CREATE TRIGGER national_services_changed AFTER INSERT OR UPDATE ON public.national_market_purchases FOR EACH STATEMENT EXECUTE FUNCTION private.broadcast_company_market();

CREATE INDEX competition_creator_lookup ON public.public_competitions(created_by);
CREATE INDEX competition_decider_lookup ON public.public_competition_applications(decided_by) WHERE decided_by IS NOT NULL;
CREATE INDEX national_purchase_transaction_lookup ON public.national_market_purchases(transaction_id);
CREATE INDEX national_purchase_actor_lookup ON public.national_market_purchases(actor_id) WHERE actor_id IS NOT NULL;
CREATE INDEX national_purchase_resource_lookup ON public.national_market_purchases(resource_code);

-- New state participates in the same world generation and reset system.
-- This only extends its catalogue and seed function; it does not run a reset.
DO $$ DECLARE body text;anchor text;target regclass;BEGIN
 body:=pg_get_functiondef('private.rp_reset_policy()'::regprocedure);
 anchor:='(''world_map_places'',''keep'',''{}''::text[])';
 IF position(anchor in body)=0 THEN RAISE EXCEPTION 'Catálogo de reset mudou. Revise a integração.';END IF;
 EXECUTE replace(body,anchor,$entries$('public_competitions','clear','{created_by}'::text[]),
 ('public_competition_applications','clear','{profile_id,decided_by}'::text[]),
 ('public_careers','clear','{profile_id}'::text[]),
 ('national_market_references','keep','{}'::text[]),
 ('national_market_stock','clear','{}'::text[]),
 ('national_market_purchases','clear','{actor_id}'::text[]),
 ('national_market_consumption','clear','{}'::text[]),$entries$||anchor);
 body:=pg_get_functiondef('private.reset_catalog()'::regprocedure);
 EXECUTE replace(body,'(''police_occurrence_reporters''','(''public_competition_exams'',''A'',''clear'',true),(''police_occurrence_reporters''');
 FOREACH body IN ARRAY ARRAY['public.admin_process_reset_batch(uuid,text,uuid)','private.reset_audit()'] LOOP
  EXECUTE replace(pg_get_functiondef(body::regprocedure),'''justice-evidence''','''justice-evidence'',''public-competitions''');
 END LOOP;
 body:=pg_get_functiondef('private.seed_reset_world(uuid)'::regprocedure);
 -- The reset seed uses a new official market account with zero balance.
 anchor:='PERFORM private.refresh_regional_infrastructure();';
 IF position(anchor in body)=0 THEN RAISE EXCEPTION 'Semente do reset mudou. Revise a integração.';END IF;
 body:=replace(body,anchor,$seed$
 INSERT INTO public.accounts(account_kind,state_enterprise_id,account_number,balance)
 SELECT 'national_market',id,'MN-'||id::text,0 FROM public.state_enterprises WHERE service_key='national_market'
 ON CONFLICT(state_enterprise_id) DO UPDATE SET balance=0;
 UPDATE public.system_settings s SET value=jsonb_set(value,'{roles}',(SELECT jsonb_agg(CASE WHEN r->>'role'='Juiz' THEN r||jsonb_build_object('role','Juiz Federal','title','Juiz Federal') ELSE r END) FROM jsonb_array_elements(s.value->'roles')r)) WHERE key='official_salaries';
 $seed$||anchor);
 EXECUTE body;
 FOREACH target IN ARRAY ARRAY['public.public_competitions'::regclass,'public.public_competition_applications'::regclass,'public.public_careers'::regclass,'private.public_competition_exams'::regclass,'public.national_market_references'::regclass,'public.national_market_stock'::regclass,'public.national_market_purchases'::regclass,'public.national_market_consumption'::regclass] LOOP
  EXECUTE format('CREATE TRIGGER world_generation_barrier BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION private.guard_world_mutation()',target);
 END LOOP;
END $$;
-- Activate the frontend only when every backend dependency is installed.
INSERT INTO public.system_settings(key,value) VALUES('integrated_update_version','{"version":1}'::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value;

NOTIFY pgrst,'reload schema';
COMMIT;
