begin;

create or replace function public.economic_has_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and (
        lower(p.role) = any (
          select lower(unnest(p_roles))
        )
        or exists (
          select 1
          from unnest(coalesce(p.titles, array[]::text[])) title
          where lower(title) = any (
            select lower(unnest(p_roles))
          )
        )
        or (
          (
            lower(p.role) = 'presidente do banco nacional'
            or exists (
              select 1
              from unnest(coalesce(p.titles, array[]::text[])) title
              where lower(title) = 'presidente do banco nacional'
            )
          )
          and exists (
            select 1
            from unnest(p_roles) requested_role
            where lower(requested_role) in ('banco central', 'presidente do banco central')
          )
        )
      )
  );
$$;

revoke all on function public.economic_has_role(text[]) from public,anon;
grant execute on function public.economic_has_role(text[]) to authenticated,service_role;

commit;
