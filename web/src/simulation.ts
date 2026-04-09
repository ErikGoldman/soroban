import {
  normalizeAssetCorrelationPair,
  type AssetCashGenerationDefinition,
  type AssetCorrelationDefinition,
  type AssetSaleTaxDefinition,
} from "./finance.js";
import {
  computeHouseholdTaxes,
  type HouseholdTaxBreakdown,
  type HouseholdTaxInput,
  type HouseholdTaxProfileDefinition,
  type Tax,
} from "./tax.js";

export type SimulationPercentile = 5 | 10 | 25 | 50 | 75 | 90;

export interface SimulationAssetInput {
  name: string;
  startingValue: number;
  expectedReturn: number;
  volatility: number;
  sellProportion: number;
  cashGeneration?: AssetCashGenerationDefinition;
  cashGenerations?: readonly AssetCashGenerationDefinition[];
  saleTax?: AssetSaleTaxDefinition;
}

export interface SimulationYearlySnapshot {
  label: string;
  netAmount: number;
  totalExpenses: number;
  flowAmounts: Map<string, number>;
  householdTaxInput: HouseholdTaxInput;
}

export interface SimulationAssetReturn {
  amount: number;
  percentage: number;
}

export interface SimulationYearRow {
  yearNumber: number;
  label: string;
  depletionProbability: number;
  totalAssets: number;
}

export interface SimulationScenario {
  percentile: SimulationPercentile;
  rows: SimulationYearRow[];
  finalTotalAssets: number;
}

export interface SimulationDetailYearRow {
  yearNumber: number;
  label: string;
  startingAssets: number;
  endingAssets: number;
  totalExpenses: number;
  totalGains: number;
  taxableGains: number;
  taxAmount: number;
  depletionProbability: number;
  householdTaxInput: HouseholdTaxInput;
  flowTotals: Map<string, number>;
  assetValues: Map<string, number>;
  assetReturns: Map<string, SimulationAssetReturn>;
  totalAssets: number;
  taxBreakdown: HouseholdTaxBreakdown;
}

export interface SimulationDetailScenario {
  rows: SimulationDetailYearRow[];
  finalTotalAssets: number;
}

export interface BuildSimulationScenariosInput {
  attempts: number;
  horizonYears: number;
  yearlySnapshots: readonly SimulationYearlySnapshot[];
  assets: readonly SimulationAssetInput[];
  assetCorrelations: readonly AssetCorrelationDefinition[];
  taxes?: readonly Tax[];
  householdTaxProfile?: HouseholdTaxProfileDefinition | null;
  nextStandardNormal?: () => number;
}

interface NormalizedSimulationAsset {
  name: string;
  startingValue: number;
  expectedReturn: number;
  volatility: number;
  sellProportion: number;
  cashGenerations: readonly AssetCashGenerationDefinition[];
  saleTax?: AssetSaleTaxDefinition;
}

interface SaleIterationResult {
  assetValues: Map<string, number>;
  assetCostBases: Map<string, number>;
  flowTotals: Map<string, number>;
  taxInput: HouseholdTaxInput;
  preTaxCashBalance: number;
  taxableGains: number;
}

interface SimulationExecutionResult {
  scenarios: SimulationDetailScenario[];
  yearlyTotals: number[][];
  depletionCountsByYear: number[];
}

export interface SimulationExecutionProgress {
  completedAttempts: number;
  totalAttempts: number;
}

export interface BuildSimulationExecutionOptions {
  onProgress?: (progress: SimulationExecutionProgress) => void;
  progressInterval?: number;
}

export interface BuildSimulationExecutionResult {
  scenarios: Map<SimulationPercentile, SimulationScenario>;
  details: SimulationDetailScenario[];
}

export function getAssetCorrelationValue(
  assetCorrelations: readonly AssetCorrelationDefinition[],
  assetA: string,
  assetB: string
): number {
  if (assetA === assetB) {
    return 1;
  }

  const pair = normalizeAssetCorrelationPair(assetA, assetB);
  return (
    assetCorrelations.find(
      (correlation) => correlation.assetA === pair.assetA && correlation.assetB === pair.assetB
    )?.correlation ?? 0
  );
}

