BEGIN;
-- Social reads expose public content, never the private profile record used for identity.
CREATE OR REPLACE FUNCTION public.can_read_public_story(p_author uuid,p_created timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND p_created<=statement_timestamp() AND p_created>statement_timestamp()-interval '24 hours'
 AND EXISTS(SELECT 1 FROM public.profiles WHERE id=p_author AND deleted_at IS NULL AND (onboarding_completed OR onboarding_mode='legacy_migration'))
$$;
REVOKE ALL ON FUNCTION public.can_read_public_story(uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_read_public_story(uuid,timestamptz) TO authenticated;
DROP POLICY IF EXISTS stories_public_read ON public.stories;
CREATE POLICY stories_public_read ON public.stories FOR SELECT TO authenticated USING(public.can_read_public_story(user_id,created_at));
REVOKE SELECT ON public.stories FROM anon;

DROP POLICY IF EXISTS domain_events_public_read ON public.domain_events;
CREATE POLICY domain_events_public_read ON public.domain_events FOR SELECT TO anon,authenticated USING(
 (event_type<>'role_changed' AND source_table NOT IN('transactions','commerce_orders','prison_terms','criminal_cases','criminal_investigations'))
 OR actor_id=auth.uid() OR (event_type='role_changed' AND payload->>'user_id'=auth.uid()::text) OR public.get_user_role(auth.uid())='Admin'
);
-- Preserve legacy office notices waiting for acknowledgement at upgrade time.
UPDATE public.notifications n SET type='role_changed',metadata=metadata||jsonb_build_object('new_role',metadata->>'office_role','origin','election','loss',false)
WHERE type='office_awarded' AND metadata->>'popup_shown_at' IS NULL
 AND NOT EXISTS(SELECT 1 FROM public.notifications newer WHERE newer.user_id=n.user_id AND newer.type='role_changed' AND newer.created_at>=n.created_at-interval '1 minute');

-- Initialize the same government rule for subsequently registered penal codes.
CREATE OR REPLACE FUNCTION private.register_penal_rule()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.government_rules(rule_key,numeric_value,description,unit,rule_kind,is_active,definition,source_kind)
 VALUES('penalty_'||replace(NEW.id::text,'-',''),NEW.maximum_sentence_units,NEW.name,'RP','penalty',NEW.is_active,
 jsonb_build_object('penal_code_id',NEW.id,'minimum',NEW.minimum_sentence_units,'maximum',NEW.maximum_sentence_units,'fine',NEW.base_fine),'system') ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER penal_rule_registered AFTER INSERT ON public.penal_code FOR EACH ROW EXECUTE FUNCTION private.register_penal_rule();
REVOKE UPDATE,DELETE ON public.penal_code FROM anon,authenticated;
REVOKE ALL ON FUNCTION private.register_penal_rule(),private.guard_tax_settings(),private.classify_case_timeline() FROM PUBLIC,anon,authenticated;

-- Transaction metadata already is the historical snapshot; prevent accidental
-- recalculation by deriving display values exclusively from this snapshot.
CREATE OR REPLACE FUNCTION private.protect_transaction_legal_snapshot()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF ROW(NEW.metadata->'levies',NEW.metadata->'gross_amount',NEW.metadata->'tax_amount',NEW.metadata->'total_debited',NEW.metadata->'net_amount')
 IS DISTINCT FROM ROW(OLD.metadata->'levies',OLD.metadata->'gross_amount',OLD.metadata->'tax_amount',OLD.metadata->'total_debited',OLD.metadata->'net_amount') THEN RAISE EXCEPTION 'LEGAL_SNAPSHOT_IS_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_transaction_norm BEFORE UPDATE OF metadata ON public.transactions FOR EACH ROW EXECUTE FUNCTION private.protect_transaction_legal_snapshot();
REVOKE ALL ON FUNCTION private.protect_transaction_legal_snapshot() FROM PUBLIC,anon,authenticated;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['posts','stories','followers','political_parties','party_members','parliament_members','parliament_houses','parliament_votings','parliament_voting_votes','parliament_commissions','parliament_commission_members','parliament_commission_house_links','parliament_leadership_terms','parliament_leadership_elections','parliament_leadership_candidates','parliament_leadership_votes','bills','bill_status_history','bill_suggestions','plebiscites','plebiscite_votes','government_rules','law_effects','legal_authority_rules','dou_entries','decrees','penal_code','case_charges','notifications','investigation_subjects','investigation_parties','criminal_investigations','criminal_cases','case_documents','case_parties','case_timeline_events','judicial_decisions','sentences','warrants','prison_terms','prison_events','appeals','hearings'] LOOP
   IF to_regclass('public.'||t) IS NOT NULL AND EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') AND NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t); END IF;
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
