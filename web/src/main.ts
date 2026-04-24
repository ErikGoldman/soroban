import { formatCurrency } from "./calculator.js";
import { StubAuthService, type UserIdentity } from "./auth.js";
import {
  formatEditableNumberInput,
  isEditableNumberValid,
  normalizeEditableNumberInput,
  parseEditableNumber,
  parseOptionalEditableNumber,
} from "./editable-number.js";
import {
  formatFormulaNumberToken,
  formatFormulaText,
  isFormulaNumberToken,
  tokenizeFormulaText,
} from "./formula-format.js";
import { buildScenarioFileContents, extractScenarioPlannerState } from "./scenario.js";
import { createPlanningStorage, type SavedPlannerState } from "./storage.js";
import {
  VARIABLE_SWEEP_STEP_COUNT,
  buildVariableSweepValues,
  buildSimulationScenariosFromAggregates,
  getAssetCorrelationValue,
  selectRepresentativeSimulationScenario,
  type SimulationInflationConfig,
  type SimulationInflationMode,
  type SimulationDetailScenario,
  type SimulationDetailYearRow,
  type SimulationPercentile,
  type SimulationScenario,
  type SimulationYearlyPlan,
} from "./simulation.js";
import {
  getSimulationAssetValueEntries,
  getSimulationCashFlowEntries,
  getSimulationSaleEntries,
  getVisibleSimulationFlowEntries,
} from "./simulation-detail.js";
import { getSimulationSellProportion } from "./simulation-input.js";
import {
  Asset,
  Event,
  Flow,
  Variable,
  applyFlowExpenseInflation,
  applyEventsForYear,
  collectFormulaVariableNames,
  collectReferencedVariableNames,
  createAssetCorrelationDefinition,
  createOneTimeExpenseSchedule,
  DEFAULT_EXPENSE_INFLATION_RATE,
  deleteAssetAndPruneCorrelations,
  deleteEventAndPruneVariables,
  deleteFlowAndPruneVariables,
  createFormulaContext,
  evaluateFormula,
  getDefaultAssetCashGenerationInflationCorrelation,
  isFlowInflationAdjusted,
  resolveAssetValueFormula,
  type FlowTaxTreatment,
  type FlowType,
  type AssetCashTaxTreatment,
  type AssetCashGenerationDefinition,
  type AssetCorrelationDefinition,
  type HomeAssetDefinition,
  type InvestmentAssetType,
  type InvestmentAssetDefinition,
  type AssetSaleTaxTreatment,
  type AssetSaleTaxDefinition,
  type EventAction,
  type EventDefinition,
  type EventYear,
  type FlowDefinition,
  type AssetDefinition,
  type VariableDefinition,
} from "./finance.js";
import {
  Tax,
  createDefaultHouseholdTaxProfile,
  createDefaultNYCHouseholdTaxes,
  createStateHouseholdTaxes,
  getStateHouseholdTaxPresetOptions,
  isStateHouseholdTaxPresetId,
  type DeductionMode,
  type FilingStatus,
  type HouseholdTaxInput,
  type HouseholdTaxProfileDefinition,
  normalizeFilingStatus,
  type TaxDefinition,
  type TaxExclusionDefinition,
  type TaxRateDefinition,
} from "./tax.js";
import type {
  SimulationWorkerRunInput,
  SimulationWorkerResponse,
} from "./simulation-worker.js";

declare global {
  interface HTMLButtonElement {
    disabledReason?: string;
    disabledReasonControls?: HTMLElement[];
  }
}

type EventActionDraftKind = EventAction["kind"] | "one-time-expense";
type AssetDraftKind = "investment" | InvestmentAssetType | "home";
type AssetDetailMode = "basic" | "advanced";

interface DisabledSubmitState {
  reason: string;
  controls: HTMLElement[];
}

interface PlannerState {
  variables: VariableDefinition[];
  assets: AssetDefinition[];
  taxes: TaxDefinition[];
  taxProfile: HouseholdTaxProfileDefinition;
  assetCorrelations: AssetCorrelationDefinition[];
  flows: FlowDefinition[];
  events: Event[];
  startYear: string;
  yearsToShow: number;
}

interface EventActionDraft {
  id: string;
  kind: EventActionDraftKind;
  variableName: string;
  m: string;
  b: string;
  flowName: string;
  formula: string;
  variableDefinitionName: string;
  variableDefinitionValue: string;
  flowDefinitionName: string;
  flowDefinitionType: "income" | "expense";
  flowDefinitionFormula: string;
  oneTimeExpenseName: string;
  oneTimeExpenseFormula: string;
}

interface EventEntryDraft {
  id: string;
  year: string;
  actions: EventActionDraft[];
}

interface EventDraft {
  originalName: string | null;
  name: string;
  flowName: string;
  entries: EventEntryDraft[];
}

interface FlowDraft {
  type: FlowType;
  name: string;
  taxTreatment: FlowTaxTreatment;
  formula: string;
  inflationAdjusted: boolean;
  oneTime: boolean;
  oneTimeYear: string;
  changeEvents: FlowChangeDraft[];
  startYear: string;
  endYear: string;
  annualRaisePercent: string;
}

interface FlowEditDraft {
  originalName: string;
  type: FlowType;
  name: string;
  taxTreatment: FlowTaxTreatment;
  formula: string;
  inflationAdjusted: boolean;
  oneTime: boolean;
  oneTimeYear: string;
  startYear: string;
  endYear: string;
  annualRaisePercent: string;
}

interface FlowEventDraft {
  originalName: string | null;
  year: string;
  formula: string;
}

interface FlowChangeDraft {
  id: string;
  year: string;
  formula: string;
}

interface ActiveFlowEventEdit {
  eventName: string | null;
  field: "year" | "formula";
}

interface AssetDraft {
  detailMode: AssetDetailMode;
  kind: AssetDraftKind;
  name: string;
  startingValue: string;
  expectedReturn: string;
  volatility: string;
  initialCost: string;
  cashPurchasePercent: string;
  closingCostPercent: string;
  mortgageType: "amortizing" | "interest-only";
  interestOnlyMaturityAction: "payoff" | "refinance" | "sell";
  mortgageRate: string;
  mortgageTermYears: string;
  monthlyNonTaxCosts: string;
  propertyTaxRate: string;
  purchaseYear: string;
  cashGenerationEnabled: boolean;
  cashGenerations: AssetCashGenerationDraft[];
  saleTaxEnabled: boolean;
  saleTaxExpanded: boolean;
  saleTaxCostBasis: string;
  saleTaxTreatment: AssetSaleTaxTreatment;
}

interface AssetCashGenerationDraft {
  id: string;
  expanded: boolean;
  name: string;
  rate: string;
  volatility: string;
  inflationCorrelation: string;
  taxTreatment: AssetCashTaxTreatment;
}

interface AssetEditDraft extends AssetDraft {
  originalName: string;
  correlations: Record<string, string>;
}

interface TaxRateDraft {
  id: string;
  rate: string;
  upTo: string;
}

interface TaxExclusionDraft {
  id: string;
  name: string;
  amount: string;
  maximum: string;
}

interface TaxDraft {
  originalName: string | null;
  name: string;
  maximum: string;
  rates: TaxRateDraft[];
  exclusions: TaxExclusionDraft[];
}

interface TaxProfileDraft {
  filingStatus: FilingStatus;
  deductionMode: DeductionMode;
  federalStandardDeduction: string;
  otherSaltTaxesPaid: string;
  saltDeductionBaseCap: string;
  saltDeductionFloorCap: string;
  saltDeductionPhaseoutThreshold: string;
  saltDeductionPhaseoutRate: string;
  otherItemizedDeductions: string;
  stateTaxableIncomeAdjustment: string;
  localTaxableIncomeAdjustment: string;
  niitThreshold: string;
  federalOrdinaryTaxName: string;
  federalQualifiedTaxName: string;
  stateTaxName: string;
  stateCapitalGainsTaxName: string;
  localTaxName: string;
  niitTaxName: string;
}

interface YearlySnapshot {
  year: EventYear;
  label: string;
  flowAmounts: Map<string, number>;
  netAmount: number;
  totalExpenses: number;
  householdTaxInput: HouseholdTaxInput;
}

interface SimulationAssetDraft extends AssetDraft {
  sellProportion: string;
}

interface AssetTypePreset {
  label: string;
  expectedReturn: string;
  volatility: string;
  cashGenerations: readonly Omit<AssetCashGenerationDraft, "id" | "expanded">[];
}

const ASSET_TYPE_PRESETS: Record<InvestmentAssetType, AssetTypePreset> = {
  "us-stocks": {
    label: "US stocks",
    expectedReturn: "4",
    volatility: "16",
    cashGenerations: [
      {
        name: "Qualified dividends",
        rate: "1.1",
        volatility: "0",
        inflationCorrelation: "0",
        taxTreatment: "qualified-dividends",
      },
      {
        name: "Ordinary income",
        rate: "0.1",
        volatility: "0",
        inflationCorrelation: "0",
        taxTreatment: "ordinary-income",
      },
    ],
  },
  "federal-bonds": {
    label: "Federal bonds",
    expectedReturn: "0",
    volatility: "0",
    cashGenerations: [
      {
        name: "State+local exempt income",
        rate: "3.7",
        volatility: "0.43",
        inflationCorrelation: "0.35",
        taxTreatment: "state-local-exempt",
      },
    ],
  },
  "local-bonds": {
    label: "Local bonds",
    expectedReturn: "0",
    volatility: "0",
    cashGenerations: [
      {
        name: "Triple exempt income",
        rate: "3.2",
        volatility: "0.19",
        inflationCorrelation: "0.35",
        taxTreatment: "triple-exempt",
      },
    ],
  },
};

const HOME_EXPECTED_RETURN_DEFAULT = "2.5";
const HOME_VOLATILITY_DEFAULT = "1";

interface VariableSweepDraft {
  enabled: boolean;
  variableName: string;
  minValue: string;
  maxValue: string;
}

interface SimulationDraft {
  startYear: string;
  attempts: number;
  currentAge: number;
  horizonYears: number;
  inflationPreset: SimulationInflationPreset;
  fixedInflationRate: string;
  regimeSwitchingInflation: {
    lowAverageRate: string;
    lowVolatility: string;
    highAverageRate: string;
    highVolatility: string;
    stayLowProbability: string;
    stayHighProbability: string;
  };
  taxPreset: TaxPreset;
  customAssetLiquidation: boolean;
  assetRows: SimulationAssetDraft[];
  variableSweep: VariableSweepDraft;
}

interface PersistedSimulationSettingsDraft {
  startYear: string;
  attempts: number;
  currentAge: number;
  horizonYears: number;
  inflationPreset: SimulationInflationPreset;
  fixedInflationRate: string;
  regimeSwitchingInflation: SimulationDraft["regimeSwitchingInflation"];
  taxPreset: TaxPreset;
  customAssetLiquidation: boolean;
  variableSweep: VariableSweepDraft;
}

interface SimulationRunState {
  completedAttempts: number;
  totalAttempts: number;
  workerCount: number;
  completedSweepSteps: number;
  totalSweepSteps: number;
  errorMessage: string | null;
}

interface SimulationSweepStepResult {
  index: number;
  value: number;
  results: Map<SimulationPercentile, SimulationScenario>;
  details: SimulationDetailScenario[];
}

interface SimulationSweepResult {
  variableName: string;
  steps: SimulationSweepStepResult[];
}

interface SimulationVariableOverride {
  variableName: string;
  value: number;
}

interface SimulationTaskDefinition {
  id: number;
  sweepIndex: number;
  chunkIndex: number;
  attemptCount: number;
  input: SimulationWorkerRunInput;
}

interface FormulaValidationResult {
  valid: boolean;
  message: string;
  unknownVariables: string[];
}

interface FormulaEditorBinding {
  wrapper: HTMLElement;
  editor: HTMLDivElement;
  hiddenInput: HTMLInputElement;
  status: HTMLElement;
  form: HTMLFormElement;
  getVariables: () => string[];
}

type FormulaEditorType = "number" | "money" | "percent";

type SummaryTab = "variables" | "assets" | "taxes";
type SimulationChartMetric = "totalAssets" | "liquidAssets";
type SimulationInflationPreset = "fixed" | "fixed-custom" | "regime" | "regime-custom";
type TaxPreset = "nyc" | `state:${string}` | "custom";
const STATE_TAX_PRESET_PREFIX = "state:";
const NYC_TAX_PRESET_OPTION = { id: "nyc", label: "NYC 2026" } as const;
const VARIABLE_SWEEP_STORAGE_KEY_PREFIX = "soroban:simulation-variable-sweep:";
const SIMULATION_TAX_PRESET_STORAGE_KEY_PREFIX = "soroban:simulation-tax-preset:";
const SIMULATION_SETTINGS_STORAGE_KEY_PREFIX = "soroban:simulation-settings:";
// When true, each active worker is assigned a distinct sweep value before any sweep is split into chunks.
const ENABLE_VARIABLE_SWEEP_WORKER_FANOUT = true;
const VARIABLE_SWEEP_DETAIL_SAMPLE_LIMIT = 128;
const DEFAULT_SIMULATION_ATTEMPTS = 5000;
const DEFAULT_SIMULATION_FIXED_INFLATION_RATE = "2.5";
const DEFAULT_CURRENT_USER_AGE = 35;
const MIN_CURRENT_USER_AGE = 0;
const MAX_CURRENT_USER_AGE = 89;
const MIN_SIMULATION_TARGET_AGE = 50;
const MAX_SIMULATION_TARGET_AGE = 90;
const DEFAULT_SIMULATION_TARGET_AGE = 80;
const DEFAULT_SIMULATION_HORIZON_YEARS = DEFAULT_SIMULATION_TARGET_AGE - DEFAULT_CURRENT_USER_AGE;
const SHOW_SIMULATION_EXAMPLE_CARD = false;
const DEFAULT_SIMULATION_REGIME_INFLATION = {
  lowAverageRate: "2.5",
  lowVolatility: "1",
  highAverageRate: "6",
  highVolatility: "2",
  stayLowProbability: "90",
  stayHighProbability: "60",
} as const;

const auth = new StubAuthService();
const storage = createPlanningStorage();
const appRoot = document.querySelector<HTMLDivElement>("#app");

function requireElement<T extends Element>(element: T | null, selector: string): T {
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }

  return element;
}

function getVariableSweepStorageKey(userId: string): string {
  return `${VARIABLE_SWEEP_STORAGE_KEY_PREFIX}${userId}`;
}

function getSimulationTaxPresetStorageKey(userId: string): string {
  return `${SIMULATION_TAX_PRESET_STORAGE_KEY_PREFIX}${userId}`;
}

function getSimulationSettingsStorageKey(userId: string): string {
  return `${SIMULATION_SETTINGS_STORAGE_KEY_PREFIX}${userId}`;
}

const mountedAppRoot = requireElement(appRoot, "#app");

const plannerState: PlannerState = createDefaultPlannerState();

const eventDraft: EventDraft = {
  originalName: null,
  name: "",
  flowName: plannerState.flows[0]?.name ?? "",
  entries: [createEventEntryDraft()],
};

const flowDraft: FlowDraft = createFlowDraft();

const flowEditDraft: FlowEditDraft = createFlowEditDraft();

const flowEventDraft: FlowEventDraft = createFlowEventDraft();
const assetDraft: AssetDraft = createAssetDraft();
const assetEditDraft: AssetEditDraft = createAssetEditDraft();
const taxDraft: TaxDraft = createTaxDraft();
const taxProfileDraft: TaxProfileDraft = createTaxProfileDraft();
const simulationDraft: SimulationDraft = createSimulationDraft();

let flowComposerOpen = false;
let eventComposerOpen = false;
let flowEditorOpen = false;
let assetComposerOpen = false;
let assetEditorOpen = false;
let taxComposerOpen = false;
let simulationInflationSectionExpanded = false;
let simulationTaxesSectionExpanded = false;
let simulationSettingsSectionExpanded = false;
let activeFlowEventEdit: ActiveFlowEventEdit | null = null;
let activeSummaryTab: SummaryTab = "variables";
let activeInlineAssetValueEditName: string | null = null;
let activeInlineExpenseValueEditName: string | null = null;
let shouldFocusNewAssetName = false;
let shouldFocusNewFlowName = false;
let shouldFocusAssetStartingValueIfZero = false;
let selectedSimulationPercentile: SimulationPercentile = 50;
let selectedSimulationChartMetric: SimulationChartMetric = "liquidAssets";
let simulationResults: Map<SimulationPercentile, SimulationScenario> | null = null;
let simulationDetailResults: SimulationDetailScenario[] | null = null;
let simulationSweepResults: SimulationSweepResult | null = null;
let simulationResultsStale = false;
let completedSimulationInputSignature: string | null = null;
let selectedSimulationSweepStepIndex = 0;
let expandedSimulationExampleKeys = new Set<string>();
let simulationRunState: SimulationRunState | null = null;
let activeSimulationWorkers: Worker[] = [];
let activeSimulationRequestId = 0;
let taxProfilePersistTimeout: number | null = null;
let modalEscapeHandlerBound = false;
let modalPointerDownStartedOnBackdrop = false;
const simulationPercentiles: readonly SimulationPercentile[] = [5, 10, 25, 50, 75, 90];
const INCOME_FLOW_TAX_TREATMENTS = [
  { value: "wages", label: "Wages" },
  { value: "ordinary-income", label: "Ordinary income" },
  { value: "qualified-dividends", label: "Qualified dividends" },
  { value: "short-term-capital-gains", label: "Short-term capital gains" },
  { value: "long-term-capital-gains", label: "Long-term capital gains" },
  { value: "tax-exempt-income", label: "Tax-exempt income" },
] satisfies ReadonlyArray<{ value: FlowTaxTreatment; label: string }>;
const EXPENSE_FLOW_TAX_TREATMENTS = [
  { value: "deductible-expense", label: "Deductible expense" },
  { value: "nondeductible-expense", label: "Nondeductible expense" },
] satisfies ReadonlyArray<{ value: FlowTaxTreatment; label: string }>;
syncTaxProfileDraft();

function createEventEntryDraft(flowName = plannerState.flows[0]?.name ?? ""): EventEntryDraft {
  return {
    id: createId(),
    year: plannerState.startYear,
    actions: [createActionDraft(flowName)],
  };
}

function createFlowDraft(type: FlowType = "expense"): FlowDraft {
  return {
    type,
    name: "",
    taxTreatment: type === "income" ? "wages" : "nondeductible-expense",
    formula: "",
    inflationAdjusted: type === "expense",
    oneTime: false,
    oneTimeYear: plannerState.startYear,
    changeEvents: [],
    startYear: plannerState.startYear,
    endYear: "",
    annualRaisePercent: "4",
  };
}

function createFlowEditDraft(): FlowEditDraft {
  return {
    originalName: "",
    ...createFlowDraft(),
  };
}

function createAssetDraft(): AssetDraft {
  const defaultPreset = ASSET_TYPE_PRESETS["us-stocks"];
  const currentYear = String(new Date().getFullYear());
  return {
    detailMode: "basic",
    kind: "us-stocks",
    name: "",
    startingValue: "",
    expectedReturn: defaultPreset.expectedReturn,
    volatility: defaultPreset.volatility,
    initialCost: "0",
    cashPurchasePercent: "20",
    closingCostPercent: "3",
    mortgageType: "amortizing",
    interestOnlyMaturityAction: "payoff",
    mortgageRate: "6",
    mortgageTermYears: "30",
    monthlyNonTaxCosts: "0",
    propertyTaxRate: "1",
    purchaseYear: currentYear,
    cashGenerationEnabled: defaultPreset.cashGenerations.length > 0,
    cashGenerations: defaultPreset.cashGenerations.map((cashGeneration) =>
      createAssetCashGenerationDraftFromPreset(cashGeneration)
    ),
    saleTaxEnabled: true,
    saleTaxExpanded: false,
    saleTaxCostBasis: "",
    saleTaxTreatment: "long-term-capital-gains",
  };
}

function createAssetCashGenerationDraft(
  kind: AssetDraftKind = "investment",
  options: {
    expanded?: boolean;
  } = {}
): AssetCashGenerationDraft {
  const assetType = getInvestmentAssetTypeFromDraftKind(kind);
  return {
    id: createId(),
    expanded: options.expanded ?? false,
    name: "",
    rate: "0",
    volatility: "0",
    inflationCorrelation: String(getDefaultAssetCashGenerationInflationCorrelation(assetType)),
    taxTreatment: "ordinary-income",
  };
}

function getAssetTypeLabel(kind: AssetDraftKind): string {
  switch (kind) {
    case "home":
      return "Home";
    case "us-stocks":
      return "US stocks";
    case "federal-bonds":
      return "Federal bonds";
    case "local-bonds":
      return "Local bonds";
    case "investment":
    default:
      return "Other investment";
  }
}

function getInvestmentAssetTypeFromDraftKind(kind: AssetDraftKind): InvestmentAssetType | null {
  switch (kind) {
    case "us-stocks":
    case "federal-bonds":
    case "local-bonds":
      return kind;
    default:
      return null;
  }
}

function getAssetTypePreset(kind: AssetDraftKind): AssetTypePreset | null {
  const assetType = getInvestmentAssetTypeFromDraftKind(kind);
  return assetType ? ASSET_TYPE_PRESETS[assetType] : null;
}

function isBondAssetDraftKind(kind: AssetDraftKind): boolean {
  return kind === "federal-bonds" || kind === "local-bonds";
}

function getDefaultAssetDetailMode(kind: AssetDraftKind): AssetDetailMode {
  return kind === "home" ? "advanced" : "basic";
}

function createAssetCashGenerationDraftFromPreset(
  cashGeneration: Omit<AssetCashGenerationDraft, "id" | "expanded">
): AssetCashGenerationDraft {
  return {
    id: createId(),
    expanded: false,
    ...cashGeneration,
  };
}

function resetInvestmentTaxModelDefaults(draft: AssetDraft | AssetEditDraft): void {
  draft.cashGenerationEnabled = false;
  draft.cashGenerations = [createAssetCashGenerationDraft(draft.kind, { expanded: true })];
  draft.saleTaxEnabled = false;
  draft.saleTaxExpanded = false;
  draft.saleTaxCostBasis = "";
  draft.saleTaxTreatment = "long-term-capital-gains";
}

function applyAssetTypePresetDefaults(draft: AssetDraft | AssetEditDraft): void {
  const preset = getAssetTypePreset(draft.kind);
  draft.detailMode = getDefaultAssetDetailMode(draft.kind);

  if (draft.kind === "home") {
    draft.expectedReturn = HOME_EXPECTED_RETURN_DEFAULT;
    draft.volatility = HOME_VOLATILITY_DEFAULT;
    resetInvestmentTaxModelDefaults(draft);
    return;
  }

  resetInvestmentTaxModelDefaults(draft);

  if (!preset) {
    draft.expectedReturn = "0";
    draft.volatility = "0";
    return;
  }

  draft.expectedReturn = preset.expectedReturn;
  draft.volatility = preset.volatility;
  draft.cashGenerationEnabled = preset.cashGenerations.length > 0;
  draft.cashGenerations = preset.cashGenerations.map((cashGeneration) =>
    createAssetCashGenerationDraftFromPreset(cashGeneration)
  );

  if (draft.kind === "us-stocks") {
    draft.saleTaxEnabled = true;
    draft.saleTaxExpanded = false;
    draft.saleTaxTreatment = "long-term-capital-gains";
  }
}

function createAssetEditDraft(): AssetEditDraft {
  return {
    originalName: "",
    correlations: {},
    ...createAssetDraft(),
  };
}

function createSimulationDraft(): SimulationDraft {
  return {
    startYear: String(new Date().getFullYear()),
    attempts: DEFAULT_SIMULATION_ATTEMPTS,
    currentAge: DEFAULT_CURRENT_USER_AGE,
    horizonYears: DEFAULT_SIMULATION_HORIZON_YEARS,
    inflationPreset: "regime",
    fixedInflationRate: DEFAULT_SIMULATION_FIXED_INFLATION_RATE,
    regimeSwitchingInflation: {
      ...DEFAULT_SIMULATION_REGIME_INFLATION,
    },
    taxPreset: "nyc",
    customAssetLiquidation: false,
    assetRows: [],
    variableSweep: {
      enabled: false,
      variableName: "",
      minValue: "0",
      maxValue: "0",
    },
  };
}

function normalizeSimulationCurrentAge(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_CURRENT_USER_AGE;
  }

  const roundedValue = Math.round(value);
  return roundedValue >= MIN_CURRENT_USER_AGE && roundedValue <= MAX_CURRENT_USER_AGE
    ? roundedValue
    : DEFAULT_CURRENT_USER_AGE;
}

function getMinimumSimulationHorizonYears(currentAge = simulationDraft.currentAge): number {
  return Math.max(1, MIN_SIMULATION_TARGET_AGE - currentAge);
}

function getMaximumSimulationHorizonYears(currentAge = simulationDraft.currentAge): number {
  return Math.max(1, MAX_SIMULATION_TARGET_AGE - currentAge);
}

function getDefaultSimulationHorizonYears(currentAge = simulationDraft.currentAge): number {
  return Math.max(
    getMinimumSimulationHorizonYears(currentAge),
    Math.min(getMaximumSimulationHorizonYears(currentAge), DEFAULT_SIMULATION_TARGET_AGE - currentAge)
  );
}

function normalizeSimulationHorizonYears(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return getDefaultSimulationHorizonYears();
  }

  const roundedValue = Math.round(value);
  return roundedValue >= getMinimumSimulationHorizonYears() && roundedValue <= getMaximumSimulationHorizonYears()
    ? roundedValue
    : getDefaultSimulationHorizonYears();
}

function getSimulationTargetAge(): number {
  return simulationDraft.currentAge + normalizeSimulationHorizonYears(simulationDraft.horizonYears);
}

function setSimulationTargetAge(targetAge: number): void {
  const roundedAge = Math.round(targetAge);
  simulationDraft.horizonYears =
    roundedAge >= MIN_SIMULATION_TARGET_AGE && roundedAge <= MAX_SIMULATION_TARGET_AGE
      ? normalizeSimulationHorizonYears(roundedAge - simulationDraft.currentAge)
      : getDefaultSimulationHorizonYears();
}

function getSimulationInflationModeForPreset(preset: SimulationInflationPreset): SimulationInflationMode {
  return preset === "fixed" || preset === "fixed-custom" ? "fixed" : "regime-switching";
}

function isSimulationInflationCustomPreset(preset: SimulationInflationPreset): boolean {
  return preset === "fixed-custom" || preset === "regime-custom";
}

function normalizeSimulationInflationPreset(
  savedInflation:
    | {
        preset?: string;
        enabled?: boolean;
        mode?: "fixed" | "regime-switching";
      }
    | undefined,
): SimulationInflationPreset {
  if (
    savedInflation?.preset === "fixed" ||
    savedInflation?.preset === "fixed-custom" ||
    savedInflation?.preset === "regime" ||
    savedInflation?.preset === "regime-custom"
  ) {
    return savedInflation.preset;
  }

  if (savedInflation?.enabled === false) {
    return "fixed-custom";
  }

  if (savedInflation?.mode === "fixed") {
    return "fixed-custom";
  }

  if (savedInflation?.mode === "regime-switching") {
    return "regime-custom";
  }

  return "regime";
}

function normalizeSimulationTaxPreset(value: string | undefined, fallback: TaxPreset = "nyc"): TaxPreset {
  if (value === "nyc" || value === "custom") {
    return value;
  }

  if (value?.startsWith(STATE_TAX_PRESET_PREFIX)) {
    const statePresetId = value.slice(STATE_TAX_PRESET_PREFIX.length);
    if (isStateHouseholdTaxPresetId(statePresetId)) {
      return `${STATE_TAX_PRESET_PREFIX}${statePresetId}`;
    }
  }

  return fallback;
}

function getBuiltInTaxPresetOptions(): { id: "nyc" | `state:${string}`; label: string }[] {
  return [
    NYC_TAX_PRESET_OPTION,
    ...getStateHouseholdTaxPresetOptions().map((preset) => ({
      id: `${STATE_TAX_PRESET_PREFIX}${preset.id}` as const,
      label: `${preset.label} 2026`,
    })),
  ].sort((left, right) => left.label.localeCompare(right.label));
}

function getSavedRegimeSwitchingInflationValue(
  regimeSwitching:
    | {
        lowAverageRate?: number;
        lowVolatility?: number;
        highAverageRate?: number;
        highVolatility?: number;
        lowRate?: number;
        highRate?: number;
        stayLowProbability?: number;
        stayHighProbability?: number;
      }
    | undefined,
  field:
    | "lowAverageRate"
    | "lowVolatility"
    | "highAverageRate"
    | "highVolatility"
    | "stayLowProbability"
    | "stayHighProbability"
): number | null {
  const rawValue =
    field === "lowAverageRate"
      ? regimeSwitching?.lowAverageRate ?? regimeSwitching?.lowRate
      : field === "highAverageRate"
        ? regimeSwitching?.highAverageRate ?? regimeSwitching?.highRate
        : regimeSwitching?.[field];

  return typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null;
}

function createTaxRateDraft(): TaxRateDraft {
  return {
    id: createId(),
    rate: "0",
    upTo: "",
  };
}

function createTaxExclusionDraft(): TaxExclusionDraft {
  return {
    id: createId(),
    name: "",
    amount: "0",
    maximum: "",
  };
}

function createTaxDraft(): TaxDraft {
  return {
    originalName: null,
    name: "",
    maximum: "",
    rates: [createTaxRateDraft()],
    exclusions: [],
  };
}

function createTaxProfileDraft(): TaxProfileDraft {
  const profile = createDefaultHouseholdTaxProfile();
  return {
    filingStatus: profile.filingStatus,
    deductionMode: profile.deductionMode,
    federalStandardDeduction: String(profile.federalStandardDeduction),
    otherSaltTaxesPaid: String(profile.otherSaltTaxesPaid),
    saltDeductionBaseCap: String(profile.saltDeductionBaseCap),
    saltDeductionFloorCap: String(profile.saltDeductionFloorCap),
    saltDeductionPhaseoutThreshold: String(profile.saltDeductionPhaseoutThreshold),
    saltDeductionPhaseoutRate: String(profile.saltDeductionPhaseoutRate),
    otherItemizedDeductions: String(profile.otherItemizedDeductions),
    stateTaxableIncomeAdjustment: String(profile.stateTaxableIncomeAdjustment),
    localTaxableIncomeAdjustment: String(profile.localTaxableIncomeAdjustment),
    niitThreshold: String(profile.niitThreshold),
    federalOrdinaryTaxName: profile.federalOrdinaryTaxName,
    federalQualifiedTaxName: profile.federalQualifiedTaxName,
    stateTaxName: profile.stateTaxName,
    stateCapitalGainsTaxName: profile.stateCapitalGainsTaxName,
    localTaxName: profile.localTaxName,
    niitTaxName: profile.niitTaxName,
  };
}

function buildNormalizedTaxDefinition(definition: TaxDefinition): TaxDefinition {
  const normalized = new Tax(definition);
  return {
    name: normalized.name,
    taxRates: normalized.taxRates.map((rate) => ({
      rate: rate.rate,
      ...(rate.upTo === null ? {} : { upTo: rate.upTo }),
    })),
    exclusions: normalized.exclusions.map((exclusion) => ({
      name: exclusion.name,
      amount: exclusion.amount,
      ...(exclusion.maximum === null ? {} : { maximum: exclusion.maximum }),
    })),
    ...(normalized.maximum === null ? {} : { maximum: normalized.maximum }),
    ...(normalized.taxableIncomeMultiplier === 1 ? {} : { taxableIncomeMultiplier: normalized.taxableIncomeMultiplier }),
  };
}

function isHomeAsset(asset: AssetDefinition): asset is HomeAssetDefinition {
  return asset.kind === "home";
}

function isInvestmentAsset(asset: AssetDefinition): asset is InvestmentAssetDefinition {
  return asset.kind !== "home";
}

function getAssetDefinitionTypeLabel(asset: AssetDefinition): string {
  if (isHomeAsset(asset)) {
    return "Home";
  }

  return asset.assetType ? getAssetTypeLabel(asset.assetType) : "Investment";
}

function getAssetCashGenerations(asset: AssetDefinition): readonly AssetCashGenerationDefinition[] {
  if (!isInvestmentAsset(asset)) {
    return [];
  }

  return asset.cashGenerations && asset.cashGenerations.length > 0
    ? asset.cashGenerations
    : asset.cashGeneration
      ? [asset.cashGeneration]
      : [];
}

function buildPlannerFormulaContext(variableOverride?: SimulationVariableOverride): Record<string, number> {
  const context = Object.fromEntries(plannerState.variables.map((variable) => [variable.name, variable.value]));
  if (variableOverride) {
    context[variableOverride.variableName] = variableOverride.value;
  }
  return context;
}

function ensurePlannerVariablesExist(variableNames: Iterable<string>): string[] {
  const existingNames = new Set(plannerState.variables.map((variable) => variable.name));
  const createdNames: string[] = [];

  for (const variableName of variableNames) {
    const normalizedName = variableName.trim();
    if (!normalizedName || existingNames.has(normalizedName)) {
      continue;
    }

    plannerState.variables.push({
      name: normalizedName,
      value: 0,
    });
    existingNames.add(normalizedName);
    createdNames.push(normalizedName);
  }

  if (createdNames.length > 0) {
    syncSimulationVariableSweepDraft();
  }

  return createdNames;
}

function collectMissingFormulaVariables(
  formulas: readonly string[],
  additionalKnownVariableNames: readonly string[] = []
): string[] {
  const knownVariables = new Set([
    ...plannerState.variables.map((variable) => variable.name),
    ...additionalKnownVariableNames.map((name) => name.trim()).filter(Boolean),
  ]);
  const missingVariables = new Set<string>();

  for (const formula of formulas) {
    for (const variableName of collectFormulaVariableNames(formula)) {
      if (!knownVariables.has(variableName)) {
        missingVariables.add(variableName);
      }
    }
  }

  return [...missingVariables];
}

function getAssetDefinitionFormulas(asset: AssetDefinition): string[] {
  if (isHomeAsset(asset)) {
    return asset.initialCostFormula ? [asset.initialCostFormula] : [];
  }

  return asset.startingValueFormula ? [asset.startingValueFormula] : [];
}

function getEventFormulas(event: Pick<Event, "schedule">): string[] {
  return event.schedule.flatMap((entry) =>
    entry.actions.flatMap((action) => {
      switch (action.kind) {
        case "set-flow-formula":
          return [action.formula];
        case "add-flow":
          return [action.flow.formula];
        default:
          return [];
      }
    })
  );
}

function getFlowAndEventFormulas(flow: FlowDefinition): string[] {
  return [
    flow.formula,
    ...plannerState.events
      .filter((event) => event.flowName === flow.name)
      .flatMap((event) => getEventFormulas(event)),
  ];
}

function collectFormulaVariables(formulas: readonly string[]): Set<string> {
  const names = new Set<string>();

  for (const formula of formulas) {
    for (const variableName of collectFormulaVariableNames(formula)) {
      names.add(variableName);
    }
  }

  return names;
}

function collectRemovedFormulaVariables(previousFormulas: readonly string[], nextFormulas: readonly string[]): string[] {
  const previousNames = collectFormulaVariables(previousFormulas);
  const nextNames = collectFormulaVariables(nextFormulas);

  return [...previousNames].filter((name) => !nextNames.has(name));
}

function pruneUnusedPlannerVariables(variableNames: Iterable<string>): void {
  const candidateNames = new Set([...variableNames].map((name) => name.trim()).filter(Boolean));
  if (candidateNames.size === 0) {
    return;
  }

  const snapshot = createPlannerSnapshot();
  const referencedNames = collectReferencedVariableNames(snapshot.flows, snapshot.events);
  for (const asset of plannerState.assets) {
    for (const variableName of collectFormulaVariables(getAssetDefinitionFormulas(asset))) {
      referencedNames.add(variableName);
    }
  }

  const previousCount = plannerState.variables.length;
  plannerState.variables = plannerState.variables.filter(
    (variable) => !candidateNames.has(variable.name) || referencedNames.has(variable.name)
  );

  if (plannerState.variables.length !== previousCount) {
    syncSimulationVariableSweepDraft();
  }
}

function resolvePlannerAssetDefinition(asset: AssetDefinition): AssetDefinition {
  return resolveAssetValueFormula(asset, buildPlannerFormulaContext());
}

function getAssetValueFormulaInput(asset: AssetDefinition): string {
  const resolvedAsset = resolvePlannerAssetDefinition(asset);

  if (isHomeAsset(resolvedAsset)) {
    return resolvedAsset.initialCostFormula ?? formatFormulaText(String(resolvedAsset.initialCost));
  }

  return resolvedAsset.startingValueFormula ?? formatFormulaText(String(resolvedAsset.startingValue));
}

function getAssetSummaryValue(asset: AssetDefinition): number {
  const resolvedAsset = resolvePlannerAssetDefinition(asset);
  return isHomeAsset(resolvedAsset) ? resolvedAsset.initialCost : resolvedAsset.startingValue;
}

function buildAssetDraftFromDefinition(
  asset: AssetDefinition,
  options: {
    preserveFormulaSource?: boolean;
  } = {}
): AssetDraft {
  const cashGenerations = getAssetCashGenerations(asset);
  const resolvedAsset = resolvePlannerAssetDefinition(asset);
  const kind = asset.kind === "home" ? "home" : asset.assetType ?? "investment";
  return {
    detailMode: getDefaultAssetDetailMode(kind),
    kind,
    name: asset.name,
    startingValue:
      options.preserveFormulaSource && isInvestmentAsset(asset)
        ? getAssetValueFormulaInput(asset)
        : String(isInvestmentAsset(resolvedAsset) ? resolvedAsset.startingValue : 0),
    expectedReturn: String(asset.expectedReturn),
    volatility: String(asset.volatility),
    initialCost:
      options.preserveFormulaSource && isHomeAsset(asset)
        ? getAssetValueFormulaInput(asset)
        : String(isHomeAsset(resolvedAsset) ? resolvedAsset.initialCost : 0),
    cashPurchasePercent: String(isHomeAsset(resolvedAsset) ? resolvedAsset.cashPurchasePercent * 100 : 20),
    closingCostPercent: String(isHomeAsset(resolvedAsset) ? (resolvedAsset.closingCostPercent ?? 0) * 100 : 3),
    mortgageType: isHomeAsset(resolvedAsset) ? resolvedAsset.mortgageType ?? "amortizing" : "amortizing",
    interestOnlyMaturityAction:
      isHomeAsset(resolvedAsset) && resolvedAsset.mortgageType === "interest-only"
        ? resolvedAsset.interestOnlyMaturityAction ?? "payoff"
        : "payoff",
    mortgageRate: String(isHomeAsset(resolvedAsset) ? resolvedAsset.mortgageRate : 6),
    mortgageTermYears: String(isHomeAsset(resolvedAsset) ? resolvedAsset.mortgageTermYears : 30),
    monthlyNonTaxCosts: String(isHomeAsset(resolvedAsset) ? resolvedAsset.monthlyNonTaxCosts : 0),
    propertyTaxRate: String(isHomeAsset(resolvedAsset) ? resolvedAsset.propertyTaxRate : 1),
    purchaseYear: String(isHomeAsset(resolvedAsset) ? resolvedAsset.purchaseYear : new Date().getFullYear()),
    cashGenerationEnabled: cashGenerations.length > 0,
    cashGenerations:
      cashGenerations.length > 0
        ? cashGenerations.map((cashGeneration, index) => ({
            id: createId(),
            expanded: false,
            name: cashGeneration.name ?? "",
            rate: String(cashGeneration.rate),
            volatility: String(cashGeneration.volatility),
            inflationCorrelation: String(
              cashGeneration.inflationCorrelation ??
                getDefaultAssetCashGenerationInflationCorrelation(
                  isInvestmentAsset(asset) ? asset.assetType ?? null : null
                )
            ),
            taxTreatment: cashGeneration.taxTreatment ?? "ordinary-income",
          }))
        : [createAssetCashGenerationDraft(asset.kind === "home" ? "home" : asset.assetType ?? "investment", { expanded: true })],
    saleTaxEnabled: isInvestmentAsset(resolvedAsset) && Boolean(resolvedAsset.saleTax),
    saleTaxExpanded: false,
    saleTaxCostBasis:
      isInvestmentAsset(resolvedAsset) && resolvedAsset.saleTax?.costBasis !== undefined
        ? String(resolvedAsset.saleTax.costBasis)
        : "",
    saleTaxTreatment:
      isInvestmentAsset(resolvedAsset)
        ? resolvedAsset.saleTax?.taxTreatment ?? "long-term-capital-gains"
        : "long-term-capital-gains",
  };
}

function migratePersistedAsset(
  asset: SavedPlannerState["assets"][number],
  context: Record<string, number>
): AssetDefinition {
  if (asset.kind === "home") {
    return resolveAssetValueFormula(
      new Asset({
        kind: "home",
        name: asset.name,
        initialCost: asset.initialCost ?? 0,
        ...(asset.initialCostFormula ? { initialCostFormula: asset.initialCostFormula } : {}),
        ...(asset.alreadyOwned ? { alreadyOwned: true } : {}),
        expectedReturn: asset.expectedReturn,
        volatility: asset.volatility,
        cashPurchasePercent: asset.cashPurchasePercent ?? 0,
        closingCostPercent: asset.closingCostPercent ?? 0,
        mortgageType: asset.mortgageType ?? "amortizing",
        interestOnlyMaturityAction:
          asset.mortgageType === "interest-only" ? asset.interestOnlyMaturityAction ?? "payoff" : undefined,
        mortgageRate: asset.mortgageRate ?? 0,
        mortgageTermYears: asset.mortgageTermYears ?? 30,
        monthlyNonTaxCosts: asset.monthlyNonTaxCosts ?? 0,
        propertyTaxRate: asset.propertyTaxRate ?? 0,
        purchaseYear: asset.purchaseYear ?? new Date().getFullYear(),
      }).toDefinition(),
      context
    );
  }

  const persistedCashGenerations =
    Array.isArray(asset.cashGenerations) && asset.cashGenerations.length > 0
      ? asset.cashGenerations
      : asset.cashGeneration
        ? [asset.cashGeneration]
        : [];

  return resolveAssetValueFormula(
    new Asset({
      name: asset.name,
      ...(asset.assetType ? { assetType: asset.assetType } : {}),
      startingValue: asset.startingValue ?? 0,
      ...(asset.startingValueFormula ? { startingValueFormula: asset.startingValueFormula } : {}),
      expectedReturn: asset.expectedReturn,
      volatility: asset.volatility,
      sellProportion:
        typeof asset.sellProportion === "number" && Number.isFinite(asset.sellProportion)
          ? asset.sellProportion
          : 1,
      ...(persistedCashGenerations.length > 0
        ? {
            cashGenerations: persistedCashGenerations.map((cashGeneration, index) => ({
              name: cashGeneration.name ?? "",
              rate: cashGeneration.rate,
              volatility: cashGeneration.volatility,
              inflationCorrelation:
                cashGeneration.inflationCorrelation ??
                getDefaultAssetCashGenerationInflationCorrelation(asset.assetType ?? null),
              taxTreatment: cashGeneration.taxTreatment ?? "ordinary-income",
            })),
          }
        : {}),
      ...(asset.saleTax
        ? {
            saleTax: {
              ...(asset.saleTax.costBasis !== undefined ? { costBasis: asset.saleTax.costBasis } : {}),
              taxTreatment: asset.saleTax.taxTreatment ?? "long-term-capital-gains",
            },
          }
        : {}),
    }).toDefinition(),
    context
  );
}

function migratePersistedAssets(
  assets: readonly SavedPlannerState["assets"][number][],
  assetSellWeightMode: SavedPlannerState["assetSellWeightMode"] | undefined,
  variables: readonly VariableDefinition[]
): AssetDefinition[] {
  const context = Object.fromEntries(variables.map((variable) => [variable.name, variable.value]));
  const migratedAssets = assets.map((asset) => migratePersistedAsset(asset, context));

  if (assetSellWeightMode === "portfolio-proportion-multiplier") {
    return migratedAssets;
  }

  const investmentAssets = migratedAssets.filter(isInvestmentAsset);
  if (investmentAssets.length === 0) {
    return migratedAssets;
  }

  const totalLegacySellProportion = investmentAssets.reduce((total, asset) => total + asset.sellProportion, 0);
  const looksLikeLegacyPercentages = investmentAssets.every(
    (asset) => asset.sellProportion >= 0 && asset.sellProportion <= 1.000001
  );
  if (!looksLikeLegacyPercentages || Math.abs(totalLegacySellProportion - 1) > 0.000001) {
    return migratedAssets;
  }

  const totalStartingValue = investmentAssets.reduce((total, asset) => total + Math.max(0, asset.startingValue), 0);
  return migratedAssets.map((asset) => {
    if (!isInvestmentAsset(asset)) {
      return asset;
    }

    if (asset.sellProportion <= 0.000001) {
      return { ...asset, sellProportion: 0 };
    }

    if (totalStartingValue <= 0.000001 || asset.startingValue <= 0.000001) {
      return { ...asset, sellProportion: 1 };
    }

    const portfolioShare = asset.startingValue / totalStartingValue;
    return {
      ...asset,
      sellProportion: asset.sellProportion / portfolioShare,
    };
  });
}

function buildTaxProfileDefinitionFromSaved(
  savedProfile: Partial<HouseholdTaxProfileDefinition> | undefined,
  taxes: readonly TaxDefinition[],
  fallback: HouseholdTaxProfileDefinition
): HouseholdTaxProfileDefinition {
  const next = {
    ...fallback,
    ...(savedProfile ?? {}),
  };
  const availableTaxNames = new Set(taxes.map((tax) => tax.name));

  return {
    filingStatus: normalizeFilingStatus(next.filingStatus),
    deductionMode: next.deductionMode,
    federalStandardDeduction: Number(next.federalStandardDeduction) || fallback.federalStandardDeduction,
    otherSaltTaxesPaid: Number((savedProfile as { saltDeduction?: number } | undefined)?.saltDeduction ?? next.otherSaltTaxesPaid) || 0,
    saltDeductionBaseCap:
      Number((savedProfile as { saltDeductionCap?: number } | undefined)?.saltDeductionCap ?? next.saltDeductionBaseCap) ||
      fallback.saltDeductionBaseCap,
    saltDeductionFloorCap: Number(next.saltDeductionFloorCap) || fallback.saltDeductionFloorCap,
    saltDeductionPhaseoutThreshold:
      Number(next.saltDeductionPhaseoutThreshold) || fallback.saltDeductionPhaseoutThreshold,
    saltDeductionPhaseoutRate: Number(next.saltDeductionPhaseoutRate) || fallback.saltDeductionPhaseoutRate,
    otherItemizedDeductions: Number(next.otherItemizedDeductions) || 0,
    stateTaxableIncomeAdjustment: Number(next.stateTaxableIncomeAdjustment) || 0,
    localTaxableIncomeAdjustment: Number(next.localTaxableIncomeAdjustment) || 0,
    niitThreshold: Number(next.niitThreshold) || fallback.niitThreshold,
    federalOrdinaryTaxName: availableTaxNames.has(next.federalOrdinaryTaxName) ? next.federalOrdinaryTaxName : "",
    federalQualifiedTaxName: availableTaxNames.has(next.federalQualifiedTaxName) ? next.federalQualifiedTaxName : "",
    stateTaxName: availableTaxNames.has(next.stateTaxName) ? next.stateTaxName : "",
    stateCapitalGainsTaxName: availableTaxNames.has(next.stateCapitalGainsTaxName)
      ? next.stateCapitalGainsTaxName
      : "",
    localTaxName: availableTaxNames.has(next.localTaxName) ? next.localTaxName : "",
    niitTaxName: availableTaxNames.has(next.niitTaxName) ? next.niitTaxName : "",
  };
}

function createDefaultPlannerState(): PlannerState {
  const taxProfile = createDefaultHouseholdTaxProfile();

  return {
    variables: [],
    assets: [],
    taxes: [],
    taxProfile: {
      ...taxProfile,
      federalOrdinaryTaxName: "",
      federalQualifiedTaxName: "",
      stateTaxName: "",
      stateCapitalGainsTaxName: "",
      localTaxName: "",
      niitTaxName: "",
    },
    assetCorrelations: [],
    flows: [],
    events: [],
    startYear: String(new Date().getFullYear()),
    yearsToShow: 3,
  };
}

function createFlowEventDraft(): FlowEventDraft {
  return {
    originalName: null,
    year: plannerState.startYear,
    formula: "",
  };
}

function createActionDraft(flowName = plannerState.flows[0]?.name ?? ""): EventActionDraft {
  const selectedFlow = plannerState.flows.find((flow) => flow.name === flowName) ?? plannerState.flows[0];

  return {
    id: createId(),
    kind: "set-flow-formula",
    variableName: plannerState.variables[0]?.name ?? "",
    m: "1",
    b: "0",
    flowName: selectedFlow?.name ?? "",
    formula: selectedFlow?.formula ?? "",
    variableDefinitionName: "",
    variableDefinitionValue: "0",
    flowDefinitionName: "",
    flowDefinitionType: "income",
    flowDefinitionFormula: "",
    oneTimeExpenseName: "",
    oneTimeExpenseFormula: "",
  };
}

function createId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function renderFormulaEditor({
  value,
  placeholder,
  variablesScope,
  inputName,
  inputId,
  fieldToken,
  type = "number",
  requiredLabel = "Formula",
}: {
  value: string;
  placeholder: string;
  variablesScope: "planner" | "event-draft";
  inputName?: string;
  inputId?: string;
  fieldToken?: string;
  type?: FormulaEditorType;
  requiredLabel?: string;
}): string {
  const formula = formatFormulaText(value);

  return `
    <div
      class="formula-editor"
      data-formula-editor
      data-variables-scope="${variablesScope}"
      data-formula-type="${type}"
      data-plain-numeric="${isPlainNumericFormula(formula) ? "true" : "false"}"
      data-required-label="${escapeAttribute(requiredLabel)}"
      ${fieldToken ? `data-field-token="${escapeAttribute(fieldToken)}"` : ""}
    >
      <div
        class="formula-editor-input"
        contenteditable="true"
        spellcheck="false"
        role="textbox"
        aria-label="${escapeAttribute(placeholder)}"
        data-placeholder="${escapeAttribute(placeholder)}"
      >${escapeHtml(formula)}</div>
      <input
        class="formula-editor-hidden-input"
        ${inputId ? `id="${escapeAttribute(inputId)}"` : ""}
        ${inputName ? `name="${escapeAttribute(inputName)}"` : ""}
        type="hidden"
        value="${escapeAttribute(formula)}"
      />
      <div class="formula-editor-menu" hidden></div>
      <p class="formula-editor-status" aria-live="polite" hidden></p>
    </div>
  `;
}

function yearLabel(year: EventYear): string {
  return String(year.year);
}

function formatPercentage(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value) + "%";
}

function formatEditableNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

function renderEditableNumberInputAttributes(options: { allowEmpty?: boolean } = {}): string {
  return `type="text" inputmode="decimal" data-editable-number="true"${
    options.allowEmpty ? ' data-editable-number-allow-empty="true"' : ""
  }`;
}

function canEditableNumberInputBeEmpty(input: HTMLInputElement): boolean {
  return input.dataset.editableNumberAllowEmpty === "true";
}

function syncEditableNumberInputValidity(input: HTMLInputElement): void {
  if (isEditableNumberValid(input.value, canEditableNumberInputBeEmpty(input))) {
    input.dataset.lastValidValue = input.value;
  }
}

function bindEditableNumberInputs(): void {
  for (const input of document.querySelectorAll<HTMLInputElement>("input[data-editable-number]")) {
    syncEditableNumberInputValidity(input);

    input.addEventListener("input", () => {
      const selectionStart = input.selectionStart ?? input.value.length;
      const { value, caret } = normalizeEditableNumberInput(input.value, selectionStart);

      if (input.value !== value) {
        input.value = value;
      }

      input.setSelectionRange(caret, caret);
      syncEditableNumberInputValidity(input);
    });

    input.addEventListener("blur", () => {
      if (!isEditableNumberValid(input.value, canEditableNumberInputBeEmpty(input))) {
        input.value = input.dataset.lastValidValue ?? "";
        return;
      }

      input.value = formatEditableNumberInput(input.value);
      syncEditableNumberInputValidity(input);
    });
  }
}

function getExpenseInflationSummary(flow: Pick<FlowDefinition, "type" | "inflationAdjusted">): string {
  return isFlowInflationAdjusted(flow)
    ? `Inflates at ${formatPercentage(DEFAULT_EXPENSE_INFLATION_RATE * 100)} annually`
    : "Inflation opt-out";
}

function formatCompactCurrency(value: number): string {
  const absoluteValue = Math.abs(value);
  if (absoluteValue >= 1_000_000_000) {
    return `${value < 0 ? "-" : ""}$${Math.round(absoluteValue / 1_000_000_000)}bn`;
  }

  if (absoluteValue >= 1_000_000) {
    return `${value < 0 ? "-" : ""}$${Math.round(absoluteValue / 1_000_000)}mm`;
  }

  if (absoluteValue >= 1_000) {
    return `${value < 0 ? "-" : ""}$${Math.round(absoluteValue / 1_000)}k`;
  }

  return `${value < 0 ? "-" : ""}$${Math.round(absoluteValue)}`;
}

function formatSignedCurrency(value: number): string {
  return `${value >= 0 ? "+" : "-"}${formatCurrency(Math.abs(value))}`;
}

function formatCurrencyWithDelta(value: number, delta: number): string {
  return `${formatCurrency(value)} (${formatSignedCurrency(delta)})`;
}

function renderSimulationDetailRows(entries: readonly [string, number][]): string {
  return entries
    .map(
      ([label, amount]) => `
        <tr>
          <th>${escapeHtml(label)}</th>
          <td>${formatSignedCurrency(amount)}</td>
        </tr>
      `
    )
    .join("");
}

function renderAssetCashTaxTreatmentOptions(selected: AssetCashTaxTreatment): string {
  return `
    <option value="ordinary-income" ${selected === "ordinary-income" ? "selected" : ""}>Ordinary income</option>
    <option value="qualified-dividends" ${selected === "qualified-dividends" ? "selected" : ""}>Qualified dividends</option>
    <option value="tax-exempt-income" ${selected === "tax-exempt-income" ? "selected" : ""}>Tax-exempt income</option>
    <option value="state-local-exempt" ${selected === "state-local-exempt" ? "selected" : ""}>State+local exempt</option>
    <option value="triple-exempt" ${selected === "triple-exempt" ? "selected" : ""}>Triple exempt</option>
    <option value="not-taxable" ${selected === "not-taxable" ? "selected" : ""}>Not taxable</option>
  `;
}

function renderAssetTypeOptions(selected: AssetDraftKind): string {
  return `
    <option value="us-stocks" ${selected === "us-stocks" ? "selected" : ""}>US stocks</option>
    <option value="federal-bonds" ${selected === "federal-bonds" ? "selected" : ""}>Federal bonds</option>
    <option value="local-bonds" ${selected === "local-bonds" ? "selected" : ""}>Local bonds</option>
    <option value="home" ${selected === "home" ? "selected" : ""}>House</option>
    <option value="investment" ${selected === "investment" ? "selected" : ""}>Other investment</option>
  `;
}

function assetCashTaxTreatmentLabel(taxTreatment: AssetCashTaxTreatment): string {
  switch (taxTreatment) {
    case "qualified-dividends":
      return "qualified";
    case "tax-exempt-income":
      return "federal exempt";
    case "state-local-exempt":
      return "state+local exempt";
    case "triple-exempt":
      return "triple exempt";
    case "not-taxable":
      return "not taxable";
    case "ordinary-income":
    default:
      return "ordinary";
  }
}

function getAssetCashGenerationDisplayName(cashGeneration: Pick<AssetCashGenerationDraft, "name">): string {
  const streamName = cashGeneration.name.trim();
  return streamName || "Unnamed cash stream";
}

function formatAssetCashGenerationDraftValue(
  value: string,
  formatter: (numericValue: number) => string
): string {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return "-";
  }

  const numericValue = Number(trimmedValue);
  return Number.isFinite(numericValue) ? formatter(numericValue) : trimmedValue;
}

function renderAssetCashGenerationDraftPreview(cashGeneration: AssetCashGenerationDraft): string {
  return [
    `Yield ${formatAssetCashGenerationDraftValue(cashGeneration.rate, formatPercentage)}`,
    `Vol ${formatAssetCashGenerationDraftValue(cashGeneration.volatility, formatPercentage)}`,
    `Infl dY ${formatAssetCashGenerationDraftValue(cashGeneration.inflationCorrelation, (value) => `${formatEditableNumber(value)}x`)}`,
    assetCashTaxTreatmentLabel(cashGeneration.taxTreatment),
  ].join(" | ");
}

function renderAssetCashGenerationSummary(asset: AssetDefinition): string {
  const cashGenerations = getAssetCashGenerations(asset);

  if (cashGenerations.length === 0) {
    if (isHomeAsset(asset)) {
      return `Home purchase ${asset.purchaseYear}`;
    }
    return "";
  }

  return cashGenerations
    .map((cashGeneration) => {
      const rate = formatPercentage(cashGeneration.rate);
      const inflationCorrelation =
        cashGeneration.inflationCorrelation ??
        getDefaultAssetCashGenerationInflationCorrelation(
          isInvestmentAsset(asset) ? asset.assetType ?? null : null
        );
      const taxTreatment = assetCashTaxTreatmentLabel(cashGeneration.taxTreatment ?? "ordinary-income");
      const streamName = cashGeneration.name?.trim();
      const inflationCorrelationSummary =
        Math.abs(inflationCorrelation) > 0.000001 ? ` + ${inflationCorrelation.toFixed(2)}x YoY inflation delta` : "";
      return streamName
        ? `${streamName}: ${rate}${inflationCorrelationSummary} ${taxTreatment}`
        : `${rate}${inflationCorrelationSummary} ${taxTreatment}`;
    })
    .join(" | ");
}

function isAssetReturnDefault(asset: AssetDefinition): boolean {
  const defaults = getDefaultAssetReturnSettings(asset);
  return numbersMatch(asset.expectedReturn, defaults.expectedReturn) && numbersMatch(asset.volatility, defaults.volatility);
}

function getDefaultAssetReturnSettings(asset: AssetDefinition): { expectedReturn: number; volatility: number } {
  if (isHomeAsset(asset)) {
    return {
      expectedReturn: Number(HOME_EXPECTED_RETURN_DEFAULT),
      volatility: Number(HOME_VOLATILITY_DEFAULT),
    };
  }

  const preset = asset.assetType ? ASSET_TYPE_PRESETS[asset.assetType] : null;
  return {
    expectedReturn: preset ? Number(preset.expectedReturn) : 0,
    volatility: preset ? Number(preset.volatility) : 0,
  };
}

function isAssetCashGenerationDefault(asset: AssetDefinition): boolean {
  const cashGenerations = getAssetCashGenerations(asset);
  if (!isInvestmentAsset(asset)) {
    return cashGenerations.length === 0;
  }

  const presetCashGenerations = asset.assetType ? ASSET_TYPE_PRESETS[asset.assetType].cashGenerations : [];
  if (cashGenerations.length !== presetCashGenerations.length) {
    return false;
  }

  return cashGenerations.every((cashGeneration, index) => {
    const presetCashGeneration = presetCashGenerations[index];
    if (!presetCashGeneration) {
      return false;
    }

    const defaultInflationCorrelation = getDefaultAssetCashGenerationInflationCorrelation(asset.assetType ?? null);
    const cashGenerationInflationCorrelation = cashGeneration.inflationCorrelation ?? defaultInflationCorrelation;
    return (
      (cashGeneration.name ?? "") === presetCashGeneration.name &&
      numbersMatch(cashGeneration.rate, Number(presetCashGeneration.rate)) &&
      numbersMatch(cashGeneration.volatility, Number(presetCashGeneration.volatility)) &&
      numbersMatch(cashGenerationInflationCorrelation, Number(presetCashGeneration.inflationCorrelation)) &&
      (cashGeneration.taxTreatment ?? "ordinary-income") === presetCashGeneration.taxTreatment
    );
  });
}

function renderVisibleAssetCashGenerationSummary(asset: AssetDefinition): string {
  if (!isHomeAsset(asset) && isAssetCashGenerationDefault(asset)) {
    return "";
  }

  return renderAssetCashGenerationSummary(asset);
}

function renderAssetStats(asset: AssetDefinition): string {
  const stats: string[] = [];
  if (!isAssetReturnDefault(asset)) {
    stats.push(`<span><strong>Expected return</strong>${formatPercentage(asset.expectedReturn)}</span>`);
    stats.push(`<span><strong>Volatility</strong>${formatPercentage(asset.volatility)}</span>`);
  }

  return stats.join("");
}

function numbersMatch(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.000001;
}

function getInterestOnlyMaturityActionLabel(action: HomeAssetDefinition["interestOnlyMaturityAction"]): string {
  switch (action) {
    case "refinance":
      return "auto refinance";
    case "sell":
      return "auto sale";
    case "payoff":
    default:
      return "force payoff";
  }
}

function renderHomeMortgageSummary(asset: AssetDefinition): string {
  if (!isHomeAsset(asset)) {
    return "";
  }

  const financedPercent = Math.max(0, (1 - asset.cashPurchasePercent) * 100);
  const mortgagePrincipal = asset.initialCost * Math.max(0, 1 - asset.cashPurchasePercent);

  if (mortgagePrincipal <= 0.000001) {
    return `Mortgage: none, ${formatPercentage(asset.cashPurchasePercent * 100)} cash purchase`;
  }

  const mortgageType =
    asset.mortgageType === "interest-only"
      ? `interest-only, ${getInterestOnlyMaturityActionLabel(asset.interestOnlyMaturityAction)}`
      : "amortizing";

  return `Mortgage: ${formatPercentage(financedPercent)} financed, ${formatPercentage(asset.mortgageRate)} ${mortgageType} for ${asset.mortgageTermYears} years`;
}

function parseYearInput(value: string): EventYear {
  const trimmedValue = value.trim();
  if (!/^\d{4}$/.test(trimmedValue)) {
    throw new Error(`Invalid year value "${value}".`);
  }

  return {
    year: Number(trimmedValue),
  };
}

function normalizeYearInput(value: string | undefined): string {
  if (value && /^\d{4}$/.test(value.trim())) {
    return value.trim();
  }

  return String(new Date().getFullYear());
}

function normalizeOptionalYearInput(value: string | undefined): string {
  if (value && /^\d{4}$/.test(value.trim())) {
    return value.trim();
  }

  return "";
}

function deriveYearString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmedValue = value.trim();
    if (/^\d{4}$/.test(trimmedValue)) {
      return trimmedValue;
    }

    const legacyMatch = /^(\d{4})-\d{2}$/.exec(trimmedValue);
    if (legacyMatch) {
      return legacyMatch[1];
    }
  }

  return undefined;
}

function deriveEventYear(value: unknown): number {
  if (value && typeof value === "object") {
    const candidate = value as {
      year?: { year?: number } | number;
      month?: { year?: number };
    };

    if (typeof candidate.year === "object" && typeof candidate.year?.year === "number") {
      return candidate.year.year;
    }

    if (typeof candidate.year === "number") {
      return candidate.year;
    }

    if (typeof candidate.month?.year === "number") {
      return candidate.month.year;
    }
  }

  throw new Error("Saved event entry is missing a valid year.");
}

function addYears(year: EventYear, increment: number): EventYear {
  const date = new Date(Date.UTC(year.year + increment, 0, 1));
  return {
    year: date.getUTCFullYear(),
  };
}

function cloneVariables(definitions: readonly VariableDefinition[]): Variable[] {
  return definitions.map((variable) => new Variable(variable));
}

function cloneFlows(definitions: readonly FlowDefinition[]): Flow[] {
  return definitions.map((flow) => new Flow(flow));
}

function createEmptyHouseholdTaxInput(): HouseholdTaxInput {
  return {
    wages: 0,
    ordinaryIncome: 0,
    qualifiedDividends: 0,
    shortTermCapitalGains: 0,
    longTermCapitalGains: 0,
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

function addAmountToHouseholdTaxInput(
  taxInput: HouseholdTaxInput,
  taxTreatment: FlowTaxTreatment,
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
      break;
  }
}

function buildSnapshotsFromPlannerData({
  startYearInput,
  yearsToShow,
  inflationRate = DEFAULT_EXPENSE_INFLATION_RATE,
  variables: variableDefinitions,
  flows: flowDefinitions,
  events,
}: {
  startYearInput: string;
  yearsToShow: number;
  inflationRate?: number;
  variables: readonly VariableDefinition[];
  flows: readonly FlowDefinition[];
  events: readonly Event[];
}): YearlySnapshot[] {
  const startYear = parseYearInput(normalizeYearInput(startYearInput));
  const snapshots: YearlySnapshot[] = [];

  for (let offset = 0; offset < yearsToShow; offset += 1) {
    const variables = cloneVariables(variableDefinitions);
    const flows = cloneFlows(flowDefinitions);

    for (let step = 0; step <= offset; step += 1) {
      applyEventsForYear(events, addYears(startYear, step), { variables, flows });
    }

    const currentYear = addYears(startYear, offset);
    const context = createFormulaContext(variables);
    const flowAmounts = new Map(
      flows.map((flow) => [
        flow.name,
        applyFlowExpenseInflation(flow, flow.evaluateSignedYearlyAmount(context, currentYear), offset, inflationRate),
      ])
    );
    const householdTaxInput = createEmptyHouseholdTaxInput();
    for (const flow of flows) {
      addAmountToHouseholdTaxInput(
        householdTaxInput,
        flow.taxTreatment,
        Math.abs(flowAmounts.get(flow.name) ?? 0)
      );
    }
    const totalExpenses = [...flowAmounts.values()]
      .filter((amount) => amount < 0)
      .reduce((total, amount) => total + Math.abs(amount), 0);

    snapshots.push({
      year: currentYear,
      label: yearLabel(currentYear),
      flowAmounts,
      netAmount: [...flowAmounts.values()].reduce((total, amount) => total + amount, 0),
      totalExpenses,
      householdTaxInput,
    });
  }

  return snapshots;
}

function buildYearlyPlansFromPlannerData({
  startYearInput,
  yearsToShow,
  variables: variableDefinitions,
  flows: flowDefinitions,
  events,
}: {
  startYearInput: string;
  yearsToShow: number;
  variables: readonly VariableDefinition[];
  flows: readonly FlowDefinition[];
  events: readonly Event[];
}): SimulationYearlyPlan[] {
  const startYear = parseYearInput(normalizeYearInput(startYearInput));
  const yearlyPlans: SimulationYearlyPlan[] = [];

  for (let offset = 0; offset < yearsToShow; offset += 1) {
    const variables = cloneVariables(variableDefinitions);
    const flows = cloneFlows(flowDefinitions);

    for (let step = 0; step <= offset; step += 1) {
      applyEventsForYear(events, addYears(startYear, step), { variables, flows });
    }

    const currentYear = addYears(startYear, offset);
    const context = createFormulaContext(variables);
    yearlyPlans.push({
      year: currentYear.year,
      label: yearLabel(currentYear),
      flows: flows.map((flow) => ({
        name: flow.name,
        type: flow.type,
        taxTreatment: flow.taxTreatment,
        inflationAdjusted: isFlowInflationAdjusted(flow),
        baseSignedAmount: flow.evaluateSignedYearlyAmount(context, currentYear),
      })),
    });
  }

  return yearlyPlans;
}

function buildSimulationInflationConfig(): SimulationInflationConfig {
  if (simulationDraft.inflationPreset === "regime") {
    return {
      mode: "regime-switching",
      lowRegime: {
        averageRate: parseEditableNumber(DEFAULT_SIMULATION_REGIME_INFLATION.lowAverageRate) / 100,
        volatility: parseEditableNumber(DEFAULT_SIMULATION_REGIME_INFLATION.lowVolatility) / 100,
      },
      highRegime: {
        averageRate: parseEditableNumber(DEFAULT_SIMULATION_REGIME_INFLATION.highAverageRate) / 100,
        volatility: parseEditableNumber(DEFAULT_SIMULATION_REGIME_INFLATION.highVolatility) / 100,
      },
      stayLowProbability: parseEditableNumber(DEFAULT_SIMULATION_REGIME_INFLATION.stayLowProbability) / 100,
      stayHighProbability: parseEditableNumber(DEFAULT_SIMULATION_REGIME_INFLATION.stayHighProbability) / 100,
    };
  }

  if (simulationDraft.inflationPreset === "regime-custom") {
    return {
      mode: "regime-switching",
      lowRegime: {
        averageRate: parseEditableNumber(simulationDraft.regimeSwitchingInflation.lowAverageRate) / 100,
        volatility: parseEditableNumber(simulationDraft.regimeSwitchingInflation.lowVolatility) / 100,
      },
      highRegime: {
        averageRate: parseEditableNumber(simulationDraft.regimeSwitchingInflation.highAverageRate) / 100,
        volatility: parseEditableNumber(simulationDraft.regimeSwitchingInflation.highVolatility) / 100,
      },
      stayLowProbability: parseEditableNumber(simulationDraft.regimeSwitchingInflation.stayLowProbability) / 100,
      stayHighProbability: parseEditableNumber(simulationDraft.regimeSwitchingInflation.stayHighProbability) / 100,
    };
  }

  return {
    mode: "fixed",
    fixedRate:
      parseEditableNumber(
        simulationDraft.inflationPreset === "fixed-custom"
          ? simulationDraft.fixedInflationRate
          : DEFAULT_SIMULATION_FIXED_INFLATION_RATE
      ) / 100,
  };
}

function buildSnapshots(startYearInput: string, yearsToShow: number): YearlySnapshot[] {
  return buildSnapshotsFromPlannerData({
    startYearInput,
    yearsToShow,
    inflationRate: DEFAULT_EXPENSE_INFLATION_RATE,
    variables: plannerState.variables,
    flows: plannerState.flows,
    events: plannerState.events,
  });
}

function buildFlowRows(startYearInput: string): Array<{ flow: FlowDefinition; yearlyAmount: number }> {
  const firstSnapshot = buildSnapshots(startYearInput, 1)[0];
  if (!firstSnapshot) {
    return [];
  }

  return plannerState.flows
    .map((flow) => ({
      flow,
      yearlyAmount: firstSnapshot.flowAmounts.get(flow.name) ?? 0,
    }))
    .sort((left, right) => {
      if (left.flow.type !== right.flow.type) {
        return left.flow.type === "income" ? -1 : 1;
      }

      return Math.abs(right.yearlyAmount) - Math.abs(left.yearlyAmount);
    });
}

function syncSimulationDraftAssetRows({ invalidateOnChange = true }: { invalidateOnChange?: boolean } = {}): void {
  const draftRows = new Map(simulationDraft.assetRows.map((row) => [row.name, row]));
  const previousNames = simulationDraft.assetRows.map((row) => row.name).join("|");
  simulationDraft.assetRows = plannerState.assets.map((asset) => {
    const existing = draftRows.get(asset.name);
    const baseDraft = buildAssetDraftFromDefinition(asset);
    return {
      ...baseDraft,
      sellProportion: existing?.sellProportion ?? String(isInvestmentAsset(asset) ? asset.sellProportion : 0),
    };
  });
  if (invalidateOnChange && simulationDraft.assetRows.map((row) => row.name).join("|") !== previousNames) {
    invalidateSimulationState();
  }
}

function syncSimulationVariableSweepDraft(): void {
  const variables = plannerState.variables;
  const selectedVariable =
    variables.find((variable) => variable.name === simulationDraft.variableSweep.variableName) ?? variables[0] ?? null;

  if (!selectedVariable) {
    simulationDraft.variableSweep.enabled = false;
    simulationDraft.variableSweep.variableName = "";
    simulationDraft.variableSweep.minValue = "0";
    simulationDraft.variableSweep.maxValue = "0";
    return;
  }

  simulationDraft.variableSweep.variableName = selectedVariable.name;

  if (!Number.isFinite(parseEditableNumber(simulationDraft.variableSweep.minValue))) {
    simulationDraft.variableSweep.minValue = formatEditableNumberInput(String(selectedVariable.value));
  }

  if (!Number.isFinite(parseEditableNumber(simulationDraft.variableSweep.maxValue))) {
    simulationDraft.variableSweep.maxValue = formatEditableNumberInput(String(selectedVariable.value));
  }
}

function buildSimulationInputSignaturePayload(): Record<string, unknown> {
  return {
    variables: plannerState.variables,
    assets: plannerState.assets,
    taxes: plannerState.taxes,
    taxProfile: plannerState.taxProfile,
    assetCorrelations: plannerState.assetCorrelations,
    flows: plannerState.flows,
    events: serializeEvents(plannerState.events),
    startYear: plannerState.startYear,
    simulation: {
      startYear: simulationDraft.startYear,
      attempts: simulationDraft.attempts,
      horizonYears: simulationDraft.horizonYears,
      inflationPreset: simulationDraft.inflationPreset,
      fixedInflationRate: simulationDraft.fixedInflationRate,
      regimeSwitchingInflation: simulationDraft.regimeSwitchingInflation,
      taxPreset: simulationDraft.taxPreset,
      customAssetLiquidation: simulationDraft.customAssetLiquidation,
      variableSweep: simulationDraft.variableSweep,
      assetRows: simulationDraft.assetRows.map((asset) => ({
        name: asset.name,
        sellProportion: asset.sellProportion,
      })),
    },
  };
}

function buildSimulationInputSignature(): string {
  return JSON.stringify(buildSimulationInputSignaturePayload());
}

function getSimulationInputSignatureDiff(previousSignature: string | null, nextSignature: string): string[] {
  if (previousSignature === null) {
    return ["no completed simulation signature"];
  }

  let previousPayload: Record<string, unknown>;
  let nextPayload: Record<string, unknown>;
  try {
    previousPayload = JSON.parse(previousSignature) as Record<string, unknown>;
    nextPayload = JSON.parse(nextSignature) as Record<string, unknown>;
  } catch {
    return ["signature parse failed"];
  }

  const changedSections: string[] = [];
  for (const key of new Set([...Object.keys(previousPayload), ...Object.keys(nextPayload)])) {
    if (JSON.stringify(previousPayload[key]) !== JSON.stringify(nextPayload[key])) {
      changedSections.push(key);
    }
  }

  const previousSimulation = previousPayload.simulation as Record<string, unknown> | undefined;
  const nextSimulation = nextPayload.simulation as Record<string, unknown> | undefined;
  if (previousSimulation && nextSimulation) {
    for (const key of new Set([...Object.keys(previousSimulation), ...Object.keys(nextSimulation)])) {
      if (JSON.stringify(previousSimulation[key]) !== JSON.stringify(nextSimulation[key])) {
        changedSections.push(`simulation.${key}`);
      }
    }
  }

  return changedSections;
}

function debugSimulationStaleState(
  eventName: string,
  details: {
    currentSignature?: string;
    completedSignature?: string | null;
    stale?: boolean;
    includeStack?: boolean;
  } = {}
): void {
  const currentSignature = details.currentSignature ?? buildSimulationInputSignature();
  const completedSignature =
    details.completedSignature === undefined ? completedSimulationInputSignature : details.completedSignature;
  const changedSections = getSimulationInputSignatureDiff(completedSignature, currentSignature);

  console.groupCollapsed(`[simulation debug] ${eventName}`);
  console.log({
    stale: details.stale ?? simulationResultsStale,
    hasResults: hasDisplayedSimulationResults(),
    hasCompletedSignature: completedSignature !== null,
    changedSections,
    currentSignatureLength: currentSignature.length,
    completedSignatureLength: completedSignature?.length ?? 0,
  });
  if (changedSections.length > 0) {
    console.log("current payload", buildSimulationInputSignaturePayload());
    if (completedSignature) {
      console.log("completed payload", JSON.parse(completedSignature) as unknown);
    }
  }
  if (details.includeStack) {
    console.trace("[simulation debug] invalidation stack");
  }
  console.groupEnd();
}

function clearSimulationOutputs(): void {
  simulationResults = null;
  simulationDetailResults = null;
  simulationSweepResults = null;
  simulationResultsStale = false;
  completedSimulationInputSignature = null;
  selectedSimulationSweepStepIndex = 0;
  selectedSimulationPercentile = 50;
  selectedSimulationChartMetric = "liquidAssets";
  expandedSimulationExampleKeys = new Set();
}

function hasDisplayedSimulationResults(): boolean {
  return getDisplayedSimulationResults() !== null;
}

function normalizeSimulationDraftHorizon(): void {
  simulationDraft.horizonYears = normalizeSimulationHorizonYears(simulationDraft.horizonYears);
}

function resetPlannerWorkspaceState(): void {
  if (taxProfilePersistTimeout !== null) {
    window.clearTimeout(taxProfilePersistTimeout);
    taxProfilePersistTimeout = null;
  }

  Object.assign(plannerState, createDefaultPlannerState());
  Object.assign(simulationDraft, createSimulationDraft());
  invalidateSimulationState();
  closeTransientPlannerUi();
  simulationInflationSectionExpanded = false;
  simulationTaxesSectionExpanded = false;
  simulationSettingsSectionExpanded = false;
  activeSummaryTab = "variables";
  syncTaxProfileDraft();
  syncSimulationDraftAssetRows();
  syncSimulationVariableSweepDraft();
}

function buildSimulationVariableDefinitions(
  variableOverride?: SimulationVariableOverride
): VariableDefinition[] {
  if (!variableOverride) {
    return [...plannerState.variables];
  }

  let matchedVariable = false;
  const variables = plannerState.variables.map((variable) => {
    if (variable.name !== variableOverride.variableName) {
      return variable;
    }

    matchedVariable = true;
    return {
      ...variable,
      value: variableOverride.value,
    };
  });

  if (!matchedVariable) {
    throw new Error(`Unknown variable "${variableOverride.variableName}".`);
  }

  return variables;
}

function buildSimulationWorkerInput(variableOverride?: SimulationVariableOverride): SimulationWorkerRunInput {
  const selectedTaxPreset = getSimulationTaxPresetDefinition(
    simulationDraft.taxPreset,
    plannerState.taxProfile.filingStatus
  );
  const formulaContext = buildPlannerFormulaContext(variableOverride);
  const yearlyPlans = buildYearlyPlansFromPlannerData({
    startYearInput: simulationDraft.startYear,
    yearsToShow: simulationDraft.horizonYears,
    variables: buildSimulationVariableDefinitions(variableOverride),
    flows: plannerState.flows,
    events: plannerState.events,
  });

  return {
    attempts: simulationDraft.attempts,
    horizonYears: simulationDraft.horizonYears,
    yearlyPlans,
    assets: plannerState.assets.map((asset) => {
      const resolvedAsset = resolveAssetValueFormula(asset, formulaContext);
      return resolvedAsset.kind === "home"
        ? {
            kind: "home" as const,
            name: resolvedAsset.name,
            initialCost: resolvedAsset.initialCost,
            expectedReturn: resolvedAsset.expectedReturn,
            volatility: resolvedAsset.volatility,
            cashPurchasePercent: resolvedAsset.cashPurchasePercent,
            closingCostPercent: resolvedAsset.closingCostPercent,
            mortgageType: resolvedAsset.mortgageType,
            ...(resolvedAsset.mortgageType === "interest-only"
              ? {
                  interestOnlyMaturityAction: resolvedAsset.interestOnlyMaturityAction,
                }
              : {}),
            mortgageRate: resolvedAsset.mortgageRate,
            mortgageTermYears: resolvedAsset.mortgageTermYears,
            monthlyNonTaxCosts: resolvedAsset.monthlyNonTaxCosts,
            propertyTaxRate: resolvedAsset.propertyTaxRate,
            purchaseYear: resolvedAsset.purchaseYear,
          }
        : {
            name: resolvedAsset.name,
            ...(resolvedAsset.assetType ? { assetType: resolvedAsset.assetType } : {}),
            startingValue: resolvedAsset.startingValue,
            expectedReturn: resolvedAsset.expectedReturn,
            volatility: resolvedAsset.volatility,
            sellProportion: getSimulationSellProportion(resolvedAsset, simulationDraft.customAssetLiquidation),
            ...((resolvedAsset.cashGenerations ?? []).length > 0
              ? {
                  cashGenerations: (resolvedAsset.cashGenerations ?? []).map((cashGeneration) => ({
                    name: cashGeneration.name?.trim(),
                    rate: Number(cashGeneration.rate),
                    volatility: Number(cashGeneration.volatility),
                    inflationCorrelation: Number(cashGeneration.inflationCorrelation ?? 0),
                    taxTreatment: cashGeneration.taxTreatment,
                  })),
                }
              : {}),
            ...(resolvedAsset.saleTax
              ? {
                  saleTax: {
                    ...(resolvedAsset.saleTax.costBasis !== undefined
                      ? { costBasis: resolvedAsset.saleTax.costBasis }
                      : {}),
                    taxTreatment: resolvedAsset.saleTax.taxTreatment,
                  },
                }
              : {}),
          };
    }),
    taxes: selectedTaxPreset.taxes,
    householdTaxProfile: selectedTaxPreset.householdTaxProfile,
    assetCorrelations: plannerState.assetCorrelations,
    inflation: buildSimulationInflationConfig(),
  };
}

function getSimulationSweepVariableValues(): number[] {
  if (!simulationDraft.variableSweep.enabled) {
    return [];
  }

  return buildVariableSweepValues(
    parseEditableNumber(simulationDraft.variableSweep.minValue),
    parseEditableNumber(simulationDraft.variableSweep.maxValue)
  );
}

function findNearestSweepStepIndex(values: readonly number[], targetValue: number): number {
  if (values.length === 0) {
    return 0;
  }

  let closestIndex = 0;
  let closestDistance = Math.abs(values[0] - targetValue);
  for (let index = 1; index < values.length; index += 1) {
    const distance = Math.abs(values[index] - targetValue);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  }

  return closestIndex;
}

function persistVariableSweepDraftToLocalStorage(userId: string): void {
  try {
    window.localStorage.setItem(
      getVariableSweepStorageKey(userId),
      JSON.stringify({
        enabled: simulationDraft.variableSweep.enabled,
        variableName: simulationDraft.variableSweep.variableName,
        minValue: simulationDraft.variableSweep.minValue,
        maxValue: simulationDraft.variableSweep.maxValue,
      })
    );
  } catch {
    // Ignore storage write failures and fall back to IndexedDB persistence.
  }
}

function removeVariableSweepDraftFromLocalStorage(userId: string): void {
  try {
    window.localStorage.removeItem(getVariableSweepStorageKey(userId));
  } catch {
    // Ignore storage write failures and fall back to IndexedDB persistence.
  }
}

function applyVariableSweepDraftFromLocalStorage(userId: string): void {
  try {
    const rawValue = window.localStorage.getItem(getVariableSweepStorageKey(userId));
    if (!rawValue) {
      return;
    }

    const parsedValue = JSON.parse(rawValue) as Partial<VariableSweepDraft>;
    if (typeof parsedValue.enabled === "boolean") {
      simulationDraft.variableSweep.enabled = parsedValue.enabled;
    }
    if (typeof parsedValue.variableName === "string") {
      simulationDraft.variableSweep.variableName = parsedValue.variableName;
    }
    if (typeof parsedValue.minValue === "string") {
      simulationDraft.variableSweep.minValue = parsedValue.minValue;
    }
    if (typeof parsedValue.maxValue === "string") {
      simulationDraft.variableSweep.maxValue = parsedValue.maxValue;
    }
  } catch {
    // Ignore storage read failures and continue with IndexedDB-backed state.
  }
}

function persistSimulationTaxPresetToLocalStorage(userId: string): void {
  try {
    window.localStorage.setItem(getSimulationTaxPresetStorageKey(userId), simulationDraft.taxPreset);
  } catch {
    // Ignore storage write failures and fall back to IndexedDB persistence.
  }
}

function removeSimulationTaxPresetFromLocalStorage(userId: string): void {
  try {
    window.localStorage.removeItem(getSimulationTaxPresetStorageKey(userId));
  } catch {
    // Ignore storage write failures and fall back to IndexedDB persistence.
  }
}

function applySimulationTaxPresetFromLocalStorage(userId: string): void {
  try {
    const rawValue = window.localStorage.getItem(getSimulationTaxPresetStorageKey(userId));
    if (!rawValue) {
      return;
    }

    simulationDraft.taxPreset = normalizeSimulationTaxPreset(rawValue, simulationDraft.taxPreset);
    simulationTaxesSectionExpanded = simulationDraft.taxPreset === "custom";
  } catch {
    // Ignore storage read failures and continue with IndexedDB-backed state.
  }
}

function isSimulationInflationPreset(value: unknown): value is SimulationInflationPreset {
  return value === "fixed" || value === "fixed-custom" || value === "regime" || value === "regime-custom";
}

function buildPersistedSimulationSettingsDraft(): PersistedSimulationSettingsDraft {
  return {
    startYear: simulationDraft.startYear,
    attempts: simulationDraft.attempts,
    currentAge: simulationDraft.currentAge,
    horizonYears: simulationDraft.horizonYears,
    inflationPreset: simulationDraft.inflationPreset,
    fixedInflationRate: simulationDraft.fixedInflationRate,
    regimeSwitchingInflation: { ...simulationDraft.regimeSwitchingInflation },
    taxPreset: simulationDraft.taxPreset,
    customAssetLiquidation: simulationDraft.customAssetLiquidation,
    variableSweep: { ...simulationDraft.variableSweep },
  };
}

function persistSimulationSettingsDraftToLocalStorage(userId: string): void {
  try {
    window.localStorage.setItem(
      getSimulationSettingsStorageKey(userId),
      JSON.stringify(buildPersistedSimulationSettingsDraft())
    );
  } catch {
    // Ignore storage write failures and fall back to IndexedDB persistence.
  }
}

function removeSimulationSettingsDraftFromLocalStorage(userId: string): void {
  try {
    window.localStorage.removeItem(getSimulationSettingsStorageKey(userId));
  } catch {
    // Ignore storage write failures and fall back to IndexedDB persistence.
  }
}

function applySimulationSettingsDraftFromLocalStorage(userId: string): void {
  try {
    const rawValue = window.localStorage.getItem(getSimulationSettingsStorageKey(userId));
    if (!rawValue) {
      return;
    }

    const parsedValue = JSON.parse(rawValue) as Partial<PersistedSimulationSettingsDraft>;
    if (typeof parsedValue.startYear === "string") {
      const normalizedYear = normalizeYearInput(parsedValue.startYear);
      simulationDraft.startYear = normalizedYear;
      plannerState.startYear = normalizedYear;
    }
    if (typeof parsedValue.attempts === "number" && Number.isFinite(parsedValue.attempts)) {
      simulationDraft.attempts = Math.max(1000, Math.min(50000, parsedValue.attempts));
    }
    if (typeof parsedValue.currentAge === "number" && Number.isFinite(parsedValue.currentAge)) {
      simulationDraft.currentAge = normalizeSimulationCurrentAge(parsedValue.currentAge);
    }
    if (typeof parsedValue.horizonYears === "number" && Number.isFinite(parsedValue.horizonYears)) {
      simulationDraft.horizonYears = normalizeSimulationHorizonYears(parsedValue.horizonYears);
    }
    if (isSimulationInflationPreset(parsedValue.inflationPreset)) {
      simulationDraft.inflationPreset = parsedValue.inflationPreset;
      simulationInflationSectionExpanded = isSimulationInflationCustomPreset(simulationDraft.inflationPreset);
    }
    if (typeof parsedValue.fixedInflationRate === "string") {
      simulationDraft.fixedInflationRate = parsedValue.fixedInflationRate;
    }
    const savedRegimeSwitchingInflation = parsedValue.regimeSwitchingInflation;
    if (savedRegimeSwitchingInflation && typeof savedRegimeSwitchingInflation === "object") {
      for (const key of Object.keys(simulationDraft.regimeSwitchingInflation) as Array<
        keyof SimulationDraft["regimeSwitchingInflation"]
      >) {
        const value = savedRegimeSwitchingInflation[key];
        if (typeof value === "string") {
          simulationDraft.regimeSwitchingInflation[key] = value;
        }
      }
    }
    if (typeof parsedValue.taxPreset === "string") {
      simulationDraft.taxPreset = normalizeSimulationTaxPreset(parsedValue.taxPreset, simulationDraft.taxPreset);
      simulationTaxesSectionExpanded = simulationDraft.taxPreset === "custom";
    }
    if (typeof parsedValue.customAssetLiquidation === "boolean") {
      simulationDraft.customAssetLiquidation = parsedValue.customAssetLiquidation;
    }
    if (parsedValue.variableSweep && typeof parsedValue.variableSweep === "object") {
      if (typeof parsedValue.variableSweep.enabled === "boolean") {
        simulationDraft.variableSweep.enabled = parsedValue.variableSweep.enabled;
      }
      if (typeof parsedValue.variableSweep.variableName === "string") {
        simulationDraft.variableSweep.variableName = parsedValue.variableSweep.variableName;
      }
      if (typeof parsedValue.variableSweep.minValue === "string") {
        simulationDraft.variableSweep.minValue = parsedValue.variableSweep.minValue;
      }
      if (typeof parsedValue.variableSweep.maxValue === "string") {
        simulationDraft.variableSweep.maxValue = parsedValue.variableSweep.maxValue;
      }
    }
  } catch {
    // Ignore storage read failures and continue with IndexedDB-backed state.
  }
}

function cancelActiveSimulationRun(): void {
  for (const worker of activeSimulationWorkers) {
    worker.terminate();
  }
  activeSimulationWorkers = [];
  simulationRunState = null;
}

function invalidateSimulationState(): void {
  cancelActiveSimulationRun();
  if (hasDisplayedSimulationResults()) {
    const currentSignature = buildSimulationInputSignature();
    simulationResultsStale =
      completedSimulationInputSignature === null ||
      currentSignature !== completedSimulationInputSignature;
    debugSimulationStaleState("invalidateSimulationState", {
      currentSignature,
      completedSignature: completedSimulationInputSignature,
      stale: simulationResultsStale,
      includeStack: true,
    });
    if (simulationResultsStale) {
      expandedSimulationExampleKeys = new Set();
    }
    syncSimulationStalePresentation();
    syncSimulationSubmitState();
  } else {
    clearSimulationOutputs();
  }
}

function eventSummary(action: EventAction): string {
  switch (action.kind) {
    case "adjust-variable":
      return `Adjust ${action.variableName} with ${action.adjustment.m}x + ${action.adjustment.b}`;
    case "set-flow-formula":
      return `Set ${action.flowName} amount to ${action.formula}`;
    case "add-variable":
      return `Add variable ${action.variable.name} = ${action.variable.value}`;
    case "add-flow":
      return `Add ${action.flow.type} flow ${action.flow.name} = ${action.flow.formula}`;
  }
}

function compareEventYears(left: EventYear, right: EventYear): number {
  return left.year - right.year;
}

function getFirstEventYear(event: Pick<EventDefinition, "schedule">): EventYear {
  return [...event.schedule]
    .map((entry) => entry.year)
    .sort(compareEventYears)[0];
}

function getSortedEvents(events: readonly Event[]): Event[] {
  return [...events].sort((left, right) => compareEventYears(getFirstEventYear(left), getFirstEventYear(right)));
}

function getEventsForFlow(flowName: string): Event[] {
  return getSortedEvents(plannerState.events.filter((event) => event.flowName === flowName));
}

function isSingleFormulaOverrideEvent(event: Event, flowName: string): boolean {
  return (
    event.flowName === flowName &&
    event.schedule.length === 1 &&
    event.schedule[0]?.actions.length === 1 &&
    event.schedule[0]?.actions[0]?.kind === "set-flow-formula" &&
    event.schedule[0].actions[0].flowName === flowName
  );
}

function createOneTimeAmountEventName(flowName: string): string {
  return `${flowName.trim()} one-time amount`;
}

function createOneTimeResetEventName(flowName: string): string {
  return `${flowName.trim()} one-time reset`;
}

function isOneTimeAmountEvent(event: Event, flowName: string): boolean {
  return (
    isSingleFormulaOverrideEvent(event, flowName) &&
    (event.name === createOneTimeAmountEventName(flowName) || event.name.endsWith(" one-time amount"))
  );
}

function isOneTimeResetEvent(event: Event, flowName: string): boolean {
  if (!isSingleFormulaOverrideEvent(event, flowName)) {
    return false;
  }

  const action = event.schedule[0].actions[0];
  return (
    (event.name === createOneTimeResetEventName(flowName) || event.name.endsWith(" one-time reset")) &&
    action.kind === "set-flow-formula" &&
    action.formula.trim() === "0" &&
    event.schedule.length === 1
  );
}

function getExpenseChangeEvents(flowName: string): Event[] {
  return getEventsForFlow(flowName).filter(
    (event) =>
      isSingleFormulaOverrideEvent(event, flowName) &&
      !isOneTimeAmountEvent(event, flowName) &&
      !isOneTimeResetEvent(event, flowName)
  );
}

function createExpenseChangeEventName(flowName: string, year: string): string {
  return `${flowName.trim()} change ${year}`;
}

function getNextExpenseChangeYear(flowName: string): string {
  const existingYears = getExpenseChangeEvents(flowName).map((event) => getFirstEventYear(event).year);
  const baseYear =
    existingYears.length > 0 ? Math.max(...existingYears) : new Date().getFullYear();

  return String(baseYear + 1);
}

function getNextFlowDraftChangeYear(draft: FlowDraft): string {
  const existingYears = draft.changeEvents
    .map((change) => Number(change.year))
    .filter((year) => Number.isInteger(year));
  const baseYear = existingYears.length > 0 ? Math.max(...existingYears) : new Date().getFullYear();

  return String(baseYear + 1);
}

function createOneTimeAmountEvent(flowName: string, year: string, formula: string): Event {
  return new Event({
    name: createOneTimeAmountEventName(flowName),
    flowName,
    schedule: [
      {
        year: parseYearInput(year),
        actions: [
          {
            kind: "set-flow-formula",
            flowName,
            formula: formula.trim(),
          },
        ],
      },
    ],
  });
}

function createOneTimeResetEvent(flowName: string, year: string): Event {
  return new Event({
    name: createOneTimeResetEventName(flowName),
    flowName,
    schedule: [
      {
        year: addYears(parseYearInput(year), 1),
        actions: [
          {
            kind: "set-flow-formula",
            flowName,
            formula: "0",
          },
        ],
      },
    ],
  });
}

function syncExpenseOneTimeSchedule(flowName: string, enabled: boolean, year: string, formula: string): void {
  plannerState.events = plannerState.events.filter(
    (event) =>
      event.flowName !== flowName ||
      !(
        isOneTimeAmountEvent(event, flowName) ||
        isOneTimeResetEvent(event, flowName) ||
        (enabled && isSingleFormulaOverrideEvent(event, flowName))
      )
  );

  if (enabled) {
    plannerState.events.push(createOneTimeAmountEvent(flowName, normalizeYearInput(year), formula));
    plannerState.events.push(createOneTimeResetEvent(flowName, normalizeYearInput(year)));
  }
}

function getOneTimeAmountEvent(flowName: string): Event | null {
  return plannerState.events.find((event) => isOneTimeAmountEvent(event, flowName)) ?? null;
}

function getOneTimeResetEvent(flowName: string): Event | null {
  return plannerState.events.find((event) => isOneTimeResetEvent(event, flowName)) ?? null;
}

function isFlowOneTimeMode(flow: FlowDefinition): boolean {
  return getOneTimeAmountEvent(flow.name) !== null || getOneTimeResetEvent(flow.name) !== null;
}

function getOneTimeYearForFlow(flow: FlowDefinition): string {
  const amountEvent = getOneTimeAmountEvent(flow.name);
  if (amountEvent) {
    return yearLabel(amountEvent.schedule[0].year);
  }

  const resetEvent = getOneTimeResetEvent(flow.name);
  if (resetEvent) {
    return yearLabel(addYears(resetEvent.schedule[0].year, -1));
  }

  return plannerState.startYear;
}

function getOneTimeFormulaForFlow(flow: FlowDefinition): string {
  const amountAction = getOneTimeAmountEvent(flow.name)?.schedule[0]?.actions[0];
  if (amountAction?.kind === "set-flow-formula") {
    return amountAction.formula;
  }

  return flow.formula;
}

function upsertExpenseChangeEvent(originalEventName: string | null, flowName: string, year: string, formula: string): void {
  const nextEvent = new Event({
    name: createExpenseChangeEventName(flowName, year),
    flowName,
    schedule: [
      {
        year: parseYearInput(year),
        actions: [
          {
            kind: "set-flow-formula",
            flowName,
            formula: formula.trim(),
          },
        ],
      },
    ],
  });

  const targetNames = new Set(
    [originalEventName, createExpenseChangeEventName(flowName, year)].filter((value): value is string => Boolean(value))
  );

  plannerState.events = plannerState.events.filter((event) => !targetNames.has(event.name));
  plannerState.events.push(nextEvent);
}

function createExpenseChangeEvent(flowName: string, year: string, formula: string): Event {
  return new Event({
    name: createExpenseChangeEventName(flowName, year),
    flowName,
    schedule: [
      {
        year: parseYearInput(year),
        actions: [
          {
            kind: "set-flow-formula",
            flowName,
            formula: formula.trim(),
          },
        ],
      },
    ],
  });
}

function upsertFlowChangeDraft(draft: FlowDraft, changeId: string | null, year: string, formula: string): void {
  const nextChange = {
    id: changeId ?? createId(),
    year: normalizeYearInput(year),
    formula: formula.trim(),
  };

  draft.changeEvents = changeId
    ? draft.changeEvents.map((change) => (change.id === changeId ? nextChange : change))
    : [...draft.changeEvents, nextChange];
}

function beginFlowEventEdit(
  flowName: string,
  field: ActiveFlowEventEdit["field"],
  eventName: string | null = null
): void {
  if (eventName) {
    const event = plannerState.events.find((candidate) => candidate.name === eventName);
    const action = event?.schedule[0]?.actions[0];
    if (!event || action?.kind !== "set-flow-formula") {
      return;
    }

    flowEventDraft.originalName = event.name;
    flowEventDraft.year = yearLabel(event.schedule[0].year);
    flowEventDraft.formula = action.formula;
  } else {
    flowEventDraft.originalName = null;
    flowEventDraft.year = getNextExpenseChangeYear(flowName);
    flowEventDraft.formula = plannerState.flows.find((flow) => flow.name === flowName)?.formula ?? "";
  }

  activeFlowEventEdit = {
    eventName,
    field,
  };
}

function beginFlowDraftChangeEdit(field: ActiveFlowEventEdit["field"], changeId: string | null = null): void {
  if (changeId) {
    const change = flowDraft.changeEvents.find((candidate) => candidate.id === changeId);
    if (!change) {
      return;
    }

    flowEventDraft.originalName = change.id;
    flowEventDraft.year = change.year;
    flowEventDraft.formula = change.formula;
  } else {
    flowEventDraft.originalName = null;
    flowEventDraft.year = getNextFlowDraftChangeYear(flowDraft);
    flowEventDraft.formula = flowDraft.formula;
  }

  activeFlowEventEdit = {
    eventName: changeId,
    field,
  };
}

function renderUser(user: UserIdentity): string {
  return `
    <section class="panel user-card">
      <div class="panel-heading">
        <p class="kicker">Identity</p>
        <h2>${escapeHtml(user.email)}</h2>
      </div>
      <div class="pill-row">
        <span class="pill">User ${escapeHtml(user.id)}</span>
        <span class="pill">Stub auth</span>
      </div>
    </section>
  `;
}

function renderSetupAssetArea(): string {
  if (plannerState.assets.length === 0) {
    return `<p class="helper-copy">No assets yet. Add one to represent your stocks, bonds, home, or other investments.</p>`;
  }

  return `
    <div class="workspace-list">
      ${plannerState.assets
        .map(
          (asset) => `
            <article
              class="workspace-item workspace-item-card"
              data-edit-asset-card="${escapeAttribute(asset.name)}"
              role="button"
              tabindex="0"
              aria-label="Edit asset ${escapeAttribute(asset.name)}"
            >
              <div class="workspace-item-header">
                <div class="workspace-item-lead">
                  <div class="workspace-item-title-row">
                    <div class="workspace-item-title">
                      ${escapeHtml(asset.name)}
                    </div>
                    <span class="pill">${escapeHtml(getAssetDefinitionTypeLabel(asset))}</span>
                  </div>
                  ${renderVisibleAssetCashGenerationSummary(asset) ? `<p class="workspace-item-copy">${escapeHtml(renderVisibleAssetCashGenerationSummary(asset))}</p>` : ""}
                  ${renderHomeMortgageSummary(asset) ? `<p class="workspace-item-copy">${escapeHtml(renderHomeMortgageSummary(asset))}</p>` : ""}
                </div>
                ${
                  activeInlineAssetValueEditName === asset.name
                    ? `
                  <form class="inline-asset-value-form" data-inline-asset-value-form="${escapeAttribute(asset.name)}">
                    <div data-inline-asset-value-input="true">
                      ${renderFormulaEditor({
                        inputName: isHomeAsset(asset) ? "initialCost" : "startingValue",
                        value: getAssetValueFormulaInput(asset),
                        placeholder: isHomeAsset(asset) ? "salary * 4" : "salary * 2",
                        variablesScope: "planner",
                        type: "money",
                      })}
                    </div>
                  </form>
                    `
                    : `
                  <button
                    type="button"
                    class="link-button workspace-item-value-button"
                    data-edit-asset-value="${escapeAttribute(asset.name)}"
                    aria-label="Edit ${escapeAttribute(asset.name)} amount"
                  >
                    ${formatCurrency(getAssetSummaryValue(asset))}
                  </button>
                    `
                }
              </div>
              <div class="workspace-item-stats">
                ${renderAssetStats(asset)}
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderExpenseValuePath(flowName: string, startYearInput: string, initialAmount: number): string {
  const startYear = parseYearInput(normalizeYearInput(startYearInput));
  const relevantEventYears = [
    ...getExpenseChangeEvents(flowName).map((event) => getFirstEventYear(event)),
    ...plannerState.events
      .filter((event) => isOneTimeResetEvent(event, flowName))
      .map((event) => getFirstEventYear(event)),
  ]
    .filter((eventYear) => compareEventYears(eventYear, startYear) > 0)
    .sort(compareEventYears);

  if (relevantEventYears.length === 0) {
    return "";
  }

  const maxOffset = Math.max(...relevantEventYears.map((eventYear) => eventYear.year - startYear.year));
  const snapshots = buildSnapshots(startYearInput, maxOffset + 1);
  const parts = [formatCurrency(initialAmount)];

  for (const eventYear of relevantEventYears) {
    const snapshot = snapshots[eventYear.year - startYear.year];
    const amount = snapshot ? Math.abs(snapshot.flowAmounts.get(flowName) ?? 0) : 0;
    parts.push(`${formatCurrency(amount)} (${eventYear.year})`);
  }

  return parts.join(" -> ");
}

function renderIncomeTimingSummary(flow: FlowDefinition): string {
  if (flow.type !== "income") {
    return "";
  }

  if (isFlowOneTimeMode(flow)) {
    return `One-time in ${getOneTimeYearForFlow(flow)}`;
  }

  const parts: string[] = [];
  if (flow.startYear !== undefined) {
    parts.push(`Starts ${flow.startYear}`);
  }
  if (flow.endYear !== undefined) {
    parts.push(`Ends ${flow.endYear}`);
  }
  if (flow.annualRaisePercent !== undefined && flow.annualRaisePercent !== 0) {
    parts.push(`${formatPercentage(flow.annualRaisePercent)} raise per year`);
  }

  return parts.length > 0 ? parts.join(" | ") : "Active each year";
}

function renderFlowSummary(flow: FlowDefinition, yearlyAmount: number): string {
  if (flow.type === "income") {
    return renderIncomeTimingSummary(flow);
  }

  const parts: string[] = [];
  const expenseValuePath = renderExpenseValuePath(flow.name, simulationDraft.startYear, Math.abs(yearlyAmount));
  if (expenseValuePath) {
    parts.push(expenseValuePath);
  }
  if (!isFlowInflationAdjusted(flow)) {
    parts.push("Inflation opt-out");
  }

  return parts.join(" | ");
}

function renderSetupFlowArea(
  flowRows: Array<{ flow: FlowDefinition; yearlyAmount: number }>,
  type: FlowType
): string {
  if (flowRows.length === 0) {
    return `<p class="helper-copy">${type === "income" ? "Add income from salary, inheritance, side hustles, etc." : "Add expenses like shopping, car payments, etc."}</p>`;
  }

  return `
    <div class="workspace-list">
      ${flowRows
        .map(
          ({ flow, yearlyAmount }) => {
            const flowSummary = renderFlowSummary(flow, yearlyAmount);

            return `
              <article
                class="workspace-item workspace-item-card"
                data-edit-flow-card="${escapeAttribute(flow.name)}"
                role="button"
                tabindex="0"
                aria-label="Edit ${escapeAttribute(flow.type)} ${escapeAttribute(flow.name)}"
              >
                <div class="workspace-item-header">
                  <div class="workspace-item-lead">
                    <div class="workspace-item-title-row">
                      <div class="workspace-item-title">
                        ${escapeHtml(flow.name)}
                      </div>
                    </div>
                    ${flowSummary ? `<p class="workspace-item-copy">${escapeHtml(flowSummary)}</p>` : ""}
                  </div>
                  ${
                    activeInlineExpenseValueEditName === flow.name
                      ? `
                    <form class="inline-asset-value-form" data-inline-expense-value-form="${escapeAttribute(flow.name)}">
                      <div data-inline-expense-value-input="true">
                        ${renderFormulaEditor({
                          inputName: "formula",
                          value: flow.formula,
                          placeholder: "1,000",
                          variablesScope: "planner",
                          type: "money",
                          requiredLabel: "Amount",
                        })}
                      </div>
                    </form>
                      `
                      : `
                    <button
                      type="button"
                      class="link-button workspace-item-value-button"
                      data-edit-expense-value="${escapeAttribute(flow.name)}"
                      aria-label="Edit ${escapeAttribute(flow.name)} amount"
                    >
                      ${formatSignedCurrency(yearlyAmount)}
                    </button>
                      `
                  }
                </div>
              </article>
            `;
          }
        )
        .join("")}
    </div>
  `;
}

function renderVariablesCard(): string {
  const variableRows =
    plannerState.variables.length > 0
      ? plannerState.variables
          .map(
            (variable) => `
              <label class="formula-input-row" data-variable-name="${escapeHtml(variable.name)}">
                <span class="formula-input-name">${escapeHtml(variable.name)}</span>
                <input
                  name="value"
                  ${renderEditableNumberInputAttributes()}
                  value="${escapeHtml(formatEditableNumberInput(String(variable.value)))}"
                />
              </label>
            `
          )
          .join("")
      : `<p class="helper-copy">Create a variable in an asset, income, or expense formula and it will appear here.</p>`;

  return `
    <section class="panel workspace-section formula-inputs-card">
      <div class="workspace-section-header workspace-section-header-compact">
        <div class="panel-heading">
          <p class="kicker">Variables</p>
          <h2>Formula inputs</h2>
        </div>
      </div>
      <div class="formula-input-list">
        ${variableRows}
      </div>
    </section>
  `;
}

function renderTaxPresetOptions(selectedTaxPreset: TaxPreset, includeCustom = false): string {
  const builtInOptions = getBuiltInTaxPresetOptions()
    .map(
      (preset) => `
        <option value="${escapeAttribute(preset.id)}" ${selectedTaxPreset === preset.id ? "selected" : ""}>
          ${escapeHtml(preset.label)}
        </option>
      `
    )
    .join("");

  return `${builtInOptions}${
    includeCustom ? `<option value="custom" ${selectedTaxPreset === "custom" ? "selected" : ""}>Custom</option>` : ""
  }`;
}

function renderBasicInfoSection(): string {
  return `
    <section class="panel workspace-section">
      <div class="workspace-section-header">
        <div class="panel-heading">
          <p class="kicker">Basic info</p>
          <h2>Age and location</h2>
        </div>
      </div>
      <div class="simulation-sweep-fields">
        <label>
          Age
          <input
            name="basicInfoCurrentAge"
            type="number"
            min="${MIN_CURRENT_USER_AGE}"
            max="${MAX_CURRENT_USER_AGE}"
            step="1"
            value="${simulationDraft.currentAge}"
          />
        </label>
        <label>
          Location
          <select name="basicInfoTaxPreset">
            ${renderTaxPresetOptions(simulationDraft.taxPreset, true)}
          </select>
        </label>
      </div>
    </section>
  `;
}

function renderSetupBoard(flowRows: Array<{ flow: FlowDefinition; yearlyAmount: number }>): string {
  const incomeRows = flowRows.filter(({ flow }) => flow.type === "income");
  const expenseRows = flowRows.filter(({ flow }) => flow.type === "expense");

  return `
    <div class="setup-main">
        ${renderBasicInfoSection()}
        <section class="panel workspace-section">
          <div class="workspace-section-header">
            <div class="panel-heading">
              <p class="kicker">Cash flow</p>
              <h2>Income</h2>
            </div>
            <button type="button" data-open-flow-composer="income">Add income</button>
          </div>
          ${renderSetupFlowArea(incomeRows, "income")}
        </section>

        <section class="panel workspace-section">
          <div class="workspace-section-header">
            <div class="panel-heading">
              <p class="kicker">Cash flow</p>
              <h2>Expenses</h2>
            </div>
            <button type="button" data-open-flow-composer="expense">Add expense</button>
          </div>
          ${renderSetupFlowArea(expenseRows, "expense")}
        </section>

        <section class="panel workspace-section">
          <div class="workspace-section-header">
            <div class="panel-heading">
              <p class="kicker">Assets</p>
              <h2>Your Money</h2>
            </div>
            <button type="button" id="open-asset-composer">Add asset</button>
          </div>
          ${renderSetupAssetArea()}
        </section>
    </div>
  `;
}

function getSimulationTaxPresetDefinition(
  taxPreset: TaxPreset,
  filingStatus: FilingStatus
): { taxes: TaxDefinition[]; householdTaxProfile: HouseholdTaxProfileDefinition } {
  switch (taxPreset) {
    case "nyc": {
      const preset = createDefaultNYCHouseholdTaxes(filingStatus);
      return {
        taxes: preset.taxes,
        householdTaxProfile: preset.profile,
      };
    }
    case "custom": {
      const nextCustomProfile = buildTaxProfileDefinition(taxProfileDraft);
      return {
        taxes: [...plannerState.taxes],
        householdTaxProfile: nextCustomProfile ? { ...nextCustomProfile } : { ...plannerState.taxProfile },
      };
    }
    default: {
      const statePresetId = taxPreset.slice(STATE_TAX_PRESET_PREFIX.length);
      const preset = createStateHouseholdTaxes(statePresetId, filingStatus);
      return {
        taxes: preset.taxes,
        householdTaxProfile: preset.profile,
      };
    }
  }
}

function createBuiltInTaxPresetDefinition(
  taxPreset: Exclude<TaxPreset, "custom">,
  filingStatus: FilingStatus
): { profile: HouseholdTaxProfileDefinition; taxes: TaxDefinition[] } {
  if (taxPreset === "nyc") {
    return createDefaultNYCHouseholdTaxes(filingStatus);
  }

  return createStateHouseholdTaxes(taxPreset.slice(STATE_TAX_PRESET_PREFIX.length), filingStatus);
}

function seedCustomTaxProfileFromPreset(taxPreset: TaxPreset): void {
  if (taxPreset === "custom" && plannerState.taxes.length > 0) {
    return;
  }

  if (plannerState.taxes.length > 0) {
    return;
  }

  const sourcePreset = taxPreset === "custom" ? "nyc" : taxPreset;
  const preset = createBuiltInTaxPresetDefinition(sourcePreset, taxProfileDraft.filingStatus);
  plannerState.taxes = preset.taxes.map((tax) => buildNormalizedTaxDefinition(tax));
  plannerState.taxProfile = preset.profile;
  syncTaxProfileDraft();
}

function renderPlanner(user: UserIdentity): void {
  syncSimulationDraftAssetRows({ invalidateOnChange: false });
  syncSimulationVariableSweepDraft();
  normalizeSimulationDraftHorizon();
  const flowRows = buildFlowRows(simulationDraft.startYear);

  mountedAppRoot.innerHTML = `
    <div class="app-shell">
      <header class="planner-header">
        <span class="planner-brand-mark" aria-hidden="true">S</span>
        <div class="planner-header-copy">
          <h1>Soroban</h1>
          <p class="hero-copy">
            Calculate the lifestyle you can afford
          </p>
        </div>
      </header>

      <main class="planner-main">
        <section class="planner-workspace-split">
          <div class="planner-workspace-panel planner-workspace-setup">
            ${renderSetupBoard(flowRows)}
          </div>
          <div class="planner-workspace-panel planner-workspace-simulation">
            ${renderSimulationBoard()}
          </div>
        </section>
      </main>

      ${renderAssetComposer()}
      ${renderAssetEditor()}
      ${renderFlowComposer()}
      ${renderFlowEditor()}
    </div>
  `;

  bindHandlers(user);
}

function renderExpensesBoard(expenseRows: Array<{ flow: FlowDefinition; yearlyAmount: number }>): string {
  if (expenseRows.length === 0) {
    return `<p class="helper-copy">No income or expenses yet. Create one to track a recurring or one-time outflow.</p>`;
  }

  return `
    <div class="board-scroll">
      <table class="flow-table expense-table">
        <thead>
          <tr>
            <th>Expense</th>
            <th>Amount</th>
            <th>Change over time</th>
            <th>Yearly amount</th>
          </tr>
        </thead>
        <tbody>
          ${expenseRows
            .map(
              ({ flow, yearlyAmount }) => {
                const changes = getExpenseChangeEvents(flow.name);
                const hasOneTimeReset = isFlowOneTimeMode(flow);

                return `
                <tr>
                  <th>
                    <button type="button" class="link-button" data-edit-flow="${escapeHtml(flow.name)}">
                      ${escapeHtml(flow.name)}
                    </button>
                    ${
                      isFlowInflationAdjusted(flow)
                        ? ""
                        : `<div class="expense-row-meta"><span class="summary-meta">${escapeHtml(getExpenseInflationSummary(flow))}</span></div>`
                    }
                  </th>
                  <td><code>${escapeHtml(formatFormulaText(flow.formula))}</code></td>
                  <td>
                    ${
                      changes.length === 0 && !hasOneTimeReset
                        ? `<span class="summary-meta">None</span>`
                        : [
                            ...changes.map(
                              (event) =>
                                `${escapeHtml(yearLabel(event.schedule[0].year))}: <code>${escapeHtml(
                                  event.schedule[0].actions[0].kind === "set-flow-formula"
                                    ? formatFormulaText(event.schedule[0].actions[0].formula)
                                    : ""
                                )}</code>`
                            ),
                            ...(hasOneTimeReset
                              ? [`<span class="summary-meta">One-time in ${escapeHtml(getOneTimeYearForFlow(flow))}</span>`]
                              : []),
                          ].join("<br />")
                    }
                  </td>
                  <td>${formatCurrency(yearlyAmount)}</td>
                </tr>
                `;
              }
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderTaxProfileFields(): string {
  const taxOptions = plannerState.taxes
    .map(
      (tax) => `
        <option value="${escapeAttribute(tax.name)}">${escapeHtml(tax.name)}</option>
      `
    )
    .join("");

  return `
      <div class="split-fields">
        <label>
          Filing status
          <select name="filingStatus">
            <option value="individual" ${taxProfileDraft.filingStatus === "individual" ? "selected" : ""}>Individual</option>
            <option value="married-couple-jointly" ${taxProfileDraft.filingStatus === "married-couple-jointly" ? "selected" : ""}>Married couple jointly</option>
          </select>
        </label>
        <label>
          Deduction mode
          <select name="deductionMode">
            <option value="standard" ${taxProfileDraft.deductionMode === "standard" ? "selected" : ""}>Standard</option>
            <option value="itemized" ${taxProfileDraft.deductionMode === "itemized" ? "selected" : ""}>Itemized</option>
          </select>
        </label>
      </div>
      <div class="split-fields">
        <label>
          Federal standard deduction
          <input
            name="federalStandardDeduction"
            ${renderEditableNumberInputAttributes()}
            value="${escapeHtml(formatEditableNumberInput(taxProfileDraft.federalStandardDeduction))}"
          />
        </label>
        <label>
          NIIT threshold
          <input name="niitThreshold" ${renderEditableNumberInputAttributes()} value="${escapeHtml(formatEditableNumberInput(taxProfileDraft.niitThreshold))}" />
        </label>
      </div>
      <div class="split-fields">
        <label>
          Other SALT paid
          <input name="otherSaltTaxesPaid" ${renderEditableNumberInputAttributes()} value="${escapeHtml(formatEditableNumberInput(taxProfileDraft.otherSaltTaxesPaid))}" />
        </label>
        <label>
          SALT base cap
          <input name="saltDeductionBaseCap" ${renderEditableNumberInputAttributes()} value="${escapeHtml(formatEditableNumberInput(taxProfileDraft.saltDeductionBaseCap))}" />
        </label>
      </div>
      <div class="split-fields">
        <label>
          SALT floor cap
          <input name="saltDeductionFloorCap" ${renderEditableNumberInputAttributes()} value="${escapeHtml(formatEditableNumberInput(taxProfileDraft.saltDeductionFloorCap))}" />
        </label>
        <label>
          SALT phaseout threshold
          <input
            name="saltDeductionPhaseoutThreshold"
            ${renderEditableNumberInputAttributes()}
            value="${escapeHtml(formatEditableNumberInput(taxProfileDraft.saltDeductionPhaseoutThreshold))}"
          />
        </label>
      </div>
      <div class="split-fields">
        <label>
          SALT phaseout rate
          <input name="saltDeductionPhaseoutRate" type="number" step="0.0001" value="${escapeHtml(taxProfileDraft.saltDeductionPhaseoutRate)}" />
        </label>
        <label>
          Other itemized deductions
          <input
            name="otherItemizedDeductions"
            ${renderEditableNumberInputAttributes()}
            value="${escapeHtml(formatEditableNumberInput(taxProfileDraft.otherItemizedDeductions))}"
          />
        </label>
      </div>
      <div class="split-fields">
        <label>
          State taxable-income adjustment
          <input
            name="stateTaxableIncomeAdjustment"
            ${renderEditableNumberInputAttributes()}
            value="${escapeHtml(formatEditableNumberInput(taxProfileDraft.stateTaxableIncomeAdjustment))}"
          />
        </label>
        <label>
          Local taxable-income adjustment
          <input
            name="localTaxableIncomeAdjustment"
            ${renderEditableNumberInputAttributes()}
            value="${escapeHtml(formatEditableNumberInput(taxProfileDraft.localTaxableIncomeAdjustment))}"
          />
        </label>
      </div>
      <div class="split-fields">
        <label>
          Federal ordinary schedule
          <select name="federalOrdinaryTaxName">${renderTaxProfileOptions(taxOptions, taxProfileDraft.federalOrdinaryTaxName)}</select>
        </label>
        <label>
          Federal qualified/LTCG schedule
          <select name="federalQualifiedTaxName">${renderTaxProfileOptions(taxOptions, taxProfileDraft.federalQualifiedTaxName)}</select>
        </label>
      </div>
      <div class="split-fields">
        <label>
          State schedule
          <select name="stateTaxName">${renderTaxProfileOptions(taxOptions, taxProfileDraft.stateTaxName)}</select>
        </label>
        <label>
          State LTCG schedule
          <select name="stateCapitalGainsTaxName">${renderTaxProfileOptions(taxOptions, taxProfileDraft.stateCapitalGainsTaxName)}</select>
        </label>
      </div>
      <div class="split-fields">
        <label>
          Local schedule
          <select name="localTaxName">${renderTaxProfileOptions(taxOptions, taxProfileDraft.localTaxName)}</select>
        </label>
        <label>
          NIIT schedule
          <select name="niitTaxName">${renderTaxProfileOptions(taxOptions, taxProfileDraft.niitTaxName)}</select>
        </label>
      </div>
  `;
}

function renderTaxProfileEditor(): string {
  const builtInTaxPresetOptions = getBuiltInTaxPresetOptions()
    .map(
      (preset) => `
        <option value="${escapeAttribute(preset.id)}">${escapeHtml(preset.label)}</option>
      `
    )
    .join("");

  return `
    <form id="tax-profile-form" class="stack-form composer-subsection" data-tax-profile-editor="setup">
      <div class="event-entry-header">
        <strong>Household tax profile</strong>
      </div>
      <div class="split-fields">
        <label>
          Tax preset
          <select name="taxPresetToLoad">
            ${builtInTaxPresetOptions}
          </select>
        </label>
        <div class="tax-preset-load-action">
          <button type="button" class="secondary-button" id="load-tax-preset">Load selected preset</button>
        </div>
      </div>
      ${renderTaxProfileFields()}
    </form>
  `;
}

function renderTaxProfileOptions(optionsHtml: string, selectedValue: string): string {
  return `<option value=""></option>${optionsHtml.replace(
    `value="${escapeAttribute(selectedValue)}"`,
    `value="${escapeAttribute(selectedValue)}" selected`
  )}`;
}

function getDefaultFlowTaxTreatment(type: FlowType): FlowTaxTreatment {
  return type === "income" ? "wages" : "nondeductible-expense";
}

function getFlowTaxTreatmentOptions(type: FlowType): ReadonlyArray<{ value: FlowTaxTreatment; label: string }> {
  return type === "income" ? INCOME_FLOW_TAX_TREATMENTS : EXPENSE_FLOW_TAX_TREATMENTS;
}

function normalizeFlowDraftTaxTreatment(type: FlowType, taxTreatment: FlowTaxTreatment): FlowTaxTreatment {
  return getFlowTaxTreatmentOptions(type).some((option) => option.value === taxTreatment)
    ? taxTreatment
    : getDefaultFlowTaxTreatment(type);
}

function updateFlowDraftType(draft: FlowDraft | FlowEditDraft, type: FlowType): void {
  draft.type = type;
  draft.taxTreatment = normalizeFlowDraftTaxTreatment(type, draft.taxTreatment);

  if (type === "income") {
    draft.inflationAdjusted = false;
    draft.oneTimeYear = normalizeYearInput(draft.oneTimeYear || draft.startYear || plannerState.startYear);
    draft.startYear = normalizeYearInput(draft.startYear);
    draft.endYear = normalizeOptionalYearInput(draft.endYear);
    if (!draft.annualRaisePercent.trim()) {
      draft.annualRaisePercent = "4";
    }
    return;
  }

  draft.inflationAdjusted = draft.oneTime ? false : true;
}

function renderFlowTaxTreatmentOptions(type: FlowType, selectedValue: FlowTaxTreatment): string {
  return getFlowTaxTreatmentOptions(type)
    .map(
      (option) =>
        `<option value="${option.value}" ${selectedValue === option.value ? "selected" : ""}>${option.label}</option>`
    )
    .join("");
}

function buildFlowDefinitionFromDraft(draft: FlowDraft | FlowEditDraft): FlowDefinition {
  if (draft.type === "income") {
    const startYear = parseYearInput(draft.oneTime ? draft.oneTimeYear : draft.startYear).year;
    const endYear = !draft.oneTime && draft.endYear.trim() ? parseYearInput(draft.endYear).year : undefined;
    const annualRaisePercent = draft.oneTime ? 0 : Number(draft.annualRaisePercent);

    if (!Number.isFinite(annualRaisePercent)) {
      throw new Error("Income annual raise % must be a finite number.");
    }

    return new Flow({
      name: draft.name.trim(),
      type: "income",
      formula: draft.oneTime ? "0" : draft.formula.trim(),
      taxTreatment: draft.taxTreatment,
      startYear,
      ...(endYear === undefined ? {} : { endYear }),
      annualRaisePercent,
    }).toDefinition();
  }

  return new Flow({
    name: draft.name.trim(),
    type: "expense",
    formula: draft.oneTime ? "0" : draft.formula.trim(),
    inflationAdjusted: draft.oneTime ? false : draft.inflationAdjusted,
    taxTreatment: draft.taxTreatment,
  }).toDefinition();
}

function focusFlowNameInputIfEmpty(formSelector: "#flow-form" | "#flow-edit-form"): void {
  const nameInput = document.querySelector<HTMLInputElement>(`${formSelector} input[name="flowLabel"]`);
  if (!nameInput || nameInput.value.trim()) {
    return;
  }

  nameInput.focus();
}

function focusNewFlowNameInput(): void {
  if (!shouldFocusNewFlowName) {
    return;
  }

  shouldFocusNewFlowName = false;
  focusFlowNameInputIfEmpty("#flow-form");
}

function focusFlowFormulaEditor(formSelector: "#flow-form" | "#flow-edit-form"): void {
  const hiddenInput = document.querySelector<HTMLInputElement>(
    `${formSelector} .formula-editor-hidden-input[name="formula"]`
  );
  const editor = hiddenInput?.closest("[data-formula-editor]")?.querySelector<HTMLDivElement>(".formula-editor-input");
  if (!editor) {
    return;
  }

  editor.focus();
  setCaretCharacterOffset(editor, editor.textContent?.length ?? 0);
}

function focusNewAssetNameInput(): void {
  if (!shouldFocusNewAssetName) {
    return;
  }

  shouldFocusNewAssetName = false;
  const nameInput = document.querySelector<HTMLInputElement>("#asset-form input[name=\"assetLabel\"]");
  if (!nameInput || nameInput.value.trim()) {
    return;
  }

  nameInput.focus();
}

function isZeroValueInput(value: string): boolean {
  const parsed = parseEditableNumber(value);
  return Number.isFinite(parsed) && Math.abs(parsed) <= 0.000001;
}

function doesAssetValueResolveToZero(value: string): boolean {
  const formula = value.trim();
  if (!formula) {
    return false;
  }

  try {
    return Math.abs(evaluateFormula(formula, buildPlannerFormulaContext())) <= 0.000001;
  } catch {
    return isZeroValueInput(value);
  }
}

function focusAssetStartingValueInputIfZero(): void {
  if (!shouldFocusAssetStartingValueIfZero) {
    return;
  }

  shouldFocusAssetStartingValueIfZero = false;
  if (!isZeroValueInput(assetDraft.startingValue)) {
    return;
  }

  const hiddenInput = document.querySelector<HTMLInputElement>("#asset-form input[name=\"startingValue\"]");
  const editor = hiddenInput
    ?.closest<HTMLElement>("[data-formula-editor]")
    ?.querySelector<HTMLDivElement>(".formula-editor-input");
  if (!editor) {
    return;
  }

  editor.focus();
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  const range = document.createRange();
  range.selectNodeContents(editor);
  selection.removeAllRanges();
  selection.addRange(range);
}

function getSimulationSubmitState(): { disabled: boolean; reason: string } {
  if (!hasSimulationEntries()) {
    return {
      disabled: true,
      reason: "Create at least one income, expense, or asset to run a simulation.",
    };
  }

  if (simulationDraft.variableSweep.enabled) {
    if (plannerState.variables.length === 0) {
      return {
        disabled: true,
        reason: "Create at least one variable before running a variable sweep.",
      };
    }

    if (!plannerState.variables.some((variable) => variable.name === simulationDraft.variableSweep.variableName)) {
      return {
        disabled: true,
        reason: "Choose a valid variable to sweep.",
      };
    }

    const minValue = parseEditableNumber(simulationDraft.variableSweep.minValue);
    const maxValue = parseEditableNumber(simulationDraft.variableSweep.maxValue);
    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
      return {
        disabled: true,
        reason: "Variable sweep min and max values must be finite numbers.",
      };
    }

    if (maxValue < minValue) {
      return {
        disabled: true,
        reason: "Variable sweep max must be greater than or equal to min.",
      };
    }
  }

  if (simulationDraft.inflationPreset === "fixed-custom") {
    const inflationRate = parseEditableNumber(simulationDraft.fixedInflationRate);
    if (!Number.isFinite(inflationRate)) {
      return {
        disabled: true,
        reason: "Simulation inflation rate must be a finite number.",
      };
    }
  } else if (simulationDraft.inflationPreset === "regime-custom") {
    const lowAverageRate = parseEditableNumber(simulationDraft.regimeSwitchingInflation.lowAverageRate);
    const lowVolatility = parseEditableNumber(simulationDraft.regimeSwitchingInflation.lowVolatility);
    const highAverageRate = parseEditableNumber(simulationDraft.regimeSwitchingInflation.highAverageRate);
    const highVolatility = parseEditableNumber(simulationDraft.regimeSwitchingInflation.highVolatility);
    const stayLowProbability = parseEditableNumber(simulationDraft.regimeSwitchingInflation.stayLowProbability);
    const stayHighProbability = parseEditableNumber(simulationDraft.regimeSwitchingInflation.stayHighProbability);

    if (
      ![
        lowAverageRate,
        lowVolatility,
        highAverageRate,
        highVolatility,
        stayLowProbability,
        stayHighProbability,
      ].every(Number.isFinite)
    ) {
      return {
        disabled: true,
        reason: "All regime-switching inflation fields must be finite numbers.",
      };
    }

    if (lowVolatility < 0 || highVolatility < 0) {
      return {
        disabled: true,
        reason: "Inflation regime volatilities must be zero or greater.",
      };
    }

    if (stayLowProbability < 0 || stayLowProbability > 100 || stayHighProbability < 0 || stayHighProbability > 100) {
      return {
        disabled: true,
        reason: "Inflation persistence probabilities must be between 0 and 100.",
      };
    }
  }

  return {
    disabled: false,
    reason: "",
  };
}

function hasSimulationEntries(): boolean {
  return plannerState.assets.length > 0 || plannerState.flows.length > 0;
}

function getSimulationPercentileColor(percentile: SimulationPercentile): string {
  switch (percentile) {
    case 5:
      return "#b14f3d";
    case 10:
      return "#cb7c34";
    case 25:
      return "#b79a27";
    case 50:
      return "#256f5c";
    case 75:
      return "#2f6f9d";
    case 90:
      return "#6b5bb3";
  }
}

function renderSimulationTaxInputs(row: SimulationDetailYearRow): string {
  const entries: Array<[string, number]> = [
    ["Wages", row.householdTaxInput.wages],
    ["Ordinary income", row.householdTaxInput.ordinaryIncome],
    ["Qualified dividends", row.householdTaxInput.qualifiedDividends],
    ["Short-term gains", row.householdTaxInput.shortTermCapitalGains],
    ["Long-term gains", row.householdTaxInput.longTermCapitalGains],
    ["Tax-exempt income", row.householdTaxInput.taxExemptIncome],
    ["State/local-exempt income", row.householdTaxInput.stateLocalExemptIncome ?? 0],
    ["Triple-exempt income", row.householdTaxInput.tripleExemptIncome ?? 0],
    ["Deductible expenses", row.householdTaxInput.deductibleExpenses],
    ["Property tax / SALT paid", row.householdTaxInput.saltTaxesPaid ?? 0],
    ["Mortgage interest candidate", row.householdTaxInput.homeMortgageInterestPaid ?? 0],
    ["Average mortgage balance", row.householdTaxInput.homeMortgageAverageBalance ?? 0],
    ["Mortgage interest debt limit", row.householdTaxInput.homeMortgageInterestDebtLimit ?? 0],
  ];
  const visibleEntries = entries.filter(([, amount]) => Math.abs(amount) > 0.000001);

  if (visibleEntries.length === 0) {
    return `<p class="helper-copy">No taxable household inputs were recorded for this example year.</p>`;
  }

  return `
    <div class="board-scroll">
      <table class="flow-table simulation-flow-detail-table">
        <thead>
          <tr>
            <th>Input</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          ${renderSimulationDetailRows(visibleEntries)}
        </tbody>
      </table>
    </div>
  `;
}

function renderSimulationTaxBreakdown(row: SimulationDetailYearRow): string {
  const calculationEntries: Array<[string, number]> = [
    ["Federal taxable income", row.taxBreakdown.federalTaxableIncome],
    ["Federal ordinary taxable income", row.taxBreakdown.federalOrdinaryTaxableIncome],
    ["Federal preferential income", row.taxBreakdown.federalPreferentialIncome],
    ["Deduction used", row.taxBreakdown.deductionUsed],
    ["State taxable income", row.taxBreakdown.stateTaxableIncome],
    ["State ordinary taxable income", row.taxBreakdown.stateOrdinaryTaxableIncome],
    ["State long-term capital gains", row.taxBreakdown.stateCapitalGainsTaxableIncome],
    ["Local taxable income", row.taxBreakdown.localTaxableIncome],
    ["Modified adjusted gross income", row.taxBreakdown.modifiedAdjustedGrossIncome],
    ["Net investment income", row.taxBreakdown.netInvestmentIncome],
    ["NIIT income above threshold", row.taxBreakdown.niitIncomeAboveThreshold],
    ["NIIT taxable income", row.taxBreakdown.niitTaxableIncome],
  ];
  const visibleCalculationEntries = calculationEntries.filter(([, amount]) => Math.abs(amount) > 0.000001);
  const taxEntries = [...row.taxBreakdown.taxByName.entries()].sort((left, right) => right[1] - left[1]);

  if (visibleCalculationEntries.length === 0 && taxEntries.length === 0 && Math.abs(row.taxAmount) <= 0.000001) {
    return `<p class="helper-copy">No tax was due for this example year.</p>`;
  }

  return `
    <div class="board-scroll">
      <table class="flow-table simulation-flow-detail-table">
        <thead>
          <tr>
            <th>Tax calculation</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          ${renderSimulationDetailRows(visibleCalculationEntries)}
          ${Math.abs(row.taxAmount) > 0.000001 ? `<tr><th>Total tax paid</th><td>${formatCurrency(row.taxAmount)}</td></tr>` : ""}
        </tbody>
      </table>
    </div>
    ${
      taxEntries.length > 0
        ? `
      <div class="board-scroll">
        <table class="flow-table simulation-flow-detail-table">
          <thead>
            <tr>
              <th>Tax</th>
              <th>Paid</th>
            </tr>
          </thead>
          <tbody>
            ${renderSimulationDetailRows(taxEntries)}
          </tbody>
        </table>
      </div>
        `
        : ""
    }
  `;
}

function renderSimulationAssetSales(saleEntries: readonly [string, number][]): string {
  const saleSummaries = summarizeSimulationAssetSales(saleEntries);
  if (saleSummaries.length === 0) {
    return `<p class="helper-copy">No asset sales were needed for this example year.</p>`;
  }

  return `
    <div class="board-scroll">
      <table class="flow-table simulation-flow-detail-table">
        <thead>
          <tr>
            <th>Asset</th>
            <th>Sale proceeds</th>
            <th>Realized gain</th>
          </tr>
        </thead>
        <tbody>
          ${saleSummaries
            .map(
              (saleSummary) => `
                <tr>
                  <th>${escapeHtml(saleSummary.assetName)}</th>
                  <td>${formatCurrency(saleSummary.proceeds)}</td>
                  <td>${formatSignedCurrency(saleSummary.realizedGain)}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

interface SimulationAssetSaleSummary {
  assetName: string;
  proceeds: number;
  realizedGain: number;
}

function summarizeSimulationAssetSales(saleEntries: readonly [string, number][]): SimulationAssetSaleSummary[] {
  const saleSummariesByAsset = new Map<string, SimulationAssetSaleSummary>();

  for (const [entryName, amount] of saleEntries) {
    const saleProceedsSuffix = " sale proceeds";
    const realizedGainSuffix = " realized gain";
    const assetName = entryName.endsWith(saleProceedsSuffix)
      ? entryName.slice(0, -saleProceedsSuffix.length)
      : entryName.endsWith(realizedGainSuffix)
        ? entryName.slice(0, -realizedGainSuffix.length)
        : "";
    if (!assetName) {
      continue;
    }

    const saleSummary = saleSummariesByAsset.get(assetName) ?? {
      assetName,
      proceeds: 0,
      realizedGain: 0,
    };
    if (entryName.endsWith(saleProceedsSuffix)) {
      saleSummary.proceeds += amount;
    } else {
      saleSummary.realizedGain += amount;
    }
    saleSummariesByAsset.set(assetName, saleSummary);
  }

  return [...saleSummariesByAsset.values()].sort((left, right) => right.proceeds - left.proceeds);
}

function buildSimulationExampleExport(
  percentile: SimulationPercentile,
  scenario: SimulationScenario,
  detailScenario: SimulationDetailScenario | null
): string {
  const exportedRows = scenario.rows.map((row) => {
    const exampleYear = getExampleSimulationYear(detailScenario, row.yearNumber);
    const visibleFlowTotals = exampleYear ? getVisibleSimulationFlowEntries(exampleYear) : [];
    const saleEntries = exampleYear ? getSimulationSaleEntries(exampleYear) : [];
    const cashFlowEntries = exampleYear ? getSimulationCashFlowEntries(exampleYear) : [];
    const assetValueEntries = exampleYear ? getSimulationAssetValueEntries(exampleYear) : [];
    const assetReturns = exampleYear
      ? [...exampleYear.assetReturns.entries()]
          .filter(
            ([, assetReturn]) =>
              Math.abs(assetReturn.amount) > 0.000001 || Math.abs(assetReturn.percentage) > 0.000001
          )
          .map(([assetName, assetReturn]) => ({
            asset: assetName,
            amount: assetReturn.amount,
            percentage: assetReturn.percentage,
          }))
      : [];
    const example = exampleYear
      ? {
          yearNumber: exampleYear.yearNumber,
          label: exampleYear.label,
          startingAssets: exampleYear.startingAssets,
          endingAssets: exampleYear.endingAssets,
          liquidAssets: exampleYear.liquidAssets ?? 0,
          expenses: Math.max(0, exampleYear.totalExpenses - exampleYear.taxAmount),
          totalExpenses: exampleYear.totalExpenses,
          totalGains: exampleYear.totalGains,
          taxableGains: exampleYear.taxableGains,
          taxAmount: exampleYear.taxAmount,
          totalAssets: exampleYear.totalAssets,
          depletionProbability: exampleYear.depletionProbability,
          cashFlows: cashFlowEntries.map(({ label, amount }) => ({ label, amount })),
          assetReturns,
          taxInputs: {
            wages: exampleYear.householdTaxInput.wages,
            ordinaryIncome: exampleYear.householdTaxInput.ordinaryIncome,
            qualifiedDividends: exampleYear.householdTaxInput.qualifiedDividends,
            shortTermCapitalGains: exampleYear.householdTaxInput.shortTermCapitalGains,
            longTermCapitalGains: exampleYear.householdTaxInput.longTermCapitalGains,
            taxExemptIncome: exampleYear.householdTaxInput.taxExemptIncome,
            stateLocalExemptIncome: exampleYear.householdTaxInput.stateLocalExemptIncome,
            tripleExemptIncome: exampleYear.householdTaxInput.tripleExemptIncome,
            deductibleExpenses: exampleYear.householdTaxInput.deductibleExpenses,
            saltTaxesPaid: exampleYear.householdTaxInput.saltTaxesPaid ?? 0,
            homeMortgageInterestPaid: exampleYear.householdTaxInput.homeMortgageInterestPaid ?? 0,
            homeMortgageAverageBalance: exampleYear.householdTaxInput.homeMortgageAverageBalance ?? 0,
            homeMortgageInterestDebtLimit: exampleYear.householdTaxInput.homeMortgageInterestDebtLimit ?? 0,
          },
          taxBreakdown: {
            federalTaxableIncome: exampleYear.taxBreakdown.federalTaxableIncome,
            federalOrdinaryTaxableIncome: exampleYear.taxBreakdown.federalOrdinaryTaxableIncome,
            federalPreferentialIncome: exampleYear.taxBreakdown.federalPreferentialIncome,
            deductionUsed: exampleYear.taxBreakdown.deductionUsed,
            stateTaxableIncome: exampleYear.taxBreakdown.stateTaxableIncome,
            stateOrdinaryTaxableIncome: exampleYear.taxBreakdown.stateOrdinaryTaxableIncome,
            stateCapitalGainsTaxableIncome: exampleYear.taxBreakdown.stateCapitalGainsTaxableIncome,
            localTaxableIncome: exampleYear.taxBreakdown.localTaxableIncome,
            modifiedAdjustedGrossIncome: exampleYear.taxBreakdown.modifiedAdjustedGrossIncome,
            netInvestmentIncome: exampleYear.taxBreakdown.netInvestmentIncome,
            niitIncomeAboveThreshold: exampleYear.taxBreakdown.niitIncomeAboveThreshold,
            niitTaxableIncome: exampleYear.taxBreakdown.niitTaxableIncome,
            totalTax: exampleYear.taxBreakdown.totalTax,
            taxesPaid: [...exampleYear.taxBreakdown.taxByName.entries()]
              .sort((left, right) => right[1] - left[1])
              .map(([name, amount]) => ({ name, amount })),
          },
          assetSales: saleEntries.map(({ label, amount }) => ({ label, amount })),
          assetValues: assetValueEntries.map(({ label, amount }) => ({ asset: label, amount })),
          assetMarketValues: [...(exampleYear.assetMarketValues?.entries() ?? [])].map(([asset, amount]) => ({ asset, amount })),
          flowTotals: visibleFlowTotals.map(([label, amount]) => ({ label, amount })),
        }
      : null;

    return {
      yearNumber: row.yearNumber,
      label: row.label,
      percentileAssets: row.totalAssets,
      depletionProbability: row.depletionProbability,
      example,
    };
  });

  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      percentile,
      finalPercentileAssets: scenario.finalTotalAssets,
      years: exportedRows,
    },
    null,
    2
  );
}

function downloadSimulationExampleExport(
  percentile: SimulationPercentile,
  scenario: SimulationScenario,
  detailScenario: SimulationDetailScenario | null
): void {
  const fileContents = buildSimulationExampleExport(percentile, scenario, detailScenario);
  const blob = new Blob([fileContents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  link.href = url;
  link.download = `simulation-example-${percentile}th-percentile-${timestamp}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

function buildPersistedPlannerStateRecord(user: UserIdentity): Omit<SavedPlannerState, "updatedAt"> {
  const snapshot = createPlannerSnapshot();
  const sweepMinValue = parseEditableNumber(simulationDraft.variableSweep.minValue);
  const sweepMaxValue = parseEditableNumber(simulationDraft.variableSweep.maxValue);

  return {
    userId: user.id,
    email: user.email,
    variables: snapshot.variables,
    assets: snapshot.assets.map((asset) => {
      const resolvedAsset = resolveAssetValueFormula(asset, buildPlannerFormulaContext());

      return isHomeAsset(resolvedAsset)
        ? {
            kind: "home" as const,
            name: resolvedAsset.name,
            initialCost: resolvedAsset.initialCost,
            ...(resolvedAsset.initialCostFormula ? { initialCostFormula: resolvedAsset.initialCostFormula } : {}),
            expectedReturn: resolvedAsset.expectedReturn,
            volatility: resolvedAsset.volatility,
            cashPurchasePercent: resolvedAsset.cashPurchasePercent,
            closingCostPercent: resolvedAsset.closingCostPercent,
            mortgageType: resolvedAsset.mortgageType,
            ...(resolvedAsset.mortgageType === "interest-only"
              ? {
                  interestOnlyMaturityAction: resolvedAsset.interestOnlyMaturityAction,
                }
              : {}),
            mortgageRate: resolvedAsset.mortgageRate,
            mortgageTermYears: resolvedAsset.mortgageTermYears,
            monthlyNonTaxCosts: resolvedAsset.monthlyNonTaxCosts,
            propertyTaxRate: resolvedAsset.propertyTaxRate,
            purchaseYear: resolvedAsset.purchaseYear,
          }
        : {
            name: resolvedAsset.name,
            ...(resolvedAsset.assetType ? { assetType: resolvedAsset.assetType } : {}),
            startingValue: resolvedAsset.startingValue,
            ...(resolvedAsset.startingValueFormula ? { startingValueFormula: resolvedAsset.startingValueFormula } : {}),
            expectedReturn: resolvedAsset.expectedReturn,
            volatility: resolvedAsset.volatility,
            sellProportion: resolvedAsset.sellProportion,
            ...(resolvedAsset.cashGenerations && resolvedAsset.cashGenerations.length > 0
              ? {
                  cashGenerations: resolvedAsset.cashGenerations.map((cashGeneration) => ({
                    name: cashGeneration.name,
                    rate: cashGeneration.rate,
                    volatility: cashGeneration.volatility,
                    inflationCorrelation: cashGeneration.inflationCorrelation ?? 0,
                    taxTreatment: cashGeneration.taxTreatment,
                  })),
                }
              : {}),
            ...(resolvedAsset.saleTax
              ? {
                  saleTax: {
                    ...(resolvedAsset.saleTax.costBasis !== undefined
                      ? { costBasis: resolvedAsset.saleTax.costBasis }
                      : {}),
                    taxTreatment: resolvedAsset.saleTax.taxTreatment,
                  },
                }
              : {}),
          };
    }),
    assetSellWeightMode: "portfolio-proportion-multiplier",
    taxes: snapshot.taxes.map((tax) => ({
      name: tax.name,
      taxRates: tax.taxRates.map((rate) => ({ ...rate })),
      ...(tax.exclusions ? { exclusions: tax.exclusions.map((exclusion) => ({ ...exclusion })) } : {}),
      ...(tax.maximum === undefined ? {} : { maximum: tax.maximum }),
    })),
    taxProfile: { ...snapshot.taxProfile },
    assetCorrelations: snapshot.assetCorrelations,
    flows: snapshot.flows,
    events: serializeEvents(snapshot.events),
    startYear: plannerState.startYear,
    yearsToShow: plannerState.yearsToShow,
    simulationAttempts: simulationDraft.attempts,
    simulationCurrentAge: simulationDraft.currentAge,
    simulationTaxPreset: simulationDraft.taxPreset,
    simulationHorizonYears: simulationDraft.horizonYears,
    simulationCustomAssetLiquidation: simulationDraft.customAssetLiquidation,
    simulationInflationRate:
      getSimulationInflationModeForPreset(simulationDraft.inflationPreset) === "fixed" &&
      Number.isFinite(parseEditableNumber(simulationDraft.fixedInflationRate))
        ? parseEditableNumber(simulationDraft.fixedInflationRate)
        : undefined,
    simulationInflation: {
      preset: simulationDraft.inflationPreset,
      mode: getSimulationInflationModeForPreset(simulationDraft.inflationPreset),
      ...(getSimulationInflationModeForPreset(simulationDraft.inflationPreset) === "fixed" &&
      Number.isFinite(parseEditableNumber(simulationDraft.fixedInflationRate))
        ? {
            fixedRate: parseEditableNumber(simulationDraft.fixedInflationRate),
          }
        : {}),
      ...(getSimulationInflationModeForPreset(simulationDraft.inflationPreset) === "regime-switching"
        ? {
            regimeSwitching: {
              ...(Number.isFinite(parseEditableNumber(simulationDraft.regimeSwitchingInflation.lowAverageRate))
                ? { lowAverageRate: parseEditableNumber(simulationDraft.regimeSwitchingInflation.lowAverageRate) }
                : {}),
              ...(Number.isFinite(parseEditableNumber(simulationDraft.regimeSwitchingInflation.lowVolatility))
                ? { lowVolatility: parseEditableNumber(simulationDraft.regimeSwitchingInflation.lowVolatility) }
                : {}),
              ...(Number.isFinite(parseEditableNumber(simulationDraft.regimeSwitchingInflation.highAverageRate))
                ? { highAverageRate: parseEditableNumber(simulationDraft.regimeSwitchingInflation.highAverageRate) }
                : {}),
              ...(Number.isFinite(parseEditableNumber(simulationDraft.regimeSwitchingInflation.highVolatility))
                ? { highVolatility: parseEditableNumber(simulationDraft.regimeSwitchingInflation.highVolatility) }
                : {}),
              ...(Number.isFinite(parseEditableNumber(simulationDraft.regimeSwitchingInflation.stayLowProbability))
                ? { stayLowProbability: parseEditableNumber(simulationDraft.regimeSwitchingInflation.stayLowProbability) }
                : {}),
              ...(Number.isFinite(parseEditableNumber(simulationDraft.regimeSwitchingInflation.stayHighProbability))
                ? { stayHighProbability: parseEditableNumber(simulationDraft.regimeSwitchingInflation.stayHighProbability) }
                : {}),
            },
          }
        : {}),
    },
    simulationVariableSweep: {
      enabled: simulationDraft.variableSweep.enabled,
      variableName: simulationDraft.variableSweep.variableName,
      ...(Number.isFinite(sweepMinValue) ? { minValue: sweepMinValue } : {}),
      ...(Number.isFinite(sweepMaxValue) ? { maxValue: sweepMaxValue } : {}),
    },
  };
}

function downloadScenarioExport(user: UserIdentity): void {
  const { userId: _userId, email: _email, ...plannerState } = buildPersistedPlannerStateRecord(user);
  const fileContents = buildScenarioFileContents(plannerState);
  const blob = new Blob([fileContents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  link.href = url;
  link.download = `scenario-${timestamp}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

async function clearScenario(user: UserIdentity): Promise<void> {
  const confirmed = window.confirm(
    "Delete all scenario data, clear the current simulation setup, and start from scratch? This cannot be undone."
  );
  if (!confirmed) {
    return;
  }

  try {
    await storage.deletePlannerState(user.id);
    removeVariableSweepDraftFromLocalStorage(user.id);
    removeSimulationTaxPresetFromLocalStorage(user.id);
    removeSimulationSettingsDraftFromLocalStorage(user.id);
    resetPlannerWorkspaceState();
    renderPlanner(user);
  } catch (error) {
    console.error(error);
    window.alert(error instanceof Error ? error.message : "Scenario data could not be cleared.");
  }
}

function getExampleSimulationYear(
  detailScenario: SimulationDetailScenario | null,
  yearNumber: number
): SimulationDetailYearRow | null {
  if (!detailScenario) {
    return null;
  }

  return detailScenario.rows.find((candidateRow) => candidateRow.yearNumber === yearNumber) ?? null;
}

function renderSimulationExampleYear(row: SimulationDetailYearRow): string {
  const saleEntries = getVisibleSimulationFlowEntries(row).filter(
    ([entryName]) => entryName.endsWith(" sale proceeds") || entryName.endsWith(" realized gain")
  );
  const cashFlowEntries = getSimulationCashFlowEntries(row);
  const assetValueEntries = getSimulationAssetValueEntries(row);
  const expensesWithoutTaxes = Math.max(0, row.totalExpenses - row.taxAmount);
  const liquidAssets = row.liquidAssets ?? 0;
  const startingLiquidAssets = row.startingLiquidAssets ?? row.startingAssets;

  return `
    <div class="simulation-detail-panel">
      <strong>Example year: ${escapeHtml(row.label)}</strong>
      <p class="helper-copy">This is one actual simulated attempt chosen to stay consistent across the selected percentile path. It is illustrative, not the percentile itself.</p>
      <div class="stack-list">
        <section>
          <strong>Summary</strong>
          <div class="board-scroll">
            <table class="flow-table simulation-flow-detail-table">
              <tbody>
                <tr>
                  <th>Starting assets</th>
                  <td>${formatCurrency(row.startingAssets)}</td>
                </tr>
                <tr>
                  <th>Ending assets</th>
                  <td>${formatCurrencyWithDelta(row.endingAssets, row.endingAssets - row.startingAssets)}</td>
                </tr>
                <tr>
                  <th>Liquid assets</th>
                  <td>${formatCurrencyWithDelta(liquidAssets, liquidAssets - startingLiquidAssets)}</td>
                </tr>
                <tr>
                  <th>Gains</th>
                  <td>${formatCurrency(row.totalGains)}</td>
                </tr>
                <tr>
                  <th>Expenses</th>
                  <td>${formatCurrency(expensesWithoutTaxes)}</td>
                </tr>
                <tr>
                  <th>Tax paid</th>
                  <td>${formatCurrency(row.taxAmount)}</td>
                </tr>
                <tr>
                  <th>Taxable gains</th>
                  <td>${formatCurrency(row.taxableGains)}</td>
                </tr>
                <tr>
                  <th>Inflation rate applied</th>
                  <td>${formatPercentage(row.inflationRateApplied * 100)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <section>
          <strong>Cash flows</strong>
          ${
            cashFlowEntries.length === 0
              ? `<p class="helper-copy">No non-zero cash flows were recorded for this example year.</p>`
              : `
          <div class="board-scroll">
            <table class="flow-table simulation-flow-detail-table">
              <thead>
                <tr>
                  <th>Entry</th>
                  <th>Year total</th>
                </tr>
              </thead>
              <tbody>
                ${cashFlowEntries
                  .map(
                    (entry) => `
                      <tr>
                        <th>${escapeHtml(entry.label)}</th>
                        <td>${formatSignedCurrency(entry.amount)}${entry.detail}</td>
                      </tr>
                    `
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
              `
          }
        </section>
        <section>
          <strong>Assets</strong>
          ${
            assetValueEntries.length === 0
              ? `<p class="helper-copy">No asset values were recorded for this example year.</p>`
              : `
          <div class="board-scroll">
            <table class="flow-table simulation-flow-detail-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Current value</th>
                </tr>
              </thead>
              <tbody>
                ${assetValueEntries
                  .map(
                    (entry) => `
                      <tr>
                        <th>${escapeHtml(entry.label)}</th>
                        <td>${formatCurrency(entry.amount)}${entry.detail}</td>
                      </tr>
                    `
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
              `
          }
        </section>
        <section>
          <details>
            <summary><strong>Asset sales</strong></summary>
            ${renderSimulationAssetSales(saleEntries)}
          </details>
        </section>
        <section>
          <details>
            <summary><strong>Tax</strong></summary>
            <div class="simulation-tax-detail">
              ${renderSimulationTaxInputs(row)}
              ${renderSimulationTaxBreakdown(row)}
            </div>
          </details>
        </section>
      </div>
    </div>
  `;
}

function getSimulationChartAxisValues(
  results: Map<SimulationPercentile, SimulationScenario>,
  valueKey: SimulationChartMetric
): number[] {
  const resultSets =
    simulationSweepResults && simulationSweepResults.steps.length > 0
      ? simulationSweepResults.steps.map((step) => step.results)
      : [results];

  return resultSets.flatMap((resultSet) =>
    simulationPercentiles.flatMap((percentile) => {
      const scenario = resultSet.get(percentile);
      return scenario?.rows.map((row) => row[valueKey] ?? 0) ?? [];
    })
  );
}

function roundUpToSingleSignificantDigit(value: number): number {
  if (value <= 0) {
    return 10_000;
  }

  const magnitude = 10 ** Math.floor(Math.log10(value));
  const leadingDigit = Math.ceil(value / magnitude);
  return leadingDigit <= 9 ? leadingDigit * magnitude : 10 * magnitude;
}

function getSimulationChartYAxis(maxValue: number): { yMax: number; yStep: number; yTicks: number[] } {
  const yMax = roundUpToSingleSignificantDigit(maxValue);
  const magnitude = 10 ** Math.floor(Math.log10(yMax));
  const leadingDigit = Math.round(yMax / magnitude);
  const yStep = leadingDigit === 1 ? 2 * (magnitude / 10) : magnitude;
  const tickCount = Math.max(1, Math.round(yMax / yStep));
  const yTicks = Array.from({ length: tickCount + 1 }, (_, index) => index * yStep);

  return { yMax, yStep, yTicks };
}

function renderSimulationChart(
  results: Map<SimulationPercentile, SimulationScenario>,
  {
    title,
    description,
    ariaLabel,
    valueKey,
    valueLabel,
  }: {
    title: string;
    description: string;
    ariaLabel: string;
    valueKey: "totalAssets" | "liquidAssets";
    valueLabel: string;
  }
): string {
  const scenarios = simulationPercentiles
    .map((percentile) => results.get(percentile))
    .filter((scenario): scenario is SimulationScenario => Boolean(scenario));
  if (scenarios.length === 0) {
    return "";
  }

  const width = 760;
  const height = 320;
  const marginTop = 24;
  const marginRight = 24;
  const marginBottom = 40;
  const marginLeft = 88;
  const chartWidth = width - marginLeft - marginRight;
  const chartHeight = height - marginTop - marginBottom;
  const yearCount = Math.max(...scenarios.map((scenario) => scenario.rows.length));
  const values = getSimulationChartAxisValues(results, valueKey);
  const maxValue = Math.max(...values, 0);
  const yMin = 0;
  const { yMax, yStep, yTicks } = getSimulationChartYAxis(maxValue);
  const yRange = Math.max(yStep, yMax - yMin);
  const xTicks = Array.from(
    new Set([1, Math.max(1, Math.ceil(yearCount / 2)), yearCount].filter((value) => value <= yearCount))
  );

  const xForYear = (yearNumber: number): number =>
    marginLeft + (yearCount <= 1 ? chartWidth / 2 : ((yearNumber - 1) / (yearCount - 1)) * chartWidth);
  const yForValue = (value: number): number => marginTop + ((yMax - value) / yRange) * chartHeight;

  return `
    <section class="simulation-chart-panel">
      <div class="simulation-chart-header">
        <div>
          <strong>${escapeHtml(title)}</strong>
          <p class="helper-copy">${escapeHtml(description)}</p>
        </div>
      </div>
      <div class="tab-strip simulation-chart-metric-tabs" role="tablist" aria-label="Simulation chart metric">
        <button
          type="button"
          class="${selectedSimulationChartMetric === "liquidAssets" ? "tab-button is-active" : "tab-button"}"
          data-simulation-chart-metric="liquidAssets"
        >
          Liquid assets
        </button>
        <button
          type="button"
          class="${selectedSimulationChartMetric === "totalAssets" ? "tab-button is-active" : "tab-button"}"
          data-simulation-chart-metric="totalAssets"
        >
          Total assets
        </button>
      </div>
      <div class="board-scroll">
        <svg class="simulation-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAttribute(ariaLabel)}">
          ${yTicks.map((tickValue) => {
            const y = yForValue(tickValue);
            return `
              <g>
                <line class="simulation-chart-grid-line" x1="${marginLeft}" y1="${y}" x2="${width - marginRight}" y2="${y}"></line>
                <text class="simulation-chart-axis-label simulation-chart-axis-label-y" x="${marginLeft - 12}" y="${y + 4}">${escapeHtml(formatCompactCurrency(tickValue))}</text>
              </g>
            `;
          }).join("")}
          ${xTicks
            .map((yearNumber) => {
              const x = xForYear(yearNumber);
              return `
                <g>
                  <line class="simulation-chart-grid-line simulation-chart-grid-line-x" x1="${x}" y1="${marginTop}" x2="${x}" y2="${height - marginBottom}"></line>
                  <text class="simulation-chart-axis-label" x="${x}" y="${height - 12}" text-anchor="middle">Year ${yearNumber}</text>
                </g>
              `;
            })
            .join("")}
          ${scenarios
            .map((scenario) => {
              const color = getSimulationPercentileColor(scenario.percentile);
              const path = scenario.rows
                .map((row, index) => {
                  const value = row[valueKey] ?? 0;
                  return `${index === 0 ? "M" : "L"} ${xForYear(row.yearNumber)} ${yForValue(value)}`;
                })
                .join(" ");
              return `
                <path
                  class="simulation-chart-line ${selectedSimulationPercentile === scenario.percentile ? "is-active" : "is-muted"}"
                  d="${path}"
                  stroke="${color}"
                  style="--series-color:${color}"
                  data-simulation-chart-percentile-select="${scenario.percentile}"
                ></path>
                ${scenario.rows
                  .map((row) => {
                    const value = row[valueKey] ?? 0;
                    return `
                      <circle
                        class="simulation-chart-point ${selectedSimulationPercentile === scenario.percentile ? "is-active" : "is-muted"}"
                        cx="${xForYear(row.yearNumber)}"
                        cy="${yForValue(value)}"
                        r="${selectedSimulationPercentile === scenario.percentile ? 6 : 5}"
                        fill="${color}"
                        style="--series-color:${color}"
                        data-simulation-chart-point="true"
                        data-simulation-chart-percentile-select="${scenario.percentile}"
                        data-simulation-chart-year="${row.yearNumber}"
                        data-simulation-chart-label="${escapeAttribute(row.label)}"
                        data-simulation-chart-value="${escapeAttribute(formatCompactCurrency(value))}"
                        data-simulation-chart-value-label="${escapeAttribute(valueLabel)}"
                        data-simulation-chart-percentile="${scenario.percentile}"
                      ></circle>
                    `
                  })
                  .join("")}
              `;
            })
            .join("")}
        </svg>
      </div>
      <div class="simulation-chart-tooltip" hidden></div>
    </section>
  `;
}

function getSelectedSimulationSweepStep(): SimulationSweepStepResult | null {
  if (!simulationSweepResults) {
    return null;
  }

  return (
    simulationSweepResults.steps[selectedSimulationSweepStepIndex] ?? simulationSweepResults.steps[0] ?? null
  );
}

function getDisplayedSimulationResults(): Map<SimulationPercentile, SimulationScenario> | null {
  return getSelectedSimulationSweepStep()?.results ?? simulationResults;
}

function getDisplayedSimulationDetailResults(): SimulationDetailScenario[] | null {
  return getSelectedSimulationSweepStep()?.details ?? simulationDetailResults;
}

function getDisplayedSimulationRunOutProbability(): number {
  const displayedSimulationResults = getDisplayedSimulationResults();
  const scenario =
    displayedSimulationResults?.get(50) ?? Array.from(displayedSimulationResults?.values() ?? [])[0] ?? null;
  const rows = scenario?.rows ?? [];
  return rows[rows.length - 1]?.depletionProbability ?? 0;
}

function isSimulationChartMetric(value: string | undefined): value is SimulationChartMetric {
  return value === "totalAssets" || value === "liquidAssets";
}

function renderSimulationSweepResults(): string {
  if (!simulationSweepResults) {
    return "";
  }

  const selectedStep = getSelectedSimulationSweepStep();
  if (!selectedStep) {
    return "";
  }

  const minimumValue = simulationSweepResults.steps[0]?.value ?? selectedStep.value;
  const maximumValue =
    simulationSweepResults.steps[simulationSweepResults.steps.length - 1]?.value ?? selectedStep.value;

  return `
    <section class="simulation-sweep-results">
      <div class="simulation-sweep-results-header">
        <div>
          <strong>Variable sweep</strong>
          <p class="helper-copy" data-simulation-sweep-summary>
            Viewing ${escapeHtml(simulationSweepResults.variableName)} at ${escapeHtml(formatEditableNumber(selectedStep.value))}.
            Sweep range: ${escapeHtml(formatEditableNumber(minimumValue))} to ${escapeHtml(formatEditableNumber(maximumValue))}
            across ${simulationSweepResults.steps.length} runs.
          </p>
        </div>
        <span class="pill" data-simulation-sweep-pill>
          ${selectedStep.index + 1} / ${simulationSweepResults.steps.length}
        </span>
      </div>
      <label class="simulation-sweep-slider-field" for="simulation-sweep-step">
        Sweep position
        <input
          id="simulation-sweep-step"
          name="simulationSweepStep"
          type="range"
          min="0"
          max="${simulationSweepResults.steps.length - 1}"
          step="1"
          value="${selectedStep.index}"
        />
      </label>
      <div class="simulation-sweep-slider-values" aria-hidden="true">
        <span>${escapeHtml(formatEditableNumber(minimumValue))}</span>
        <strong data-simulation-sweep-current-value>${escapeHtml(formatEditableNumber(selectedStep.value))}</strong>
        <span>${escapeHtml(formatEditableNumber(maximumValue))}</span>
      </div>
    </section>
  `;
}

function renderSimulationResultsBody(): string {
  const displayedSimulationResults = getDisplayedSimulationResults();
  const displayedSimulationDetails = getDisplayedSimulationDetailResults();
  const selectedScenario = displayedSimulationResults?.get(selectedSimulationPercentile) ?? null;
  const selectedDetailScenario =
    selectedScenario && displayedSimulationDetails
      ? selectRepresentativeSimulationScenario(displayedSimulationDetails, selectedScenario.rows)
      : null;
  const rows = selectedScenario?.rows ?? [];

  if (!selectedScenario || !displayedSimulationResults) {
    return "";
  }

  const selectedSimulationChart =
    selectedSimulationChartMetric === "liquidAssets"
      ? {
          title: "Liquid assets by year",
          description: "Your net worth without counting the value of your home",
          ariaLabel: "Simulation liquid assets by year and percentile",
          valueKey: "liquidAssets" as const,
          valueLabel: "Liquid assets",
        }
      : {
          title: "Total assets by year",
          description: "Total value of all assets, including your home",
          ariaLabel: "Simulation total assets by year and percentile",
          valueKey: "totalAssets" as const,
          valueLabel: "Total assets",
        };

  return `
      ${renderSimulationChart(displayedSimulationResults, selectedSimulationChart)}
      ${SHOW_SIMULATION_EXAMPLE_CARD ? `
      <section class="simulation-example-card">
        <div class="simulation-example-card-controls">
          <div>
            <strong>${selectedSimulationPercentile}th percentile example</strong>
          </div>
          <div class="simulation-actions simulation-results-actions">
            <button
              type="button"
              class="secondary-button"
              data-export-simulation-example="${selectedSimulationPercentile}"
              ${selectedDetailScenario ? "" : "disabled"}
            >
              Export example
            </button>
          </div>
        </div>
        <p class="helper-copy">See an example scenario for the selected percentile. For illustrative purposes only.</p>
        <div class="board-scroll simulation-results">
          <table class="flow-table">
            <thead>
              <tr>
                <th>Year</th>
                <th>${selectedSimulationPercentile}th percentile assets</th>
                <th>Depleted by year</th>
                <th>Example</th>
              </tr>
            </thead>
            <tbody>
              ${rows
                .map((row) => {
                  const expandedKey = `${selectedSimulationPercentile}:${row.yearNumber}`;
                  const isExpanded = expandedSimulationExampleKeys.has(expandedKey);
                  const exampleYear =
                    isExpanded
                      ? getExampleSimulationYear(selectedDetailScenario, row.yearNumber)
                      : null;

                  return `
                    <tr>
                      <th>${escapeHtml(row.label)}</th>
                      <td>${formatCurrency(row.totalAssets)}</td>
                      <td>${formatPercentage(row.depletionProbability)}</td>
                      <td>
                        <button
                          type="button"
                          class="link-button simulation-year-button"
                          data-toggle-simulation-example="${expandedKey}"
                        >
                          ${isExpanded ? "Hide example" : "Show example"}
                        </button>
                      </td>
                    </tr>
                    ${
                      isExpanded
                        ? `
                    <tr class="simulation-detail-row">
                      <td colspan="4">
                        ${
                          exampleYear
                            ? renderSimulationExampleYear(exampleYear)
                            : `<div class="simulation-detail-panel"><p class="helper-copy">No example year was available for this percentile row.</p></div>`
                        }
                      </td>
                    </tr>
                        `
                        : ""
                    }
                  `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
      ` : ""}
  `;
}

function getSimulationInflationSummary(): string {
  if (simulationDraft.inflationPreset === "fixed") {
    return "Fixed 2.5%";
  }

  if (simulationDraft.inflationPreset === "fixed-custom") {
    return `Fixed ${formatEditableNumber(parseEditableNumber(simulationDraft.fixedInflationRate))}%`;
  }

  if (simulationDraft.inflationPreset === "regime") {
    return "Default";
  }

  return `Regime low ${formatEditableNumber(parseEditableNumber(simulationDraft.regimeSwitchingInflation.lowAverageRate))}% +/- ${formatEditableNumber(parseEditableNumber(simulationDraft.regimeSwitchingInflation.lowVolatility))}%, high ${formatEditableNumber(parseEditableNumber(simulationDraft.regimeSwitchingInflation.highAverageRate))}% +/- ${formatEditableNumber(parseEditableNumber(simulationDraft.regimeSwitchingInflation.highVolatility))}%, ${formatEditableNumber(parseEditableNumber(simulationDraft.regimeSwitchingInflation.stayLowProbability))}%/${formatEditableNumber(parseEditableNumber(simulationDraft.regimeSwitchingInflation.stayHighProbability))}%`;
}

function getSimulationTaxPresetLabel(): string {
  if (simulationDraft.taxPreset === "custom") {
    return "Custom";
  }

  if (simulationDraft.taxPreset === "nyc") {
    return "NYC 2026";
  }

  return getBuiltInTaxPresetOptions().find((preset) => preset.id === simulationDraft.taxPreset)?.label ?? "State 2026";
}

function getSimulationTaxPresetSummary(): string {
  if (simulationDraft.taxPreset === "custom") {
    return getTaxScheduleSummary(
      "Custom",
      plannerState.taxes,
      taxProfileDraft.stateTaxName,
      taxProfileDraft.stateCapitalGainsTaxName,
      taxProfileDraft.localTaxName,
      parseEditableNumber(taxProfileDraft.stateTaxableIncomeAdjustment)
    );
  }

  const preset = createBuiltInTaxPresetDefinition(simulationDraft.taxPreset, plannerState.taxProfile.filingStatus);
  return getTaxScheduleSummary(
    getSimulationTaxPresetLabel(),
    preset.taxes,
    preset.profile.stateTaxName,
    preset.profile.stateCapitalGainsTaxName,
    preset.profile.localTaxName,
    preset.profile.stateTaxableIncomeAdjustment
  );
}

function getSimulationHeadlineAmount(): string {
  const scenario = getDisplayedSimulationResults()?.get(selectedSimulationPercentile) ?? null;
  const targetRow = scenario?.rows.find((row) => row.yearNumber === simulationDraft.horizonYears) ?? scenario?.rows.at(-1) ?? null;
  return targetRow ? formatCurrency(targetRow.totalAssets) : "$xxx,xxx";
}

function renderSimulationTargetAgeOptions(): string {
  const minimumTargetAge = Math.max(MIN_SIMULATION_TARGET_AGE, simulationDraft.currentAge + 1);
  return Array.from(
    { length: MAX_SIMULATION_TARGET_AGE - minimumTargetAge + 1 },
    (_, index) => minimumTargetAge + index
  )
    .map(
      (age) => `
        <option value="${age}" ${getSimulationTargetAge() === age ? "selected" : ""}>${age}</option>
      `
    )
    .join("");
}

function renderSimulationHeadline(): string {
  return `
    <section class="simulation-forecast-header" aria-labelledby="simulation-forecast-heading">
      <h2 id="simulation-forecast-heading">
        There's a
        <span class="simulation-inline-select-wrap">
          <select class="simulation-inline-select" data-simulation-percentile-select aria-label="Simulation percentile">
            ${simulationPercentiles
              .map(
                (percentile) => `
                  <option value="${percentile}" ${selectedSimulationPercentile === percentile ? "selected" : ""}>
                    ${percentile}%
                  </option>
                `
              )
              .join("")}
          </select>
        </span>
        chance that you'll have ${escapeHtml(getSimulationHeadlineAmount())} when you are
        <span class="simulation-inline-select-wrap">
          <select class="simulation-inline-select" data-simulation-target-age aria-label="Target age">
            ${renderSimulationTargetAgeOptions()}
          </select>
        </span>
        years old.
      </h2>
    </section>
  `;
}

function getTaxScheduleSummary(
  label: string,
  taxes: readonly TaxDefinition[],
  stateTaxName: string,
  stateCapitalGainsTaxName: string,
  localTaxName: string,
  stateAdjustment: number
): string {
  const stateTax = taxes.find((tax) => tax.name === stateTaxName);
  const stateCapitalGainsTax = taxes.find((tax) => tax.name === stateCapitalGainsTaxName);
  const localTax = taxes.find((tax) => tax.name === localTaxName);
  const parts: string[] = [];

  if (stateTax) {
    parts.push(`State ${formatTaxRateRange(stateTax.taxRates)}`);
  } else {
    parts.push("No state wage income tax");
  }

  if (stateCapitalGainsTax) {
    parts.push(`LTCG ${formatTaxRateRange(stateCapitalGainsTax.taxRates)}`);
  } else {
    parts.push("no state LTCG tax");
  }

  if (localTax) {
    parts.push(`local ${formatTaxRateRange(localTax.taxRates)}`);
  }

  if (stateTax && stateAdjustment > 0) {
    parts.push(`${formatCurrency(stateAdjustment)} deduction/exemption`);
  }

  return `${label}: ${parts.join("; ")}`;
}

function formatTaxRateRange(taxRates: readonly TaxRateDefinition[]): string {
  if (taxRates.length === 0) {
    return "none";
  }

  const rates = taxRates.map((taxRate) => taxRate.rate * 100);
  const minRate = Math.min(...rates);
  const maxRate = Math.max(...rates);
  if (Math.abs(minRate - maxRate) < 0.000001) {
    return formatPercentage(maxRate);
  }

  return `${formatPercentage(minRate)}-${formatPercentage(maxRate)}`;
}

function renderDisclosureIcon(expanded: boolean): string {
  return `
    <svg viewBox="0 0 16 16" aria-hidden="true" class="disclosure-icon${expanded ? " is-expanded" : ""}">
      <path d="M5 3.5 10 8l-5 4.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" />
    </svg>
  `;
}

function renderSimulationRunControl({ showProgress = true }: { showProgress?: boolean } = {}): string {
  const simulationSubmitState = getSimulationSubmitState();
  const isSimulationRunning = simulationRunState !== null && simulationRunState.errorMessage === null;
  const buttonLabel = isSimulationRunning
    ? "Simulating..."
    : hasDisplayedSimulationResults()
      ? "Regenerate results"
      : "Run simulation";

  return `
    <div class="simulation-run-control">
      ${showProgress && simulationRunState ? renderSimulationProgress() : ""}
      <span id="simulation-run-wrapper" title="${escapeAttribute(simulationSubmitState.reason)}">
        <button
          id="simulation-run-button"
          type="submit"
          form="simulation-form"
          ${simulationSubmitState.disabled || isSimulationRunning ? "disabled" : ""}
        >
          ${buttonLabel}
        </button>
      </span>
    </div>
  `;
}

function renderSimulationProgress(): string {
  if (!simulationRunState) {
    return "";
  }

  const simulationProgressPercent = Math.max(
    0,
    Math.min(100, (simulationRunState.completedAttempts / Math.max(1, simulationRunState.totalAttempts)) * 100)
  );

  return `
    <div class="simulation-progress" role="status" aria-live="polite">
      <div
        class="simulation-progress-track${simulationRunState.errorMessage ? " is-error" : ""}"
        aria-hidden="true"
      >
        <span style="width:${simulationRunState.errorMessage ? 100 : simulationProgressPercent}%"></span>
      </div>
      <span class="summary-meta">
        ${
          simulationRunState.errorMessage
            ? escapeHtml(simulationRunState.errorMessage)
            : `${simulationRunState.totalSweepSteps > 1 ? `${simulationRunState.completedSweepSteps.toLocaleString("en-US")} of ${simulationRunState.totalSweepSteps.toLocaleString("en-US")} sweep values complete. ` : ""}${simulationRunState.completedAttempts.toLocaleString("en-US")} of ${simulationRunState.totalAttempts.toLocaleString("en-US")} attempts across ${simulationRunState.workerCount.toLocaleString("en-US")} worker${simulationRunState.workerCount === 1 ? "" : "s"}`
        }
      </span>
    </div>
  `;
}

function renderSimulationBoard(): string {
  return `
    <div class="simulation-panel">
      ${renderSimulationHeadline()}

      ${
        getDisplayedSimulationResults()
          ? `
      <section class="simulation-results-section${simulationResultsStale ? " is-stale" : ""}" aria-label="Simulation results">
        <div class="simulation-stale-banner" data-simulation-stale-banner ${simulationResultsStale ? "" : "hidden"}>
          <p>These results are based on older inputs.</p>
          ${renderSimulationRunControl()}
        </div>
        <div id="simulation-results-panel">${renderSimulationResultsBody()}</div>
        ${renderSimulationSweepResults()}
      </section>
          `
          : `
      <section class="simulation-empty-results">
        ${
          simulationRunState
            ? renderSimulationProgress()
            : `<p class="helper-copy">Run a simulation to see the percentile graph.</p>`
        }
        ${renderSimulationRunControl({ showProgress: false })}
      </section>
          `
      }

      ${
        !hasSimulationEntries()
          ? `
      <form id="simulation-form" class="stack-form">
        <section class="simulation-section">
          <div class="simulation-section-header">
            <div>
              <h3>Scenario entries</h3>
            </div>
          </div>
          <p class="helper-copy">Create at least one income, expense, or asset to run a simulation.</p>
        </section>
      </form>
            `
          : `<form id="simulation-form" class="stack-form" hidden></form>`
      }

      ${renderVariablesCard()}
    </div>
  `;
}

function syncSimulationSweepSelectionDisplay(): void {
  const selectedStep = getSelectedSimulationSweepStep();
  if (!simulationSweepResults || !selectedStep) {
    return;
  }

  const minimumValue = simulationSweepResults.steps[0]?.value ?? selectedStep.value;
  const maximumValue =
    simulationSweepResults.steps[simulationSweepResults.steps.length - 1]?.value ?? selectedStep.value;
  const summary = document.querySelector<HTMLElement>("[data-simulation-sweep-summary]");
  const pill = document.querySelector<HTMLElement>("[data-simulation-sweep-pill]");
  const currentValue = document.querySelector<HTMLElement>("[data-simulation-sweep-current-value]");

  if (summary) {
    summary.textContent = `Viewing ${simulationSweepResults.variableName} at ${formatEditableNumber(selectedStep.value)}. Sweep range: ${formatEditableNumber(minimumValue)} to ${formatEditableNumber(maximumValue)} across ${simulationSweepResults.steps.length} runs.`;
  }

  if (pill) {
    pill.textContent = `${selectedStep.index + 1} / ${simulationSweepResults.steps.length}`;
  }

  if (currentValue) {
    currentValue.textContent = formatEditableNumber(selectedStep.value);
  }
}

function bindSimulationResultsControls(user: UserIdentity): void {
  for (const target of document.querySelectorAll<SVGElement>("[data-simulation-chart-percentile-select]")) {
    target.addEventListener("click", () => {
      const percentile = Number(target.dataset.simulationChartPercentileSelect) as SimulationPercentile;
      if (!simulationPercentiles.includes(percentile) || !getDisplayedSimulationResults()?.has(percentile)) {
        return;
      }

      selectedSimulationPercentile = percentile;
      expandedSimulationExampleKeys = new Set();
      renderPlanner(user);
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-simulation-chart-metric]")) {
    button.addEventListener("click", () => {
      const metric = button.dataset.simulationChartMetric;
      if (!isSimulationChartMetric(metric)) {
        return;
      }

      selectedSimulationChartMetric = metric;
      renderPlanner(user);
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-toggle-simulation-example]")) {
    button.addEventListener("click", () => {
      const key = button.dataset.toggleSimulationExample;
      if (!key) {
        return;
      }

      if (expandedSimulationExampleKeys.has(key)) {
        expandedSimulationExampleKeys.delete(key);
      } else {
        expandedSimulationExampleKeys.add(key);
      }

      renderPlanner(user);
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-export-simulation-example]")) {
    button.addEventListener("click", () => {
      const percentile = Number(button.dataset.exportSimulationExample) as SimulationPercentile;
      const displayedSimulationResults = getDisplayedSimulationResults();
      const displayedSimulationDetails = getDisplayedSimulationDetailResults();
      const scenario = displayedSimulationResults?.get(percentile) ?? null;
      const detailScenario =
        scenario && displayedSimulationDetails
          ? selectRepresentativeSimulationScenario(displayedSimulationDetails, scenario.rows)
          : null;

      if (!scenario || !detailScenario) {
        return;
      }

      downloadSimulationExampleExport(percentile, scenario, detailScenario);
    });
  }
}

function refreshSimulationResultsPanel(user: UserIdentity): void {
  const resultsPanel = document.querySelector<HTMLElement>("#simulation-results-panel");
  if (!resultsPanel) {
    return;
  }

  resultsPanel.innerHTML = renderSimulationResultsBody();
  bindSimulationResultsControls(user);
  bindSimulationChartTooltip();
}

function syncSimulationSubmitState(): void {
  const submitButton = document.querySelector<HTMLButtonElement>("#simulation-run-button");
  const submitWrapper = document.querySelector<HTMLElement>("#simulation-run-wrapper");
  if (!submitButton || !submitWrapper) {
    return;
  }

  const state = getSimulationSubmitState();
  submitButton.disabled = state.disabled;
  submitWrapper.title = state.reason;
}

function syncSimulationStalePresentation(): void {
  const resultsSection = document.querySelector<HTMLElement>(".simulation-results-section");
  const staleBanner = document.querySelector<HTMLElement>("[data-simulation-stale-banner]");
  const depletionSummary = document.querySelector<HTMLElement>("[data-simulation-depletion-summary]");

  resultsSection?.classList.toggle("is-stale", simulationResultsStale);
  if (staleBanner) {
    staleBanner.hidden = !simulationResultsStale;
  }
  if (depletionSummary) {
    depletionSummary.hidden = simulationResultsStale;
  }
}

function bindSimulationChartTooltip(): void {
  for (const panel of document.querySelectorAll<HTMLElement>(".simulation-chart-panel")) {
    const tooltip = panel.querySelector<HTMLDivElement>(".simulation-chart-tooltip");
    if (!tooltip) {
      continue;
    }

    const hideTooltip = () => {
      tooltip.hidden = true;
    };
    const setSeriesHover = (percentile: string | undefined, hovered: boolean): void => {
      if (!percentile) {
        return;
      }

      for (const target of panel.querySelectorAll<SVGElement>(
        `[data-simulation-chart-percentile-select="${CSS.escape(percentile)}"]`
      )) {
        target.classList.toggle("is-series-hovered", hovered);
      }
    };

    const updateTooltipPosition = (event: MouseEvent) => {
      const panelRect = panel.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const tooltipOffset = 14;
      const edgePadding = 10;
      const rawX = event.clientX - panelRect.left + tooltipOffset;
      const rawY = event.clientY - panelRect.top - tooltipRect.height - tooltipOffset;
      const belowY = event.clientY - panelRect.top + tooltipOffset;
      const maxX = Math.max(edgePadding, panelRect.width - tooltipRect.width - edgePadding);
      const maxY = Math.max(edgePadding, panelRect.height - tooltipRect.height - edgePadding);
      const clampedX = Math.min(Math.max(rawX, edgePadding), maxX);
      const clampedY = Math.min(Math.max(rawY >= edgePadding ? rawY : belowY, edgePadding), maxY);
      tooltip.style.left = `${clampedX}px`;
      tooltip.style.top = `${clampedY}px`;
    };

    for (const point of panel.querySelectorAll<SVGCircleElement>("[data-simulation-chart-point]")) {
      point.addEventListener("mouseenter", (event) => {
        setSeriesHover(point.dataset.simulationChartPercentile, true);
        tooltip.textContent = `${point.dataset.simulationChartLabel} | ${point.dataset.simulationChartValueLabel}: ${point.dataset.simulationChartValue} | ${point.dataset.simulationChartPercentile}th percentile`;
        tooltip.hidden = false;
        updateTooltipPosition(event);
      });
      point.addEventListener("mousemove", updateTooltipPosition);
      point.addEventListener("mouseleave", () => {
        setSeriesHover(point.dataset.simulationChartPercentile, false);
        hideTooltip();
      });
    }

    for (const line of panel.querySelectorAll<SVGPathElement>(".simulation-chart-line")) {
      line.addEventListener("mouseenter", () => {
        setSeriesHover(line.dataset.simulationChartPercentileSelect, true);
      });
      line.addEventListener("mouseleave", () => {
        setSeriesHover(line.dataset.simulationChartPercentileSelect, false);
      });
    }

    panel.addEventListener("mouseleave", hideTooltip);
  }
}

function renderAssetComposer(): string {
  if (!assetComposerOpen) {
    return "";
  }

  return `
    <div class="modal-shell">
      <section class="panel modal-panel asset-panel">
        <div class="modal-header">
          <div class="panel-heading">
            <p class="kicker">Create Asset</p>
            <h2>New asset</h2>
          </div>
        </div>
        <form id="asset-form" class="stack-form">
          <label>
            Asset name
            <input name="assetLabel" type="text" value="${escapeHtml(assetDraft.name)}" placeholder="Brokerage account, 401k, etc." required />
          </label>
          <label>
            Asset type
            <select name="kind">
              ${renderAssetTypeOptions(assetDraft.kind)}
            </select>
          </label>
          ${renderAssetDetailModeFields(assetDraft)}
          ${renderAssetAdvancedSettingsToggle(assetDraft)}
          ${renderAssetAdvancedSettingsFields(assetDraft)}
          <div class="event-buttons">
            <button type="button" class="secondary-button" id="close-asset-composer-secondary">Cancel</button>
            <button type="submit">Save asset</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderAssetEditor(): string {
  if (!assetEditorOpen) {
    return "";
  }

  const relatedAssets = plannerState.assets.filter((asset) => asset.name !== assetEditDraft.originalName);

  return `
    <div class="modal-shell">
      <section class="panel modal-panel asset-panel">
        <div class="modal-header">
          <div class="panel-heading">
            <p class="kicker">Edit Asset</p>
            <h2>${escapeHtml(assetEditDraft.originalName)}</h2>
          </div>
          <button
            type="button"
            class="ghost-button icon-button"
            id="delete-asset-from-editor"
            aria-label="Delete asset"
            title="Delete asset"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M9 3h6m-9 4h12m-1 0-.7 11.2a2 2 0 0 1-2 1.8H9.4a2 2 0 0 1-2-1.8L6.7 7m3 4v5m4-5v5"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.8"
              />
            </svg>
          </button>
        </div>
        <form id="asset-edit-form" class="stack-form">
          <label>
            Asset name
            <input name="assetLabel" type="text" value="${escapeHtml(assetEditDraft.name)}" required />
          </label>
          <label>
            Asset type
            <select name="kind">
              ${renderAssetTypeOptions(assetEditDraft.kind)}
            </select>
          </label>
          ${renderAssetDetailModeFields(assetEditDraft)}
          ${renderAssetAdvancedSettingsToggle(assetEditDraft)}
          ${renderAssetAdvancedSettingsFields(assetEditDraft)}
          ${renderAssetCorrelationFields(relatedAssets)}
          <div class="event-buttons">
            <button type="button" class="secondary-button" id="close-asset-editor">Cancel</button>
            <button type="submit">Save asset</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderAssetCorrelationFields(relatedAssets: readonly AssetDefinition[]): string {
  if (assetEditDraft.kind !== "home" && assetEditDraft.detailMode !== "advanced") {
    return "";
  }

  return `
    <section class="composer-subsection">
      <div class="event-entry-header">
        <strong>Correlation</strong>
        <span class="summary-meta">-1 to 1 annual return correlation</span>
      </div>
      ${
        relatedAssets.length === 0
          ? `<p class="helper-copy">Create another asset to define pairwise correlations.</p>`
          : `
      <div class="board-scroll">
        <table class="flow-table correlation-table">
          <thead>
            <tr>
              <th>Other asset</th>
              <th>Correlation</th>
            </tr>
          </thead>
          <tbody>
            ${relatedAssets
              .map(
                (asset) => `
                  <tr>
                    <th>${escapeHtml(asset.name)}</th>
                    <td>
                      <input
                        type="number"
                        min="-1"
                        max="1"
                        step="0.01"
                        data-asset-correlation="${escapeAttribute(asset.name)}"
                        value="${escapeHtml(assetEditDraft.correlations[asset.name] ?? "0")}"
                      />
                    </td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
          `
      }
    </section>
  `;
}

function renderAssetAdvancedSettingsToggle(draft: AssetDraft): string {
  if (draft.kind === "home") {
    return "";
  }

  return `
    <div class="asset-toggle-row asset-advanced-toggle-row">
      <label class="switch-field asset-toggle-switch" aria-label="Show advanced settings">
        <input
          type="checkbox"
          name="advancedSettingsEnabled"
          ${draft.detailMode === "advanced" ? "checked" : ""}
        />
        <span class="switch-track" aria-hidden="true"></span>
      </label>
      <div class="asset-toggle-copy">
        <strong>Show advanced settings</strong>
      </div>
    </div>
  `;
}

function renderAssetDetailModeFields(draft: AssetDraft): string {
  if (draft.kind === "home") {
    return renderHomeAssetFields(draft);
  }

  return `
    ${renderAssetCoreFields(draft)}
  `;
}

function renderAssetAdvancedSettingsFields(draft: AssetDraft): string {
  if (draft.kind === "home" || draft.detailMode !== "advanced") {
    return "";
  }

  return `
    ${isBondAssetDraftKind(draft.kind) ? renderBondInterestFields(draft) : renderInvestmentReturnFields(draft)}
    ${isBondAssetDraftKind(draft.kind) ? renderAssetSaleTaxFields(draft) : renderAssetTaxModelFields(draft)}
  `;
}

function renderHomeAssetFields(draft: AssetDraft): string {
  return `
    <section class="composer-subsection asset-form-section">
      <div class="event-entry-header">
        <strong>Value and upkeep</strong>
      </div>
      <div class="split-fields">
        <label>
          Home price
          ${renderFormulaEditor({
            inputName: "initialCost",
            value: draft.initialCost,
            placeholder: "salary * 4",
            variablesScope: "planner",
            type: "money",
          })}
        </label>
        <label>
          Purchase year
          <input name="purchaseYear" type="number" step="1" value="${escapeHtml(draft.purchaseYear)}" required />
        </label>
      </div>
      <div class="split-fields">
        <label>
          Property tax rate (%)
          <input name="propertyTaxRate" type="number" step="0.01" value="${escapeHtml(draft.propertyTaxRate)}" required />
        </label>
        <label>
          Other monthly $
          <input
            name="monthlyNonTaxCosts"
            ${renderEditableNumberInputAttributes()}
            value="${escapeHtml(formatEditableNumberInput(draft.monthlyNonTaxCosts))}"
            required
          />
        </label>
      </div>
    </section>
    <section class="composer-subsection asset-form-section">
      <div class="event-entry-header">
        <strong>Mortgage</strong>
      </div>
      <div class="split-fields">
        <label>
          Mortgage type
          <select name="mortgageType">
            <option value="amortizing" ${draft.mortgageType === "amortizing" ? "selected" : ""}>Amortizing</option>
            <option value="interest-only" ${draft.mortgageType === "interest-only" ? "selected" : ""}>Interest-only</option>
          </select>
        </label>
        ${
          draft.mortgageType === "interest-only"
            ? `
        <label>
          IO maturity action
          <select name="interestOnlyMaturityAction">
            <option value="payoff" ${draft.interestOnlyMaturityAction === "payoff" ? "selected" : ""}>Force payoff</option>
            <option value="refinance" ${draft.interestOnlyMaturityAction === "refinance" ? "selected" : ""}>Auto refinance</option>
            <option value="sell" ${draft.interestOnlyMaturityAction === "sell" ? "selected" : ""}>Auto sale</option>
          </select>
        </label>
        `
            : ""
        }
        <label>
          Mortgage rate (%)
          <input name="mortgageRate" type="number" step="0.01" value="${escapeHtml(draft.mortgageRate)}" required />
        </label>
        <label>
          Mortgage term (years)
          <input name="mortgageTermYears" type="number" step="1" value="${escapeHtml(draft.mortgageTermYears)}" required />
        </label>
        <label>
          Down payment %
          <input name="cashPurchasePercent" type="number" step="0.01" value="${escapeHtml(draft.cashPurchasePercent)}" required />
        </label>
      </div>
      <div class="split-fields">
        <label>
          Closing costs (%)
          <input name="closingCostPercent" type="number" step="0.01" value="${escapeHtml(draft.closingCostPercent)}" required />
        </label>
      </div>
    </section>
    <section class="composer-subsection asset-form-section">
      <div class="event-entry-header">
        <strong>Appreciation</strong>
      </div>
      ${renderAssetReturnFields(draft)}
    </section>
  `;
}

function renderAssetCoreFields(draft: AssetDraft): string {
  return `
    <label>
      Current value
      ${renderFormulaEditor({
        inputName: "startingValue",
        value: draft.startingValue,
        placeholder: "$0",
        variablesScope: "planner",
        type: "money",
      })}
    </label>
  `;
}

function getPrimaryBondCashGenerationDraft(draft: AssetDraft): AssetCashGenerationDraft {
  if (!isBondAssetDraftKind(draft.kind)) {
    throw new Error(`Basic bond fields require a bond asset draft.`);
  }

  draft.cashGenerationEnabled = true;

  if (draft.cashGenerations.length === 0) {
    const preset = getAssetTypePreset(draft.kind);
    const presetCashGeneration = preset?.cashGenerations[0];
    draft.cashGenerations = [
      presetCashGeneration
        ? createAssetCashGenerationDraftFromPreset(presetCashGeneration)
        : createAssetCashGenerationDraft(draft.kind, { expanded: true }),
    ];
  }

  return draft.cashGenerations[0];
}

function renderBondInterestFields(draft: AssetDraft): string {
  const cashGeneration = getPrimaryBondCashGenerationDraft(draft);

  return `
    <section class="composer-subsection asset-form-section">
      <div class="event-entry-header">
        <strong>Interest and volatility</strong>
      </div>
      <div class="split-fields">
        <label>
          Interest rate (%)
          <input
            name="assetBasicBondInterestRate"
            data-cash-generation-field="${cashGeneration.id}:rate"
            type="number"
            step="0.01"
            value="${escapeHtml(cashGeneration.rate)}"
            required
          />
        </label>
        <label>
          Volatility (%)
          <input
            name="assetBasicBondVolatility"
            data-cash-generation-field="${cashGeneration.id}:volatility"
            type="number"
            step="0.01"
            value="${escapeHtml(cashGeneration.volatility)}"
            required
          />
        </label>
        <label>
          Interest tax treatment
          <select name="assetBasicBondTaxTreatment" data-cash-generation-field="${cashGeneration.id}:taxTreatment">
            ${renderAssetCashTaxTreatmentOptions(cashGeneration.taxTreatment)}
          </select>
        </label>
      </div>
    </section>
  `;
}

function renderInvestmentReturnFields(draft: AssetDraft): string {
  return `
    <section class="composer-subsection asset-form-section">
      <div class="event-entry-header">
        <strong>Returns and volatility</strong>
      </div>
      ${renderAssetReturnFields(draft)}
    </section>
  `;
}

function renderAssetReturnFields(draft: AssetDraft): string {
  return `
    <div class="split-fields">
      <label>
        Expected return (%)
        <input
          name="expectedReturn"
          type="number"
          step="0.01"
          value="${escapeHtml(draft.expectedReturn)}"
          required
        />
      </label>
      <label>
        Volatility (%)
        <input
          name="volatility"
          type="number"
          step="0.01"
          value="${escapeHtml(draft.volatility)}"
          required
        />
      </label>
    </div>
  `;
}

function getAssetSaleTaxTreatmentLabel(treatment: AssetSaleTaxTreatment): string {
  switch (treatment) {
    case "short-term-capital-gains":
      return "Short-term capital gains";
    case "not-taxable":
      return "Not taxable";
    case "long-term-capital-gains":
    default:
      return "Long-term capital gains";
  }
}

function renderAssetSaleTaxDraftPreview(draft: AssetDraft): string {
  const costBasis = draft.saleTaxCostBasis.trim();
  const basisLabel = costBasis ? `basis ${costBasis}` : "basis not set";
  return `${getAssetSaleTaxTreatmentLabel(draft.saleTaxTreatment)}, ${basisLabel}`;
}

function renderAssetSaleTaxFields(draft: AssetDraft): string {
  const bodyId = "asset-sale-tax-body";

  return `
    <section class="composer-subsection">
      <div class="asset-toggle-row">
        <div class="asset-toggle-leading">
          ${
            draft.saleTaxEnabled
              ? `
          <button
            type="button"
            class="ghost-button icon-button disclosure-button"
            data-toggle-sale-tax="true"
            aria-label="${draft.saleTaxExpanded ? "Collapse tax when selling" : "Expand tax when selling"}"
            aria-expanded="${draft.saleTaxExpanded ? "true" : "false"}"
            aria-controls="${bodyId}"
          >
            ${renderDisclosureIcon(draft.saleTaxExpanded)}
          </button>
              `
              : ""
          }
          <div class="asset-toggle-copy">
            <strong>Tax when selling</strong>
            <span class="summary-meta">
              ${
                draft.saleTaxEnabled
                  ? escapeHtml(renderAssetSaleTaxDraftPreview(draft))
                  : "For realized capital gains or other taxable sale events"
              }
            </span>
          </div>
        </div>
        <div class="asset-toggle-actions">
          <label class="switch-field asset-toggle-switch" aria-label="Enable tax on selling for cash">
            <input type="checkbox" name="saleTaxEnabled" ${draft.saleTaxEnabled ? "checked" : ""} />
            <span class="switch-track" aria-hidden="true"></span>
          </label>
        </div>
      </div>
      ${
        draft.saleTaxEnabled
          ? `
        <div id="${bodyId}" class="asset-sale-tax-body" ${draft.saleTaxExpanded ? "" : "hidden"}>
          <label>
            Starting cost basis
            <input
              name="saleTaxCostBasis"
              ${renderEditableNumberInputAttributes()}
              value="${escapeHtml(formatEditableNumberInput(draft.saleTaxCostBasis))}"
            />
          </label>
          <label>
            Realized gain tax treatment
            <select name="saleTaxTreatment">
              <option value="short-term-capital-gains" ${draft.saleTaxTreatment === "short-term-capital-gains" ? "selected" : ""}>Short-term capital gains</option>
              <option value="long-term-capital-gains" ${draft.saleTaxTreatment === "long-term-capital-gains" ? "selected" : ""}>Long-term capital gains</option>
              <option value="not-taxable" ${draft.saleTaxTreatment === "not-taxable" ? "selected" : ""}>Not taxable</option>
            </select>
          </label>
        </div>
          `
          : ""
      }
    </section>
  `;
}

function renderAssetTaxModelFields(draft: AssetDraft): string {
  if (draft.kind === "home") {
    return "";
  }

  return `
    <section class="composer-subsection">
      <div class="asset-toggle-row">
        <div class="asset-toggle-copy">
          <strong>Cash generation</strong>
          <span class="summary-meta">For dividends, bond income, distributions, or rent-like cash yield</span>
        </div>
        <label class="switch-field asset-toggle-switch" aria-label="Enable cash generation">
          <input type="checkbox" name="cashGenerationEnabled" ${draft.cashGenerationEnabled ? "checked" : ""} />
          <span class="switch-track" aria-hidden="true"></span>
        </label>
      </div>
      ${
        draft.cashGenerationEnabled
          ? `
        <div class="stack-list">
          ${draft.cashGenerations
            .map(
              (cashGeneration) => `
                <section class="composer-subsection cash-generation-entry" data-cash-generation-entry="${cashGeneration.id}">
                  <div class="event-entry-header cash-generation-entry-header">
                    <button
                      type="button"
                      class="cash-generation-toggle"
                      data-toggle-cash-generation="${cashGeneration.id}"
                      aria-expanded="${cashGeneration.expanded ? "true" : "false"}"
                      aria-controls="cash-generation-body-${cashGeneration.id}"
                    >
                      <span class="cash-generation-toggle-icon ${cashGeneration.expanded ? "is-expanded" : ""}" aria-hidden="true">
                        <svg viewBox="0 0 20 20">
                          <path d="M6 4l8 6-8 6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" />
                        </svg>
                      </span>
                      <span class="cash-generation-toggle-copy">
                        <strong data-cash-generation-title="${cashGeneration.id}">${escapeHtml(getAssetCashGenerationDisplayName(cashGeneration))}</strong>
                        <span
                          class="summary-meta cash-generation-preview"
                          data-cash-generation-preview="${cashGeneration.id}"
                          ${cashGeneration.expanded ? "hidden" : ""}
                        >
                          ${escapeHtml(renderAssetCashGenerationDraftPreview(cashGeneration))}
                        </span>
                      </span>
                    </button>
                    ${
                      draft.cashGenerations.length > 1
                        ? `<button type="button" class="secondary-button" data-remove-cash-generation="${cashGeneration.id}">Remove</button>`
                        : ""
                    }
                  </div>
                  <div
                    id="cash-generation-body-${cashGeneration.id}"
                    class="cash-generation-body"
                    ${cashGeneration.expanded ? "" : "hidden"}
                  >
                    <label>
                      Stream name
                      <input name="cashGenerationName" data-cash-generation-field="${cashGeneration.id}:name" type="text" value="${escapeHtml(cashGeneration.name)}" placeholder="Qualified dividends" />
                    </label>
                    <div class="split-fields">
                      <label>
                        Cash generation rate (%)
                        <input name="cashGenerationRate" data-cash-generation-field="${cashGeneration.id}:rate" type="number" step="0.01" value="${escapeHtml(cashGeneration.rate)}" />
                      </label>
                      <label>
                        Cash generation volatility (%)
                        <input name="cashGenerationVolatility" data-cash-generation-field="${cashGeneration.id}:volatility" type="number" step="0.01" value="${escapeHtml(cashGeneration.volatility)}" />
                      </label>
                      <label>
                        Inflation correlation (YoY delta)
                        <input name="cashGenerationInflationCorrelation" data-cash-generation-field="${cashGeneration.id}:inflationCorrelation" type="number" step="0.01" value="${escapeHtml(cashGeneration.inflationCorrelation)}" />
                      </label>
                    </div>
                    <label>
                      Cash generation tax treatment
                      <select name="cashGenerationTaxTreatment" data-cash-generation-field="${cashGeneration.id}:taxTreatment">
                        ${renderAssetCashTaxTreatmentOptions(cashGeneration.taxTreatment)}
                      </select>
                    </label>
                  </div>
                </section>
              `
            )
            .join("")}
          <div class="event-buttons">
            <button type="button" class="secondary-button" id="add-cash-generation">Add cash stream</button>
          </div>
        </div>
          `
          : ""
      }
    </section>
    ${renderAssetSaleTaxFields(draft)}
  `;
}

function renderTaxComposer(): string {
  if (!taxComposerOpen) {
    return "";
  }

  const isEditing = Boolean(taxDraft.originalName);

  return `
    <div class="modal-shell">
      <section class="panel modal-panel">
        <div class="modal-header">
          <div class="panel-heading">
            <p class="kicker">${isEditing ? "Edit Tax" : "Create Tax"}</p>
            <h2>${isEditing ? escapeHtml(taxDraft.originalName ?? "") : "Graduated tax model"}</h2>
          </div>
          <button
            type="button"
            class="ghost-button ${isEditing ? "icon-button" : ""}"
            id="${isEditing ? "delete-tax-from-editor" : "close-tax-composer"}"
          >
            ${isEditing ? "Delete" : "Close"}
          </button>
        </div>
        <form id="tax-form" class="stack-form">
          <label>
            Tax model name
            <input name="taxLabel" type="text" value="${escapeHtml(taxDraft.name)}" placeholder="Qualified dividends" required />
          </label>
          <label>
            Maximum tax
            <input
              name="maximum"
              ${renderEditableNumberInputAttributes({ allowEmpty: true })}
              value="${escapeHtml(formatEditableNumberInput(taxDraft.maximum))}"
              placeholder="Optional cap"
            />
          </label>
          <section class="composer-subsection">
            <div class="event-entry-header">
              <strong>Tax rates</strong>
              <button type="button" class="secondary-button" id="add-tax-rate">Add rate</button>
            </div>
            <div class="action-list">
              ${taxDraft.rates
                .map(
                  (rate, index) => `
                    <div class="action-card">
                      <div class="action-header">
                        <span>Rate ${index + 1}</span>
                        <button type="button" class="ghost-button" data-remove-tax-rate="${rate.id}" ${taxDraft.rates.length === 1 ? "disabled" : ""}>Remove</button>
                      </div>
                      <div class="split-fields">
                        <label>
                          Rate
                          <input type="number" step="0.0001" data-tax-rate-field="${rate.id}:rate" value="${escapeHtml(rate.rate)}" />
                        </label>
                        <label>
                          Up to
                          <input
                            ${renderEditableNumberInputAttributes({ allowEmpty: true })}
                            data-tax-rate-field="${rate.id}:upTo"
                            value="${escapeHtml(formatEditableNumberInput(rate.upTo))}"
                            placeholder="Blank = uncapped"
                          />
                        </label>
                      </div>
                    </div>
                  `
                )
                .join("")}
            </div>
          </section>
          <section class="composer-subsection">
            <div class="event-entry-header">
              <strong>Exclusions</strong>
              <button type="button" class="secondary-button" id="add-tax-exclusion">Add exclusion</button>
            </div>
            <div class="action-list">
              ${taxDraft.exclusions.length === 0
                ? `<p class="helper-copy">Optional. Use exclusions for deductions or exempt amounts like SALT-style caps.</p>`
                : taxDraft.exclusions
                    .map(
                      (exclusion, index) => `
                        <div class="action-card">
                          <div class="action-header">
                            <span>Exclusion ${index + 1}</span>
                            <button type="button" class="ghost-button" data-remove-tax-exclusion="${exclusion.id}">Remove</button>
                          </div>
                          <label>
                            Exclusion name
                            <input type="text" data-tax-exclusion-field="${exclusion.id}:name" value="${escapeHtml(exclusion.name)}" />
                          </label>
                          <div class="split-fields">
                            <label>
                              Amount
                              <input
                                ${renderEditableNumberInputAttributes()}
                                data-tax-exclusion-field="${exclusion.id}:amount"
                                value="${escapeHtml(formatEditableNumberInput(exclusion.amount))}"
                              />
                            </label>
                            <label>
                              Maximum
                              <input
                                ${renderEditableNumberInputAttributes({ allowEmpty: true })}
                                data-tax-exclusion-field="${exclusion.id}:maximum"
                                value="${escapeHtml(formatEditableNumberInput(exclusion.maximum))}"
                                placeholder="Optional cap"
                              />
                            </label>
                          </div>
                        </div>
                      `
                    )
                    .join("")}
            </div>
          </section>
          <div class="event-buttons">
            <button type="button" class="secondary-button" id="close-tax-composer-secondary">Cancel</button>
            <button type="submit">Save tax</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderExpenseToggle(
  name: "oneTime" | "inflationAdjusted" | "taxDeductible",
  checked: boolean,
  label: string
): string {
  return `
    <div class="expense-toggle-row">
      <label class="switch-field expense-toggle-switch" aria-label="${escapeHtml(label)}">
        <input type="checkbox" name="${name}" ${checked ? "checked" : ""} />
        <span class="switch-track" aria-hidden="true"></span>
      </label>
      <div class="expense-toggle-copy">
        <strong>${escapeHtml(label)}</strong>
      </div>
    </div>
  `;
}

function renderFlowTaxTreatmentField(draft: FlowDraft | FlowEditDraft): string {
  if (draft.type === "expense") {
    return renderExpenseToggle("taxDeductible", draft.taxTreatment === "deductible-expense", "Tax deductible");
  }

  return `
    <label>
      Type
      <select name="taxTreatment">
        ${renderFlowTaxTreatmentOptions(draft.type, draft.taxTreatment)}
      </select>
    </label>
  `;
}

function renderIncomeFlowFields(draft: FlowDraft | FlowEditDraft): string {
  return `
    ${renderExpenseToggle("oneTime", draft.oneTime, "One-time income")}
    ${
      draft.oneTime
        ? renderOneTimeFlowFields(draft)
        : `
          <div class="split-fields">
            <label>
              Start year
              <input name="startYear" type="number" min="1900" max="9999" value="${escapeHtml(draft.startYear)}" required />
            </label>
            <label>
              End year
              <input name="endYear" type="number" min="1900" max="9999" value="${escapeHtml(draft.endYear)}" placeholder="Optional" />
            </label>
          </div>
          <label>
            % raise per year
            <input name="annualRaisePercent" type="number" step="0.01" value="${escapeHtml(draft.annualRaisePercent)}" />
          </label>
        `
    }
  `;
}

function renderOneTimeFlowFields(draft: FlowDraft | FlowEditDraft): string {
  return `
    <label>
      Year
      <input name="oneTimeYear" type="number" min="1900" max="9999" value="${escapeHtml(draft.oneTimeYear)}" required />
    </label>
  `;
}

function renderFlowComposer(): string {
  if (!flowComposerOpen) {
    return "";
  }

  return `
    <div class="modal-shell">
      <section class="panel modal-panel">
        <div class="modal-header">
          <div class="panel-heading">
            <p class="kicker">Create ${flowDraft.type === "income" ? "Income" : "Expense"}</p>
            <h2>New ${flowDraft.type}</h2>
          </div>
        </div>
        <form id="flow-form" class="stack-form">
          ${flowDraft.type === "income" ? renderFlowTaxTreatmentField(flowDraft) : ""}
          <label>
            ${flowDraft.type === "income" ? "Income name" : "Expense name"}
            <input
              name="flowLabel"
              type="text"
              placeholder="${flowDraft.type === "income" ? "Salary, inheritance, etc." : "Shopping, food, etc."}"
              value="${escapeHtml(flowDraft.name)}"
              required
            />
          </label>
          <label>
            Amount per year
            ${renderFormulaEditor({
              inputName: "formula",
              value: flowDraft.formula,
              placeholder: "$50,000",
              variablesScope: "planner",
              type: "money",
              requiredLabel: "Amount",
            })}
          </label>
          ${
            flowDraft.type === "income"
              ? renderIncomeFlowFields(flowDraft)
              : `
                ${renderExpenseToggle("oneTime", flowDraft.oneTime, "One-time expense")}
                ${flowDraft.oneTime ? renderOneTimeFlowFields(flowDraft) : renderExpenseToggle("inflationAdjusted", flowDraft.inflationAdjusted, "Apply inflation")}
              `
          }
          ${flowDraft.type === "expense" ? renderFlowTaxTreatmentField(flowDraft) : ""}
          ${
            flowDraft.oneTime
              ? ""
              : renderFlowChangePanel(renderFlowDraftEvents(flowDraft), "open-flow-draft-event-composer")
          }
          <div class="event-buttons">
            <button type="button" class="secondary-button" id="close-flow-composer-secondary">Cancel</button>
            <button type="submit">Save ${flowDraft.type}</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderEventComposer(): string {
  if (!eventComposerOpen) {
    return "";
  }

  return `
    <div class="modal-shell">
      <section class="panel modal-panel event-panel">
        <div class="modal-header">
          <div class="panel-heading">
            <p class="kicker">${eventDraft.originalName ? "Edit Event" : "Create Event"}</p>
            <h2>${eventDraft.originalName ? escapeHtml(eventDraft.originalName) : "Scheduled change set"}</h2>
          </div>
        </div>
        <form id="event-form" class="stack-form">
          <label>
            Event name
            <input id="event-name" name="eventLabel" type="text" value="${escapeHtml(eventDraft.name)}" placeholder="Promotion cycle" required />
          </label>
          <label>
            Flow
            <select id="event-flow-name" name="flowName" ${plannerState.flows.length === 0 ? "disabled" : ""}>
              ${plannerState.flows
                .map(
                  (flow) => `
                    <option value="${escapeHtml(flow.name)}" ${eventDraft.flowName === flow.name ? "selected" : ""}>
                      ${escapeHtml(flow.name)}
                    </option>
                  `
                )
                .join("")}
            </select>
          </label>

          <div class="event-entry-list">
            ${eventDraft.entries
              .map(
                (entry, entryIndex) => `
                  <section class="event-entry" data-entry-id="${entry.id}">
                    <div class="event-entry-header">
                      <strong>Change ${entryIndex + 1}</strong>
                      <button type="button" class="ghost-button" data-remove-entry="${entry.id}">Remove year</button>
                    </div>
                    <label>
                      Year
                      <input type="number" min="1900" max="9999" data-entry-year="${entry.id}" value="${entry.year}" />
                    </label>
                    <div class="action-list">
                      ${entry.actions
                        .map(
                          (action, actionIndex) => `
                            <div class="action-card" data-action-id="${action.id}">
                              <div class="action-header">
                                <span>Action ${actionIndex + 1}</span>
                                <button type="button" class="ghost-button" data-remove-action="${entry.id}:${action.id}">Remove</button>
                              </div>
                              <label>
                                Type
                                <select data-action-kind="${entry.id}:${action.id}">
                                  <option value="adjust-variable" ${action.kind === "adjust-variable" ? "selected" : ""}>Adjust variable</option>
                                  <option value="set-flow-formula" ${action.kind === "set-flow-formula" ? "selected" : ""}>Set flow amount</option>
                                  <option value="add-variable" ${action.kind === "add-variable" ? "selected" : ""}>Add variable</option>
                                  <option value="add-flow" ${action.kind === "add-flow" ? "selected" : ""}>Add flow</option>
                                  <option value="one-time-expense" ${action.kind === "one-time-expense" ? "selected" : ""}>One-time expense</option>
                                </select>
                              </label>
                              ${renderActionFields(entry.id, action)}
                            </div>
                          `
                        )
                        .join("")}
                    </div>
                    <button type="button" class="secondary-button" data-add-action="${entry.id}">Add action</button>
                  </section>
                `
              )
              .join("")}
          </div>

          <div class="event-buttons">
            <button type="button" class="secondary-button" id="add-entry-button">Add year</button>
            <div class="event-buttons">
              <button type="button" class="secondary-button" id="close-event-composer-secondary">Cancel</button>
              <button type="submit">Save event</button>
            </div>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderFlowEvents(flowName: string): string {
  const events = getExpenseChangeEvents(flowName);
  const hasDraftRow = activeFlowEventEdit?.eventName === null;
  const rows = hasDraftRow ? [...events, null] : events;

  if (rows.length === 0) {
    const flowType =
      plannerState.flows.find((flow) => flow.name === flowName)?.type ??
      (flowEditDraft.originalName === flowName ? flowEditDraft.type : "expense");
    return `<p class="helper-copy">Modify the amount of ${flowType === "income" ? "income" : "this expense"} over time.</p>`;
  }

  return `
    <div class="board-scroll">
      <table class="flow-table flow-event-table">
        <thead>
          <tr>
            <th>Year</th>
            <th>Amount</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
      ${rows
        .map(
          (event) => {
            const eventName = event?.name ?? null;
            const action = event?.schedule[0]?.actions[0];
            const yearValue =
              activeFlowEventEdit?.eventName === eventName ? flowEventDraft.year : event ? yearLabel(event.schedule[0].year) : "";
            const formulaValue =
              activeFlowEventEdit?.eventName === eventName
                ? flowEventDraft.formula
                : action?.kind === "set-flow-formula"
                  ? action.formula
                  : "";
            const isEditingYear = activeFlowEventEdit?.eventName === eventName && activeFlowEventEdit.field === "year";
            const isEditingFormula =
              activeFlowEventEdit?.eventName === eventName && activeFlowEventEdit.field === "formula";

            return `
              <tr>
                <td>
                  ${
                    isEditingYear
                      ? `<input class="flow-event-inline-input" data-inline-flow-event-year="${escapeAttribute(
                          eventName ?? "__new__"
                        )}" type="number" min="1900" max="9999" value="${escapeHtml(yearValue)}" />`
                      : `<button type="button" class="link-button flow-event-inline-button" data-start-edit-flow-event-year="${escapeAttribute(
                          eventName ?? "__new__"
                        )}">${escapeHtml(yearValue || "Year")}</button>`
                  }
                </td>
                <td>
                  ${
                    isEditingFormula
                      ? `<div data-inline-flow-event-formula-editor="${escapeAttribute(eventName ?? "__new__")}">
                          ${renderFormulaEditor({
                            inputName: "flowEventFormula",
                            value: formulaValue,
                            placeholder: "1,000",
                            variablesScope: "planner",
                            type: "money",
                            requiredLabel: "Amount",
                          })}
                        </div>`
                      : `<button type="button" class="link-button flow-event-inline-button flow-event-inline-formula" data-start-edit-flow-event-formula="${escapeAttribute(
                          eventName ?? "__new__"
                        )}"><code>${escapeHtml(formulaValue ? formatFormulaText(formulaValue) : "Amount")}</code></button>`
                  }
                </td>
                <td>
                  ${
                    event
                      ? `<button type="button" class="ghost-button" data-delete-flow-event="${escapeHtml(event.name)}">Delete</button>`
                      : `<span class="summary-meta">New</span>`
                  }
                </td>
              </tr>
            `;
          }
        )
        .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderFlowDraftEvents(draft: FlowDraft): string {
  const hasDraftRow = activeFlowEventEdit?.eventName === null;
  const rows = hasDraftRow ? [...draft.changeEvents, null] : draft.changeEvents;

  if (rows.length === 0) {
    return `<p class="helper-copy">Modify the amount of ${draft.type === "income" ? "income" : "this expense"} over time.</p>`;
  }

  return `
    <div class="board-scroll">
      <table class="flow-table flow-event-table">
        <thead>
          <tr>
            <th>Year</th>
            <th>Amount</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((change) => {
              const changeId = change?.id ?? null;
              const yearValue = activeFlowEventEdit?.eventName === changeId ? flowEventDraft.year : change?.year ?? "";
              const formulaValue =
                activeFlowEventEdit?.eventName === changeId ? flowEventDraft.formula : change?.formula ?? "";
              const isEditingYear = activeFlowEventEdit?.eventName === changeId && activeFlowEventEdit.field === "year";
              const isEditingFormula =
                activeFlowEventEdit?.eventName === changeId && activeFlowEventEdit.field === "formula";

              return `
                <tr>
                  <td>
                    ${
                      isEditingYear
                        ? `<input class="flow-event-inline-input" data-inline-flow-event-year="${escapeAttribute(
                            changeId ?? "__new__"
                          )}" type="number" min="1900" max="9999" value="${escapeHtml(yearValue)}" />`
                        : `<button type="button" class="link-button flow-event-inline-button" data-start-edit-flow-draft-event-year="${escapeAttribute(
                            changeId ?? "__new__"
                          )}">${escapeHtml(yearValue || "Year")}</button>`
                    }
                  </td>
                  <td>
                    ${
                      isEditingFormula
                        ? `<div data-inline-flow-event-formula-editor="${escapeAttribute(changeId ?? "__new__")}">
                            ${renderFormulaEditor({
                              inputName: "flowEventFormula",
                              value: formulaValue,
                              placeholder: "1,000",
                              variablesScope: "planner",
                              type: "money",
                              requiredLabel: "Amount",
                            })}
                          </div>`
                        : `<button type="button" class="link-button flow-event-inline-button flow-event-inline-formula" data-start-edit-flow-draft-event-formula="${escapeAttribute(
                            changeId ?? "__new__"
                          )}"><code>${escapeHtml(formulaValue ? formatFormulaText(formulaValue) : "Amount")}</code></button>`
                    }
                  </td>
                  <td>
                    ${
                      change
                        ? `<button type="button" class="ghost-button" data-delete-flow-draft-event="${escapeHtml(change.id)}">Delete</button>`
                        : `<span class="summary-meta">New</span>`
                    }
                  </td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderFlowChangePanel(content: string, addButtonId: string): string {
  return `
    <section class="composer-subsection flow-editor-events-section">
      <div class="event-entry-header">
        <h3>Change over time</h3>
      </div>
      ${content}
      <div class="event-buttons">
        <button type="button" class="secondary-button" id="${addButtonId}">Add change</button>
      </div>
    </section>
  `;
}

function renderFlowEditor(): string {
  if (!flowEditorOpen) {
    return "";
  }

  return `
    <div class="modal-shell">
      <section class="panel modal-panel">
        <div class="modal-header">
          <div class="panel-heading">
            <p class="kicker">Edit ${escapeHtml(flowEditDraft.type === "income" ? "Income" : "Expense")}</p>
            <h2>${escapeHtml(flowEditDraft.originalName)}</h2>
          </div>
          <button
            type="button"
            class="ghost-button icon-button"
            id="delete-flow-from-editor"
            aria-label="Delete ${escapeAttribute(flowEditDraft.type)}"
            title="Delete ${escapeAttribute(flowEditDraft.type)}"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M9 3h6m-9 4h12m-1 0-.7 11.2a2 2 0 0 1-2 1.8H9.4a2 2 0 0 1-2-1.8L6.7 7m3 4v5m4-5v5"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.8"
              />
            </svg>
          </button>
        </div>
        <form id="flow-edit-form" class="stack-form">
          ${flowEditDraft.type === "income" ? renderFlowTaxTreatmentField(flowEditDraft) : ""}
          <label>
            ${flowEditDraft.type === "income" ? "Income name" : "Expense name"}
            <input name="flowLabel" type="text" value="${escapeHtml(flowEditDraft.name)}" required />
          </label>
          ${flowEditDraft.type === "expense" ? renderFlowTaxTreatmentField(flowEditDraft) : ""}
          <label>
            Amount
            ${renderFormulaEditor({
              inputName: "formula",
              value: flowEditDraft.formula,
              placeholder: "1,000",
              variablesScope: "planner",
              type: "money",
              requiredLabel: "Amount",
            })}
          </label>
          ${
            flowEditDraft.type === "income"
              ? renderIncomeFlowFields(flowEditDraft)
              : `
                ${renderExpenseToggle("oneTime", flowEditDraft.oneTime, "One-time expense")}
                ${flowEditDraft.oneTime ? renderOneTimeFlowFields(flowEditDraft) : renderExpenseToggle("inflationAdjusted", flowEditDraft.inflationAdjusted, "Apply inflation")}
              `
          }
          ${
            flowEditDraft.oneTime
              ? ""
              : renderFlowChangePanel(renderFlowEvents(flowEditDraft.originalName), "open-flow-event-composer")
          }
          <div class="event-buttons">
            <button type="button" class="secondary-button" id="close-flow-editor-secondary">Cancel</button>
            <button type="submit">Save ${flowEditDraft.type}</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderActionFields(entryId: string, action: EventActionDraft): string {
  switch (action.kind) {
    case "adjust-variable":
      return `
        <label>
          Variable
          <input type="text" data-field="${entryId}:${action.id}:variableName" value="${escapeHtml(action.variableName)}" placeholder="salary" />
        </label>
        <div class="split-fields">
          <label>
            m
            <input type="number" step="0.01" data-field="${entryId}:${action.id}:m" value="${escapeHtml(action.m)}" />
          </label>
          <label>
            b
            <input
              ${renderEditableNumberInputAttributes()}
              data-field="${entryId}:${action.id}:b"
              value="${escapeHtml(formatEditableNumberInput(action.b))}"
            />
          </label>
        </div>
      `;
    case "set-flow-formula":
      return `
        <p class="helper-copy">This event updates the amount for ${escapeHtml(eventDraft.flowName || action.flowName || "the selected flow")}.</p>
        <label>
          New amount
          ${renderFormulaEditor({
            value: action.formula,
            placeholder: "1,000",
            variablesScope: "event-draft",
            fieldToken: `${entryId}:${action.id}:formula`,
            type: "money",
            requiredLabel: "Amount",
          })}
        </label>
      `;
    case "add-variable":
      return `
        <label>
          Variable name
          <input type="text" data-field="${entryId}:${action.id}:variableDefinitionName" value="${escapeHtml(action.variableDefinitionName)}" placeholder="sideGig" />
        </label>
        <label>
          Starting value
          <input
            ${renderEditableNumberInputAttributes()}
            data-field="${entryId}:${action.id}:variableDefinitionValue"
            value="${escapeHtml(formatEditableNumberInput(action.variableDefinitionValue))}"
          />
        </label>
      `;
    case "add-flow":
      return `
        <label>
          Flow name
          <input type="text" data-field="${entryId}:${action.id}:flowDefinitionName" value="${escapeHtml(action.flowDefinitionName)}" placeholder="Side gig" />
        </label>
        <label>
          Flow type
          <select data-field="${entryId}:${action.id}:flowDefinitionType">
            <option value="expense" ${action.flowDefinitionType === "expense" ? "selected" : ""}>Expense</option>
            <option value="income" ${action.flowDefinitionType === "income" ? "selected" : ""}>Income</option>
          </select>
        </label>
        <label>
          Amount
          ${renderFormulaEditor({
            value: action.flowDefinitionFormula,
            placeholder: "sideGig",
            variablesScope: "event-draft",
            fieldToken: `${entryId}:${action.id}:flowDefinitionFormula`,
            type: "money",
            requiredLabel: "Amount",
          })}
        </label>
      `;
    case "one-time-expense":
      return `
        <label>
          Expense name
          <input type="text" data-field="${entryId}:${action.id}:oneTimeExpenseName" value="${escapeHtml(action.oneTimeExpenseName)}" placeholder="Laptop purchase" />
        </label>
        <label>
          Amount
          ${renderFormulaEditor({
            value: action.oneTimeExpenseFormula,
            placeholder: "taxBillAmount * 0.5",
            variablesScope: "event-draft",
            fieldToken: `${entryId}:${action.id}:oneTimeExpenseFormula`,
            type: "money",
            requiredLabel: "Amount",
          })}
        </label>
      `;
  }
}

function bindHandlers(user: UserIdentity): void {
  bindEditableNumberInputs();
  bindSimulationChartTooltip();
  focusInlineAssetValueInput();
  focusInlineExpenseValueInput();
  focusNewAssetNameInput();

  const openAssetButton = document.querySelector<HTMLButtonElement>("#open-asset-composer");

  for (const openFlowButton of document.querySelectorAll<HTMLButtonElement>("[data-open-flow-composer]")) {
    openFlowButton.addEventListener("click", () => {
      const type = openFlowButton.dataset.openFlowComposer === "income" ? "income" : "expense";
      Object.assign(flowDraft, createFlowDraft(type));
      flowComposerOpen = true;
      shouldFocusNewFlowName = true;
      renderPlanner(user);
    });
  }

  openAssetButton?.addEventListener("click", () => {
    assetComposerOpen = true;
    shouldFocusNewAssetName = true;
    activeSummaryTab = "assets";
    renderPlanner(user);
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-summary-tab]")) {
    button.addEventListener("click", () => {
      const nextTab = button.dataset.summaryTab as SummaryTab | undefined;
      if (!nextTab) {
        return;
      }

      activeSummaryTab = nextTab;
      renderPlanner(user);
    });
  }

  const percentileSelect = document.querySelector<HTMLSelectElement>("[data-simulation-percentile-select]");
  percentileSelect?.addEventListener("change", () => {
    const percentile = Number(percentileSelect.value) as SimulationPercentile;
    if (!simulationPercentiles.includes(percentile)) {
      return;
    }

    selectedSimulationPercentile = percentile;
    expandedSimulationExampleKeys = new Set();
    renderPlanner(user);
  });

  const targetAgeSelect = document.querySelector<HTMLSelectElement>("[data-simulation-target-age]");
  targetAgeSelect?.addEventListener("change", () => {
    setSimulationTargetAge(Number(targetAgeSelect.value));
    invalidateSimulationState();
    expandedSimulationExampleKeys = new Set();
    persistSimulationSettingsDraftToLocalStorage(user.id);
    void persistPlannerState(user);
    renderPlanner(user);
  });

  const simulationForm = document.querySelector<HTMLFormElement>("#simulation-form");

  const applySimulationInflationPresetChange = (target: HTMLSelectElement): boolean => {
    if (target.name !== "simulationInflationPreset") {
      return false;
    }

    const nextInflationPreset = isSimulationInflationPreset(target.value) ? target.value : simulationDraft.inflationPreset;
    if (nextInflationPreset === simulationDraft.inflationPreset) {
      return true;
    }

    simulationDraft.inflationPreset = nextInflationPreset;
    simulationInflationSectionExpanded = isSimulationInflationCustomPreset(simulationDraft.inflationPreset);
    invalidateSimulationState();
    renderPlanner(user);
    void persistPlannerState(user);
    return true;
  };

  const applySimulationTaxPresetChange = (target: HTMLSelectElement): boolean => {
    if (target.name !== "simulationTaxPreset" && target.name !== "basicInfoTaxPreset") {
      return false;
    }

    const previousTaxPreset = simulationDraft.taxPreset;
    const nextTaxPreset = normalizeSimulationTaxPreset(target.value, simulationDraft.taxPreset);
    if (nextTaxPreset === simulationDraft.taxPreset) {
      return true;
    }

    simulationDraft.taxPreset = nextTaxPreset;
    if (simulationDraft.taxPreset === "custom") {
      seedCustomTaxProfileFromPreset(previousTaxPreset);
      simulationTaxesSectionExpanded = true;
    } else {
      simulationTaxesSectionExpanded = false;
    }
    persistSimulationSettingsDraftToLocalStorage(user.id);
    persistSimulationTaxPresetToLocalStorage(user.id);
    invalidateSimulationState();
    syncSimulationSubmitState();
    renderPlanner(user);
    void persistPlannerState(user);
    return true;
  };

  const basicInfoAgeInput = document.querySelector<HTMLInputElement>('input[name="basicInfoCurrentAge"]');
  basicInfoAgeInput?.addEventListener("change", () => {
    const previousHorizonYears = simulationDraft.horizonYears;
    simulationDraft.currentAge = normalizeSimulationCurrentAge(Number(basicInfoAgeInput.value));
    simulationDraft.horizonYears = normalizeSimulationHorizonYears(simulationDraft.horizonYears);
    if (simulationDraft.horizonYears !== previousHorizonYears) {
      invalidateSimulationState();
    }
    syncSimulationSubmitState();
    persistSimulationSettingsDraftToLocalStorage(user.id);
    void persistPlannerState(user);
    renderPlanner(user);
  });

  const basicInfoLocationSelect = document.querySelector<HTMLSelectElement>('select[name="basicInfoTaxPreset"]');
  basicInfoLocationSelect?.addEventListener("change", () => {
    applySimulationTaxPresetChange(basicInfoLocationSelect);
  });

  const applySimulationVariableSweepVariableChange = (target: HTMLSelectElement): boolean => {
    if (target.name !== "simulationVariableSweepVariableName") {
      return false;
    }

    simulationDraft.variableSweep.variableName = target.value;
    invalidateSimulationState();
    syncSimulationSubmitState();
    void persistPlannerState(user);
    return true;
  };

  simulationForm?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const actionButton = target.closest<HTMLButtonElement>("[data-simulation-action]");
    if (!actionButton) {
      return;
    }

    event.preventDefault();
    const action = actionButton.dataset.simulationAction;
    if (action === "toggle-settings-section") {
      simulationSettingsSectionExpanded = !simulationSettingsSectionExpanded;
      renderPlanner(user);
      return;
    } else if (action === "toggle-inflation-section") {
      if (!isSimulationInflationCustomPreset(simulationDraft.inflationPreset)) {
        return;
      }
      simulationInflationSectionExpanded = !simulationInflationSectionExpanded;
      renderPlanner(user);
      return;
    } else if (action === "toggle-taxes-section") {
      if (simulationDraft.taxPreset !== "custom") {
        return;
      }
      simulationTaxesSectionExpanded = !simulationTaxesSectionExpanded;
      renderPlanner(user);
      return;
    } else {
      return;
    }

    invalidateSimulationState();
    syncSimulationSubmitState();
    renderPlanner(user);
    void persistPlannerState(user);
  });

  simulationForm?.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
      return;
    }

    const assetFieldToken = target.dataset.simulationAssetField;
    if (assetFieldToken) {
      const [assetName, field] = assetFieldToken.split(":");
      const assetDraftRow = simulationDraft.assetRows.find((row) => row.name === assetName);
      if (!assetDraftRow) {
        return;
      }

      if (field === "sellProportion") {
        assetDraftRow.sellProportion = target.value;
        plannerState.assets = plannerState.assets.map((asset) =>
          asset.name === assetName ? { ...asset, sellProportion: Number(target.value) || 0 } : asset
        );
        invalidateSimulationState();
        syncSimulationSubmitState();
        void persistPlannerState(user);
      }
      return;
    }

    if (target.name === "simulationStartYear") {
      const normalizedYear = normalizeYearInput(target.value);
      simulationDraft.startYear = normalizedYear;
      plannerState.startYear = normalizedYear;
    } else if (target.name === "simulationHorizonYears") {
      simulationDraft.horizonYears = normalizeSimulationHorizonYears(Number(target.value));
    } else if (target instanceof HTMLSelectElement && applySimulationInflationPresetChange(target)) {
      return;
    } else if (target.name === "simulationFixedInflationRate") {
      simulationDraft.fixedInflationRate = target.value;
    } else if (target.name === "simulationInflationLowAverageRate") {
      simulationDraft.regimeSwitchingInflation.lowAverageRate = target.value;
    } else if (target.name === "simulationInflationLowVolatility") {
      simulationDraft.regimeSwitchingInflation.lowVolatility = target.value;
    } else if (target.name === "simulationInflationHighAverageRate") {
      simulationDraft.regimeSwitchingInflation.highAverageRate = target.value;
    } else if (target.name === "simulationInflationHighVolatility") {
      simulationDraft.regimeSwitchingInflation.highVolatility = target.value;
    } else if (target.name === "simulationInflationStayLowProbability") {
      simulationDraft.regimeSwitchingInflation.stayLowProbability = target.value;
    } else if (target.name === "simulationInflationStayHighProbability") {
      simulationDraft.regimeSwitchingInflation.stayHighProbability = target.value;
    } else if (target instanceof HTMLSelectElement && applySimulationTaxPresetChange(target)) {
      return;
    } else if (target.name === "simulationVariableSweepEnabled" && target instanceof HTMLInputElement) {
      simulationDraft.variableSweep.enabled = target.checked;
      if (target.checked) {
        syncSimulationVariableSweepDraft();
      }
      invalidateSimulationState();
      renderPlanner(user);
      void persistPlannerState(user);
      return;
    } else if (target.name === "simulationCustomAssetLiquidation" && target instanceof HTMLInputElement) {
      simulationDraft.customAssetLiquidation = target.checked;
      invalidateSimulationState();
      syncSimulationSubmitState();
      renderPlanner(user);
      void persistPlannerState(user);
      return;
    } else if (target instanceof HTMLSelectElement && applySimulationVariableSweepVariableChange(target)) {
      return;
    } else if (target.name === "simulationVariableSweepMinValue") {
      simulationDraft.variableSweep.minValue = target.value;
    } else if (target.name === "simulationVariableSweepMaxValue") {
      simulationDraft.variableSweep.maxValue = target.value;
    }

    invalidateSimulationState();
    syncSimulationSubmitState();
    void persistPlannerState(user);
  });

  simulationForm?.addEventListener("change", (event) => {
    const target = event.target;
    if (
      target instanceof HTMLSelectElement &&
      (applySimulationInflationPresetChange(target) ||
        applySimulationTaxPresetChange(target) ||
        applySimulationVariableSweepVariableChange(target))
    ) {
      return;
    }

    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (target.name === "simulationVariableSweepEnabled") {
      simulationDraft.variableSweep.enabled = target.checked;
      if (target.checked) {
        syncSimulationVariableSweepDraft();
      }
      invalidateSimulationState();
      renderPlanner(user);
      void persistPlannerState(user);
      return;
    }

    if (target.name === "simulationCustomAssetLiquidation") {
      simulationDraft.customAssetLiquidation = target.checked;
      invalidateSimulationState();
      syncSimulationSubmitState();
      renderPlanner(user);
      void persistPlannerState(user);
    }
  });

  simulationForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitState = getSimulationSubmitState();
    if (submitState.disabled) {
      syncSimulationSubmitState();
      return;
    }

    await persistPlannerState(user);
    syncSimulationDraftAssetRows({ invalidateOnChange: false });
    syncSimulationVariableSweepDraft();
    normalizeSimulationDraftHorizon();
    const runInputSignature = buildSimulationInputSignature();
    debugSimulationStaleState("run start", {
      currentSignature: runInputSignature,
      completedSignature: completedSimulationInputSignature,
      stale: simulationResultsStale,
    });
    const sweepValues = getSimulationSweepVariableValues();
    const sweepVariableName = simulationDraft.variableSweep.enabled
      ? simulationDraft.variableSweep.variableName
      : null;
    const simulationRuns = sweepVariableName
      ? sweepValues.map((value, index) => ({
          index,
          value,
          input: buildSimulationWorkerInput({
            variableName: sweepVariableName,
            value,
          }),
          taskIds: [] as number[],
        }))
      : [
          {
            index: 0,
            value: null,
            input: buildSimulationWorkerInput(),
            taskIds: [] as number[],
          },
        ];

    cancelActiveSimulationRun();
    clearSimulationOutputs();
    activeSimulationRequestId += 1;
    const requestId = activeSimulationRequestId;
    const hardwareConcurrency = Math.max(1, window.navigator.hardwareConcurrency ?? 1);
    const maxWorkerCount = Math.min(10, hardwareConcurrency);
    const taskDefinitions: SimulationTaskDefinition[] = [];
    let nextTaskId = 1;
    const potentialWorkerCount = Math.max(1, Math.min(maxWorkerCount, simulationRuns.length));
    const useVariableSweepWorkerFanout =
      ENABLE_VARIABLE_SWEEP_WORKER_FANOUT &&
      sweepVariableName !== null &&
      potentialWorkerCount >= simulationRuns.length;
    for (const run of simulationRuns) {
      const chunkCount = Math.max(1, Math.min(maxWorkerCount, run.input.attempts));
      const taskAttemptCounts = useVariableSweepWorkerFanout
        ? [run.input.attempts]
        : Array.from({ length: chunkCount }, (_, index) =>
            Math.floor(run.input.attempts / chunkCount) + (index < run.input.attempts % chunkCount ? 1 : 0)
          ).filter((attemptCount) => attemptCount > 0);
      const detailSampleLimitPerTask =
        sweepVariableName === null
          ? null
          : Math.max(1, Math.ceil(VARIABLE_SWEEP_DETAIL_SAMPLE_LIMIT / taskAttemptCounts.length));
      run.taskIds = taskAttemptCounts.map((attemptCount, chunkIndex) => {
        const taskId = nextTaskId;
        nextTaskId += 1;
        taskDefinitions.push({
          id: taskId,
          sweepIndex: run.index,
          chunkIndex,
          attemptCount,
          input: {
            ...run.input,
            attempts: attemptCount,
            detailSampleLimit: detailSampleLimitPerTask,
            includeAggregates: taskAttemptCounts.length > 1,
          },
        });
        return taskId;
      });
    }

    const taskById = new Map(taskDefinitions.map((task) => [task.id, task]));
    const totalAttempts = simulationRuns.reduce((total, run) => total + run.input.attempts, 0);
    const workerCount = Math.max(1, Math.min(maxWorkerCount, taskDefinitions.length));
    const completedAttemptsByTask = new Map<number, number>();
    const scenariosByTask = new Map<number, Map<SimulationPercentile, SimulationScenario>>();
    const detailResultsByTask = new Map<number, SimulationDetailScenario[]>();
    const yearlyTotalsByTask = new Map<number, number[][]>();
    const yearlyLiquidTotalsByTask = new Map<number, number[][]>();
    const depletionCountsByTask = new Map<number, number[]>();
    const completedTaskCountsByRun = simulationRuns.map(() => 0);
    let pendingTasks = taskDefinitions.length;
    let nextTaskIndex = 0;
    let hasSettled = false;

    simulationRunState = {
      completedAttempts: 0,
      totalAttempts,
      workerCount,
      completedSweepSteps: 0,
      totalSweepSteps: simulationRuns.length,
      errorMessage: null,
    };

    const updateSimulationProgress = (): void => {
      if (activeSimulationRequestId !== requestId || hasSettled) {
        return;
      }

      simulationRunState = {
        completedAttempts: [...completedAttemptsByTask.values()].reduce((total, attempts) => total + attempts, 0),
        totalAttempts,
        workerCount,
        completedSweepSteps: completedTaskCountsByRun.filter(
          (completedCount, index) => completedCount === simulationRuns[index]?.taskIds.length
        ).length,
        totalSweepSteps: simulationRuns.length,
        errorMessage: null,
      };
      renderPlanner(user);
    };

    const failSimulationRun = (message: string): void => {
      if (activeSimulationRequestId !== requestId || hasSettled) {
        return;
      }

      hasSettled = true;
      cancelActiveSimulationRun();
      simulationRunState = {
        completedAttempts: 0,
        totalAttempts,
        workerCount,
        completedSweepSteps: 0,
        totalSweepSteps: simulationRuns.length,
        errorMessage: message,
      };
      renderPlanner(user);
    };

    const finalizeSimulationRun = (): void => {
      if (activeSimulationRequestId !== requestId || hasSettled || pendingTasks > 0) {
        return;
      }

      hasSettled = true;
      for (const worker of activeSimulationWorkers) {
        worker.terminate();
      }
      activeSimulationWorkers = [];
      const finalizedRuns = simulationRuns.map((run) => {
        const mergedDetails = run.taskIds
          .map((taskId) => taskById.get(taskId))
          .filter((task): task is SimulationTaskDefinition => Boolean(task))
          .sort((left, right) => left.chunkIndex - right.chunkIndex)
          .flatMap((task) => detailResultsByTask.get(task.id) ?? []);

        const results =
          run.taskIds.length === 1
            ? (scenariosByTask.get(run.taskIds[0]) ?? new Map<SimulationPercentile, SimulationScenario>())
            : buildSimulationScenariosFromAggregates({
                attempts: run.input.attempts,
                horizonYears: run.input.horizonYears,
                yearlyPlans: run.input.yearlyPlans ?? [],
                yearlyTotals: Array.from({ length: run.input.horizonYears }, (_, rowIndex) =>
                  run.taskIds.flatMap((taskId) => yearlyTotalsByTask.get(taskId)?.[rowIndex] ?? [])
                ),
                yearlyLiquidTotals: Array.from({ length: run.input.horizonYears }, (_, rowIndex) =>
                  run.taskIds.flatMap((taskId) => yearlyLiquidTotalsByTask.get(taskId)?.[rowIndex] ?? [])
                ),
                depletionCountsByYear: Array.from({ length: run.input.horizonYears }, (_, rowIndex) =>
                  run.taskIds.reduce((total, taskId) => total + (depletionCountsByTask.get(taskId)?.[rowIndex] ?? 0), 0)
                ),
              });

        return {
          ...run,
          details: mergedDetails,
          results,
        };
      });

      if (sweepVariableName) {
        simulationResults = null;
        simulationDetailResults = null;
        simulationSweepResults = {
          variableName: sweepVariableName,
          steps: finalizedRuns.map((run) => ({
            index: run.index,
            value: run.value ?? 0,
            results: run.results,
            details: run.details,
          })),
        };
        const baseVariableValue =
          plannerState.variables.find((variable) => variable.name === sweepVariableName)?.value ??
          finalizedRuns[0]?.value ??
          0;
        selectedSimulationSweepStepIndex = findNearestSweepStepIndex(sweepValues, baseVariableValue);
      } else {
        simulationSweepResults = null;
        simulationResults = finalizedRuns[0]?.results ?? null;
        simulationDetailResults = finalizedRuns[0]?.details ?? null;
        selectedSimulationSweepStepIndex = 0;
      }

      simulationResultsStale = false;
      completedSimulationInputSignature = runInputSignature;
      debugSimulationStaleState("run complete", {
        currentSignature: buildSimulationInputSignature(),
        completedSignature: completedSimulationInputSignature,
        stale: simulationResultsStale,
      });
      selectedSimulationPercentile = 50;
      expandedSimulationExampleKeys = new Set();
      simulationRunState = null;
      renderPlanner(user);
    };

    const dispatchNextTask = (worker: Worker): void => {
      const task = taskDefinitions[nextTaskIndex];
      nextTaskIndex += 1;
      if (!task) {
        finalizeSimulationRun();
        return;
      }

      completedAttemptsByTask.set(task.id, 0);
      worker.postMessage({
        type: "run",
        requestId: task.id,
        input: task.input,
      });
    };

    activeSimulationWorkers = Array.from({ length: workerCount }, () => {
      const worker = new Worker(new URL("./simulation-worker.ts", import.meta.url), { type: "module" });
      worker.addEventListener("message", (messageEvent: MessageEvent<SimulationWorkerResponse>) => {
        const message = messageEvent.data;
        if (!message || hasSettled) {
          return;
        }

        const task = taskById.get(message.requestId);
        if (!task || activeSimulationRequestId !== requestId) {
          return;
        }

        if (message.type === "progress") {
          completedAttemptsByTask.set(task.id, message.completedAttempts);
          updateSimulationProgress();
          return;
        }

        if (message.type === "error") {
          failSimulationRun(message.message);
          return;
        }

        completedAttemptsByTask.set(task.id, task.attemptCount);
        scenariosByTask.set(task.id, message.scenarios);
        detailResultsByTask.set(task.id, message.details);
        if (message.yearlyTotals) {
          yearlyTotalsByTask.set(task.id, message.yearlyTotals);
        }
        if (message.yearlyLiquidTotals) {
          yearlyLiquidTotalsByTask.set(task.id, message.yearlyLiquidTotals);
        }
        if (message.depletionCountsByYear) {
          depletionCountsByTask.set(task.id, message.depletionCountsByYear);
        }
        completedTaskCountsByRun[task.sweepIndex] += 1;
        pendingTasks -= 1;
        updateSimulationProgress();
        if (pendingTasks <= 0) {
          finalizeSimulationRun();
          return;
        }

        dispatchNextTask(worker);
      });
      worker.addEventListener("error", () => {
        failSimulationRun("Simulation failed.");
      });
      return worker;
    });

    for (const worker of activeSimulationWorkers) {
      dispatchNextTask(worker);
    }
    renderPlanner(user);
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-simulation-chart-metric]")) {
    button.addEventListener("click", () => {
      const metric = button.dataset.simulationChartMetric as SimulationChartMetric | undefined;
      if (!metric) {
        return;
      }

      selectedSimulationChartMetric = metric;
      renderPlanner(user);
    });
  }

  for (const target of document.querySelectorAll<SVGElement>("[data-simulation-chart-percentile-select]")) {
    target.addEventListener("click", () => {
      const percentile = Number(target.dataset.simulationChartPercentileSelect) as SimulationPercentile;
      if (!simulationPercentiles.includes(percentile) || !getDisplayedSimulationResults()?.has(percentile)) {
        return;
      }

      selectedSimulationPercentile = percentile;
      expandedSimulationExampleKeys = new Set();
      renderPlanner(user);
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-toggle-simulation-example]")) {
    button.addEventListener("click", () => {
      const key = button.dataset.toggleSimulationExample;
      if (!key) {
        return;
      }

      if (expandedSimulationExampleKeys.has(key)) {
        expandedSimulationExampleKeys.delete(key);
      } else {
        expandedSimulationExampleKeys.add(key);
      }

      renderPlanner(user);
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-export-simulation-example]")) {
    button.addEventListener("click", () => {
      const percentile = Number(button.dataset.exportSimulationExample) as SimulationPercentile;
      const displayedSimulationResults = getDisplayedSimulationResults();
      const displayedSimulationDetails = getDisplayedSimulationDetailResults();
      const scenario = displayedSimulationResults?.get(percentile) ?? null;
      const detailScenario =
        scenario && displayedSimulationDetails
          ? selectRepresentativeSimulationScenario(displayedSimulationDetails, scenario.rows)
          : null;

      if (!scenario || !detailScenario) {
        return;
      }

      downloadSimulationExampleExport(percentile, scenario, detailScenario);
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-edit-asset]")) {
    button.addEventListener("click", () => {
      const assetName = button.dataset.editAsset;
      if (!assetName) {
        return;
      }

      openAssetEditor(assetName);
      activeSummaryTab = "assets";
      renderPlanner(user);
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-edit-tax]")) {
    button.addEventListener("click", () => {
      const taxName = button.dataset.editTax;
      if (!taxName) {
        return;
      }

      openTaxEditor(taxName);
      activeSummaryTab = "taxes";
      renderPlanner(user);
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-delete-tax]")) {
    button.addEventListener("click", async () => {
      const taxName = button.dataset.deleteTax;
      if (!taxName) {
        return;
      }

      plannerState.taxes = plannerState.taxes.filter((tax) => tax.name !== taxName);
      clearDeletedTaxReference(taxName);
      invalidateSimulationState();
      await persistPlannerState(user);
      renderPlanner(user);
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-edit-flow]")) {
    button.addEventListener("click", () => {
      const flowName = button.dataset.editFlow;
      if (!flowName) {
        return;
      }

      openFlowEditor(flowName);
      renderPlanner(user);
    });
  }

  const shouldIgnoreWorkspaceCardClick = (target: EventTarget | null): boolean =>
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        [
          "[data-edit-asset-value]",
          "[data-edit-expense-value]",
          "[data-inline-asset-value-form]",
          "[data-inline-expense-value-form]",
          "button",
          "input",
          "select",
          "textarea",
          "a",
        ].join(", ")
      )
    );

  for (const card of document.querySelectorAll<HTMLElement>("[data-edit-asset-card]")) {
    const assetName = card.dataset.editAssetCard;
    if (!assetName) {
      continue;
    }

    card.addEventListener("click", (event) => {
      if (shouldIgnoreWorkspaceCardClick(event.target)) {
        return;
      }

      openAssetEditor(assetName);
      activeSummaryTab = "assets";
      renderPlanner(user);
    });

    card.addEventListener("keydown", (event) => {
      if (event.target !== card || (event.key !== "Enter" && event.key !== " ")) {
        return;
      }

      event.preventDefault();
      openAssetEditor(assetName);
      activeSummaryTab = "assets";
      renderPlanner(user);
    });
  }

  for (const card of document.querySelectorAll<HTMLElement>("[data-edit-flow-card]")) {
    const flowName = card.dataset.editFlowCard;
    if (!flowName) {
      continue;
    }

    card.addEventListener("click", (event) => {
      if (shouldIgnoreWorkspaceCardClick(event.target)) {
        return;
      }

      openFlowEditor(flowName);
      renderPlanner(user);
    });

    card.addEventListener("keydown", (event) => {
      if (event.target !== card || (event.key !== "Enter" && event.key !== " ")) {
        return;
      }

      event.preventDefault();
      openFlowEditor(flowName);
      renderPlanner(user);
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-delete-flow]")) {
    button.addEventListener("click", async () => {
      const deleteFlowName = button.dataset.deleteFlow;
      if (!deleteFlowName) {
        return;
      }

      deleteFlow(deleteFlowName);
      invalidateSimulationState();
      await persistPlannerState(user);
      renderPlanner(user);
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-delete-event]")) {
    button.addEventListener("click", async () => {
      const deleteEventName = button.dataset.deleteEvent;
      if (!deleteEventName) {
        return;
      }

      deleteEvent(deleteEventName);
      invalidateSimulationState();
      await persistPlannerState(user);
      renderPlanner(user);
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-edit-event]")) {
    button.addEventListener("click", () => {
      const eventName = button.dataset.editEvent;
      if (!eventName) {
        return;
      }

      openEventEditor(eventName);
      renderPlanner(user);
    });
  }

  for (const field of document.querySelectorAll<HTMLLabelElement>(".variable-edit-form")) {
    const input = field.querySelector<HTMLInputElement>('input[name="value"]');
    if (!input) {
      continue;
    }

    input.addEventListener("change", async () => {
      const variableName = field.dataset.variableName;
      if (!variableName) {
        return;
      }

      const nextValue = parseEditableNumber(input.value);
      if (!Number.isFinite(nextValue)) {
        input.value = formatEditableNumberInput(
          String(plannerState.variables.find((variable) => variable.name === variableName)?.value ?? 0)
        );
        return;
      }

      updateInitialVariableValue(variableName, nextValue);
      syncSimulationDraftAssetRows();
      invalidateSimulationState();
      await persistPlannerState(user);
      renderPlanner(user);
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-edit-asset-value]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const assetName = button.dataset.editAssetValue;
      if (!assetName) {
        return;
      }

      activeInlineAssetValueEditName = assetName;
      activeInlineExpenseValueEditName = null;
      renderPlanner(user);
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-edit-expense-value]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const flowName = button.dataset.editExpenseValue;
      if (!flowName) {
        return;
      }

      activeInlineExpenseValueEditName = flowName;
      activeInlineAssetValueEditName = null;
      renderPlanner(user);
    });
  }

  for (const form of document.querySelectorAll<HTMLFormElement>("[data-inline-asset-value-form]")) {
    const hiddenInput = form.querySelector<HTMLInputElement>(".formula-editor-hidden-input");
    const editor = form.querySelector<HTMLDivElement>(".formula-editor-input");
    const wrapper = form.querySelector<HTMLElement>("[data-inline-asset-value-input]");
    const assetName = form.dataset.inlineAssetValueForm;
    if (!hiddenInput || !editor || !wrapper || !assetName) {
      continue;
    }

    let canceledByEscape = false;

    wrapper.addEventListener("focusout", () => {
      window.setTimeout(() => {
        if (canceledByEscape || activeInlineAssetValueEditName !== assetName) {
          return;
        }

        if (wrapper.contains(document.activeElement)) {
          return;
        }

        void saveInlineAssetValue(assetName, hiddenInput.value, user);
      }, 0);
    });

    editor.addEventListener("focus", () => {
      canceledByEscape = false;
    });

    editor.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") {
        return;
      }

      canceledByEscape = true;
      activeInlineAssetValueEditName = null;
      renderPlanner(user);
    });
  }

  for (const form of document.querySelectorAll<HTMLFormElement>("[data-inline-expense-value-form]")) {
    const hiddenInput = form.querySelector<HTMLInputElement>(".formula-editor-hidden-input");
    const editor = form.querySelector<HTMLDivElement>(".formula-editor-input");
    const wrapper = form.querySelector<HTMLElement>("[data-inline-expense-value-input]");
    const flowName = form.dataset.inlineExpenseValueForm;
    if (!hiddenInput || !editor || !wrapper || !flowName) {
      continue;
    }

    let canceledByEscape = false;

    wrapper.addEventListener("focusout", () => {
      window.setTimeout(() => {
        if (canceledByEscape || activeInlineExpenseValueEditName !== flowName) {
          return;
        }

        if (wrapper.contains(document.activeElement)) {
          return;
        }

        void saveInlineExpenseValue(flowName, hiddenInput.value, user);
      }, 0);
    });

    editor.addEventListener("focus", () => {
      canceledByEscape = false;
    });

    editor.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") {
        return;
      }

      canceledByEscape = true;
      activeInlineExpenseValueEditName = null;
      renderPlanner(user);
    });
  }

  bindFormulaEditors();
  bindAssetComposer(user);
  bindAssetEditor(user);
  bindTaxComposer(user);
  bindTaxProfileForm(user);
  bindFlowComposer(user);
  bindFlowEditor(user);
  bindEventComposer(user);
  focusNewFlowNameInput();
  focusAssetStartingValueInputIfZero();
}

function focusInlineAssetValueInput(): void {
  if (!activeInlineAssetValueEditName) {
    return;
  }

  const editor = document.querySelector<HTMLDivElement>(
    `[data-inline-asset-value-form="${CSS.escape(activeInlineAssetValueEditName)}"] [data-inline-asset-value-input] .formula-editor-input`
  );
  if (!editor) {
    return;
  }

  editor.focus();
  setCaretCharacterOffset(editor, editor.textContent?.length ?? 0);
}

function focusInlineExpenseValueInput(): void {
  if (!activeInlineExpenseValueEditName) {
    return;
  }

  const editor = document.querySelector<HTMLDivElement>(
    `[data-inline-expense-value-form="${CSS.escape(activeInlineExpenseValueEditName)}"] [data-inline-expense-value-input] .formula-editor-input`
  );
  if (!editor) {
    return;
  }

  editor.focus();
  setCaretCharacterOffset(editor, editor.textContent?.length ?? 0);
}

function bindFormulaEditors(): void {
  for (const wrapper of document.querySelectorAll<HTMLElement>("[data-formula-editor]")) {
    const editor = wrapper.querySelector<HTMLDivElement>(".formula-editor-input");
    const hiddenInput = wrapper.querySelector<HTMLInputElement>(".formula-editor-hidden-input");
    const status = wrapper.querySelector<HTMLElement>(".formula-editor-status");
    const menu = wrapper.querySelector<HTMLDivElement>(".formula-editor-menu");
    const form = wrapper.closest("form");

    if (!editor || !hiddenInput || !status || !menu || !form) {
      continue;
    }

    const binding: FormulaEditorBinding = {
      wrapper,
      editor,
      hiddenInput,
      status,
      form,
      getVariables: () => getFormulaEditorVariableNames(wrapper),
    };

    let activeSuggestionIndex = 0;

    const syncEditor = (preferredCaretOffset?: number) => {
      const rawFormula = normalizeEditorText(editor.textContent ?? "");
      const rawCaretOffset = preferredCaretOffset ?? getCaretCharacterOffset(editor);
      const formula = formatFormulaText(rawFormula);
      const caretOffset = formatFormulaText(rawFormula.slice(0, rawCaretOffset)).length;
      syncFormulaEditorDisplayType(wrapper, formula);
      hiddenInput.value = formula;
      renderFormulaEditorTokens(binding, formula, caretOffset);
      syncFormulaDraftField(wrapper, formula);
      updateFormulaEditorValidation(binding);
      renderFormulaSuggestionMenu(binding, menu, {
        index: activeSuggestionIndex,
        onIndexChange(nextIndex) {
          activeSuggestionIndex = nextIndex;
        },
      });
      updateFormSubmissionState(form);
    };

    editor.addEventListener("input", () => {
      wrapper.dataset.interacted = "true";
      activeSuggestionIndex = 0;
      syncEditor();
    });

    editor.addEventListener("focus", () => {
      syncEditor();
    });

    editor.addEventListener("click", () => {
      renderFormulaSuggestionMenu(binding, menu, {
        index: activeSuggestionIndex,
        onIndexChange(nextIndex) {
          activeSuggestionIndex = nextIndex;
        },
      });
    });

    editor.addEventListener("keydown", (event) => {
      const suggestions = getFormulaSuggestions(binding);
      if (event.key === "Enter" && suggestions.length === 0) {
        event.preventDefault();

        if (
          wrapper.closest("[data-inline-asset-value-form]") ||
          wrapper.closest("[data-inline-expense-value-form]") ||
          wrapper.closest("[data-inline-flow-event-formula-editor]")
        ) {
          editor.blur();
          return;
        }

        form.requestSubmit();
        return;
      }

      if (suggestions.length === 0) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        activeSuggestionIndex = (activeSuggestionIndex + 1) % suggestions.length;
        renderFormulaSuggestionMenu(binding, menu, {
          index: activeSuggestionIndex,
          onIndexChange(nextIndex) {
            activeSuggestionIndex = nextIndex;
          },
        });
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        activeSuggestionIndex = (activeSuggestionIndex - 1 + suggestions.length) % suggestions.length;
        renderFormulaSuggestionMenu(binding, menu, {
          index: activeSuggestionIndex,
          onIndexChange(nextIndex) {
            activeSuggestionIndex = nextIndex;
          },
        });
        return;
      }

      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        applyFormulaSuggestion(binding, suggestions[activeSuggestionIndex] ?? suggestions[0]);
        activeSuggestionIndex = 0;
        renderFormulaSuggestionMenu(binding, menu, {
          index: activeSuggestionIndex,
          onIndexChange(nextIndex) {
            activeSuggestionIndex = nextIndex;
          },
        });
        updateFormSubmissionState(form);
        return;
      }

      if (event.key === "Escape") {
        menu.hidden = true;
      }
    });

    menu.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const button = target.closest<HTMLButtonElement>("[data-formula-suggestion]");
      if (!button) {
        return;
      }

      applyFormulaSuggestion(binding, button.dataset.formulaSuggestion ?? "");
      activeSuggestionIndex = 0;
      renderFormulaSuggestionMenu(binding, menu, {
        index: activeSuggestionIndex,
        onIndexChange(nextIndex) {
          activeSuggestionIndex = nextIndex;
        },
      });
      updateFormSubmissionState(form);
    });

    editor.addEventListener("blur", () => {
      window.setTimeout(() => {
        if (!wrapper.contains(document.activeElement)) {
          menu.hidden = true;
        }
      }, 0);
    });

    syncEditor(hiddenInput.value.length);
  }
}

function refreshFormulaEditors(form: HTMLFormElement): void {
  for (const wrapper of form.querySelectorAll<HTMLElement>("[data-formula-editor]")) {
    const editor = wrapper.querySelector<HTMLDivElement>(".formula-editor-input");
    const hiddenInput = wrapper.querySelector<HTMLInputElement>(".formula-editor-hidden-input");
    const status = wrapper.querySelector<HTMLElement>(".formula-editor-status");

    if (!editor || !hiddenInput || !status) {
      continue;
    }

    const binding: FormulaEditorBinding = {
      wrapper,
      editor,
      hiddenInput,
      status,
      form,
      getVariables: () => getFormulaEditorVariableNames(wrapper),
    };

    const caretOffset =
      document.activeElement === editor ? getCaretCharacterOffset(editor) : hiddenInput.value.length;
    syncFormulaEditorDisplayType(wrapper, hiddenInput.value);
    renderFormulaEditorTokens(binding, hiddenInput.value, caretOffset);
    updateFormulaEditorValidation(binding);
  }

  updateFormSubmissionState(form);
}

function getFormulaEditorVariableNames(wrapper: HTMLElement): string[] {
  const scope = wrapper.dataset.variablesScope;

  switch (scope) {
    case "event-draft":
      return getEventDraftVariableNames();
    case "planner":
    default:
      return plannerState.variables.map((variable) => variable.name);
  }
}

function getEventDraftVariableNames(): string[] {
  const names = new Set<string>(plannerState.variables.map((variable) => variable.name));
  for (const entry of eventDraft.entries) {
    for (const action of entry.actions) {
      if (action.kind !== "add-variable") {
        continue;
      }

      const name = action.variableDefinitionName.trim();
      if (name) {
        names.add(name);
      }
    }
  }

  return [...names];
}

function syncFormulaDraftField(wrapper: HTMLElement, formula: string): void {
  const fieldToken = wrapper.dataset.fieldToken;
  if (fieldToken) {
    const [entryId, actionId, field] = fieldToken.split(":");
    updateDraftActionField(findDraftAction(entryId, actionId), field, formula);
    return;
  }

  const inputName = wrapper.querySelector<HTMLInputElement>(".formula-editor-hidden-input")?.name;
  if (inputName === "startingValue" || inputName === "initialCost") {
    if (wrapper.closest("#asset-form")) {
      if (inputName === "startingValue") {
        assetDraft.startingValue = formula;
      } else {
        assetDraft.initialCost = formula;
      }
      return;
    }

    if (wrapper.closest("#asset-edit-form")) {
      if (inputName === "startingValue") {
        assetEditDraft.startingValue = formula;
      } else {
        assetEditDraft.initialCost = formula;
      }
      return;
    }
  }

  if (inputName === "formula") {
    if (wrapper.closest("#flow-form")) {
      flowDraft.formula = formula;
      return;
    }

    if (wrapper.closest("#flow-edit-form")) {
      flowEditDraft.formula = formula;
    }

    return;
  }

  if (inputName === "flowEventFormula") {
    flowEventDraft.formula = formula;
  }
}

function normalizeEditorText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\n/g, "").trim();
}

function isPlainNumericFormula(formula: string): boolean {
  return /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?$|^[+-]?\.\d+$/.test(formula.trim());
}

function syncFormulaEditorDisplayType(wrapper: HTMLElement, formula: string): void {
  wrapper.dataset.plainNumeric = isPlainNumericFormula(formula) ? "true" : "false";
}

function resolveAssetValueInput(
  input: string,
  fieldLabel: "Value" | "Home price"
): {
  value: number;
  formula?: string;
} {
  const formula = input.trim();
  if (!formula) {
    throw new Error(`${fieldLabel} is required.`);
  }

  const value = evaluateFormula(formula, buildPlannerFormulaContext());
  if (!Number.isFinite(value)) {
    throw new Error(`${fieldLabel} must resolve to a finite number.`);
  }

  return {
    value,
    ...(isPlainNumericFormula(formula) ? {} : { formula }),
  };
}

function getEventDraftVariableDefinitionNames(): string[] {
  return eventDraft.entries
    .flatMap((entry) => entry.actions)
    .filter((action) => action.kind === "add-variable")
    .map((action) => action.variableDefinitionName.trim())
    .filter(Boolean);
}

function getEventDraftFormulas(draft: EventDraft): string[] {
  return draft.entries.flatMap((entry) =>
    entry.actions.flatMap((action) => {
      switch (action.kind) {
        case "set-flow-formula":
          return [action.formula.trim()];
        case "add-flow":
          return [action.flowDefinitionFormula.trim()];
        case "one-time-expense":
          return [action.oneTimeExpenseFormula.trim()];
        default:
          return [];
      }
    })
  );
}

function validateFormula(
  formula: string,
  availableVariables: readonly string[],
  requiredLabel = "Formula"
): FormulaValidationResult {
  if (!formula.trim()) {
    return {
      valid: false,
      message: `${requiredLabel} is required.`,
      unknownVariables: [],
    };
  }

  try {
    const referencedVariables = [...collectFormulaVariableNames(formula)];
    const available = new Set(availableVariables);
    const unknownVariables = referencedVariables.filter((name) => !available.has(name));

    if (unknownVariables.length > 0) {
      return {
        valid: true,
        message: `Will create variable${unknownVariables.length === 1 ? "" : "s"} on save: ${unknownVariables.join(", ")}`,
        unknownVariables,
      };
    }

    return {
      valid: true,
      message: "",
      unknownVariables: [],
    };
  } catch (error) {
    return {
      valid: false,
      message: error instanceof Error ? error.message : "Invalid formula.",
      unknownVariables: [],
    };
  }
}

function updateFormulaEditorValidation(binding: FormulaEditorBinding): void {
  const shouldDeferRequiredValidation =
    !binding.hiddenInput.value.trim() &&
    binding.wrapper.dataset.interacted !== "true" &&
    binding.form.dataset.formulaValidationSubmitted !== "true";

  const result = shouldDeferRequiredValidation
    ? {
        valid: true,
        message: "",
        unknownVariables: [],
      }
    : validateFormula(binding.hiddenInput.value, binding.getVariables(), binding.wrapper.dataset.requiredLabel ?? "Formula");

  binding.wrapper.dataset.invalid = result.valid ? "false" : "true";
  binding.status.textContent = result.message;
  binding.status.dataset.invalid = result.valid ? "false" : "true";
  binding.status.hidden = result.message.length === 0;
}

function setDisabledReasonControlsHighlighted(controls: HTMLElement[] | undefined, highlighted: boolean): void {
  for (const control of controls ?? []) {
    if (highlighted) {
      control.dataset.disabledReasonControl = "true";
    } else {
      delete control.dataset.disabledReasonControl;
    }
  }
}

function bindDisabledReasonAnchorControls(anchor: HTMLElement, button: HTMLButtonElement): void {
  if (anchor.dataset.disabledReasonControlsBound === "true") {
    return;
  }

  anchor.dataset.disabledReasonControlsBound = "true";
  anchor.addEventListener("pointerenter", () => {
    setDisabledReasonControlsHighlighted(button.disabledReasonControls, true);
  });
  anchor.addEventListener("pointerleave", () => {
    setDisabledReasonControlsHighlighted(button.disabledReasonControls, false);
  });
  anchor.addEventListener("focusin", () => {
    setDisabledReasonControlsHighlighted(button.disabledReasonControls, true);
  });
  anchor.addEventListener("focusout", () => {
    setDisabledReasonControlsHighlighted(button.disabledReasonControls, false);
  });
}

function setButtonDisabledReason(
  button: HTMLButtonElement,
  { reason, controls }: DisabledSubmitState
): void {
  const anchor = getButtonDisabledReasonAnchor(button);
  bindDisabledReasonAnchorControls(anchor, button);
  setDisabledReasonControlsHighlighted(button.disabledReasonControls, false);
  button.disabledReason = reason || undefined;
  button.disabledReasonControls = reason ? controls : [];
  button.disabled = Boolean(button.disabledReason);
  button.setAttribute("aria-disabled", button.disabledReason ? "true" : "false");
  button.title = "";
  if (button.disabledReason) {
    anchor.dataset.disabledReason = button.disabledReason;
  } else {
    delete anchor.dataset.disabledReason;
    delete button.dataset.disabledReason;
  }
}

function getButtonDisabledReasonAnchor(button: HTMLButtonElement): HTMLElement {
  const parent = button.parentElement;
  if (parent?.classList.contains("disabled-reason-anchor")) {
    return parent;
  }

  const anchor = document.createElement("span");
  anchor.className = "disabled-reason-anchor";
  button.parentNode?.insertBefore(anchor, button);
  anchor.appendChild(button);
  return anchor;
}

function getNamedInputControl(form: HTMLFormElement, name: string): HTMLElement | null {
  return form.querySelector<HTMLElement>(`[name="${name}"]`);
}

function getFormulaEditorControlByInputName(form: HTMLFormElement, name: string): HTMLElement | null {
  const input = form.querySelector<HTMLInputElement>(`.formula-editor-hidden-input[name="${name}"]`);
  return input?.closest<HTMLElement>("[data-formula-editor]") ?? input;
}

function getInvalidFormulaSubmitState(form: HTMLFormElement): DisabledSubmitState {
  const invalidFormulas = [...form.querySelectorAll<HTMLElement>("[data-formula-editor]")]
    .filter((wrapper) => wrapper.dataset.invalid === "true");
  if (invalidFormulas.length === 0) {
    return { reason: "", controls: [] };
  }

  const status = invalidFormulas[0]?.querySelector<HTMLElement>(".formula-editor-status");
  const reason = status?.textContent?.trim() || "Fix the highlighted formula.";
  return {
    reason,
    controls: invalidFormulas.filter((wrapper) => {
      const wrapperReason =
        wrapper.querySelector<HTMLElement>(".formula-editor-status")?.textContent?.trim() ||
        "Fix the highlighted formula.";
      return wrapperReason === reason;
    }),
  };
}

function getAssetDraftSubmitDisabledState(form: HTMLFormElement, draft: AssetDraft | AssetEditDraft): DisabledSubmitState {
  if (!draft.name.trim()) {
    const nameInput = getNamedInputControl(form, "assetLabel");
    return {
      reason: "Enter an asset name.",
      controls: nameInput ? [nameInput] : [],
    };
  }

  const invalidFormulaState = getInvalidFormulaSubmitState(form);
  if (invalidFormulaState.reason) {
    return invalidFormulaState;
  }

  if (draft.kind === "home" && doesAssetValueResolveToZero(draft.initialCost)) {
    const homePriceControl = getFormulaEditorControlByInputName(form, "initialCost");
    return {
      reason: "Home price must be greater than 0.",
      controls: homePriceControl ? [homePriceControl] : [],
    };
  }

  if (draft.kind !== "home" && doesAssetValueResolveToZero(draft.startingValue)) {
    const startingValueControl = getFormulaEditorControlByInputName(form, "startingValue");
    return {
      reason: "Starting value must be greater than 0.",
      controls: startingValueControl ? [startingValueControl] : [],
    };
  }

  return { reason: "", controls: [] };
}

function getFlowChangeSubmitDisabledState(form: HTMLFormElement, draft: FlowDraft | FlowEditDraft): DisabledSubmitState {
  if (draft.oneTime || !form.querySelector(".flow-editor-events-section")) {
    return { reason: "", controls: [] };
  }

  const formulaControl = getFormulaEditorControlByInputName(form, "flowEventFormula");
  const reason = "Enter a formula for the change over time.";

  if (activeFlowEventEdit && !flowEventDraft.formula.trim()) {
    return {
      reason,
      controls: formulaControl ? [formulaControl] : [],
    };
  }

  if ("changeEvents" in draft && draft.changeEvents.some((change) => !change.formula.trim())) {
    return {
      reason,
      controls: formulaControl ? [formulaControl] : [],
    };
  }

  if ("originalName" in draft) {
    const hasEmptyChange = getExpenseChangeEvents(draft.originalName).some((event) => {
      const action = event.schedule[0]?.actions[0];
      return action?.kind === "set-flow-formula" && !action.formula.trim();
    });

    if (hasEmptyChange) {
      return {
        reason,
        controls: formulaControl ? [formulaControl] : [],
      };
    }
  }

  return { reason: "", controls: [] };
}

function getFlowDraftSubmitDisabledState(form: HTMLFormElement, draft: FlowDraft | FlowEditDraft): DisabledSubmitState {
  if (!draft.name.trim()) {
    const nameInput = getNamedInputControl(form, "flowLabel");
    return {
      reason: `Enter ${draft.type === "income" ? "an income" : "an expense"} name.`,
      controls: nameInput ? [nameInput] : [],
    };
  }

  if (!draft.formula.trim()) {
    const formulaControl = getFormulaEditorControlByInputName(form, "formula");
    return {
      reason: `Enter a ${draft.type} amount.`,
      controls: formulaControl ? [formulaControl] : [],
    };
  }

  const invalidFormulaState = getInvalidFormulaSubmitState(form);
  if (invalidFormulaState.reason) {
    return invalidFormulaState;
  }

  const invalidChangeState = getFlowChangeSubmitDisabledState(form, draft);
  if (invalidChangeState.reason) {
    return invalidChangeState;
  }

  if (draft.oneTime && !/^\d{4}$/.test(draft.oneTimeYear.trim())) {
    const yearInput = getNamedInputControl(form, "oneTimeYear");
    return {
      reason: `Enter a one-time ${draft.type} year.`,
      controls: yearInput ? [yearInput] : [],
    };
  }

  try {
    const resolvedAmount = evaluateFormula(draft.formula, buildPlannerFormulaContext());
    if (Number.isFinite(resolvedAmount) && resolvedAmount < 0) {
      const formulaControl = getFormulaEditorControlByInputName(form, "formula");
      return {
        reason: `${draft.type === "income" ? "Income" : "Expense"} amount cannot be negative.`,
        controls: formulaControl ? [formulaControl] : [],
      };
    }
  } catch {
    // Unknown variables are valid here because they can be created on save.
  }

  return { reason: "", controls: [] };
}

function getFormSubmitDisabledState(form: HTMLFormElement): DisabledSubmitState {
  if (form.id === "asset-form") {
    return getAssetDraftSubmitDisabledState(form, assetDraft);
  }

  if (form.id === "asset-edit-form") {
    return getAssetDraftSubmitDisabledState(form, assetEditDraft);
  }

  if (form.id === "flow-form") {
    return getFlowDraftSubmitDisabledState(form, flowDraft);
  }

  if (form.id === "flow-edit-form") {
    return getFlowDraftSubmitDisabledState(form, flowEditDraft);
  }

  return getInvalidFormulaSubmitState(form);
}

function updateFormSubmissionState(form: HTMLFormElement): void {
  const disabledState = getFormSubmitDisabledState(form);

  for (const submitButton of form.querySelectorAll<HTMLButtonElement>('button[type="submit"]')) {
    setButtonDisabledReason(submitButton, disabledState);
  }
}

function hasInvalidFormulaEditors(form: HTMLFormElement): boolean {
  return [...form.querySelectorAll<HTMLElement>("[data-formula-editor]")]
    .some((wrapper) => wrapper.dataset.invalid === "true");
}

function markFormulaEditorsSubmitted(form: HTMLFormElement): void {
  form.dataset.formulaValidationSubmitted = "true";
  refreshFormulaEditors(form);
}

function renderFormulaEditorTokens(
  binding: FormulaEditorBinding,
  formula: string,
  preferredCaretOffset: number
): void {
  const variables = new Set(binding.getVariables());
  const tokens = tokenizeFormulaText(formula);

  binding.editor.innerHTML = tokens
    .map((token) => {
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) {
        const valid = variables.has(token);
        return `<span class="${valid ? "formula-token formula-token-variable" : "formula-token formula-token-variable is-new-variable"}">${escapeHtml(token)}</span>`;
      }

      if (/^\s+$/.test(token)) {
        return token.replaceAll(" ", "&nbsp;");
      }

      if (isFormulaNumberToken(token)) {
        return `<span class="formula-token formula-token-number">${escapeHtml(formatFormulaNumberToken(token))}</span>`;
      }

      return `<span class="formula-token formula-token-operator">${escapeHtml(token)}</span>`;
    })
    .join("");

  if (!tokens.length) {
    binding.editor.innerHTML = "";
  }

  if (document.activeElement === binding.editor) {
    setCaretCharacterOffset(binding.editor, Math.min(preferredCaretOffset, formula.length));
  }
}

function getCaretCharacterOffset(root: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return root.textContent?.length ?? 0;
  }

  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) {
    return root.textContent?.length ?? 0;
  }

  const preRange = range.cloneRange();
  preRange.selectNodeContents(root);
  preRange.setEnd(range.startContainer, range.startOffset);
  return preRange.toString().length;
}

function setCaretCharacterOffset(root: HTMLElement, offset: number): void {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let currentOffset = 0;
  let textNode: Text | null = null;
  let localOffset = 0;

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const nextOffset = currentOffset + node.data.length;
    if (offset <= nextOffset) {
      textNode = node;
      localOffset = offset - currentOffset;
      break;
    }
    currentOffset = nextOffset;
  }

  const range = document.createRange();
  if (textNode) {
    range.setStart(textNode, Math.max(0, localOffset));
  } else {
    range.selectNodeContents(root);
    range.collapse(false);
  }

  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function getIdentifierAtCaret(formula: string, offset: number): { start: number; end: number; value: string } | null {
  const clampedOffset = Math.max(0, Math.min(offset, formula.length));
  const tokenPattern = /[A-Za-z_][A-Za-z0-9_]*/g;

  for (const match of formula.matchAll(tokenPattern)) {
    const value = match[0];
    const start = match.index ?? 0;
    const end = start + value.length;
    if (clampedOffset >= start && clampedOffset <= end) {
      return { start, end, value };
    }
  }

  const partialMatch = /[A-Za-z_][A-Za-z0-9_]*$/.exec(formula.slice(0, clampedOffset));
  if (!partialMatch) {
    return null;
  }

  return {
    start: clampedOffset - partialMatch[0].length,
    end: clampedOffset,
    value: partialMatch[0],
  };
}

function getFormulaSuggestions(binding: FormulaEditorBinding): string[] {
  const formula = binding.hiddenInput.value;
  const identifier = getIdentifierAtCaret(formula, getCaretCharacterOffset(binding.editor));
  if (!identifier) {
    return [];
  }

  const query = identifier.value.toLowerCase();
  return binding
    .getVariables()
    .filter((name) => name.toLowerCase().includes(query) && name !== identifier.value)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 6);
}

function renderFormulaSuggestionMenu(
  binding: FormulaEditorBinding,
  menu: HTMLDivElement,
  controller: { index: number; onIndexChange: (nextIndex: number) => void }
): void {
  const suggestions = getFormulaSuggestions(binding);
  if (suggestions.length === 0) {
    menu.hidden = true;
    menu.innerHTML = "";
    controller.onIndexChange(0);
    return;
  }

  const nextIndex = Math.max(0, Math.min(controller.index, suggestions.length - 1));
  controller.onIndexChange(nextIndex);
  menu.hidden = false;
  menu.innerHTML = suggestions
    .map(
      (suggestion, index) => `
        <button
          type="button"
          class="${index === nextIndex ? "formula-suggestion is-active" : "formula-suggestion"}"
          data-formula-suggestion="${escapeAttribute(suggestion)}"
        >
          ${escapeHtml(suggestion)}
        </button>
      `
    )
    .join("");
}

function applyFormulaSuggestion(binding: FormulaEditorBinding, suggestion: string): void {
  if (!suggestion) {
    return;
  }

  const formula = binding.hiddenInput.value;
  const caretOffset = getCaretCharacterOffset(binding.editor);
  const identifier = getIdentifierAtCaret(formula, caretOffset);
  if (!identifier) {
    return;
  }

  const nextFormula = `${formula.slice(0, identifier.start)}${suggestion}${formula.slice(identifier.end)}`;
  binding.hiddenInput.value = nextFormula;
  renderFormulaEditorTokens(binding, nextFormula, identifier.start + suggestion.length);
  syncFormulaDraftField(binding.wrapper, nextFormula);
  updateFormulaEditorValidation(binding);
}

function bindAssetComposer(user: UserIdentity): void {
  const assetForm = document.querySelector<HTMLFormElement>("#asset-form");
  if (!assetForm) {
    return;
  }

  assetForm.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
      return;
    }

    const cashGenerationField = target.dataset.cashGenerationField;
    if (cashGenerationField) {
      const [cashGenerationId, field] = cashGenerationField.split(":");
      const cashGeneration = findAssetCashGenerationDraft(assetDraft, cashGenerationId);
      if (field === "name") {
        cashGeneration.name = target.value;
      } else if (field === "rate") {
        cashGeneration.rate = target.value;
      } else if (field === "volatility") {
        cashGeneration.volatility = target.value;
      } else if (field === "inflationCorrelation") {
        cashGeneration.inflationCorrelation = target.value;
      } else if (field === "taxTreatment") {
        cashGeneration.taxTreatment = target.value as AssetCashTaxTreatment;
      }
      syncAssetCashGenerationDraftPresentation(assetForm, assetDraft, cashGenerationId);
      return;
    }

    if (target.name === "assetLabel") {
      assetDraft.name = target.value;
    } else if (target.name === "kind") {
      assetDraft.kind = target.value as AssetDraftKind;
      applyAssetTypePresetDefaults(assetDraft);
      shouldFocusAssetStartingValueIfZero = assetDraft.kind !== "home" && isZeroValueInput(assetDraft.startingValue);
      renderPlanner(user);
      return;
    } else if (target.name === "advancedSettingsEnabled") {
      assetDraft.detailMode = target instanceof HTMLInputElement && target.checked ? "advanced" : "basic";
      renderPlanner(user);
      return;
    } else if (target.name === "startingValue") {
      assetDraft.startingValue = target.value;
    } else if (target.name === "initialCost") {
      assetDraft.initialCost = target.value;
    } else if (target.name === "cashPurchasePercent") {
      assetDraft.cashPurchasePercent = target.value;
    } else if (target.name === "closingCostPercent") {
      assetDraft.closingCostPercent = target.value;
    } else if (target.name === "mortgageType") {
      assetDraft.mortgageType = target.value as AssetDraft["mortgageType"];
      if (assetDraft.mortgageType !== "interest-only") {
        assetDraft.interestOnlyMaturityAction = "payoff";
      }
      renderPlanner(user);
      return;
    } else if (target.name === "interestOnlyMaturityAction") {
      assetDraft.interestOnlyMaturityAction = target.value as AssetDraft["interestOnlyMaturityAction"];
    } else if (target.name === "mortgageRate") {
      assetDraft.mortgageRate = target.value;
    } else if (target.name === "mortgageTermYears") {
      assetDraft.mortgageTermYears = target.value;
    } else if (target.name === "monthlyNonTaxCosts") {
      assetDraft.monthlyNonTaxCosts = target.value;
    } else if (target.name === "propertyTaxRate") {
      assetDraft.propertyTaxRate = target.value;
    } else if (target.name === "purchaseYear") {
      assetDraft.purchaseYear = target.value;
    } else if (target.name === "expectedReturn") {
      assetDraft.expectedReturn = target.value;
    } else if (target.name === "volatility") {
      assetDraft.volatility = target.value;
    } else if (target.name === "cashGenerationEnabled") {
      assetDraft.cashGenerationEnabled = target instanceof HTMLInputElement ? target.checked : target.value === "true";
      if (assetDraft.cashGenerationEnabled && assetDraft.cashGenerations.length === 0) {
        assetDraft.cashGenerations = [createAssetCashGenerationDraft(assetDraft.kind, { expanded: true })];
      }
      renderPlanner(user);
      return;
    } else if (target.name === "saleTaxEnabled") {
      assetDraft.saleTaxEnabled = target instanceof HTMLInputElement ? target.checked : target.value === "true";
      assetDraft.saleTaxExpanded = false;
      renderPlanner(user);
      return;
    } else if (target.name === "saleTaxCostBasis") {
      assetDraft.saleTaxCostBasis = target.value;
    } else if (target.name === "saleTaxTreatment") {
      assetDraft.saleTaxTreatment = target.value as AssetSaleTaxTreatment;
    }

    updateFormSubmissionState(assetForm);
  });

  assetForm.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const button = target.closest<HTMLButtonElement>("button");
    if (!button) {
      return;
    }

    const toggleCashGenerationId = button.dataset.toggleCashGeneration;
    if (toggleCashGenerationId) {
      const cashGeneration = findAssetCashGenerationDraft(assetDraft, toggleCashGenerationId);
      cashGeneration.expanded = !cashGeneration.expanded;
      renderPlanner(user);
      return;
    }

    if (button.dataset.toggleSaleTax === "true") {
      assetDraft.saleTaxExpanded = !assetDraft.saleTaxExpanded;
      renderPlanner(user);
      return;
    }

    if (button.id === "add-cash-generation") {
      assetDraft.cashGenerations.push(createAssetCashGenerationDraft(assetDraft.kind, { expanded: true }));
      renderPlanner(user);
      return;
    }

    const removeCashGenerationId = button.dataset.removeCashGeneration;
    if (removeCashGenerationId) {
      assetDraft.cashGenerations = assetDraft.cashGenerations.filter((candidate) => candidate.id !== removeCashGenerationId);
      if (assetDraft.cashGenerations.length === 0) {
        assetDraft.cashGenerations = [createAssetCashGenerationDraft(assetDraft.kind, { expanded: true })];
      }
      renderPlanner(user);
      return;
    }

    if (button.id === "close-asset-composer" || button.id === "close-asset-composer-secondary") {
      closeAssetComposer();
      renderPlanner(user);
    }
  });

  assetForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const disabledState = getAssetDraftSubmitDisabledState(assetForm, assetDraft);
    if (disabledState.reason) {
      updateFormSubmissionState(assetForm);
      return;
    }

    try {
      ensurePlannerVariablesExist(
        collectMissingFormulaVariables([assetDraft.kind === "home" ? assetDraft.initialCost : assetDraft.startingValue])
      );
      const nextAsset = buildAssetDefinition(assetDraft);
      assertAssetNameAvailable(nextAsset.name, null);
      plannerState.assets.push(nextAsset);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Asset could not be saved.");
      return;
    }
    syncSimulationDraftAssetRows();
    invalidateSimulationState();
    closeAssetComposer();
    activeSummaryTab = "assets";
    await persistPlannerState(user);
    renderPlanner(user);
  });
}

function bindAssetEditor(user: UserIdentity): void {
  const assetEditForm = document.querySelector<HTMLFormElement>("#asset-edit-form");
  const assetEditorPanel = assetEditForm?.closest<HTMLElement>(".asset-panel");
  if (!assetEditForm || !assetEditorPanel) {
    return;
  }

  assetEditForm.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
      return;
    }

    const cashGenerationField = target.dataset.cashGenerationField;
    if (cashGenerationField) {
      const [cashGenerationId, field] = cashGenerationField.split(":");
      const cashGeneration = findAssetCashGenerationDraft(assetEditDraft, cashGenerationId);
      if (field === "name") {
        cashGeneration.name = target.value;
      } else if (field === "rate") {
        cashGeneration.rate = target.value;
      } else if (field === "volatility") {
        cashGeneration.volatility = target.value;
      } else if (field === "inflationCorrelation") {
        cashGeneration.inflationCorrelation = target.value;
      } else if (field === "taxTreatment") {
        cashGeneration.taxTreatment = target.value as AssetCashTaxTreatment;
      }
      syncAssetCashGenerationDraftPresentation(assetEditForm, assetEditDraft, cashGenerationId);
      return;
    }

    if (target.name === "assetLabel") {
      assetEditDraft.name = target.value;
    } else if (target.name === "kind") {
      assetEditDraft.kind = target.value as AssetDraftKind;
      applyAssetTypePresetDefaults(assetEditDraft);
      renderPlanner(user);
      return;
    } else if (target.name === "advancedSettingsEnabled") {
      assetEditDraft.detailMode = target instanceof HTMLInputElement && target.checked ? "advanced" : "basic";
      renderPlanner(user);
      return;
    } else if (target.name === "startingValue") {
      assetEditDraft.startingValue = target.value;
    } else if (target.name === "initialCost") {
      assetEditDraft.initialCost = target.value;
    } else if (target.name === "cashPurchasePercent") {
      assetEditDraft.cashPurchasePercent = target.value;
    } else if (target.name === "closingCostPercent") {
      assetEditDraft.closingCostPercent = target.value;
    } else if (target.name === "mortgageType") {
      assetEditDraft.mortgageType = target.value as AssetDraft["mortgageType"];
      if (assetEditDraft.mortgageType !== "interest-only") {
        assetEditDraft.interestOnlyMaturityAction = "payoff";
      }
      renderPlanner(user);
      return;
    } else if (target.name === "interestOnlyMaturityAction") {
      assetEditDraft.interestOnlyMaturityAction = target.value as AssetDraft["interestOnlyMaturityAction"];
    } else if (target.name === "mortgageRate") {
      assetEditDraft.mortgageRate = target.value;
    } else if (target.name === "mortgageTermYears") {
      assetEditDraft.mortgageTermYears = target.value;
    } else if (target.name === "monthlyNonTaxCosts") {
      assetEditDraft.monthlyNonTaxCosts = target.value;
    } else if (target.name === "propertyTaxRate") {
      assetEditDraft.propertyTaxRate = target.value;
    } else if (target.name === "purchaseYear") {
      assetEditDraft.purchaseYear = target.value;
    } else if (target.name === "expectedReturn") {
      assetEditDraft.expectedReturn = target.value;
    } else if (target.name === "volatility") {
      assetEditDraft.volatility = target.value;
    } else if (target.name === "cashGenerationEnabled") {
      assetEditDraft.cashGenerationEnabled = target instanceof HTMLInputElement ? target.checked : target.value === "true";
      if (assetEditDraft.cashGenerationEnabled && assetEditDraft.cashGenerations.length === 0) {
        assetEditDraft.cashGenerations = [createAssetCashGenerationDraft(assetEditDraft.kind, { expanded: true })];
      }
      renderPlanner(user);
      return;
    } else if (target.name === "saleTaxEnabled") {
      assetEditDraft.saleTaxEnabled = target instanceof HTMLInputElement ? target.checked : target.value === "true";
      assetEditDraft.saleTaxExpanded = false;
      renderPlanner(user);
      return;
    } else if (target.name === "saleTaxCostBasis") {
      assetEditDraft.saleTaxCostBasis = target.value;
    } else if (target.name === "saleTaxTreatment") {
      assetEditDraft.saleTaxTreatment = target.value as AssetSaleTaxTreatment;
    } else if (target.dataset.assetCorrelation) {
      assetEditDraft.correlations[target.dataset.assetCorrelation] = target.value;
    }

    updateFormSubmissionState(assetEditForm);
  });

  assetEditorPanel.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const button = target.closest<HTMLButtonElement>("button");
    if (!button) {
      return;
    }

    const toggleCashGenerationId = button.dataset.toggleCashGeneration;
    if (toggleCashGenerationId) {
      const cashGeneration = findAssetCashGenerationDraft(assetEditDraft, toggleCashGenerationId);
      cashGeneration.expanded = !cashGeneration.expanded;
      renderPlanner(user);
      return;
    }

    if (button.dataset.toggleSaleTax === "true") {
      assetEditDraft.saleTaxExpanded = !assetEditDraft.saleTaxExpanded;
      renderPlanner(user);
      return;
    }

    if (button.id === "add-cash-generation") {
      assetEditDraft.cashGenerations.push(createAssetCashGenerationDraft(assetEditDraft.kind, { expanded: true }));
      renderPlanner(user);
      return;
    }

    const removeCashGenerationId = button.dataset.removeCashGeneration;
    if (removeCashGenerationId) {
      assetEditDraft.cashGenerations = assetEditDraft.cashGenerations.filter(
        (candidate) => candidate.id !== removeCashGenerationId
      );
      if (assetEditDraft.cashGenerations.length === 0) {
        assetEditDraft.cashGenerations = [createAssetCashGenerationDraft(assetEditDraft.kind, { expanded: true })];
      }
      renderPlanner(user);
      return;
    }

    if (button.id === "delete-asset-from-editor") {
      const confirmed = window.confirm(`Delete asset "${assetEditDraft.originalName}"? This will also remove its correlations.`);
      if (!confirmed) {
        return;
      }

      deleteAsset(assetEditDraft.originalName);
      syncSimulationDraftAssetRows();
      invalidateSimulationState();
      closeAssetEditor();
      void persistPlannerState(user).then(() => {
        renderPlanner(user);
      });
      return;
    }

    if (button.id === "close-asset-editor" || button.id === "close-asset-editor-secondary") {
      closeAssetEditor();
      renderPlanner(user);
    }
  });

  assetEditForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const disabledState = getAssetDraftSubmitDisabledState(assetEditForm, assetEditDraft);
    if (disabledState.reason) {
      updateFormSubmissionState(assetEditForm);
      return;
    }

    const previousAsset = plannerState.assets.find((asset) => asset.name === assetEditDraft.originalName);
    const previousFormulas = previousAsset ? getAssetDefinitionFormulas(previousAsset) : [];
    try {
      ensurePlannerVariablesExist(
        collectMissingFormulaVariables([assetEditDraft.kind === "home" ? assetEditDraft.initialCost : assetEditDraft.startingValue])
      );
      const nextAsset = buildAssetDefinition(assetEditDraft);
      assertAssetNameAvailable(nextAsset.name, assetEditDraft.originalName);
      updateAsset(assetEditDraft.originalName, nextAsset);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Asset could not be saved.");
      return;
    }
    const nextAsset = plannerState.assets.find((asset) => asset.name === assetEditDraft.name.trim());
    if (nextAsset) {
      pruneUnusedPlannerVariables(collectRemovedFormulaVariables(previousFormulas, getAssetDefinitionFormulas(nextAsset)));
    }
    updateAssetCorrelations(assetEditDraft.originalName, assetEditDraft.name.trim(), assetEditDraft.correlations);
    syncSimulationDraftAssetRows();
    invalidateSimulationState();
    closeAssetEditor();
    activeSummaryTab = "assets";
    await persistPlannerState(user);
    renderPlanner(user);
  });
}

function bindTaxComposer(user: UserIdentity): void {
  const taxForm = document.querySelector<HTMLFormElement>("#tax-form");
  if (!taxForm) {
    return;
  }

  taxForm.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (target.name === "taxLabel") {
      taxDraft.name = target.value;
      return;
    }

    if (target.name === "maximum") {
      taxDraft.maximum = target.value;
      return;
    }

    const rateField = target.dataset.taxRateField;
    if (rateField) {
      const [rateId, field] = rateField.split(":");
      const rate = taxDraft.rates.find((candidate) => candidate.id === rateId);
      if (!rate) {
        return;
      }

      if (field === "rate") {
        rate.rate = target.value;
      } else if (field === "upTo") {
        rate.upTo = target.value;
      }
      return;
    }

    const exclusionField = target.dataset.taxExclusionField;
    if (exclusionField) {
      const [exclusionId, field] = exclusionField.split(":");
      const exclusion = taxDraft.exclusions.find((candidate) => candidate.id === exclusionId);
      if (!exclusion) {
        return;
      }

      if (field === "name") {
        exclusion.name = target.value;
      } else if (field === "amount") {
        exclusion.amount = target.value;
      } else if (field === "maximum") {
        exclusion.maximum = target.value;
      }
    }
  });

  taxForm.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const button = target.closest<HTMLButtonElement>("button");
    if (!button) {
      return;
    }

    if (button.id === "close-tax-composer" || button.id === "close-tax-composer-secondary") {
      closeTaxComposer();
      renderPlanner(user);
      return;
    }

    if (button.id === "delete-tax-from-editor") {
      if (!taxDraft.originalName) {
        return;
      }

      const taxName = taxDraft.originalName;
      plannerState.taxes = plannerState.taxes.filter((tax) => tax.name !== taxName);
      clearDeletedTaxReference(taxName);
      invalidateSimulationState();
      closeTaxComposer();
      void persistPlannerState(user).then(() => renderPlanner(user));
      return;
    }

    if (button.id === "add-tax-rate") {
      taxDraft.rates.push(createTaxRateDraft());
      renderPlanner(user);
      return;
    }

    if (button.id === "add-tax-exclusion") {
      taxDraft.exclusions.push(createTaxExclusionDraft());
      renderPlanner(user);
      return;
    }

    const removeRateId = button.dataset.removeTaxRate;
    if (removeRateId) {
      taxDraft.rates = taxDraft.rates.filter((rate) => rate.id !== removeRateId);
      renderPlanner(user);
      return;
    }

    const removeExclusionId = button.dataset.removeTaxExclusion;
    if (removeExclusionId) {
      taxDraft.exclusions = taxDraft.exclusions.filter((exclusion) => exclusion.id !== removeExclusionId);
      renderPlanner(user);
    }
  });

  taxForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const nextTax = buildTaxDefinition(taxDraft);
    if (taxDraft.originalName) {
      plannerState.taxes = plannerState.taxes.map((tax) =>
        tax.name === taxDraft.originalName ? nextTax : tax
      );
      if (taxDraft.originalName !== nextTax.name) {
        renameTaxReference(taxDraft.originalName, nextTax.name);
      }
    } else {
      plannerState.taxes.push(nextTax);
    }

    invalidateSimulationState();
    closeTaxComposer();
    activeSummaryTab = "taxes";
    await persistPlannerState(user);
    renderPlanner(user);
  });
}

function bindTaxProfileForm(user: UserIdentity): void {
  const forms = document.querySelectorAll<HTMLElement>("[data-tax-profile-editor]");
  if (forms.length === 0) {
    return;
  }

  const persistTaxProfile = async (shouldRender: boolean): Promise<void> => {
    const nextTaxProfile = buildTaxProfileDefinition(taxProfileDraft);
    if (!nextTaxProfile) {
      return;
    }

    plannerState.taxProfile = nextTaxProfile;
    invalidateSimulationState();
    await persistPlannerState(user);
    if (shouldRender) {
      renderPlanner(user);
    }
  };

  const scheduleTaxProfilePersistence = (): void => {
    if (taxProfilePersistTimeout !== null) {
      window.clearTimeout(taxProfilePersistTimeout);
    }

    taxProfilePersistTimeout = window.setTimeout(() => {
      taxProfilePersistTimeout = null;
      void persistTaxProfile(false);
    }, 250);
  };

  const flushTaxProfilePersistence = async (shouldRender: boolean): Promise<void> => {
    if (taxProfilePersistTimeout !== null) {
      window.clearTimeout(taxProfilePersistTimeout);
      taxProfilePersistTimeout = null;
    }

    await persistTaxProfile(shouldRender);
  };

  for (const form of forms) {
    const formMode = form.dataset.taxProfileEditor;

    form.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
        return;
      }

      if (target.name === "filingStatus") {
        taxProfileDraft.filingStatus = target.value as FilingStatus;
      } else if (target.name === "deductionMode") {
        taxProfileDraft.deductionMode = target.value as DeductionMode;
      } else if (target.name === "federalStandardDeduction") {
        taxProfileDraft.federalStandardDeduction = target.value;
      } else if (target.name === "otherSaltTaxesPaid") {
        taxProfileDraft.otherSaltTaxesPaid = target.value;
      } else if (target.name === "saltDeductionBaseCap") {
        taxProfileDraft.saltDeductionBaseCap = target.value;
      } else if (target.name === "saltDeductionFloorCap") {
        taxProfileDraft.saltDeductionFloorCap = target.value;
      } else if (target.name === "saltDeductionPhaseoutThreshold") {
        taxProfileDraft.saltDeductionPhaseoutThreshold = target.value;
      } else if (target.name === "saltDeductionPhaseoutRate") {
        taxProfileDraft.saltDeductionPhaseoutRate = target.value;
      } else if (target.name === "otherItemizedDeductions") {
        taxProfileDraft.otherItemizedDeductions = target.value;
      } else if (target.name === "stateTaxableIncomeAdjustment") {
        taxProfileDraft.stateTaxableIncomeAdjustment = target.value;
      } else if (target.name === "localTaxableIncomeAdjustment") {
        taxProfileDraft.localTaxableIncomeAdjustment = target.value;
      } else if (target.name === "niitThreshold") {
        taxProfileDraft.niitThreshold = target.value;
      } else if (target.name === "federalOrdinaryTaxName") {
        taxProfileDraft.federalOrdinaryTaxName = target.value;
      } else if (target.name === "federalQualifiedTaxName") {
        taxProfileDraft.federalQualifiedTaxName = target.value;
      } else if (target.name === "stateTaxName") {
        taxProfileDraft.stateTaxName = target.value;
      } else if (target.name === "stateCapitalGainsTaxName") {
        taxProfileDraft.stateCapitalGainsTaxName = target.value;
      } else if (target.name === "localTaxName") {
        taxProfileDraft.localTaxName = target.value;
      } else if (target.name === "niitTaxName") {
        taxProfileDraft.niitTaxName = target.value;
      }

      if (formMode === "simulation") {
        simulationDraft.taxPreset = "custom";
        const presetSelect = document.querySelector<HTMLSelectElement>('select[name="simulationTaxPreset"]');
        if (presetSelect) {
          presetSelect.value = "custom";
        }
      }

      scheduleTaxProfilePersistence();
    });

    form.addEventListener("change", async () => {
      await flushTaxProfilePersistence(true);
    });

    if (formMode !== "setup") {
      continue;
    }

    form.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const presetButton = target.closest<HTMLButtonElement>("#load-tax-preset");
      if (!presetButton) {
        return;
      }

      event.preventDefault();
      const selectedTaxPresetId = form.querySelector<HTMLSelectElement>('select[name="taxPresetToLoad"]')?.value ?? "nyc";
      const normalizedTaxPreset = normalizeSimulationTaxPreset(selectedTaxPresetId, "nyc");
      const preset = createBuiltInTaxPresetDefinition(
        normalizedTaxPreset === "custom" ? "nyc" : normalizedTaxPreset,
        taxProfileDraft.filingStatus
      );
      plannerState.taxes = preset.taxes.map((tax) => buildNormalizedTaxDefinition(tax));
      plannerState.taxProfile = preset.profile;
      syncTaxProfileDraft();
      invalidateSimulationState();
      if (taxProfilePersistTimeout !== null) {
        window.clearTimeout(taxProfilePersistTimeout);
        taxProfilePersistTimeout = null;
      }
      await persistPlannerState(user);
      renderPlanner(user);
    });
  }
}

function clearDeletedTaxReference(taxName: string): void {
  plannerState.taxProfile = {
    ...plannerState.taxProfile,
    federalOrdinaryTaxName:
      plannerState.taxProfile.federalOrdinaryTaxName === taxName ? "" : plannerState.taxProfile.federalOrdinaryTaxName,
    federalQualifiedTaxName:
      plannerState.taxProfile.federalQualifiedTaxName === taxName ? "" : plannerState.taxProfile.federalQualifiedTaxName,
    stateTaxName: plannerState.taxProfile.stateTaxName === taxName ? "" : plannerState.taxProfile.stateTaxName,
    stateCapitalGainsTaxName:
      plannerState.taxProfile.stateCapitalGainsTaxName === taxName ? "" : plannerState.taxProfile.stateCapitalGainsTaxName,
    localTaxName: plannerState.taxProfile.localTaxName === taxName ? "" : plannerState.taxProfile.localTaxName,
    niitTaxName: plannerState.taxProfile.niitTaxName === taxName ? "" : plannerState.taxProfile.niitTaxName,
  };
  syncTaxProfileDraft();
}

function renameTaxReference(previousName: string, nextName: string): void {
  plannerState.taxProfile = {
    ...plannerState.taxProfile,
    federalOrdinaryTaxName:
      plannerState.taxProfile.federalOrdinaryTaxName === previousName ? nextName : plannerState.taxProfile.federalOrdinaryTaxName,
    federalQualifiedTaxName:
      plannerState.taxProfile.federalQualifiedTaxName === previousName ? nextName : plannerState.taxProfile.federalQualifiedTaxName,
    stateTaxName: plannerState.taxProfile.stateTaxName === previousName ? nextName : plannerState.taxProfile.stateTaxName,
    stateCapitalGainsTaxName:
      plannerState.taxProfile.stateCapitalGainsTaxName === previousName
        ? nextName
        : plannerState.taxProfile.stateCapitalGainsTaxName,
    localTaxName: plannerState.taxProfile.localTaxName === previousName ? nextName : plannerState.taxProfile.localTaxName,
    niitTaxName: plannerState.taxProfile.niitTaxName === previousName ? nextName : plannerState.taxProfile.niitTaxName,
  };
  syncTaxProfileDraft();
}

function bindInlineFlowEventInputs(user: UserIdentity, saveInlineFlowEvent: () => Promise<void>): void {
  for (const input of document.querySelectorAll<HTMLInputElement>("[data-inline-flow-event-year]")) {
    let isSwitchingInlineFlowEventField = false;

    input.addEventListener("input", () => {
      flowEventDraft.year = input.value;
    });
    input.addEventListener("blur", () => {
      if (isSwitchingInlineFlowEventField) {
        return;
      }

      void saveInlineFlowEvent();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        input.blur();
        return;
      }

      if (event.key === "Tab" && !event.shiftKey) {
        event.preventDefault();
        flowEventDraft.year = input.value;
        const token = input.dataset.inlineFlowEventYear;
        activeFlowEventEdit = {
          eventName: token === "__new__" ? null : token ?? null,
          field: "formula",
        };
        isSwitchingInlineFlowEventField = true;
        renderPlanner(user);
      }
    });
    input.focus();
    input.select();
  }

  for (const wrapper of document.querySelectorAll<HTMLElement>("[data-inline-flow-event-formula-editor]")) {
    const syncInlineFlowEventFormulaDraft = (): void => {
      const hiddenInput = wrapper.querySelector<HTMLInputElement>(".formula-editor-hidden-input");
      const editor = wrapper.querySelector<HTMLElement>(".formula-editor-input");
      const editorFormula = formatFormulaText(normalizeEditorText(editor?.textContent ?? ""));
      flowEventDraft.formula = editorFormula || hiddenInput?.value || "";
    };

    wrapper.addEventListener("focusout", () => {
      window.setTimeout(() => {
        if (wrapper.contains(document.activeElement)) {
          return;
        }

        syncInlineFlowEventFormulaDraft();

        const formulaWrapper = wrapper.querySelector<HTMLElement>("[data-formula-editor]");
        if (formulaWrapper?.dataset.invalid === "true") {
          return;
        }

        void saveInlineFlowEvent();
      }, 0);
    });

    const editor = wrapper.querySelector<HTMLElement>(".formula-editor-input");
    if (!editor) {
      continue;
    }

    editor.focus();
    setCaretCharacterOffset(editor, editor.textContent?.length ?? 0);
  }
}

function bindFlowComposer(user: UserIdentity): void {
  const flowForm = document.querySelector<HTMLFormElement>("#flow-form");
  if (!flowForm) {
    return;
  }

  flowForm.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
      return;
    }

    if (target.name === "flowLabel") {
      flowDraft.name = target.value;
    } else if (target.name === "taxTreatment") {
      flowDraft.taxTreatment = target.value as FlowTaxTreatment;
    } else if (target.name === "taxDeductible" && target instanceof HTMLInputElement) {
      flowDraft.taxTreatment = target.checked ? "deductible-expense" : "nondeductible-expense";
    } else if (target.name === "formula") {
      flowDraft.formula = target.value;
    } else if (target.name === "startYear") {
      flowDraft.startYear = target.value;
    } else if (target.name === "endYear") {
      flowDraft.endYear = target.value;
    } else if (target.name === "annualRaisePercent") {
      flowDraft.annualRaisePercent = target.value;
    } else if (target.name === "oneTime" && target instanceof HTMLInputElement) {
      flowDraft.oneTime = target.checked;
      flowDraft.oneTimeYear = normalizeYearInput(flowDraft.oneTimeYear || plannerState.startYear);
      renderPlanner(user);
      return;
    } else if (target.name === "oneTimeYear") {
      flowDraft.oneTimeYear = target.value;
    } else if (target.name === "inflationAdjusted" && target instanceof HTMLInputElement) {
      flowDraft.inflationAdjusted = target.checked;
    }

    refreshFormulaEditors(flowForm);
    if (target.name === "taxTreatment") {
      window.setTimeout(() => focusFlowFormulaEditor("#flow-form"), 0);
    }
  });

  flowForm.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const button = target.closest<HTMLButtonElement>("button");
    if (!button) {
      return;
    }

    if (button.id === "close-flow-composer" || button.id === "close-flow-composer-secondary") {
      closeFlowComposer();
      renderPlanner(user);
      return;
    }

    if (button.id === "open-flow-draft-event-composer") {
      beginFlowDraftChangeEdit("year");
      renderPlanner(user);
      return;
    }

    const deleteChangeId = button.dataset.deleteFlowDraftEvent;
    if (deleteChangeId) {
      flowDraft.changeEvents = flowDraft.changeEvents.filter((change) => change.id !== deleteChangeId);
      if (activeFlowEventEdit?.eventName === deleteChangeId) {
        activeFlowEventEdit = null;
      }
      renderPlanner(user);
    }
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-start-edit-flow-draft-event-year]")) {
    button.addEventListener("click", () => {
      const token = button.dataset.startEditFlowDraftEventYear;
      beginFlowDraftChangeEdit("year", token === "__new__" ? null : token ?? null);
      renderPlanner(user);
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-start-edit-flow-draft-event-formula]")) {
    button.addEventListener("click", () => {
      const token = button.dataset.startEditFlowDraftEventFormula;
      beginFlowDraftChangeEdit("formula", token === "__new__" ? null : token ?? null);
      renderPlanner(user);
    });
  }

  const saveInlineFlowDraftEvent = async (): Promise<void> => {
    if (!flowEventDraft.formula.trim()) {
      activeFlowEventEdit = {
        eventName: flowEventDraft.originalName,
        field: "formula",
      };
      return;
    }

    upsertFlowChangeDraft(
      flowDraft,
      flowEventDraft.originalName,
      normalizeYearInput(flowEventDraft.year),
      flowEventDraft.formula
    );
    resetFlowEventDraft(flowDraft.name, flowDraft.formula);
    activeFlowEventEdit = null;
    renderPlanner(user);
  };

  bindInlineFlowEventInputs(user, saveInlineFlowDraftEvent);

  flowForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    markFormulaEditorsSubmitted(flowForm);
    if (activeFlowEventEdit && flowEventDraft.formula.trim()) {
      upsertFlowChangeDraft(
        flowDraft,
        flowEventDraft.originalName,
        normalizeYearInput(flowEventDraft.year),
        flowEventDraft.formula
      );
      activeFlowEventEdit = null;
    }

    const disabledState = getFlowDraftSubmitDisabledState(flowForm, flowDraft);
    if (disabledState.reason) {
      updateFormSubmissionState(flowForm);
      return;
    }

    let nextFlow: FlowDefinition;
    try {
      nextFlow = buildFlowDefinitionFromDraft(flowDraft);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Flow could not be created.");
      return;
    }

    const draftChangeFormulas = flowDraft.oneTime ? [] : flowDraft.changeEvents.map((change) => change.formula.trim());
    ensurePlannerVariablesExist(collectMissingFormulaVariables([flowDraft.formula.trim(), ...draftChangeFormulas]));
    plannerState.flows.push(nextFlow);
    if (!flowDraft.oneTime) {
      for (const change of flowDraft.changeEvents) {
        plannerState.events.push(createExpenseChangeEvent(nextFlow.name, normalizeYearInput(change.year), change.formula));
      }
    }
    syncExpenseOneTimeSchedule(
      nextFlow.name,
      flowDraft.oneTime,
      flowDraft.oneTimeYear,
      flowDraft.formula
    );
    invalidateSimulationState();
    closeFlowComposer();
    activeSummaryTab = "variables";
    await persistPlannerState(user);
    renderPlanner(user);
  });
}

function bindEventComposer(user: UserIdentity): void {
  const eventForm = document.querySelector<HTMLFormElement>("#event-form");
  if (!eventForm) {
    return;
  }

  const eventNameInput = requireElement(document.querySelector<HTMLInputElement>("#event-name"), "#event-name");

  eventNameInput.addEventListener("input", () => {
    eventDraft.name = eventNameInput.value;
  });

  eventForm.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
      return;
    }

    if (target.name === "flowName") {
      eventDraft.flowName = target.value;
      for (const entry of eventDraft.entries) {
        for (const action of entry.actions) {
          if (action.kind === "set-flow-formula") {
            action.flowName = eventDraft.flowName;
            if (!action.formula.trim()) {
              action.formula =
                plannerState.flows.find((flow) => flow.name === eventDraft.flowName)?.formula ?? "";
            }
          }
        }
      }
      renderPlanner(user);
      return;
    }

    const entryYearId = target.dataset.entryYear;
    if (entryYearId) {
      const entry = findDraftEntry(entryYearId);
      entry.year = normalizeYearInput(target.value);
      refreshFormulaEditors(eventForm);
      return;
    }

    const fieldToken = target.dataset.field;
    if (fieldToken) {
      const [entryId, actionId, field] = fieldToken.split(":");
      const action = findDraftAction(entryId, actionId);
      updateDraftActionField(action, field, target.value);
      refreshFormulaEditors(eventForm);
      return;
    }

    const actionKindToken = target.dataset.actionKind;
    if (actionKindToken) {
      const [entryId, actionId] = actionKindToken.split(":");
      const action = findDraftAction(entryId, actionId);
      action.kind = target.value as EventActionDraftKind;
      if (action.kind === "set-flow-formula") {
        action.flowName = eventDraft.flowName;
        action.formula =
          action.formula.trim() ||
          plannerState.flows.find((flow) => flow.name === eventDraft.flowName)?.formula ||
          "";
      }
      renderPlanner(user);
    }
  });

  eventForm.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }

    const addActionId = target.dataset.addAction;
    if (addActionId) {
      findDraftEntry(addActionId).actions.push(createActionDraft(eventDraft.flowName));
      renderPlanner(user);
      return;
    }

    const removeActionToken = target.dataset.removeAction;
    if (removeActionToken) {
      const [entryId, actionId] = removeActionToken.split(":");
      const entry = findDraftEntry(entryId);
      entry.actions = entry.actions.filter((action) => action.id !== actionId);
      if (entry.actions.length === 0) {
        entry.actions.push(createActionDraft(eventDraft.flowName));
      }
      renderPlanner(user);
      return;
    }

    const removeEntryId = target.dataset.removeEntry;
    if (removeEntryId) {
      eventDraft.entries = eventDraft.entries.filter((entry) => entry.id !== removeEntryId);
      if (eventDraft.entries.length === 0) {
        eventDraft.entries.push(createEventEntryDraft(eventDraft.flowName));
      }
      renderPlanner(user);
      return;
    }

    if (target.id === "add-entry-button") {
      eventDraft.entries.push(createEventEntryDraft(eventDraft.flowName));
      renderPlanner(user);
      return;
    }

    if (target.id === "close-event-composer" || target.id === "close-event-composer-secondary") {
      closeEventComposer();
      renderPlanner(user);
    }
  });

  eventForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    markFormulaEditorsSubmitted(eventForm);
    if (hasInvalidFormulaEditors(eventForm)) {
      return;
    }

    const previousEvent = eventDraft.originalName
      ? plannerState.events.find((event) => event.name === eventDraft.originalName) ?? null
      : null;
    const previousFormulas = previousEvent ? getEventFormulas(previousEvent) : [];
    ensurePlannerVariablesExist(
      collectMissingFormulaVariables(getEventDraftFormulas(eventDraft), getEventDraftVariableDefinitionNames())
    );

    const nextEvent = new Event({
      name: eventDraft.name.trim(),
      flowName: eventDraft.flowName.trim(),
      schedule: buildEventSchedule(eventDraft),
    });

    if (eventDraft.originalName) {
      plannerState.events = plannerState.events.map((event) =>
        event.name === eventDraft.originalName ? nextEvent : event
      );
    } else {
      plannerState.events.push(nextEvent);
    }

    pruneUnusedPlannerVariables(collectRemovedFormulaVariables(previousFormulas, getEventFormulas(nextEvent)));

    invalidateSimulationState();
    closeEventComposer();
    await persistPlannerState(user);
    renderPlanner(user);
  });
}

function bindFlowEditor(user: UserIdentity): void {
  const flowEditForm = document.querySelector<HTMLFormElement>("#flow-edit-form");
  const openFlowEventComposerButton = document.querySelector<HTMLButtonElement>("#open-flow-event-composer");
  const deleteFlowButton = document.querySelector<HTMLButtonElement>("#delete-flow-from-editor");
  if (!flowEditForm) {
    return;
  }

  flowEditForm.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
      return;
    }

    if (target.name === "flowLabel") {
      flowEditDraft.name = target.value;
    } else if (target.name === "taxTreatment") {
      flowEditDraft.taxTreatment = target.value as FlowTaxTreatment;
    } else if (target.name === "taxDeductible" && target instanceof HTMLInputElement) {
      flowEditDraft.taxTreatment = target.checked ? "deductible-expense" : "nondeductible-expense";
    } else if (target.name === "formula") {
      flowEditDraft.formula = target.value;
    } else if (target.name === "startYear") {
      flowEditDraft.startYear = target.value;
    } else if (target.name === "endYear") {
      flowEditDraft.endYear = target.value;
    } else if (target.name === "annualRaisePercent") {
      flowEditDraft.annualRaisePercent = target.value;
    } else if (target.name === "oneTime" && target instanceof HTMLInputElement) {
      flowEditDraft.oneTime = target.checked;
      flowEditDraft.oneTimeYear = normalizeYearInput(flowEditDraft.oneTimeYear || plannerState.startYear);
      renderPlanner(user);
      return;
    } else if (target.name === "oneTimeYear") {
      flowEditDraft.oneTimeYear = target.value;
    } else if (target.name === "inflationAdjusted" && target instanceof HTMLInputElement) {
      flowEditDraft.inflationAdjusted = target.checked;
    }

    refreshFormulaEditors(flowEditForm);
    if (target.name === "taxTreatment") {
      window.setTimeout(() => focusFlowFormulaEditor("#flow-edit-form"), 0);
    }
  });

  deleteFlowButton?.addEventListener("click", () => {
      const confirmed = window.confirm(
        `Delete ${flowEditDraft.type} "${flowEditDraft.originalName}"? This will also remove related change-over-time overrides and prune unused variables.`
      );
      if (!confirmed) {
        return;
      }

      deleteFlow(flowEditDraft.originalName);
      invalidateSimulationState();
      closeFlowEditor();
      void persistPlannerState(user).then(() => {
        renderPlanner(user);
      });
  });

  flowEditForm.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const button = target.closest<HTMLButtonElement>("button");
    if (!button) {
      return;
    }

    if (button.id === "close-flow-editor" || button.id === "close-flow-editor-secondary") {
      closeFlowEditor();
      renderPlanner(user);
    }
  });

  openFlowEventComposerButton?.addEventListener("click", () => {
    beginFlowEventEdit(flowEditDraft.originalName, "year");
    renderPlanner(user);
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-delete-flow-event]")) {
    button.addEventListener("click", async () => {
      const eventName = button.dataset.deleteFlowEvent;
      if (!eventName) {
        return;
      }

      deleteEvent(eventName);
      invalidateSimulationState();
      activeFlowEventEdit = null;
      resetFlowEventDraft(flowEditDraft.originalName, flowEditDraft.formula);
      await persistPlannerState(user);
      renderPlanner(user);
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-start-edit-flow-event-year]")) {
    button.addEventListener("click", () => {
      const token = button.dataset.startEditFlowEventYear;
      beginFlowEventEdit(flowEditDraft.originalName, "year", token === "__new__" ? null : token ?? null);
      renderPlanner(user);
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-start-edit-flow-event-formula]")) {
    button.addEventListener("click", () => {
      const token = button.dataset.startEditFlowEventFormula;
      beginFlowEventEdit(flowEditDraft.originalName, "formula", token === "__new__" ? null : token ?? null);
      renderPlanner(user);
    });
  }

  flowEditForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    markFormulaEditorsSubmitted(flowEditForm);
    const previousFlow = plannerState.flows.find((flow) => flow.name === flowEditDraft.originalName);
    const previousFormulas = previousFlow ? getFlowAndEventFormulas(previousFlow) : [];
    if (activeFlowEventEdit && flowEventDraft.formula.trim()) {
      ensurePlannerVariablesExist(collectMissingFormulaVariables([flowEventDraft.formula.trim()]));
      upsertExpenseChangeEvent(
        flowEventDraft.originalName,
        flowEditDraft.originalName,
        normalizeYearInput(flowEventDraft.year),
        flowEventDraft.formula
      );
      activeFlowEventEdit = null;
    }

    const disabledState = getFlowDraftSubmitDisabledState(flowEditForm, flowEditDraft);
    if (disabledState.reason) {
      updateFormSubmissionState(flowEditForm);
      return;
    }

    let nextFlow: FlowDefinition;
    try {
      nextFlow = buildFlowDefinitionFromDraft(flowEditDraft);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Flow could not be saved.");
      return;
    }

    ensurePlannerVariablesExist(collectMissingFormulaVariables([flowEditDraft.formula.trim()]));
    updateFlow(flowEditDraft.originalName, nextFlow);
    syncExpenseOneTimeSchedule(
      nextFlow.name,
      flowEditDraft.oneTime,
      flowEditDraft.oneTimeYear,
      flowEditDraft.formula
    );
    pruneUnusedPlannerVariables(
      collectRemovedFormulaVariables(previousFormulas, getFlowAndEventFormulas(nextFlow))
    );
    invalidateSimulationState();
    closeFlowEditor();
    activeSummaryTab = "variables";
    await persistPlannerState(user);
    renderPlanner(user);
  });

  const saveInlineFlowEvent = async (): Promise<void> => {
    try {
      if (!flowEventDraft.formula.trim()) {
        activeFlowEventEdit = {
          eventName: flowEventDraft.originalName,
          field: "formula",
        };
        return;
      }

      const previousEvent = flowEventDraft.originalName
        ? plannerState.events.find((event) => event.name === flowEventDraft.originalName) ?? null
        : null;
      const previousFormulas = previousEvent ? getEventFormulas(previousEvent) : [];
      ensurePlannerVariablesExist(collectMissingFormulaVariables([flowEventDraft.formula.trim()]));
      upsertExpenseChangeEvent(
        flowEventDraft.originalName,
        flowEditDraft.originalName,
        normalizeYearInput(flowEventDraft.year),
        flowEventDraft.formula
      );
      const nextEvent = plannerState.events.find(
        (event) => event.name === createExpenseChangeEventName(flowEditDraft.originalName, normalizeYearInput(flowEventDraft.year))
      );
      pruneUnusedPlannerVariables(
        collectRemovedFormulaVariables(previousFormulas, nextEvent ? getEventFormulas(nextEvent) : [])
      );
      resetFlowEventDraft(flowEditDraft.originalName, flowEditDraft.formula);
      activeFlowEventEdit = null;
      await persistPlannerState(user);
      renderPlanner(user);
    } catch {
      activeFlowEventEdit = {
        eventName: flowEventDraft.originalName,
        field: "formula",
      };
      renderPlanner(user);
    }
  };

  bindInlineFlowEventInputs(user, saveInlineFlowEvent);
}

function toEventAction(action: EventActionDraft, flowName: string): EventAction {
  switch (action.kind) {
    case "adjust-variable":
      return {
        kind: "adjust-variable",
        variableName: action.variableName.trim(),
        adjustment: {
          m: Number(action.m),
          b: parseEditableNumber(action.b),
        },
      };
    case "set-flow-formula":
      return {
        kind: "set-flow-formula",
        flowName: flowName.trim(),
        formula: action.formula.trim(),
      };
    case "add-variable":
      return {
        kind: "add-variable",
        variable: {
          name: action.variableDefinitionName.trim(),
          value: parseEditableNumber(action.variableDefinitionValue),
        },
      };
    case "add-flow":
      return {
        kind: "add-flow",
        flow: {
          name: action.flowDefinitionName.trim(),
          type: action.flowDefinitionType,
          formula: action.flowDefinitionFormula.trim(),
        },
      };
    case "one-time-expense":
      throw new Error("One-time expense actions must be expanded into scheduled entries before serialization.");
  }
}

function toEventActionDraft(action: EventAction): EventActionDraft {
  switch (action.kind) {
    case "adjust-variable":
      return {
        id: createId(),
        kind: "adjust-variable",
        variableName: action.variableName,
        m: String(action.adjustment.m),
        b: String(action.adjustment.b),
        flowName: plannerState.flows[0]?.name ?? "",
        formula: "",
        variableDefinitionName: "",
        variableDefinitionValue: "0",
        flowDefinitionName: "",
        flowDefinitionType: "income",
        flowDefinitionFormula: "",
        oneTimeExpenseName: "",
        oneTimeExpenseFormula: "",
      };
    case "set-flow-formula":
      return {
        id: createId(),
        kind: "set-flow-formula",
        variableName: plannerState.variables[0]?.name ?? "",
        m: "1",
        b: "0",
        flowName: action.flowName,
        formula: action.formula,
        variableDefinitionName: "",
        variableDefinitionValue: "0",
        flowDefinitionName: "",
        flowDefinitionType: "income",
        flowDefinitionFormula: "",
        oneTimeExpenseName: "",
        oneTimeExpenseFormula: "",
      };
    case "add-variable":
      return {
        id: createId(),
        kind: "add-variable",
        variableName: plannerState.variables[0]?.name ?? "",
        m: "1",
        b: "0",
        flowName: plannerState.flows[0]?.name ?? "",
        formula: "",
        variableDefinitionName: action.variable.name,
        variableDefinitionValue: String(action.variable.value),
        flowDefinitionName: "",
        flowDefinitionType: "income",
        flowDefinitionFormula: "",
        oneTimeExpenseName: "",
        oneTimeExpenseFormula: "",
      };
    case "add-flow":
      return {
        id: createId(),
        kind: "add-flow",
        variableName: plannerState.variables[0]?.name ?? "",
        m: "1",
        b: "0",
        flowName: plannerState.flows[0]?.name ?? "",
        formula: "",
        variableDefinitionName: "",
        variableDefinitionValue: "0",
        flowDefinitionName: action.flow.name,
        flowDefinitionType: action.flow.type,
        flowDefinitionFormula: action.flow.formula,
        oneTimeExpenseName: "",
        oneTimeExpenseFormula: "",
      };
  }
}

function findDraftEntry(entryId: string): EventEntryDraft {
  const entry = eventDraft.entries.find((candidate) => candidate.id === entryId);
  if (!entry) {
    throw new Error(`Unknown event draft entry "${entryId}".`);
  }

  return entry;
}

function findDraftAction(entryId: string, actionId: string): EventActionDraft {
  const action = findDraftEntry(entryId).actions.find((candidate) => candidate.id === actionId);
  if (!action) {
    throw new Error(`Unknown event draft action "${actionId}".`);
  }

  return action;
}

function updateDraftActionField(action: EventActionDraft, field: string, value: string): void {
  switch (field) {
    case "variableName":
    case "m":
    case "b":
    case "flowName":
    case "formula":
    case "variableDefinitionName":
    case "variableDefinitionValue":
    case "flowDefinitionName":
    case "flowDefinitionFormula":
    case "oneTimeExpenseName":
    case "oneTimeExpenseFormula":
      action[field] = value;
      return;
    case "flowDefinitionType":
      action.flowDefinitionType = value === "expense" ? "expense" : "income";
      return;
    default:
      throw new Error(`Unsupported draft field "${field}".`);
  }
}

function buildEventSchedule(draft: EventDraft): EventDefinition["schedule"] {
  const groupedEntries = new Map<string, { year: EventYear; actions: EventAction[] }>();

  for (const entry of draft.entries) {
    const year = parseYearInput(entry.year);
    for (const scheduledEntry of expandDraftActions(entry.actions, year, draft.flowName)) {
      appendActions(groupedEntries, scheduledEntry.year, scheduledEntry.actions);
    }
  }

  return [...groupedEntries.values()].sort((left, right) => compareEventYears(left.year, right.year));
}

function expandDraftActions(
  actions: readonly EventActionDraft[],
  year: EventYear,
  flowName: string
): EventDefinition["schedule"] {
  const groupedEntries = new Map<string, { year: EventYear; actions: EventAction[] }>();
  appendActions(groupedEntries, year, []);

  for (const action of actions) {
    if (action.kind === "one-time-expense") {
      const oneTimeExpenseSchedule = createOneTimeExpenseSchedule({
        flowName: action.oneTimeExpenseName.trim(),
        year,
        formula: action.oneTimeExpenseFormula.trim(),
      });

      for (const scheduledEntry of oneTimeExpenseSchedule) {
        appendActions(groupedEntries, scheduledEntry.year, [...scheduledEntry.actions]);
      }
      continue;
    }

    appendActions(groupedEntries, year, [toEventAction(action, flowName)]);
  }

  return [...groupedEntries.values()]
    .filter((entry) => entry.actions.length > 0)
    .sort((left, right) => compareEventYears(left.year, right.year));
}

function appendActions(
  groupedEntries: Map<string, { year: EventYear; actions: EventAction[] }>,
  year: EventYear,
  actions: readonly EventAction[]
): void {
  const key = String(year.year);
  const existing = groupedEntries.get(key);

  if (existing) {
    existing.actions.push(...actions);
    return;
  }

  groupedEntries.set(key, {
    year: { ...year },
    actions: [...actions],
  });
}

function findAssetCashGenerationDraft(
  draft: AssetDraft | AssetEditDraft,
  cashGenerationId: string
): AssetCashGenerationDraft {
  const cashGeneration = draft.cashGenerations.find((candidate) => candidate.id === cashGenerationId);
  if (!cashGeneration) {
    throw new Error(`Unknown asset cash generation draft "${cashGenerationId}".`);
  }

  return cashGeneration;
}

function syncAssetCashGenerationDraftPresentation(
  root: ParentNode,
  draft: AssetDraft | AssetEditDraft,
  cashGenerationId: string
): void {
  const cashGeneration = findAssetCashGenerationDraft(draft, cashGenerationId);
  const title = root.querySelector<HTMLElement>(`[data-cash-generation-title="${cashGenerationId}"]`);
  if (title) {
    title.textContent = getAssetCashGenerationDisplayName(cashGeneration);
  }

  const preview = root.querySelector<HTMLElement>(`[data-cash-generation-preview="${cashGenerationId}"]`);
  if (preview) {
    preview.textContent = renderAssetCashGenerationDraftPreview(cashGeneration);
  }
}

function buildAssetDefinition(draft: AssetDraft): AssetDefinition {
  if (draft.kind === "home") {
    const initialCost = resolveAssetValueInput(draft.initialCost, "Home price");

    return new Asset({
      kind: "home",
      name: draft.name,
      initialCost: initialCost.value,
      ...(initialCost.formula ? { initialCostFormula: initialCost.formula } : {}),
      expectedReturn: Number(draft.expectedReturn),
      volatility: Number(draft.volatility),
      cashPurchasePercent: Number(draft.cashPurchasePercent) / 100,
      closingCostPercent: Number(draft.closingCostPercent) / 100,
      mortgageType: draft.mortgageType,
      ...(draft.mortgageType === "interest-only"
        ? {
            interestOnlyMaturityAction: draft.interestOnlyMaturityAction,
          }
        : {}),
      mortgageRate: Number(draft.mortgageRate),
      mortgageTermYears: Number(draft.mortgageTermYears),
      monthlyNonTaxCosts: parseEditableNumber(draft.monthlyNonTaxCosts),
      propertyTaxRate: Number(draft.propertyTaxRate),
      purchaseYear: Number(draft.purchaseYear),
    }).toDefinition();
  }

  const assetType = getInvestmentAssetTypeFromDraftKind(draft.kind);
  const startingValue = resolveAssetValueInput(draft.startingValue, "Value");
  return new Asset({
    name: draft.name,
    ...(assetType ? { assetType } : {}),
    startingValue: startingValue.value,
    ...(startingValue.formula ? { startingValueFormula: startingValue.formula } : {}),
    expectedReturn: Number(draft.expectedReturn),
    volatility: Number(draft.volatility),
    sellProportion: 1,
    ...(draft.cashGenerationEnabled
      ? {
          cashGenerations: draft.cashGenerations.map(
            (cashGeneration): AssetCashGenerationDefinition => ({
              name: cashGeneration.name.trim(),
              rate: Number(cashGeneration.rate),
              volatility: Number(cashGeneration.volatility),
              inflationCorrelation: Number(cashGeneration.inflationCorrelation),
              taxTreatment: cashGeneration.taxTreatment,
            })
          ),
        }
      : {}),
    ...(draft.saleTaxEnabled
      ? {
          saleTax: {
            ...(draft.saleTaxCostBasis.trim() ? { costBasis: parseEditableNumber(draft.saleTaxCostBasis) } : {}),
            taxTreatment: draft.saleTaxTreatment,
          } satisfies AssetSaleTaxDefinition,
        }
      : {}),
  }).toDefinition();
}

function assertAssetNameAvailable(assetName: string, originalName: string | null): void {
  const normalizedName = assetName.trim();
  if (!normalizedName) {
    return;
  }

  const duplicate = plannerState.assets.find(
    (asset) => asset.name === normalizedName && (originalName === null || asset.name !== originalName)
  );
  if (duplicate) {
    throw new Error(`Asset name "${normalizedName}" is already in use.`);
  }
}

function assertUniqueAssetNames(assets: readonly AssetDefinition[]): void {
  const seenNames = new Set<string>();
  for (const asset of assets) {
    const normalizedName = asset.name.trim();
    if (!normalizedName) {
      continue;
    }
    if (seenNames.has(normalizedName)) {
      throw new Error(`Asset name "${normalizedName}" is already in use.`);
    }
    seenNames.add(normalizedName);
  }
}

function buildTaxDefinition(draft: TaxDraft): TaxDefinition {
  const maximum = parseOptionalEditableNumber(draft.maximum);

  return buildNormalizedTaxDefinition({
    name: draft.name,
    taxRates: draft.rates.map(
      (rate): TaxRateDefinition => {
        const upTo = parseOptionalEditableNumber(rate.upTo);

        return {
          rate: Number(rate.rate),
          ...(upTo !== null ? { upTo } : {}),
        };
      }
    ),
    exclusions: draft.exclusions.map((exclusion): TaxExclusionDefinition => {
      const maximumExclusion = parseOptionalEditableNumber(exclusion.maximum);

      return {
        name: exclusion.name,
        amount: parseEditableNumber(exclusion.amount),
        ...(maximumExclusion !== null ? { maximum: maximumExclusion } : {}),
      };
    }),
    ...(maximum !== null ? { maximum } : {}),
  });
}

function buildTaxProfileDefinition(draft: TaxProfileDraft): HouseholdTaxProfileDefinition | null {
  const federalStandardDeduction = parseEditableNumber(draft.federalStandardDeduction);
  const otherSaltTaxesPaid = parseEditableNumber(draft.otherSaltTaxesPaid);
  const saltDeductionBaseCap = parseEditableNumber(draft.saltDeductionBaseCap);
  const saltDeductionFloorCap = parseEditableNumber(draft.saltDeductionFloorCap);
  const saltDeductionPhaseoutThreshold = parseEditableNumber(draft.saltDeductionPhaseoutThreshold);
  const otherItemizedDeductions = parseEditableNumber(draft.otherItemizedDeductions);
  const stateTaxableIncomeAdjustment = parseEditableNumber(draft.stateTaxableIncomeAdjustment);
  const localTaxableIncomeAdjustment = parseEditableNumber(draft.localTaxableIncomeAdjustment);
  const niitThreshold = parseEditableNumber(draft.niitThreshold);

  if (
    !Number.isFinite(federalStandardDeduction) ||
    !Number.isFinite(otherSaltTaxesPaid) ||
    !Number.isFinite(saltDeductionBaseCap) ||
    !Number.isFinite(saltDeductionFloorCap) ||
    !Number.isFinite(saltDeductionPhaseoutThreshold) ||
    !Number.isFinite(otherItemizedDeductions) ||
    !Number.isFinite(stateTaxableIncomeAdjustment) ||
    !Number.isFinite(localTaxableIncomeAdjustment) ||
    !Number.isFinite(niitThreshold)
  ) {
    return null;
  }

  return {
    filingStatus: draft.filingStatus,
    deductionMode: draft.deductionMode,
    federalStandardDeduction,
    otherSaltTaxesPaid,
    saltDeductionBaseCap,
    saltDeductionFloorCap,
    saltDeductionPhaseoutThreshold,
    saltDeductionPhaseoutRate: Number(draft.saltDeductionPhaseoutRate),
    otherItemizedDeductions,
    stateTaxableIncomeAdjustment,
    localTaxableIncomeAdjustment,
    niitThreshold,
    federalOrdinaryTaxName: draft.federalOrdinaryTaxName,
    federalQualifiedTaxName: draft.federalQualifiedTaxName,
    stateTaxName: draft.stateTaxName,
    stateCapitalGainsTaxName: draft.stateCapitalGainsTaxName,
    localTaxName: draft.localTaxName,
    niitTaxName: draft.niitTaxName,
  };
}

function syncTaxProfileDraft(): void {
  const profile = plannerState.taxProfile;
  taxProfileDraft.filingStatus = profile.filingStatus;
  taxProfileDraft.deductionMode = profile.deductionMode;
  taxProfileDraft.federalStandardDeduction = String(profile.federalStandardDeduction);
  taxProfileDraft.otherSaltTaxesPaid = String(profile.otherSaltTaxesPaid);
  taxProfileDraft.saltDeductionBaseCap = String(profile.saltDeductionBaseCap);
  taxProfileDraft.saltDeductionFloorCap = String(profile.saltDeductionFloorCap);
  taxProfileDraft.saltDeductionPhaseoutThreshold = String(profile.saltDeductionPhaseoutThreshold);
  taxProfileDraft.saltDeductionPhaseoutRate = String(profile.saltDeductionPhaseoutRate);
  taxProfileDraft.otherItemizedDeductions = String(profile.otherItemizedDeductions);
  taxProfileDraft.stateTaxableIncomeAdjustment = String(profile.stateTaxableIncomeAdjustment);
  taxProfileDraft.localTaxableIncomeAdjustment = String(profile.localTaxableIncomeAdjustment);
  taxProfileDraft.niitThreshold = String(profile.niitThreshold);
  taxProfileDraft.federalOrdinaryTaxName = profile.federalOrdinaryTaxName;
  taxProfileDraft.federalQualifiedTaxName = profile.federalQualifiedTaxName;
  taxProfileDraft.stateTaxName = profile.stateTaxName;
  taxProfileDraft.stateCapitalGainsTaxName = profile.stateCapitalGainsTaxName;
  taxProfileDraft.localTaxName = profile.localTaxName;
  taxProfileDraft.niitTaxName = profile.niitTaxName;
}

function closeAssetComposer(): void {
  assetComposerOpen = false;
  Object.assign(assetDraft, createAssetDraft());
}

function openAssetEditor(assetName: string): void {
  const asset = plannerState.assets.find((candidate) => candidate.name === assetName);
  if (!asset) {
    throw new Error(`Unknown asset "${assetName}".`);
  }

  const nextDraft = buildAssetDraftFromDefinition(asset, { preserveFormulaSource: true });
  assetEditorOpen = true;
  assetEditDraft.originalName = asset.name;
  Object.assign(assetEditDraft, nextDraft);
  assetEditDraft.correlations = Object.fromEntries(
    plannerState.assets
      .filter((candidate) => candidate.name !== asset.name)
      .map((candidate) => [
        candidate.name,
        String(getAssetCorrelationValue(plannerState.assetCorrelations, asset.name, candidate.name)),
      ])
  );
}

function closeAssetEditor(): void {
  assetEditorOpen = false;
  Object.assign(assetEditDraft, createAssetEditDraft());
}

function openTaxEditor(taxName: string): void {
  const tax = plannerState.taxes.find((candidate) => candidate.name === taxName);
  if (!tax) {
    throw new Error(`Unknown tax "${taxName}".`);
  }

  taxComposerOpen = true;
  taxDraft.originalName = tax.name;
  taxDraft.name = tax.name;
  taxDraft.maximum = tax.maximum === undefined ? "" : String(tax.maximum);
  taxDraft.rates = tax.taxRates.map((rate) => ({
    id: createId(),
    rate: String(rate.rate),
    upTo: rate.upTo === undefined ? "" : String(rate.upTo),
  }));
  taxDraft.exclusions = (tax.exclusions ?? []).map((exclusion) => ({
    id: createId(),
    name: exclusion.name,
    amount: String(exclusion.amount),
    maximum: exclusion.maximum === undefined ? "" : String(exclusion.maximum),
  }));
}

function closeTaxComposer(): void {
  taxComposerOpen = false;
  Object.assign(taxDraft, createTaxDraft());
}

function closeFlowComposer(): void {
  flowComposerOpen = false;
  Object.assign(flowDraft, createFlowDraft());
}

function resetFlowEventDraft(flowName: string, formula: string): void {
  flowEventDraft.originalName = null;
  flowEventDraft.year = plannerState.startYear;
  flowEventDraft.formula = formula;
}

function openFlowEditor(flowName: string): void {
  const flow = plannerState.flows.find((candidate) => candidate.name === flowName);
  if (!flow) {
    throw new Error(`Unknown flow "${flowName}".`);
  }

  flowEditorOpen = true;
  flowEditDraft.originalName = flow.name;
  flowEditDraft.type = flow.type;
  flowEditDraft.name = flow.name;
  flowEditDraft.taxTreatment = flow.taxTreatment ?? getDefaultFlowTaxTreatment(flow.type);
  flowEditDraft.oneTime = isFlowOneTimeMode(flow);
  flowEditDraft.formula = flowEditDraft.oneTime ? getOneTimeFormulaForFlow(flow) : flow.formula;
  flowEditDraft.inflationAdjusted = isFlowInflationAdjusted(flow);
  flowEditDraft.oneTimeYear = flowEditDraft.oneTime ? getOneTimeYearForFlow(flow) : plannerState.startYear;
  flowEditDraft.startYear = flow.startYear === undefined ? plannerState.startYear : String(flow.startYear);
  flowEditDraft.endYear = flow.endYear === undefined ? "" : String(flow.endYear);
  flowEditDraft.annualRaisePercent = String(flow.annualRaisePercent ?? 0);
  activeFlowEventEdit = null;
  resetFlowEventDraft(flow.name, flow.formula);
}

function closeFlowEditor(): void {
  flowEditorOpen = false;
  activeFlowEventEdit = null;
  Object.assign(flowEditDraft, createFlowEditDraft());
  flowEventDraft.originalName = null;
  flowEventDraft.year = plannerState.startYear;
  flowEventDraft.formula = "";
}

function closeEventComposer(): void {
  eventComposerOpen = false;
  eventDraft.originalName = null;
  eventDraft.name = "";
  eventDraft.flowName = plannerState.flows[0]?.name ?? "";
  eventDraft.entries = [createEventEntryDraft(eventDraft.flowName)];
}

function closeTopmostModal(): boolean {
  if (flowEditorOpen) {
    closeFlowEditor();
    return true;
  }

  if (eventComposerOpen) {
    closeEventComposer();
    return true;
  }

  if (taxComposerOpen) {
    closeTaxComposer();
    return true;
  }

  if (assetEditorOpen) {
    closeAssetEditor();
    return true;
  }

  if (flowComposerOpen) {
    closeFlowComposer();
    return true;
  }

  if (assetComposerOpen) {
    closeAssetComposer();
    return true;
  }

  return false;
}

function closeTransientPlannerUi(): void {
  closeAssetComposer();
  closeAssetEditor();
  closeTaxComposer();
  closeFlowComposer();
  closeFlowEditor();
  closeEventComposer();
  activeInlineAssetValueEditName = null;
  activeInlineExpenseValueEditName = null;
}

function openEventEditor(eventName: string): void {
  const event = plannerState.events.find((candidate) => candidate.name === eventName);
  if (!event) {
    throw new Error(`Unknown event "${eventName}".`);
  }

  eventComposerOpen = true;
  eventDraft.originalName = event.name;
  eventDraft.name = event.name;
  eventDraft.flowName = event.flowName;
  eventDraft.entries = event.schedule.map((entry) => ({
    id: createId(),
    year: String(entry.year.year),
    actions: entry.actions.map(toEventActionDraft),
  }));
}

function updateInitialVariableValue(variableName: string, nextValue: number): void {
  plannerState.variables = plannerState.variables.map((variable) =>
    variable.name === variableName ? { ...variable, value: nextValue } : variable
  );
}

function updateAsset(assetName: string, nextAsset: AssetDefinition): void {
  plannerState.assets = plannerState.assets.map((asset) =>
    asset.name === assetName ? nextAsset : asset
  );
}

async function saveInlineAssetValue(assetName: string, formula: string, user: UserIdentity): Promise<boolean> {
  const existingAsset = plannerState.assets.find((asset) => asset.name === assetName);
  if (!existingAsset) {
    return false;
  }

  const previousFormulas = getAssetDefinitionFormulas(existingAsset);
  try {
    ensurePlannerVariablesExist(collectMissingFormulaVariables([formula]));
    const resolvedValue = isInvestmentAsset(existingAsset)
      ? resolveAssetValueInput(formula, "Value")
      : resolveAssetValueInput(formula, "Home price");

    updateAsset(
      assetName,
      isInvestmentAsset(existingAsset)
        ? (() => {
            const { startingValueFormula: _startingValueFormula, ...nextAsset } = existingAsset;
            return {
              ...nextAsset,
              startingValue: resolvedValue.value,
              ...(resolvedValue.formula ? { startingValueFormula: resolvedValue.formula } : {}),
            };
          })()
        : (() => {
            const { initialCostFormula: _initialCostFormula, ...nextAsset } = existingAsset;
            return {
              ...nextAsset,
              initialCost: resolvedValue.value,
              ...(resolvedValue.formula ? { initialCostFormula: resolvedValue.formula } : {}),
            };
          })()
    );
  } catch (error) {
    window.alert(error instanceof Error ? error.message : "Asset value could not be saved.");
    return false;
  }

  const nextAsset = plannerState.assets.find((asset) => asset.name === assetName);
  if (nextAsset) {
    pruneUnusedPlannerVariables(collectRemovedFormulaVariables(previousFormulas, getAssetDefinitionFormulas(nextAsset)));
  }

  syncSimulationDraftAssetRows();
  invalidateSimulationState();
  activeInlineAssetValueEditName = null;
  await persistPlannerState(user);
  renderPlanner(user);
  return true;
}

async function saveInlineExpenseValue(flowName: string, formula: string, user: UserIdentity): Promise<boolean> {
  const existingFlow = plannerState.flows.find((flow) => flow.name === flowName);
  if (!existingFlow) {
    return false;
  }

  const trimmedFormula = formula.trim();
  const previousFormulas = [existingFlow.formula];

  try {
    const validation = validateFormula(trimmedFormula, plannerState.variables.map((variable) => variable.name), "Amount");
    if (!validation.valid) {
      throw new Error(validation.message);
    }

    ensurePlannerVariablesExist(collectMissingFormulaVariables([trimmedFormula]));
    updateFlow(flowName, {
      ...existingFlow,
      formula: trimmedFormula,
    });
    pruneUnusedPlannerVariables(collectRemovedFormulaVariables(previousFormulas, [trimmedFormula]));
  } catch (error) {
    window.alert(error instanceof Error ? error.message : "Flow value could not be saved.");
    return false;
  }

  syncSimulationDraftAssetRows();
  invalidateSimulationState();
  activeInlineExpenseValueEditName = null;
  await persistPlannerState(user);
  renderPlanner(user);
  return true;
}

function updateAssetCorrelations(
  originalAssetName: string,
  nextAssetName: string,
  correlations: Record<string, string>
): void {
  const trimmedName = nextAssetName.trim();
  const renamedCorrelations = plannerState.assetCorrelations
    .map((correlation) => ({
      assetA: correlation.assetA === originalAssetName ? trimmedName : correlation.assetA,
      assetB: correlation.assetB === originalAssetName ? trimmedName : correlation.assetB,
      correlation: correlation.correlation,
    }))
    .filter((correlation) => correlation.assetA !== trimmedName && correlation.assetB !== trimmedName)
    .map((correlation) => createAssetCorrelationDefinition(correlation));

  const nextCorrelations = [...renamedCorrelations];

  for (const [otherAssetName, correlationValue] of Object.entries(correlations)) {
    const trimmedOther = otherAssetName.trim();
    const numericCorrelation = Number(correlationValue);

    if (!trimmedName || !trimmedOther || trimmedName === trimmedOther || !Number.isFinite(numericCorrelation)) {
      continue;
    }

    nextCorrelations.push(
      createAssetCorrelationDefinition({
        assetA: trimmedName,
        assetB: trimmedOther,
        correlation: numericCorrelation,
      })
    );
  }

  const deduped = new Map<string, AssetCorrelationDefinition>();
  for (const correlation of nextCorrelations) {
    deduped.set(`${correlation.assetA}|${correlation.assetB}`, correlation);
  }
  plannerState.assetCorrelations = [...deduped.values()];
}

function deleteAsset(assetName: string): void {
  const result = deleteAssetAndPruneCorrelations(
    plannerState.assets,
    plannerState.assetCorrelations,
    assetName
  );
  plannerState.assets = result.assets;
  plannerState.assetCorrelations = result.correlations;
}

function updateFlow(flowName: string, nextFlow: FlowDefinition): void {
  plannerState.flows = plannerState.flows.map((flow) =>
    flow.name === flowName ? nextFlow : flow
  );

  if (flowName === nextFlow.name) {
    return;
  }

  plannerState.events = plannerState.events.map(
    (event) =>
      new Event({
        name: event.name,
        flowName: event.flowName === flowName ? nextFlow.name : event.flowName,
        schedule: event.schedule.map((entry) => ({
          year: { ...entry.year },
          actions: entry.actions.map((action) =>
            action.kind === "set-flow-formula" && action.flowName === flowName
              ? { ...action, flowName: nextFlow.name }
              : action
          ),
        })),
      })
  );
}

function deleteFlow(flowName: string): void {
  const result = deleteFlowAndPruneVariables(createPlannerSnapshot(), flowName);
  plannerState.variables = result.variables;
  plannerState.flows = result.flows;
  plannerState.events = result.events.map((event) => new Event(event));
}

function deleteEvent(eventName: string): void {
  const result = deleteEventAndPruneVariables(createPlannerSnapshot(), eventName);
  plannerState.variables = result.variables;
  plannerState.flows = result.flows;
  plannerState.events = result.events.map((event) => new Event(event));
}

function createPlannerSnapshot(): {
  variables: VariableDefinition[];
  assets: AssetDefinition[];
  taxes: TaxDefinition[];
  taxProfile: HouseholdTaxProfileDefinition;
  assetCorrelations: AssetCorrelationDefinition[];
  flows: FlowDefinition[];
  events: EventDefinition[];
} {
  return {
    variables: [...plannerState.variables],
    assets: [...plannerState.assets],
    taxes: [...plannerState.taxes],
    taxProfile: { ...plannerState.taxProfile },
    assetCorrelations: [...plannerState.assetCorrelations],
    flows: [...plannerState.flows],
    events: plannerState.events.map((event) => ({
      name: event.name,
      flowName: event.flowName,
      schedule: event.schedule.map((entry) => ({
        year: { ...entry.year },
        actions: [...entry.actions],
      })),
    })),
  };
}

function applySavedPlannerState(savedState: SavedPlannerState): void {
  const fallbackState = createDefaultPlannerState();
  const fallbackSimulationDraft = createSimulationDraft();
  const partialState = savedState as Partial<SavedPlannerState> & {
    monthViewStartMonth?: string;
    monthViewMonthsToShow?: number;
    yearViewStartMonth?: string;
    yearViewYearsToShow?: number;
    startMonth?: string;
    monthsToShow?: number;
    yearViewMonthsToShow?: number;
  };

  plannerState.variables = Array.isArray(partialState.variables) ? partialState.variables : fallbackState.variables;
  plannerState.assets = Array.isArray(partialState.assets)
    ? migratePersistedAssets(partialState.assets, partialState.assetSellWeightMode, plannerState.variables)
    : fallbackState.assets;
  assertUniqueAssetNames(plannerState.assets);
  plannerState.taxes = Array.isArray(partialState.taxes)
    ? partialState.taxes.map((tax) => buildNormalizedTaxDefinition(tax))
    : fallbackState.taxes;
  plannerState.taxProfile = buildTaxProfileDefinitionFromSaved(
    (partialState as Partial<SavedPlannerState> & { taxProfile?: Partial<HouseholdTaxProfileDefinition> }).taxProfile,
    plannerState.taxes,
    fallbackState.taxProfile
  );
  plannerState.assetCorrelations = Array.isArray(partialState.assetCorrelations)
    ? partialState.assetCorrelations.map((correlation) => createAssetCorrelationDefinition(correlation))
    : fallbackState.assetCorrelations;
  plannerState.flows = Array.isArray(partialState.flows)
    ? partialState.flows.map((flow) => new Flow(flow).toDefinition())
    : fallbackState.flows;
  plannerState.events = Array.isArray(partialState.events)
    ? partialState.events.map((event) => new Event(toEventDefinition(event)))
    : fallbackState.events;
  plannerState.startYear = normalizeYearInput(
    partialState.startYear ??
      deriveYearString(partialState.monthViewStartMonth) ??
      deriveYearString(partialState.yearViewStartMonth) ??
      deriveYearString(partialState.startMonth)
  );
  plannerState.yearsToShow =
    typeof partialState.yearsToShow === "number" && Number.isFinite(partialState.yearsToShow)
      ? Math.max(1, Math.min(10, partialState.yearsToShow))
      : typeof partialState.yearViewYearsToShow === "number" && Number.isFinite(partialState.yearViewYearsToShow)
        ? Math.max(1, Math.min(10, partialState.yearViewYearsToShow))
        : typeof partialState.yearViewMonthsToShow === "number" &&
            Number.isFinite(partialState.yearViewMonthsToShow)
          ? Math.max(1, Math.min(10, Math.ceil(partialState.yearViewMonthsToShow / 12)))
          : typeof partialState.monthViewMonthsToShow === "number" &&
              Number.isFinite(partialState.monthViewMonthsToShow)
            ? Math.max(1, Math.min(10, Math.ceil(partialState.monthViewMonthsToShow / 12)))
            : typeof partialState.monthsToShow === "number" && Number.isFinite(partialState.monthsToShow)
              ? Math.max(1, Math.min(10, Math.ceil(partialState.monthsToShow / 12)))
              : fallbackState.yearsToShow;
  simulationDraft.startYear = plannerState.startYear;
  simulationDraft.attempts =
    typeof partialState.simulationAttempts === "number" && Number.isFinite(partialState.simulationAttempts)
      ? Math.max(1000, Math.min(50000, partialState.simulationAttempts))
      : fallbackSimulationDraft.attempts;
  simulationDraft.currentAge =
    typeof partialState.simulationCurrentAge === "number" && Number.isFinite(partialState.simulationCurrentAge)
      ? normalizeSimulationCurrentAge(partialState.simulationCurrentAge)
      : fallbackSimulationDraft.currentAge;
  simulationDraft.taxPreset = normalizeSimulationTaxPreset(
    partialState.simulationTaxPreset,
    fallbackSimulationDraft.taxPreset
  );
  simulationDraft.horizonYears = normalizeSimulationHorizonYears(partialState.simulationHorizonYears);
  simulationDraft.customAssetLiquidation = partialState.simulationCustomAssetLiquidation === true;
  simulationDraft.inflationPreset = normalizeSimulationInflationPreset(partialState.simulationInflation);
  simulationDraft.fixedInflationRate =
    typeof partialState.simulationInflation?.fixedRate === "number" && Number.isFinite(partialState.simulationInflation.fixedRate)
      ? formatEditableNumberInput(String(partialState.simulationInflation.fixedRate))
      : typeof partialState.simulationInflationRate === "number" && Number.isFinite(partialState.simulationInflationRate)
        ? formatEditableNumberInput(String(partialState.simulationInflationRate))
        : fallbackSimulationDraft.fixedInflationRate;
  simulationDraft.regimeSwitchingInflation.lowAverageRate =
    getSavedRegimeSwitchingInflationValue(partialState.simulationInflation?.regimeSwitching, "lowAverageRate") !== null
      ? formatEditableNumberInput(
          String(getSavedRegimeSwitchingInflationValue(partialState.simulationInflation?.regimeSwitching, "lowAverageRate"))
        )
      : fallbackSimulationDraft.regimeSwitchingInflation.lowAverageRate;
  simulationDraft.regimeSwitchingInflation.lowVolatility =
    getSavedRegimeSwitchingInflationValue(partialState.simulationInflation?.regimeSwitching, "lowVolatility") !== null
      ? formatEditableNumberInput(
          String(getSavedRegimeSwitchingInflationValue(partialState.simulationInflation?.regimeSwitching, "lowVolatility"))
        )
      : fallbackSimulationDraft.regimeSwitchingInflation.lowVolatility;
  simulationDraft.regimeSwitchingInflation.highAverageRate =
    getSavedRegimeSwitchingInflationValue(partialState.simulationInflation?.regimeSwitching, "highAverageRate") !== null
      ? formatEditableNumberInput(
          String(getSavedRegimeSwitchingInflationValue(partialState.simulationInflation?.regimeSwitching, "highAverageRate"))
        )
      : fallbackSimulationDraft.regimeSwitchingInflation.highAverageRate;
  simulationDraft.regimeSwitchingInflation.highVolatility =
    getSavedRegimeSwitchingInflationValue(partialState.simulationInflation?.regimeSwitching, "highVolatility") !== null
      ? formatEditableNumberInput(
          String(getSavedRegimeSwitchingInflationValue(partialState.simulationInflation?.regimeSwitching, "highVolatility"))
        )
      : fallbackSimulationDraft.regimeSwitchingInflation.highVolatility;
  simulationDraft.regimeSwitchingInflation.stayLowProbability =
    getSavedRegimeSwitchingInflationValue(partialState.simulationInflation?.regimeSwitching, "stayLowProbability") !== null
      ? formatEditableNumberInput(
          String(getSavedRegimeSwitchingInflationValue(partialState.simulationInflation?.regimeSwitching, "stayLowProbability"))
        )
      : fallbackSimulationDraft.regimeSwitchingInflation.stayLowProbability;
  simulationDraft.regimeSwitchingInflation.stayHighProbability =
    getSavedRegimeSwitchingInflationValue(partialState.simulationInflation?.regimeSwitching, "stayHighProbability") !== null
      ? formatEditableNumberInput(
          String(getSavedRegimeSwitchingInflationValue(partialState.simulationInflation?.regimeSwitching, "stayHighProbability"))
        )
      : fallbackSimulationDraft.regimeSwitchingInflation.stayHighProbability;
  simulationDraft.variableSweep.enabled = partialState.simulationVariableSweep?.enabled === true;
  simulationDraft.variableSweep.variableName =
    typeof partialState.simulationVariableSweep?.variableName === "string"
      ? partialState.simulationVariableSweep.variableName
      : fallbackSimulationDraft.variableSweep.variableName;
  simulationDraft.variableSweep.minValue =
    typeof partialState.simulationVariableSweep?.minValue === "number" &&
    Number.isFinite(partialState.simulationVariableSweep.minValue)
      ? formatEditableNumberInput(String(partialState.simulationVariableSweep.minValue))
      : fallbackSimulationDraft.variableSweep.minValue;
  simulationDraft.variableSweep.maxValue =
    typeof partialState.simulationVariableSweep?.maxValue === "number" &&
    Number.isFinite(partialState.simulationVariableSweep.maxValue)
      ? formatEditableNumberInput(String(partialState.simulationVariableSweep.maxValue))
      : fallbackSimulationDraft.variableSweep.maxValue;
  syncTaxProfileDraft();
  syncSimulationDraftAssetRows();
  syncSimulationVariableSweepDraft();
}

async function persistPlannerState(user: UserIdentity): Promise<void> {
  persistSimulationSettingsDraftToLocalStorage(user.id);
  persistVariableSweepDraftToLocalStorage(user.id);
  persistSimulationTaxPresetToLocalStorage(user.id);
  await storage.savePlannerState(buildPersistedPlannerStateRecord(user));
}

function inferPersistedEventFlowName(savedEvent: SavedPlannerState["events"][number]): string {
  if (typeof savedEvent.flowName === "string" && savedEvent.flowName.trim()) {
    return savedEvent.flowName.trim();
  }

  const referencedFlowNames = new Set<string>();
  for (const entry of savedEvent.schedule) {
    for (const action of entry.actions) {
      if (action.kind === "set-flow-formula" && action.flowName?.trim()) {
        referencedFlowNames.add(action.flowName.trim());
      }
    }
  }

  return referencedFlowNames.size === 1 ? [...referencedFlowNames][0] : "";
}

function toEventDefinition(savedEvent: SavedPlannerState["events"][number]): EventDefinition {
  return {
    name: savedEvent.name,
    flowName: inferPersistedEventFlowName(savedEvent),
    schedule: savedEvent.schedule.map((entry) => ({
      year: {
        year: entry.year?.year ?? deriveEventYear(entry),
      },
      actions: entry.actions.map((action) => {
        switch (action.kind) {
          case "adjust-variable":
            return {
              kind: "adjust-variable" as const,
              variableName: action.variableName ?? "",
              adjustment: action.adjustment ?? { m: 1, b: 0 },
            };
          case "set-flow-formula":
            return {
              kind: "set-flow-formula" as const,
              flowName: action.flowName ?? "",
              formula: action.formula ?? "",
            };
          case "add-variable":
            return {
              kind: "add-variable" as const,
              variable: action.variable ?? { name: "", value: 0 },
            };
          case "add-flow":
            return {
              kind: "add-flow" as const,
              flow: action.flow ?? { name: "", type: "expense", formula: "" },
            };
        }
      }),
    })),
  };
}

function serializeEvents(events: readonly EventDefinition[]): SavedPlannerState["events"] {
  return events.map((event) => ({
    name: event.name,
    flowName: event.flowName,
    schedule: event.schedule.map((entry) => ({
      year: { ...entry.year },
      actions: entry.actions.map((action) => {
        switch (action.kind) {
          case "adjust-variable":
            return {
              kind: "adjust-variable" as const,
              variableName: action.variableName,
              adjustment: { ...action.adjustment },
            };
          case "set-flow-formula":
            return {
              kind: "set-flow-formula" as const,
              flowName: action.flowName,
              formula: action.formula,
            };
          case "add-variable":
            return {
              kind: "add-variable" as const,
              variable: { ...action.variable },
            };
          case "add-flow":
            return {
              kind: "add-flow" as const,
              flow: { ...action.flow },
            };
        }
      }),
    })),
  }));
}

function bindModalDismissHandlers(user: UserIdentity): void {
  if (modalEscapeHandlerBound) {
    return;
  }

  modalEscapeHandlerBound = true;
  document.addEventListener("keydown", (event) => {
    if (
      event.key !== "Escape" ||
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }

    if (!closeTopmostModal()) {
      return;
    }

    event.preventDefault();
    renderPlanner(user);
  });

  document.addEventListener("pointerdown", (event) => {
    if (!(event.target instanceof HTMLElement) || !event.target.classList.contains("modal-shell")) {
      modalPointerDownStartedOnBackdrop = false;
      return;
    }

    modalPointerDownStartedOnBackdrop = true;
  });

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement) || !event.target.classList.contains("modal-shell")) {
      modalPointerDownStartedOnBackdrop = false;
      return;
    }

    if (!modalPointerDownStartedOnBackdrop) {
      return;
    }

    modalPointerDownStartedOnBackdrop = false;
    if (!closeTopmostModal()) {
      return;
    }

    renderPlanner(user);
  });
}

async function bootstrap(): Promise<void> {
  const user = await auth.getCurrentUser();
  const savedState = await storage.getPlannerState(user.id);
  if (savedState) {
    applySavedPlannerState(savedState);
  } else {
    await persistPlannerState(user);
  }
  applySimulationSettingsDraftFromLocalStorage(user.id);
  applySimulationTaxPresetFromLocalStorage(user.id);
  applyVariableSweepDraftFromLocalStorage(user.id);
  syncSimulationVariableSweepDraft();
  bindModalDismissHandlers(user);
  renderPlanner(user);
  mountedAppRoot.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.name !== "simulationSweepStep") {
      return;
    }

    if (!simulationSweepResults) {
      return;
    }

    selectedSimulationSweepStepIndex = Math.max(
      0,
      Math.min(simulationSweepResults.steps.length - 1, Number(target.value) || 0)
    );
    expandedSimulationExampleKeys = new Set();
    syncSimulationSweepSelectionDisplay();
    refreshSimulationResultsPanel(user);
  });
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  mountedAppRoot.innerHTML = `<div class="app-shell"><p class="error-copy">The planner failed to load. Check the console for details.</p></div>`;
});
