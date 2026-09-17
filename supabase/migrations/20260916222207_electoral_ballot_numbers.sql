begin;
alter table public.political_parties add column if not exists electoral_number text;
alter table public.candidates add column if not exists electoral_number text;
alter table public.votes add column if not exists ballot_kind text not null default 'candidate';
update public.votes set ballot_kind='null' where candidate_id is null;
alter table public.votes add constraint votes_ballot_kind_check check(ballot_kind in ('candidate','blank','null'));
create unique index if not exists party_electoral_number_unique on public.political_parties(electoral_number);
create unique index if not exists candidate_electoral_number_unique on public.candidates(election_id,electoral_number);
create or replace function private.election_number_digits(p_election_id uuid) returns integer language sql stable set search_path='' as $$
  select case when lower(t.name) like '%senad%' then 3 when lower(t.name) like '%deput%' then 4 else 2 end from public.elections e join public.election_types t on t.id=e.election_type_id where e.id=p_election_id
$$;
create or replace function private.assign_party_electoral_number() returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('party-electoral-number',0));
  if tg_op='UPDATE' and old.electoral_number is not null and new.electoral_number is distinct from old.electoral_number then raise exception 'O número eleitoral do partido é permanente.'; end if;
  if new.electoral_number is null then
    select n::text into new.electoral_number from generate_series(10,99) n where not exists(select 1 from public.political_parties p where p.electoral_number=n::text) order by n limit 1;
  end if;
  if new.electoral_number is null then raise exception 'Não há número partidário disponível. Procure a administração eleitoral.'; end if;
  if new.electoral_number !~ '^[1-9][0-9]$' then raise exception 'O número partidário deve ter dois dígitos, de 10 a 99.'; end if;
  if exists(select 1 from public.political_parties p where p.electoral_number=new.electoral_number and p.id<>new.id) then raise exception 'Este número já pertence a outro partido.'; end if;
  return new;
end; $$;
create trigger assign_party_electoral_number before insert or update of electoral_number on public.political_parties for each row execute function private.assign_party_electoral_number();
update public.political_parties set electoral_number=null where electoral_number is null;
create or replace function private.assign_candidate_electoral_number() returns trigger language plpgsql security definer set search_path='' as $$
declare v_digits integer; v_prefix text; v_min integer; v_max integer;
begin
  v_digits:=private.election_number_digits(new.election_id);
  if v_digits is null then raise exception 'Eleição não encontrada.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('candidate-number:'||new.election_id::text,0));
  if tg_op='UPDATE' and old.electoral_number is not null and new.electoral_number is distinct from old.electoral_number and exists(select 1 from public.elections where id=new.election_id and (status in ('Voting','Finished') or voting_start_date<=clock_timestamp())) then raise exception 'O número não pode mudar depois do início da votação.'; end if;
  if new.party_id is not null then
    select electoral_number into v_prefix from public.political_parties where id=new.party_id;
  else
    v_prefix:='0'; -- Independent candidacies keep the existing constitutional eligibility rule.
  end if;
  if v_prefix is null then raise exception 'O partido precisa de número eleitoral.'; end if;
  v_min:=(v_prefix||repeat('0',v_digits-length(v_prefix)))::integer;
  v_max:=(v_prefix||repeat('9',v_digits-length(v_prefix)))::integer;
  if new.electoral_number is null then
    select lpad(n::text,v_digits,'0') into new.electoral_number from generate_series(v_min,v_max) n where not exists(select 1 from public.candidates c where c.election_id=new.election_id and c.electoral_number=lpad(n::text,v_digits,'0') and c.id<>new.id) order by n limit 1;
  end if;
  if not coalesce(new.electoral_number ~ ('^[0-9]{'||v_digits||'}$') and left(new.electoral_number,length(v_prefix))=v_prefix,false) then raise exception 'Use % dígitos começando por %.',v_digits,v_prefix; end if;
  if exists(select 1 from public.candidates c where c.election_id=new.election_id and c.electoral_number=new.electoral_number and c.id<>new.id) then raise exception 'Este número já está reservado nesta eleição.'; end if;
  return new;
