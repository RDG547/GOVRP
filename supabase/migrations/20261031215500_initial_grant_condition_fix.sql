BEGIN;
CREATE OR REPLACE FUNCTION public.ensure_citizen_bank_account()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_account public.accounts%rowtype;
  v_balance numeric := 1000;
  v_setting jsonb;
  v_agency text;
  v_account_number text;
  v_transfer_key text;
  v_created boolean := false;
begin
  if v_user_id is null then raise exception 'Usuário não autenticado.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text || ':bank', 0));

  select * into v_profile from public.profiles where id = v_user_id;
  if not exists (
    select 1 from public.documents where user_id = v_user_id
      and type in ('CPF','RG','CTD') and is_valid
    group by user_id having count(distinct type) = 3
  ) then raise exception 'Emita CPF, RG e CTD antes de abrir a conta.'; end if;

  select * into v_account from public.accounts where user_id = v_user_id limit 1;
  if found then
    update public.profiles set onboarding_step = case when onboarding_completed then onboarding_step else 'citizenship' end,
      onboarding_updated_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = v_user_id;
    return jsonb_build_object('account', to_jsonb(v_account), 'created', false);
  end if;

  select value into v_setting from public.system_settings where key = 'citizen_onboarding';
  if coalesce(v_setting->>'initial_bank_balance', '') ~ '^\d+(\.\d+)?$' then
    v_balance := (v_setting->>'initial_bank_balance')::numeric;
  end if;
  v_balance := greatest(0, v_balance);
  -- New citizens must verify their email and age 24h before receiving the
  -- initial grant, otherwise scripts can turn mass signups into RP money.
  if not exists (
    select 1 from auth.users au where au.id=v_user_id
      and au.deleted_at is null and au.email_confirmed_at is not null
      and au.created_at <= clock_timestamp()-interval '24 hours'
      and v_profile.onboarding_completed IS TRUE
  ) then v_balance:=0; end if;

  loop
    v_agency := lpad(floor(random() * 10000)::bigint::text, 4, '0');
    v_account_number := lpad(floor(random() * 10000000)::bigint::text, 7, '0') || '-' || floor(random() * 10)::integer::text;
    exit when not exists (select 1 from public.accounts where account_number = v_account_number);
  end loop;
  v_transfer_key := public.generate_unique_transfer_key();

  insert into public.accounts(user_id, agency_number, account_number, balance, cpf, transfer_key)
  values (v_user_id, v_agency, v_account_number, v_balance, v_profile.cpf, v_transfer_key)
  returning * into v_account;
  v_created := true;

  if v_balance > 0 then
    insert into public.transactions(to_account_id, amount, description, type, metadata)
    values (v_account.id, v_balance, 'Saldo inicial da cidadania', 'citizenship_initial_balance',
      jsonb_build_object('onboarding_version', 2, 'source', 'citizen_onboarding'));
  end if;

  update public.profiles set onboarding_step = case when onboarding_completed then onboarding_step else 'citizenship' end,
    onboarding_updated_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = v_user_id;
  perform public.record_citizen_lifecycle_event(
    v_user_id, 'bank_account_created', 'Conta no Banco Nacional criada.',
    jsonb_build_object('account_id', v_account.id, 'initial_balance', v_balance),
    'bank-account-created:' || v_account.id, v_user_id
  );
  insert into public.notifications(user_id, content, link, type, metadata)
  values (v_user_id, 'Sua conta no Banco Nacional foi aberta.', '/services/bank', 'citizen_bank_account',
    jsonb_build_object('account_id', v_account.id));

  return jsonb_build_object('account', to_jsonb(v_account), 'created', v_created);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.claim_citizen_initial_grant()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user uuid:=auth.uid();
  v_account public.accounts%rowtype;
  v_amount numeric:=1000;
  v_setting jsonb;
  v_grant uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Entre na sua conta.' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text || ':bank',0));
  IF NOT EXISTS (
    SELECT 1 FROM auth.users au JOIN public.profiles p ON p.id=au.id
    WHERE au.id=v_user AND au.deleted_at IS NULL
      AND au.email_confirmed_at IS NOT NULL
      AND au.created_at <= clock_timestamp()-interval '24 hours'
      AND p.onboarding_completed IS TRUE AND p.deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'O saldo inicial estará disponível após confirmar o e-mail, concluir a cidadania e completar 24 horas de conta.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_account FROM public.accounts WHERE user_id=v_user AND business_id IS NULL ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF v_account.id IS NULL THEN RAISE EXCEPTION 'Crie sua conta no Banco Nacional primeiro.'; END IF;
  IF EXISTS(SELECT 1 FROM public.transactions WHERE to_account_id=v_account.id AND type='citizenship_initial_balance')
     OR EXISTS(SELECT 1 FROM private.citizen_initial_grants WHERE user_id=v_user) THEN
    RETURN jsonb_build_object('success',false,'message','Saldo inicial já foi concedido.');
  END IF;
  SELECT value INTO v_setting FROM public.system_settings WHERE key='citizen_onboarding';
  IF COALESCE(v_setting->>'initial_bank_balance','') ~ '^[0-9]+([.][0-9]+)? THEN
    v_amount:=(v_setting->>'initial_bank_balance')::numeric;
  END IF;
  v_amount:=greatest(0,v_amount);
  INSERT INTO private.citizen_initial_grants(user_id,account_id,amount)
  VALUES(v_user,v_account.id,v_amount)
  ON CONFLICT(user_id) DO NOTHING RETURNING user_id INTO v_grant;
  IF v_grant IS NULL THEN RETURN jsonb_build_object('success',false,'message','Saldo inicial já foi concedido.'); END IF;
  UPDATE public.accounts SET balance=balance+v_amount WHERE id=v_account.id;
  IF v_amount>0 THEN
    INSERT INTO public.transactions(to_account_id,amount,description,type,metadata)
    VALUES(v_account.id,v_amount,'Saldo inicial da cidadania','citizenship_initial_balance',
     jsonb_build_object('source','citizen_claim_after_verification'));
  END IF;
  RETURN jsonb_build_object('success',true,'amount',v_amount);
END $function$
 THEN
    v_amount:=(v_setting->>'initial_bank_balance')::numeric;
  END IF;
  v_amount:=greatest(0,v_amount);
  INSERT INTO private.citizen_initial_grants(user_id,account_id,amount)
  VALUES(v_user,v_account.id,v_amount)
  ON CONFLICT(user_id) DO NOTHING RETURNING user_id INTO v_grant;
  IF v_grant IS NULL THEN RETURN jsonb_build_object('success',false,'message','Saldo inicial já foi concedido.'); END IF;
  UPDATE public.accounts SET balance=balance+v_amount WHERE id=v_account.id;
  IF v_amount>0 THEN
    INSERT INTO public.transactions(to_account_id,amount,description,type,metadata)
    VALUES(v_account.id,v_amount,'Saldo inicial da cidadania','citizenship_initial_balance',
     jsonb_build_object('source','citizen_claim_after_verification'));
  END IF;
  RETURN jsonb_build_object('success',true,'amount',v_amount);
END $function$
;
COMMIT;