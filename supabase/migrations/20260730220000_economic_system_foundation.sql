begin;

create extension if not exists pgcrypto with schema extensions;

create schema if not exists economy_private;
revoke all on schema economy_private from public, anon, authenticated;
grant usage on schema economy_private to postgres, service_role;

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

revoke all on function public.economic_has_role(text[]) from public, anon;
grant execute on function public.economic_has_role(text[]) to authenticated, service_role;

create table if not exists public.economic_calibrations (
  key text primary key,
  value jsonb not null,
  unit text,
  description text not null,
  engine_version text not null default '1.0.0',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint economic_calibrations_key_format
    check (key ~ '^[a-z0-9_]+$')
);

create table if not exists public.economic_sectors (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null unique,
  description text,
  base_productivity numeric(12,4) not null default 1,
  labor_intensity numeric(8,4) not null default .5,
  interest_sensitivity numeric(8,4) not null default .5,
  consumption_sensitivity numeric(8,4) not null default .5,
  public_investment_sensitivity numeric(8,4) not null default .5,
  import_dependency numeric(8,4) not null default .2,
  base_capacity numeric(20,4) not null default 100,
  price_index_weight numeric(8,6) not null default 0,
  gdp_weight numeric(8,6) not null default 0,
  risk_score numeric(8,4) not null default .5,
  environmental_intensity numeric(8,4) not null default 0,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint economic_sectors_code_format check (code ~ '^[a-z0-9_]+$'),
  constraint economic_sectors_rates check (
    base_productivity > 0
    and labor_intensity between 0 and 1
    and interest_sensitivity between 0 and 1
    and consumption_sensitivity between 0 and 1
    and public_investment_sensitivity between 0 and 1
    and import_dependency between 0 and 1
    and price_index_weight between 0 and 1
    and gdp_weight between 0 and 1
    and risk_score between 0 and 1
    and environmental_intensity between 0 and 1
  )
);

create table if not exists public.economic_periods (
  id uuid primary key default gen_random_uuid(),
  period_type text not null,
  rp_year integer not null,
  rp_quarter integer,
  rp_month integer,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  starts_at_rp timestamptz not null,
  ends_at_rp timestamptz not null,
  status text not null default 'open',
  closed_at timestamptz,
  engine_version text not null default '1.0.0',
  close_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint economic_periods_type check (period_type in ('month', 'quarter', 'year')),
  constraint economic_periods_status check (status in ('scheduled', 'open', 'closing', 'closed', 'reopened', 'failed')),
  constraint economic_periods_quarter check (rp_quarter is null or rp_quarter between 1 and 4),
  constraint economic_periods_month check (rp_month is null or rp_month between 1 and 12),
  constraint economic_periods_dates check (starts_at < ends_at and starts_at_rp < ends_at_rp),
  unique (period_type, rp_year, rp_quarter, rp_month)
);

create unique index if not exists economic_periods_natural_key
  on public.economic_periods (period_type, rp_year, rp_quarter, rp_month)
  nulls not distinct;

create table if not exists public.economic_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  economic_classification text not null,
  source_table text not null,
  source_id text not null,
  economic_group_key text,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  business_id uuid references public.businesses(id) on delete set null,
  government_entity_id uuid references public.state_enterprises(id) on delete set null,
  sector_id uuid references public.economic_sectors(id) on delete set null,
  nominal_amount numeric(24,4) not null default 0,
  economic_amount numeric(24,4) not null default 0,
  real_amount numeric(24,4) not null default 0,
  quantity numeric(20,4),
  unit_price numeric(20,4),
  tax_amount numeric(20,4) not null default 0,
  subsidy_amount numeric(20,4) not null default 0,
  occurred_at_real timestamptz not null default now(),
  occurred_at_rp timestamptz not null,
  economic_period_id uuid references public.economic_periods(id) on delete restrict,
  reverses_event_id uuid references public.economic_events(id) on delete restrict,
  is_simulated boolean not null default false,
  is_suspicious boolean not null default false,
  macro_weight numeric(8,4) not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  engine_version text not null default '1.0.0',
  created_at timestamptz not null default now(),
  constraint economic_events_classification check (
    economic_classification in (
      'gross_output',
      'household_consumption',
      'productive_investment',
      'government_spending',
      'export',
      'import',
      'intermediate_consumption',
      'compensation',
      'product_tax',
      'income_tax',
      'subsidy',
      'social_transfer',
      'financial_operation',
      'capital_transfer',
      'not_in_gdp'
    )
  ),
  constraint economic_events_finite_values check (
    nominal_amount not in ('Infinity'::numeric, '-Infinity'::numeric)
    and economic_amount not in ('Infinity'::numeric, '-Infinity'::numeric)
    and real_amount not in ('Infinity'::numeric, '-Infinity'::numeric)
    and tax_amount >= 0
    and subsidy_amount >= 0
    and macro_weight between 0 and 1
  ),
  constraint economic_events_quantity check (quantity is null or quantity >= 0),
  constraint economic_events_unit_price check (unit_price is null or unit_price >= 0),
  constraint economic_events_reversal check (reverses_event_id is null or reverses_event_id <> id),
  unique (source_table, source_id, event_type)
);

create unique index if not exists economic_events_group_event_unique
  on public.economic_events (economic_group_key, event_type)
  where economic_group_key is not null;
create index if not exists economic_events_period_classification_idx
  on public.economic_events (economic_period_id, economic_classification);
create index if not exists economic_events_occurred_rp_idx
  on public.economic_events (occurred_at_rp);
create index if not exists economic_events_sector_period_idx
  on public.economic_events (sector_id, economic_period_id);
create index if not exists economic_events_actor_idx
  on public.economic_events (actor_profile_id, occurred_at_real desc);
create index if not exists economic_events_business_idx
  on public.economic_events (business_id, occurred_at_real desc);
create index if not exists economic_events_source_idx
  on public.economic_events (source_table, source_id);

create table if not exists public.economic_indicators (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.economic_periods(id) on delete restrict,
  indicator_code text not null,
  nominal_value numeric(24,6),
  real_value numeric(24,6),
  variation numeric(14,6),
  unit text not null default 'number',
  status text not null default 'official',
  metadata jsonb not null default '{}'::jsonb,
  engine_version text not null default '1.0.0',
  created_at timestamptz not null default now(),
  constraint economic_indicators_code check (indicator_code ~ '^[a-z0-9_]+$'),
  constraint economic_indicators_status check (status in ('preliminary', 'official', 'revised')),
  unique (period_id, indicator_code)
);

