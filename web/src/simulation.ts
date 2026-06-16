import {
  getDefaultAssetCashGenerationInflationCorrelation,
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
  avoidEarlyWithdrawalPenalty?: boolean;
}

export interface SimulationHomeAssetInput extends HomeAssetDefinition {
  kind: "home";
}

export type SimulationAssetInput = SimulationInvestmentAssetInput | SimulationHomeAssetInput;

export type SimulationInflationMode = "fixed" | "regime-switching";

export interface SimulationFixedInflationConfig {
  mode: "fixed";
  fixedRate: number;
}

export interface SimulationInflationRegimeSettings {
  averageRate: number;
  volatility: number;
}

export interface SimulationRegimeSwitchingInflationConfig {
  mode: "regime-switching";
  lowRegime: SimulationInflationRegimeSettings;
  highRegime: SimulationInflationRegimeSettings;
  stayLowProbability: number;
  stayHighProbability: number;
}

export type SimulationInflationConfig = SimulationFixedInflationConfig | SimulationRegimeSwitchingInflationConfig;

export interface SimulationYearlyFlowInput {
  name: string;
  type: "income" | "expense";
  taxTreatment:
    | "wages"
    | "ordinary-income"
    | "qualified-dividends"
    | "short-term-capital-gains"
    | "long-term-capital-gains"
    | "tax-exempt-income"
    | "deductible-expense"
    | "nondeductible-expense";
  inflationAdjusted: boolean;
  baseSignedAmount: number;
}

export interface SimulationYearlyPlan {
  year?: number;
  label: string;
  flows: readonly SimulationYearlyFlowInput[];
  legacySnapshot?: {
    netAmount: number;
    totalExpenses: number;
    flowAmounts: Map<string, number>;
    householdTaxInput: HouseholdTaxInput;
  };
}

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
  bankruptcyProbability: number;
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
  inflationMode: SimulationInflationMode;
  inflationRateApplied: number;
  inflationRegime: "fixed" | "low" | "high";
  startingAssets: number;
  endingAssets: number;
  startingLiquidAssets?: number;
  liquidAssets?: number;
  totalExpenses: number;
  totalGains: number;
  taxableGains: number;
  taxAmount: number;
  depleted: boolean;
  bankruptcyProbability: number;
  depletionProbability: number;
  householdTaxInput: HouseholdTaxInput;
  flowTotals: Map<string, number>;
  flowPercentages?: Map<string, number>;
  startingAssetValues?: Map<string, number>;
  startingAssetMarketValues?: Map<string, number>;
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
  currentAge?: number;
  yearlyPlans?: readonly SimulationYearlyPlan[];
  yearlySnapshots?: readonly SimulationYearlySnapshot[];
  assets: readonly SimulationAssetInput[];
  assetCorrelations: readonly AssetCorrelationDefinition[];
  inflation?: SimulationInflationConfig;
  taxes?: readonly Tax[];
  householdTaxProfile?: HouseholdTaxProfileDefinition | null;
  nextStandardNormal?: () => number;
  nextRandom?: () => number;
}

interface NormalizedSimulationInvestmentAsset {
  kind: "investment";
  name: string;
  startingValue: number;
  assetType?: InvestmentAssetDefinition["assetType"];
  desiredAnnualContribution: number;
  expectedReturn: number;
  volatility: number;
  // Stored in the historical sellProportion field, but interpreted as a sale multiplier.
  sellProportion: number;
  avoidEarlyWithdrawalPenalty: boolean;
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
  closingCostPercent: number;
  mortgageType: "amortizing" | "interest-only";
  interestOnlyMaturityAction: "payoff" | "refinance" | "sell";
  mortgageRate: number;
  mortgageTermYears: number;
  monthlyNonTaxCosts: number;
  propertyTaxRate: number;
  purchaseYear: number;
  saleYear: number | null;
  saleCostPercent: number;
}

type NormalizedSimulationAsset = NormalizedSimulationInvestmentAsset | NormalizedSimulationHomeAsset;

const SYNTHETIC_CASH_SAVINGS_ASSET_NAME = "Cash savings";
const RETIREMENT_IRA_UNDER_50_LIMIT = 7500;
const RETIREMENT_IRA_50_PLUS_LIMIT = 8600;
const RETIREMENT_401K_UNDER_50_LIMIT = 24500;
const RETIREMENT_401K_50_PLUS_LIMIT = 32500;
const RETIREMENT_401K_60_TO_63_LIMIT = 35750;
const EARLY_WITHDRAWAL_PENALTY_AVOIDANCE_AGE = 60;

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

interface RealizedYearlyPlan {
  label: string;
  year?: number;
  flowAmounts: Map<string, number>;
  netAmount: number;
  totalExpenses: number;
  householdTaxInput: HouseholdTaxInput;
  inflationRateApplied: number;
  inflationRateDeltaApplied: number;
  inflationRegime: "fixed" | "low" | "high";
}

