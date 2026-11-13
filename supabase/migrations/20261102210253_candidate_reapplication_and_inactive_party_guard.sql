BEGIN;

-- A withdrawn/rejected application remains immutable in history, while the
-- same citizen may file another active application before voting begins.
-- Create the replacement first so no concurrent write loses uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS candidates_one_active_per_election_user
  ON public.candidates(election_id, user_id)
  WHERE removed_at IS NULL
    AND lower(coalesce(status, '')) NOT IN
      ('rejected', 'rejeitado', 'cancelled', 'cancelado', 'cancelada', 'withdrawn');

ALTER TABLE public.candidates
  DROP CONSTRAINT IF EXISTS candidates_election_id_user_id_key;

-- A service-role insert (including presidential tickets accepted by a vice)
-- cannot bypass membership and active-party requirements.
CREATE OR REPLACE FUNCTION private.enforce_candidate_party_eligibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_member_party_id uuid;
  v_party_name text;
  v_party_active boolean;
  v_party_status text;
  v_member_count integer;
BEGIN
  -- Preserve existing historical imports; apply only to new candidacies.
  IF lower(coalesce(NEW.status, '')) IN
      ('withdrawn', 'rejected', 'rejeitado', 'cancelled', 'cancelado', 'cancelada') THEN
    RETURN NEW;
  END IF;

  SELECT pm.party_id, p.name, p.is_active, p.status
    INTO v_member_party_id, v_party_name, v_party_active, v_party_status
  FROM public.party_members pm
  LEFT JOIN public.political_parties p ON p.id = pm.party_id
  WHERE pm.user_id = NEW.user_id
  FOR SHARE OF pm;

  IF v_member_party_id IS NULL THEN
    IF NEW.party_id IS NOT NULL THEN
      RAISE EXCEPTION 'Você precisa estar filiado ao partido informado para concorrer por ele.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW; -- independent candidate, no current party membership
  END IF;

  SELECT count(*) INTO v_member_count
    FROM public.party_members
    WHERE party_id = v_member_party_id;

  IF v_party_active IS DISTINCT FROM TRUE
     OR v_party_status = 'Encerrado'
     OR v_member_count < 5 THEN
    RAISE EXCEPTION 'Seu partido está inativo. São necessários no mínimo 5 membros e o partido deve estar ativo para concorrer às eleições. Para se candidatar como independente, você precisa sair do partido.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.party_id IS DISTINCT FROM v_member_party_id THEN
    RAISE EXCEPTION 'Você já está filiado a um partido. Para concorrer de forma independente, primeiro saia do partido.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_candidate_party_eligibility ON public.candidates;
CREATE TRIGGER enforce_candidate_party_eligibility
  BEFORE INSERT ON public.candidates
  FOR EACH ROW EXECUTE FUNCTION private.enforce_candidate_party_eligibility();

COMMIT;
