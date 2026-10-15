begin;
-- Technical administration survives appointments, elections and character resets.
create table private.platform_admins(user_id uuid primary key references public.profiles(id) on delete cascade,granted_at timestamptz not null default clock_timestamp(),granted_by uuid references public.profiles(id) on delete set null);
alter table private.platform_admins enable row level security;
revoke all on private.platform_admins from public,anon,authenticated;
insert into private.platform_admins(user_id) select id from public.profiles where role='Admin' and deleted_at is null;
create or replace function public.is_admin(p_user_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=p_user_id and p.deleted_at is null and (p.role='Admin' or exists(select 1 from private.platform_admins a where a.user_id=p.id)));
$$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$select public.is_admin(auth.uid());$$;
revoke all on function public.is_admin(uuid),public.is_admin() from public,anon;
grant execute on function public.is_admin(uuid),public.is_admin() to authenticated,service_role;
-- This function is only for authorization. get_user_role remains the canonical RP role.
create or replace function public.get_authority_role(p_user_id uuid) returns text language sql stable security definer set search_path='' as $$
 select case when public.is_admin(p_user_id) then 'Admin' else public.get_user_role(p_user_id) end;
$$;
revoke all on function public.get_authority_role(uuid) from public,anon,authenticated;

create table private.admin_development_modes(user_id uuid primary key references public.profiles(id) on delete cascade,mode text not null default 'normal' check(mode in('normal','total','simulate')),simulated_role text,execute_real boolean not null default false,updated_at timestamptz not null default clock_timestamp());
alter table private.admin_development_modes enable row level security;
revoke all on private.admin_development_modes from public,anon,authenticated;
create or replace function public.get_admin_development_state() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_admin(auth.uid()) then return jsonb_build_object('is_platform_admin',false,'mode','normal','execute_real',false);end if;
 return jsonb_build_object('is_platform_admin',true,'mode','normal','execute_real',false)||coalesce((select jsonb_build_object('mode',mode,'simulated_role',simulated_role,'execute_real',execute_real) from private.admin_development_modes where user_id=auth.uid()),'{}');
