import { supabase } from '@/lib/supabaseClient';
import { fetchPresidentialElectionHistory } from '@/lib/executiveGovernance';
import { normalizeRpEconomicState } from '@/lib/countryRpEconomy';

const DEFAULT_COUNTRY_CODE = 'BR';
const missingRpSchemaCodes = new Set(['42P01', 'PGRST200', 'PGRST205']);

const fetchManualPresident = async () => {
  const { data: president, error } = await supabase
    .from('profiles')
    .select('id, full_name, username, role_assigned_at, updated_at')
    .eq('role', 'Presidente')
    .order('role_assigned_at', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false })
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
    party: membership?.party?.name
      ? `${membership.party.name}${membership.party.acronym ? ` (${membership.party.acronym})` : ''}`
      : null,
    ideology: membership?.party?.ideology || membership?.party?.orientation || null,
    source: 'GOV.RP — cargo em jogo',
  };
};

const fetchBrazilPoliticalState = async () => {
  const activePresident = await fetchManualPresident();
  if (activePresident) return activePresident;

  try {
    const { currentTerm } = await fetchPresidentialElectionHistory(supabase);
    const winner = currentTerm?.winner;

    if (winner?.profile?.role === 'Presidente') {
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

  return {
    leader: 'Cargo vago',
    office: 'Presidência da República no GOV.RP',
    party: 'Não se aplica',
    ideology: 'Não definida no GOV.RP',
    source: 'GOV.RP — estado institucional',
  };
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

export const loadCountryRpContext = async (alpha2) => {
  if (!alpha2) return null;

  const isBrazil = alpha2 === DEFAULT_COUNTRY_CODE;
  const [stateResult, politicsResult] = await Promise.allSettled([
    fetchRpStateRow(alpha2),
    isBrazil ? fetchBrazilPoliticalState() : Promise.resolve(null),
  ]);
  const state = stateResult.status === 'fulfilled' ? stateResult.value : null;
  const gamePolitics = politicsResult.status === 'fulfilled' ? politicsResult.value : null;
  const explicitPolitics = withoutNullishValues(state?.political_current);
  const politics = {
    ...explicitPolitics,
    ...gamePolitics,
  };
  const economicCurrent = withoutNullishValues(state?.economic_current);

  return {
    countryCode: alpha2,
    isPlayable: Boolean(state?.is_playable),
    economicBaseline: state?.economic_baseline ?? {},
    economicCurrent,
    demographicCurrent: state?.demographic_current ?? {},
    politics,
    revision: state?.revision ?? 0,
    startedAt: state?.started_at ?? null,
    referenceSnapshotAt: state?.reference_snapshot_at ?? null,
    updatedAt: state?.updated_at ?? null,
    lastEventSummary: state?.last_event_summary ?? null,
    playerShare: Number(state?.player_share ?? 0.5),
    simulatedShare: Number(state?.simulated_share ?? 0.5),
    hasGameplayData: Boolean(state?.is_playable && state?.reference_snapshot_at),
  };
};

export const mergeCountryRpProfile = (realProfile, context) => {
  if (!realProfile || !context?.hasGameplayData) return realProfile;

  const economy = realProfile.economy ? { ...realProfile.economy } : {};
  const exchange = realProfile.exchange ? { ...realProfile.exchange } : {};
  const government = realProfile.government ? { ...realProfile.government } : {};
  const economicCurrent = normalizeRpEconomicState(context.economicCurrent);
  const rpDate = context.updatedAt?.slice?.(0, 10) || 'agora';
  const rpIndicator = (value) => ({
    value: Number(value),
    year: 'RP',
    source: 'GOV.RP',
  });

  if (economicCurrent.gdp != null) {
    economy.gdp = {
      ...rpIndicator(economicCurrent.gdp),
      currency: economicCurrent.gdpCurrency || 'USD',
    };
  }

  if (economicCurrent.growth != null) {
    economy.growth = rpIndicator(economicCurrent.growth);
  }

  if (context.demographicCurrent.population != null) {
    economy.population = rpIndicator(context.demographicCurrent.population);
  }

  if (context.demographicCurrent.area != null) {
    economy.area = rpIndicator(context.demographicCurrent.area);
  }

  ['inflation', 'unemployment'].forEach((field) => {
    if (economicCurrent[field] == null) return;
    economy[field] = rpIndicator(economicCurrent[field]);
  });

  if (economicCurrent.exchangeUsd != null) {
    exchange.usd = Number(economicCurrent.exchangeUsd);
    if (economicCurrent.exchangeEur != null) {
      exchange.eur = Number(economicCurrent.exchangeEur);
    }
    exchange.currency = economicCurrent.currency || exchange.currency || 'BRL';
    exchange.date = rpDate;
    exchange.source = 'GOV.RP';
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
        year: 'RP',
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
    [
      'economic_state',
      'economic_indicators',
      'elections',
      'election_types',
      'candidates',
      'votes',
      'profiles',
      'party_members',
      'political_parties',
      'system_settings',
    ]
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
