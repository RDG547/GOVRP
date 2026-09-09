begin;
create or replace function private.check_legal_effect_definition()
returns trigger language plpgsql security definer set search_path='' as $$
declare r public.government_rules%rowtype; ceiling numeric;
begin
 if new.effect_data is null then return new; end if;
 perform private.validate_legal_definition(new.effect_data);
 if new.effect_data->>'executive_rate_adjustment'='true' then
   select * into r from public.government_rules where rule_key=new.effect_key for update;
   select decree_max_value into ceiling from public.legal_authority_rules where capability='executive_rate_adjustment' and decree_allowed;
   if tg_op<>'INSERT' or new.status<>'active' or new.source_kind<>'decree' or new.configured_by is distinct from auth.uid()
     or not exists(select 1 from public.profiles where id=auth.uid() and role in('Admin','Presidente'))
     or r.rule_key is null or not r.is_active or r.rule_kind not in('tax','fee') or r.valid_from>clock_timestamp() or r.valid_until<=clock_timestamp()
     or new.effect_data->>'action'<>'change' or new.effect_data->>'kind'<>r.rule_kind
     or new.effect_data->'definition' is distinct from r.definition or new.previous_snapshot is distinct from to_jsonb(r)
     or new.valid_until is distinct from r.valid_until or ceiling is null or new.effect_value>ceiling
     or not exists(select 1 from public.decrees where id=new.source_id and not is_published and author_id=auth.uid())
   then raise exception 'Este ajuste exige um tributo vigente e autoridade executiva válida.' using errcode='42501'; end if;
   perform private.validate_legal_measure(r.rule_kind,new.effect_data,'bill');
 else perform private.validate_legal_measure(new.effect_data->>'kind',new.effect_data,new.source_kind); end if;
 return new;
end; $$;

create or replace function public.configure_citizen_needs(p_config jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old_cfg jsonb; k text; v numeric;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role='Admin') then raise exception 'Somente a administração pode configurar as necessidades.' using errcode='42501'; end if;
 if jsonb_typeof(p_config) is distinct from 'object' or jsonb_typeof(p_config->'decay_per_rp_day') is distinct from 'object' then raise exception 'Informe uma configuração válida.'; end if;
 if (p_config-array['decay_per_rp_day','offline_decay_cap','offline_floor','grace_rp_days','bath_cooldown_rp_hours','sleep_cooldown_rp_hours','social_daily_cap'])<>'{}'
   or ((p_config->'decay_per_rp_day')-array['hunger','thirst','hygiene','social','sleep'])<>'{}' then raise exception 'Há uma configuração de necessidade desconhecida.'; end if;
 foreach k in array array['hunger','thirst','hygiene','social','sleep'] loop
   v:=(p_config->'decay_per_rp_day'->>k)::numeric;
   if v is null or v::text in('NaN','Infinity','-Infinity') or v<0 or v>10 then raise exception 'O decaimento diário deve ficar entre zero e dez pontos RP.'; end if;
 end loop;
 foreach k in array array['offline_decay_cap','offline_floor','grace_rp_days','bath_cooldown_rp_hours','sleep_cooldown_rp_hours','social_daily_cap'] loop
   v:=(p_config->>k)::numeric;
   if v is null or v::text in('NaN','Infinity','-Infinity') or v<>trunc(v) or v<0 or v>100 then raise exception 'Use valores inteiros de zero a cem.'; end if;
 end loop;
 if (p_config->>'offline_decay_cap')::numeric>30 or (p_config->>'offline_floor')::numeric<30 or (p_config->>'grace_rp_days')::numeric<1
   or (p_config->>'bath_cooldown_rp_hours')::numeric<1 or (p_config->>'sleep_cooldown_rp_hours')::numeric<1 or (p_config->>'social_daily_cap')::numeric>20
 then raise exception 'Preserve a proteção offline, a carência e os limites moderados de recuperação.'; end if;
 select value into old_cfg from public.system_settings where key='citizen_needs' for update;
 update public.system_settings set value=p_config where key='citizen_needs';
 perform economy_private.audit('citizen_needs_configured','system_settings','citizen_needs',old_cfg,p_config,'Configuração das necessidades do cidadão.',auth.uid());
 return p_config;
end; $$;
create or replace function private.guard_citizen_world_settings()
returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in('postgres','supabase_admin','service_role') then if tg_op='DELETE' then return old; else return new; end if; end if;
 if coalesce(new.key,old.key)='citizen_needs' then raise exception 'Use a configuração administrativa validada de necessidades.' using errcode='42501'; end if;
 if coalesce(new.key,old.key)='executive_governance' and
    (tg_op='DELETE' or coalesce(new.value->'specialAppointments','{}') is distinct from coalesce(old.value->'specialAppointments','{}')) then
   raise exception 'Use a ação institucional de nomeação ou exoneração.' using errcode='42501';
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end; $$;
create trigger guard_citizen_world_settings before insert or update or delete on public.system_settings for each row execute function private.guard_citizen_world_settings();

