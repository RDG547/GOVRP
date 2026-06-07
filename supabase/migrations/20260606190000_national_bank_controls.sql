create extension if not exists pgcrypto;

create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  description text,
  updated_at timestamptz not null default now()
);

-- Banco Nacional: estrutura mínima para câmbio, cartões e empréstimos.
alter table if exists public.accounts
  add column if not exists currency_balances jsonb not null default '{}'::jsonb;

create table if not exists public.credit_card_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  brand text not null default 'visa',
  requested_limit numeric not null default 0,
  approved_limit numeric,
  approved_brand text,
  status text not null default 'Pendente',
  feedback text,
  admin_feedback text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table if exists public.credit_card_applications
  add column if not exists brand text not null default 'visa',
  add column if not exists requested_limit numeric not null default 0,
  add column if not exists approved_limit numeric,
  add column if not exists approved_brand text,
  add column if not exists feedback text,
  add column if not exists admin_feedback text,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  card_number text not null,
  card_type text not null default 'credit',
  brand text not null default 'visa',
  card_limit numeric not null default 0,
  used_limit numeric not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table if exists public.cards
  add column if not exists account_id uuid references public.accounts(id) on delete set null,
  add column if not exists card_number text,
  add column if not exists card_type text not null default 'credit',
  add column if not exists brand text not null default 'visa',
  add column if not exists card_limit numeric not null default 0,
  add column if not exists used_limit numeric not null default 0,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now();

alter table if exists public.cards
  alter column card_type set default 'credit',
  alter column brand set default 'visa',
  alter column card_limit set default 0,
  alter column used_limit set default 0,
  alter column is_active set default true,
  alter column created_at set default now();

create index if not exists cards_user_brand_active_idx
  on public.cards(user_id, brand)
  where is_active is true;

create table if not exists public.loan_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric not null default 0,
  status text not null default 'Pendente',
  installments integer,
  interest_rate numeric,
  total_due numeric,
  feedback text,
  admin_feedback text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table if exists public.loan_applications
  add column if not exists amount numeric not null default 0,
  add column if not exists installments integer,
  add column if not exists interest_rate numeric,
  add column if not exists total_due numeric,
  add column if not exists feedback text,
  add column if not exists admin_feedback text,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists created_at timestamptz not null default now();

insert into public.system_settings (key, value, description)
values (
  'bank_policy',
  jsonb_build_object(
    'loan_interest_rate', 2.5,
    'credit_card_revolving_rate', 8.9,
    'government_debt_interest_rate', 1.75,
    'credit_card_default_limit', 5000,
    'credit_card_brand_limits', jsonb_build_object('visa', 5000, 'mastercard', 5000),
    'exchange_fee_free', true,
    'exchange_fee_type', 'percentage',
    'exchange_fee_rate', 0,
    'exchange_fee_fixed_amount', 0
  ),
  'Política de juros, crédito e câmbio do Banco Nacional.'
)
on conflict (key) do update
set
  value = coalesce(public.system_settings.value::jsonb, '{}'::jsonb)
    || jsonb_build_object(
      'exchange_fee_type',
      coalesce(nullif(public.system_settings.value::jsonb->>'exchange_fee_type', ''), 'percentage'),
      'exchange_fee_fixed_amount',
      case
        when coalesce(public.system_settings.value::jsonb->>'exchange_fee_fixed_amount', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
          then greatest(0, (public.system_settings.value::jsonb->>'exchange_fee_fixed_amount')::numeric)
        else 0
      end
    ),
  description = excluded.description,
  updated_at = now();

create or replace function public.is_national_bank_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.role in ('Admin', 'Presidente do Banco Nacional')
  );
$$;

create or replace function public.normalize_card_brand(p_brand text)
returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(p_brand, 'visa')) like '%master%' then 'mastercard'
    else 'visa'
  end;
$$;

create or replace function public.generate_card_number()
returns text
language plpgsql
volatile
as $$
declare
  generated_number text;
begin
  loop
    generated_number := (
      floor(random() * 9000000000000000 + 1000000000000000)::bigint
    )::text;

    exit when not exists (
      select 1 from public.cards where card_number = generated_number
    );
  end loop;

  return generated_number;
end;
$$;

drop function if exists public.set_credit_card_limit(uuid, numeric);

