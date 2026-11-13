BEGIN;
-- Safe materialized public directory: no sensitive columns from profiles are
-- ever stored here, and no anonymous role can SELECT from profiles itself.
CREATE TABLE IF NOT EXISTS public.public_profile_directory_data (
  id uuid PRIMARY KEY,
  username text,
  full_name text,
  avatar_url text,
  party_affiliation uuid,
  created_at timestamptz,
  x_handle text,
  x_username text,
  x_avatar_url text,
  public_role text,
  manual_role_override boolean,
  role_assigned_at timestamptz,
  role_assigned_by uuid,
  updated_at timestamptz
);
REVOKE ALL ON public.public_profile_directory_data FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.public_profile_directory_data TO anon,authenticated;
ALTER TABLE public.public_profile_directory_data ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_directory_read_safe ON public.public_profile_directory_data;
CREATE POLICY public_directory_read_safe ON public.public_profile_directory_data
  FOR SELECT TO anon,authenticated USING (true);

-- We only refresh the directory when a public-facing field changes.
CREATE OR REPLACE FUNCTION private.refresh_public_profile_directory()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    DELETE FROM public.public_profile_directory_data WHERE id=OLD.id;
    RETURN OLD;
  END IF;
  IF NEW.deleted_at IS NOT NULL OR NEW.onboarding_completed IS DISTINCT FROM TRUE THEN
    DELETE FROM public.public_profile_directory_data WHERE id=NEW.id;
  ELSE
    INSERT INTO public.public_profile_directory_data(
      id,username,full_name,avatar_url,party_affiliation,created_at,
      x_handle,x_username,x_avatar_url,public_role,
      manual_role_override,role_assigned_at,role_assigned_by,updated_at
    ) VALUES(
      NEW.id,NEW.username,NEW.full_name,NEW.avatar_url,NEW.party_affiliation,NEW.created_at,
      NEW.x_handle,NEW.x_username,NEW.x_avatar_url,
      CASE WHEN NEW.role='Admin' THEN 'Cidadão' ELSE NEW.role END,
      NEW.manual_role_override,NEW.role_assigned_at,NEW.role_assigned_by,NEW.updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      username=EXCLUDED.username, full_name=EXCLUDED.full_name,
      avatar_url=EXCLUDED.avatar_url, party_affiliation=EXCLUDED.party_affiliation,
      created_at=EXCLUDED.created_at, x_handle=EXCLUDED.x_handle,
      x_username=EXCLUDED.x_username, x_avatar_url=EXCLUDED.x_avatar_url,
      public_role=EXCLUDED.public_role, manual_role_override=EXCLUDED.manual_role_override,
      role_assigned_at=EXCLUDED.role_assigned_at,
      role_assigned_by=EXCLUDED.role_assigned_by,updated_at=EXCLUDED.updated_at;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS public_profile_directory_sync ON public.profiles;
CREATE TRIGGER public_profile_directory_sync
AFTER INSERT OR UPDATE OF username,full_name,avatar_url,party_affiliation,
 x_handle,x_username,x_avatar_url,role,manual_role_override,role_assigned_at,
 role_assigned_by,onboarding_completed,deleted_at
OR DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION private.refresh_public_profile_directory();

CREATE OR REPLACE FUNCTION private.clear_public_profile_directory()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  TRUNCATE public.public_profile_directory_data;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS public_profile_directory_truncate ON public.profiles;
CREATE TRIGGER public_profile_directory_truncate
AFTER TRUNCATE ON public.profiles
FOR EACH STATEMENT EXECUTE FUNCTION private.clear_public_profile_directory();

INSERT INTO public.public_profile_directory_data(
 id,username,full_name,avatar_url,party_affiliation,created_at,
 x_handle,x_username,x_avatar_url,public_role,manual_role_override,
 role_assigned_at,role_assigned_by,updated_at
)
SELECT id,username,full_name,avatar_url,party_affiliation,created_at,
 x_handle,x_username,x_avatar_url,
 CASE WHEN role='Admin' THEN 'Cidadão' ELSE role END,
 manual_role_override,role_assigned_at,role_assigned_by,updated_at
FROM public.profiles WHERE onboarding_completed IS TRUE AND deleted_at IS NULL
ON CONFLICT(id) DO NOTHING;

CREATE OR REPLACE VIEW public.public_profiles
WITH (security_invoker=true,security_barrier=true) AS
SELECT id,username,full_name,avatar_url,party_affiliation,created_at
FROM public.public_profile_directory_data;
CREATE OR REPLACE VIEW public.public_social_profiles
WITH (security_invoker=true,security_barrier=true) AS
SELECT id,x_handle,x_username,x_avatar_url FROM public.public_profile_directory_data;
CREATE OR REPLACE VIEW public.public_office_profiles
WITH (security_invoker=true,security_barrier=true) AS
SELECT id,username,full_name,avatar_url,public_role AS role,x_handle,
       manual_role_override,role_assigned_at,role_assigned_by,updated_at
FROM public.public_profile_directory_data WHERE public_role IN ('Presidente','Vice-Presidente');
REVOKE ALL ON public.public_profiles,public.public_social_profiles,public.public_office_profiles FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.public_profiles,public.public_social_profiles,public.public_office_profiles TO anon,authenticated;
COMMIT;
