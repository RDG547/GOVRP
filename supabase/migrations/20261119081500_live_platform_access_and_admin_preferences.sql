CREATE TABLE public.platform_access_exceptions(
 user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
 granted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 granted_at timestamptz NOT NULL DEFAULT now(),
 revoked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 revoked_at timestamptz,
 reason text NOT NULL CHECK(length(reason) BETWEEN 5 AND 1000)
);
CREATE INDEX platform_exception_grant_actor ON public.platform_access_exceptions(granted_by);
CREATE INDEX platform_exception_revoke_actor ON public.platform_access_exceptions(revoked_by);
ALTER TABLE public.platform_access_exceptions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.platform_access_exceptions TO authenticated;
REVOKE ALL ON public.platform_access_exceptions FROM anon;
CREATE POLICY own_or_admin_exception_read ON public.platform_access_exceptions FOR SELECT TO authenticated USING(user_id=(select auth.uid()) OR (select public.is_admin(auth.uid())));

CREATE FUNCTION public.can_access_platform() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT value->'__site__'->>'mode' FROM public.system_settings WHERE key='service_availability'),'active')='active'
 OR (auth.uid() IS NOT NULL AND (public.is_admin(auth.uid()) OR EXISTS(SELECT 1 FROM public.platform_access_exceptions WHERE user_id=auth.uid() AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.deleted_at IS NULL))))
$$;
REVOKE ALL ON FUNCTION public.can_access_platform() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_platform() TO anon,authenticated,service_role;
CREATE FUNCTION public.get_platform_access() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('allowed',public.can_access_platform(),'bypass',auth.uid() IS NOT NULL AND (public.is_admin(auth.uid()) OR EXISTS(SELECT 1 FROM public.platform_access_exceptions WHERE user_id=auth.uid() AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.deleted_at IS NULL))),
 'settings',coalesce((SELECT value FROM public.system_settings WHERE key='service_availability'),'{}'::jsonb),'server_now',now())
$$;
REVOKE ALL ON FUNCTION public.get_platform_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_platform_access() TO anon,authenticated,service_role;
CREATE FUNCTION public.admin_set_platform_exception(p_user_id uuid,p_allowed boolean,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Somente administradores podem conceder acesso durante a manutenção.' USING errcode='42501';END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
 IF p_allowed IS NULL OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'Informe uma justificativa entre 5 e 1.000 caracteres.';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_user_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Conta não encontrada.';END IF;
 SELECT to_jsonb(e) INTO previous FROM public.platform_access_exceptions e WHERE user_id=p_user_id FOR UPDATE;
 IF p_allowed THEN
  INSERT INTO public.platform_access_exceptions(user_id,granted_by,reason) VALUES(p_user_id,auth.uid(),btrim(p_reason))
  ON CONFLICT(user_id) DO UPDATE SET granted_by=excluded.granted_by,granted_at=clock_timestamp(),reason=excluded.reason,revoked_by=NULL,revoked_at=NULL;
 ELSE UPDATE public.platform_access_exceptions SET revoked_by=auth.uid(),revoked_at=clock_timestamp(),reason=btrim(p_reason) WHERE user_id=p_user_id AND revoked_at IS NULL;END IF;
 PERFORM economy_private.audit(CASE WHEN p_allowed THEN 'platform_access_granted' ELSE 'platform_access_revoked' END,'profiles',p_user_id::text,previous,jsonb_build_object('allowed',p_allowed),p_reason,auth.uid());
 RETURN jsonb_build_object('success',true);
END $$;
REVOKE ALL ON FUNCTION public.admin_set_platform_exception(uuid,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_set_platform_exception(uuid,boolean,text) TO authenticated;

-- Check privileged RPCs as well as ordinary table access in the Data API.
CREATE FUNCTION public.check_platform_request() RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE path text:=current_setting('request.path',true);method text:=current_setting('request.method',true);
BEGIN
 IF auth.jwt()->>'role'='service_role' OR public.can_access_platform() THEN RETURN;END IF;
 IF path IN('/rpc/get_platform_access','/rpc/can_access_platform','/rpc/get_world_runtime','/rpc/get_my_account_identity','/rpc/get_admin_development_state','/rpc/is_electoral_judge') THEN RETURN;END IF;
 IF method IN('GET','HEAD') AND path IN('/profiles','/system_settings','/platform_access_exceptions') THEN RETURN;END IF;
 RAISE sqlstate 'PT503' USING message='A plataforma está temporariamente indisponível para esta conta. A entrada permanece disponível para contas autorizadas.';
END $$;
REVOKE ALL ON FUNCTION public.check_platform_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_platform_request() TO anon,authenticated,service_role;
ALTER ROLE authenticator SET pgrst.db_pre_request='public.check_platform_request';

-- Restrictive policies also protect Realtime and Storage, which do not run the Data API pre-request.
DO $$ DECLARE t record;BEGIN
 FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p') AND c.relrowsecurity
 AND c.relname NOT IN('system_settings','profiles','platform_access_exceptions') LOOP
  EXECUTE format('CREATE POLICY platform_availability_guard ON public.%I AS RESTRICTIVE FOR ALL TO anon,authenticated USING ((select public.can_access_platform())) WITH CHECK ((select public.can_access_platform()))',t.relname);
 END LOOP;
END $$;
CREATE POLICY platform_availability_guard ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated USING((select public.can_access_platform())) WITH CHECK((select public.can_access_platform()));
CREATE FUNCTION private.guard_site_mode_admin() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (NEW.key='service_availability' OR (TG_OP='UPDATE' AND OLD.key='service_availability')) AND auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Somente a administração pode alterar a disponibilidade da plataforma.' USING errcode='42501';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_site_mode_admin() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER platform_availability_admin BEFORE INSERT OR UPDATE ON public.system_settings FOR EACH ROW EXECUTE FUNCTION private.guard_site_mode_admin();

CREATE OR REPLACE FUNCTION private.assert_citizen_service(p_service text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE settings jsonb;bypass boolean;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND onboarding_completed) THEN RAISE EXCEPTION 'Conclua sua cidadania para usar este serviço.' USING errcode='42501';END IF;
 bypass:=public.is_admin(auth.uid()) OR EXISTS(SELECT 1 FROM public.platform_access_exceptions WHERE user_id=auth.uid() AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.deleted_at IS NULL));
 SELECT value INTO settings FROM public.system_settings WHERE key='service_availability';
 IF NOT bypass AND (coalesce(settings->'__site__'->>'mode','active')<>'active' OR coalesce(settings->p_service->>'mode','active')<>'active') THEN RAISE EXCEPTION 'Este serviço está temporariamente indisponível. Tente novamente mais tarde.';END IF;
END $$;

CREATE TABLE public.admin_dashboard_preferences(user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,section_order jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(section_order)='array'),updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.admin_dashboard_preferences ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.admin_dashboard_preferences TO authenticated;
CREATE POLICY admin_own_preferences ON public.admin_dashboard_preferences FOR SELECT TO authenticated USING(user_id=(select auth.uid()) AND (select public.is_admin(auth.uid())));
CREATE FUNCTION public.save_admin_dashboard_order(p_order jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso exclusivo da administração.' USING errcode='42501';END IF;
 IF jsonb_typeof(p_order) IS DISTINCT FROM 'array' OR jsonb_array_length(p_order)>100 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_order) v WHERE jsonb_typeof(v)<>'string' OR length(v::text)>100) OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(p_order)) THEN RAISE EXCEPTION 'Ordem de seções inválida.';END IF;
 INSERT INTO public.admin_dashboard_preferences(user_id,section_order) VALUES(auth.uid(),p_order) ON CONFLICT(user_id) DO UPDATE SET section_order=excluded.section_order,updated_at=clock_timestamp();
