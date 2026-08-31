begin;

-- Os grupos nacionais continuam agregados, mas agora guardam as dimensões
-- necessárias para reagir de modo diferente a políticas e crises.
alter table public.country_population_segments
  add column if not exists government_approval numeric(8,4) not null default 50,
  add column if not exists unemployment_pressure numeric(8,4) not null default 20,
  add column if not exists purchasing_power numeric(8,4) not null default 50,
  add column if not exists social_tension numeric(8,4) not null default 20,
  add column if not exists revision bigint not null default 0,
  add column if not exists last_change_reason text,
  add column if not exists last_domain_event_id bigint references public.domain_events(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='country_population_segments_reaction_ranges'
      and conrelid='public.country_population_segments'::regclass
  ) then
    alter table public.country_population_segments
      add constraint country_population_segments_reaction_ranges check (
        government_approval between 0 and 100
        and unemployment_pressure between 0 and 100
        and purchasing_power between 0 and 100
        and social_tension between 0 and 100
      );
  end if;
end;
$$;

create table if not exists public.population_segment_events (
  id bigint generated always as identity primary key,
  country_code text not null,
  segment_key text not null,
  consequence_key text not null,
  reason text not null,
  welfare_delta numeric(8,4) not null default 0,
  approval_delta numeric(8,4) not null default 0,
  unemployment_delta numeric(8,4) not null default 0,
  purchasing_power_delta numeric(8,4) not null default 0,
  tension_delta numeric(8,4) not null default 0,
  before_state jsonb not null,
  after_state jsonb not null,
  domain_event_id bigint references public.domain_events(id) on delete set null,
  national_event_id uuid references public.national_game_events(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key(country_code,segment_key)
    references public.country_population_segments(country_code,segment_key) on delete restrict,
  unique(consequence_key,segment_key)
);

create index if not exists population_segment_events_recent_idx
  on public.population_segment_events(country_code,created_at desc,id desc);

create or replace function public.protect_population_segment_event()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'POPULATION_EVENT_IS_IMMUTABLE';
end;
$$;

drop trigger if exists population_segment_events_immutable on public.population_segment_events;
create trigger population_segment_events_immutable
before update or delete on public.population_segment_events
for each row execute function public.protect_population_segment_event();

create or replace function public.apply_population_consequence(
  p_country_code text,
  p_consequence_key text,
  p_reason text,
  p_effects jsonb,
  p_domain_event_id bigint default null,
  p_national_event_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_segment public.country_population_segments%rowtype;
  v_change jsonb;
  v_before jsonb;
  v_after jsonb;
  v_welfare numeric;
  v_approval numeric;
  v_unemployment numeric;
  v_power numeric;
  v_tension numeric;
  v_count integer:=0;
begin
  if nullif(btrim(coalesce(p_consequence_key,'')),'') is null then
    raise exception 'CONSEQUENCE_KEY_REQUIRED';
  end if;
  if length(btrim(coalesce(p_reason,'')))<10 then
    raise exception 'CONSEQUENCE_REASON_REQUIRED';
  end if;

  for v_segment in
    select * from public.country_population_segments
    where country_code=upper(coalesce(nullif(p_country_code,''),'BR'))
    order by segment_key for update
  loop
    v_change:=coalesce(p_effects->'segments'->'*','{}'::jsonb)
      ||coalesce(p_effects->'segments'->v_segment.segment_key,'{}'::jsonb);
    if v_change='{}'::jsonb then continue; end if;

    v_welfare:=coalesce((v_change->>'welfare')::numeric,0);
    v_approval:=coalesce((v_change->>'approval')::numeric,0);
    v_unemployment:=coalesce((v_change->>'unemploymentPressure')::numeric,0);
    v_power:=coalesce((v_change->>'purchasingPower')::numeric,0);
    v_tension:=coalesce((v_change->>'socialTension')::numeric,0);
    v_before:=jsonb_build_object(
      'welfare',v_segment.welfare_index,
      'approval',v_segment.government_approval,
      'unemploymentPressure',v_segment.unemployment_pressure,
      'purchasingPower',v_segment.purchasing_power,
      'socialTension',v_segment.social_tension
    );
    v_after:=jsonb_build_object(
      'welfare',least(100,greatest(0,v_segment.welfare_index+v_welfare)),
      'approval',least(100,greatest(0,v_segment.government_approval+v_approval)),
      'unemploymentPressure',least(100,greatest(0,v_segment.unemployment_pressure+v_unemployment)),
      'purchasingPower',least(100,greatest(0,v_segment.purchasing_power+v_power)),
      'socialTension',least(100,greatest(0,v_segment.social_tension+v_tension))
    );

    insert into public.population_segment_events(
      country_code,segment_key,consequence_key,reason,welfare_delta,approval_delta,
      unemployment_delta,purchasing_power_delta,tension_delta,before_state,after_state,
      domain_event_id,national_event_id
    ) values(
      v_segment.country_code,v_segment.segment_key,p_consequence_key,btrim(p_reason),
      (v_after->>'welfare')::numeric-v_segment.welfare_index,
      (v_after->>'approval')::numeric-v_segment.government_approval,
      (v_after->>'unemploymentPressure')::numeric-v_segment.unemployment_pressure,
      (v_after->>'purchasingPower')::numeric-v_segment.purchasing_power,
      (v_after->>'socialTension')::numeric-v_segment.social_tension,
      v_before,v_after,p_domain_event_id,p_national_event_id
    ) on conflict(consequence_key,segment_key) do nothing;
    if not found then continue; end if;

    update public.country_population_segments
    set welfare_index=(v_after->>'welfare')::numeric,
        government_approval=(v_after->>'approval')::numeric,
        unemployment_pressure=(v_after->>'unemploymentPressure')::numeric,
        purchasing_power=(v_after->>'purchasingPower')::numeric,
        social_tension=(v_after->>'socialTension')::numeric,
        revision=revision+1,last_change_reason=btrim(p_reason),
        last_domain_event_id=p_domain_event_id,updated_at=clock_timestamp()
    where country_code=v_segment.country_code and segment_key=v_segment.segment_key;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

-- Um evento nacional possui opções, prazo e exatamente uma resposta oficial.
create table if not exists public.national_event_decision_options (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.national_game_events(id) on delete cascade,
  label text not null,
  description text not null,
  treasury_cost numeric(24,2) not null default 0 check(treasury_cost>=0),
  effects jsonb not null default '{}'::jsonb,
  authorized_roles text[] not null default array['Presidente','Admin']::text[],
  is_default boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  unique(event_id,label)
);

create unique index if not exists national_event_one_default_option
  on public.national_event_decision_options(event_id) where is_default;

create table if not exists public.national_event_responses (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references public.national_game_events(id) on delete restrict,
  option_id uuid not null references public.national_event_decision_options(id) on delete restrict,
  responded_by uuid references public.profiles(id) on delete set null,
  response_reason text not null,
  was_automatic boolean not null default false,
  treasury_cost numeric(24,2) not null default 0,
  consequence_event_id bigint references public.domain_events(id) on delete set null,
  resolved_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists national_event_options_event_idx
  on public.national_event_decision_options(event_id,sort_order,id);
create index if not exists national_event_responses_recent_idx
  on public.national_event_responses(resolved_at desc,id desc);

create or replace function public.create_national_game_event(
  p_title text,
  p_description text,
  p_category text,
  p_severity text,
  p_deadline_rp_hours numeric,
  p_options jsonb,
  p_country_code text default 'BR'
)
returns public.national_game_events
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=auth.uid();
  v_role text;
  v_event public.national_game_events%rowtype;
  v_option jsonb;
  v_default_count integer:=0;
begin
  v_role:=public.get_user_role(v_actor);
  if coalesce(v_role,'') not in ('Admin','Presidente')
     and coalesce(auth.jwt()->>'role','')<>'service_role' then
    raise exception 'EVENT_MANAGEMENT_DENIED';
  end if;
  if length(btrim(coalesce(p_title,'')))<5 or length(btrim(coalesce(p_description,'')))<20 then
    raise exception 'EVENT_DETAILS_REQUIRED';
  end if;
  if p_category not in ('economy','politics','society','infrastructure','security','international') then
    raise exception 'INVALID_EVENT_CATEGORY';
  end if;
  if p_severity not in ('information','attention','important','critical') then
    raise exception 'INVALID_EVENT_SEVERITY';
  end if;
  if jsonb_typeof(p_options)<>'array' or jsonb_array_length(p_options)<2 then
    raise exception 'EVENT_REQUIRES_DECISION_OPTIONS';
  end if;
  if exists(
    select 1 from public.national_game_events
    where country_code=upper(coalesce(nullif(p_country_code,''),'BR'))
      and category=p_category and status in ('scheduled','active')
      and created_at>clock_timestamp()-interval '6 hours'
  ) then
    raise exception 'EVENT_CATEGORY_COOLDOWN';
  end if;

  insert into public.national_game_events(
    country_code,title,description,category,severity,status,effects,starts_at,ends_at,created_by
  ) values(
    upper(coalesce(nullif(p_country_code,''),'BR')),btrim(p_title),btrim(p_description),
    p_category,p_severity,'active','{}'::jsonb,clock_timestamp(),
    clock_timestamp()+make_interval(secs=>public.rp_duration_to_real_seconds(greatest(1,p_deadline_rp_hours),'hour')),
    v_actor
  ) returning * into v_event;

  for v_option in select value from jsonb_array_elements(p_options)
  loop
    if length(btrim(coalesce(v_option->>'label','')))<2
       or length(btrim(coalesce(v_option->>'description','')))<10 then
      raise exception 'INVALID_EVENT_OPTION';
    end if;
    if coalesce((v_option->>'isDefault')::boolean,false) then
      v_default_count:=v_default_count+1;
    end if;
    insert into public.national_event_decision_options(
      event_id,label,description,treasury_cost,effects,authorized_roles,is_default,sort_order
    ) values(
      v_event.id,btrim(v_option->>'label'),btrim(v_option->>'description'),
      greatest(0,coalesce((v_option->>'treasuryCost')::numeric,0)),
      coalesce(v_option->'effects','{}'::jsonb),
      coalesce(array(select jsonb_array_elements_text(v_option->'authorizedRoles')),array['Presidente','Admin']::text[]),
      coalesce((v_option->>'isDefault')::boolean,false),
      coalesce((v_option->>'sortOrder')::integer,0)
    );
  end loop;
  if v_default_count<>1 then raise exception 'EVENT_REQUIRES_ONE_DEFAULT_OPTION'; end if;

  insert into public.notifications(user_id,sender_id,type,content,link,metadata)
  select profile.id,v_actor,'national_event_decision',
    'Uma decisão nacional aguarda resposta: '||v_event.title,'/about',
    jsonb_build_object('eventId',v_event.id,'deadline',v_event.ends_at)
  from public.profiles profile
  where profile.deleted_at is null and profile.role in ('Presidente','Admin');
  return v_event;
end;
$$;

create or replace function public.settle_national_game_event(
  p_event_id uuid,
  p_option_id uuid,
  p_actor_id uuid,
  p_reason text,
  p_automatic boolean
)
returns public.national_event_responses
language plpgsql
security definer
set search_path=''
as $$
declare
  v_event public.national_game_events%rowtype;
  v_option public.national_event_decision_options%rowtype;
  v_response public.national_event_responses%rowtype;
  v_domain_event_id bigint;
  v_role text;
  v_popularity jsonb;
begin
  select * into v_event from public.national_game_events where id=p_event_id for update;
  if not found then raise exception 'NATIONAL_EVENT_NOT_FOUND'; end if;
  select * into v_response from public.national_event_responses where event_id=p_event_id;
  if found then return v_response; end if;
  if v_event.status not in ('active','scheduled') then raise exception 'NATIONAL_EVENT_NOT_ACTIVE'; end if;
  if not p_automatic and v_event.ends_at is not null and v_event.ends_at<clock_timestamp() then
    raise exception 'NATIONAL_EVENT_DEADLINE_EXPIRED';
  end if;
  select * into v_option from public.national_event_decision_options
  where id=p_option_id and event_id=p_event_id for update;
  if not found then raise exception 'EVENT_OPTION_NOT_FOUND'; end if;

  if not p_automatic then
    v_role:=public.get_user_role(p_actor_id);
    if p_actor_id is null or not(v_role=any(v_option.authorized_roles)) then
      raise exception 'EVENT_RESPONSE_DENIED';
    end if;
  elsif not v_option.is_default then
    raise exception 'AUTOMATIC_RESPONSE_MUST_USE_DEFAULT';
  end if;

  if v_option.treasury_cost>0 then
    update public.government_finances
    set treasury_balance=treasury_balance-v_option.treasury_cost,updated_at=clock_timestamp()
    where id=1 and treasury_balance>=v_option.treasury_cost;
    if not found then raise exception 'TREASURY_BALANCE_INSUFFICIENT'; end if;
    insert into public.government_expenditures(
      expenditure_type,source_table,source_id,amount,occurred_at_rp,metadata
    ) values(
      'subsidy','national_game_events',v_event.id::text,v_option.treasury_cost,public.rp_now(),
      jsonb_build_object('eventTitle',v_event.title,'option',v_option.label,'automatic',p_automatic)
    );
  end if;

  insert into public.domain_events(
    event_type,source_domain,source_table,source_id,country_code,actor_id,payload,
    idempotency_key,status,processed_at
  ) values(
    'national_crisis_resolved',v_event.category,'national_game_events',v_event.id,
    v_event.country_code,p_actor_id,
    jsonb_build_object('title',v_event.title,'facts',v_event.description,'choice',v_option.label,
      'choiceDescription',v_option.description,'reason',btrim(p_reason),
      'treasuryCost',v_option.treasury_cost,'automatic',p_automatic,'effects',v_option.effects),
    'national-event-response:'||v_event.id,'processed',clock_timestamp()
  ) returning id into v_domain_event_id;

  insert into public.national_event_responses(
    event_id,option_id,responded_by,response_reason,was_automatic,treasury_cost,consequence_event_id
  ) values(
    v_event.id,v_option.id,p_actor_id,btrim(p_reason),p_automatic,v_option.treasury_cost,v_domain_event_id
  ) returning * into v_response;

  update public.national_game_events
  set status='resolved',resolved_at=clock_timestamp(),effects=v_option.effects
  where id=v_event.id;

  perform public.apply_population_consequence(
    v_event.country_code,'national-event:'||v_event.id,btrim(p_reason),v_option.effects,
    v_domain_event_id,v_event.id
  );
  v_popularity:=coalesce(v_option.effects->'popularity','{}'::jsonb);
  if coalesce((v_popularity->>'player')::numeric,0)<>0
     or coalesce((v_popularity->>'simulation')::numeric,0)<>0 then
    perform public.apply_government_impact(
      v_event.category,'national_event_response','Resposta ao acontecimento nacional: '||v_event.title,
      coalesce((v_popularity->>'player')::numeric,0),
      coalesce((v_popularity->>'simulation')::numeric,0),
      'national_game_events',v_event.id::text,
      jsonb_build_object('option',v_option.label,'automatic',p_automatic)
    );
  end if;
  return v_response;
end;
$$;

create or replace function public.respond_national_game_event(
  p_event_id uuid,p_option_id uuid,p_reason text
)
returns public.national_event_responses
language plpgsql
security definer
set search_path=''
as $$
begin
  if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if length(btrim(coalesce(p_reason,'')))<10 then raise exception 'RESPONSE_REASON_REQUIRED'; end if;
  return public.settle_national_game_event(p_event_id,p_option_id,auth.uid(),p_reason,false);
end;
$$;

create or replace function public.resolve_expired_national_game_events()
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare v_event record;v_count integer:=0;
begin
  for v_event in
    select event.id,option.id option_id
    from public.national_game_events event
    join public.national_event_decision_options option on option.event_id=event.id and option.is_default
    where event.status in ('active','scheduled') and event.ends_at<=clock_timestamp()
    order by event.ends_at,event.id
    for update of event skip locked
  loop
    perform public.settle_national_game_event(
      v_event.id,v_event.option_id,null,'Prazo encerrado sem resposta da autoridade responsável.',true
    );
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

-- Pautas automáticas preservam fatos-base; a abordagem editorial é neutra e
-- identificada, sem fingir que uma autoridade ou jogador escreveu o texto.
create table if not exists public.national_media_briefs (
  id uuid primary key default gen_random_uuid(),
  domain_event_id bigint not null unique references public.domain_events(id) on delete restrict,
  country_code text not null default 'BR',
  category text not null,
  title text not null,
  facts text not null,
  framing text not null default 'neutro',
  source_kind text not null default 'simulated_outlet'
    check(source_kind in ('simulated_outlet','institutional')),
  status text not null default 'published' check(status in ('draft','published','archived')),
  published_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists national_media_briefs_feed_idx
  on public.national_media_briefs(status,published_at desc,id desc);

create or replace function public.publish_relevant_domain_event()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare v_title text;v_facts text;
begin
  if new.event_type not in (
    'law_enacted','decree_enacted','legal_effect_activated','business_opened',
    'national_crisis_started','national_crisis_resolved','election_settled'
  ) then return new; end if;
  v_title:=coalesce(nullif(new.payload->>'title',''),case new.event_type
    when 'law_enacted' then 'Nova lei entra em vigor'
    when 'decree_enacted' then 'Novo decreto entra em vigor'
    when 'business_opened' then 'Novo empreendimento inicia atividades'
    when 'national_crisis_resolved' then 'Governo responde a acontecimento nacional'
    when 'election_settled' then 'Resultado eleitoral é oficializado'
    else 'Mudança nacional entra em vigor' end);
  v_facts:=coalesce(nullif(new.payload->>'facts',''),nullif(new.payload->>'summary',''),
    case new.event_type
      when 'legal_effect_activated' then format('A regra %s passou do valor %s para %s.',
        coalesce(new.payload->>'ruleKey','nacional'),coalesce(new.payload->>'previousValue','anterior'),coalesce(new.payload->>'newValue','atual'))
      when 'national_crisis_resolved' then format('A resposta escolhida foi: %s. %s',
        coalesce(new.payload->>'choice','Resposta oficial'),coalesce(new.payload->>'choiceDescription',''))
      else 'O acontecimento foi registrado pelos sistemas oficiais do GOV.RP.' end);
  insert into public.national_media_briefs(domain_event_id,country_code,category,title,facts)
  values(new.id,new.country_code,new.source_domain,v_title,v_facts)
  on conflict(domain_event_id) do nothing;
  return new;
end;
$$;

drop trigger if exists domain_events_publish_national_brief on public.domain_events;
create trigger domain_events_publish_national_brief
after insert on public.domain_events for each row
execute function public.publish_relevant_domain_event();

insert into public.national_media_briefs(domain_event_id,country_code,category,title,facts,published_at)
select event.id,event.country_code,event.source_domain,
  coalesce(nullif(event.payload->>'title',''),'Acontecimento nacional'),
  coalesce(nullif(event.payload->>'facts',''),nullif(event.payload->>'summary',''),
    'O acontecimento foi registrado pelos sistemas oficiais do GOV.RP.'),event.created_at
from public.domain_events event
where event.event_type in (
  'law_enacted','decree_enacted','legal_effect_activated','business_opened',
  'national_crisis_started','national_crisis_resolved','election_settled'
)
on conflict(domain_event_id) do nothing;

create or replace function public.get_national_feed(
  p_limit integer default 12,p_offset integer default 0
)
returns table(
  id text,title text,summary text,image_url text,published_at timestamptz,
  source_type text,category text,article_id uuid,metadata jsonb,total_count bigint
)
language sql
stable
security definer
set search_path=''
as $$
  with feed as (
    select 'article:'||article.id::text id,article.title,
      left(regexp_replace(article.content,'\s+',' ','g'),360) summary,article.image_url,
      article.created_at published_at,'article'::text source_type,
      coalesce(category.name,'Notícias') category,article.id article_id,
      jsonb_build_object('outletId',article.outlet_id,'framing',article.framing) metadata
    from public.news_articles article
    left join public.news_categories category on category.id=article.category_id
    union all
    select 'gazette:'||entry.id::text,entry.title,entry.summary,null::text,entry.published_at,
      'official_gazette',coalesce(entry.type,'Diário Oficial'),null::uuid,
      jsonb_build_object('sourceId',entry.source_id)
    from public.dou_entries entry
    union all
    select 'brief:'||brief.id::text,brief.title,brief.facts,null::text,brief.published_at,
      'national_event',brief.category,null::uuid,
      jsonb_build_object('framing',brief.framing,'sourceKind',brief.source_kind,'domainEventId',brief.domain_event_id)
    from public.national_media_briefs brief where brief.status='published'
  )
  select feed.*,count(*) over() from feed
  order by feed.published_at desc,feed.id desc
  limit least(50,greatest(1,coalesce(p_limit,12)))
  offset greatest(0,coalesce(p_offset,0))
$$;

-- Cada moeda possui estado, volatilidade e choques determinísticos próprios.
create table if not exists public.currency_market_states (
  country_code text not null references public.country_rp_states(country_code) on delete cascade,
  currency_code text not null,
  base_brl_per_unit numeric(18,8) not null,
  current_strength numeric(12,8) not null default 1,
  economic_strength numeric(8,4) not null default 50,
  interest_factor numeric(8,4) not null default 50,
  inflation_factor numeric(8,4) not null default 50,
  risk_factor numeric(8,4) not null default 50,
  stability_factor numeric(8,4) not null default 50,
  trend numeric(10,8) not null default 0,
  international_demand numeric(8,4) not null default 50,
  volatility numeric(10,8) not null default .006,
  last_cycle_key text,
  updated_at timestamptz not null default clock_timestamp(),
  primary key(country_code,currency_code),
  constraint currency_market_states_currency_check check(currency_code in ('BRL','USD','EUR','GBP','JPY','CNY')),
  constraint currency_market_states_strength_check check(current_strength between .5 and 1.5),
  constraint currency_market_states_volatility_check check(volatility between 0 and .05)
);

create table if not exists public.currency_market_cycles (
  country_code text not null,
  cycle_key text not null,
  state_snapshot jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(country_code,cycle_key)
);

insert into public.currency_market_states(
  country_code,currency_code,base_brl_per_unit,economic_strength,interest_factor,
  inflation_factor,risk_factor,stability_factor,trend,international_demand,volatility
)
select state.country_code,seed.currency_code,seed.base_rate,seed.economic_strength,seed.interest_factor,
  seed.inflation_factor,seed.risk_factor,seed.stability_factor,seed.trend,seed.demand,seed.volatility
from public.country_rp_states state
cross join (values
  ('BRL',1::numeric,50::numeric,55::numeric,52::numeric,58::numeric,55::numeric,0::numeric,50::numeric,.008::numeric),
  ('USD',5.20,72,62,48,22,88,.0008,92,.0045),
  ('EUR',5.65,68,51,45,28,83,.0002,78,.0042),
  ('GBP',6.65,64,56,49,31,79,.0004,67,.0052),
  ('JPY',.034,58,18,35,25,91,-.0002,63,.0065),
  ('CNY',.72,76,47,41,38,74,.0005,85,.0035)
) as seed(currency_code,base_rate,economic_strength,interest_factor,inflation_factor,risk_factor,stability_factor,trend,demand,volatility)
where state.is_playable
on conflict(country_code,currency_code) do nothing;

create or replace function public.recalculate_currency_market(
  p_country_code text,p_cycle_key text,p_advance boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_country text:=upper(coalesce(nullif(p_country_code,''),'BR'));
  v_cycle text:=coalesce(nullif(p_cycle_key,''),to_char(clock_timestamp(),'YYYY-MM-DD-HH24'));
  v_state public.currency_market_states%rowtype;
  v_economy public.economic_state%rowtype;
  v_noise numeric;
  v_driver numeric;
  v_delta numeric;
  v_brl_strength numeric:=1;
  v_revision bigint:=0;
  v_result jsonb;
begin
  if p_advance and exists(
    select 1 from public.currency_market_cycles where country_code=v_country and cycle_key=v_cycle
  ) then
    select state_snapshot into v_result from public.currency_market_cycles
    where country_code=v_country and cycle_key=v_cycle;
    return v_result;
  end if;
  select * into v_economy from public.economic_state where id=true;
  select revision into v_revision from public.country_rp_states where country_code=v_country;

  for v_state in
    select * from public.currency_market_states where country_code=v_country
    order by currency_code for update
  loop
    v_noise:=(mod(abs(pg_catalog.hashtextextended(v_state.currency_code||':'||v_cycle,0)::numeric),2001)/1000)-1;
    if v_state.currency_code='BRL' then
      v_driver:=coalesce(v_economy.current_selic,10)*.00045
        -coalesce(v_economy.inflation_target,3)*.00065
        +(coalesce(v_economy.consumer_confidence,50)-50)*.00008
        +(coalesce(v_economy.fiscal_confidence,50)-50)*.00009
        -(v_state.risk_factor-50)*.00008;
    else
      v_driver:=(v_state.economic_strength-50)*.000025
        +(v_state.interest_factor-50)*.000018
        -(v_state.inflation_factor-50)*.00002
        -(v_state.risk_factor-50)*.000018
        +(v_state.stability_factor-50)*.000012
        +(v_state.international_demand-50)*.000015
        +v_state.trend;
    end if;
    v_delta:=greatest(-v_state.volatility,least(v_state.volatility,
      v_driver+(1-v_state.current_strength)*.025+v_noise*v_state.volatility*.35));
    if p_advance then
      update public.currency_market_states
      set current_strength=greatest(.5,least(1.5,current_strength+v_delta)),
          last_cycle_key=v_cycle,updated_at=clock_timestamp()
      where country_code=v_country and currency_code=v_state.currency_code
      returning current_strength into v_state.current_strength;
    end if;
    if v_state.currency_code='BRL' then v_brl_strength:=v_state.current_strength; end if;
  end loop;

  for v_state in
    select * from public.currency_market_states where country_code=v_country and currency_code<>'BRL'
    order by currency_code
  loop
    perform public.upsert_country_rp_exchange_rate(
      v_country,v_state.currency_code,
      greatest(.000001,v_state.base_brl_per_unit*v_state.current_strength/greatest(.5,v_brl_strength)),
      'independent_currency_market',v_revision
    );
  end loop;
  select jsonb_object_agg(rate.currency_code,jsonb_build_object(
    'brlPerUnit',rate.brl_per_unit,'strength',state.current_strength,'updatedAt',rate.updated_at
  )) into v_result
  from public.country_rp_exchange_rates rate
  join public.currency_market_states state using(country_code,currency_code)
  where rate.country_code=v_country;
  if p_advance then
    insert into public.currency_market_cycles(country_code,cycle_key,state_snapshot)
    values(v_country,v_cycle,coalesce(v_result,'{}'::jsonb))
    on conflict(country_code,cycle_key) do nothing;
  end if;
  return coalesce(v_result,'{}'::jsonb);
end;
$$;

create or replace function public.run_currency_market_cycle(p_cycle_key text default null)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role'
     and public.get_user_role(auth.uid())<>'Admin' then
    raise exception 'CURRENCY_MARKET_ADMIN_REQUIRED';
  end if;
  return public.recalculate_currency_market('BR',p_cycle_key,true);
end;
$$;

create or replace function public.sync_country_rp_exchange_rates()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  perform public.recalculate_currency_market(new.country_code,'state-revision:'||new.revision,false);
  return new;
end;
$$;

-- A influência humana cresce com atividade real e muda suavemente por ciclo.
create or replace function economy_private.update_activity_mix()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_active_players integer;
  v_transactions integer;
  v_businesses integer;
  v_participation integer;
  v_score numeric;
  v_level text;
  v_target numeric;
  v_current numeric;
  v_player numeric;
begin
  select count(distinct session.user_id)::integer into v_active_players
  from public.user_activity_sessions session
  where session.last_seen_at>=clock_timestamp()-interval '7 days';
  select count(*)::integer into v_transactions from public.transactions
  where created_at>=clock_timestamp()-interval '7 days';
  select count(*)::integer into v_businesses from public.businesses
  where status='active' and updated_at>=clock_timestamp()-interval '14 days';
  select coalesce(sum(total),0)::integer into v_participation from (
    select count(*) total from public.posts where created_at>=clock_timestamp()-interval '7 days'
    union all select count(*) from public.votes where voted_at>=clock_timestamp()-interval '7 days'
    union all select count(*) from public.bill_votes where voted_at>=clock_timestamp()-interval '7 days'
    union all select count(*) from public.criminal_cases where created_at>=clock_timestamp()-interval '7 days'
  ) activity;
  v_score:=coalesce(v_active_players,0)*3+least(coalesce(v_transactions,0),300)*.15
    +coalesce(v_businesses,0)*4+least(coalesce(v_participation,0),200)*.35;
  v_level:=case when v_score<15 then 'very_low' when v_score<40 then 'low'
    when v_score<90 then 'medium' when v_score<180 then 'high' else 'very_high' end;
  v_target:=case v_level when 'very_low' then .25 when 'low' then .35
    when 'medium' then .50 when 'high' then .60 else .75 end;
  select player_share into v_current from public.economic_state where id=true for update;
  v_current:=coalesce(v_current,.25);
  v_player:=round(least(v_current+.08,greatest(v_current-.08,v_current*.75+v_target*.25)),6);

  update public.economic_state
  set player_activity_level=v_level,player_share=v_player,simulated_share=1-v_player,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'activity_score',round(v_score,4),'active_players',v_active_players,
        'recent_transactions',v_transactions,'active_businesses',v_businesses,
        'participation_actions',v_participation,'influence_model','dynamic_smoothed',
        'target_player_share',v_target,'player_share',v_player,'simulated_share',1-v_player
      ),updated_at=clock_timestamp()
  where id=true;
  update public.country_rp_states
  set player_share=v_player,simulated_share=1-v_player,
      economic_current=economic_current||jsonb_build_object('playerShare',v_player,'simulatedShare',1-v_player),
      updated_at=clock_timestamp()
  where is_playable;
  update public.government_popularity_state
  set player_activity_weight=v_player,simulation_weight=1-v_player,updated_at=clock_timestamp()
  where country_code='BR';
  return jsonb_build_object('level',v_level,'score',round(v_score,4),
    'target_player_share',v_target,'player_share',v_player,'simulated_share',1-v_player);
end;
$$;

create or replace function public.recalculate_country_activity_mix()
returns jsonb language sql security definer set search_path='' as $$
  select economy_private.update_activity_mix()
$$;

insert into public.system_settings(key,value)
values('election_simulation',jsonb_build_object(
  'enabled',false,'modelVersion','infrastructure-only-v1',
  'description','Componente populacional eleitoral permanece desativado por padrão.'
)) on conflict(key) do nothing;

-- Objetivos das aspirações que já possuem ações reais na plataforma.
insert into public.citizen_objective_definitions(
  objective_key,aspiration,title,description,category,target_type,target_value,action_path,reputation_reward,sort_order
) values
  ('consult_public_security','security','Conhecer a segurança pública','Acesse a área de segurança pública do GOV.RP.','Segurança','page_security',1,'/services/police',5,20),
  ('report_valid_occurrence','security','Registrar uma denúncia','Envie uma ocorrência válida às autoridades.','Segurança','police_reports',1,'/services/police',8,30),
  ('read_national_news','communication','Acompanhar o país','Acesse o portal de notícias e acompanhe um acontecimento.','Comunicação','page_news',1,'/news',5,20),
  ('publish_media_article','communication','Publicar uma matéria','Publique uma matéria quando fizer parte de um veículo.','Comunicação','media_articles',1,'/news',10,40),
  ('explore_education','knowledge','Planejar a carreira','Conheça a área de educação e formação.','Conhecimento e carreira','page_education',1,'/services/education',5,20),
  ('obtain_employment','knowledge','Conquistar uma ocupação','Obtenha um vínculo de trabalho registrado.','Conhecimento e carreira','employment',1,'/services/business',10,40)
on conflict(objective_key) do update set
  aspiration=excluded.aspiration,title=excluded.title,description=excluded.description,
  category=excluded.category,target_type=excluded.target_type,target_value=excluded.target_value,
  action_path=excluded.action_path,reputation_reward=excluded.reputation_reward,
  sort_order=excluded.sort_order,is_active=true;

-- A movimentação inicial do onboarding não vale como ação bancária voluntária.
update public.citizen_objective_definitions
set target_type='voluntary_transactions',description='Realize uma transferência, compra ou câmbio por iniciativa própria.'
where objective_key='first_bank_transfer';

alter table public.population_segment_events enable row level security;
alter table public.national_event_decision_options enable row level security;
alter table public.national_event_responses enable row level security;
alter table public.national_media_briefs enable row level security;
alter table public.currency_market_states enable row level security;
alter table public.currency_market_cycles enable row level security;

create policy population_segment_events_public_read on public.population_segment_events
  for select to anon,authenticated using(true);
create policy national_event_options_public_read on public.national_event_decision_options
  for select to anon,authenticated using(true);
create policy national_event_responses_public_read on public.national_event_responses
  for select to anon,authenticated using(true);
create policy national_media_briefs_public_read on public.national_media_briefs
  for select to anon,authenticated using(status='published');
create policy currency_market_states_public_read on public.currency_market_states
  for select to anon,authenticated using(true);
create policy currency_market_cycles_public_read on public.currency_market_cycles
  for select to anon,authenticated using(true);

revoke all on table public.population_segment_events,public.national_event_decision_options,
  public.national_event_responses,public.national_media_briefs,
  public.currency_market_states,public.currency_market_cycles from public,anon,authenticated;
grant select on table public.population_segment_events,public.national_event_decision_options,
  public.national_event_responses,public.national_media_briefs,
  public.currency_market_states,public.currency_market_cycles to anon,authenticated;
grant all on table public.population_segment_events,public.national_event_decision_options,
  public.national_event_responses,public.national_media_briefs,
  public.currency_market_states,public.currency_market_cycles to service_role;

revoke all on function public.apply_population_consequence(text,text,text,jsonb,bigint,uuid) from public,anon,authenticated;
revoke all on function public.settle_national_game_event(uuid,uuid,uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.resolve_expired_national_game_events() from public,anon,authenticated;
revoke all on function public.recalculate_currency_market(text,text,boolean) from public,anon,authenticated;
revoke all on function public.recalculate_country_activity_mix() from public,anon,authenticated;
grant execute on function public.create_national_game_event(text,text,text,text,numeric,jsonb,text) to authenticated,service_role;
grant execute on function public.respond_national_game_event(uuid,uuid,text) to authenticated,service_role;
grant execute on function public.resolve_expired_national_game_events() to service_role;
grant execute on function public.get_national_feed(integer,integer) to anon,authenticated,service_role;
grant execute on function public.run_currency_market_cycle(text) to authenticated,service_role;
grant execute on function public.recalculate_country_activity_mix() to service_role;

do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='country_population_segments') then
      alter publication supabase_realtime add table public.country_population_segments;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='national_event_decision_options') then
      alter publication supabase_realtime add table public.national_event_decision_options;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='national_event_responses') then
      alter publication supabase_realtime add table public.national_event_responses;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='national_media_briefs') then
      alter publication supabase_realtime add table public.national_media_briefs;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='currency_market_states') then
      alter publication supabase_realtime add table public.currency_market_states;
    end if;
  end if;
end;
$$;

notify pgrst,'reload schema';
commit;
