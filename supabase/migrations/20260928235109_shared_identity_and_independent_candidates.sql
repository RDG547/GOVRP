-- Reuse existing party, directory, candidacy and historical identity structures.
begin;
create or replace function public.valid_brand_font(p_key text) returns boolean
language sql immutable set search_path='' as $$ select p_key = any(array['default','modern','institutional','classic','elegant','geometric','editorial','technical','lato','poppins','raleway','nunito-sans','source-sans-3','work-sans','manrope','dm-sans','figtree','outfit','plus-jakarta-sans','barlow','urbanist','rubik','oswald','bebas-neue','anton','archivo','cabin','karla','quicksand','josefin-sans','exo-2','rajdhani','space-grotesk','space-mono','ibm-plex-sans','ibm-plex-serif','ibm-plex-mono','playfair-display','lora','pt-serif','noto-serif','source-serif-4','crimson-pro','eb-garamond','bitter','zilla-slab','arvo','cinzel','dm-serif-display','vollkorn']::text[]) $$;

create or replace function public.create_political_party(p_name text,p_acronym text,p_ideology text,p_logo_url text,p_statute text,p_description text,p_orientation public.political_orientation,p_color text,p_font_key text,p_header_url text)
returns json language plpgsql security definer set search_path='' as $$
declare result json; customization jsonb;
begin
 if auth.uid() is null then raise exception 'Entre na sua conta para fundar um partido.' using errcode='42501'; end if;
 result:=public.create_political_party(p_name,p_acronym,p_ideology,p_logo_url,p_statute,p_description,p_orientation,p_color,p_font_key);
 if coalesce((result->>'success')::boolean,false) then
  customization:=public.update_party_customization((result->>'party_id')::uuid,jsonb_build_object('logo_url',p_logo_url,'header_url',coalesce(p_header_url,'')));
  if not coalesce((customization->>'success')::boolean,false) then raise exception '%',coalesce(customization->>'message','Não foi possível salvar a personalização.'); end if;
 end if;
 return result;
end $$;
revoke all on function public.create_political_party(text,text,text,text,text,text,public.political_orientation,text,text,text) from public,anon;
grant execute on function public.create_political_party(text,text,text,text,text,text,public.political_orientation,text,text,text) to authenticated;

-- Institutional edits cannot overwrite a newer logo/color saved in Personalização.
create or replace function public.update_party_details(p_party_id uuid,p_name text,p_acronym text,p_ideology text,p_statute text,p_owner_id uuid,p_president_id uuid,p_vice_president_id uuid,p_description text,p_orientation public.political_orientation)
returns json language plpgsql security definer set search_path='' as $$
declare party public.political_parties%rowtype;
begin
 if auth.uid() is null then raise exception 'Entre na sua conta para editar o partido.' using errcode='42501'; end if;
 select * into party from public.political_parties where id=p_party_id for update;
 return public.update_party_details(p_party_id,p_name,p_acronym,p_ideology,p_statute,party.logo_url,p_owner_id,p_president_id,p_vice_president_id,p_description,p_orientation);