export function buildCorrelationMatrix(
  assetNames: readonly string[],
  assetCorrelations: readonly AssetCorrelationDefinition[]
): number[][] {
  return assetNames.map((assetA) =>
    assetNames.map((assetB) => getAssetCorrelationValue(assetCorrelations, assetA, assetB))
  );
}

export function choleskyDecomposition(matrix: readonly (readonly number[])[]): number[][] {
  const size = matrix.length;
  const lower = Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
  const tolerance = 1e-12;

  for (let row = 0; row < size; row += 1) {
    if (matrix[row]?.length !== size) {
      throw new Error("Correlation matrix must be square.");
    }

    for (let column = 0; column < size; column += 1) {
      const value = matrix[row][column];
      if (!Number.isFinite(value)) {
        throw new Error("Correlation matrix entries must be finite.");
      }

      if (Math.abs(value - matrix[column][row]) > tolerance) {
        throw new Error("Correlation matrix must be symmetric.");
      }
    }
  }

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      let sum = 0;
      for (let index = 0; index < column; index += 1) {
        sum += lower[row][index] * lower[column][index];
      }

      const residual = matrix[row][column] - sum;

      if (row === column) {
        if (residual < -tolerance) {
          throw new Error("Correlation matrix must be positive semidefinite.");
        }

        lower[row][column] = residual <= tolerance ? 0 : Math.sqrt(residual);
      } else {
        if (Math.abs(lower[column][column]) <= tolerance) {
          if (Math.abs(residual) > tolerance) {
            throw new Error("Correlation matrix must be positive semidefinite.");
          }

          lower[row][column] = 0;
          continue;
        }

        lower[row][column] = residual / lower[column][column];
      }
    }
  }

  return lower;
}

export function randomStandardNormal(): number {
  let u = 0;
  let v = 0;

  while (u === 0) {
    u = Math.random();
  }

  while (v === 0) {
    v = Math.random();
  }

  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function createCorrelatedNormals(
  assetNames: readonly string[],
  assetCorrelations: readonly AssetCorrelationDefinition[],
  nextStandardNormal: () => number = randomStandardNormal
): Map<string, number> {
  const correlationMatrix = buildCorrelationMatrix(assetNames, assetCorrelations);
  const cholesky = choleskyDecomposition(correlationMatrix);
  const independentNormals = assetNames.map(() => nextStandardNormal());
  const correlatedNormals = new Map<string, number>();

  for (let row = 0; row < assetNames.length; row += 1) {
    let value = 0;
    for (let column = 0; column <= row; column += 1) {
      value += cholesky[row][column] * independentNormals[column];
    }
    correlatedNormals.set(assetNames[row], value);
  }

  return correlatedNormals;
}

export function buildSimulationScenarios({
  attempts,
  horizonYears,
  yearlySnapshots,
  assets,
  assetCorrelations,
  taxes = [],
  householdTaxProfile = null,
  nextStandardNormal = randomStandardNormal,
}: BuildSimulationScenariosInput): Map<SimulationPercentile, SimulationScenario> {
  return buildSimulationExecution({
    attempts,
    horizonYears,
    yearlySnapshots,
    assets,
    assetCorrelations,
    taxes,
    householdTaxProfile,
    nextStandardNormal,
  }).scenarios;
}

export function buildSimulationExecution(
  {
    attempts,
    horizonYears,
    yearlySnapshots,
    assets,
    assetCorrelations,
    taxes = [],
    householdTaxProfile = null,
    nextStandardNormal = randomStandardNormal,
  }: BuildSimulationScenariosInput,
  { onProgress, progressInterval }: BuildSimulationExecutionOptions = {}
): BuildSimulationExecutionResult {
  const { scenarios, yearlyTotals, depletionCountsByYear } = runSimulationAttempts(
    {
      attempts,
      horizonYears,
      yearlySnapshots,
      assets,
      assetCorrelations,
      taxes,
      householdTaxProfile,
      nextStandardNormal,
    },
    {
      onProgress,
      progressInterval,
    }
  );
  return {
    scenarios: buildSimulationScenarioSummaries({
      attempts,
      horizonYears,
      yearlySnapshots,
      yearlyTotals,
      depletionCountsByYear,
    }),
    details: scenarios,
  };
}

export function buildSimulationScenariosFromDetails({
  attempts,
  horizonYears,
  yearlySnapshots,
  details,
}: {
  attempts: number;
  horizonYears: number;
  yearlySnapshots: readonly SimulationYearlySnapshot[];
  details: readonly SimulationDetailScenario[];
}): Map<SimulationPercentile, SimulationScenario> {
  const yearlyTotals = Array.from({ length: horizonYears }, () => [] as number[]);
  const depletionCountsByYear = Array.from({ length: horizonYears }, () => 0);

  for (const scenario of details) {
    for (let rowIndex = 0; rowIndex < horizonYears; rowIndex += 1) {
      const row = scenario.rows[rowIndex];
      if (!row) {
        continue;
      }

      yearlyTotals[rowIndex]?.push(row.totalAssets);
      if (row.totalAssets <= 0) {
        depletionCountsByYear[rowIndex] += 1;
      }
    }
  }

  return buildSimulationScenarioSummaries({
    attempts,
    horizonYears,
    yearlySnapshots,
    yearlyTotals,
    depletionCountsByYear,
  });
}

function buildSimulationScenarioSummaries({
  attempts,
  horizonYears,
  yearlySnapshots,
  yearlyTotals,
  depletionCountsByYear,
}: {
  attempts: number;
  horizonYears: number;
  yearlySnapshots: readonly SimulationYearlySnapshot[];
  yearlyTotals: readonly (readonly number[])[];
  depletionCountsByYear: readonly number[];
}): Map<SimulationPercentile, SimulationScenario> {
  const rowCount = Math.min(horizonYears, yearlySnapshots.length);
  const results = new Map<SimulationPercentile, SimulationScenario>();

  for (const percentile of [5, 10, 25, 50, 75, 90] as const) {
    const rows: SimulationYearRow[] = [];
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const snapshot = yearlySnapshots[rowIndex];
      const yearlyPercentileTotalAssets = selectPercentileValue(yearlyTotals[rowIndex] ?? [], percentile);
      if (!snapshot || yearlyPercentileTotalAssets === null) {
        continue;
      }
      rows.push({
        yearNumber: rowIndex + 1,
        label: snapshot.label,
        depletionProbability: ((depletionCountsByYear[rowIndex] ?? 0) / attempts) * 100,
        totalAssets: yearlyPercentileTotalAssets,
      });
    }
    results.set(percentile, {
      percentile,
      rows,
      finalTotalAssets: rows[rows.length - 1]?.totalAssets ?? 0,
    });
  }

  return results;
}

