BEGIN;
-- Root cause: catalog alcoholic products used "social":8, while the
-- authoritative private.validate_citizen_product trigger requires "happiness":8.
-- Stock decrements triggered this validation and rolled back the entire purchase.

-- Repair only the three known official catalog rows. Preserve prices, inventory,
-- sales counters, user balances and prior transactions.
UPDATE public.products
SET consumable_effects=jsonb_build_object('thirst',15,'happiness',8,'health',-3)
WHERE id IN (
  'f2100000-0000-4000-8000-000000000021'::uuid,
  'f2100000-0000-4000-8000-000000000022'::uuid,
  'f2100000-0000-4000-8000-000000000023'::uuid
)
AND consumable_effects = '{"thirst":15,"social":8,"health":-3}'::jsonb;

-- The reset engine recreates the original invalid payload. Patch only that
-- literal inside its existing function, preserving every other reset behavior.
DO $fix_alcohol_reset$
DECLARE
  v_definition text;
  v_before text := $old$'{"thirst":15,"social":8,"health":-3}'::jsonb$old$;
  v_after text := $new$'{"thirst":15,"happiness":8,"health":-3}'::jsonb$new$;
BEGIN
  v_definition := pg_get_functiondef('private.seed_reset_world(uuid)'::regprocedure);
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Reset function not found; aborting alcohol catalog repair';
  END IF;
  IF strpos(v_definition,v_before)>0 THEN
    IF strpos(substring(v_definition FROM strpos(v_definition,v_before)+length(v_before)),v_before)>0 THEN
      RAISE EXCEPTION 'Ambiguous alcoholic product seed in reset function';
    END IF;
    EXECUTE replace(v_definition,v_before,v_after);
  ELSIF strpos(v_definition,v_after)=0 THEN
    RAISE EXCEPTION 'Unexpected alcoholic product seed; cannot safely patch reset';
  END IF;

  IF (SELECT count(*) FROM public.products
      WHERE id IN (
        'f2100000-0000-4000-8000-000000000021'::uuid,
        'f2100000-0000-4000-8000-000000000022'::uuid,
        'f2100000-0000-4000-8000-000000000023'::uuid)
      AND consumable_effects='{"thirst":15,"happiness":8,"health":-3}'::jsonb) <> 3
  THEN
    RAISE EXCEPTION 'Alcohol catalog is not aligned with citizen product validation';
  END IF;
END;
$fix_alcohol_reset$;
COMMIT;
