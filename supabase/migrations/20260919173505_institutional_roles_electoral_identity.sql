begin;
set local lock_timeout='10s';
set local statement_timeout='120s';
-- profiles.role is the validated current office; mandates and board terms are its
-- institutional records. Titles and obsolete election caches confer no authority.
create or replace function public.handle_profile_role_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare h uuid; pos text; member public.parliament_members%rowtype; previous record;
begin
 perform public.sync_parliament_membership(new.id,new.role,old.role);
 select m.* into member from public.parliament_members m where m.user_id=new.id and m.id=public.get_active_parliament_member_id(new.id,m.house_id) limit 1;
 h:=member.house_id;
 if new.role=public.canonical_official_role(public.get_parliament_leadership_role_label(h,'president')) then pos:='president';
 elsif new.role=public.canonical_official_role(public.get_parliament_leadership_role_label(h,'vice_president')) then pos:='vice_president'; end if;
 update public.parliament_leadership_terms t set status='completed',concluded_at=clock_timestamp()
 where t.member_id in(select id from public.parliament_members where user_id=new.id) and t.status='active'
 and (h is null or pos is null or t.house_id<>h or t.position<>pos);
 if h is not null and pos is not null then
  perform pg_advisory_xact_lock(hashtextextended(h::text||':board',0));
  for previous in select t.*,m.user_id from public.parliament_leadership_terms t join public.parliament_members m on m.id=t.member_id where t.house_id=h and t.position=pos and t.status='active' and t.member_id<>member.id loop
   update public.parliament_leadership_terms set status='completed',concluded_at=clock_timestamp() where id=previous.id;
   update public.profiles set role=public.get_parliament_base_role_label(h),updated_at=clock_timestamp() where id=previous.user_id and role=new.role;
  end loop;
  if not exists(select 1 from public.parliament_leadership_terms where member_id=member.id and status='active' and position=pos) then
   insert into public.parliament_leadership_terms(house_id,member_id,position,term_start_date,term_end_date,status) values(h,member.id,pos,current_date,member.term_end_date,'active');
  end if;
 end if;
 return new;
end $$;
revoke all on function public.handle_profile_role_change() from public,anon,authenticated;
-- Reconcile existing offices through the same trigger, without changing role labels.
do $$ declare p record; begin
 for p in select id,role from public.profiles where deleted_at is null and role in('Deputado','Senador','Presidente da Câmara dos Deputados','Vice-Presidente da Câmara dos Deputados','Presidente do Senado','Vice-Presidente do Senado Federal') loop
  perform public.sync_parliament_membership(p.id,p.role,p.role);
 end loop;
end $$;
-- The trigger normally only runs when the role changes. Reconcile missing board
-- records explicitly using each valid base mandate (no new profile permissions).
insert into public.parliament_leadership_terms(house_id,member_id,position,term_start_date,term_end_date,status)
select m.house_id,m.id,case when p.role like 'Vice-%' then 'vice_president' else 'president' end,current_date,m.term_end_date,'active'
from public.profiles p join public.parliament_members m on m.user_id=p.id
where m.id=public.get_active_parliament_member_id(p.id,m.house_id) and p.role in('Presidente da Câmara dos Deputados','Vice-Presidente da Câmara dos Deputados','Presidente do Senado','Vice-Presidente do Senado Federal')
and not exists(select 1 from public.parliament_leadership_terms t where t.status='active' and (t.member_id=m.id or (t.house_id=m.house_id and t.position=case when p.role like 'Vice-%' then 'vice_president' else 'president' end)));

alter table public.presidential_formation add column status text not null default 'pending' check(status in('pending','in_progress','completed','invalidated'));
update public.presidential_formation set status=case when ended_at is not null then 'invalidated' when completed_at is not null then 'completed' else 'pending' end;
create or replace function private.start_presidential_formation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.role='Presidente' and (old.role is distinct from new.role or new.role_assigned_at is distinct from old.role_assigned_at) then
  update public.presidential_formation set ended_at=clock_timestamp(),status='invalidated' where user_id=new.id and ended_at is null;
  insert into public.presidential_formation(user_id) values(new.id);
 elsif old.role='Presidente' and new.role<>'Presidente' then
  update public.presidential_formation set ended_at=clock_timestamp(),status='invalidated' where user_id=new.id and ended_at is null;
 end if;
 return new;
end $$;
CREATE OR REPLACE FUNCTION public.get_presidential_formation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 if f.status='pending' then update public.presidential_formation set status='in_progress' where id=f.id returning * into f; end if;
 return to_jsonb(f)||jsonb_build_object('offices',offices,'ministries',ministries,'remaining',remaining);
end; $function$;
create function public.complete_presidential_formation() returns void language plpgsql security definer set search_path='' as $$
declare f jsonb;
begin
 f:=public.get_presidential_formation();
 if f is null then raise exception 'Somente o Presidente em exercício pode concluir a formação.' using errcode='42501'; end if;
 if (f->>'remaining')::integer<>0 then raise exception 'Preencha os cargos pendentes antes de concluir.'; end if;
 update public.presidential_formation set completed_at=coalesce(completed_at,clock_timestamp()),status='completed' where id=(f->>'id')::uuid;
