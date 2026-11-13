begin;

-- A assinatura antiga com quatro argumentos conflita com a versão ampliada
-- que possui defaults; removê-la mantém chamadas antigas funcionando na RPC nova.
drop function if exists public.get_admin_transaction_history(integer,integer,text,text);

-- Matriz mínima: tudo que está no schema público deve ter RLS explícito.
alter table public.armed_forces_enlistment enable row level security;
alter table public.armed_forces_reports enable row level security;
alter table public.bills_of_exchange enable row level security;
alter table public.parliament_voting_votes enable row level security;
alter table public.parliament_votings enable row level security;
alter table public.prison_appeals enable row level security;
alter table public.prison_hearings enable row level security;
alter table public.stories enable row level security;

drop policy if exists "armed_enlistment_read" on public.armed_forces_enlistment;
create policy "armed_enlistment_read"
on public.armed_forces_enlistment for select to authenticated
using (
  user_id=(select auth.uid())
  or public.get_user_role((select auth.uid())) in ('Admin','Forças Armadas','Militar','Comandante das Forças Armadas')
);

drop policy if exists "armed_enlistment_request" on public.armed_forces_enlistment;
create policy "armed_enlistment_request"
on public.armed_forces_enlistment for insert to authenticated
with check (
  user_id=(select auth.uid())
  and status='Alistado'
  and certificate_url is null
);

drop policy if exists "armed_reports_read" on public.armed_forces_reports;
create policy "armed_reports_read"
on public.armed_forces_reports for select to authenticated
using (
  reporter_id=(select auth.uid())
  or public.get_user_role((select auth.uid())) in ('Admin','Forças Armadas','Militar','Comandante das Forças Armadas')
);

drop policy if exists "armed_reports_create" on public.armed_forces_reports;
create policy "armed_reports_create"
on public.armed_forces_reports for insert to authenticated
with check (
  (coalesce(is_anonymous,false) and reporter_id is null)
  or (not coalesce(is_anonymous,false) and reporter_id=(select auth.uid()))
);

drop policy if exists "Enable read access for all users" on public.bills_of_exchange;
drop policy if exists "bills_of_exchange_read_participants" on public.bills_of_exchange;
create policy "bills_of_exchange_read_participants"
on public.bills_of_exchange for select to authenticated
using (
  issuer_id=(select auth.uid())
  or payer_id=(select auth.uid())
  or public.user_can_manage_national_bank((select auth.uid()))
);

drop policy if exists "parliament_votings_public_read" on public.parliament_votings;
create policy "parliament_votings_public_read"
on public.parliament_votings for select to anon,authenticated
using (true);

drop policy if exists "parliament_votes_public_read" on public.parliament_voting_votes;
create policy "parliament_votes_public_read"
on public.parliament_voting_votes for select to anon,authenticated
using (true);

drop policy if exists "prison_appeals_read" on public.prison_appeals;
create policy "prison_appeals_read"
on public.prison_appeals for select to authenticated
using (
  user_id=(select auth.uid())
  or public.justice_has_role(array['Admin','Juiz','Advogado','Defensor Público','Promotor','Agente Penitenciário','Diretor Penitenciário'])
);

drop policy if exists "prison_hearings_read" on public.prison_hearings;
create policy "prison_hearings_read"
on public.prison_hearings for select to authenticated
using (
  user_id=(select auth.uid())
  or public.justice_has_role(array['Admin','Juiz','Advogado','Defensor Público','Promotor','Agente Penitenciário','Diretor Penitenciário'])
);

drop policy if exists "stories_public_read" on public.stories;
create policy "stories_public_read"
on public.stories for select to anon,authenticated
using (true);

drop policy if exists "stories_create_own" on public.stories;
create policy "stories_create_own"
on public.stories for insert to authenticated
with check (user_id=(select auth.uid()));

-- Escritas de alto impacto ficam somente nas funções autoritativas.
revoke all on public.armed_forces_enlistment,public.armed_forces_reports from anon;
revoke update,delete on public.armed_forces_enlistment,public.armed_forces_reports from authenticated;
grant select,insert on public.armed_forces_enlistment,public.armed_forces_reports to authenticated;

revoke all on public.bills_of_exchange from anon,authenticated;
grant select on public.bills_of_exchange to authenticated;

revoke insert,update,delete on public.parliament_votings,public.parliament_voting_votes from anon,authenticated;
grant select on public.parliament_votings,public.parliament_voting_votes to anon,authenticated;

revoke all on public.prison_appeals,public.prison_hearings from anon,authenticated;
grant select on public.prison_appeals,public.prison_hearings to authenticated;

revoke insert,update,delete on public.stories from anon,authenticated;
grant select on public.stories to anon,authenticated;
grant insert on public.stories to authenticated;