interface SimulationExecutionResult {
  scenarios: SimulationDetailScenario[];
  yearlyTotals: number[][];
  yearlyLiquidTotals: number[][];
  bankruptcyCountsByYear: number[];
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
  bankruptcyCountsByYear?: number[];
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

function normalizeSimulationYearlyPlans(
  yearlyPlans: readonly SimulationYearlyPlan[] | undefined,
  yearlySnapshots: readonly SimulationYearlySnapshot[] | undefined
): readonly SimulationYearlyPlan[] {
  if (yearlyPlans && yearlyPlans.length > 0) {
    return yearlyPlans;
  }

  return (yearlySnapshots ?? []).map((snapshot) => ({
    year: snapshot.year,
    label: snapshot.label,
    flows: [...snapshot.flowAmounts.entries()].map(([name, amount]) => ({
      name,
      type: amount < 0 ? "expense" : "income",
      taxTreatment: amount < 0 ? "nondeductible-expense" : "ordinary-income",
      inflationAdjusted: false,
      baseSignedAmount: amount,
    })),
    legacySnapshot: {
      netAmount: snapshot.netAmount,
      totalExpenses: snapshot.totalExpenses,
      flowAmounts: new Map(snapshot.flowAmounts),
      householdTaxInput: cloneHouseholdTaxInput(snapshot.householdTaxInput),
    },
  }));
}

export function buildSimulationScenarios({
  attempts,
  horizonYears,
  currentAge,
  yearlyPlans,
  yearlySnapshots,
  assets,
  assetCorrelations,
  inflation,
  taxes = [],
  householdTaxProfile = null,
  nextStandardNormal = randomStandardNormal,
  nextRandom = Math.random,
}: BuildSimulationScenariosInput): Map<SimulationPercentile, SimulationScenario> {
  return buildSimulationExecution({
    attempts,
    horizonYears,
    currentAge,
    yearlyPlans,
    yearlySnapshots,
    assets,
    assetCorrelations,
    inflation,
    taxes,
    householdTaxProfile,
    nextStandardNormal,
    nextRandom,
  }).scenarios;
}

export function buildSimulationExecution(
  {
    attempts,
    horizonYears,
    currentAge,
    yearlyPlans,
    yearlySnapshots,
    assets,
    assetCorrelations,
    inflation,
    taxes = [],
    householdTaxProfile = null,
    nextStandardNormal = randomStandardNormal,
    nextRandom = Math.random,
  }: BuildSimulationScenariosInput,
  { onProgress, progressInterval, detailSampleLimit = null, includeAggregates = true }: BuildSimulationExecutionOptions = {}
): BuildSimulationExecutionResult {
  const normalizedYearlyPlans = normalizeSimulationYearlyPlans(yearlyPlans, yearlySnapshots);
  const normalizedInflation = inflation ?? { mode: "fixed", fixedRate: 0 };
  const { scenarios, yearlyTotals, yearlyLiquidTotals, bankruptcyCountsByYear, depletionCountsByYear } = runSimulationAttempts(
    {
      attempts,
      horizonYears,
      currentAge,
      yearlyPlans: normalizedYearlyPlans,
      assets,
      assetCorrelations,
      inflation: normalizedInflation,
      taxes,
      householdTaxProfile,
      nextStandardNormal,
      nextRandom,
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
      yearlyPlans: normalizedYearlyPlans,
      yearlyTotals,
      yearlyLiquidTotals,
      bankruptcyCountsByYear,
      depletionCountsByYear,
    }),
    details: scenarios,
    ...(includeAggregates
      ? {
          yearlyTotals,
          yearlyLiquidTotals,
          bankruptcyCountsByYear,
          depletionCountsByYear,
        }
      : {}),
  };
}

export function buildSimulationScenariosFromDetails({
  attempts,
  horizonYears,
  yearlyPlans,
  details,
}: {
  attempts: number;
  horizonYears: number;
  yearlyPlans: readonly SimulationYearlyPlan[];
  details: readonly SimulationDetailScenario[];
}): Map<SimulationPercentile, SimulationScenario> {
  const yearlyTotals = Array.from({ length: horizonYears }, () => [] as number[]);
  const yearlyLiquidTotals = Array.from({ length: horizonYears }, () => [] as number[]);
  const bankruptcyCountsByYear = Array.from({ length: horizonYears }, () => 0);
  const depletionCountsByYear = Array.from({ length: horizonYears }, () => 0);

  for (const scenario of details) {
    for (let rowIndex = 0; rowIndex < horizonYears; rowIndex += 1) {
      const row = scenario.rows[rowIndex];
      if (!row) {
        continue;
      }

      yearlyTotals[rowIndex]?.push(row.totalAssets);
      yearlyLiquidTotals[rowIndex]?.push(row.liquidAssets ?? 0);
      if ((row.liquidAssets ?? 0) <= 0.000001) {
        bankruptcyCountsByYear[rowIndex] += 1;
      }
      if (row.depleted) {
        depletionCountsByYear[rowIndex] += 1;
      }
    }
  }

  return buildSimulationScenariosFromAggregates({
    attempts,
    horizonYears,
    yearlyPlans,
    yearlyTotals,
    yearlyLiquidTotals,
    bankruptcyCountsByYear,
    depletionCountsByYear,
  });
}

export function buildSimulationScenariosFromAggregates({
  attempts,
  horizonYears,
  yearlyPlans,
  yearlyTotals,
  yearlyLiquidTotals,
  bankruptcyCountsByYear,
  depletionCountsByYear,
}: {
  attempts: number;
  horizonYears: number;
  yearlyPlans: readonly SimulationYearlyPlan[];
  yearlyTotals: readonly (readonly number[])[];
  yearlyLiquidTotals: readonly (readonly number[])[];
  bankruptcyCountsByYear: readonly number[];
  depletionCountsByYear: readonly number[];
}): Map<SimulationPercentile, SimulationScenario> {
  return buildSimulationScenarioSummaries({
    attempts,
    horizonYears,
    yearlyPlans,
    yearlyTotals,
    yearlyLiquidTotals,
    bankruptcyCountsByYear,
    depletionCountsByYear,
  });
}

