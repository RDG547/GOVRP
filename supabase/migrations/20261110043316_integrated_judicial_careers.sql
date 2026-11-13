BEGIN;
-- Transform the installed definitions, never restore an older function body.
-- This deliberately preserves the latest electoral/ministerial changes.
DO $$ DECLARE f record;body text;pol record;clause text;BEGIN
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN('public','private','economy_private') AND p.prokind='f'
 AND (position(quote_literal('Juiz') in p.prosrc)>0 OR position(quote_literal('juiz') in p.prosrc)>0) LOOP
  body:=pg_get_functiondef(f.oid);
  body:=replace(replace(body,quote_literal('Juiz'),quote_literal('Juiz Federal')),quote_literal('juiz'),quote_literal('juiz federal'));
  EXECUTE body;
 END LOOP;
 FOR pol IN SELECT p.*,n.nspname,c.relname,pg_get_expr(p.polqual,p.polrelid) qual,pg_get_expr(p.polwithcheck,p.polrelid) chk
 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN('public','storage') LOOP
  IF position(quote_literal('Juiz') in coalesce(pol.qual,'')||coalesce(pol.chk,''))>0 THEN
   clause:=format('ALTER POLICY %I ON %I.%I',pol.polname,pol.nspname,pol.relname);
   IF pol.qual IS NOT NULL THEN clause:=clause||' USING ('||replace(pol.qual,quote_literal('Juiz'),quote_literal('Juiz Federal'))||')';END IF;
   IF pol.chk IS NOT NULL THEN clause:=clause||' WITH CHECK ('||replace(pol.chk,quote_literal('Juiz'),quote_literal('Juiz Federal'))||')';END IF;
   EXECUTE clause;
  END IF;
 END LOOP;
 -- These two helpers govern institutional appointments, not competition careers.
 FOREACH body IN ARRAY ARRAY['private.sync_institutional_role()','private.end_institutional_term(uuid,text,uuid)'] LOOP
  EXECUTE replace(pg_get_functiondef(body::regprocedure),quote_literal('Promotor'),quote_literal('Procurador-Geral da República'));
 END LOOP;
 FOREACH body IN ARRAY ARRAY['public.set_admin_development_mode(text,text)','public.share_agies_report(uuid,uuid,text)'] LOOP
  IF to_regprocedure(body) IS NOT NULL THEN
   EXECUTE replace(pg_get_functiondef(body::regprocedure),quote_literal('Promotor'),quote_literal('Promotor')||','||quote_literal('Procurador-Geral da República'));
  END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.canonical_official_role(p_role text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE p_role WHEN 'Juiz' THEN 'Juiz Federal' WHEN 'Delegado' THEN 'Diretor-Geral de Polícia' WHEN 'Presidente da Câmara' THEN 'Presidente da Câmara dos Deputados' WHEN 'Vice-Presidente do Senado' THEN 'Vice-Presidente do Senado Federal' WHEN 'Diretor da Polícia Federal' THEN 'Diretor-Geral de Polícia' WHEN 'Comandante das Forças Armadas' THEN 'Comandante-Geral das Forças Armadas' ELSE p_role END
$$;
UPDATE public.executive_office_definitions SET role_label='Juiz Federal' WHERE role_label='Juiz';
UPDATE public.executive_office_definitions SET role_label='Procurador-Geral da República',description='Ministério Público · indicação presidencial com aceite; sem concurso ou votação do Senado.' WHERE office_key='public_prosecutor';
-- Updating a label must not restart a judge's term. The installed trigger now
-- compares the new label to the same existing seat and retains its term id.
UPDATE public.profiles SET role='Juiz Federal',updated_at=clock_timestamp() WHERE role='Juiz';
UPDATE public.profiles SET titles=array_replace(titles,'Juiz','Juiz Federal') WHERE 'Juiz'=ANY(titles);

UPDATE public.system_settings s SET value=jsonb_set(s.value,'{roles}',
 (SELECT jsonb_agg(CASE WHEN r->>'role'='Juiz' THEN r||jsonb_build_object('role','Juiz Federal','title','Juiz Federal') ELSE r END) FROM jsonb_array_elements(s.value->'roles')r)),updated_at=clock_timestamp() WHERE key='official_salaries';
UPDATE public.system_settings SET value=jsonb_set(value,'{roles}',(value->'roles')||jsonb_build_array(jsonb_build_object('role','Procurador-Geral da República','title','Procurador-Geral da República','amount',14000,'previous_amount',14000,'version',1,'valid_from',clock_timestamp()))),updated_at=clock_timestamp()
WHERE key='official_salaries' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(value->'roles')r WHERE r->>'role'='Procurador-Geral da República');
-- Preserve legal-rule identities and prior legal effects; only their role label changes.
UPDATE public.government_rules SET definition=jsonb_set(definition,'{role}','"Juiz Federal"'),description='Remuneração semanal: Juiz Federal' WHERE definition->>'operation'='official_salary' AND definition->>'role'='Juiz';
INSERT INTO public.government_rules(rule_key,numeric_value,unit,description,rule_kind,is_active,definition)
VALUES('official_salary_'||md5('Procurador-Geral da República'),14000,'BRL','Remuneração semanal: Procurador-Geral da República','policy',true,jsonb_build_object('operation','official_salary','role','Procurador-Geral da República','audience','all')) ON CONFLICT(rule_key) DO NOTHING;