-- Empresas só podem nascer pela cobrança e registro autoritativos. O dono ainda
-- pode administrar a oferta de venda da empresa já criada.
drop policy if exists "businesses_insert_own" on public.businesses;
revoke insert,delete on public.businesses from anon,authenticated;

-- Cartões e solicitações podem ser lidos, mas decisões/limites passam por RPC.
drop policy if exists "Users can manage their own cards." on public.cards;
drop policy if exists "National bank managers can update cards" on public.cards;
drop policy if exists "Users can manage their own loan applications" on public.loan_applications;
drop policy if exists "loan_applications_update_own_or_bank" on public.loan_applications;
revoke insert,update,delete on public.cards from anon,authenticated;
revoke update,delete on public.loan_applications from anon,authenticated;
grant select,update on public.cards to authenticated;
grant select,insert,update on public.loan_applications to authenticated;

drop policy if exists "National bank managers can update credit applications" on public.credit_card_applications;
drop policy if exists "credit_card_applications_update_bank" on public.credit_card_applications;
drop policy if exists "National bank managers can read credit applications" on public.credit_card_applications;
drop policy if exists "credit_card_applications_select_own_or_bank" on public.credit_card_applications;
create policy "credit_card_applications_select_own_or_bank"
on public.credit_card_applications for select to authenticated
using (user_id=(select auth.uid()) or public.user_can_manage_national_bank((select auth.uid())));
drop policy if exists "credit_card_applications_insert_own" on public.credit_card_applications;
create policy "credit_card_applications_insert_own"
on public.credit_card_applications for insert to authenticated
with check (user_id=(select auth.uid()) and status='Pendente');
revoke update,delete on public.credit_card_applications from anon,authenticated;
grant select,insert,update on public.credit_card_applications to authenticated;

drop policy if exists "loan_applications_select_own_or_bank" on public.loan_applications;
create policy "loan_applications_select_own_or_bank"
on public.loan_applications for select to authenticated
using (user_id=(select auth.uid()) or public.user_can_manage_national_bank((select auth.uid())));
drop policy if exists "loan_applications_insert_own" on public.loan_applications;
create policy "loan_applications_insert_own"
on public.loan_applications for insert to authenticated
with check (user_id=(select auth.uid()) and status in ('Pendente','pending'));

-- O Realtime do Supabase avalia também a policy do evento UPDATE. A policy
-- autoriza a entrega do evento; o gatilho abaixo continua bloqueando UPDATE
-- vindo diretamente de clientes e deixa passar somente RPC/serviço.
create or replace function public.block_direct_authoritative_bank_update()
returns trigger language plpgsql set search_path='' as $$
begin
  if current_user in ('anon','authenticated') then
    raise exception 'DIRECT_BANK_UPDATE_FORBIDDEN' using errcode='42501';
  end if;
  return new;
end;
$$;

drop policy if exists "credit_card_applications_realtime_update" on public.credit_card_applications;
create policy "credit_card_applications_realtime_update"
on public.credit_card_applications for update to authenticated
using (user_id=(select auth.uid()) or public.user_can_manage_national_bank((select auth.uid())))
with check (user_id=(select auth.uid()) or public.user_can_manage_national_bank((select auth.uid())));

drop policy if exists "loan_applications_realtime_update" on public.loan_applications;
create policy "loan_applications_realtime_update"
on public.loan_applications for update to authenticated
using (user_id=(select auth.uid()) or public.user_can_manage_national_bank((select auth.uid())))
with check (user_id=(select auth.uid()) or public.user_can_manage_national_bank((select auth.uid())));

drop policy if exists "cards_realtime_update" on public.cards;
create policy "cards_realtime_update"
on public.cards for update to authenticated
using (user_id=(select auth.uid()) or public.user_can_manage_national_bank((select auth.uid())))
with check (user_id=(select auth.uid()) or public.user_can_manage_national_bank((select auth.uid())));

drop trigger if exists credit_card_applications_direct_update_guard on public.credit_card_applications;
create trigger credit_card_applications_direct_update_guard before update on public.credit_card_applications
for each row execute function public.block_direct_authoritative_bank_update();
drop trigger if exists loan_applications_direct_update_guard on public.loan_applications;
create trigger loan_applications_direct_update_guard before update on public.loan_applications
for each row execute function public.block_direct_authoritative_bank_update();
drop trigger if exists cards_direct_update_guard on public.cards;
create trigger cards_direct_update_guard before update on public.cards
for each row execute function public.block_direct_authoritative_bank_update();

-- Projetos são propostos e tramitam pelas RPCs; nem autor nem Admin podem
-- forçar status diretamente pelo cliente.
drop policy if exists "Author or admin can update bill" on public.bills;
drop policy if exists "Users can insert their own bills" on public.bills;
drop policy if exists "Parliament members can create bills" on public.bills;
revoke insert,update,delete on public.bills from anon,authenticated;

