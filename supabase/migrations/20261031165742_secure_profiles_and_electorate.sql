BEGIN;
-- GOVRP SECURITY: never expose the private citizen record to an anonymous
-- PostgREST caller. The public directory is a deliberate column whitelist.
DROP POLICY IF EXISTS citizen_profiles_public_completed_read ON public.profiles;
REVOKE ALL ON TABLE public.profiles FROM anon;
REVOKE SELECT ON TABLE public.public_citizen_profiles FROM anon;

-- A security-invoker view cannot read from a table for which its invoker has
-- no SELECT grant. This specific narrow view therefore uses controlled view-
-- owner access while the underlying table remains owner/admin-only via RLS.
CREATE OR REPLACE VIEW public.public_profiles
WITH (security_barrier = true, security_invoker = false) AS
SELECT id, username, full_name, avatar_url, party_affiliation, created_at
FROM public.profiles
WHERE onboarding_completed IS TRUE AND deleted_at IS NULL;
REVOKE ALL ON TABLE public.public_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.public_profiles TO anon, authenticated;

-- Eligibility is authoritative at the database, not in UI controls.
-- This also covers both cast_ballot and the legacy cast_vote RPC because both
-- call can_vote_in_election before recording the vote.
CREATE OR REPLACE FUNCTION public.can_vote_in_election(p_election_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM auth.users au
      JOIN public.profiles p ON p.id = au.id
      WHERE au.id = auth.uid()
        AND au.deleted_at IS NULL
        AND au.email_confirmed_at IS NOT NULL
        AND au.created_at <= now() - interval '24 hours'
        AND p.deleted_at IS NULL
        AND p.onboarding_completed IS TRUE
        AND EXISTS (
          SELECT 1 FROM public.documents d
          WHERE d.user_id = p.id
            AND d.type = 'Título de Eleitor'
            AND d.is_valid
            AND (d.expires_at IS NULL OR d.expires_at >= now())
            AND d.issued_at >= au.email_confirmed_at
        )
    )
    AND EXISTS (
      SELECT 1 FROM public.elections e
      WHERE e.id = p_election_id
        AND (e.election_mode = 'direct'
          OR (
            auth.uid() = ANY(e.electorate_ids)
            AND EXISTS (
              SELECT 1 FROM public.parliament_members m
              WHERE m.user_id=auth.uid()
                AND m.id=public.get_active_parliament_member_id(m.user_id,m.house_id)
            )
          )
        )
    );
$$;
REVOKE ALL ON FUNCTION public.can_vote_in_election(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_vote_in_election(uuid) TO authenticated;
COMMIT;
