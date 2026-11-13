-- GOVRP Citizen Identity and Onboarding v2
-- Separates private account identity (OOC) from public character/citizen data (IC).

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.account_identities (
  user_id uuid primary key references auth.users(id) on delete cascade,
  real_full_name text,
  real_date_of_birth date,
  email text,
  phone text,
  phone_country_code text default '+55',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint account_identities_real_name_length
    check (real_full_name is null or char_length(real_full_name) between 3 and 120)
);

alter table private.account_identities enable row level security;
revoke all on private.account_identities from public, anon, authenticated;

alter table public.profiles
  add column if not exists citizen_id uuid default gen_random_uuid(),
  add column if not exists character_bio text,
  add column if not exists birth_country_code text,
  add column if not exists birth_country_name text,
  add column if not exists birth_state_code text,
  add column if not exists birth_state_name text,
  add column if not exists birth_city_code text,
  add column if not exists birth_city_name text,
  add column if not exists residence_country_code text,
  add column if not exists residence_country_name text,
  add column if not exists residence_state_code text,
  add column if not exists residence_state_name text,
  add column if not exists residence_city_code text,
  add column if not exists residence_city_name text,
  add column if not exists initial_aspiration text,
  add column if not exists onboarding_step text not null default 'welcome',
  add column if not exists onboarding_version integer not null default 2,
  add column if not exists onboarding_mode text not null default 'standard',
  add column if not exists onboarding_updated_at timestamptz not null default clock_timestamp(),
  add column if not exists citizenship_created_at timestamptz,
  add column if not exists citizen_profile_confirmed_at timestamptz,
  add column if not exists username_is_generated boolean not null default false;

update public.profiles set citizen_id = gen_random_uuid() where citizen_id is null;
alter table public.profiles alter column citizen_id set not null;

create unique index if not exists profiles_citizen_id_key on public.profiles(citizen_id);
create index if not exists profiles_onboarding_status_idx
  on public.profiles(onboarding_completed, onboarding_step, onboarding_version);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_character_bio_length') then
    alter table public.profiles add constraint profiles_character_bio_length
      check (character_bio is null or char_length(character_bio) <= 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_initial_aspiration_check') then
    alter table public.profiles add constraint profiles_initial_aspiration_check
      check (initial_aspiration is null or initial_aspiration in (
        'politics', 'entrepreneurship', 'justice', 'security', 'communication', 'knowledge', 'civil_life'
      ));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_onboarding_step_check') then
    alter table public.profiles add constraint profiles_onboarding_step_check
      check (onboarding_step in (
        'welcome', 'identity', 'origin', 'profile', 'civil_documents',
        'mandatory_documents', 'initial_status', 'citizenship', 'completed'
      ));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_onboarding_mode_check') then
    alter table public.profiles add constraint profiles_onboarding_mode_check
      check (onboarding_mode in ('standard', 'legacy_migration'));
  end if;
end;
$$;

comment on column public.profiles.full_name is
  'Nome civil público do personagem/cidadão (IC). Nunca armazena o nome real da conta.';
comment on column public.profiles.date_of_birth is
  'Data de nascimento do personagem/cidadão (IC).';
comment on column public.profiles.email is
  'Campo legado. Dados OOC foram migrados para private.account_identities e este campo deve permanecer nulo.';
comment on column public.profiles.phone is
  'Campo legado. Dados OOC foram migrados para private.account_identities e este campo deve permanecer nulo.';
comment on column public.profiles.citizenship_created_at is
  'Horário autoritativo em que a cidadania IC foi concedida; distinto de auth.users.created_at.';

insert into private.account_identities (
  user_id, real_full_name, real_date_of_birth, email, phone, created_at, updated_at
)
select
  au.id,
  nullif(trim(coalesce(
    au.raw_user_meta_data->>'real_full_name',
    au.raw_user_meta_data->>'full_name',
    p.full_name
  )), ''),
  case
    when coalesce(au.raw_user_meta_data->>'real_date_of_birth', au.raw_user_meta_data->>'date_of_birth')
      ~ '^\d{4}-\d{2}-\d{2}$'
      then coalesce(au.raw_user_meta_data->>'real_date_of_birth', au.raw_user_meta_data->>'date_of_birth')::date
    else p.date_of_birth
  end,
  au.email,
  nullif(regexp_replace(coalesce(
    au.raw_user_meta_data->>'phone', p.phone, au.phone
  ), '\D', '', 'g'), ''),
  coalesce(p.created_at, au.created_at, clock_timestamp()),
  clock_timestamp()
from auth.users au
left join public.profiles p on p.id = au.id
on conflict (user_id) do update set
  real_full_name = coalesce(private.account_identities.real_full_name, excluded.real_full_name),
  real_date_of_birth = coalesce(private.account_identities.real_date_of_birth, excluded.real_date_of_birth),
  email = coalesce(excluded.email, private.account_identities.email),
  phone = coalesce(private.account_identities.phone, excluded.phone),
  updated_at = clock_timestamp();

update private.account_identities
set phone = substring(phone from 3), updated_at = clock_timestamp()
where phone like '55%' and char_length(phone) in (12, 13);

-- Existing accounts enter a shortened confirmation flow. All IC/economic/political data is preserved.
update public.profiles
set
  residence_country_code = coalesce(residence_country_code, country_code),
  residence_country_name = coalesce(residence_country_name, country_name),
  residence_state_code = coalesce(residence_state_code, state_code),
  residence_state_name = coalesce(residence_state_name, state_name),
  onboarding_completed = false,
  onboarding_step = 'identity',
  onboarding_version = 2,
  onboarding_mode = 'legacy_migration',
  onboarding_updated_at = clock_timestamp(),
  username_is_generated = username like 'u\_%' escape '\',
  email = null,
  phone = null;

-- Move legacy cached official numbers into the existing documents source of truth.
insert into public.documents (user_id, type, document_number, issued_at, is_valid, metadata, qr_code_data, full_name)
select p.id, legacy.type, legacy.document_number, p.created_at, true,
  jsonb_build_object('migrated_from_profiles', true, 'original_issued_at_unknown', true),
  'GOVRP:' || legacy.type || ':' || p.id || ':' || legacy.document_number,
  p.full_name
from public.profiles p
cross join lateral (values
  ('CPF'::text, p.cpf),
  ('RG'::text, p.rg),
  ('Título de Eleitor'::text, p.titulo_eleitor),
  ('CTD'::text, p.carteira_trabalho)
) as legacy(type, document_number)
where nullif(trim(legacy.document_number), '') is not null
  and not exists (
    select 1 from public.documents d
    where d.user_id = p.id and d.type = legacy.type and d.is_valid = true
  );

create unique index if not exists documents_valid_type_number_key
  on public.documents(type, document_number) where is_valid = true;
create unique index if not exists accounts_user_id_key on public.accounts(user_id);

insert into public.system_settings(key, value, description, updated_at)
values (
  'citizen_onboarding',
  jsonb_build_object('version', 2, 'initial_bank_balance', 1000, 'minimum_character_age', 0, 'maximum_character_age', 120),
  'Configuração administrável do Registro Nacional de Cidadania.',
  clock_timestamp()
)
on conflict (key) do nothing;

create table if not exists public.citizen_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  dedupe_key text unique,
  created_at timestamptz not null default clock_timestamp()
);

