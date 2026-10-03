begin;

-- Only trusted schemas may participate in name resolution. pg_temp is explicit
-- and last, so temporary tables cannot shadow application relations.
revoke create on schema public from public, anon, authenticated;
do $hardening$
declare f record;
begin
 for f in select p.oid, p.oid::regprocedure as signature, p.prokind from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind in ('f','p')
    and not exists(select 1 from unnest(p.proconfig) c where c like 'search_path=%')
 loop
  execute format('alter %s %s set search_path = pg_catalog, public, extensions, pg_temp',
    case f.prokind when 'p' then 'procedure' else 'function' end, f.signature);
 end loop;
end $hardening$;

-- Foreign tables cannot enforce RLS and must not be exposed by PostgREST.
-- No application query, function or view depends on this legacy Stripe FDW.
do $hardening$
begin
 if to_regclass('public.stripe_prices') is not null then
  revoke all on public.stripe_prices from public, anon, authenticated;
  alter foreign table public.stripe_prices set schema private;
 end if;
end $hardening$;

-- Intentional public APIs: public aggregates, public identities and contact form.
-- Preserve existing authenticated/service grants while removing PUBLIC inheritance.
do $hardening$
declare f record;
 public_api constant text[] := array[
  'get_basic_service_prices','get_bank_policy','get_public_wanted_list',
  'get_public_economic_dashboard','get_public_dashboard_stats','get_server_now',
  'get_national_feed','get_country_constitution','get_daily_news','get_rp_exchange_quotes',
  'get_public_party_profiles','get_citizen_rankings','get_election_results',
  'get_electoral_candidate_identities','get_government_rule','quote_legal_levies',
  'get_products_with_final_price','create_support_ticket',
  'get_user_role','is_admin','user_can_manage_national_bank','is_national_bank_manager'
 ];
 internal_only constant text[] := array[
  'award_political_points','sync_political_point_awards','process_citizen_income',
  'process_weekly_service_bills','process_card_transactions_for_invoice',
  'publish_parliament_leadership_gazette_event','refresh_brazil_rp_political_state',
  'check_police_query','get_inmates','next_support_ticket_number',
  'record_citizen_lifecycle_event','apply_population_consequence',
  'recalculate_country_activity_mix','resolve_expired_national_game_events'
 ];
begin
 for f in select p.oid,p.oid::regprocedure signature,p.proname,p.prorettype,
   has_function_privilege('anon',p.oid,'EXECUTE') was_anon,
   has_function_privilege('authenticated',p.oid,'EXECUTE') was_authenticated,
   has_function_privilege('service_role',p.oid,'EXECUTE') was_service
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f'
    and (p.prosecdef or p.prorettype in('trigger'::regtype,'event_trigger'::regtype) or p.proname=any(internal_only))
 loop
  execute format('revoke execute on function %s from public, anon, authenticated',f.signature);
  if f.was_service then execute format('grant execute on function %s to service_role',f.signature);end if;
  if f.prorettype in('trigger'::regtype,'event_trigger'::regtype) or f.proname=any(internal_only) then continue;end if;
  if f.was_authenticated then execute format('grant execute on function %s to authenticated',f.signature);end if;
  if f.was_anon and f.proname=any(public_api) then execute format('grant execute on function %s to anon',f.signature);end if;
 end loop;
end $hardening$;

-- Future migrations must opt into API exposure explicitly.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;

-- No elevated access is needed to return the current database timestamp.
alter function public.get_server_now() security invoker;

-- This RLS helper may only enumerate the caller's own conversations.
create or replace function public.get_user_conversation_ids(p_user uuid)
returns setof uuid language sql stable security definer set search_path='' as $function$
 select cp.conversation_id from public.x_conversation_participants cp
 where cp.user_id=p_user and p_user=(select auth.uid());
$function$;

-- Preserve the existing administrative bank screen without exposing third-party balances.
create or replace function public.get_total_invested_by_user(p_user_id uuid)
returns numeric language plpgsql stable security definer set search_path='' as $function$
begin
 if auth.uid() is null or (p_user_id is distinct from auth.uid() and not public.is_admin(auth.uid())) then
  raise exception 'Você não tem permissão para consultar os investimentos deste cidadão.' using errcode='42501';
 end if;
 return (select coalesce(sum(amount_invested),0) from public.user_investments where user_id=p_user_id);
end;
$function$;