create index if not exists economic_indicators_code_period_idx
  on public.economic_indicators (indicator_code, period_id);

create table if not exists public.economic_sector_snapshots (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.economic_periods(id) on delete restrict,
  sector_id uuid not null references public.economic_sectors(id) on delete restrict,
  gross_output numeric(24,4) not null default 0,
  intermediate_consumption numeric(24,4) not null default 0,
  value_added numeric(24,4) not null default 0,
  real_value_added numeric(24,4) not null default 0,
  employment numeric(20,4) not null default 0,
  average_wage numeric(20,4) not null default 0,
  wage_mass numeric(24,4) not null default 0,
  investment numeric(24,4) not null default 0,
  price_index numeric(14,6) not null default 100,
  capacity_utilization numeric(8,4) not null default 60,
  productivity_index numeric(14,6) not null default 100,
  confidence_index numeric(8,4) not null default 50,
  growth_rate numeric(12,6),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint economic_sector_snapshots_ranges check (
    capacity_utilization between 0 and 120
    and confidence_index between 0 and 100
    and price_index >= 0
    and productivity_index >= 0
  ),
  unique (period_id, sector_id)
);

create table if not exists public.price_basket_items (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  category text not null,
  weight numeric(10,8) not null,
  base_price numeric(20,4) not null,
  current_price numeric(20,4) not null,
  base_index numeric(14,6) not null default 100,
  sector_id uuid references public.economic_sectors(id) on delete set null,
  source_type text not null default 'hybrid',
  is_essential boolean not null default false,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint price_basket_items_weight check (weight > 0 and weight <= 1),
  constraint price_basket_items_prices check (base_price > 0 and current_price >= 0),
  constraint price_basket_items_source check (source_type in ('observed', 'simulated', 'hybrid'))
);

create table if not exists public.price_observations (
  id uuid primary key default gen_random_uuid(),
  basket_item_id uuid not null references public.price_basket_items(id) on delete restrict,
  product_id uuid references public.products(id) on delete set null,
  sector_id uuid references public.economic_sectors(id) on delete set null,
  source_table text not null,
  source_id text not null,
  price numeric(20,4) not null,
  quantity_weight numeric(16,6) not null default 1,
  is_simulated boolean not null default false,
  observed_at_real timestamptz not null default now(),
  observed_at_rp timestamptz not null,
  period_id uuid references public.economic_periods(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  constraint price_observations_price check (price >= 0),
  constraint price_observations_weight check (quantity_weight > 0),
  unique (source_table, source_id, observed_at_rp)
);

create index if not exists price_observations_item_period_idx
  on public.price_observations (basket_item_id, period_id);

create table if not exists public.citizen_economic_statuses (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  labor_status text not null default 'outside_labor_force',
  actively_seeking boolean not null default false,
  available_for_work boolean not null default true,
  last_economic_activity_at timestamptz,
  activity_score numeric(10,4) not null default 0,
  macro_weight numeric(8,4) not null default 1,
  fraud_review_status text not null default 'clear',
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint citizen_economic_statuses_labor check (
    labor_status in (
      'private_employee',
      'public_employee',
      'entrepreneur',
      'self_employed',
      'unemployed',
      'outside_labor_force',
      'retired',
      'imprisoned',
      'temporarily_unable'
    )
  ),
  constraint citizen_economic_statuses_weight check (macro_weight between 0 and 1),
  constraint citizen_economic_statuses_fraud check (
    fraud_review_status in ('clear', 'under_review', 'restricted', 'blocked')
  )
);

create table if not exists public.labor_market_snapshots (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.economic_periods(id) on delete restrict,
  working_age_population numeric(20,4) not null default 0,
  labor_force numeric(20,4) not null default 0,
  employed numeric(20,4) not null default 0,
  unemployed numeric(20,4) not null default 0,
  outside_labor_force numeric(20,4) not null default 0,
  private_employment numeric(20,4) not null default 0,
  public_employment numeric(20,4) not null default 0,
  open_vacancies numeric(20,4) not null default 0,
  hires numeric(20,4) not null default 0,
  dismissals numeric(20,4) not null default 0,
  participation_rate numeric(12,6) not null default 0,
  unemployment_rate numeric(12,6) not null default 0,
  average_wage numeric(20,4) not null default 0,
  real_average_wage numeric(20,4) not null default 0,
  wage_mass numeric(24,4) not null default 0,
  productivity_per_worker numeric(20,4) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint labor_market_snapshots_rates check (
    participation_rate between 0 and 100
    and unemployment_rate between 0 and 100
  ),
  unique (period_id)
);

create table if not exists public.fiscal_periods (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null unique references public.economic_periods(id) on delete restrict,
  tax_revenue numeric(24,4) not null default 0,
  state_enterprise_revenue numeric(24,4) not null default 0,
  other_revenue numeric(24,4) not null default 0,
  current_expenditure numeric(24,4) not null default 0,
  public_investment numeric(24,4) not null default 0,
  social_transfers numeric(24,4) not null default 0,
  subsidies numeric(24,4) not null default 0,
  debt_interest numeric(24,4) not null default 0,
  primary_result numeric(24,4) not null default 0,
  nominal_result numeric(24,4) not null default 0,
  gross_debt numeric(24,4) not null default 0,
  net_debt numeric(24,4) not null default 0,
  debt_to_gdp numeric(12,6) not null default 0,
  average_interest_rate numeric(12,6) not null default 0,
  average_maturity_rp_months numeric(12,4) not null default 0,
  debt_service numeric(24,4) not null default 0,
  treasury_reserves numeric(24,4) not null default 0,
  fiscal_confidence numeric(8,4) not null default 50,
  fiscal_risk text not null default 'low',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint fiscal_periods_confidence check (fiscal_confidence between 0 and 100),
  constraint fiscal_periods_risk check (fiscal_risk in ('low', 'moderate', 'high', 'critical'))
);

create table if not exists public.government_revenues (
  id uuid primary key default gen_random_uuid(),
  period_id uuid references public.economic_periods(id) on delete restrict,
  revenue_type text not null,
  source_table text not null,
  source_id text not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  business_id uuid references public.businesses(id) on delete set null,
  amount numeric(24,4) not null,
  occurred_at_real timestamptz not null default now(),
  occurred_at_rp timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint government_revenues_amount check (amount > 0),
  constraint government_revenues_type check (
    revenue_type in (
      'income_tax', 'corporate_tax', 'consumption_tax', 'payroll_tax',
      'property_tax', 'tariff', 'fine', 'fee', 'state_dividend',
      'privatization', 'financial', 'other'
    )
  ),
  unique (source_table, source_id, revenue_type)
);

create table if not exists public.government_expenditures (
  id uuid primary key default gen_random_uuid(),
  period_id uuid references public.economic_periods(id) on delete restrict,
  expenditure_type text not null,
  ministry text,
  project_id uuid,
  source_table text not null,
  source_id text not null,
  beneficiary_profile_id uuid references public.profiles(id) on delete set null,
  business_id uuid references public.businesses(id) on delete set null,
  sector_id uuid references public.economic_sectors(id) on delete set null,
  amount numeric(24,4) not null,
  productive_share numeric(8,4) not null default 0,
  occurred_at_real timestamptz not null default now(),
  occurred_at_rp timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint government_expenditures_amount check (amount > 0),
  constraint government_expenditures_share check (productive_share between 0 and 1),
  constraint government_expenditures_type check (
    expenditure_type in (
      'public_salary', 'health', 'education', 'security', 'defense',
      'infrastructure', 'social_assistance', 'subsidy', 'debt_interest',
      'state_enterprise_capital', 'government_project', 'technology',
      'administration', 'other'
    )
  ),
  unique (source_table, source_id, expenditure_type)
);

create table if not exists public.government_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null,
  ministry text not null,
  sector_id uuid references public.economic_sectors(id) on delete set null,
  project_type text not null,
  approved_budget numeric(24,4) not null,
  reserved_amount numeric(24,4) not null default 0,
  spent_amount numeric(24,4) not null default 0,
  progress numeric(8,4) not null default 0,
  started_at timestamptz,
  expected_completion_at timestamptz,
  completed_at timestamptz,
  status text not null default 'proposed',
  productivity_impact numeric(12,6) not null default 0,
  employment_impact numeric(12,6) not null default 0,
  inflation_impact numeric(12,6) not null default 0,
  immediate_multiplier numeric(10,6) not null default 1,
  future_multiplier numeric(10,6) not null default 1,
  quality_score numeric(8,4) not null default 75,
  created_by uuid not null references public.profiles(id) on delete restrict,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  audit_status text not null default 'not_started',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint government_projects_budget check (
    approved_budget > 0
    and reserved_amount >= 0
    and spent_amount >= 0
    and spent_amount <= approved_budget * 2
  ),
  constraint government_projects_progress check (progress between 0 and 100),
  constraint government_projects_quality check (quality_score between 0 and 100),
  constraint government_projects_status check (
    status in (
      'proposed', 'pending_parliament', 'approved', 'funded', 'in_progress',
      'paused', 'delayed', 'completed', 'cancelled', 'under_investigation'
    )
  ),
  constraint government_projects_audit check (
    audit_status in ('not_started', 'pending', 'approved', 'qualified', 'rejected')
  )
);

