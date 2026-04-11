import {
  normalizeAssetCorrelationPair,
  type AssetCashGenerationDefinition,
  type AssetCorrelationDefinition,
  type HomeAssetDefinition,
  type InvestmentAssetDefinition,
  type AssetSaleTaxDefinition,
} from "./finance.js";
import {
  computeHouseholdTaxes,
  type FilingStatus,
  type HouseholdTaxBreakdown,
  type HouseholdTaxInput,
  type HouseholdTaxProfileDefinition,
  summarizeNetCapitalGainAmounts,
  type Tax,
} from "./tax.js";

export type SimulationPercentile = 5 | 10 | 25 | 50 | 75 | 90;
export const VARIABLE_SWEEP_STEP_COUNT = 10;

export interface SimulationInvestmentAssetInput extends InvestmentAssetDefinition {
  kind?: "investment";
}

export interface SimulationHomeAssetInput extends HomeAssetDefinition {
  kind: "home";
}

export type SimulationAssetInput = SimulationInvestmentAssetInput | SimulationHomeAssetInput;

export interface SimulationYearlySnapshot {
  year?: number;
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
  liquidAssets?: number;
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
  liquidAssets?: number;
  totalExpenses: number;
  totalGains: number;
  taxableGains: number;
  taxAmount: number;
  depleted: boolean;
  depletionProbability: number;
  householdTaxInput: HouseholdTaxInput;
  flowTotals: Map<string, number>;
  assetValues: Map<string, number>;
  assetMarketValues?: Map<string, number>;
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

interface NormalizedSimulationInvestmentAsset {
  kind: "investment";
  name: string;
  startingValue: number;
  expectedReturn: number;
  volatility: number;
  // Stored in the historical sellProportion field, but interpreted as a sale multiplier.
  sellProportion: number;
  cashGenerations: readonly AssetCashGenerationDefinition[];
  saleTax?: AssetSaleTaxDefinition;
}

interface NormalizedSimulationHomeAsset {
  kind: "home";
  name: string;
  initialCost: number;
  expectedReturn: number;
  volatility: number;
  cashPurchasePercent: number;
  mortgageType: "amortizing" | "interest-only";
  interestOnlyMaturityAction: "payoff" | "refinance" | "sell";
  mortgageRate: number;
  mortgageTermYears: number;
  monthlyNonTaxCosts: number;
  propertyTaxRate: number;
  purchaseYear: number;
}

type NormalizedSimulationAsset = NormalizedSimulationInvestmentAsset | NormalizedSimulationHomeAsset;

interface HomeSimulationState {
  marketValues: Map<string, number>;
  mortgageBalances: Map<string, number>;
  mortgageStates: Map<string, HomeMortgageState>;
}

interface HomeMortgageState {
  mortgageType: "amortizing" | "interest-only";
  mortgageRate: number;
  mortgageTermMonths: number;
  monthsElapsed: number;
  interestOnlyMaturityAction: "payoff" | "refinance" | "sell";
}

interface CapitalLossCarryforwardState {
  shortTermCapitalLoss: number;
  longTermCapitalLoss: number;
}

interface SaleIterationResult {
  assetValues: Map<string, number>;
  assetCostBases: Map<string, number>;
  flowTotals: Map<string, number>;
  taxInput: HouseholdTaxInput;
  preTaxCashBalance: number;
  taxableGains: number;
}

interface GeneratedCashStreamsResult {
  taxInput: HouseholdTaxInput;
  generatedCashTotal: number;
  reinvestmentSources: Map<string, number>;
  expenseTotal: number;
}

interface SimulationExecutionResult {
  scenarios: SimulationDetailScenario[];
  yearlyTotals: number[][];
  yearlyLiquidTotals: number[][];
  depletionCountsByYear: number[];
}

export interface SimulationExecutionProgress {
  completedAttempts: number;
  totalAttempts: number;
}

export interface BuildSimulationExecutionOptions {
  onProgress?: (progress: SimulationExecutionProgress) => void;
  progressInterval?: number;
  detailSampleLimit?: number | null;
  includeAggregates?: boolean;
}

export interface BuildSimulationExecutionResult {
  scenarios: Map<SimulationPercentile, SimulationScenario>;
  details: SimulationDetailScenario[];
  yearlyTotals?: number[][];
  yearlyLiquidTotals?: number[][];
  depletionCountsByYear?: number[];
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

export function buildVariableSweepValues(
  minValue: number,
  maxValue: number,
  stepCount: number = VARIABLE_SWEEP_STEP_COUNT
): number[] {
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
    throw new Error("Variable sweep bounds must be finite.");
  }

  if (!Number.isInteger(stepCount) || stepCount < 2) {
    throw new Error("Variable sweep step count must be an integer greater than 1.");
  }

