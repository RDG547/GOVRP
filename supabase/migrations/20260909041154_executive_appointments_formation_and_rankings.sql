begin;
create or replace function public.canonical_official_role(p_role text)
returns text language sql immutable set search_path='' as $$
 select case p_role when 'Presidente da Câmara' then 'Presidente da Câmara dos Deputados' when 'Vice-Presidente do Senado' then 'Vice-Presidente do Senado Federal' when 'Diretor da Polícia Federal' then 'Diretor-Geral de Polícia' when 'Comandante das Forças Armadas' then 'Comandante-Geral das Forças Armadas' else p_role end;
$$;
create or replace function private.normalize_official_role()
returns trigger language plpgsql set search_path='' as $$
begin
 new.role:=public.canonical_official_role(new.role);
 select coalesce(array_agg(distinct public.canonical_official_role(t)),'{}') into new.titles from unnest(coalesce(new.titles,'{}')) t;
 return new;
end; $$;
create trigger normalize_official_role before insert or update of role,titles on public.profiles for each row execute function private.normalize_official_role();
update public.profiles set role=public.canonical_official_role(role),titles=(select coalesce(array_agg(distinct public.canonical_official_role(t)),'{}') from unnest(coalesce(titles,'{}')) t)
where role<>public.canonical_official_role(role) or exists(select 1 from unnest(coalesce(titles,'{}')) t where t<>public.canonical_official_role(t));

create table public.executive_office_definitions (
 office_key text primary key,role_label text not null unique,description text not null,required_for_formation boolean not null default true,sort_order integer not null
);
insert into public.executive_office_definitions values
 ('federal_police_director','Diretor-Geral de Polícia','Direção unificada da Polícia do GOVRP.',true,1),
 ('armed_forces_commander','Comandante-Geral das Forças Armadas','Comando unificado das Forças Armadas.',true,2),
 ('intelligence_commander','Comandante da Agência de Inteligência','Coordenação institucional da Agência de Inteligência.',true,3),
 ('national_bank_president','Presidente do Banco Nacional','Gestão do Banco Nacional.',false,4);
alter table public.executive_office_definitions enable row level security;
revoke all on public.executive_office_definitions from public,anon,authenticated;
grant select on public.executive_office_definitions to anon,authenticated;
grant all on public.executive_office_definitions to service_role;
create policy executive_office_public_read on public.executive_office_definitions for select to anon,authenticated using(true);
create table public.presidential_formation (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id),
 started_at timestamptz not null default clock_timestamp(),completed_at timestamptz,ended_at timestamptz
);
create unique index one_active_presidential_formation on public.presidential_formation(user_id) where ended_at is null;
alter table public.presidential_formation enable row level security;
revoke all on public.presidential_formation from public,anon,authenticated;
grant select on public.presidential_formation to authenticated;
grant all on public.presidential_formation to service_role;
create policy formation_owner_read on public.presidential_formation for select to authenticated using(user_id=(select auth.uid()));
create or replace function private.start_presidential_formation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.role='Presidente' and old.role is distinct from new.role then
   insert into public.presidential_formation(user_id) values(new.id) on conflict do nothing;
 elsif old.role='Presidente' and new.role<>'Presidente' then update public.presidential_formation set ended_at=clock_timestamp() where user_id=new.id and ended_at is null; end if;
 return new;
end; $$;
create trigger start_presidential_formation after update of role on public.profiles for each row execute function private.start_presidential_formation();

create or replace function public.manage_executive_appointment(p_office_key text,p_user_id uuid default null,p_note text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg jsonb; office public.executive_office_definitions%rowtype; previous jsonb; target public.profiles%rowtype; entry jsonb; event_id uuid:=gen_random_uuid();
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role in('Presidente','Admin')) then raise exception 'A nomeação exige autoridade presidencial.' using errcode='42501'; end if;
 select * into office from public.executive_office_definitions where office_key=p_office_key;
 if not found then raise exception 'Escolha um cargo executivo válido.'; end if;
 select coalesce(value,'{}') into cfg from public.system_settings where key='executive_governance' for update;
 cfg:=coalesce(cfg,'{}');previous:=cfg->'specialAppointments'->p_office_key;
 if p_user_id is not null then
   select * into target from public.profiles where id=p_user_id and onboarding_completed and deleted_at is null for update;
   if not found or target.role in('Admin','Presidente','Vice-Presidente') then raise exception 'Escolha um cidadão elegível para a nomeação.'; end if;
   if previous->>'user_id'=p_user_id::text then return previous; end if;
   if exists(select 1 from jsonb_each(coalesce(cfg->'specialAppointments','{}')) a where a.key<>p_office_key and a.value->>'user_id'=p_user_id::text) then raise exception 'Este cidadão já ocupa outra nomeação estratégica.'; end if;
 end if;
 if previous->>'user_id' is not null then
   update public.profiles set role=coalesce(previous->>'previous_role','Cidadão'),updated_at=clock_timestamp() where id=(previous->>'user_id')::uuid and role=office.role_label;
 end if;
 if p_user_id is null then cfg:=jsonb_set(cfg,'{specialAppointments}',coalesce(cfg->'specialAppointments','{}')-p_office_key);
 else
   entry:=jsonb_build_object('user_id',p_user_id,'appointed_at',clock_timestamp(),'appointed_by',auth.uid(),'previous_role',target.role,'note',p_note);
   cfg:=jsonb_set(cfg,'{specialAppointments}',coalesce(cfg->'specialAppointments','{}')||jsonb_build_object(p_office_key,entry));
   update public.profiles set role=office.role_label,updated_at=clock_timestamp() where id=p_user_id;
 end if;
 insert into public.system_settings(key,value) values('executive_governance',cfg) on conflict(key) do update set value=excluded.value;
 insert into public.dou_entries(title,summary,content,type,source_id,legal_metadata)
 values(case when p_user_id is null then 'Exoneração: ' else 'Nomeação: ' end||office.role_label,
   case when p_user_id is null then 'O cargo foi desocupado.' else target.full_name||' assume o cargo.' end,
   coalesce(p_note,''),'Nomeacao e Exoneracao',event_id,jsonb_build_object('office_key',p_office_key,'actor_id',auth.uid(),'user_id',p_user_id,'previous',previous));
 perform economy_private.audit('executive_appointment_changed','system_settings',p_office_key,previous,entry,coalesce(p_note,'Nomeação executiva.'),auth.uid());
 return coalesce(entry,'{}');