alter table public.government_expenditures
  drop constraint if exists government_expenditures_project_id_fkey;
alter table public.government_expenditures
  add constraint government_expenditures_project_id_fkey
  foreign key (project_id) references public.government_projects(id) on delete set null;

create table if not exists public.economic_policy_decisions (
  id uuid primary key default gen_random_uuid(),
  policy_type text not null,
  authority text not null,
  authority_profile_id uuid not null references public.profiles(id) on delete restrict,
  previous_value numeric(20,6),
  new_value numeric(20,6),
  value_unit text,
  justification text not null,
  announced_at_real timestamptz not null default now(),
  announced_at_rp timestamptz not null,
  effective_at_real timestamptz not null,
  effective_at_rp timestamptz not null,
  expires_at_real timestamptz,
  expires_at_rp timestamptz,
  status text not null default 'announced',
  expected_impacts jsonb not null default '{}'::jsonb,
  actual_impacts jsonb not null default '{}'::jsonb,
  market_expectation numeric(20,6),
  surprise_index numeric(12,6) not null default 0,
  engine_version text not null default '1.0.0',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint economic_policy_decisions_type check (
    policy_type in (
      'selic', 'inflation_target', 'consumption_tax', 'corporate_tax',
      'income_tax', 'payroll_tax', 'minimum_wage', 'public_spending',
      'subsidy', 'reserve_requirement', 'exchange_intervention',
      'debt_limit', 'emergency_rule'
    )
  ),
  constraint economic_policy_decisions_status check (
    status in ('draft', 'announced', 'effective', 'expired', 'cancelled', 'superseded')
  )
);

create table if not exists public.economic_policy_effects (
  id uuid primary key default gen_random_uuid(),
  policy_decision_id uuid not null references public.economic_policy_decisions(id) on delete cascade,
  effect_code text not null,
  total_impact numeric(20,8) not null,
  starts_at_rp timestamptz not null,
  peaks_at_rp timestamptz not null,
  ends_at_rp timestamptz not null,
  applied_impact numeric(20,8) not null default 0,
  last_applied_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint economic_policy_effects_dates check (
    starts_at_rp <= peaks_at_rp and peaks_at_rp <= ends_at_rp
  ),
  unique (policy_decision_id, effect_code)
);

create table if not exists public.economic_shocks (
  id uuid primary key default gen_random_uuid(),
  shock_type text not null,
  title text not null,
  description text not null,
  origin text not null,
  intensity numeric(8,4) not null,
  starts_at_real timestamptz not null,
  starts_at_rp timestamptz not null,
  ends_at_real timestamptz,
  ends_at_rp timestamptz,
  affected_sector_ids uuid[] not null default array[]::uuid[],
  impacts jsonb not null default '{}'::jsonb,
  expected_consequences text[] not null default array[]::text[],
  status text not null default 'scheduled',
  created_by uuid not null references public.profiles(id) on delete restrict,
  justification text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint economic_shocks_intensity check (intensity between 0 and 1),
  constraint economic_shocks_origin check (
    origin in ('automatic', 'admin', 'player_actions', 'international', 'narrative')
  ),
  constraint economic_shocks_status check (
    status in ('scheduled', 'active', 'resolved', 'cancelled')
  )
);