create or replace function public.gift_inventory_item(p_inventory_id uuid,p_recipient_cpf text,p_quantity integer)
returns json language plpgsql security definer set search_path='' as $$
declare item public.user_inventory%rowtype; recipient uuid; label text;
begin
 if auth.uid() is null then raise exception 'Autenticação necessária.' using errcode='42501'; end if;
 if p_quantity is null or p_quantity<=0 then raise exception 'A quantidade deve ser maior que zero.'; end if;
 select * into item from public.user_inventory where id=p_inventory_id and user_id=auth.uid() for update;
 if not found or item.quantity<p_quantity then raise exception 'Quantidade indisponível no seu inventário.'; end if;
 if exists(select 1 from public.citizen_residences where inventory_id=item.id) then raise exception 'Imóveis não podem ser presenteados. A transferência imobiliária ainda não está disponível.'; end if;
 select id into recipient from public.profiles where cpf=p_recipient_cpf and onboarding_completed and deleted_at is null;
 if recipient is null or recipient=auth.uid() then raise exception 'Informe o CPF de outro cidadão válido.'; end if;
 update public.user_inventory set quantity=quantity-p_quantity where id=item.id;
 insert into public.user_inventory(user_id,product_id,quantity,metadata)
 values(recipient,item.product_id,p_quantity,coalesce(item.metadata,'{}')||jsonb_build_object('gifted_by',auth.uid(),'source_inventory_id',item.id));
 select name into label from public.products where id=item.product_id;
 insert into public.notifications(user_id,sender_id,type,content,link) values(recipient,auth.uid(),'item_gifted','Você recebeu '||p_quantity||'x '||label||' de presente!','/services/inventory');
 return json_build_object('success',true,'message','Item presenteado com sucesso!');
end; $$;
CREATE OR REPLACE FUNCTION public.save_business_product(p_product_id uuid, p_business_id uuid, p_name text, p_description text, p_price numeric, p_image_url text, p_product_type text, p_subscription_interval text, p_category text, p_stock integer, p_promotion_price numeric, p_promotion_expires_at timestamp with time zone, p_consumable_effects jsonb)
 RETURNS products
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid();v_business public.businesses%rowtype;v_product public.products%rowtype;
begin
  perform private.assert_citizen_service('/services/business');
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if not exists(select 1 from public.profiles where id=v_actor and onboarding_completed and deleted_at is null) then
    raise exception 'CITIZENSHIP_REQUIRED';
  end if;
  if p_business_id is not null then
    select * into v_business from public.businesses where id=p_business_id for share;
    if not found or v_business.owner_id is distinct from v_actor then raise exception 'BUSINESS_OWNERSHIP_REQUIRED'; end if;
    if v_business.status not in('active','pending') then raise exception 'BUSINESS_NOT_ACTIVE'; end if;
    if v_business.bank_account_id is null then raise exception 'BUSINESS_BANK_ACCOUNT_REQUIRED'; end if;
  elsif not exists(select 1 from public.accounts where user_id=v_actor) then
    raise exception 'BANK_ACCOUNT_REQUIRED';
  end if;
  if length(btrim(coalesce(p_name,'')))<3 or length(btrim(coalesce(p_description,'')))<5 then raise exception 'PRODUCT_DETAILS_INCOMPLETE'; end if;
  if p_price is null or p_price<=0 or p_price::text in('NaN','Infinity','-Infinity') then raise exception 'INVALID_PRODUCT_PRICE'; end if;
  if p_product_type is null or p_product_type not in('one-time','subscription') then raise exception 'INVALID_PRODUCT_TYPE'; end if;
  if p_product_type='one-time' and (p_stock is null or p_stock<0 or (p_product_id is null and p_stock<1)) then raise exception 'INVALID_PRODUCT_STOCK'; end if;
  if p_product_type='subscription' and (p_subscription_interval is null or p_subscription_interval not in('7 days','30 days')) then raise exception 'INVALID_SUBSCRIPTION_INTERVAL'; end if;
  if p_promotion_price is not null and (p_promotion_price::text in('NaN','Infinity','-Infinity') or p_promotion_price<=0 or p_promotion_price>=p_price or p_promotion_expires_at is null) then
    raise exception 'INVALID_PROMOTION';
  end if;
  if p_product_id is null then
    insert into public.products(
      seller_id,business_id,name,description,price,image_url,product_type,subscription_interval,
      subscription_price,category,stock,promotion_price,promotion_expires_at,consumable_effects
    ) values(
      v_actor,p_business_id,btrim(p_name),btrim(p_description),p_price,nullif(btrim(coalesce(p_image_url,'')),''),
      p_product_type,case when p_product_type='subscription' then p_subscription_interval end,
      case when p_product_type='subscription' then p_price end,btrim(p_category),
      case when p_product_type='one-time' then p_stock end,p_promotion_price,p_promotion_expires_at,coalesce(p_consumable_effects,'{}')
    ) returning * into v_product;
  else
    update public.products set business_id=p_business_id,name=btrim(p_name),description=btrim(p_description),price=p_price,
      image_url=nullif(btrim(coalesce(p_image_url,'')),''),product_type=p_product_type,
      subscription_interval=case when p_product_type='subscription' then p_subscription_interval end,
      subscription_price=case when p_product_type='subscription' then p_price end,category=btrim(p_category),
      stock=case when p_product_type='one-time' then p_stock end,promotion_price=p_promotion_price,
      promotion_expires_at=p_promotion_expires_at,consumable_effects=coalesce(p_consumable_effects,'{}')
    where id=p_product_id and seller_id=v_actor returning * into v_product;
    if not found then raise exception 'PRODUCT_NOT_FOUND_OR_FORBIDDEN'; end if;
  end if;
  return v_product;
