ALTER TABLE public.whatsapp_bot_groups ADD COLUMN is_official boolean NOT NULL DEFAULT false,ADD COLUMN authorized_at timestamptz,ADD COLUMN authorized_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,ADD COLUMN bot_joined boolean NOT NULL DEFAULT false,ADD COLUMN membership_checked_at timestamptz;
CREATE INDEX whatsapp_group_authorizer ON public.whatsapp_bot_groups(authorized_by);
-- The official group was identified from the existing active production configuration.
UPDATE public.whatsapp_bot_groups SET is_official=true,authorized_at=coalesce(authorized_at,now()) WHERE jid='120363289786230845@g.us';
UPDATE public.whatsapp_bot_groups SET authorized_at=coalesce(authorized_at,now()) WHERE enabled;
-- Existing discover_group records prove past membership; the worker reconciles current membership.
UPDATE public.whatsapp_bot_groups SET bot_joined=true,membership_checked_at=discovered_at WHERE authorized_at IS NOT NULL;
DROP POLICY IF EXISTS whatsapp_bot_admin_groups ON public.whatsapp_bot_groups;
CREATE POLICY whatsapp_bot_admin_groups ON public.whatsapp_bot_groups FOR SELECT TO authenticated USING((select public.is_admin()) AND (is_official OR authorized_at IS NOT NULL));
CREATE TABLE public.whatsapp_bot_group_invitations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),invite_code text NOT NULL UNIQUE CHECK(invite_code~'^[A-Za-z0-9]{20,32}$'),
 requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,requested_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','processing','connected','awaiting_approval','error')),
 group_jid text REFERENCES public.whatsapp_bot_groups(jid) ON DELETE SET NULL,group_name text,error_message text,attempts integer NOT NULL DEFAULT 0,lease_id uuid,updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_invite_requester ON public.whatsapp_bot_group_invitations(requested_by);