export function buildSimulationDetails({
  attempts,
  horizonYears,
  yearlySnapshots,
  assets,
  assetCorrelations,
  taxes = [],
  householdTaxProfile = null,
  nextStandardNormal = randomStandardNormal,
}: BuildSimulationScenariosInput): SimulationDetailScenario[] {
  return buildSimulationExecution({
    attempts,
    horizonYears,
    yearlySnapshots,
    assets,
    assetCorrelations,
    taxes,
    householdTaxProfile,
    nextStandardNormal,
  }).details;
}

export function selectRepresentativeSimulationScenario(
  detailScenarios: readonly SimulationDetailScenario[],
  targetRows: readonly SimulationYearRow[]
): SimulationDetailScenario | null {
  if (detailScenarios.length === 0 || targetRows.length === 0) {
    return null;
  }

  const targetRowsByYear = new Map(targetRows.map((row) => [row.yearNumber, row]));
  const candidates = detailScenarios
    .map((scenario) => {
      let totalDistance = 0;
      let matchedYears = 0;

      for (const row of scenario.rows) {
        const targetRow = targetRowsByYear.get(row.yearNumber);
        if (!targetRow) {
          continue;
        }

        totalDistance += Math.abs(row.totalAssets - targetRow.totalAssets);
        matchedYears += 1;
      }

      return {
        scenario,
        totalDistance,
        matchedYears,
      };
    })
    .filter((candidate) => candidate.matchedYears > 0);

  if (candidates.length === 0) {
    return null;
  }

  const finalTargetTotalAssets = targetRows[targetRows.length - 1]?.totalAssets ?? 0;
  candidates.sort((left, right) => {
    if (left.matchedYears !== right.matchedYears) {
      return right.matchedYears - left.matchedYears;
    }

    const distanceDifference = left.totalDistance - right.totalDistance;
    if (Math.abs(distanceDifference) > 0.000001) {
      return distanceDifference;
    }

    return (
      Math.abs(left.scenario.finalTotalAssets - finalTargetTotalAssets) -
      Math.abs(right.scenario.finalTotalAssets - finalTargetTotalAssets)
    );
  });

  return candidates[0]?.scenario ?? null;
}