create table if not exists public.economic_engine_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null,
  period_id uuid references public.economic_periods(id) on delete set null,
  engine_version text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  errors jsonb not null default '[]'::jsonb,
  results jsonb not null default '{}'::jsonb,
  input_hash text,
  output_hash text,
  initiated_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  constraint economic_engine_runs_type check (
    run_type in ('operational', 'monthly_close', 'quarterly_close', 'annual_close', 'rebuild', 'forecast')
  ),
  constraint economic_engine_runs_status check (
    status in ('running', 'completed', 'failed', 'skipped')
  )
);

create index if not exists economic_engine_runs_started_idx
  on public.economic_engine_runs (started_at desc);

create table if not exists public.economic_forecasts (
  id uuid primary key default gen_random_uuid(),
  forecast_type text not null,
  policy_type text,
  policy_payload jsonb not null default '{}'::jsonb,
  base_period_id uuid references public.economic_periods(id) on delete set null,
  optimistic_scenario jsonb not null,
  base_scenario jsonb not null,
  pessimistic_scenario jsonb not null,
  confidence_interval numeric(8,4) not null default .65,
  assumptions jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  engine_version text not null default '1.0.0',
  created_at timestamptz not null default now(),
  constraint economic_forecasts_confidence check (confidence_interval between 0 and 1)
);

create table if not exists public.economic_audit_log (
  id bigint generated always as identity primary key,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  old_data jsonb,
  new_data jsonb,
  justification text,
  request_id uuid not null default gen_random_uuid(),
  engine_version text not null default '1.0.0',
  created_at timestamptz not null default now()
);

create index if not exists economic_audit_entity_idx
  on public.economic_audit_log (entity_type, entity_id, created_at desc);

create table if not exists public.economic_state (
  id boolean primary key default true check (id),
  current_selic numeric(10,4) not null default 10,
  inflation_target numeric(10,4) not null default 3,
  exchange_rate numeric(12,6) not null default 5,
  cpi_index numeric(14,6) not null default 100,
  gdp_deflator numeric(14,6) not null default 100,
  consumer_confidence numeric(8,4) not null default 50,
  business_confidence numeric(8,4) not null default 50,
  fiscal_confidence numeric(8,4) not null default 50,
  economic_cycle text not null default 'stable',
  public_debt numeric(24,4) not null default 0,
  anticrisis_reserve numeric(24,4) not null default 0,
  base_monthly_gdp numeric(24,4) not null default 833333333.33,
  player_activity_level text not null default 'very_low',
  simulated_share numeric(8,6) not null default .8,
  player_share numeric(8,6) not null default .2,
  last_operational_run_at timestamptz,
  last_monthly_close_at timestamptz,
  last_quarterly_close_at timestamptz,
  last_annual_close_at timestamptz,
  engine_version text not null default '1.0.0',
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint economic_state_rates check (
    current_selic between -5 and 100
    and inflation_target between 0 and 100
    and exchange_rate > 0
    and cpi_index > 0
    and gdp_deflator > 0
    and consumer_confidence between 0 and 100
    and business_confidence between 0 and 100
    and fiscal_confidence between 0 and 100
    and simulated_share between 0 and 1
    and player_share between 0 and 1
    and abs((simulated_share + player_share) - 1) < .000001
  ),
  constraint economic_state_cycle check (
    economic_cycle in (
      'stable', 'expansion', 'boom', 'overheating', 'slowdown',
      'technical_recession', 'recession', 'deep_recession',
      'stagflation', 'recovery'
    )
  ),
  constraint economic_state_activity check (
    player_activity_level in ('very_low', 'low', 'medium', 'high', 'very_high')
  )
);

