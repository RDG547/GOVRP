-- GOVRP moderation: permanent account bans + identifier restrictions (email, character identity, IP, browser installation).
-- The browser-installation token is NOT a hardware fingerprint and can be cleared.
-- Passwords are NEVER used as ban identifiers.
BEGIN;

CREATE TABLE IF NOT EXISTS private.govrp_security_bans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 target_user_id uuid NOT NULL,
 email_norm text,
 username_norm text,
 citizen_name_norm text,
 ip_addresses inet[] NOT NULL DEFAULT '{}'::inet[],
 device_hashes text[] NOT NULL DEFAULT '{}'::text[],
 block_email boolean NOT NULL DEFAULT true,
 block_username boolean NOT NULL DEFAULT true,
 block_citizen_name boolean NOT NULL DEFAULT true,
 block_ip boolean NOT NULL DEFAULT true,
 block_devices boolean NOT NULL DEFAULT true,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 1000),
 created_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 active boolean NOT NULL DEFAULT true,
 revoked_at timestamptz,
 revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 CONSTRAINT govrp_security_bans_revoked CHECK ((active AND revoked_at IS NULL) OR (NOT active AND revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS govrp_bans_one_active_per_target ON private.govrp_security_bans(target_user_id) WHERE active;
CREATE INDEX IF NOT EXISTS govrp_bans_active_email ON private.govrp_security_bans(email_norm) WHERE active AND block_email;
CREATE INDEX IF NOT EXISTS govrp_bans_active_username ON private.govrp_security_bans(username_norm) WHERE active AND block_username;
CREATE INDEX IF NOT EXISTS govrp_bans_active_citizen ON private.govrp_security_bans(citizen_name_norm) WHERE active AND block_citizen_name;

CREATE TABLE IF NOT EXISTS private.govrp_security_devices (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 token_hash text NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 first_ip inet,
 last_ip inet,
 user_agent text,
 first_seen_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,token_hash)
);
CREATE INDEX IF NOT EXISTS govrp_devices_hash_idx ON private.govrp_security_devices(token_hash);

-- Keep moderation data out of PostgREST. Browser clients have no table grants.
REVOKE ALL ON TABLE private.govrp_security_bans,private.govrp_security_devices FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE private.govrp_security_bans,private.govrp_security_devices TO postgres;
CREATE OR REPLACE FUNCTION private.govrp_ban_match(
 p_email text DEFAULT NULL,
 p_ip inet DEFAULT NULL,
 p_device_hash text DEFAULT NULL,
 p_username text DEFAULT NULL,
 p_citizen_name text DEFAULT NULL
) RETURNS TABLE(ban_id uuid,match_kind text,ban_reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT b.id,
   CASE WHEN b.block_email AND p_email IS NOT NULL AND b.email_norm=lower(btrim(p_email)) THEN 'email'
        WHEN b.block_ip AND p_ip IS NOT NULL AND p_ip=ANY(b.ip_addresses) THEN 'ip'
        WHEN b.block_devices AND p_device_hash IS NOT NULL AND p_device_hash=ANY(b.device_hashes) THEN 'device'
        WHEN b.block_username AND p_username IS NOT NULL AND b.username_norm=lower(btrim(p_username)) THEN 'username'
        WHEN b.block_citizen_name AND p_citizen_name IS NOT NULL AND b.citizen_name_norm=lower(btrim(p_citizen_name)) THEN 'citizen_name'
        ELSE 'other' END AS match_kind,
   b.reason
 FROM private.govrp_security_bans b
 WHERE b.active AND (
   (b.block_email AND p_email IS NOT NULL AND b.email_norm=lower(btrim(p_email)))
   OR (b.block_ip AND p_ip IS NOT NULL AND p_ip=ANY(b.ip_addresses))
   OR (b.block_devices AND p_device_hash IS NOT NULL AND p_device_hash=ANY(b.device_hashes))
   OR (b.block_username AND p_username IS NOT NULL AND b.username_norm=lower(btrim(p_username)))
   OR (b.block_citizen_name AND p_citizen_name IS NOT NULL AND b.citizen_name_norm=lower(btrim(p_citizen_name)))
 )
 ORDER BY b.created_at DESC LIMIT 1;
$fn$;
REVOKE ALL ON FUNCTION private.govrp_ban_match(text,inet,text,text,text) FROM PUBLIC,anon,authenticated;

-- Authoritative auth-level hook. Activate in Supabase Dashboard -> Authentication -> Hooks.
-- Supabase Auth provides the originating IP in event.metadata.ip_address (not browser supplied).
CREATE OR REPLACE FUNCTION private.govrp_before_user_created_hook(event jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_email text;v_ip inet;v_match record;
BEGIN
 v_email:=nullif(btrim(event->'user'->>'email'),'');
 BEGIN v_ip:=nullif(event->'metadata'->>'ip_address','')::inet;
 EXCEPTION WHEN invalid_text_representation THEN v_ip:=NULL;
 END;
 SELECT * INTO v_match FROM private.govrp_ban_match(v_email,v_ip,NULL,NULL,NULL);
 IF FOUND THEN
   RETURN jsonb_build_object('error',jsonb_build_object('http_code',403,
     'message','Cadastro bloqueado pela moderação do GOVRP. Solicite uma revisão pelo suporte da comunidade.'));
 END IF;
 RETURN '{}'::jsonb;
END $fn$;
REVOKE ALL ON FUNCTION private.govrp_before_user_created_hook(jsonb) FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA private TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.govrp_before_user_created_hook(jsonb) TO supabase_auth_admin;

-- Extra email safeguard applies across email signup and OAuth even if the hook is not yet configured.
CREATE OR REPLACE FUNCTION private.govrp_guard_auth_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF NEW.email IS NOT NULL AND EXISTS(
   SELECT 1 FROM private.govrp_ban_match(NEW.email,NULL,NULL,NULL,NULL)
   WHERE match_kind='email'
 ) THEN
   RAISE EXCEPTION 'Cadastro bloqueado pela moderação do GOVRP. Solicite revisão à administração.'
    USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.govrp_guard_auth_email() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS govrp_guard_banned_auth_email ON auth.users;
CREATE TRIGGER govrp_guard_banned_auth_email BEFORE INSERT OR UPDATE OF email ON auth.users
 FOR EACH ROW EXECUTE FUNCTION private.govrp_guard_auth_email();

-- Users only choose their character names after signup; protect those fields in the database.
CREATE OR REPLACE FUNCTION private.govrp_guard_character_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_match record;
BEGIN
 IF TG_OP='INSERT' OR NEW.username IS DISTINCT FROM OLD.username OR NEW.full_name IS DISTINCT FROM OLD.full_name THEN
  SELECT * INTO v_match FROM private.govrp_ban_match(
   NULL,NULL,NULL,NEW.username,NEW.full_name);
  IF FOUND THEN RAISE EXCEPTION 'Este nome de usuário ou cidadão está bloqueado pela moderação. Escolha outra identidade ou solicite revisão.'
      USING ERRCODE='42501';END IF;
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.govrp_guard_character_identity() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS govrp_guard_banned_character_identity ON public.profiles;
CREATE TRIGGER govrp_guard_banned_character_identity
 BEFORE INSERT OR UPDATE OF username,full_name ON public.profiles
 FOR EACH ROW EXECUTE FUNCTION private.govrp_guard_character_identity();

-- Service-only entry point used by the Vercel API for preflight, session checks and observation.
CREATE OR REPLACE FUNCTION public.govrp_server_check_access(
 p_email text DEFAULT NULL,p_ip text DEFAULT NULL,p_device_hash text DEFAULT NULL,p_user_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_ip inet;v_match record;v_own record;v_email text;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Acesso restrito ao servidor.' USING ERRCODE='42501';END IF;
 BEGIN v_ip:=nullif(p_ip,'')::inet;EXCEPTION WHEN invalid_text_representation THEN v_ip:=NULL;END;
 IF p_user_id IS NOT NULL THEN
  SELECT id,reason INTO v_own FROM private.govrp_security_bans WHERE target_user_id=p_user_id AND active LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('allowed',false,'scope','account','reason',v_own.reason);END IF;
  SELECT lower(email) INTO v_email FROM auth.users WHERE id=p_user_id;
 ELSE v_email:=p_email;END IF;
 SELECT * INTO v_match FROM private.govrp_ban_match(v_email,v_ip,p_device_hash,NULL,NULL);
 IF FOUND THEN
  -- Never disclose one member's private moderation reason to another user on a shared IP/device.
  RETURN jsonb_build_object('allowed',false,'scope',v_match.match_kind,
    'reason','Este acesso está bloqueado por decisão da moderação do GOVRP. Solicite revisão à administração.');
 END IF;
 RETURN jsonb_build_object('allowed',true);
END $fn$;
REVOKE ALL ON FUNCTION public.govrp_server_check_access(text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.govrp_server_check_access(text,text,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.govrp_server_record_device(
 p_user_id uuid,p_device_hash text,p_ip text DEFAULT NULL,p_agent text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_ip inet;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Acesso restrito ao servidor.' USING ERRCODE='42501';END IF;
 IF p_user_id IS NULL OR p_device_hash IS NULL OR p_device_hash !~ '^[a-f0-9]{64}$' THEN
   RAISE EXCEPTION 'Identificador de navegador inválido.';END IF;
 BEGIN v_ip:=nullif(p_ip,'')::inet;EXCEPTION WHEN invalid_text_representation THEN v_ip:=NULL;END;
 INSERT INTO private.govrp_security_devices(user_id,token_hash,first_ip,last_ip,user_agent)
 VALUES(p_user_id,p_device_hash,v_ip,v_ip,left(coalesce(p_agent,''),280))
 ON CONFLICT(user_id,token_hash) DO UPDATE SET
  last_ip=coalesce(excluded.last_ip,private.govrp_security_devices.last_ip),
  user_agent=excluded.user_agent,last_seen_at=now();
END $fn$;
REVOKE ALL ON FUNCTION public.govrp_server_record_device(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.govrp_server_record_device(uuid,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.govrp_admin_ban_context(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_context jsonb;v_auth_email text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso administrativo necessário.' USING ERRCODE='42501';END IF;
 SELECT email INTO v_auth_email FROM auth.users WHERE id=p_user_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conta não encontrada.';END IF;
 SELECT jsonb_build_object('email',v_auth_email,
  'ips',coalesce((SELECT jsonb_agg(ip::text ORDER BY ip::text) FROM (
     SELECT DISTINCT ip FROM auth.sessions WHERE user_id=p_user_id AND ip IS NOT NULL
     UNION SELECT DISTINCT last_ip FROM private.govrp_security_devices WHERE user_id=p_user_id AND last_ip IS NOT NULL
   ) i),'[]'::jsonb),
  'devices',coalesce((SELECT jsonb_agg(jsonb_build_object('hash_suffix',right(token_hash,12),
     'last_ip',last_ip,'user_agent',user_agent,'last_seen_at',last_seen_at) ORDER BY last_seen_at DESC)
     FROM private.govrp_security_devices WHERE user_id=p_user_id),'[]'::jsonb),
  'current_ban',(SELECT jsonb_build_object('id',id,'reason',reason,'created_at',created_at,'block_email',block_email,
     'block_username',block_username,'block_citizen_name',block_citizen_name,'block_ip',block_ip,'block_devices',block_devices,
     'ip_count',cardinality(ip_addresses),'device_count',cardinality(device_hashes))
    FROM private.govrp_security_bans WHERE target_user_id=p_user_id AND active LIMIT 1),
  'history',coalesce((SELECT jsonb_agg(jsonb_build_object('reason',reason,'created_at',created_at,'revoked_at',revoked_at)
     ORDER BY created_at DESC) FROM private.govrp_security_bans WHERE target_user_id=p_user_id),'[]'::jsonb)
 ) INTO v_context;
 RETURN v_context;
END $fn$;
REVOKE ALL ON FUNCTION public.govrp_admin_ban_context(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.govrp_admin_ban_context(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.govrp_admin_list_bans()
RETURNS TABLE(target_user_id uuid,ban_id uuid,reason text,created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso administrativo necessário.' USING ERRCODE='42501';END IF;
 RETURN QUERY SELECT b.target_user_id,b.id,b.reason,b.created_at
 FROM private.govrp_security_bans b WHERE b.active ORDER BY b.created_at DESC;
END $fn$;
REVOKE ALL ON FUNCTION public.govrp_admin_list_bans() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.govrp_admin_list_bans() TO authenticated;

CREATE OR REPLACE FUNCTION public.govrp_admin_apply_ban(p_user_id uuid,p_reason text,p_scope jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_id uuid;v_profile public.profiles%rowtype;v_email text;v_ips inet[];v_hashes text[];
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso administrativo necessário.' USING ERRCODE='42501';END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
 IF p_user_id=auth.uid() OR public.is_admin(p_user_id) THEN RAISE EXCEPTION 'Administradores não podem ser banidos por este fluxo.' USING ERRCODE='42501';END IF;
 IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 1000 THEN RAISE EXCEPTION 'Informe o motivo do banimento (10 a 1000 caracteres).';END IF;
 SELECT * INTO v_profile FROM public.profiles WHERE id=p_user_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Usuário inexistente ou excluído.';END IF;
 SELECT email INTO v_email FROM auth.users WHERE id=p_user_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conta de autenticação não encontrada.';END IF;
 SELECT array_agg(ip) INTO v_ips FROM (
  SELECT DISTINCT ip FROM auth.sessions WHERE user_id=p_user_id AND ip IS NOT NULL
  UNION SELECT DISTINCT last_ip FROM private.govrp_security_devices WHERE user_id=p_user_id AND last_ip IS NOT NULL
 ) as known_ips;
 SELECT array_agg(DISTINCT token_hash) INTO v_hashes FROM private.govrp_security_devices WHERE user_id=p_user_id;
 INSERT INTO private.govrp_security_bans(
 target_user_id,email_norm,username_norm,citizen_name_norm,ip_addresses,device_hashes,
 block_email,block_username,block_citizen_name,block_ip,block_devices,reason,created_by)
 VALUES(p_user_id,lower(btrim(v_email)),lower(btrim(v_profile.username)),lower(btrim(v_profile.full_name)),
  coalesce(v_ips,'{}'::inet[]),coalesce(v_hashes,'{}'::text[]),
  coalesce((p_scope->>'email')::boolean,true),coalesce((p_scope->>'username')::boolean,true),
  coalesce((p_scope->>'citizen_name')::boolean,true),coalesce((p_scope->>'ip')::boolean,true),
  coalesce((p_scope->>'devices')::boolean,true),btrim(p_reason),auth.uid()) RETURNING id INTO v_id;
 RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.govrp_admin_apply_ban(uuid,text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.govrp_admin_apply_ban(uuid,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.govrp_admin_revoke_ban(p_ban_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso administrativo necessário.' USING ERRCODE='42501';END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
 UPDATE private.govrp_security_bans SET active=false,revoked_at=now(),revoked_by=auth.uid()
 WHERE id=p_ban_id AND active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Banimento ativo não encontrado.';END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.govrp_admin_revoke_ban(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.govrp_admin_revoke_ban(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.govrp_my_ban_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_reason text;
BEGIN
 IF auth.uid() IS NULL THEN RETURN jsonb_build_object('banned',false);END IF;
 SELECT reason INTO v_reason FROM private.govrp_security_bans WHERE target_user_id=auth.uid() AND active LIMIT 1;
 RETURN jsonb_build_object('banned',v_reason IS NOT NULL,'reason',v_reason);
END $fn$;
REVOKE ALL ON FUNCTION public.govrp_my_ban_status() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.govrp_my_ban_status() TO authenticated;

COMMIT;