  return Array.from({ length: stepCount }, (_, index) => {
    const ratio = index / (stepCount - 1);
    return minValue + (maxValue - minValue) * ratio;
  });
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
  { onProgress, progressInterval, detailSampleLimit = null, includeAggregates = true }: BuildSimulationExecutionOptions = {}
): BuildSimulationExecutionResult {
  const { scenarios, yearlyTotals, yearlyLiquidTotals, depletionCountsByYear } = runSimulationAttempts(
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
      detailSampleLimit,
    }
  );
  return {
    scenarios: buildSimulationScenarioSummaries({
      attempts,
      horizonYears,
      yearlySnapshots,
      yearlyTotals,
      yearlyLiquidTotals,
      depletionCountsByYear,
    }),
    details: scenarios,
    ...(includeAggregates
      ? {
          yearlyTotals,
          yearlyLiquidTotals,
          depletionCountsByYear,
        }
      : {}),
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
  const yearlyLiquidTotals = Array.from({ length: horizonYears }, () => [] as number[]);
  const depletionCountsByYear = Array.from({ length: horizonYears }, () => 0);

  for (const scenario of details) {
    for (let rowIndex = 0; rowIndex < horizonYears; rowIndex += 1) {
      const row = scenario.rows[rowIndex];
      if (!row) {
        continue;
      }

      yearlyTotals[rowIndex]?.push(row.totalAssets);
      yearlyLiquidTotals[rowIndex]?.push(row.liquidAssets ?? 0);
      if (row.depleted) {
        depletionCountsByYear[rowIndex] += 1;
      }
    }
  }

  return buildSimulationScenariosFromAggregates({
    attempts,
    horizonYears,
    yearlySnapshots,
    yearlyTotals,
    yearlyLiquidTotals,
    depletionCountsByYear,
  });
}

export function buildSimulationScenariosFromAggregates({
  attempts,
  horizonYears,
  yearlySnapshots,
  yearlyTotals,
  yearlyLiquidTotals,
  depletionCountsByYear,
}: {
  attempts: number;
  horizonYears: number;
  yearlySnapshots: readonly SimulationYearlySnapshot[];
  yearlyTotals: readonly (readonly number[])[];
  yearlyLiquidTotals: readonly (readonly number[])[];
  depletionCountsByYear: readonly number[];
}): Map<SimulationPercentile, SimulationScenario> {
  return buildSimulationScenarioSummaries({
    attempts,
    horizonYears,
    yearlySnapshots,
    yearlyTotals,
    yearlyLiquidTotals,
    depletionCountsByYear,
  });
}

function buildSimulationScenarioSummaries({
  attempts,
  horizonYears,
  yearlySnapshots,
  yearlyTotals,
  yearlyLiquidTotals,
  depletionCountsByYear,
}: {
  attempts: number;
  horizonYears: number;
  yearlySnapshots: readonly SimulationYearlySnapshot[];
  yearlyTotals: readonly (readonly number[])[];
  yearlyLiquidTotals: readonly (readonly number[])[];
  depletionCountsByYear: readonly number[];
}): Map<SimulationPercentile, SimulationScenario> {
  const rowCount = Math.min(horizonYears, yearlySnapshots.length);
  const results = new Map<SimulationPercentile, SimulationScenario>();

  for (const percentile of [5, 10, 25, 50, 75, 90] as const) {
    const rows: SimulationYearRow[] = [];
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const snapshot = yearlySnapshots[rowIndex];
      const yearlyPercentileTotalAssets = selectPercentileValue(yearlyTotals[rowIndex] ?? [], percentile);
      const yearlyPercentileLiquidAssets = selectPercentileValue(yearlyLiquidTotals[rowIndex] ?? [], percentile);
      if (!snapshot || yearlyPercentileTotalAssets === null) {
        continue;
      }
      rows.push({
        yearNumber: rowIndex + 1,
        label: snapshot.label,
        depletionProbability: ((depletionCountsByYear[rowIndex] ?? 0) / attempts) * 100,
        totalAssets: yearlyPercentileTotalAssets,
        liquidAssets: yearlyPercentileLiquidAssets ?? 0,
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
  detailSampleLimit = null,
}: BuildSimulationExecutionOptions = {}): SimulationExecutionResult {
  const scenarios: SimulationDetailScenario[] = [];
  const yearlyTotals = Array.from({ length: horizonYears }, () => [] as number[]);
  const yearlyLiquidTotals = Array.from({ length: horizonYears }, () => [] as number[]);
  const depletionCountsByYear = Array.from({ length: horizonYears }, () => 0);
  const normalizedAssets = assets.map(normalizeSimulationAsset);
  assertUniqueSimulationAssetNames(normalizedAssets);
  const assetNames = normalizedAssets.map((asset) => asset.name);
  const reinvestableAssetNames = normalizedAssets
    .filter((asset): asset is NormalizedSimulationInvestmentAsset => asset.kind === "investment")
    .map((asset) => asset.name);
  const initialYear = getSnapshotYear(yearlySnapshots[0], 0);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const shouldCaptureScenarioDetails = detailSampleLimit === null || scenarios.length < detailSampleLimit;
    const initialState = initializeSimulationState(normalizedAssets, initialYear);
    let assetValues = initialState.assetValues;
    let assetCostBases = initialState.assetCostBases;
    let capitalLossCarryforward = createEmptyCapitalLossCarryforwardState();
    const homeState = initialState.homeState;
    let hasDepleted = false;
    const yearlyRows: SimulationDetailYearRow[] = [];

    for (let yearIndex = 0; yearIndex < horizonYears; yearIndex += 1) {
      const snapshot = yearlySnapshots[yearIndex];
      if (!snapshot) {
        break;
      }

      const startingTotalAssets = [...assetValues.values()].reduce((total, value) => total + value, 0);
      const startingInvestmentAssets = reinvestableAssetNames.reduce(
        (total, assetName) => total + (assetValues.get(assetName) ?? 0),
        0
      );
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
      const halfYearPriceReturns = new Map(
        normalizedAssets.map((asset) => [
          asset.name,
          calculatePeriodReturn(annualPriceReturns.get(asset.name) ?? 0, 0.5),
        ])
      );
      const assetReturnAmounts = new Map(normalizedAssets.map((asset) => [asset.name, 0]));

      const snapshotYear = getSnapshotYear(snapshot, yearIndex);
      const purchaseCashFlow = applyHomePurchasesForYear(
        snapshotYear,
        normalizedAssets,
        assetValues,
        homeState,
        flowTotals
      );
      const contributionAmounts = new Map(
        reinvestableAssetNames.map((assetName) => [assetName, Math.max(0, snapshot.flowAmounts.get(assetName) ?? 0)])
      );
      let saleResult: SaleIterationResult = {
        assetValues,
        assetCostBases,
        flowTotals,
        taxInput: cloneHouseholdTaxInput(snapshot.householdTaxInput),
        preTaxCashBalance: 0,
        taxableGains: 0,
      };
      let cashBalance = purchaseCashFlow;
      let generatedExpenseTotal = 0;
      let generatedCashTotal = 0;
      let totalTaxableGains = 0;

      for (let halfIndex = 0; halfIndex < 2; halfIndex += 1) {
        const openingInvestmentValues = new Map(
          reinvestableAssetNames.map((assetName) => [assetName, saleResult.assetValues.get(assetName) ?? 0])
        );
        applyPeriodAssetReturns({
          assets: normalizedAssets,
          assetValues: saleResult.assetValues,
          homeState,
          periodReturns: halfYearPriceReturns,
          assetReturnAmounts,
        });

        const taxInputWithCashGeneration = applyGeneratedCashStreams({
          baseTaxInput: saleResult.taxInput,
          assets: normalizedAssets,
          assetValues: saleResult.assetValues,
          homeState,
          year: snapshotYear,
          filingStatus: householdTaxProfile?.filingStatus ?? "individual",
          annualNormals: annualCorrelatedNormals,
          flowTotals: saleResult.flowTotals,
          periodFraction: 0.5,
          periodMonths: 6,
          openingInvestmentValues,
        });
        for (const [assetName, amount] of taxInputWithCashGeneration.reinvestmentSources) {
          contributionAmounts.set(assetName, (contributionAmounts.get(assetName) ?? 0) + amount);
        }

        generatedExpenseTotal += taxInputWithCashGeneration.expenseTotal;
        generatedCashTotal += taxInputWithCashGeneration.generatedCashTotal;
        cashBalance += snapshot.netAmount / 2 + taxInputWithCashGeneration.generatedCashTotal;

        saleResult = resolveSalesForCashNeed({
          cashNeeded: Math.max(0, -cashBalance),
          assets: normalizedAssets,
          assetValues: saleResult.assetValues,
          assetCostBases: saleResult.assetCostBases,
          flowTotals: saleResult.flowTotals,
          baseTaxInput: taxInputWithCashGeneration.taxInput,
        });
        totalTaxableGains += saleResult.taxableGains;
        cashBalance += saleResult.preTaxCashBalance;
      }

      const baseCashBalance = purchaseCashFlow + snapshot.netAmount + generatedCashTotal;
      const filingStatus = householdTaxProfile?.filingStatus ?? "individual";
      let effectiveTaxInput = applyCapitalLossCarryforward(saleResult.taxInput, capitalLossCarryforward, filingStatus);
      let endingCapitalLossCarryforward = getCapitalLossCarryforward(
        saleResult.taxInput,
        capitalLossCarryforward,
        filingStatus
      );

      let taxBreakdown =
        householdTaxProfile === null
          ? emptyHouseholdTaxBreakdown()
          : computeHouseholdTaxes(effectiveTaxInput, householdTaxProfile, taxes);

      for (let iteration = 0; iteration < 5; iteration += 1) {
        const postTaxCashBalance = cashBalance - taxBreakdown.totalTax;
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
        totalTaxableGains += saleResult.taxableGains;
        cashBalance += saleResult.preTaxCashBalance;
        if (saleResult.preTaxCashBalance <= 0.000001) {
          break;
        }
        effectiveTaxInput = applyCapitalLossCarryforward(saleResult.taxInput, capitalLossCarryforward, filingStatus);
        endingCapitalLossCarryforward = getCapitalLossCarryforward(
          saleResult.taxInput,
          capitalLossCarryforward,
          filingStatus
        );
        taxBreakdown =
          householdTaxProfile === null
            ? emptyHouseholdTaxBreakdown()
            : computeHouseholdTaxes(effectiveTaxInput, householdTaxProfile, taxes);
      }

      const flowTotalsWithTaxes = new Map(saleResult.flowTotals);
      if (Math.abs(taxBreakdown.totalTax) > 0.000001) {
        flowTotalsWithTaxes.set("Taxes paid", -taxBreakdown.totalTax);
      }

      const totalExpenses = snapshot.totalExpenses + generatedExpenseTotal + taxBreakdown.totalTax;
      const postTaxCashBalance = cashBalance - taxBreakdown.totalTax;
      const postTaxShortfall = Math.max(0, -postTaxCashBalance);
      const postTaxSurplus = Math.max(0, postTaxCashBalance);
      if (postTaxSurplus > 0 && reinvestableAssetNames.length > 0) {
        const reinvestmentAmounts = buildSurplusReinvestmentAmounts(
          postTaxSurplus,
          contributionAmounts,
          reinvestableAssetNames
        );
        for (const [assetName, reinvestmentAmount] of reinvestmentAmounts) {
          saleResult.assetValues.set(assetName, (saleResult.assetValues.get(assetName) ?? 0) + reinvestmentAmount);
          saleResult.assetCostBases.set(assetName, (saleResult.assetCostBases.get(assetName) ?? 0) + reinvestmentAmount);
        }
      }

      const assetReturns = new Map(
        normalizedAssets.map((asset) => {
          const annualReturn = annualPriceReturns.get(asset.name) ?? 0;
          const amount = assetReturnAmounts.get(asset.name) ?? 0;
          return [
            asset.name,
            {
              amount,
              percentage: Math.abs(amount) > 0.000001 ? annualReturn * 100 : 0,
            },
          ];
        })
      );

      const yearAssetValues = new Map(
        normalizedAssets.map((asset) => [asset.name, saleResult.assetValues.get(asset.name) ?? 0])
      );
      const yearAssetMarketValues = new Map(
        normalizedAssets.map((asset) => [
          asset.name,
          asset.kind === "home"
            ? homeState.marketValues.get(asset.name) ?? 0
            : saleResult.assetValues.get(asset.name) ?? 0,
        ])
      );
      const endingInvestmentAssets = reinvestableAssetNames.reduce(
        (total, assetName) => total + (yearAssetValues.get(assetName) ?? 0),
        0
      );
      const finalTotalAssets = [...yearAssetValues.values()].reduce((total, value) => total + value, 0);
      const totalGains = finalTotalAssets - startingTotalAssets + totalExpenses - postTaxShortfall;
      const depletedThisYear =
        endingInvestmentAssets <= 0.000001 &&
        (startingInvestmentAssets > 0.000001 || baseCashBalance < -0.000001);
      hasDepleted ||= depletedThisYear;
      assetValues = saleResult.assetValues;
      assetCostBases = saleResult.assetCostBases;
      capitalLossCarryforward = endingCapitalLossCarryforward;
      yearlyTotals[yearIndex]?.push(finalTotalAssets);
      yearlyLiquidTotals[yearIndex]?.push(endingInvestmentAssets);
      if (hasDepleted) {
        depletionCountsByYear[yearIndex] += 1;
      }

      if (shouldCaptureScenarioDetails) {
        yearlyRows.push({
          yearNumber: yearIndex + 1,
          label: snapshot.label,
          startingAssets: startingTotalAssets,
          endingAssets: finalTotalAssets,
          liquidAssets: endingInvestmentAssets,
          totalExpenses,
          totalGains,
          taxableGains: totalTaxableGains,
          taxAmount: taxBreakdown.totalTax,
          depleted: hasDepleted,
          depletionProbability: ((depletionCountsByYear[yearIndex] ?? 0) / Math.max(1, attempt + 1)) * 100,
          householdTaxInput: effectiveTaxInput,
          flowTotals: flowTotalsWithTaxes,
          assetValues: yearAssetValues,
          assetMarketValues: yearAssetMarketValues,
          assetReturns,
          totalAssets: finalTotalAssets,
          taxBreakdown,
        });
      }
    }

    if (shouldCaptureScenarioDetails) {
      scenarios.push({
        rows: yearlyRows,
        finalTotalAssets: yearlyRows[yearlyRows.length - 1]?.totalAssets ?? 0,
      });
    }

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
    yearlyLiquidTotals,
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

function getSnapshotYear(snapshot: SimulationYearlySnapshot | undefined, fallbackIndex: number): number {
  if (snapshot?.year !== undefined && Number.isInteger(snapshot.year)) {
    return snapshot.year;
  }

  const parsedLabelYear = Number.parseInt(snapshot?.label ?? "", 10);
  if (Number.isInteger(parsedLabelYear)) {
    return parsedLabelYear;
  }

  return new Date().getUTCFullYear() + fallbackIndex;
}

function assertUniqueSimulationAssetNames(assets: readonly NormalizedSimulationAsset[]): void {
  const seenNames = new Set<string>();
  for (const asset of assets) {
    if (seenNames.has(asset.name)) {
      throw new Error(`Asset name "${asset.name}" is already in use.`);
    }
    seenNames.add(asset.name);
  }
}

function normalizeSimulationAsset(asset: SimulationAssetInput): NormalizedSimulationAsset {
  if (asset.kind === "home") {
    return {
      kind: "home",
      name: asset.name,
      initialCost: Math.max(0, asset.initialCost),
      expectedReturn: asset.expectedReturn,
      volatility: asset.volatility,
      cashPurchasePercent: Math.max(0, Math.min(1, asset.cashPurchasePercent)),
      mortgageType: asset.mortgageType ?? "amortizing",
      interestOnlyMaturityAction:
        asset.mortgageType === "interest-only" ? asset.interestOnlyMaturityAction ?? "payoff" : "payoff",
      mortgageRate: Math.max(0, asset.mortgageRate),
      mortgageTermYears: Math.max(1, Math.floor(asset.mortgageTermYears)),
      monthlyNonTaxCosts: Math.max(0, asset.monthlyNonTaxCosts),
      propertyTaxRate: Math.max(0, asset.propertyTaxRate),
      purchaseYear: asset.purchaseYear,
    };
  }

  const cashGenerations =
    asset.cashGenerations && asset.cashGenerations.length > 0
      ? asset.cashGenerations
      : asset.cashGeneration
        ? [asset.cashGeneration]
        : [];
  return {
    kind: "investment",
    name: asset.name,
    startingValue: asset.startingValue,
    expectedReturn: asset.expectedReturn,
    volatility: asset.volatility,
    sellProportion: Number.isFinite(asset.sellProportion) ? Math.max(0, asset.sellProportion) : 1,
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

function createHomeMortgageState(asset: NormalizedSimulationHomeAsset): HomeMortgageState {
  return {
    mortgageType: asset.mortgageType,
    mortgageRate: asset.mortgageRate,
    mortgageTermMonths: asset.mortgageTermYears * 12,
    monthsElapsed: 0,
    interestOnlyMaturityAction: asset.interestOnlyMaturityAction,
  };
}

function initializeHomeMortgageState(
  asset: NormalizedSimulationHomeAsset,
  elapsedMonths: number
): {
  mortgageBalance: number;
  mortgageState: HomeMortgageState;
} {
  const loanPrincipal = asset.initialCost * (1 - asset.cashPurchasePercent);
  if (loanPrincipal <= 0.000001) {
    return {
      mortgageBalance: 0,
      mortgageState: createHomeMortgageState(asset),
    };
  }

  const totalMonths = asset.mortgageTermYears * 12;
  if (asset.mortgageType === "amortizing") {
    const boundedMonthsElapsed = Math.min(totalMonths, Math.max(0, elapsedMonths));
    return {
      mortgageBalance: calculateAmortizingRemainingBalance(
        loanPrincipal,
        asset.mortgageRate / 1200,
        totalMonths,
        boundedMonthsElapsed
      ),
      mortgageState: {
        mortgageType: "amortizing",
        mortgageRate: asset.mortgageRate,
        mortgageTermMonths: totalMonths,
        monthsElapsed: boundedMonthsElapsed,
        interestOnlyMaturityAction: asset.interestOnlyMaturityAction,
      },
    };
  }

  if (elapsedMonths < totalMonths) {
    return {
      mortgageBalance: loanPrincipal,
      mortgageState: {
        mortgageType: "interest-only",
        mortgageRate: asset.mortgageRate,
        mortgageTermMonths: totalMonths,
        monthsElapsed: Math.max(0, elapsedMonths),
        interestOnlyMaturityAction: asset.interestOnlyMaturityAction,
      },
    };
  }

  if (asset.interestOnlyMaturityAction === "refinance") {
    const refinanceMonthsElapsed = Math.min(totalMonths, Math.max(0, elapsedMonths - totalMonths));
    return {
      mortgageBalance: calculateAmortizingRemainingBalance(
        loanPrincipal,
        asset.mortgageRate / 1200,
        totalMonths,
        refinanceMonthsElapsed
      ),
      mortgageState: {
        mortgageType: "amortizing",
        mortgageRate: asset.mortgageRate,
        mortgageTermMonths: totalMonths,
        monthsElapsed: refinanceMonthsElapsed,
        interestOnlyMaturityAction: "refinance",
      },
    };
  }

  return {
    mortgageBalance: loanPrincipal,
    mortgageState: {
      mortgageType: "interest-only",
      mortgageRate: asset.mortgageRate,
      mortgageTermMonths: totalMonths,
      monthsElapsed: totalMonths,
      interestOnlyMaturityAction: asset.interestOnlyMaturityAction,
    },
  };
}

function initializeSimulationState(
  assets: readonly NormalizedSimulationAsset[],
  initialYear: number
): {
  assetValues: Map<string, number>;
  assetCostBases: Map<string, number>;
  homeState: HomeSimulationState;
} {
  const assetValues = new Map<string, number>();
  const assetCostBases = new Map<string, number>();
  const homeState: HomeSimulationState = {
    marketValues: new Map<string, number>(),
    mortgageBalances: new Map<string, number>(),
    mortgageStates: new Map<string, HomeMortgageState>(),
  };

  for (const asset of assets) {
    if (asset.kind === "investment") {
      assetValues.set(asset.name, asset.startingValue);
      assetCostBases.set(asset.name, Math.min(asset.saleTax?.costBasis ?? asset.startingValue, asset.startingValue));
      continue;
    }

    if (asset.purchaseYear < initialYear) {
      const elapsedYears = initialYear - asset.purchaseYear;
      const elapsedMonths = elapsedYears * 12;
      const marketValue = Math.max(0, asset.initialCost * Math.pow(1 + asset.expectedReturn / 100, elapsedYears));
      const { mortgageBalance, mortgageState } = initializeHomeMortgageState(asset, elapsedMonths);
      homeState.marketValues.set(asset.name, marketValue);
      homeState.mortgageBalances.set(asset.name, mortgageBalance);
      homeState.mortgageStates.set(asset.name, mortgageState);
      assetValues.set(asset.name, marketValue - mortgageBalance);
    } else {
      homeState.marketValues.set(asset.name, 0);
      homeState.mortgageBalances.set(asset.name, 0);
      homeState.mortgageStates.set(asset.name, createHomeMortgageState(asset));
      assetValues.set(asset.name, 0);
    }
  }

  return {
    assetValues,
    assetCostBases,
    homeState,
  };
}

function applyHomePurchasesForYear(
  year: number,
  assets: readonly NormalizedSimulationAsset[],
  assetValues: Map<string, number>,
  homeState: HomeSimulationState,
  flowTotals: Map<string, number>
): number {
  let generatedCashTotal = 0;

  for (const asset of assets) {
    if (asset.kind !== "home" || asset.purchaseYear !== year) {
      continue;
    }

    const currentMarketValue = homeState.marketValues.get(asset.name) ?? 0;
    if (currentMarketValue > 0.000001) {
      continue;
    }

    const mortgageBalance = asset.initialCost * (1 - asset.cashPurchasePercent);
    const downPayment = asset.initialCost * asset.cashPurchasePercent;
    homeState.marketValues.set(asset.name, asset.initialCost);
    homeState.mortgageBalances.set(asset.name, mortgageBalance);
    homeState.mortgageStates.set(asset.name, createHomeMortgageState(asset));
    assetValues.set(asset.name, asset.initialCost - mortgageBalance);
    if (downPayment > 0.000001) {
      generatedCashTotal -= downPayment;
      flowTotals.set(`${asset.name} down payment`, -downPayment);
    }
  }

  return generatedCashTotal;
}

function applyPeriodAssetReturns({
  assets,
  assetValues,
  homeState,
  periodReturns,
  assetReturnAmounts,
}: {
  assets: readonly NormalizedSimulationAsset[];
  assetValues: Map<string, number>;
  homeState: HomeSimulationState;
  periodReturns: ReadonlyMap<string, number>;
  assetReturnAmounts: Map<string, number>;
}): void {
  for (const asset of assets) {
    const periodReturn = periodReturns.get(asset.name) ?? 0;
    if (asset.kind === "investment") {
      const currentValue = assetValues.get(asset.name) ?? 0;
      const nextValue = currentValue <= 0 ? 0 : Math.max(0, currentValue * (1 + periodReturn));
      assetValues.set(asset.name, nextValue);
      assetReturnAmounts.set(asset.name, (assetReturnAmounts.get(asset.name) ?? 0) + (nextValue - currentValue));
      continue;
    }

    const currentMarketValue = homeState.marketValues.get(asset.name) ?? 0;
    const nextMarketValue = currentMarketValue <= 0 ? 0 : Math.max(0, currentMarketValue * (1 + periodReturn));
    homeState.marketValues.set(asset.name, nextMarketValue);
    assetValues.set(asset.name, nextMarketValue - (homeState.mortgageBalances.get(asset.name) ?? 0));
    assetReturnAmounts.set(asset.name, (assetReturnAmounts.get(asset.name) ?? 0) + (nextMarketValue - currentMarketValue));
  }
}

function applyGeneratedCashStreams({
  baseTaxInput,
  assets,
  assetValues,
  homeState,
  year,
  filingStatus,
  annualNormals,
  flowTotals,
  periodFraction,
  periodMonths,
  openingInvestmentValues,
}: {
  baseTaxInput: HouseholdTaxInput;
  assets: readonly NormalizedSimulationAsset[];
  assetValues: Map<string, number>;
  homeState: HomeSimulationState;
  year: number;
  filingStatus: FilingStatus;
  annualNormals: ReadonlyMap<string, number>;
  flowTotals: Map<string, number>;
  periodFraction: number;
  periodMonths: number;
  openingInvestmentValues: ReadonlyMap<string, number>;
}): GeneratedCashStreamsResult {
  const taxInput = cloneHouseholdTaxInput(baseTaxInput);
  const reinvestmentSources = new Map<string, number>();
  let generatedCashTotal = 0;
  let expenseTotal = 0;

  for (const asset of assets) {
    if (asset.kind === "investment") {
      const currentValue = openingInvestmentValues.get(asset.name) ?? assetValues.get(asset.name) ?? 0;
      for (const cashGeneration of asset.cashGenerations) {
        const generatedCash = calculateAssetCashGenerationAmount(
          currentValue,
          annualNormals.get(asset.name) ?? 0,
          cashGeneration,
          periodFraction
        );
        if (generatedCash <= 0.000001) {
          continue;
        }

        generatedCashTotal += generatedCash;
        reinvestmentSources.set(asset.name, (reinvestmentSources.get(asset.name) ?? 0) + generatedCash);
        flowTotals.set(
          `${asset.name} ${cashGeneration.name}`,
          (flowTotals.get(`${asset.name} ${cashGeneration.name}`) ?? 0) + generatedCash
        );
        applyTaxTreatmentAmount(taxInput, cashGeneration.taxTreatment ?? "ordinary-income", generatedCash);
      }
      continue;
    }

    const currentMarketValue = homeState.marketValues.get(asset.name) ?? 0;
    if (currentMarketValue <= 0.000001 || year < asset.purchaseYear) {
      continue;
    }

    const homePeriodResult = processHomePeriod({
      asset,
      marketValue: currentMarketValue,
      flowTotals,
      assetValues,
      homeState,
      periodMonths,
    });
    generatedCashTotal += homePeriodResult.generatedCashTotal;
    expenseTotal += homePeriodResult.expenseTotal;
    if (homePeriodResult.propertyTaxPaid > 0.000001) {
      taxInput.saltTaxesPaid = (taxInput.saltTaxesPaid ?? 0) + homePeriodResult.propertyTaxPaid;
    }
    if (homePeriodResult.mortgageInterestPaid > 0.000001) {
      taxInput.homeMortgageInterestPaid =
        (taxInput.homeMortgageInterestPaid ?? 0) + homePeriodResult.mortgageInterestPaid;
      taxInput.homeMortgageAverageBalance =
        (taxInput.homeMortgageAverageBalance ?? 0) + homePeriodResult.mortgageAverageBalanceMonths / 12;
      taxInput.homeMortgageInterestDebtLimit = Math.max(
        taxInput.homeMortgageInterestDebtLimit ?? 0,
        getMortgageInterestDebtLimit(asset.purchaseYear, filingStatus)
      );
    }
  }

  return {
    taxInput,
    generatedCashTotal,
    reinvestmentSources,
    expenseTotal,
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
  const nextTaxInput = cloneHouseholdTaxInput(baseTaxInput);
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
      (asset): asset is NormalizedSimulationInvestmentAsset =>
        asset.kind === "investment" && (nextAssetValues.get(asset.name) ?? 0) > 0.000001
    );
    const totalSellWeight = sellableAssets.reduce(
      (total, asset) => total + (nextAssetValues.get(asset.name) ?? 0) * asset.sellProportion,
      0
    );
    const totalFallbackValue =
      totalSellWeight > 0
        ? 0
        : sellableAssets.reduce((total, asset) => total + (nextAssetValues.get(asset.name) ?? 0), 0);

    if (sellableAssets.length === 0 || (totalSellWeight <= 0 && totalFallbackValue <= 0.000001)) {
      break;
    }

    let grossProceedsThisRound = 0;
    for (const asset of sellableAssets) {
      const currentValue = nextAssetValues.get(asset.name) ?? 0;
      const saleWeight =
        totalSellWeight > 0
          ? (currentValue * asset.sellProportion) / totalSellWeight
          : currentValue / Math.max(totalFallbackValue, 1);
      const amountSold = Math.min(currentValue, remainingCashNeed * saleWeight);
      if (amountSold <= 0.000001) {
        continue;
      }

      const currentCostBasis = nextAssetCostBases.get(asset.name) ?? 0;
      const basisReduction = currentValue <= 0 ? 0 : Math.min(currentCostBasis, currentCostBasis * (amountSold / currentValue));
      const realizedGain = amountSold - basisReduction;

      nextAssetValues.set(asset.name, currentValue - amountSold);
      nextAssetCostBases.set(asset.name, Math.max(0, currentCostBasis - basisReduction));
      nextFlowTotals.set(`${asset.name} sale proceeds`, (nextFlowTotals.get(`${asset.name} sale proceeds`) ?? 0) + amountSold);
      grossProceedsThisRound += amountSold;

      if (Math.abs(realizedGain) > 0.000001) {
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

function processHomePeriod({
  asset,
  marketValue,
  flowTotals,
  assetValues,
  homeState,
  periodMonths,
}: {
  asset: NormalizedSimulationHomeAsset;
  marketValue: number;
  flowTotals: Map<string, number>;
  assetValues: Map<string, number>;
  homeState: HomeSimulationState;
  periodMonths: number;
}): {
  generatedCashTotal: number;
  expenseTotal: number;
  propertyTaxPaid: number;
  mortgageInterestPaid: number;
  mortgageAverageBalanceMonths: number;
} {
  let generatedCashTotal = 0;
  let expenseTotal = 0;
  let propertyTaxPaid = 0;
  let mortgageInterestPaid = 0;
  let mortgageAverageBalanceMonths = 0;
  let remainingMonths = periodMonths;
  let mortgageBalance = homeState.mortgageBalances.get(asset.name) ?? 0;
  const mortgageState = homeState.mortgageStates.get(asset.name) ?? createHomeMortgageState(asset);
  const monthlyRate = mortgageState.mortgageRate / 1200;

  while (remainingMonths > 0 && marketValue > 0.000001) {
    if (mortgageBalance <= 0.000001) {
      const propertyTax = marketValue * (asset.propertyTaxRate / 100) * (remainingMonths / 12);
      if (propertyTax > 0.000001) {
        generatedCashTotal -= propertyTax;
        expenseTotal += propertyTax;
        propertyTaxPaid += propertyTax;
        flowTotals.set(`${asset.name} property tax`, (flowTotals.get(`${asset.name} property tax`) ?? 0) - propertyTax);
      }

      const nonTaxCosts = asset.monthlyNonTaxCosts * remainingMonths;
      if (nonTaxCosts > 0.000001) {
        generatedCashTotal -= nonTaxCosts;
        expenseTotal += nonTaxCosts;
        flowTotals.set(`${asset.name} home monthlies`, (flowTotals.get(`${asset.name} home monthlies`) ?? 0) - nonTaxCosts);
      }
      remainingMonths = 0;
      break;
    }

    if (mortgageState.mortgageType === "interest-only") {
      const monthsUntilMaturity = Math.max(0, mortgageState.mortgageTermMonths - mortgageState.monthsElapsed);
      if (monthsUntilMaturity <= 0) {
        const maturityResult = applyInterestOnlyMaturityAction({
          asset,
          marketValue,
          mortgageBalance,
          mortgageState,
          flowTotals,
          assetValues,
          homeState,
        });
        generatedCashTotal += maturityResult.generatedCashTotal;
        mortgageBalance = maturityResult.mortgageBalance;
        marketValue = maturityResult.marketValue;
        if (maturityResult.stopProcessing) {
          remainingMonths = 0;
          break;
        }
        continue;
      }

      const monthsThisChunk = Math.min(remainingMonths, monthsUntilMaturity);
      const propertyTax = marketValue * (asset.propertyTaxRate / 100) * (monthsThisChunk / 12);
      if (propertyTax > 0.000001) {
        generatedCashTotal -= propertyTax;
        expenseTotal += propertyTax;
        propertyTaxPaid += propertyTax;
        flowTotals.set(`${asset.name} property tax`, (flowTotals.get(`${asset.name} property tax`) ?? 0) - propertyTax);
      }

      const nonTaxCosts = asset.monthlyNonTaxCosts * monthsThisChunk;
      if (nonTaxCosts > 0.000001) {
        generatedCashTotal -= nonTaxCosts;
        expenseTotal += nonTaxCosts;
        flowTotals.set(`${asset.name} home monthlies`, (flowTotals.get(`${asset.name} home monthlies`) ?? 0) - nonTaxCosts);
      }

      const interest = mortgageBalance * monthlyRate * monthsThisChunk;
      if (interest > 0.000001) {
        generatedCashTotal -= interest;
        expenseTotal += interest;
        mortgageInterestPaid += interest;
        mortgageAverageBalanceMonths += mortgageBalance * monthsThisChunk;
        flowTotals.set(
          `${asset.name} mortgage interest`,
          (flowTotals.get(`${asset.name} mortgage interest`) ?? 0) - interest
        );
      }

      mortgageState.monthsElapsed += monthsThisChunk;
      remainingMonths -= monthsThisChunk;
      continue;
    }

    const remainingMortgageMonths = Math.max(0, mortgageState.mortgageTermMonths - mortgageState.monthsElapsed);
    if (remainingMortgageMonths <= 0) {
      mortgageBalance = 0;
      continue;
    }

    const monthsThisChunk = Math.min(remainingMonths, remainingMortgageMonths);
    const propertyTax = marketValue * (asset.propertyTaxRate / 100) * (monthsThisChunk / 12);
    if (propertyTax > 0.000001) {
      generatedCashTotal -= propertyTax;
      expenseTotal += propertyTax;
      propertyTaxPaid += propertyTax;
      flowTotals.set(`${asset.name} property tax`, (flowTotals.get(`${asset.name} property tax`) ?? 0) - propertyTax);
    }

    const nonTaxCosts = asset.monthlyNonTaxCosts * monthsThisChunk;
    if (nonTaxCosts > 0.000001) {
      generatedCashTotal -= nonTaxCosts;
      expenseTotal += nonTaxCosts;
      flowTotals.set(`${asset.name} home monthlies`, (flowTotals.get(`${asset.name} home monthlies`) ?? 0) - nonTaxCosts);
    }

    let principalPaid = 0;
    let interestPaid = 0;
    for (let monthIndex = 0; monthIndex < monthsThisChunk && mortgageBalance > 0.000001; monthIndex += 1) {
      const remainingMonthsOnLoan = Math.max(1, mortgageState.mortgageTermMonths - mortgageState.monthsElapsed);
      const payment = calculateMortgagePayment(mortgageBalance, monthlyRate, remainingMonthsOnLoan);
      const interest = mortgageBalance * monthlyRate;
      const principal = Math.min(mortgageBalance, Math.max(0, payment - interest));
      mortgageAverageBalanceMonths += mortgageBalance;
      interestPaid += interest;
      principalPaid += principal;
      mortgageBalance = Math.max(0, mortgageBalance - principal);
      mortgageState.monthsElapsed += 1;
    }

    if (interestPaid > 0.000001) {
      generatedCashTotal -= interestPaid;
      expenseTotal += interestPaid;
      mortgageInterestPaid += interestPaid;
      flowTotals.set(
        `${asset.name} mortgage interest`,
        (flowTotals.get(`${asset.name} mortgage interest`) ?? 0) - interestPaid
      );
    }
    if (principalPaid > 0.000001) {
      generatedCashTotal -= principalPaid;
      flowTotals.set(
        `${asset.name} mortgage principal`,
        (flowTotals.get(`${asset.name} mortgage principal`) ?? 0) - principalPaid
      );
    }

    remainingMonths -= monthsThisChunk;
  }

  homeState.marketValues.set(asset.name, marketValue);
  homeState.mortgageBalances.set(asset.name, mortgageBalance);
  homeState.mortgageStates.set(asset.name, mortgageState);
  assetValues.set(asset.name, marketValue - mortgageBalance);

  return {
    generatedCashTotal,
    expenseTotal,
    propertyTaxPaid,
    mortgageInterestPaid,
    mortgageAverageBalanceMonths,
  };
}

function applyInterestOnlyMaturityAction({
  asset,
  marketValue,
  mortgageBalance,
  mortgageState,
  flowTotals,
  assetValues,
  homeState,
}: {
  asset: NormalizedSimulationHomeAsset;
  marketValue: number;
  mortgageBalance: number;
  mortgageState: HomeMortgageState;
  flowTotals: Map<string, number>;
  assetValues: Map<string, number>;
  homeState: HomeSimulationState;
}): {
  generatedCashTotal: number;
  mortgageBalance: number;
  marketValue: number;
  stopProcessing: boolean;
} {
  switch (mortgageState.interestOnlyMaturityAction) {
    case "payoff":
      const balloonPayoffAmount = mortgageBalance;
      if (mortgageBalance > 0.000001) {
        flowTotals.set(
          `${asset.name} mortgage balloon principal`,
          (flowTotals.get(`${asset.name} mortgage balloon principal`) ?? 0) - mortgageBalance
        );
      }
      mortgageBalance = 0;
      return {
        generatedCashTotal: -balloonPayoffAmount,
        mortgageBalance,
        marketValue,
        stopProcessing: false,
      };
    case "refinance":
      mortgageState.mortgageType = "amortizing";
      mortgageState.monthsElapsed = 0;
      mortgageState.mortgageTermMonths = asset.mortgageTermYears * 12;
      return {
        generatedCashTotal: 0,
        mortgageBalance,
        marketValue,
        stopProcessing: false,
      };
    case "sell":
      if (marketValue > 0.000001) {
        flowTotals.set(`${asset.name} sale proceeds`, (flowTotals.get(`${asset.name} sale proceeds`) ?? 0) + marketValue);
      }
      if (mortgageBalance > 0.000001) {
        flowTotals.set(
          `${asset.name} mortgage balloon principal`,
          (flowTotals.get(`${asset.name} mortgage balloon principal`) ?? 0) - mortgageBalance
        );
      }
      homeState.marketValues.set(asset.name, 0);
      homeState.mortgageBalances.set(asset.name, 0);
      assetValues.set(asset.name, 0);
      return {
        generatedCashTotal: marketValue - mortgageBalance,
        mortgageBalance: 0,
        marketValue: 0,
        stopProcessing: true,
      };
  }
}

function calculateAmortizingRemainingBalance(
  startingBalance: number,
  monthlyRate: number,
  totalMonths: number,
  monthsElapsed: number
): number {
  if (startingBalance <= 0.000001 || monthsElapsed <= 0) {
    return startingBalance;
  }

  let balance = startingBalance;
  let remainingMonths = totalMonths;
  const monthsToProcess = Math.min(totalMonths, Math.max(0, monthsElapsed));
  for (let monthIndex = 0; monthIndex < monthsToProcess && balance > 0.000001 && remainingMonths > 0; monthIndex += 1) {
    const payment = calculateMortgagePayment(balance, monthlyRate, remainingMonths);
    const interest = balance * monthlyRate;
    const principal = Math.min(balance, Math.max(0, payment - interest));
    balance = Math.max(0, balance - principal);
    remainingMonths -= 1;
  }

  return balance;
}

function calculateMortgagePayment(balance: number, monthlyRate: number, remainingMonths: number): number {
  if (remainingMonths <= 0) {
    return 0;
  }
  if (Math.abs(monthlyRate) <= 0.000000001) {
    return balance / remainingMonths;
  }

  return (balance * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -remainingMonths));
}

function getMortgageInterestDebtLimit(purchaseYear: number, filingStatus: FilingStatus): number {
  const isIndividual = filingStatus === "individual";
  if (purchaseYear <= 2017) {
    return isIndividual ? 500000 : 1000000;
  }

  return isIndividual ? 375000 : 750000;
}

function calculateAssetCashGenerationAmount(
  assetValue: number,
  annualNormal: number,
  cashGeneration: AssetCashGenerationDefinition | undefined,
  periodFraction = 1
): number {
  if (!cashGeneration) {
    return 0;
  }

  const annualCashGenerationRate = Math.max(
    0,
    (cashGeneration.rate / 100) * periodFraction + ((cashGeneration.volatility / 100) * periodFraction) * annualNormal
  );
  return assetValue * annualCashGenerationRate;
}

function calculatePeriodReturn(annualReturn: number, periodFraction: number): number {
  return Math.pow(1 + annualReturn, periodFraction) - 1;
}

function cloneHouseholdTaxInput(input: HouseholdTaxInput): HouseholdTaxInput {
  return {
    wages: input.wages,
    ordinaryIncome: input.ordinaryIncome,
    qualifiedDividends: input.qualifiedDividends,
    shortTermCapitalGains: input.shortTermCapitalGains,
    longTermCapitalGains: input.longTermCapitalGains,
    capitalLossDeduction: input.capitalLossDeduction ?? 0,
    taxExemptIncome: input.taxExemptIncome,
    stateLocalExemptIncome: input.stateLocalExemptIncome,
    tripleExemptIncome: input.tripleExemptIncome,
    deductibleExpenses: input.deductibleExpenses,
    saltTaxesPaid: input.saltTaxesPaid ?? 0,
    homeMortgageInterestPaid: input.homeMortgageInterestPaid ?? 0,
    homeMortgageAverageBalance: input.homeMortgageAverageBalance ?? 0,
    homeMortgageInterestDebtLimit: input.homeMortgageInterestDebtLimit ?? 0,
  };
}

function createEmptyCapitalLossCarryforwardState(): CapitalLossCarryforwardState {
  return {
    shortTermCapitalLoss: 0,
    longTermCapitalLoss: 0,
  };
}

function applyCapitalLossCarryforward(
  taxInput: HouseholdTaxInput,
  capitalLossCarryforward: CapitalLossCarryforwardState,
  filingStatus: FilingStatus
): HouseholdTaxInput {
  const nextTaxInput = cloneHouseholdTaxInput(taxInput);
  const capitalGainSummary = summarizeNetCapitalGainAmounts(
    nextTaxInput.shortTermCapitalGains - capitalLossCarryforward.shortTermCapitalLoss,
    nextTaxInput.longTermCapitalGains - capitalLossCarryforward.longTermCapitalLoss,
    filingStatus
  );

  nextTaxInput.shortTermCapitalGains = capitalGainSummary.shortTermCapitalGains;
  nextTaxInput.longTermCapitalGains = capitalGainSummary.longTermCapitalGains;
  nextTaxInput.capitalLossDeduction = capitalGainSummary.ordinaryIncomeDeduction;

  return nextTaxInput;
}

function getCapitalLossCarryforward(
  taxInput: HouseholdTaxInput,
  capitalLossCarryforward: CapitalLossCarryforwardState,
  filingStatus: FilingStatus
): CapitalLossCarryforwardState {
  const capitalGainSummary = summarizeNetCapitalGainAmounts(
    taxInput.shortTermCapitalGains - capitalLossCarryforward.shortTermCapitalLoss,
    taxInput.longTermCapitalGains - capitalLossCarryforward.longTermCapitalLoss,
    filingStatus
  );

  return {
    shortTermCapitalLoss: capitalGainSummary.shortTermCapitalLossCarryforward,
    longTermCapitalLoss: capitalGainSummary.longTermCapitalLossCarryforward,
  };
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
    | "state-local-exempt"
    | "triple-exempt"
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
    case "state-local-exempt":
      taxInput.stateLocalExemptIncome += amount;
      break;
    case "triple-exempt":
      taxInput.tripleExemptIncome += amount;
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
    deductibleMortgageInterest: 0,
    saltDeductionUsed: 0,
    otherItemizedDeductionsUsed: 0,
    totalTax: 0,
    taxByName: new Map(),
  };
}
