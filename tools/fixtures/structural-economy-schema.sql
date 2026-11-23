-- Schema-only fixture captured from the inspected project. No player data.
-- External integrations are explicitly stubbed by the individual tests.
CREATE SCHEMA private; CREATE SCHEMA economy_private; CREATE SCHEMA auth;
DO $$BEGIN CREATE ROLE anon;EXCEPTION WHEN duplicate_object THEN NULL;END$$;
DO $$BEGIN CREATE ROLE authenticated;EXCEPTION WHEN duplicate_object THEN NULL;END$$;
DO $$BEGIN CREATE ROLE service_role;EXCEPTION WHEN duplicate_object THEN NULL;END$$;
SET check_function_bodies=off;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
CREATE FUNCTION public.rp_now() RETURNS timestamptz LANGUAGE sql AS 'SELECT now()';
CREATE FUNCTION public.rp_date_to_real_date(timestamptz) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS 'SELECT $1';
CREATE FUNCTION public.economic_has_role(text[]) RETURNS boolean LANGUAGE sql AS 'SELECT current_setting(''test.admin'',true)=''true''';
CREATE TABLE private.business_daily_effort (
business_id uuid NOT NULL,
effort_date date NOT NULL,
boost numeric DEFAULT 0 NOT NULL
);
CREATE TABLE private.population_demand_runs (
operation_date date NOT NULL,
spent numeric DEFAULT 0 NOT NULL,
created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.accounts (
id uuid DEFAULT gen_random_uuid() NOT NULL,
user_id uuid,
account_number text NOT NULL,
balance numeric(15,2) DEFAULT 1000.00 NOT NULL,
created_at timestamp with time zone DEFAULT now() NOT NULL,
updated_at timestamp with time zone DEFAULT now() NOT NULL,
agency_number text,
transfer_key text,
cpf text,
currency_balances jsonb DEFAULT '{}'::jsonb,
bank_welcome_completed boolean DEFAULT false NOT NULL,
business_id uuid,
account_kind text DEFAULT 'personal'::text NOT NULL,
investment_id uuid,
state_enterprise_id uuid
);
CREATE TABLE public.business_daily_operations (
business_id uuid NOT NULL,
operation_date date NOT NULL,
produced_quantity numeric DEFAULT 0 NOT NULL,
sold_quantity numeric DEFAULT 0 NOT NULL,
revenue numeric DEFAULT 0 NOT NULL,
payroll_accrued numeric DEFAULT 0 NOT NULL,
input_cost numeric DEFAULT 0 NOT NULL,
overhead numeric DEFAULT 0 NOT NULL,
productivity numeric DEFAULT 0 NOT NULL,
status text NOT NULL,
metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE TABLE public.business_employees (
id uuid DEFAULT gen_random_uuid() NOT NULL,
business_id uuid NOT NULL,
profile_id uuid,
name text NOT NULL,
role text DEFAULT 'Funcionário'::text NOT NULL,
salary numeric(12,2) DEFAULT 0 NOT NULL,
is_npc boolean DEFAULT true NOT NULL,
hired_at timestamp with time zone DEFAULT now() NOT NULL,
fired_at timestamp with time zone,
role_template_id text,
skill_area text DEFAULT 'management'::text NOT NULL,
experience integer DEFAULT 0 NOT NULL,
satisfaction numeric DEFAULT 70 NOT NULL,
wage_due numeric DEFAULT 0 NOT NULL,
last_accrued_on date,
last_paid_at timestamp with time zone,
qualification_level integer DEFAULT 1 NOT NULL,
role_history jsonb DEFAULT '[]'::jsonb NOT NULL
);
CREATE TABLE public.business_inventory (
business_id uuid NOT NULL,
resource_code text NOT NULL,
quantity numeric DEFAULT 0 NOT NULL,
unit_cost numeric DEFAULT 0 NOT NULL,
selling_price numeric,
available_for_sale boolean DEFAULT false NOT NULL,
updated_at timestamp with time zone DEFAULT now() NOT NULL,
price_policy text DEFAULT 'automatic'::text NOT NULL
);
CREATE TABLE public.business_recipes (
id text NOT NULL,
business_type_id text NOT NULL,
output_resource text NOT NULL,
output_quantity numeric DEFAULT 1 NOT NULL,
inputs jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE TABLE public.business_role_templates (
id text NOT NULL,
business_type_id text NOT NULL,
name text NOT NULL,
skill_area text NOT NULL,
game_family text NOT NULL,
base_weekly_salary numeric NOT NULL,
can_manage boolean DEFAULT false NOT NULL
);
CREATE TABLE public.business_supply_contracts (
id uuid DEFAULT gen_random_uuid() NOT NULL,
buyer_business_id uuid NOT NULL,
seller_business_id uuid NOT NULL,
resource_code text NOT NULL,
daily_quantity numeric NOT NULL,
max_unit_price numeric NOT NULL,
ends_at timestamp with time zone NOT NULL,
status text DEFAULT 'active'::text NOT NULL,
last_processed_on date,
created_by uuid NOT NULL,
created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.business_supply_orders (
id uuid DEFAULT gen_random_uuid() NOT NULL,
buyer_business_id uuid NOT NULL,
seller_business_id uuid NOT NULL,
resource_code text NOT NULL,
quantity numeric NOT NULL,
unit_price numeric NOT NULL,
total numeric NOT NULL,
tax_snapshot jsonb NOT NULL,
transaction_id uuid NOT NULL,
actor_id uuid,
idempotency_key uuid NOT NULL,
created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.business_transactions (
id uuid DEFAULT gen_random_uuid() NOT NULL,
business_id uuid NOT NULL,
type text NOT NULL,
amount numeric(12,2) NOT NULL,
description text DEFAULT ''::text NOT NULL,
created_at timestamp with time zone DEFAULT now() NOT NULL,
metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
operation_key text,
accounting_date date DEFAULT CURRENT_DATE NOT NULL
);
CREATE TABLE public.business_types (
id text NOT NULL,
name text NOT NULL,
category text NOT NULL,
description text DEFAULT ''::text NOT NULL,
icon text DEFAULT 'Building2'::text NOT NULL,
color text DEFAULT 'text-cyan-400'::text NOT NULL,
registration_fee numeric(12,2) DEFAULT 0 NOT NULL,
min_employees integer DEFAULT 1 NOT NULL,
profit_potential text DEFAULT 'Médio'::text NOT NULL,
risk_level text DEFAULT 'Médio'::text NOT NULL,
requirements jsonb DEFAULT '[]'::jsonb NOT NULL,
monthly_costs jsonb DEFAULT '{}'::jsonb NOT NULL,
is_active boolean DEFAULT true NOT NULL,
created_at timestamp with time zone DEFAULT now() NOT NULL,
updated_at timestamp with time zone DEFAULT now() NOT NULL,
economic_sector_id uuid,
requires_cnpj boolean DEFAULT true NOT NULL,
game_family text DEFAULT 'sales'::text NOT NULL,
base_daily_capacity numeric DEFAULT 10 NOT NULL,
daily_overhead numeric DEFAULT 10 NOT NULL
);
CREATE TABLE public.businesses (
id uuid DEFAULT gen_random_uuid() NOT NULL,
owner_id uuid,
business_type_id text NOT NULL,
name text NOT NULL,
description text DEFAULT ''::text NOT NULL,
status text DEFAULT 'pending'::text NOT NULL,
employees integer DEFAULT 0 NOT NULL,
monthly_revenue numeric(12,2) DEFAULT 0 NOT NULL,
metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
created_at timestamp with time zone DEFAULT now() NOT NULL,
updated_at timestamp with time zone DEFAULT now() NOT NULL,
is_for_sale boolean DEFAULT false NOT NULL,
sale_price numeric(14,2),
sale_listed_at timestamp with time zone,
sold_at timestamp with time zone,
previous_owner_id uuid,
economic_sector_id uuid,
capacity_utilization numeric(8,4) DEFAULT 60 NOT NULL,
productivity_index numeric(14,6) DEFAULT 100 NOT NULL,
confidence_index numeric(8,4) DEFAULT 50 NOT NULL,
bank_account_id uuid,
registration_idempotency_key uuid,
logo_url text,
font_key text DEFAULT 'default'::text NOT NULL,
brand_color text DEFAULT '#64748B'::text NOT NULL,
cnpj_document_id uuid,
region_code text,
brand_palette jsonb DEFAULT '[]'::jsonb NOT NULL,
control_kind text DEFAULT 'player'::text NOT NULL,
owner_operates boolean DEFAULT true NOT NULL,
market_value numeric DEFAULT 0 NOT NULL,
size_class text DEFAULT 'micro'::text NOT NULL,
reputation numeric DEFAULT 50 NOT NULL,
operational_status text DEFAULT 'starting'::text NOT NULL,
loss_cycles integer DEFAULT 0 NOT NULL,
price_multiplier numeric DEFAULT 1 NOT NULL,
last_simulated_on date,
last_fiscal_cycle_at timestamp with time zone DEFAULT now() NOT NULL,
national_market_auto boolean DEFAULT true NOT NULL
);
CREATE TABLE public.country_population_segments (
country_code text NOT NULL,
segment_key text NOT NULL,
name text NOT NULL,
description text NOT NULL,
population_share numeric(8,6) NOT NULL,
population_count bigint DEFAULT 0 NOT NULL,
welfare_index numeric(8,4) DEFAULT 50 NOT NULL,
political_influence numeric(8,4) DEFAULT 50 NOT NULL,
economic_participation numeric(8,4) DEFAULT 50 NOT NULL,
metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
government_approval numeric(8,4) DEFAULT 50 NOT NULL,
unemployment_pressure numeric(8,4) DEFAULT 20 NOT NULL,
purchasing_power numeric(8,4) DEFAULT 50 NOT NULL,
social_tension numeric(8,4) DEFAULT 20 NOT NULL,
revision bigint DEFAULT 0 NOT NULL,
last_change_reason text,
last_domain_event_id bigint
);
CREATE TABLE public.country_rp_states (
country_code text NOT NULL,
country_name text NOT NULL,
is_playable boolean DEFAULT false NOT NULL,
economic_baseline jsonb DEFAULT '{}'::jsonb NOT NULL,
economic_current jsonb DEFAULT '{}'::jsonb NOT NULL,
political_current jsonb DEFAULT '{}'::jsonb NOT NULL,
demographic_current jsonb DEFAULT '{}'::jsonb NOT NULL,
economy_influence numeric(6,5) DEFAULT 0 NOT NULL,
politics_influence numeric(6,5) DEFAULT 0 NOT NULL,
society_influence numeric(6,5) DEFAULT 0 NOT NULL,
revision bigint DEFAULT 0 NOT NULL,
last_event_type text,
last_event_summary text,
started_at timestamp with time zone DEFAULT now() NOT NULL,
updated_at timestamp with time zone DEFAULT now() NOT NULL,
updated_by uuid,
economic_engine_cursor jsonb DEFAULT '{}'::jsonb NOT NULL,
reference_snapshot_at timestamp with time zone,
player_share numeric(8,6) DEFAULT 0.5 NOT NULL,
simulated_share numeric(8,6) DEFAULT 0.5 NOT NULL
);
CREATE TABLE public.economic_calibrations (
key text NOT NULL,
value jsonb NOT NULL,
unit text,
description text NOT NULL,
engine_version text DEFAULT '1.0.0'::text NOT NULL,
updated_by uuid,
updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.economic_engine_runs (
id uuid DEFAULT gen_random_uuid() NOT NULL,
run_type text NOT NULL,
period_id uuid,
engine_version text NOT NULL,
started_at timestamp with time zone DEFAULT now() NOT NULL,
finished_at timestamp with time zone,
status text DEFAULT 'running'::text NOT NULL,
errors jsonb DEFAULT '[]'::jsonb NOT NULL,
results jsonb DEFAULT '{}'::jsonb NOT NULL,
input_hash text,
output_hash text,
initiated_by uuid,
metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE TABLE public.economic_events (
id uuid DEFAULT gen_random_uuid() NOT NULL,
event_type text NOT NULL,
economic_classification text NOT NULL,
source_table text NOT NULL,
source_id text NOT NULL,
economic_group_key text,
actor_profile_id uuid,
business_id uuid,
government_entity_id uuid,
sector_id uuid,
nominal_amount numeric(24,4) DEFAULT 0 NOT NULL,
economic_amount numeric(24,4) DEFAULT 0 NOT NULL,
real_amount numeric(24,4) DEFAULT 0 NOT NULL,
quantity numeric(20,4),
unit_price numeric(20,4),
tax_amount numeric(20,4) DEFAULT 0 NOT NULL,
subsidy_amount numeric(20,4) DEFAULT 0 NOT NULL,
occurred_at_real timestamp with time zone DEFAULT now() NOT NULL,
occurred_at_rp timestamp with time zone NOT NULL,
economic_period_id uuid,
reverses_event_id uuid,
is_simulated boolean DEFAULT false NOT NULL,
is_suspicious boolean DEFAULT false NOT NULL,
macro_weight numeric(8,4) DEFAULT 1 NOT NULL,
metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
engine_version text DEFAULT '1.0.0'::text NOT NULL,
created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.economic_indicators (
id uuid DEFAULT gen_random_uuid() NOT NULL,
period_id uuid NOT NULL,
indicator_code text NOT NULL,
nominal_value numeric(24,6),
real_value numeric(24,6),
variation numeric(24,6),
unit text DEFAULT 'number'::text NOT NULL,
status text DEFAULT 'official'::text NOT NULL,
metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
engine_version text DEFAULT '1.0.0'::text NOT NULL,
created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.economic_periods (
id uuid DEFAULT gen_random_uuid() NOT NULL,
period_type text NOT NULL,
rp_year integer NOT NULL,
rp_quarter integer,
rp_month integer,
starts_at timestamp with time zone NOT NULL,
ends_at timestamp with time zone NOT NULL,
starts_at_rp timestamp with time zone NOT NULL,
ends_at_rp timestamp with time zone NOT NULL,
status text DEFAULT 'open'::text NOT NULL,
closed_at timestamp with time zone,
engine_version text DEFAULT '1.0.0'::text NOT NULL,
close_hash text,
metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.economic_regions (
code text NOT NULL,
name text NOT NULL,
capital text NOT NULL,
population bigint DEFAULT 2000000 NOT NULL,
roads numeric DEFAULT 50 NOT NULL,
energy numeric DEFAULT 50 NOT NULL,
ports numeric DEFAULT 30 NOT NULL,
airports numeric DEFAULT 40 NOT NULL,
telecom numeric DEFAULT 50 NOT NULL,
coastal boolean DEFAULT false NOT NULL,
updated_at timestamp with time zone DEFAULT now() NOT NULL,
industry numeric DEFAULT 40 NOT NULL,
infrastructure_baseline jsonb,
country_code text DEFAULT 'BR'::text NOT NULL
);
CREATE TABLE public.economic_resources (
code text NOT NULL,
name text NOT NULL,
unit text NOT NULL,
base_price numeric NOT NULL,
is_service boolean DEFAULT false NOT NULL
);
CREATE TABLE public.economic_sectors (
id uuid DEFAULT gen_random_uuid() NOT NULL,
code text NOT NULL,
name text NOT NULL,
description text,
base_productivity numeric(12,4) DEFAULT 1 NOT NULL,
labor_intensity numeric(8,4) DEFAULT 0.5 NOT NULL,
interest_sensitivity numeric(8,4) DEFAULT 0.5 NOT NULL,
consumption_sensitivity numeric(8,4) DEFAULT 0.5 NOT NULL,
public_investment_sensitivity numeric(8,4) DEFAULT 0.5 NOT NULL,
import_dependency numeric(8,4) DEFAULT 0.2 NOT NULL,
base_capacity numeric(20,4) DEFAULT 100 NOT NULL,
price_index_weight numeric(8,6) DEFAULT 0 NOT NULL,
gdp_weight numeric(8,6) DEFAULT 0 NOT NULL,
risk_score numeric(8,4) DEFAULT 0.5 NOT NULL,
environmental_intensity numeric(8,4) DEFAULT 0 NOT NULL,
is_active boolean DEFAULT true NOT NULL,
metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
created_at timestamp with time zone DEFAULT now() NOT NULL,
updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.economic_state (
id boolean DEFAULT true NOT NULL,
current_selic numeric(10,4) DEFAULT 10 NOT NULL,
inflation_target numeric(10,4) DEFAULT 3 NOT NULL,
exchange_rate numeric(24,8) DEFAULT 5 NOT NULL,
cpi_index numeric(14,6) DEFAULT 100 NOT NULL,
gdp_deflator numeric(14,6) DEFAULT 100 NOT NULL,
consumer_confidence numeric(8,4) DEFAULT 50 NOT NULL,
business_confidence numeric(8,4) DEFAULT 50 NOT NULL,
fiscal_confidence numeric(8,4) DEFAULT 50 NOT NULL,
economic_cycle text DEFAULT 'stable'::text NOT NULL,
public_debt numeric(24,4) DEFAULT 0 NOT NULL,
anticrisis_reserve numeric(24,4) DEFAULT 0 NOT NULL,
base_monthly_gdp numeric(24,4) DEFAULT 833333333.33 NOT NULL,
player_activity_level text DEFAULT 'very_low'::text NOT NULL,
simulated_share numeric(8,6) DEFAULT 0.8 NOT NULL,
player_share numeric(8,6) DEFAULT 0.2 NOT NULL,
last_operational_run_at timestamp with time zone,
last_monthly_close_at timestamp with time zone,
last_quarterly_close_at timestamp with time zone,
last_annual_close_at timestamp with time zone,
engine_version text DEFAULT '1.0.0'::text NOT NULL,
metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.fiscal_periods (
id uuid DEFAULT gen_random_uuid() NOT NULL,
period_id uuid NOT NULL,
tax_revenue numeric(24,4) DEFAULT 0 NOT NULL,
state_enterprise_revenue numeric(24,4) DEFAULT 0 NOT NULL,
other_revenue numeric(24,4) DEFAULT 0 NOT NULL,
current_expenditure numeric(24,4) DEFAULT 0 NOT NULL,
public_investment numeric(24,4) DEFAULT 0 NOT NULL,
social_transfers numeric(24,4) DEFAULT 0 NOT NULL,
subsidies numeric(24,4) DEFAULT 0 NOT NULL,
debt_interest numeric(24,4) DEFAULT 0 NOT NULL,
primary_result numeric(24,4) DEFAULT 0 NOT NULL,
nominal_result numeric(24,4) DEFAULT 0 NOT NULL,
gross_debt numeric(24,4) DEFAULT 0 NOT NULL,
net_debt numeric(24,4) DEFAULT 0 NOT NULL,
debt_to_gdp numeric(12,6) DEFAULT 0 NOT NULL,
average_interest_rate numeric(12,6) DEFAULT 0 NOT NULL,
average_maturity_rp_months numeric(12,4) DEFAULT 0 NOT NULL,
debt_service numeric(24,4) DEFAULT 0 NOT NULL,
treasury_reserves numeric(24,4) DEFAULT 0 NOT NULL,
fiscal_confidence numeric(8,4) DEFAULT 50 NOT NULL,
fiscal_risk text DEFAULT 'low'::text NOT NULL,
metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.government_expenditures (
id uuid DEFAULT gen_random_uuid() NOT NULL,
period_id uuid,
expenditure_type text NOT NULL,
ministry text,
project_id uuid,
source_table text NOT NULL,
source_id text NOT NULL,
beneficiary_profile_id uuid,
business_id uuid,
sector_id uuid,
amount numeric(24,4) NOT NULL,
productive_share numeric(8,4) DEFAULT 0 NOT NULL,
occurred_at_real timestamp with time zone DEFAULT now() NOT NULL,
occurred_at_rp timestamp with time zone NOT NULL,
metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.government_finances (
id integer DEFAULT 1 NOT NULL,
treasury_balance numeric DEFAULT 1000000000.00 NOT NULL,
loans_balance numeric DEFAULT 0.00 NOT NULL,
corporate_card_limit numeric DEFAULT 50000.00 NOT NULL,
corporate_card_used numeric DEFAULT 0.00 NOT NULL,
updated_at timestamp with time zone DEFAULT now() NOT NULL,
loan_limit numeric DEFAULT 10000000.00
);
CREATE TABLE public.government_revenues (
id uuid DEFAULT gen_random_uuid() NOT NULL,
period_id uuid,
revenue_type text NOT NULL,
source_table text NOT NULL,
source_id text NOT NULL,
actor_profile_id uuid,
business_id uuid,
amount numeric(24,4) NOT NULL,
occurred_at_real timestamp with time zone DEFAULT now() NOT NULL,
occurred_at_rp timestamp with time zone NOT NULL,
metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.national_market_references (
resource_code text NOT NULL,
unit_price numeric NOT NULL,
base_price numeric NOT NULL,
per_capita_daily numeric DEFAULT 0.00001 NOT NULL,
reserve_days integer DEFAULT 7 NOT NULL,
automatic_price boolean DEFAULT false NOT NULL,
version integer DEFAULT 1 NOT NULL,
updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
CREATE TABLE public.products (
id uuid DEFAULT gen_random_uuid() NOT NULL,
seller_id uuid,
name text NOT NULL,
description text,
price numeric(10,2) NOT NULL,
image_url text,
created_at timestamp with time zone DEFAULT now() NOT NULL,
product_type text DEFAULT 'one-time'::text NOT NULL,
subscription_interval text,
subscription_price numeric,
metadata jsonb,
category text,
stock integer,
promotion_price numeric,
promotion_expires_at timestamp with time zone,
sales_count integer DEFAULT 0,
subscribers_count integer DEFAULT 0,
economic_sector_id uuid,
price_basket_item_id uuid,
unit_cost numeric(20,4),
is_final_good boolean DEFAULT true NOT NULL,
business_id uuid,
seller_type text GENERATED ALWAYS AS (CASE
    WHEN (business_id IS NULL) THEN 'citizen'::text
    ELSE 'business'::text
END) STORED,
state_enterprise_id uuid,
consumable_effects jsonb DEFAULT '{}'::jsonb NOT NULL,
residence_spec jsonb,
stock_depleted_at timestamp with time zone,
archived_at timestamp with time zone,
moderation_status text DEFAULT 'approved'::text NOT NULL,
moderation_reason text,
moderated_by uuid,
moderated_at timestamp with time zone,
listing_paid_until timestamp with time zone,
listing_status text DEFAULT 'active'::text NOT NULL,
listing_fee_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
publication_request_key uuid,
publication_request_hash text,
resource_code text
);
CREATE TABLE public.transactions (
id uuid DEFAULT gen_random_uuid() NOT NULL,
from_account_id uuid,
to_account_id uuid,
amount numeric(15,2) NOT NULL,
description text,
created_at timestamp with time zone DEFAULT now() NOT NULL,
type text,
metadata jsonb,
idempotency_key uuid,
status text DEFAULT 'completed'::text NOT NULL,
currency text DEFAULT 'BRL'::text NOT NULL
);
CREATE TABLE public.profiles(id uuid PRIMARY KEY);
CREATE FUNCTION economy_private.calibration_numeric(text,numeric) RETURNS numeric LANGUAGE sql AS 'SELECT coalesce((SELECT value::text::numeric FROM public.economic_calibrations WHERE key=$1),$2)';
ALTER TABLE public.economic_periods ADD PRIMARY KEY(id);
CREATE UNIQUE INDEX month_unique ON public.economic_periods(rp_year,rp_month) WHERE period_type='month';
CREATE UNIQUE INDEX quarter_unique ON public.economic_periods(rp_year,rp_quarter) WHERE period_type='quarter';
CREATE UNIQUE INDEX year_unique ON public.economic_periods(rp_year) WHERE period_type='year';
ALTER TABLE public.economic_events ADD PRIMARY KEY(id);
CREATE UNIQUE INDEX economic_events_group_event_unique ON public.economic_events(economic_group_key,event_type) WHERE economic_group_key IS NOT NULL;
CREATE INDEX economic_events_occurred_rp_idx ON public.economic_events(occurred_at_rp);
ALTER TABLE public.business_recipes ADD PRIMARY KEY(id);
ALTER TABLE public.economic_engine_runs ADD PRIMARY KEY(id);
ALTER TABLE public.business_inventory ADD PRIMARY KEY(business_id,resource_code);
ALTER TABLE public.business_daily_operations ADD PRIMARY KEY(business_id,operation_date);
ALTER TABLE public.businesses ADD PRIMARY KEY(id);
ALTER TABLE public.business_supply_orders ADD UNIQUE(idempotency_key);
ALTER TABLE public.transactions ADD UNIQUE(idempotency_key);
ALTER TABLE public.transactions ADD PRIMARY KEY(id);
ALTER TABLE private.population_demand_runs ADD PRIMARY KEY(operation_date);
ALTER TABLE public.economic_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.economic_engine_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_recipes ENABLE ROW LEVEL SECURITY;
CREATE PUBLICATION supabase_realtime;