end;
$function$;


CREATE OR REPLACE FUNCTION public.audit_bank_application_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_kind text;
  v_action text;
begin
  if new.status is not distinct from old.status
     or old.status not in ('Pendente','pending')
     or new.status not in ('Aprovado','approved','Rejeitado','rejected') then
    return new;
  end if;

  v_kind := case when tg_table_name='credit_card_applications' then 'cartão' else 'empréstimo' end;
  v_action := case when new.status in ('Aprovado','approved') then 'approved' else 'rejected' end;

  perform economy_private.audit(
    'bank_application_'||v_action,
    tg_table_name,
    new.id::text,
    to_jsonb(old),
    to_jsonb(new),
    coalesce(new.admin_feedback,new.feedback,'Decisão registrada pelo Banco Nacional.'),
    new.reviewed_by
  );

  -- A aprovação de cartão já envia uma notificação enriquecida na RPC.
  if tg_table_name<>'credit_card_applications' or v_action<>'approved' then
    insert into public.notifications(user_id,sender_id,type,content,link,is_read,metadata,created_at)
    values(
      new.user_id,
      new.reviewed_by,
      'bank_'||case when tg_table_name='credit_card_applications' then 'credit' else 'loan' end||'_review',
      'Sua solicitação de '||v_kind||' foi '||case when v_action='approved' then 'aprovada' else 'rejeitada' end||' pelo Banco Nacional.'||case when tg_table_name='loan_applications' and v_action='approved' then format(' Valor: R$ %s. Parcelas: %s. Juros contratados: %s. Total a pagar: R$ %s.', to_jsonb(new)->>'amount',to_jsonb(new)->>'installments',to_jsonb(new)->>'interest_rate',to_jsonb(new)->>'total_due') else '' end||coalesce(' Motivo: '||nullif(coalesce(new.admin_feedback,new.feedback),''),''),
      '/services/bank',
      false,
      jsonb_build_object(
        'application_id',new.id,
        'decision',v_action,
        'feedback',coalesce(new.admin_feedback,new.feedback),'amount',to_jsonb(new)->'amount','installments',to_jsonb(new)->'installments','interest_rate',to_jsonb(new)->'interest_rate','total_due',to_jsonb(new)->'total_due'
      ),
      clock_timestamp()
    );
  end if;

  return new;
end;
$function$;


-- Existing elections keep their current voting period; new elections reserve 25% for nominations.
alter table public.parliament_leadership_elections add column nomination_end_at timestamptz;
update public.parliament_leadership_elections set nomination_end_at=start_at;
alter table public.parliament_leadership_elections alter column nomination_end_at set default clock_timestamp();
alter table public.parliament_leadership_elections alter column nomination_end_at set not null;
create or replace function public.get_active_parliament_member_id(p_user_id uuid,p_house_id uuid)
returns uuid language sql stable security definer set search_path='' as $$
 select m.id from public.parliament_members m join public.profiles p on p.id=m.user_id
 where m.user_id=p_user_id and m.house_id=p_house_id and current_date between m.term_start_date and m.term_end_date
 and p.deleted_at is null and (p.role=public.get_parliament_base_role_label(p_house_id)
 or p.role=public.canonical_official_role(public.get_parliament_leadership_role_label(p_house_id,'president'))
 or p.role=public.canonical_official_role(public.get_parliament_leadership_role_label(p_house_id,'vice_president')))
 order by m.term_end_date desc,m.term_start_date desc limit 1;
