-- Completa a sobreposição econômica do RP com inflação e desemprego.
-- O motor econômico já produz o resultado híbrido; o cliente aplica apenas a
-- variação entre esta base congelada e o estado corrente sobre o dado real.

with latest_indicators as (
  select jsonb_strip_nulls(jsonb_build_object(
    'gdp', (
      select coalesce(real_value, nominal_value)
      from public.economic_indicators
      where indicator_code = 'gdp_nominal'
      order by created_at desc
      limit 1
    ),
    'growth', (
      select coalesce(real_value, nominal_value)
      from public.economic_indicators
      where indicator_code in ('gdp_growth_year_over_year', 'gdp_growth_quarterly')
      order by
        (indicator_code = 'gdp_growth_year_over_year') desc,
        created_at desc
      limit 1
    ),
    'inflation', (
      select coalesce(real_value, nominal_value)
      from public.economic_indicators
      where indicator_code = 'inflation_annual'
      order by created_at desc
      limit 1
    ),
    'unemployment', (
      select coalesce(real_value, nominal_value)
      from public.economic_indicators
      where indicator_code = 'unemployment_rate'
      order by created_at desc
      limit 1
    ),
    'exchangeUsd', (select exchange_rate from public.economic_state where id = true)
  )) as snapshot
)
update public.country_rp_states state
set economic_baseline = latest.snapshot || state.economic_baseline,
    economic_current = state.economic_current || latest.snapshot
from latest_indicators latest
where state.country_code = 'BR';

create or replace function public.sync_brazil_rp_indicator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  field_name text;
  field_value numeric;
  current_player_share numeric := 0;
begin
  field_name := case new.indicator_code
    when 'gdp_nominal' then 'gdp'
    when 'gdp_growth_year_over_year' then 'growth'
    when 'gdp_growth_quarterly' then 'growth'
    when 'inflation_annual' then 'inflation'
    when 'unemployment_rate' then 'unemployment'
    else null
  end;

  if field_name is null then
    return new;
  end if;

  field_value := coalesce(new.real_value, new.nominal_value);
  if field_value is null then
    return new;
  end if;

  select coalesce(player_share, 0)
    into current_player_share
    from public.economic_state
   where id = true;

  update public.country_rp_states
  set economic_baseline = case
        when economic_baseline ? field_name then economic_baseline
        else economic_baseline || jsonb_build_object(field_name, field_value)
      end,
      economic_current = economic_current || jsonb_build_object(field_name, field_value),
      economy_influence = greatest(
        economy_influence,
        least(1, greatest(0, current_player_share))
      ),
      last_event_type = 'economic_indicator_update',
      last_event_summary = format(
        'O indicador %s foi recalculado pelo motor econômico do Brasil no RP.',
        field_name
      )
  where country_code = 'BR';

  return new;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.price_basket_items;
exception when duplicate_object then
  null;
end;
$$;