function buildSimulationScenarioSummaries({
  attempts,
  horizonYears,
  yearlyPlans,
  yearlyTotals,
  yearlyLiquidTotals,
  bankruptcyCountsByYear,
  depletionCountsByYear,
}: {
  attempts: number;
  horizonYears: number;
  yearlyPlans: readonly SimulationYearlyPlan[];
  yearlyTotals: readonly (readonly number[])[];
  yearlyLiquidTotals: readonly (readonly number[])[];
  bankruptcyCountsByYear: readonly number[];
  depletionCountsByYear: readonly number[];
}): Map<SimulationPercentile, SimulationScenario> {
  const rowCount = Math.min(horizonYears, yearlyPlans.length);
  const results = new Map<SimulationPercentile, SimulationScenario>();

  for (const percentile of [5, 10, 25, 50, 75, 90] as const) {
    const rows: SimulationYearRow[] = [];
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const yearlyPlan = yearlyPlans[rowIndex];
      const yearlyPercentileTotalAssets = selectPercentileValue(yearlyTotals[rowIndex] ?? [], percentile);
      const yearlyPercentileLiquidAssets = selectPercentileValue(yearlyLiquidTotals[rowIndex] ?? [], percentile);
      if (!yearlyPlan || yearlyPercentileTotalAssets === null) {
        continue;
      }
      rows.push({
        yearNumber: rowIndex + 1,
        label: yearlyPlan.label,
        bankruptcyProbability: ((bankruptcyCountsByYear[rowIndex] ?? 0) / attempts) * 100,
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
  currentAge,
  yearlyPlans,
  yearlySnapshots,
  assets,
  assetCorrelations,
  inflation,
  taxes = [],
  householdTaxProfile = null,
  nextStandardNormal = randomStandardNormal,
  nextRandom = Math.random,
}: BuildSimulationScenariosInput): SimulationDetailScenario[] {
  return buildSimulationExecution({
    attempts,
    horizonYears,
    currentAge,
    yearlyPlans,
    yearlySnapshots,
    assets,
    assetCorrelations,
    inflation,
    taxes,
    householdTaxProfile,
    nextStandardNormal,
    nextRandom,
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
  currentAge = 35,
  yearlyPlans = [],
  assets,
  assetCorrelations,
  inflation = { mode: "fixed", fixedRate: 0 },
  taxes = [],
  householdTaxProfile = null,
  nextStandardNormal = randomStandardNormal,
  nextRandom = Math.random,
}: BuildSimulationScenariosInput,
{
  onProgress,
  progressInterval = Math.max(1, Math.floor(attempts / 100)),
  detailSampleLimit = null,
}: BuildSimulationExecutionOptions = {}): SimulationExecutionResult {
  const scenarios: SimulationDetailScenario[] = [];
  const yearlyTotals = Array.from({ length: horizonYears }, () => [] as number[]);
  const yearlyLiquidTotals = Array.from({ length: horizonYears }, () => [] as number[]);
  const bankruptcyCountsByYear = Array.from({ length: horizonYears }, () => 0);
  const depletionCountsByYear = Array.from({ length: horizonYears }, () => 0);
  const normalizedInputAssets = assets.map(normalizeSimulationAsset);
  assertUniqueSimulationAssetNames(normalizedInputAssets);
  const normalizedAssets = addSyntheticCashSavingsAssetIfNeeded(normalizedInputAssets);
  const assetNames = normalizedAssets.map((asset) => asset.name);
  const reinvestableAssetNames = normalizedAssets
    .filter((asset): asset is NormalizedSimulationInvestmentAsset => asset.kind === "investment")
    .map((asset) => asset.name);
  const initialYear = getPlanYear(yearlyPlans[0], 0);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const shouldCaptureScenarioDetails = detailSampleLimit === null || scenarios.length < detailSampleLimit;
    const initialState = initializeSimulationState(normalizedAssets, initialYear);
    let assetValues = initialState.assetValues;
    let assetCostBases = initialState.assetCostBases;
    let capitalLossCarryforward = createEmptyCapitalLossCarryforwardState();
    const homeState = initialState.homeState;
    let hasDepleted = false;
    const yearlyRows: SimulationDetailYearRow[] = [];
    const realizedInflationPath = buildRealizedInflationPath({
      yearlyPlans,
      inflation,
      nextStandardNormal,
      nextRandom,
    });

    for (let yearIndex = 0; yearIndex < horizonYears; yearIndex += 1) {
      const yearlyPlan = realizedInflationPath[yearIndex];
      if (!yearlyPlan) {
        break;
      }

      const simulationAge = currentAge + yearIndex;
      const startingTotalAssets = [...assetValues.values()].reduce((total, value) => total + value, 0);
      const startingInvestmentAssets = sumAccessibleInvestmentAssets(normalizedAssets, assetValues, simulationAge);
      const startingAssetValues = new Map(normalizedAssets.map((asset) => [asset.name, assetValues.get(asset.name) ?? 0]));
      const startingAssetMarketValues = new Map(
        normalizedAssets.map((asset) => [
          asset.name,
          asset.kind === "home" ? homeState.marketValues.get(asset.name) ?? 0 : assetValues.get(asset.name) ?? 0,
        ])
      );
      const flowTotals = new Map(yearlyPlan.flowAmounts);
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

      const snapshotYear = getPlanYear(yearlyPlan, yearIndex);
      const homePurchaseResult = applyHomePurchasesForYear(
        snapshotYear,
        normalizedAssets,
        assetValues,
        homeState,
        flowTotals
      );
      const homeSaleResult = applyHomeSalesForYear(
        snapshotYear,
        normalizedAssets,
        assetValues,
        homeState,
        flowTotals,
        householdTaxProfile?.filingStatus ?? "individual"
      );
      const contributionAmounts = new Map(
        reinvestableAssetNames.map((assetName) => [assetName, Math.max(0, yearlyPlan.flowAmounts.get(assetName) ?? 0)])
      );
      const flowPercentages = new Map<string, number>();
      let saleResult: SaleIterationResult = {
        assetValues,
        assetCostBases,
        flowTotals,
        taxInput: cloneHouseholdTaxInput(yearlyPlan.householdTaxInput),
        preTaxCashBalance: 0,
        taxableGains: 0,
      };
      // a home sale this year realizes a long-term capital gain (above the
      // primary-residence exclusion) — seed it so the year's taxes include it
      if (homeSaleResult.taxableGain > 0.000001) {
        applyTaxTreatmentAmount(saleResult.taxInput, "long-term-capital-gains", homeSaleResult.taxableGain);
      }
      let cashBalance = homePurchaseResult.generatedCashTotal + homeSaleResult.cashProceeds;
      let generatedExpenseTotal = homePurchaseResult.expenseTotal;
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
          year: snapshotYear,
        });

        const taxInputWithCashGeneration = applyGeneratedCashStreams({
          baseTaxInput: saleResult.taxInput,
          assets: normalizedAssets,
          assetValues: saleResult.assetValues,
          homeState,
          year: snapshotYear,
          inflationRateDeltaApplied: yearlyPlan.inflationRateDeltaApplied,
          filingStatus: householdTaxProfile?.filingStatus ?? "individual",
          annualNormals: annualCorrelatedNormals,
          flowTotals: saleResult.flowTotals,
          flowPercentages,
          periodFraction: 0.5,
          periodMonths: 6,
          openingInvestmentValues,
        });
        for (const [assetName, amount] of taxInputWithCashGeneration.reinvestmentSources) {
          contributionAmounts.set(assetName, (contributionAmounts.get(assetName) ?? 0) + amount);
        }

        generatedExpenseTotal += taxInputWithCashGeneration.expenseTotal;
        generatedCashTotal += taxInputWithCashGeneration.generatedCashTotal;
        cashBalance += yearlyPlan.netAmount / 2 + taxInputWithCashGeneration.generatedCashTotal;

        saleResult = resolveSalesForCashNeed({
          cashNeeded: Math.max(0, -cashBalance),
          assets: normalizedAssets,
          assetValues: saleResult.assetValues,
          assetCostBases: saleResult.assetCostBases,
          flowTotals: saleResult.flowTotals,
          baseTaxInput: taxInputWithCashGeneration.taxInput,
          age: simulationAge,
        });
        totalTaxableGains += saleResult.taxableGains;
        cashBalance += saleResult.preTaxCashBalance;
      }

      const baseCashBalance = homePurchaseResult.generatedCashTotal + yearlyPlan.netAmount + generatedCashTotal;
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
          age: simulationAge,
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

      const totalExpenses = yearlyPlan.totalExpenses + generatedExpenseTotal + taxBreakdown.totalTax;
      const postTaxCashBalance = cashBalance - taxBreakdown.totalTax;
      const postTaxShortfall = Math.max(0, -postTaxCashBalance);
      let postTaxSurplus = Math.max(0, postTaxCashBalance);
      if (postTaxSurplus > 0) {
        const retirementContributions = buildRetirementContributionAmounts({
          availableSurplus: postTaxSurplus,
          assets: normalizedAssets,
          earnedCompensation: yearlyPlan.householdTaxInput.wages,
          age: currentAge + yearIndex,
        });
        for (const [assetName, contributionAmount] of retirementContributions) {
          saleResult.assetValues.set(assetName, (saleResult.assetValues.get(assetName) ?? 0) + contributionAmount);
          saleResult.assetCostBases.set(assetName, (saleResult.assetCostBases.get(assetName) ?? 0) + contributionAmount);
          flowTotalsWithTaxes.set(`${assetName} contribution`, contributionAmount);
          postTaxSurplus -= contributionAmount;
        }
      }

      if (postTaxSurplus > 0) {
        const surplusReinvestmentAssets = normalizedAssets
          .filter(
            (asset): asset is NormalizedSimulationInvestmentAsset =>
              asset.kind === "investment" && !isRetirementInvestmentAsset(asset)
          )
          .map((asset) => ({
            name: asset.name,
            isCashLike: isCashLikeInvestmentAsset(asset),
            weight: asset.reinvestmentWeight,
          }));
        const reinvestmentAmounts = buildSurplusReinvestmentAmounts(
          postTaxSurplus,
          saleResult.assetValues,
          surplusReinvestmentAssets
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
      const endingInvestmentAssets = sumAccessibleInvestmentAssets(normalizedAssets, yearAssetValues, simulationAge);
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
      if (endingInvestmentAssets <= 0.000001) {
        bankruptcyCountsByYear[yearIndex] += 1;
      }
      if (hasDepleted) {
        depletionCountsByYear[yearIndex] += 1;
      }

      if (shouldCaptureScenarioDetails) {
        yearlyRows.push({
          yearNumber: yearIndex + 1,
          label: yearlyPlan.label,
          inflationMode: inflation.mode,
          inflationRateApplied: yearlyPlan.inflationRateApplied,
          inflationRegime: yearlyPlan.inflationRegime,
          startingAssets: startingTotalAssets,
          endingAssets: finalTotalAssets,
          startingLiquidAssets: startingInvestmentAssets,
          liquidAssets: endingInvestmentAssets,
          totalExpenses,
          totalGains,
          taxableGains: totalTaxableGains,
          taxAmount: taxBreakdown.totalTax,
          depleted: hasDepleted,
          bankruptcyProbability: ((bankruptcyCountsByYear[yearIndex] ?? 0) / Math.max(1, attempt + 1)) * 100,
          depletionProbability: ((depletionCountsByYear[yearIndex] ?? 0) / Math.max(1, attempt + 1)) * 100,
          householdTaxInput: effectiveTaxInput,
          flowTotals: flowTotalsWithTaxes,
          flowPercentages,
          startingAssetValues,
          startingAssetMarketValues,
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
    bankruptcyCountsByYear,
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

function buildRealizedInflationPath({
  yearlyPlans,
  inflation,
  nextStandardNormal,
  nextRandom,
}: {
  yearlyPlans: readonly SimulationYearlyPlan[];
  inflation: SimulationInflationConfig;
  nextStandardNormal: () => number;
  nextRandom: () => number;
}): RealizedYearlyPlan[] {
  const realizedPlans: RealizedYearlyPlan[] = [];
  let cumulativeInflationMultiplier = 1;
  let currentRegime: "low" | "high" | null = null;
  let previousInflationRateApplied: number | null = null;

  if (inflation.mode === "regime-switching") {
    currentRegime = selectInitialInflationRegime(inflation, nextRandom);
  }

  for (let yearIndex = 0; yearIndex < yearlyPlans.length; yearIndex += 1) {
    const yearlyPlan = yearlyPlans[yearIndex];
    if (!yearlyPlan) {
      continue;
    }

    if (yearlyPlan.legacySnapshot) {
      const inflationRateApplied =
        inflation.mode === "fixed" ? inflation.fixedRate : inflation.lowRegime.averageRate;
      const inflationRateDeltaApplied =
        previousInflationRateApplied === null ? 0 : inflationRateApplied - previousInflationRateApplied;
      realizedPlans.push({
        year: yearlyPlan.year,
        label: yearlyPlan.label,
        flowAmounts: new Map(yearlyPlan.legacySnapshot.flowAmounts),
        netAmount: yearlyPlan.legacySnapshot.netAmount,
        totalExpenses: yearlyPlan.legacySnapshot.totalExpenses,
        householdTaxInput: cloneHouseholdTaxInput(yearlyPlan.legacySnapshot.householdTaxInput),
        inflationRateApplied,
        inflationRateDeltaApplied,
        inflationRegime: inflation.mode === "fixed" ? "fixed" : "low",
      });
      previousInflationRateApplied = inflationRateApplied;
      continue;
    }

    let inflationRateApplied = 0;
    let inflationRegime: "fixed" | "low" | "high" = "fixed";

    if (inflation.mode === "fixed") {
      inflationRateApplied = inflation.fixedRate;
      inflationRegime = "fixed";
      if (yearIndex > 0) {
        cumulativeInflationMultiplier *= 1 + inflationRateApplied;
      }
    } else {
      if (currentRegime === null) {
        currentRegime = selectInitialInflationRegime(inflation, nextRandom);
      } else if (yearIndex > 0) {
        currentRegime = selectNextInflationRegime(currentRegime, inflation, nextRandom);
      }

      inflationRegime = currentRegime;
      inflationRateApplied = sampleInflationRateForRegime(currentRegime, inflation, nextStandardNormal);
      if (yearIndex > 0) {
        cumulativeInflationMultiplier *= 1 + inflationRateApplied;
      }
    }

    const flowAmounts = new Map<string, number>();
    const householdTaxInput = createEmptySimulationHouseholdTaxInput();
    let netAmount = 0;
    let totalExpenses = 0;

    for (const flow of yearlyPlan.flows) {
      const realizedAmount =
        flow.type === "expense" && flow.inflationAdjusted
          ? flow.baseSignedAmount * cumulativeInflationMultiplier
          : flow.baseSignedAmount;
      flowAmounts.set(flow.name, realizedAmount);
      netAmount += realizedAmount;
      if (realizedAmount < 0) {
        totalExpenses += Math.abs(realizedAmount);
      }
      applyTaxTreatmentAmount(householdTaxInput, flow.taxTreatment, Math.abs(realizedAmount));
    }

    realizedPlans.push({
      year: yearlyPlan.year,
      label: yearlyPlan.label,
      flowAmounts,
      netAmount,
      totalExpenses,
      householdTaxInput,
      inflationRateApplied,
      inflationRateDeltaApplied:
        previousInflationRateApplied === null ? 0 : inflationRateApplied - previousInflationRateApplied,
      inflationRegime,
    });
    previousInflationRateApplied = inflationRateApplied;
  }

  return realizedPlans;
}

function sampleInflationRateForRegime(
  regime: "low" | "high",
  inflation: SimulationRegimeSwitchingInflationConfig,
  nextStandardNormal: () => number
): number {
  const regimeSettings = regime === "low" ? inflation.lowRegime : inflation.highRegime;
  const sampledRate =
    regimeSettings.volatility > 0
      ? regimeSettings.averageRate + regimeSettings.volatility * nextStandardNormal()
      : regimeSettings.averageRate;
  return clampAnnualReturn(sampledRate);
}

function selectInitialInflationRegime(
  inflation: SimulationRegimeSwitchingInflationConfig,
  nextRandom: () => number
): "low" | "high" {
  const switchToHighProbability = 1 - inflation.stayLowProbability;
  const switchToLowProbability = 1 - inflation.stayHighProbability;
  const stationaryHighProbability =
    switchToHighProbability + switchToLowProbability <= 0
      ? 0.5
      : switchToHighProbability / (switchToHighProbability + switchToLowProbability);

  return nextRandom() < stationaryHighProbability ? "high" : "low";
}

function selectNextInflationRegime(
  currentRegime: "low" | "high",
  inflation: SimulationRegimeSwitchingInflationConfig,
  nextRandom: () => number
): "low" | "high" {
  if (currentRegime === "low") {
    return nextRandom() < inflation.stayLowProbability ? "low" : "high";
  }

  return nextRandom() < inflation.stayHighProbability ? "high" : "low";
}

function createEmptySimulationHouseholdTaxInput(): HouseholdTaxInput {
  return {
    wages: 0,
    ordinaryIncome: 0,
    qualifiedDividends: 0,
    shortTermCapitalGains: 0,
    longTermCapitalGains: 0,
    capitalLossDeduction: 0,
    taxExemptIncome: 0,
    stateLocalExemptIncome: 0,
    tripleExemptIncome: 0,
    deductibleExpenses: 0,
    saltTaxesPaid: 0,
    homeMortgageInterestPaid: 0,
    homeMortgageAverageBalance: 0,
    homeMortgageInterestDebtLimit: 0,
  };
}

function getPlanYear(plan: SimulationYearlyPlan | RealizedYearlyPlan | undefined, fallbackIndex: number): number {
  if (plan?.year !== undefined && Number.isInteger(plan.year)) {
    return plan.year;
  }

  const parsedLabelYear = Number.parseInt(plan?.label ?? "", 10);
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

function addSyntheticCashSavingsAssetIfNeeded(
  assets: readonly NormalizedSimulationAsset[]
): readonly NormalizedSimulationAsset[] {
  if (assets.some((asset) => asset.kind === "investment")) {
    return assets;
  }

  return [
    ...assets,
    {
      kind: "investment",
      name: createUniqueSyntheticAssetName(assets, SYNTHETIC_CASH_SAVINGS_ASSET_NAME),
      startingValue: 0,
      desiredAnnualContribution: 0,
      expectedReturn: 0,
      volatility: 0,
      sellProportion: 1,
      avoidEarlyWithdrawalPenalty: false,
      cashGenerations: [],
    },
  ];
}

function createUniqueSyntheticAssetName(
  assets: readonly NormalizedSimulationAsset[],
  baseName: string
): string {
  const existingNames = new Set(assets.map((asset) => asset.name));
  if (!existingNames.has(baseName)) {
    return baseName;
  }

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${baseName} ${suffix}`;
    if (!existingNames.has(candidate)) {
      return candidate;
    }
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
      closingCostPercent: Math.max(0, Math.min(1, asset.closingCostPercent ?? 0)),
      mortgageType: asset.mortgageType ?? "amortizing",
      interestOnlyMaturityAction:
        asset.mortgageType === "interest-only" ? asset.interestOnlyMaturityAction ?? "payoff" : "payoff",
      mortgageRate: Math.max(0, asset.mortgageRate),
      mortgageTermYears: Math.max(1, Math.floor(asset.mortgageTermYears)),
      monthlyNonTaxCosts: Math.max(0, asset.monthlyNonTaxCosts),
      propertyTaxRate: Math.max(0, asset.propertyTaxRate),
      purchaseYear: asset.purchaseYear,
      saleYear:
        typeof asset.saleYear === "number" && asset.saleYear > asset.purchaseYear ? Math.floor(asset.saleYear) : null,
      saleCostPercent: Math.max(0, Math.min(1, asset.saleCostPercent ?? 0)),
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
    assetType: asset.assetType,
    desiredAnnualContribution: Math.max(0, asset.desiredAnnualContribution ?? 0),
    expectedReturn: asset.expectedReturn,
    volatility: asset.volatility,
    reinvestmentWeight:
      typeof asset.reinvestmentWeight === "number" ? Math.max(0, asset.reinvestmentWeight) : undefined,
    sellProportion: Number.isFinite(asset.sellProportion) ? Math.max(0, asset.sellProportion) : 1,
    avoidEarlyWithdrawalPenalty: asset.avoidEarlyWithdrawalPenalty === true,
    cashGenerations: cashGenerations.map((cashGeneration, index) => ({
      name: cashGeneration.name?.trim() || `Cash generation ${index + 1}`,
      rate: Math.max(0, cashGeneration.rate),
      volatility: Math.max(0, cashGeneration.volatility),
      inflationCorrelation:
        cashGeneration.inflationCorrelation ??
        getDefaultAssetCashGenerationInflationCorrelation(asset.assetType ?? null),
      taxTreatment: cashGeneration.taxTreatment ?? "ordinary-income",
    })),
    saleTax: asset.saleTax
      ? {
          ...(asset.saleTax.costBasis !== undefined ? { costBasis: Math.max(0, asset.saleTax.costBasis) } : {}),
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

function calculateElapsedMortgageMonthsAtYearStart(asset: NormalizedSimulationHomeAsset, year: number): number {
  return Math.max(0, (year - asset.purchaseYear) * 12);
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
      const elapsedMonths = calculateElapsedMortgageMonthsAtYearStart(asset, initialYear);
      const elapsedAppreciationYears = Math.max(0, initialYear - asset.purchaseYear - 1);
      const marketValue = Math.max(
        0,
        asset.initialCost * Math.pow(1 + asset.expectedReturn / 100, elapsedAppreciationYears)
      );
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
): {
  generatedCashTotal: number;
  expenseTotal: number;
} {
  let generatedCashTotal = 0;
  let expenseTotal = 0;

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
    const closingCosts = asset.initialCost * asset.closingCostPercent;
    homeState.marketValues.set(asset.name, asset.initialCost);
    homeState.mortgageBalances.set(asset.name, mortgageBalance);
    homeState.mortgageStates.set(asset.name, createHomeMortgageState(asset));
    assetValues.set(asset.name, asset.initialCost - mortgageBalance);
    if (downPayment > 0.000001) {
      generatedCashTotal -= downPayment;
      flowTotals.set(`${asset.name} down payment`, -downPayment);
    }
    if (closingCosts > 0.000001) {
      generatedCashTotal -= closingCosts;
      expenseTotal += closingCosts;
      flowTotals.set(`${asset.name} closing costs`, -closingCosts);
    }
  }

  return {
    generatedCashTotal,
    expenseTotal,
  };
}

// Sell any home whose sale year is THIS year. The house is liquidated at its
// current market value, selling costs come off the top, the remaining mortgage
// is paid off, and the net proceeds become spendable/reinvestable cash (so the
// normal surplus-reinvestment step distributes it across investments, auto or
// weighted, exactly like income). Profit above the Section 121 primary-residence
// exclusion is reported as a long-term capital gain so it is taxed correctly.
function applyHomeSalesForYear(
  year: number,
  assets: readonly NormalizedSimulationAsset[],
  assetValues: Map<string, number>,
  homeState: HomeSimulationState,
  flowTotals: Map<string, number>,
  filingStatus: FilingStatus
): { cashProceeds: number; taxableGain: number } {
  let cashProceeds = 0;
  let taxableGain = 0;

  for (const asset of assets) {
    if (asset.kind !== "home" || asset.saleYear === null || asset.saleYear !== year) {
      continue;
    }
    const marketValue = homeState.marketValues.get(asset.name) ?? 0;
    if (marketValue <= 0.000001) {
      continue;
    }
    const mortgageBalance = homeState.mortgageBalances.get(asset.name) ?? 0;
    const sellingCosts = marketValue * asset.saleCostPercent;
    const amountRealized = marketValue - sellingCosts; // proceeds the IRS counts (net of selling costs)
    const netToCash = amountRealized - mortgageBalance; // what actually lands in cash after the loan payoff

    const grossGain = amountRealized - asset.initialCost;
    const exclusion = filingStatus === "individual" ? 250000 : 500000;
    const homeTaxableGain = Math.max(0, grossGain - exclusion);

    // liquidate: the home leaves the portfolio for good
    homeState.marketValues.set(asset.name, 0);
    homeState.mortgageBalances.set(asset.name, 0);
    assetValues.set(asset.name, 0);

    cashProceeds += netToCash;
    taxableGain += homeTaxableGain;
    flowTotals.set(`${asset.name} sale proceeds`, (flowTotals.get(`${asset.name} sale proceeds`) ?? 0) + netToCash);
  }

  return { cashProceeds, taxableGain };
}

function applyPeriodAssetReturns({
  assets,
  assetValues,
  homeState,
  periodReturns,
  assetReturnAmounts,
  year,
}: {
  assets: readonly NormalizedSimulationAsset[];
  assetValues: Map<string, number>;
  homeState: HomeSimulationState;
  periodReturns: ReadonlyMap<string, number>;
  assetReturnAmounts: Map<string, number>;
  year: number;
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
    if (year <= asset.purchaseYear) {
      assetValues.set(asset.name, currentMarketValue - (homeState.mortgageBalances.get(asset.name) ?? 0));
      continue;
    }
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
  inflationRateDeltaApplied,
  filingStatus,
  annualNormals,
  flowTotals,
  flowPercentages,
  periodFraction,
  periodMonths,
  openingInvestmentValues,
}: {
  baseTaxInput: HouseholdTaxInput;
  assets: readonly NormalizedSimulationAsset[];
  assetValues: Map<string, number>;
  homeState: HomeSimulationState;
  year: number;
  inflationRateDeltaApplied: number;
  filingStatus: FilingStatus;
  annualNormals: ReadonlyMap<string, number>;
  flowTotals: Map<string, number>;
  flowPercentages: Map<string, number>;
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
        const cashGenerationRate = calculateAssetCashGenerationRate(
          annualNormals.get(asset.name) ?? 0,
          cashGeneration,
          inflationRateDeltaApplied,
          periodFraction
        );
        const generatedCash = currentValue * cashGenerationRate;
        if (generatedCash <= 0.000001) {
          continue;
        }

        const entryName = `${asset.name} ${cashGeneration.name}`;
        generatedCashTotal += generatedCash;
        reinvestmentSources.set(asset.name, (reinvestmentSources.get(asset.name) ?? 0) + generatedCash);
        flowTotals.set(entryName, (flowTotals.get(entryName) ?? 0) + generatedCash);
        flowPercentages.set(entryName, (flowPercentages.get(entryName) ?? 0) + cashGenerationRate * 100);
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
  age,
}: {
  cashNeeded: number;
  assets: readonly NormalizedSimulationAsset[];
  assetValues: ReadonlyMap<string, number>;
  assetCostBases: ReadonlyMap<string, number>;
  flowTotals: Map<string, number>;
  baseTaxInput: HouseholdTaxInput;
  age: number;
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
        asset.kind === "investment" &&
        (nextAssetValues.get(asset.name) ?? 0) > 0.000001 &&
        isAssetAccessibleForDefaultSale(asset, age)
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

function buildRetirementContributionAmounts({
  availableSurplus,
  assets,
  earnedCompensation,
  age,
}: {
  availableSurplus: number;
  assets: readonly NormalizedSimulationAsset[];
  earnedCompensation: number;
  age: number;
}): Map<string, number> {
  const contributionAmounts = new Map<string, number>();
  let remainingSurplus = Math.max(0, availableSurplus);
  let remainingCompensation = Math.max(0, earnedCompensation);
  let remainingIraLimit = getIraContributionLimit(age);
  let remaining401kLimit = get401kContributionLimit(age);

  for (const asset of assets) {
    if (asset.kind !== "investment" || asset.desiredAnnualContribution <= 0 || remainingSurplus <= 0.000001) {
      continue;
    }

    let remainingAccountLimit = 0;
    if (asset.assetType === "ira" || asset.assetType === "roth-ira") {
      remainingAccountLimit = remainingIraLimit;
    } else if (asset.assetType === "401k") {
      remainingAccountLimit = remaining401kLimit;
    } else {
      continue;
    }

    const contributionAmount = Math.min(
      asset.desiredAnnualContribution,
      remainingAccountLimit,
      remainingCompensation,
      remainingSurplus
    );
    if (contributionAmount <= 0.000001) {
      continue;
    }

    contributionAmounts.set(asset.name, contributionAmount);
    remainingSurplus -= contributionAmount;
    remainingCompensation -= contributionAmount;
    if (asset.assetType === "ira" || asset.assetType === "roth-ira") {
      remainingIraLimit -= contributionAmount;
    } else {
      remaining401kLimit -= contributionAmount;
    }
  }

  return contributionAmounts;
}

function isRetirementInvestmentAsset(asset: NormalizedSimulationInvestmentAsset): boolean {
  return asset.assetType === "ira" || asset.assetType === "roth-ira" || asset.assetType === "401k";
}

// A cash-like asset (no expected growth, no volatility, no cash generation) is a
// holding buffer rather than something we actively want to grow. Surplus cash is
// reinvested OUT of these and into real growth assets, so they're only used as a
// reinvestment destination when there is nothing else to put money into.
function isCashLikeInvestmentAsset(asset: NormalizedSimulationInvestmentAsset): boolean {
  return asset.expectedReturn === 0 && asset.volatility === 0 && asset.cashGenerations.length === 0;
}

function isAssetAccessibleForDefaultSale(asset: NormalizedSimulationInvestmentAsset, age: number): boolean {
  return !asset.avoidEarlyWithdrawalPenalty || age >= EARLY_WITHDRAWAL_PENALTY_AVOIDANCE_AGE;
}

function sumAccessibleInvestmentAssets(
  assets: readonly NormalizedSimulationAsset[],
  assetValues: ReadonlyMap<string, number>,
  age: number
): number {
  return assets.reduce((total, asset) => {
    if (asset.kind !== "investment" || !isAssetAccessibleForDefaultSale(asset, age)) {
      return total;
    }

    return total + (assetValues.get(asset.name) ?? 0);
  }, 0);
}

function getIraContributionLimit(age: number): number {
  return age >= 50 ? RETIREMENT_IRA_50_PLUS_LIMIT : RETIREMENT_IRA_UNDER_50_LIMIT;
}

function get401kContributionLimit(age: number): number {
  if (age >= 60 && age <= 63) {
    return RETIREMENT_401K_60_TO_63_LIMIT;
  }

  return age >= 50 ? RETIREMENT_401K_50_PLUS_LIMIT : RETIREMENT_401K_UNDER_50_LIMIT;
}

function buildSurplusReinvestmentAmounts(
  availableSurplus: number,
  assetValues: ReadonlyMap<string, number>,
  reinvestmentAssets: readonly { name: string; isCashLike: boolean; weight?: number }[]
): Map<string, number> {
  const reinvestmentAmounts = new Map<string, number>();
  const surplus = Math.max(0, availableSurplus);
  if (surplus <= 0.000001 || reinvestmentAssets.length === 0) {
    return reinvestmentAmounts;
  }

  // Custom allocation: when explicit reinvestment weights are supplied (the user
  // chose a target split in the income editor), divide the surplus by those
  // weights directly — equal weights give an equal split, unequal weights skew
  // accordingly — rather than mirroring current holdings.
  const customAssets = reinvestmentAssets.filter(
    (asset) => typeof asset.weight === "number" && asset.weight > 0
  );
  if (customAssets.length > 0) {
    const totalCustomWeight = customAssets.reduce((total, asset) => total + (asset.weight ?? 0), 0);
    let allocatedCustom = 0;
    let heaviestCustom = customAssets[0];
    for (const asset of customAssets) {
      if ((asset.weight ?? 0) > (heaviestCustom.weight ?? 0)) {
        heaviestCustom = asset;
      }
      const amount = (surplus * (asset.weight ?? 0)) / totalCustomWeight;
      if (amount > 0.000001) {
        reinvestmentAmounts.set(asset.name, amount);
        allocatedCustom += amount;
      }
    }
    const leftoverCustom = surplus - allocatedCustom;
    if (Math.abs(leftoverCustom) > 0.000001) {
      reinvestmentAmounts.set(
        heaviestCustom.name,
        (reinvestmentAmounts.get(heaviestCustom.name) ?? 0) + leftoverCustom
      );
    }
    return reinvestmentAmounts;
  }

  // Reinvest surplus cash into non-house assets in the proportion they are
  // currently owned (e.g. a 70/30 stock/bond split reinvests new cash 70/30,
  // drifting as the holdings drift). Prefer growth assets; only fall back to
  // cash-like buffers when there is nothing else to hold the money.
  const growthAssets = reinvestmentAssets.filter((asset) => !asset.isCashLike);
  const weightedAssets = growthAssets.length > 0 ? growthAssets : [...reinvestmentAssets];

  const weights = weightedAssets.map((asset) => Math.max(0, assetValues.get(asset.name) ?? 0));
  let totalWeight = weights.reduce((total, weight) => total + weight, 0);
  // No current holdings to proportion against — split the surplus evenly so it
  // still gets put to work.
  const effectiveWeights = totalWeight > 0.000001 ? weights : weightedAssets.map(() => 1);
  totalWeight = effectiveWeights.reduce((total, weight) => total + weight, 0);

  let allocated = 0;
  let heaviestIndex = 0;
  for (let index = 0; index < weightedAssets.length; index += 1) {
    if (effectiveWeights[index] > effectiveWeights[heaviestIndex]) {
      heaviestIndex = index;
    }
    const amount = (surplus * effectiveWeights[index]) / totalWeight;
    if (amount > 0.000001) {
      reinvestmentAmounts.set(weightedAssets[index].name, amount);
      allocated += amount;
    }
  }

  // Hand any rounding remainder to the largest holding.
  const leftover = surplus - allocated;
  if (Math.abs(leftover) > 0.000001) {
    const heaviestName = weightedAssets[heaviestIndex].name;
    reinvestmentAmounts.set(heaviestName, (reinvestmentAmounts.get(heaviestName) ?? 0) + leftover);
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

function calculateAssetCashGenerationRate(
  annualNormal: number,
  cashGeneration: AssetCashGenerationDefinition | undefined,
  inflationRateDeltaApplied: number,
  periodFraction = 1
): number {
  if (!cashGeneration) {
    return 0;
  }

  const inflationAdjustedAnnualRate =
    cashGeneration.rate + (cashGeneration.inflationCorrelation ?? 0) * inflationRateDeltaApplied * 100;
  return Math.max(
    0,
    (inflationAdjustedAnnualRate / 100) * periodFraction +
      ((cashGeneration.volatility / 100) * periodFraction) * annualNormal
  );
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
    stateOrdinaryTaxableIncome: 0,
    stateCapitalGainsTaxableIncome: 0,
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