create table if not exists public.citizen_economic_snapshots (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.economic_periods(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  labor_status text not null,
  nominal_income numeric(20,4) not null default 0,
  disposable_income numeric(20,4) not null default 0,
  real_income numeric(20,4) not null default 0,
  consumption numeric(20,4) not null default 0,
  savings numeric(20,4) not null default 0,
  debt numeric(20,4) not null default 0,
  debt_service numeric(20,4) not null default 0,
  basket_cost numeric(20,4) not null default 0,
  purchasing_power_index numeric(14,6) not null default 100,
  consumer_confidence numeric(8,4) not null default 50,
  poverty_status text not null default 'not_classified',
  macro_weight numeric(8,4) not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint citizen_snapshots_confidence check (consumer_confidence between 0 and 100),
  constraint citizen_snapshots_weight check (macro_weight between 0 and 1),
  constraint citizen_snapshots_poverty check (
    poverty_status in ('not_classified', 'extreme_poverty', 'poverty', 'vulnerable', 'middle_income', 'high_income')
  ),
  unique (period_id, profile_id)
);

create table if not exists public.business_economic_snapshots (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.economic_periods(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete cascade,
  sector_id uuid references public.economic_sectors(id) on delete set null,
  gross_revenue numeric(24,4) not null default 0,
  intermediate_costs numeric(24,4) not null default 0,
  wage_costs numeric(24,4) not null default 0,
  tax_costs numeric(24,4) not null default 0,
  interest_costs numeric(24,4) not null default 0,
  net_profit numeric(24,4) not null default 0,
  investment numeric(24,4) not null default 0,
  employment numeric(20,4) not null default 0,
  capacity_utilization numeric(8,4) not null default 60,
  productivity_index numeric(14,6) not null default 100,
  demand_index numeric(14,6) not null default 100,
  cost_inflation numeric(12,6) not null default 0,
  confidence_index numeric(8,4) not null default 50,
  default_risk numeric(8,4) not null default .1,
  health_status text not null default 'stable',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint business_snapshots_ranges check (
    capacity_utilization between 0 and 120
    and confidence_index between 0 and 100
    and default_risk between 0 and 1
  ),
  constraint business_snapshots_health check (
    health_status in ('strong', 'stable', 'attention', 'distressed', 'insolvent')
  ),
  unique (period_id, business_id)
);

create table if not exists public.monetary_policy_meetings (
  id uuid primary key default gen_random_uuid(),
  meeting_number integer not null,
  scheduled_at_real timestamptz not null,
  scheduled_at_rp timestamptz not null,
  opened_at timestamptz,
  closed_at timestamptz,
  inflation_target numeric(10,4) not null,
  market_expectation numeric(10,4),
  previous_selic numeric(10,4) not null,
  decided_selic numeric(10,4),
  status text not null default 'scheduled',
  minutes text,
  votes jsonb not null default '[]'::jsonb,
  decision_id uuid references public.economic_policy_decisions(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint monetary_policy_meetings_status check (
    status in ('scheduled', 'open', 'voting', 'closed', 'cancelled')
  ),
  unique (meeting_number)
);

create table if not exists public.economic_bulletins (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.economic_periods(id) on delete restrict,
  bulletin_type text not null,
  title text not null,
  summary text not null,
  content text not null,
  highlights jsonb not null default '[]'::jsonb,
  status text not null default 'published',
  published_at timestamptz not null default now(),
  generated_by_engine_run_id uuid references public.economic_engine_runs(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  constraint economic_bulletins_type check (
    bulletin_type in ('monthly', 'quarterly', 'annual', 'fiscal', 'labor', 'monetary', 'alert')
  ),
  constraint economic_bulletins_status check (status in ('draft', 'published', 'corrected')),
  unique (period_id, bulletin_type)
);

create table if not exists public.economic_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_code text not null,
  severity text not null,
  title text not null,
  message text not null,
  period_id uuid references public.economic_periods(id) on delete set null,
  entity_type text,
  entity_id text,
  status text not null default 'active',
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint economic_alerts_severity check (severity in ('info', 'warning', 'critical')),
  constraint economic_alerts_status check (status in ('active', 'acknowledged', 'resolved')),
  unique (alert_code, period_id, entity_type, entity_id)
);

alter table public.business_types
  add column if not exists economic_sector_id uuid references public.economic_sectors(id) on delete set null;
alter table public.businesses
  add column if not exists economic_sector_id uuid references public.economic_sectors(id) on delete set null,
  add column if not exists capacity_utilization numeric(8,4) not null default 60,
  add column if not exists productivity_index numeric(14,6) not null default 100,
  add column if not exists confidence_index numeric(8,4) not null default 50;
alter table public.state_enterprises
  add column if not exists economic_sector_id uuid references public.economic_sectors(id) on delete set null;
alter table public.products
  add column if not exists economic_sector_id uuid references public.economic_sectors(id) on delete set null,
  add column if not exists price_basket_item_id uuid references public.price_basket_items(id) on delete set null,
  add column if not exists unit_cost numeric(20,4),
  add column if not exists is_final_good boolean not null default true;

insert into public.economic_sectors (
  code, name, description, base_productivity, labor_intensity,
  interest_sensitivity, consumption_sensitivity, public_investment_sensitivity,
  import_dependency, base_capacity, price_index_weight, gdp_weight, risk_score
)
values
  ('agriculture', 'Agropecuária', 'Produção agropecuária, pesca e atividades primárias.', 1.08, .45, .25, .55, .30, .18, 100, .23, .07, .35),
  ('industry', 'Indústria', 'Transformação de matérias-primas e produção de bens.', 1.12, .55, .65, .60, .55, .42, 100, .10, .14, .55),
  ('construction', 'Construção', 'Construção civil, habitação e grandes obras.', 1.00, .78, .88, .30, .95, .22, 100, .08, .06, .65),
  ('commerce', 'Comércio', 'Varejo, atacado e distribuição de bens finais.', .95, .70, .55, .95, .25, .35, 100, .12, .10, .42),
  ('transport', 'Transporte e logística', 'Mobilidade, fretes, armazenagem e logística.', 1.00, .62, .60, .70, .75, .48, 100, .12, .05, .55),
  ('energy', 'Energia', 'Geração e distribuição de energia.', 1.25, .28, .72, .65, .90, .38, 100, .05, .04, .58),
  ('oil_mining', 'Petróleo e mineração', 'Extração de petróleo, minerais e recursos naturais.', 1.30, .25, .70, .25, .65, .30, 100, .03, .05, .72),
  ('telecom', 'Telecomunicações', 'Telefonia, internet e redes de comunicação.', 1.22, .32, .58, .75, .60, .32, 100, .07, .03, .42),
  ('technology', 'Tecnologia', 'Software, inovação, pesquisa e serviços digitais.', 1.35, .38, .72, .68, .70, .20, 100, .04, .05, .48),
  ('finance', 'Serviços financeiros', 'Bancos, crédito, investimentos e seguros.', 1.18, .35, .98, .62, .20, .12, 100, .02, .07, .75),
  ('health', 'Saúde', 'Serviços médicos, farmacêuticos e assistência à saúde.', 1.02, .82, .30, .82, .75, .30, 100, .08, .06, .32),
  ('education', 'Educação', 'Ensino, formação profissional e pesquisa acadêmica.', 1.05, .88, .20, .60, .88, .10, 100, .06, .05, .25),
  ('tourism', 'Turismo e lazer', 'Turismo, hotelaria, cultura, esporte e entretenimento.', .92, .82, .62, .98, .35, .25, 100, .05, .03, .62),
  ('public_admin', 'Administração pública', 'Administração e serviços públicos gerais.', .90, .76, .15, .20, .75, .08, 100, .00, .08, .20),
  ('professional', 'Serviços profissionais', 'Consultoria, advocacia, contabilidade e serviços especializados.', 1.15, .68, .52, .72, .35, .12, 100, .02, .04, .35),
  ('real_estate', 'Imobiliário', 'Locação, incorporação e serviços imobiliários.', 1.02, .30, .92, .65, .65, .10, 100, .18, .04, .58),
  ('other_services', 'Outros serviços', 'Demais serviços pessoais e empresariais.', .92, .78, .48, .85, .30, .22, 100, .05, .04, .45)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  base_productivity = excluded.base_productivity,
  labor_intensity = excluded.labor_intensity,
  interest_sensitivity = excluded.interest_sensitivity,
  consumption_sensitivity = excluded.consumption_sensitivity,
  public_investment_sensitivity = excluded.public_investment_sensitivity,
  import_dependency = excluded.import_dependency,
  price_index_weight = excluded.price_index_weight,
  gdp_weight = excluded.gdp_weight,
  risk_score = excluded.risk_score,
  updated_at = now();

insert into public.price_basket_items (
  code, name, category, weight, base_price, current_price, sector_id, source_type, is_essential
)
values
  ('food', 'Alimentação', 'Alimentação', .23, 100, 100, (select id from public.economic_sectors where code='agriculture'), 'hybrid', true),
  ('housing', 'Moradia', 'Moradia', .18, 500, 500, (select id from public.economic_sectors where code='real_estate'), 'hybrid', true),
  ('energy', 'Energia', 'Energia', .05, 120, 120, (select id from public.economic_sectors where code='energy'), 'hybrid', true),
  ('water', 'Água', 'Água', .03, 50, 50, (select id from public.economic_sectors where code='public_admin'), 'hybrid', true),
  ('gas', 'Gás', 'Gás', .03, 90, 90, (select id from public.economic_sectors where code='oil_mining'), 'hybrid', true),
  ('internet', 'Internet', 'Comunicação', .04, 100, 100, (select id from public.economic_sectors where code='telecom'), 'hybrid', true),
  ('phone', 'Telefonia', 'Comunicação', .03, 60, 60, (select id from public.economic_sectors where code='telecom'), 'hybrid', true),
  ('transport', 'Transporte', 'Transporte', .12, 150, 150, (select id from public.economic_sectors where code='transport'), 'hybrid', true),
  ('health', 'Saúde', 'Saúde', .08, 120, 120, (select id from public.economic_sectors where code='health'), 'hybrid', true),
  ('education', 'Educação', 'Educação', .06, 150, 150, (select id from public.economic_sectors where code='education'), 'hybrid', true),
  ('clothing', 'Vestuário', 'Vestuário', .05, 100, 100, (select id from public.economic_sectors where code='commerce'), 'hybrid', false),
  ('leisure', 'Lazer', 'Lazer', .05, 100, 100, (select id from public.economic_sectors where code='tourism'), 'hybrid', false),
  ('financial', 'Serviços financeiros', 'Serviços financeiros', .02, 50, 50, (select id from public.economic_sectors where code='finance'), 'hybrid', false),
  ('other', 'Outros', 'Outros', .03, 100, 100, (select id from public.economic_sectors where code='other_services'), 'hybrid', false)
on conflict (code) do update set
  name = excluded.name,
  category = excluded.category,
  weight = excluded.weight,
  sector_id = excluded.sector_id,
  source_type = excluded.source_type,
  is_essential = excluded.is_essential,
  updated_at = now();

insert into public.economic_calibrations (key, value, unit, description)
values
  ('baseline_annual_gdp', '10000000000', 'BRL', 'PIB anual de referência da economia-base.'),
  ('baseline_population', '2000000', 'people', 'População nacional fictícia usada no modelo híbrido.'),
  ('baseline_average_wage', '3000', 'BRL_month', 'Salário médio de referência da economia-base.'),
  ('baseline_unemployment_rate', '8.5', 'percent', 'Desemprego estrutural inicial da economia-base.'),
  ('baseline_cpi', '100', 'index', 'Índice-base da cesta oficial de preços.'),
  ('inflation_target', '3', 'percent_year', 'Meta anual de inflação.'),
  ('default_selic', '10', 'percent_year', 'Taxa Selic inicial.'),
  ('player_representativity_factor', '1000', 'multiplier', 'Expansão limitada das ações dos jogadores.'),
  ('max_event_share_quarter_gdp', '0.0025', 'ratio', 'Impacto máximo de um evento individual sobre o PIB trimestral-base.'),
  ('reconciliation_tolerance', '0.03', 'ratio', 'Diferença máxima entre as óticas do PIB sem alerta.'),
  ('recession_minimum_decline', '0.005', 'ratio', 'Queda acumulada mínima para recessão técnica.'),
  ('debt_limit_ratio', '0.9', 'ratio_gdp', 'Limite prudencial inicial da dívida pública.'),
  ('confidence_smoothing', '0.3', 'ratio', 'Parcela da nova informação incorporada por fechamento.'),
  ('price_adjustment_speed', '0.18', 'ratio', 'Velocidade-base de ajuste de preços.'),
  ('interest_rate_sensitivity', '0.15', 'elasticity', 'Sensibilidade macroeconômica aos juros.'),
  ('demand_elasticity', '0.6', 'elasticity', 'Elasticidade-base da demanda.'),
  ('marginal_propensity_to_consume', '0.72', 'ratio', 'Propensão marginal ao consumo.'),
  ('marginal_propensity_to_save', '0.28', 'ratio', 'Propensão marginal à poupança.'),
  ('simulated_share_levels', '{"very_low":0.80,"low":0.70,"medium":0.50,"high":0.30,"very_high":0.15}', 'json', 'Participação simulada por nível de atividade.'),
  ('activity_thresholds', '{"very_low":15,"low":40,"medium":90,"high":180}', 'score', 'Faixas do índice de atividade dos jogadores.'),
  ('fiscal_multipliers', '{"infrastructure":{"immediate":1.45,"future":1.55},"education":{"immediate":0.55,"future":1.80},"health":{"immediate":0.95,"future":1.35},"social_assistance":{"immediate":1.25,"future":0.35},"defense":{"immediate":0.85,"future":0.55},"technology":{"immediate":1.05,"future":1.85},"administration":{"immediate":0.45,"future":0.25}}', 'json', 'Multiplicadores fiscais por área.'),
  ('engine_limits', '{"max_selic_change":5,"max_tax_change":10,"max_confidence_step":8,"max_price_step":0.12,"max_debt_step_ratio":0.08}', 'json', 'Limites graduais do motor.'),
  ('engine_version', '"1.0.0"', 'semver', 'Versão ativa do motor econômico.')
on conflict (key) do nothing;

insert into public.economic_state (
  id, current_selic, inflation_target, public_debt, base_monthly_gdp,
  engine_version
)
values (
  true,
  10,
  3,
  coalesce((select loans_balance from public.government_finances where id=1), 0),
  10000000000::numeric / 12,
  '1.0.0'
)
on conflict (id) do nothing;

update public.business_types bt
set economic_sector_id = es.id
from public.economic_sectors es
where es.code = case bt.id
  when 'banco' then 'finance'
  when 'construtora' then 'construction'
  when 'fabrica' then 'industry'
  when 'loja' then 'commerce'
  when 'transportadora' then 'transport'
  when 'consultoria' then 'professional'
  when 'seguranca' then 'professional'
  when 'distribuidora' then 'commerce'
  else 'other_services'
end;

update public.businesses b
set economic_sector_id = bt.economic_sector_id
from public.business_types bt
where bt.id = b.business_type_id
  and b.economic_sector_id is distinct from bt.economic_sector_id;

update public.state_enterprises se
set economic_sector_id = es.id
from public.economic_sectors es
where es.code = case
  when lower(se.sector) like '%energ%' then 'energy'
  when lower(se.sector) like '%petr%' or lower(se.sector) like '%minera%' then 'oil_mining'
  when lower(se.sector) like '%tele%' or lower(se.sector) like '%comunica%' then 'telecom'
  when lower(se.sector) like '%banc%' or lower(se.sector) like '%finan%' then 'finance'
  when lower(se.sector) like '%transport%' or lower(se.sector) like '%log%' then 'transport'
  when lower(se.sector) like '%saúde%' or lower(se.sector) like '%saude%' then 'health'
  when lower(se.sector) like '%educ%' then 'education'
  else 'public_admin'
end;

create or replace function economy_private.prevent_economic_ledger_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'O livro-razão econômico é imutável. Registre um evento de correção inversa.'
    using errcode = '55000';
end;
$$;

drop trigger if exists economic_events_immutable on public.economic_events;
create trigger economic_events_immutable
before update or delete on public.economic_events
for each row execute function economy_private.prevent_economic_ledger_mutation();

create or replace function economy_private.prevent_closed_period_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'closed' then
    raise exception 'Períodos econômicos fechados não podem ser alterados.'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists economic_periods_closed_immutable on public.economic_periods;
create trigger economic_periods_closed_immutable
before update or delete on public.economic_periods
for each row execute function economy_private.prevent_closed_period_mutation();

alter table public.economic_calibrations enable row level security;
alter table public.economic_sectors enable row level security;
alter table public.economic_periods enable row level security;
alter table public.economic_events enable row level security;
alter table public.economic_indicators enable row level security;
alter table public.economic_sector_snapshots enable row level security;
alter table public.price_basket_items enable row level security;
alter table public.price_observations enable row level security;
alter table public.citizen_economic_statuses enable row level security;
alter table public.labor_market_snapshots enable row level security;
alter table public.fiscal_periods enable row level security;
alter table public.government_revenues enable row level security;
alter table public.government_expenditures enable row level security;
alter table public.government_projects enable row level security;
alter table public.economic_policy_decisions enable row level security;
alter table public.economic_policy_effects enable row level security;
alter table public.economic_shocks enable row level security;
alter table public.economic_engine_runs enable row level security;
alter table public.economic_forecasts enable row level security;
alter table public.economic_audit_log enable row level security;
alter table public.economic_state enable row level security;
alter table public.citizen_economic_snapshots enable row level security;
alter table public.business_economic_snapshots enable row level security;
alter table public.monetary_policy_meetings enable row level security;
alter table public.economic_bulletins enable row level security;
alter table public.economic_alerts enable row level security;

drop policy if exists economic_calibrations_read on public.economic_calibrations;
create policy economic_calibrations_read on public.economic_calibrations
  for select to authenticated using (true);

drop policy if exists economic_sectors_public_read on public.economic_sectors;
create policy economic_sectors_public_read on public.economic_sectors
  for select to anon, authenticated using (is_active);

drop policy if exists economic_periods_public_read on public.economic_periods;
create policy economic_periods_public_read on public.economic_periods
  for select to anon, authenticated using (status in ('open', 'closed'));

drop policy if exists economic_events_contextual_read on public.economic_events;
create policy economic_events_contextual_read on public.economic_events
  for select to authenticated
  using (
    actor_profile_id = (select auth.uid())
    or exists (
      select 1 from public.businesses b
      where b.id = economic_events.business_id
        and b.owner_id = (select auth.uid())
    )
    or (select public.economic_has_role(array['Admin','Presidente','Ministro da Fazenda','Presidente do Banco Central']))
  );

drop policy if exists economic_indicators_public_read on public.economic_indicators;
create policy economic_indicators_public_read on public.economic_indicators
  for select to anon, authenticated using (status in ('preliminary', 'official', 'revised'));

drop policy if exists economic_sector_snapshots_public_read on public.economic_sector_snapshots;
create policy economic_sector_snapshots_public_read on public.economic_sector_snapshots
  for select to anon, authenticated using (true);

drop policy if exists price_basket_public_read on public.price_basket_items;
create policy price_basket_public_read on public.price_basket_items
  for select to anon, authenticated using (is_active);

drop policy if exists price_observations_public_read on public.price_observations;
create policy price_observations_public_read on public.price_observations
  for select to anon, authenticated using (true);

drop policy if exists citizen_economic_status_own_read on public.citizen_economic_statuses;
create policy citizen_economic_status_own_read on public.citizen_economic_statuses
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (select public.economic_has_role(array['Admin']))
  );

drop policy if exists labor_market_public_read on public.labor_market_snapshots;
create policy labor_market_public_read on public.labor_market_snapshots
  for select to anon, authenticated using (true);

drop policy if exists fiscal_periods_public_read on public.fiscal_periods;
create policy fiscal_periods_public_read on public.fiscal_periods
  for select to anon, authenticated using (true);

drop policy if exists government_revenues_authority_read on public.government_revenues;
create policy government_revenues_authority_read on public.government_revenues
  for select to authenticated
  using (
    actor_profile_id = (select auth.uid())
    or (select public.economic_has_role(array['Admin','Presidente','Ministro da Fazenda']))
  );

drop policy if exists government_expenditures_authority_read on public.government_expenditures;
create policy government_expenditures_authority_read on public.government_expenditures
  for select to authenticated
  using (
    beneficiary_profile_id = (select auth.uid())
    or (select public.economic_has_role(array['Admin','Presidente','Ministro da Fazenda']))
  );

drop policy if exists government_projects_public_read on public.government_projects;
drop policy if exists government_projects_authority_read on public.government_projects;
create policy government_projects_public_read on public.government_projects
  for select to anon, authenticated
  using (status <> 'proposed');
create policy government_projects_authority_read on public.government_projects
  for select to authenticated
  using (
    created_by = (select auth.uid())
    or (select public.economic_has_role(array['Admin','Presidente','Ministro']))
  );

drop policy if exists economic_policy_public_read on public.economic_policy_decisions;
create policy economic_policy_public_read on public.economic_policy_decisions
  for select to anon, authenticated using (status <> 'draft');

drop policy if exists economic_policy_effects_authority_read on public.economic_policy_effects;
create policy economic_policy_effects_authority_read on public.economic_policy_effects
  for select to authenticated
  using ((select public.economic_has_role(array['Admin','Presidente','Ministro da Fazenda','Presidente do Banco Central'])));

drop policy if exists economic_shocks_public_read on public.economic_shocks;
create policy economic_shocks_public_read on public.economic_shocks
  for select to anon, authenticated using (status <> 'cancelled');

drop policy if exists economic_engine_runs_admin_read on public.economic_engine_runs;
create policy economic_engine_runs_admin_read on public.economic_engine_runs
  for select to authenticated
  using ((select public.economic_has_role(array['Admin'])));

drop policy if exists economic_forecasts_own_read on public.economic_forecasts;
create policy economic_forecasts_own_read on public.economic_forecasts
  for select to authenticated
  using (
    created_by = (select auth.uid())
    or (select public.economic_has_role(array['Admin','Presidente','Ministro da Fazenda','Presidente do Banco Central']))
  );

drop policy if exists economic_audit_admin_read on public.economic_audit_log;
create policy economic_audit_admin_read on public.economic_audit_log
  for select to authenticated
  using ((select public.economic_has_role(array['Admin'])));

drop policy if exists economic_state_public_read on public.economic_state;
create policy economic_state_public_read on public.economic_state
  for select to anon, authenticated using (true);

drop policy if exists citizen_snapshots_own_read on public.citizen_economic_snapshots;
create policy citizen_snapshots_own_read on public.citizen_economic_snapshots
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (select public.economic_has_role(array['Admin']))
  );

drop policy if exists business_snapshots_owner_read on public.business_economic_snapshots;
create policy business_snapshots_owner_read on public.business_economic_snapshots
  for select to authenticated
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_economic_snapshots.business_id
        and b.owner_id = (select auth.uid())
    )
    or (select public.economic_has_role(array['Admin','Presidente','Ministro da Fazenda']))
  );

