const asFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const withoutNullishValues = (value) => Object.fromEntries(
  Object.entries(value ?? {}).filter(([, item]) => item != null && item !== ''),
);

export const normalizeRpEconomicState = (value) => {
  const economic = withoutNullishValues(value);
  const gdp = asFiniteNumber(economic.gdp);
  const exchangeUsd = asFiniteNumber(economic.exchangeUsd);
  const localCurrency = String(economic.currency || 'BRL').toUpperCase();
  const gdpCurrency = String(economic.gdpCurrency || 'USD').toUpperCase();

  if (gdp !== null && gdpCurrency === localCurrency && gdpCurrency !== 'USD' && exchangeUsd !== null && exchangeUsd > 0) {
    return {
      ...economic,
      gdp: gdp / exchangeUsd,
      gdpCurrency: 'USD',
    };
  }

  return {
    ...economic,
    ...(gdp !== null ? { gdp } : {}),
    gdpCurrency,
  };
};

const normalizeSnapshotHistory = (snapshots, currentState) => {
  const source = snapshots?.length
    ? snapshots.map((snapshot) => ({
        economic: normalizeRpEconomicState(snapshot.economic_state),
        recordedAt: snapshot.recorded_at,
        revision: snapshot.revision,
      })).sort((left, right) => (
        new Date(left.recordedAt).getTime() - new Date(right.recordedAt).getTime()
      ))
    : [{
        economic: currentState,
        recordedAt: null,
        revision: 0,
      }];

  return source.map(({ economic, recordedAt, revision }, index) => ({
    period_type: 'country_rp_snapshot',
    label: recordedAt
      ? new Intl.DateTimeFormat('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(recordedAt))
      : 'Início do RP',
    ends_at_rp: recordedAt,
    revision: revision ?? index,
    indicators: withoutNullishValues({
      gdp_total: asFiniteNumber(economic.gdp),
      gdp_nominal: asFiniteNumber(economic.gdp),
      gdp_real: asFiniteNumber(economic.gdp),
      gdp_growth_year_over_year: asFiniteNumber(economic.growth),
      inflation_annual: asFiniteNumber(economic.inflation),
      unemployment_rate: asFiniteNumber(economic.unemployment),
    }),
  }));
};

const scaleSectorsToNationalGdp = (sectors, nationalGdp) => {
  const gdp = asFiniteNumber(nationalGdp);
  if (gdp === null || !sectors?.length) return sectors ?? [];

  const total = sectors.reduce((sum, sector) => (
    sum + Math.max(0, asFiniteNumber(sector.real_value_added ?? sector.value_added) ?? 0)
  ), 0);

  if (total <= 0) return sectors;

  return sectors.map((sector) => {
    const sourceValue = Math.max(
      0,
      asFiniteNumber(sector.real_value_added ?? sector.value_added) ?? 0,
    );
    const value = gdp * sourceValue / total;

    return {
      ...sector,
      value_added: value,
      real_value_added: value,
      national_share: sourceValue / total,
    };
  });
};

const classifyEconomicCycle = ({ growth, inflation, target }) => {
  if (growth === null) return null;
  if (growth <= -3) return 'deep_recession';
  if (growth < -0.5) return 'recession';
  if (growth < 0) return 'technical_recession';
  if (inflation !== null && target !== null && inflation > target + 2 && growth < 1) {
    return 'stagflation';
  }
  if (inflation !== null && target !== null && inflation > target + 2 && growth >= 4) {
    return 'overheating';
  }
  if (growth >= 4) return 'boom';
  if (growth >= 2) return 'expansion';
  if (growth > 0) return 'stable';
  return 'slowdown';
};

export const composeNationalEconomyDashboard = ({ dashboard, rpState, snapshots = [] }) => {
  if (!dashboard || !rpState?.is_playable || !rpState?.reference_snapshot_at) return dashboard;

  const economic = normalizeRpEconomicState(rpState.economic_current);
  const gdp = asFiniteNumber(economic.gdp);
  const growth = asFiniteNumber(economic.growth);
  const inflation = asFiniteNumber(economic.inflation);
  const unemployment = asFiniteNumber(economic.unemployment);
  const exchangeUsd = asFiniteNumber(economic.exchangeUsd);
  const exchangeEur = asFiniteNumber(economic.exchangeEur);
  const inflationTarget = asFiniteNumber(dashboard.state?.inflation_target);
  const economicCycle = classifyEconomicCycle({
    growth,
    inflation,
    target: inflationTarget,
  });

  return {
    ...dashboard,
    generated_at: rpState.updated_at || dashboard.generated_at,
    state: {
      ...(dashboard.state || {}),
      country_code: rpState.country_code,
      country_rp_active: true,
      national_source: 'GOV.RP',
      national_updated_at: rpState.updated_at,
      ...(economicCycle ? { economic_cycle: economicCycle } : {}),
      ...(exchangeUsd !== null ? { exchange_rate: exchangeUsd } : {}),
      ...(exchangeEur !== null ? { exchange_eur: exchangeEur } : {}),
      player_share: asFiniteNumber(rpState.player_share) ?? 0.5,
      simulated_share: asFiniteNumber(rpState.simulated_share) ?? 0.5,
    },
    headline: {
      ...(dashboard.headline || {}),
      ...(gdp !== null ? {
        gdp_total: gdp,
        gdp_nominal: gdp,
        gdp_real: gdp,
        gdp_currency: economic.gdpCurrency || 'USD',
      } : {}),
      ...(growth !== null ? {
        gdp_growth_year_over_year: growth,
        gdp_growth_quarterly: null,
      } : {}),
      ...(inflation !== null ? { inflation_annual: inflation } : {}),
      ...(unemployment !== null ? { unemployment_rate: unemployment } : {}),
    },
    sectors: scaleSectorsToNationalGdp(dashboard.sectors, gdp),
    history: normalizeSnapshotHistory(snapshots, economic),
    national: {
      countryCode: rpState.country_code,
      source: 'GOV.RP',
      referenceSnapshotAt: rpState.reference_snapshot_at,
      updatedAt: rpState.updated_at,
      economic,
    },
  };
};
