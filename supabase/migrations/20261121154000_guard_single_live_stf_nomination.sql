-- GOVRP: one live STF nomination per citizen across all STF seats.
-- Correct superseded hearing records without erasing sabatina, historical votes
-- or a legitimately sworn-in justice. All checks are enforced in PostgreSQL.
BEGIN;

-- Candidates already appointed to the STF must not keep previous accepted
-- hearings or pending invitations for different STF seats.
DO $repair$
DECLARE
  obsolete record;
BEGIN
  FOR obsolete IN
    SELECT i.id, i.candidate_id, i.office_key AS obsolete_office,
           term.id AS active_term_id, term.office_key AS active_office
      FROM public.minister_invitations AS i
      JOIN public.institutional_terms AS term
        ON term.profile_id=i.candidate_id
       AND term.office_key LIKE 'supreme_court_%'
       AND term.status='active'
       AND term.ended_at IS NULL
       AND (term.ends_at IS NULL OR term.ends_at>clock_timestamp())
       AND term.invitation_id IS DISTINCT FROM i.id
     WHERE i.office_key LIKE 'supreme_court_%'
       AND (i.status='pending'
         OR (i.status='accepted' AND i.institutional_stage IN ('hearing','voting')))
       AND i.senate_voting_id IS NULL
     ORDER BY i.created_at
  LOOP
    UPDATE public.minister_invitations
       SET status='cancelled',
           institutional_stage='cancelled',
           responded_at=coalesce(responded_at,clock_timestamp())
     WHERE id=obsolete.id
       AND (status='pending'
          OR (status='accepted' AND institutional_stage IN ('hearing','voting')));
    PERFORM private.institutional_notice(
      obsolete.candidate_id,
      'institutional_nomination_superseded',
      'Uma indicação anterior ao STF foi encerrada porque você já tomou posse na vaga '||
        split_part(obsolete.active_office,'_',3)||'. O mandato em exercício permanece válido.',
      obsolete.id,
      jsonb_build_object('active_term_id',obsolete.active_term_id,
                         'active_office',obsolete.active_office,
                         'superseded_office',obsolete.obsolete_office)
    );
  END LOOP;
END $repair$;

-- PostgreSQL prevents a second live invitation even when different
-- presidents, admin routines or different Supreme Court seats are involved.
CREATE UNIQUE INDEX IF NOT EXISTS one_live_stf_nomination_per_candidate
  ON public.minister_invitations(candidate_id)
  WHERE office_key LIKE 'supreme_court_%'
    AND (status='pending'
      OR (status='accepted' AND institutional_stage IN ('hearing','voting')));

CREATE OR REPLACE FUNCTION private.guard_live_stf_nomination()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $guard$
BEGIN
  IF new.office_key NOT LIKE 'supreme_court_%'
    OR NOT (new.status='pending'
      OR (new.status='accepted' AND new.institutional_stage IN ('hearing','voting'))) THEN
    RETURN new;
  END IF;

  -- Serialize race conditions involving the same candidate, including
  -- invitations to different judicial seats in distinct transactions.
  PERFORM pg_advisory_xact_lock(hashtextextended('govrp:stf-candidate:'||new.candidate_id::text,0));

  IF EXISTS (
    SELECT 1 FROM public.institutional_terms t
     WHERE t.profile_id=new.candidate_id
       AND t.office_key LIKE 'supreme_court_%'
       AND t.status='active' AND t.ended_at IS NULL
       AND (t.ends_at IS NULL OR t.ends_at>clock_timestamp())
  ) THEN
    RAISE EXCEPTION 'Este cidadão já possui mandato ativo no STF. Não é possível criar outra indicação.'
      USING ERRCODE='23505', CONSTRAINT='one_live_stf_nomination_per_candidate';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.minister_invitations i
     WHERE i.candidate_id=new.candidate_id AND i.id<>new.id
       AND i.office_key LIKE 'supreme_court_%'
       AND (i.status='pending'
        OR (i.status='accepted' AND i.institutional_stage IN ('hearing','voting')))
  ) THEN
    RAISE EXCEPTION 'Este cidadão já possui indicação ao STF em andamento, inclusive para outra vaga.'
      USING ERRCODE='23505', CONSTRAINT='one_live_stf_nomination_per_candidate';
  END IF;

  RETURN new;
END $guard$;

DROP TRIGGER IF EXISTS guard_live_stf_nomination ON public.minister_invitations;
CREATE TRIGGER guard_live_stf_nomination
BEFORE INSERT OR UPDATE OF candidate_id,office_key,status,institutional_stage
ON public.minister_invitations
FOR EACH ROW EXECUTE FUNCTION private.guard_live_stf_nomination();

-- This also protects administrative appointments that bypass the Senate
-- workflow. Once an active institutional term is created, incompatible
-- previous hearings are ended without changing the lawful new term.
CREATE OR REPLACE FUNCTION private.close_superseded_stf_nominations()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $close$
DECLARE previous record;
BEGIN
  IF new.office_key NOT LIKE 'supreme_court_%' OR new.status<>'active'
     OR new.ended_at IS NOT NULL THEN
    RETURN new;
  END IF;
  IF tg_op='UPDATE' THEN
    IF old.status='active'
      AND old.office_key IS NOT DISTINCT FROM new.office_key
      AND old.profile_id IS NOT DISTINCT FROM new.profile_id THEN
      RETURN new;
    END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('govrp:stf-candidate:'||new.profile_id::text,0));

  -- An active Senate ballot cannot be silently cancelled when a different
  -- judicial office is appointed administratively.
  IF EXISTS (
    SELECT 1 FROM public.minister_invitations i
    WHERE i.candidate_id=new.profile_id
      AND i.office_key LIKE 'supreme_court_%'
      AND i.id IS DISTINCT FROM new.invitation_id
      AND i.status='accepted'
      AND i.institutional_stage='voting'
      AND i.senate_voting_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Este cidadão possui outra indicação ao STF em votação no Senado. Conclua a votação antes de uma nova posse.';
  END IF;
  FOR previous IN
    UPDATE public.minister_invitations AS i
       SET status='cancelled',institutional_stage='cancelled',
           responded_at=coalesce(i.responded_at,clock_timestamp())
     WHERE i.candidate_id=new.profile_id
       AND i.office_key LIKE 'supreme_court_%'
       AND i.id IS DISTINCT FROM new.invitation_id
       AND (i.status='pending'
         OR (i.status='accepted' AND i.institutional_stage IN ('hearing','voting')))
       -- Never erase or annul a legally opened Senate vote.
       AND i.senate_voting_id IS NULL
     RETURNING i.id,i.office_key
  LOOP
    PERFORM private.institutional_notice(
      new.profile_id,'institutional_nomination_superseded',
      'Sua indicação anterior ao STF foi encerrada após a posse em outra vaga. O mandato atual permanece válido.',
      previous.id,
      jsonb_build_object('active_term_id',new.id,'active_office',new.office_key,
                         'superseded_office',previous.office_key)
    );
  END LOOP;
  RETURN new;
END $close$;

DROP TRIGGER IF EXISTS close_superseded_stf_nominations ON public.institutional_terms;
CREATE TRIGGER close_superseded_stf_nominations
AFTER INSERT OR UPDATE OF status,office_key,profile_id
ON public.institutional_terms
FOR EACH ROW EXECUTE FUNCTION private.close_superseded_stf_nominations();

-- Historical appointed/expired invitations remain immutable; only the
-- stale non-voted hearing is closed. New elections and other offices untouched.
COMMIT;
