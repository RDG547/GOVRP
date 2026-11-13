-- GOVRP WhatsApp election lifecycle alerts and enumerated election queries.
-- Schedule is authoritative (election date columns). Poller calls RPC every 30 seconds.
-- No retrospective flood: phases are enqueued only while their current short window is open.
BEGIN;

-- Replace legacy generic status announcements with precise scheduled phases.
-- Only the elections trigger is removed: news, government and parliament outboxes remain.
DROP TRIGGER IF EXISTS whatsapp_election_outbox ON public.elections;

CREATE OR REPLACE FUNCTION public.bot_whatsapp_enqueue_election_lifecycle()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_inserted integer := 0; v_count integer := 0;
BEGIN
 IF auth.role() <> 'service_role' THEN
  RAISE EXCEPTION 'Serviço não autorizado.' USING errcode='42501';
 END IF;
 IF NOT EXISTS (
   SELECT 1 FROM public.whatsapp_bot_settings s
   JOIN public.whatsapp_bot_groups g ON g.enabled AND g.notify_elections
   WHERE s.id=true AND s.enabled
 ) THEN
   RETURN 0;
 END IF;

 WITH phases AS (
   SELECT e.id, e.name, e.extraordinary, e.candidacy_start_date, e.candidacy_end_date,
          e.voting_start_date, e.voting_end_date, x.phase_key, x.phase_at
   FROM public.elections e
   CROSS JOIN LATERAL (VALUES
     ('candidacy_open', e.candidacy_start_date),
     ('voting_open', e.voting_start_date),
     ('voting_30m', e.voting_end_date - interval '30 minutes'),
     ('voting_close', e.voting_end_date)
   ) x(phase_key,phase_at)
   WHERE e.archived_at IS NULL
     AND e.status NOT IN ('Cancelled','Canceled','Archived')
     AND x.phase_at IS NOT NULL
     AND x.phase_at <= clock_timestamp()
     AND x.phase_at > clock_timestamp() - interval '8 minutes'
     AND (x.phase_key NOT IN ('voting_open','voting_30m')
          OR e.voting_end_date > clock_timestamp())
     AND (x.phase_key <> 'voting_30m'
          OR e.voting_start_date <= x.phase_at)
 ), created AS (
   INSERT INTO public.whatsapp_bot_events(
     event_kind,source_table,source_id,title,message,url,expires_at
   )
   SELECT 'elections','elections',p.id::text||':'||p.phase_key||':'||p.phase_at::text,
     CASE p.phase_key
       WHEN 'candidacy_open' THEN '🗳️ Candidaturas abertas'
       WHEN 'voting_open' THEN '🗳️ Votação iniciada'
       WHEN 'voting_30m' THEN '🗳️ Votação termina em 30 minutos'
       ELSE '🗳️ Período de votação encerrado'
     END,
     '📌 *'||left(p.name,170)||'*'
     ||CASE WHEN p.extraordinary THEN E'\n⚡ Eleição extraordinária' ELSE '' END
     ||E'\n'
     ||CASE p.phase_key
       WHEN 'candidacy_open' THEN
         E'\n📝 O período de candidaturas começou.'
         ||E'\nAté: '||to_char(p.candidacy_end_date AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')
         ||E'\nVotação: '||to_char(p.voting_start_date AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')
       WHEN 'voting_open' THEN
         E'\n✅ A votação está aberta!'
         ||E'\nEncerra em: '||to_char(p.voting_end_date AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')
       WHEN 'voting_30m' THEN
         E'\n⏳ Faltam até 30 minutos para o encerramento.'
         ||E'\nPrazo final: '||to_char(p.voting_end_date AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')
       ELSE
         E'\n🔒 O prazo para votar terminou.'
         ||E'\nEncerramento: '||to_char(p.voting_end_date AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')
         ||E'\nAguardando publicação da apuração, se ainda não disponível.'
     END
     ||E'\n\nConsulte !eleicao ou !eleicoes.',
     'https://govrp.vercel.app/services/elections',
     clock_timestamp()+interval '4 hours'
   FROM phases p
   ON CONFLICT (event_kind,source_table,source_id) DO NOTHING
   RETURNING id
 )
 SELECT count(*) INTO v_count FROM created;
 v_inserted:=v_inserted+v_count;

 -- Results are announced ONLY after an authoritative, committed settlement.
 -- Newly deployed bots never broadcast months-old results.
 WITH recent_results AS (
   SELECT s.id, s.election_id, s.office_role, s.total_valid_votes, s.processed_at,
          e.name AS election_name,
          (
            SELECT string_agg(
              CASE WHEN EXISTS (
                SELECT 1 FROM jsonb_array_elements(coalesce(s.result,'[]'::jsonb)) x
                 WHERE x->>'candidate_id'=r.candidate_id::text
                   AND x->>'office_role'<>'Vice-Presidente'
              ) THEN '🏆 ' ELSE '• ' END
              ||left(coalesce(nullif(r.political_name,''),'Candidatura'),75)
              ||' — '||coalesce(r.vote_count,0)::text||' voto(s)',
              E'\n' ORDER BY r.vote_count DESC,r.candidate_id
            )
            FROM (
              SELECT * FROM public.get_election_results(s.election_id)
              ORDER BY vote_count DESC,candidate_id LIMIT 12
            ) r
          ) AS tally
   FROM public.election_settlements s
   JOIN public.elections e ON e.id=s.election_id
   WHERE s.status='settled'
     AND s.processed_at BETWEEN clock_timestamp()-interval '30 minutes' AND clock_timestamp()
     AND e.voting_end_date <= clock_timestamp()
 ), created AS (
   INSERT INTO public.whatsapp_bot_events(
     event_kind,source_table,source_id,title,message,url,expires_at
   )
   SELECT 'elections','election_settlements',r.id::text||':result',
     '🗳️ Resultado da apuração',
     '📌 *'||left(r.election_name,170)||'*'
      ||E'\n\n✅ Apuração concluída.'
      ||E'\nCargo: '||coalesce(r.office_role,'Eleição')
      ||E'\nVotos válidos: '||coalesce(r.total_valid_votes,0)::text
      ||E'\n\n*Resultado por candidatura:*\n'||coalesce(r.tally,'Não há candidaturas com votos contabilizados.')
      ||E'\n\nPara mais detalhes, use !eleicoes N.',
     'https://govrp.vercel.app/services/elections',
     clock_timestamp()+interval '6 hours'
   FROM recent_results r
   ON CONFLICT (event_kind,source_table,source_id) DO NOTHING
   RETURNING id
 )
 SELECT count(*) INTO v_count FROM created;
 RETURN v_inserted+v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.bot_whatsapp_enqueue_election_lifecycle() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bot_whatsapp_enqueue_election_lifecycle() TO service_role;

CREATE OR REPLACE FUNCTION public.bot_whatsapp_election_command(
 p_command text,
 p_number integer DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_e public.elections%ROWTYPE;
        v_lines text;
        v_phase text;
        v_title text;
        v_total integer;
        v_approved integer;
        v_candidates text;
        v_results text;
        v_settled boolean;
        v_idx bigint;
        v_now timestamptz:=clock_timestamp();
BEGIN
 IF auth.role() <> 'service_role' THEN
  RAISE EXCEPTION 'Serviço não autorizado.' USING errcode='42501';
 END IF;
 IF p_command NOT IN ('eleicao','eleicoes') THEN
  RETURN 'Comando inválido.';
 END IF;
 IF p_number IS NOT NULL AND (p_number < 1 OR p_number > 1000000) THEN
  RETURN 'Número de eleição inválido. Use !eleicoes para consultar a lista numerada.';
 END IF;

 -- Full and stable enumeration includes all past elections and those not yet opened.
 IF p_command='eleicoes' AND p_number IS NULL THEN
   WITH indexed AS (
     SELECT e.id,e.name,e.status,e.candidacy_start_date,e.voting_start_date,
            e.voting_end_date,
            row_number() over(order by e.created_at DESC,e.id DESC) n
     FROM public.elections e
   )
   SELECT string_agg(
     '*'||n::text||'.* '||left(name,90)
     ||' — '||
     CASE WHEN status IN ('Cancelled','Canceled') THEN 'Cancelada'
          WHEN v_now>=voting_end_date THEN 'Encerrada'
          WHEN v_now>=voting_start_date THEN 'Votação aberta'
          WHEN v_now>=candidacy_start_date THEN 'Candidaturas'
          ELSE 'Agendada' END,
     E'\n' ORDER BY n
   ) INTO v_lines FROM (SELECT * FROM indexed ORDER BY n LIMIT 25) x;
   SELECT count(*) INTO v_total FROM public.elections;
   RETURN '🗳️ *Histórico de eleições do GOVRP*'
     ||E'\n\n'||coalesce(v_lines,'Nenhuma eleição cadastrada.')
     ||E'\n\nTotal: '||v_total::text
     ||CASE WHEN v_total>25 THEN E'\nMostrando as primeiras 25; consulte qualquer número diretamente.' ELSE '' END
     ||E'\n\nDetalhes: !eleicoes N'
     ||E'\nhttps://govrp.vercel.app/services/elections';
 END IF;

 IF p_number IS NOT NULL THEN
  SELECT e.* INTO v_e FROM public.elections e
  JOIN (SELECT id,row_number() over(order by created_at DESC,id DESC) n FROM public.elections) numbered
    ON numbered.id=e.id WHERE numbered.n=p_number;
  v_idx:=p_number;
 ELSIF p_command='eleicao' THEN
  -- Show current elections together when their windows overlap.
  WITH indexed AS (
   SELECT e.id,e.name,e.candidacy_start_date,e.voting_start_date,e.voting_end_date,e.status,
          row_number() over(order by e.created_at DESC,e.id DESC) n
   FROM public.elections e
  ), present AS (
   SELECT * FROM indexed WHERE v_now>=candidacy_start_date AND v_now<voting_end_date
     AND status NOT IN ('Cancelled','Canceled','Archived')
  )
  SELECT string_agg(
   '*'||n::text||'.* '||left(name,100)||E'\n'
   ||CASE WHEN v_now<voting_start_date THEN
       CASE WHEN v_now<candidacy_start_date THEN 'Agendada' ELSE 'Candidaturas / aguardando votação' END
     ELSE 'Votação aberta' END
   ||E'\nCandidaturas: '||to_char(candidacy_start_date AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI')
   ||E' | Votação: '||to_char(voting_start_date AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI')
   ||E'\nFim: '||to_char(voting_end_date AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI'),
   E'\n\n' ORDER BY voting_end_date,n)
  INTO v_lines FROM present;

  IF v_lines IS NOT NULL THEN
   RETURN '🗳️ *Eleições em andamento*'||E'\n\n'||v_lines
    ||E'\n\nDetalhes: !eleicoes N'
    ||E'\nhttps://govrp.vercel.app/services/elections';
  END IF;

  -- If none are active, pick the next scheduled date; otherwise the latest concluded.
  SELECT e.* INTO v_e FROM public.elections e
  WHERE e.status NOT IN ('Cancelled','Canceled','Archived')
  ORDER BY CASE WHEN e.candidacy_start_date>v_now THEN 0 ELSE 1 END,
           CASE WHEN e.candidacy_start_date>v_now THEN e.candidacy_start_date END ASC,
           CASE WHEN e.candidacy_start_date<=v_now THEN e.voting_end_date END DESC,
           e.id DESC LIMIT 1;
  IF FOUND THEN
   SELECT count(*)+1 INTO v_idx FROM public.elections e
   WHERE (e.created_at,e.id)>(v_e.created_at,v_e.id);
  END IF;
 END IF;

 IF v_e.id IS NULL THEN
   RETURN '🗳️ Nenhuma eleição encontrada. Digite !eleicoes para consultar o histórico.';
 END IF;
 SELECT count(*)::int,count(*) FILTER(WHERE c.status='Approved' AND c.removed_at IS NULL)::int
 INTO v_total,v_approved
 FROM public.candidates c WHERE c.election_id=v_e.id;
 SELECT EXISTS(SELECT 1 FROM public.election_settlements s
               WHERE s.election_id=v_e.id AND s.status='settled')
 INTO v_settled;
 v_phase:=CASE
  WHEN v_e.status IN ('Cancelled','Canceled') THEN 'Cancelada'
  WHEN v_now < v_e.candidacy_start_date THEN 'Agendada'
  WHEN v_now < v_e.candidacy_end_date THEN 'Recebendo candidaturas'
  WHEN v_now < v_e.voting_start_date THEN 'Aguardando início da votação'
  WHEN v_now < v_e.voting_end_date THEN 'Votação aberta'
  WHEN v_settled THEN 'Encerrada • apurada'
  ELSE 'Encerrada • aguardando apuração'
 END;

 SELECT string_agg(
   '• '||left(coalesce(nullif(c.political_name,''),p.full_name,'Candidatura'),70)
   ||coalesce(' (nº '||nullif(c.electoral_number,'')||')','')
   ||coalesce(' — '||pp.acronym,''),
   E'\n' ORDER BY c.political_name,c.id
 ) INTO v_candidates FROM (
   SELECT * FROM public.candidates
   WHERE election_id=v_e.id AND status='Approved' AND removed_at IS NULL
   ORDER BY political_name,id LIMIT 15
 ) c
 LEFT JOIN public.profiles p ON p.id=c.user_id
 LEFT JOIN public.political_parties pp ON pp.id=c.party_id;

 v_title:='🗳️ *Eleição '||coalesce(v_idx::text,'')||' — '||left(v_e.name,120)||'*';
 v_lines:=v_title
   ||E'\nStatus: *'||v_phase||'*'
   ||CASE WHEN v_e.extraordinary THEN E'\n⚡ Extraordinária' ELSE '' END
   ||E'\n\n📝 Candidaturas: '
   ||to_char(v_e.candidacy_start_date AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')
   ||' até '||to_char(v_e.candidacy_end_date AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')
   ||E'\n🗳️ Votação: '
   ||to_char(v_e.voting_start_date AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')
   ||' até '||to_char(v_e.voting_end_date AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')
   ||E'\n\nCandidaturas recebidas: '||v_total::text
   ||E'\nCandidaturas aprovadas: '||v_approved::text
   ||E'\n\n*Chapas aprovadas:*\n'||coalesce(v_candidates,'Nenhuma chapa aprovada.');

 IF v_settled AND v_now>=v_e.voting_end_date THEN
  SELECT string_agg(
      '• '||left(coalesce(nullif(r.political_name,''),'Candidatura'),75)
      ||' — '||r.vote_count::text||' voto(s)',
      E'\n' ORDER BY r.vote_count DESC,r.candidate_id
  ) INTO v_results FROM (
    SELECT * FROM public.get_election_results(v_e.id)
    ORDER BY vote_count DESC,candidate_id LIMIT 15
  ) r;
  v_lines:=v_lines||E'\n\n📊 *Apuração publicada:*\n'
   ||coalesce(v_results,'Sem votos apurados.');
 END IF;
 RETURN left(v_lines,3500)||E'\n\n🔗 https://govrp.vercel.app/services/elections';
END;
$function$;

REVOKE ALL ON FUNCTION public.bot_whatsapp_election_command(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bot_whatsapp_election_command(text,integer) TO service_role;

COMMIT;
