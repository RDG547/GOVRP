-- Reconvocação presidencial extraordinária de 14 a 15/11/2026.
-- Regra exclusiva: candidaturas aprovadas automaticamente após verificações comuns.
-- Preserva votos anteriores em uma eleição anulada; não transfere votos à nova urna.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL TIME ZONE 'America/Sao_Paulo';

-- Preserve annulment across all ordinary status refreshers.
CREATE OR REPLACE FUNCTION public.update_election_status()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'pg_catalog','public','extensions','pg_temp'
AS $fn$
BEGIN
 IF lower(coalesce(NEW.status,'')) IN ('cancelled','canceled','cancelada') THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' AND lower(coalesce(OLD.status,'')) IN ('cancelled','canceled','cancelada') THEN
  NEW.status:=OLD.status;
  RETURN NEW;
 END IF;
 IF now()<NEW.candidacy_start_date THEN NEW.status:='Scheduled';
 ELSIF now()<NEW.candidacy_end_date THEN NEW.status:='Candidacy';
 ELSIF now()<NEW.voting_start_date THEN NEW.status:='Scheduled';
 ELSIF now()<NEW.voting_end_date THEN NEW.status:='Voting';
 ELSE NEW.status:='Finished'; END IF;
 RETURN NEW;
END $fn$;

CREATE OR REPLACE PROCEDURE public.refresh_all_election_status()
LANGUAGE plpgsql
SET search_path TO 'pg_catalog','public','extensions','pg_temp'
AS $proc$
BEGIN
 UPDATE public.elections SET status=CASE
  WHEN now()<candidacy_start_date THEN 'Scheduled'
  WHEN now()<candidacy_end_date THEN 'Candidacy'
  WHEN now()<voting_start_date THEN 'Scheduled'
  WHEN now()<voting_end_date THEN 'Voting'
  ELSE 'Finished' END
 WHERE lower(coalesce(status,'')) NOT IN ('cancelled','canceled','cancelada')
   AND status IS DISTINCT FROM CASE
    WHEN now()<candidacy_start_date THEN 'Scheduled'
    WHEN now()<candidacy_end_date THEN 'Candidacy'
    WHEN now()<voting_start_date THEN 'Scheduled'
    WHEN now()<voting_end_date THEN 'Voting'
    ELSE 'Finished' END;
END $proc$;