function runSimulationAttempts({
  attempts,
  horizonYears,
  yearlySnapshots,
  assets,
  assetCorrelations,
  taxes = [],
  householdTaxProfile = null,
  nextStandardNormal,
}: BuildSimulationScenariosInput,
{
  onProgress,
  progressInterval = Math.max(1, Math.floor(attempts / 100)),
}: BuildSimulationExecutionOptions = {}): SimulationExecutionResult {
  const scenarios: SimulationDetailScenario[] = [];
  const yearlyTotals = Array.from({ length: horizonYears }, () => [] as number[]);
  const depletionCountsByYear = Array.from({ length: horizonYears }, () => 0);
  const normalizedAssets = assets.map(normalizeSimulationAsset);
  const assetNames = normalizedAssets.map((asset) => asset.name);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let assetValues = new Map(normalizedAssets.map((asset) => [asset.name, asset.startingValue]));
    let assetCostBases = new Map(
      normalizedAssets.map((asset) => [asset.name, Math.min(asset.saleTax?.costBasis ?? asset.startingValue, asset.startingValue)])
    );
    const yearlyRows: SimulationDetailYearRow[] = [];

    for (let yearIndex = 0; yearIndex < horizonYears; yearIndex += 1) {
      const snapshot = yearlySnapshots[yearIndex];
      if (!snapshot) {
        break;
      }

      const startingTotalAssets = [...assetValues.values()].reduce((total, value) => total + value, 0);
      const flowTotals = new Map(snapshot.flowAmounts);
      const annualCorrelatedNormals = createCorrelatedNormals(assetNames, assetCorrelations, nextStandardNormal);
      const annualPriceReturns = new Map(
        normalizedAssets.map((asset) => [
          asset.name,
          clampAnnualReturn(
            asset.expectedReturn / 100 + (asset.volatility / 100) * (annualCorrelatedNormals.get(asset.name) ?? 0)
          ),
        ])
      );

      const taxInputWithCashGeneration = applyCashGeneration(
        snapshot.householdTaxInput,
        normalizedAssets,
        assetValues,
        annualCorrelatedNormals,
        flowTotals
      );

      const contributionAmounts = new Map(
        assetNames.map((assetName) => [assetName, Math.max(0, snapshot.flowAmounts.get(assetName) ?? 0)])
      );
      for (const [assetName, amount] of taxInputWithCashGeneration.reinvestmentSources) {
        contributionAmounts.set(assetName, (contributionAmounts.get(assetName) ?? 0) + amount);
      }

      let saleResult = resolveSalesForCashNeed({
        cashNeeded: Math.max(0, -(snapshot.netAmount + taxInputWithCashGeneration.generatedCashTotal)),
        assets: normalizedAssets,
        assetValues,
        assetCostBases,
        flowTotals,
        baseTaxInput: taxInputWithCashGeneration.taxInput,
      });
      const baseCashBalance = snapshot.netAmount + taxInputWithCashGeneration.generatedCashTotal;
      let totalTaxableGains = saleResult.taxableGains;
      let totalCashRaised = saleResult.preTaxCashBalance;

      let taxBreakdown =
        householdTaxProfile === null
          ? emptyHouseholdTaxBreakdown()
          : computeHouseholdTaxes(saleResult.taxInput, householdTaxProfile, taxes);

      for (let iteration = 0; iteration < 5; iteration += 1) {
        const postTaxCashBalance = baseCashBalance + totalCashRaised - taxBreakdown.totalTax;
        if (postTaxCashBalance >= -0.000001) {
          break;
        }

        saleResult = resolveSalesForCashNeed({
          cashNeeded: Math.abs(postTaxCashBalance),
          assets: normalizedAssets,
          assetValues: saleResult.assetValues,
          assetCostBases: saleResult.assetCostBases,
          flowTotals: saleResult.flowTotals,
          baseTaxInput: saleResult.taxInput,
        });
        totalCashRaised += saleResult.preTaxCashBalance;
        totalTaxableGains += saleResult.taxableGains;
        taxBreakdown =
          householdTaxProfile === null
            ? emptyHouseholdTaxBreakdown()
            : computeHouseholdTaxes(saleResult.taxInput, householdTaxProfile, taxes);
      }

      const flowTotalsWithTaxes = new Map(saleResult.flowTotals);
      if (Math.abs(taxBreakdown.totalTax) > 0.000001) {
        flowTotalsWithTaxes.set("Taxes paid", -taxBreakdown.totalTax);
      }

      const totalExpenses = snapshot.totalExpenses + taxBreakdown.totalTax;
      const postTaxSurplus = baseCashBalance + totalCashRaised - taxBreakdown.totalTax;
      if (postTaxSurplus > 0 && normalizedAssets.length > 0) {
        const reinvestmentAmounts = buildSurplusReinvestmentAmounts(postTaxSurplus, contributionAmounts, assetNames);
        for (const [assetName, reinvestmentAmount] of reinvestmentAmounts) {
          saleResult.assetValues.set(assetName, (saleResult.assetValues.get(assetName) ?? 0) + reinvestmentAmount);
          saleResult.assetCostBases.set(assetName, (saleResult.assetCostBases.get(assetName) ?? 0) + reinvestmentAmount);
        }
      }

      const assetReturns = new Map(
        normalizedAssets.map((asset) => {
          const currentValue = saleResult.assetValues.get(asset.name) ?? 0;
          const annualReturn = annualPriceReturns.get(asset.name) ?? 0;
          const nextValue = Math.max(0, currentValue * (1 + annualReturn));
          saleResult.assetValues.set(asset.name, nextValue);
          return [
            asset.name,
            {
              amount: nextValue - currentValue,
              percentage: annualReturn * 100,
            },
          ];
        })
      );

      const yearAssetValues = new Map(
        normalizedAssets.map((asset) => [asset.name, saleResult.assetValues.get(asset.name) ?? 0])
      );
      const finalTotalAssets = [...yearAssetValues.values()].reduce((total, value) => total + value, 0);
      const totalGains = finalTotalAssets - startingTotalAssets + totalExpenses;
      assetValues = saleResult.assetValues;
      assetCostBases = saleResult.assetCostBases;
      yearlyTotals[yearIndex]?.push(finalTotalAssets);
      if (finalTotalAssets <= 0) {
        depletionCountsByYear[yearIndex] += 1;
      }

      yearlyRows.push({
        yearNumber: yearIndex + 1,
        label: snapshot.label,
        startingAssets: startingTotalAssets,
        endingAssets: finalTotalAssets,
        totalExpenses,
        totalGains,
        taxableGains: totalTaxableGains,
        taxAmount: taxBreakdown.totalTax,
        depletionProbability: ((depletionCountsByYear[yearIndex] ?? 0) / Math.max(1, attempt + 1)) * 100,
        householdTaxInput: saleResult.taxInput,
        flowTotals: flowTotalsWithTaxes,
        assetValues: yearAssetValues,
        assetReturns,
        totalAssets: finalTotalAssets,
        taxBreakdown,
      });
    }

    scenarios.push({
      rows: yearlyRows,
      finalTotalAssets: yearlyRows[yearlyRows.length - 1]?.totalAssets ?? 0,
    });

    if (onProgress && ((attempt + 1) % progressInterval === 0 || attempt === attempts - 1)) {
      onProgress({
        completedAttempts: attempt + 1,
        totalAttempts: attempts,
      });
    }
  }

  return {
    scenarios,
    yearlyTotals,
    depletionCountsByYear,
  };
}

