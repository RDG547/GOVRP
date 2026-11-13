BEGIN;

CREATE OR REPLACE FUNCTION private.freeze_electoral_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_expected jsonb; v_allow_party_refresh boolean:=false;
BEGIN
 IF TG_OP='INSERT' THEN
  NEW.identity_snapshot:=private.electoral_identity(NEW.user_id,NEW.party_id);
  NEW.political_name:=NEW.identity_snapshot->>'name';
  NEW.identity_snapshot:=jsonb_set(NEW.identity_snapshot,'{avatar_url}',to_jsonb(coalesce(NEW.campaign_photo_url,NEW.identity_snapshot->>'avatar_url','')));
  NEW.campaign_photo_url:=NEW.identity_snapshot->>'avatar_url';
  NEW.party_snapshot:=NEW.identity_snapshot->'party';
  IF NEW.vice_candidate_id IS NOT NULL THEN
   NEW.vice_identity_snapshot:=private.electoral_identity(NEW.vice_candidate_id,null,true);
  END IF;
 ELSE
  IF NEW.identity_snapshot IS DISTINCT FROM OLD.identity_snapshot THEN
   IF OLD.party_id IS NOT NULL AND NEW.party_id IS NOT DISTINCT FROM OLD.party_id
      AND NEW.political_name IS NOT DISTINCT FROM OLD.political_name
      AND NEW.vice_identity_snapshot IS NOT DISTINCT FROM OLD.vice_identity_snapshot
      AND EXISTS(SELECT 1 FROM public.elections
         WHERE id=OLD.election_id AND voting_start_date>clock_timestamp())
   THEN
    v_expected:=jsonb_set(OLD.identity_snapshot,'{party}',
      private.electoral_identity(OLD.user_id,OLD.party_id)->'party',true);
    v_allow_party_refresh:=NEW.identity_snapshot=v_expected;
   END IF;
  END IF;
  IF NEW.political_name IS DISTINCT FROM OLD.political_name
    OR NEW.vice_identity_snapshot IS DISTINCT FROM OLD.vice_identity_snapshot
    OR (NEW.identity_snapshot IS DISTINCT FROM OLD.identity_snapshot AND NOT v_allow_party_refresh)
  THEN RAISE EXCEPTION 'A identidade eleitoral vem do cidadão e não pode ser personalizada.'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION private.propagate_party_public_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_public jsonb;
BEGIN
 v_public:=jsonb_build_object(
    'id',NEW.id,'name',NEW.name,'acronym',NEW.acronym,
    'logo_url',NEW.logo_url,'color',NEW.color,
    'electoral_number',NEW.electoral_number);
 UPDATE public.candidates c SET
   electoral_number=CASE WHEN NEW.electoral_number IS DISTINCT FROM OLD.electoral_number
      THEN NEW.electoral_number||substring(c.electoral_number FROM 3)
      ELSE c.electoral_number END,
   party_snapshot=v_public,
   identity_snapshot=jsonb_set(c.identity_snapshot,'{party}',v_public,true)
 FROM public.elections e
 WHERE e.id=c.election_id AND c.party_id=NEW.id
   AND e.voting_start_date>clock_timestamp()
   AND c.identity_snapshot IS NOT NULL
   AND (NEW.name IS DISTINCT FROM OLD.name OR NEW.acronym IS DISTINCT FROM OLD.acronym
     OR NEW.logo_url IS DISTINCT FROM OLD.logo_url OR NEW.color IS DISTINCT FROM OLD.color
     OR NEW.electoral_number IS DISTINCT FROM OLD.electoral_number);
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS party_public_identity_to_upcoming_ballots ON public.political_parties;
CREATE TRIGGER party_public_identity_to_upcoming_ballots
AFTER UPDATE OF electoral_number,name,acronym,logo_url,color ON public.political_parties
FOR EACH ROW EXECUTE FUNCTION private.propagate_party_public_identity();

COMMIT;