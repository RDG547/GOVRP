import iso3166 from 'iso-3166-1';
import { supabase } from '@/lib/supabaseClient';
import { loadCountryProfile } from '@/lib/countryProfile';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CNY'];
const requiredNumber = (value, label, positive = false) => {
  if (value == null || value === '' || !Number.isFinite(Number(value)) || (positive && Number(value) <= 0)) {
    throw new Error(`A fonte real não retornou ${label}. Tente novamente antes de resetar.`);
  }
  return Number(value);
};

const fetchReference = async (url) => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error('Não foi possível consultar as referências reais.');
    return await response.json();
  } finally {
    window.clearTimeout(timer);
  }
};

export const loadResetCountrySnapshots = async () => {
  const { data, error } = await supabase.from('country_rp_states').select('country_code,country_name').eq('is_playable', true);
  if (error) throw error;
  const countries = [...(data || [])];
  if (!countries.some((country) => country.country_code === 'BR')) countries.push({ country_code: 'BR', country_name: 'Brasil' });
  const [selicRows, exchangeRows, profiles] = await Promise.all([
    fetchReference('https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json'),
    fetchReference(`https://api.frankfurter.dev/v2/rates?base=BRL&quotes=${CURRENCIES.join(',')}`),
    Promise.all(countries.map(async (country) => {
      const info = iso3166.whereAlpha2(country.country_code);
      if (!info) throw new Error(`País sem código de referência: ${country.country_code}.`);
      const profile = await loadCountryProfile({ alpha2: info.alpha2, alpha3: info.alpha3, force: true });
      return { country, profile };
    })),
  ]);
  const selic = requiredNumber(selicRows?.[0]?.valor, 'a Selic');
  const rates = Object.fromEntries(CURRENCIES.map((currency) => [currency,
    1 / requiredNumber(exchangeRows?.find((row) => row.quote === currency)?.rate, `o câmbio ${currency}`, true),
  ]));
  return profiles.map(({ country, profile }) => {
    const { economy, exchange } = profile;
    const baseline = Object.fromEntries(['gdp', 'growth', 'inflation', 'unemployment'].map((key) => [
      key, requiredNumber(economy?.[key]?.value, `${key} de ${country.country_name}`, key === 'gdp'),
    ]));
    return {
      ...country,
      fetched_at: new Date().toISOString(),
      economy: {
        ...baseline,
        gdpCurrency: 'USD',
        currency: exchange?.currency,
        exchangeUsd: country.country_code === 'BR' ? rates.USD : requiredNumber(exchange?.usd, 'o câmbio USD', true),
        exchangeEur: country.country_code === 'BR' ? rates.EUR : requiredNumber(exchange?.eur, 'o câmbio EUR', true),
        referenceSources: [...(economy?.providers || []), exchange?.source || 'Frankfurter', ...(country.country_code === 'BR' ? ['Banco Central do Brasil'] : [])],
        referenceYears: Object.fromEntries(['gdp', 'growth', 'inflation', 'unemployment'].map((key) => [key, economy?.[key]?.year])),
        exchangeDate: country.country_code === 'BR' ? exchangeRows?.[0]?.date : exchange?.date,
        ...(country.country_code === 'BR' ? { selic, selicDate: selicRows[0].data, selicSource: 'Banco Central do Brasil / SGS 432' } : {}),
      },
      demographics: {
        population: requiredNumber(economy?.population?.value, 'a população', true),
        area: requiredNumber(economy?.area?.value, 'a área', true),
        referenceYear: economy?.population?.year,
        referenceSources: economy?.providers || [],
      },
      politics: { ...(profile.government || {}), regime: profile.regime?.label, source: 'Fotografia real de início do RP' },
      ...(country.country_code === 'BR' ? { exchange_rates: rates } : {}),
    };
  });
};

export const prepareAdminReset = async ({ scope, userIds = [], reason }) => {
  const snapshots = scope === 'full_rp' ? await loadResetCountrySnapshots() : [];
  const { data, error } = await supabase.rpc('admin_prepare_rp_reset', {
    p_scope: scope, p_user_ids: userIds, p_reason: reason, p_country_snapshots: snapshots,
  });
  if (error) throw error;
  return { ...data, snapshots };
};

// RPC responses are capped by PostgREST. Fetch every page so a large community
// can still find and select citizens beyond the first response window.
export const fetchResetUsers = async () => {
  const users = new Map();
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.rpc('admin_get_all_users').order('id').range(offset, offset + pageSize - 1);
    if (error) throw error;
    (data || []).forEach((user) => users.set(user.id, user));
    if (!data || data.length < pageSize) break;
  }
  return [...users.values()];
};

export const executeAdminReset = async (requestId, confirmation) => {
  const { data, error } = await supabase.rpc('admin_execute_rp_reset', {
    p_request_id: requestId, p_confirmation: confirmation,
  });
  if (error) throw error;
  if (!data?.success && !data?.accepted) throw new Error('O reset não foi concluído. Consulte o histórico antes de tentar novamente.');
  return data;
};