-- NULL roles (expired/deleted identities) must fail closed, just like other non-admin roles.
CREATE OR REPLACE FUNCTION public.get_dashboard_growth_stats()
 RETURNS TABLE(new_users_last_24h bigint, new_posts_last_24h bigint, new_transactions_last_24h bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, extensions, pg_temp
AS $function$
BEGIN
    -- Verifica o papel do usuário chamador
    IF (SELECT role FROM public.profiles WHERE id = (SELECT auth.uid())) IS DISTINCT FROM 'Admin' THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.get_users_with_pending_invoices()
 RETURNS TABLE(id uuid, full_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, extensions, pg_temp
AS $function$
BEGIN
  IF (SELECT role FROM public.profiles WHERE public.profiles.id = auth.uid()) IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'Permission denied. Not an admin.';
  END IF;

  RETURN QUERY
  SELECT DISTINCT p.id, p.full_name
  FROM public.profiles p
  JOIN public.card_invoices ci ON p.id = ci.user_id
  WHERE ci.status = 'pending' AND ci.amount > 0;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_pay_invoice(p_invoice_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, extensions, pg_temp
AS $function$
DECLARE
    admin_user_id UUID := auth.uid();
    invoice_info RECORD;
BEGIN
    IF (SELECT role FROM public.profiles WHERE id = admin_user_id) IS DISTINCT FROM 'Admin' THEN
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
$function$;

-- Administrative identity queries must also reject deleted/missing profile roles.
do $hardening$
declare target regprocedure; definition text;
begin
 for target in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname=any(array['admin_get_all_users','get_admin_dashboard_stats','admin_change_user_password','admin_correct_party_founder','admin_update_citizen_identity','admin_reset_citizen_onboarding']) loop
  definition:=pg_get_functiondef(target);
  if definition ~ 'public\.get_user_role\(auth\.uid\(\)\)\s*<>\s*''Admin''' then
   execute regexp_replace(definition,'public\.get_user_role\(auth\.uid\(\)\)\s*<>\s*''Admin''',
    'public.get_user_role(auth.uid()) IS DISTINCT FROM ''Admin''','g');
  elsif position('public.get_user_role(auth.uid()) IS DISTINCT FROM ''Admin''' in definition)=0 then
   raise exception 'Administrative authorization changed; review % before migration',target;
  end if;
 end loop;
end $hardening$;

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
  if auth.uid() is null or (auth.uid() is distinct from party.owner_id and public.get_user_role(auth.uid()) is distinct from 'Admin') then return json_build_object('success',false,'message','Apenas o dono atual pode encerrar o partido.'); end if;
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
  if auth.uid() is null or (auth.uid() is distinct from party.owner_id and auth.uid() is distinct from party.president_id and public.get_user_role(auth.uid()) is distinct from 'Admin') then return json_build_object('success',false,'message','Somente o dono ou presidente pode alterar as filiações.'); end if;
  if p_mode not in('automatic','manual') then return json_build_object('success',false,'message','Modo de filiação inválido.'); end if;
  update public.political_parties set affiliation_mode=p_mode where id=party.id;
  insert into public.party_history(party_id,actor_id,event_type,summary,previous_state,current_state) values(party.id,auth.uid(),'affiliation_mode_changed','Modo de filiação atualizado.',jsonb_build_object('mode',party.affiliation_mode),jsonb_build_object('mode',p_mode));
  return json_build_object('success',true,'message','Modo de filiação atualizado.');
end; $function$
;
-- Qualify the settings key; the loop variable must not shadow the table column.
CREATE OR REPLACE FUNCTION public.configure_executive_transition_rules(p_rules jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE cfg jsonb; key text;
BEGIN
 IF NOT coalesce(public.is_admin(auth.uid()),false) THEN RAISE EXCEPTION 'Somente Admin pode configurar os prazos institucionais.' USING errcode='42501'; END IF;
 SELECT setting.value INTO cfg FROM public.system_settings setting WHERE setting.key='executive_transition_rules' FOR UPDATE;
 FOR key IN SELECT jsonb_object_keys(p_rules) LOOP
  IF key NOT IN ('direct_call_hours','indirect_call_hours','candidacy_hours','voting_hours','indirect_quorum_numerator','indirect_quorum_denominator','administrative_term_days') THEN RAISE EXCEPTION 'Parâmetro institucional desconhecido.'; END IF;
  IF (p_rules->>key)::numeric<=0 OR (p_rules->>key)::numeric>720 OR (p_rules->>key)::numeric<>trunc((p_rules->>key)::numeric) THEN RAISE EXCEPTION 'Informe valores inteiros entre 1 e 720.'; END IF;
 END LOOP;
 cfg:=cfg||p_rules;
 IF (cfg->>'indirect_quorum_numerator')::integer>=(cfg->>'indirect_quorum_denominator')::integer THEN RAISE EXCEPTION 'O quórum deve ser uma fração entre zero e um.'; END IF;
 UPDATE public.system_settings AS setting SET value=cfg,updated_at=clock_timestamp() WHERE setting.key='executive_transition_rules';
 PERFORM public.justice_write_audit('executive.rules','system_settings',NULL,NULL,cfg,'Prazos de sucessão alterados.');
 RETURN cfg;
END; $function$
;
notify pgrst, 'reload schema';
commit;
