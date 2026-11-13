begin;

alter table public.profiles
  add column if not exists character_gender text;

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conname='profiles_character_gender_check'
      and conrelid='public.profiles'::regclass
  ) then
    alter table public.profiles add constraint profiles_character_gender_check
      check(character_gender is null or character_gender in ('male','female'));
  end if;
end;
$$;

create or replace function public.save_citizen_identity(
  p_full_name text,
  p_username text,
  p_date_of_birth date,
  p_character_bio text,
  p_avatar_url text,
  p_character_gender text
)
returns public.profiles
language plpgsql
security definer
set search_path=''
as $$
declare v_profile public.profiles%rowtype;
begin
  if p_character_gender not in ('male','female') then
    raise exception 'Selecione o sexo do personagem.';
  end if;
  v_profile:=public.save_citizen_identity(
    p_full_name,p_username,p_date_of_birth,p_character_bio,p_avatar_url
  );
  update public.profiles set character_gender=p_character_gender,updated_at=clock_timestamp()
  where id=auth.uid() and onboarding_completed=false returning * into v_profile;
  if v_profile.id is null then raise exception 'Onboarding indisponível ou já concluído.'; end if;
  return v_profile;
end;
$$;

create or replace function public.require_character_gender_for_citizenship()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.onboarding_completed and not coalesce(old.onboarding_completed,false)
     and new.character_gender is null then
    raise exception 'Selecione o sexo do personagem antes de concluir a cidadania.';
  end if;
  return new;
end;
$$;

drop trigger if exists require_character_gender_for_citizenship on public.profiles;
create trigger require_character_gender_for_citizenship
before update of onboarding_completed on public.profiles
for each row execute function public.require_character_gender_for_citizenship();

create or replace function public.protect_citizen_official_fields()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if current_user not in ('postgres','service_role','supabase_admin') then
    if new.full_name is distinct from old.full_name
       or new.username is distinct from old.username
       or new.date_of_birth is distinct from old.date_of_birth
       or new.character_gender is distinct from old.character_gender
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

-- Constituição persistida e versionada por país.
create table if not exists public.country_constitutions (
  id uuid primary key default gen_random_uuid(),
  country_code text not null,
  version text not null,
  title text not null,
  preamble text not null,
  status text not null default 'active' check(status in ('draft','active','superseded')),
  effective_at timestamptz not null default clock_timestamp(),
  superseded_at timestamptz,
  source_url text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(country_code,version)
);

create unique index if not exists country_one_active_constitution
  on public.country_constitutions(country_code) where status='active';

create table if not exists public.constitution_sections (
  id uuid primary key default gen_random_uuid(),
  constitution_id uuid not null references public.country_constitutions(id) on delete cascade,
  title text not null,
  sort_order integer not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(constitution_id,sort_order)
);

create table if not exists public.constitution_articles (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.constitution_sections(id) on delete cascade,
  article_number text not null,
  body text not null,
  sort_order integer not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(section_id,article_number)
);

create table if not exists public.constitution_amendments (
  id uuid primary key default gen_random_uuid(),
  constitution_id uuid not null references public.country_constitutions(id) on delete restrict,
  amendment_number text not null,
  title text not null,
  summary text not null,
  published_at timestamptz not null,
  source_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  unique(constitution_id,amendment_number)
);

do $$
declare
  v_constitution uuid;
  v_section uuid;