function selectPercentileValue(values: readonly number[], percentile: SimulationPercentile): number | null {
  if (values.length === 0) {
    return null;
  }

  const sortedValues = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * sortedValues.length) - 1)
  );
  return sortedValues[index] ?? null;
}

function normalizeSimulationAsset(asset: SimulationAssetInput): NormalizedSimulationAsset {
  const cashGenerations =
    asset.cashGenerations && asset.cashGenerations.length > 0
      ? asset.cashGenerations
      : asset.cashGeneration
        ? [asset.cashGeneration]
        : [];
  return {
    ...asset,
    sellProportion: Math.max(0, Math.min(1, asset.sellProportion || 0)),
    cashGenerations: cashGenerations.map((cashGeneration, index) => ({
      name: cashGeneration.name?.trim() || `Cash generation ${index + 1}`,
      rate: Math.max(0, cashGeneration.rate),
      volatility: Math.max(0, cashGeneration.volatility),
      taxTreatment: cashGeneration.taxTreatment ?? "ordinary-income",
    })),
    saleTax: asset.saleTax
      ? {
          costBasis: Math.max(0, asset.saleTax.costBasis),
          taxTreatment: asset.saleTax.taxTreatment ?? "long-term-capital-gains",
        }
      : undefined,
  };
}

function clampAnnualReturn(value: number): number {
  return Math.max(-0.999999, value);
}