alter table public.citizen_lifecycle_events enable row level security;
drop policy if exists citizen_lifecycle_owner_or_admin_read on public.citizen_lifecycle_events;
create policy citizen_lifecycle_owner_or_admin_read
  on public.citizen_lifecycle_events for select to authenticated
  using (user_id = auth.uid() or public.get_user_role(auth.uid()) = 'Admin');
revoke insert, update, delete, truncate on public.citizen_lifecycle_events from anon, authenticated;
grant select on public.citizen_lifecycle_events to authenticated;
grant all on public.citizen_lifecycle_events to service_role;

create or replace view public.public_citizen_profiles
with (security_invoker = true)
as
select
  id,
  citizen_id,
  username,
  full_name,
  avatar_url,
  character_bio,
  date_of_birth,
  residence_country_code,
  residence_country_name,
  residence_state_code,
  residence_state_name,
  residence_city_code,
  residence_city_name,
  role,
  titles,
  occupation,
  education_level,
  party_affiliation,
  reputation_points,
  x_handle,
  x_username,
  x_bio,
  x_avatar_url,
  citizenship_created_at,
  x_header_url
from public.profiles
where onboarding_completed = true;

grant select on public.public_citizen_profiles to anon, authenticated;

-- The base table remains necessary for existing relationships, but anonymous
-- and cross-user reads are restricted to confirmed citizens. This prevents an
-- ambiguous legacy full_name from remaining public before the player confirms
-- that it is the character's civil name.
drop policy if exists "Public profiles are viewable by everyone." on public.profiles;
drop policy if exists citizen_profiles_public_completed_read on public.profiles;
drop policy if exists citizen_profiles_owner_read on public.profiles;
drop policy if exists citizen_profiles_admin_read on public.profiles;
create policy citizen_profiles_public_completed_read
  on public.profiles for select to public
  using (onboarding_completed = true);
create policy citizen_profiles_owner_read
  on public.profiles for select to authenticated
  using (id = auth.uid());
create policy citizen_profiles_admin_read
  on public.profiles for select to authenticated
  using (public.get_user_role(auth.uid()) = 'Admin');
alter function public.get_user_role(uuid) set search_path = '';

