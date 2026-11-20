-- GOVRP WhatsApp: parliamentary end display, member details, STF and current prisoners.
-- Existing mandate dates are date-only. Display the institutional 06:00 hour
-- as requested; do not rewrite the authoritative mandates themselves.
BEGIN;
DO $patch$
DECLARE f text;
BEGIN
  SELECT pg_get_functiondef('public.bot_whatsapp_parliament_house(text)'::regprocedure) INTO f;
  IF (length(f)-length(replace(f,'to_char(term_end_date,''DD/MM/YYYY'')','')))/length('to_char(term_end_date,''DD/MM/YYYY'')') <> 1 THEN
    RAISE EXCEPTION 'Parliamentary list changed; manual review before updating display.';
  END IF;
  EXECUTE replace(f,'to_char(term_end_date,''DD/MM/YYYY'')',
                 'to_char(term_end_date,''DD/MM/YYYY'')||'' - 06:00H''');
END $patch$;

CREATE OR REPLACE FUNCTION public.bot_whatsapp_parliament_member(p_house text,p_selector text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
 v_house_id uuid;
 v_house text;
 v_member record;
 v_total bigint;
 v_pl bigint;
 v_pec bigint;
 v_approved bigint;
 v_rejected bigint;
 v_pending bigint;
 v_found bigint;
 v_selector text:=btrim(coalesce(p_selector,''));
BEGIN
 IF auth.role()<>'service_role' THEN
  RAISE EXCEPTION 'Serviço não autorizado.' USING ERRCODE='42501';
 END IF;
 IF p_house NOT IN ('deputado','senador') THEN RETURN 'Casa parlamentar inválida.';END IF;
 IF length(v_selector)=0 OR length(v_selector)>120 THEN
  RETURN 'Informe o nome completo ou o número da lista de '||
      CASE WHEN p_house='deputado' THEN 'deputados' ELSE 'senadores' END||'.';
 END IF;
 v_house:=CASE WHEN p_house='deputado' THEN 'Câmara dos Deputados' ELSE 'Senado' END;
 SELECT id INTO v_house_id FROM public.parliament_houses WHERE name=v_house LIMIT 1;
 IF v_house_id IS NULL THEN RETURN 'Casa parlamentar indisponível.';END IF;

 WITH members AS (
   SELECT m.id,m.user_id,m.term_start_date,m.term_end_date,
    left(coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''),'Cidadão'),90) name,
    p.username,
    coalesce(nullif(btrim(pp.acronym),''),'Sem partido') party,
    row_number() OVER(ORDER BY lower(coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''),'Cidadão')),m.id) pos
   FROM public.parliament_members m
   JOIN public.profiles p ON p.id=m.user_id AND p.deleted_at IS NULL
   LEFT JOIN public.political_parties pp ON pp.id=coalesce(m.party_id,m.elected_party_id)
   WHERE m.house_id=v_house_id
    AND m.term_start_date<=(now() AT TIME ZONE 'America/Sao_Paulo')::date
    AND m.term_end_date>=(now() AT TIME ZONE 'America/Sao_Paulo')::date
    AND m.id=public.get_active_parliament_member_id(m.user_id,m.house_id)
 ), matches AS (
   SELECT * FROM members
   WHERE CASE WHEN v_selector ~ '^[0-9]{1,6}$'
    THEN pos=v_selector::bigint
    ELSE lower(name)=lower(v_selector) OR lower(coalesce(username,''))=lower(ltrim(v_selector,'@'))
   END
 )
 SELECT count(*) INTO v_found FROM matches;

 IF v_found=0 THEN
  RETURN '🔎 Nenhum '||CASE WHEN p_house='deputado' THEN 'deputado' ELSE 'senador' END
   ||' em exercício encontrado. Consulte a lista com !'||CASE WHEN p_house='deputado' THEN 'deputados' ELSE 'senadores' END||'.';
 END IF;
 IF v_found>1 THEN
  RETURN 'Há mais de um parlamentar com esse nome. Consulte !'||
    CASE WHEN p_house='deputado' THEN 'deputados' ELSE 'senadores' END||
    ' e use o número correspondente.';
 END IF;

 WITH members AS (
   SELECT m.id,m.user_id,m.term_start_date,m.term_end_date,
    coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''),'Cidadão') name,
    p.username,coalesce(nullif(btrim(pp.acronym),''),'Sem partido') party,
    row_number() OVER(ORDER BY lower(coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''),'Cidadão')),m.id) pos
   FROM public.parliament_members m
   JOIN public.profiles p ON p.id=m.user_id AND p.deleted_at IS NULL
   LEFT JOIN public.political_parties pp ON pp.id=coalesce(m.party_id,m.elected_party_id)
   WHERE m.house_id=v_house_id
    AND m.term_start_date<=(now() AT TIME ZONE 'America/Sao_Paulo')::date
    AND m.term_end_date>=(now() AT TIME ZONE 'America/Sao_Paulo')::date
    AND m.id=public.get_active_parliament_member_id(m.user_id,m.house_id)
 )
 SELECT * INTO v_member FROM members
 WHERE CASE WHEN v_selector ~ '^[0-9]{1,6}$'
   THEN pos=v_selector::bigint
   ELSE lower(name)=lower(v_selector) OR lower(coalesce(username,''))=lower(ltrim(v_selector,'@'))
 END
 LIMIT 1;

 SELECT count(*),
  count(*) FILTER(WHERE type='PL'),
  count(*) FILTER(WHERE type='PEC'),
  count(*) FILTER(WHERE status IN('Aprovado','Aguardando sanção presidencial','Sancionado','Promulgado','Vigente')),
  count(*) FILTER(WHERE status='Rejeitado'),
  count(*) FILTER(WHERE status NOT IN('Aprovado','Aguardando sanção presidencial','Sancionado','Promulgado','Vigente','Rejeitado'))
 INTO v_total,v_pl,v_pec,v_approved,v_rejected,v_pending
 FROM public.bills
 WHERE author_id=v_member.user_id AND type IN('PL','PEC');

 RETURN '🏛️ *'||CASE WHEN p_house='deputado' THEN 'Deputado' ELSE 'Senador' END
  ||' — ficha parlamentar*'
  ||E'\n\n🔢 Número na lista: '||v_member.pos
  ||E'\n👤 Nome: '||v_member.name
  ||E'\n📱 Usuário: @'||coalesce(v_member.username,'Não informado')
  ||E'\n🏳️ Partido: '||v_member.party
  ||E'\n🏛️ Casa: '||v_house
  ||E'\n📅 Mandato: '||to_char(v_member.term_start_date,'DD/MM/YYYY')
  ||' até '||to_char(v_member.term_end_date,'DD/MM/YYYY')||' - 06:00H'
  ||E'\n\n📜 *Proposições de autoria*'
  ||E'\n• Total PL + PEC: '||v_total
  ||E'\n• PLs propostas: '||v_pl
  ||E'\n• PECs propostas: '||v_pec
  ||E'\n• Aprovadas: '||v_approved
  ||E'\n• Rejeitadas: '||v_rejected
  ||E'\n• Em tramitação ou outra situação: '||v_pending
  ||E'\n\nℹ️ Resultados calculados a partir do status atual dos projetos.'
  ||E'\n🌐 https://govrp.vercel.app/services/parliament';
