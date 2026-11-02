BEGIN;

CREATE OR REPLACE FUNCTION private.issue_citizenship_initial_grant(p_user uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_account public.accounts%rowtype;
BEGIN
 IF p_user IS NULL THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text||':bank',0));
 IF NOT EXISTS(SELECT 1 FROM public.profiles p JOIN auth.users au ON au.id=p.id
   WHERE p.id=p_user AND p.onboarding_completed IS TRUE
      AND p.deleted_at IS NULL AND au.deleted_at IS NULL) THEN RETURN false; END IF;
 SELECT * INTO v_account FROM public.accounts WHERE user_id=p_user AND account_kind='personal'
   AND business_id IS NULL ORDER BY created_at LIMIT 1 FOR UPDATE;
 IF v_account.id IS NULL THEN RETURN false; END IF;

 -- Both historic direct grants and current ledger grants count as fulfilled.
 IF EXISTS(SELECT 1 FROM private.citizen_initial_grants WHERE user_id=p_user)
   OR EXISTS(SELECT 1 FROM public.transactions t
      WHERE t.to_account_id=v_account.id AND t.type='citizenship_initial_balance')
 THEN RETURN false; END IF;

 INSERT INTO private.citizen_initial_grants(user_id,account_id,amount)
 VALUES(p_user,v_account.id,1000.00) ON CONFLICT(user_id) DO NOTHING;
 IF NOT FOUND THEN RETURN false; END IF;

 UPDATE public.accounts SET balance=balance+1000.00 WHERE id=v_account.id;
 INSERT INTO public.transactions(to_account_id,amount,description,type,metadata)
 VALUES(v_account.id,1000.00,'Saldo inicial da cidadania',
   'citizenship_initial_balance',jsonb_build_object('source','automatic_citizen_bank_grant','version',3));
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION private.issue_citizenship_initial_grant(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.auto_issue_citizenship_initial_grant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='accounts' THEN
    IF NEW.user_id IS NOT NULL AND NEW.account_kind='personal' AND NEW.business_id IS NULL
      THEN PERFORM private.issue_citizenship_initial_grant(NEW.user_id); END IF;
 ELSIF TG_TABLE_NAME='profiles' THEN
    IF NEW.onboarding_completed IS TRUE AND
      (TG_OP='INSERT' OR OLD.onboarding_completed IS DISTINCT FROM TRUE)
    THEN PERFORM private.issue_citizenship_initial_grant(NEW.id); END IF;
 END IF;
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS issue_grant_when_bank_opened ON public.accounts;
CREATE TRIGGER issue_grant_when_bank_opened
AFTER INSERT ON public.accounts FOR EACH ROW EXECUTE FUNCTION private.auto_issue_citizenship_initial_grant();
DROP TRIGGER IF EXISTS issue_grant_when_citizenship_completed ON public.profiles;
CREATE TRIGGER issue_grant_when_citizenship_completed
AFTER UPDATE OF onboarding_completed ON public.profiles
FOR EACH ROW EXECUTE FUNCTION private.auto_issue_citizenship_initial_grant();

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
  -- The initial grant is issued only by the idempotent ledger routine.
  -- Account creation starts with zero to avoid any untracked credit.
  v_balance:=0;

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

-- Compatibility: old clients may still call the RPC. Never grant twice.
CREATE OR REPLACE FUNCTION public.claim_citizen_initial_grant()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user uuid:=auth.uid(); v_done boolean;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'Entre na sua conta.' USING ERRCODE='42501'; END IF;
 v_done:=private.issue_citizenship_initial_grant(v_user);
 RETURN jsonb_build_object('success',v_done,'amount',CASE WHEN v_done THEN 1000 ELSE 0 END,
   'message',CASE WHEN v_done THEN 'Saldo inicial creditado.' ELSE 'Saldo inicial já concedido ou conta ainda não concluída.' END);
END $$;

-- Previously-created citizens: all identifiable prior grants are skipped.
-- The 20 missing accounts were individually audited and have no matching
-- initial-balance transaction nor ledger record. Run atomically and once.
DO $$
DECLARE v_record record; v_count integer:=0;
BEGIN
 FOR v_record IN
   SELECT a.user_id FROM public.accounts a
   JOIN public.profiles p ON p.id=a.user_id
   WHERE a.account_kind='personal' AND a.business_id IS NULL
     AND p.onboarding_completed IS TRUE AND p.deleted_at IS NULL
     AND NOT EXISTS(SELECT 1 FROM private.citizen_initial_grants g WHERE g.user_id=a.user_id)
     AND NOT EXISTS(SELECT 1 FROM public.transactions t WHERE t.to_account_id=a.id AND t.type='citizenship_initial_balance')
   ORDER BY a.created_at
 LOOP
   IF private.issue_citizenship_initial_grant(v_record.user_id) THEN
     v_count:=v_count+1;
   END IF;
 END LOOP;
 RAISE NOTICE 'Créditos iniciais concedidos a % contas sem registro anterior.',v_count;
END $$;

COMMIT;