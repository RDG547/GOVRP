-- GOVRP: full government formation and suppression of involuntary X "official news".
-- Existing news and sent messages stay untouched; only new outbox events are filtered.
BEGIN;
DO $patch$
DECLARE
  definition text;
  first_at integer;
  next_at integer;
  old_text text;
BEGIN
  SELECT pg_get_functiondef('public.bot_whatsapp_command(text,text)'::regprocedure)
  INTO definition;

  first_at := strpos(definition,$anchor$ ELSIF v_head='governo' THEN$anchor$);
  next_at := strpos(definition,$anchor$ ELSIF v_head='partidos' THEN$anchor$);
  IF first_at=0 OR next_at<=first_at THEN
    RAISE EXCEPTION 'The !governo command changed; manual review required.';
  END IF;

  definition := substr(definition,1,first_at-1) || $government$
 ELSIF v_head='governo' THEN
  -- Only the active Government term, with vice chosen in the winning slate.
  SELECT '🏛️ *Formação governamental*'
   || E'\n\n🇧🇷 *Presidente da República*\n'
   || coalesce(p.full_name,p.username,'Não definido')
   || E'\n\n🤝 *Vice-Presidente da República*\n'
   || coalesce(vp.full_name,vp.username,'Não definido')
  INTO v_result
  FROM public.government_terms g
  LEFT JOIN public.profiles p ON p.id=g.head_id
  LEFT JOIN LATERAL (
    SELECT c.vice_candidate_id FROM public.candidates c
    WHERE c.election_id=g.election_id AND c.user_id=g.original_president_id
      AND c.vice_candidate_id IS NOT NULL
    ORDER BY c.created_at DESC LIMIT 1
  ) slate ON true
  LEFT JOIN public.profiles vp ON vp.id=slate.vice_candidate_id
  WHERE g.ended_at IS NULL AND (g.term_ends_at IS NULL OR g.term_ends_at>now())
  ORDER BY g.term_starts_at DESC LIMIT 1;

  SELECT string_agg(
    '• '||coalesce(p.full_name,p.username,'Cidadão')
      ||' — '||coalesce(m.ministry,'Ministério'),
    E'\n' ORDER BY m.ministry, p.full_name
  )
  INTO v_head
  FROM public.ministers m
  JOIN public.government_terms g ON g.id=m.government_id AND g.ended_at IS NULL
    AND (g.term_ends_at IS NULL OR g.term_ends_at>now())
  LEFT JOIN public.profiles p ON p.id=m.user_id
  WHERE m.status='active' AND m.ended_at IS NULL;

  SELECT coalesce(p.full_name,p.username,'Não nomeado')
  INTO v_prefix
  FROM public.institutional_terms t
  JOIN public.profiles p ON p.id=t.profile_id
  WHERE t.office_key='public_prosecutor' AND t.status='active'
    AND t.ended_at IS NULL AND (t.ends_at IS NULL OR t.ends_at>now())
  ORDER BY t.starts_at DESC LIMIT 1;

  RETURN coalesce(v_result,
    '🏛️ *Formação governamental*'
    || E'\n\n🇧🇷 *Presidente da República*\nNão definido'
    || E'\n\n🤝 *Vice-Presidente da República*\nNão definido')
   || E'\n\n🏢 *Ministros de Estado*\n'
   || coalesce(v_head,'Nenhum ministro ativo registrado.')
   || E'\n\n⚖️ *Procurador-Geral da República (PGR)*\n'
   || coalesce(v_prefix,'Não nomeado')
   || E'\n\n🌐 Mais informações: https://govrp.vercel.app/';
$government$ || substr(definition,next_at);

  -- Prevent old PWA bundles' automatic X-to-news articles appearing under !noticias.
  old_text := 'FROM public.news_articles ORDER BY created_at DESC LIMIT 5';
  IF strpos(definition,old_text)=0 THEN
    RAISE EXCEPTION '!noticias query changed; review required.';
  END IF;
  definition := replace(definition,old_text,
    $new$FROM public.news_articles
      WHERE title NOT LIKE '📢 Pronunciamento Oficial do Presidente:%'
      ORDER BY created_at DESC LIMIT 5$new$);
  EXECUTE definition;

  SELECT pg_get_functiondef('private.whatsapp_bot_outbox_trigger()'::regprocedure)
  INTO definition;
  old_text := $old$ IF TG_TABLE_NAME='news_articles' AND TG_OP='INSERT' THEN$old$;
  IF strpos(definition,old_text)=0 THEN
    RAISE EXCEPTION 'The WhatsApp news trigger changed; review required.';
  END IF;
  definition := replace(definition,old_text,
    $new$ IF TG_TABLE_NAME='news_articles' AND TG_OP='INSERT' THEN
   -- A legacy X client can still submit an automatic "official pronouncement"
   -- news article. Never broadcast it to WhatsApp as an institutional act.
   IF NEW.title LIKE '📢 Pronunciamento Oficial do Presidente:%'
   THEN RETURN NEW; END IF;$new$);
  EXECUTE definition;
END $patch$;
COMMIT;