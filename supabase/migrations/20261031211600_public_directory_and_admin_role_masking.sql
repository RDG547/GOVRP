BEGIN;
-- Public directory views are deliberately narrow. Their view-owner access is
-- needed because direct SELECT on profiles is forbidden for anonymous users.
CREATE OR REPLACE VIEW public.public_social_profiles
WITH (security_barrier=true,security_invoker=false) AS
SELECT id,x_handle,x_username,x_avatar_url FROM public.profiles
WHERE deleted_at IS NULL AND onboarding_completed IS TRUE;
REVOKE ALL ON public.public_social_profiles FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.public_social_profiles TO anon,authenticated;

CREATE OR REPLACE VIEW public.public_office_profiles
WITH (security_barrier=true,security_invoker=false) AS
SELECT id,username,full_name,avatar_url,role,x_handle,manual_role_override,
       role_assigned_at,role_assigned_by,updated_at
FROM public.profiles WHERE deleted_at IS NULL AND onboarding_completed IS TRUE
AND role IN ('Presidente','Vice-Presidente');
REVOKE ALL ON public.public_office_profiles FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.public_office_profiles TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_public_party_profiles(p_ids uuid[])
 RETURNS TABLE(id uuid, citizen_id uuid, full_name text, username text, avatar_url text, role text, titles text[], party_affiliation uuid, x_username text, x_handle text, x_avatar_url text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if coalesce(cardinality(p_ids),0)>100 then raise exception 'Consulte até 100 perfis por vez.'; end if;
 return query select p.id,p.citizen_id,p.full_name,p.username,p.avatar_url,CASE WHEN p.role = 'Admin' THEN 'Cidadão' ELSE p.role END,array_remove(coalesce(p.titles,'{}'::text[]),'Admin'),p.party_affiliation,p.x_username,p.x_handle,p.x_avatar_url
 from public.profiles p where p.id=any(p_ids) and p.deleted_at is null and (p.onboarding_completed or p.onboarding_mode='legacy_migration');
end; $function$
;
CREATE OR REPLACE FUNCTION public.search_citizens(p_search text DEFAULT ''::text, p_roles text[] DEFAULT NULL::text[], p_limit integer DEFAULT 30, p_offset integer DEFAULT 0, p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(id uuid, citizen_id uuid, full_name text, username text, avatar_url text, role text, x_username text, x_handle text, x_avatar_url text, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if length(coalesce(p_search,'')) > 120 or coalesce(cardinality(p_ids),0)>1000 then
    raise exception 'INVALID_SEARCH';
  end if;
  return query
  select p.id,p.citizen_id,p.full_name,p.username,p.avatar_url,(CASE WHEN p.role = 'Admin' THEN 'Cidadão' ELSE p.role END)::text,
    p.x_username,p.x_handle,p.x_avatar_url,count(*) over()
  from public.profiles p
  where p.deleted_at is null
    and (p.onboarding_completed or p.onboarding_mode='legacy_migration')
    and (p_roles is null or (CASE WHEN p.role='Admin' THEN 'Cidadão' ELSE p.role END)::text=any(p_roles))
    and (p_ids is null or p.id=any(p_ids))
    and (coalesce(p_search,'')='' or position(lower(trim(p_search)) in lower(concat_ws(' ',p.full_name,p.username,p.x_username,p.x_handle)))>0)
  order by lower(coalesce(p.full_name,p.username)),p.id
  limit least(greatest(coalesce(p_limit,30),1),100) offset greatest(coalesce(p_offset,0),0);
end $function$
;
COMMIT;
