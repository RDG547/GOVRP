BEGIN;
-- Prospective competence convention. Daily operating expenses are allocated
-- over their Sao Paulo civil day, intersected with canonical RP months.
-- Settlement timestamps and all existing events remain unchanged.
CREATE OR REPLACE FUNCTION economy_private.daily_accrual_parts(p_day date,p_amount numeric)
RETURNS TABLE(part_key text,amount numeric,real_at timestamptz,rp_at timestamptz,
 real_start timestamptz,real_end timestamptz,rp_start timestamptz,rp_end timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE day_start timestamptz; day_end timestamptz; first_rp timestamptz; last_rp timestamptz;
 month_start timestamptz; total numeric:=round(abs(p_amount),2); remaining numeric:=round(abs(p_amount),2);
BEGIN
 IF p_day IS NULL OR p_amount IS NULL OR p_amount::text IN ('NaN','Infinity','-Infinity') THEN
  RAISE EXCEPTION 'Competência e valor finito são obrigatórios.';
 END IF;
 day_start:=p_day::timestamp AT TIME ZONE 'America/Sao_Paulo';
 day_end:=(p_day+1)::timestamp AT TIME ZONE 'America/Sao_Paulo';
 first_rp:=public.real_date_to_rp_date(day_start); last_rp:=public.real_date_to_rp_date(day_end);
 IF last_rp<first_rp THEN RAISE EXCEPTION 'Conversão RP não monotônica.';END IF;
 IF last_rp=first_rp THEN
  part_key:=to_char(first_rp,'YYYY-MM');amount:=total;real_at:=day_start;rp_at:=first_rp;
  real_start:=day_start;real_end:=day_end;rp_start:=first_rp;rp_end:=last_rp;RETURN NEXT;RETURN;
 END IF;
 month_start:=date_trunc('month',first_rp);
 WHILE month_start<last_rp LOOP
  rp_start:=greatest(first_rp,month_start);rp_end:=least(last_rp,month_start+interval '1 month');
  -- Linear overlap in RP time is deliberate: this is an accrual allocation,
  -- not an attempt to fabricate past settlement timestamps.
  real_start:=day_start+(day_end-day_start)*(extract(epoch FROM rp_start-first_rp)/extract(epoch FROM last_rp-first_rp))::double precision;
  real_end:=day_start+(day_end-day_start)*(extract(epoch FROM rp_end-first_rp)/extract(epoch FROM last_rp-first_rp))::double precision;
  amount:=CASE WHEN rp_end=last_rp THEN remaining ELSE least(remaining,round(total*extract(epoch FROM rp_end-rp_start)/extract(epoch FROM last_rp-first_rp),2)) END;
  remaining:=remaining-amount;part_key:=to_char(month_start,'YYYY-MM');
  rp_at:=rp_start+(rp_end-rp_start)/2;real_at:=real_start+(real_end-real_start)/2;
  IF amount>0 THEN RETURN NEXT;END IF;
  month_start:=month_start+interval '1 month';
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION economy_private.daily_accrual_parts(date,numeric) FROM PUBLIC,anon,authenticated;

ALTER TABLE public.business_transactions ALTER COLUMN accounting_date
 SET DEFAULT ((statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date);
CREATE OR REPLACE FUNCTION economy_private.on_business_transaction_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  business_row public.businesses%rowtype;
  classification text;
  event_type text;
  part record; is_daily boolean; common_weight numeric:=1; representativity numeric; cap numeric;
begin
  select * into business_row
  from public.businesses
  where id = new.business_id;

  classification := case when new.metadata->>'kind'='payroll_accrual' then 'compensation' else case lower(new.type)
    when 'revenue' then 'gross_output'
    when 'expense' then 'intermediate_consumption'
    when 'monthly_cost' then 'intermediate_consumption'
    when 'tax' then 'income_tax'
    when 'registration' then 'capital_transfer'
    else 'not_in_gdp'
  end end;

  event_type := case classification
    when 'gross_output' then 'business_gross_output'
    when 'intermediate_consumption' then 'business_intermediate_consumption'
    else 'business_' || lower(new.type)
  end;

  is_daily:=new.metadata->>'kind' IN ('payroll_accrual','input_consumption','overhead');
  IF is_daily AND abs(new.amount)>0 THEN
   representativity:=greatest(0,economy_private.calibration_numeric('player_representativity_factor',1000));
   cap:=economy_private.calibration_numeric('baseline_annual_gdp',10000000000)/4
    *economy_private.calibration_numeric('max_event_share_quarter_gdp',.0025);
   IF representativity>0 THEN common_weight:=least(1,greatest(0,cap)/(abs(new.amount)*representativity));END IF;
  END IF;
  FOR part IN
   SELECT a.part_key,a.amount,a.real_at,a.rp_at,
    jsonb_build_object('accounting_basis','daily_accrual_rp_overlap','accounting_date',new.accounting_date,
      'recorded_at',new.created_at,'source_business_transaction_id',new.id,'real_start',a.real_start,
      'real_end',a.real_end,'rp_start',a.rp_start,'rp_end',a.rp_end) temporal_metadata
   FROM economy_private.daily_accrual_parts(new.accounting_date,new.amount) a WHERE is_daily
   UNION ALL SELECT NULL::text,abs(new.amount),new.created_at,public.real_date_to_rp_date(new.created_at),
    jsonb_build_object('accounting_basis','transaction_timestamp','accounting_date',new.accounting_date,'recorded_at',new.created_at)
   WHERE NOT coalesce(is_daily,false)
  LOOP
  perform economy_private.record_event(
    event_type,
    classification,
    'business_transactions',
    new.id::text||coalesce(':rp-month:'||part.part_key,''),
    part.amount,
    business_row.owner_id,
    new.business_id,
    null,
    coalesce(
      business_row.economic_sector_id,
      economy_private.resolve_sector(new.business_id, null, new.description)
    ),
    null,
    null,
    case when classification = 'income_tax' then part.amount else 0 end,
    0,
    part.real_at,
    part.rp_at,
    coalesce((business_row.control_kind='population' OR new.metadata->>'is_simulated'='true' OR new.metadata->>'kind'='population_sale' OR EXISTS(SELECT 1 FROM public.transactions tx WHERE tx.id=CASE WHEN new.metadata->>'transaction_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (new.metadata->>'transaction_id')::uuid END AND (tx.type='population_purchase' OR tx.metadata->>'is_simulated'='true'))),false),
    common_weight,
    coalesce(new.metadata,'{}')||jsonb_build_object('business_transaction_type', new.type)||part.temporal_metadata,
    'business_transaction:' || new.id::text||coalesce(':rp-month:'||part.part_key,'')
  );
  END LOOP;

  return new;
end;
$function$;

COMMIT;