END $function$;
REVOKE ALL ON FUNCTION public.bot_whatsapp_parliament_member(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bot_whatsapp_parliament_member(text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.bot_whatsapp_stf()
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_result text;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Serviço não autorizado.' USING ERRCODE='42501'; END IF;
 WITH slots AS (
  SELECT n, 'supreme_court_'||n AS office_key FROM generate_series(1,5) n
 ), holders AS (
  SELECT s.n,s.office_key,
   coalesce(p.full_name,p.username,'') person,
   t.starts_at,t.ends_at
  FROM slots s
  LEFT JOIN LATERAL (
   SELECT term.profile_id,term.starts_at,term.ends_at
   FROM public.institutional_terms term
   WHERE term.office_key=s.office_key AND term.status='active'
    AND term.ended_at IS NULL AND (term.ends_at IS NULL OR term.ends_at>now())
   ORDER BY term.starts_at DESC LIMIT 1
  ) t ON true
  LEFT JOIN public.profiles p ON p.id=t.profile_id AND p.deleted_at IS NULL
 )
 SELECT string_agg(
    '⚖️ *Vaga '||n||'* — '||
    CASE WHEN person<>'' THEN person ELSE 'Disponível (sem ministro empossado)' END||
    CASE WHEN person<>'' THEN E'\n📅 Posse: '||to_char(starts_at AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')
      ||coalesce(E'\n⏳ Fim do mandato: '||to_char(ends_at AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI'),'')
    ELSE '' END,
   E'\n\n' ORDER BY n
 ) INTO v_result FROM holders;
 RETURN '⚖️ *Composição do Supremo Tribunal Federal — GOVRP*'
  ||E'\n\n'||coalesce(v_result,'Nenhuma vaga cadastrada.')
  ||E'\n\nℹ️ Indicações em sabatina não significam posse; somente mandatos ativos integram esta lista.'
  ||E'\n🌐 https://govrp.vercel.app/services/justice';
END $function$;
REVOKE ALL ON FUNCTION public.bot_whatsapp_stf() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bot_whatsapp_stf() TO service_role;

CREATE OR REPLACE FUNCTION public.bot_whatsapp_presos()
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_result text; v_count int;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Serviço não autorizado.' USING ERRCODE='42501'; END IF;
 WITH current_custody AS (
  SELECT DISTINCT ON (t.inmate_id)
   t.inmate_id,coalesce(p.full_name,p.username,'Cidadão') inmate,
   coalesce(f.name,'Unidade não informada') facility,t.custody_status,
   t.admitted_at,t.expected_release_at
  FROM public.prison_terms t
  JOIN public.profiles p ON p.id=t.inmate_id AND p.deleted_at IS NULL
  LEFT JOIN public.prison_facilities f ON f.id=t.facility_id
  WHERE t.custody_status IN('provisional','serving','awaiting_intake')
    AND t.actual_release_at IS NULL
    AND (t.expected_release_at IS NULL OR t.expected_release_at>now())
  ORDER BY t.inmate_id,t.admitted_at DESC
 ), ranked AS (
  SELECT *,row_number() OVER(ORDER BY lower(inmate),inmate_id) position FROM current_custody
 )
 SELECT count(*)::int,
  string_agg(
    '*'||position||'. '||inmate||'*'
    ||E'\n🏢 Unidade: '||facility
    ||E'\n🔒 Situação: '||CASE custody_status::text
       WHEN 'provisional' THEN 'Prisão provisória'
       WHEN 'serving' THEN 'Cumprindo pena'
       ELSE 'Aguardando ingresso' END
    ||coalesce(E'\n📅 Previsão de saída: '||to_char(expected_release_at AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI'),''),
   E'\n\n' ORDER BY position)
 INTO v_count,v_result FROM ranked;
 RETURN '🚔 *Cidadãos sob custódia — GOVRP*'
  ||E'\n\nPresos registrados: '||v_count
  ||E'\n\n'||coalesce(v_result,'Nenhum cidadão atualmente sob custódia.')
  ||E'\n\n🌐 https://govrp.vercel.app/services/justice';
END $function$;
REVOKE ALL ON FUNCTION public.bot_whatsapp_presos() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bot_whatsapp_presos() TO service_role;
COMMIT;