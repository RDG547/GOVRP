-- Additional schema-only tables from the inspected database. No live records.
CREATE TABLE public.citizen_economic_statuses(
profile_id uuid NOT NULL,
labor_status text DEFAULT 'outside_labor_force'::text NOT NULL,
actively_seeking boolean DEFAULT false NOT NULL,
available_for_work boolean DEFAULT true NOT NULL,
last_economic_activity_at timestamp with time zone,
activity_score numeric DEFAULT 0 NOT NULL,
macro_weight numeric DEFAULT 1 NOT NULL,
fraud_review_status text DEFAULT 'clear'::text NOT NULL,
metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.government_rules(
rule_key text NOT NULL,
numeric_value numeric NOT NULL,
unit text DEFAULT 'ratio'::text NOT NULL,
description text NOT NULL,
source_kind text,
source_id uuid,
version bigint DEFAULT 1 NOT NULL,
updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
rule_kind text DEFAULT 'policy'::text NOT NULL,
definition jsonb DEFAULT '{}'::jsonb NOT NULL,
is_active boolean DEFAULT true NOT NULL,
valid_from timestamp with time zone DEFAULT '-infinity'::timestamp with time zone NOT NULL,
valid_until timestamp with time zone,
active_effect_id uuid
);
CREATE TABLE public.labor_market_snapshots(
id uuid DEFAULT gen_random_uuid() NOT NULL,
period_id uuid NOT NULL,
working_age_population numeric DEFAULT 0 NOT NULL,
labor_force numeric DEFAULT 0 NOT NULL,
employed numeric DEFAULT 0 NOT NULL,
unemployed numeric DEFAULT 0 NOT NULL,
outside_labor_force numeric DEFAULT 0 NOT NULL,
private_employment numeric DEFAULT 0 NOT NULL,
public_employment numeric DEFAULT 0 NOT NULL,
open_vacancies numeric DEFAULT 0 NOT NULL,
hires numeric DEFAULT 0 NOT NULL,
dismissals numeric DEFAULT 0 NOT NULL,
participation_rate numeric DEFAULT 0 NOT NULL,
unemployment_rate numeric DEFAULT 0 NOT NULL,
average_wage numeric DEFAULT 0 NOT NULL,
real_average_wage numeric DEFAULT 0 NOT NULL,
wage_mass numeric DEFAULT 0 NOT NULL,
productivity_per_worker numeric DEFAULT 0 NOT NULL,
metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.national_market_consumption(
operation_date date NOT NULL,
resource_code text NOT NULL,
quantity numeric NOT NULL,
amount numeric NOT NULL
);
CREATE TABLE public.national_market_purchases(
id uuid DEFAULT gen_random_uuid() NOT NULL,
business_id uuid NOT NULL,
resource_code text NOT NULL,
quantity numeric NOT NULL,
unit_price numeric NOT NULL,
gross_amount numeric NOT NULL,
net_amount numeric NOT NULL,
is_service boolean NOT NULL,
service_remaining numeric DEFAULT 0 NOT NULL,
transaction_id uuid NOT NULL,
idempotency_key uuid NOT NULL,
actor_id uuid,
created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
CREATE TABLE public.national_market_stock(
resource_code text NOT NULL,
quantity numeric DEFAULT 0 NOT NULL,
unit_cost numeric DEFAULT 0 NOT NULL,
updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
CREATE TABLE public.price_basket_items(
id uuid DEFAULT gen_random_uuid() NOT NULL,
code text NOT NULL,
name text NOT NULL,
category text NOT NULL,
weight numeric NOT NULL,
base_price numeric NOT NULL,
current_price numeric NOT NULL,
base_index numeric DEFAULT 100 NOT NULL,
sector_id uuid,
source_type text DEFAULT 'hybrid'::text NOT NULL,
is_essential boolean DEFAULT false NOT NULL,
is_active boolean DEFAULT true NOT NULL,
metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
created_at timestamp with time zone DEFAULT now() NOT NULL,
updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.price_observations(
id uuid DEFAULT gen_random_uuid() NOT NULL,
basket_item_id uuid NOT NULL,
product_id uuid,
sector_id uuid,
source_table text NOT NULL,
source_id text NOT NULL,
price numeric NOT NULL,
quantity_weight numeric DEFAULT 1 NOT NULL,
is_simulated boolean DEFAULT false NOT NULL,
observed_at_real timestamp with time zone DEFAULT now() NOT NULL,
observed_at_rp timestamp with time zone NOT NULL,
period_id uuid,
metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE TABLE public.rp_time_settings(
id boolean DEFAULT true NOT NULL,
rp_year_real_seconds bigint DEFAULT 604800 NOT NULL,
rp_days_per_year integer DEFAULT 365 NOT NULL,
rp_epoch_real_at timestamp with time zone DEFAULT now() NOT NULL,
rp_epoch_game_at timestamp with time zone DEFAULT '2025-12-31 21:00:00-03'::timestamp with time zone NOT NULL,
speed_multiplier numeric DEFAULT 1 NOT NULL,
is_paused boolean DEFAULT false NOT NULL,
paused_real_at timestamp with time zone,
paused_rp_at timestamp with time zone,
penal_time_multiplier numeric DEFAULT 1 NOT NULL,
updated_by uuid,
updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.state_enterprises(
id uuid DEFAULT gen_random_uuid() NOT NULL,
name text NOT NULL,
sector text NOT NULL,
description text,
is_active boolean DEFAULT true NOT NULL,
is_privatized boolean DEFAULT false NOT NULL,
created_by uuid,
created_at timestamp with time zone DEFAULT now() NOT NULL,
updated_at timestamp with time zone DEFAULT now() NOT NULL,
privatization_status text DEFAULT 'none'::text NOT NULL,
privatization_price numeric,
privatization_buyer_id uuid,
privatized_at timestamp with time zone,
is_system boolean DEFAULT false NOT NULL,
market_value numeric DEFAULT 0 NOT NULL,
health_score integer DEFAULT 75 NOT NULL,
economic_sector_id uuid,
service_key text,
operating_business_id uuid,
manager_id uuid,
commission_type text DEFAULT 'percentage'::text NOT NULL,
commission_value numeric DEFAULT 0 NOT NULL,
publication_mode text DEFAULT 'automatic'::text NOT NULL,
fixed_sale_fee numeric DEFAULT 0 NOT NULL,
active_listing_fee_enabled boolean DEFAULT false NOT NULL,
active_listing_fee_amount numeric DEFAULT 0 NOT NULL,
active_listing_fee_period integer DEFAULT 7 NOT NULL,
seller_fees jsonb DEFAULT '{}'::jsonb NOT NULL,
last_fiscal_cycle_at timestamp with time zone DEFAULT now() NOT NULL,
management_settings jsonb DEFAULT '{}'::jsonb NOT NULL
);
ALTER TABLE public.national_market_stock ADD PRIMARY KEY(resource_code);
ALTER TABLE public.national_market_purchases ADD UNIQUE(idempotency_key);
ALTER TABLE public.national_market_consumption ADD PRIMARY KEY(operation_date,resource_code);
ALTER TABLE public.price_basket_items ADD PRIMARY KEY(id);
ALTER TABLE public.price_observations ADD UNIQUE(source_table,source_id,basket_item_id);
ALTER TABLE public.economic_indicators ADD UNIQUE(period_id,indicator_code);
ALTER TABLE public.fiscal_periods ADD UNIQUE(period_id);
ALTER TABLE public.labor_market_snapshots ADD UNIQUE(period_id);
