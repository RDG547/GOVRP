BEGIN;
-- Prospective cutover leaves all legacy rows and balances untouched. Old
-- incomplete periods require separate review, without freezing future cycles.
CREATE TABLE economy_private.period_transition_policy(
 id boolean PRIMARY KEY DEFAULT true CHECK(id),month_from timestamptz NOT NULL,
 quarter_from timestamptz NOT NULL,year_from timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO economy_private.period_transition_policy(id,month_from,quarter_from,year_from)
 SELECT true,(date_trunc('month',public.rp_now() AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC',
 (date_trunc('quarter',public.rp_now() AT TIME ZONE 'UTC')+interval '3 months') AT TIME ZONE 'UTC',
 (date_trunc('year',public.rp_now() AT TIME ZONE 'UTC')+interval '1 year') AT TIME ZONE 'UTC';
ALTER TABLE economy_private.period_transition_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON economy_private.period_transition_policy FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION economy_private.period_close_readiness(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.economic_periods%rowtype; canonical record; child_type text;
 expected_count integer; child_count integer; closed_count integer; valid_count integer; captured_count integer; cutover timestamptz;
BEGIN
 SELECT * INTO p FROM public.economic_periods WHERE id=p_id;
 IF p.id IS NULL THEN RAISE EXCEPTION 'Período econômico inexistente.';END IF;
 IF p.status='closed' THEN RETURN jsonb_build_object('status','already_closed','period_id',p_id);END IF;
 SELECT * INTO canonical FROM economy_private.period_bounds(p.period_type,
   make_timestamptz(p.rp_year,CASE p.period_type WHEN 'month' THEN p.rp_month WHEN 'quarter' THEN (p.rp_quarter-1)*3+1 ELSE 1 END,1,0,0,0,'UTC'));
 IF p.starts_at_rp IS DISTINCT FROM canonical.starts_at_rp OR p.ends_at_rp IS DISTINCT FROM canonical.ends_at_rp
  OR p.starts_at IS DISTINCT FROM public.rp_date_to_real_date(canonical.starts_at_rp)
  OR p.ends_at IS DISTINCT FROM public.rp_date_to_real_date(canonical.ends_at_rp) THEN
  RETURN jsonb_build_object('status','blocked_legacy_bounds','period_id',p_id,'requires_review',true);
 END IF;
 SELECT CASE p.period_type WHEN 'month' THEN month_from WHEN 'quarter' THEN quarter_from ELSE year_from END
 INTO cutover FROM economy_private.period_transition_policy WHERE id=true;
 IF p.starts_at_rp<cutover THEN RETURN jsonb_build_object('status','blocked_transition','period_id',p.id,
  'prospective_from_rp',cutover,'requires_review',true);END IF;
 -- p_force may request a retry; it must never close a future period.
 IF statement_timestamp()<p.ends_at THEN RETURN jsonb_build_object('status','not_due','period_id',p_id);END IF;
 IF EXISTS(SELECT 1 FROM public.economic_periods x WHERE x.period_type=p.period_type
  AND x.starts_at_rp<p.starts_at_rp AND x.starts_at_rp>=cutover AND x.status<>'closed') THEN
  RETURN jsonb_build_object('status','blocked_previous_period','period_id',p_id);
 END IF;
 IF p.period_type IN ('quarter','year') THEN
  child_type:=CASE p.period_type WHEN 'quarter' THEN 'month' ELSE 'quarter' END;
  expected_count:=CASE p.period_type WHEN 'quarter' THEN 3 ELSE 4 END;
  SELECT count(*),count(*) FILTER(WHERE c.status='closed'),
   count(*) FILTER(WHERE c.starts_at_rp=b.starts_at_rp AND c.ends_at_rp=b.ends_at_rp
    AND c.starts_at=public.rp_date_to_real_date(b.starts_at_rp)
    AND c.ends_at=public.rp_date_to_real_date(b.ends_at_rp))
  INTO child_count,closed_count,valid_count
  FROM public.economic_periods c
  CROSS JOIN LATERAL economy_private.period_bounds(child_type,c.starts_at_rp) b
  WHERE c.period_type=child_type AND c.starts_at_rp>=p.starts_at_rp AND c.starts_at_rp<p.ends_at_rp;
  IF child_count<>expected_count OR closed_count<>expected_count OR valid_count<>expected_count THEN
   RETURN jsonb_build_object('status','blocked_children','period_id',p_id,'expected',expected_count,
    'children',child_count,'closed_children',closed_count,'valid_children',valid_count);
  END IF;
  SELECT count(*) INTO captured_count FROM public.economic_periods c
   JOIN economy_private.period_input_manifests m ON m.period_id=c.id
   WHERE c.period_type=child_type AND c.status='closed'
    AND c.starts_at_rp>=p.starts_at_rp AND c.ends_at_rp<=p.ends_at_rp;
  IF captured_count<>expected_count THEN
   RETURN jsonb_build_object('status','blocked_legacy_inputs','period_id',p_id,
    'expected',expected_count,'captured_children',captured_count,'requires_review',true);
  END IF;
 END IF;
 RETURN jsonb_build_object('status','ready','period_id',p_id);
END $$;

-- Read-only impact report. It does not approve or apply historical revisions.
CREATE OR REPLACE FUNCTION public.get_economic_period_review(p_period_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.economic_periods%rowtype; b record; report jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(public.economic_has_role(ARRAY['Admin']),false) THEN
  RAISE EXCEPTION 'Revisão restrita à Administração.' USING errcode='42501';
 END IF;
 SELECT * INTO p FROM public.economic_periods WHERE id=p_period_id;
 IF p.id IS NULL THEN RAISE EXCEPTION 'Período econômico inexistente.' USING errcode='22023';END IF;
 SELECT * INTO b FROM economy_private.period_bounds(p.period_type,
  make_timestamptz(p.rp_year,CASE p.period_type WHEN 'month' THEN p.rp_month
   WHEN 'quarter' THEN (p.rp_quarter-1)*3+1 ELSE 1 END,1,0,0,0,'UTC'));
 WITH windows AS (
  SELECT 'stored' kind,p.starts_at_rp starts_at,p.ends_at_rp ends_at
  UNION ALL SELECT 'canonical',b.starts_at_rp,b.ends_at_rp
 ), aggregates AS (
  SELECT w.kind,count(e.id) event_count,
   coalesce(sum(CASE e.economic_classification WHEN 'gross_output' THEN e.economic_amount
    WHEN 'intermediate_consumption' THEN -e.economic_amount WHEN 'product_tax' THEN e.economic_amount
    WHEN 'subsidy' THEN -e.economic_amount ELSE 0 END),0) production_gdp,
   max(e.created_at) latest_event_recorded_at
  FROM windows w LEFT JOIN public.economic_events e ON e.occurred_at_rp>=w.starts_at AND e.occurred_at_rp<w.ends_at
  GROUP BY w.kind
 ) SELECT jsonb_object_agg(kind,to_jsonb(a)-'kind') INTO report FROM aggregates a;
 RETURN jsonb_build_object('period',to_jsonb(p),'readiness',economy_private.period_close_readiness(p.id),
  'reviewed_at',statement_timestamp(),'read_only',true,'requires_specific_approval',true,
  'prospective_policy',(SELECT to_jsonb(t) FROM economy_private.period_transition_policy t WHERE id=true),
  'stored_bounds',jsonb_build_object('rp_start',p.starts_at_rp,'rp_end',p.ends_at_rp,'real_start',p.starts_at,'real_end',p.ends_at),
  'canonical_bounds',jsonb_build_object('rp_start',b.starts_at_rp,'rp_end',b.ends_at_rp,
   'real_start',public.rp_date_to_real_date(b.starts_at_rp),'real_end',public.rp_date_to_real_date(b.ends_at_rp)),
  'ledger_comparison',report,
  'published_gdp',(SELECT nominal_value FROM public.economic_indicators WHERE period_id=p.id AND indicator_code='gdp_nominal'),
  'captured_events',(SELECT count(*) FROM economy_private.period_event_inputs WHERE period_id=p.id),
  'has_manifest',EXISTS(SELECT 1 FROM economy_private.period_input_manifests WHERE period_id=p.id),
  'pending_revisions',(SELECT count(*) FROM economy_private.period_revision_queue WHERE period_id=p.id AND status='pending'),
  'children',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'period_type',c.period_type,
    'rp_year',c.rp_year,'rp_month',c.rp_month,'rp_quarter',c.rp_quarter,'status',c.status,
    'has_manifest',EXISTS(SELECT 1 FROM economy_private.period_input_manifests m WHERE m.period_id=c.id)) ORDER BY c.starts_at_rp),'[]')
   FROM public.economic_periods c WHERE c.period_type=CASE p.period_type WHEN 'quarter' THEN 'month' WHEN 'year' THEN 'quarter' ELSE '' END
    AND c.starts_at_rp>=b.starts_at_rp AND c.starts_at_rp<b.ends_at_rp),
  'next_step',CASE WHEN p.status='closed' THEN 'review_published_revision'
   WHEN p.starts_at_rp IS DISTINCT FROM b.starts_at_rp OR p.ends_at_rp IS DISTINCT FROM b.ends_at_rp
    OR p.starts_at IS DISTINCT FROM public.rp_date_to_real_date(b.starts_at_rp)
    OR p.ends_at IS DISTINCT FROM public.rp_date_to_real_date(b.ends_at_rp) THEN 'review_open_bounds'
   ELSE 'review_dependencies' END,
  'warning','A soma atual dos eventos não reconstrói, sozinha, a informação disponível no fechamento original. Nenhuma revisão foi aplicada.');
END $$;
REVOKE ALL ON FUNCTION public.get_economic_period_review(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_economic_period_review(uuid) TO authenticated;

COMMIT;
