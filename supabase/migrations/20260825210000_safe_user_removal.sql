begin;

-- User removal is intentionally a soft, anonymizing operation. Economic,
-- legislative and judicial ledgers keep the stable profile id they already
-- reference, while credentials and personally identifying data are revoked.
alter table public.profiles
  add column if not exists deleted_at timestamptz,
  add column if not exists anonymized_at timestamptz,
  add column if not exists deletion_reason text;

create index if not exists profiles_active_created_at_idx
  on public.profiles (created_at desc)
  where deleted_at is null;

create table if not exists private.deleted_user_snapshots (
  id uuid primary key default gen_random_uuid(),
  deleted_user_id uuid not null,
  deleted_by uuid not null,
  profile_snapshot jsonb not null,
  account_identity_snapshot jsonb,
  preservation_summary jsonb not null default '{}'::jsonb,
  reason text,
  created_at timestamptz not null default clock_timestamp()
);

alter table private.deleted_user_snapshots enable row level security;
revoke all on private.deleted_user_snapshots from public, anon, authenticated;
grant all on private.deleted_user_snapshots to service_role;

drop function if exists public.admin_delete_user(uuid);
create function public.admin_delete_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_identity jsonb;
  v_anonymous_key text := replace(p_user_id::text, '-', '');
  v_snapshot_id uuid;
begin
  if public.get_user_role(v_admin_id) <> 'Admin' then
    raise exception 'Acesso negado: apenas administradores podem remover contas.';
  end if;

  if p_user_id is null or p_user_id = v_admin_id then
    raise exception 'A conta administrativa em uso não pode ser removida.';
  end if;

  select * into v_profile
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'message', 'Usuário não encontrado.');
  end if;

  if v_profile.deleted_at is not null then
    return jsonb_build_object('success', true, 'message', 'Esta conta já foi removida e anonimizada.');
  end if;

  select to_jsonb(identity_row) into v_identity
  from private.account_identities identity_row
  where identity_row.user_id = p_user_id;

  insert into private.deleted_user_snapshots (
    deleted_user_id,
    deleted_by,
    profile_snapshot,
    account_identity_snapshot,
    preservation_summary,
    reason
  ) values (
    p_user_id,
    v_admin_id,
    to_jsonb(v_profile),
    v_identity,
    jsonb_build_object(
      'economic_events', (select count(*) from public.economic_events where actor_profile_id = p_user_id),
      'bills', (select count(*) from public.bills where author_id = p_user_id),
      'documents', coalesce((
        select jsonb_agg(to_jsonb(document_row) order by document_row.created_at)
        from public.documents document_row
        where document_row.user_id = p_user_id
      ), '[]'::jsonb),
      'notifications_preserved', true,
      'legal_history_preserved', true,
      'profile_id_preserved', true
    ),
    'Remoção administrativa com preservação de histórico'
  )
  returning id into v_snapshot_id;

  -- Revoke every live authentication path without deleting auth.users. Keeping
  -- that row preserves the profiles FK and therefore all immutable ledgers.
  delete from auth.refresh_tokens where user_id::text = p_user_id::text;
  delete from auth.sessions where user_id = p_user_id;
  delete from auth.identities where user_id = p_user_id;

  if to_regclass('auth.mfa_factors') is not null then
    execute 'delete from auth.mfa_factors where user_id = $1' using p_user_id;
  end if;

  update auth.users
  set email = 'removed-' || v_anonymous_key || '@accounts.invalid',
      phone = null,
      encrypted_password = encode(extensions.gen_random_bytes(48), 'hex'),
      raw_user_meta_data = jsonb_build_object('account_removed', true),
      raw_app_meta_data = jsonb_build_object('provider', 'removed', 'providers', jsonb_build_array()),
      banned_until = 'infinity'::timestamptz,
      updated_at = clock_timestamp()
  where id = p_user_id;

  update private.account_identities
  set real_full_name = null,
      real_date_of_birth = null,
      email = null,
      phone = null,
      phone_country_code = null,
      updated_at = clock_timestamp()
  where user_id = p_user_id;

  update public.profiles
  set username = 'removed_' || left(v_anonymous_key, 12),
      full_name = 'Cidadão removido',
      phone = null,
      avatar_url = null,
      date_of_birth = null,
      rg = null,
      cpf = null,
      email = null,
      x_username = null,
      x_handle = null,
      x_bio = null,
      x_header_url = null,
      x_avatar_url = null,
      titles = '{}'::text[],
      marital_status = null,
      occupation = null,
      education_level = null,
      ui_preferences = '{}'::jsonb,
      party_affiliation = null,
      manual_role_override = false,
      role_assigned_at = null,
      role_assigned_by = null,
      role = 'Usuário',
      country_code = null,
      country_name = null,
      state_code = null,
      state_name = null,
      titulo_eleitor = null,
      carteira_trabalho = null,
      character_bio = null,
      birth_country_code = null,
      birth_country_name = null,
      birth_state_code = null,
      birth_state_name = null,
      birth_city_code = null,
      birth_city_name = null,
      residence_country_code = null,
      residence_country_name = null,
      residence_state_code = null,
      residence_state_name = null,
      residence_city_code = null,
      residence_city_name = null,
      initial_aspiration = null,
      onboarding_completed = false,
      onboarding_step = 'welcome',
      deleted_at = clock_timestamp(),
      anonymized_at = clock_timestamp(),
      deletion_reason = 'Remoção administrativa',
      updated_at = clock_timestamp()
  where id = p_user_id;

  -- Banking records remain auditable, but their live credentials cannot be
  -- used to locate or transact with the removed account.
  update public.accounts
  set transfer_key = null,
      cpf = null,
      agency_number = 'REM',
      account_number = 'REM-' || left(v_anonymous_key, 16),
      updated_at = clock_timestamp()
  where user_id = p_user_id;

  update public.cards set is_active = false where user_id = p_user_id;

  update public.documents
  set document_number = 'REM-' || left(replace(id::text, '-', ''), 20),
      is_valid = false,
      metadata = jsonb_build_object('account_removed', true),
      qr_code_data = null,
      history = null,
      full_name = 'Cidadão removido'
  where user_id = p_user_id;

  if to_regclass('public.support_tickets') is not null then
    execute $redact$
      update public.support_tickets
      set requester_name = 'Cidadão removido',
          requester_email = 'removed@accounts.invalid',
          requester_phone = null,
          updated_at = clock_timestamp()
      where requester_id = $1
    $redact$ using p_user_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'message', 'Conta removida. Dados pessoais e acessos foram apagados; os registros históricos permaneceram preservados.',
    'snapshot_id', v_snapshot_id,
    'preserved_profile_id', p_user_id
  );
