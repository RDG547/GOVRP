import { supabase } from '@/lib/supabaseClient';
import { fetchPresidentialElectionHistory } from '@/lib/executiveGovernance';

const DEFAULT_COUNTRY_CODE = 'BR';
const missingRpSchemaCodes = new Set(['42P01', 'PGRST200', 'PGRST205']);

const asFiniteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

// O motor econômico já pondera a participação simulada e a dos jogadores.
// Aplicar economyInfluence novamente aqui diminuía o efeito do RP duas vezes.
const applyRelativeGameChange = (realValue, gameBaseline, gameCurrent) => {
  const real = asFiniteNumber(realValue);
  const baseline = asFiniteNumber(gameBaseline);
  const current = asFiniteNumber(gameCurrent);

  if (current === null) return real;
  if (real === null || baseline === null || baseline === 0) return current;

  const relativeChange = clamp((current / baseline) - 1, -0.75, 3);
  return real * (1 + relativeChange);
};

const applyAbsoluteGameChange = (realValue, gameBaseline, gameCurrent) => {
  const real = asFiniteNumber(realValue);
  const baseline = asFiniteNumber(gameBaseline);
  const current = asFiniteNumber(gameCurrent);

  if (current === null) return real;
  if (real === null || baseline === null) return current;
  return real + (current - baseline);
};

const fetchManualPresident = async () => {
  const { data: president, error } = await supabase
    .from('profiles')
    .select('id, full_name, username')
    .eq('role', 'Presidente')
    .limit(1)
    .maybeSingle();

  if (error || !president) return null;

  const { data: membership } = await supabase
    .from('party_members')
    .select('party:political_parties(name, acronym, ideology, orientation)')
    .eq('user_id', president.id)
    .limit(1)
    .maybeSingle();

  return {
    leader: president.full_name || president.username,
    party: membership?.party?.name || null,
    ideology: membership?.party?.ideology || membership?.party?.orientation || null,
    source: 'GOV.RP — cargo em jogo',
  };
};

const fetchBrazilPoliticalState = async () => {
  try {
    const { currentTerm } = await fetchPresidentialElectionHistory(supabase);
    const winner = currentTerm?.winner;

    if (winner?.profile) {
      return {
        leader: winner.profile.full_name || winner.profile.username || winner.political_name,
        party: winner.party?.name || null,
        ideology: winner.party?.ideology || winner.party?.orientation || null,
        source: 'GOV.RP — eleição dos jogadores',
      };
    }
  } catch {
    // A camada real continua visível se a governança do jogo ainda não estiver acessível.
  }

  return fetchManualPresident();
};

const fetchRpStateRow = async (alpha2) => {
  const { data, error } = await supabase
    .from('country_rp_states')
    .select('*')
    .eq('country_code', alpha2)
    .maybeSingle();

  if (error && !missingRpSchemaCodes.has(error.code)) throw error;
  return data ?? null;
};

const withoutNullishValues = (value) => Object.fromEntries(
  Object.entries(value ?? {}).filter(([, item]) => item != null && item !== ''),
);

const fetchBrazilEconomy = async () => {
  const { data, error } = await supabase.rpc('get_public_economic_dashboard');
  if (error) return null;

  return {
    gdp: data?.headline?.gdp_nominal ?? null,
    growth: data?.headline?.gdp_growth_year_over_year
      ?? data?.headline?.gdp_growth_quarterly
      ?? null,
    inflation: data?.headline?.inflation_annual ?? null,
    unemployment: data?.headline?.unemployment_rate ?? null,
    exchangeUsd: data?.state?.exchange_rate ?? null,
    playerShare: data?.state?.player_share ?? null,
    activityLevel: data?.state?.player_activity_level ?? null,
  };
};

export const loadCountryRpContext = async (alpha2) => {
  if (!alpha2) return null;

  const isBrazil = alpha2 === DEFAULT_COUNTRY_CODE;
  const [stateResult, economyResult, politicsResult] = await Promise.allSettled([
    fetchRpStateRow(alpha2),
    isBrazil ? fetchBrazilEconomy() : Promise.resolve(null),
    isBrazil ? fetchBrazilPoliticalState() : Promise.resolve(null),
  ]);
  const state = stateResult.status === 'fulfilled' ? stateResult.value : null;
  const liveEconomy = economyResult.status === 'fulfilled' ? economyResult.value : null;
  const gamePolitics = politicsResult.status === 'fulfilled' ? politicsResult.value : null;
  const explicitPolitics = withoutNullishValues(state?.political_current);
  const politics = {
    ...gamePolitics,
    ...explicitPolitics,
  };
  const economicCurrent = {
    ...(liveEconomy ?? {}),
    ...withoutNullishValues(state?.economic_current),
  };
  const economyInfluence = clamp(
    Math.max(
      asFiniteNumber(state?.economy_influence) ?? 0,
      asFiniteNumber(liveEconomy?.playerShare) ?? 0,
    ),
    0,
    1,
  );
  const hasEconomicChange = Object.keys(economicCurrent).some((key) => {
    const current = asFiniteNumber(economicCurrent[key]);
    const baseline = asFiniteNumber(state?.economic_baseline?.[key]);
    return current !== null && baseline !== null && Math.abs(current - baseline) > 0.000001;
  });

  return {
    countryCode: alpha2,
    isPlayable: Boolean(state?.is_playable || isBrazil),
    economicBaseline: state?.economic_baseline ?? {},
    economicCurrent,
    demographicCurrent: state?.demographic_current ?? {},
    politics,
    economyInfluence,
    politicsInfluence: gamePolitics?.leader
      ? 1
      : clamp(asFiniteNumber(state?.politics_influence) ?? 0, 0, 1),
    societyInfluence: clamp(asFiniteNumber(state?.society_influence) ?? 0, 0, 1),
    revision: state?.revision ?? 0,
    updatedAt: state?.updated_at ?? null,
    lastEventSummary: state?.last_event_summary ?? null,
    hasGameplayData: Boolean(
      gamePolitics?.leader
      || Object.keys(explicitPolitics).length
      || hasEconomicChange
      || economyInfluence > 0
      || (state?.society_influence ?? 0) > 0
    ),
  };
};