$$;
CREATE OR REPLACE FUNCTION public.create_leadership_election(p_house_id uuid, p_position text, p_description text DEFAULT NULL::text, p_duration_hours integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_house_name text;
  v_title text;
  v_election_id uuid;
begin
  if v_user_id is null then
    raise exception 'É necessário estar autenticado.';
  end if;

  if p_position not in ('president', 'vice_president') then
    raise exception 'Posição da eleição inválida.';
  end if;

  if public.get_active_parliament_member_id(v_user_id,p_house_id) is null and not exists(select 1 from public.profiles where id=v_user_id and role='Admin') then
    raise exception 'Somente parlamentares ativos da Casa ou a administração podem abrir a eleição.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_house_id::text||':'||p_position,0));
  if p_duration_hours is null or p_duration_hours not between 1 and 168 then raise exception 'A duração deve ficar entre uma e 168 horas.'; end if;
  perform public.refresh_parliament_leadership_terms();

  if exists (
    select 1
      from public.parliament_leadership_elections
     where house_id = p_house_id
       and position = p_position
       and status = 'open'
  ) then
    raise exception 'Já existe uma eleição aberta para esta posição.';
  end if;

  select name
    into v_house_name
    from public.parliament_houses
   where id = p_house_id;

  v_title := case
    when p_position = 'president' then 'Eleição para Presidente'
    else 'Eleição para Vice-Presidente'
  end || ' - ' || coalesce(v_house_name, 'Casa Legislativa');

  insert into public.parliament_leadership_elections (
    house_id,
    position,
    title,
    description,
    created_by,
    end_at,nomination_end_at
  )
  values (
    p_house_id,
    p_position,
    v_title,
    nullif(btrim(coalesce(p_description, '')), ''),
    v_user_id,
    now() + make_interval(hours => p_duration_hours),now()+make_interval(secs=>p_duration_hours*900)
  )
  returning id into v_election_id;

  return jsonb_build_object(
    'success', true,
    'election_id', v_election_id,
    'message', 'Eleição interna aberta com sucesso.'
  );
end;
$function$

;
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
$function$

;
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

  if v_election.status <> 'open' or clock_timestamp()<v_election.nomination_end_at or clock_timestamp()>=v_election.end_at then
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
$function$

;
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

  if v_vote_total < coalesce(v_active_members, 0)
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
$function$

;

create or replace function public.close_leadership_election(p_election_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare house uuid;
begin
 select house_id into house from public.parliament_leadership_elections where id=p_election_id;
 if auth.uid() is null or (public.get_active_parliament_member_id(auth.uid(),house) is null and not exists(select 1 from public.profiles where id=auth.uid() and role='Admin')) then raise exception 'Somente parlamentares ativos da Casa podem apurar esta eleição.' using errcode='42501'; end if;
 return private.conclude_leadership_election(p_election_id);
end; $$;
create or replace function private.process_due_leadership_elections()
returns integer language plpgsql security definer set search_path='' as $$
declare e record; total integer:=0;
begin
 for e in select id from public.parliament_leadership_elections where status='open' and end_at<=clock_timestamp() order by end_at for update skip locked loop
   begin perform private.conclude_leadership_election(e.id); total:=total+1;
   exception when others then raise warning 'Falha ao apurar eleição %: %',e.id,sqlerrm; end;
 end loop;
 return total;
end; $$;
select cron.schedule('parliament-leadership-due','10 seconds','select private.process_due_leadership_elections()');

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
 (n.nspname='private' and p.proname in('check_legal_effect_definition','guard_citizen_world_settings','conclude_leadership_election','process_due_leadership_elections'))
 or (n.nspname='public' and p.proname in('configure_citizen_needs','gift_inventory_item','save_business_product','create_leadership_election','nominate_leadership_candidate','cast_leadership_vote','close_leadership_election','get_active_parliament_member_id','audit_bank_application_decision')) loop
 execute format('alter function %s owner to postgres',f.signature);
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 end loop;
end; $$;
grant execute on function public.configure_citizen_needs(jsonb),public.gift_inventory_item(uuid,text,integer),public.save_business_product(uuid,uuid,text,text,numeric,text,text,text,text,integer,numeric,timestamptz,jsonb),public.save_business_product(uuid,uuid,text,text,numeric,text,text,text,text,integer,numeric,timestamptz),public.create_leadership_election(uuid,text,text,integer),public.nominate_leadership_candidate(uuid,uuid,text),public.cast_leadership_vote(uuid,uuid),public.close_leadership_election(uuid),public.get_active_parliament_member_id(uuid,uuid) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