function applyCashGeneration(
  baseTaxInput: HouseholdTaxInput,
  assets: readonly NormalizedSimulationAsset[],
  assetValues: ReadonlyMap<string, number>,
  annualNormals: ReadonlyMap<string, number>,
  flowTotals: Map<string, number>
): {
  taxInput: HouseholdTaxInput;
  generatedCashTotal: number;
  reinvestmentSources: Map<string, number>;
} {
  const taxInput: HouseholdTaxInput = { ...baseTaxInput };
  const reinvestmentSources = new Map<string, number>();
  let generatedCashTotal = 0;

  for (const asset of assets) {
    const currentValue = assetValues.get(asset.name) ?? 0;
    for (const cashGeneration of asset.cashGenerations) {
      const generatedCash = calculateAssetCashGenerationAmount(
        currentValue,
        annualNormals.get(asset.name) ?? 0,
        cashGeneration
      );
      if (generatedCash <= 0.000001) {
        continue;
      }

      generatedCashTotal += generatedCash;
      reinvestmentSources.set(asset.name, (reinvestmentSources.get(asset.name) ?? 0) + generatedCash);
      flowTotals.set(`${asset.name} ${cashGeneration.name}`, generatedCash);
      applyTaxTreatmentAmount(taxInput, cashGeneration.taxTreatment ?? "ordinary-income", generatedCash);
    }
  }

  return {
    taxInput,
    generatedCashTotal,
    reinvestmentSources,
  };
}

function resolveSalesForCashNeed({
  cashNeeded,
  assets,
  assetValues,
  assetCostBases,
  flowTotals,
  baseTaxInput,
}: {
  cashNeeded: number;
  assets: readonly NormalizedSimulationAsset[];
  assetValues: ReadonlyMap<string, number>;
  assetCostBases: ReadonlyMap<string, number>;
  flowTotals: Map<string, number>;
  baseTaxInput: HouseholdTaxInput;
}): SaleIterationResult {
  const nextAssetValues = new Map(assetValues);
  const nextAssetCostBases = new Map(assetCostBases);
  const nextFlowTotals = new Map(flowTotals);
  const nextTaxInput: HouseholdTaxInput = { ...baseTaxInput };
  let remainingCashNeed = Math.max(0, cashNeeded);
  let taxableGains = 0;
  let preTaxCashBalance = -remainingCashNeed;

  if (remainingCashNeed <= 0.000001) {
    return {
      assetValues: nextAssetValues,
      assetCostBases: nextAssetCostBases,
      flowTotals: nextFlowTotals,
      taxInput: nextTaxInput,
      preTaxCashBalance: 0,
      taxableGains,
    };
  }

  while (remainingCashNeed > 0.000001) {
    const sellableAssets = assets.filter(
      (asset) => asset.sellProportion > 0 && (nextAssetValues.get(asset.name) ?? 0) > 0
    );
    const totalSellWeight = sellableAssets.reduce((total, asset) => total + asset.sellProportion, 0);
    if (totalSellWeight <= 0) {
      break;
    }

    let grossProceedsThisRound = 0;
    for (const asset of sellableAssets) {
      const currentValue = nextAssetValues.get(asset.name) ?? 0;
      const amountSold = Math.min(currentValue, remainingCashNeed * (asset.sellProportion / totalSellWeight));
      if (amountSold <= 0.000001) {
        continue;
      }

      const currentCostBasis = nextAssetCostBases.get(asset.name) ?? 0;
      const basisReduction = currentValue <= 0 ? 0 : Math.min(currentCostBasis, currentCostBasis * (amountSold / currentValue));
      const realizedGain = Math.max(0, amountSold - basisReduction);

      nextAssetValues.set(asset.name, currentValue - amountSold);
      nextAssetCostBases.set(asset.name, Math.max(0, currentCostBasis - basisReduction));
      nextFlowTotals.set(`${asset.name} sale proceeds`, (nextFlowTotals.get(`${asset.name} sale proceeds`) ?? 0) + amountSold);
      grossProceedsThisRound += amountSold;

      if (realizedGain > 0.000001) {
        taxableGains += realizedGain;
        applyTaxTreatmentAmount(nextTaxInput, asset.saleTax?.taxTreatment ?? "long-term-capital-gains", realizedGain);
        nextFlowTotals.set(`${asset.name} realized gain`, (nextFlowTotals.get(`${asset.name} realized gain`) ?? 0) + realizedGain);
      }
    }

    if (grossProceedsThisRound <= 0.000001) {
      break;
    }

    remainingCashNeed -= grossProceedsThisRound;
  }

  preTaxCashBalance = Math.max(0, cashNeeded - remainingCashNeed);

  return {
    assetValues: nextAssetValues,
    assetCostBases: nextAssetCostBases,
    flowTotals: nextFlowTotals,
    taxInput: nextTaxInput,
    preTaxCashBalance,
    taxableGains,
  };
}