create or replace function public.brazil_state_name(p_state_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case upper(trim(p_state_code))
    when 'AC' then 'Acre' when 'AL' then 'Alagoas' when 'AP' then 'Amapá'
    when 'AM' then 'Amazonas' when 'BA' then 'Bahia' when 'CE' then 'Ceará'
    when 'DF' then 'Distrito Federal' when 'ES' then 'Espírito Santo' when 'GO' then 'Goiás'
    when 'MA' then 'Maranhão' when 'MT' then 'Mato Grosso' when 'MS' then 'Mato Grosso do Sul'
    when 'MG' then 'Minas Gerais' when 'PA' then 'Pará' when 'PB' then 'Paraíba'
    when 'PR' then 'Paraná' when 'PE' then 'Pernambuco' when 'PI' then 'Piauí'
    when 'RJ' then 'Rio de Janeiro' when 'RN' then 'Rio Grande do Norte' when 'RS' then 'Rio Grande do Sul'
    when 'RO' then 'Rondônia' when 'RR' then 'Roraima' when 'SC' then 'Santa Catarina'
    when 'SP' then 'São Paulo' when 'SE' then 'Sergipe' when 'TO' then 'Tocantins'
    else null
  end;
$$;

create or replace function public.record_citizen_lifecycle_event(
  p_user_id uuid,
  p_event_type text,
  p_summary text,
  p_metadata jsonb default '{}'::jsonb,
  p_dedupe_key text default null,
  p_actor_id uuid default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.citizen_lifecycle_events(
    user_id, actor_id, event_type, summary, metadata, dedupe_key
  ) values (
    p_user_id, p_actor_id, p_event_type, p_summary, coalesce(p_metadata, '{}'::jsonb), p_dedupe_key
  ) on conflict (dedupe_key) do nothing;
$$;

revoke all on function public.record_citizen_lifecycle_event(uuid,text,text,jsonb,text,uuid) from public, anon, authenticated;

create or replace function public.brazil_state_ibge_prefix(p_state_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case upper(trim(p_state_code))
    when 'RO' then '11' when 'AC' then '12' when 'AM' then '13' when 'RR' then '14'
    when 'PA' then '15' when 'AP' then '16' when 'TO' then '17' when 'MA' then '21'
    when 'PI' then '22' when 'CE' then '23' when 'RN' then '24' when 'PB' then '25'
    when 'PE' then '26' when 'AL' then '27' when 'SE' then '28' when 'BA' then '29'
    when 'MG' then '31' when 'ES' then '32' when 'RJ' then '33' when 'SP' then '35'
    when 'PR' then '41' when 'SC' then '42' when 'RS' then '43' when 'MS' then '50'
    when 'MT' then '51' when 'GO' then '52' when 'DF' then '53' else null
  end;
$$;

create or replace function public.get_my_account_identity()
returns table (
  user_id uuid,
  real_full_name text,
  real_date_of_birth date,
  email text,
  phone text,
  phone_country_code text
)
language sql
stable
security definer
set search_path = ''
as $$
  select ai.user_id, ai.real_full_name, ai.real_date_of_birth,
    coalesce(au.email, ai.email), ai.phone, ai.phone_country_code
  from private.account_identities ai
  join auth.users au on au.id = ai.user_id
  where ai.user_id = auth.uid();
$$;

revoke all on function public.get_my_account_identity() from public, anon;
grant execute on function public.get_my_account_identity() to authenticated, service_role;

create or replace function public.update_my_account_identity(
  p_real_full_name text,
  p_real_date_of_birth date,
  p_phone text,
  p_phone_country_code text default '+55'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := regexp_replace(trim(coalesce(p_real_full_name, '')), '\s+', ' ', 'g');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
  v_result private.account_identities%rowtype;
begin
  if v_user_id is null then raise exception 'Usuário não autenticado.'; end if;
  if coalesce(p_phone_country_code, '+55') = '+55' and v_phone like '55%'
     and char_length(v_phone) in (12, 13) then
    v_phone := substring(v_phone from 3);
  end if;
  if char_length(v_name) not between 3 and 120 or v_name !~ '[[:alpha:]]' then
    raise exception 'Informe seu nome real completo.';
  end if;
  if p_real_date_of_birth is null or p_real_date_of_birth > current_date - interval '13 years'
     or p_real_date_of_birth < current_date - interval '120 years' then
    raise exception 'Data de nascimento real inválida.';
  end if;
  if v_phone is null or char_length(v_phone) not between 10 and 15 then
    raise exception 'Telefone inválido.';
  end if;

  insert into private.account_identities(
    user_id, real_full_name, real_date_of_birth, email, phone, phone_country_code, updated_at
  )
  select v_user_id, v_name, p_real_date_of_birth, au.email, v_phone,
    coalesce(nullif(trim(p_phone_country_code), ''), '+55'), clock_timestamp()
  from auth.users au where au.id = v_user_id
  on conflict (user_id) do update set
    real_full_name = excluded.real_full_name,
    real_date_of_birth = excluded.real_date_of_birth,
    email = excluded.email,
    phone = excluded.phone,
    phone_country_code = excluded.phone_country_code,
    updated_at = clock_timestamp()
  returning * into v_result;

  return to_jsonb(v_result) - 'created_at' - 'updated_at';
end;
$$;

revoke all on function public.update_my_account_identity(text,date,text,text) from public, anon;
grant execute on function public.update_my_account_identity(text,date,text,text) to authenticated, service_role;

-- The public citizen username is deliberately not a login identifier. Keeping
-- authentication email-only avoids an anonymous resolver that would disclose
-- the private/OOC email linked to a public handle or phone number.
drop function if exists public.resolve_login_identifier(text);

create or replace function public.get_my_citizen_onboarding()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null then raise exception 'Usuário não autenticado.'; end if;

  select jsonb_build_object(
    'profile', to_jsonb(p) - 'email' - 'phone',
    'account_identity', (
      select to_jsonb(ai) - 'created_at' - 'updated_at'
      from private.account_identities ai where ai.user_id = v_user_id
    ),
    'documents', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.issued_at)
      from public.documents d where d.user_id = v_user_id and d.is_valid = true
    ), '[]'::jsonb),
    'bank_account', (
      select to_jsonb(a) from public.accounts a where a.user_id = v_user_id limit 1
    ),
    'lifecycle_events', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.created_at)
      from public.citizen_lifecycle_events e where e.user_id = v_user_id
    ), '[]'::jsonb)
  ) into v_result
  from public.profiles p
  where p.id = v_user_id;

  if v_result is null then raise exception 'Perfil não encontrado.'; end if;
  return v_result;
end;
$$;

revoke all on function public.get_my_citizen_onboarding() from public, anon;
grant execute on function public.get_my_citizen_onboarding() to authenticated, service_role;

create or replace function public.start_citizen_onboarding()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare v_profile public.profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'Usuário não autenticado.'; end if;
  if not exists (
    select 1 from private.account_identities ai where ai.user_id = auth.uid()
      and ai.real_full_name is not null and ai.real_date_of_birth is not null
      and ai.email is not null and ai.phone is not null
  ) then raise exception 'Complete os dados privados da conta antes de criar o cidadão.'; end if;
  update public.profiles set onboarding_step = 'identity', onboarding_version = 2,
    onboarding_updated_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = auth.uid() and onboarding_completed = false
  returning * into v_profile;
  if v_profile.id is null then raise exception 'Onboarding indisponível ou já concluído.'; end if;
  return v_profile;
end;
$$;

revoke all on function public.start_citizen_onboarding() from public, anon;
grant execute on function public.start_citizen_onboarding() to authenticated, service_role;