begin
  insert into public.country_constitutions(country_code,version,title,preamble,status,source_url)
  values(
    'BR','1.0','Constituição Federal do GOV.RP',
    'Nós, representantes e cidadãos do GOV.RP, estabelecemos esta Constituição para organizar o Estado, proteger direitos, garantir o equilíbrio entre os Poderes e orientar a vida pública.',
    'active','/constituicao-govrp.pdf'
  ) on conflict(country_code,version) do update set title=excluded.title,preamble=excluded.preamble
  returning id into v_constitution;

  insert into public.constitution_sections(constitution_id,title,sort_order)
  values(v_constitution,'Título I — Princípios Fundamentais',10)
  on conflict(constitution_id,sort_order) do update set title=excluded.title returning id into v_section;
  insert into public.constitution_articles(section_id,article_number,body,sort_order) values
    (v_section,'Art. 1º','O GOV.RP constitui-se em uma República presidencialista, democrática e soberana.',10),
    (v_section,'Art. 2º','São Poderes da Nação, independentes e harmônicos entre si, o Executivo, o Legislativo e o Judiciário.',20),
    (v_section,'Art. 3º','Todo poder emana do povo, que o exerce por representantes eleitos e pelos mecanismos de participação popular.',30)
  on conflict(section_id,article_number) do update set body=excluded.body,sort_order=excluded.sort_order;

  insert into public.constitution_sections(constitution_id,title,sort_order)
  values(v_constitution,'Título II — Direitos e Garantias',20)
  on conflict(constitution_id,sort_order) do update set title=excluded.title returning id into v_section;
  insert into public.constitution_articles(section_id,article_number,body,sort_order) values
    (v_section,'Art. 4º','São assegurados aos cidadãos a dignidade, a liberdade de expressão, o devido processo legal, o acesso aos serviços públicos e a igualdade de tratamento perante as instituições do GOV.RP.',10),
    (v_section,'Art. 5º','Nenhum cidadão será privado de seus direitos sem fundamento legal e decisão da autoridade competente.',20)
  on conflict(section_id,article_number) do update set body=excluded.body,sort_order=excluded.sort_order;

  insert into public.constitution_sections(constitution_id,title,sort_order)
  values(v_constitution,'Título III — Organização Política',30)
  on conflict(constitution_id,sort_order) do update set title=excluded.title returning id into v_section;
  insert into public.constitution_articles(section_id,article_number,body,sort_order) values
    (v_section,'Art. 6º','O Presidente da República exerce a chefia de Estado e de Governo, nos termos desta Constituição.',10),
    (v_section,'Art. 7º','O Parlamento representa a vontade popular, fiscaliza o Executivo e delibera sobre projetos e plebiscitos.',20),
    (v_section,'Art. 8º','O Judiciário assegura a interpretação da lei, a garantia de direitos e a solução dos conflitos.',30)
  on conflict(section_id,article_number) do update set body=excluded.body,sort_order=excluded.sort_order;

  insert into public.constitution_sections(constitution_id,title,sort_order)
  values(v_constitution,'Participação Popular',40)
  on conflict(constitution_id,sort_order) do update set title=excluded.title returning id into v_section;
  insert into public.constitution_articles(section_id,article_number,body,sort_order) values
    (v_section,'Art. 9º','O povo poderá sugerir projetos, participar de consultas públicas e apresentar plebiscitos na forma da lei.',10),
    (v_section,'Art. 10','O voto é instrumento legítimo de escolha dos representantes e de definição do rumo político do GOV.RP.',20)
  on conflict(section_id,article_number) do update set body=excluded.body,sort_order=excluded.sort_order;

  insert into public.constitution_sections(constitution_id,title,sort_order)
  values(v_constitution,'Ordem Econômica e Social',50)
  on conflict(constitution_id,sort_order) do update set title=excluded.title returning id into v_section;
  insert into public.constitution_articles(section_id,article_number,body,sort_order) values
    (v_section,'Art. 11','A ordem econômica observa a livre iniciativa, a função social e a responsabilidade fiscal do Estado.',10),
    (v_section,'Art. 12','O Estado promoverá educação, saúde, segurança, infraestrutura e acesso digital de forma progressiva.',20)
  on conflict(section_id,article_number) do update set body=excluded.body,sort_order=excluded.sort_order;

  insert into public.constitution_sections(constitution_id,title,sort_order)
  values(v_constitution,'Emendas e Revisão',60)
  on conflict(constitution_id,sort_order) do update set title=excluded.title returning id into v_section;
  insert into public.constitution_articles(section_id,article_number,body,sort_order) values
    (v_section,'Art. 13','A Constituição poderá ser alterada por emenda, observado o rito legislativo próprio e o interesse nacional.',10),
    (v_section,'Art. 14','Nenhuma emenda poderá abolir o voto popular, a separação dos Poderes e os direitos fundamentais.',20)
  on conflict(section_id,article_number) do update set body=excluded.body,sort_order=excluded.sort_order;

  insert into public.constitution_sections(constitution_id,title,sort_order)
  values(v_constitution,'Disposição Final',70)
  on conflict(constitution_id,sort_order) do update set title=excluded.title returning id into v_section;
  insert into public.constitution_articles(section_id,article_number,body,sort_order)
  values(v_section,'Art. 15','Esta Constituição entra em vigor na data de sua publicação e orienta todo o funcionamento institucional do GOV.RP.',10)
  on conflict(section_id,article_number) do update set body=excluded.body,sort_order=excluded.sort_order;
end;
$$;

