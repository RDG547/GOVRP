-- O PostgREST executa com a proteção safe-update habilitada. O recálculo
-- global dos investimentos precisa, portanto, declarar explicitamente o alvo.

create or replace function public.sync_global_monetary_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  economic_policy jsonb := '{}'::jsonb;
  bank_policy jsonb := '{}'::jsonb;
  previous_monthly numeric;
  current_monthly numeric;
  loan_spread numeric;
  card_spread numeric;
  debt_spread numeric;
begin
  select coalesce(setting.value, '{}'::jsonb)
    into economic_policy
  from public.system_settings setting
  where setting.key = 'economic_policy';

  select coalesce(setting.value, '{}'::jsonb)
    into bank_policy
  from public.system_settings setting
  where setting.key = 'bank_policy';

  economic_policy := coalesce(economic_policy, '{}'::jsonb) || jsonb_build_object(
    'selic_rate', new.current_selic,
    'updated_at', now(),
    'updated_by', auth.uid()
  );

  previous_monthly := round(
    (power(1 + greatest(coalesce(old.current_selic, new.current_selic), 0) / 100, 1.0 / 12.0) - 1) * 100,
    2
  );
  current_monthly := round(
    (power(1 + greatest(new.current_selic, 0) / 100, 1.0 / 12.0) - 1) * 100,
    2
  );

  loan_spread := coalesce(
    nullif(bank_policy->>'loan_interest_spread', '')::numeric,
    greatest(0, coalesce(nullif(bank_policy->>'loan_interest_rate', '')::numeric, 2.5) - previous_monthly)
  );
  card_spread := coalesce(
    nullif(bank_policy->>'credit_card_revolving_spread', '')::numeric,
    greatest(0, coalesce(nullif(bank_policy->>'credit_card_revolving_rate', '')::numeric, 8.9) - previous_monthly)
  );
  debt_spread := coalesce(
    nullif(bank_policy->>'government_debt_interest_spread', '')::numeric,
    greatest(0, coalesce(nullif(bank_policy->>'government_debt_interest_rate', '')::numeric, 1.75) - previous_monthly)
  );

  bank_policy := coalesce(bank_policy, '{}'::jsonb) || jsonb_build_object(
    'loan_interest_spread', loan_spread,
    'credit_card_revolving_spread', card_spread,
    'government_debt_interest_spread', debt_spread,
    'loan_interest_rate', round(current_monthly + loan_spread, 2),
    'credit_card_revolving_rate', round(current_monthly + card_spread, 2),
    'government_debt_interest_rate', round(current_monthly + debt_spread, 2),
    'selic_reference', new.current_selic,
    'updated_at', now()
  );

  insert into public.system_settings (key, value, description, updated_at)
  values (
    'economic_policy',
    economic_policy,
    'Política monetária nacional sincronizada com o motor econômico.',
    now()
  )
  on conflict (key) do update
  set value = excluded.value,
      description = excluded.description,
      updated_at = excluded.updated_at;

  insert into public.system_settings (key, value, description, updated_at)
  values (
    'bank_policy',
    bank_policy,
    'Política de juros e crédito sincronizada com a Selic nacional.',
    now()
  )
  on conflict (key) do update
  set value = excluded.value,
      description = excluded.description,
      updated_at = excluded.updated_at;

  update public.investment_options option
  set annual_return_rate = round(greatest(
    0.005,
    (
      new.current_selic * case option.risk_level
        when 'low' then 0.90
        when 'high' then 1.20
        when 'very-high' then 1.35
        else 1.05
      end
      + case option.risk_level
        when 'low' then -0.40
        when 'high' then 2.20
        when 'very-high' then 4.50
        else 0.80
      end
    ) / 100
  ), 6)
  where option.id is not null;

  return new;
end;
$$;