end $$;
revoke all on function public.complete_presidential_formation() from public,anon;
grant execute on function public.complete_presidential_formation() to authenticated;

alter table public.parliament_leadership_elections add column voting_start_at timestamptz;
update public.parliament_leadership_elections set voting_start_at=nomination_end_at;
alter table public.parliament_leadership_elections alter column voting_start_at set not null;
alter table public.parliament_leadership_elections add constraint internal_calendar_order check(start_at<nomination_end_at and nomination_end_at<=voting_start_at and voting_start_at<end_at) not valid;
do $$ begin
 if not exists(select 1 from public.parliament_leadership_elections where not(start_at<nomination_end_at and nomination_end_at<=voting_start_at and voting_start_at<end_at)) then
  alter table public.parliament_leadership_elections validate constraint internal_calendar_order;
 end if;
end $$;
-- Compatibility for existing callers; every new UI uses the complete calendar.
create function private.default_internal_voting_start() returns trigger language plpgsql set search_path='' as $$ begin new.voting_start_at:=coalesce(new.voting_start_at,new.nomination_end_at);return new;end $$;
revoke all on function private.default_internal_voting_start() from public,anon,authenticated;
create trigger default_internal_voting_start before insert on public.parliament_leadership_elections for each row execute function private.default_internal_voting_start();
create function public.schedule_leadership_election(p_house_id uuid,p_position text,p_start_at timestamptz,p_nomination_end_at timestamptz,p_voting_start_at timestamptz,p_end_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare election_id uuid;
begin
 if auth.uid() is null or (not coalesce(public.is_admin(auth.uid()),false) and public.get_active_parliament_member_id(auth.uid(),p_house_id) is null) then raise exception 'Somente parlamentares ativos desta Casa podem abrir eleições.' using errcode='42501'; end if;
 if p_position not in('president','vice_president') or p_position is null then raise exception 'Selecione a função da Mesa.'; end if;
 if not coalesce(p_start_at>=clock_timestamp()-interval '1 minute' and p_start_at<p_nomination_end_at and p_nomination_end_at<=p_voting_start_at and p_voting_start_at<p_end_at,false) then raise exception 'Informe datas futuras: início das candidaturas < fim das candidaturas ≤ início da votação < fim da votação.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_house_id::text||':'||p_position,0));
 if exists(select 1 from public.parliament_leadership_elections where house_id=p_house_id and position=p_position and status='open') then raise exception 'Já existe uma eleição em andamento para esta função.'; end if;
 insert into public.parliament_leadership_elections(house_id,position,title,created_by,start_at,nomination_end_at,voting_start_at,end_at)
 values(p_house_id,p_position,'Eleição para '||public.get_parliament_leadership_role_label(p_house_id,p_position),auth.uid(),p_start_at,p_nomination_end_at,p_voting_start_at,p_end_at) returning id into election_id;
 return jsonb_build_object('success',true,'election_id',election_id);
end $$;
revoke all on function public.schedule_leadership_election(uuid,text,timestamptz,timestamptz,timestamptz,timestamptz) from public,anon;
grant execute on function public.schedule_leadership_election(uuid,text,timestamptz,timestamptz,timestamptz,timestamptz) to authenticated;
CREATE OR REPLACE FUNCTION public.nominate_leadership_candidate(p_election_id uuid, p_member_id uuid, p_manifesto text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_election record;
  v_nominee record;
  v_voter_member_id uuid;
begin
  if v_user_id is null then
    raise exception 'É necessário estar autenticado.';
  end if;

  select *
    into v_election
    from public.parliament_leadership_elections
   where id = p_election_id for update;

  if not found then
    raise exception 'Eleição não encontrada.';
  end if;

  if v_election.status <> 'open' or clock_timestamp()>=v_election.nomination_end_at or clock_timestamp()<v_election.start_at then
    raise exception 'A eleição não está mais aberta para candidaturas.';
  end if;

  v_voter_member_id := public.get_active_parliament_member_id(v_user_id, v_election.house_id);

  if v_voter_member_id is null then
    raise exception 'Apenas parlamentares ativos da Casa podem registrar candidaturas.';
  end if;

  if p_member_id is distinct from v_voter_member_id then
    raise exception 'Você só pode registrar sua própria candidatura nesta Casa.' using errcode='42501';
  end if;

  select pm.*, pr.role
    into v_nominee
    from public.parliament_members pm
    join public.profiles pr
      on pr.id = pm.user_id
   where pm.id = p_member_id
     and pm.house_id = v_election.house_id
     and current_date between pm.term_start_date and pm.term_end_date
     and pm.id=public.get_active_parliament_member_id(pm.user_id,pm.house_id);

  if not found then
    raise exception 'O parlamentar indicado não possui mandato ativo nesta Casa.';
  end if;

  if v_nominee.role in ('Admin', 'Presidente') then
    raise exception 'Perfis administrativos não podem ser registrados como candidatos nesta eleição.';
  end if;

  if exists (
    select 1
      from public.parliament_leadership_terms
     where member_id = p_member_id
       and status = 'active'
  ) then
    raise exception 'Este parlamentar já ocupa cargo ativo na mesa diretora.';
  end if;

  insert into public.parliament_leadership_candidates (
    election_id,
    member_id,
    nominated_by,
    manifesto
  )
  values (
    p_election_id,
    p_member_id,
    v_user_id,
    nullif(btrim(coalesce(p_manifesto, '')), '')
  )
  on conflict (election_id, member_id) do update
    set manifesto = excluded.manifesto,
        nominated_by = excluded.nominated_by;

  return jsonb_build_object(
    'success', true,
    'message', 'Candidatura registrada com sucesso.'
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.cast_leadership_vote(p_election_id uuid, p_candidate_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_election record;
  v_candidate record;
  v_member_id uuid;
begin
  if v_user_id is null then
    raise exception 'É necessário estar autenticado.';
  end if;

  select *
    into v_election
    from public.parliament_leadership_elections
   where id = p_election_id for update;

  if not found then
    raise exception 'Eleição não encontrada.';
  end if;

  if v_election.status <> 'open' or clock_timestamp()<v_election.voting_start_at or clock_timestamp()>=v_election.end_at then
    raise exception 'A eleição não está aberta para votos.';
  end if;

  v_member_id := public.get_active_parliament_member_id(v_user_id, v_election.house_id);

  if v_member_id is null then
    raise exception 'Somente parlamentares ativos desta Casa podem votar.';
  end if;

  select plc.*
    into v_candidate
    from public.parliament_leadership_candidates plc
    join public.parliament_members pm
      on pm.id = plc.member_id
   where plc.id = p_candidate_id
     and plc.election_id = p_election_id
     and pm.house_id = v_election.house_id
     and pm.id=public.get_active_parliament_member_id(pm.user_id,pm.house_id);

  if not found then
    raise exception 'Candidato não encontrado para esta eleição.';
  end if;

  insert into public.parliament_leadership_votes (
    election_id,
    voter_member_id,
    candidate_id
  )
  values (
    p_election_id,
    v_member_id,
    p_candidate_id
  );

  return jsonb_build_object(
    'success', true,
    'message', 'Voto registrado com sucesso.'
  );
exception
  when unique_violation then
    raise exception 'Cada parlamentar pode votar apenas uma vez por eleição.';
end;
$function$;
CREATE OR REPLACE FUNCTION private.conclude_leadership_election(p_election_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_election record;
  v_vote_total integer;
  v_active_members integer;
  v_winner_candidate_id uuid;
  v_winner_member_id uuid;
  v_top_votes integer;
  v_top_count integer;
  v_new_term_id uuid;
  v_previous_term record;
  v_previous_user_id uuid;
begin

  select *
    into v_election
    from public.parliament_leadership_elections
   where id = p_election_id for update;

  if not found then
    raise exception 'Eleição não encontrada.';
  end if;

  if v_election.status <> 'open' then
    return jsonb_build_object(
      'success', true,
      'message', 'A eleição já foi encerrada anteriormente.'
    );
  end if;

  if clock_timestamp()<v_election.voting_start_at then raise exception 'O período de votação ainda não começou.'; end if;

  select count(*)
    into v_vote_total
    from public.parliament_leadership_votes
   where election_id = p_election_id;

  select count(*)
    into v_active_members
    from public.parliament_members
   where house_id = v_election.house_id
     and id=public.get_active_parliament_member_id(user_id,house_id);

  if not coalesce(public.get_user_role(auth.uid())='Admin',false) and v_vote_total < coalesce(v_active_members, 0)
     and (v_election.end_at is null or v_election.end_at > now()) then
    raise exception 'A eleição ainda está em andamento.';
  end if;

  if not exists (
    select 1
      from public.parliament_leadership_candidates
     where election_id = p_election_id
  ) then
    update public.parliament_leadership_elections
       set status = 'cancelled',
           concluded_at = now()
     where id = p_election_id;

    return jsonb_build_object(
      'success', true,
      'message', 'Eleição encerrada sem candidaturas registradas.'
    );
  end if;

  with candidate_totals as (
    select plc.id as candidate_id,
           plc.member_id,
           count(plv.id) as total_votes
      from public.parliament_leadership_candidates plc
      left join public.parliament_leadership_votes plv
        on plv.candidate_id = plc.id
     where plc.election_id = p_election_id
       and exists(select 1 from public.parliament_members pm where pm.id=plc.member_id and pm.id=public.get_active_parliament_member_id(pm.user_id,pm.house_id))
     group by plc.id, plc.member_id
  )
  select candidate_id, member_id, total_votes
    into v_winner_candidate_id, v_winner_member_id, v_top_votes
    from candidate_totals
   order by total_votes desc, candidate_id
   limit 1;

  with candidate_totals as (
    select count(plv.id) as total_votes
      from public.parliament_leadership_candidates plc
      left join public.parliament_leadership_votes plv
        on plv.candidate_id = plc.id
     where plc.election_id = p_election_id
       and exists(select 1 from public.parliament_members pm where pm.id=plc.member_id and pm.id=public.get_active_parliament_member_id(pm.user_id,pm.house_id))
     group by plc.id
  )
  select count(*)
    into v_top_count
    from candidate_totals
   where total_votes = coalesce(v_top_votes, 0);

  if coalesce(v_top_votes,0)=0 then
    update public.parliament_leadership_elections
       set status = 'cancelled',
           concluded_at = now()
     where id = p_election_id;

    return jsonb_build_object(
      'success', true,
      'message', 'Eleição encerrada sem votos válidos.'
    );
  end if;

  if v_top_count > 1 then
    update public.parliament_leadership_elections
       set status = 'tied',
           concluded_at = now()
     where id = p_election_id;

    return jsonb_build_object(
      'success', true,
      'message', 'Empate detectado. É necessário abrir nova eleição.'
    );
  end if;

  select plt.*, pm.user_id
    into v_previous_term
    from public.parliament_leadership_terms plt
    join public.parliament_members pm
      on pm.id = plt.member_id
   where plt.house_id = v_election.house_id
     and plt.position = v_election.position
     and plt.status = 'active'
   limit 1;

  if found then
    update public.parliament_leadership_terms
       set status = 'completed',
           concluded_at = now()
     where id = v_previous_term.id;

    v_previous_user_id := v_previous_term.user_id;

    update public.profiles
       set role = public.get_parliament_base_role_label(v_election.house_id),
           updated_at = now()
     where id = v_previous_user_id
       and role = public.get_parliament_leadership_role_label(v_election.house_id, v_election.position);
  end if;

  insert into public.parliament_leadership_terms (
    house_id,
    position,
    member_id,
    elected_by_election_id,
    term_start_date,
    term_end_date,
    status
  )
  values (
    v_election.house_id,
    v_election.position,
    v_winner_member_id,
    p_election_id,
    current_date,
    (current_date + interval '1 month')::date,
    'active'
  )
  returning id into v_new_term_id;

  update public.parliament_leadership_elections
     set status = 'closed',
         winner_member_id = v_winner_member_id,
         concluded_at = now()
   where id = p_election_id;

  update public.profiles
     set role = public.get_parliament_leadership_role_label(v_election.house_id, v_election.position),
         updated_at = now()
   where id = (
     select user_id
       from public.parliament_members
      where id = v_winner_member_id
   );

  return jsonb_build_object(
    'success', true,
    'term_id', v_new_term_id,
    'winner_member_id', v_winner_member_id,
    'message', 'Eleição encerrada e mandato da mesa diretora registrado.'
  );
end;
$function$;
alter table public.political_parties add column color text not null default '#64748B' check(color ~ '^#[0-9A-Fa-f]{6}$');
update public.political_parties set color=upper(customization->>'primary_color') where customization->>'primary_color' ~ '^#[0-9A-Fa-f]{6}$';
alter table public.political_parties drop constraint political_parties_name_key;
alter table public.political_parties drop constraint political_parties_acronym_key;
drop index public.party_electoral_number_unique;
create unique index active_party_name_unique on public.political_parties(lower(btrim(name))) where status is distinct from 'Encerrado';
create unique index active_party_acronym_unique on public.political_parties(lower(btrim(acronym))) where status is distinct from 'Encerrado';
create unique index active_party_number_unique on public.political_parties(electoral_number) where status is distinct from 'Encerrado';
CREATE OR REPLACE FUNCTION private.assign_party_electoral_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform pg_advisory_xact_lock(hashtextextended('party-electoral-number',0));
  if tg_op='UPDATE' and old.electoral_number is not null and new.electoral_number is distinct from old.electoral_number then raise exception 'O número eleitoral do partido é permanente.'; end if;
  if new.electoral_number is null then
    select n::text into new.electoral_number from generate_series(10,99) n where not exists(select 1 from public.political_parties p where p.status is distinct from 'Encerrado' and p.electoral_number=n::text) order by n limit 1;
  end if;
  if new.electoral_number is null then raise exception 'Não há número partidário disponível. Procure a administração eleitoral.'; end if;
  if new.electoral_number !~ '^[1-9][0-9]$' then raise exception 'O número partidário deve ter dois dígitos, de 10 a 99.'; end if;
  if exists(select 1 from public.political_parties p where p.status is distinct from 'Encerrado' and p.electoral_number=new.electoral_number and p.id<>new.id) then raise exception 'Este número já pertence a outro partido.'; end if;
  return new;
end; $function$;
create function public.set_party_color(p_party_id uuid,p_color text) returns void language plpgsql security definer set search_path='' as $$
declare p public.political_parties%rowtype;
begin
 select * into p from public.political_parties where id=p_party_id for update;
 if not found or p.status='Encerrado' then raise exception 'Partido encerrado ou indisponível.'; end if;
 if auth.uid() is null or not (coalesce(public.is_admin(auth.uid()) or auth.uid()=p.owner_id or auth.uid()=p.president_id,false)) then raise exception 'Você não pode editar este partido.' using errcode='42501'; end if;
 if p_color is null or p_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Informe uma cor HEX válida.'; end if;
 update public.political_parties set color=upper(p_color) where id=p.id and color is distinct from upper(p_color);
 if p.color is distinct from upper(p_color) then
 insert into public.party_history(party_id,actor_id,event_type,summary,previous_state,current_state) values(p.id,auth.uid(),'color_changed','Cor oficial atualizada.',jsonb_build_object('color',p.color),jsonb_build_object('color',upper(p_color)));
 end if;
end $$;
revoke all on function public.set_party_color(uuid,text) from public,anon;
grant execute on function public.set_party_color(uuid,text) to authenticated;
create function public.create_political_party(p_name text,p_acronym text,p_ideology text,p_logo_url text,p_statute text,p_description text,p_orientation public.political_orientation,p_color text)
returns json language plpgsql security definer set search_path='' as $$ declare r json; begin
 if auth.uid() is null then raise exception 'Entre na sua conta para fundar um partido.' using errcode='42501'; end if;
 r:=public.create_political_party(p_name,p_acronym,p_ideology,p_logo_url,p_statute,p_description,p_orientation);
 if (r->>'success')::boolean then perform public.set_party_color((r->>'party_id')::uuid,p_color); end if;
 return r;
end $$;
revoke all on function public.create_political_party(text,text,text,text,text,text,public.political_orientation,text) from public,anon;
grant execute on function public.create_political_party(text,text,text,text,text,text,public.political_orientation,text) to authenticated;
alter table public.candidates add column identity_snapshot jsonb, add column vice_identity_snapshot jsonb;
create function private.electoral_identity(p_user_id uuid,p_party_id uuid default null,p_use_membership boolean default false) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p.id,'name',p.full_name,'avatar_url',p.avatar_url,'party',case when t.id is null then null else jsonb_build_object('id',t.id,'name',t.name,'acronym',t.acronym,'logo_url',t.logo_url,'color',t.color,'electoral_number',t.electoral_number) end)
 from public.profiles p left join public.political_parties t on t.id=case when p_use_membership then (select m.party_id from public.party_members m where m.user_id=p.id order by joined_at desc limit 1) else p_party_id end where p.id=p_user_id;
$$;
revoke all on function private.electoral_identity(uuid,uuid,boolean) from public,anon,authenticated;
create function private.freeze_electoral_identity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  new.identity_snapshot:=private.electoral_identity(new.user_id,new.party_id);
  new.political_name:=new.identity_snapshot->>'name';
  new.identity_snapshot:=jsonb_set(new.identity_snapshot,'{avatar_url}',to_jsonb(coalesce(new.campaign_photo_url,new.identity_snapshot->>'avatar_url','')));
  new.campaign_photo_url:=new.identity_snapshot->>'avatar_url';
  new.party_snapshot:=new.identity_snapshot->'party';
  if new.vice_candidate_id is not null then new.vice_identity_snapshot:=private.electoral_identity(new.vice_candidate_id,null,true); end if;
 else
  if new.political_name is distinct from old.political_name or new.identity_snapshot is distinct from old.identity_snapshot or new.vice_identity_snapshot is distinct from old.vice_identity_snapshot then raise exception 'A identidade eleitoral vem do cidadão e não pode ser personalizada.'; end if;
 end if;
 return new;
end $$;
revoke all on function private.freeze_electoral_identity() from public,anon,authenticated;
-- Historical names are preserved. Where no old party snapshot exists, explicitly
-- identify the legacy reconstruction rather than inventing past affiliations.
update public.candidates c set identity_snapshot=coalesce(private.electoral_identity(c.user_id,c.party_id),'{}')||jsonb_build_object('name',c.political_name,'avatar_url',coalesce(c.campaign_photo_url,(select avatar_url from public.profiles where id=c.user_id)),'party',coalesce(c.party_snapshot,private.electoral_identity(c.user_id,c.party_id)->'party'),'legacy_reconstructed',true),vice_identity_snapshot=case when c.vice_candidate_id is not null then private.electoral_identity(c.vice_candidate_id,null,false)||jsonb_build_object('legacy_reconstructed',true,'historical_party_unknown',true) end;
create trigger freeze_electoral_identity before insert or update on public.candidates for each row execute function private.freeze_electoral_identity();
CREATE OR REPLACE FUNCTION public.get_election_results(p_election_id uuid)
 RETURNS TABLE(candidate_id uuid, political_name text, campaign_photo_url text, party_name text, party_logo_url text, vote_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    candidate.id,
    candidate.political_name,
    coalesce(candidate.identity_snapshot->>'avatar_url',candidate.campaign_photo_url),
    coalesce(candidate.identity_snapshot->'party'->>'name',party.name),
    coalesce(candidate.identity_snapshot->'party'->>'logo_url',party.logo_url),
    count(vote.id) filter (where vote.is_valid)
  from public.candidates candidate
  left join public.votes vote
    on vote.candidate_id = candidate.id
   and vote.election_id = candidate.election_id
   and vote.is_valid
  left join public.political_parties party on party.id = candidate.party_id
  where candidate.election_id = p_election_id
    and candidate.status = 'Approved'
  group by candidate.id, party.name, party.logo_url
  order by count(vote.id) filter (where vote.is_valid) desc, candidate.created_at, candidate.id;
$function$;
create function public.get_electoral_candidate_identities(p_election_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'identity',c.identity_snapshot,'vice',c.vice_identity_snapshot,'electoral_number',c.electoral_number,'status',c.status)),'[]') from public.candidates c join public.elections e on e.id=c.election_id where e.id=p_election_id and c.status='Approved';
$$;
revoke all on function public.get_electoral_candidate_identities(uuid) from public;
grant execute on function public.get_electoral_candidate_identities(uuid) to anon,authenticated;
create or replace function private.notify_electoral_result() returns trigger language plpgsql security definer set search_path='' as $$
declare e public.elections%rowtype; winners jsonb;
begin
 select * into e from public.elections where id=new.election_id;
 select coalesce(jsonb_agg(coalesce(case when w->>'office_role'='Vice-Presidente' then c.vice_identity_snapshot else c.identity_snapshot end,'{}')||jsonb_build_object('office_role',w->>'office_role','votes',w->'votes','electoral_number',c.electoral_number,'percentage',case when new.total_valid_votes>0 then round((w->>'votes')::numeric/new.total_valid_votes*100,2) else 0 end)),'[]') into winners
 from jsonb_array_elements(new.result) w join public.candidates c on c.id=(w->>'candidate_id')::uuid;
 insert into public.notifications(user_id,type,content,link,metadata)
 select id,'election_result_published','Resultado publicado: '||e.name||'. Conheça a apuração no Portal Eleitoral.','/services/elections',jsonb_build_object('event_key','election_result_published:'||new.election_id,'election_id',new.election_id,'election_name',e.name,'status',new.status,'winners',winners,'finished_at',e.voting_end_date,'popup_pending',true)
 from public.profiles where deleted_at is null and (onboarding_completed or onboarding_mode='legacy_migration') on conflict do nothing;
 return new;
end $$;
CREATE OR REPLACE FUNCTION public.finalize_bill_voting(p_voting_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare house uuid;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 select house_id into house from public.parliament_votings where id=p_voting_id;
 if not coalesce(public.is_parliament_governance_manager(auth.uid(),house),false) and not exists(select 1 from public.parliament_members where user_id=auth.uid() and house_id=house and term_start_date<=current_date and term_end_date>=current_date) then raise exception 'PARLIAMENT_MEMBER_REQUIRED'; end if;
 return private.finalize_bill_voting(p_voting_id);
end $function$;

CREATE OR REPLACE FUNCTION private.finalize_bill_voting(p_voting_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.parliament_votings%rowtype; bill public.bills%rowtype; seats integer; voted integer; yes integer; no integer; approved boolean; other_house uuid; other_result record; next_status text;
begin
 select * into v from public.parliament_votings where id=p_voting_id for update;
 if not found or v.type<>'bill' then raise exception 'Votação legislativa não encontrada.'; end if;
 if v.status='closed' then return jsonb_build_object('finalized',true,'message','Votação já encerrada.'); end if;
 select * into bill from public.bills where id=v.related_id for update;
 if bill.type='IMPEACHMENT' then return private.finalize_impeachment(p_voting_id); end if;
 if lower(coalesce(bill.status,'')) in ('sancionado','promulgado','rejeitado','vetado','arquivado','sustado') then
  update public.parliament_votings set status='closed' where id=v.id;
  return jsonb_build_object('finalized',true,'message','Votação encerrada; decisão institucional preservada.');
 end if;
 select count(*) into seats from public.parliament_members where house_id=v.house_id and id=public.get_active_parliament_member_id(user_id,house_id);
 select count(*),count(*) filter(where vote='Aprovar'),count(*) filter(where vote='Rejeitar') into voted,yes,no from public.parliament_voting_votes where voting_id=v.id;
 if clock_timestamp()<v.end_date and (seats=0 or voted<seats) then return jsonb_build_object('finalized',false); end if;
 approved:=case when bill.type='PEC' then yes>=ceil(greatest(seats,1)*2.0/3.0) else yes>no and yes>0 end;
 next_status:=case when approved and bill.type='PDL' and bill.suspends_decree_id is not null then 'Promulgado' when approved then 'Aguardando sanção presidencial' else 'Rejeitado' end;
 if bill.type='PEC' and approved then
  select pv.id,pv.status,pv.house_id,count(pvv.*) filter(where pvv.vote='Aprovar') approvals,
   (select greatest(count(*),1) from public.parliament_members where house_id=pv.house_id and term_start_date<=current_date and term_end_date>=current_date) seats
  into other_result from public.parliament_votings pv left join public.parliament_voting_votes pvv on pvv.voting_id=pv.id
  where pv.related_id=bill.id and pv.type='bill' and pv.house_id<>v.house_id group by pv.id order by pv.created_at desc limit 1;
  if found and other_result.status='closed' then next_status:=case when other_result.approvals>=ceil(other_result.seats*2.0/3.0) then 'Aguardando promulgação presidencial' else 'Rejeitado' end;
  else
   next_status:='Em votação (2ª Casa)';
   if other_result.id is null then
    select id into other_house from public.parliament_houses where id<>v.house_id order by case when id in ('a1b2c3d4-e5f6-7890-1234-567890abcdef','fedcba09-8765-4321-0987-654321fedcba') then 0 else 1 end,id limit 1;
    if other_house is null then raise exception 'A proposta constitucional exige duas Casas legislativas.'; end if;
    insert into public.parliament_votings(house_id,type,related_id,title,description,status,end_date) values(other_house,'bill',bill.id,'[2ª Casa] '||bill.title,'Votação constitucional na segunda Casa. Exige aprovação de dois terços.','active',clock_timestamp()+interval '24 hours');
   end if;
  end if;
 end if;
 update public.bills set status=next_status,updated_at=clock_timestamp() where id=bill.id;
 update public.parliament_votings set status='closed' where id=v.id;
 insert into public.notifications(user_id,type,content,link,metadata)
 select m.user_id,'parliament_voting_result',
 case when vote.vote='Abster' then 'Votação encerrada: o projeto "'||bill.title||'", no qual você registrou abstenção, foi '
 when (vote.vote='Aprovar' and approved) or (vote.vote='Rejeitar' and not approved) then 'Boa notícia! O projeto "'||bill.title||'", em que você votou '||case vote.vote when 'Aprovar' then 'a favor' else 'contra' end||', foi '
 else 'Resultado da votação: o projeto "'||bill.title||'", em que você votou '||case vote.vote when 'Aprovar' then 'a favor' else 'contra' end||', foi ' end
 ||case when approved then 'aprovado' else 'rejeitado' end||' pela sua Casa Legislativa.',
 '/services/parliament',jsonb_build_object('voting_id',v.id,'bill_id',bill.id,'vote',vote.vote,'approved',approved,'tone',case when vote.vote='Abster' then 'neutral' when (vote.vote='Aprovar')=approved then 'positive' else 'institutional' end)
 from public.parliament_voting_votes vote join public.parliament_members m on m.id=vote.member_id where vote.voting_id=v.id
 and not exists(select 1 from public.notifications n where n.user_id=m.user_id and n.type='parliament_voting_result' and n.metadata->>'voting_id'=v.id::text);
 return jsonb_build_object('finalized',true,'approved',approved,'message','Votação encerrada. '||next_status||'.');
end $function$;
alter table public.elections add column archived_at timestamptz;
create function public.admin_delete_election(p_election_id uuid,p_confirm_history boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.elections%rowtype; has_history boolean;
begin
 if not coalesce(public.is_admin(auth.uid()),false) then raise exception 'Somente Admin pode excluir eleições.' using errcode='42501'; end if;
 select * into e from public.elections where id=p_election_id for update;
 if not found then return jsonb_build_object('success',true); end if;
 has_history:=exists(select 1 from public.election_audit_log where election_id=e.id) or exists(select 1 from public.election_office_assignments where election_id=e.id) or exists(select 1 from public.candidates where election_id=e.id) or exists(select 1 from public.votes where election_id=e.id) or exists(select 1 from public.election_settlements where election_id=e.id);
 if has_history and not p_confirm_history then raise exception 'Esta eleição possui histórico. Confirme o arquivamento preservando candidaturas, votos, resultados e mandatos.'; end if;
 perform public.justice_write_audit('election.deleted','election',e.id,to_jsonb(e),jsonb_build_object('archived',has_history),'Exclusão administrativa confirmada.');
 if has_history then update public.elections set archived_at=coalesce(archived_at,clock_timestamp()),status=case when exists(select 1 from public.election_settlements where election_id=e.id) then e.status else 'Cancelled' end where id=e.id;
 else delete from public.elections where id=e.id; end if;
 return jsonb_build_object('success',true,'archived',has_history);
end $$;
revoke all on function public.admin_delete_election(uuid,boolean) from public,anon;
grant execute on function public.admin_delete_election(uuid,boolean) to authenticated;
CREATE OR REPLACE FUNCTION public.get_electoral_management()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform private.assert_electoral_management();
 return jsonb_build_object('elections',coalesce((select jsonb_agg(to_jsonb(e)) from(select * from public.elections where archived_at is null order by voting_start_date desc)e),'[]'),
 'candidates',coalesce((select jsonb_agg(to_jsonb(c)) from(select id,election_id,political_name,status,bio,proposals,admin_feedback,user_id,vice_candidate_id,electoral_number,identity_snapshot,vice_identity_snapshot from public.candidates where removed_at is null and election_id in(select id from public.elections where archived_at is null) order by created_at desc)c),'[]'));
end; $function$;
create or replace function public.update_party_details(p_party_id uuid,p_name text,p_acronym text,p_ideology text,p_statute text,p_logo_url text,p_owner_id uuid,p_president_id uuid,p_vice_president_id uuid,p_description text,p_orientation public.political_orientation,p_color text)
returns json language plpgsql security definer set search_path='' as $$ declare r json; begin
 -- Validate and save the color while the caller still owns the party. Any later
 -- failure rolls the complete edit back, including this color and its audit.
 perform public.set_party_color(p_party_id,p_color);
 r:=public.update_party_details(p_party_id,p_name,p_acronym,p_ideology,p_statute,p_logo_url,p_owner_id,p_president_id,p_vice_president_id,p_description,p_orientation);
 if not coalesce((r->>'success')::boolean,false) then raise exception '%',coalesce(r->>'message','Não foi possível atualizar o partido.'); end if;
 return r;
end $$;
revoke all on function public.update_party_details(uuid,text,text,text,text,text,uuid,uuid,uuid,text,public.political_orientation,text) from public,anon;
grant execute on function public.update_party_details(uuid,text,text,text,text,text,uuid,uuid,uuid,text,public.political_orientation,text) to authenticated;
CREATE OR REPLACE FUNCTION public.admin_update_party(p_party_id uuid, p_changes jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result json; party public.political_parties%rowtype;
begin
 if not coalesce(public.get_user_role(auth.uid())='Admin',false) then raise exception 'Somente Admin pode usar esta edição.' using errcode='42501'; end if;
 select * into party from public.political_parties where id=p_party_id for update;
 if not found or party.status='Encerrado' then raise exception 'O partido está encerrado ou indisponível.'; end if;
 if p_changes ? 'color' then perform public.set_party_color(p_party_id,p_changes->>'color'); end if;
 result:=public.update_party_details(p_party_id,p_changes->>'name',p_changes->>'acronym',p_changes->>'ideology',p_changes->>'statute',p_changes->>'logo_url',nullif(p_changes->>'owner_id','')::uuid,nullif(p_changes->>'president_id','')::uuid,nullif(p_changes->>'vice_president_id','')::uuid,p_changes->>'description',(p_changes->>'orientation')::public.political_orientation);
 if not coalesce((result->>'success')::boolean,false) then raise exception '%',coalesce(result->>'message','Não foi possível salvar o partido.'); end if;
 if p_changes->>'affiliation_mode' is distinct from party.affiliation_mode then
  result:=public.toggle_party_affiliation_mode(p_party_id,p_changes->>'affiliation_mode');
  if not coalesce((result->>'success')::boolean,false) then raise exception '%',result->>'message'; end if;
 end if;
end $function$;
create or replace function public.set_party_color(p_party_id uuid,p_color text) returns void language plpgsql security definer set search_path='' as $$
declare p public.political_parties%rowtype;
begin
 select * into p from public.political_parties where id=p_party_id for update;
 if not found or p.status='Encerrado' then raise exception 'Partido encerrado ou indisponível.'; end if;
 if auth.uid() is null or not (coalesce(public.is_admin(auth.uid()) or auth.uid()=p.owner_id or auth.uid()=p.president_id,false)) then raise exception 'Você não pode editar este partido.' using errcode='42501'; end if;
 if p_color is null or p_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Informe uma cor HEX válida.'; end if;
 update public.political_parties set color=upper(p_color) where id=p.id and color is distinct from upper(p_color);
 if p.color is distinct from upper(p_color) then
 insert into public.party_history(party_id,actor_id,event_type,summary,previous_state,current_state) values(p.id,auth.uid(),'color_changed','Cor oficial atualizada.',jsonb_build_object('color',p.color),jsonb_build_object('color',upper(p_color)));
 end if;
end $$;

drop trigger start_presidential_formation on public.profiles;
create trigger start_presidential_formation after update of role,role_assigned_at on public.profiles for each row execute function private.start_presidential_formation();
create or replace view public.elections_with_status with(security_invoker=true) as
select id,name,description,election_type_id,candidacy_start_date,candidacy_end_date,voting_start_date,voting_end_date,created_at,
case when lower(status)='cancelled' then 'Cancelled' when now()>=voting_end_date then 'Finished' when now()>=voting_start_date then 'Voting' when now()>=candidacy_start_date and now()<candidacy_end_date then 'Candidacy' else 'Scheduled' end as status
from public.elections where archived_at is null;

CREATE OR REPLACE FUNCTION public.update_party_customization(p_party_id uuid, p_customization jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare party public.political_parties%rowtype;
begin
  select * into party from public.political_parties where id=p_party_id for update;
  if not found then return json_build_object('success',false,'message','Partido não encontrado.'); end if;
  if auth.uid() is null or not coalesce(auth.uid()=party.owner_id or auth.uid()=party.president_id or public.get_user_role(auth.uid())='Admin',false) then return json_build_object('success',false,'message','Sem permissão para personalizar o partido.'); end if;
  if p_customization is null or jsonb_typeof(p_customization)<>'object' then return json_build_object('success',false,'message','Personalização inválida.'); end if;
  if party.status='Encerrado' then raise exception 'O partido está encerrado.'; end if;
  if p_customization ? 'primary_color' then perform public.set_party_color(p_party_id,p_customization->>'primary_color'); end if;
  update public.political_parties set customization=(p_customization-'primary_color') where id=party.id;
  insert into public.party_history(party_id,actor_id,event_type,summary,current_state) values(party.id,auth.uid(),'customization_updated','Página partidária personalizada.',p_customization);
  return json_build_object('success',true,'message','Página do partido atualizada.');
end; $function$;

-- Publish aggregate results without exposing any secret ballot or voter identity.
create function private.broadcast_electoral_results() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform realtime.send(jsonb_build_object('election_id',case when tg_op='DELETE' then old.election_id else new.election_id end),'election-results-changed','electoral-results',false);
 return null;
end $$;
revoke all on function private.broadcast_electoral_results() from public,anon,authenticated;
create trigger electoral_results_changed after insert or update or delete on public.votes for each row execute function private.broadcast_electoral_results();

create policy voter_can_read_own_ballot on public.votes for select to authenticated using (voter_id=(select auth.uid()));
notify pgrst,'reload schema';
commit;