drop policy if exists monetary_meetings_public_read on public.monetary_policy_meetings;
create policy monetary_meetings_public_read on public.monetary_policy_meetings
  for select to anon, authenticated using (status <> 'cancelled');

drop policy if exists economic_bulletins_public_read on public.economic_bulletins;
create policy economic_bulletins_public_read on public.economic_bulletins
  for select to anon, authenticated using (status in ('published', 'corrected'));

drop policy if exists economic_alerts_public_read on public.economic_alerts;
create policy economic_alerts_public_read on public.economic_alerts
  for select to anon, authenticated using (true);

revoke all on all tables in schema economy_private from public, anon, authenticated;

grant select on public.economic_sectors,
  public.economic_periods,
  public.economic_indicators,
  public.economic_sector_snapshots,
  public.price_basket_items,
  public.price_observations,
  public.labor_market_snapshots,
  public.fiscal_periods,
  public.government_projects,
  public.economic_policy_decisions,
  public.economic_shocks,
  public.economic_state,
  public.monetary_policy_meetings,
  public.economic_bulletins,
  public.economic_alerts
to anon, authenticated;

grant select on public.economic_calibrations,
  public.economic_events,
  public.citizen_economic_statuses,
  public.government_revenues,
  public.government_expenditures,
  public.economic_policy_effects,
  public.economic_engine_runs,
  public.economic_forecasts,
  public.economic_audit_log,
  public.citizen_economic_snapshots,
  public.business_economic_snapshots