create or replace function public.save_citizen_identity(
  p_full_name text,
  p_username text,
  p_date_of_birth date,
  p_character_bio text default null,
  p_avatar_url text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
  v_username text := lower(trim(leading '@' from trim(coalesce(p_username, ''))));
  v_bio text := nullif(trim(coalesce(p_character_bio, '')), '');
  v_profile public.profiles%rowtype;
begin
  if v_user_id is null then raise exception 'Usuário não autenticado.'; end if;
  if not exists (
    select 1 from private.account_identities ai where ai.user_id = v_user_id
      and ai.real_full_name is not null and ai.real_date_of_birth is not null
      and ai.email is not null and ai.phone is not null
  ) then raise exception 'Complete os dados privados da conta antes de criar o cidadão.'; end if;
  if char_length(v_name) not between 5 and 80 or v_name !~ '[[:alpha:]]' then
    raise exception 'O nome civil deve ter entre 5 e 80 caracteres e conter letras.';
  end if;
  if v_username !~ '^[a-z0-9][a-z0-9._-]{2,19}$' then
    raise exception 'O username deve ter de 3 a 20 caracteres: letras, números, ponto, hífen ou sublinhado.';
  end if;
  if p_date_of_birth is null
     or p_date_of_birth > current_date
     or p_date_of_birth < current_date - interval '120 years' then
    raise exception 'A data de nascimento do cidadão deve ser válida e ter no máximo 120 anos.';
  end if;
  if v_bio is not null and char_length(v_bio) > 300 then
    raise exception 'A biografia pode ter no máximo 300 caracteres.';
  end if;

  update public.profiles
  set full_name = v_name,
      username = v_username,
      date_of_birth = p_date_of_birth,
      character_bio = v_bio,
      avatar_url = coalesce(nullif(trim(p_avatar_url), ''), avatar_url),
      username_is_generated = false,
      citizen_profile_confirmed_at = clock_timestamp(),
      onboarding_step = 'origin',
      onboarding_updated_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = v_user_id and onboarding_completed = false
  returning * into v_profile;

  if v_profile.id is null then raise exception 'Onboarding indisponível ou já concluído.'; end if;
  perform public.record_citizen_lifecycle_event(
    v_user_id, 'character_created', v_name || ' teve sua identidade civil registrada.',
    jsonb_build_object('username', v_username), 'character-created:' || v_user_id, v_user_id
  );
  return v_profile;
exception
  when unique_violation then raise exception 'Este username já está em uso.';
end;
$$;

revoke all on function public.save_citizen_identity(text,text,date,text,text) from public, anon;
grant execute on function public.save_citizen_identity(text,text,date,text,text) to authenticated, service_role;

create or replace function public.save_citizen_origin(
  p_birth_state_code text,
  p_birth_city_code text,
  p_birth_city_name text,
  p_residence_state_code text,
  p_residence_city_code text,
  p_residence_city_name text
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_birth_state text := upper(trim(coalesce(p_birth_state_code, '')));
  v_residence_state text := upper(trim(coalesce(p_residence_state_code, '')));
  v_birth_state_name text := public.brazil_state_name(p_birth_state_code);
  v_residence_state_name text := public.brazil_state_name(p_residence_state_code);
  v_profile public.profiles%rowtype;
begin
  if v_user_id is null then raise exception 'Usuário não autenticado.'; end if;
  if v_birth_state_name is null or v_residence_state_name is null then
    raise exception 'Selecione estados brasileiros válidos.';
  end if;
  if coalesce(p_birth_city_code, '') !~ '^\d{7}$'
     or left(p_birth_city_code, 2) <> public.brazil_state_ibge_prefix(v_birth_state)
     or nullif(trim(p_birth_city_name), '') is null then
    raise exception 'Selecione um município de nascimento válido.';
  end if;
  if coalesce(p_residence_city_code, '') !~ '^\d{7}$'
     or left(p_residence_city_code, 2) <> public.brazil_state_ibge_prefix(v_residence_state)
     or nullif(trim(p_residence_city_name), '') is null then
    raise exception 'Selecione um município de residência válido.';
  end if;

  update public.profiles
  set birth_country_code = 'BR', birth_country_name = 'Brasil',
      birth_state_code = v_birth_state, birth_state_name = v_birth_state_name,
      birth_city_code = p_birth_city_code, birth_city_name = trim(p_birth_city_name),
      residence_country_code = 'BR', residence_country_name = 'Brasil',
      residence_state_code = v_residence_state, residence_state_name = v_residence_state_name,
      residence_city_code = p_residence_city_code, residence_city_name = trim(p_residence_city_name),
      country_code = 'BR', country_name = 'Brasil',
      state_code = v_residence_state, state_name = v_residence_state_name,
      onboarding_step = 'profile', onboarding_updated_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = v_user_id and onboarding_completed = false
  returning * into v_profile;

  if v_profile.id is null then raise exception 'Onboarding indisponível ou já concluído.'; end if;
  return v_profile;
end;
$$;

revoke all on function public.save_citizen_origin(text,text,text,text,text,text) from public, anon;
grant execute on function public.save_citizen_origin(text,text,text,text,text,text) to authenticated, service_role;

create or replace function public.save_citizen_aspiration(p_initial_aspiration text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
begin
  if v_user_id is null then raise exception 'Usuário não autenticado.'; end if;
  if p_initial_aspiration not in (
    'politics', 'entrepreneurship', 'justice', 'security', 'communication', 'knowledge', 'civil_life'
  ) then raise exception 'Aspiração inicial inválida.'; end if;

  update public.profiles
  set initial_aspiration = p_initial_aspiration,
      onboarding_step = 'civil_documents', onboarding_updated_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = v_user_id and onboarding_completed = false
  returning * into v_profile;
  if v_profile.id is null then raise exception 'Onboarding indisponível ou já concluído.'; end if;
  return v_profile;
end;
$$;

revoke all on function public.save_citizen_aspiration(text) from public, anon;
grant execute on function public.save_citizen_aspiration(text) to authenticated, service_role;

create or replace function public.generate_rp_cpf()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_cpf text;
  v_sum integer;
  v_digit integer;
  i integer;
begin
  loop
    v_base := lpad(floor(random() * 1000000000)::bigint::text, 9, '0');
    if v_base !~ '^([0-9])\1{8}$' then
      v_sum := 0;
      for i in 1..9 loop v_sum := v_sum + substr(v_base, i, 1)::integer * (11 - i); end loop;
      v_digit := mod(11 - mod(v_sum, 11), 10);
      v_cpf := v_base || v_digit::text;
      v_sum := 0;
      for i in 1..10 loop v_sum := v_sum + substr(v_cpf, i, 1)::integer * (12 - i); end loop;
      v_digit := mod(11 - mod(v_sum, 11), 10);
      v_cpf := v_cpf || v_digit::text;
      exit when not exists (
        select 1 from public.documents where type = 'CPF' and document_number = v_cpf and is_valid = true
      ) and not exists (select 1 from public.profiles where cpf = v_cpf);
    end if;
  end loop;
  return v_cpf;
end;
$$;

revoke all on function public.generate_rp_cpf() from public, anon, authenticated;

create or replace function public.generate_citizen_document_number(p_document_type text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number text;
begin
  if p_document_type = 'CPF' then return public.generate_rp_cpf(); end if;
  loop
    v_number := case p_document_type
      when 'RG' then lpad(floor(random() * 1000000000)::bigint::text, 9, '0')
      when 'Título de Eleitor' then lpad(floor(random() * 1000000000000)::bigint::text, 12, '0')
      when 'CTD' then lpad(floor(random() * 10000000)::bigint::text, 7, '0') || ' ' || lpad(floor(random() * 1000)::bigint::text, 3, '0')
      else null
    end;
    if v_number is null then raise exception 'Tipo de documento inválido.'; end if;
    exit when not exists (
      select 1 from public.documents
      where type = p_document_type and document_number = v_number and is_valid = true
    );
  end loop;
  return v_number;
end;
$$;

revoke all on function public.generate_citizen_document_number(text) from public, anon, authenticated;

create or replace function public.issue_citizen_onboarding_document(p_document_type text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_type text := case lower(trim(coalesce(p_document_type, '')))
    when 'cpf' then 'CPF' when 'rg' then 'RG'
    when 'título de eleitor' then 'Título de Eleitor' when 'titulo de eleitor' then 'Título de Eleitor'
    when 'ctd' then 'CTD' else null end;
  v_document public.documents%rowtype;
  v_number text;
  v_inserted boolean := false;
  v_name text;
begin
  if v_user_id is null then raise exception 'Usuário não autenticado.'; end if;
  if v_type is null then raise exception 'Tipo de documento inválido.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text || ':' || v_type, 0));

  select full_name into v_name from public.profiles
  where id = v_user_id and citizen_profile_confirmed_at is not null
    and residence_city_code is not null and initial_aspiration is not null
    and onboarding_completed = false;
  if v_name is null then raise exception 'Complete identidade, origem e perfil antes de emitir documentos.'; end if;
  if v_type in ('Título de Eleitor','CTD') and not exists (
    select 1 from public.documents where user_id = v_user_id and type in ('CPF','RG') and is_valid
    group by user_id having count(distinct type) = 2
  ) then raise exception 'Emita CPF e RG antes dos documentos obrigatórios.'; end if;

  select * into v_document from public.documents
  where user_id = v_user_id and type = v_type and is_valid = true
  order by issued_at desc limit 1;

  if not found then
    select case v_type
      when 'CPF' then cpf when 'RG' then rg
      when 'Título de Eleitor' then titulo_eleitor when 'CTD' then carteira_trabalho
    end into v_number
    from public.profiles where id = v_user_id;
    v_number := coalesce(nullif(trim(v_number), ''), public.generate_citizen_document_number(v_type));

    insert into public.documents(
      user_id, type, document_number, issued_at, is_valid, metadata, qr_code_data, full_name
    ) values (
      v_user_id, v_type, v_number, clock_timestamp(), true,
      jsonb_build_object('issued_by', 'citizen_onboarding_v2', 'onboarding_version', 2),
      'GOVRP:' || v_type || ':' || v_user_id || ':' || v_number, v_name
    ) returning * into v_document;
    v_inserted := true;
  end if;

  update public.profiles
  set cpf = case when v_type = 'CPF' then v_document.document_number else cpf end,
      rg = case when v_type = 'RG' then v_document.document_number else rg end,
      titulo_eleitor = case when v_type = 'Título de Eleitor' then v_document.document_number else titulo_eleitor end,
      carteira_trabalho = case when v_type = 'CTD' then v_document.document_number else carteira_trabalho end,
      onboarding_step = case
        when v_type in ('Título de Eleitor','CTD') and exists (
          select 1 from public.documents d where d.user_id = v_user_id and d.is_valid and d.type in ('Título de Eleitor','CTD')
          group by d.user_id having count(distinct d.type) = 2
        ) and onboarding_step in ('identity','origin','profile','civil_documents','mandatory_documents') then 'initial_status'
        when v_type in ('CPF','RG') and exists (
          select 1 from public.documents d where d.user_id = v_user_id and d.is_valid and d.type in ('CPF','RG')
          group by d.user_id having count(distinct d.type) = 2
        ) and onboarding_step in ('identity','origin','profile','civil_documents') then 'mandatory_documents'
        else onboarding_step end,
      onboarding_updated_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = v_user_id;

  if v_inserted then
    perform public.record_citizen_lifecycle_event(
      v_user_id, 'document_issued', v_type || ' emitido.',
      jsonb_build_object('document_id', v_document.id, 'document_type', v_type),
      'document-issued:' || v_document.id, v_user_id
    );
    insert into public.notifications(user_id, content, link, type, metadata)
    values (v_user_id, v_type || ' emitido com sucesso.', '/services/dic', 'citizen_document',
      jsonb_build_object('document_id', v_document.id, 'document_type', v_type));
  end if;

  return jsonb_build_object('document', to_jsonb(v_document), 'created', v_inserted);
end;
$$;

revoke all on function public.issue_citizen_onboarding_document(text) from public, anon;
grant execute on function public.issue_citizen_onboarding_document(text) to authenticated, service_role;

create or replace function public.issue_onboarding_document(p_document_type text)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select public.issue_citizen_onboarding_document(p_document_type); $$;
revoke all on function public.issue_onboarding_document(text) from public, anon;
grant execute on function public.issue_onboarding_document(text) to authenticated, service_role;

create or replace function public.ensure_citizen_bank_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_account public.accounts%rowtype;
  v_balance numeric := 1000;
  v_setting jsonb;
  v_agency text;
  v_account_number text;
  v_transfer_key text;
  v_created boolean := false;
begin
  if v_user_id is null then raise exception 'Usuário não autenticado.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text || ':bank', 0));

  select * into v_profile from public.profiles where id = v_user_id;
  if not exists (
    select 1 from public.documents where user_id = v_user_id
      and type in ('CPF','RG','Título de Eleitor','CTD') and is_valid
    group by user_id having count(distinct type) = 4
  ) then raise exception 'Emita os quatro documentos obrigatórios antes de abrir a conta.'; end if;

  select * into v_account from public.accounts where user_id = v_user_id limit 1;
  if found then
    update public.profiles set onboarding_step = case when onboarding_completed then onboarding_step else 'citizenship' end,
      onboarding_updated_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = v_user_id;
    return jsonb_build_object('account', to_jsonb(v_account), 'created', false);
  end if;

  select value into v_setting from public.system_settings where key = 'citizen_onboarding';
  if coalesce(v_setting->>'initial_bank_balance', '') ~ '^\d+(\.\d+)?$' then
    v_balance := (v_setting->>'initial_bank_balance')::numeric;
  end if;
  v_balance := greatest(0, v_balance);

  loop
    v_agency := lpad(floor(random() * 10000)::bigint::text, 4, '0');
    v_account_number := lpad(floor(random() * 10000000)::bigint::text, 7, '0') || '-' || floor(random() * 10)::integer::text;
    exit when not exists (select 1 from public.accounts where account_number = v_account_number);
  end loop;
  v_transfer_key := public.generate_unique_transfer_key();

  insert into public.accounts(user_id, agency_number, account_number, balance, cpf, transfer_key)
  values (v_user_id, v_agency, v_account_number, v_balance, v_profile.cpf, v_transfer_key)
  returning * into v_account;
  v_created := true;

  if v_balance > 0 then
    insert into public.transactions(to_account_id, amount, description, type, metadata)
    values (v_account.id, v_balance, 'Saldo inicial da cidadania', 'citizenship_initial_balance',
      jsonb_build_object('onboarding_version', 2, 'source', 'citizen_onboarding'));
  end if;

  update public.profiles set onboarding_step = case when onboarding_completed then onboarding_step else 'citizenship' end,
    onboarding_updated_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = v_user_id;
  perform public.record_citizen_lifecycle_event(
    v_user_id, 'bank_account_created', 'Conta no Banco Nacional criada.',
    jsonb_build_object('account_id', v_account.id, 'initial_balance', v_balance),
    'bank-account-created:' || v_account.id, v_user_id
  );
  insert into public.notifications(user_id, content, link, type, metadata)
  values (v_user_id, 'Sua conta no Banco Nacional foi aberta.', '/services/bank', 'citizen_bank_account',
    jsonb_build_object('account_id', v_account.id));

  return jsonb_build_object('account', to_jsonb(v_account), 'created', v_created);
end;
$$;

revoke all on function public.ensure_citizen_bank_account() from public, anon;
grant execute on function public.ensure_citizen_bank_account() to authenticated, service_role;

create or replace function public.create_bank_account()
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  v_result := public.ensure_citizen_bank_account();
  return jsonb_build_object(
    'success', true,
    'message', case when coalesce((v_result->>'created')::boolean, false)
      then 'Conta bancária criada com sucesso!'
      else 'Sua conta bancária existente foi preservada.' end,
    'created', coalesce((v_result->>'created')::boolean, false),
    'account', v_result->'account'
  )::json;
end;
$$;
revoke all on function public.create_bank_account() from public, anon;
grant execute on function public.create_bank_account() to authenticated, service_role;

create or replace function public.finalize_citizen_onboarding()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_document_count integer;
  v_created_at timestamptz;
begin
  if v_user_id is null then raise exception 'Usuário não autenticado.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text || ':finalize', 0));
  select * into v_profile from public.profiles where id = v_user_id for update;
  if v_profile.id is null then raise exception 'Perfil não encontrado.'; end if;
  if not exists (
    select 1 from private.account_identities ai where ai.user_id = v_user_id
      and ai.real_full_name is not null and ai.real_date_of_birth is not null
      and ai.email is not null and ai.phone is not null
  ) then raise exception 'Os dados privados da conta estão incompletos.'; end if;
  if v_profile.onboarding_completed then
    return jsonb_build_object('profile', to_jsonb(v_profile) - 'email' - 'phone', 'already_completed', true);
  end if;
  if v_profile.full_name is null or v_profile.username_is_generated or v_profile.date_of_birth is null
     or v_profile.citizen_profile_confirmed_at is null then
    raise exception 'A identidade do cidadão está incompleta.';
  end if;
  if v_profile.birth_city_code is null or v_profile.residence_city_code is null
     or v_profile.birth_state_code is null or v_profile.residence_state_code is null then
    raise exception 'Origem e residência estão incompletas.';
  end if;
  if v_profile.initial_aspiration is null then raise exception 'Selecione uma aspiração inicial.'; end if;

  select count(distinct type) into v_document_count
  from public.documents
  where user_id = v_user_id and is_valid and type in ('CPF','RG','Título de Eleitor','CTD');
  if v_document_count <> 4 then raise exception 'Os quatro documentos obrigatórios ainda não foram emitidos.'; end if;
  if not exists (select 1 from public.accounts where user_id = v_user_id) then
    raise exception 'A conta no Banco Nacional ainda não foi criada.';
  end if;

  v_created_at := coalesce(v_profile.citizenship_created_at, clock_timestamp());
  update public.profiles
  set onboarding_completed = true, onboarding_step = 'completed', onboarding_version = 2,
      citizenship_created_at = v_created_at, onboarding_updated_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = v_user_id
  returning * into v_profile;

  perform public.record_citizen_lifecycle_event(
    v_user_id, 'citizenship_granted',
    v_profile.full_name || ' tornou-se oficialmente cidadão do GOVRP.',
    jsonb_build_object('citizenship_created_at', v_created_at, 'onboarding_version', 2),
    'citizenship-granted:' || v_user_id, v_user_id
  );
  insert into public.notifications(user_id, content, link, type, metadata)
  select v_user_id, 'Cidadania concedida a ' || v_profile.full_name || '.', '/dashboard', 'citizenship_granted',
    jsonb_build_object('citizenship_created_at', v_created_at)
  where not exists (
    select 1 from public.notifications n
    where n.user_id = v_user_id and n.type = 'citizenship_granted'
  );

  return jsonb_build_object('profile', to_jsonb(v_profile) - 'email' - 'phone', 'already_completed', false);
end;
$$;

revoke all on function public.finalize_citizen_onboarding() from public, anon;
grant execute on function public.finalize_citizen_onboarding() to authenticated, service_role;

create or replace function public.update_my_citizen_profile(p_character_bio text, p_avatar_url text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare v_profile public.profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'Usuário não autenticado.'; end if;
  if p_character_bio is not null and char_length(trim(p_character_bio)) > 300 then
    raise exception 'A biografia pode ter no máximo 300 caracteres.';
  end if;
  update public.profiles set character_bio = nullif(trim(coalesce(p_character_bio, '')), ''),
    avatar_url = nullif(trim(coalesce(p_avatar_url, '')), ''), updated_at = clock_timestamp()
  where id = auth.uid() returning * into v_profile;
  return v_profile;
end;
$$;

revoke all on function public.update_my_citizen_profile(text,text) from public, anon;
grant execute on function public.update_my_citizen_profile(text,text) to authenticated, service_role;

drop function if exists public.admin_get_all_users();

create function public.admin_get_all_users()
returns table (
  id uuid, full_name text, username text, character_birth_date date, email text, real_full_name text, real_date_of_birth date,
  phone text, role text, titles text[], x_handle text, has_bank_account boolean, balance numeric,
  onboarding_completed boolean, onboarding_step text, onboarding_version integer, onboarding_mode text,
  citizen_id uuid, citizenship_created_at timestamptz, document_types text[]
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.get_user_role(auth.uid()) <> 'Admin' then raise exception 'Acesso negado.'; end if;
  return query
  select p.id, p.full_name, p.username, p.date_of_birth, coalesce(au.email, ai.email), ai.real_full_name, ai.real_date_of_birth,
    ai.phone, p.role, p.titles, p.x_handle, a.id is not null, a.balance,
    p.onboarding_completed, p.onboarding_step, p.onboarding_version, p.onboarding_mode,
    p.citizen_id, p.citizenship_created_at,
    coalesce((select array_agg(distinct d.type order by d.type) from public.documents d
      where d.user_id = p.id and d.is_valid), '{}'::text[])
  from public.profiles p
  left join private.account_identities ai on ai.user_id = p.id
  left join auth.users au on au.id = p.id
  left join public.accounts a on a.user_id = p.id;
end;
$$;

revoke all on function public.admin_get_all_users() from public, anon;
grant execute on function public.admin_get_all_users() to authenticated, service_role;

create or replace function public.admin_update_citizen_identity(
  p_user_id uuid,
  p_character_full_name text,
  p_username text,
  p_character_birth_date date,
  p_real_full_name text default null,
  p_real_birth_date date default null,
  p_onboarding_step text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.get_user_role(auth.uid()) <> 'Admin' then raise exception 'Acesso negado.'; end if;
  if p_onboarding_step is not null and p_onboarding_step not in (
    'welcome','identity','origin','profile','civil_documents','mandatory_documents','initial_status','citizenship','completed'
  ) then raise exception 'Etapa inválida.'; end if;
  update public.profiles set
    full_name = coalesce(nullif(regexp_replace(trim(p_character_full_name), '\s+', ' ', 'g'), ''), full_name),
    username = coalesce(nullif(lower(trim(leading '@' from trim(p_username))), ''), username),
    date_of_birth = coalesce(p_character_birth_date, date_of_birth),
    onboarding_step = coalesce(p_onboarding_step, onboarding_step),
    onboarding_updated_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = p_user_id;
  update private.account_identities set
    real_full_name = coalesce(nullif(trim(p_real_full_name), ''), real_full_name),
    real_date_of_birth = coalesce(p_real_birth_date, real_date_of_birth), updated_at = clock_timestamp()
  where user_id = p_user_id;
end;
$$;

revoke all on function public.admin_update_citizen_identity(uuid,text,text,date,text,date,text) from public, anon;
grant execute on function public.admin_update_citizen_identity(uuid,text,text,date,text,date,text) to authenticated, service_role;

create or replace function public.admin_reset_citizen_onboarding(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.get_user_role(auth.uid()) <> 'Admin' then
    raise exception 'Apenas administradores podem reiniciar o primeiro acesso.';
  end if;
  update public.profiles set onboarding_completed = false, onboarding_step = 'identity',
    onboarding_mode = 'legacy_migration', onboarding_version = 2,
    onboarding_updated_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = p_user_id;
  if not found then raise exception 'Cidadão não encontrado.'; end if;
  perform public.record_citizen_lifecycle_event(
    p_user_id, 'onboarding_reset', 'Onboarding reiniciado por um administrador.',
    jsonb_build_object('preserved_documents', true, 'preserved_bank_account', true),
    'onboarding-reset:' || gen_random_uuid(), auth.uid()
  );
end;
$$;

revoke all on function public.admin_reset_citizen_onboarding(uuid) from public, anon;
grant execute on function public.admin_reset_citizen_onboarding(uuid) to authenticated, service_role;

-- Auth trigger: OAuth creates only an account. Character data stays empty until onboarding.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := 'u_' || left(replace(new.id::text, '-', ''), 8) || right(replace(new.id::text, '-', ''), 10);
  v_real_name text := nullif(trim(coalesce(
    new.raw_user_meta_data->>'real_full_name', new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'
  )), '');
  v_real_birth date;
  v_phone text := nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'phone', new.phone, ''), '\D', '', 'g'), '');
begin
  if coalesce(new.raw_user_meta_data->>'real_date_of_birth', new.raw_user_meta_data->>'date_of_birth') ~ '^\d{4}-\d{2}-\d{2}$' then
    v_real_birth := coalesce(new.raw_user_meta_data->>'real_date_of_birth', new.raw_user_meta_data->>'date_of_birth')::date;
  end if;
  if v_phone like '55%' and char_length(v_phone) in (12, 13) then v_phone := substring(v_phone from 3); end if;

  insert into public.profiles(
    id, username, full_name, email, phone, role, onboarding_completed, onboarding_step,
    onboarding_version, onboarding_mode, username_is_generated, created_at, updated_at
  ) values (
    new.id, v_username, null, null, null, 'Cidadão', false, 'welcome', 2, 'standard', true,
    clock_timestamp(), clock_timestamp()
  ) on conflict (id) do nothing;

  insert into private.account_identities(
    user_id, real_full_name, real_date_of_birth, email, phone, created_at, updated_at
  ) values (
    new.id, v_real_name, v_real_birth, new.email,
    v_phone,
    clock_timestamp(), clock_timestamp()
  ) on conflict (user_id) do update set
    real_full_name = coalesce(excluded.real_full_name, private.account_identities.real_full_name),
    real_date_of_birth = coalesce(excluded.real_date_of_birth, private.account_identities.real_date_of_birth),
    email = coalesce(excluded.email, private.account_identities.email),
    phone = coalesce(excluded.phone, private.account_identities.phone),
    updated_at = clock_timestamp();
  return new;
end;
$$;

create or replace function public.ensure_profile_exists()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user auth.users%rowtype;
  v_phone text;
begin
  select * into v_user from auth.users where id = auth.uid();
  if v_user.id is null then raise exception 'Usuário não autenticado.'; end if;
  v_phone := nullif(regexp_replace(coalesce(v_user.raw_user_meta_data->>'phone', v_user.phone, ''), '\D', '', 'g'), '');
  if v_phone like '55%' and char_length(v_phone) in (12, 13) then v_phone := substring(v_phone from 3); end if;
  insert into public.profiles(
    id, username, role, onboarding_completed, onboarding_step, onboarding_version,
    onboarding_mode, username_is_generated, created_at, updated_at
  ) values (
    v_user.id, 'u_' || left(replace(v_user.id::text, '-', ''), 8) || right(replace(v_user.id::text, '-', ''), 10), 'Cidadão', false,
    'welcome', 2, 'standard', true, clock_timestamp(), clock_timestamp()
  ) on conflict (id) do nothing;
  insert into private.account_identities(user_id, real_full_name, email, phone, created_at, updated_at)
  values (
    v_user.id,
    nullif(trim(coalesce(v_user.raw_user_meta_data->>'real_full_name', v_user.raw_user_meta_data->>'full_name', v_user.raw_user_meta_data->>'name')), ''),
    v_user.email,
    v_phone,
    clock_timestamp(), clock_timestamp()
  ) on conflict (user_id) do update set email = excluded.email, updated_at = clock_timestamp();
end;
$$;

revoke all on function public.ensure_profile_exists() from public, anon;
grant execute on function public.ensure_profile_exists() to authenticated, service_role;

create or replace function public.protect_citizen_official_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then
    if new.full_name is distinct from old.full_name
       or new.username is distinct from old.username
       or new.date_of_birth is distinct from old.date_of_birth
       or new.cpf is distinct from old.cpf or new.rg is distinct from old.rg
       or new.titulo_eleitor is distinct from old.titulo_eleitor
       or new.carteira_trabalho is distinct from old.carteira_trabalho
       or new.citizen_id is distinct from old.citizen_id
       or new.birth_country_code is distinct from old.birth_country_code
       or new.birth_country_name is distinct from old.birth_country_name
       or new.birth_state_code is distinct from old.birth_state_code
       or new.birth_state_name is distinct from old.birth_state_name
       or new.birth_city_code is distinct from old.birth_city_code
       or new.birth_city_name is distinct from old.birth_city_name
       or new.residence_country_code is distinct from old.residence_country_code
       or new.residence_country_name is distinct from old.residence_country_name
       or new.residence_state_code is distinct from old.residence_state_code
       or new.residence_state_name is distinct from old.residence_state_name
       or new.residence_city_code is distinct from old.residence_city_code
       or new.residence_city_name is distinct from old.residence_city_name
       or new.initial_aspiration is distinct from old.initial_aspiration
       or new.onboarding_step is distinct from old.onboarding_step
       or new.onboarding_version is distinct from old.onboarding_version
       or new.onboarding_mode is distinct from old.onboarding_mode
       or new.onboarding_completed is distinct from old.onboarding_completed
       or new.onboarding_updated_at is distinct from old.onboarding_updated_at
       or new.citizenship_created_at is distinct from old.citizenship_created_at
       or new.citizen_profile_confirmed_at is distinct from old.citizen_profile_confirmed_at
       or new.username_is_generated is distinct from old.username_is_generated
       or new.party_affiliation is distinct from old.party_affiliation
       or new.reputation_points is distinct from old.reputation_points
       or new.political_points is distinct from old.political_points
       or new.email is distinct from old.email or new.phone is distinct from old.phone then
      raise exception 'Campos oficiais do cidadão só podem ser alterados por procedimento autorizado.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_citizen_official_fields_trigger on public.profiles;
create trigger protect_citizen_official_fields_trigger
before update on public.profiles
for each row execute function public.protect_citizen_official_fields();

-- Direct client writes cannot issue documents or complete onboarding.
revoke insert, update, delete on public.documents from anon, authenticated;
revoke insert on public.profiles from anon, authenticated;
revoke execute on function public.generate_unique_document_number(text) from anon, authenticated;
revoke execute on function public.complete_residency_onboarding(text,text,text,text) from anon, authenticated;
