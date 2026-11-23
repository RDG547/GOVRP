-- Schema-only tables required to exercise complete closes and dashboard queries.
ALTER TABLE public.economic_sectors ADD PRIMARY KEY(id);
CREATE TABLE public.country_rp_exchange_rates(
country_code text NOT NULL,
currency_code text NOT NULL,
brl_per_unit numeric NOT NULL,
source text DEFAULT 'country_rp_state'::text NOT NULL,
source_revision bigint DEFAULT 0 NOT NULL,
updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
rp_day date,
day_open_rate numeric
);
CREATE TABLE public.economic_alerts(
id uuid DEFAULT gen_random_uuid() NOT NULL,
alert_code text NOT NULL,
severity text NOT NULL,
title text NOT NULL,
message text NOT NULL,
period_id uuid,
entity_type text,
entity_id text,
status text DEFAULT 'active'::text NOT NULL,
detected_at timestamp with time zone DEFAULT now() NOT NULL,
resolved_at timestamp with time zone,
metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE TABLE public.economic_bulletins(
id uuid DEFAULT gen_random_uuid() NOT NULL,
period_id uuid NOT NULL,
bulletin_type text NOT NULL,
title text NOT NULL,
summary text NOT NULL,
content text NOT NULL,
highlights jsonb DEFAULT '[]'::jsonb NOT NULL,
status text DEFAULT 'published'::text NOT NULL,
published_at timestamp with time zone DEFAULT now() NOT NULL,
generated_by_engine_run_id uuid,
metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE TABLE public.economic_sector_snapshots(
id uuid DEFAULT gen_random_uuid() NOT NULL,
period_id uuid NOT NULL,
sector_id uuid NOT NULL,
gross_output numeric DEFAULT 0 NOT NULL,
intermediate_consumption numeric DEFAULT 0 NOT NULL,
value_added numeric DEFAULT 0 NOT NULL,
real_value_added numeric DEFAULT 0 NOT NULL,
employment numeric DEFAULT 0 NOT NULL,
average_wage numeric DEFAULT 0 NOT NULL,
wage_mass numeric DEFAULT 0 NOT NULL,
investment numeric DEFAULT 0 NOT NULL,
price_index numeric DEFAULT 100 NOT NULL,
capacity_utilization numeric DEFAULT 60 NOT NULL,
productivity_index numeric DEFAULT 100 NOT NULL,
confidence_index numeric DEFAULT 50 NOT NULL,
growth_rate numeric,
metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
created_at timestamp with time zone DEFAULT now() NOT NULL
);