CREATE INDEX whatsapp_invite_group ON public.whatsapp_bot_group_invitations(group_jid);
ALTER TABLE public.whatsapp_bot_group_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_bot_group_invitations FROM anon,authenticated;
GRANT SELECT ON public.whatsapp_bot_group_invitations TO authenticated;
GRANT ALL ON public.whatsapp_bot_group_invitations TO service_role;
CREATE POLICY whatsapp_invites_admin ON public.whatsapp_bot_group_invitations FOR SELECT TO authenticated USING((select public.is_admin()));
CREATE FUNCTION public.admin_add_whatsapp_group_invite(p_link text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE code text;i public.whatsapp_bot_group_invitations%rowtype;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Acesso administrativo necessário.' USING errcode='42501';END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
 code:=substring(btrim(p_link) from '^https://chat[.]whatsapp[.]com/([A-Za-z0-9]{20,32})/?(?:[?]mode=[A-Za-z0-9_]+)?$');
 IF code IS NULL THEN RAISE EXCEPTION 'Informe um link de convite válido de chat.whatsapp.com.';END IF;
 INSERT INTO public.whatsapp_bot_group_invitations(invite_code,requested_by) VALUES(code,auth.uid())
 ON CONFLICT(invite_code) DO UPDATE SET status=CASE WHEN whatsapp_bot_group_invitations.status='connected' AND EXISTS(SELECT 1 FROM public.whatsapp_bot_groups WHERE jid=whatsapp_bot_group_invitations.group_jid AND bot_joined) THEN 'connected' ELSE 'pending' END,attempts=0,error_message=NULL,updated_at=now() RETURNING * INTO i;
 PERFORM economy_private.audit('whatsapp_group_invite_requested','whatsapp_bot_group_invitations',i.id::text,NULL,jsonb_build_object('status',i.status),'Vínculo de grupo solicitado por convite. O código do convite permanece restrito à administração.',auth.uid());
 RETURN jsonb_build_object('id',i.id,'status',i.status);
END $$;
CREATE FUNCTION public.bot_claim_whatsapp_group_invites() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF auth.jwt()->>'role' IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Serviço não autorizado.' USING errcode='42501';END IF;
 WITH eligible AS(SELECT id FROM public.whatsapp_bot_group_invitations WHERE attempts<3 AND (status='pending' OR(status='processing' AND updated_at<now()-interval '2 minutes')) ORDER BY requested_at LIMIT 3 FOR UPDATE SKIP LOCKED),claimed AS(UPDATE public.whatsapp_bot_group_invitations i SET status='processing',lease_id=gen_random_uuid(),attempts=attempts+1,updated_at=now() FROM eligible WHERE i.id=eligible.id RETURNING i.id,i.invite_code,i.lease_id)
 SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') INTO result FROM claimed c;RETURN result;
END $$;
CREATE FUNCTION public.bot_finish_whatsapp_group_invite(p_id uuid,p_lease uuid,p_jid text,p_name text,p_joined boolean,p_status text,p_error text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.whatsapp_bot_group_invitations%rowtype;
BEGIN
 IF auth.jwt()->>'role' IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Serviço não autorizado.' USING errcode='42501';END IF;
 SELECT * INTO i FROM public.whatsapp_bot_group_invitations WHERE id=p_id AND status='processing' AND lease_id=p_lease FOR UPDATE;
 IF i.id IS NULL THEN RETURN;END IF;
 IF p_status NOT IN('connected','awaiting_approval','error') OR p_status IS NULL OR(p_status='connected' AND p_joined IS DISTINCT FROM true) THEN RAISE EXCEPTION 'Confirme a participação real do bot antes de conectar o grupo.';END IF;
 IF p_jid IS NOT NULL THEN
  IF p_jid !~ '^[0-9A-Za-z_.:-]+@g[.]us$' THEN RAISE EXCEPTION 'Grupo inválido.';END IF;
  INSERT INTO public.whatsapp_bot_groups(jid,display_name,authorized_at,authorized_by,bot_joined,membership_checked_at) VALUES(p_jid,left(p_name,100),i.requested_at,i.requested_by,p_joined,now())
  ON CONFLICT(jid) DO UPDATE SET display_name=excluded.display_name,authorized_at=coalesce(whatsapp_bot_groups.authorized_at,excluded.authorized_at),authorized_by=coalesce(whatsapp_bot_groups.authorized_by,excluded.authorized_by),bot_joined=excluded.bot_joined,membership_checked_at=now();
 END IF;
 UPDATE public.whatsapp_bot_group_invitations SET status=p_status,group_jid=p_jid,group_name=left(p_name,100),error_message=left(p_error,400),updated_at=now() WHERE id=i.id;
 PERFORM economy_private.audit('whatsapp_group_invite_processed','whatsapp_bot_group_invitations',i.id::text,NULL,jsonb_build_object('status',p_status,'group_jid',p_jid,'bot_joined',p_joined),'Vínculo conferido pelo serviço do bot.',NULL);
END $$;
CREATE OR REPLACE FUNCTION public.bot_whatsapp_discover_group(p_jid text,p_name text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.jwt()->>'role' IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Serviço não autorizado.' USING errcode='42501';END IF;
 -- Do not insert or expose personal groups discovered on the connected number.
 UPDATE public.whatsapp_bot_groups SET display_name=CASE WHEN length(btrim(coalesce(p_name,'')))>0 THEN left(p_name,100) ELSE display_name END,bot_joined=true,membership_checked_at=now() WHERE jid=p_jid AND(is_official OR authorized_at IS NOT NULL);
END $$;
CREATE FUNCTION public.bot_sync_whatsapp_group_membership(p_jids jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.jwt()->>'role' IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Serviço não autorizado.' USING errcode='42501';END IF;
 IF jsonb_typeof(p_jids) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Lista de grupos inválida.';END IF;
 UPDATE public.whatsapp_bot_groups g SET bot_joined=p_jids ? g.jid,enabled=CASE WHEN p_jids ? g.jid THEN enabled ELSE false END,membership_checked_at=now() WHERE is_official OR authorized_at IS NOT NULL;
 UPDATE public.whatsapp_bot_group_invitations SET status='connected',error_message=NULL,updated_at=now() WHERE status='awaiting_approval' AND p_jids ? group_jid;
END $$;
CREATE OR REPLACE FUNCTION public.admin_save_whatsapp_bot_group(p_jid text,p_enabled boolean,p_news boolean,p_elections boolean,p_votings boolean,p_government boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g public.whatsapp_bot_groups%rowtype;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Acesso administrativo necessário.' USING errcode='42501';END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
 SELECT * INTO g FROM public.whatsapp_bot_groups WHERE jid=p_jid AND(is_official OR authorized_at IS NOT NULL) FOR UPDATE;
 IF g.jid IS NULL THEN RAISE EXCEPTION 'Cadastre o grupo pelo link de convite antes de autorizá-lo.';END IF;
 IF p_enabled AND (NOT g.bot_joined OR g.membership_checked_at<now()-interval '2 minutes' OR NOT EXISTS(SELECT 1 FROM public.whatsapp_bot_runtime WHERE id AND connected AND paired AND last_seen_at>now()-interval '75 seconds')) THEN RAISE EXCEPTION 'O bot precisa estar online e sua participação no grupo deve estar confirmada.';END IF;
 UPDATE public.whatsapp_bot_groups SET enabled=coalesce(p_enabled,false),notify_news=coalesce(p_news,false),notify_elections=coalesce(p_elections,false),notify_votings=coalesce(p_votings,false),notify_government=coalesce(p_government,false),updated_at=now() WHERE jid=g.jid;
 PERFORM economy_private.audit('whatsapp_group_authorization_changed','whatsapp_bot_groups',g.jid,to_jsonb(g),jsonb_build_object('enabled',p_enabled),'Preferências de grupo autorizado atualizadas.',auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.admin_add_whatsapp_group_invite(text),public.bot_claim_whatsapp_group_invites(),public.bot_finish_whatsapp_group_invite(uuid,uuid,text,text,boolean,text,text),public.bot_sync_whatsapp_group_membership(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_add_whatsapp_group_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bot_claim_whatsapp_group_invites(),public.bot_finish_whatsapp_group_invite(uuid,uuid,text,text,boolean,text,text),public.bot_sync_whatsapp_group_membership(jsonb) TO service_role;
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_bot_group_invitations;
NOTIFY pgrst,'reload schema';

CREATE OR REPLACE FUNCTION public.bot_whatsapp_claim_deliveries(p_limit integer DEFAULT 5)
 RETURNS TABLE(event_id bigint, group_jid text, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Serviço não autorizado.' USING errcode='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.whatsapp_bot_settings WHERE id AND enabled) THEN RETURN; END IF;
 RETURN QUERY
 WITH candidates AS (
  SELECT e.id,g.jid
  FROM public.whatsapp_bot_events e
  JOIN public.whatsapp_bot_groups g ON g.enabled AND g.bot_joined AND (g.is_official OR g.authorized_at IS NOT NULL) AND (e.target_group_jid IS NULL OR e.target_group_jid=g.jid)
  LEFT JOIN public.whatsapp_bot_deliveries d ON d.event_id=e.id AND d.group_jid=g.jid
  WHERE e.expires_at>now() AND e.created_at>now()-interval '48 hours'
   AND e.created_at >= greatest(g.updated_at,(SELECT updated_at FROM public.whatsapp_bot_settings WHERE id=true))
   AND CASE e.event_kind
    WHEN 'news' THEN g.notify_news
    WHEN 'elections' THEN g.notify_elections
    WHEN 'votings' THEN g.notify_votings
    WHEN 'government' THEN g.notify_government
    ELSE true END
   AND (d.event_id IS NULL OR (d.attempts<3 AND d.status IN ('sending','error') AND d.updated_at<now()-interval '2 minutes'))
  ORDER BY e.id ASC,g.jid ASC LIMIT least(greatest(coalesce(p_limit,5),1),10)
 ), claimed AS (
  INSERT INTO public.whatsapp_bot_deliveries(event_id,group_jid,status,attempts,updated_at)
  SELECT c.id,c.jid,'sending',1,now() FROM candidates c
  ON CONFLICT ON CONSTRAINT whatsapp_bot_deliveries_pkey DO UPDATE SET status='sending',attempts=whatsapp_bot_deliveries.attempts+1,updated_at=now(),last_error=null
   WHERE whatsapp_bot_deliveries.status IN ('sending','error')
     AND whatsapp_bot_deliveries.attempts<3
     AND whatsapp_bot_deliveries.updated_at<now()-interval '2 minutes'
  RETURNING whatsapp_bot_deliveries.event_id,whatsapp_bot_deliveries.group_jid
 )
 SELECT c.event_id,c.group_jid,
  left('📢 *'||e.title||'*'||E'\n\n'||e.message||CASE WHEN e.url IS NOT NULL THEN E'\n\n🔗 '||e.url ELSE '' END,3500)
 FROM claimed c JOIN public.whatsapp_bot_events e ON e.id=c.event_id ORDER BY c.event_id;
END $function$

;

CREATE OR REPLACE FUNCTION private.rp_reset_policy()
 RETURNS TABLE(table_name text, reset_mode text, owner_columns text[])
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  values
    ('platform_access_exceptions','keep','{}'::text[]),
    ('admin_dashboard_preferences','keep','{}'::text[]),
    ('whatsapp_bot_group_invitations','keep','{}'::text[]),
    ('public_competitions','clear','{created_by}'::text[]),
 ('public_competition_applications','clear','{profile_id,decided_by}'::text[]),
 ('public_careers','clear','{profile_id}'::text[]),
 ('national_market_references','keep','{}'::text[]),
 ('national_market_stock','clear','{}'::text[]),
 ('national_market_purchases','clear','{actor_id}'::text[]),
 ('national_market_consumption','clear','{}'::text[]),('world_map_places','keep','{}'::text[]),
    ('infrastructure_project_types','keep','{}'::text[]),
    ('citizen_happiness_events','clear','{user_id}'::text[]),
    ('agies_clearances','clear','{user_id}'::text[]),
    ('agies_dossiers','clear','{responsible_id}'::text[]),
    ('agies_reports','clear','{author_id}'::text[]),
    ('agies_report_recipients','clear','{user_id}'::text[]),
    ('agies_tasks','clear','{agent_id}'::text[]),
    ('minister_invitations','clear','{candidate_id,invited_by}'::text[]),
    ('election_result_receipts','clear','{user_id}'::text[]),
    ('business_recipes','keep','{}'::text[]),
    ('business_inventory','clear','{}'::text[]),
    ('business_role_templates','keep','{}'::text[]),
    ('business_national_cycles','clear','{}'::text[]),
    ('government_terms','clear','{original_president_id,head_id}'::text[]),
    ('professional_work_sessions','clear','{user_id}'::text[]),
    ('stock_price_history','clear','{}'::text[]),
    ('residence_leases','clear','{landlord_id,tenant_id}'::text[]),
    ('economic_resources','keep','{}'::text[]),
    ('economic_regions','keep','{}'::text[]),
    ('business_daily_operations','clear','{}'::text[]),
    ('business_applications','clear','{profile_id}'::text[]),
    ('parliament_voting_rules','keep','{}'::text[]),
    ('stock_dividend_receipts','clear','{user_id}'::text[]),
    ('business_vacancies','clear','{}'::text[]),
    ('healthcare_visits','clear','{user_id}'::text[]),
    ('business_supply_contracts','clear','{}'::text[]),
    ('company_dividends','clear','{}'::text[]),
    ('citizen_professional_experience','clear','{profile_id}'::text[]),
    ('stock_index_history','clear','{}'::text[]),
    ('business_supply_orders','clear','{}'::text[]),
    ('party_treasuries','clear','{}'::text[]),
    ('party_treasury_entries','clear','{actor_id}'::text[]),
    ('citizen_needs','clear','{user_id}'::text[]),
    ('citizen_residences','clear','{owner_id}'::text[]),
    ('presidential_formation','clear','{user_id}'::text[]),
    ('executive_office_definitions','keep','{}'::text[]),
    ('accounts', 'clear', '{user_id}'::text[]),
    ('achievements', 'keep', '{}'::text[]),
    ('agies_missions', 'clear', '{agent_id}'::text[]),
    ('app_config', 'keep', '{}'::text[]),
    ('appeals', 'clear', '{filed_by}'::text[]),
    ('armed_forces_enlistment', 'clear', '{user_id}'::text[]),
    ('armed_forces_operations', 'clear', '{commander_id}'::text[]),
    ('armed_forces_reports', 'clear', '{reporter_id}'::text[]),
    ('arrests', 'clear', '{suspect_id}'::text[]),
    ('bill_status_history', 'clear', '{}'::text[]),
    ('bill_suggestions', 'clear', '{author_id}'::text[]),
    ('bill_votes', 'clear', '{}'::text[]),
    ('bills', 'clear', '{author_id}'::text[]),
    ('bills_of_exchange', 'clear', '{issuer_id,payer_id}'::text[]),
    ('business_balance_cycles', 'clear', '{owner_id}'::text[]),
    ('business_economic_snapshots', 'clear', '{}'::text[]),
    ('business_employees', 'clear', '{profile_id}'::text[]),
    ('business_transactions', 'clear', '{}'::text[]),
    ('business_types', 'keep', '{}'::text[]),
    ('businesses', 'clear', '{owner_id}'::text[]),
    ('candidates', 'clear', '{user_id,vice_candidate_id}'::text[]),
    ('card_invoice_items', 'clear', '{}'::text[]),
    ('card_invoices', 'clear', '{user_id}'::text[]),
    ('cards', 'clear', '{user_id}'::text[]),
    ('case_charges', 'clear', '{defendant_id}'::text[]),
    ('case_documents', 'clear', '{author_id}'::text[]),
    ('case_evidence', 'clear', '{}'::text[]),
    ('case_parties', 'clear', '{profile_id}'::text[]),
    ('case_timeline_events', 'clear', '{}'::text[]),
    ('citizen_economic_snapshots', 'clear', '{profile_id}'::text[]),
    ('citizen_economic_statuses', 'clear', '{profile_id}'::text[]),
    ('citizen_justice_requests', 'clear', '{requester_id}'::text[]),
    ('citizen_lifecycle_events', 'clear', '{user_id}'::text[]),
    ('citizen_objective_definitions', 'keep', '{}'::text[]),
    ('citizen_objective_progress', 'clear', '{user_id}'::text[]),
    ('comments', 'clear', '{user_id}'::text[]),
    ('commerce_orders', 'clear', '{buyer_id}'::text[]),
    ('constitution_amendments', 'clear', '{}'::text[]),
    ('constitution_articles', 'keep', '{}'::text[]),
    ('constitution_sections', 'keep', '{}'::text[]),
    ('country_constitutions', 'keep', '{}'::text[]),
    ('country_population_segments', 'reset', '{}'::text[]),
    ('country_rp_economic_snapshots', 'clear', '{}'::text[]),
    ('country_rp_events', 'clear', '{}'::text[]),
    ('country_rp_exchange_history', 'clear', '{}'::text[]),
    ('country_rp_exchange_rates', 'clear', '{}'::text[]),
    ('country_rp_states', 'reset', '{}'::text[]),
    ('credit_card_applications', 'clear', '{user_id}'::text[]),
    ('criminal_cases', 'clear', '{}'::text[]),
    ('criminal_investigations', 'clear', '{}'::text[]),
    ('criminal_records', 'clear', '{user_id}'::text[]),
    ('currency_market_cycles', 'clear', '{}'::text[]),
    ('currency_market_states', 'reset', '{}'::text[]),
    ('daily_check_ins', 'clear', '{user_id}'::text[]),
    ('decrees', 'clear', '{author_id}'::text[]),
    ('document_history', 'clear', '{user_id}'::text[]),
    ('document_requests', 'clear', '{user_id}'::text[]),
    ('documents', 'clear', '{user_id}'::text[]),
    ('domain_events', 'clear', '{}'::text[]),
    ('donation_webhook_events', 'keep', '{}'::text[]),
    ('donations', 'keep', '{}'::text[]),
    ('dou_entries', 'clear', '{}'::text[]),
    ('economic_alerts', 'clear', '{}'::text[]),
    ('economic_audit_log', 'clear', '{}'::text[]),
    ('economic_bulletins', 'clear', '{}'::text[]),
    ('economic_calibrations', 'keep', '{}'::text[]),
    ('economic_engine_runs', 'clear', '{}'::text[]),
    ('economic_events', 'clear', '{actor_profile_id}'::text[]),
    ('economic_forecasts', 'clear', '{}'::text[]),
    ('economic_indicators', 'clear', '{}'::text[]),
    ('economic_periods', 'clear', '{}'::text[]),
    ('economic_policy_decisions', 'clear', '{}'::text[]),
    ('economic_policy_effects', 'clear', '{}'::text[]),
    ('economic_sector_snapshots', 'clear', '{}'::text[]),
    ('economic_sectors', 'keep', '{}'::text[]),
    ('economic_shocks', 'clear', '{}'::text[]),
    ('economic_state', 'reset', '{}'::text[]),
    ('election_audit_log', 'clear', '{}'::text[]),
    ('election_office_assignments', 'clear', '{profile_id}'::text[]),
    ('election_settlements', 'clear', '{}'::text[]),
    ('election_types', 'keep', '{}'::text[]),
    ('elections', 'clear', '{}'::text[]),
    ('evidence_custody_events', 'clear', '{}'::text[]),
    ('fine_appeals', 'clear', '{appellant_id}'::text[]),
    ('fine_hearing_requests', 'clear', '{requester_id}'::text[]),
    ('fiscal_periods', 'clear', '{}'::text[]),
    ('followers', 'clear', '{follower_id,following_id}'::text[]),
    ('government_expenditures', 'clear', '{}'::text[]),
    ('government_finances', 'reset', '{}'::text[]),
    ('government_media_contracts', 'clear', '{}'::text[]),
    ('government_ministries', 'reset', '{}'::text[]),
    ('government_popularity_events', 'clear', '{}'::text[]),
    ('government_popularity_state', 'reset', '{}'::text[]),
    ('government_projects', 'clear', '{}'::text[]),
    ('government_revenues', 'clear', '{}'::text[]),
    ('government_rules', 'clear', '{}'::text[]),
    ('hearing_participants', 'clear', '{profile_id}'::text[]),
    ('hearings', 'clear', '{}'::text[]),
    ('investigation_events', 'clear', '{}'::text[]),
    ('investigation_parties', 'clear', '{profile_id}'::text[]),
    ('investigation_subjects', 'clear', '{profile_id}'::text[]),
    ('investment_operations', 'clear', '{user_id}'::text[]),
    ('investment_options', 'clear', '{}'::text[]),
    ('investment_portfolio_snapshots', 'clear', '{user_id}'::text[]),
    ('judicial_decisions', 'clear', '{}'::text[]),
    ('judicial_requests', 'clear', '{requested_by,target_profile_id}'::text[]),
    ('justice_audit_log', 'clear', '{}'::text[]),
    ('justice_deadlines', 'clear', '{}'::text[]),
    ('justice_number_counters', 'clear', '{}'::text[]),
    ('labor_market_snapshots', 'clear', '{}'::text[]),
    ('legal_authority_rules', 'keep', '{}'::text[]),
    ('law_effects', 'clear', '{}'::text[]),
    ('likes', 'clear', '{user_id}'::text[]),
    ('loan_applications', 'clear', '{user_id}'::text[]),
    ('loans', 'clear', '{user_id}'::text[]),
    ('media_outlets', 'clear', '{editor_id}'::text[]),
    ('minister_history', 'clear', '{minister_profile_id}'::text[]),
    ('ministers', 'clear', '{user_id}'::text[]),
    ('monetary_policy_meetings', 'clear', '{}'::text[]),
    ('national_event_decision_options', 'clear', '{}'::text[]),
    ('national_event_responses', 'clear', '{}'::text[]),
    ('national_game_events', 'clear', '{}'::text[]),
    ('national_indicator_points', 'clear', '{}'::text[]),
    ('national_media_briefs', 'clear', '{}'::text[]),
    ('news_articles', 'clear', '{author_id}'::text[]),
    ('news_categories', 'keep', '{}'::text[]),
    ('notifications', 'clear', '{user_id,sender_id}'::text[]),
    ('parliament_commission_houses', 'clear', '{}'::text[]),
    ('parliament_commission_members', 'clear', '{}'::text[]),
    ('parliament_commission_supports', 'clear', '{}'::text[]),
    ('parliament_commissions', 'clear', '{}'::text[]),
    ('parliament_houses', 'keep', '{}'::text[]),
    ('parliament_leadership_candidates', 'clear', '{}'::text[]),
    ('parliament_leadership_elections', 'clear', '{}'::text[]),
    ('parliament_leadership_terms', 'clear', '{}'::text[]),
    ('parliament_leadership_votes', 'clear', '{}'::text[]),
    ('parliament_members', 'clear', '{user_id}'::text[]),
    ('parliament_voting_votes', 'clear', '{}'::text[]),
    ('parliament_votings', 'clear', '{}'::text[]),
    ('party_affiliation_requests', 'clear', '{user_id}'::text[]),
    ('party_history', 'clear', '{}'::text[]),
    ('party_members', 'clear', '{user_id}'::text[]),
    ('penal_code', 'keep', '{}'::text[]),
    ('penal_time_brackets', 'keep', '{}'::text[]),
    ('plebiscite_votes', 'clear', '{voter_id}'::text[]),
    ('plebiscites', 'clear', '{author_id}'::text[]),
    ('police_fines', 'clear', '{user_id}'::text[]),
    ('police_investigations', 'clear', '{}'::text[]),
    ('police_occurrences', 'clear', '{user_id}'::text[]),
    ('police_reports', 'clear', '{}'::text[]),
    ('police_wanted_list', 'clear', '{profile_id}'::text[]),
    ('political_parties', 'clear', '{founder_id,owner_id}'::text[]),
    ('political_point_events', 'clear', '{user_id}'::text[]),
    ('population_segment_events', 'clear', '{}'::text[]),
    ('post_likes', 'clear', '{user_id}'::text[]),
    ('posts', 'clear', '{user_id}'::text[]),
    ('price_basket_items', 'reset', '{}'::text[]),
    ('price_observations', 'clear', '{}'::text[]),
    ('prison_activities', 'keep', '{}'::text[]),
    ('prison_activity_runs', 'clear', '{inmate_id}'::text[]),
    ('prison_appeals', 'clear', '{user_id}'::text[]),
    ('prison_cells', 'keep', '{}'::text[]),
    ('prison_events', 'clear', '{}'::text[]),
    ('prison_facilities', 'keep', '{}'::text[]),
    ('prison_hearings', 'clear', '{user_id}'::text[]),
    ('prison_terms', 'clear', '{inmate_id}'::text[]),
    ('prison_visits', 'clear', '{inmate_id,visitor_id}'::text[]),
    ('prison_wings', 'keep', '{}'::text[]),
    ('product_ownership_history', 'clear', '{user_id}'::text[]),
    ('product_reviews', 'clear', '{user_id}'::text[]),
    ('products', 'clear', '{seller_id}'::text[]),
    ('profiles', 'reset', '{}'::text[]),
    ('public_integrity_case_events', 'clear', '{}'::text[]),
    ('public_integrity_cases', 'clear', '{}'::text[]),
    ('public_safety_campaigns', 'clear', '{}'::text[]),
    ('reposts', 'clear', '{user_id}'::text[]),
    ('rp_time_settings', 'reset', '{}'::text[]),
    ('salary_payments', 'clear', '{user_id}'::text[]),
    ('security_audit_log', 'keep', '{}'::text[]),
    ('sentences', 'clear', '{defendant_id}'::text[]),
    ('state_enterprises', 'reset', '{}'::text[]),
    ('stories', 'clear', '{user_id}'::text[]),
    ('support_ticket_messages', 'keep', '{}'::text[]),
    ('support_tickets', 'keep', '{}'::text[]),
    ('system_settings', 'reset', '{}'::text[]),
    ('trade_settlement_audit', 'clear', '{user_id}'::text[]),
    ('trade_settlement_locks', 'clear', '{user_id}'::text[]),
    ('trades', 'clear', '{user_id}'::text[]),
    ('transactions', 'clear', '{}'::text[]),
    ('trends', 'clear', '{}'::text[]),
    ('user_achievements', 'clear', '{user_id}'::text[]),
    ('user_activity_sessions', 'clear', '{user_id}'::text[]),
    ('user_inventory', 'clear', '{user_id}'::text[]),
    ('user_investments', 'clear', '{user_id}'::text[]),
    ('user_page_views', 'clear', '{user_id}'::text[]),
    ('user_services', 'clear', '{user_id}'::text[]),
    ('user_subscriptions', 'clear', '{user_id,seller_id}'::text[]),
    ('users', 'keep', '{}'::text[]),
    ('votes', 'clear', '{voter_id}'::text[]),
    ('warrants', 'clear', '{target_profile_id}'::text[]),
    ('x_conversation_participants', 'clear', '{user_id}'::text[]),
    ('x_conversations', 'clear', '{}'::text[]),
    ('x_messages', 'clear', '{sender_id}'::text[]),
    ('comment_likes', 'clear', '{user_id}'::text[]),
    ('marketplace_reports', 'clear', '{reporter_id}'::text[]),
    ('institutional_terms','clear','{profile_id}'::text[]),
    ('judicial_electoral_assignments','clear','{profile_id}'::text[])
$function$

;