to authenticated;

grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

drop policy if exists state_enterprises_insert on public.state_enterprises;
drop policy if exists state_enterprises_update on public.state_enterprises;
drop policy if exists state_enterprises_delete on public.state_enterprises;
drop policy if exists state_enterprises_select on public.state_enterprises;

create policy state_enterprises_public_read on public.state_enterprises
  for select to anon, authenticated using (true);

create policy state_enterprises_authority_insert on public.state_enterprises
  for insert to authenticated
  with check (
    (select public.economic_has_role(array['Admin','Presidente']))
    and created_by = (select auth.uid())
  );

create policy state_enterprises_authority_update on public.state_enterprises
  for update to authenticated
  using ((select public.economic_has_role(array['Admin','Presidente'])))
  with check ((select public.economic_has_role(array['Admin','Presidente'])));

create policy state_enterprises_admin_delete on public.state_enterprises
  for delete to authenticated
  using (
    (select public.economic_has_role(array['Admin']))
    and not is_system
  );

drop policy if exists "Admins can update finances" on public.government_finances;
revoke insert, update, delete on public.government_finances from anon, authenticated;

do $$
declare
  target_function regprocedure;
begin
  for target_function in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array[
        'admin_modify_balance',
        'admin_modify_currency_balance',
        'admin_modify_investments',
        'admin_modify_treasury',
        'admin_forgive_debt',
        'admin_set_gov_card_limit',
        'admin_set_gov_loan_limit',
        'approve_loan_application',
        'reject_loan_application',
        'request_government_loan',
        'pay_government_loan',
        'create_state_enterprise',
        'privatize_state_enterprise'
      ])
  loop
    execute format('revoke all on function %s from public, anon', target_function);
    execute format('grant execute on function %s to authenticated, service_role', target_function);
    execute format('alter function %s set search_path to pg_catalog, public, auth', target_function);
  end loop;
end
$$;

do $$
declare
  realtime_table text;
begin
  foreach realtime_table in array array[
    'economic_state',
    'economic_indicators',
    'economic_sector_snapshots',
    'economic_bulletins',
    'economic_alerts',
    'government_projects',
    'economic_policy_decisions',
    'economic_shocks'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = realtime_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', realtime_table);
    end if;
  end loop;
end
$$;

insert into public.economic_audit_log (
  actor_profile_id, action, entity_type, entity_id, justification, new_data
)
values (
  auth.uid(),
  'economic_system_foundation_created',
  'economic_engine',
  '1.0.0',
  'Implantação da fundação do Sistema Econômico e Macroeconômico do GOVRP.',
  jsonb_build_object(
    'engine_version', '1.0.0',
    'sectors', 17,
    'price_basket_items', 14,
    'ledger_immutable', true
  )
);

commit;