drop policy if exists "Members can cast votes on bills in their house" on public.bill_votes;
revoke insert,update,delete on public.bill_votes from anon,authenticated;

drop policy if exists "Users can request loans." on public.loans;
revoke insert,update,delete on public.loans from anon,authenticated;

drop policy if exists "Users can create occurrences" on public.police_occurrences;
drop policy if exists "Police and Admins can manage all occurrences" on public.police_occurrences;
revoke insert,update,delete on public.police_occurrences from anon,authenticated;

-- Leituras mais frequentes usam uma única policy e auth.uid() como init plan.
drop policy if exists "National bank managers can read accounts" on public.accounts;
drop policy if exists "Users can view their own accounts." on public.accounts;
create policy "accounts_owner_or_bank_read" on public.accounts for select to authenticated
using (user_id=(select auth.uid()) or public.user_can_manage_national_bank((select auth.uid())));
revoke select on public.accounts from anon;
grant select on public.accounts to authenticated;

drop policy if exists "National bank managers can read cards" on public.cards;
drop policy if exists "Users can view their own cards." on public.cards;
create policy "cards_owner_or_bank_read" on public.cards for select to authenticated
using (user_id=(select auth.uid()) or public.user_can_manage_national_bank((select auth.uid())));

drop policy if exists "Users can view their own transactions." on public.transactions;
create policy "transactions_participant_read" on public.transactions for select to authenticated
using (
  exists(select 1 from public.accounts a where a.id=from_account_id and a.user_id=(select auth.uid()))
  or exists(select 1 from public.accounts a where a.id=to_account_id and a.user_id=(select auth.uid()))
);

drop policy if exists "businesses_select_own" on public.businesses;
create policy "businesses_select_own" on public.businesses for select to authenticated
using (
  owner_id=(select auth.uid())
  or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='Admin')
);
drop policy if exists "businesses_update_own" on public.businesses;
create policy "businesses_update_own" on public.businesses for update to authenticated
using (
  owner_id=(select auth.uid())
  or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='Admin')
)
with check (
  owner_id=(select auth.uid())
  or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='Admin')
);

drop policy if exists "Users can delete their own products." on public.products;
create policy "products_delete_own" on public.products for delete to authenticated
using (seller_id=(select auth.uid()));

-- Candidaturas pendentes não são públicas e nenhum perfil escreve direto.
drop policy if exists "Admins can manage all candidacies" on public.candidates;
drop policy if exists "Public can view candidates" on public.candidates;
drop policy if exists candidates_owner_read on public.candidates;
create policy "candidates_public_approved" on public.candidates for select to anon
using (status='Approved');
create policy "candidates_authenticated_read" on public.candidates for select to authenticated
using (
  status='Approved' or user_id=(select auth.uid()) or vice_candidate_id=(select auth.uid())
  or public.is_admin((select auth.uid()))
);
revoke insert,update,delete on public.candidates from anon,authenticated;

-- A visão respeita as políticas da tabela-base em vez dos privilégios do dono.
drop view if exists public.elections_with_status;
create view public.elections_with_status
with (security_invoker=true)
as
select
  id,name,description,election_type_id,candidacy_start_date,candidacy_end_date,
  voting_start_date,voting_end_date,created_at,
  case
    when now()>voting_end_date then 'Finished'::text
    when now()>=voting_start_date and now()<=voting_end_date then 'Voting'::text
    when now()>=candidacy_start_date and now()<=candidacy_end_date then 'Candidacy'::text
    else 'Scheduled'::text
  end as status
from public.elections;
grant select on public.elections_with_status to anon,authenticated,service_role;

