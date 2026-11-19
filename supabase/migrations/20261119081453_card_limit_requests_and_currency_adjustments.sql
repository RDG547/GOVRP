-- Extend the existing application queue and account wallets; retain all financial history.
ALTER TABLE public.credit_card_applications
 ADD COLUMN application_kind text NOT NULL DEFAULT 'new_card' CHECK(application_kind IN('new_card','limit_increase')),
 ADD COLUMN card_id uuid REFERENCES public.cards(id) ON DELETE SET NULL,
 ADD COLUMN current_limit_snapshot numeric,
 ADD COLUMN justification text;
CREATE INDEX credit_application_card_idx ON public.credit_card_applications(card_id);
CREATE UNIQUE INDEX one_pending_card_limit_request ON public.credit_card_applications(card_id) WHERE application_kind='limit_increase' AND status='Pendente';
REVOKE INSERT,UPDATE,DELETE ON public.credit_card_applications FROM anon,authenticated;

CREATE FUNCTION private.notify_card_limit_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE reason text:=nullif(current_setting('govrp.card_limit_reason',true),'');changed_at timestamptz:=clock_timestamp();
BEGIN
 IF NEW.card_limit IS NOT DISTINCT FROM OLD.card_limit THEN RETURN NEW;END IF;
 IF NEW.card_limit IS NULL OR NEW.card_limit::text IN('NaN','Infinity','-Infinity') OR NEW.card_limit<0 OR NEW.card_limit>1000000000 THEN RAISE EXCEPTION 'Informe um limite válido entre zero e um bilhão de reais.';END IF;
 INSERT INTO public.notifications(user_id,type,content,link,metadata) VALUES(NEW.user_id,'bank_card_limit_changed',
 'O limite do seu cartão '||coalesce(NEW.brand,'')||' final '||right(NEW.card_number,4)||' mudou de '||public.format_currency_brl(OLD.card_limit)||' para '||public.format_currency_brl(NEW.card_limit)||'. Variação: '||public.format_currency_brl(NEW.card_limit-OLD.card_limit)||'. Em '||to_char(changed_at AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||'.'||CASE WHEN reason IS NOT NULL THEN ' Motivo: '||reason ELSE '' END,
 '/services/bank?tab=cards&card='||NEW.id,
 jsonb_build_object('card_id',NEW.id,'last_four',right(NEW.card_number,4),'old_limit',OLD.card_limit,'new_limit',NEW.card_limit,'difference',NEW.card_limit-OLD.card_limit,'changed_at',changed_at,'reason',reason));
 PERFORM economy_private.audit('bank_card_limit_changed','cards',NEW.id::text,jsonb_build_object('limit',OLD.card_limit),jsonb_build_object('limit',NEW.card_limit,'changed_at',changed_at),reason,auth.uid());
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.notify_card_limit_change() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER card_limit_notification AFTER UPDATE OF card_limit ON public.cards FOR EACH ROW EXECUTE FUNCTION private.notify_card_limit_change();

CREATE OR REPLACE FUNCTION public.set_bank_card_limit(p_card_id uuid,p_new_limit numeric,p_reason text DEFAULT NULL) RETURNS public.cards LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.cards%rowtype;
BEGIN
 IF auth.uid() IS NULL OR NOT public.user_can_manage_national_bank(auth.uid()) THEN RAISE EXCEPTION 'Somente a instituição financeira pode alterar limites.' USING errcode='42501';END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
 SELECT * INTO c FROM public.cards WHERE id=p_card_id FOR UPDATE;
 IF c.id IS NULL THEN RAISE EXCEPTION 'Cartão não encontrado.';END IF;
 IF p_new_limit IS NULL OR p_new_limit::text IN('NaN','Infinity','-Infinity') OR p_new_limit<greatest(coalesce(c.used_limit,0),0) OR p_new_limit>1000000000 THEN RAISE EXCEPTION 'O limite deve cobrir o valor utilizado e respeitar o máximo permitido.';END IF;
 PERFORM set_config('govrp.card_limit_reason',left(coalesce(p_reason,'Ajuste autorizado pela instituição financeira.'),1000),true);
 UPDATE public.cards SET card_limit=round(p_new_limit,2) WHERE id=c.id RETURNING * INTO c;
 RETURN c;
END $$;
CREATE OR REPLACE FUNCTION public.set_credit_card_limit(p_card_id uuid,p_card_limit numeric) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM public.set_bank_card_limit(p_card_id,p_card_limit,'Ajuste autorizado pela instituição financeira.');RETURN jsonb_build_object('success',true,'message','Limite atualizado.');END $$;

CREATE FUNCTION public.request_card_limit_increase(p_card_id uuid,p_requested_limit numeric,p_justification text DEFAULT '') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.cards%rowtype;a public.credit_card_applications%rowtype;policy jsonb;maximum numeric;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para solicitar aumento.' USING errcode='42501';END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
 SELECT * INTO c FROM public.cards WHERE id=p_card_id AND user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND onboarding_completed AND deleted_at IS NULL) FOR UPDATE;
 IF c.id IS NULL OR c.is_active IS DISTINCT FROM true OR coalesce(c.card_type,c.type)<>'credit' THEN RAISE EXCEPTION 'Escolha um cartão de crédito ativo de sua titularidade.' USING errcode='42501';END IF;
 policy:=public.get_bank_policy();maximum:=least(1000000000,coalesce((policy->>'credit_card_max_limit')::numeric,1000000000));
 IF p_requested_limit IS NULL OR p_requested_limit::text IN('NaN','Infinity','-Infinity') OR round(p_requested_limit,2)<=c.card_limit OR p_requested_limit>maximum THEN RAISE EXCEPTION 'O limite desejado deve superar o atual e respeitar a política de crédito.';END IF;
 IF length(btrim(p_justification))<10 OR length(p_justification)>2000 THEN RAISE EXCEPTION 'Informe uma justificativa entre 10 e 2.000 caracteres.';END IF;
 SELECT * INTO a FROM public.credit_card_applications WHERE card_id=c.id AND application_kind='limit_increase' AND status='Pendente';
 IF a.id IS NOT NULL THEN
  IF a.requested_limit=round(p_requested_limit,2) AND a.justification=btrim(p_justification) THEN RETURN jsonb_build_object('success',true,'application_id',a.id);END IF;
  RAISE EXCEPTION 'Este cartão já possui um pedido de aumento em análise.';
 END IF;
 INSERT INTO public.credit_card_applications(user_id,brand,requested_limit,status,application_kind,card_id,current_limit_snapshot,justification)
 VALUES(auth.uid(),lower(c.brand),round(p_requested_limit,2),'Pendente','limit_increase',c.id,c.card_limit,btrim(p_justification)) RETURNING * INTO a;
 INSERT INTO public.notifications(user_id,type,content,link,metadata)
 SELECT p.id,'bank_limit_request','Nova solicitação de aumento de limite aguarda análise.','/services/bank?tab=management',jsonb_build_object('application_id',a.id)
 FROM public.profiles p WHERE p.id<>auth.uid() AND public.user_can_manage_national_bank(p.id);
 PERFORM economy_private.audit('card_limit_increase_requested','credit_card_applications',a.id::text,NULL,jsonb_build_object('card_id',c.id,'current_limit',c.card_limit,'requested_limit',a.requested_limit),p_justification,auth.uid());
 RETURN jsonb_build_object('success',true,'application_id',a.id);