end; $$;

create or replace function public.get_presidential_formation()
returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.presidential_formation%rowtype; offices jsonb; ministries jsonb; cfg jsonb; remaining integer;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role='Presidente') then return null; end if;
 insert into public.presidential_formation(user_id) values(auth.uid()) on conflict do nothing;
 select * into f from public.presidential_formation where user_id=auth.uid() and ended_at is null for update;
 select value into cfg from public.system_settings where key='executive_governance';
 select coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object('appointment',cfg->'specialAppointments'->o.office_key) order by sort_order),'[]') into offices from public.executive_office_definitions o where required_for_formation;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'holder_id',a.user_id) order by m.name),'[]') into ministries
 from public.government_ministries m left join lateral (select user_id from public.ministers where ministry_id=m.id and status='active' order by appointed_at desc limit 1) a on true where m.is_active;
 select count(*) into remaining from jsonb_array_elements(offices) o where o->'appointment'->>'user_id' is null;
 remaining:=remaining+(select count(*) from jsonb_array_elements(ministries) m where m->>'holder_id' is null);
 if remaining=0 and f.completed_at is null then update public.presidential_formation set completed_at=clock_timestamp() where id=f.id returning * into f; end if;
 return to_jsonb(f)||jsonb_build_object('offices',offices,'ministries',ministries,'remaining',remaining);
end; $$;

-- Public aggregated rankings expose no account identifiers or private ledger details.
create or replace function public.get_citizen_rankings()
returns jsonb language sql stable security definer set search_path='' as $$
 with citizens as (select id,full_name,avatar_url,role,coalesce(reputation_points,0) reputation from public.profiles where onboarding_completed and deleted_at is null),
 scores as (select c.*,
   coalesce((select sum(a.balance+coalesce((select sum(j.value::numeric*r.brl_per_unit) from jsonb_each_text(coalesce(a.currency_balances,'{}')) j join public.country_rp_exchange_rates r on r.currency_code=j.key and r.country_code='BR'),0)) from public.accounts a where a.user_id=c.id),0)
   +coalesce((select sum(amount_invested) from public.user_investments where user_id=c.id and is_active),0)
   +coalesce((select sum(purchase_price) from public.citizen_residences where owner_id=c.id and status='owned'),0) wealth,
   least(30,greatest(0,c.reputation)/100)
   +case when c.role='Presidente' then 25 when c.role in('Deputado','Senador','Juiz','Ministro') then 15 when c.role<>'Cidadão' and c.role<>'Usuário' and c.role<>'Admin' then 10 else 0 end
   +least(25,(select count(distinct f.follower_id) from public.followers f join citizens valid on valid.id=f.follower_id where f.following_id=c.id and f.follower_id<>c.id))
   +least(20,(select count(distinct v.voting_id) from public.parliament_voting_votes v join public.parliament_members m on m.id=v.member_id where m.user_id=c.id)) influence
 from citizens c)
 select jsonb_build_object('wealth',(select coalesce(jsonb_agg(to_jsonb(w)),'[]') from (select id,full_name,avatar_url,wealth from scores order by wealth desc,id limit 10) w),
 'influence',(select coalesce(jsonb_agg(to_jsonb(i)),'[]') from (select id,full_name,avatar_url,influence from scores order by influence desc,id limit 10) i),
 'wealth_method','Saldos em reais, moedas convertidas pela cotação do RP, principal dos investimentos ativos e valor de aquisição dos imóveis. Sem avaliação arbitrária de empresas.',
 'influence_method','Reputação: até 30 pontos (1 por 100); cargo público: até 25; seguidores cidadãos distintos: até 25; votações parlamentares distintas: até 20. Assinaturas pagas não pontuam.');
$$;
create or replace function private.broadcast_citizen_rankings()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform realtime.send('{}'::jsonb,'rankings-changed','citizen-world-rankings',false);
 return null;
end; $$;
create trigger account_ranking_change after insert or update or delete on public.accounts for each statement execute function private.broadcast_citizen_rankings();
create trigger investment_ranking_change after insert or update or delete on public.user_investments for each statement execute function private.broadcast_citizen_rankings();
create trigger residence_ranking_change after insert or update or delete on public.citizen_residences for each statement execute function private.broadcast_citizen_rankings();

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
 (n.nspname='private' and p.proname in('normalize_official_role','start_presidential_formation','broadcast_citizen_rankings')) or
 (n.nspname='public' and p.proname in('canonical_official_role','manage_executive_appointment','get_presidential_formation','get_citizen_rankings')) loop
 execute format('alter function %s owner to postgres',f.signature);
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 end loop;
end; $$;
grant execute on function public.canonical_official_role(text),public.get_citizen_rankings() to anon,authenticated,service_role;
grant execute on function public.manage_executive_appointment(text,uuid,text),public.get_presidential_formation() to authenticated,service_role;
alter publication supabase_realtime add table public.presidential_formation,public.executive_office_definitions;
alter table public.executive_office_definitions owner to postgres;
alter table public.presidential_formation owner to postgres;
commit;