-- Inicia votação legislativa sem aceitar Casa, status ou prazo manipulados.
create or replace function public.start_parliament_bill_voting(
  p_bill_id uuid,
  p_house_id uuid,
  p_title text,
  p_description text default null
)
returns public.parliament_votings
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());
  v_bill public.bills%rowtype;
  v_voting public.parliament_votings%rowtype;
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  select * into v_bill from public.bills where id=p_bill_id for update;
  if not found then raise exception 'BILL_NOT_FOUND'; end if;
  if not public.is_parliament_governance_manager(v_actor,p_house_id)
     and not (
       v_bill.type='PEC'
       and p_house_id<>v_bill.house_id
       and exists(
         select 1 from public.parliament_members
         where user_id=v_actor and house_id=v_bill.house_id
           and term_start_date<=current_date and term_end_date>=current_date
       )
       and exists(
         select 1 from public.parliament_votings
         where related_id=p_bill_id and house_id=v_bill.house_id
           and type='bill' and status='closed'
       )
     ) then
    raise exception 'PARLIAMENT_MANAGER_REQUIRED' using errcode='42501';
  end if;
  if v_bill.house_id<>p_house_id and v_bill.type not in ('PEC','Proposta de Emenda Constitucional') then
    raise exception 'BILL_HOUSE_MISMATCH';
  end if;
  if v_bill.status in ('Sancionado','Promulgado','Vetado integralmente','Vetado parcialmente','Rejeitado') then
    raise exception 'BILL_ALREADY_DECIDED';
  end if;

  select * into v_voting
  from public.parliament_votings
  where related_id=p_bill_id and house_id=p_house_id and type='bill' and status='active'
  order by created_at desc limit 1;
  if found then return v_voting; end if;

  insert into public.parliament_votings(
    house_id,title,description,type,related_id,status,end_date
  ) values(
    p_house_id,
    left(coalesce(nullif(btrim(p_title),''),v_bill.title),180),
    nullif(btrim(coalesce(p_description,'')),''),
    'bill',p_bill_id,'active',clock_timestamp()+interval '24 hours'
  ) returning * into v_voting;

  update public.bills set
    status=case when p_house_id=v_bill.house_id then 'Em votação' else 'Em votação (2ª Casa)' end,
    updated_at=clock_timestamp()
  where id=p_bill_id;

  insert into public.domain_events(
    event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key,status,processed_at
  ) values(
    'parliament_voting_started','government','parliament_votings',v_voting.id,v_actor,
    jsonb_build_object('bill_id',p_bill_id,'house_id',p_house_id,'end_date',v_voting.end_date),
    'parliament-voting-started:'||v_voting.id,'processed',clock_timestamp()
  ) on conflict(idempotency_key) do nothing;

  return v_voting;
end;
$$;

-- O membro vem da sessão, pertence à Casa da votação e o prazo é observado.
create or replace function public.cast_parliament_vote(p_voting_id uuid,p_member_id uuid,p_vote text)
returns json
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());
  v_voting public.parliament_votings%rowtype;
  v_member public.parliament_members%rowtype;
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  if p_vote not in ('Aprovar','Rejeitar','Abster') then raise exception 'INVALID_VOTE'; end if;

  select * into v_voting from public.parliament_votings where id=p_voting_id for update;
  if not found then raise exception 'VOTING_NOT_FOUND'; end if;
  if v_voting.status<>'active' or clock_timestamp()>v_voting.end_date then
    raise exception 'VOTING_NOT_OPEN';
  end if;

  select * into v_member from public.parliament_members
  where id=p_member_id and user_id=v_actor and house_id=v_voting.house_id
    and term_start_date<=current_date and term_end_date>=current_date;
  if not found then raise exception 'ACTIVE_HOUSE_MEMBER_REQUIRED' using errcode='42501'; end if;

  insert into public.parliament_voting_votes(voting_id,member_id,vote)
  values(p_voting_id,v_member.id,p_vote);

  return json_build_object('success',true,'message','Seu voto foi computado com sucesso!');
exception
  when unique_violation then
    raise exception 'PARLIAMENT_VOTE_ALREADY_CAST';
end;
$$;

create or replace function public.close_parliament_voting(p_voting_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());
  v_voting public.parliament_votings%rowtype;
  v_members integer;
  v_votes integer;
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  select * into v_voting from public.parliament_votings where id=p_voting_id for update;
  if not found then raise exception 'VOTING_NOT_FOUND'; end if;
  if v_voting.status='closed' then return; end if;

  if not public.is_parliament_governance_manager(v_actor,v_voting.house_id)
     and not exists(
       select 1 from public.parliament_members
       where user_id=v_actor and house_id=v_voting.house_id
         and term_start_date<=current_date and term_end_date>=current_date
     ) then raise exception 'PARLIAMENT_MEMBER_REQUIRED' using errcode='42501'; end if;

  select count(*) into v_members from public.parliament_members
  where house_id=v_voting.house_id and term_start_date<=current_date and term_end_date>=current_date;
  select count(*) into v_votes from public.parliament_voting_votes where voting_id=p_voting_id;
  if clock_timestamp()<v_voting.end_date and (v_members=0 or v_votes<v_members) then
    raise exception 'VOTING_NOT_READY_TO_CLOSE';
  end if;

  update public.parliament_votings set status='closed' where id=p_voting_id;
end;
$$;