-- Non-public exception registry: other elections retain their usual approval flow.
CREATE TABLE IF NOT EXISTS private.govrp_election_auto_approval_exceptions(
 election_id uuid PRIMARY KEY REFERENCES public.elections(id) ON DELETE CASCADE,
 candidacy_deadline timestamptz NOT NULL,
 reason text NOT NULL,
 source_election_id uuid REFERENCES public.elections(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON private.govrp_election_auto_approval_exceptions FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.govrp_auto_approve_special_candidacy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF NEW.removed_at IS NULL AND NEW.status IN('Pendente','Pending')
  AND EXISTS(
    SELECT 1 FROM private.govrp_election_auto_approval_exceptions x
    JOIN public.elections e ON e.id=x.election_id
    WHERE x.election_id=NEW.election_id AND clock_timestamp()<x.candidacy_deadline
      AND clock_timestamp()>=e.candidacy_start_date AND clock_timestamp()<e.candidacy_end_date
      AND e.status='Candidacy'
  )
 THEN
   NEW.status:='Approved';
   NEW.admin_feedback:= 'Aprovada automaticamente conforme regra excepcional da reconvocação de 14/11/2026; mantidos os requisitos legais gerais.';
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.govrp_auto_approve_special_candidacy() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS zz_govrp_auto_approve_special_candidacy ON public.candidates;
CREATE TRIGGER zz_govrp_auto_approve_special_candidacy
 BEFORE INSERT OR UPDATE OF status ON public.candidates
 FOR EACH ROW EXECUTE FUNCTION private.govrp_auto_approve_special_candidacy();

CREATE OR REPLACE FUNCTION private.govrp_notify_special_candidacy_approved()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF NEW.status='Approved' AND EXISTS(
  SELECT 1 FROM private.govrp_election_auto_approval_exceptions WHERE election_id=NEW.election_id
 ) THEN
  INSERT INTO public.notifications(user_id,type,content,link,metadata)
  SELECT p.profile_id,'candidacy_approved',
    CASE WHEN p.position='candidate' THEN
      'Sua chapa foi aprovada automaticamente para a nova eleição presidencial extraordinária.'
    ELSE 'Você está confirmado como vice na chapa automaticamente aprovada para a nova eleição presidencial extraordinária.' END,
    '/services/elections',
    jsonb_build_object('election_id',NEW.election_id,'candidate_id',NEW.id,
       'automatic_approval',true,'position',p.position)
  FROM (VALUES(NEW.user_id,'candidate'),(NEW.vice_candidate_id,'vice')) p(profile_id,position)
  WHERE p.profile_id IS NOT NULL AND p.profile_id<>ALL('{}'::uuid[]);
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.govrp_notify_special_candidacy_approved() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS govrp_notify_special_candidacy_approved ON public.candidates;
CREATE TRIGGER govrp_notify_special_candidacy_approved
 AFTER INSERT ON public.candidates FOR EACH ROW
 EXECUTE FUNCTION private.govrp_notify_special_candidacy_approved();

-- Prevent a duplicate generic "candidacies open" notification from the 30s bot
-- poller when the exclusive manually authored announcement is already in the outbox.
DO $poller_guard$
DECLARE v_def text;v_old text;v_new text;
BEGIN
 SELECT pg_get_functiondef('public.bot_whatsapp_enqueue_election_lifecycle()'::regprocedure)
 INTO v_def;
 v_old:='AND x.phase_at > clock_timestamp() - interval ''8 minutes''';
 IF position(v_old IN v_def)=0 THEN
   RAISE EXCEPTION 'Padrão de agendamento eleitoral mudou. Não duplicar notificações.';
 END IF;
 v_new:=v_old||E'\n     AND NOT (x.phase_key = ''candidacy_open'' AND EXISTS (\n       SELECT 1 FROM private.govrp_election_auto_approval_exceptions sp\n       WHERE sp.election_id = e.id\n         AND EXISTS (SELECT 1 FROM public.whatsapp_bot_events event\n                     WHERE event.event_kind = ''elections''\n                       AND event.source_table = ''elections''\n                       AND event.source_id LIKE e.id::text||'':candidacy_open:%'')\n     ))';
 EXECUTE replace(v_def,v_old,v_new);
END $poller_guard$;

-- One transaction: cancel the old election, undo its future awards/PP,
-- create the fresh ballot, copy the two approved tickets, schedule bot notice.
DO $reconvocation$
DECLARE
 v_old constant uuid:='5ead99a1-bc29-4a07-9938-626414d31393'::uuid;
 v_first constant uuid:='364c60b6-a4cd-4061-b59a-13c2dfd98d2c'::uuid;
 v_group constant text:='120363289786230845@g.us';
 v_gov uuid;
 v_new uuid;
 v_old_e public.elections%ROWTYPE;
 v_first_e public.elections%ROWTYPE;
 v_pre_assignments jsonb;
 v_pre_settlement jsonb;
 v_pre_points jsonb;
 v_copied integer;
 v_revoked integer;
 v_points_total integer;
 v_notice_id bigint;
 v_notice text;
 v_reason constant text:='Eleição extraordinária anulada administrativamente; reconvocação sob as regras da primeira eleição presidencial, voto de 24 horas, candidaturas até 2h antes e aprovação automática exclusiva.';
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('govrp:extraordinary-revote:2026-11-14',0));
 SELECT * INTO v_old_e FROM public.elections WHERE id=v_old FOR UPDATE;
 SELECT * INTO v_first_e FROM public.elections WHERE id=v_first;
 IF v_old_e.id IS NULL OR v_first_e.id IS NULL OR v_old_e.status<>'Finished'
    OR NOT v_old_e.extraordinary OR v_old_e.election_mode<>'direct'
 THEN RAISE EXCEPTION 'Eleição anterior não corresponde à eleição extraordinária apurada.';END IF;
 IF v_old_e.election_type_id IS DISTINCT FROM v_first_e.election_type_id THEN
   RAISE EXCEPTION 'O tipo eleitoral deve ser o mesmo da primeira eleição presidencial.';
 END IF;
 IF clock_timestamp()>='2026-11-14 04:00:00-03'::timestamptz THEN
   RAISE EXCEPTION 'Janela de candidaturas expirou: não publicar programação retroativa.';
 END IF;
 IF EXISTS(SELECT 1 FROM public.elections WHERE name='Eleição Presidencial Extraordinária Direta — Reconvocação 14/11/2026') THEN
   RAISE EXCEPTION 'Reconvocação já cadastrada; bloqueando duplicação.';
 END IF;
 SELECT g.id INTO v_gov FROM public.government_terms g
   WHERE id=v_old_e.government_id AND ended_at IS NULL AND is_interim FOR UPDATE;
 IF v_gov IS NULL THEN RAISE EXCEPTION 'Governo interino original indisponível.';END IF;
 IF (SELECT count(*) FROM public.candidates WHERE election_id=v_old AND status='Approved' AND removed_at IS NULL)<>2 THEN
   RAISE EXCEPTION 'Número inesperado de chapas na eleição anulada.';
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) INTO v_pre_assignments
 FROM public.election_office_assignments a WHERE a.election_id=v_old;
 IF (SELECT count(*) FROM public.election_office_assignments WHERE election_id=v_old AND status='pending')<>2
  OR EXISTS(SELECT 1 FROM public.election_office_assignments WHERE election_id=v_old AND status='active')
 THEN RAISE EXCEPTION 'Existem atribuições eleitorais inesperadas; não alterar cargos em exercício.';END IF;
 SELECT to_jsonb(s) INTO v_pre_settlement FROM public.election_settlements s
 WHERE election_id=v_old AND status='settled' FOR UPDATE;
 IF v_pre_settlement IS NULL THEN RAISE EXCEPTION 'Apuração anterior não encontrada ou já invalidada.';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb),coalesce(sum(x.points),0)::int
 INTO v_pre_points,v_points_total
 FROM public.political_point_events x WHERE x.related_id=v_old AND x.event_type='election_win';
 IF v_points_total<>120 THEN RAISE EXCEPTION 'Premiação política inesperada (%), abortado.',v_points_total;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.whatsapp_bot_groups
   WHERE jid=v_group AND enabled AND notify_elections)
   OR NOT EXISTS(SELECT 1 FROM public.whatsapp_bot_settings WHERE id AND enabled)
 THEN RAISE EXCEPTION 'Grupo GOVRP ou notificações eleitorais estão desativados.'; END IF;

 UPDATE public.elections SET status='Cancelled',
  description=coalesce(description,'')||E'\n\n[ANULADA] Resultado e posse sem validade por decisão administrativa de reconvocação em 13/11/2026. Dados históricos preservados.'
 WHERE id=v_old;
 IF (SELECT status FROM public.elections WHERE id=v_old)<>'Cancelled' THEN RAISE EXCEPTION 'A anulação não foi preservada.';END IF;

 UPDATE public.election_settlements
  SET status='cancelled',
      metadata=coalesce(metadata,'{}'::jsonb)||
        jsonb_build_object('annulled',true,'annulled_at',clock_timestamp(),'reason',v_reason,'original_result_preserved',true)
 WHERE election_id=v_old AND status='settled';

 UPDATE public.election_office_assignments
  SET status='revoked',ended_at=clock_timestamp(),
      metadata=coalesce(metadata,'{}'::jsonb)||
       jsonb_build_object('reason','election_annulled','annulled_at',clock_timestamp(),
         'scheduled_inauguration_invalidated',true)
 WHERE election_id=v_old AND status='pending';
 GET DIAGNOSTICS v_revoked=ROW_COUNT;
 IF v_revoked<>2 THEN RAISE EXCEPTION 'Deveriam ser revogadas 2 posses futuras; obtidas %',v_revoked;END IF;

 -- The award from the now-void result is reversed without erasing its audit history.
 UPDATE public.profiles p
 SET political_points=greatest(0,coalesce(p.political_points,0)-v.points),
     updated_at=clock_timestamp()
 FROM (SELECT user_id,sum(points)::int points
       FROM public.political_point_events
       WHERE related_id=v_old AND event_type='election_win'
       GROUP BY user_id) v
 WHERE p.id=v.user_id;
 DELETE FROM public.political_point_events WHERE related_id=v_old AND event_type='election_win';
 UPDATE public.notifications SET
   type='political_points_revoked',
   content='Os pontos políticos atribuídos pela eleição presidencial extraordinária anulada foram estornados.',
   metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('annulled',true)
 WHERE type='political_points_awarded'
   AND metadata->>'related_id'=v_old::text;

 -- Previously announced result cannot continue to appear as a current victory popup.
 UPDATE public.notifications SET
   type='election_result_annulled',
   content='O resultado da eleição presidencial extraordinária foi anulado. Uma nova votação foi convocada para 14/11/2026.',
   metadata=coalesce(metadata,'{}'::jsonb)||
     jsonb_build_object('status','cancelled','annulled',true,'popup_pending',false,'annulled_at',clock_timestamp())
 WHERE type='election_result_published' AND metadata->>'election_id'=v_old::text;

 INSERT INTO public.elections(
  name,description,election_type_id,candidacy_start_date,candidacy_end_date,
  voting_start_date,voting_end_date,extraordinary,election_mode,
  government_id,original_term_ends_at,electorate_ids,quorum_min_votes,seats_available
 ) VALUES (
  'Eleição Presidencial Extraordinária Direta — Reconvocação 14/11/2026',
  'Reconvocação da eleição anulada. Mesmo modelo majoritário da 1ª eleição presidencial: Presidente e Vice-Presidente por voto popular. Exclusivamente nesta edição, as chapas elegíveis são aprovadas automaticamente. A posse ocorre 24 horas após o encerramento da votação; o mandato completa o período original.',
  v_first_e.election_type_id,now(),
  '2026-11-14 04:00:00-03'::timestamptz,
  '2026-11-14 06:00:00-03'::timestamptz,
  '2026-11-15 06:00:00-03'::timestamptz,
  true,'direct',v_gov,v_old_e.original_term_ends_at,'{}'::uuid[],0,NULL
 ) RETURNING id INTO v_new;

 IF (SELECT status FROM public.elections WHERE id=v_new)<>'Candidacy' THEN
   RAISE EXCEPTION 'A nova eleição não entrou automaticamente em fase de candidaturas.';
 END IF;

 INSERT INTO private.govrp_election_auto_approval_exceptions(
  election_id,candidacy_deadline,reason,source_election_id
 ) VALUES(v_new,'2026-11-14 04:00:00-03'::timestamptz,v_reason,v_old);

 INSERT INTO public.candidates(
  election_id,user_id,party_id,vice_candidate_id,political_name,
  bio,proposals,campaign_photo_url,status,electoral_number,admin_feedback
 )
 SELECT v_new,c.user_id,c.party_id,c.vice_candidate_id,c.political_name,
        c.bio,c.proposals,c.campaign_photo_url,'Pendente',c.electoral_number,
        'Chapa previamente aprovada na eleição anulada; registro migrado para a reconvocação, sem transportar votos.'
 FROM public.candidates c WHERE c.election_id=v_old AND c.status='Approved' AND c.removed_at IS NULL
 ORDER BY c.created_at;
 GET DIAGNOSTICS v_copied=ROW_COUNT;
 IF v_copied<>2 OR (SELECT count(*) FROM public.candidates
   WHERE election_id=v_new AND status='Approved' AND removed_at IS NULL)<>2 THEN
   RAISE EXCEPTION 'As duas chapas não foram transferidas com aprovação automática.';
 END IF;

 UPDATE public.government_terms SET extraordinary_election_id=v_new
 WHERE id=v_gov AND extraordinary_election_id=v_old;
 IF NOT FOUND THEN RAISE EXCEPTION 'Não foi possível reconectar o governo interino à nova eleição.';END IF;

 INSERT INTO public.election_audit_log(
  election_id,actor_id,actor_role,action,entity_type,entity_id,before_state,after_state,metadata
 ) VALUES (
  v_old,NULL,'Administração — reconvocação extraordinária',
  'election_annulled_with_revote','election',v_old::text,
  to_jsonb(v_old_e)||jsonb_build_object('settlement',v_pre_settlement,'assignments',v_pre_assignments,'reversed_points',v_pre_points),
  (SELECT to_jsonb(e) FROM public.elections e WHERE id=v_old),
  jsonb_build_object('reason',v_reason,'replacement_election_id',v_new,
   'revoked_future_assignments',v_revoked,'reversed_political_points',v_points_total,
   'prior_votes_preserved',true,'existing_user_roles_preserved',true)
 ),(
  v_new,NULL,'Administração — reconvocação extraordinária',
  'extraordinary_election_reconvoked','election',v_new::text,
  jsonb_build_object('annulled_election_id',v_old),
  (SELECT to_jsonb(e) FROM public.elections e WHERE id=v_new),
  jsonb_build_object('automatic_approval',true,'transferred_approved_tickets',v_copied,
   'voting_hours',24,'candidacy_deadline','2026-11-14 04:00:00-03',
   'inauguration_at','2026-11-16 06:00:00-03','preserved_original_term',v_old_e.original_term_ends_at)
 );

 INSERT INTO public.dou_entries(title,summary,content,type,source_id,legal_metadata)
 VALUES (
  'Anulação da eleição presidencial extraordinária anterior',
  'O resultado apurado em 13/11/2026 foi anulado e as posses futuras foram revogadas.',
  'Em razão de reconvocação administrativa, a eleição extraordinária anterior e seu resultado não produzirão efeitos para atribuição de cargos. Os registros de votos são mantidos como histórico da votação invalidada. O governo interino segue até a próxima posse.',
  'Ato Executivo',v_old,jsonb_build_object('annulled',true,'replacement_election_id',v_new)
 ),(
  'Reconvocação da eleição presidencial extraordinária',
  'Inscrições até 14/11 04h; votação 14/11 06h a 15/11 06h; posse 16/11 06h.',
  'Votação direta majoritária de 24 horas, Presidente e Vice. Aprovação automática de todas as chapas regulares exclusivamente nesta reconvocação. As duas chapas anteriormente aprovadas foram reaproveitadas. Eleitos tomam posse 24 horas após o término da votação, para completar o mandato original.',
  'Ato Executivo',v_new,jsonb_build_object(
   'source_election_id',v_old,'election_id',v_new,'auto_approval',true,
   'candidacy_until','2026-11-14 04:00:00-03','voting_from','2026-11-14 06:00:00-03',
   'voting_until','2026-11-15 06:00:00-03','inauguration_at','2026-11-16 06:00:00-03'
  )
 );

 -- Use the same idempotency key as the candidacy-opening lifecycle event:
 -- the bot therefore sends one exclusive announcement instead of two alerts.
 v_notice:=
  '⚖️ *COMUNICADO OFICIAL — NOVA ELEIÇÃO PRESIDENCIAL EXTRAORDINÁRIA*'
  ||E'\n\nA votação extraordinária anterior foi *ANULADA*. Seus votos e resultados não valem para a nova eleição. As posses que haviam sido agendadas foram revogadas.'
  ||E'\n\n📝 *CANDIDATURAS JÁ ABERTAS*\nAté: *sábado, 14/11/2026, às 04h*.'
  ||E'\n✅ *REGRA EXCLUSIVA:* todas as chapas que cumprirem os requisitos legais serão aprovadas automaticamente, sem análise manual.'
  ||E'\n\n✅ *Chapas já reaprovadas:*\n• Wesley / Guilherme Vaisman Da Conceicao Jr — PR, nº 10'
  ||E'\n• Billin Gabriel Mendes Cardoso / José Rite Picolé — PRONA, nº 57'
  ||E'\n\n🗳️ *VOTAÇÃO: 24 HORAS*\nInício: *sábado, 14/11, às 06h*\nEncerramento: *domingo, 15/11, às 06h*.'
  ||E'\n🏛️ *POSSE:* segunda-feira, *16/11, às 06h*, conforme regra de 24 horas após a votação. O mandato vai até 09/12/2026 às 06h.'
  ||E'\n\nA eleição segue o modelo majoritário da *1ª Eleição Presidencial*: chapa Presidente + Vice. O governo interino segue até a posse.'
  ||E'\n\nNão haverá transferência dos votos antigos. Toda a votação será refeita.'
  ;

 INSERT INTO public.whatsapp_bot_events(
  event_kind,source_table,source_id,title,message,url,target_group_jid,expires_at
 ) SELECT
  'elections','elections',v_new::text||':candidacy_open:'||e.candidacy_start_date::text,
  '🗳️ COMUNICADO EXCLUSIVO — ELEIÇÃO PRESIDENCIAL RECONVOCADA',
  v_notice,'https://govrp.vercel.app/services/elections',v_group,clock_timestamp()+interval '4 hours'
 FROM public.elections e WHERE e.id=v_new RETURNING id INTO v_notice_id;

 IF v_notice_id IS NULL THEN RAISE EXCEPTION 'Falhou ao programar comunicado exclusivo para o WhatsApp.';END IF;
END $reconvocation$;
COMMIT;
