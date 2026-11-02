BEGIN;
-- Do not release a historical party identity for reuse by other parties.
CREATE UNIQUE INDEX IF NOT EXISTS political_party_name_global_unique
  ON public.political_parties(lower(btrim(name)));
CREATE UNIQUE INDEX IF NOT EXISTS political_party_acronym_global_unique
  ON public.political_parties(lower(btrim(acronym)));
CREATE UNIQUE INDEX IF NOT EXISTS political_party_electoral_number_global_unique
  ON public.political_parties(electoral_number) WHERE electoral_number IS NOT NULL;

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
  -- AFTER INSERT grant trigger already updated the authoritative balance.
  SELECT * INTO v_account FROM public.accounts WHERE id=v_account.id;

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

-- The API schema must know about newly added electoral RPCs/columns immediately.
NOTIFY pgrst, 'reload schema';
COMMIT;