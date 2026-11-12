-- GOVRP Bot: show live country GDP growth and inflation in the !economia command.
-- No Oracle Whatsmeow binary update needed: bot resolves this RPC on every request.
BEGIN;
CREATE OR REPLACE FUNCTION public.bot_whatsapp_command(p_command text, p_sender_jid text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_result text;v_head text;v_id uuid;v_prefix text;
BEGIN
 IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Serviço não autorizado.' USING errcode='42501'; END IF;
 v_head:=lower(coalesce(p_command,''));
 IF v_head='ajuda' THEN
  RETURN E'🤖 *GOVRP Bot*\n\n!noticias — notícias recentes\n!economia — indicadores atuais\n!governo — presidente e ministros\n!partidos — partidos ativos\n!eleicoes — eleições\n!votacoes — votações parlamentares\n!leis — projetos legislativos recentes\n!perfil — sua ficha pública\n\nVincular conta: gere o código em govrp.vercel.app/settings e envie *!vincular CÓDIGO* no privado do bot.';
 ELSIF v_head='noticias' THEN
  SELECT string_agg('• '||left(n.title,160)||E'\n'||'https://govrp.vercel.app/news/'||n.id::text,E'\n\n' ORDER BY n.created_at DESC) INTO v_result FROM (SELECT id,title,created_at FROM public.news_articles ORDER BY created_at DESC LIMIT 5) n;
  RETURN '📰 *Últimas notícias do GOVRP*'||E'\n\n'||coalesce(v_result,'Nenhuma notícia disponível.');
 ELSIF v_head='economia' THEN
  -- Read the same current country metrics as the GOVRP economy, without hardcoded rates.
  WITH indicadores AS (
   SELECT s.current_selic, s.cpi_index, s.exchange_rate, s.economic_cycle,
    coalesce(
      nullif(c.economic_current->>'growth','')::numeric,
      (SELECT coalesce(i.real_value,i.nominal_value) FROM public.economic_indicators i
       WHERE i.indicator_code='gdp_growth_year_over_year' AND i.status='official'
       ORDER BY i.created_at DESC,i.id DESC LIMIT 1)
    ) AS crescimento_anual,
    coalesce(
      nullif(c.economic_current->>'growthQuarterly','')::numeric,
      (SELECT coalesce(i.real_value,i.nominal_value) FROM public.economic_indicators i
       WHERE i.indicator_code='gdp_growth_quarterly' AND i.status='official'
       ORDER BY i.created_at DESC,i.id DESC LIMIT 1)
    ) AS crescimento_trimestral,
    coalesce(
      nullif(c.economic_current->>'inflation','')::numeric,
      (SELECT coalesce(i.real_value,i.nominal_value) FROM public.economic_indicators i
       WHERE i.indicator_code='inflation_annual' AND i.status='official'
       ORDER BY i.created_at DESC,i.id DESC LIMIT 1)
    ) AS inflacao_anual,
    (SELECT coalesce(i.real_value,i.nominal_value) FROM public.economic_indicators i
     WHERE i.indicator_code='inflation_monthly' AND i.status='official'
     ORDER BY i.created_at DESC,i.id DESC LIMIT 1) AS inflacao_mensal
   FROM public.economic_state s
   LEFT JOIN public.country_rp_states c ON c.country_code='BR'
   WHERE s.id=true
  )
  SELECT '📊 *Economia do GOVRP*'
    ||E'\n\n📈 Crescimento do PIB (12 meses): '
    ||coalesce((CASE WHEN crescimento_anual>0 THEN '+' ELSE '' END)
      ||replace(round(crescimento_anual,2)::text,'.',',')||'%','indisponível')
    ||E'\n📈 Crescimento trimestral: '
    ||coalesce((CASE WHEN crescimento_trimestral>0 THEN '+' ELSE '' END)
      ||replace(round(crescimento_trimestral,2)::text,'.',',')||'%','indisponível')
    ||E'\n🔥 Inflação anual: '
    ||coalesce(replace(round(inflacao_anual,2)::text,'.',',')||'%','indisponível')
    ||E'\n🔥 Inflação mensal: '
    ||coalesce(replace(round(inflacao_mensal,2)::text,'.',',')||'%','indisponível')
    ||E'\n\nSelic: '||round(coalesce(current_selic,0),2)||'%'
    ||E'\nÍndice de preços (CPI): '||round(coalesce(cpi_index,0),2)
    ||E'\nCâmbio: '||round(coalesce(exchange_rate,0),2)
    ||E'\nCiclo econômico: '||coalesce(economic_cycle,'—')
  INTO v_result FROM indicadores;
  RETURN coalesce(v_result,'Indicadores econômicos indisponíveis.')||E'\n\nDetalhes: https://govrp.vercel.app/';
 ELSIF v_head='governo' THEN
  SELECT '🏛️ *Presidência*\n'||coalesce(p.full_name,p.username,'Em definição') INTO v_result FROM public.government_terms g LEFT JOIN public.profiles p ON p.id=g.head_id WHERE g.ended_at IS NULL ORDER BY g.term_starts_at DESC LIMIT 1;
  SELECT string_agg('• '||coalesce(p.full_name,p.username,'Cidadão')||' — '||coalesce(m.ministry,'Ministério'),E'\n') INTO v_head FROM (SELECT * FROM public.ministers WHERE status='active' ORDER BY appointed_at DESC LIMIT 15) m LEFT JOIN public.profiles p ON p.id=m.user_id;
  RETURN coalesce(v_result,'🏛️ *Presidência*: não identificada')||E'\n\n*Ministros*\n'||coalesce(v_head,'Nenhum ministro ativo registrado.');
 ELSIF v_head='partidos' THEN
  SELECT string_agg('• '||left(name,90)||' ('||coalesce(acronym,'—')||')',E'\n' ORDER BY name) INTO v_result FROM (SELECT name,acronym FROM public.political_parties WHERE is_active=true ORDER BY name LIMIT 25) p;
  RETURN '🚩 *Partidos ativos*'||E'\n\n'||coalesce(v_result,'Nenhum partido ativo registrado.');
 ELSIF v_head='eleicoes' THEN
  SELECT string_agg('• '||left(name,85)||' ('||status||')'||E'\nVotação: '||to_char(voting_start_date AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI'),E'\n' ORDER BY voting_start_date) INTO v_result
  FROM (SELECT name,status,voting_start_date FROM public.elections WHERE archived_at IS NULL AND status NOT IN ('Cancelled','Canceled','Archived') ORDER BY voting_start_date DESC LIMIT 5) e;
  RETURN '🗳️ *Eleições*'||E'\n\n'||coalesce(v_result,'Nenhuma eleição cadastrada.');
 ELSIF v_head='votacoes' THEN
  SELECT string_agg('• '||left(title,100)||E'\nAté: '||to_char(end_date AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI'),E'\n' ORDER BY end_date) INTO v_result
  FROM (SELECT title,end_date FROM public.parliament_votings WHERE status='active' AND end_date>now() ORDER BY end_date LIMIT 8) v;
  RETURN '🏛️ *Votações em andamento*'||E'\n\n'||coalesce(v_result,'Nenhuma votação ativa.')||E'\n\nhttps://govrp.vercel.app/';
 ELSIF v_head='leis' THEN
  SELECT string_agg('• '||left(title,100)||' — '||status,E'\n' ORDER BY updated_at DESC) INTO v_result
  FROM (SELECT title,status,updated_at FROM public.bills ORDER BY updated_at DESC LIMIT 5) b;
  RETURN '📜 *Propostas legislativas recentes*'||E'\n\n'||coalesce(v_result,'Nenhum projeto encontrado.');
 ELSIF v_head='perfil' THEN
  SELECT user_id INTO v_id FROM public.whatsapp_bot_links WHERE sender_jid=p_sender_jid;
  IF v_id IS NULL THEN RETURN '🔗 Conta não vinculada. Acesse https://govrp.vercel.app/settings, gere um código na seção WhatsApp e envie !vincular CÓDIGO no privado do bot.'; END IF;
  SELECT '👤 *Meu perfil GOVRP*'||E'\nNome: '||coalesce(p.full_name,p.username,'Cidadão')||E'\nUsuário: @'||coalesce(p.username,'—')||E'\nCargo: '||coalesce(p.role,'Cidadão') INTO v_result
  FROM public.profiles p WHERE p.id=v_id;
  RETURN coalesce(v_result,'Perfil não encontrado.')||E'\n\nhttps://govrp.vercel.app/settings';
 END IF;
 RETURN 'Comando desconhecido. Digite !ajuda para ver as opções.';
END $function$

REVOKE ALL ON FUNCTION public.bot_whatsapp_command(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bot_whatsapp_command(text,text) TO service_role;
COMMIT;