end $$;
revoke all on function public.get_admin_development_state() from public,anon;
grant execute on function public.get_admin_development_state() to authenticated;
create or replace function public.set_admin_development_mode(p_mode text,p_simulated_role text default null,p_execute_real boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin(auth.uid()) then raise exception 'Somente administradores podem utilizar o modo de desenvolvimento.' using errcode='42501';end if;
 if p_mode is null or p_mode not in('normal','total','simulate') then raise exception 'Selecione um modo válido.';end if;
 if p_mode='simulate' and (p_simulated_role is null or p_simulated_role not in('Cidadão','Presidente','Vice-Presidente','Deputado','Senador','Policial','Delegado','Promotor','Juiz','Ministro','Empresário','Agente Secreto','Militar','Presidente do STF','Presidente do Banco Nacional','Presidente do Portal Eleitoral')) then raise exception 'Selecione um cargo válido para simular.';end if;
 if coalesce(p_execute_real,false) and p_mode<>'total' then raise exception 'A execução administrativa real exige Acesso Total.';end if;
 insert into private.admin_development_modes(user_id,mode,simulated_role,execute_real) values(auth.uid(),p_mode,case when p_mode='simulate' then p_simulated_role end,coalesce(p_execute_real,false))
 on conflict(user_id) do update set mode=excluded.mode,simulated_role=excluded.simulated_role,execute_real=excluded.execute_real,updated_at=clock_timestamp();
 insert into public.security_audit_log(action,target_table,target_id,actor_id,actor_role,metadata)
 values('admin_development_mode_changed','admin_development_modes',auth.uid()::text,auth.uid(),'Admin',jsonb_build_object('mode',p_mode,'simulated_role',p_simulated_role,'impacts_production',false,'execution',case when p_execute_real then 'real_enabled' else 'preview' end));
 return public.get_admin_development_state();
end $$;
revoke all on function public.set_admin_development_mode(text,text,boolean) from public,anon;
grant execute on function public.set_admin_development_mode(text,text,boolean) to authenticated;

create or replace function public.assert_admin_real_action(p_actor_id uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if current_user is null then return false;end if;
 if exists(select 1 from private.admin_development_modes where user_id=p_actor_id and mode<>'normal' and not execute_real) then raise exception 'Você está em pré-visualização. Nenhuma ação real foi executada.' using errcode='42501';end if;
 return true;
end $$;
revoke all on function public.assert_admin_real_action(uuid) from public,anon,authenticated;
grant execute on function public.assert_admin_real_action(uuid) to service_role;

create or replace function private.audit_admin_world_write() returns trigger language plpgsql security definer set search_path='' as $$
declare mode_name text; real_enabled boolean;target jsonb;
begin
 if auth.uid() is not null and public.is_admin(auth.uid()) then
  select mode,execute_real into mode_name,real_enabled from private.admin_development_modes where user_id=auth.uid();
  if coalesce(mode_name,'normal')<>'normal' and not coalesce(real_enabled,false) then raise exception 'Você está em pré-visualização. Nenhuma ação real foi executada.' using errcode='42501';end if;
  target:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into public.security_audit_log(action,target_table,target_id,actor_id,actor_role,metadata)
  values('admin_real_'||lower(tg_op),tg_table_name,coalesce(target->>'id',target->>'user_id',target->>'business_id'),auth.uid(),'Admin',jsonb_build_object('mode',coalesce(mode_name,'normal'),'execution','real','impacts_production',true,'schema',tg_table_schema));
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function private.audit_admin_world_write() from public,anon,authenticated;
do $$declare t record;begin
 for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','p') and not c.relispartition and c.relname<>'security_audit_log' loop
  execute format('create trigger audit_admin_world_write before insert or update or delete on public.%I for each row execute function private.audit_admin_world_write()',t.relname);
 end loop;
end $$;

-- Existing administrative entry points use independent technical membership.
CREATE OR REPLACE FUNCTION private.assert_reset_admin()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid := auth.uid();
begin
  if v_id is null or not exists (
    select 1 from public.profiles where id=v_id and public.is_admin(id) and deleted_at is null
  ) then raise exception 'Apenas administradores ativos podem resetar o RP.' using errcode='42501'; end if;
  perform public.assert_admin_real_action(v_id);
  return v_id;
end; $function$
;

CREATE OR REPLACE FUNCTION public.is_house_presiding_authority(p_actor uuid, p_house_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.get_authority_role(p_actor)='Admin' or exists(
    select 1 from public.parliament_leadership_terms term join public.parliament_members member on member.id=term.member_id
    where term.house_id=p_house_id and term.position='president' and term.status='active' and term.term_start_date<=current_date and term.term_end_date>=current_date and member.user_id=p_actor
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_parliament_governance_manager(p_user_id uuid, p_house_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with profile_role as (
    select id,role
      from public.profiles
     where id = p_user_id
  )
  select exists (
    select 1
      from profile_role
     where (public.is_admin(id) or role in ('Admin', 'Presidente'))
  )
  or private.is_house_president(p_user_id,p_house_id)
  or exists (
    select 1
      from public.parliament_leadership_terms plt
      join public.parliament_members pm
        on pm.id = plt.member_id
     where pm.user_id = p_user_id
       and pm.house_id = p_house_id
       and pm.term_end_date >= current_date
       and plt.house_id = p_house_id
       and plt.status = 'active'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_national_bank_manager(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_user_id is not null
    and (
      exists (
        select 1
        from public.profiles as profile
        where profile.id = p_user_id
          and (public.is_admin(profile.id) or profile.role in (
            'Admin',
            'Presidente',
            'Presidente do Banco Nacional'
          ))
      )
      or exists (
        select 1
        from public.system_settings as setting
        where setting.key = 'executive_governance'
          and setting.value
            -> 'specialAppointments'
            -> 'national_bank_president'
            ->> 'user_id' = p_user_id::text
      )
    );
$function$
;

CREATE OR REPLACE FUNCTION private.assert_electoral_management()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and deleted_at is null and (public.is_admin(id) or role in('Admin','Presidente do Portal Eleitoral'))) then raise exception 'Esta função exige autoridade de gestão eleitoral.' using errcode='42501'; end if;
end; $function$
;

CREATE OR REPLACE FUNCTION public.get_account_transactions(p_account_id uuid)
 RETURNS TABLE(id uuid, created_at timestamp with time zone, type text, amount double precision, description text, metadata jsonb, direction text, other_party_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select t.id,t.created_at,t.type,t.amount::double precision,t.description,t.metadata,
    case when t.from_account_id=p_account_id then 'sent' else 'received' end,
    case when t.from_account_id=p_account_id then receiver.full_name else sender.full_name end
  from public.transactions t
  left join public.accounts sa on sa.id=t.from_account_id left join public.profiles sender on sender.id=sa.user_id
  left join public.accounts ra on ra.id=t.to_account_id left join public.profiles receiver on receiver.id=ra.user_id
  where (t.from_account_id=p_account_id or t.to_account_id=p_account_id)
    and exists(select 1 from public.accounts own where own.id=p_account_id and (own.user_id=auth.uid() or public.get_authority_role(auth.uid())='Admin'))
  order by t.created_at desc;
$function$
;

CREATE OR REPLACE FUNCTION public.run_currency_market_cycle(p_cycle_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role'
     and not exists(select 1 from public.profiles where id=auth.uid() and public.is_admin(id) and deleted_at is null) then
    raise exception 'CURRENCY_MARKET_ADMIN_REQUIRED';
  end if;
  return public.recalculate_currency_market('BR',p_cycle_key,true);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_parliament_access_data(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    user_profile RECORD;
    member_record RECORD;
    house_record RECORD;
    is_admin BOOLEAN;
    default_house_id uuid;
BEGIN
    -- Obter o perfil do usuário para verificar o cargo
    SELECT role, id INTO user_profile FROM public.profiles WHERE id = p_user_id;

    IF user_profile IS NULL THEN
        RETURN jsonb_build_object('has_access', false, 'reason', 'Perfil não encontrado.');
    END IF;

    is_admin := (public.is_admin(user_profile.id));

    -- Tentar encontrar uma associação na tabela de membros do parlamento
    SELECT pm.*, ph.id as house_id, ph.name as house_name, ph.description as house_description
    INTO member_record
    FROM public.parliament_members pm
    JOIN public.parliament_houses ph ON pm.house_id = ph.id
    WHERE pm.user_id = p_user_id;

    -- Se não for admin E não for membro do parlamento, negar acesso
    IF NOT is_admin AND member_record IS NULL THEN
        RETURN jsonb_build_object('has_access', false, 'reason', 'Não é membro do parlamento.');
    END IF;

    IF member_record IS NOT NULL THEN
        house_record := member_record;
    ELSE
        -- Não é membro; como é admin, atribuir uma house padrão
        -- Escolhe a primeira house disponível como padrão (ajuste conforme necessário)
        SELECT id AS house_id, name AS house_name, description AS house_description
        INTO house_record
        FROM public.parliament_houses
        ORDER BY id
        LIMIT 1;

        -- Se não existir house no sistema, retornar erro controlado
        IF house_record IS NULL THEN
            RETURN jsonb_build_object('has_access', false, 'reason', 'Nenhuma casa configurada para servir como padrão.');
        END IF;
    END IF;

    -- Se chegou até aqui, o acesso é permitido. Retornar os dados consolidados.
    RETURN jsonb_build_object(
        'has_access', true,
        'is_admin', is_admin,
        'member', to_jsonb(member_record),
        'house', jsonb_build_object(
            'id', house_record.house_id,
            'name', house_record.house_name,
            'description', house_record.house_description
        )
    );

EXCEPTION
    WHEN others THEN
        RETURN jsonb_build_object('has_access', false, 'reason', 'Erro inesperado no servidor: ' || SQLERRM);
END;
$function$
;

CREATE OR REPLACE FUNCTION private.check_legal_effect_definition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.government_rules%rowtype; ceiling numeric;
begin
 if new.effect_data is null then return new; end if;
 perform private.validate_legal_definition(new.effect_data);
 if new.effect_data->>'executive_rate_adjustment'='true' then
   select * into r from public.government_rules where rule_key=new.effect_key for update;
   select decree_max_value into ceiling from public.legal_authority_rules where capability='executive_rate_adjustment' and decree_allowed;
   if tg_op<>'INSERT' or new.status<>'active' or new.source_kind<>'decree' or new.configured_by is distinct from auth.uid()
     or not exists(select 1 from public.profiles where id=auth.uid() and (public.is_admin(id) or role in('Admin','Presidente')))
     or r.rule_key is null or not r.is_active or r.rule_kind not in('tax','fee') or r.valid_from>clock_timestamp() or r.valid_until<=clock_timestamp()
     or new.effect_data->>'action'<>'change' or new.effect_data->>'kind'<>r.rule_kind
     or (new.effect_data->'definition')-'nature' is distinct from r.definition-'nature' or new.previous_snapshot is distinct from to_jsonb(r)
     or new.valid_until is distinct from r.valid_until or ceiling is null or new.effect_value>ceiling
     or not exists(select 1 from public.decrees where id=new.source_id and not is_published and author_id=auth.uid())
   then raise exception 'Este ajuste exige um tributo vigente e autoridade executiva válida.' using errcode='42501'; end if;
   perform private.validate_legal_measure(r.rule_kind,new.effect_data,'bill');
 else perform private.validate_legal_measure(new.effect_data->>'kind',new.effect_data,new.source_kind); end if;
 return new;
end; $function$
;

CREATE OR REPLACE FUNCTION private.guard_institutional_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if (case when tg_op='DELETE' then old.key else new.key end) <> 'parliament_institutional_rules' and (tg_op<>'UPDATE' or old.key<>'parliament_institutional_rules') then return coalesce(new,old); end if;
 if tg_op='UPDATE' and new.key is distinct from old.key then raise exception 'A chave da regra institucional não pode ser alterada.'; end if;
 if auth.uid() is not null and not coalesce(public.get_authority_role(auth.uid())='Admin',false) then raise exception 'Somente Admin pode configurar as regras institucionais do RP.' using errcode='42501'; end if;
 if tg_op='DELETE' then raise exception 'A configuração institucional não pode ser apagada.'; end if;
 if jsonb_typeof(new.value->'impeachment_approval_numerator')<>'number' or jsonb_typeof(new.value->'impeachment_approval_denominator')<>'number'
 or not coalesce((new.value->>'impeachment_approval_numerator')::integer between 1 and 100 and (new.value->>'impeachment_approval_denominator')::integer between 1 and 100
 and (new.value->>'impeachment_approval_numerator')::numeric/(new.value->>'impeachment_approval_denominator')::numeric>0.5
 and (new.value->>'impeachment_approval_numerator')::integer<=(new.value->>'impeachment_approval_denominator')::integer
 and (new.value->>'impeachment_duration_hours')::numeric between 1 and 168,false) then raise exception 'Configure maioria qualificada válida e prazo entre 1 e 168 horas.'; end if;
 if new.value->'succession_roles' is distinct from '["Vice-Presidente","Presidente da Câmara dos Deputados","Presidente do Senado","Presidente do STF"]'::jsonb then raise exception 'A sucessão segue Vice, Câmara, Senado e STF.'; end if;
 return new;
end $function$
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

  if not coalesce(public.get_authority_role(auth.uid())='Admin',false) and v_vote_total < coalesce(v_active_members, 0)
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

CREATE OR REPLACE FUNCTION public.approve_plebiscite(p_plebiscite_id uuid, p_house_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    current_user_id UUID := auth.uid();
    plebiscite_info RECORD;
BEGIN
    IF NOT (get_authority_role(current_user_id) = ANY(ARRAY['Admin', 'Deputado', 'Senador'])) THEN
        RETURN json_build_object('success', false, 'message', 'Você não tem permissão para aprovar plebiscitos.');
    END IF;

    SELECT * INTO plebiscite_info FROM public.plebiscites WHERE id = p_plebiscite_id AND status = 'Pendente';

    IF plebiscite_info IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Plebiscito não encontrado ou já processado.');
    END IF;

    UPDATE public.plebiscites
    SET
        status = 'Ativo',
        approved_by_house_id = p_house_id,
        start_date = now(),
        end_date = now() + interval '7 days'
    WHERE id = p_plebiscite_id;

    RETURN json_build_object('success', true, 'message', 'Plebiscito aprovado e enviado para votação popular.');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_transaction_receipt(p_transaction_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    receipt_data RECORD;
    current_user_id UUID := auth.uid();
    is_involved BOOLEAN;
    is_admin_user BOOLEAN;
    seller_cnpj_details JSONB;
    recipient_user_id UUID;
    total_amount NUMERIC;
BEGIN
    SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = current_user_id AND public.is_admin(id)) INTO is_admin_user;

    SELECT EXISTS (
        SELECT 1
        FROM public.transactions t
        LEFT JOIN public.accounts a_from ON t.from_account_id = a_from.id
        LEFT JOIN public.accounts a_to ON t.to_account_id = a_to.id
        WHERE t.id = p_transaction_id AND (a_from.user_id = current_user_id OR a_to.user_id = current_user_id)
    ) INTO is_involved;

    IF NOT is_involved AND NOT is_admin_user THEN
        RETURN jsonb_build_object('success', false, 'message', 'Você não tem permissão para ver este comprovante.');
    END IF;

    SELECT
        t.id,
        t.amount, -- This is the base amount
        t.description,
        t.type,
        t.created_at,
        t.metadata,
        CASE WHEN sender_acc.user_id=current_user_id THEN 'sent' ELSE 'received' END AS direction,
        COALESCE((t.metadata->>'tax_amount')::numeric, 0) as tax_amount, -- get tax from metadata
        sender_p.full_name as sender_name,
        sender_p.role as sender_role,
        sender_acc.transfer_key as sender_key,
        sender_acc.cpf as sender_cpf,
        sender_acc.agency_number as sender_agency,
        sender_acc.account_number as sender_account,
        recipient_p.full_name as recipient_name,
        recipient_p.role as recipient_role,
        recipient_acc.transfer_key as recipient_key,
        recipient_acc.cpf as recipient_cpf,
        recipient_acc.agency_number as recipient_agency,
        recipient_acc.account_number as recipient_account,
        recipient_acc.user_id as recipient_user_id
    INTO receipt_data
    FROM public.transactions t
    LEFT JOIN public.accounts sender_acc ON t.from_account_id = sender_acc.id
    LEFT JOIN public.profiles sender_p ON sender_acc.user_id = sender_p.id
    LEFT JOIN public.accounts recipient_acc ON t.to_account_id = recipient_acc.id
    LEFT JOIN public.profiles recipient_p ON recipient_acc.user_id = recipient_p.id
    WHERE t.id = p_transaction_id;

    IF receipt_data IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Comprovante não encontrado.');
    END IF;

    total_amount := coalesce((receipt_data.metadata->>'total_debited')::numeric,receipt_data.amount);

    IF receipt_data.recipient_role = 'PJ' THEN
        SELECT jsonb_build_object(
            'cnpj', d.document_number,
            'business_name', d.metadata->>'business_name',
            'trade_name', d.metadata->>'trade_name'
        )
        INTO seller_cnpj_details
        FROM public.documents d
        WHERE d.user_id = receipt_data.recipient_user_id
        AND d.type = 'CNPJ'
        LIMIT 1;

        receipt_data.metadata := jsonb_set(COALESCE(receipt_data.metadata, '{}'::jsonb), '{seller_cnpj_details}', seller_cnpj_details);
    END IF;

    RETURN jsonb_build_object('success', true, 'total_amount', total_amount) || jsonb_strip_nulls(to_jsonb(receipt_data));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.configure_parliament_institutional_rules(p_config jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare prior jsonb;
begin
 if not coalesce(public.get_authority_role(auth.uid())='Admin',false) then raise exception 'Somente Admin pode configurar as regras institucionais do RP.' using errcode='42501'; end if;
 select value into prior from public.system_settings where key='parliament_institutional_rules' for update;
 update public.system_settings set value=p_config,updated_at=clock_timestamp() where key='parliament_institutional_rules';
 perform public.justice_write_audit('parliament.rules_changed','system_settings',null,prior,p_config,'Configuração institucional; propostas existentes preservam as regras do protocolo.');
 return p_config;
end $function$
;

CREATE OR REPLACE FUNCTION public.propose_decree_suspension(p_decree_id uuid, p_house_id uuid, p_reason text)
 RETURNS bills
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE d public.decrees%rowtype; b public.bills%rowtype;
BEGIN
 IF NOT coalesce(public.get_authority_role(auth.uid())='Admin',false) AND public.get_active_parliament_member_id(auth.uid(),p_house_id) IS NULL THEN RAISE EXCEPTION 'PARLIAMENT_AUTHORITY_REQUIRED'; END IF;
 IF length(btrim(coalesce(p_reason,'')))<40 THEN RAISE EXCEPTION 'LEGAL_TEXT_REQUIRED'; END IF;
 SELECT * INTO d FROM public.decrees WHERE id=p_decree_id AND is_published AND revoked_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'LEGAL_SOURCE_NOT_FOUND'; END IF;
 b:=public.propose_parliament_bill('Sustação do decreto: '||d.title,p_reason,
   'Art. 1º. Fica sustado o decreto '||d.title||'. Art. 2º. Cessam seus efeitos sobre novas operações, preservado o histórico. Justificativa: '||p_reason,'PDL',p_house_id);
 UPDATE public.bills SET suspends_decree_id=d.id WHERE id=b.id RETURNING * INTO b;
 RETURN b;
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_admin_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_identity jsonb;
  v_anonymous_key text := replace(p_user_id::text, '-', '');
  v_snapshot_id uuid;
begin
  if public.get_authority_role(v_admin_id) <> 'Admin' then
    raise exception 'Acesso negado: apenas administradores podem remover contas.';
  end if;

  if p_user_id is null or p_user_id = v_admin_id then
    raise exception 'A conta administrativa em uso não pode ser removida.';
  end if;

  select * into v_profile
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'message', 'Usuário não encontrado.');
  end if;

  if v_profile.deleted_at is not null then
    return jsonb_build_object('success', true, 'message', 'Esta conta já foi removida e anonimizada.');
  end if;

  select to_jsonb(identity_row) into v_identity
  from private.account_identities identity_row
  where identity_row.user_id = p_user_id;

  insert into private.deleted_user_snapshots (
    deleted_user_id,
    deleted_by,
    profile_snapshot,
    account_identity_snapshot,
    preservation_summary,
    reason
  ) values (
    p_user_id,
    v_admin_id,
    to_jsonb(v_profile),
    v_identity,
    jsonb_build_object(
      'economic_events', (select count(*) from public.economic_events where actor_profile_id = p_user_id),
      'bills', (select count(*) from public.bills where author_id = p_user_id),
      'documents', coalesce((
        select jsonb_agg(to_jsonb(document_row) order by document_row.created_at)
        from public.documents document_row
        where document_row.user_id = p_user_id
      ), '[]'::jsonb),
      'notifications_preserved', true,
      'legal_history_preserved', true,
      'profile_id_preserved', true
    ),
    'Remoção administrativa com preservação de histórico'
  )
  returning id into v_snapshot_id;

  -- Revoke every live authentication path without deleting auth.users. Keeping
  -- that row preserves the profiles FK and therefore all immutable ledgers.
  delete from auth.refresh_tokens where user_id::text = p_user_id::text;
  delete from auth.sessions where user_id = p_user_id;
  delete from auth.identities where user_id = p_user_id;

  if to_regclass('auth.mfa_factors') is not null then
    execute 'delete from auth.mfa_factors where user_id = $1' using p_user_id;
  end if;

  update auth.users
  set email = 'removed-' || v_anonymous_key || '@accounts.invalid',
      phone = null,
      encrypted_password = encode(extensions.gen_random_bytes(48), 'hex'),
      raw_user_meta_data = jsonb_build_object('account_removed', true),
      raw_app_meta_data = jsonb_build_object('provider', 'removed', 'providers', jsonb_build_array()),
      banned_until = 'infinity'::timestamptz,
      updated_at = clock_timestamp()
  where id = p_user_id;

  update private.account_identities
  set real_full_name = null,
      real_date_of_birth = null,
      email = null,
      phone = null,
      phone_country_code = null,
      updated_at = clock_timestamp()
  where user_id = p_user_id;

  update public.profiles
  set username = 'removed_' || left(v_anonymous_key, 12),
      full_name = 'Cidadão removido',
      phone = null,
      avatar_url = null,
      date_of_birth = null,
      rg = null,
      cpf = null,
      email = null,
      x_username = null,
      x_handle = null,
      x_bio = null,
      x_header_url = null,
      x_avatar_url = null,
      titles = '{}'::text[],
      marital_status = null,
      occupation = null,
      education_level = null,
      ui_preferences = '{}'::jsonb,
      party_affiliation = null,
      manual_role_override = false,
      role_assigned_at = null,
      role_assigned_by = null,
      role = 'Usuário',
      country_code = null,
      country_name = null,
      state_code = null,
      state_name = null,
      titulo_eleitor = null,
      carteira_trabalho = null,
      character_bio = null,
      birth_country_code = null,
      birth_country_name = null,
      birth_state_code = null,
      birth_state_name = null,
      birth_city_code = null,
      birth_city_name = null,
      residence_country_code = null,
      residence_country_name = null,
      residence_state_code = null,
      residence_state_name = null,
      residence_city_code = null,
      residence_city_name = null,
      initial_aspiration = null,
      onboarding_completed = false,
      onboarding_step = 'welcome',
      deleted_at = clock_timestamp(),
      anonymized_at = clock_timestamp(),
      deletion_reason = 'Remoção administrativa',
      updated_at = clock_timestamp()
  where id = p_user_id;

  -- Banking records remain auditable, but their live credentials cannot be
  -- used to locate or transact with the removed account.
  update public.accounts
  set transfer_key = null,
      cpf = null,
      agency_number = 'REM',
      account_number = 'REM-' || left(v_anonymous_key, 16),
      updated_at = clock_timestamp()
  where user_id = p_user_id;

  update public.cards set is_active = false where user_id = p_user_id;

  update public.documents
  set document_number = 'REM-' || left(replace(id::text, '-', ''), 20),
      is_valid = false,
      metadata = jsonb_build_object('account_removed', true),
      qr_code_data = null,
      history = null,
      full_name = 'Cidadão removido'
  where user_id = p_user_id;

  if to_regclass('public.support_tickets') is not null then
    execute $redact$
      update public.support_tickets
      set requester_name = 'Cidadão removido',
          requester_email = 'removed@accounts.invalid',
          requester_phone = null,
          updated_at = clock_timestamp()
      where requester_id = $1
    $redact$ using p_user_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'message', 'Conta removida. Dados pessoais e acessos foram apagados; os registros históricos permaneceram preservados.',
    'snapshot_id', v_snapshot_id,
    'preserved_profile_id', p_user_id
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.transfer_party_ownership(p_party_id uuid, p_new_founder_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := auth.uid(); old_owner uuid; party_name text;
begin
  select owner_id, name into old_owner, party_name from public.political_parties where id = p_party_id for update;
  if old_owner is null then return json_build_object('success', false, 'message', 'Partido não encontrado.'); end if;
  if actor <> old_owner and public.get_authority_role(actor) <> 'Admin' then
    return json_build_object('success', false, 'message', 'Apenas o dono pode transferir a propriedade do partido.');
  end if;
  if p_new_founder_id = old_owner then return json_build_object('success', true, 'message', 'O membro indicado já é o dono.'); end if;
  if not exists (select 1 from public.party_members where party_id=p_party_id and user_id=p_new_founder_id) then
    return json_build_object('success', false, 'message', 'O novo dono precisa ser membro do partido.');
  end if;

  update public.political_parties set owner_id=p_new_founder_id where id=p_party_id;
  update public.party_members set role='Membro' where party_id=p_party_id and user_id=old_owner;
  update public.party_members set role='Dono' where party_id=p_party_id and user_id=p_new_founder_id;
  insert into public.party_history(party_id,actor_id,event_type,summary,previous_state,current_state)
  values(p_party_id,actor,'ownership_transferred','Propriedade partidária transferida.',jsonb_build_object('ownerId',old_owner),jsonb_build_object('ownerId',p_new_founder_id));
  return json_build_object('success', true, 'message', 'Propriedade do partido transferida. O fundador histórico foi preservado.');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_minister_impact(p_minister_id uuid, p_summary text, p_reputation_delta numeric, p_performance_delta numeric, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS ministers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); result public.ministers%rowtype;
begin
  if public.get_authority_role(actor) not in('Presidente','Admin') and not exists(select 1 from public.ministers where user_id=actor and id=p_minister_id and status='active') then raise exception 'Sem permissão para registrar impacto ministerial.'; end if;
  if length(trim(coalesce(p_summary,'')))<10 then raise exception 'Descreva o impacto.'; end if;
  update public.ministers set reputation_score=least(100,greatest(0,reputation_score+p_reputation_delta)),performance_score=least(100,greatest(0,performance_score+p_performance_delta)) where id=p_minister_id and status='active' returning * into result;
  if result.id is null then raise exception 'Ministro ativo não encontrado.'; end if;
  insert into public.minister_history(minister_profile_id,ministry_id,event_type,summary,reputation_delta,performance_delta,actor_id,metadata)
  values(result.user_id,result.ministry_id,'impact',trim(p_summary),p_reputation_delta,p_performance_delta,actor,coalesce(p_metadata,'{}'));
  perform public.apply_government_impact('politics','minister_impact',trim(p_summary),p_reputation_delta/5,p_performance_delta/10,'ministers',result.id::text,p_metadata);
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.call_extraordinary_election()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE g uuid;
BEGIN
 IF auth.uid() IS NULL OR coalesce(public.get_authority_role(auth.uid()),'') NOT IN ('Presidente','Admin') THEN RAISE EXCEPTION 'A convocação exige a chefia do Executivo.' USING errcode='42501'; END IF;
 SELECT id INTO g FROM public.government_terms WHERE ended_at IS NULL;
 RETURN private.call_extraordinary_election(g);
END; $function$
;

CREATE OR REPLACE FUNCTION public.admin_forgive_debt(p_target_type text, p_user_id uuid DEFAULT NULL::uuid, p_loan_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
    admin_user_id UUID := auth.uid();
BEGIN
    IF NOT public.is_admin(admin_user_id) THEN
        RETURN json_build_object('success', false, 'message', 'Apenas administradores podem executar esta ação.');
    END IF;

    IF p_target_type = 'government' THEN
        UPDATE public.government_finances SET loans_balance = 0 WHERE id = 1;
        RETURN json_build_object('success', true, 'message', 'Dívida de empréstimos do governo perdoada.');
    ELSIF p_target_type = 'user' THEN
        IF p_loan_id IS NULL THEN
            RETURN json_build_object('success', false, 'message', 'ID do empréstimo do usuário é necessário.');
        END IF;

        UPDATE public.loans SET status = 'Perdoado', amount = 0 WHERE id = p_loan_id AND user_id = p_user_id;

        IF NOT FOUND THEN
            RETURN json_build_object('success', false, 'message', 'Empréstimo não encontrado para o usuário especificado.');
        END IF;

        RETURN json_build_object('success', true, 'message', 'Dívida do usuário perdoada com sucesso.');
    ELSE
        RETURN json_build_object('success', false, 'message', 'Tipo de alvo inválido. Use "government" ou "user".');
    END IF;
EXCEPTION
    WHEN others THEN
        RETURN json_build_object('success', false, 'message', 'Ocorreu um erro inesperado.');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.contract_government_media(p_outlet_id uuid, p_amount numeric, p_purpose text, p_duration_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); outlet public.media_outlets%rowtype; legitimacy text; risk numeric; expense uuid; contract public.government_media_contracts%rowtype;
begin
  if public.get_authority_role(actor) not in('Presidente','Admin') then raise exception 'Apenas a Presidência pode autorizar publicidade institucional.'; end if;
  if p_amount<=0 or length(trim(coalesce(p_purpose,'')))<20 then raise exception 'Valor e finalidade detalhada são obrigatórios.'; end if;
  select * into outlet from public.media_outlets where id=p_outlet_id and is_active for update;
  if not found then raise exception 'Veículo indisponível.'; end if;
  select case when p_amount>treasury_balance*.02 then 90 when p_amount>treasury_balance*.005 then 65 else 20 end into risk from public.government_finances where id=1 for update;
  legitimacy:=case when risk>=80 then 'corruption_risk' when risk>=50 then 'suspicious' else 'institutional' end;
  update public.government_finances set treasury_balance=treasury_balance-p_amount,updated_at=clock_timestamp() where id=1 and treasury_balance>=p_amount;
  if not found then raise exception 'Saldo do Tesouro insuficiente.'; end if;
  insert into public.government_expenditures(expenditure_type,source_table,source_id,amount,occurred_at_rp,metadata)
  values('administration','government_media_contracts',gen_random_uuid()::text,p_amount,public.rp_now(),jsonb_build_object('purpose',trim(p_purpose),'outletId',p_outlet_id,'legitimacy',legitimacy)) returning id into expense;
  insert into public.government_media_contracts(outlet_id,amount,purpose,legitimacy,risk_score,authorized_by,expenditure_id,ends_at)
  values(p_outlet_id,p_amount,trim(p_purpose),legitimacy,risk,actor,expense,clock_timestamp()+make_interval(days=>greatest(1,p_duration_days))) returning * into contract;
  if legitimacy<>'institutional' then perform public.apply_government_impact('integrity','media_contract_risk','Contrato de mídia sob risco de favorecimento.',case when legitimacy='corruption_risk' then -4 else -1 end,0,'government_media_contracts',contract.id::text,jsonb_build_object('riskScore',risk)); end if;
  return jsonb_build_object('contract',to_jsonb(contract),'classification',legitimacy,'riskScore',risk);
end; $function$
;

CREATE OR REPLACE FUNCTION public.publish_media_coverage(p_event_type text, p_event_id text, p_title text, p_facts text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare outlet public.media_outlets%rowtype; framing_text text; published_count int:=0;
begin
  if public.get_authority_role(auth.uid()) not in('Admin','Presidente') then raise exception 'Sem permissão para distribuir pauta institucional.'; end if;
  if length(trim(coalesce(p_facts,'')))<20 then raise exception 'Informe os fatos verificáveis da pauta.'; end if;
  for outlet in select * from public.media_outlets where is_active loop
    framing_text:=case outlet.editorial_profile
      when 'governista' then 'O governo destaca os resultados e a continuidade da medida.'
      when 'oposicao' then 'A oposição questiona custos, riscos e promessas ainda não comprovadas.'
      when 'sensacionalista' then 'A repercussão cresce em meio a disputas e forte reação pública.'
      else 'O veículo apresenta fatos, contexto e contrapontos disponíveis.' end;
    insert into public.news_articles(author_id,title,content,outlet_id,framing,source_event_type,source_event_id)
    values(outlet.editor_id,p_title,trim(p_facts)||E'\n\n'||framing_text,outlet.id,outlet.editorial_profile,p_event_type,p_event_id);
    published_count:=published_count+1;
  end loop;
  return published_count;
end; $function$
;

CREATE OR REPLACE FUNCTION public.manage_government_ministry(p_ministry_id uuid, p_name text, p_acronym text, p_description text, p_responsibilities text[], p_annual_budget numeric, p_is_active boolean)
 RETURNS government_ministries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); result public.government_ministries%rowtype; previous public.government_ministries%rowtype; treasury numeric:=0; cost_ratio numeric:=0; impact numeric:=0;
begin
  if public.get_authority_role(actor) not in('Presidente','Admin') then raise exception 'Apenas a Presidência pode gerir ministérios.'; end if;
  if length(trim(coalesce(p_name,'')))<4 or p_annual_budget<0 then raise exception 'Dados ministeriais inválidos.'; end if;
  select treasury_balance into treasury from public.government_finances where id=1;
  cost_ratio:=case when treasury>0 then p_annual_budget/treasury else 1 end;
  if p_ministry_id is null then
    insert into public.government_ministries(name,acronym,description,responsibilities,annual_budget,is_active,created_by,efficiency_score)
    values(trim(p_name),upper(nullif(trim(p_acronym),'')),trim(p_description),coalesce(p_responsibilities,'{}'),p_annual_budget,coalesce(p_is_active,true),actor,50) returning * into result;
    impact:=-least(4,greatest(.2,cost_ratio*25));
    perform public.apply_government_impact('administration','ministry_created','Criação de '||result.name||' com custo anual de '||to_char(result.annual_budget,'FM999G999G999G990D00')||'.',impact,0,'government_ministries',result.id::text,jsonb_build_object('annualBudget',result.annual_budget,'treasuryRatio',cost_ratio,'efficiency',result.efficiency_score));
  else
    select * into previous from public.government_ministries where id=p_ministry_id for update;
    if not found then raise exception 'Ministério não encontrado.'; end if;
    update public.government_ministries set name=trim(p_name),acronym=upper(nullif(trim(p_acronym),'')),description=trim(p_description),responsibilities=coalesce(p_responsibilities,'{}'),annual_budget=p_annual_budget,is_active=coalesce(p_is_active,true),updated_at=clock_timestamp() where id=p_ministry_id returning * into result;
    impact:=case when not result.is_active and previous.is_active then .15 when result.annual_budget>previous.annual_budget then -least(2,(result.annual_budget-previous.annual_budget)/greatest(treasury,1)*20) when result.annual_budget<previous.annual_budget then least(1,(previous.annual_budget-result.annual_budget)/greatest(treasury,1)*10) else 0 end;
    if impact<>0 then perform public.apply_government_impact('administration','ministry_restructured','Estrutura ou orçamento de '||result.name||' alterado.',impact,0,'government_ministries',result.id::text,jsonb_build_object('previousBudget',previous.annual_budget,'annualBudget',result.annual_budget,'active',result.is_active)); end if;
  end if;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.delete_story(p_story_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid:=auth.uid(); owner_id uuid;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
 SELECT user_id INTO owner_id FROM public.stories WHERE id=p_story_id FOR UPDATE;
 IF NOT FOUND THEN RETURN json_build_object('success',true,'message','Story já removido.'); END IF;
 IF actor IS DISTINCT FROM owner_id AND public.get_authority_role(actor) IS DISTINCT FROM 'Admin' THEN
   RAISE EXCEPTION 'ROLE_NOT_AUTHORIZED';
 END IF;
 DELETE FROM public.posts WHERE story_id=p_story_id;
 DELETE FROM public.stories WHERE id=p_story_id;
 INSERT INTO public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key)
 VALUES('story_removed','social','stories',p_story_id,actor,jsonb_build_object('owner_id',owner_id,'moderated',actor<>owner_id),'story-removed:'||p_story_id);
 IF actor<>owner_id THEN
   INSERT INTO public.notifications(user_id,sender_id,type,content,link,metadata)
   VALUES(owner_id,actor,'story_moderated','Um de seus Stories foi removido pela moderação.','/services/x',jsonb_build_object('story_id',p_story_id));
 END IF;
 RETURN json_build_object('success',true,'message','Story excluído com sucesso.');
END $function$
;

CREATE OR REPLACE FUNCTION public.manage_media_outlet(p_outlet_id uuid, p_name text, p_editor_id uuid, p_profile text, p_credibility numeric, p_is_active boolean)
 RETURNS media_outlets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result public.media_outlets%rowtype;
begin
  if public.get_authority_role(auth.uid()) not in('Presidente','Admin') then raise exception 'Sem permissão para gerir veículos.'; end if;
  if p_profile not in('governista','oposicao','neutro','sensacionalista') or p_credibility not between 0 and 100 then raise exception 'Perfil editorial inválido.'; end if;
  if not exists(select 1 from public.profiles where id=p_editor_id) then raise exception 'Editor não encontrado.'; end if;
  if p_outlet_id is null then insert into public.media_outlets(name,editor_id,editorial_profile,credibility_score,is_active) values(trim(p_name),p_editor_id,p_profile,p_credibility,p_is_active) returning * into result;
  else update public.media_outlets set name=trim(p_name),editor_id=p_editor_id,editorial_profile=p_profile,credibility_score=p_credibility,is_active=p_is_active,updated_at=clock_timestamp() where id=p_outlet_id returning * into result; end if;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.finalize_bill_suggestion_voting(p_voting_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); voting public.parliament_votings%rowtype; suggestion public.bill_suggestions%rowtype; seats int; votes_cast int; approvals int; rejections int; approved boolean; created_bill public.bills%rowtype;
begin
  select * into voting from public.parliament_votings where id=p_voting_id and type='suggestion' for update;
  if not found then raise exception 'Votação de sugestão não encontrada.'; end if;
  if not exists(select 1 from public.parliament_members where user_id=actor and house_id=voting.house_id and term_end_date>=current_date) and public.get_authority_role(actor)<>'Admin' then raise exception 'Sem mandato nesta Casa.'; end if;
  select count(*) into seats from public.parliament_members where house_id=voting.house_id and term_start_date<=current_date and term_end_date>=current_date;
  select count(*),count(*) filter(where vote='Aprovar'),count(*) filter(where vote='Rejeitar') into votes_cast,approvals,rejections from public.parliament_voting_votes where voting_id=voting.id;
  if voting.status='active' and clock_timestamp()<voting.end_date and votes_cast<greatest(seats,1) then return jsonb_build_object('finalized',false); end if;
  select * into suggestion from public.bill_suggestions where id=voting.related_id for update;
  approved:=approvals>=case when approvals+rejections>0 then floor((approvals+rejections)/2.0)+1 else 1 end;
  if approved and suggestion.adopted_bill_id is null then
    insert into public.bills(title,summary,full_text,author_id,house_id,author_role,status,type)
    values(suggestion.title,suggestion.suggestion,suggestion.suggestion,suggestion.author_id,voting.house_id,'Cidadão','Em tramitação',suggestion.bill_type) returning * into created_bill;
    update public.bill_suggestions set status='aprovada',adopted_by=coalesce(adopted_by,actor),adopted_bill_id=created_bill.id,updated_at=clock_timestamp() where id=suggestion.id;
  elsif not approved then update public.bill_suggestions set status='rejeitada',updated_at=clock_timestamp() where id=suggestion.id; end if;
  update public.parliament_votings set status='closed' where id=voting.id and status<>'closed';
  return jsonb_build_object('finalized',true,'approved',approved,'bill',to_jsonb(created_bill),'message',case when approved then 'Sugestão aprovada e convertida em projeto.' else 'Sugestão rejeitada pela Casa.' end);
end; $function$
;

CREATE OR REPLACE FUNCTION public.search_executive_candidates(p_office_key text, p_query text DEFAULT ''::text, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if auth.uid() is null or not coalesce(public.get_authority_role(auth.uid()) in ('Admin','Presidente'),false) then raise exception 'A consulta exige autoridade presidencial.' using errcode='42501'; end if;
 if p_office_key is null or (p_office_key<>'minister' and not exists(select 1 from public.executive_office_definitions where office_key=p_office_key)) then raise exception 'Selecione um cargo válido.'; end if;
 if p_offset is null or p_offset<0 or p_offset>1000000 then raise exception 'Página inválida.'; end if;
 select coalesce(jsonb_agg(to_jsonb(c)), '[]') into result from (
  select p.id,p.full_name,p.username,p.avatar_url,p.role,exists(select 1 from public.minister_invitations inv where inv.candidate_id=p.id and inv.status='pending' and inv.expires_at>clock_timestamp()) invitation_pending,count(*) over() as total_count from public.profiles p
  where private.is_executive_candidate(p.id,p_office_key)
   and (coalesce(btrim(p_query),'')='' or position(lower(btrim(p_query)) in lower(concat_ws(' ',p.full_name,p.username,p.x_handle,p.x_username)))>0)
  order by p.full_name,p.id limit 51 offset p_offset
 ) c;
 return jsonb_build_object('candidates',case when jsonb_array_length(result)>50 then result-50 else result end,'has_more',jsonb_array_length(result)>50);
end; $function$
;

CREATE OR REPLACE FUNCTION public.respond_to_affiliation_request(p_request_id uuid, p_is_approved boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare request public.party_affiliation_requests%rowtype; actor_role public.party_role; party_name text; applicant_name text;
begin
  select * into request from public.party_affiliation_requests where id=p_request_id for update;
  if not found or request.status<>'pending' then return json_build_object('success',false,'message','Solicitação indisponível.'); end if;
  select role into actor_role from public.party_members where party_id=request.party_id and user_id=auth.uid();
  if auth.uid() is null or (coalesce(actor_role::text,'') not in('Dono','Presidente','Vice-Presidente') and public.get_authority_role(auth.uid()) is distinct from 'Admin') then return json_build_object('success',false,'message','Sem permissão para decidir esta solicitação.'); end if;
  select name into party_name from public.political_parties where id=request.party_id;
  select coalesce(full_name,username,'Cidadão') into applicant_name from public.profiles where id=request.user_id;
  if p_is_approved then
    if exists(select 1 from public.party_members where user_id=request.user_id) then return json_build_object('success',false,'message','O solicitante já está filiado a outro partido.'); end if;
    insert into public.party_members(party_id,user_id,role) values(request.party_id,request.user_id,'Membro');
    update public.profiles set party_affiliation=request.party_id where id=request.user_id;
  end if;
  update public.party_affiliation_requests set status=case when p_is_approved then 'approved' else 'rejected' end where id=request.id;
  insert into public.party_history(party_id,actor_id,event_type,summary,current_state)
  values(request.party_id,auth.uid(),case when p_is_approved then 'affiliation_approved' else 'affiliation_rejected' end,'Solicitação de '||applicant_name||case when p_is_approved then ' aprovada.' else ' rejeitada.' end,jsonb_build_object('userId',request.user_id));
  insert into public.notifications(user_id,sender_id,type,content,link) values(request.user_id,auth.uid(),'party_affiliation_decided','Sua solicitação para '||party_name||case when p_is_approved then ' foi aprovada.' else ' foi rejeitada.' end,'/services/political-parties/'||request.party_id);
  return json_build_object('success',true,'message',case when p_is_approved then 'Membro aprovado.' else 'Solicitação rejeitada.' end);
end; $function$
;

CREATE OR REPLACE FUNCTION public.justice_admit_sentence(p_sentence_id uuid)
 RETURNS prison_terms
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE s public.sentences%rowtype; t public.prison_terms%rowtype; w public.warrants%rowtype; investigation uuid;
BEGIN
 SELECT * INTO s FROM public.sentences WHERE id=p_sentence_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SENTENCE_NOT_FOUND'; END IF;
 IF s.status NOT IN('final','serving') THEN RAISE EXCEPTION 'SENTENCE_NOT_FINAL'; END IF;
 SELECT * INTO t FROM public.prison_terms WHERE sentence_id=s.id ORDER BY admitted_at DESC LIMIT 1;
 IF FOUND THEN RETURN t; END IF;
 SELECT * INTO t FROM public.prison_terms WHERE inmate_id=s.defendant_id AND custody_status IN('provisional','serving','awaiting_intake') FOR UPDATE;
 IF FOUND THEN
   IF t.sentence_id IS NOT NULL THEN RAISE EXCEPTION 'INMATE_ALREADY_IN_CUSTODY'; END IF;
   UPDATE public.prison_terms SET sentence_id=s.id,custody_status='serving',
     expected_release_at=clock_timestamp()+make_interval(secs=>greatest(60,s.real_duration_seconds-extract(epoch from(clock_timestamp()-t.admitted_at))::integer)),
     original_duration_seconds=s.real_duration_seconds,remaining_units=s.final_sentence_units WHERE id=t.id RETURNING * INTO t;
   UPDATE public.sentences SET status='serving',starts_at=clock_timestamp(),ends_at=t.expected_release_at WHERE id=s.id;
   RETURN t;
 END IF;
 SELECT investigation_id INTO investigation FROM public.criminal_cases WHERE id=s.case_id;
 INSERT INTO public.warrants(warrant_number,warrant_type,target_profile_id,case_id,investigation_id,issued_by,expires_at,sentence_id)
 VALUES(public.justice_next_number('MAN'),'arrest',s.defendant_id,s.case_id,investigation,s.judge_id,
   clock_timestamp()+make_interval(secs=>public.rp_duration_to_real_seconds(30,'day')),s.id)
 ON CONFLICT(sentence_id) WHERE sentence_id IS NOT NULL DO NOTHING RETURNING * INTO w;
 IF w.id IS NOT NULL THEN
   PERFORM public.justice_notify(p.id,'sentence_warrant_issued','Mandado de prisão disponível para cumprimento.','/services/justice',jsonb_build_object('warrant_id',w.id,'case_id',s.case_id))
   FROM public.profiles p WHERE (public.is_admin(p.id) or p.role IN('Admin','Policial','Police','Delegado')) AND p.deleted_at IS NULL;
   PERFORM public.justice_write_audit('sentence.warrant_issued','warrant',w.id,null,to_jsonb(w),'Expedição para cumprimento de sentença definitiva');
 END IF;
 RETURN NULL;
END $function$
;

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

  if public.get_active_parliament_member_id(v_user_id,p_house_id) is null and not exists(select 1 from public.profiles where id=v_user_id and public.is_admin(id)) then
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

CREATE OR REPLACE FUNCTION public.record_minister_event(p_minister_id uuid, p_event_type text, p_summary text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS ministers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); reputation_delta numeric; performance_delta numeric; result public.ministers%rowtype;
begin
  if public.get_authority_role(actor) not in('Presidente','Admin') then raise exception 'Somente a Presidência pode registrar resultados ministeriais.'; end if;
  if length(trim(coalesce(p_summary,'')))<10 then raise exception 'Descreva o acontecimento.'; end if;
  select x.reputation,x.performance into reputation_delta,performance_delta from (values
    ('policy_success',3::numeric,5::numeric),('policy_failure',-3::numeric,-5::numeric),('administrative_delivery',2::numeric,3::numeric),
    ('scandal',-10::numeric,-5::numeric),('investigation',-5::numeric,-2::numeric),('acquitted',3::numeric,0::numeric),('conviction',-20::numeric,-10::numeric)
  ) as x(kind,reputation,performance) where x.kind=p_event_type;
  if reputation_delta is null then raise exception 'Tipo de acontecimento ministerial inválido.'; end if;
  update public.ministers set reputation_score=least(100,greatest(0,reputation_score+reputation_delta)),performance_score=least(100,greatest(0,performance_score+performance_delta)) where id=p_minister_id and status='active' returning * into result;
  if result.id is null then raise exception 'Ministro ativo não encontrado.'; end if;
  insert into public.minister_history(minister_profile_id,ministry_id,event_type,summary,reputation_delta,performance_delta,actor_id,metadata)
  values(result.user_id,result.ministry_id,p_event_type,trim(p_summary),reputation_delta,performance_delta,actor,coalesce(p_metadata,'{}'));
  perform public.apply_government_impact('politics','minister_'||p_event_type,trim(p_summary),reputation_delta/5,performance_delta/10,'ministers',result.id::text,jsonb_build_object('eventType',p_event_type,'reputationDelta',reputation_delta,'performanceDelta',performance_delta)||coalesce(p_metadata,'{}'));
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.admin_delete_post(p_post_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Permission denied. Not an admin.';
  END IF;

  DELETE FROM public.posts WHERE id = p_post_id;

  RETURN true;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.configure_economic_mix(p_player_share numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare before_state jsonb; result jsonb;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and public.is_admin(id)) then raise exception 'Somente a administração pode configurar os pesos.' using errcode='42501'; end if;
  if p_player_share is null or p_player_share<0 or p_player_share>1 then raise exception 'Os pesos precisam somar 100%%.'; end if;
  select to_jsonb(s) into before_state from public.economic_state s where id for update;
  update public.economic_state set metadata=jsonb_set(coalesce(metadata,'{}'),'{activity_mix_override}',jsonb_build_object('player_share',p_player_share,'actor_id',auth.uid(),'updated_at',clock_timestamp())) where id;
  result:=economy_private.update_activity_mix();
  perform economy_private.audit('economic_mix_configured','economic_state','true',before_state,result,'Pesos de cidadãos e sociedade simulada configurados.',auth.uid());
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.remove_x_comment(p_comment_id uuid)
 RETURNS comments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.comments%rowtype; result public.comments%rowtype;
begin
 select * into c from public.comments where id=p_comment_id for update;
 if auth.uid() is null or (c.user_id is distinct from auth.uid() and not exists(select 1 from public.profiles where id=auth.uid() and public.is_admin(id) and deleted_at is null)) then raise exception 'Você não tem permissão para remover este comentário.' using errcode='42501'; end if;
 if c.deleted_at is not null then return c; end if;
 update public.comments set content='',deleted_at=clock_timestamp() where id=c.id returning * into result;
 insert into public.security_audit_log(action,target_table,target_id,actor_id,old_data,new_data)
 values('comment_removed','comments',c.id::text,auth.uid(),to_jsonb(c),to_jsonb(result));
 return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.create_support_ticket(p_requester_name text, p_requester_email text, p_requester_phone text, p_request_type text, p_subject text, p_message text, p_attachment_path text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_ticket public.support_tickets%rowtype;
begin
  if coalesce(p_request_type, 'support') not in ('support', 'contact') then
    raise exception 'Tipo de atendimento inválido.';
  end if;
  if coalesce(p_request_type, 'support') = 'support' and v_user_id is null then
    raise exception 'Entre na sua conta para abrir e acompanhar um ticket de suporte.';
  end if;
  if char_length(btrim(coalesce(p_requester_name, ''))) not between 2 and 120 then
    raise exception 'Informe seu nome.';
  end if;
  if btrim(coalesce(p_requester_email, '')) !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Informe um e-mail válido.';
  end if;
  if char_length(btrim(coalesce(p_subject, ''))) not between 3 and 160 then
    raise exception 'O assunto deve ter entre 3 e 160 caracteres.';
  end if;
  if char_length(btrim(coalesce(p_message, ''))) not between 10 and 5000 then
    raise exception 'Descreva a solicitação com pelo menos 10 caracteres.';
  end if;

  insert into public.support_tickets (
    requester_id, requester_name, requester_email, requester_phone,
    request_type, subject, attachment_path
  ) values (
    v_user_id,
    btrim(p_requester_name),
    lower(btrim(p_requester_email)),
    nullif(btrim(p_requester_phone), ''),
    coalesce(p_request_type, 'support'),
    btrim(p_subject),
    nullif(btrim(p_attachment_path), '')
  ) returning * into v_ticket;

  insert into public.support_ticket_messages (
    ticket_id, sender_id, sender_kind, body, attachment_path
  ) values (
    v_ticket.id,
    v_user_id,
    case when v_user_id is null then 'guest' else 'citizen' end,
    btrim(p_message),
    nullif(btrim(p_attachment_path), '')
  );

  insert into public.notifications (user_id, type, content, link, metadata)
  select profile.id,
         'support_ticket',
         'Novo ticket ' || v_ticket.public_id || ': ' || v_ticket.subject,
         '/admin-dashboard/support',
         jsonb_build_object('ticket_id', v_ticket.id, 'public_id', v_ticket.public_id)
  from public.profiles profile
  where public.is_admin(profile.id) and profile.deleted_at is null;

  return jsonb_build_object(
    'success', true,
    'ticket_id', v_ticket.id,
    'public_id', v_ticket.public_id,
    'message', 'Solicitação ' || v_ticket.public_id || ' aberta com sucesso.'
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.adjust_existing_levy(p_rule_key text, p_value numeric, p_expected_version bigint, p_nature text)
 RETURNS government_rules
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.government_rules%rowtype; actor uuid:=auth.uid(); d uuid; e uuid; explanation text; max_value numeric; effect jsonb; next_definition jsonb;
begin
  if not exists(select 1 from public.profiles where id=actor and (public.is_admin(id) or role in('Admin','Presidente'))) then raise exception 'Somente o Presidente pode ajustar tributos vigentes.' using errcode='42501'; end if;
  perform public.process_due_legal_effects();
  select * into r from public.government_rules where rule_key=p_rule_key for update;
  if not found or r.rule_kind not in('tax','fee') or not r.is_active or r.valid_from>clock_timestamp() or r.valid_until<=clock_timestamp() then raise exception 'Selecione um imposto ou tarifa vigente. Criar ou extinguir exige o processo legislativo.'; end if;
  if p_expected_version is null or r.version<>p_expected_version then raise exception 'O valor foi atualizado por outra medida. Confira a nova alíquota antes de salvar.'; end if;
  select decree_max_value into max_value from public.legal_authority_rules where capability='executive_rate_adjustment' and decree_allowed;
  if max_value is null then raise exception 'O regime vigente não permite ajuste executivo de alíquotas.'; end if;
  if p_nature is null or p_nature not in('percentage','fixed') then raise exception 'Escolha percentual ou valor fixo.'; end if;
  next_definition:=r.definition||jsonb_build_object('nature',p_nature);
  if p_nature='percentage' then max_value:=least(1,max_value); end if;
  if p_value is null or p_value::text in('NaN','Infinity','-Infinity') or p_value<0 or p_value>max_value then raise exception 'Informe um valor dentro dos limites permitidos.'; end if;
  if r.numeric_value=p_value and r.definition->>'nature'=p_nature then return r; end if;
  explanation:=r.description||': '||r.numeric_value||' ('||(r.definition->>'nature')||') → '||p_value||' ('||p_nature||'). Ajuste executivo do valor e da forma de cobrança, preservados escopo e vigência da norma.';
  insert into public.decrees(title,content,author_id,is_published) values('Ajuste de '||r.description,explanation,actor,false) returning id into d;
  effect:=jsonb_build_object('kind',r.rule_kind,'action','change','rule_key',r.rule_key,'name',r.description,'value',p_value,'definition',next_definition,'executive_rate_adjustment',true);
  -- Scope, payer, exemptions and dates remain governed by the existing legal authority.
  insert into public.law_effects(source_kind,source_id,effect_key,operation,effect_value,explanation,status,configured_by,activated_at,effect_data,valid_from,valid_until,previous_snapshot)
  values('decree',d,r.rule_key,'set',p_value,explanation,'active',actor,clock_timestamp(),effect,clock_timestamp(),r.valid_until,to_jsonb(r)) returning id into e;
  update public.government_rules set numeric_value=p_value,definition=next_definition,unit=case when p_nature='percentage' then 'ratio' else 'BRL' end,source_kind='decree',source_id=d,active_effect_id=e,version=version+1,updated_at=clock_timestamp() where rule_key=r.rule_key;
  update public.decrees set is_published=true,published_at=clock_timestamp() where id=d;
  perform economy_private.audit('executive_levy_adjusted','government_rules',r.rule_key,to_jsonb(r),effect,explanation,actor);
  insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key)
  values('legal_effect_activated','government','law_effects',e,actor,effect,'legal-effect:'||e);
  select * into r from public.government_rules where rule_key=p_rule_key;
  return r;
end; $function$
;

CREATE OR REPLACE FUNCTION public.reply_to_support_ticket(p_ticket_id uuid, p_message text, p_attachment_path text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_is_admin boolean := public.get_authority_role(v_user_id) = 'Admin';
  v_ticket public.support_tickets%rowtype;
begin
  if v_user_id is null then raise exception 'É necessário estar autenticado.'; end if;
  if char_length(btrim(coalesce(p_message, ''))) not between 1 and 5000 then
    raise exception 'A mensagem deve ter entre 1 e 5.000 caracteres.';
  end if;

  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if not found then raise exception 'Ticket não encontrado.'; end if;
  if not v_is_admin and v_ticket.requester_id is distinct from v_user_id then
    raise exception 'Você não pode responder a este ticket.';
  end if;
  if v_ticket.status = 'closed' then raise exception 'Este ticket está encerrado.'; end if;

  insert into public.support_ticket_messages (ticket_id, sender_id, sender_kind, body, attachment_path)
  values (p_ticket_id, v_user_id, case when v_is_admin then 'admin' else 'citizen' end,
          btrim(p_message), nullif(btrim(p_attachment_path), ''));

  update public.support_tickets
  set last_message_at = clock_timestamp(),
      updated_at = clock_timestamp(),
      status = case
        when v_is_admin then 'waiting_user'
        when status in ('resolved', 'waiting_user') then 'in_progress'
        else status
      end,
      assigned_to = case when v_is_admin then coalesce(assigned_to, v_user_id) else assigned_to end,
      accepted_at = case when v_is_admin then coalesce(accepted_at, clock_timestamp()) else accepted_at end,
      resolved_at = case when not v_is_admin and status = 'resolved' then null else resolved_at end
  where id = p_ticket_id;

  if v_is_admin and v_ticket.requester_id is not null then
    insert into public.notifications (user_id, sender_id, type, content, link, metadata)
    values (
      v_ticket.requester_id, v_user_id, 'support_reply',
      'A equipe respondeu ao ticket ' || v_ticket.public_id || '.',
      '/support?ticket=' || v_ticket.public_id,
      jsonb_build_object('ticket_id', p_ticket_id, 'public_id', v_ticket.public_id)
    );
  elsif not v_is_admin then
    insert into public.notifications (user_id, sender_id, type, content, link, metadata)
    select profile.id, v_user_id, 'support_reply',
           'Nova resposta no ticket ' || v_ticket.public_id || '.',
           '/admin-dashboard/support',
           jsonb_build_object('ticket_id', p_ticket_id, 'public_id', v_ticket.public_id)
    from public.profiles profile
    where profile.deleted_at is null
      and (profile.id = v_ticket.assigned_to or (v_ticket.assigned_to is null and public.is_admin(profile.id)));
  end if;

  return jsonb_build_object('success', true, 'message', 'Mensagem enviada.');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_manage_support_ticket(p_ticket_id uuid, p_status text DEFAULT NULL::text, p_priority text DEFAULT NULL::text, p_assigned_to uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_admin_id uuid := auth.uid();
  v_ticket public.support_tickets%rowtype;
  v_status text;
  v_priority text;
  v_assignee uuid;
begin
  if public.get_authority_role(v_admin_id) <> 'Admin' then raise exception 'Acesso negado.'; end if;
  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if not found then raise exception 'Ticket não encontrado.'; end if;

  v_status := coalesce(p_status, v_ticket.status);
  v_priority := coalesce(p_priority, v_ticket.priority);
  v_assignee := coalesce(p_assigned_to, v_ticket.assigned_to, v_admin_id);
  if v_status not in ('open', 'in_progress', 'waiting_user', 'resolved', 'closed') then raise exception 'Status inválido.'; end if;
  if v_priority not in ('low', 'normal', 'high', 'urgent') then raise exception 'Prioridade inválida.'; end if;
  if public.get_authority_role(v_assignee) <> 'Admin' then raise exception 'O responsável precisa ser administrador.'; end if;

  update public.support_tickets
  set status = v_status,
      priority = v_priority,
      assigned_to = v_assignee,
      accepted_at = coalesce(accepted_at, clock_timestamp()),
      resolved_at = case when v_status = 'resolved' then coalesce(resolved_at, clock_timestamp()) else null end,
      closed_at = case when v_status = 'closed' then coalesce(closed_at, clock_timestamp()) else null end,
      updated_at = clock_timestamp()
  where id = p_ticket_id;

  if v_ticket.requester_id is not null and (v_ticket.status is distinct from v_status or v_ticket.assigned_to is null) then
    insert into public.notifications (user_id, sender_id, type, content, link, metadata)
    values (
      v_ticket.requester_id, v_admin_id, 'support_status',
      'O ticket ' || v_ticket.public_id || ' foi atualizado para ' ||
        case v_status when 'open' then 'aberto' when 'in_progress' then 'em atendimento'
          when 'waiting_user' then 'aguardando sua resposta' when 'resolved' then 'resolvido' else 'encerrado' end || '.',
      '/support?ticket=' || v_ticket.public_id,
      jsonb_build_object('ticket_id', p_ticket_id, 'public_id', v_ticket.public_id, 'status', v_status)
    );
  end if;

  return jsonb_build_object('success', true, 'message', 'Ticket atualizado com sucesso.');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_national_game_event(p_title text, p_description text, p_category text, p_severity text, p_deadline_rp_hours numeric, p_options jsonb, p_country_code text DEFAULT 'BR'::text)
 RETURNS national_game_events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid:=auth.uid();
  v_role text;
  v_event public.national_game_events%rowtype;
  v_option jsonb;
  v_default_count integer:=0;
begin
  v_role:=public.get_authority_role(v_actor);
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
  where profile.deleted_at is null and (public.is_admin(profile.id) or profile.role in ('Presidente','Admin'));
  return v_event;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_investigation(p_investigation_id uuid, p_outcome text, p_conclusion text, p_recommended_action text DEFAULT NULL::text)
 RETURNS criminal_investigations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_old public.criminal_investigations%rowtype;
  v_new public.criminal_investigations%rowtype;
begin
  if not public.justice_has_role(array['Admin', 'Delegado']) then raise exception 'ROLE_NOT_AUTHORIZED'; end if;
  if p_outcome not in ('indict', 'no_indictment') then raise exception 'INVALID_INVESTIGATION_OUTCOME'; end if;
  if length(btrim(coalesce(p_conclusion, ''))) < 40 then raise exception 'CONCLUSION_TOO_SHORT'; end if;

  select * into v_old from public.criminal_investigations where id = p_investigation_id for update;
  if not found then raise exception 'INVESTIGATION_NOT_FOUND'; end if;
  if v_old.status='sent_to_prosecutor' and p_outcome='indict' and v_old.conclusion=btrim(p_conclusion) then return v_old; end if;
  if v_old.status not in ('open', 'in_progress', 'delegate_review', 'complement_requested') then
    raise exception 'INVESTIGATION_ALREADY_RESOLVED';
  end if;

  if p_outcome = 'indict' then
    if not exists (
      select 1 from public.investigation_parties
      where investigation_id = p_investigation_id and party_type = 'suspect'
        and not exists(select 1 from public.investigation_subjects s where s.investigation_id=p_investigation_id and s.profile_id=public.investigation_parties.profile_id and s.subject_status='cleared')
    ) then raise exception 'INVESTIGATION_REQUIRES_SUSPECT'; end if;
    if not exists (
      select 1 from public.case_evidence
      where investigation_id = p_investigation_id and status = 'sealed'
    ) then raise exception 'INVESTIGATION_REQUIRES_SEALED_EVIDENCE'; end if;
  end if;

  update public.criminal_investigations
  set status = case when p_outcome = 'indict' then 'sent_to_prosecutor' else 'archived' end,
      conclusion = btrim(p_conclusion),
      recommended_action = case when p_outcome = 'indict'
        then coalesce(nullif(btrim(coalesce(p_recommended_action, '')), ''), 'criminal_charge')
        else 'no_indictment' end,
      closed_at = case when p_outcome = 'no_indictment' then clock_timestamp() else null end,
      updated_at = clock_timestamp()
  where id = p_investigation_id
  returning * into v_new;

  update public.police_occurrences
  set status = case when p_outcome = 'indict' then 'Concluída' else 'Arquivada' end,
      updated_at = clock_timestamp()
  where id = v_old.occurrence_id;

  insert into public.investigation_events (
    investigation_id, event_type, title, description, actor_id, metadata
  ) values (
    p_investigation_id,
    case when p_outcome = 'indict' then 'indictment' else 'no_indictment' end,
    case when p_outcome = 'indict' then 'Relatório final com indiciamento' else 'Investigação arquivada sem indiciamento' end,
    btrim(p_conclusion), v_actor,
    jsonb_build_object('outcome', p_outcome, 'recommended_action', v_new.recommended_action)
  );

  perform public.justice_write_audit(
    'investigation.' || p_outcome, 'criminal_investigation', p_investigation_id,
    to_jsonb(v_old), to_jsonb(v_new), p_conclusion
  );
  if p_outcome='indict' then
    update public.investigation_subjects set subject_status='indicted' where investigation_id=p_investigation_id and subject_status<>'cleared';
    perform public.justice_notify(p.id,'investigation_referred','Nova investigação foi remetida ao Ministério Público.','/services/justice',jsonb_build_object('investigation_id',p_investigation_id))
    from public.profiles p where (public.is_admin(p.id) or p.role in('Promotor','Admin')) and p.deleted_at is null;
    perform public.justice_notify(s.profile_id,'investigation_indicted','Você foi formalmente indiciado em uma investigação.','/services/justice?view=citizen',jsonb_build_object('investigation_id',p_investigation_id))
    from public.investigation_subjects s where s.investigation_id=p_investigation_id and s.subject_status='indicted' and not s.is_secret;
  end if;
  return v_new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_set_gov_card_limit(p_new_limit numeric)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
    admin_user_id UUID := auth.uid();
BEGIN
    IF NOT public.is_admin(admin_user_id) THEN
        RETURN json_build_object('success', false, 'message', 'Apenas administradores podem executar esta ação.');
    END IF;

    IF p_new_limit < 0 THEN
        RETURN json_build_object('success', false, 'message', 'O limite não pode ser negativo.');
    END IF;

    UPDATE public.government_finances SET corporate_card_limit = p_new_limit WHERE id = 1;

    RETURN json_build_object('success', true, 'message', 'Limite do cartão corporativo atualizado com sucesso.');
EXCEPTION
    WHEN others THEN
        RETURN json_build_object('success', false, 'message', 'Ocorreu um erro inesperado.');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reject_plebiscite(p_plebiscite_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    current_user_id UUID := auth.uid();
BEGIN
    IF NOT (get_authority_role(current_user_id) IN ('Admin', 'Deputado', 'Senador')) THEN
        RETURN json_build_object('success', false, 'message', 'Você não tem permissão para rejeitar plebiscitos.');
    END IF;

    UPDATE public.plebiscites
    SET status = 'Rejeitado'
    WHERE id = p_plebiscite_id AND status = 'Pendente';

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Plebiscito não encontrado ou já processado.');
    END IF;

    RETURN json_build_object('success', true, 'message', 'Plebiscito rejeitado.');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.user_can_manage_national_bank(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and (
        (public.is_admin(p.id) or p.role in ('Admin', 'Presidente do Banco Nacional'))
        or exists (
          select 1
          from jsonb_array_elements_text(
            case
              when jsonb_typeof(to_jsonb(p.titles)) = 'array' then to_jsonb(p.titles)
              else '[]'::jsonb
            end
          ) as title(value)
          where title.value in ('Admin', 'Presidente do Banco Nacional')
        )
        or exists (
          select 1
          from public.system_settings s
          where s.key = 'executive_governance'
            and s.value -> 'specialAppointments' -> 'national_bank_president' ->> 'user_id' = p_user_id::text
        )
      )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.promulgate_decree_suspension(p_bill_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.bills%rowtype; voting uuid; result jsonb;
begin
 select * into b from public.bills where id=p_bill_id;
 if b.suspends_decree_id is null or b.type<>'PDL' then raise exception 'Proposta de sustação não encontrada.'; end if;
 if public.get_active_parliament_member_id(auth.uid(),b.house_id) is null and not coalesce(public.get_authority_role(auth.uid())='Admin',false) then raise exception 'Somente a Casa competente pode concluir a sustação.' using errcode='42501'; end if;
 if b.status='Promulgado' then return; end if;
 select id into voting from public.parliament_votings where related_id=b.id and type='bill' order by created_at desc limit 1;
 if voting is null then raise exception 'A sustação precisa de votação legislativa.'; end if;
 result:=private.finalize_bill_voting(voting);
 if not coalesce((result->>'finalized')::boolean,false) then raise exception 'A votação ainda está em andamento.'; end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_modify_currency_balance(p_user_id uuid, p_currency_code text, p_amount numeric, p_action text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
    admin_user_id UUID := auth.uid();
    target_account RECORD;
BEGIN
    IF NOT public.is_admin(admin_user_id) THEN
        RETURN json_build_object('success', false, 'message', 'Apenas administradores podem executar esta ação.');
    END IF;

    SELECT * INTO target_account FROM public.accounts WHERE user_id = p_user_id;
    IF target_account IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Conta bancária do usuário não encontrada.');
    END IF;

    IF p_action = 'set' THEN
        UPDATE public.accounts
        SET currency_balances = jsonb_set(COALESCE(currency_balances, '{}'), ARRAY[p_currency_code], to_jsonb(p_amount))
        WHERE id = target_account.id;
    ELSE
        RETURN json_build_object('success', false, 'message', 'Ação inválida. Use "set".');
    END IF;

    RETURN json_build_object('success', true, 'message', 'Saldo em moeda estrangeira do usuário modificado com sucesso.');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_forgive_debt(p_target_type text, p_user_id uuid DEFAULT NULL::uuid, p_loan_id uuid DEFAULT NULL::uuid, p_amount numeric DEFAULT NULL::numeric)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
    admin_user_id UUID := auth.uid();
    current_debt NUMERIC;
BEGIN
    IF NOT public.is_admin(admin_user_id) THEN
        RETURN json_build_object('success', false, 'message', 'Apenas administradores podem executar esta ação.');
    END IF;

    IF p_target_type = 'government' THEN
        SELECT loans_balance INTO current_debt FROM public.government_finances WHERE id = 1;

        IF p_amount IS NOT NULL THEN
             IF p_amount <= 0 THEN
                RETURN json_build_object('success', false, 'message', 'O valor a abater deve ser positivo.');
            END IF;
             IF p_amount > current_debt THEN
                RETURN json_build_object('success', false, 'message', 'O valor a abater não pode ser maior que a dívida atual.');
            END IF;
            UPDATE public.government_finances SET loans_balance = loans_balance - p_amount WHERE id = 1;
            RETURN json_build_object('success', true, 'message', 'Valor de ' || format_currency_brl(p_amount) || ' abatido da dívida do governo.');
        ELSE
            UPDATE public.government_finances SET loans_balance = 0 WHERE id = 1;
            RETURN json_build_object('success', true, 'message', 'Dívida de empréstimos do governo totalmente perdoada.');
        END IF;

    ELSIF p_target_type = 'user' THEN
        IF p_loan_id IS NULL THEN
            RETURN json_build_object('success', false, 'message', 'ID do empréstimo do usuário é necessário.');
        END IF;

        UPDATE public.loans SET status = 'Perdoado', amount = 0 WHERE id = p_loan_id AND user_id = p_user_id;

        IF NOT FOUND THEN
            RETURN json_build_object('success', false, 'message', 'Empréstimo não encontrado para o usuário especificado.');
        END IF;

        RETURN json_build_object('success', true, 'message', 'Dívida do usuário perdoada com sucesso.');
    ELSE
        RETURN json_build_object('success', false, 'message', 'Tipo de alvo inválido. Use "government" ou "user".');
    END IF;
EXCEPTION
    WHEN others THEN
        RETURN json_build_object('success', false, 'message', 'Ocorreu um erro inesperado.');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_modify_balance(p_user_id uuid, p_amount numeric, p_action text, p_reason text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
    admin_user_id UUID := auth.uid();
    target_account RECORD;
    admin_profile RECORD;
BEGIN
    -- Check if the calling user is an admin
    SELECT * INTO admin_profile FROM public.profiles WHERE id = admin_user_id AND public.is_admin(id);
    IF admin_profile IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Apenas administradores podem executar esta ação.');
    END IF;

    -- Find the target user's account
    SELECT * INTO target_account FROM public.accounts WHERE user_id = p_user_id;
    IF target_account IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Conta bancária do usuário não encontrada.');
    END IF;

    -- Perform the balance modification
    IF p_action = 'add' THEN
        UPDATE public.accounts SET balance = balance + p_amount WHERE id = target_account.id;

        INSERT INTO public.transactions(to_account_id, amount, description, type)
        VALUES (target_account.id, p_amount, 'Crédito administrativo: ' || p_reason, 'admin_credit');

    ELSIF p_action = 'remove' THEN
        IF target_account.balance < p_amount THEN
            RETURN json_build_object('success', false, 'message', 'Saldo do usuário insuficiente para a remoção.');
        END IF;
        UPDATE public.accounts SET balance = balance - p_amount WHERE id = target_account.id;

        INSERT INTO public.transactions(from_account_id, amount, description, type)
        VALUES (target_account.id, p_amount, 'Débito administrativo: ' || p_reason, 'admin_debit');

    ELSE
        RETURN json_build_object('success', false, 'message', 'Ação inválida. Use "add" ou "remove".');
    END IF;

    RETURN json_build_object('success', true, 'message', 'Saldo do usuário modificado com sucesso.');
EXCEPTION
    WHEN others THEN
        RETURN json_build_object('success', false, 'message', 'Ocorreu um erro inesperado.');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_set_gov_loan_limit(p_new_limit numeric)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
    admin_user_id UUID := auth.uid();
BEGIN
    IF NOT public.is_admin(admin_user_id) THEN
        RETURN json_build_object('success', false, 'message', 'Apenas administradores podem executar esta ação.');
    END IF;

    IF p_new_limit < 0 THEN
        RETURN json_build_object('success', false, 'message', 'O limite não pode ser negativo.');
    END IF;

    UPDATE public.government_finances SET loan_limit = p_new_limit WHERE id = 1;

    RETURN json_build_object('success', true, 'message', 'Limite de empréstimos do governo atualizado com sucesso.');
EXCEPTION
    WHEN others THEN
        RETURN json_build_object('success', false, 'message', 'Ocorreu um erro inesperado.');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.dismiss_minister(p_user_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); result public.ministers%rowtype;
begin
  if coalesce(public.get_authority_role(actor),'') not in('Presidente','Admin') then return json_build_object('success',false,'message','Apenas a Presidência pode exonerar ministros.'); end if;
  perform pg_advisory_xact_lock(hashtext('govrp:presidential-succession'));
  perform pg_advisory_xact_lock(hashtext('govrp:executive:appointments'));
  update public.ministers set status='dismissed',ended_at=clock_timestamp() where user_id=p_user_id and status='active' returning * into result;
  if result.id is null then return json_build_object('success',false,'message','Ministro ativo não encontrado.'); end if;
  update public.profiles set role=private.minister_return_role(result.previous_role),manual_role_override=false,role_assigned_at=clock_timestamp(),role_assigned_by=actor,titles=array_remove(coalesce(titles,'{}'),'Ministro') where id=p_user_id and role='Ministro';
  update public.profiles set titles=array_remove(coalesce(titles,'{}'),'Ministro') where id=p_user_id and 'Ministro'=any(coalesce(titles,'{}'));
  insert into public.minister_history(minister_profile_id,ministry_id,event_type,summary,actor_id) values(p_user_id,result.ministry_id,'dismissed','Exoneração de '||result.ministry||'.',actor);
  perform public.apply_government_impact('politics','minister_dismissed','Exoneração ministerial.',-.3,0,'ministers',result.id::text,jsonb_build_object('ministerId',p_user_id,'ministry',result.ministry));
  return json_build_object('success',true,'message','Ministro exonerado com sucesso.');
end; $function$
;

CREATE OR REPLACE FUNCTION public.create_parliament_commission(p_title text, p_summary text, p_purpose text, p_type text, p_house_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_scope text;
  v_status text;
  v_house_id uuid;
  v_member_id uuid;
  v_commission_id uuid;
begin
  if v_user_id is null then
    raise exception 'É necessário estar autenticado para criar comissão.';
  end if;

  if p_title is null or btrim(p_title) = '' or p_summary is null or btrim(p_summary) = '' or p_purpose is null or btrim(p_purpose) = '' then
    raise exception 'Título, resumo e objetivo são obrigatórios.';
  end if;

  if p_type not in ('permanent', 'temporary', 'cpi', 'cpmi') then
    raise exception 'Tipo de comissão inválido.';
  end if;

  if coalesce(array_length(p_house_ids, 1), 0) = 0 then
    raise exception 'Ao menos uma casa legislativa deve ser informada.';
  end if;

  if p_type = 'cpmi' then
    if coalesce(array_length(p_house_ids, 1), 0) <> 2 then
      raise exception 'CPMI deve envolver exatamente duas Casas.';
    end if;
    v_scope := 'mixed';
    v_status := 'collecting_support';
  else
    if coalesce(array_length(p_house_ids, 1), 0) <> 1 then
      raise exception 'Esta comissão deve estar vinculada a uma única Casa.';
    end if;
    v_scope := 'house';
    v_status := case
      when p_type = 'permanent' then 'active'
      when p_type = 'temporary' then 'pending_plenary'
      else 'collecting_support'
    end;
  end if;

  if p_type = 'permanent' and not public.is_parliament_governance_manager(v_user_id, p_house_ids[1]) then
    raise exception 'Somente a mesa diretora pode criar comissões permanentes.';
  end if;

  v_house_id := p_house_ids[1];
  v_member_id := public.get_active_parliament_member_id(v_user_id, v_house_id);

  if v_member_id is null and not exists (
    select 1
      from public.profiles
     where id = v_user_id
       and (public.is_admin(id) or role in ('Admin', 'Presidente'))
  ) then
    raise exception 'Somente parlamentares ativos podem iniciar esse fluxo.';
  end if;

  insert into public.parliament_commissions (
    title,
    summary,
    purpose,
    scope,
    type,
    status,
    requested_by,
    officialized_by,
    officialized_at,
    opened_at
  )
  values (
    btrim(p_title),
    btrim(p_summary),
    btrim(p_purpose),
    v_scope,
    p_type,
    v_status,
    v_user_id,
    case when p_type = 'permanent' then v_user_id else null end,
    case when p_type = 'permanent' then now() else null end,
    case when p_type = 'permanent' then now() else null end
  )
  returning id into v_commission_id;

  foreach v_house_id in array p_house_ids
  loop
    insert into public.parliament_commission_houses (commission_id, house_id)
    values (v_commission_id, v_house_id);
  end loop;

  if v_member_id is not null and p_type in ('cpi', 'cpmi') then
    insert into public.parliament_commission_supports (commission_id, member_id)
    values (v_commission_id, v_member_id)
    on conflict do nothing;
  end if;

  if v_member_id is not null and p_type = 'permanent' then
    insert into public.parliament_commission_members (commission_id, member_id, role, appointed_by)
    values (v_commission_id, v_member_id, 'chair', v_user_id)
    on conflict (commission_id, member_id) do update
      set role = excluded.role,
          appointed_by = excluded.appointed_by,
          appointed_at = now();
  end if;

  return jsonb_build_object(
    'success', true,
    'commission_id', v_commission_id,
    'message', case
      when p_type = 'temporary' then 'Comissão temporária cadastrada e pronta para deliberação do plenário.'
      when p_type = 'permanent' then 'Comissão permanente criada com sucesso.'
      else 'Requerimento de comissão registrado. Agora ele pode receber apoios parlamentares.'
    end
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_post(p_post_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid:=auth.uid(); owner_id uuid;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
 SELECT user_id INTO owner_id FROM public.posts WHERE id=p_post_id FOR UPDATE;
 IF NOT FOUND THEN RETURN json_build_object('success',true,'message','Publicação já removida.'); END IF;
 IF actor IS DISTINCT FROM owner_id AND public.get_authority_role(actor) IS DISTINCT FROM 'Admin' THEN
   RAISE EXCEPTION 'ROLE_NOT_AUTHORIZED';
 END IF;
 DELETE FROM public.posts WHERE id=p_post_id;
 RETURN json_build_object('success',true,'message','Publicação excluída com sucesso.');
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_modify_treasury(p_amount numeric, p_action text, p_reason text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=(select auth.uid());v_old numeric;v_new numeric;
begin
  if public.get_authority_role(v_actor)<>'Admin' then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
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
$function$
;

CREATE OR REPLACE FUNCTION public.admin_modify_investments(p_user_id uuid, p_amount numeric, p_action text, p_reason text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=(select auth.uid());v_old numeric;v_new numeric;v_delta numeric;
begin
  if public.get_authority_role(v_actor)<>'Admin' then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
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
$function$
;

CREATE OR REPLACE FUNCTION public.admin_archive_support_ticket(p_ticket_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_admin_id uuid:=auth.uid();
  v_ticket public.support_tickets%rowtype;
begin
  if public.get_authority_role(v_admin_id)<>'Admin' then
    raise exception 'Acesso permitido apenas à administração.' using errcode='42501';
  end if;
  select * into v_ticket from public.support_tickets where id=p_ticket_id for update;
  if not found then raise exception 'Ticket não encontrado.'; end if;
  if v_ticket.deleted_at is not null then return jsonb_build_object('success',true,'already_deleted',true); end if;

  update public.support_tickets
  set deleted_at=clock_timestamp(),deleted_by=v_admin_id,
      deletion_reason=nullif(left(btrim(coalesce(p_reason,'')),500),''),
      status='closed',closed_at=coalesce(closed_at,clock_timestamp()),updated_at=clock_timestamp()
  where id=p_ticket_id;

  insert into public.security_audit_log(action,target_table,target_id,actor_id,actor_role,old_data,new_data,metadata)
  values('support_ticket_archived','support_tickets',p_ticket_id::text,v_admin_id,'Admin',
    to_jsonb(v_ticket),
    jsonb_build_object('deleted_at',clock_timestamp(),'deleted_by',v_admin_id,'reason',nullif(btrim(coalesce(p_reason,'')),'')),
    jsonb_build_object('public_id',v_ticket.public_id));

  return jsonb_build_object('success',true,'message','Ticket excluído da fila ativa.');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.expel_party_member(p_party_id uuid, p_member_id_to_expel uuid, p_reason text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := auth.uid(); actor_role public.party_role; target_role public.party_role;
  actor_rank int; target_rank int; party_name text; member_name text;
begin
  if actor = p_member_id_to_expel then return json_build_object('success',false,'message','Use a opção de desfiliação para sair do partido.'); end if;
  select name into party_name from public.political_parties where id=p_party_id for update;
  select role into actor_role from public.party_members where party_id=p_party_id and user_id=actor;
  select role into target_role from public.party_members where party_id=p_party_id and user_id=p_member_id_to_expel;
  if target_role is null then return json_build_object('success',false,'message','Membro não encontrado no partido.'); end if;
  actor_rank := case actor_role when 'Dono' then 4 when 'Presidente' then 3 when 'Vice-Presidente' then 2 else 1 end;
  target_rank := case target_role when 'Dono' then 4 when 'Presidente' then 3 when 'Vice-Presidente' then 2 else 1 end;
  if public.get_authority_role(actor) <> 'Admin' and (actor_role is null or actor_rank <= target_rank or actor_rank < 3) then
    return json_build_object('success',false,'message','A hierarquia não permite expulsar este integrante.');
  end if;
  if nullif(trim(p_reason),'') is null then return json_build_object('success',false,'message','Informe o motivo da expulsão.'); end if;

  select full_name into member_name from public.profiles where id=p_member_id_to_expel;
  update public.political_parties set president_id=null where id=p_party_id and president_id=p_member_id_to_expel;
  update public.political_parties set vice_president_id=null where id=p_party_id and vice_president_id=p_member_id_to_expel;
  delete from public.party_members where party_id=p_party_id and user_id=p_member_id_to_expel;
  insert into public.party_history(party_id,actor_id,event_type,summary,previous_state)
  values(p_party_id,actor,'member_expelled',coalesce(member_name,'Membro')||' foi expulso: '||trim(p_reason),jsonb_build_object('userId',p_member_id_to_expel,'role',target_role));
  insert into public.notifications(user_id,sender_id,type,content,link)
  values(p_member_id_to_expel,actor,'party_expelled','Você foi expulso do partido '||party_name||'. Motivo: '||trim(p_reason),'/services/political-parties');
  return json_build_object('success',true,'message','Membro expulso com sucesso.');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.configure_citizen_needs(p_config jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare old_cfg jsonb; k text; v numeric;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and public.is_admin(id)) then raise exception 'Somente a administração pode configurar as necessidades.' using errcode='42501'; end if;
 if jsonb_typeof(p_config) is distinct from 'object' or jsonb_typeof(p_config->'decay_per_rp_day') is distinct from 'object' then raise exception 'Informe uma configuração válida.'; end if;
 if (p_config-array['decay_per_rp_day','sleep_duration_real_minutes','offline_floor','grace_rp_days','bath_cooldown_rp_hours','sleep_cooldown_rp_hours','social_daily_cap'])<>'{}'
   or ((p_config->'decay_per_rp_day')-array['hunger','thirst','hygiene','social','sleep'])<>'{}' then raise exception 'Há uma configuração de necessidade desconhecida.'; end if;
 foreach k in array array['hunger','thirst','hygiene','social','sleep'] loop
   v:=(p_config->'decay_per_rp_day'->>k)::numeric;
   if v is null or v::text in('NaN','Infinity','-Infinity') or v<0 or v>10 then raise exception 'O decaimento diário deve ficar entre zero e dez pontos RP.'; end if;
 end loop;
 foreach k in array array['sleep_duration_real_minutes','offline_floor','grace_rp_days','bath_cooldown_rp_hours','sleep_cooldown_rp_hours','social_daily_cap'] loop
   v:=(p_config->>k)::numeric;
   if v is null or v::text in('NaN','Infinity','-Infinity') or v<>trunc(v) or v<0 or v>100 then raise exception 'Use valores inteiros de zero a cem.'; end if;
 end loop;
 if (p_config->>'sleep_duration_real_minutes')::numeric not between 1 and 100 or (p_config->>'offline_floor')::numeric not between 0 and 20 or (p_config->>'grace_rp_days')::numeric<1
   or (p_config->>'bath_cooldown_rp_hours')::numeric<1 or (p_config->>'sleep_cooldown_rp_hours')::numeric<1 or (p_config->>'social_daily_cap')::numeric>20
 then raise exception 'Preserve a carência, o piso recuperável e os limites de descanso.'; end if;
 select value into old_cfg from public.system_settings where key='citizen_needs' for update;
 update public.system_settings set value=p_config where key='citizen_needs';
 perform economy_private.audit('citizen_needs_configured','system_settings','citizen_needs',old_cfg,p_config,'Configuração das necessidades do cidadão.',auth.uid());
 return p_config;
end; $function$
;

CREATE OR REPLACE FUNCTION public.process_official_payroll()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cfg jsonb; recipients jsonb; recipient jsonb; week_start timestamptz:=private.payroll_week(clock_timestamp());
 treasury numeric; total numeric:=0; count integer:=0; payment uuid; batch uuid:=gen_random_uuid(); amount numeric;
begin
 if not (session_user in ('postgres','supabase_admin') and auth.uid() is null and coalesce(auth.role(),'')='') and coalesce(auth.role(),'')<>'service_role' and not exists(select 1 from public.profiles where id=auth.uid() and public.is_admin(id) and deleted_at is null) then raise exception 'A rotina salarial exige autorização administrativa.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtext('govrp:official-payroll'));
 select value into cfg from public.system_settings where key='official_salaries' for share;
 select treasury_balance into treasury from public.government_finances where id=1 for update;
 if treasury is null then raise exception 'As finanças públicas não estão disponíveis.'; end if;
 with eligible as (
  select p.id,a.id account_id,r.value salary,
    case when (r.value->>'valid_from')::timestamptz>week_start then (r.value->>'previous_amount')::numeric else (r.value->>'amount')::numeric end amount
  from public.profiles p join public.accounts a on a.user_id=p.id
   join lateral jsonb_array_elements(cfg->'roles') r on r.value->>'role'=public.canonical_official_role(p.role)
  where p.deleted_at is null and p.onboarding_completed
   and not exists(select 1 from public.salary_payments sp where sp.user_id=p.id and sp.paid_at>=week_start)
  order by p.id for update of p,a
 ) select coalesce(jsonb_agg(to_jsonb(eligible)),'[]'),coalesce(sum(eligible.amount),0) into recipients,total from eligible where eligible.amount>0;
 if total>treasury then
  for recipient in select value from jsonb_array_elements(recipients) loop
   insert into public.notifications(user_id,type,content,link,metadata)
   select (recipient->>'id')::uuid,'salary_payment_failed','O pagamento semanal aguarda saldo suficiente no Tesouro.','/services/bank',jsonb_build_object('payroll_window_start',week_start,'expected_amount',recipient->'amount','popup_pending',true)
   where not exists(select 1 from public.notifications where user_id=(recipient->>'id')::uuid and type='salary_payment_failed' and metadata->>'payroll_window_start'=week_start::text);
  end loop;
  return jsonb_build_object('success',false,'processedCount',0,'totalAmount',total,'failedDueToFunds',true,'message','Saldo insuficiente no Tesouro. Nenhum débito foi realizado.');
 end if;
 for recipient in select value from jsonb_array_elements(recipients) loop
  amount:=(recipient->>'amount')::numeric;
  insert into public.salary_payments(user_id,role,title,amount,paid_at,payment_batch_id,payroll_window_start,salary_snapshot)
  values((recipient->>'id')::uuid,recipient->'salary'->>'role',recipient->'salary'->>'title',amount,clock_timestamp(),batch,week_start,recipient->'salary'||jsonb_build_object('paid_amount',amount)) returning id into payment;
  update public.accounts set balance=balance+amount,updated_at=clock_timestamp() where id=(recipient->>'account_id')::uuid;
  insert into public.transactions(to_account_id,amount,type,description,metadata)
  values((recipient->>'account_id')::uuid,amount,'salary_payment','Pagamento semanal: '||(recipient->'salary'->>'title'),jsonb_build_object('role',recipient->'salary'->>'role','salary_payment_id',payment,'payroll_window_start',week_start,'salary_snapshot',recipient->'salary','gross_amount',amount,'net_amount',amount,'tax_amount',0));
  insert into public.notifications(user_id,type,content,link,metadata)
  values((recipient->>'id')::uuid,'salary_payment','Seu salário semanal de '||(recipient->'salary'->>'title')||' foi depositado: R$ '||to_char(amount,'FM999999990D00')||'.','/services/bank',jsonb_build_object('salary_payment_id',payment,'payroll_window_start',week_start,'amount',amount,'role',recipient->'salary'->>'role','popup_pending',true,'popup_shown_at',null));
  count:=count+1;
 end loop;
 update public.government_finances set treasury_balance=treasury_balance-total,updated_at=clock_timestamp() where id=1;
 perform economy_private.audit('official_payroll_processed','salary_payments',batch::text,null,jsonb_build_object('count',count,'total',total,'week_start',week_start),'Pagamento semanal atômico dos cargos oficiais.',auth.uid());
 return jsonb_build_object('success',true,'processedCount',count,'totalAmount',total,'payrollWindowStart',week_start,'failedDueToFunds',false,'message','Folha semanal processada.');
end; $function$
;

CREATE OR REPLACE FUNCTION public.configure_official_salary(p_role text, p_amount numeric, p_expected_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cfg jsonb; entry jsonb; previous jsonb; index integer; effective timestamptz;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and public.is_admin(id) and deleted_at is null) then raise exception 'Somente a administração pode configurar a remuneração.' using errcode='42501'; end if;
 if p_amount is null or p_amount::text in('NaN','Infinity','-Infinity') or p_amount<0 or p_amount>1000000 or p_amount<>round(p_amount,2) then raise exception 'Informe um valor de zero a um milhão, com até duas casas decimais.'; end if;
 select value into cfg from public.system_settings where key='official_salaries' for update;
 select value,ordinality::integer-1 into previous,index from jsonb_array_elements(cfg->'roles') with ordinality where value->>'role'=p_role;
 if previous is null then raise exception 'Selecione um cargo remunerado do catálogo oficial.'; end if;
 if p_expected_version is null or (previous->>'version')::integer<>p_expected_version then raise exception 'A remuneração foi alterada. Atualize os valores antes de salvar.'; end if;
 effective:=private.payroll_week(clock_timestamp())+interval '7 days';
 entry:=previous||jsonb_build_object('previous_amount',case when (previous->>'valid_from')::timestamptz>clock_timestamp() then (previous->>'previous_amount')::numeric else (previous->>'amount')::numeric end,'amount',p_amount,'valid_from',effective,'version',p_expected_version+1,'updated_by',auth.uid(),'updated_at',clock_timestamp());
 cfg:=jsonb_set(cfg,array['roles',index::text],entry);
 update public.system_settings set value=cfg,updated_at=clock_timestamp() where key='official_salaries';
 perform economy_private.audit('official_salary_configured','system_settings',p_role,previous,entry,'Configuração de salário para o próximo ciclo semanal.',auth.uid());
 return entry;
end; $function$
;

CREATE OR REPLACE FUNCTION public.set_party_leadership(p_party_id uuid, p_member_id uuid, p_role text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare party public.political_parties%rowtype; owner_id uuid; president_id uuid; vice_id uuid;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 select * into party from public.political_parties where id=p_party_id and status<>'Encerrado' for update;
 if not found then raise exception 'Este partido não está disponível.'; end if;
 if not (auth.uid()=party.owner_id or auth.uid()=party.president_id or public.get_authority_role(auth.uid())='Admin') is true then raise exception 'Sem permissão para alterar a liderança.'; end if;
 if not exists(select 1 from public.party_members where party_id=p_party_id and user_id=p_member_id) then raise exception 'O cidadão precisa integrar este partido.'; end if;
 owner_id:=party.owner_id; president_id:=party.president_id; vice_id:=party.vice_president_id;
 if p_role='Dono' then owner_id:=p_member_id;
 elsif p_role='Presidente' then president_id:=p_member_id;
 elsif p_role='Vice-Presidente' then vice_id:=p_member_id;
 elsif p_role='Membro' then
  if p_member_id=owner_id then raise exception 'Transfira a propriedade antes de remover a função do dono.'; end if;
  if president_id=p_member_id then president_id:=null; end if;
  if vice_id=p_member_id then vice_id:=null; end if;
 else raise exception 'Função partidária inválida.'; end if;
 if p_role in('Dono','Presidente') and vice_id=p_member_id then vice_id:=null; end if;
 return public.update_party_details(party.id,party.name,party.acronym,party.ideology,party.statute,party.logo_url,owner_id,president_id,vice_id,party.description,party.orientation);
end $function$
;

CREATE OR REPLACE FUNCTION public.update_party_details(p_party_id uuid, p_name text, p_acronym text, p_ideology text, p_statute text, p_logo_url text, p_owner_id uuid, p_president_id uuid, p_vice_president_id uuid, p_description text, p_orientation political_orientation)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); party public.political_parties%rowtype; admin boolean; prior jsonb;
begin
  select * into party from public.political_parties where id=p_party_id for update;
  if not found then return json_build_object('success',false,'message','Partido não encontrado.'); end if;
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  admin:=coalesce(public.get_authority_role(actor)='Admin',false);
  if not admin and not coalesce(actor=party.owner_id or actor=party.president_id,false) then return json_build_object('success',false,'message','Sem permissão para editar este partido.'); end if;
  if not admin and actor=party.president_id and actor<>party.owner_id and p_owner_id is distinct from party.owner_id then return json_build_object('success',false,'message','O presidente não pode transferir a propriedade.'); end if;
  if p_owner_id is null or not exists(select 1 from public.party_members where party_id=p_party_id and user_id=p_owner_id) then return json_build_object('success',false,'message','O dono precisa integrar o partido.'); end if;
  if p_president_id is not null and not exists(select 1 from public.party_members where party_id=p_party_id and user_id=p_president_id) then return json_build_object('success',false,'message','O presidente precisa integrar o partido.'); end if;
  if p_vice_president_id is not null and (p_vice_president_id in(p_owner_id,p_president_id) or not exists(select 1 from public.party_members where party_id=p_party_id and user_id=p_vice_president_id)) then return json_build_object('success',false,'message','O vice-presidente precisa ser outro integrante do partido.'); end if;
  if length(trim(coalesce(p_name,'')))<3 or length(trim(coalesce(p_acronym,'')))<2 then return json_build_object('success',false,'message','Nome e sigla são obrigatórios.'); end if;
  prior:=to_jsonb(party);
  update public.political_parties set name=trim(p_name),acronym=upper(trim(p_acronym)),ideology=trim(p_ideology),statute=p_statute,logo_url=p_logo_url,owner_id=p_owner_id,president_id=p_president_id,vice_president_id=p_vice_president_id,description=p_description,orientation=p_orientation where id=p_party_id;
  update public.party_members set role=case when user_id=p_owner_id then 'Dono'::public.party_role when user_id=p_president_id then 'Presidente'::public.party_role when user_id=p_vice_president_id then 'Vice-Presidente'::public.party_role else 'Membro'::public.party_role end where party_id=p_party_id;
  insert into public.party_history(party_id,actor_id,event_type,summary,previous_state,current_state) values(p_party_id,actor,'party_updated','Estrutura e dados partidários atualizados.',prior,jsonb_build_object('ownerId',p_owner_id,'presidentId',p_president_id,'vicePresidentId',p_vice_president_id,'name',trim(p_name)));
  return json_build_object('success',true,'message','Partido atualizado com sucesso.');
end; $function$
;

CREATE OR REPLACE FUNCTION public.manage_executive_appointment(p_office_key text, p_user_id uuid DEFAULT NULL::uuid, p_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cfg jsonb; office public.executive_office_definitions%rowtype; previous jsonb; target public.profiles%rowtype; entry jsonb; event_id uuid:=gen_random_uuid();
begin
 if coalesce(public.get_authority_role(auth.uid()),'') not in ('Presidente','Admin') then raise exception 'A nomeação exige autoridade presidencial.' using errcode='42501'; end if;
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
   update public.profiles set role=coalesce(previous->>'previous_role','Cidadão'),manual_role_override=false,role_assigned_at=clock_timestamp(),role_assigned_by=auth.uid(),updated_at=clock_timestamp() where id=(previous->>'user_id')::uuid and role=office.role_label;
 end if;
 if p_user_id is null then cfg:=jsonb_set(cfg,'{specialAppointments}',coalesce(cfg->'specialAppointments','{}')-p_office_key);
 else
   entry:=jsonb_build_object('user_id',p_user_id,'appointed_at',clock_timestamp(),'appointed_by',auth.uid(),'previous_role',target.role,'note',p_note,'government_id',(select id from public.government_terms where ended_at is null));
   cfg:=jsonb_set(cfg,'{specialAppointments}',coalesce(cfg->'specialAppointments','{}')||jsonb_build_object(p_office_key,entry));
   update public.profiles set role=office.role_label,manual_role_override=false,role_assigned_at=clock_timestamp(),role_assigned_by=auth.uid(),updated_at=clock_timestamp() where id=p_user_id;
 end if;
 insert into public.system_settings(key,value) values('executive_governance',cfg) on conflict(key) do update set value=excluded.value;
 insert into public.dou_entries(title,summary,content,type,source_id,legal_metadata)
 values(case when p_user_id is null then 'Exoneração: ' else 'Nomeação: ' end||office.role_label,
   case when p_user_id is null then 'O cargo foi desocupado.' else target.full_name||' assume o cargo.' end,
   coalesce(p_note,''),'Nomeacao e Exoneracao',event_id,jsonb_build_object('office_key',p_office_key,'actor_id',auth.uid(),'user_id',p_user_id,'previous',previous));
 perform economy_private.audit('executive_appointment_changed','system_settings',p_office_key,previous,entry,coalesce(p_note,'Nomeação executiva.'),auth.uid());
 return coalesce(entry,'{}');
end; $function$
;

CREATE OR REPLACE FUNCTION public.reactivate_state_enterprise(p_enterprise_id uuid)
 RETURNS state_enterprises
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare old_row public.state_enterprises%rowtype; new_row public.state_enterprises%rowtype;
begin
 if auth.uid() is null or not coalesce(public.get_authority_role(auth.uid()) in ('Admin','Presidente'),false) then raise exception 'Somente a autoridade executiva pode reestatizar este serviço.'; end if;
 select * into old_row from public.state_enterprises where id=p_enterprise_id for update;
 if not found then raise exception 'Estatal não encontrada.'; end if;
 if not old_row.is_privatized then return old_row; end if;
 update public.state_enterprises set is_privatized=false,is_active=true,privatization_status='none',privatization_price=null,privatization_buyer_id=null,privatized_at=null,operating_business_id=null,manager_id=null,updated_at=clock_timestamp() where id=p_enterprise_id returning * into new_row;
 perform public.justice_write_audit('state_enterprise.reactivated','state_enterprise',p_enterprise_id,to_jsonb(old_row),to_jsonb(new_row),'Reestatização pela autoridade executiva');
 if old_row.privatization_buyer_id is not null then
  insert into public.notifications(user_id,type,content,link,metadata) values(old_row.privatization_buyer_id,'state_enterprise_reactivated','O serviço '||old_row.name||' retornou à administração pública. Seu histórico financeiro foi preservado.','/services/entrepreneur-portal',jsonb_build_object('enterprise_id',p_enterprise_id));
 end if;
 return new_row;
end $function$
;

CREATE OR REPLACE FUNCTION public.close_leadership_election(p_election_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare house uuid;
begin
 select house_id into house from public.parliament_leadership_elections where id=p_election_id;
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and public.is_admin(id) and deleted_at is null) then raise exception 'Somente Admin pode encerrar manualmente esta eleição.' using errcode='42501'; end if;
 perform public.justice_write_audit('parliament.election_manual_close','parliament_leadership_election',p_election_id,null,null,'Apuração manual pelo Admin');
 return private.conclude_leadership_election(p_election_id);
end; $function$
;

CREATE OR REPLACE FUNCTION public.admin_close_party(p_party_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare party public.political_parties%rowtype;
begin
 if not coalesce(public.get_authority_role(auth.uid())='Admin',false) then raise exception 'Somente Admin pode encerrar o partido.' using errcode='42501'; end if;
 select * into party from public.political_parties where id=p_party_id for update;
 if not found then raise exception 'Partido não encontrado.'; end if;
 if party.status='Encerrado' then return; end if;
 insert into public.party_history(party_id,actor_id,event_type,summary,previous_state)
 values(p_party_id,auth.uid(),'closed_by_admin','Partido encerrado pela administração; histórico político e financeiro preservado.',jsonb_build_object('party',to_jsonb(party),'members',(select coalesce(jsonb_agg(to_jsonb(m)),'[]') from public.party_members m where party_id=p_party_id)));
 update public.political_parties set status='Encerrado',is_active=false,owner_id=null,president_id=null,vice_president_id=null where id=p_party_id;
 insert into public.notifications(user_id,type,content,link,metadata) select user_id,'party_closed','O partido '||party.name||' foi encerrado pela administração. Seu histórico foi preservado.','/services/political-parties',jsonb_build_object('party_id',p_party_id) from public.party_members where party_id=p_party_id;
 update public.party_affiliation_requests set status='rejected' where party_id=p_party_id and status='pending';
 delete from public.party_members where party_id=p_party_id;
 perform public.justice_write_audit('party.closed','political_party',party.id,to_jsonb(party),jsonb_build_object('status','Encerrado'),'Encerramento administrativo com preservação do histórico.');
end $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.admin_update_party(p_party_id uuid, p_changes jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result json; party public.political_parties%rowtype;
begin
 if not coalesce(public.get_authority_role(auth.uid())='Admin',false) then raise exception 'Somente Admin pode usar esta edição.' using errcode='42501'; end if;
 select * into party from public.political_parties where id=p_party_id for update;
 if not found or party.status='Encerrado' then raise exception 'O partido está encerrado ou indisponível.'; end if;
 if p_changes ? 'color' then perform public.set_party_color(p_party_id,p_changes->>'color'); end if;
 result:=public.update_party_details(p_party_id,p_changes->>'name',p_changes->>'acronym',p_changes->>'ideology',p_changes->>'statute',p_changes->>'logo_url',nullif(p_changes->>'owner_id','')::uuid,nullif(p_changes->>'president_id','')::uuid,nullif(p_changes->>'vice_president_id','')::uuid,p_changes->>'description',(p_changes->>'orientation')::public.political_orientation);
 if not coalesce((result->>'success')::boolean,false) then raise exception '%',coalesce(result->>'message','Não foi possível salvar o partido.'); end if;
 if p_changes->>'affiliation_mode' is distinct from party.affiliation_mode then
  result:=public.toggle_party_affiliation_mode(p_party_id,p_changes->>'affiliation_mode');
  if not coalesce((result->>'success')::boolean,false) then raise exception '%',result->>'message'; end if;
 end if;
end $function$
;

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
  if auth.uid() is null or not coalesce(auth.uid()=party.owner_id or auth.uid()=party.president_id or public.get_authority_role(auth.uid())='Admin',false) then return json_build_object('success',false,'message','Sem permissão para personalizar o partido.'); end if;
  if p_customization is null or jsonb_typeof(p_customization)<>'object' then return json_build_object('success',false,'message','Personalização inválida.'); end if;
  if p_customization ? 'font_key' and not public.valid_brand_font(p_customization->>'font_key') then raise exception 'Selecione uma fonte da biblioteca da plataforma.'; end if;
  if p_customization ? 'header_url' and coalesce(p_customization->>'header_url','')<>'' and p_customization->>'header_url' !~ '^https://' then raise exception 'Informe uma imagem HTTPS válida.'; end if;
  if party.status='Encerrado' then raise exception 'O partido está encerrado.'; end if;
  if p_customization ? 'logo_url' and coalesce(p_customization->>'logo_url','')<>'' and p_customization->>'logo_url' !~ '^https://' then raise exception 'Informe uma imagem HTTPS válida.'; end if;
  if p_customization ? 'logo_url' then update public.political_parties set logo_url=nullif(p_customization->>'logo_url','') where id=party.id; end if;
  if p_customization ? 'primary_color' then perform public.set_party_color(p_party_id,p_customization->>'primary_color'); end if;
  update public.political_parties set customization=coalesce(customization,'{}')||(p_customization-'primary_color') where id=party.id;
  insert into public.party_history(party_id,actor_id,event_type,summary,current_state) values(party.id,auth.uid(),'customization_updated','Página partidária personalizada.',p_customization);
  return json_build_object('success',true,'message','Página do partido atualizada.');
end; $function$
;

CREATE OR REPLACE FUNCTION public.get_executive_state()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT jsonb_build_object('government',to_jsonb(g),'head',CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('id',p.id,'full_name',p.full_name,'avatar_url',p.avatar_url,'role',p.role) END,
 'vice',(SELECT jsonb_build_object('id',v.id,'full_name',v.full_name,'avatar_url',v.avatar_url,'role',v.role) FROM public.profiles v WHERE v.role='Vice-Presidente' AND v.deleted_at IS NULL ORDER BY v.role_assigned_at DESC LIMIT 1),
 'is_interim',coalesce(g.is_interim,false),'authorized',coalesce(public.get_authority_role(auth.uid()) IN ('Presidente','Admin'),false))
 FROM (SELECT 1) seed LEFT JOIN public.government_terms g ON g.ended_at IS NULL AND g.term_ends_at>now()
 LEFT JOIN public.profiles p ON p.id=g.head_id AND p.deleted_at IS NULL AND (p.role='Presidente' OR public.is_acting_president(p.id));
$function$
;

CREATE OR REPLACE FUNCTION public.admin_get_all_users()
 RETURNS TABLE(id uuid, full_name text, username text, character_birth_date date, email text, real_full_name text, real_date_of_birth date, phone text, avatar_url text, role text, titles text[], x_handle text, has_bank_account boolean, balance numeric, onboarding_completed boolean, onboarding_step text, onboarding_version integer, onboarding_mode text, citizen_id uuid, citizenship_created_at timestamp with time zone, document_types text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if public.get_authority_role(auth.uid()) IS DISTINCT FROM 'Admin' then
    raise exception 'Acesso negado.';
  end if;

  return query
  select
    p.id::uuid,
    p.full_name::text,
    p.username::text,
    p.date_of_birth::date,
    coalesce(au.email::text, ai.email::text),
    ai.real_full_name::text,
    ai.real_date_of_birth::date,
    ai.phone::text,
    p.avatar_url::text,
    p.role::text,
    coalesce(p.titles, '{}'::text[])::text[],
    p.x_handle::text,
    (a.id is not null)::boolean,
    a.balance::numeric,
    p.onboarding_completed::boolean,
    p.onboarding_step::text,
    p.onboarding_version::integer,
    p.onboarding_mode::text,
    p.citizen_id::uuid,
    p.citizenship_created_at::timestamptz,
    coalesce((
      select array_agg(distinct d.type::text order by d.type::text)
      from public.documents d
      where d.user_id = p.id and d.is_valid
    ), '{}'::text[])::text[]
  from public.profiles p
  left join private.account_identities ai on ai.user_id = p.id
  left join auth.users au on au.id = p.id
  left join public.accounts a on a.user_id = p.id
  where p.deleted_at is null
  order by p.full_name nulls last, p.username;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_stats()
 RETURNS TABLE(total_users bigint, total_posts bigint, total_transactions bigint, total_accounts bigint, total_comments bigint, total_cards bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if public.get_authority_role(auth.uid()) IS DISTINCT FROM 'Admin' then
    raise exception 'Acesso negado: apenas administradores podem consultar estas estatísticas';
  end if;

  return query
  select
    (select count(*) from public.profiles where deleted_at is null),
    (select count(*) from public.posts),
    (select count(*) from public.transactions),
    (select count(*) from public.accounts a join public.profiles p on p.id = a.user_id where p.deleted_at is null),
    (select count(*) from public.comments),
    (select count(*) from public.cards c join public.profiles p on p.id = c.user_id where p.deleted_at is null);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_dashboard_growth_stats()
 RETURNS TABLE(new_users_last_24h bigint, new_posts_last_24h bigint, new_transactions_last_24h bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    -- Verifica o papel do usuário chamador
    IF NOT public.is_admin((SELECT auth.uid())) THEN
        RAISE EXCEPTION 'Acesso negado: apenas administradores podem consultar estas estatísticas';
    END IF;

    RETURN QUERY
    SELECT
        (SELECT COUNT(*) FROM public.profiles
         WHERE created_at >= now() - interval '24 hours')          AS new_users_last_24h,
        (SELECT COUNT(*) FROM public.posts
         WHERE created_at >= now() - interval '24 hours')          AS new_posts_last_24h,
        (SELECT COUNT(*) FROM public.transactions
         WHERE created_at >= now() - interval '24 hours')          AS new_transactions_last_24h;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_users_with_pending_invoices()
 RETURNS TABLE(id uuid, full_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Permission denied. Not an admin.';
  END IF;

  RETURN QUERY
  SELECT DISTINCT p.id, p.full_name
  FROM public.profiles p
  JOIN public.card_invoices ci ON p.id = ci.user_id
  WHERE ci.status = 'pending' AND ci.amount > 0;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_pay_invoice(p_invoice_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    admin_user_id UUID := auth.uid();
    invoice_info RECORD;
BEGIN
    IF NOT public.is_admin(admin_user_id) THEN
        RETURN json_build_object('success', false, 'message', 'Apenas administradores podem executar esta ação.');
    END IF;

    SELECT * INTO invoice_info FROM public.card_invoices WHERE id = p_invoice_id;

    IF invoice_info IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Fatura não encontrada.');
    END IF;

    IF invoice_info.status = 'paid' THEN
        RETURN json_build_object('success', false, 'message', 'Esta fatura já foi paga.');
    END IF;

    -- Update card used limit
    UPDATE public.cards SET used_limit = GREATEST(0, used_limit - invoice_info.amount) WHERE id = invoice_info.card_id;

    -- Update invoice status
    UPDATE public.card_invoices SET status = 'paid', amount = 0, updated_at = now() WHERE id = p_invoice_id;

    RETURN json_build_object('success', true, 'message', 'Fatura quitada com sucesso em nome do usuário.');
EXCEPTION
    WHEN others THEN
        RETURN json_build_object('success', false, 'message', 'Ocorreu um erro inesperado.');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_change_user_password(p_user_id uuid, p_new_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if public.get_authority_role(auth.uid()) IS DISTINCT FROM 'Admin' then raise exception 'Apenas administradores podem alterar credenciais.'; end if;
  if length(coalesce(p_new_password,''))<8 then return jsonb_build_object('success',false,'message','A senha deve conter ao menos 8 caracteres.'); end if;
  update auth.users set encrypted_password=extensions.crypt(p_new_password,extensions.gen_salt('bf')),updated_at=clock_timestamp() where id=p_user_id;
  if not found then return jsonb_build_object('success',false,'message','Usuário não encontrado.'); end if;
  return jsonb_build_object('success',true,'message','Senha atualizada com sucesso.');
end; $function$
;

CREATE OR REPLACE FUNCTION public.admin_correct_party_founder(p_party_id uuid, p_founder_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare old_founder uuid;
begin
  if public.get_authority_role(auth.uid()) IS DISTINCT FROM 'Admin' then raise exception 'Apenas a administração pode corrigir o fundador histórico.'; end if;
  if length(trim(coalesce(p_reason,'')))<20 then raise exception 'A correção exige justificativa detalhada.'; end if;
  if not exists(select 1 from public.profiles where id=p_founder_id) then raise exception 'Fundador informado não existe.'; end if;
  select founder_id into old_founder from public.political_parties where id=p_party_id for update;
  if old_founder is null then raise exception 'Partido não encontrado.'; end if;
  perform set_config('govrp.allow_founder_correction','on',true);
  update public.political_parties set founder_id=p_founder_id where id=p_party_id;
  insert into public.party_history(party_id,actor_id,event_type,summary,previous_state,current_state)
  values(p_party_id,auth.uid(),'founder_corrected',trim(p_reason),jsonb_build_object('founderId',old_founder),jsonb_build_object('founderId',p_founder_id));
  return jsonb_build_object('success',true);
end; $function$
;

CREATE OR REPLACE FUNCTION public.admin_reset_citizen_onboarding(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if public.get_authority_role(auth.uid()) IS DISTINCT FROM 'Admin' then
    raise exception 'Apenas administradores podem reiniciar o primeiro acesso.';
  end if;
  update public.profiles set onboarding_completed = false, onboarding_step = 'identity',
    onboarding_mode = 'legacy_migration', onboarding_version = 2,
    onboarding_updated_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = p_user_id;
  if not found then raise exception 'Cidadão não encontrado.'; end if;
  perform public.record_citizen_lifecycle_event(
    p_user_id, 'onboarding_reset', 'Onboarding reiniciado por um administrador.',
    jsonb_build_object('preserved_documents', true, 'preserved_bank_account', true),
    'onboarding-reset:' || gen_random_uuid(), auth.uid()
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_update_citizen_identity(p_user_id uuid, p_character_full_name text, p_username text, p_character_birth_date date, p_real_full_name text DEFAULT NULL::text, p_real_birth_date date DEFAULT NULL::date, p_onboarding_step text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if public.get_authority_role(auth.uid()) IS DISTINCT FROM 'Admin' then raise exception 'Acesso negado.'; end if;
  if p_onboarding_step is not null and p_onboarding_step not in (
    'welcome','identity','origin','profile','civil_documents','mandatory_documents','initial_status','citizenship','completed'
  ) then raise exception 'Etapa inválida.'; end if;
  update public.profiles set
    full_name = coalesce(nullif(regexp_replace(trim(p_character_full_name), '\s+', ' ', 'g'), ''), full_name),
    username = coalesce(nullif(lower(trim(leading '@' from trim(p_username))), ''), username),
    date_of_birth = coalesce(p_character_birth_date, date_of_birth),
    onboarding_step = coalesce(p_onboarding_step, onboarding_step),
    onboarding_updated_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = p_user_id;
  update private.account_identities set
    real_full_name = coalesce(nullif(trim(p_real_full_name), ''), real_full_name),
    real_date_of_birth = coalesce(p_real_birth_date, real_date_of_birth), updated_at = clock_timestamp()
  where user_id = p_user_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_party(p_party_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare party public.political_parties%rowtype;
begin
  select * into party from public.political_parties where id=p_party_id for update;
  if not found then return json_build_object('success',false,'message','Partido não encontrado.'); end if;
  if auth.uid() is null or (auth.uid() is distinct from party.owner_id and public.get_authority_role(auth.uid()) is distinct from 'Admin') then return json_build_object('success',false,'message','Apenas o dono atual pode encerrar o partido.'); end if;
  insert into public.party_history(party_id,actor_id,event_type,summary,previous_state)
  values(party.id,auth.uid(),'party_closed','Partido encerrado pelo dono atual ou pela administração.',to_jsonb(party));
  update public.political_parties set status='Encerrado',is_active=false where id=p_party_id;
  return json_build_object('success',true,'message','Partido encerrado com sucesso.');
end; $function$
;

CREATE OR REPLACE FUNCTION public.toggle_party_affiliation_mode(p_party_id uuid, p_mode text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare party public.political_parties%rowtype;
begin
  select * into party from public.political_parties where id=p_party_id for update;
  if not found then return json_build_object('success',false,'message','Partido não encontrado.'); end if;
  if auth.uid() is null or (auth.uid() is distinct from party.owner_id and auth.uid() is distinct from party.president_id and public.get_authority_role(auth.uid()) is distinct from 'Admin') then return json_build_object('success',false,'message','Somente o dono ou presidente pode alterar as filiações.'); end if;
  if p_mode not in('automatic','manual') then return json_build_object('success',false,'message','Modo de filiação inválido.'); end if;
  update public.political_parties set affiliation_mode=p_mode where id=party.id;
  insert into public.party_history(party_id,actor_id,event_type,summary,previous_state,current_state) values(party.id,auth.uid(),'affiliation_mode_changed','Modo de filiação atualizado.',jsonb_build_object('mode',party.affiliation_mode),jsonb_build_object('mode',p_mode));
  return json_build_object('success',true,'message','Modo de filiação atualizado.');
end; $function$
;

CREATE OR REPLACE FUNCTION public.economic_has_role(p_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select (public.is_admin(auth.uid()) and 'admin'=any(select lower(unnest(p_roles)))) or (public.is_acting_president(auth.uid()) and 'presidente'=any(select lower(unnest(p_roles)))) or exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and (
        lower(p.role) = any (
          select lower(unnest(p_roles))
        )
        or exists (
          select 1
          from unnest(coalesce(p.titles, array[]::text[])) title
          where lower(title)<>'admin' and lower(title) = any (
            select lower(unnest(p_roles))
          )
        )
        or (
          (
            lower(p.role) = 'presidente do banco nacional'
            or exists (
              select 1
              from unnest(coalesce(p.titles, array[]::text[])) title
              where lower(title) = 'presidente do banco nacional'
            )
          )
          and exists (
            select 1
            from unnest(p_roles) requested_role
            where lower(requested_role) in ('banco central', 'presidente do banco central')
          )
        )
      )
  );
$function$

;

CREATE OR REPLACE FUNCTION public.justice_has_role(p_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select (public.is_admin(auth.uid()) and 'admin'=any(select lower(unnest(p_roles)))) or (public.is_acting_president(auth.uid()) and 'presidente'=any(select lower(unnest(p_roles)))) or exists(select 1 from public.profiles p cross join lateral unnest(array[p.role]||coalesce(p.titles,'{}')) r
 cross join lateral unnest(public.official_role_capabilities(r)) cap
 where p.id=(select auth.uid()) and p.deleted_at is null and lower(cap)<>'admin' and lower(cap)=any(select lower(unnest(p_roles))));
$function$

;

grant execute on function public.get_authority_role(uuid) to authenticated,service_role;
notify pgrst,'reload schema';

create or replace function public.admin_update_user_with_access(p_user_id uuid,p_full_name text,p_username text,p_role text,p_titles text[],p_platform_admin boolean default null) returns json language plpgsql security definer set search_path='' as $$
declare result json;
begin
 if not public.is_admin(auth.uid()) then raise exception 'Somente a administração pode alterar contas.' using errcode='42501';end if;
 perform public.assert_admin_real_action(auth.uid());
 perform pg_advisory_xact_lock(hashtextextended('platform-admin-membership',0));
 if p_platform_admin=false and exists(select 1 from private.platform_admins where user_id=p_user_id) and (select count(*) from private.platform_admins)<=1 then raise exception 'Mantenha pelo menos um administrador técnico ativo.';end if;
 if p_role='Admin' then raise exception 'Escolha o cargo real do personagem. A administração técnica é configurada separadamente.';end if;
 result:=public.admin_update_user(p_user_id,p_full_name,p_username,p_role,p_titles);
 if p_platform_admin is not null then
  if p_platform_admin then insert into private.platform_admins(user_id,granted_by) values(p_user_id,auth.uid()) on conflict(user_id) do nothing;
  else delete from private.platform_admins where user_id=p_user_id;delete from private.admin_development_modes where user_id=p_user_id;end if;
  insert into public.security_audit_log(action,target_table,target_id,actor_id,actor_role,metadata) values('platform_admin_membership_changed','platform_admins',p_user_id::text,auth.uid(),'Admin',jsonb_build_object('enabled',p_platform_admin,'mode','real','impacts_production',true));
 end if;
 return result;
end $$;
revoke all on function public.admin_update_user_with_access(uuid,text,text,text,text[],boolean) from public,anon;
grant execute on function public.admin_update_user_with_access(uuid,text,text,text,text[],boolean) to authenticated;
notify pgrst,'reload schema';

CREATE OR REPLACE FUNCTION public.admin_update_user(p_user_id uuid, p_full_name text, p_username text, p_role text, p_titles text[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  previous public.profiles%rowtype;
  updated public.profiles%rowtype;
  next_role text := public.canonical_official_role(btrim(p_role));
  changed boolean;
  previous_context text := current_setting('govrp.admin_role_change', true);
begin
  if auth.uid() is null or not coalesce(public.is_admin(auth.uid()), false) then
    raise exception 'Apenas administradores podem executar esta ação.' using errcode = '42501';
  end if;
  if nullif(btrim(p_full_name), '') is null or nullif(btrim(p_username), '') is null or nullif(next_role, '') is null then
    raise exception 'Informe nome, nome de usuário e cargo.' using errcode = '22023';
  end if;
  select * into previous from public.profiles where id = p_user_id and deleted_at is null for update;
  if not found then raise exception 'Usuário não encontrado.' using errcode = '22023'; end if;
  if next_role='Admin' or 'Admin'=any(coalesce(p_titles,'{}')) then raise exception 'Configure a administração técnica separadamente do cargo e dos títulos do personagem.';end if;
  changed := previous.role is distinct from next_role;
  perform set_config('govrp.admin_role_change', p_user_id::text, true);
  update public.profiles set
    full_name = btrim(p_full_name), username = btrim(p_username), role = next_role,
    titles = coalesce(p_titles, '{}'::text[]),
    manual_role_override = case when changed then true else previous.manual_role_override end,
    role_assigned_at = case when changed then clock_timestamp() else previous.role_assigned_at end,
    role_assigned_by = case when changed then auth.uid() else previous.role_assigned_by end,
    updated_at = clock_timestamp()
  where id = p_user_id returning * into updated;
  perform set_config('govrp.admin_role_change', coalesce(previous_context, ''), true);
  return json_build_object('success', true, 'message', 'Usuário atualizado com sucesso.', 'user',
    json_build_object('id', updated.id, 'full_name', updated.full_name, 'username', updated.username,
      'role', updated.role, 'titles', updated.titles, 'manual_role_override', updated.manual_role_override));
end $function$

;

create or replace function public.is_admin_preview() returns boolean language sql stable security definer set search_path='' as $$
 select public.is_admin(auth.uid()) and exists(select 1 from private.admin_development_modes where user_id=auth.uid() and mode<>'normal' and not execute_real);
$$;
revoke all on function public.is_admin_preview() from public,anon;
grant execute on function public.is_admin_preview() to authenticated;
create policy block_admin_preview_asset_insert on storage.objects as restrictive for insert to authenticated with check(not public.is_admin_preview());
create policy block_admin_preview_asset_update on storage.objects as restrictive for update to authenticated using(not public.is_admin_preview()) with check(not public.is_admin_preview());
create policy block_admin_preview_asset_delete on storage.objects as restrictive for delete to authenticated using(not public.is_admin_preview());
notify pgrst,'reload schema';

CREATE OR REPLACE FUNCTION private.can_manage_company(p_business_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select p_user_id is not null and ((public.is_admin(p_user_id) and exists(select 1 from private.admin_development_modes where user_id=p_user_id and mode='total')) or exists(select 1 from public.businesses where id=p_business_id and owner_id=p_user_id) or exists(select 1 from public.business_employees e join public.business_role_templates t on t.id=e.role_template_id where e.business_id=p_business_id and e.profile_id=p_user_id and e.fired_at is null and t.can_manage))
$function$

;

create or replace function public.get_platform_admin_ids() returns uuid[] language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_admin(auth.uid()) then raise exception 'Consulta restrita à administração técnica.' using errcode='42501';end if;
 return array(select p.id from public.profiles p where p.deleted_at is null and public.is_admin(p.id));
end $$;
revoke all on function public.get_platform_admin_ids() from public,anon;
grant execute on function public.get_platform_admin_ids() to authenticated;

commit;
