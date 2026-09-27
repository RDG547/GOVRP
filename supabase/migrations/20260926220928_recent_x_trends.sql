BEGIN;
CREATE INDEX IF NOT EXISTS posts_recent_trends_idx ON public.posts(created_at DESC) WHERE parent_post_id IS NULL;
CREATE OR REPLACE FUNCTION public.get_x_trends(p_window_hours integer DEFAULT 12)
RETURNS TABLE(hashtag text, post_count bigint, unique_authors bigint, score numeric)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre na sua conta para consultar as tendências.'; END IF;
  IF p_window_hours NOT IN (6,12,24) OR p_window_hours IS NULL THEN RAISE EXCEPTION 'Escolha uma janela de 6, 12 ou 24 horas.'; END IF;
  RETURN QUERY
  WITH tags AS (
    SELECT DISTINCT p.id,p.user_id,p.created_at,lower(m[1]) AS tag
    FROM public.posts p
    CROSS JOIN LATERAL regexp_matches(coalesce(p.content,'') || ' ' || coalesce(p.quote_content,''),'#([[:alnum:]_]{2,64})','g') m
    WHERE p.parent_post_id IS NULL AND p.created_at > now()-make_interval(hours=>p_window_hours)
      AND p.created_at <= now()
  ), authors AS (
    SELECT tag,user_id,count(*) AS publications,max(created_at) AS latest
    FROM tags GROUP BY tag,user_id
  )
  SELECT tag, sum(publications)::bigint, count(*)::bigint,
    sum((1 + 0.1 * least(publications-1,2)) * exp(-extract(epoch FROM now()-latest)/(p_window_hours*3600)))::numeric
  FROM authors GROUP BY tag ORDER BY 4 DESC,3 DESC,1 LIMIT 10;
END;
$$;
REVOKE ALL ON FUNCTION public.get_x_trends(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_x_trends(integer) TO authenticated;
COMMIT;
