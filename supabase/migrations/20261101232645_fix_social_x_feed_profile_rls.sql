BEGIN;
-- Public X authors are a strict allowlisted projection of citizen profiles.
-- Never broaden SELECT policies on private citizen identity.
ALTER TABLE public.public_profile_directory_data
  ADD COLUMN IF NOT EXISTS x_bio text,
  ADD COLUMN IF NOT EXISTS public_titles text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE OR REPLACE FUNCTION private.refresh_public_profile_directory()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      x_handle,x_username,x_avatar_url,x_bio,public_titles,public_role,
      manual_role_override,role_assigned_at,role_assigned_by,updated_at
    ) VALUES(
      NEW.id,NEW.username,NEW.full_name,NEW.avatar_url,NEW.party_affiliation,NEW.created_at,
      NEW.x_handle,NEW.x_username,NEW.x_avatar_url,NEW.x_bio,
      ARRAY(SELECT t FROM unnest(COALESCE(NEW.titles, ARRAY[]::text[])) AS t WHERE t=ANY(ARRAY['Fundador', 'Presidente', 'Vice-Presidente', 'Deputado', 'Senador', 'Presidente da Câmara', 'Presidente da Câmara dos Deputados', 'Vice-Presidente da Câmara dos Deputados', 'Presidente do Senado', 'Vice-Presidente do Senado', 'Vice-Presidente do Senado Federal', 'Presidente do STF']::text[])),
      CASE WHEN NEW.role='Admin' THEN 'Cidadão' ELSE NEW.role END,
      NEW.manual_role_override,NEW.role_assigned_at,NEW.role_assigned_by,NEW.updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      username=EXCLUDED.username, full_name=EXCLUDED.full_name,
      avatar_url=EXCLUDED.avatar_url, party_affiliation=EXCLUDED.party_affiliation,
      created_at=EXCLUDED.created_at, x_handle=EXCLUDED.x_handle,
      x_username=EXCLUDED.x_username, x_avatar_url=EXCLUDED.x_avatar_url,
      x_bio=EXCLUDED.x_bio, public_titles=EXCLUDED.public_titles,
      public_role=EXCLUDED.public_role, manual_role_override=EXCLUDED.manual_role_override,
      role_assigned_at=EXCLUDED.role_assigned_at,
      role_assigned_by=EXCLUDED.role_assigned_by,updated_at=EXCLUDED.updated_at;
  END IF;
  RETURN NEW;
END $function$
;

DROP TRIGGER IF EXISTS public_profile_directory_sync ON public.profiles;
CREATE TRIGGER public_profile_directory_sync
AFTER INSERT OR UPDATE OF username,full_name,avatar_url,party_affiliation,
  x_handle,x_username,x_avatar_url,x_bio,role,titles,manual_role_override,
  role_assigned_at,role_assigned_by,onboarding_completed,deleted_at
OR DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION private.refresh_public_profile_directory();

-- Update only safe public-facing attributes on already registered citizens.
UPDATE public.public_profile_directory_data AS d
SET x_bio=p.x_bio,
    public_titles=ARRAY(SELECT t FROM unnest(COALESCE(p.titles, ARRAY[]::text[])) AS t WHERE t=ANY(ARRAY['Fundador', 'Presidente', 'Vice-Presidente', 'Deputado', 'Senador', 'Presidente da Câmara', 'Presidente da Câmara dos Deputados', 'Vice-Presidente da Câmara dos Deputados', 'Presidente do Senado', 'Vice-Presidente do Senado', 'Vice-Presidente do Senado Federal', 'Presidente do STF']::text[]))
FROM public.profiles AS p
WHERE d.id=p.id AND (d.x_bio IS DISTINCT FROM p.x_bio
 OR d.public_titles IS DISTINCT FROM ARRAY(SELECT t FROM unnest(COALESCE(p.titles, ARRAY[]::text[])) AS t WHERE t=ANY(ARRAY['Fundador', 'Presidente', 'Vice-Presidente', 'Deputado', 'Senador', 'Presidente da Câmara', 'Presidente da Câmara dos Deputados', 'Vice-Presidente da Câmara dos Deputados', 'Presidente do Senado', 'Vice-Presidente do Senado', 'Vice-Presidente do Senado Federal', 'Presidente do STF']::text[])));

CREATE OR REPLACE VIEW public.x_public_authors
WITH (security_invoker=true,security_barrier=true) AS
SELECT id,username,full_name,avatar_url,x_handle,x_username,x_avatar_url,
       x_bio,public_role AS role,public_titles AS titles
FROM public.public_profile_directory_data
WHERE x_handle IS NOT NULL;
REVOKE ALL ON public.x_public_authors FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.x_public_authors TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_x_posts(p_post_ids uuid[] DEFAULT NULL::uuid[], p_author_id uuid DEFAULT NULL::uuid, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(id uuid, user_id uuid, content text, created_at timestamp with time zone, parent_post_id uuid, likes_count integer, comments_count integer, views_count integer, reposts_count integer, image_url text, author json, is_liked_by_user boolean, is_reposted_by_user boolean, original_post json, quote_content text, metadata jsonb, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
SELECT
    p.id,
    p.user_id,
    p.content,
    p.created_at,
    p.parent_post_id,
    p.likes_count,
    p.comments_count,
    p.views_count,
    p.reposts_count,
    p.image_url,
    json_build_object(
        'id', u.id,
        'username', u.username,
        'full_name', u.full_name,
        'avatar_url', u.avatar_url,
        'x_avatar_url', u.x_avatar_url,
        'x_username', u.x_username,
        'x_handle', u.x_handle,
        'role', u.role,
        'titles', u.titles
    ) as author,
    EXISTS(SELECT 1 FROM public.likes l WHERE l.post_id = p.id AND l.user_id = auth.uid()) as is_liked_by_user,
    EXISTS(SELECT 1 FROM public.posts rp WHERE rp.original_post_id = p.id AND rp.user_id = auth.uid()) as is_reposted_by_user,
    (
      SELECT json_build_object(
        'id', op.id,
        'content', op.content,
        'created_at', op.created_at,
        'image_url', op.image_url,
        'author', json_build_object(
          'id', op_author.id,
          'x_username', op_author.x_username,
          'x_handle', op_author.x_handle,
          'x_avatar_url', op_author.x_avatar_url
        )
      )
      FROM public.posts op
      JOIN public.x_public_authors op_author ON op.user_id = op_author.id
      WHERE op.id = p.original_post_id
    ) as original_post,
    p.quote_content,
    p.metadata,
    p.updated_at
FROM
    public.posts p
JOIN
    public.x_public_authors u ON p.user_id = u.id
WHERE 
    p.parent_post_id IS NULL
    AND (p_post_ids IS NULL OR p.id = ANY(p_post_ids))
    AND (p_author_id IS NULL OR p.user_id = p_author_id)
    AND (p_before IS NULL OR p.created_at < p_before)
ORDER BY
    p.created_at DESC, p.id DESC LIMIT 100;
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_posts_with_interactions(p_viewer_id uuid, p_target_user_id uuid)
 RETURNS TABLE(id uuid, user_id uuid, content text, created_at timestamp with time zone, parent_post_id uuid, likes_count integer, comments_count integer, views_count integer, reposts_count integer, image_url text, author json, is_liked_by_user boolean, is_reposted_by_user boolean, original_post json, quote_content text, metadata jsonb, updated_at timestamp with time zone)
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
SELECT
    p.id,
    p.user_id,
    p.content,
    p.created_at,
    p.parent_post_id,
    p.likes_count,
    p.comments_count,
    p.views_count,
    p.reposts_count,
    p.image_url,
    json_build_object(
        'id', u.id,
        'username', u.username,
        'full_name', u.full_name,
        'avatar_url', u.avatar_url,
        'x_avatar_url', u.x_avatar_url,
        'x_username', u.x_username,
        'x_handle', u.x_handle,
        'role', u.role,
        'titles', u.titles
    ) as author,
    EXISTS(SELECT 1 FROM public.likes l WHERE l.post_id = p.id AND l.user_id = auth.uid()) as is_liked_by_user,
    EXISTS(SELECT 1 FROM public.posts rp WHERE rp.original_post_id = p.id AND rp.user_id = auth.uid()) as is_reposted_by_user,
    (
      SELECT json_build_object(
        'id', op.id,
        'content', op.content,
        'created_at', op.created_at,
        'image_url', op.image_url,
        'author', json_build_object(
          'id', op_author.id,
          'x_username', op_author.x_username,
          'x_handle', op_author.x_handle,
          'x_avatar_url', op_author.x_avatar_url,
          'role', op_author.role,
          'titles', op_author.titles
        )
      )
      FROM public.posts op
      JOIN public.x_public_authors op_author ON op.user_id = op_author.id
      WHERE op.id = p.original_post_id
    ) as original_post,
    p.quote_content,
    p.metadata,
    p.updated_at
FROM
    public.posts p
JOIN
    public.x_public_authors u ON p.user_id = u.id
WHERE 
    p.parent_post_id IS NULL AND 
    (
        (p.user_id = p_target_user_id AND p.original_post_id IS NULL) OR 
        (p.original_post_id IS NOT NULL AND p.user_id = p_target_user_id)
    )
ORDER BY
    p.created_at DESC;
$function$
;

CREATE OR REPLACE FUNCTION public.get_posts_with_interactions(p_user_id uuid)
 RETURNS TABLE(id uuid, user_id uuid, content text, created_at timestamp with time zone, parent_post_id uuid, likes_count integer, comments_count integer, views_count integer, reposts_count integer, image_url text, author json, is_liked_by_user boolean, is_reposted_by_user boolean, original_post json, quote_content text, metadata jsonb, updated_at timestamp with time zone)
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
SELECT
    p.id,
    p.user_id,
    p.content,
    p.created_at,
    p.parent_post_id,
    p.likes_count,
    p.comments_count,
    p.views_count,
    p.reposts_count,
    p.image_url,
    json_build_object(
        'id', u.id,
        'username', u.username,
        'full_name', u.full_name,
        'avatar_url', u.avatar_url,
        'x_avatar_url', u.x_avatar_url,
        'x_username', u.x_username,
        'x_handle', u.x_handle,
        'role', u.role,
        'titles', u.titles
    ) as author,
    EXISTS(SELECT 1 FROM public.likes l WHERE l.post_id = p.id AND l.user_id = auth.uid()) as is_liked_by_user,
    EXISTS(SELECT 1 FROM public.posts rp WHERE rp.original_post_id = p.id AND rp.user_id = auth.uid()) as is_reposted_by_user,
    (
      SELECT json_build_object(
        'id', op.id,
        'content', op.content,
        'created_at', op.created_at,
        'image_url', op.image_url,
        'author', json_build_object(
          'id', op_author.id,
          'x_username', op_author.x_username,
          'x_handle', op_author.x_handle,
          'x_avatar_url', op_author.x_avatar_url
        )
      )
      FROM public.posts op
      JOIN public.x_public_authors op_author ON op.user_id = op_author.id
      WHERE op.id = p.original_post_id
    ) as original_post,
    p.quote_content,
    p.metadata,
    p.updated_at
FROM
    public.posts p
JOIN
    public.x_public_authors u ON p.user_id = u.id
WHERE 
    p.parent_post_id IS NULL -- This fetches both original posts and reposts, but not comments
ORDER BY
    p.created_at DESC;
$function$
;

CREATE OR REPLACE FUNCTION public.search_x(p_query_text text)
 RETURNS json
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    users_result json;
    posts_result json;
BEGIN
    SELECT json_agg(u) INTO users_result FROM (
        SELECT id, x_username, x_handle, avatar_url, x_bio
        FROM public.x_public_authors
        WHERE x_handle IS NOT NULL AND (x_handle ILIKE '%' || p_query_text || '%' OR x_username ILIKE '%' || p_query_text || '%')
        LIMIT 10
    ) u;

    SELECT json_agg(p) INTO posts_result FROM (
        SELECT
            p.id, p.user_id, p.content, p.created_at, p.likes_count, p.comments_count, p.views_count, p.reposts_count, p.image_url,
            json_build_object(
              'id', author.id,
              'username', author.username,
              'full_name', author.full_name,
              'avatar_url', author.avatar_url,
              'x_username', author.x_username,
              'x_handle', author.x_handle
            ) as author,
            EXISTS(SELECT 1 FROM public.likes l WHERE l.post_id = p.id AND l.user_id = auth.uid()) as is_liked_by_user,
            EXISTS(SELECT 1 FROM public.reposts r WHERE r.post_id = p.id AND r.user_id = auth.uid()) as is_reposted_by_user
        FROM public.posts p
        JOIN public.x_public_authors author ON p.user_id = author.id
        WHERE p.parent_post_id IS NULL AND p.content ILIKE '%' || p_query_text || '%'
        ORDER BY p.created_at DESC
        LIMIT 20
    ) p;

    RETURN json_build_object('users', COALESCE(users_result, '[]'::json), 'posts', COALESCE(posts_result, '[]'::json));
END;
$function$
;

COMMIT;
