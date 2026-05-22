export const GOVERNMENT_BUDGET_AREA_NAMES = [
  'Saúde',
  'Segurança',
  'Defesa',
  'Educação',
  'Tecnologia',
  'Meio Ambiente',
  'Infraestrutura',
  'Cultura',
  'Relações Exteriores',
  'Economia',
  'Pesquisa',
];

const toWholeBudgetValue = (value) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.max(0, Math.floor(numericValue));
};

export const hydrateGovernmentBudgetAreas = (budgetAreas = []) =>
  GOVERNMENT_BUDGET_AREA_NAMES.map((name) => {
    const existingArea = (budgetAreas || []).find((area) => area?.name === name);

    return {
      name,
      allocated_value: toWholeBudgetValue(existingArea?.allocated_value),
    };
  });

export const getGovernmentBudgetTotal = (areas = []) =>
  (areas || []).reduce((sum, area) => sum + toWholeBudgetValue(area?.allocated_value), 0);

export const rebalanceGovernmentBudgetAreas = (budgetAreas = [], treasuryBalance = 0) => {
  const hydratedAreas = hydrateGovernmentBudgetAreas(budgetAreas);
  const safeTreasuryBalance = toWholeBudgetValue(treasuryBalance);
  const currentTotal = getGovernmentBudgetTotal(hydratedAreas);

  if (safeTreasuryBalance === 0) {
    return hydratedAreas.map((area) => ({
      ...area,
      allocated_value: 0,
    }));
  }

  // Saldo livre do cofre deve continuar livre; só reduzimos alocações quando elas excedem o cofre.
  if (currentTotal === 0 || currentTotal <= safeTreasuryBalance) {
    return hydratedAreas;
  }

  const proportionalAreas = hydratedAreas.map((area, index) => {
    const rawAllocation = (area.allocated_value / currentTotal) * safeTreasuryBalance;
    const flooredAllocation = Math.floor(rawAllocation);

    return {
      ...area,
      allocated_value: flooredAllocation,
      remainder: rawAllocation - flooredAllocation,
      originalIndex: index,
    };
  });

  let remainingUnits =
    safeTreasuryBalance -
    proportionalAreas.reduce((sum, area) => sum + area.allocated_value, 0);

  if (remainingUnits > 0) {
    [...proportionalAreas]
      .sort((left, right) => {
        if (right.remainder !== left.remainder) {
          return right.remainder - left.remainder;
        }

        return left.originalIndex - right.originalIndex;
      })
      .slice(0, remainingUnits)
      .forEach((area) => {
        area.allocated_value += 1;
      });
  }

  return proportionalAreas
    .sort((left, right) => left.originalIndex - right.originalIndex)
    .map(({ remainder, originalIndex, ...area }) => area);
};

export const haveGovernmentBudgetAreasChanged = (leftAreas = [], rightAreas = []) => {
  const normalizedLeft = hydrateGovernmentBudgetAreas(leftAreas);
  const normalizedRight = hydrateGovernmentBudgetAreas(rightAreas);

  return normalizedLeft.some((area, index) => {
    const comparedArea = normalizedRight[index];

    return (
      area.name !== comparedArea?.name ||
      toWholeBudgetValue(area.allocated_value) !== toWholeBudgetValue(comparedArea?.allocated_value)
    );
  });
};
