-- GOVRP: population purchases in the National Market pay legal consumption levies,
-- just like purchases from citizen-owned companies. No synthetic currency is created.
BEGIN;
DO $patch$
DECLARE
 f text;
 old_text text;
 new_text text;
BEGIN
 SELECT pg_get_functiondef('private.consume_national_market(date,numeric)'::regprocedure) INTO f;
 IF strpos(f,'q jsonb;')>0 THEN
   RAISE EXCEPTION 'Consumo do mercado nacional já foi alterado; revisar antes de aplicar novamente.';
 END IF;
 old_text:=$old$buyer public.accounts%rowtype;$old$;
 new_text:=$new$buyer public.accounts%rowtype;q jsonb;total_debit numeric;net_credit numeric;taxes numeric;v_tx uuid;$new$;
 IF strpos(f,old_text)=0 THEN RAISE EXCEPTION 'Assinatura de consumo nacional divergente.';END IF;
 f:=replace(f,old_text,new_text);

 old_text:=$old$IF qty<=0 OR amount<=0 THEN CONTINUE;END IF;$old$;
 new_text:=$new$IF qty<=0 OR amount<=0 THEN CONTINUE;END IF;
  -- Tax and fees use the same live legislative rules as an ordinary checkout.
  q:=public.quote_legal_levies('purchase',amount,true,null,row.resource_code,null,null);
  IF coalesce((q->>'restricted')::boolean,false) THEN CONTINUE;END IF;
  total_debit:=(q->>'total_debited')::numeric;
  net_credit:=(q->>'net_amount')::numeric;
  taxes:=round(greatest(0,total_debit-net_credit),2);
  IF total_debit<=0 OR net_credit<0 OR spent+total_debit>p_budget OR total_debit>buyer.balance-spent THEN CONTINUE;END IF;$new$;
 IF strpos(f,old_text)=0 THEN RAISE EXCEPTION 'Validação de quantidade do mercado nacional divergente.';END IF;
 f:=replace(f,old_text,new_text);
 old_text:=$old$UPDATE public.accounts SET balance=balance-amount,updated_at=clock_timestamp() WHERE id=buyer.id;$old$;
 new_text:=$new$UPDATE public.accounts SET balance=balance-total_debit,updated_at=clock_timestamp() WHERE id=buyer.id;$new$;
 IF strpos(f,old_text)=0 THEN RAISE EXCEPTION 'Débito da população divergente.';END IF;
 f:=replace(f,old_text,new_text);
 old_text:=$old$UPDATE public.accounts SET balance=balance+amount,updated_at=clock_timestamp() WHERE id=market;$old$;
 new_text:=$new$UPDATE public.accounts SET balance=balance+net_credit,updated_at=clock_timestamp() WHERE id=market;$new$;
 IF strpos(f,old_text)=0 THEN RAISE EXCEPTION 'Crédito ao mercado divergente.';END IF;
 f:=replace(f,old_text,new_text);
 old_text:=$old$jsonb_build_object('resource_code',row.resource_code,'quantity',qty,'operation_date',p_day,'national_market',true,'final_consumption',true),md5('national-consumption:'||p_day||':'||row.resource_code)::uuid);$old$;
 new_text:=$new$q||jsonb_build_object('resource_code',row.resource_code,'quantity',qty,'operation_date',p_day,'national_market',true,'final_consumption',true),md5('national-consumption:'||p_day||':'||row.resource_code)::uuid)
  RETURNING id INTO v_tx;$new$;
 IF strpos(f,old_text)=0 THEN RAISE EXCEPTION 'Lançamento de compra no Mercado Nacional divergente.';END IF;
 f:=replace(f,old_text,new_text);
 old_text:=$old$spent:=spent+amount;$old$;
 new_text:=$new$IF taxes>0 THEN
    UPDATE public.government_finances
    SET treasury_balance=treasury_balance+taxes,updated_at=clock_timestamp()
    WHERE id=1;
    INSERT INTO public.government_revenues(revenue_type,source_table,source_id,amount,occurred_at_rp,metadata)
    VALUES('consumption_tax','transactions',v_tx::text,taxes,public.rp_now(),
      q||jsonb_build_object('market_channel','national_market','simulated_households',true,'resource_code',row.resource_code));
  END IF;
  spent:=spent+total_debit;$new$;
 IF strpos(f,old_text)=0 THEN RAISE EXCEPTION 'Acumulação de demanda nacional divergente.';END IF;
 f:=replace(f,old_text,new_text);
 EXECUTE f;
END $patch$;
COMMIT;