END $$;
REVOKE ALL ON FUNCTION public.request_card_limit_increase(uuid,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_card_limit_increase(uuid,numeric,text) TO authenticated;

CREATE FUNCTION private.review_card_limit_request(p_application_id uuid,p_approved boolean,p_limit numeric,p_feedback text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.credit_card_applications%rowtype;c public.cards%rowtype;policy jsonb;amount numeric;
BEGIN
 IF auth.uid() IS NULL OR NOT public.user_can_manage_national_bank(auth.uid()) THEN RAISE EXCEPTION 'Somente a instituição financeira pode analisar pedidos.' USING errcode='42501';END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
 SELECT * INTO a FROM public.credit_card_applications WHERE id=p_application_id FOR UPDATE;
 IF a.id IS NULL OR a.application_kind<>'limit_increase' THEN RAISE EXCEPTION 'Pedido de aumento não encontrado.';END IF;
 IF a.user_id=auth.uid() THEN RAISE EXCEPTION 'Você não pode analisar seu próprio pedido.' USING errcode='42501';END IF;
 IF a.status<>'Pendente' THEN RETURN jsonb_build_object('success',true,'message','Este pedido já foi analisado.','status',a.status);END IF;
 SELECT * INTO c FROM public.cards WHERE id=a.card_id FOR UPDATE;
 IF p_approved THEN
  amount:=round(coalesce(p_limit,a.requested_limit),2);policy:=public.get_bank_policy();
  IF c.id IS NULL OR c.is_active IS DISTINCT FROM true OR c.user_id<>a.user_id THEN RAISE EXCEPTION 'O cartão deste pedido não está ativo.';END IF;
  IF amount IS NULL OR amount::text IN('NaN','Infinity','-Infinity') OR amount<=c.card_limit OR amount>a.requested_limit OR amount>least(1000000000,coalesce((policy->>'credit_card_max_limit')::numeric,1000000000)) THEN RAISE EXCEPTION 'O novo limite deve superar o atual, respeitar o pedido e a política de crédito.';END IF;
  PERFORM public.set_bank_card_limit(c.id,amount,'Solicitação de aumento aprovada pela instituição financeira.');
 END IF;
 UPDATE public.credit_card_applications SET status=CASE WHEN p_approved THEN 'Aprovado' ELSE 'Rejeitado' END,approved_limit=CASE WHEN p_approved THEN amount ELSE NULL END,reviewed_by=auth.uid(),reviewed_at=clock_timestamp(),updated_at=clock_timestamp(),feedback=left(p_feedback,2000),admin_feedback=left(p_feedback,2000) WHERE id=a.id;
 INSERT INTO public.notifications(user_id,type,content,link,metadata) VALUES(a.user_id,'bank_limit_review',CASE WHEN p_approved THEN 'Seu pedido de aumento foi aprovado. Novo limite: '||public.format_currency_brl(amount) ELSE 'Seu pedido de aumento de limite foi rejeitado. O limite permanece inalterado.' END||CASE WHEN nullif(btrim(p_feedback),'') IS NOT NULL THEN ' Motivo: '||left(p_feedback,2000) ELSE '' END,'/services/bank?tab=cards&card='||a.card_id,jsonb_build_object('application_id',a.id,'card_id',a.card_id,'approved',p_approved));
 PERFORM economy_private.audit('card_limit_request_reviewed','credit_card_applications',a.id::text,to_jsonb(a),jsonb_build_object('approved',p_approved,'new_limit',amount),p_feedback,auth.uid());
 RETURN jsonb_build_object('success',true,'message',CASE WHEN p_approved THEN 'Aumento aprovado e aplicado ao cartão.' ELSE 'Pedido rejeitado.' END);
END $$;
REVOKE ALL ON FUNCTION private.review_card_limit_request(uuid,boolean,numeric,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.approve_credit_card_application(p_application_id uuid, p_card_limit numeric DEFAULT NULL::numeric, p_brand text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  application_record public.credit_card_applications%rowtype;
  account_id_value uuid;
  approved_limit_value numeric(14, 2);
  approved_brand_value text;
  holder_name_value text;
  created_card_id uuid;
  policy_value jsonb;
  policy_default_limit numeric(14, 2);
begin
IF EXISTS(SELECT 1 FROM public.credit_card_applications WHERE id=p_application_id AND application_kind='limit_increase') THEN RETURN private.review_card_limit_request(p_application_id,true,p_card_limit,'Aumento aprovado pela instituição financeira.');END IF;

  if (select auth.uid()) is null or not public.is_national_bank_manager() then
    return jsonb_build_object(
      'success',
      false,
      'message',
      'Apenas o Banco Nacional pode aprovar cartões.'
    );
  end if;

  select *
  into application_record
  from public.credit_card_applications
  where id = p_application_id
  for update;

  if not found then
    return jsonb_build_object(
      'success',
      false,
      'message',
      'Solicitação de cartão não encontrada.'
    );
  end if;

  if application_record.status not in ('Pendente', 'pending') then
    return jsonb_build_object(
      'success',
      false,
      'message',
      'Esta solicitação já foi analisada.'
    );
  end if;

  select account.id
  into account_id_value
  from public.accounts as account
  where account.user_id = application_record.user_id
  order by account.id
  limit 1;

  if account_id_value is null then
    return jsonb_build_object(
      'success',
      false,
      'message',
      'O usuário precisa ter conta bancária para receber cartão.'
    );
  end if;

  select coalesce(
    nullif(btrim(profile.full_name), ''),
    nullif(btrim(profile.username), '')
  )
  into holder_name_value
  from public.profiles as profile
  where profile.id = application_record.user_id;

  holder_name_value := upper(coalesce(holder_name_value, 'CLIENTE GOV.RP'));
  approved_brand_value := public.normalize_card_brand(
    coalesce(nullif(btrim(p_brand), ''), application_record.brand, 'visa')
  );

  policy_value := public.get_bank_policy();
  begin
    policy_default_limit :=
      nullif(policy_value ->> 'credit_card_default_limit', '')::numeric;
  exception
    when invalid_text_representation then
      policy_default_limit := 5000;
  end;

  approved_limit_value := greatest(
    100,
    coalesce(
      nullif(p_card_limit, 0),
      nullif(application_record.requested_limit, 0),
      policy_default_limit,
      5000
    )
  );

  insert into public.cards (
    user_id,
    account_id,
    card_number,
    card_holder_name,
    expiry_date,
    cvv,
    type,
    card_type,
    brand,
    card_limit,
    used_limit,
    closing_day,
    due_day,
    is_active,
    created_at
  )
  values (
    application_record.user_id,
    account_id_value,
    public.generate_card_number(),
    holder_name_value,
    to_char(now() + interval '4 years', 'MM/YY'),
    lpad(floor(random() * 1000)::integer::text, 3, '0'),
    'credit',
    'credit',
    approved_brand_value,
    approved_limit_value,
    0,
    25,
    5,
    true,
    now()
  )
  returning id into created_card_id;

  update public.credit_card_applications
  set
    status = 'Aprovado',
    approved_limit = approved_limit_value,
    approved_brand = approved_brand_value,
    reviewed_by = (select auth.uid()),
    reviewed_at = now(),
    updated_at = now(),
    admin_feedback = coalesce(
      admin_feedback,
      'Cartão aprovado pelo Banco Nacional.'
    )
  where id = application_record.id;

  insert into public.notifications (
    user_id,
    type,
    content,
    link,
    is_read,
    metadata,
    created_at
  )
  values (
    application_record.user_id,
    'bank_credit_review',
    'Seu cartão de crédito foi aprovado pelo Banco Nacional.',
    '/services/bank',
    false,
    jsonb_build_object(
      'application_id',
      application_record.id,
      'card_id',
      created_card_id,
      'approved_limit',
      approved_limit_value,
      'brand',
      approved_brand_value
    ),
    now()
  );

  return jsonb_build_object(
    'success',
    true,
    'message',
    'Cartão aprovado e emitido com sucesso.',
    'card_id',
    created_card_id,
    'card_holder_name',
    holder_name_value
  );
end;
$function$

;

CREATE OR REPLACE FUNCTION public.reject_credit_card_application(p_application_id uuid, p_feedback text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
IF EXISTS(SELECT 1 FROM public.credit_card_applications WHERE id=p_application_id AND application_kind='limit_increase') THEN RETURN private.review_card_limit_request(p_application_id,false,NULL,p_feedback);END IF;

  if not public.is_national_bank_manager() then
    return jsonb_build_object('success', false, 'message', 'Apenas o Banco Nacional pode rejeitar cartões.');
  end if;

  update public.credit_card_applications
  set
    status = 'Rejeitado',
    feedback = p_feedback,
    admin_feedback = p_feedback,
    reviewed_by = auth.uid(),
    reviewed_at = now()
  where id = p_application_id
    and status in ('Pendente', 'pending');

  if not found then
    return jsonb_build_object('success', false, 'message', 'Solicitação pendente não encontrada.');
  end if;

  return jsonb_build_object('success', true, 'message', 'Solicitação de cartão rejeitada.');
end;
$function$

;

CREATE FUNCTION public.admin_get_wallet_balances(p_user_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.accounts%rowtype;codes jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso exclusivo da administração.' USING errcode='42501';END IF;
 SELECT * INTO a FROM public.accounts WHERE user_id=p_user_id AND account_kind='personal' ORDER BY created_at LIMIT 1;
 IF a.id IS NULL THEN RAISE EXCEPTION 'O cidadão não possui conta bancária pessoal.';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('code',currency_code,'balance',coalesce((a.currency_balances->>currency_code)::numeric,0),'decimals',CASE WHEN currency_code='JPY' THEN 0 ELSE 2 END) ORDER BY currency_code),'[]') INTO codes FROM public.country_rp_exchange_rates WHERE country_code='BR' AND currency_code<>'BRL';
 RETURN jsonb_build_object('account_id',a.id,'BRL',a.balance,'currencies',codes);
END $$;
CREATE FUNCTION public.admin_adjust_wallet_balance(p_user_id uuid,p_currency_code text,p_amount numeric,p_action text,p_reason text,p_operation_key uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.accounts%rowtype;t public.transactions%rowtype;previous numeric;next_amount numeric;code text:=upper(btrim(p_currency_code));decimals integer;payload jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Acesso exclusivo da administração.' USING errcode='42501';END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
 IF p_operation_key IS NULL OR p_amount IS NULL OR p_amount::text IN('NaN','Infinity','-Infinity') OR p_amount<=0 OR p_amount>1000000000 OR p_action NOT IN('add','remove') OR p_action IS NULL OR length(btrim(coalesce(p_reason,'')))<5 OR length(p_reason)>1000 THEN RAISE EXCEPTION 'Informe valor positivo, operação e justificativa entre 5 e 1.000 caracteres.';END IF;
 IF code IS NULL OR (code<>'BRL' AND NOT EXISTS(SELECT 1 FROM public.country_rp_exchange_rates WHERE country_code='BR' AND currency_code=code)) THEN RAISE EXCEPTION 'Esta moeda não está disponível na carteira do GOVRP.';END IF;
 decimals:=CASE WHEN code='JPY' THEN 0 ELSE 2 END;
 IF round(p_amount,decimals)<>p_amount THEN RAISE EXCEPTION 'O valor possui casas decimais incompatíveis com esta moeda.';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_key::text,0));
 payload:=jsonb_build_object('actor_id',auth.uid(),'target_id',p_user_id,'currency',code,'amount',p_amount,'action',p_action,'reason',btrim(p_reason));
 SELECT * INTO t FROM public.transactions WHERE idempotency_key=p_operation_key;
 IF t.id IS NOT NULL THEN
  IF t.metadata->'admin_adjustment' IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Esta confirmação já foi usada em outra operação.';END IF;
  RETURN jsonb_build_object('success',true,'transaction_id',t.id,'message','Alteração já registrada.');
 END IF;
 SELECT * INTO a FROM public.accounts WHERE user_id=p_user_id AND account_kind='personal' ORDER BY created_at LIMIT 1 FOR UPDATE;
 IF a.id IS NULL THEN RAISE EXCEPTION 'Conta pessoal não encontrada.';END IF;
 previous:=CASE WHEN code='BRL' THEN a.balance ELSE coalesce((a.currency_balances->>code)::numeric,0) END;
 next_amount:=previous+CASE WHEN p_action='add' THEN p_amount ELSE -p_amount END;
 IF next_amount<0 THEN RAISE EXCEPTION 'Saldo insuficiente nesta moeda para a retirada.';END IF;
 IF code='BRL' THEN UPDATE public.accounts SET balance=next_amount,updated_at=clock_timestamp() WHERE id=a.id;
 ELSE UPDATE public.accounts SET currency_balances=jsonb_set(coalesce(currency_balances,'{}'),ARRAY[code],to_jsonb(next_amount)),updated_at=clock_timestamp() WHERE id=a.id;END IF;
 INSERT INTO public.transactions(from_account_id,to_account_id,amount,currency,type,description,idempotency_key,status,metadata)
 VALUES(CASE WHEN p_action='remove' THEN a.id END,CASE WHEN p_action='add' THEN a.id END,p_amount,code,CASE WHEN p_action='add' THEN 'admin_credit' ELSE 'admin_debit' END,'Ajuste administrativo ('||code||'): '||btrim(p_reason),p_operation_key,'completed',jsonb_build_object('admin_adjustment',payload,'currency',code,'balance_before',previous,'balance_after',next_amount)) RETURNING * INTO t;
 PERFORM economy_private.audit('admin_wallet_adjusted','accounts',a.id::text,jsonb_build_object('currency',code,'balance',previous),jsonb_build_object('currency',code,'balance',next_amount,'transaction_id',t.id),p_reason,auth.uid());
 RETURN jsonb_build_object('success',true,'transaction_id',t.id,'message','Saldo em '||code||' atualizado.');
END $$;
REVOKE ALL ON FUNCTION public.admin_get_wallet_balances(uuid),public.admin_adjust_wallet_balance(uuid,text,numeric,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_get_wallet_balances(uuid),public.admin_adjust_wallet_balance(uuid,text,numeric,text,text,uuid) TO authenticated;
-- Retire the unaudited absolute overwrite entry point; use atomic, justified adjustments.
CREATE OR REPLACE FUNCTION public.admin_modify_currency_balance(p_user_id uuid,p_currency_code text,p_amount numeric,p_action text) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Use a alteração de saldo por moeda com justificativa e confirmação.' USING errcode='42501';END $$;
NOTIFY pgrst,'reload schema';

-- The institutional corporate card has its own canonical owner: the current head of government.
CREATE FUNCTION private.notify_government_card_limit_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE holder uuid;changed_at timestamptz:=clock_timestamp();
BEGIN
 IF NEW.corporate_card_limit IS NOT DISTINCT FROM OLD.corporate_card_limit THEN RETURN NEW;END IF;
 IF NEW.corporate_card_limit IS NULL OR NEW.corporate_card_limit<0 OR NEW.corporate_card_limit::text IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Informe um limite corporativo válido.';END IF;
 SELECT head_id INTO holder FROM public.government_terms WHERE ended_at IS NULL ORDER BY term_starts_at DESC LIMIT 1;
 IF holder IS NOT NULL THEN
  INSERT INTO public.notifications(user_id,type,content,link,metadata) VALUES(holder,'bank_card_limit_changed',
  'O limite do cartão corporativo do Governo mudou de '||public.format_currency_brl(OLD.corporate_card_limit)||' para '||public.format_currency_brl(NEW.corporate_card_limit)||'. Variação: '||public.format_currency_brl(NEW.corporate_card_limit-OLD.corporate_card_limit)||'. Em '||to_char(changed_at AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||'.',
  '/dashboard/president',jsonb_build_object('institutional_card','government','old_limit',OLD.corporate_card_limit,'new_limit',NEW.corporate_card_limit,'difference',NEW.corporate_card_limit-OLD.corporate_card_limit,'changed_at',changed_at));
 END IF;
 PERFORM economy_private.audit('government_card_limit_changed','government_finances',NEW.id::text,jsonb_build_object('limit',OLD.corporate_card_limit),jsonb_build_object('limit',NEW.corporate_card_limit),'Alteração do limite do cartão corporativo do Governo.',auth.uid());
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.notify_government_card_limit_change() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER government_card_limit_notification AFTER UPDATE OF corporate_card_limit ON public.government_finances FOR EACH ROW EXECUTE FUNCTION private.notify_government_card_limit_change();