-- Transições legislativas: Parlamento encerra votação; Presidência decide lei.
create or replace function public.update_bill_status(p_bill_id uuid,p_new_status text)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());
  v_bill public.bills%rowtype;
  v_role text;
  v_is_parliament boolean;
  v_is_executive boolean;
  v_latest public.parliament_votings%rowtype;
  v_members integer:=0;
  v_votes integer:=0;
  v_approve integer:=0;
  v_reject integer:=0;
  v_ready boolean:=false;
  v_approved boolean:=false;
  v_approved_houses integer:=0;
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  select * into v_bill from public.bills where id=p_bill_id for update;
  if not found then raise exception 'BILL_NOT_FOUND'; end if;
  select role into v_role from public.profiles where id=v_actor;
  v_is_parliament:=public.is_parliament_governance_manager(v_actor,v_bill.house_id)
    or exists(select 1 from public.parliament_members where user_id=v_actor and house_id=v_bill.house_id and term_start_date<=current_date and term_end_date>=current_date);
  v_is_executive:=v_role in ('Admin','Presidente');

  if p_new_status in ('Aguardando sanção presidencial','Aguardando promulgação presidencial','Rejeitado') then
    if not v_is_parliament then raise exception 'PARLIAMENT_AUTHORITY_REQUIRED' using errcode='42501'; end if;
    select * into v_latest from public.parliament_votings
    where related_id=p_bill_id and type='bill'
    order by created_at desc limit 1;
    if not found then raise exception 'BILL_VOTING_NOT_FOUND'; end if;
    select count(*) into v_members from public.parliament_members
    where house_id=v_latest.house_id and term_start_date<=current_date and term_end_date>=current_date;
    select count(*),count(*) filter(where vote='Aprovar'),count(*) filter(where vote='Rejeitar')
      into v_votes,v_approve,v_reject
    from public.parliament_voting_votes where voting_id=v_latest.id;
    v_ready:=clock_timestamp()>=v_latest.end_date or (v_members>0 and v_votes>=v_members);
    v_approved:=case when v_bill.type='PEC'
      then v_approve>=ceil(greatest(v_members,1)*2.0/3.0)
      else v_approve>v_reject and v_approve>0 end;
    if not v_ready then raise exception 'BILL_VOTING_NOT_READY'; end if;

    if p_new_status='Aguardando sanção presidencial' and (v_bill.type='PEC' or not v_approved) then
      raise exception 'BILL_RESULT_DOES_NOT_ALLOW_SANCTION';
    end if;
    if p_new_status='Rejeitado' and v_approved then
      raise exception 'BILL_RESULT_IS_APPROVED';
    end if;
    if p_new_status='Aguardando promulgação presidencial' then
      if v_bill.type<>'PEC' then raise exception 'ONLY_PEC_AWAITS_PROMULGATION'; end if;
      select count(*) into v_approved_houses
      from public.parliament_votings voting
      cross join lateral (
        select greatest(count(*),1)::integer as member_count
        from public.parliament_members member
        where member.house_id=voting.house_id
          and member.term_start_date<=current_date and member.term_end_date>=current_date
      ) members
      cross join lateral (
        select count(*)::integer as total_votes,
          count(*) filter(where vote.vote='Aprovar')::integer as approval_votes
        from public.parliament_voting_votes vote where vote.voting_id=voting.id
      ) result
      where voting.related_id=p_bill_id and voting.type='bill'
        and (clock_timestamp()>=voting.end_date or result.total_votes>=members.member_count)
        and result.approval_votes>=ceil(members.member_count*2.0/3.0);
      if v_approved_houses<2 then raise exception 'PEC_REQUIRES_TWO_APPROVED_HOUSES'; end if;
    end if;
  elsif p_new_status in ('Sancionado','Promulgado','Vetado integralmente','Vetado parcialmente') then
    if not v_is_executive then raise exception 'EXECUTIVE_AUTHORITY_REQUIRED' using errcode='42501'; end if;
    if v_bill.status not in ('Aguardando sanção presidencial','Aguardando promulgação presidencial','Aprovado') then
      raise exception 'BILL_NOT_AWAITING_EXECUTIVE_DECISION';
    end if;
  else
    raise exception 'INVALID_BILL_STATUS';
  end if;

  update public.bills set status=p_new_status,updated_at=clock_timestamp() where id=p_bill_id;

  if p_new_status in ('Sancionado','Promulgado') then
    insert into public.dou_entries(title,summary,content,published_at,type,source_id)
    select
      v_bill.title,
      case when p_new_status='Sancionado'
        then 'Lei sancionada pela Presidência da República.'
        else 'Norma promulgada e publicada oficialmente.' end,
      coalesce(nullif(v_bill.full_text,''),v_bill.summary),
      clock_timestamp(),v_bill.type,v_bill.id
    where not exists(
      select 1 from public.dou_entries entry
      where entry.source_id=v_bill.id and entry.type=v_bill.type
    );
  end if;
end;
$$;

-- Limite de cartão validado e auditado, sem UPDATE direto no cliente.
create or replace function public.set_bank_card_limit(p_card_id uuid,p_new_limit numeric,p_reason text default null)
returns public.cards
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());
  v_old public.cards%rowtype;
  v_new public.cards%rowtype;