create or replace function public.get_country_constitution(p_country_code text default 'BR')
returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'id',constitution.id,'countryCode',constitution.country_code,'version',constitution.version,
    'title',constitution.title,'preamble',constitution.preamble,'effectiveAt',constitution.effective_at,
    'sourceUrl',constitution.source_url,
    'sections',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',section.id,'title',section.title,'sortOrder',section.sort_order,
        'articles',coalesce((
          select jsonb_agg(jsonb_build_object(
            'id',article.id,'number',article.article_number,'body',article.body,'sortOrder',article.sort_order
          ) order by article.sort_order,article.article_number)
          from public.constitution_articles article where article.section_id=section.id
        ),'[]'::jsonb)
      ) order by section.sort_order,section.title)
      from public.constitution_sections section where section.constitution_id=constitution.id
    ),'[]'::jsonb),
    'amendments',coalesce((select jsonb_agg(to_jsonb(amendment) order by amendment.published_at)
      from public.constitution_amendments amendment where amendment.constitution_id=constitution.id),'[]'::jsonb)
  )
  from public.country_constitutions constitution
  where constitution.country_code=upper(coalesce(nullif(p_country_code,''),'BR')) and constitution.status='active'
  order by constitution.effective_at desc limit 1
$$;

-- Objetivos usam somente ações reais e uma movimentação bancária voluntária.
create or replace function public.refresh_my_citizen_objectives()
returns table(
  objective_id uuid,objective_key text,title text,description text,category text,
  action_path text,target_value integer,progress integer,reputation_reward integer,completed_at timestamptz
)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid();
  v_aspiration text;
  objective record;
  v_progress integer;
  v_completed_at timestamptz;
begin
  if v_user_id is null then raise exception 'É necessário estar autenticado.'; end if;
  select profile.initial_aspiration into v_aspiration from public.profiles profile
  where profile.id=v_user_id and profile.deleted_at is null;
  if not found then raise exception 'Cidadão não encontrado.'; end if;

  for objective in
    select definition.* from public.citizen_objective_definitions definition
    where definition.is_active and (definition.aspiration is null or definition.aspiration=v_aspiration)
    order by definition.sort_order,definition.title
  loop
    v_progress:=case objective.target_type
      when 'onboarding' then (select case when profile.onboarding_completed then 1 else 0 end from public.profiles profile where profile.id=v_user_id)
      when 'posts' then (select count(*)::integer from public.posts post where post.user_id=v_user_id and post.parent_post_id is null)
      when 'voluntary_transactions' then (
        select count(*)::integer from public.transactions transaction_row
        join public.accounts account on account.id=transaction_row.from_account_id
        where account.user_id=v_user_id and transaction_row.type in ('transfer','exchange','purchase')
          and coalesce(transaction_row.metadata->>'origin','') not in ('citizenship_onboarding','system','automatic')
      )
      when 'votes' then (
        (select count(*)::integer from public.plebiscite_votes vote where vote.voter_id=v_user_id)+
        (select count(*)::integer from public.bill_votes vote join public.parliament_members member on member.id=vote.member_id where member.user_id=v_user_id)
      )
      when 'party_membership' then (select count(*)::integer from public.party_members member where member.user_id=v_user_id)
      when 'businesses' then (select count(*)::integer from public.businesses business where business.owner_id=v_user_id)
      when 'page_justice' then (select count(*)::integer from public.user_page_views view_row where view_row.user_id=v_user_id and view_row.path like '/services/justice%')
      when 'services' then (select count(distinct view_row.service_key)::integer from public.user_page_views view_row where view_row.user_id=v_user_id and view_row.service_key is not null)
      when 'page_security' then (select count(*)::integer from public.user_page_views view_row where view_row.user_id=v_user_id and (view_row.path like '/services/police%' or view_row.path like '/services/armed-forces%'))
      when 'police_reports' then (select count(*)::integer from public.police_occurrences occurrence where coalesce(occurrence.reported_by,occurrence.user_id)=v_user_id)
      when 'page_news' then (select count(*)::integer from public.user_page_views view_row where view_row.user_id=v_user_id and view_row.path like '/news%')
      when 'media_articles' then (select count(*)::integer from public.news_articles article where article.author_id=v_user_id)
      when 'page_education' then (select count(*)::integer from public.user_page_views view_row where view_row.user_id=v_user_id and view_row.path like '/services/education%')
      when 'employment' then (select count(*)::integer from public.business_employees employee where employee.profile_id=v_user_id and not employee.is_npc and employee.fired_at is null)
      else 0
    end;
    v_progress:=least(objective.target_value,greatest(0,coalesce(v_progress,0)));
    v_completed_at:=case when v_progress>=objective.target_value then clock_timestamp() else null end;

    insert into public.citizen_objective_progress(user_id,objective_id,progress,completed_at,updated_at)
    values(v_user_id,objective.id,v_progress,v_completed_at,clock_timestamp())
    on conflict on constraint citizen_objective_progress_pkey do update set
      progress=case when objective.objective_key='first_bank_transfer' then excluded.progress
        else greatest(public.citizen_objective_progress.progress,excluded.progress) end,
      completed_at=case when objective.objective_key='first_bank_transfer' and excluded.completed_at is null then null
        else coalesce(public.citizen_objective_progress.completed_at,excluded.completed_at) end,
      updated_at=excluded.updated_at;

    update public.citizen_objective_progress progress_row set reward_claimed_at=clock_timestamp()
    where progress_row.user_id=v_user_id and progress_row.objective_id=objective.id
      and progress_row.completed_at is not null and progress_row.reward_claimed_at is null;
    if found and objective.reputation_reward>0 then
      update public.profiles set reputation_points=coalesce(reputation_points,0)+objective.reputation_reward,
        updated_at=clock_timestamp() where id=v_user_id;
    end if;
  end loop;

  return query
  select definition.id,definition.objective_key,definition.title,definition.description,
    definition.category,definition.action_path,definition.target_value,progress_row.progress,
    definition.reputation_reward,progress_row.completed_at
  from public.citizen_objective_definitions definition
  join public.citizen_objective_progress progress_row
    on progress_row.objective_id=definition.id and progress_row.user_id=v_user_id
  where definition.is_active and (definition.aspiration is null or definition.aspiration=v_aspiration)
  order by definition.sort_order,definition.title;
