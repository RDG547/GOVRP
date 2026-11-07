BEGIN;
-- Diagnostic endpoint for the signed-in citizen only. Eligibility itself remains
-- enforced by can_vote_in_election and cast_ballot; no voting rules are relaxed.
CREATE OR REPLACE FUNCTION public.get_my_election_voting_status(p_election_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_account auth.users%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_election public.elections%ROWTYPE;
  v_reason text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'session_required');
  END IF;

  SELECT * INTO v_election FROM public.elections WHERE id = p_election_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'election_not_found');
  END IF;

  SELECT * INTO v_account FROM auth.users WHERE id = v_uid;
  IF NOT FOUND OR v_account.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'account_inactive');
  END IF;
  IF v_account.email_confirmed_at IS NULL THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'email_unconfirmed');
  END IF;
  IF v_account.created_at > now() - INTERVAL '24 hours' THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'account_wait_24h',
                              'eligibleAt', v_account.created_at + INTERVAL '24 hours');
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND OR v_profile.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'citizen_not_found');
  END IF;
  IF v_profile.onboarding_completed IS DISTINCT FROM TRUE THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'citizenship_incomplete');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.user_id = v_uid AND d.type = 'Título de Eleitor'
      AND d.is_valid AND (d.expires_at IS NULL OR d.expires_at >= now())
      AND d.issued_at >= v_account.email_confirmed_at
  ) THEN
    IF EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.user_id = v_uid AND d.type = 'Título de Eleitor'
        AND d.is_valid AND (d.expires_at IS NULL OR d.expires_at >= now())
        AND d.issued_at < v_account.email_confirmed_at
    ) THEN
      v_reason := 'title_before_email';
    ELSIF EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.user_id = v_uid AND d.type = 'Título de Eleitor'
    ) THEN
      v_reason := 'title_invalid';
    ELSE
      v_reason := 'title_missing';
    END IF;
    RETURN jsonb_build_object('eligible', false, 'reason', v_reason);
  END IF;

  IF v_election.election_mode = 'indirect' THEN
    IF v_uid <> ALL(coalesce(v_election.electorate_ids, ARRAY[]::uuid[]))
       OR NOT EXISTS (
         SELECT 1 FROM public.parliament_members m
         WHERE m.user_id = v_uid
           AND m.id = public.get_active_parliament_member_id(m.user_id, m.house_id)
       ) THEN
      RETURN jsonb_build_object('eligible', false, 'reason', 'indirect_electorate');
    END IF;
  ELSIF v_election.election_mode IS DISTINCT FROM 'direct' THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'electorate_unavailable');
  END IF;

  -- Final authoritative check ensures this status cannot grant a vote.
  IF public.can_vote_in_election(p_election_id) THEN
    RETURN jsonb_build_object('eligible', true, 'reason', 'eligible');
  END IF;
  RETURN jsonb_build_object('eligible', false, 'reason', 'electorate_unavailable');
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_election_voting_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_election_voting_status(uuid) TO authenticated;
COMMIT;
