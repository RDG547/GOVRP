-- GOVRP Bot 1.0 | Safe WhatsApp group opt-in, outbox, administrative controls and linkage
-- Whatsmeow is an unofficial protocol client. No outbound messaging until administrator enables bot and each group.
BEGIN;

CREATE TABLE IF NOT EXISTS public.whatsapp_bot_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 enabled boolean NOT NULL DEFAULT false,
 commands_enabled boolean NOT NULL DEFAULT true,
 command_prefix text NOT NULL DEFAULT '!' CHECK (length(command_prefix) BETWEEN 1 AND 2),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid
);
INSERT INTO public.whatsapp_bot_settings(id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.whatsapp_bot_groups (
 jid text PRIMARY KEY CHECK (jid ~ '^[0-9A-Za-z_.:-]+@g[.]us$'),
 display_name text NOT NULL DEFAULT '',
 enabled boolean NOT NULL DEFAULT false,
 notify_news boolean NOT NULL DEFAULT true,
 notify_elections boolean NOT NULL DEFAULT true,
 notify_votings boolean NOT NULL DEFAULT true,
 notify_government boolean NOT NULL DEFAULT true,
 discovered_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_bot_runtime (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 connected boolean NOT NULL DEFAULT false,
 paired boolean NOT NULL DEFAULT false,
 phone_jid text,
 qr_image text,
 qr_expires_at timestamptz,
 last_seen_at timestamptz,
 last_error text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.whatsapp_bot_runtime(id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.whatsapp_bot_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 event_kind text NOT NULL,
 source_table text NOT NULL,
 source_id text NOT NULL,
 title text NOT NULL,
 message text NOT NULL,
 url text,
 target_group_jid text REFERENCES public.whatsapp_bot_groups(jid) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT (now()+interval '48 hours'),
 CONSTRAINT whatsapp_bot_event_idempotence UNIQUE (event_kind,source_table,source_id)
);
CREATE INDEX IF NOT EXISTS whatsapp_bot_events_queue_idx ON public.whatsapp_bot_events(created_at,id) WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.whatsapp_bot_deliveries (
 event_id bigint NOT NULL REFERENCES public.whatsapp_bot_events(id) ON DELETE CASCADE,
 group_jid text NOT NULL REFERENCES public.whatsapp_bot_groups(jid) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending','sent','error')),
 attempts integer NOT NULL DEFAULT 1 CHECK(attempts >= 1),
 provider_message_id text,
 last_error text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(event_id,group_jid)
);

CREATE TABLE IF NOT EXISTS public.whatsapp_bot_links (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 sender_jid text NOT NULL UNIQUE CHECK(sender_jid ~ '^[0-9A-Za-z_.:-]+@(s[.]whatsapp[.]net|lid)$'),
 linked_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.whatsapp_bot_link_codes (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 code_hash text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,
 issued_at timestamptz NOT NULL DEFAULT now()
);

-- Restrict every administration/runtime/outbox table. Service-role access bypasses RLS, never expose service key in Vite.
ALTER TABLE public.whatsapp_bot_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_bot_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_bot_runtime ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_bot_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_bot_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_bot_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_bot_link_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_bot_settings,public.whatsapp_bot_groups,public.whatsapp_bot_runtime,public.whatsapp_bot_events,public.whatsapp_bot_deliveries,public.whatsapp_bot_links,public.whatsapp_bot_link_codes FROM anon,authenticated;
GRANT SELECT ON public.whatsapp_bot_settings,public.whatsapp_bot_groups,public.whatsapp_bot_runtime,public.whatsapp_bot_events,public.whatsapp_bot_deliveries TO authenticated;
GRANT ALL ON public.whatsapp_bot_settings,public.whatsapp_bot_groups,public.whatsapp_bot_runtime,public.whatsapp_bot_events,public.whatsapp_bot_deliveries,public.whatsapp_bot_links,public.whatsapp_bot_link_codes TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.whatsapp_bot_events_id_seq TO service_role;
CREATE POLICY whatsapp_bot_admin_settings ON public.whatsapp_bot_settings FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY whatsapp_bot_admin_groups ON public.whatsapp_bot_groups FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY whatsapp_bot_admin_runtime ON public.whatsapp_bot_runtime FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY whatsapp_bot_admin_events ON public.whatsapp_bot_events FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY whatsapp_bot_admin_deliveries ON public.whatsapp_bot_deliveries FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

-- Administrative mutations go through authenticated RPCs; preview sessions may not modify production.
CREATE OR REPLACE FUNCTION public.admin_save_whatsapp_bot_settings(p_enabled boolean,p_commands_enabled boolean,p_prefix text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Acesso administrativo necessário.' USING errcode='42501'; END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
 IF p_prefix NOT IN ('!','/') THEN RAISE EXCEPTION 'Prefixo inválido.'; END IF;
 UPDATE public.whatsapp_bot_settings SET enabled=coalesce(p_enabled,false),commands_enabled=coalesce(p_commands_enabled,false),command_prefix=p_prefix,updated_at=now(),updated_by=auth.uid() WHERE id;
END $fn$;

CREATE OR REPLACE FUNCTION public.admin_save_whatsapp_bot_group(
 p_jid text,p_enabled boolean,p_news boolean,p_elections boolean,p_votings boolean,p_government boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Acesso administrativo necessário.' USING errcode='42501'; END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
 IF p_jid IS NULL OR p_jid !~ '^[0-9A-Za-z_.:-]+@g[.]us$' THEN RAISE EXCEPTION 'Identificador de grupo inválido.'; END IF;
 INSERT INTO public.whatsapp_bot_groups(jid,enabled,notify_news,notify_elections,notify_votings,notify_government)
 VALUES(p_jid,coalesce(p_enabled,false),coalesce(p_news,false),coalesce(p_elections,false),coalesce(p_votings,false),coalesce(p_government,false))
 ON CONFLICT(jid) DO UPDATE SET enabled=excluded.enabled,notify_news=excluded.notify_news,notify_elections=excluded.notify_elections,notify_votings=excluded.notify_votings,notify_government=excluded.notify_government,updated_at=now();
END $fn$;

CREATE OR REPLACE FUNCTION public.admin_enqueue_whatsapp_bot_announcement(
 p_title text,p_message text,p_target_group text DEFAULT null
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_id bigint;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Acesso administrativo necessário.' USING errcode='42501'; END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
 IF length(trim(coalesce(p_title,''))) NOT BETWEEN 3 AND 120 OR length(trim(coalesce(p_message,''))) NOT BETWEEN 3 AND 1500 THEN
  RAISE EXCEPTION 'Informe título de 3–120 caracteres e mensagem de 3–1500 caracteres.';
 END IF;
 IF p_target_group IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.whatsapp_bot_groups WHERE jid=p_target_group AND enabled) THEN
  RAISE EXCEPTION 'O grupo selecionado deve estar autorizado e ativo.';
 END IF;
 INSERT INTO public.whatsapp_bot_events(event_kind,source_table,source_id,title,message,url,target_group_jid,expires_at)
 VALUES('manual','admin',gen_random_uuid()::text,trim(p_title),trim(p_message),null,p_target_group,now()+interval '24 hours')
 RETURNING id INTO v_id;
 RETURN v_id;
END $fn$;

-- Link codes are generated on the authenticated site; no WhatsApp number is read from a user's GOVRP profile.
CREATE OR REPLACE FUNCTION public.create_my_whatsapp_link_code()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_code text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login antes de vincular sua conta.' USING errcode='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.whatsapp_bot_link_codes WHERE user_id=auth.uid() AND issued_at>now()-interval '30 seconds') THEN
  RAISE EXCEPTION 'Aguarde 30 segundos antes de gerar outro código.';
 END IF;
 v_code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
 INSERT INTO public.whatsapp_bot_link_codes(user_id,code_hash,expires_at,issued_at)
 VALUES(auth.uid(),md5(v_code),now()+interval '10 minutes',now())
 ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,issued_at=now();
 RETURN v_code;
END $fn$;

CREATE OR REPLACE FUNCTION public.get_my_whatsapp_link_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_jid text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado.' USING errcode='42501'; END IF;
 SELECT sender_jid INTO v_jid FROM public.whatsapp_bot_links WHERE user_id=auth.uid();
 RETURN jsonb_build_object('linked',v_jid IS NOT NULL,'linked_account',CASE WHEN v_jid IS NULL THEN null ELSE '••••'||right(split_part(v_jid,'@',1),4) END);
END $fn$;

CREATE OR REPLACE FUNCTION public.unlink_my_whatsapp_account()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado.' USING errcode='42501'; END IF;
 DELETE FROM public.whatsapp_bot_links WHERE user_id=auth.uid();
 DELETE FROM public.whatsapp_bot_link_codes WHERE user_id=auth.uid();
END $fn$;

-- All worker endpoints explicitly require service_role; never grant to browser clients.
CREATE OR REPLACE FUNCTION public.bot_whatsapp_report_status(
 p_connected boolean,p_paired boolean,p_phone_jid text,p_qr_image text DEFAULT null,p_error text DEFAULT null
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Serviço não autorizado.' USING errcode='42501'; END IF;
 UPDATE public.whatsapp_bot_runtime SET connected=coalesce(p_connected,false),paired=coalesce(p_paired,false),
 phone_jid=left(p_phone_jid,100),qr_image=CASE WHEN p_qr_image IS NOT NULL THEN CASE WHEN length(p_qr_image)>150000 THEN null ELSE p_qr_image END WHEN coalesce(p_paired,false) THEN null ELSE qr_image END,
 qr_expires_at=CASE WHEN p_qr_image IS NOT NULL THEN now()+interval '75 seconds' WHEN coalesce(p_paired,false) THEN null ELSE qr_expires_at END,
 last_seen_at=now(),last_error=left(p_error,500),updated_at=now() WHERE id;
END $fn$;

CREATE OR REPLACE FUNCTION public.bot_whatsapp_discover_group(p_jid text,p_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Serviço não autorizado.' USING errcode='42501'; END IF;
 IF p_jid IS NULL OR p_jid !~ '^[0-9A-Za-z_.:-]+@g[.]us$' THEN RETURN; END IF;
 INSERT INTO public.whatsapp_bot_groups(jid,display_name) VALUES(p_jid,left(coalesce(p_name,''),100))
 ON CONFLICT(jid) DO UPDATE SET display_name=CASE WHEN length(trim(excluded.display_name))>0 THEN excluded.display_name ELSE public.whatsapp_bot_groups.display_name END;
END $fn$;

CREATE OR REPLACE FUNCTION public.bot_whatsapp_claim_deliveries(p_limit integer DEFAULT 5)
RETURNS TABLE(event_id bigint,group_jid text,message text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Serviço não autorizado.' USING errcode='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.whatsapp_bot_settings WHERE id AND enabled) THEN RETURN; END IF;
 RETURN QUERY
 WITH candidates AS (
  SELECT e.id,g.jid
  FROM public.whatsapp_bot_events e
  JOIN public.whatsapp_bot_groups g ON g.enabled AND (e.target_group_jid IS NULL OR e.target_group_jid=g.jid)
  LEFT JOIN public.whatsapp_bot_deliveries d ON d.event_id=e.id AND d.group_jid=g.jid
  WHERE e.expires_at>now() AND e.created_at>now()-interval '48 hours'
   AND CASE e.event_kind
    WHEN 'news' THEN g.notify_news
    WHEN 'elections' THEN g.notify_elections
    WHEN 'votings' THEN g.notify_votings
    WHEN 'government' THEN g.notify_government
    ELSE true END
   AND (d.event_id IS NULL OR (d.attempts<3 AND d.status IN ('sending','error') AND d.updated_at<now()-interval '2 minutes'))
  ORDER BY e.id ASC,g.jid ASC LIMIT least(greatest(coalesce(p_limit,5),1),10)
 ), claimed AS (
  INSERT INTO public.whatsapp_bot_deliveries(event_id,group_jid,status,attempts,updated_at)
  SELECT c.id,c.jid,'sending',1,now() FROM candidates c
  ON CONFLICT(event_id,group_jid) DO UPDATE SET status='sending',attempts=whatsapp_bot_deliveries.attempts+1,updated_at=now(),last_error=null
   WHERE whatsapp_bot_deliveries.status IN ('sending','error')
     AND whatsapp_bot_deliveries.attempts<3
     AND whatsapp_bot_deliveries.updated_at<now()-interval '2 minutes'
  RETURNING whatsapp_bot_deliveries.event_id,whatsapp_bot_deliveries.group_jid
 )
 SELECT c.event_id,c.group_jid,
  left('📢 *'||e.title||'*'||E'\n\n'||e.message||CASE WHEN e.url IS NOT NULL THEN E'\n\n🔗 '||e.url ELSE '' END,3500)
 FROM claimed c JOIN public.whatsapp_bot_events e ON e.id=c.event_id ORDER BY c.event_id;
END $fn$;

CREATE OR REPLACE FUNCTION public.bot_whatsapp_finish_delivery(p_event_id bigint,p_group_jid text,p_success boolean,p_provider_id text DEFAULT null,p_error text DEFAULT null)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Serviço não autorizado.' USING errcode='42501'; END IF;
 UPDATE public.whatsapp_bot_deliveries SET status=CASE WHEN p_success THEN 'sent' ELSE 'error' END,
 provider_message_id=left(p_provider_id,140),last_error=left(p_error,400),updated_at=now()
 WHERE event_id=p_event_id AND group_jid=p_group_jid AND status='sending';
END $fn$;

CREATE OR REPLACE FUNCTION public.bot_whatsapp_complete_link(p_sender_jid text,p_code text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_user uuid;v_name text;
BEGIN
 IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Serviço não autorizado.' USING errcode='42501'; END IF;
 IF p_sender_jid !~ '^[0-9A-Za-z_.:-]+@(s[.]whatsapp[.]net|lid)$' OR p_code !~ '^[0-9A-F]{12}$' THEN RETURN 'Código ou remetente inválido.'; END IF;
 SELECT user_id INTO v_user FROM public.whatsapp_bot_link_codes WHERE code_hash=md5(p_code) AND expires_at>now() FOR UPDATE;
 IF v_user IS NULL THEN RETURN 'Código inválido ou expirado. Gere outro nas configurações do GOVRP.'; END IF;
 IF EXISTS (SELECT 1 FROM public.whatsapp_bot_links WHERE sender_jid=p_sender_jid AND user_id<>v_user) THEN
  RETURN 'Este WhatsApp já está associado a outra conta GOVRP. Desvincule primeiro.';
 END IF;
 INSERT INTO public.whatsapp_bot_links(user_id,sender_jid) VALUES(v_user,p_sender_jid)
 ON CONFLICT(user_id) DO UPDATE SET sender_jid=excluded.sender_jid,linked_at=now();
 DELETE FROM public.whatsapp_bot_link_codes WHERE user_id=v_user;
 SELECT coalesce(nullif(full_name,''),username,'Cidadão') INTO v_name FROM public.profiles WHERE id=v_user;
 RETURN '✅ Conta GOVRP vinculada com sucesso: '||coalesce(v_name,'Cidadão')||'.';
END $fn$;

CREATE OR REPLACE FUNCTION public.bot_whatsapp_unlink_sender(p_sender_jid text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_count integer;
BEGIN
 IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Serviço não autorizado.' USING errcode='42501'; END IF;
 DELETE FROM public.whatsapp_bot_links WHERE sender_jid=p_sender_jid;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 RETURN v_count>0;
END $fn$;

CREATE OR REPLACE FUNCTION public.bot_whatsapp_command(p_command text,p_sender_jid text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
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
  SELECT '📊 *Economia do GOVRP*'||E'\n\nSelic: '||round(coalesce(current_selic,0),2)||'%'||E'\nÍndice de preços (CPI): '||round(coalesce(cpi_index,0),2)||E'\nCâmbio: '||round(coalesce(exchange_rate,0),2)||E'\nCiclo econômico: '||coalesce(economic_cycle,'—')
  INTO v_result FROM public.economic_state LIMIT 1;
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
END $fn$;

-- Authorization for every RPC is explicit; browser cannot invoke worker endpoints.
REVOKE ALL ON FUNCTION public.admin_save_whatsapp_bot_settings(boolean,boolean,text),
 public.admin_save_whatsapp_bot_group(text,boolean,boolean,boolean,boolean,boolean),
 public.admin_enqueue_whatsapp_bot_announcement(text,text,text),
 public.create_my_whatsapp_link_code(),
 public.get_my_whatsapp_link_status(),
 public.unlink_my_whatsapp_account(),
 public.bot_whatsapp_report_status(boolean,boolean,text,text,text),
 public.bot_whatsapp_discover_group(text,text),
 public.bot_whatsapp_claim_deliveries(integer),
 public.bot_whatsapp_finish_delivery(bigint,text,boolean,text,text),
 public.bot_whatsapp_complete_link(text,text),
 public.bot_whatsapp_unlink_sender(text),
 public.bot_whatsapp_command(text,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_save_whatsapp_bot_settings(boolean,boolean,text),
 public.admin_save_whatsapp_bot_group(text,boolean,boolean,boolean,boolean,boolean),
 public.admin_enqueue_whatsapp_bot_announcement(text,text,text),
 public.create_my_whatsapp_link_code(),
 public.get_my_whatsapp_link_status(),
 public.unlink_my_whatsapp_account() TO authenticated;
GRANT EXECUTE ON FUNCTION public.bot_whatsapp_report_status(boolean,boolean,text,text,text),
 public.bot_whatsapp_discover_group(text,text),
 public.bot_whatsapp_claim_deliveries(integer),
 public.bot_whatsapp_finish_delivery(bigint,text,boolean,text,text),
 public.bot_whatsapp_complete_link(text,text),
 public.bot_whatsapp_unlink_sender(text),
 public.bot_whatsapp_command(text,text) TO service_role;

-- Outbox on actual platform data, no backfill and no notifications until opt-in.
CREATE OR REPLACE FUNCTION private.whatsapp_bot_outbox_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_kind text;v_event text;v_title text;v_message text;v_url text;v_source text;
BEGIN
 v_source:=NEW.id::text;
 IF TG_TABLE_NAME='news_articles' AND TG_OP='INSERT' THEN
  v_kind:='news';v_event:='news';
  v_title:=left(coalesce(NEW.title,'Notícia do GOVRP'),160);
  v_message:=left(regexp_replace(coalesce(NEW.content,''),'<[^>]*>',' ','g'),500);
  v_url:='https://govrp.vercel.app/news/'||v_source;
 ELSIF TG_TABLE_NAME='parliament_voting_schedules' THEN
  IF TG_OP='INSERT' THEN
   v_kind:='votings';v_event:='scheduled';v_title:='Votação agendada';
   v_message:=left(NEW.title,200)||E'\nInício: '||to_char(NEW.starts_at AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI')||E'\nTérmino: '||to_char(NEW.ends_at AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI');
  ELSIF NEW.status IN ('cancelled','canceled') AND OLD.status IS DISTINCT FROM NEW.status THEN
   v_kind:='votings';v_event:='cancelled';v_title:='Votação cancelada';v_message:=left(NEW.title,250);
  ELSE RETURN NEW;END IF;
  v_url:='https://govrp.vercel.app/services/parliament';
 ELSIF TG_TABLE_NAME='parliament_votings' THEN
  IF NEW.status='active' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
   v_kind:='votings';v_event:='active';v_title:='Votação parlamentar iniciada';
  ELSIF TG_OP='UPDATE' AND NEW.status='closed' AND OLD.status IS DISTINCT FROM NEW.status THEN
   v_kind:='votings';v_event:='closed';v_title:='Votação parlamentar encerrada';
  ELSE RETURN NEW;END IF;
  v_message:=left(NEW.title,240);v_url:='https://govrp.vercel.app/services/parliament';
 ELSIF TG_TABLE_NAME='elections' AND TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
  IF NEW.status NOT IN ('Candidacy','Voting','Finished') THEN RETURN NEW; END IF;
  v_kind:='elections';v_event:=NEW.status;v_title:='Eleições: '||NEW.status;
  v_message:=left(NEW.name,240);v_url:='https://govrp.vercel.app/services/elections';
 ELSIF TG_TABLE_NAME='decrees' AND (TG_OP='INSERT' OR TG_OP='UPDATE') THEN
  IF NOT NEW.is_published OR (TG_OP='UPDATE' AND coalesce(OLD.is_published,false)) THEN RETURN NEW; END IF;
  v_kind:='government';v_event:='published';v_title:='Novo decreto publicado';v_message:=left(NEW.title,240);
  v_url:='https://govrp.vercel.app/';
 ELSIF TG_TABLE_NAME='bills' AND TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
  IF NEW.status NOT IN ('Sancionado','Promulgado','Vigente') THEN RETURN NEW; END IF;
  v_kind:='government';v_event:='law_'||NEW.status;v_title:='Lei aprovada e publicada';v_message:=left(NEW.title,240);
  v_url:='https://govrp.vercel.app/services/parliament';
 ELSE RETURN NEW;END IF;
 INSERT INTO public.whatsapp_bot_events(event_kind,source_table,source_id,title,message,url)
 VALUES(v_kind,TG_TABLE_NAME,v_source||':'||v_event,v_title,coalesce(v_message,''),v_url)
 ON CONFLICT(event_kind,source_table,source_id) DO NOTHING;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.whatsapp_bot_outbox_trigger() FROM PUBLIC,anon,authenticated;

CREATE TRIGGER whatsapp_news_outbox AFTER INSERT ON public.news_articles FOR EACH ROW EXECUTE FUNCTION private.whatsapp_bot_outbox_trigger();
CREATE TRIGGER whatsapp_voting_schedule_outbox AFTER INSERT OR UPDATE OF status ON public.parliament_voting_schedules FOR EACH ROW EXECUTE FUNCTION private.whatsapp_bot_outbox_trigger();
CREATE TRIGGER whatsapp_voting_outbox AFTER INSERT OR UPDATE OF status ON public.parliament_votings FOR EACH ROW EXECUTE FUNCTION private.whatsapp_bot_outbox_trigger();
CREATE TRIGGER whatsapp_election_outbox AFTER UPDATE OF status ON public.elections FOR EACH ROW EXECUTE FUNCTION private.whatsapp_bot_outbox_trigger();
CREATE TRIGGER whatsapp_decree_outbox AFTER INSERT OR UPDATE OF is_published ON public.decrees FOR EACH ROW EXECUTE FUNCTION private.whatsapp_bot_outbox_trigger();
CREATE TRIGGER whatsapp_bill_outbox AFTER UPDATE OF status ON public.bills FOR EACH ROW EXECUTE FUNCTION private.whatsapp_bot_outbox_trigger();

COMMIT;