end;
$$;

update public.citizen_objective_progress progress
set progress=0,completed_at=null,updated_at=clock_timestamp()
from public.citizen_objective_definitions definition
where definition.id=progress.objective_id and definition.objective_key='first_bank_transfer'
  and not exists(
    select 1 from public.transactions transaction_row
    join public.accounts account on account.id=transaction_row.from_account_id
    where account.user_id=progress.user_id and transaction_row.type in ('transfer','exchange','purchase')
      and coalesce(transaction_row.metadata->>'origin','') not in ('citizenship_onboarding','system','automatic')
  );

alter table public.country_constitutions enable row level security;
alter table public.constitution_sections enable row level security;
alter table public.constitution_articles enable row level security;
alter table public.constitution_amendments enable row level security;

create policy country_constitutions_public_read on public.country_constitutions
  for select to anon,authenticated using(status='active');
create policy constitution_sections_public_read on public.constitution_sections
  for select to anon,authenticated using(exists(
    select 1 from public.country_constitutions constitution
    where constitution.id=constitution_id and constitution.status='active'
  ));
create policy constitution_articles_public_read on public.constitution_articles
  for select to anon,authenticated using(exists(
    select 1 from public.constitution_sections section
    join public.country_constitutions constitution on constitution.id=section.constitution_id
    where section.id=section_id and constitution.status='active'
  ));
create policy constitution_amendments_public_read on public.constitution_amendments
  for select to anon,authenticated using(exists(
    select 1 from public.country_constitutions constitution
    where constitution.id=constitution_id and constitution.status='active'
  ));

revoke all on table public.country_constitutions,public.constitution_sections,
  public.constitution_articles,public.constitution_amendments from public,anon,authenticated;
grant select on table public.country_constitutions,public.constitution_sections,
  public.constitution_articles,public.constitution_amendments to anon,authenticated;
grant all on table public.country_constitutions,public.constitution_sections,
  public.constitution_articles,public.constitution_amendments to service_role;

revoke all on function public.save_citizen_identity(text,text,date,text,text,text) from public,anon;
grant execute on function public.save_citizen_identity(text,text,date,text,text,text) to authenticated,service_role;
revoke all on function public.get_country_constitution(text) from public;
grant execute on function public.get_country_constitution(text) to anon,authenticated,service_role;

-- A foto escolhida no onboarding precisa funcionar também em uma instalação
-- nova. Cada pessoa só pode gravar ou remover arquivos dentro da própria pasta.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'avatars','avatars',true,5242880,
  array['image/jpeg','image/png','image/webp','image/gif','image/avif']
)
on conflict(id) do update set
  public=excluded.public,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

notify pgrst,'reload schema';
commit;
