-- Registro auditável e idempotente das doações processadas no backend.

create sequence if not exists public.donation_number_seq;

create table if not exists public.donations (
  id uuid primary key default gen_random_uuid(),
  donation_code text not null unique default ('DOA-'||to_char(clock_timestamp(),'YYYY')||'-'||lpad(nextval('public.donation_number_seq')::text,6,'0')),
  donor_id uuid not null references public.profiles(id) on delete restrict,
  amount numeric(14,2) not null check(amount>=5),
  currency text not null default 'BRL' check(currency='BRL'),
  payment_method text not null check(payment_method in('card','pix')),
  gateway text not null check(gateway in('stripe','abacatepay')),
  status text not null default 'pending' check(status in('pending','processing','paid','failed','cancelled','expired','refunded')),
  idempotency_key uuid not null unique,
  gateway_reference text unique,
  payment_intent_id text,
  checkout_url text,
  paid_at timestamptz,
  refunded_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.donation_webhook_events (
  gateway text not null,
  event_id text not null,
  event_type text not null,
  processed_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  primary key(gateway,event_id)
);

create or replace function public.touch_donation()
returns trigger language plpgsql set search_path='' as $$ begin new.updated_at=clock_timestamp(); return new; end; $$;
drop trigger if exists donations_touch on public.donations;
create trigger donations_touch before update on public.donations for each row execute function public.touch_donation();

alter table public.donations enable row level security;
alter table public.donation_webhook_events enable row level security;
create policy donations_own_read on public.donations for select to authenticated using(donor_id=auth.uid());
revoke insert,update,delete on public.donations from anon,authenticated;
revoke all on public.donation_webhook_events from anon,authenticated;
grant select on public.donations to authenticated;
grant all on public.donations,public.donation_webhook_events to service_role;

do $$ begin alter publication supabase_realtime add table public.donations; exception when duplicate_object then null; end $$;
