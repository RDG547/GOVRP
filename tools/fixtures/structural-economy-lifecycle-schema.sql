-- Schema-only lifecycle tables from the inspected database.
CREATE TABLE public.business_balance_cycles(
id uuid DEFAULT gen_random_uuid() NOT NULL,
business_id uuid,
state_enterprise_id uuid,
owner_id uuid,
account_id uuid,
cycle_start_at timestamp with time zone NOT NULL,
gross_revenue numeric DEFAULT 0 NOT NULL,
operating_cost numeric DEFAULT 0 NOT NULL,
net_result numeric DEFAULT 0 NOT NULL,
result_type text DEFAULT 'profit'::text NOT NULL,
metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
processed_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.domain_events(
id bigint NOT NULL,
event_type text NOT NULL,
source_domain text NOT NULL,
source_table text NOT NULL,
source_id uuid,
country_code text DEFAULT 'BR'::text NOT NULL,
actor_id uuid,
payload jsonb DEFAULT '{}'::jsonb NOT NULL,
idempotency_key text NOT NULL,
caused_by_event_id bigint,
status text DEFAULT 'recorded'::text NOT NULL,
created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
processed_at timestamp with time zone
);
CREATE TABLE public.investment_options(
id uuid DEFAULT gen_random_uuid() NOT NULL,
name text NOT NULL,
description text,
risk_level text NOT NULL,
annual_return_rate numeric NOT NULL,
minimum_amount numeric DEFAULT 0 NOT NULL,
is_active boolean DEFAULT true NOT NULL,
asset_symbol text,
asset_type text DEFAULT 'fixed_income'::text NOT NULL,
current_unit_price numeric DEFAULT 1 NOT NULL,
price_updated_at timestamp with time zone DEFAULT now() NOT NULL,
business_id uuid,
total_shares numeric,
floated_shares numeric,
available_shares numeric,
initial_unit_price numeric,
previous_close numeric,
listed_at timestamp with time zone,
listing_metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE TABLE public.notifications(
id uuid DEFAULT gen_random_uuid() NOT NULL,
user_id uuid NOT NULL,
content text NOT NULL,
link text,
is_read boolean DEFAULT false NOT NULL,
created_at timestamp with time zone DEFAULT now() NOT NULL,
type text DEFAULT 'general'::text NOT NULL,
sender_id uuid,
metadata jsonb,
phone_dismissed_at timestamp with time zone
);
CREATE UNIQUE INDEX business_cycles_unique ON public.business_balance_cycles(business_id,cycle_start_at) WHERE business_id IS NOT NULL;
ALTER TABLE public.domain_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;

