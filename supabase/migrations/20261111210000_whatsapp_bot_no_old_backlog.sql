-- Follow-up production hotfix for the claimed delivery RPC: RETURNS TABLE introduces event_id output variable.
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
   AND e.created_at >= greatest(g.updated_at,(SELECT updated_at FROM public.whatsapp_bot_settings WHERE id=true))
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
  ON CONFLICT ON CONSTRAINT whatsapp_bot_deliveries_pkey DO UPDATE SET status='sending',attempts=whatsapp_bot_deliveries.attempts+1,updated_at=now(),last_error=null
   WHERE whatsapp_bot_deliveries.status IN ('sending','error')
     AND whatsapp_bot_deliveries.attempts<3
     AND whatsapp_bot_deliveries.updated_at<now()-interval '2 minutes'
  RETURNING whatsapp_bot_deliveries.event_id,whatsapp_bot_deliveries.group_jid
 )
 SELECT c.event_id,c.group_jid,
  left('📢 *'||e.title||'*'||E'\n\n'||e.message||CASE WHEN e.url IS NOT NULL THEN E'\n\n🔗 '||e.url ELSE '' END,3500)
 FROM claimed c JOIN public.whatsapp_bot_events e ON e.id=c.event_id ORDER BY c.event_id;
END $fn$;
REVOKE ALL ON FUNCTION public.bot_whatsapp_claim_deliveries(integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.bot_whatsapp_claim_deliveries(integer) TO service_role;