function buildSurplusReinvestmentAmounts(
  availableSurplus: number,
  contributionAmounts: ReadonlyMap<string, number>,
  assetNames: readonly string[]
): Map<string, number> {
  const reinvestmentAmounts = new Map<string, number>();
  let remainingSurplus = Math.max(0, availableSurplus);

  for (const assetName of assetNames) {
    if (remainingSurplus <= 0.000001) {
      break;
    }

    const matchedFlowAmount = Math.max(0, contributionAmounts.get(assetName) ?? 0);
    if (matchedFlowAmount <= 0) {
      continue;
    }

    const reinvestmentAmount = Math.min(matchedFlowAmount, remainingSurplus);
    reinvestmentAmounts.set(assetName, reinvestmentAmount);
    remainingSurplus -= reinvestmentAmount;
  }

  if (remainingSurplus > 0.000001 && assetNames.length > 0) {
    const fallbackAssetName = assetNames[0];
    reinvestmentAmounts.set(
      fallbackAssetName,
      (reinvestmentAmounts.get(fallbackAssetName) ?? 0) + remainingSurplus
    );
  }

  return reinvestmentAmounts;
}

function calculateAssetCashGenerationAmount(
  assetValue: number,
  annualNormal: number,
  cashGeneration: AssetCashGenerationDefinition | undefined
): number {
  if (!cashGeneration) {
    return 0;
  }

  const annualCashGenerationRate = Math.max(
    0,
    cashGeneration.rate / 100 + (cashGeneration.volatility / 100) * annualNormal
  );
  return assetValue * annualCashGenerationRate;
}

function applyTaxTreatmentAmount(
  taxInput: HouseholdTaxInput,
  taxTreatment:
    | "wages"
    | "ordinary-income"
    | "qualified-dividends"
    | "short-term-capital-gains"
    | "long-term-capital-gains"
    | "tax-exempt-income"
    | "deductible-expense"
    | "nondeductible-expense"
    | "not-taxable",
  amount: number
): void {
  switch (taxTreatment) {
    case "wages":
      taxInput.wages += amount;
      break;
    case "ordinary-income":
      taxInput.ordinaryIncome += amount;
      break;
    case "qualified-dividends":
      taxInput.qualifiedDividends += amount;
      break;
    case "short-term-capital-gains":
      taxInput.shortTermCapitalGains += amount;
      break;
    case "long-term-capital-gains":
      taxInput.longTermCapitalGains += amount;
      break;
    case "tax-exempt-income":
      taxInput.taxExemptIncome += amount;
      break;
    case "deductible-expense":
      taxInput.deductibleExpenses += amount;
      break;
    case "nondeductible-expense":
    case "not-taxable":
      break;
  }
}

function emptyHouseholdTaxBreakdown(): HouseholdTaxBreakdown {
  return {
    federalOrdinaryTaxableIncome: 0,
    federalPreferentialIncome: 0,
    federalTaxableIncome: 0,
    stateTaxableIncome: 0,
    localTaxableIncome: 0,
    modifiedAdjustedGrossIncome: 0,
    netInvestmentIncome: 0,
    niitIncomeAboveThreshold: 0,
    niitTaxableIncome: 0,
    deductionUsed: 0,
    totalTax: 0,
    taxByName: new Map(),
  };
}
