BEGIN;

-- Um mandato eletivo termina no prazo oficial, mesmo que nenhuma chapa ou
-- parlamentar sucessor tenha sido empossado. A posse antecipada continua
-- encerrando o mandato anterior, inclusive em casos de reeleicao.

-- Reverte eventuais prorrogacoes automaticas de versoes anteriores.
UPDATE public.government_terms g
SET term_ends_at = (a.metadata->>'scheduled_term_ends_at')::timestamptz
FROM public.election_office_assignments a
WHERE a.status = 'active'
  AND a.office_role = 'Presidente'
  AND a.metadata->>'holdover' = 'true'
  AND a.metadata ? 'scheduled_term_ends_at'
  AND g.ended_at IS NULL
  AND g.election_id = a.election_id
  AND g.head_id = a.profile_id
  AND g.term_ends_at > (a.metadata->>'scheduled_term_ends_at')::timestamptz;

UPDATE public.parliament_members m
SET term_end_date = (a.metadata->>'scheduled_term_ends_at')::date
FROM public.election_office_assignments a
WHERE a.status = 'active'
  AND a.office_role IN ('Deputado', 'Senador')
  AND a.metadata->>'holdover' = 'true'
  AND a.metadata ? 'scheduled_term_ends_at'
  AND m.user_id = a.profile_id
  AND m.house_id = CASE a.office_role
    WHEN 'Deputado' THEN 'a1b2c3d4-e5f6-7890-1234-567890abcdef'::uuid
    ELSE 'fedcba09-8765-4321-0987-654321fedcba'::uuid END
  AND m.term_end_date > (a.metadata->>'scheduled_term_ends_at')::date;

UPDATE public.election_office_assignments a
SET term_ends_at = (metadata->>'scheduled_term_ends_at')::timestamptz,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'holdover', false, 'holdover_cancelled_at', clock_timestamp()
    )
WHERE status = 'active'
  AND metadata->>'holdover' = 'true'
  AND metadata ? 'scheduled_term_ends_at'
  AND term_ends_at > (metadata->>'scheduled_term_ends_at')::timestamptz;

-- Mantem o nome antigo apenas como compatibilidade: nao prolonga mandatos.
CREATE OR REPLACE FUNCTION private.extend_due_elected_mandates()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
BEGIN
  RETURN;
END;
$$;
REVOKE ALL ON FUNCTION private.extend_due_elected_mandates() FROM PUBLIC, anon, authenticated;

-- Aciona o encerramento automaticamente mesmo quando nao ha nova eleicao.
CREATE OR REPLACE FUNCTION private.expire_due_elected_mandates()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  a public.election_office_assignments%rowtype;
  v_house_id uuid;
  changed boolean := false;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('govrp:presidential-succession'));

  FOR a IN
    SELECT * FROM public.election_office_assignments
    WHERE status = 'active' AND term_ends_at <= clock_timestamp()
    ORDER BY term_ends_at, id
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.election_office_assignments
    SET status = 'expired',
        ended_at = clock_timestamp(),
        metadata = coalesce(metadata, '{}'::jsonb)
          || jsonb_build_object('reason', 'Fim do prazo regular do mandato, sem posse de sucessor')
    WHERE id = a.id AND status = 'active';

    PERFORM set_config('govrp.role_change_reason',
      'Fim do prazo regular do mandato eleitoral ' || a.id, true);

    UPDATE public.profiles p
    SET role = 'Cidadão',
        titles = array_remove(coalesce(titles, '{}'::text[]), a.office_role),
        role_assigned_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE p.id = a.profile_id
      AND p.role = a.office_role
      AND NOT p.manual_role_override
      AND NOT EXISTS (
        SELECT 1 FROM public.election_office_assignments next_term
        WHERE next_term.profile_id = p.id
          AND next_term.office_role = a.office_role
          AND next_term.status = 'active'
          AND next_term.term_starts_at <= clock_timestamp()
          AND next_term.term_ends_at > clock_timestamp()
      );

    IF a.office_role IN ('Deputado', 'Senador') THEN
      v_house_id := CASE a.office_role
        WHEN 'Deputado' THEN 'a1b2c3d4-e5f6-7890-1234-567890abcdef'::uuid
        ELSE 'fedcba09-8765-4321-0987-654321fedcba'::uuid END;

      UPDATE public.parliament_members m
      SET term_end_date = least(coalesce(m.term_end_date, a.term_ends_at::date), a.term_ends_at::date)
      WHERE m.user_id = a.profile_id AND m.house_id = v_house_id
        AND NOT EXISTS (
          SELECT 1 FROM public.election_office_assignments next_term
          WHERE next_term.profile_id = a.profile_id
            AND next_term.office_role = a.office_role
            AND next_term.status = 'active'
            AND next_term.term_starts_at <= clock_timestamp()
            AND next_term.term_ends_at > clock_timestamp()
        );
    END IF;

    changed := true;
  END LOOP;

  IF changed THEN
    PERFORM private.refresh_office_assignment_snapshot();
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.expire_due_elected_mandates() FROM PUBLIC, anon, authenticated;

-- O cron 'govrp-government-term' ja executa esta funcao a cada minuto.
-- Primeiro encerra o governo em seu prazo regular, depois todos os mandatos
-- eletivos expirados; uma posse futura nao gera prorrogacao automatica.
CREATE OR REPLACE FUNCTION private.maintain_government_term()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE g public.government_terms%rowtype;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('govrp:presidential-succession'));
  SELECT * INTO g FROM public.government_terms WHERE ended_at IS NULL FOR UPDATE;

  IF g.id IS NOT NULL THEN
    IF g.term_ends_at <= clock_timestamp() THEN
      PERFORM set_config('govrp.executive_transition', 'replacing', true);
      PERFORM private.end_government_cabinet(g.id, 'Encerramento normal do Governo.');
      PERFORM private.end_government_appointments(g.id, 'Encerramento normal do Governo.');
      UPDATE public.government_terms SET ended_at = clock_timestamp() WHERE id = g.id;
      UPDATE public.profiles SET role = 'Cidadão',
        manual_role_override = false,
        role_assigned_at = clock_timestamp(),
        titles = array_remove(array_remove(coalesce(titles, '{}'), 'Presidente'), 'Vice-Presidente')
      WHERE (id = g.head_id AND role = 'Presidente')
         OR (role = 'Vice-Presidente' AND deleted_at IS NULL);
      UPDATE public.presidential_formation
      SET ended_at = clock_timestamp(), status = 'invalidated'
      WHERE government_id = g.id AND ended_at IS NULL;
      PERFORM set_config('govrp.executive_transition', '', true);
    ELSIF g.is_interim AND NOT coalesce(public.is_acting_president(g.head_id), false) THEN
      PERFORM private.assign_interim_president(
        g.id, 'Atualização da chefia interina após mudança na Presidência da Câmara.'
      );
    END IF;
  END IF;

  PERFORM private.expire_due_elected_mandates();
END;
$$;
REVOKE ALL ON FUNCTION private.maintain_government_term() FROM PUBLIC, anon, authenticated;

COMMIT;