end;
$$;

revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated, service_role;

-- Removed profiles must not be included in public or administrative totals.
create or replace function public.get_public_dashboard_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total_users', (select count(*) from public.profiles where deleted_at is null),
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
    (select count(*) from public.profiles where deleted_at is null),
    (select count(*) from public.posts),
    (select count(*) from public.transactions),
    (select count(*) from public.accounts a join public.profiles p on p.id = a.user_id where p.deleted_at is null),
    (select count(*) from public.comments),
    (select count(*) from public.cards c join public.profiles p on p.id = c.user_id where p.deleted_at is null);
end;
$$;

revoke all on function public.get_admin_dashboard_stats() from public, anon;
grant execute on function public.get_admin_dashboard_stats() to authenticated, service_role;

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
    coalesce((
      select array_agg(distinct d.type::text order by d.type::text)
      from public.documents d
      where d.user_id = p.id and d.is_valid
    ), '{}'::text[])::text[]
  from public.profiles p
  left join private.account_identities ai on ai.user_id = p.id
  left join auth.users au on au.id = p.id
  left join public.accounts a on a.user_id = p.id
  where p.deleted_at is null
  order by p.full_name nulls last, p.username;
end;
$$;

revoke all on function public.admin_get_all_users() from public, anon;
grant execute on function public.admin_get_all_users() to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