begin
  if v_actor is null or not public.user_can_manage_national_bank(v_actor) then
    raise exception 'BANK_MANAGER_REQUIRED' using errcode='42501';
  end if;
  if p_new_limit is null or p_new_limit<0 or p_new_limit>1000000000 then
    raise exception 'INVALID_CARD_LIMIT';
  end if;
  select * into v_old from public.cards where id=p_card_id for update;
  if not found then raise exception 'CARD_NOT_FOUND'; end if;
  update public.cards set card_limit=round(p_new_limit,2) where id=p_card_id returning * into v_new;
  perform economy_private.audit(
    'bank_card_limit_changed','cards',p_card_id::text,to_jsonb(v_old),to_jsonb(v_new),
    coalesce(nullif(btrim(coalesce(p_reason,'')),''),'Limite ajustado pelo Banco Nacional.'),v_actor
  );
  return v_new;
end;
$$;

-- Pagamento de boleto é único, trava saldo/boleto e respeita o pagador indicado.
create or replace function public.validate_and_get_bill(p_bill_code text)
returns json
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_bill public.bills_of_exchange%rowtype; v_actor uuid:=(select auth.uid());
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  select * into v_bill from public.bills_of_exchange where bill_code=p_bill_code;
  if not found or (v_bill.payer_id is not null and v_bill.payer_id<>v_actor and not public.user_can_manage_national_bank(v_actor)) then
    return json_build_object('success',false,'status','invalid','message','Boleto inexistente.');
  end if;
  if v_bill.status='paid' then return json_build_object('success',false,'status','paid','message','Este boleto já foi pago.'); end if;
  return json_build_object('success',true,'status','valid','message','Boleto válido e pendente.','amount',v_bill.amount,'description',v_bill.description,'due_date',v_bill.due_date);
end;
$$;

create or replace function public.pay_boleto(p_bill_code text)
returns json
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());
  v_bill public.bills_of_exchange%rowtype;
  v_source public.accounts%rowtype;
  v_target_id uuid;
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  select * into v_bill from public.bills_of_exchange where bill_code=p_bill_code for update;
  if not found then return json_build_object('success',false,'message','Boleto inexistente.'); end if;
  if v_bill.payer_id is not null and v_bill.payer_id<>v_actor then raise exception 'BILL_PAYER_MISMATCH' using errcode='42501'; end if;
  if v_bill.status='paid' then return json_build_object('success',false,'message','Este boleto já foi pago.'); end if;
  if v_bill.status<>'pending' then return json_build_object('success',false,'message','Este boleto não pode ser pago.'); end if;

  select * into v_source from public.accounts where user_id=v_actor order by created_at limit 1 for update;
  if not found then return json_build_object('success',false,'message','Conta bancária não encontrada.'); end if;
  if v_source.balance<v_bill.amount then return json_build_object('success',false,'message','Saldo insuficiente para realizar o pagamento.'); end if;
  select id into v_target_id from public.accounts where user_id=v_bill.issuer_id order by created_at limit 1 for update;

  update public.accounts set balance=balance-v_bill.amount where id=v_source.id;
  if v_target_id is not null then update public.accounts set balance=balance+v_bill.amount where id=v_target_id; end if;
  update public.bills_of_exchange set status='paid',updated_at=clock_timestamp() where id=v_bill.id;
  insert into public.transactions(
    from_account_id,to_account_id,amount,description,type,status,currency,idempotency_key,metadata
  ) values(
    v_source.id,v_target_id,v_bill.amount,'Pagamento de Boleto: '||coalesce(v_bill.description,v_bill.bill_code),
    'bill_payment','completed','BRL',v_bill.id,jsonb_build_object('bill_code',v_bill.bill_code,'bill_id',v_bill.id)
  ) on conflict(idempotency_key) do nothing;
  return json_build_object('success',true,'message','Boleto pago com sucesso!');
end;
$$;

