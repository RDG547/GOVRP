begin;

-- Barramento transacional: todo efeito relevante nasce na mesma transação da
-- ação que o originou e recebe uma chave idempotente auditável.
create table if not exists public.domain_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  source_domain text not null,
  source_table text not null,
  source_id uuid,
  country_code text not null default 'BR',
  actor_id uuid references public.profiles(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  caused_by_event_id bigint references public.domain_events(id) on delete set null,
  status text not null default 'recorded' check (status in ('recorded','processed','failed')),
  created_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz
);

create index if not exists domain_events_recent_idx
  on public.domain_events(created_at desc, id desc);
create index if not exists domain_events_source_idx
  on public.domain_events(source_table, source_id, created_at desc);

alter table public.domain_events enable row level security;
drop policy if exists domain_events_public_read on public.domain_events;
create policy domain_events_public_read on public.domain_events
  for select to anon, authenticated using (true);

create table if not exists public.government_rules (
  rule_key text primary key,
  numeric_value numeric(20,6) not null,
  unit text not null default 'ratio',
  description text not null,
  source_kind text,
  source_id uuid,
  version bigint not null default 1,
  updated_at timestamptz not null default clock_timestamp(),
  constraint government_rules_source_kind_check
    check (source_kind is null or source_kind in ('bill','decree','system'))
);

insert into public.government_rules(rule_key,numeric_value,unit,description,source_kind)
values
  ('corporate_tax_rate',0.10,'ratio','Alíquota sobre receitas empresariais','system'),
  ('consumption_tax_rate',0.03,'ratio','Alíquota incidente sobre compras de produtos','system'),
  ('business_license_fee',250,'BRL','Taxa para abertura de empresa','system'),
  ('public_safety_policy_index',50,'index','Intensidade da política nacional de segurança','system'),
  ('social_welfare_policy_index',50,'index','Intensidade da política nacional de bem-estar','system')
on conflict(rule_key) do nothing;

create table if not exists public.law_effects (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('bill','decree')),
  source_id uuid not null,
  effect_key text not null references public.government_rules(rule_key),
  operation text not null default 'set' check (operation in ('set','add','multiply')),
  effect_value numeric(20,6) not null,
  explanation text not null,
  status text not null default 'draft' check (status in ('draft','active','revoked')),
  configured_by uuid not null references public.profiles(id) on delete restrict,
  activated_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(source_kind, source_id, effect_key)
);

create index if not exists law_effects_source_idx
  on public.law_effects(source_kind, source_id, status);

alter table public.government_rules enable row level security;
alter table public.law_effects enable row level security;
drop policy if exists government_rules_public_read on public.government_rules;
create policy government_rules_public_read on public.government_rules
  for select to anon, authenticated using(true);
drop policy if exists law_effects_public_read on public.law_effects;
create policy law_effects_public_read on public.law_effects
  for select to anon, authenticated using(true);

create or replace function public.protect_immutable_domain_event()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'DOMAIN_EVENT_IS_IMMUTABLE';
end;
$$;
drop trigger if exists domain_events_immutable on public.domain_events;
create trigger domain_events_immutable before update or delete on public.domain_events
for each row execute function public.protect_immutable_domain_event();

create or replace function public.configure_law_effect(
  p_source_kind text,
  p_source_id uuid,
  p_effect_key text,
  p_operation text,
  p_effect_value numeric,
  p_explanation text
)
returns public.law_effects
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=auth.uid();
  v_effect public.law_effects%rowtype;
  v_role text;
  v_author uuid;
  v_locked boolean:=false;
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if p_source_kind not in ('bill','decree') then raise exception 'INVALID_LEGAL_SOURCE'; end if;
  if p_operation not in ('set','add','multiply') then raise exception 'INVALID_EFFECT_OPERATION'; end if;
  if length(btrim(coalesce(p_explanation,'')))<20 then raise exception 'EFFECT_EXPLANATION_TOO_SHORT'; end if;
  if not exists(select 1 from public.government_rules where rule_key=p_effect_key) then raise exception 'UNKNOWN_GOVERNMENT_RULE'; end if;
  select role into v_role from public.profiles where id=v_actor;

  if p_source_kind='bill' then
    select author_id, lower(status) in ('sancionado','promulgado')
      into v_author,v_locked from public.bills where id=p_source_id;
  else
    select author_id,is_published into v_author,v_locked from public.decrees where id=p_source_id;
  end if;
  if v_author is null then raise exception 'LEGAL_SOURCE_NOT_FOUND'; end if;
  if v_locked then raise exception 'LEGAL_SOURCE_ALREADY_IN_FORCE'; end if;
  if v_author is distinct from v_actor and lower(coalesce(v_role,'')) not in ('admin','presidente','president') then
    raise exception 'LEGAL_EFFECT_CONFIGURATION_DENIED';
  end if;

  insert into public.law_effects(
    source_kind,source_id,effect_key,operation,effect_value,explanation,configured_by
  ) values(
    p_source_kind,p_source_id,p_effect_key,p_operation,p_effect_value,btrim(p_explanation),v_actor
  )
  on conflict(source_kind,source_id,effect_key) do update
  set operation=excluded.operation,effect_value=excluded.effect_value,
      explanation=excluded.explanation,configured_by=excluded.configured_by,
      updated_at=clock_timestamp()
  where public.law_effects.status='draft'
  returning * into v_effect;
  if v_effect.id is null then raise exception 'ACTIVE_LEGAL_EFFECT_IS_IMMUTABLE'; end if;
  return v_effect;
end;
$$;

