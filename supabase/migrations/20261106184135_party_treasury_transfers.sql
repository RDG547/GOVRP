BEGIN;
ALTER TABLE public.party_treasury_entries DROP CONSTRAINT party_treasury_entries_kind_check;
ALTER TABLE public.party_treasury_entries DROP CONSTRAINT party_treasury_entries_amount_check;
ALTER TABLE public.party_treasury_entries DROP CONSTRAINT IF EXISTS party_treasury_entries_kind_check;
ALTER TABLE public.party_treasury_entries ADD CONSTRAINT party_treasury_entries_kind_check CHECK(kind IN('donation','judicial_fine','judicial_refund','transfer'));
ALTER TABLE public.party_treasury_entries DROP CONSTRAINT IF EXISTS party_treasury_entries_amount_check;
ALTER TABLE public.party_treasury_entries ADD CONSTRAINT party_treasury_entries_amount_check CHECK((kind IN('judicial_fine','transfer') AND amount<0) OR (kind IN('donation','judicial_refund') AND amount>0));

CREATE OR REPLACE FUNCTION public.transfer_party_funds(p_party_id uuid,p_recipient_id uuid,p_amount numeric,p_reason text,p_idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE party public.political_parties%rowtype;fund public.party_treasuries%rowtype;a public.accounts%rowtype;t public.transactions%rowtype;q jsonb;debited numeric;received numeric;actor uuid:=auth.uid();BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Entre para movimentar o caixa partidário.' USING errcode='42501';END IF;
 PERFORM public.assert_admin_real_action(actor);
 IF p_amount IS NULL OR p_amount::text IN('NaN','Infinity','-Infinity') OR p_amount<=0 OR p_amount>1000000000 OR round(p_amount,2)<>p_amount OR p_idempotency_key IS NULL OR length(btrim(coalesce(p_reason,'')))<5 OR length(p_reason)>500 THEN RAISE EXCEPTION 'Informe valor positivo, destinatário e uma justificativa de 5 a 500 caracteres.';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
 SELECT * INTO t FROM public.transactions WHERE idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF t.type<>'party_transfer' OR t.metadata->>'party_id' IS DISTINCT FROM p_party_id::text OR t.metadata->>'actor_id' IS DISTINCT FROM actor::text OR t.metadata->>'recipient_id' IS DISTINCT FROM p_recipient_id::text OR (t.metadata->>'requested_amount')::numeric<>p_amount OR t.metadata->>'reason' IS DISTINCT FROM btrim(p_reason) THEN RAISE EXCEPTION 'Este identificador já pertence a outra operação.';END IF;
  RETURN jsonb_build_object('success',true,'transaction_id',t.id,'snapshot',t.metadata);
 END IF;
 SELECT * INTO party FROM public.political_parties WHERE id=p_party_id FOR UPDATE;
 IF party.id IS NULL OR (actor IS DISTINCT FROM coalesce(party.owner_id,party.founder_id) AND actor IS DISTINCT FROM party.president_id AND NOT public.has_full_admin_access()) THEN RAISE EXCEPTION 'Somente o dono, presidente do partido ou a administração autorizada pode transferir.' USING errcode='42501';END IF;
 IF NOT party.is_active OR party.status='Encerrado' THEN RAISE EXCEPTION 'O partido precisa estar ativo.';END IF;
 SELECT * INTO fund FROM public.party_treasuries WHERE party_id=party.id FOR UPDATE;
 SELECT * INTO a FROM public.accounts WHERE user_id=p_recipient_id AND account_kind='personal' FOR UPDATE;
 IF a.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_recipient_id AND deleted_at IS NULL AND onboarding_completed) THEN RAISE EXCEPTION 'O destinatário precisa ter cidadania e conta ativa.';END IF;
 q:=public.quote_legal_levies('transfer',p_amount,false);
 IF coalesce((q->>'restricted')::boolean,false) THEN RAISE EXCEPTION 'A transferência está restrita por norma vigente.';END IF;
 debited:=(q->>'total_debited')::numeric;received:=(q->>'net_amount')::numeric;
 IF fund.balance IS NULL OR fund.balance<debited THEN RAISE EXCEPTION 'Saldo partidário insuficiente para o valor e os tributos.';END IF;
 UPDATE public.party_treasuries SET balance=balance-debited,updated_at=clock_timestamp() WHERE party_id=party.id RETURNING * INTO fund;
 UPDATE public.accounts SET balance=balance+received,updated_at=clock_timestamp() WHERE id=a.id;
 UPDATE public.government_finances SET treasury_balance=treasury_balance+debited-received,updated_at=clock_timestamp() WHERE id=1;
 INSERT INTO public.transactions(to_account_id,amount,type,description,metadata,idempotency_key)
 VALUES(a.id,p_amount,'party_transfer','Transferência do partido '||party.acronym,q||jsonb_build_object('party_id',party.id,'actor_id',actor,'recipient_id',p_recipient_id,'requested_amount',p_amount,'reason',btrim(p_reason)),p_idempotency_key) RETURNING * INTO t;
 INSERT INTO public.party_treasury_entries(party_id,transaction_id,actor_id,kind,amount,balance_after,description,donor_snapshot,idempotency_key)
 SELECT party.id,t.id,actor,'transfer',-debited,fund.balance,'Transferência para '||p.full_name||': '||btrim(p_reason),jsonb_build_object('id',p.id,'full_name',p.full_name,'avatar_url',p.avatar_url,'direction','outgoing','actor_id',actor),p_idempotency_key FROM public.profiles p WHERE p.id=p_recipient_id;
 IF debited>received THEN INSERT INTO public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,amount,occurred_at_rp,metadata) VALUES('financial','transactions',t.id::text,actor,debited-received,public.rp_now(),q);END IF;
 PERFORM economy_private.audit('party_funds_transferred','political_parties',party.id::text,NULL,jsonb_build_object('transaction_id',t.id,'recipient_id',p_recipient_id,'amount',p_amount),p_reason,actor);
 RETURN jsonb_build_object('success',true,'transaction_id',t.id,'snapshot',t.metadata,'balance',fund.balance);
END $$;
REVOKE ALL ON FUNCTION public.transfer_party_funds(uuid,uuid,numeric,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transfer_party_funds(uuid,uuid,numeric,text,uuid) TO authenticated;
COMMIT;