end $$;
revoke all on function public.update_party_details(uuid,text,text,text,text,uuid,uuid,uuid,text,public.political_orientation) from public,anon;
grant execute on function public.update_party_details(uuid,text,text,text,text,uuid,uuid,uuid,text,public.political_orientation) to authenticated;
CREATE OR REPLACE FUNCTION public.search_executive_candidates(p_office_key text, p_query text DEFAULT ''::text, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if auth.uid() is null or not coalesce(public.get_user_role(auth.uid()) in ('Admin','Presidente'),false) then raise exception 'A consulta exige autoridade presidencial.' using errcode='42501'; end if;
 if p_office_key is null or (p_office_key<>'minister' and not exists(select 1 from public.executive_office_definitions where office_key=p_office_key)) then raise exception 'Selecione um cargo válido.'; end if;
 if p_offset is null or p_offset<0 or p_offset>1000000 then raise exception 'Página inválida.'; end if;
 select coalesce(jsonb_agg(to_jsonb(c)), '[]') into result from (
  select p.id,p.full_name,p.username,p.avatar_url,p.role,count(*) over() as total_count from public.profiles p
  where private.is_executive_candidate(p.id,p_office_key)
   and (coalesce(btrim(p_query),'')='' or position(lower(btrim(p_query)) in lower(concat_ws(' ',p.full_name,p.username,p.x_handle,p.x_username)))>0)
  order by p.full_name,p.id limit 51 offset p_offset
 ) c;
 return jsonb_build_object('candidates',case when jsonb_array_length(result)>50 then result-50 else result end,'has_more',jsonb_array_length(result)>50);
end; $function$
;
CREATE OR REPLACE FUNCTION private.assign_candidate_electoral_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_digits integer; v_prefix text; v_min integer; v_max integer;
begin
  -- Deleting a closed party only detaches its FK; the ballot number is historical.
  if tg_op='UPDATE' and old.party_id is not null and new.party_id is null
    and new.party_snapshot->>'id'=old.party_id::text
    and new.election_id=old.election_id and new.electoral_number=old.electoral_number then return new; end if;
  v_digits:=private.election_number_digits(new.election_id);
  if v_digits is null then raise exception 'Eleição não encontrada.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('candidate-number:'||new.election_id::text,0));
  if tg_op='UPDATE' and old.electoral_number is not null and new.electoral_number is distinct from old.electoral_number and exists(select 1 from public.elections where id=new.election_id and (status in ('Voting','Finished') or voting_start_date<=clock_timestamp())) then raise exception 'O número não pode mudar depois do início da votação.'; end if;
  if new.party_id is not null then
    select electoral_number into v_prefix from public.political_parties where id=new.party_id;
  else
    v_prefix:=''; -- Independent ballots may use any available number of the office's length.
  end if;
  if v_prefix is null then raise exception 'O partido precisa de número eleitoral.'; end if;
  v_min:=(v_prefix||repeat('0',v_digits-length(v_prefix)))::integer;
  v_max:=(v_prefix||repeat('9',v_digits-length(v_prefix)))::integer;
  if new.electoral_number is null then
    select lpad(n::text,v_digits,'0') into new.electoral_number from generate_series(v_min,v_max) n where not exists(select 1 from public.candidates c where c.election_id=new.election_id and c.electoral_number=lpad(n::text,v_digits,'0') and c.id<>new.id and lower(coalesce(c.status,'')) not in ('rejected','rejeitado','cancelled','cancelado','cancelada','withdrawn')) order by n limit 1;
  end if;
  if not coalesce(new.electoral_number ~ ('^[0-9]{'||v_digits||'}$') and left(new.electoral_number,length(v_prefix))=v_prefix,false) then
    if new.party_id is null then raise exception 'Informe um número com % dígitos.',v_digits;
    else raise exception 'Use % dígitos começando por %.',v_digits,v_prefix; end if;
  end if;
  if exists(select 1 from public.candidates c where c.election_id=new.election_id and c.electoral_number=new.electoral_number and c.id<>new.id and lower(coalesce(c.status,'')) not in ('rejected','rejeitado','cancelled','cancelado','cancelada','withdrawn')) then raise exception 'Este número já está sendo utilizado nesta eleição.'; end if;
  return new;
end; $function$
;
CREATE OR REPLACE FUNCTION public.submit_candidacy(p_election_id uuid, p_party_id uuid, p_vice_candidate_id uuid, p_political_name text, p_bio text, p_proposals text, p_campaign_photo_url text, p_electoral_number text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_requester uuid := auth.uid();
  v_election record;
  v_requires_vice boolean;
  v_candidate_id uuid;
  v_constraint text;
begin
  if v_requester is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  if nullif(btrim(p_electoral_number),'') is null then raise exception 'Defina o número eleitoral da candidatura.'; end if;

  if nullif(btrim(coalesce(p_political_name, '')), '') is null
     or char_length(btrim(p_political_name)) > 80 then
    raise exception 'POLITICAL_NAME_INVALID';
  end if;

  select e.*, et.name as type_name, coalesce(et.requires_vice_candidate, false) as requires_vice
    into v_election
  from public.elections e
  left join public.election_types et on et.id = e.election_type_id
  where e.id = p_election_id
  for update of e;

  if not found then raise exception 'ELECTION_NOT_FOUND'; end if;
  if lower(coalesce(v_election.status, '')) <> 'candidacy'
     or clock_timestamp() < v_election.candidacy_start_date
     or clock_timestamp() > v_election.candidacy_end_date then
    raise exception 'CANDIDACY_WINDOW_CLOSED';
  end if;

  if not exists (
    select 1 from public.profiles profile
    where profile.id = v_requester
      and profile.deleted_at is null
      and (profile.onboarding_completed or profile.role <> 'Usuário')
  ) then
    raise exception 'CITIZEN_NOT_ELIGIBLE';
  end if;

  if p_party_id is not null and not exists (
    select 1 from public.party_members member
    where member.party_id = p_party_id and member.user_id = v_requester
  ) then
    raise exception 'PARTY_MEMBERSHIP_REQUIRED';
  end if;

  v_requires_vice := v_election.requires_vice
    or lower(coalesce(v_election.type_name, '')) = 'presidente'
    or lower(coalesce(v_election.name, '')) like '%presidencial%';

  if v_requires_vice and p_vice_candidate_id is null then
    raise exception 'VICE_CANDIDATE_REQUIRED';
  end if;
  if p_vice_candidate_id = v_requester then raise exception 'SELF_VICE_NOT_ALLOWED'; end if;
  if p_vice_candidate_id is not null and not exists (
    select 1 from public.profiles profile
    where profile.id = p_vice_candidate_id
      and profile.deleted_at is null
      and profile.role not in ('Admin', 'Presidente')
      and (profile.onboarding_completed or profile.role <> 'Usuário')
  ) then
    raise exception 'VICE_CANDIDATE_NOT_ELIGIBLE';
  end if;

  if exists (
    select 1
    from public.candidates candidate
    join public.elections election on election.id = candidate.election_id
    where candidate.status in ('Pendente', 'Pending', 'Approved')
      and (candidate.user_id = v_requester or candidate.vice_candidate_id = v_requester)
      and (lower(coalesce(election.status, '')) in ('scheduled', 'candidacy', 'voting')
        or election.voting_end_date > clock_timestamp())
  ) then
    raise exception 'ACTIVE_CANDIDACY_EXISTS';
  end if;

  if p_vice_candidate_id is not null and exists (
    select 1 from public.candidates candidate
    where candidate.election_id = p_election_id
      and candidate.status in ('Pendente', 'Pending', 'Approved')
      and p_vice_candidate_id in (candidate.user_id, candidate.vice_candidate_id)
  ) then
    raise exception 'VICE_ALREADY_RUNNING';
  end if;

  insert into public.candidates (
    election_id, user_id, party_id, vice_candidate_id, political_name,
    bio, proposals, campaign_photo_url, status, electoral_number
  ) values (
    p_election_id, v_requester, p_party_id, p_vice_candidate_id,
    btrim(p_political_name), nullif(btrim(coalesce(p_bio, '')), ''),
    nullif(btrim(coalesce(p_proposals, '')), ''),
    nullif(btrim(coalesce(p_campaign_photo_url, '')), ''), 'Pendente', btrim(p_electoral_number)
  ) returning id into v_candidate_id;

  insert into public.election_audit_log (
    election_id, actor_id, actor_role, action, entity_type, entity_id, after_state
  ) values (
    p_election_id, v_requester, public.get_user_role(v_requester), 'candidacy_requested',
    'candidate', v_candidate_id::text,
    jsonb_build_object('status', 'Pendente', 'party_id', p_party_id, 'vice_candidate_id', p_vice_candidate_id)
  );

  return jsonb_build_object(
    'success', true,
    'candidate_id', v_candidate_id,
    'status', 'Pendente',
    'message', 'Candidatura enviada para análise.'
  );
exception
  when unique_violation then
    get stacked diagnostics v_constraint=constraint_name;
    if v_constraint='candidate_electoral_number_unique' then raise exception 'Este número já está sendo utilizado nesta eleição.'; end if;
    raise exception 'CANDIDACY_ALREADY_EXISTS';
end;
$function$
;
revoke all on function public.submit_candidacy(uuid,uuid,uuid,text,text,text,text) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