-- Existing legitimately appointed prosecutors retain their role and term.
-- Future invitations use the updated seat label and can only award PGR.
-- A competition prosecutor is authorized by a career record, independently
-- from a presidential invitation or term.
CREATE OR REPLACE FUNCTION public.official_role_capabilities(p_role text) RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE public.canonical_official_role(p_role)
 WHEN 'Presidente do STF' THEN ARRAY['Presidente do STF','Juiz Federal']
 WHEN 'Procurador-Geral da República' THEN ARRAY['Procurador-Geral da República','Promotor']
 WHEN 'Diretor-Geral de Polícia' THEN ARRAY['Diretor-Geral de Polícia','Policial','Delegado']
 WHEN 'Comandante-Geral das Forças Armadas' THEN ARRAY['Comandante-Geral das Forças Armadas','Militar']
 WHEN 'Comandante da Agência de Inteligência' THEN ARRAY['Comandante da Agência de Inteligência','Agente Secreto']
 ELSE ARRAY[public.canonical_official_role(p_role)] END
$$;

CREATE OR REPLACE FUNCTION public.justice_has_role(p_roles text[]) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (public.is_admin(auth.uid()) AND 'admin'=ANY(SELECT lower(unnest(p_roles))))
 OR (public.is_acting_president(auth.uid()) AND 'presidente'=ANY(SELECT lower(unnest(p_roles))))
 OR EXISTS(SELECT 1 FROM public.profiles p CROSS JOIN LATERAL unnest(public.official_role_capabilities(p.role)) cap
 WHERE p.id=(SELECT auth.uid()) AND p.deleted_at IS NULL AND lower(cap)<>'admin'
 AND lower(cap)=ANY(SELECT lower(public.canonical_official_role(r)) FROM unnest(p_roles)r)
 AND (cap<>'Juiz Federal' OR (p.role IN('Juiz Federal','Presidente do STF') AND EXISTS(SELECT 1 FROM public.institutional_terms WHERE profile_id=p.id AND status='active' AND office_key LIKE 'supreme_court_%' AND ends_at>clock_timestamp())))
 AND (cap NOT IN('Promotor','Procurador-Geral da República') OR
  (p.role='Promotor' AND EXISTS(SELECT 1 FROM public.public_careers WHERE profile_id=p.id AND role='Promotor')) OR
  (p.role='Procurador-Geral da República' AND EXISTS(SELECT 1 FROM public.institutional_terms WHERE profile_id=p.id AND status='active' AND office_key='public_prosecutor')))
 AND (lower(cap) NOT IN('delegado','diretor-geral de polícia') OR public.canonical_official_role(p.role)='Diretor-Geral de Polícia')
 AND (lower(cap) NOT IN('policial','police') OR public.canonical_official_role(p.role) IN('Diretor-Geral de Polícia','Policial','Police')))
$$;

-- Disallow indirect executive appointments to competition-only careers even
-- if an old custom office definition still exists.
UPDATE public.executive_office_definitions SET is_assignable=false,required_for_formation=false
WHERE role_label IN('Defensor Público','Promotor','Agente Secreto','Professor','Policial','Militar','Agente Penitenciário');

NOTIFY pgrst,'reload schema';
COMMIT;