export const mergeCountryRpProfile = (realProfile, context) => {
  if (!realProfile || !context?.hasGameplayData) return realProfile;

  const economy = realProfile.economy ? { ...realProfile.economy } : {};
  const exchange = realProfile.exchange ? { ...realProfile.exchange } : {};
  const government = realProfile.government ? { ...realProfile.government } : {};
  const economicBaseline = context.economicBaseline;
  const economicCurrent = context.economicCurrent;
  const rpDate = context.updatedAt?.slice?.(0, 10) || 'agora';

  if (economicCurrent.gdp != null) {
    economy.gdp = {
      value: applyRelativeGameChange(
        economy.gdp?.value,
        economicBaseline.gdp,
        economicCurrent.gdp,
      ),
      year: 'RP ao vivo',
      source: 'GOV.RP + base real',
    };
  }

  if (economicCurrent.growth != null) {
    economy.growth = {
      value: applyAbsoluteGameChange(
        economy.growth?.value,
        economicBaseline.growth,
        economicCurrent.growth,
      ),
      year: 'RP ao vivo',
      source: 'GOV.RP + base real',
    };
  }

  if (context.demographicCurrent.population != null) {
    economy.population = {
      value: applyRelativeGameChange(
        economy.population?.value,
        context.demographicCurrent.populationBaseline,
        context.demographicCurrent.population,
      ),
      year: 'RP ao vivo',
      source: 'GOV.RP + base real',
    };
  }

  ['inflation', 'unemployment'].forEach((field) => {
    if (economicCurrent[field] == null) return;
    economy[field] = {
      value: applyAbsoluteGameChange(
        economy[field]?.value,
        economicBaseline[field],
        economicCurrent[field],
      ),
      year: 'RP ao vivo',
      source: 'GOV.RP + base real',
    };
  });

  if (exchange.usd != null
    && economicBaseline.exchangeUsd != null
    && economicCurrent.exchangeUsd != null) {
    exchange.usd = applyRelativeGameChange(
      exchange.usd,
      economicBaseline.exchangeUsd,
      economicCurrent.exchangeUsd,
    );
    exchange.eur = applyRelativeGameChange(
      exchange.eur,
      economicBaseline.exchangeUsd,
      economicCurrent.exchangeUsd,
    );
    exchange.date = rpDate;
    exchange.source = 'GOV.RP + base cambial real';
  }

  if (context.politics?.leader) {
    government.leader = context.politics.leader;
    government.office = context.politics.office || 'Presidente da República no GOV.RP';
    government.party = context.politics.party || 'Sem partido no GOV.RP';
    government.partyLabel = 'Partido no GOV.RP';
    government.ideology = context.politics.ideology || 'Não definida no GOV.RP';
  }

  if (context.politics?.governmentForm) {
    government.governmentForm = context.politics.governmentForm;
  }

  const regime = context.politics?.regime
    ? {
        label: context.politics.regime,
        year: 'RP ao vivo',
        source: 'GOV.RP',
      }
    : realProfile.regime;

  return {
    ...realProfile,
    economy,
    exchange,
    government,
    regime,
    rp: {
      active: true,
      ...context,
    },
  };
};

export const applyCountryRpEvent = async ({
  countryCode = DEFAULT_COUNTRY_CODE,
  domain,
  changes,
  eventType,
  summary,
  influenceDelta = 0.05,
}) => {
  const { data, error } = await supabase.rpc('apply_country_rp_event', {
    p_country_code: countryCode,
    p_domain: domain,
    p_changes: changes,
    p_event_type: eventType,
    p_summary: summary,
    p_influence_delta: influenceDelta,
  });

  if (error) throw error;
  return data;
};

export const subscribeToCountryRp = (alpha2, onChange) => {
  if (!alpha2) return () => {};

  let refreshTimer;
  const scheduleRefresh = () => {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(onChange, 250);
  };
  let channel = supabase
    .channel(`country-rp:${alpha2}:${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'country_rp_states',
      filter: `country_code=eq.${alpha2}`,
    }, scheduleRefresh);

  if (alpha2 === DEFAULT_COUNTRY_CODE) {
    ['economic_state', 'economic_indicators', 'elections', 'candidates', 'profiles', 'political_parties']
      .forEach((table) => {
        channel = channel.on('postgres_changes', {
          event: '*', schema: 'public', table,
        }, scheduleRefresh);
      });
  }

  channel.subscribe();

  return () => {
    window.clearTimeout(refreshTimer);
    supabase.removeChannel(channel);
  };
};
