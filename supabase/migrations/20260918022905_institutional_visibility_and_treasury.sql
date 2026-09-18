begin;

CREATE OR REPLACE FUNCTION private.is_executive_candidate(p_user_id uuid, p_office_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.profiles p where p.id=p_user_id and p.deleted_at is null and (p.onboarding_completed or p.onboarding_mode='legacy_migration')
  and p.role not in('Admin','Presidente','Vice-Presidente')
  and not exists(select 1 from public.system_settings s cross join lateral jsonb_each(coalesce(s.value->'specialAppointments','{}')) a
    where s.key='executive_governance' and a.key<>p_office_key and a.value->>'user_id'=p.id::text)
  and not exists(select 1 from public.ministers m where m.user_id=p.id and m.status='active'));
$function$;



CREATE OR REPLACE FUNCTION public.manage_executive_appointment(p_office_key text, p_user_id uuid DEFAULT NULL::uuid, p_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cfg jsonb; office public.executive_office_definitions%rowtype; previous jsonb; target public.profiles%rowtype; entry jsonb; event_id uuid:=gen_random_uuid();
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role in('Presidente','Admin')) then raise exception 'A nomeação exige autoridade presidencial.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtext('govrp:executive:appointments'));
 select * into office from public.executive_office_definitions where office_key=p_office_key;
 if not found then raise exception 'Escolha um cargo executivo válido.'; end if;
 select coalesce(value,'{}') into cfg from public.system_settings where key='executive_governance' for update;
 cfg:=coalesce(cfg,'{}');previous:=cfg->'specialAppointments'->p_office_key;
 if p_user_id is not null then
   select * into target from public.profiles where id=p_user_id and (onboarding_completed or onboarding_mode='legacy_migration') and deleted_at is null for update;
   if not found or not private.is_executive_candidate(p_user_id,p_office_key) then raise exception 'Escolha um cidadão elegível para a nomeação.'; end if;
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
end; $function$;



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

  if v_voter_member_id is null and not coalesce(public.get_user_role(v_user_id)='Admin',false) then
    raise exception 'Apenas parlamentares ativos da Casa podem registrar candidaturas.';
  end if;

  if not coalesce(public.get_user_role(v_user_id)='Admin',false) and p_member_id is distinct from v_voter_member_id then
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



CREATE OR REPLACE FUNCTION public.close_leadership_election(p_election_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare house uuid;
begin
 select house_id into house from public.parliament_leadership_elections where id=p_election_id;
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='Admin' and deleted_at is null) then raise exception 'Somente Admin pode encerrar manualmente esta eleição.' using errcode='42501'; end if;
 perform public.justice_write_audit('parliament.election_manual_close','parliament_leadership_election',p_election_id,null,null,'Apuração manual pelo Admin');
 return private.conclude_leadership_election(p_election_id);
end; $function$;



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

  if clock_timestamp()<v_election.nomination_end_at then raise exception 'O período de candidaturas ainda está aberto.'; end if;

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



-- A timestamptz default must preserve its instant regardless of the connection timezone.
alter table public.posts alter column created_at set default now();
alter table public.profiles alter column created_at set default now(), alter column updated_at set default now();
alter table public.transactions alter column created_at set default now();
alter table public.accounts alter column created_at set default now(), alter column updated_at set default now();
alter table public.products alter column created_at set default now();
-- Keep the RPC shape for older clients. day_open_rate is now the persisted 24h baseline.
create or replace function public.get_rp_exchange_quotes(p_country_code text default 'BR')
returns table(currency_code text,brl_per_unit numeric,day_open_rate numeric,change_percent numeric,rp_day date,updated_at timestamptz)
language sql stable security definer set search_path='' as $$
 select r.currency_code,r.brl_per_unit,h.brl_per_unit,
 case when h.brl_per_unit>0 then round((r.brl_per_unit/h.brl_per_unit-1)*100,6) end,
 (public.rp_now() at time zone 'UTC')::date,r.updated_at
 from public.country_rp_exchange_rates r left join lateral (
  select history.brl_per_unit from public.country_rp_exchange_history history
  where history.country_code=r.country_code and history.currency_code=r.currency_code
  and history.recorded_at<=now()-interval '24 hours'
  order by history.recorded_at desc,history.id desc limit 1
 ) h on true
 where r.country_code=case when exists(select 1 from public.country_rp_exchange_rates where country_code=upper(p_country_code)) then upper(p_country_code) else 'BR' end;