create or replace function public.activate_legal_effects(
  p_source_kind text,
  p_source_id uuid,
  p_actor_id uuid,
  p_title text
)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_effect public.law_effects%rowtype;
  v_previous numeric;
  v_next numeric;
  v_count integer:=0;
begin
  for v_effect in
    select * from public.law_effects
    where source_kind=p_source_kind and source_id=p_source_id and status='draft'
    order by created_at,id
    for update
  loop
    select numeric_value into v_previous
    from public.government_rules where rule_key=v_effect.effect_key for update;
    v_next:=case v_effect.operation
      when 'set' then v_effect.effect_value
      when 'add' then v_previous+v_effect.effect_value
      when 'multiply' then v_previous*v_effect.effect_value
    end;
    if v_effect.effect_key like '%_rate' and (v_next<0 or v_next>1) then
      raise exception 'RATE_RULE_OUT_OF_RANGE: %',v_effect.effect_key;
    end if;
    if v_effect.effect_key like '%_index' then v_next:=least(100,greatest(0,v_next)); end if;

    update public.government_rules
    set numeric_value=v_next,source_kind=p_source_kind,source_id=p_source_id,
        version=version+1,updated_at=clock_timestamp()
    where rule_key=v_effect.effect_key;
    update public.law_effects set status='active',activated_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=v_effect.id;
    insert into public.domain_events(
      event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key,status,processed_at
    ) values(
      'legal_effect_activated','government',case when p_source_kind='bill' then 'bills' else 'decrees' end,
      p_source_id,p_actor_id,
      jsonb_build_object('title',p_title,'effectId',v_effect.id,'ruleKey',v_effect.effect_key,
        'operation',v_effect.operation,'effectValue',v_effect.effect_value,'previousValue',v_previous,'newValue',v_next),
      format('legal-effect:%s:%s',p_source_kind,v_effect.id),'processed',clock_timestamp()
    ) on conflict(idempotency_key) do nothing;
    v_count:=v_count+1;
  end loop;

  insert into public.domain_events(
    event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key,status,processed_at
  ) values(
    case when p_source_kind='bill' then 'law_enacted' else 'decree_enacted' end,
    'government',case when p_source_kind='bill' then 'bills' else 'decrees' end,
    p_source_id,p_actor_id,jsonb_build_object('title',p_title,'activatedEffects',v_count),
    format('legal-source:%s:%s',p_source_kind,p_source_id),'processed',clock_timestamp()
  ) on conflict(idempotency_key) do nothing;
  return v_count;
end;
$$;

create or replace function public.propose_parliament_bill_with_effect(
  p_title text,
  p_summary text,
  p_full_text text,
  p_type text,
  p_house_id uuid,
  p_effect_key text default null,
  p_effect_operation text default 'set',
  p_effect_value numeric default null,
  p_effect_explanation text default null
)
returns public.bills
language plpgsql
security definer
set search_path=''
as $$
declare v_bill public.bills%rowtype;
begin
  v_bill:=public.propose_parliament_bill(p_title,p_summary,p_full_text,p_type,p_house_id);
  if nullif(btrim(coalesce(p_effect_key,'')),'') is not null then
    if p_effect_value is null then raise exception 'LEGAL_EFFECT_VALUE_REQUIRED'; end if;
    perform public.configure_law_effect(
      'bill',v_bill.id,p_effect_key,p_effect_operation,p_effect_value,
      coalesce(nullif(btrim(coalesce(p_effect_explanation,'')),''),p_summary)
    );
  end if;
  return v_bill;
end;
$$;

create or replace function public.activate_bill_effects_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if lower(new.status) in ('sancionado','promulgado')
     and (tg_op='INSERT' or lower(coalesce(old.status,'')) not in ('sancionado','promulgado')) then
    perform public.activate_legal_effects('bill',new.id,new.author_id,new.title);
  end if;
  return new;
end;
$$;
drop trigger if exists bills_activate_legal_effects on public.bills;
create trigger bills_activate_legal_effects
after insert or update of status on public.bills for each row
execute function public.activate_bill_effects_trigger();

create or replace function public.activate_decree_effects_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.is_published and (tg_op='INSERT' or not coalesce(old.is_published,false)) then
    perform public.activate_legal_effects('decree',new.id,new.author_id,new.title);
  end if;
  return new;
end;
$$;
drop trigger if exists decrees_activate_legal_effects on public.decrees;
create trigger decrees_activate_legal_effects
after insert or update of is_published on public.decrees for each row
execute function public.activate_decree_effects_trigger();

create or replace function public.get_government_rule(p_rule_key text)
returns numeric language sql stable security definer set search_path='' as $$
  select numeric_value from public.government_rules where rule_key=p_rule_key
$$;

revoke all on table public.domain_events,public.government_rules,public.law_effects from public,anon,authenticated;
grant select on table public.domain_events,public.government_rules,public.law_effects to anon,authenticated;
grant all on table public.domain_events,public.government_rules,public.law_effects to service_role;
grant usage,select on sequence public.domain_events_id_seq to anon,authenticated,service_role;
revoke all on function public.configure_law_effect(text,uuid,text,text,numeric,text) from public,anon;
grant execute on function public.configure_law_effect(text,uuid,text,text,numeric,text) to authenticated,service_role;
revoke all on function public.propose_parliament_bill_with_effect(text,text,text,text,uuid,text,text,numeric,text) from public,anon;
grant execute on function public.propose_parliament_bill_with_effect(text,text,text,text,uuid,text,text,numeric,text) to authenticated,service_role;
revoke all on function public.activate_legal_effects(text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.activate_legal_effects(text,uuid,uuid,text) to service_role;
grant execute on function public.get_government_rule(text) to anon,authenticated,service_role;

commit;