END $$;
REVOKE ALL ON FUNCTION public.save_admin_dashboard_order(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_admin_dashboard_order(jsonb) TO authenticated;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='platform_access_exceptions') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.platform_access_exceptions;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='admin_dashboard_preferences') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_dashboard_preferences;END IF;
END $$;
NOTIFY pgrst,'reload config';
NOTIFY pgrst,'reload schema';

-- Merge only edited services under a row lock so concurrent administrators do
-- not silently overwrite each other's unrelated availability changes.
CREATE FUNCTION public.admin_set_service_availability(p_changes jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE settings jsonb;previous jsonb;k text;v jsonb;mode text;changed boolean:=false;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Somente a administração pode alterar a disponibilidade.' USING errcode='42501';END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
 IF jsonb_typeof(p_changes) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_each(p_changes))>100 THEN RAISE EXCEPTION 'Selecione os serviços que deseja alterar.';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('govrp:service-availability',0));
 SELECT value INTO settings FROM public.system_settings WHERE key='service_availability' FOR UPDATE;
 settings:=coalesce(settings,'{}');previous:=settings;
 FOR k,v IN SELECT * FROM jsonb_each(p_changes) LOOP
  mode:=v->>'mode';
  IF length(k)>150 OR(k<>'__site__' AND left(k,1)<>'/') OR mode IS NULL OR mode NOT IN('active','maintenance','coming_soon') THEN RAISE EXCEPTION 'Estado de disponibilidade inválido.';END IF;
  IF coalesce(settings->k->>'mode','active') IS DISTINCT FROM mode THEN
   settings:=jsonb_set(settings,ARRAY[k],jsonb_build_object('mode',mode,'updated_at',clock_timestamp()));changed:=true;
  END IF;
 END LOOP;
 IF changed THEN
  INSERT INTO public.system_settings(key,value) VALUES('service_availability',settings) ON CONFLICT(key) DO UPDATE SET value=excluded.value;
  PERFORM economy_private.audit('service_availability_changed','system_settings','service_availability',previous,settings,'Disponibilidade de serviços atualizada pela administração.',auth.uid());
 END IF;
 RETURN settings;
END $$;
REVOKE ALL ON FUNCTION public.admin_set_service_availability(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_set_service_availability(jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
