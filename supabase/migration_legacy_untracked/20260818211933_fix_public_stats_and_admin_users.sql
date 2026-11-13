-- Public counters are intentionally aggregated across the whole platform.
-- SECURITY DEFINER prevents RLS from turning the totals into 0 for anonymous
-- visitors or into "only my rows" for authenticated citizens.
drop function if exists public.get_public_dashboard_stats();

create function public.get_public_dashboard_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total_users', (select count(*) from public.profiles),
    'total_transactions', (select count(*) from public.transactions),
    'total_posts', (select count(*) from public.posts where parent_post_id is null),
    'total_parties', (select count(*) from public.political_parties),
    'government_balance', (select treasury_balance from public.government_finances where id = 1)
  );
$$;

revoke all on function public.get_public_dashboard_stats() from public;
grant execute on function public.get_public_dashboard_stats() to anon, authenticated, service_role;

create or replace function public.get_admin_dashboard_stats()
returns table (
  total_users bigint,
  total_posts bigint,
  total_transactions bigint,
  total_accounts bigint,
  total_comments bigint,
  total_cards bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.get_user_role(auth.uid()) <> 'Admin' then
    raise exception 'Acesso negado: apenas administradores podem consultar estas estatísticas';
  end if;

  return query
  select
    (select count(*) from public.profiles),
    (select count(*) from public.posts),
    (select count(*) from public.transactions),
    (select count(*) from public.accounts),
    (select count(*) from public.comments),
    (select count(*) from public.cards);
end;
$$;

revoke all on function public.get_admin_dashboard_stats() from public, anon;
grant execute on function public.get_admin_dashboard_stats() to authenticated, service_role;

-- Recreate the admin RPC with an explicit output contract. Postgres does not
-- implicitly accept varchar/domain columns for RETURNS TABLE text fields in a
-- RETURN QUERY, which caused PGRST to report that the query structure did not
-- match the function result type after the citizen identity migration.
drop function if exists public.admin_get_all_users();

create function public.admin_get_all_users()
returns table (
  id uuid,
  full_name text,
  username text,
  character_birth_date date,
  email text,
  real_full_name text,
  real_date_of_birth date,
  phone text,
  avatar_url text,
  role text,
  titles text[],
  x_handle text,
  has_bank_account boolean,
  balance numeric,
  onboarding_completed boolean,
  onboarding_step text,
  onboarding_version integer,
  onboarding_mode text,
  citizen_id uuid,
  citizenship_created_at timestamptz,
  document_types text[]
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.get_user_role(auth.uid()) <> 'Admin' then
    raise exception 'Acesso negado.';
  end if;

  return query
  select
    p.id::uuid,
    p.full_name::text,
    p.username::text,
    p.date_of_birth::date,
    coalesce(au.email::text, ai.email::text),
    ai.real_full_name::text,
    ai.real_date_of_birth::date,
    ai.phone::text,
    p.avatar_url::text,
    p.role::text,
    coalesce(p.titles, '{}'::text[])::text[],
    p.x_handle::text,
    (a.id is not null)::boolean,
    a.balance::numeric,
    p.onboarding_completed::boolean,
    p.onboarding_step::text,
    p.onboarding_version::integer,
    p.onboarding_mode::text,
    p.citizen_id::uuid,
    p.citizenship_created_at::timestamptz,
    coalesce(
      (
        select array_agg(distinct d.type::text order by d.type::text)
        from public.documents d
        where d.user_id = p.id
          and d.is_valid
      ),
      '{}'::text[]
    )::text[]
  from public.profiles p
  left join private.account_identities ai on ai.user_id = p.id
  left join auth.users au on au.id = p.id
  left join public.accounts a on a.user_id = p.id
  order by p.full_name nulls last, p.username;
end;
$$;

revoke all on function public.admin_get_all_users() from public, anon;
grant execute on function public.admin_get_all_users() to authenticated, service_role;

notify pgrst, 'reload schema';