end; $$;
create trigger assign_candidate_electoral_number before insert or update of electoral_number,party_id,election_id on public.candidates for each row execute function private.assign_candidate_electoral_number();
update public.candidates set electoral_number=null where electoral_number is null;
create or replace function public.submit_candidacy(p_election_id uuid,p_party_id uuid,p_vice_candidate_id uuid,p_political_name text,p_bio text,p_proposals text,p_campaign_photo_url text,p_electoral_number text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta para continuar.'; end if;
  if nullif(btrim(p_electoral_number),'') is null then raise exception 'Defina o número eleitoral da candidatura.'; end if;
  result:=public.submit_candidacy(p_election_id,p_party_id,p_vice_candidate_id,p_political_name,p_bio,p_proposals,p_campaign_photo_url);
  if coalesce((result->>'success')::boolean,false) then update public.candidates set electoral_number=btrim(p_electoral_number) where id=(result->>'candidate_id')::uuid and user_id=auth.uid(); end if;
  return result;
end; $$;
revoke all on function public.submit_candidacy(uuid,uuid,uuid,text,text,text,text,text) from public,anon;
grant execute on function public.submit_candidacy(uuid,uuid,uuid,text,text,text,text,text) to authenticated;
create or replace function public.cast_ballot(p_election_id uuid, p_number text, p_kind text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_voter uuid := auth.uid();
  v_election public.elections%rowtype;
  v_candidate public.candidates%rowtype;
  v_vote_id uuid;
begin
  if p_kind not in ('candidate','blank','null') or p_kind is null then raise exception 'Selecione um voto válido, em branco ou nulo.'; end if;
  if v_voter is null then raise exception 'Entre na sua conta para votar.'; end if;

  if not exists (
    select 1 from public.profiles profile
    where profile.id = v_voter
      and profile.deleted_at is null
      and (profile.onboarding_completed or profile.role <> 'Usuário')
  ) then
    raise exception 'Seu cidadão ainda não está habilitado para votar.';
  end if;

  if not exists (
    select 1 from public.documents document
    where document.user_id = v_voter
      and document.type = 'Título de Eleitor'
      and document.is_valid
      and (document.expires_at is null or document.expires_at >= clock_timestamp())
  ) and not exists (
    select 1 from public.profiles profile
    where profile.id = v_voter and nullif(btrim(profile.titulo_eleitor), '') is not null
  ) then
    raise exception 'Emita seu título de eleitor no DIC antes de votar.';
  end if;

  select * into v_election
  from public.elections
  where id = p_election_id
  for share;

  if not found then raise exception 'Eleição não encontrada.'; end if;
  if lower(coalesce(v_election.status, '')) <> 'voting'
     or clock_timestamp() < v_election.voting_start_date
     or clock_timestamp() > v_election.voting_end_date then
    raise exception 'Esta eleição não está aberta para votação.';
  end if;

  if p_kind in ('candidate','null') then
    if p_number is null or p_number !~ ('^[0-9]{'||private.election_number_digits(p_election_id)||'}$') then raise exception 'Digite o número completo.'; end if;
    select * into v_candidate from public.candidates where electoral_number=p_number and election_id=p_election_id and status='Approved' for share;
    if p_kind='candidate' and not found then raise exception 'Candidato não encontrado ou candidatura não aprovada.'; end if;
    if p_kind='null' and found then raise exception 'Este número corresponde a um candidato válido. Confira seu voto.'; end if;
  end if;
  insert into public.votes (
    election_id, voter_id, candidate_id, is_valid, validation_source,
    validated_at, integrity_metadata, ballot_kind
  ) values (
    p_election_id, v_voter, v_candidate.id, true, 'cast_ballot',
    clock_timestamp(), jsonb_build_object('authenticated_voter', true), p_kind
  ) returning id into v_vote_id;

  insert into public.election_audit_log (
    election_id, actor_id, actor_role, action, entity_type, entity_id, after_state
  ) values (
    p_election_id, v_voter, public.get_user_role(v_voter), 'vote_cast', 'vote', v_vote_id::text,
    jsonb_build_object('validation_source', 'cast_ballot')
  );

  return json_build_object('success', true, 'message', 'Voto computado com sucesso!');
exception
  when unique_violation then
    raise exception 'Você já votou nesta eleição.';
end;
$$;

revoke all on function public.cast_ballot(uuid,text,text) from public,anon;
grant execute on function public.cast_ballot(uuid,text,text) to authenticated;
revoke all on function private.election_number_digits(uuid),private.assign_party_electoral_number(),private.assign_candidate_electoral_number() from public,anon,authenticated;
commit;