$$;
create index if not exists exchange_history_real_time_baseline on public.country_rp_exchange_history(country_code,currency_code,recorded_at desc);

-- Party funds have their own owner; no personal or synthetic citizen account is used.
create table public.party_treasuries (
 party_id uuid primary key references public.political_parties(id) on delete restrict,
 balance numeric(18,2) not null default 0 check(balance>=0),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.party_treasury_entries (
 id uuid primary key default gen_random_uuid(),
 party_id uuid not null references public.party_treasuries(party_id) on delete restrict,
 transaction_id uuid not null unique references public.transactions(id) on delete restrict,
 actor_id uuid references public.profiles(id) on delete set null,
 kind text not null check(kind in ('donation')),
 amount numeric(18,2) not null check(amount>0),
 balance_after numeric(18,2) not null check(balance_after>=0),
 description text not null,
 donor_snapshot jsonb not null,
 idempotency_key uuid not null unique,
 created_at timestamptz not null default now()
);
create index party_treasury_entries_party_time on public.party_treasury_entries(party_id,created_at desc,id);
create index party_treasury_entries_actor on public.party_treasury_entries(actor_id);
alter table public.party_treasuries enable row level security;
alter table public.party_treasury_entries enable row level security;
create policy party_treasury_transparency on public.party_treasuries for select to anon,authenticated using(true);
create policy party_treasury_entry_transparency on public.party_treasury_entries for select to anon,authenticated using(true);
revoke all on public.party_treasuries,public.party_treasury_entries from anon,authenticated;
grant select on public.party_treasuries,public.party_treasury_entries to anon,authenticated;
grant all on public.party_treasuries,public.party_treasury_entries to service_role;
insert into public.party_treasuries(party_id) select id from public.political_parties;
create function private.initialize_party_treasury() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.party_treasuries(party_id) values(new.id) on conflict do nothing; return new; end $$;
revoke all on function private.initialize_party_treasury() from public,anon,authenticated;
create trigger initialize_party_treasury after insert on public.political_parties for each row execute function private.initialize_party_treasury();

create function public.donate_to_party(p_party_id uuid,p_amount numeric,p_idempotency_key uuid)
returns public.party_treasury_entries language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); donor public.profiles%rowtype; party public.political_parties%rowtype;
 account public.accounts%rowtype; ledger public.party_treasury_entries%rowtype; tx uuid; balance_after numeric;