create function public.set_credit_card_limit(
  p_card_id uuid,
  p_card_limit numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  card_record public.cards%rowtype;
  next_limit numeric := greatest(0, coalesce(p_card_limit, 0));
begin
  if not public.is_national_bank_manager() then
    return jsonb_build_object('success', false, 'message', 'Apenas o Banco Nacional pode alterar limites.');
  end if;

  select * into card_record
  from public.cards
  where id = p_card_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'message', 'Cartão não encontrado.');
  end if;

  if next_limit < coalesce(card_record.used_limit, 0) then
    return jsonb_build_object('success', false, 'message', 'O limite não pode ser menor que o valor já utilizado.');
  end if;

  update public.cards
  set card_limit = next_limit
  where id = p_card_id;

  return jsonb_build_object('success', true, 'message', 'Limite do cartão atualizado.');
end;
$$;

drop function if exists public.approve_credit_card_application(uuid, numeric, text);

create function public.approve_credit_card_application(
  p_application_id uuid,
  p_card_limit numeric,
  p_brand text default 'visa'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  application_record public.credit_card_applications%rowtype;
  account_id_value uuid;
  approved_limit_value numeric := greatest(0, coalesce(p_card_limit, 0));
  approved_brand_value text := public.normalize_card_brand(p_brand);
  created_card_id uuid;
begin
  if not public.is_national_bank_manager() then
    return jsonb_build_object('success', false, 'message', 'Apenas o Banco Nacional pode aprovar cartões.');
  end if;

  select * into application_record
  from public.credit_card_applications
  where id = p_application_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'message', 'Solicitação de cartão não encontrada.');
  end if;

  if application_record.status not in ('Pendente', 'pending') then
    return jsonb_build_object('success', false, 'message', 'Esta solicitação já foi analisada.');
  end if;

  select id into account_id_value
  from public.accounts
  where user_id = application_record.user_id
  order by id
  limit 1;

  if account_id_value is null then
    return jsonb_build_object('success', false, 'message', 'O usuário precisa ter conta bancária para receber cartão.');
  end if;

  if approved_limit_value <= 0 then
    approved_limit_value := greatest(100, coalesce(application_record.requested_limit, 0));
  end if;

  insert into public.cards (
    user_id,
    account_id,
    card_number,
    card_type,
    brand,
    card_limit,
    used_limit,
    is_active
  )
  values (
    application_record.user_id,
    account_id_value,
    public.generate_card_number(),
    'credit',
    approved_brand_value,
    approved_limit_value,
    0,
    true
  )
  returning id into created_card_id;

  update public.credit_card_applications
  set
    status = 'Aprovado',
    approved_limit = approved_limit_value,
    approved_brand = approved_brand_value,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    admin_feedback = coalesce(admin_feedback, 'Cartão aprovado pelo Banco Nacional.')
  where id = p_application_id;

  return jsonb_build_object(
    'success', true,
    'message', 'Cartão aprovado e emitido com sucesso.',
    'card_id', created_card_id
  );
end;
$$;

drop function if exists public.reject_credit_card_application(uuid, text);