-- Logs de alteração de privilégios são append-only.
create table if not exists public.security_audit_log(
  id bigint generated always as identity primary key,
  action text not null,
  target_table text not null,
  target_id text,
  actor_id uuid,
  actor_role text,
  old_data jsonb,
  new_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.security_audit_log enable row level security;
drop policy if exists "security_audit_admin_read" on public.security_audit_log;
create policy "security_audit_admin_read" on public.security_audit_log for select to authenticated
using (public.get_user_role((select auth.uid()))='Admin');
revoke all on public.security_audit_log from public,anon,authenticated;
grant select on public.security_audit_log to authenticated;
grant all on public.security_audit_log to service_role;

create or replace function public.audit_profile_privilege_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.role is distinct from old.role or new.titles is distinct from old.titles then
    insert into public.security_audit_log(action,target_table,target_id,actor_id,actor_role,old_data,new_data)
    values('profile_privileges_changed','profiles',new.id::text,(select auth.uid()),public.get_user_role((select auth.uid())),
      jsonb_build_object('role',old.role,'titles',old.titles),
      jsonb_build_object('role',new.role,'titles',new.titles));
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_privilege_audit on public.profiles;
create trigger profiles_privilege_audit after update of role,titles on public.profiles
for each row execute function public.audit_profile_privilege_change();

create or replace function public.block_security_audit_mutation()
returns trigger language plpgsql set search_path='' as $$
begin raise exception 'AUDIT_LOG_IS_IMMUTABLE' using errcode='42501'; end; $$;
drop trigger if exists security_audit_immutable on public.security_audit_log;
create trigger security_audit_immutable before update or delete on public.security_audit_log
for each row execute function public.block_security_audit_mutation();

create or replace function public.audit_national_event_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=coalesce((select auth.uid()),new.created_by);
begin
  insert into public.security_audit_log(
    action,target_table,target_id,actor_id,actor_role,old_data,new_data,metadata
  ) values(
    case when tg_op='INSERT' then 'national_event_created' else 'national_event_changed' end,
    'national_game_events',new.id::text,v_actor,public.get_user_role(v_actor),
    case when tg_op='UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new),jsonb_build_object('operation',tg_op)
  );
  return new;
end;
$$;
drop trigger if exists national_event_security_audit on public.national_game_events;
create trigger national_event_security_audit after insert or update on public.national_game_events
for each row execute function public.audit_national_event_change();

-- Ajustes financeiros administrativos mantêm histórico em vez de apagar
-- posições e exigem uma justificativa auditável.
insert into public.investment_options(
  id,name,description,risk_level,annual_return_rate,minimum_amount,is_active
) values(
  '00000000-0000-0000-0000-000000000001','Ajuste administrativo',
  'Lançamento técnico visível usado somente para correções administrativas auditadas.',
  'Baixo',0,0,false
) on conflict(id) do nothing;

create or replace function public.admin_modify_treasury(p_amount numeric,p_action text,p_reason text)
returns json
language plpgsql security definer set search_path=''
as $$
declare v_actor uuid:=(select auth.uid());v_old numeric;v_new numeric;
begin
  if public.get_user_role(v_actor)<>'Admin' then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if p_amount is null or p_amount<0 then raise exception 'INVALID_AMOUNT'; end if;
  if length(btrim(coalesce(p_reason,'')))<20 then raise exception 'JUSTIFICATION_REQUIRED'; end if;
  select treasury_balance into v_old from public.government_finances where id=1 for update;
  v_new:=case p_action when 'add' then v_old+p_amount when 'remove' then v_old-p_amount when 'set' then p_amount else null end;
  if v_new is null then raise exception 'INVALID_ACTION'; end if;
  if v_new<0 then raise exception 'TREASURY_BALANCE_INSUFFICIENT'; end if;
  update public.government_finances set treasury_balance=v_new,updated_at=clock_timestamp() where id=1;
  perform economy_private.audit(
    'admin_treasury_adjustment','government_finances','1',
    jsonb_build_object('treasury_balance',v_old),jsonb_build_object('treasury_balance',v_new),
    btrim(p_reason),v_actor
  );
  return json_build_object('success',true,'message','Cofre do Governo modificado com sucesso.','balance',v_new);
end;
$$;

create or replace function public.admin_modify_investments(p_user_id uuid,p_amount numeric,p_action text,p_reason text)
returns json
language plpgsql security definer set search_path=''
as $$
declare v_actor uuid:=(select auth.uid());v_old numeric;v_new numeric;v_delta numeric;
begin
  if public.get_user_role(v_actor)<>'Admin' then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if p_amount is null or p_amount<0 then raise exception 'INVALID_AMOUNT'; end if;
  if length(btrim(coalesce(p_reason,'')))<20 then raise exception 'JUSTIFICATION_REQUIRED'; end if;
  if not exists(select 1 from public.profiles where id=p_user_id) then raise exception 'PROFILE_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  select coalesce(sum(amount_invested),0) into v_old from public.user_investments where user_id=p_user_id and is_active;
  v_new:=case p_action when 'add' then v_old+p_amount when 'remove' then v_old-p_amount when 'set' then p_amount else null end;
  if v_new is null then raise exception 'INVALID_ACTION'; end if;
  if v_new<0 then raise exception 'INVESTMENT_BALANCE_INSUFFICIENT'; end if;
  v_delta:=v_new-v_old;
  if v_delta<>0 then
    insert into public.user_investments(user_id,investment_id,amount_invested,is_active)
    values(p_user_id,'00000000-0000-0000-0000-000000000001',v_delta,true);
  end if;
  perform economy_private.audit(
    'admin_investment_adjustment','user_investments',p_user_id::text,
    jsonb_build_object('total',v_old),jsonb_build_object('total',v_new,'delta',v_delta),
    btrim(p_reason),v_actor
  );
  return json_build_object('success',true,'message','Investimentos do usuário modificados com sucesso.','total',v_new);
end;
$$;

-- Funções herdadas de Justiça/Mídia mantêm o fluxo, agora sem resolução de
-- objetos por search_path manipulável e sem execução anônima.
alter function public.appeal_fine(uuid,text) set search_path='';
alter function public.schedule_hearing(text,text) set search_path='';
alter function public.delete_story(uuid) set search_path='';
alter function public.generate_bill_for_fine() set search_path='';
create or replace function public.generate_unique_transfer_key()
returns text
language plpgsql
set search_path=''
as $$
declare v_key text; v_attempt integer:=0;
begin
  while v_attempt<100 loop
    v_attempt:=v_attempt+1;
    select string_agg(character,'') into v_key
    from (
      select character
      from unnest(string_to_array('ABCDEFGHIJKLMNPQRSTUVWXYZ123456789',null)) as chars(character)
      order by random() limit 5
    ) generated;
    if not exists(select 1 from public.accounts where transfer_key=v_key) then
      return v_key;
    end if;
  end loop;
  raise exception 'TRANSFER_KEY_GENERATION_EXHAUSTED';
end;
$$;
alter function public.is_parliament_governance_manager(uuid,uuid) set search_path='';
alter function public.admin_update_user(uuid,text,text,text,text[]) set search_path='';

revoke all on function public.start_parliament_bill_voting(uuid,uuid,text,text) from public,anon;
revoke all on function public.cast_parliament_vote(uuid,uuid,text) from public,anon;
revoke all on function public.close_parliament_voting(uuid) from public,anon;
revoke all on function public.update_bill_status(uuid,text) from public,anon;
revoke all on function public.set_bank_card_limit(uuid,numeric,text) from public,anon;
revoke all on function public.validate_and_get_bill(text) from public,anon;
revoke all on function public.pay_boleto(text) from public,anon;
revoke all on function public.pay_boleto(text,numeric) from public,anon,authenticated;
revoke all on function public.appeal_fine(uuid,text) from public,anon;
revoke all on function public.schedule_hearing(text,text) from public,anon;
revoke all on function public.delete_story(uuid) from public,anon;
revoke all on function public.admin_update_user(uuid,text,text,text,text[]) from public,anon;
revoke all on function public.audit_profile_privilege_change() from public,anon,authenticated;
revoke all on function public.block_security_audit_mutation() from public,anon,authenticated;
revoke all on function public.block_direct_authoritative_bank_update() from public,anon,authenticated;
revoke all on function public.audit_national_event_change() from public,anon,authenticated;
revoke all on function public.admin_modify_treasury(numeric,text,text) from public,anon;
revoke all on function public.admin_modify_investments(uuid,numeric,text,text) from public,anon;

grant execute on function public.start_parliament_bill_voting(uuid,uuid,text,text) to authenticated,service_role;
grant execute on function public.cast_parliament_vote(uuid,uuid,text) to authenticated,service_role;
grant execute on function public.close_parliament_voting(uuid) to authenticated,service_role;
grant execute on function public.update_bill_status(uuid,text) to authenticated,service_role;
grant execute on function public.set_bank_card_limit(uuid,numeric,text) to authenticated,service_role;
grant execute on function public.validate_and_get_bill(text) to authenticated,service_role;
grant execute on function public.pay_boleto(text) to authenticated,service_role;
grant execute on function public.appeal_fine(uuid,text),public.schedule_hearing(text,text),public.delete_story(uuid) to authenticated,service_role;
grant execute on function public.admin_update_user(uuid,text,text,text,text[]) to authenticated,service_role;
grant execute on function public.admin_modify_treasury(numeric,text,text) to authenticated,service_role;
grant execute on function public.admin_modify_investments(uuid,numeric,text,text) to authenticated,service_role;

-- Índices para RLS, filtros, timelines e painéis de alta frequência.
create index if not exists armed_forces_enlistment_user_status_idx on public.armed_forces_enlistment(user_id,status);
create index if not exists armed_forces_reports_reporter_created_idx on public.armed_forces_reports(reporter_id,created_at desc);
create index if not exists bills_of_exchange_payer_status_due_idx on public.bills_of_exchange(payer_id,status,due_date);
create index if not exists bills_of_exchange_issuer_created_idx on public.bills_of_exchange(issuer_id,created_at desc);
create index if not exists parliament_votings_house_status_end_idx on public.parliament_votings(house_id,status,end_date);
create index if not exists parliament_votings_related_idx on public.parliament_votings(related_id,type,status);
create index if not exists parliament_voting_votes_member_idx on public.parliament_voting_votes(member_id,created_at desc);
create index if not exists prison_appeals_user_status_idx on public.prison_appeals(user_id,status,created_at desc);
create index if not exists prison_hearings_user_status_idx on public.prison_hearings(user_id,status,requested_at desc);
create index if not exists stories_created_idx on public.stories(created_at desc);
create index if not exists stories_user_created_idx on public.stories(user_id,created_at desc);
create index if not exists security_audit_target_idx on public.security_audit_log(target_table,target_id,created_at desc);
create index if not exists security_audit_actor_idx on public.security_audit_log(actor_id,created_at desc);

commit;
