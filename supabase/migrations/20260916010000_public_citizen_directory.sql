-- A public projection for selectors: legacy RP citizens remain eligible during
-- identity migration, without granting SELECT on private profile columns.
create or replace function public.search_citizens(
  p_search text default '', p_roles text[] default null,
  p_limit integer default 30, p_offset integer default 0, p_ids uuid[] default null
) returns table(id uuid, citizen_id uuid, full_name text, username text,
  avatar_url text, role text, x_username text, x_handle text, x_avatar_url text, total_count bigint)
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if length(coalesce(p_search,'')) > 120 or coalesce(cardinality(p_ids),0)>1000 then
    raise exception 'INVALID_SEARCH';
  end if;
  return query
  select p.id,p.citizen_id,p.full_name,p.username,p.avatar_url,p.role::text,
    p.x_username,p.x_handle,p.x_avatar_url,count(*) over()
  from public.profiles p
  where p.deleted_at is null
    and (p.onboarding_completed or p.onboarding_mode='legacy_migration')
    and (p_roles is null or p.role::text=any(p_roles))
    and (p_ids is null or p.id=any(p_ids))
    and (coalesce(p_search,'')='' or position(lower(trim(p_search)) in lower(concat_ws(' ',p.full_name,p.username,p.x_username,p.x_handle)))>0)
  order by lower(coalesce(p.full_name,p.username)),p.id
  limit least(greatest(coalesce(p_limit,30),1),100) offset greatest(coalesce(p_offset,0),0);
end $$;
revoke all on function public.search_citizens(text,text[],integer,integer,uuid[]) from public,anon;
grant execute on function public.search_citizens(text,text[],integer,integer,uuid[]) to authenticated;
notify pgrst,'reload schema';