begin
 if actor is null then raise exception 'Entre na sua conta para doar.' using errcode='42501'; end if;
 if p_idempotency_key is null or p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<=0 or p_amount<>round(p_amount,2) or p_amount>100000000 then raise exception 'Informe um valor válido, maior que zero e com até duas casas decimais.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('party-donation:'||p_idempotency_key::text,0));
 select * into ledger from public.party_treasury_entries where idempotency_key=p_idempotency_key;
 if found then
  if ledger.actor_id=actor and ledger.party_id=p_party_id and ledger.amount=p_amount then return ledger; end if;
  raise exception 'Esta identificação já pertence a outra doação.';
 end if;
 select * into donor from public.profiles where id=actor and deleted_at is null;
 if not found then raise exception 'Cidadão indisponível.'; end if;
 select * into party from public.political_parties where id=p_party_id for update;
 if not found or party.status='Encerrado' then raise exception 'Este partido não está recebendo doações.'; end if;
 select * into account from public.accounts where user_id=actor for update;
 if not found then raise exception 'Você precisa de uma conta bancária para doar.'; end if;
 if account.balance<p_amount then raise exception 'Seu saldo é insuficiente para esta doação.'; end if;
 update public.accounts set balance=balance-p_amount,updated_at=clock_timestamp() where id=account.id;
 insert into public.party_treasuries(party_id) values(p_party_id) on conflict do nothing;
 update public.party_treasuries set balance=balance+p_amount,updated_at=clock_timestamp() where party_id=p_party_id returning balance into balance_after;
 insert into public.transactions(from_account_id,amount,type,description,idempotency_key,status,currency,metadata)
 values(account.id,p_amount,'party_donation','Doação para '||party.name||' ('||party.acronym||')',p_idempotency_key,'completed','BRL',
 jsonb_build_object('party_id',p_party_id,'recipient_name',party.name,'recipient_type','political_party','party_snapshot',jsonb_build_object('name',party.name,'acronym',party.acronym,'logo_url',party.logo_url),'gross_amount',p_amount,'net_amount',p_amount,'total_debited',p_amount,'tax_amount',0,'buyer_tax',0,'seller_tax',0,'levies','[]'::jsonb)) returning id into tx;
 insert into public.party_treasury_entries(party_id,transaction_id,actor_id,kind,amount,balance_after,description,donor_snapshot,idempotency_key)
 values(p_party_id,tx,actor,'donation',p_amount,balance_after,'Doação de cidadão',jsonb_build_object('full_name',donor.full_name,'avatar_url',donor.avatar_url,'username',donor.username),p_idempotency_key) returning * into ledger;
 insert into public.party_history(party_id,actor_id,event_type,summary,previous_state)
 values(p_party_id,actor,'donation','Doação recebida no caixa partidário.',jsonb_build_object('ledger_id',ledger.id,'transaction_id',tx,'amount',p_amount));
 insert into public.notifications(user_id,type,content,link,metadata)
 select distinct recipient,'party_donation_received','O partido recebeu uma doação de R$ '||to_char(p_amount,'FM999999990.00')||'.','/services/political-parties/'||p_party_id,jsonb_build_object('party_id',p_party_id,'entry_id',ledger.id)
 from unnest(array[party.owner_id,party.president_id,party.vice_president_id]) recipient where recipient is not null;
 return ledger;
end $$;
revoke all on function public.donate_to_party(uuid,numeric,uuid) from public,anon;
grant execute on function public.donate_to_party(uuid,numeric,uuid) to authenticated;
alter publication supabase_realtime add table public.party_treasuries,public.party_treasury_entries;
CREATE OR REPLACE FUNCTION public.search_executive_candidates(p_office_key text, p_query text DEFAULT ''::text, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role in('Admin','Presidente') and deleted_at is null) then raise exception 'A consulta exige autoridade presidencial.' using errcode='42501'; end if;
 if p_office_key is null or (p_office_key<>'minister' and not exists(select 1 from public.executive_office_definitions where office_key=p_office_key)) then raise exception 'Selecione um cargo válido.'; end if;
 if p_offset is null or p_offset<0 or p_offset>1000000 then raise exception 'Página inválida.'; end if;
 select coalesce(jsonb_agg(to_jsonb(c)), '[]') into result from (
  select p.id,p.full_name,p.username,p.avatar_url,p.role,count(*) over() as total_count from public.profiles p
  where private.is_executive_candidate(p.id,p_office_key)
   and (coalesce(btrim(p_query),'')='' or position(lower(btrim(p_query)) in lower(coalesce(p.full_name,'')||' '||coalesce(p.username,'')))>0)
  order by p.full_name,p.id limit 51 offset p_offset
 ) c;
 return jsonb_build_object('candidates',case when jsonb_array_length(result)>50 then result-50 else result end,'has_more',jsonb_array_length(result)>50);
end; $function$;

notify pgrst,'reload schema';
commit;