create function public.reject_credit_card_application(
  p_application_id uuid,
  p_feedback text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_national_bank_manager() then
    return jsonb_build_object('success', false, 'message', 'Apenas o Banco Nacional pode rejeitar cartões.');
  end if;

  update public.credit_card_applications
  set
    status = 'Rejeitado',
    feedback = p_feedback,
    admin_feedback = p_feedback,
    reviewed_by = auth.uid(),
    reviewed_at = now()
  where id = p_application_id
    and status in ('Pendente', 'pending');

  if not found then
    return jsonb_build_object('success', false, 'message', 'Solicitação pendente não encontrada.');
  end if;

  return jsonb_build_object('success', true, 'message', 'Solicitação de cartão rejeitada.');
end;
$$;

drop function if exists public.approve_loan_application(uuid, integer, text);

create function public.approve_loan_application(
  p_application_id uuid,
  p_installments integer default 12,
  p_feedback text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  application_record public.loan_applications%rowtype;
  account_record public.accounts%rowtype;
  bank_policy jsonb := '{}'::jsonb;
  installment_count integer := greatest(1, least(120, coalesce(p_installments, 12)));
  monthly_rate numeric := 2.5;
  total_due_value numeric;
begin
  if not public.is_national_bank_manager() then
    return jsonb_build_object('success', false, 'message', 'Apenas o Banco Nacional pode aprovar empréstimos.');
  end if;

  select * into application_record
  from public.loan_applications
  where id = p_application_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'message', 'Solicitação de empréstimo não encontrada.');
  end if;

  if application_record.status not in ('Pendente', 'pending') then
    return jsonb_build_object('success', false, 'message', 'Esta solicitação já foi analisada.');
  end if;

  select * into account_record
  from public.accounts
  where user_id = application_record.user_id
  order by id
  limit 1
  for update;

  if not found then
    return jsonb_build_object('success', false, 'message', 'O usuário precisa ter conta bancária para receber empréstimo.');
  end if;

  select coalesce(value::jsonb, '{}'::jsonb) into bank_policy
  from public.system_settings
  where key = 'bank_policy';

  if bank_policy ? 'loan_interest_rate'
     and (bank_policy->>'loan_interest_rate') ~ '^-?[0-9]+(\.[0-9]+)?$' then
    monthly_rate := greatest(0, (bank_policy->>'loan_interest_rate')::numeric);
  end if;

  total_due_value := round(
    greatest(0, coalesce(application_record.amount, 0)) * (1 + (monthly_rate / 100) * installment_count),
    2
  );

  update public.accounts
  set balance = coalesce(balance, 0) + greatest(0, coalesce(application_record.amount, 0))
  where id = account_record.id;

  update public.loan_applications
  set
    status = 'Aprovado',
    installments = installment_count,
    interest_rate = monthly_rate,
    total_due = total_due_value,
    feedback = p_feedback,
    admin_feedback = p_feedback,
    reviewed_by = auth.uid(),
    reviewed_at = now()
  where id = p_application_id;

  return jsonb_build_object('success', true, 'message', 'Empréstimo aprovado e creditado em conta.');
end;
$$;

drop function if exists public.reject_loan_application(uuid, text);

create function public.reject_loan_application(
  p_application_id uuid,
  p_feedback text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_national_bank_manager() then
    return jsonb_build_object('success', false, 'message', 'Apenas o Banco Nacional pode rejeitar empréstimos.');
  end if;

  update public.loan_applications
  set
    status = 'Rejeitado',
    feedback = p_feedback,
    admin_feedback = p_feedback,
    reviewed_by = auth.uid(),
    reviewed_at = now()
  where id = p_application_id
    and status in ('Pendente', 'pending');

  if not found then
    return jsonb_build_object('success', false, 'message', 'Solicitação pendente não encontrada.');
  end if;

  return jsonb_build_object('success', true, 'message', 'Solicitação de empréstimo rejeitada.');
end;
$$;

drop function if exists public.execute_exchange(text, text, numeric);

create function public.execute_exchange(
  p_from_currency text,
  p_to_currency text,
  p_from_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account_record public.accounts%rowtype;
  currency_balances_value jsonb := '{}'::jsonb;
  from_currency text := upper(trim(coalesce(p_from_currency, '')));
  to_currency text := upper(trim(coalesce(p_to_currency, '')));
  from_amount numeric := coalesce(p_from_amount, 0);
  rate_from numeric;
  rate_to numeric;
  from_balance numeric;
  to_balance numeric;
  bank_policy jsonb := '{}'::jsonb;
  fee_free boolean := true;
  fee_type text := 'percentage';
  fee_rate numeric := 0;
  fee_fixed_brl numeric := 0;
  fee_amount numeric := 0;
  net_amount numeric := 0;
  converted_amount numeric := 0;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'message', 'Usuário não autenticado.');
  end if;

  if from_currency = '' or to_currency = '' or from_currency = to_currency then
    return jsonb_build_object('success', false, 'message', 'Selecione moedas diferentes para realizar o câmbio.');
  end if;

  if from_amount <= 0 then
    return jsonb_build_object('success', false, 'message', 'Informe um valor positivo para converter.');
  end if;

  rate_from := case from_currency
    when 'BRL' then 1
    when 'USD' then 0.19
    when 'EUR' then 0.17
    when 'GBP' then 0.15
    when 'JPY' then 29.00
    when 'CNY' then 1.36
    else null
  end;

  rate_to := case to_currency
    when 'BRL' then 1
    when 'USD' then 0.19
    when 'EUR' then 0.17
    when 'GBP' then 0.15
    when 'JPY' then 29.00
    when 'CNY' then 1.36
    else null
  end;

  if rate_from is null or rate_to is null then
    return jsonb_build_object('success', false, 'message', 'Moeda não suportada.');
  end if;

  select * into account_record
  from public.accounts
  where user_id = auth.uid()
  order by id
  limit 1
  for update;

  if not found then
    return jsonb_build_object('success', false, 'message', 'Conta bancária não encontrada.');
  end if;

  currency_balances_value := coalesce(account_record.currency_balances, '{}'::jsonb);
  from_balance := case
    when from_currency = 'BRL' then coalesce(account_record.balance, 0)
    else coalesce(nullif(currency_balances_value->>from_currency, '')::numeric, 0)
  end;

  if from_balance < from_amount then
    return jsonb_build_object('success', false, 'message', 'Saldo insuficiente para realizar o câmbio.');
  end if;

  select coalesce(value::jsonb, '{}'::jsonb) into bank_policy
  from public.system_settings
  where key = 'bank_policy';

  fee_free := coalesce((bank_policy->>'exchange_fee_free')::boolean, true);
  fee_type := coalesce(nullif(bank_policy->>'exchange_fee_type', ''), 'percentage');

  if bank_policy ? 'exchange_fee_rate'
     and (bank_policy->>'exchange_fee_rate') ~ '^-?[0-9]+(\.[0-9]+)?$' then
    fee_rate := least(100, greatest(0, (bank_policy->>'exchange_fee_rate')::numeric));
  end if;

  if bank_policy ? 'exchange_fee_fixed_amount'
     and (bank_policy->>'exchange_fee_fixed_amount') ~ '^-?[0-9]+(\.[0-9]+)?$' then
    fee_fixed_brl := greatest(0, (bank_policy->>'exchange_fee_fixed_amount')::numeric);
  end if;

  if fee_free then
    fee_amount := 0;
  elsif fee_type = 'fixed' then
    fee_amount := case
      when from_currency = 'BRL' then fee_fixed_brl
      else fee_fixed_brl * rate_from
    end;
  else
    fee_amount := from_amount * fee_rate / 100;
  end if;

  fee_amount := least(from_amount, round(greatest(0, fee_amount), 4));
  net_amount := from_amount - fee_amount;
  converted_amount := round((net_amount / rate_from) * rate_to, 4);

  if from_currency = 'BRL' then
    account_record.balance := coalesce(account_record.balance, 0) - from_amount;
  else
    currency_balances_value := jsonb_set(
      currency_balances_value,
      array[from_currency],
      to_jsonb(round(from_balance - from_amount, 4)),
      true
    );
  end if;

  if to_currency = 'BRL' then
    account_record.balance := coalesce(account_record.balance, 0) + converted_amount;
  else
    to_balance := coalesce(nullif(currency_balances_value->>to_currency, '')::numeric, 0);
    currency_balances_value := jsonb_set(
      currency_balances_value,
      array[to_currency],
      to_jsonb(round(to_balance + converted_amount, 4)),
      true
    );
  end if;

  update public.accounts
  set
    balance = round(account_record.balance, 2),
    currency_balances = currency_balances_value
  where id = account_record.id;

  return jsonb_build_object(
    'success', true,
    'message', 'Câmbio realizado com sucesso.',
    'from_currency', from_currency,
    'to_currency', to_currency,
    'from_amount', from_amount,
    'fee_amount', fee_amount,
    'net_amount', net_amount,
    'converted_amount', converted_amount
  );
end;
$$;

-- Eleições: a candidatura antiga de eleição encerrada não deve bloquear a atual.
drop function if exists public.submit_candidacy(uuid, uuid, uuid, text, text, text, text);

create function public.submit_candidacy(
  p_election_id uuid,
  p_party_id uuid,
  p_vice_candidate_id uuid,
  p_political_name text,
  p_bio text,
  p_proposals text,
  p_campaign_photo_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  requester_id uuid := auth.uid();
  election_record record;
  requires_vice boolean := false;
  active_conflict_count integer := 0;
begin
  if requester_id is null then
    return jsonb_build_object('success', false, 'message', 'Usuário não autenticado.');
  end if;

  select
    e.id,
    e.name,
    e.status,
    e.voting_end_date,
    et.name as election_type_name,
    coalesce(et.requires_vice_candidate, false) as requires_vice_candidate
  into election_record
  from public.elections e
  left join public.election_types et on et.id = e.election_type_id
  where e.id = p_election_id;

  if election_record.id is null then
    return jsonb_build_object('success', false, 'message', 'Eleição não encontrada.');
  end if;

  if election_record.status <> 'Candidacy' then
    return jsonb_build_object('success', false, 'message', 'A janela de candidaturas desta eleição não está aberta.');
  end if;

  requires_vice :=
    election_record.requires_vice_candidate
    or lower(coalesce(election_record.election_type_name, '')) = 'presidente'
    or lower(coalesce(election_record.name, '')) like '%presidencial%';

  if requires_vice and p_vice_candidate_id is null then
    return jsonb_build_object('success', false, 'message', 'Candidaturas presidenciais exigem vice aceito.');
  end if;

  if p_vice_candidate_id = requester_id then
    return jsonb_build_object('success', false, 'message', 'O candidato não pode ser o próprio vice.');
  end if;

  select count(*) into active_conflict_count
  from public.candidates c
  join public.elections e on e.id = c.election_id
  where c.status in ('Pendente', 'Approved')
    and c.user_id = requester_id
    and (
      lower(coalesce(e.status, '')) in ('scheduled', 'candidacy', 'voting')
      or (e.voting_end_date is not null and e.voting_end_date > now())
    );

  if active_conflict_count > 0 then
    return jsonb_build_object('success', false, 'message', 'Você já possui uma candidatura ativa no momento.');
  end if;

  select count(*) into active_conflict_count
  from public.candidates c
  where c.election_id = p_election_id
    and c.status in ('Pendente', 'Approved')
    and (
      c.user_id = requester_id
      or c.vice_candidate_id = requester_id
      or (p_vice_candidate_id is not null and c.user_id = p_vice_candidate_id)
      or (p_vice_candidate_id is not null and c.vice_candidate_id = p_vice_candidate_id)
    );

  if active_conflict_count > 0 then
    return jsonb_build_object('success', false, 'message', 'Um dos participantes já está vinculado a uma candidatura nesta eleição.');
  end if;

  insert into public.candidates (
    election_id,
    user_id,
    party_id,
    vice_candidate_id,
    political_name,
    bio,
    proposals,
    campaign_photo_url,
    status
  )
  values (
    p_election_id,
    requester_id,
    p_party_id,
    p_vice_candidate_id,
    nullif(trim(coalesce(p_political_name, '')), ''),
    nullif(trim(coalesce(p_bio, '')), ''),
    nullif(trim(coalesce(p_proposals, '')), ''),
    nullif(trim(coalesce(p_campaign_photo_url, '')), ''),
    'Pendente'
  );

  return jsonb_build_object('success', true, 'message', 'Candidatura enviada para análise.');
end;
$$;

-- Executivo: se a Presidência ficar sem ocupante e existir Vice-Presidente, o vice assume.
alter table if exists public.profiles
  add column if not exists manual_role_override boolean not null default false,
  add column if not exists role_assigned_at timestamptz,
  add column if not exists role_assigned_by uuid references public.profiles(id) on delete set null;

create or replace function public.promote_vice_president_when_presidency_empty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  vice_profile_id uuid;
begin
  if tg_op <> 'UPDATE'
     or coalesce(old.role, '') <> 'Presidente'
     or coalesce(new.role, '') = 'Presidente' then
    return new;
  end if;

  if exists (
    select 1
    from public.profiles profile
    where profile.id <> old.id
      and profile.role = 'Presidente'
  ) then
    return new;
  end if;

  select profile.id into vice_profile_id
  from public.profiles profile
  where profile.role = 'Vice-Presidente'
  order by profile.role_assigned_at asc nulls last, profile.full_name asc nulls last, profile.id::text asc
  limit 1;

  if vice_profile_id is null then
    insert into public.system_settings (key, value, description)
    values (
      'executive_governance',
      jsonb_build_object(
        'officeVacancy', jsonb_build_object(
          'vacant', true,
          'since', now(),
          'reason', 'Presidente deixou o cargo sem Vice-Presidente ativo',
          'triggered_by', coalesce(auth.uid(), old.id)
        ),
        'presidentialSuccession', null
      ),
      'Governança constitucional do Poder Executivo.'
    )
    on conflict (key) do update
    set
      value = coalesce(public.system_settings.value::jsonb, '{}'::jsonb)
        || jsonb_build_object(
          'officeVacancy', jsonb_build_object(
            'vacant', true,
            'since', now(),
            'reason', 'Presidente deixou o cargo sem Vice-Presidente ativo',
            'triggered_by', coalesce(auth.uid(), old.id)
          ),
          'presidentialSuccession', null
        ),
      updated_at = now();

    return new;
  end if;

  update public.profiles
  set
    role = 'Presidente',
    manual_role_override = true,
    role_assigned_at = now(),
    role_assigned_by = coalesce(auth.uid(), old.id)
  where id = vice_profile_id;

  insert into public.system_settings (key, value, description)
  values (
    'executive_governance',
    jsonb_build_object(
      'officeVacancy', jsonb_build_object(
        'vacant', false,
        'since', null,
        'reason', '',
        'triggered_by', null
      ),
      'presidentialSuccession', jsonb_build_object(
        'promoted_president_id', vice_profile_id,
        'previous_vice_id', vice_profile_id,
        'former_president_id', old.id,
        'term_election_id', null,
        'promoted_at', now(),
        'reason', 'Vacância presidencial automática',
        'triggered_by', coalesce(auth.uid(), old.id)
      )
    ),
    'Governança constitucional do Poder Executivo.'
  )
  on conflict (key) do update
  set
    value = coalesce(public.system_settings.value::jsonb, '{}'::jsonb)
      || jsonb_build_object(
        'officeVacancy', jsonb_build_object(
          'vacant', false,
          'since', null,
          'reason', '',
          'triggered_by', null
        ),
        'presidentialSuccession', jsonb_build_object(
          'promoted_president_id', vice_profile_id,
          'previous_vice_id', vice_profile_id,
          'former_president_id', old.id,
          'term_election_id', null,
          'promoted_at', now(),
          'reason', 'Vacância presidencial automática',
          'triggered_by', coalesce(auth.uid(), old.id)
        )
      ),
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists promote_vice_president_when_presidency_empty_trigger on public.profiles;

create trigger promote_vice_president_when_presidency_empty_trigger
after update of role
on public.profiles
for each row
execute function public.promote_vice_president_when_presidency_empty();

-- Partidos: uma pessoa não pode liderar dois partidos, e partidos sem núcleo recebem liderança do membro mais antigo.
alter table if exists public.party_members
  add column if not exists joined_at timestamptz not null default now();

create or replace function public.get_oldest_party_member(
  p_party_id uuid,
  p_excluded_user_ids uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  order_expression text := 'member.id::text';
  selected_user_id uuid;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'party_members'
      and column_name = 'created_at'
  ) then
    order_expression := 'member.created_at';
  elsif exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'party_members'
      and column_name = 'joined_at'
  ) then
    order_expression := 'member.joined_at';
  end if;

  execute format(
    'select member.user_id
       from public.party_members member
      where member.party_id = $1
        and member.user_id is not null
        and not (member.user_id = any($2))
      order by %s asc nulls last, member.id::text asc
      limit 1',
    order_expression
  )
  into selected_user_id
  using p_party_id, coalesce(p_excluded_user_ids, '{}'::uuid[]);

  return selected_user_id;
end;
$$;

with ranked_members as (
  select
    id,
    row_number() over (
      partition by user_id
      order by joined_at asc nulls last, id::text asc
    ) as rn
  from public.party_members
  where user_id is not null
)
delete from public.party_members member
using ranked_members ranked
where member.id = ranked.id
  and ranked.rn > 1;

create unique index if not exists party_members_one_party_per_user_idx
  on public.party_members(user_id);

do $$
declare
  party_record record;
  occupied_leaders uuid[] := '{}'::uuid[];
  replacement_id uuid;
begin
  for party_record in
    select id, owner_id, president_id, vice_president_id, founder_id
    from public.political_parties
    order by id::text asc
  loop
    if party_record.owner_id is null and party_record.president_id is null then
      party_record.owner_id := coalesce(
        public.get_oldest_party_member(party_record.id, '{}'::uuid[]),
        party_record.founder_id
      );
      party_record.president_id := coalesce(
        public.get_oldest_party_member(party_record.id, array_remove(array[party_record.owner_id], null)),
        party_record.owner_id
      );

      update public.political_parties
      set
        owner_id = coalesce(party_record.owner_id, owner_id),
        president_id = coalesce(party_record.president_id, president_id)
      where id = party_record.id;
    end if;

    if party_record.owner_id is not null and party_record.owner_id = any(occupied_leaders) then
      replacement_id := public.get_oldest_party_member(
        party_record.id,
        array_remove(occupied_leaders || array[party_record.president_id, party_record.vice_president_id], null)
      );

      if replacement_id is not null then
        update public.political_parties set owner_id = replacement_id where id = party_record.id;
        party_record.owner_id := replacement_id;
      end if;
    end if;

    if party_record.owner_id is not null then
      occupied_leaders := array_append(occupied_leaders, party_record.owner_id);
    end if;

    if party_record.president_id is not null and party_record.president_id = any(occupied_leaders) then
      replacement_id := public.get_oldest_party_member(
        party_record.id,
        array_remove(occupied_leaders || array[party_record.owner_id, party_record.vice_president_id], null)
      );

      if replacement_id is not null then
        update public.political_parties set president_id = replacement_id where id = party_record.id;
        party_record.president_id := replacement_id;
      end if;
    end if;

    if party_record.president_id is not null then
      occupied_leaders := array_append(occupied_leaders, party_record.president_id);
    end if;

    if party_record.vice_president_id is not null and party_record.vice_president_id = any(occupied_leaders) then
      replacement_id := public.get_oldest_party_member(
        party_record.id,
        array_remove(occupied_leaders || array[party_record.owner_id, party_record.president_id], null)
      );

      if replacement_id is not null then
        update public.political_parties set vice_president_id = replacement_id where id = party_record.id;
        party_record.vice_president_id := replacement_id;
      else
        update public.political_parties set vice_president_id = null where id = party_record.id;
        party_record.vice_president_id := null;
      end if;
    end if;

    if party_record.vice_president_id is not null then
      occupied_leaders := array_append(occupied_leaders, party_record.vice_president_id);
    end if;
  end loop;
end $$;

create or replace function public.ensure_party_core_leadership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_id is null and new.president_id is null then
    new.owner_id := coalesce(public.get_oldest_party_member(new.id, '{}'::uuid[]), new.founder_id);
    new.president_id := coalesce(
      public.get_oldest_party_member(new.id, array_remove(array[new.owner_id], null)),
      new.owner_id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists ensure_party_core_leadership_trigger on public.political_parties;

create trigger ensure_party_core_leadership_trigger
before insert or update of owner_id, president_id
on public.political_parties
for each row
execute function public.ensure_party_core_leadership();

create or replace function public.prevent_duplicate_party_leadership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  leader_id uuid;
  conflict_party text;
begin
  if new.vice_president_id is not null
     and new.vice_president_id in (new.owner_id, new.president_id) then
    raise exception 'O vice-presidente deve ser diferente do dono e do presidente do partido.';
  end if;

  foreach leader_id in array array_remove(array[new.owner_id, new.president_id, new.vice_president_id], null)
  loop
    select concat(name, ' (', acronym, ')') into conflict_party
    from public.political_parties
    where id <> new.id
      and coalesce(is_active, true)
      and leader_id in (owner_id, president_id, vice_president_id)
    limit 1;

    if conflict_party is not null then
      raise exception 'Este usuário já ocupa liderança no partido %.', conflict_party;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists prevent_duplicate_party_leadership_trigger on public.political_parties;

create trigger prevent_duplicate_party_leadership_trigger
before insert or update of owner_id, president_id, vice_president_id, is_active
on public.political_parties
for each row
execute function public.prevent_duplicate_party_leadership();

grant execute on function public.is_national_bank_manager() to authenticated;
grant execute on function public.normalize_card_brand(text) to authenticated;
grant execute on function public.generate_card_number() to authenticated;
grant execute on function public.set_credit_card_limit(uuid, numeric) to authenticated;
grant execute on function public.approve_credit_card_application(uuid, numeric, text) to authenticated;
grant execute on function public.reject_credit_card_application(uuid, text) to authenticated;
grant execute on function public.approve_loan_application(uuid, integer, text) to authenticated;
grant execute on function public.reject_loan_application(uuid, text) to authenticated;
grant execute on function public.execute_exchange(text, text, numeric) to authenticated;
grant execute on function public.submit_candidacy(uuid, uuid, uuid, text, text, text, text) to authenticated;
grant execute on function public.get_oldest_party_member(uuid, uuid[]) to authenticated;
