-- Separate simulated macroeconomic public debt from actual government bank credit.
-- Never change historical fiscal_periods/economic_state or treasury_balance.
BEGIN;

DO $quarter_correction$
DECLARE
  function_sql text;
  target text := E'  update public.government_finances\n  set loans_balance=new_debt,updated_at=now()\n  where id=1;';
  corrected text := E'  -- The macroeconomic public debt is held in economic_state.public_debt.\n  -- It must NOT overwrite the separate government bank loan balance.';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO function_sql
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='economy_private' AND p.proname='close_quarter'
    AND pg_get_function_identity_arguments(p.oid)='p_period_id uuid, p_force boolean, p_initiated_by uuid';
  IF function_sql IS NULL THEN
    RAISE EXCEPTION 'Quarter close function not found; no financial changes applied';
  END IF;
  IF length(function_sql)-length(replace(function_sql,target,'')) <> length(target) THEN
    RAISE EXCEPTION 'Quarter-close update did not match exactly once; refusing migration';
  END IF;
  EXECUTE replace(function_sql,target,corrected);
END;
$quarter_correction$;

-- A formerly shared numeric column was overwritten on each quarter close.
-- Reclassify ONLY when the old value matches the fiscal debt, down to the cent.
-- Keep its full former value in the permanent audit log for reconciliation.
DO $reconcile_legacy$
DECLARE
  previous_balance numeric;
  macro_debt numeric;
BEGIN
  SELECT loans_balance INTO previous_balance
  FROM public.government_finances WHERE id=1 FOR UPDATE;
  SELECT public_debt INTO macro_debt FROM public.economic_state WHERE id=true;

  IF previous_balance IS NULL OR macro_debt IS NULL OR previous_balance < 0 THEN
    RAISE EXCEPTION 'Missing balances; cannot reconcile government loan debt';
  END IF;
  IF abs(previous_balance-macro_debt)>=0.01 THEN
    RAISE EXCEPTION 'Government loan balance differs from macro fiscal debt; needs manual reconciliation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.economic_audit_log
    WHERE action='government_loan_contracted'
  ) THEN
    RAISE EXCEPTION 'Existing government bank credit audit found; manual reconciliation required';
  END IF;

  IF previous_balance > 0 THEN
    PERFORM economy_private.audit(
      'government_loan_balance_reclassified',
      'government_finances','1',
      jsonb_build_object('old_loans_balance',previous_balance),
      jsonb_build_object('verified_bank_credit_balance',0,'fiscal_debt_preserved',macro_debt,'historical_loans_not_independently_auditable',true),
      'O fechamento trimestral gravou deficits e juros simulados no saldo de emprestimos bancarios. Reclassificacao auditavel, sem perdao da divida publica ou movimento do cofre.',
      NULL
    );
    UPDATE public.government_finances
    SET loans_balance=0,updated_at=clock_timestamp()
    WHERE id=1;
  END IF;
END;
$reconcile_legacy$;

-- Preserve established loan pricing, amount and repayment schedule interface.
-- Only current President/acting President or platform Admin can draw credit.
-- Every new disbursement is auditable and cannot overrun the credit ceiling
-- including contractual interest.
CREATE OR REPLACE FUNCTION public.government_take_loan(
  p_amount numeric, p_installments integer DEFAULT 12
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $loan_contract$
DECLARE
  v_actor uuid := auth.uid();
  v_finance public.government_finances%rowtype;
  v_policy jsonb;
  v_rate numeric(8,4);
  v_principal numeric(14,2);
  v_total numeric(14,2);
  v_available numeric(14,2);
BEGIN
  IF v_actor IS NULL OR coalesce(public.get_authority_role(v_actor),'') NOT IN ('Presidente','Admin') THEN
    RAISE EXCEPTION 'Apenas a Presidencia ou o administrador podem contratar emprestimos governamentais.' USING ERRCODE='42501';
  END IF;
  IF p_amount IS NULL OR p_amount::text='NaN' OR p_amount<=0 THEN
    RETURN jsonb_build_object('success',false,'message','Valor de empréstimo inválido.');
  END IF;
  IF p_installments IS NULL OR p_installments<1 THEN
    RETURN jsonb_build_object('success',false,'message','Informe ao menos uma parcela.');
  END IF;

  v_principal := round(p_amount,2);
  IF v_principal<=0 THEN
    RETURN jsonb_build_object('success',false,'message','O empréstimo deve ter ao menos R$ 0,01.');
  END IF;
  SELECT * INTO v_finance FROM public.government_finances WHERE id=1 FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'message','Finanças do Governo não encontradas.');
  END IF;
  v_policy := public.get_bank_policy();
  v_rate := coalesce((v_policy->>'government_debt_interest_rate')::numeric,1.75);
  v_total := round(v_principal*(1+v_rate/100),2);
  v_available := greatest(0,coalesce(v_finance.loan_limit,0)-coalesce(v_finance.loans_balance,0));
  IF v_total>v_available THEN
    RETURN jsonb_build_object('success',false,'message','Valor total com juros excede a margem de crédito do Governo.');
  END IF;

  UPDATE public.government_finances
  SET treasury_balance=coalesce(treasury_balance,0)+v_principal,
      loans_balance=coalesce(loans_balance,0)+v_total,
      updated_at=clock_timestamp()
  WHERE id=1;

  PERFORM economy_private.audit(
    'government_loan_contracted','government_finances','1',
    jsonb_build_object('treasury_balance',v_finance.treasury_balance,'bank_credit_balance',v_finance.loans_balance),
    jsonb_build_object('treasury_balance',v_finance.treasury_balance+v_principal,'bank_credit_balance',v_finance.loans_balance+v_total,
      'principal',v_principal,'total_due',v_total,'interest_rate_percent',v_rate,'installments',p_installments),
    'Empréstimo contratado pelo Governo junto ao Banco Nacional.',v_actor
  );
  RETURN jsonb_build_object(
    'success',true,'message','Empréstimo governamental contratado com juros do Banco Nacional.',
    'amount',v_principal,'interest_rate',v_rate,'installments',p_installments,'total_due',v_total
  );
END;
$loan_contract$;

REVOKE ALL ON FUNCTION public.government_take_loan(numeric,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.government_take_loan(numeric,integer) TO authenticated;

COMMIT;
