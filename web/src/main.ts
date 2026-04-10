import { formatCurrency } from "./calculator.js";
import { StubAuthService, type UserIdentity } from "./auth.js";
import { buildScenarioFileContents, extractScenarioPlannerState } from "./scenario.js";
import { createPlanningStorage, type SavedPlannerState } from "./storage.js";
import {
  VARIABLE_SWEEP_STEP_COUNT,
  buildVariableSweepValues,
  buildSimulationScenariosFromAggregates,
  getAssetCorrelationValue,
  selectRepresentativeSimulationScenario,
  type SimulationDetailScenario,
  type SimulationDetailYearRow,
  type SimulationPercentile,
  type SimulationScenario,
} from "./simulation.js";
import {
  Asset,
  Event,
  Flow,
  Variable,
  applyFlowExpenseInflation,
  applyEventsForYear,
  collectFormulaVariableNames,
  createAssetCorrelationDefinition,
  createOneTimeExpenseSchedule,
  DEFAULT_EXPENSE_INFLATION_RATE,
  deleteAssetAndPruneCorrelations,
  deleteEventAndPruneVariables,
  deleteFlowAndPruneVariables,
  createFormulaContext,
  isFlowInflationAdjusted,
  type FlowTaxTreatment,
  type AssetCashTaxTreatment,
  type AssetCashGenerationDefinition,
  type AssetCorrelationDefinition,
  type HomeAssetDefinition,
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
  type DeductionMode,
  type FilingStatus,
  type HouseholdTaxInput,
  type HouseholdTaxProfileDefinition,
  type TaxDefinition,
  type TaxExclusionDefinition,
  type TaxRateDefinition,
} from "./tax.js";
import type {
  SimulationWorkerRunInput,
  SimulationWorkerResponse,
} from "./simulation-worker.js";

type EventActionDraftKind = EventAction["kind"] | "one-time-expense";

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

interface FlowVariableDraft {
  id: string;
  name: string;
  value: string;
}

interface FlowDraft {
  name: string;
  taxTreatment: FlowTaxTreatment;
  formula: string;
  inflationAdjusted: boolean;
  oneTime: boolean;
  variables: FlowVariableDraft[];
}

interface FlowEditDraft {
  originalName: string;
  name: string;
  taxTreatment: FlowTaxTreatment;
  formula: string;
  inflationAdjusted: boolean;
  oneTime: boolean;
}

interface FlowEventDraft {
  originalName: string | null;
  year: string;
  formula: string;
}

interface ActiveFlowEventEdit {
  eventName: string | null;
  field: "year" | "formula";
}

interface AssetDraft {
  kind: "investment" | "home";
  name: string;
  startingValue: string;
  expectedReturn: string;
  volatility: string;
  initialCost: string;
  cashPurchasePercent: string;
  mortgageType: "amortizing" | "interest-only";
  mortgageRate: string;
  mortgageTermYears: string;
  monthlyNonTaxCosts: string;
  propertyTaxRate: string;
  purchaseYear: string;
  cashGenerationEnabled: boolean;
  cashGenerations: AssetCashGenerationDraft[];
  saleTaxEnabled: boolean;
  saleTaxCostBasis: string;
  saleTaxTreatment: AssetSaleTaxTreatment;
}

interface AssetCashGenerationDraft {
  id: string;
  name: string;
  rate: string;
  volatility: string;
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

interface VariableSweepDraft {
  enabled: boolean;
  variableName: string;
  minValue: string;
  maxValue: string;
}

interface SimulationDraft {
  startYear: string;
  attempts: number;
  horizonYears: number;
  taxPreset: TaxPreset;
  assetRows: SimulationAssetDraft[];
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

type SummaryTab = "variables" | "assets" | "taxes";
type PlannerBoardTab = "setup" | "simulation";
type TaxPreset = "nyc";
const VARIABLE_SWEEP_STORAGE_KEY_PREFIX = "soroban:simulation-variable-sweep:";
// When true, each active worker is assigned a distinct sweep value before any sweep is split into chunks.
const ENABLE_VARIABLE_SWEEP_WORKER_FANOUT = true;
const VARIABLE_SWEEP_DETAIL_SAMPLE_LIMIT = 128;

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

const mountedAppRoot = requireElement(appRoot, "#app");

const plannerState: PlannerState = createDefaultPlannerState();

const eventDraft: EventDraft = {
  originalName: null,
  name: "",
  flowName: plannerState.flows[0]?.name ?? "",
  entries: [createEventEntryDraft()],
};

const flowDraft: FlowDraft = {
  name: "",
  taxTreatment: "nondeductible-expense",
  formula: "",
  inflationAdjusted: true,
  oneTime: false,
  variables: [],
};

const flowEditDraft: FlowEditDraft = {
  originalName: "",
  name: "",
  taxTreatment: "nondeductible-expense",
  formula: "",
  inflationAdjusted: true,
  oneTime: false,
};

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
let activeFlowEventEdit: ActiveFlowEventEdit | null = null;
let activeSummaryTab: SummaryTab = "variables";
let activePlannerBoardTab: PlannerBoardTab = "setup";
let activeInlineAssetValueEditName: string | null = null;
let selectedSimulationPercentile: SimulationPercentile = 50;
let simulationResults: Map<SimulationPercentile, SimulationScenario> | null = null;
let simulationDetailResults: SimulationDetailScenario[] | null = null;
let simulationSweepResults: SimulationSweepResult | null = null;
let selectedSimulationSweepStepIndex = 0;
let expandedSimulationExampleKeys = new Set<string>();
let simulationRunState: SimulationRunState | null = null;
let activeSimulationWorkers: Worker[] = [];
let activeSimulationRequestId = 0;
let taxProfilePersistTimeout: number | null = null;
const simulationPercentiles: readonly SimulationPercentile[] = [5, 10, 25, 50, 75, 90];
syncTaxProfileDraft();

function createEventEntryDraft(flowName = plannerState.flows[0]?.name ?? ""): EventEntryDraft {
  return {
    id: createId(),
    year: plannerState.startYear,
    actions: [createActionDraft(flowName)],
  };
}

function createFlowVariableDraft(): FlowVariableDraft {
  return {
    id: createId(),
    name: "",
    value: "0",
  };
}

function createAssetDraft(): AssetDraft {
  return {
    kind: "investment",
    name: "",
    startingValue: "0",
    expectedReturn: "0",
    volatility: "0",
    initialCost: "0",
    cashPurchasePercent: "20",
    mortgageType: "amortizing",
    mortgageRate: "6",
    mortgageTermYears: "30",
    monthlyNonTaxCosts: "0",
    propertyTaxRate: "1",
    purchaseYear: String(new Date().getFullYear()),
    cashGenerationEnabled: false,
    cashGenerations: [createAssetCashGenerationDraft()],
    saleTaxEnabled: false,
    saleTaxCostBasis: "0",
    saleTaxTreatment: "long-term-capital-gains",
  };
}

function createAssetCashGenerationDraft(): AssetCashGenerationDraft {
  return {
    id: createId(),
    name: "",
    rate: "0",
    volatility: "0",
    taxTreatment: "ordinary-income",
  };
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
    attempts: 10000,
    horizonYears: 10,
    taxPreset: "nyc",
    assetRows: [],
    variableSweep: {
      enabled: false,
      variableName: "",
      minValue: "0",
      maxValue: "0",
    },
  };
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
  };
}

function isHomeAsset(asset: AssetDefinition): asset is HomeAssetDefinition {
  return asset.kind === "home";
}

function isInvestmentAsset(asset: AssetDefinition): asset is InvestmentAssetDefinition {
  return asset.kind !== "home";
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

function getAssetSummaryValue(asset: AssetDefinition): number {
  return isHomeAsset(asset) ? asset.initialCost : asset.startingValue;
}

function buildAssetDraftFromDefinition(asset: AssetDefinition): AssetDraft {
  const cashGenerations = getAssetCashGenerations(asset);
  return {
    kind: asset.kind === "home" ? "home" : "investment",
    name: asset.name,
    startingValue: String(isInvestmentAsset(asset) ? asset.startingValue : 0),
    expectedReturn: String(asset.expectedReturn),
    volatility: String(asset.volatility),
    initialCost: String(isHomeAsset(asset) ? asset.initialCost : 0),
    cashPurchasePercent: String(isHomeAsset(asset) ? asset.cashPurchasePercent * 100 : 20),
    mortgageType: isHomeAsset(asset) ? asset.mortgageType ?? "amortizing" : "amortizing",
    mortgageRate: String(isHomeAsset(asset) ? asset.mortgageRate : 6),
    mortgageTermYears: String(isHomeAsset(asset) ? asset.mortgageTermYears : 30),
    monthlyNonTaxCosts: String(isHomeAsset(asset) ? asset.monthlyNonTaxCosts : 0),
    propertyTaxRate: String(isHomeAsset(asset) ? asset.propertyTaxRate : 1),
    purchaseYear: String(isHomeAsset(asset) ? asset.purchaseYear : new Date().getFullYear()),
    cashGenerationEnabled: cashGenerations.length > 0,
    cashGenerations:
      cashGenerations.length > 0
        ? cashGenerations.map((cashGeneration, index) => ({
            id: createId(),
            name: cashGeneration.name ?? `Cash generation ${index + 1}`,
            rate: String(cashGeneration.rate),
            volatility: String(cashGeneration.volatility),
            taxTreatment: cashGeneration.taxTreatment ?? "ordinary-income",
          }))
        : [createAssetCashGenerationDraft()],
    saleTaxEnabled: isInvestmentAsset(asset) && Boolean(asset.saleTax),
    saleTaxCostBasis: String(isInvestmentAsset(asset) ? asset.saleTax?.costBasis ?? 0 : 0),
    saleTaxTreatment:
      isInvestmentAsset(asset) ? asset.saleTax?.taxTreatment ?? "long-term-capital-gains" : "long-term-capital-gains",
  };
}

function migratePersistedAsset(
  asset: SavedPlannerState["assets"][number]
): AssetDefinition {
  if (asset.kind === "home") {
    return new Asset({
      kind: "home",
      name: asset.name,
      initialCost: asset.initialCost ?? 0,
      expectedReturn: asset.expectedReturn,
      volatility: asset.volatility,
      cashPurchasePercent: asset.cashPurchasePercent ?? 0,
      mortgageType: asset.mortgageType ?? "amortizing",
      mortgageRate: asset.mortgageRate ?? 0,
      mortgageTermYears: asset.mortgageTermYears ?? 30,
      monthlyNonTaxCosts: asset.monthlyNonTaxCosts ?? 0,
      propertyTaxRate: asset.propertyTaxRate ?? 0,
      purchaseYear: asset.purchaseYear ?? new Date().getFullYear(),
    }).toDefinition();
  }

  const persistedCashGenerations =
    Array.isArray(asset.cashGenerations) && asset.cashGenerations.length > 0
      ? asset.cashGenerations
      : asset.cashGeneration
        ? [asset.cashGeneration]
        : [];
  const legacyTaxNames = persistedCashGenerations.flatMap((cashGeneration) => cashGeneration.taxNames ?? []);
  const legacySaleTaxNames = asset.saleTax?.taxNames ?? [];
  const inferredCashGenerationTaxTreatment: AssetCashTaxTreatment =
    legacyTaxNames.some((name) => /qualified|capital/i.test(name))
      ? "qualified-dividends"
      : legacyTaxNames.some((name) => /exempt/i.test(name))
        ? "tax-exempt-income"
        : "ordinary-income";
  const inferredSaleTaxTreatment: AssetSaleTaxTreatment =
    legacySaleTaxNames.some((name) => /short/i.test(name))
      ? "short-term-capital-gains"
      : legacySaleTaxNames.some((name) => /capital|qualified/i.test(name))
        ? "long-term-capital-gains"
        : "long-term-capital-gains";

  const migratedSaleTax =
    asset.saleTax === undefined
      ? undefined
      : {
          costBasis:
            typeof asset.saleTax.costBasis === "number"
              ? asset.saleTax.costBasis
              : (asset.startingValue ?? 0) * (1 - Math.max(0, Math.min(1, asset.saleTax.taxableGainProportion ?? 0))),
          taxTreatment:
            "taxTreatment" in asset.saleTax && asset.saleTax.taxTreatment
              ? asset.saleTax.taxTreatment
              : inferredSaleTaxTreatment,
        };

  return new Asset({
    name: asset.name,
    startingValue: asset.startingValue ?? 0,
    expectedReturn: asset.expectedReturn,
    volatility: asset.volatility,
    sellProportion:
      typeof asset.sellProportion === "number" && Number.isFinite(asset.sellProportion)
        ? asset.sellProportion
        : 0,
    ...(persistedCashGenerations.length > 0
      ? {
          cashGenerations: persistedCashGenerations.map((cashGeneration, index) => ({
            name: cashGeneration.name ?? `Cash generation ${index + 1}`,
            rate: cashGeneration.rate,
            volatility: cashGeneration.volatility,
            taxTreatment:
              "taxTreatment" in cashGeneration && cashGeneration.taxTreatment
                ? cashGeneration.taxTreatment
                : inferredCashGenerationTaxTreatment,
          })),
        }
      : {}),
    ...(migratedSaleTax ? { saleTax: migratedSaleTax } : {}),
  }).toDefinition();
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
    filingStatus: next.filingStatus,
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
    localTaxName: availableTaxNames.has(next.localTaxName) ? next.localTaxName : "",
    niitTaxName: availableTaxNames.has(next.niitTaxName) ? next.niitTaxName : "",
  };
}

function createDefaultPlannerState(): PlannerState {
  return {
    variables: [
      { name: "salary", value: 6200 },
      { name: "rent", value: 2150 },
      { name: "groceries", value: 650 },
    ],
    assets: [],
    taxes: [],
    taxProfile: createDefaultHouseholdTaxProfile(),
    assetCorrelations: [],
    flows: [
      { name: "Salary", type: "income", formula: "salary", taxTreatment: "wages" },
      {
        name: "Rent",
        type: "expense",
        formula: "rent",
        taxTreatment: "nondeductible-expense",
        inflationAdjusted: true,
      },
      {
        name: "Groceries",
        type: "expense",
        formula: "groceries",
        taxTreatment: "nondeductible-expense",
        inflationAdjusted: true,
      },
    ],
    events: [
      new Event({
        name: "Spring raise",
        flowName: "Salary",
        schedule: [
          {
            year: { year: 2027 },
            actions: [
              { kind: "set-flow-formula", flowName: "Salary", formula: "salary * 1.04 + 150" },
            ],
          },
        ],
      }),
    ],
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
}: {
  value: string;
  placeholder: string;
  variablesScope: "planner" | "flow-draft" | "event-draft";
  inputName?: string;
  inputId?: string;
  fieldToken?: string;
}): string {
  return `
    <div
      class="formula-editor"
      data-formula-editor
      data-variables-scope="${variablesScope}"
      ${fieldToken ? `data-field-token="${escapeAttribute(fieldToken)}"` : ""}
    >
      <div
        class="formula-editor-input"
        contenteditable="true"
        spellcheck="false"
        role="textbox"
        aria-label="${escapeAttribute(placeholder)}"
        data-placeholder="${escapeAttribute(placeholder)}"
      >${escapeHtml(value)}</div>
      <input
        class="formula-editor-hidden-input"
        ${inputId ? `id="${escapeAttribute(inputId)}"` : ""}
        ${inputName ? `name="${escapeAttribute(inputName)}"` : ""}
        type="hidden"
        value="${escapeAttribute(value)}"
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

function parseEditableNumber(value: string): number {
  return Number(value.replaceAll(",", "").trim());
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

function renderAssetCashGenerationSummary(asset: AssetDefinition): string {
  const cashGenerations = getAssetCashGenerations(asset);

  if (cashGenerations.length === 0) {
    if (isHomeAsset(asset)) {
      return `Home purchased ${asset.purchaseYear}`;
    }
    return "";
  }

  return cashGenerations
    .map((cashGeneration) => {
      const rate = formatPercentage(cashGeneration.rate);
      const taxTreatment = assetCashTaxTreatmentLabel(cashGeneration.taxTreatment ?? "ordinary-income");
      const streamName = cashGeneration.name?.trim();
      return streamName ? `${streamName}: ${rate} ${taxTreatment}` : `${rate} ${taxTreatment}`;
    })
    .join(" | ");
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
  variables: variableDefinitions,
  flows: flowDefinitions,
  events,
}: {
  startYearInput: string;
  yearsToShow: number;
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
        applyFlowExpenseInflation(flow, flow.evaluateSignedYearlyAmount(context), offset, DEFAULT_EXPENSE_INFLATION_RATE),
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

function buildSnapshots(startYearInput: string, yearsToShow: number): YearlySnapshot[] {
  return buildSnapshotsFromPlannerData({
    startYearInput,
    yearsToShow,
    variables: plannerState.variables,
    flows: plannerState.flows,
    events: plannerState.events,
  });
}

function buildExpenseRows(startYearInput: string): Array<{ flow: FlowDefinition; yearlyAmount: number }> {
  const firstSnapshot = buildSnapshots(startYearInput, 1)[0];
  if (!firstSnapshot) {
    return [];
  }

  return plannerState.flows
    .filter((flow) => flow.type === "expense")
    .map((flow) => ({
      flow,
      yearlyAmount: Math.abs(firstSnapshot.flowAmounts.get(flow.name) ?? 0),
    }))
    .sort((left, right) => right.yearlyAmount - left.yearlyAmount);
}

function syncSimulationDraftAssetRows(): void {
  const draftRows = new Map(simulationDraft.assetRows.map((row) => [row.name, row]));
  const previousNames = simulationDraft.assetRows.map((row) => row.name).join("|");
  simulationDraft.assetRows = plannerState.assets.map((asset) => {
    const existing = draftRows.get(asset.name);
    const baseDraft = buildAssetDraftFromDefinition(asset);
    return {
      ...baseDraft,
      sellProportion: existing?.sellProportion ?? String(isInvestmentAsset(asset) ? asset.sellProportion * 100 : 0),
    };
  });
  if (simulationDraft.assetRows.map((row) => row.name).join("|") !== previousNames) {
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
    simulationDraft.variableSweep.minValue = formatEditableNumber(selectedVariable.value);
  }

  if (!Number.isFinite(parseEditableNumber(simulationDraft.variableSweep.maxValue))) {
    simulationDraft.variableSweep.maxValue = formatEditableNumber(selectedVariable.value);
  }
}

function clearSimulationOutputs(): void {
  simulationResults = null;
  simulationDetailResults = null;
  simulationSweepResults = null;
  selectedSimulationSweepStepIndex = 0;
  selectedSimulationPercentile = 50;
  expandedSimulationExampleKeys = new Set();
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
  const yearlySnapshots = buildSnapshotsFromPlannerData({
    startYearInput: simulationDraft.startYear,
    yearsToShow: simulationDraft.horizonYears,
    variables: buildSimulationVariableDefinitions(variableOverride),
    flows: plannerState.flows,
    events: plannerState.events,
  }).map((snapshot) => ({
    year: snapshot.year.year,
    label: snapshot.label,
    netAmount: snapshot.netAmount,
    totalExpenses: snapshot.totalExpenses,
    flowAmounts: new Map(snapshot.flowAmounts),
    householdTaxInput: { ...snapshot.householdTaxInput },
  }));

  return {
    attempts: simulationDraft.attempts,
    horizonYears: simulationDraft.horizonYears,
    yearlySnapshots,
    assets: simulationDraft.assetRows.map((asset) =>
      asset.kind === "home"
        ? {
            kind: "home" as const,
            name: asset.name,
            initialCost: parseEditableNumber(asset.initialCost),
            expectedReturn: Number(asset.expectedReturn),
            volatility: Number(asset.volatility),
            cashPurchasePercent: Number(asset.cashPurchasePercent) / 100,
            mortgageType: asset.mortgageType,
            mortgageRate: Number(asset.mortgageRate),
            mortgageTermYears: Number(asset.mortgageTermYears),
            monthlyNonTaxCosts: Number(asset.monthlyNonTaxCosts),
            propertyTaxRate: Number(asset.propertyTaxRate),
            purchaseYear: Number(asset.purchaseYear),
          }
        : {
            name: asset.name,
            startingValue: Number(asset.startingValue),
            expectedReturn: Number(asset.expectedReturn),
            volatility: Number(asset.volatility),
            sellProportion: Number(asset.sellProportion) / 100,
            ...(asset.cashGenerationEnabled
              ? {
                  cashGenerations: asset.cashGenerations.map((cashGeneration) => ({
                    name: cashGeneration.name.trim(),
                    rate: Number(cashGeneration.rate),
                    volatility: Number(cashGeneration.volatility),
                    taxTreatment: cashGeneration.taxTreatment,
                  })),
                }
              : {}),
            ...(asset.saleTaxEnabled
              ? {
                  saleTax: {
                    costBasis: Number(asset.saleTaxCostBasis),
                    taxTreatment: asset.saleTaxTreatment,
                  },
                }
              : {}),
          }
    ),
    taxes: selectedTaxPreset.taxes,
    householdTaxProfile: selectedTaxPreset.householdTaxProfile,
    assetCorrelations: plannerState.assetCorrelations,
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

function cancelActiveSimulationRun(): void {
  for (const worker of activeSimulationWorkers) {
    worker.terminate();
  }
  activeSimulationWorkers = [];
  simulationRunState = null;
}

function invalidateSimulationState(): void {
  cancelActiveSimulationRun();
  clearSimulationOutputs();
}

function eventSummary(action: EventAction): string {
  switch (action.kind) {
    case "adjust-variable":
      return `Adjust ${action.variableName} with ${action.adjustment.m}x + ${action.adjustment.b}`;
    case "set-flow-formula":
      return `Set ${action.flowName} formula to ${action.formula}`;
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

function getOneTimeResetYear(): EventYear {
  return addYears(parseYearInput(plannerState.startYear), 1);
}

function isOneTimeResetEvent(event: Event, flowName: string): boolean {
  if (!isSingleFormulaOverrideEvent(event, flowName)) {
    return false;
  }

  const action = event.schedule[0].actions[0];
  return (
    action.kind === "set-flow-formula" &&
    action.formula.trim() === "0" &&
    compareEventYears(event.schedule[0].year, getOneTimeResetYear()) === 0
  );
}

function getExpenseChangeEvents(flowName: string): Event[] {
  return getEventsForFlow(flowName).filter(
    (event) => isSingleFormulaOverrideEvent(event, flowName) && !isOneTimeResetEvent(event, flowName)
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

function createOneTimeResetEvent(flowName: string): Event {
  return new Event({
    name: `${flowName.trim()} one-time reset`,
    flowName,
    schedule: [
      {
        year: getOneTimeResetYear(),
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

function syncExpenseOneTimeReset(flowName: string, enabled: boolean): void {
  plannerState.events = plannerState.events.filter((event) => !isOneTimeResetEvent(event, flowName));

  if (enabled) {
    plannerState.events.push(createOneTimeResetEvent(flowName));
  }
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
    return `<p class="helper-copy">No assets yet. Add one to model balances, returns, volatility, and sale behavior.</p>`;
  }

  return `
    <div class="workspace-list">
      ${plannerState.assets
        .map(
          (asset) => `
            <article class="workspace-item">
              <div class="workspace-item-header">
                <div class="workspace-item-lead">
                  <button type="button" class="link-button workspace-item-title" data-edit-asset="${escapeHtml(asset.name)}">
                    ${escapeHtml(asset.name)}
                  </button>
                  ${renderAssetCashGenerationSummary(asset) ? `<p class="workspace-item-copy">${escapeHtml(renderAssetCashGenerationSummary(asset))}</p>` : ""}
                </div>
                ${
                  activeInlineAssetValueEditName === asset.name
                    && isInvestmentAsset(asset)
                    ? `
                  <form class="inline-asset-value-form" data-inline-asset-value-form="${escapeAttribute(asset.name)}">
                    <input
                      class="inline-asset-value-input"
                      name="startingValue"
                      type="text"
                      inputmode="decimal"
                      value="${escapeAttribute(formatEditableNumber(asset.startingValue))}"
                    />
                    <button type="submit" class="secondary-button">Save</button>
                    <button
                      type="button"
                      class="ghost-button"
                      data-cancel-inline-asset-value="${escapeAttribute(asset.name)}"
                    >
                      Cancel
                    </button>
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
                <span><strong>Type</strong>${isHomeAsset(asset) ? "Home" : "Investment"}</span>
                <span><strong>Expected return</strong>${formatPercentage(asset.expectedReturn)}</span>
                <span><strong>Volatility</strong>${formatPercentage(asset.volatility)}</span>
                <span><strong>${isHomeAsset(asset) ? "Sale behavior" : "Sell proportion"}</strong>${isHomeAsset(asset) ? "Not sellable" : formatPercentage(isInvestmentAsset(asset) ? asset.sellProportion : 0)}</span>
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
    parts.push(formatCurrency(amount));
  }

  return parts.join(" -> ");
}

function renderSetupExpenseArea(expenseRows: Array<{ flow: FlowDefinition; yearlyAmount: number }>): string {
  if (expenseRows.length === 0) {
    return `<p class="helper-copy">No expenses yet. Add one to model recurring or one-time spending.</p>`;
  }

  return `
    <div class="workspace-list">
      ${expenseRows
        .map(
          ({ flow, yearlyAmount }) => {
            const expenseValuePath = renderExpenseValuePath(flow.name, simulationDraft.startYear, yearlyAmount);

            return `
              <article class="workspace-item">
                <div class="workspace-item-header">
                  <div class="workspace-item-lead">
                    <div class="workspace-item-title-row">
                      <button type="button" class="link-button workspace-item-title" data-edit-flow="${escapeHtml(flow.name)}">
                        ${escapeHtml(flow.name)}
                      </button>
                      ${
                        isFlowInflationAdjusted(flow)
                          ? ""
                          : `<span class="pill">Inflation opt-out</span>`
                      }
                    </div>
                    ${expenseValuePath ? `<p class="workspace-item-copy">${escapeHtml(expenseValuePath)}</p>` : ""}
                  </div>
                  <strong class="workspace-item-value">${formatCurrency(yearlyAmount)}</strong>
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
  return `
    <section class="panel workspace-sidecard">
      <div class="workspace-section-header workspace-section-header-compact">
        <div class="panel-heading">
          <p class="kicker">Variables</p>
          <h2>Formula inputs</h2>
        </div>
        <p class="helper-copy">Edit base values here. New variables are still introduced while creating expenses.</p>
      </div>
      <div class="workspace-list workspace-list-tight">
        ${plannerState.variables
          .map(
            (variable) => `
              <label class="variable-edit-form workspace-variable-row" data-variable-name="${escapeHtml(variable.name)}">
                <span class="workspace-variable-name">${escapeHtml(variable.name)}</span>
                <input
                  name="value"
                  type="text"
                  inputmode="decimal"
                  value="${escapeHtml(formatEditableNumber(variable.value))}"
                />
              </label>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderSetupBoard(expenseRows: Array<{ flow: FlowDefinition; yearlyAmount: number }>): string {
  return `
    <div class="setup-layout">
      <div class="setup-main">
        <section class="panel workspace-section">
          <div class="workspace-section-header">
            <div class="panel-heading">
              <p class="kicker">Assets</p>
              <h2>Holdings and return assumptions</h2>
            </div>
            <button type="button" class="secondary-button" id="open-asset-composer">Create asset</button>
          </div>
          ${renderSetupAssetArea()}
        </section>

        <section class="panel workspace-section">
          <div class="workspace-section-header">
            <div class="panel-heading">
              <p class="kicker">Expenses</p>
              <h2>Current spending model</h2>
            </div>
            <button type="button" id="open-flow-composer">Create expense</button>
          </div>
          ${renderSetupExpenseArea(expenseRows)}
        </section>
      </div>

      ${renderVariablesCard()}
    </div>
  `;
}

function renderPlannerBoardTabs(): string {
  return `
    <div class="tab-strip planner-tab-strip" role="tablist" aria-label="Planner views">
      <button
        type="button"
        class="${activePlannerBoardTab === "setup" ? "tab-button is-active" : "tab-button"}"
        data-board-tab="setup"
      >
        Setup
      </button>
      <button
        type="button"
        class="${activePlannerBoardTab === "simulation" ? "tab-button is-active" : "tab-button"}"
        data-board-tab="simulation"
      >
        Simulation
      </button>
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
  }
}

function renderPlanner(user: UserIdentity): void {
  syncSimulationDraftAssetRows();
  syncSimulationVariableSweepDraft();
  const expenseRows = buildExpenseRows(simulationDraft.startYear);

  mountedAppRoot.innerHTML = `
    <div class="app-shell">
      <header class="planner-header">
        <div class="planner-header-copy">
          <p class="eyebrow">Soroban</p>
          <h1>Formula planner</h1>
          <p class="hero-copy">
            Configure assets, expenses, and variables in setup, then run portfolio simulations against a fixed tax preset.
          </p>
        </div>
        <div class="planner-header-meta">
          <div class="pill-row">
            <span class="pill">${escapeHtml(user.email)}</span>
            <span class="pill">Preset tax mode</span>
          </div>
          <div class="planner-header-actions">
            <button type="button" class="secondary-button" id="save-scenario-button">Save scenario</button>
            <button type="button" class="secondary-button" id="load-scenario-button">Load scenario</button>
            <input id="load-scenario-input" type="file" accept=".json,application/json" hidden />
          </div>
        </div>
      </header>

      <main class="planner-main">
        <div class="planner-board-switcher">
          ${renderPlannerBoardTabs()}
        </div>
        <section class="board-panel">
          ${
            activePlannerBoardTab === "setup"
              ? renderSetupBoard(expenseRows)
              : `
        <section class="panel workspace-section">
          <div class="board-header">
            <div class="panel-heading">
              <p class="kicker">Simulation</p>
              <h2>Portfolio outcomes</h2>
            </div>
          </div>
          ${renderSimulationBoard()}
        </section>
          `
          }
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
    return `<p class="helper-copy">No expenses yet. Create one to track a recurring or one-time outflow.</p>`;
  }

  return `
    <div class="board-scroll">
      <table class="flow-table expense-table">
        <thead>
          <tr>
            <th>Expense</th>
            <th>Formula</th>
            <th>Change over time</th>
            <th>Yearly amount</th>
          </tr>
        </thead>
        <tbody>
          ${expenseRows
            .map(
              ({ flow, yearlyAmount }) => {
                const changes = getExpenseChangeEvents(flow.name);
                const hasOneTimeReset = plannerState.events.some((event) => isOneTimeResetEvent(event, flow.name));

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
                              ? [`<span class="summary-meta">One-time reset in ${escapeHtml(yearLabel(getOneTimeResetYear()))}</span>`]
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

function renderTaxProfileEditor(): string {
  const taxOptions = plannerState.taxes
    .map(
      (tax) => `
        <option value="${escapeAttribute(tax.name)}">${escapeHtml(tax.name)}</option>
      `
    )
    .join("");

  return `
    <form id="tax-profile-form" class="stack-form composer-subsection">
      <div class="event-entry-header">
        <strong>Household tax profile</strong>
        <button type="button" class="secondary-button" id="load-nyc-tax-preset">Load NYC 2025 preset</button>
      </div>
      <div class="split-fields">
        <label>
          Filing status
          <select name="filingStatus">
            <option value="single" ${taxProfileDraft.filingStatus === "single" ? "selected" : ""}>Single</option>
            <option value="married-filing-jointly" ${taxProfileDraft.filingStatus === "married-filing-jointly" ? "selected" : ""}>Married filing jointly</option>
            <option value="married-filing-separately" ${taxProfileDraft.filingStatus === "married-filing-separately" ? "selected" : ""}>Married filing separately</option>
            <option value="head-of-household" ${taxProfileDraft.filingStatus === "head-of-household" ? "selected" : ""}>Head of household</option>
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
          <input name="federalStandardDeduction" type="number" step="0.01" value="${escapeHtml(taxProfileDraft.federalStandardDeduction)}" />
        </label>
        <label>
          NIIT threshold
          <input name="niitThreshold" type="number" step="0.01" value="${escapeHtml(taxProfileDraft.niitThreshold)}" />
        </label>
      </div>
      <div class="split-fields">
        <label>
          Other SALT paid
          <input name="otherSaltTaxesPaid" type="number" step="0.01" value="${escapeHtml(taxProfileDraft.otherSaltTaxesPaid)}" />
        </label>
        <label>
          SALT base cap
          <input name="saltDeductionBaseCap" type="number" step="0.01" value="${escapeHtml(taxProfileDraft.saltDeductionBaseCap)}" />
        </label>
      </div>
      <div class="split-fields">
        <label>
          SALT floor cap
          <input name="saltDeductionFloorCap" type="number" step="0.01" value="${escapeHtml(taxProfileDraft.saltDeductionFloorCap)}" />
        </label>
        <label>
          SALT phaseout threshold
          <input name="saltDeductionPhaseoutThreshold" type="number" step="0.01" value="${escapeHtml(taxProfileDraft.saltDeductionPhaseoutThreshold)}" />
        </label>
      </div>
      <div class="split-fields">
        <label>
          SALT phaseout rate
          <input name="saltDeductionPhaseoutRate" type="number" step="0.0001" value="${escapeHtml(taxProfileDraft.saltDeductionPhaseoutRate)}" />
        </label>
        <label>
          Other itemized deductions
          <input name="otherItemizedDeductions" type="number" step="0.01" value="${escapeHtml(taxProfileDraft.otherItemizedDeductions)}" />
        </label>
      </div>
      <div class="split-fields">
        <label>
          State taxable-income adjustment
          <input name="stateTaxableIncomeAdjustment" type="number" step="0.01" value="${escapeHtml(taxProfileDraft.stateTaxableIncomeAdjustment)}" />
        </label>
        <label>
          Local taxable-income adjustment
          <input name="localTaxableIncomeAdjustment" type="number" step="0.01" value="${escapeHtml(taxProfileDraft.localTaxableIncomeAdjustment)}" />
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
          Local schedule
          <select name="localTaxName">${renderTaxProfileOptions(taxOptions, taxProfileDraft.localTaxName)}</select>
        </label>
      </div>
      <label>
        NIIT schedule
        <select name="niitTaxName">${renderTaxProfileOptions(taxOptions, taxProfileDraft.niitTaxName)}</select>
      </label>
    </form>
  `;
}

function renderTaxProfileOptions(optionsHtml: string, selectedValue: string): string {
  return `<option value=""></option>${optionsHtml.replace(
    `value="${escapeAttribute(selectedValue)}"`,
    `value="${escapeAttribute(selectedValue)}" selected`
  )}`;
}

function renderFlowTaxTreatmentOptions(selectedValue: FlowTaxTreatment): string {
  const options: Array<{ value: FlowTaxTreatment; label: string }> = [
    { value: "wages", label: "Wages" },
    { value: "ordinary-income", label: "Ordinary income" },
    { value: "qualified-dividends", label: "Qualified dividends" },
    { value: "short-term-capital-gains", label: "Short-term capital gains" },
    { value: "long-term-capital-gains", label: "Long-term capital gains" },
    { value: "tax-exempt-income", label: "Tax-exempt income" },
    { value: "deductible-expense", label: "Deductible expense" },
    { value: "nondeductible-expense", label: "Nondeductible expense" },
  ];

  return options
    .map(
      (option) =>
        `<option value="${option.value}" ${selectedValue === option.value ? "selected" : ""}>${option.label}</option>`
    )
    .join("");
}

function renderExpenseTaxTreatmentOptions(selectedValue: FlowTaxTreatment): string {
  return [
    { value: "deductible-expense" as const, label: "Deductible expense" },
    { value: "nondeductible-expense" as const, label: "Nondeductible expense" },
  ]
    .map(
      (option) =>
        `<option value="${option.value}" ${selectedValue === option.value ? "selected" : ""}>${option.label}</option>`
    )
    .join("");
}

function getSimulationSubmitState(): { disabled: boolean; reason: string } {
  const sellableAssets = simulationDraft.assetRows.filter((asset) => asset.kind !== "home");
  const sellProportionTotal = sellableAssets.reduce((total, asset) => total + (Number(asset.sellProportion) || 0), 0);
  if (simulationDraft.assetRows.length === 0) {
    return {
      disabled: true,
      reason: "Create at least one asset to run a simulation.",
    };
  }

  if (sellableAssets.length > 0 && Math.abs(sellProportionTotal - 100) > 0.000001) {
    return {
      disabled: true,
      reason: `Sell proportions must add up to 100%. Current total: ${sellProportionTotal.toFixed(2)}%.`,
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

  return {
    disabled: false,
    reason: "",
  };
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
  if (Math.abs(row.taxAmount) <= 0.000001) {
    return `<p class="helper-copy">No tax was due for this example year.</p>`;
  }

  const calculationEntries: Array<[string, number]> = [
    ["Federal taxable income", row.taxBreakdown.federalTaxableIncome],
    ["Federal ordinary taxable income", row.taxBreakdown.federalOrdinaryTaxableIncome],
    ["Federal preferential income", row.taxBreakdown.federalPreferentialIncome],
    ["Deduction used", row.taxBreakdown.deductionUsed],
    ["State taxable income", row.taxBreakdown.stateTaxableIncome],
    ["Local taxable income", row.taxBreakdown.localTaxableIncome],
    ["Modified adjusted gross income", row.taxBreakdown.modifiedAdjustedGrossIncome],
    ["Net investment income", row.taxBreakdown.netInvestmentIncome],
    ["NIIT income above threshold", row.taxBreakdown.niitIncomeAboveThreshold],
    ["NIIT taxable income", row.taxBreakdown.niitTaxableIncome],
  ];
  const visibleCalculationEntries = calculationEntries.filter(([, amount]) => Math.abs(amount) > 0.000001);
  const taxEntries = [...row.taxBreakdown.taxByName.entries()].sort((left, right) => right[1] - left[1]);

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
          ${taxEntries.length > 0 ? `<tr><th>Total tax paid</th><td>${formatCurrency(row.taxAmount)}</td></tr>` : ""}
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
  if (saleEntries.length === 0) {
    return `<p class="helper-copy">No asset sales were needed for this example year.</p>`;
  }

  return `
    <div class="board-scroll">
      <table class="flow-table simulation-flow-detail-table">
        <thead>
          <tr>
            <th>Sale activity</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          ${renderSimulationDetailRows(saleEntries)}
        </tbody>
      </table>
    </div>
  `;
}

function buildSimulationExampleExport(
  percentile: SimulationPercentile,
  scenario: SimulationScenario,
  detailScenario: SimulationDetailScenario | null
): string {
  const exportedRows = scenario.rows.map((row) => {
    const exampleYear = getExampleSimulationYear(detailScenario, row.yearNumber);
    const visibleFlowTotals = exampleYear
      ? [...exampleYear.flowTotals.entries()]
          .filter(([, amount]) => Math.abs(amount) > 0.000001)
          .sort((left, right) => compareSignedAmounts(left[1], right[1]))
      : [];
    const saleEntries = visibleFlowTotals.filter(
      ([entryName]) => entryName.endsWith(" sale proceeds") || entryName.endsWith(" realized gain")
    );
    const operatingEntries = visibleFlowTotals.filter(
      ([entryName]) => !entryName.endsWith(" sale proceeds") && !entryName.endsWith(" realized gain")
    );
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
          expenses: Math.max(0, exampleYear.totalExpenses - exampleYear.taxAmount),
          totalExpenses: exampleYear.totalExpenses,
          totalGains: exampleYear.totalGains,
          taxableGains: exampleYear.taxableGains,
          taxAmount: exampleYear.taxAmount,
          totalAssets: exampleYear.totalAssets,
          depletionProbability: exampleYear.depletionProbability,
          cashFlows: operatingEntries.map(([label, amount]) => ({ label, amount })),
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
          assetSales: saleEntries.map(([label, amount]) => ({ label, amount })),
          assetValues: [...exampleYear.assetValues.entries()].map(([asset, amount]) => ({ asset, amount })),
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
    assets: snapshot.assets.map((asset) =>
      isHomeAsset(asset)
        ? {
            kind: "home" as const,
            name: asset.name,
            initialCost: asset.initialCost,
            expectedReturn: asset.expectedReturn,
            volatility: asset.volatility,
            cashPurchasePercent: asset.cashPurchasePercent,
            mortgageType: asset.mortgageType,
            mortgageRate: asset.mortgageRate,
            mortgageTermYears: asset.mortgageTermYears,
            monthlyNonTaxCosts: asset.monthlyNonTaxCosts,
            propertyTaxRate: asset.propertyTaxRate,
            purchaseYear: asset.purchaseYear,
          }
        : {
            name: asset.name,
            startingValue: asset.startingValue,
            expectedReturn: asset.expectedReturn,
            volatility: asset.volatility,
            sellProportion: asset.sellProportion,
            ...(asset.cashGenerations && asset.cashGenerations.length > 0
              ? {
                  cashGenerations: asset.cashGenerations.map((cashGeneration) => ({
                    name: cashGeneration.name,
                    rate: cashGeneration.rate,
                    volatility: cashGeneration.volatility,
                    taxTreatment: cashGeneration.taxTreatment,
                  })),
                }
              : {}),
            ...(asset.saleTax
              ? {
                  saleTax: {
                    costBasis: asset.saleTax.costBasis,
                    taxTreatment: asset.saleTax.taxTreatment,
                  },
                }
              : {}),
          }
    ),
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
    simulationTaxPreset: simulationDraft.taxPreset,
    simulationHorizonYears: simulationDraft.horizonYears,
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

function getExampleSimulationYear(
  detailScenario: SimulationDetailScenario | null,
  yearNumber: number
): SimulationDetailYearRow | null {
  if (!detailScenario) {
    return null;
  }

  return detailScenario.rows.find((candidateRow) => candidateRow.yearNumber === yearNumber) ?? null;
}

function compareSignedAmounts(leftAmount: number, rightAmount: number): number {
  const leftPositive = leftAmount > 0;
  const rightPositive = rightAmount > 0;

  if (leftPositive !== rightPositive) {
    return leftPositive ? -1 : 1;
  }

  if (leftPositive) {
    return rightAmount - leftAmount;
  }

  return leftAmount - rightAmount;
}

function renderSimulationExampleYear(row: SimulationDetailYearRow): string {
  const visibleFlowTotals = [...row.flowTotals.entries()]
    .filter(([, amount]) => Math.abs(amount) > 0.000001)
    .sort((left, right) => compareSignedAmounts(left[1], right[1]));
  const saleEntries = visibleFlowTotals.filter(
    ([entryName]) => entryName.endsWith(" sale proceeds") || entryName.endsWith(" realized gain")
  );
  const operatingEntries = visibleFlowTotals.filter(
    ([entryName]) => !entryName.endsWith(" sale proceeds") && !entryName.endsWith(" realized gain")
  );
  const assetReturnEntries = [...row.assetReturns.entries()]
    .filter(
    ([, assetReturn]) => Math.abs(assetReturn.amount) > 0.000001 || Math.abs(assetReturn.percentage) > 0.000001
    )
    .map(([assetName, assetReturn]) => ({
      label: `${assetName} return`,
      amount: assetReturn.amount,
      detail: ` (${formatPercentage(assetReturn.percentage)})`,
    }));
  const cashFlowEntries = [
    ...operatingEntries.map(([entryName, amount]) => ({
      label: entryName,
      amount,
      detail: "",
    })),
    ...assetReturnEntries,
  ].sort((left, right) => compareSignedAmounts(left.amount, right.amount));
  const assetValueEntries = [...row.assetValues.entries()].sort((left, right) => right[1] - left[1]);
  const expensesWithoutTaxes = Math.max(0, row.totalExpenses - row.taxAmount);

  return `
    <div class="simulation-detail-panel">
      <strong>Example year: ${escapeHtml(row.label)}</strong>
      <p class="helper-copy">This is one actual simulated attempt chosen to stay consistent across the selected percentile path. It is illustrative, not the percentile itself.</p>
      <div class="stack-list">
        <section>
          <strong>Portfolio</strong>
          <div class="board-scroll">
            <table class="flow-table simulation-flow-detail-table">
              <tbody>
                <tr>
                  <th>Starting assets</th>
                  <td>${formatCurrency(row.startingAssets)}</td>
                </tr>
                <tr>
                  <th>Ending assets</th>
                  <td>${formatCurrency(row.endingAssets)}</td>
                </tr>
                ${assetValueEntries
                  .map(
                    ([assetName, amount]) => `
                <tr>
                  <th>${escapeHtml(assetName)}</th>
                  <td>${formatCurrency(amount)}</td>
                </tr>
                `
                  )
                  .join("")}
                <tr>
                  <th>Expenses</th>
                  <td>${formatCurrency(expensesWithoutTaxes)}</td>
                </tr>
                <tr>
                  <th>Total gains</th>
                  <td>${formatCurrency(row.totalGains)}</td>
                </tr>
                <tr>
                  <th>Taxable gains</th>
                  <td>${formatCurrency(row.taxableGains)}</td>
                </tr>
                <tr>
                  <th>Tax paid</th>
                  <td>${formatCurrency(row.taxAmount)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <section>
          <strong>Cash flows</strong>
          ${
            cashFlowEntries.length === 0
              ? `<p class="helper-copy">No non-zero flows or asset returns were recorded for this example year.</p>`
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
          <details>
            <summary><strong>Tax inputs</strong></summary>
            ${renderSimulationTaxInputs(row)}
          </details>
        </section>
        <section>
          <details>
            <summary><strong>Tax paid</strong></summary>
            ${renderSimulationTaxBreakdown(row)}
          </details>
        </section>
        <section>
          <strong>Asset sales</strong>
          ${renderSimulationAssetSales(saleEntries)}
        </section>
      </div>
    </div>
  `;
}

function renderSimulationChart(results: Map<SimulationPercentile, SimulationScenario>): string {
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
  const values = scenarios.flatMap((scenario) => scenario.rows.map((row) => row.totalAssets));
  const maxValue = Math.max(...values, 0);
  const yStep = 10_000_000;
  const yMin = 0;
  const yMax = Math.max(yStep, Math.ceil(maxValue / yStep) * yStep);
  const yRange = Math.max(yStep, yMax - yMin);
  const yTicks = Array.from({ length: Math.round((yMax - yMin) / yStep) + 1 }, (_, index) => yMin + index * yStep);
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
          <strong>Total assets by year</strong>
          <p class="helper-copy">X-axis: simulation year. Y-axis: portfolio value at each year-by-year percentile across all simulation attempts.</p>
        </div>
        <div class="simulation-chart-legend">
          ${simulationPercentiles
            .map(
              (percentile) => `
                <span class="simulation-chart-legend-item">
                  <span class="simulation-chart-swatch" style="--swatch:${getSimulationPercentileColor(percentile)}"></span>
                  ${percentile}th
                </span>
              `
            )
            .join("")}
        </div>
      </div>
      <div class="board-scroll">
        <svg class="simulation-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Simulation total assets by year and percentile">
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
                .map((row, index) => `${index === 0 ? "M" : "L"} ${xForYear(row.yearNumber)} ${yForValue(row.totalAssets)}`)
                .join(" ");
              return `
                <path class="simulation-chart-line ${selectedSimulationPercentile === scenario.percentile ? "is-active" : ""}" d="${path}" stroke="${color}"></path>
                ${scenario.rows
                  .map(
                    (row) => `
                      <circle
                        class="simulation-chart-point ${selectedSimulationPercentile === scenario.percentile ? "is-active" : ""}"
                        cx="${xForYear(row.yearNumber)}"
                        cy="${yForValue(row.totalAssets)}"
                        r="${selectedSimulationPercentile === scenario.percentile ? 6 : 5}"
                        fill="${color}"
                        data-simulation-chart-point="true"
                        data-simulation-chart-year="${row.yearNumber}"
                        data-simulation-chart-label="${escapeAttribute(row.label)}"
                        data-simulation-chart-total-assets="${escapeAttribute(formatCompactCurrency(row.totalAssets))}"
                        data-simulation-chart-percentile="${scenario.percentile}"
                      ></circle>
                    `
                  )
                  .join("")}
              `;
            })
            .join("")}
        </svg>
      </div>
      <div class="simulation-chart-tooltip" id="simulation-chart-tooltip" hidden></div>
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
          <p class="helper-copy">
            Viewing ${escapeHtml(simulationSweepResults.variableName)} at ${escapeHtml(formatEditableNumber(selectedStep.value))}.
            Sweep range: ${escapeHtml(formatEditableNumber(minimumValue))} to ${escapeHtml(formatEditableNumber(maximumValue))}
            across ${simulationSweepResults.steps.length} runs.
          </p>
        </div>
        <span class="pill">
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
        <strong>${escapeHtml(formatEditableNumber(selectedStep.value))}</strong>
        <span>${escapeHtml(formatEditableNumber(maximumValue))}</span>
      </div>
    </section>
  `;
}

function renderSimulationBoard(): string {
  const displayedSimulationResults = getDisplayedSimulationResults();
  const displayedSimulationDetails = getDisplayedSimulationDetailResults();
  const selectedScenario = displayedSimulationResults?.get(selectedSimulationPercentile) ?? null;
  const selectedDetailScenario =
    selectedScenario && displayedSimulationDetails
      ? selectRepresentativeSimulationScenario(displayedSimulationDetails, selectedScenario.rows)
      : null;
  const rows = selectedScenario?.rows ?? [];
  const simulationSubmitState = getSimulationSubmitState();
  const isSimulationRunning = simulationRunState !== null && simulationRunState.errorMessage === null;
  const simulationProgressPercent = simulationRunState
    ? Math.max(0, Math.min(100, (simulationRunState.completedAttempts / Math.max(1, simulationRunState.totalAttempts)) * 100))
    : 0;
  const sweepVariableOptions = plannerState.variables
    .map(
      (variable) => `
        <option value="${escapeAttribute(variable.name)}" ${
          simulationDraft.variableSweep.variableName === variable.name ? "selected" : ""
        }>
          ${escapeHtml(variable.name)}
        </option>
      `
    )
    .join("");

  return `
    <div class="simulation-panel">
      <form id="simulation-form" class="stack-form">
        <div class="simulation-toolbar">
          <label>
            Start year
            <input name="simulationStartYear" type="number" min="1900" max="9999" value="${escapeHtml(simulationDraft.startYear)}" />
          </label>
          <label>
            Time horizon (years)
            <input name="simulationHorizonYears" type="number" min="1" max="50" value="${simulationDraft.horizonYears}" />
          </label>
          <label>
            Attempts
            <input name="simulationAttempts" type="range" min="5000" max="100000" step="5000" value="${simulationDraft.attempts}" />
            <span class="summary-meta">${simulationDraft.attempts.toLocaleString("en-US")} attempts</span>
          </label>
        </div>

        <section class="simulation-sweep-config">
          <label class="checkbox-field">
            <input
              name="simulationVariableSweepEnabled"
              type="checkbox"
              ${simulationDraft.variableSweep.enabled ? "checked" : ""}
              ${plannerState.variables.length === 0 ? "disabled" : ""}
            />
            <span>Enable variable sweep</span>
          </label>
          ${
            plannerState.variables.length === 0
              ? `<p class="helper-copy">Create a variable in Setup before using a sweep.</p>`
              : simulationDraft.variableSweep.enabled
                ? `
          <p class="helper-copy">Run ${VARIABLE_SWEEP_STEP_COUNT} simulations with one variable interpolated from min to max.</p>
          <div class="simulation-sweep-fields">
            <label>
              Variable
              <select name="simulationVariableSweepVariableName">
                ${sweepVariableOptions}
              </select>
            </label>
            <label>
              Min value
              <input
                name="simulationVariableSweepMinValue"
                type="number"
                step="any"
                value="${escapeHtml(simulationDraft.variableSweep.minValue)}"
              />
            </label>
            <label>
              Max value
              <input
                name="simulationVariableSweepMaxValue"
                type="number"
                step="any"
                value="${escapeHtml(simulationDraft.variableSweep.maxValue)}"
              />
            </label>
          </div>
                `
                : ""
          }
        </section>

        ${
          simulationDraft.assetRows.length === 0
            ? `<p class="helper-copy">Create at least one asset to run a simulation.</p>`
            : `
        <div class="board-scroll">
          <table class="flow-table simulation-input-table">
            <thead>
              <tr>
                <th>Sell proportion (%)</th>
                <th>Asset</th>
                <th>Starting value</th>
                <th>Expected return (%)</th>
                <th>Volatility (%)</th>
              </tr>
            </thead>
            <tbody>
              ${simulationDraft.assetRows
                .map(
                  (asset) => `
                    <tr>
                      <td>${
                        asset.kind === "home"
                          ? "Not sellable"
                          : `<input type="number" min="0" max="100" step="0.01" data-simulation-asset-field="${escapeAttribute(asset.name)}:sellProportion" value="${escapeHtml(asset.sellProportion)}" />`
                      }</td>
                      <th>
                        <button type="button" class="link-button" data-edit-asset="${escapeHtml(asset.name)}">
                          ${escapeHtml(asset.name)}
                        </button>
                      </th>
                      <td>${formatCurrency(Number(asset.kind === "home" ? asset.initialCost : asset.startingValue))}</td>
                      <td>${formatPercentage(Number(asset.expectedReturn))}</td>
                      <td>${formatPercentage(Number(asset.volatility))}</td>
                    </tr>
                  `
                )
                .join("")}
            </tbody>
          </table>
        </div>
        <label class="simulation-tax-preset-field">
          Tax preset
          <select name="simulationTaxPreset">
            <option value="nyc" ${simulationDraft.taxPreset === "nyc" ? "selected" : ""}>NYC</option>
          </select>
        </label>
            `
        }

        <div class="simulation-actions">
          ${
            simulationRunState
              ? `
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
              `
              : ""
          }
          <span id="simulation-submit-wrapper" title="${escapeAttribute(simulationSubmitState.reason)}">
            <button id="simulation-submit-button" type="submit" ${simulationSubmitState.disabled || isSimulationRunning ? "disabled" : ""}>
              ${isSimulationRunning ? "Simulating..." : "Simulate"}
            </button>
          </span>
        </div>
      </form>

      ${
        selectedScenario
          ? `
      ${renderSimulationSweepResults()}
      ${renderSimulationChart(displayedSimulationResults!)}
      <div class="tab-strip" role="tablist" aria-label="Simulation percentiles">
        ${simulationPercentiles
          .map(
            (percentile) => `
              <button
                type="button"
                class="${selectedSimulationPercentile === percentile ? "tab-button is-active" : "tab-button"}"
                data-simulation-percentile="${percentile}"
              >
                ${percentile}th
              </button>
            `
          )
          .join("")}
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
      <p class="helper-copy">Depletion is cumulative by year and means the plan ran out of non-home assets or cash. Home equity still remains in total assets because homes are not sold in the simulation.</p>
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
          `
          : ``
      }
    </div>
  `;
}

function syncSimulationSubmitState(): void {
  const submitButton = document.querySelector<HTMLButtonElement>("#simulation-submit-button");
  const submitWrapper = document.querySelector<HTMLElement>("#simulation-submit-wrapper");
  if (!submitButton || !submitWrapper) {
    return;
  }

  const state = getSimulationSubmitState();
  submitButton.disabled = state.disabled;
  submitWrapper.title = state.reason;
}

function bindSimulationChartTooltip(): void {
  const tooltip = document.querySelector<HTMLDivElement>("#simulation-chart-tooltip");
  const panel = document.querySelector<HTMLElement>(".simulation-chart-panel");
  if (!tooltip || !panel) {
    return;
  }

  const hideTooltip = () => {
    tooltip.hidden = true;
  };

  const updateTooltipPosition = (event: MouseEvent) => {
    const panelRect = panel.getBoundingClientRect();
    const tooltipOffset = 16;
    tooltip.style.left = `${event.clientX - panelRect.left + tooltipOffset}px`;
    tooltip.style.top = `${event.clientY - panelRect.top - tooltipOffset}px`;
  };

  for (const point of document.querySelectorAll<SVGCircleElement>("[data-simulation-chart-point]")) {
    point.addEventListener("mouseenter", (event) => {
      tooltip.textContent = `${point.dataset.simulationChartLabel} | ${point.dataset.simulationChartTotalAssets} | ${point.dataset.simulationChartPercentile}th percentile`;
      tooltip.hidden = false;
      updateTooltipPosition(event);
    });
    point.addEventListener("mousemove", updateTooltipPosition);
    point.addEventListener("mouseleave", hideTooltip);
  }

  panel.addEventListener("mouseleave", hideTooltip);
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
            <h2>New standalone asset</h2>
          </div>
          <button type="button" class="ghost-button" id="close-asset-composer">Close</button>
        </div>
        <form id="asset-form" class="stack-form">
          <label>
            Name
            <input name="name" type="text" value="${escapeHtml(assetDraft.name)}" placeholder="Brokerage account" required />
          </label>
          <label>
            Asset type
            <select name="kind">
              <option value="investment" ${assetDraft.kind === "investment" ? "selected" : ""}>Investment</option>
              <option value="home" ${assetDraft.kind === "home" ? "selected" : ""}>Home</option>
            </select>
          </label>
          ${renderAssetCoreFields(assetDraft)}
          <div class="split-fields">
            <label>
              Expected return (%)
              <input name="expectedReturn" type="number" step="0.01" value="${escapeHtml(assetDraft.expectedReturn)}" required />
            </label>
            <label>
              Volatility (%)
              <input name="volatility" type="number" step="0.01" value="${escapeHtml(assetDraft.volatility)}" required />
            </label>
          </div>
          ${renderAssetTaxModelFields(assetDraft)}
          <p class="helper-copy">
            Price return, cash generation, and taxable sales are modeled separately for simulation.
          </p>
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
            Name
            <input name="name" type="text" value="${escapeHtml(assetEditDraft.name)}" required />
          </label>
          <label>
            Asset type
            <select name="kind">
              <option value="investment" ${assetEditDraft.kind === "investment" ? "selected" : ""}>Investment</option>
              <option value="home" ${assetEditDraft.kind === "home" ? "selected" : ""}>Home</option>
            </select>
          </label>
          ${renderAssetCoreFields(assetEditDraft)}
          <div class="split-fields">
            <label>
              Expected return (%)
              <input name="expectedReturn" type="number" step="0.01" value="${escapeHtml(assetEditDraft.expectedReturn)}" required />
            </label>
            <label>
              Volatility (%)
              <input name="volatility" type="number" step="0.01" value="${escapeHtml(assetEditDraft.volatility)}" required />
            </label>
          </div>
          ${renderAssetTaxModelFields(assetEditDraft)}
          <p class="helper-copy">
            Changes here only affect the saved asset record.
          </p>
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
          <div class="event-buttons">
            <button type="button" class="secondary-button" id="close-asset-editor">Cancel</button>
            <button type="submit">Save asset</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderAssetCoreFields(draft: AssetDraft): string {
  if (draft.kind === "home") {
    return `
      <label>
        Initial cost
        <input
          name="initialCost"
          type="text"
          inputmode="decimal"
          value="${escapeHtml(draft.initialCost === "" ? "" : formatEditableNumber(parseEditableNumber(draft.initialCost)))}"
          required
        />
      </label>
      <label>
        Cash purchase (%)
        <input name="cashPurchasePercent" type="number" step="0.01" value="${escapeHtml(draft.cashPurchasePercent)}" required />
      </label>
      <div class="split-fields">
        <label>
          Mortgage type
          <select name="mortgageType">
            <option value="amortizing" ${draft.mortgageType === "amortizing" ? "selected" : ""}>Amortizing</option>
            <option value="interest-only" ${draft.mortgageType === "interest-only" ? "selected" : ""}>Interest-only</option>
          </select>
        </label>
        <label>
          Mortgage rate (%)
          <input name="mortgageRate" type="number" step="0.01" value="${escapeHtml(draft.mortgageRate)}" required />
        </label>
        <label>
          Mortgage term (years)
          <input name="mortgageTermYears" type="number" step="1" value="${escapeHtml(draft.mortgageTermYears)}" required />
        </label>
      </div>
      <div class="split-fields">
        <label>
          Non-tax monthlies
          <input name="monthlyNonTaxCosts" type="number" step="0.01" value="${escapeHtml(draft.monthlyNonTaxCosts)}" required />
        </label>
        <label>
          Property tax rate (%)
          <input name="propertyTaxRate" type="number" step="0.01" value="${escapeHtml(draft.propertyTaxRate)}" required />
        </label>
      </div>
      <label>
        Purchase year
        <input name="purchaseYear" type="number" step="1" value="${escapeHtml(draft.purchaseYear)}" required />
      </label>
    `;
  }

  return `
    <label>
      Starting value
      <input
        name="startingValue"
        type="text"
        inputmode="decimal"
        value="${escapeHtml(draft.startingValue === "" ? "" : formatEditableNumber(parseEditableNumber(draft.startingValue)))}"
        required
      />
    </label>
  `;
}

function renderAssetTaxModelFields(draft: AssetDraft): string {
  if (draft.kind === "home") {
    return `
      <section class="composer-subsection">
        <div class="event-entry-header">
          <strong>Home cash model</strong>
          <span class="summary-meta">Mortgage, property tax, and operating costs are generated automatically.</span>
        </div>
        <p class="helper-copy">Mortgage interest and property tax feed federal itemized deduction analysis. Home assets cannot be sold in simulation.</p>
      </section>
    `;
  }

  return `
    <section class="composer-subsection">
      <div class="event-entry-header">
        <strong>Cash generation</strong>
        <span class="summary-meta">For dividends, bond income, distributions, or rent-like cash yield</span>
      </div>
      <label>
        <input type="checkbox" name="cashGenerationEnabled" ${draft.cashGenerationEnabled ? "checked" : ""} />
        Enable cash generation
      </label>
      ${
        draft.cashGenerationEnabled
          ? `
        <div class="stack-list">
          ${draft.cashGenerations
            .map(
              (cashGeneration, index) => `
                <section class="composer-subsection">
                  <div class="event-entry-header">
                    <strong>Cash stream ${index + 1}</strong>
                    ${
                      draft.cashGenerations.length > 1
                        ? `<button type="button" class="secondary-button" data-remove-cash-generation="${cashGeneration.id}">Remove</button>`
                        : ""
                    }
                  </div>
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
                  </div>
                  <label>
                    Cash generation tax treatment
                    <select name="cashGenerationTaxTreatment" data-cash-generation-field="${cashGeneration.id}:taxTreatment">
                      ${renderAssetCashTaxTreatmentOptions(cashGeneration.taxTreatment)}
                    </select>
                  </label>
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
    <section class="composer-subsection">
      <div class="event-entry-header">
        <strong>Tax on selling for cash</strong>
        <span class="summary-meta">For realized capital gains or other taxable sale events</span>
      </div>
      <label>
        <input type="checkbox" name="saleTaxEnabled" ${draft.saleTaxEnabled ? "checked" : ""} />
        Enable tax on sales
      </label>
      ${
        draft.saleTaxEnabled
          ? `
        <label>
          Starting cost basis
          <input
            name="saleTaxCostBasis"
            type="text"
            inputmode="decimal"
            value="${escapeHtml(
              draft.saleTaxCostBasis === "" ? "" : formatEditableNumber(parseEditableNumber(draft.saleTaxCostBasis))
            )}"
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
          `
          : ""
      }
    </section>
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
            Name
            <input name="name" type="text" value="${escapeHtml(taxDraft.name)}" placeholder="Qualified dividends" required />
          </label>
          <label>
            Maximum tax
            <input name="maximum" type="number" step="0.01" value="${escapeHtml(taxDraft.maximum)}" placeholder="Optional cap" />
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
                          <input type="number" step="0.01" data-tax-rate-field="${rate.id}:upTo" value="${escapeHtml(rate.upTo)}" placeholder="Blank = uncapped" />
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
                            Name
                            <input type="text" data-tax-exclusion-field="${exclusion.id}:name" value="${escapeHtml(exclusion.name)}" />
                          </label>
                          <div class="split-fields">
                            <label>
                              Amount
                              <input type="number" step="0.01" data-tax-exclusion-field="${exclusion.id}:amount" value="${escapeHtml(exclusion.amount)}" />
                            </label>
                            <label>
                              Maximum
                              <input type="number" step="0.01" data-tax-exclusion-field="${exclusion.id}:maximum" value="${escapeHtml(exclusion.maximum)}" placeholder="Optional cap" />
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

function renderFlowComposer(): string {
  if (!flowComposerOpen) {
    return "";
  }

  return `
    <div class="modal-shell">
      <section class="panel modal-panel">
        <div class="modal-header">
          <div class="panel-heading">
            <p class="kicker">Create Expense</p>
            <h2>New expense</h2>
          </div>
          <button type="button" class="ghost-button" id="close-flow-composer">Close</button>
        </div>
        <form id="flow-form" class="stack-form">
          <label>
            Name
            <input name="name" type="text" placeholder="Health insurance" value="${escapeHtml(flowDraft.name)}" required />
          </label>
          <label>
            Tax treatment
            <select name="taxTreatment">
              ${renderExpenseTaxTreatmentOptions(flowDraft.taxTreatment)}
            </select>
          </label>
          <label>
            Formula
            ${renderFormulaEditor({
              inputName: "formula",
              value: flowDraft.formula,
              placeholder: "rent * 0.1",
              variablesScope: "flow-draft",
            })}
          </label>
          <label>
            <input name="oneTime" type="checkbox" ${flowDraft.oneTime ? "checked" : ""} />
            One-time expense
          </label>
          <label>
            <input name="inflationAdjusted" type="checkbox" ${flowDraft.inflationAdjusted ? "checked" : ""} />
            Apply inflation
          </label>
          <p class="helper-copy">
            One-time expenses automatically create a next-year override that sets the formula to 0.
          </p>
          <div class="composer-subsection">
            <div class="event-entry-header">
              <strong>Add variables first</strong>
              <button type="button" class="secondary-button" id="add-flow-variable">Add variable</button>
            </div>
            <div class="action-list">
              ${flowDraft.variables.length === 0
                ? `<p class="helper-copy">Optional. Create supporting variables here before saving the flow.</p>`
                : flowDraft.variables
                    .map(
                      (variable, index) => `
                        <div class="action-card">
                          <div class="action-header">
                            <span>Variable ${index + 1}</span>
                            <button type="button" class="ghost-button" data-remove-flow-variable="${variable.id}">Remove</button>
                          </div>
                          <label>
                            Name
                            <input type="text" data-flow-variable-field="${variable.id}:name" value="${escapeHtml(variable.name)}" placeholder="insuranceBase" />
                          </label>
                          <label>
                            Value
                            <input type="number" step="0.01" data-flow-variable-field="${variable.id}:value" value="${escapeHtml(variable.value)}" />
                          </label>
                        </div>
                      `
                    )
                    .join("")}
            </div>
          </div>
          <div class="event-buttons">
            <button type="button" class="secondary-button" id="close-flow-composer-secondary">Cancel</button>
            <button type="submit">Save expense</button>
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
          <button type="button" class="ghost-button" id="close-event-composer">Close</button>
        </div>
        <form id="event-form" class="stack-form">
          <label>
            Event name
            <input id="event-name" name="name" type="text" value="${escapeHtml(eventDraft.name)}" placeholder="Promotion cycle" required />
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
                                  <option value="set-flow-formula" ${action.kind === "set-flow-formula" ? "selected" : ""}>Set flow formula</option>
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
    return `<p class="helper-copy">No scheduled expense changes yet.</p>`;
  }

  return `
    <div class="board-scroll">
      <table class="flow-table flow-event-table">
        <thead>
          <tr>
            <th>Year</th>
            <th>Formula</th>
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
                            placeholder: "rent * 1.05",
                            variablesScope: "planner",
                          })}
                        </div>`
                      : `<button type="button" class="link-button flow-event-inline-button flow-event-inline-formula" data-start-edit-flow-event-formula="${escapeAttribute(
                          eventName ?? "__new__"
                        )}"><code>${escapeHtml(formulaValue ? formatFormulaText(formulaValue) : "Formula")}</code></button>`
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

function renderFlowEditor(): string {
  if (!flowEditorOpen) {
    return "";
  }

  return `
    <div class="modal-shell">
      <section class="panel modal-panel">
        <div class="modal-header">
          <div class="panel-heading">
            <p class="kicker">Edit Expense</p>
            <h2>${escapeHtml(flowEditDraft.originalName)}</h2>
          </div>
          <button
            type="button"
            class="ghost-button icon-button"
            id="delete-flow-from-editor"
            aria-label="Delete expense"
            title="Delete expense"
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
          <label>
            Name
            <input name="name" type="text" value="${escapeHtml(flowEditDraft.name)}" required />
          </label>
          <label>
            Tax treatment
            <select name="taxTreatment">
              ${renderExpenseTaxTreatmentOptions(flowEditDraft.taxTreatment)}
            </select>
          </label>
          <label>
            Formula
            ${renderFormulaEditor({
              inputName: "formula",
              value: flowEditDraft.formula,
              placeholder: "rent * 1.05",
              variablesScope: "planner",
            })}
          </label>
          <label>
            <input name="oneTime" type="checkbox" ${flowEditDraft.oneTime ? "checked" : ""} />
            One-time expense
          </label>
          <label>
            <input name="inflationAdjusted" type="checkbox" ${flowEditDraft.inflationAdjusted ? "checked" : ""} />
            Apply inflation
          </label>
          <p class="helper-copy">
            Keeps this expense active for the start year, then creates a hidden next-year formula override to 0.
          </p>
          <div class="event-buttons">
            <button type="button" class="secondary-button" id="close-flow-editor-secondary">Cancel</button>
            <button type="submit">Save expense</button>
          </div>
        </form>
        <section class="composer-subsection flow-editor-events-section">
          <div class="event-entry-header">
            <strong>Change over time</strong>
            <div class="event-buttons">
              <span class="summary-meta">Sorted by effective year</span>
              <button type="button" class="secondary-button" id="open-flow-event-composer">Add change</button>
            </div>
          </div>
          ${renderFlowEvents(flowEditDraft.originalName)}
        </section>
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
            <input type="number" step="0.01" data-field="${entryId}:${action.id}:b" value="${escapeHtml(action.b)}" />
          </label>
        </div>
      `;
    case "set-flow-formula":
      return `
        <p class="helper-copy">This event updates the formula for ${escapeHtml(eventDraft.flowName || action.flowName || "the selected flow")}.</p>
        <label>
          New formula
          ${renderFormulaEditor({
            value: action.formula,
            placeholder: "rent * 1.05",
            variablesScope: "event-draft",
            fieldToken: `${entryId}:${action.id}:formula`,
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
          <input type="number" step="0.01" data-field="${entryId}:${action.id}:variableDefinitionValue" value="${escapeHtml(action.variableDefinitionValue)}" />
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
          Formula
          ${renderFormulaEditor({
            value: action.flowDefinitionFormula,
            placeholder: "sideGig",
            variablesScope: "event-draft",
            fieldToken: `${entryId}:${action.id}:flowDefinitionFormula`,
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
          Formula
          ${renderFormulaEditor({
            value: action.oneTimeExpenseFormula,
            placeholder: "taxBillAmount * 0.5",
            variablesScope: "event-draft",
            fieldToken: `${entryId}:${action.id}:oneTimeExpenseFormula`,
          })}
        </label>
      `;
  }
}

function bindHandlers(user: UserIdentity): void {
  bindSimulationChartTooltip();
  focusInlineAssetValueInput();

  const openAssetButton = document.querySelector<HTMLButtonElement>("#open-asset-composer");
  const openFlowButton = document.querySelector<HTMLButtonElement>("#open-flow-composer");
  const saveScenarioButton = document.querySelector<HTMLButtonElement>("#save-scenario-button");
  const loadScenarioButton = document.querySelector<HTMLButtonElement>("#load-scenario-button");
  const loadScenarioInput = document.querySelector<HTMLInputElement>("#load-scenario-input");

  saveScenarioButton?.addEventListener("click", () => {
    downloadScenarioExport(user);
  });

  loadScenarioButton?.addEventListener("click", () => {
    loadScenarioInput?.click();
  });

  loadScenarioInput?.addEventListener("change", async () => {
    const file = loadScenarioInput.files?.[0];
    loadScenarioInput.value = "";
    if (!file) {
      return;
    }

    const previousState = buildPersistedPlannerStateRecord(user);

    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const importedState = extractScenarioPlannerState(parsed);

      invalidateSimulationState();
      closeTransientPlannerUi();
      applySavedPlannerState({
        ...importedState,
        userId: user.id,
        email: user.email,
        updatedAt: new Date().toISOString(),
      } as SavedPlannerState);
      await persistPlannerState(user);
      renderPlanner(user);
    } catch (error) {
      try {
        applySavedPlannerState({
          ...previousState,
          updatedAt: new Date().toISOString(),
        });
      } catch (restoreError) {
        console.error(restoreError);
      }
      renderPlanner(user);
      console.error(error);
      window.alert(error instanceof Error ? error.message : "Scenario file could not be loaded.");
    }
  });

  openFlowButton?.addEventListener("click", () => {
    flowComposerOpen = true;
    renderPlanner(user);
  });

  openAssetButton?.addEventListener("click", () => {
    assetComposerOpen = true;
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

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-board-tab]")) {
    button.addEventListener("click", () => {
      const nextTab = button.dataset.boardTab as PlannerBoardTab | undefined;
      if (!nextTab) {
        return;
      }

      activePlannerBoardTab = nextTab;
      renderPlanner(user);
    });
  }

  const simulationForm = document.querySelector<HTMLFormElement>("#simulation-form");
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
          asset.name === assetName ? { ...asset, sellProportion: (Number(target.value) || 0) / 100 } : asset
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
      simulationDraft.horizonYears = Math.max(1, Math.min(50, Number(target.value) || 1));
    } else if (target.name === "simulationAttempts") {
      simulationDraft.attempts = Math.max(5000, Math.min(100000, Number(target.value) || 5000));
      invalidateSimulationState();
      renderPlanner(user);
      return;
    } else if (target.name === "simulationTaxPreset") {
      simulationDraft.taxPreset = target.value as TaxPreset;
    } else if (target.name === "simulationVariableSweepEnabled" && target instanceof HTMLInputElement) {
      simulationDraft.variableSweep.enabled = target.checked;
      if (target.checked) {
        syncSimulationVariableSweepDraft();
      }
      invalidateSimulationState();
      renderPlanner(user);
      void persistPlannerState(user);
      return;
    } else if (target.name === "simulationVariableSweepVariableName") {
      simulationDraft.variableSweep.variableName = target.value;
    } else if (target.name === "simulationVariableSweepMinValue") {
      simulationDraft.variableSweep.minValue = target.value;
    } else if (target.name === "simulationVariableSweepMaxValue") {
      simulationDraft.variableSweep.maxValue = target.value;
    }

    invalidateSimulationState();
    syncSimulationSubmitState();
    void persistPlannerState(user);
  });

  simulationForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitState = getSimulationSubmitState();
    if (submitState.disabled) {
      syncSimulationSubmitState();
      return;
    }

    await persistPlannerState(user);
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
                yearlySnapshots: run.input.yearlySnapshots,
                yearlyTotals: Array.from({ length: run.input.horizonYears }, (_, rowIndex) =>
                  run.taskIds.flatMap((taskId) => yearlyTotalsByTask.get(taskId)?.[rowIndex] ?? [])
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

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-simulation-percentile]")) {
    button.addEventListener("click", () => {
      const percentile = Number(button.dataset.simulationPercentile) as SimulationPercentile;
      if (!getDisplayedSimulationResults()?.has(percentile)) {
        return;
      }

      selectedSimulationPercentile = percentile;
      renderPlanner(user);
    });
  }

  const simulationSweepSlider = document.querySelector<HTMLInputElement>("#simulation-sweep-step");
  simulationSweepSlider?.addEventListener("input", () => {
    if (!simulationSweepResults) {
      return;
    }

    selectedSimulationSweepStepIndex = Math.max(
      0,
      Math.min(simulationSweepResults.steps.length - 1, Number(simulationSweepSlider.value) || 0)
    );
    expandedSimulationExampleKeys = new Set();
    renderPlanner(user);
  });

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
        input.value = formatEditableNumber(
          plannerState.variables.find((variable) => variable.name === variableName)?.value ?? 0
        );
        return;
      }

      updateInitialVariableValue(variableName, nextValue);
      invalidateSimulationState();
      await persistPlannerState(user);
      renderPlanner(user);
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-edit-asset-value]")) {
    button.addEventListener("click", () => {
      const assetName = button.dataset.editAssetValue;
      if (!assetName) {
        return;
      }

      activeInlineAssetValueEditName = assetName;
      renderPlanner(user);
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-cancel-inline-asset-value]")) {
    button.addEventListener("click", () => {
      activeInlineAssetValueEditName = null;
      renderPlanner(user);
    });
  }

  for (const form of document.querySelectorAll<HTMLFormElement>("[data-inline-asset-value-form]")) {
    const input = form.querySelector<HTMLInputElement>('input[name="startingValue"]');
    const assetName = form.dataset.inlineAssetValueForm;
    if (!input || !assetName) {
      continue;
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const existingAsset = plannerState.assets.find((asset) => asset.name === assetName);
      if (!existingAsset) {
        return;
      }

      const nextValue = parseEditableNumber(input.value);
      if (!Number.isFinite(nextValue)) {
        return;
      }

      updateAsset(assetName, {
        ...existingAsset,
        ...(isInvestmentAsset(existingAsset) ? { startingValue: nextValue } : { initialCost: nextValue }),
      });
      syncSimulationDraftAssetRows();
      invalidateSimulationState();
      activeInlineAssetValueEditName = null;
      await persistPlannerState(user);
      renderPlanner(user);
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        activeInlineAssetValueEditName = null;
        renderPlanner(user);
      }
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
}

function focusInlineAssetValueInput(): void {
  if (!activeInlineAssetValueEditName) {
    return;
  }

  const input = document.querySelector<HTMLInputElement>(
    `[data-inline-asset-value-form="${CSS.escape(activeInlineAssetValueEditName)}"] input[name="startingValue"]`
  );
  if (!input) {
    return;
  }

  input.focus();
  input.select();
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
    renderFormulaEditorTokens(binding, hiddenInput.value, caretOffset);
    updateFormulaEditorValidation(binding);
  }

  updateFormSubmissionState(form);
}

function getFormulaEditorVariableNames(wrapper: HTMLElement): string[] {
  const scope = wrapper.dataset.variablesScope;

  switch (scope) {
    case "flow-draft":
      return getFlowDraftVariableNames();
    case "event-draft":
      return getEventDraftVariableNames();
    case "planner":
    default:
      return plannerState.variables.map((variable) => variable.name);
  }
}

function getFlowDraftVariableNames(): string[] {
  const names = new Set<string>(plannerState.variables.map((variable) => variable.name));
  for (const variable of flowDraft.variables) {
    const name = variable.name.trim();
    if (name) {
      names.add(name);
    }
  }
  return [...names];
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

function formatFormulaText(formula: string): string {
  return (formula.match(/[A-Za-z_][A-Za-z0-9_]*|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+|\s+|./g) ?? [])
    .map((token) =>
      /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$|^\d+(?:\.\d+)?$|^\.\d+$/.test(token)
        ? formatFormulaNumberToken(token)
        : token
    )
    .join("");
}

function formatFormulaNumberToken(token: string): string {
  if (token.startsWith(".")) {
    return token;
  }

  const [integerPart, fractionalPart] = token.replaceAll(",", "").split(".");
  const groupedIntegerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fractionalPart === undefined ? groupedIntegerPart : `${groupedIntegerPart}.${fractionalPart}`;
}

function validateFormula(formula: string, availableVariables: readonly string[]): FormulaValidationResult {
  if (!formula.trim()) {
    return {
      valid: false,
      message: "Formula is required.",
      unknownVariables: [],
    };
  }

  try {
    const referencedVariables = [...collectFormulaVariableNames(formula)];
    const available = new Set(availableVariables);
    const unknownVariables = referencedVariables.filter((name) => !available.has(name));

    if (unknownVariables.length > 0) {
      return {
        valid: false,
        message: `Unknown variable${unknownVariables.length === 1 ? "" : "s"}: ${unknownVariables.join(", ")}`,
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
  const result = validateFormula(binding.hiddenInput.value, binding.getVariables());
  binding.wrapper.dataset.invalid = result.valid ? "false" : "true";
  binding.status.textContent = result.message;
  binding.status.dataset.invalid = result.valid ? "false" : "true";
  binding.status.hidden = result.valid;
}

function updateFormSubmissionState(form: HTMLFormElement): void {
  const hasInvalidFormula = hasInvalidFormulaEditors(form);

  for (const submitButton of form.querySelectorAll<HTMLButtonElement>('button[type="submit"]')) {
    submitButton.disabled = hasInvalidFormula;
  }
}

function hasInvalidFormulaEditors(form: HTMLFormElement): boolean {
  return [...form.querySelectorAll<HTMLElement>("[data-formula-editor]")]
    .some((wrapper) => wrapper.dataset.invalid === "true");
}

function renderFormulaEditorTokens(
  binding: FormulaEditorBinding,
  formula: string,
  preferredCaretOffset: number
): void {
  const variables = new Set(binding.getVariables());
  const tokens =
    formula.match(/[A-Za-z_][A-Za-z0-9_]*|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+|\s+|./g) ?? [];

  binding.editor.innerHTML = tokens
    .map((token) => {
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) {
        const valid = variables.has(token);
        return `<span class="${valid ? "formula-token formula-token-variable" : "formula-token formula-token-variable is-invalid"}">${escapeHtml(token)}</span>`;
      }

      if (/^\s+$/.test(token)) {
        return token.replaceAll(" ", "&nbsp;");
      }

      if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$|^\d+(?:\.\d+)?$|^\.\d+$/.test(token)) {
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
      } else if (field === "taxTreatment") {
        cashGeneration.taxTreatment = target.value as AssetCashTaxTreatment;
      }
      return;
    }

    if (target.name === "name") {
      assetDraft.name = target.value;
    } else if (target.name === "kind") {
      assetDraft.kind = target.value as AssetDraft["kind"];
      renderPlanner(user);
      return;
    } else if (target.name === "startingValue") {
      assetDraft.startingValue = target.value;
    } else if (target.name === "initialCost") {
      assetDraft.initialCost = target.value;
    } else if (target.name === "cashPurchasePercent") {
      assetDraft.cashPurchasePercent = target.value;
    } else if (target.name === "mortgageType") {
      assetDraft.mortgageType = target.value as AssetDraft["mortgageType"];
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
        assetDraft.cashGenerations = [createAssetCashGenerationDraft()];
      }
      renderPlanner(user);
      return;
    } else if (target.name === "saleTaxEnabled") {
      assetDraft.saleTaxEnabled = target instanceof HTMLInputElement ? target.checked : target.value === "true";
      renderPlanner(user);
      return;
    } else if (target.name === "saleTaxCostBasis") {
      assetDraft.saleTaxCostBasis = target.value;
    } else if (target.name === "saleTaxTreatment") {
      assetDraft.saleTaxTreatment = target.value as AssetSaleTaxTreatment;
    }
  });

  assetForm.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }

    if (target.id === "add-cash-generation") {
      assetDraft.cashGenerations.push(createAssetCashGenerationDraft());
      renderPlanner(user);
      return;
    }

    const removeCashGenerationId = target.dataset.removeCashGeneration;
    if (removeCashGenerationId) {
      assetDraft.cashGenerations = assetDraft.cashGenerations.filter((candidate) => candidate.id !== removeCashGenerationId);
      if (assetDraft.cashGenerations.length === 0) {
        assetDraft.cashGenerations = [createAssetCashGenerationDraft()];
      }
      renderPlanner(user);
      return;
    }

    if (target.id === "close-asset-composer" || target.id === "close-asset-composer-secondary") {
      closeAssetComposer();
      renderPlanner(user);
    }
  });

  assetForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    plannerState.assets.push(buildAssetDefinition(assetDraft));
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
      } else if (field === "taxTreatment") {
        cashGeneration.taxTreatment = target.value as AssetCashTaxTreatment;
      }
      return;
    }

    if (target.name === "name") {
      assetEditDraft.name = target.value;
    } else if (target.name === "kind") {
      assetEditDraft.kind = target.value as AssetDraft["kind"];
      renderPlanner(user);
      return;
    } else if (target.name === "startingValue") {
      assetEditDraft.startingValue = target.value;
    } else if (target.name === "initialCost") {
      assetEditDraft.initialCost = target.value;
    } else if (target.name === "cashPurchasePercent") {
      assetEditDraft.cashPurchasePercent = target.value;
    } else if (target.name === "mortgageType") {
      assetEditDraft.mortgageType = target.value as AssetDraft["mortgageType"];
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
        assetEditDraft.cashGenerations = [createAssetCashGenerationDraft()];
      }
      renderPlanner(user);
      return;
    } else if (target.name === "saleTaxEnabled") {
      assetEditDraft.saleTaxEnabled = target instanceof HTMLInputElement ? target.checked : target.value === "true";
      renderPlanner(user);
      return;
    } else if (target.name === "saleTaxCostBasis") {
      assetEditDraft.saleTaxCostBasis = target.value;
    } else if (target.name === "saleTaxTreatment") {
      assetEditDraft.saleTaxTreatment = target.value as AssetSaleTaxTreatment;
    } else if (target.dataset.assetCorrelation) {
      assetEditDraft.correlations[target.dataset.assetCorrelation] = target.value;
    }
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

    if (button.id === "add-cash-generation") {
      assetEditDraft.cashGenerations.push(createAssetCashGenerationDraft());
      renderPlanner(user);
      return;
    }

    const removeCashGenerationId = button.dataset.removeCashGeneration;
    if (removeCashGenerationId) {
      assetEditDraft.cashGenerations = assetEditDraft.cashGenerations.filter(
        (candidate) => candidate.id !== removeCashGenerationId
      );
      if (assetEditDraft.cashGenerations.length === 0) {
        assetEditDraft.cashGenerations = [createAssetCashGenerationDraft()];
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

    updateAsset(assetEditDraft.originalName, buildAssetDefinition(assetEditDraft));
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

    if (target.name === "name") {
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
  const form = document.querySelector<HTMLFormElement>("#tax-profile-form");
  if (!form) {
    return;
  }

  const persistTaxProfile = async (shouldRender: boolean): Promise<void> => {
    plannerState.taxProfile = buildTaxProfileDefinition(taxProfileDraft);
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
    } else if (target.name === "localTaxName") {
      taxProfileDraft.localTaxName = target.value;
    } else if (target.name === "niitTaxName") {
      taxProfileDraft.niitTaxName = target.value;
    }

    scheduleTaxProfilePersistence();
  });

  form.addEventListener("change", async () => {
    await flushTaxProfilePersistence(true);
  });

  form.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const button = target.closest<HTMLButtonElement>("#load-nyc-tax-preset");
    if (!button) {
      return;
    }

    event.preventDefault();
    const preset = createDefaultNYCHouseholdTaxes(taxProfileDraft.filingStatus);
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

function clearDeletedTaxReference(taxName: string): void {
  plannerState.taxProfile = {
    ...plannerState.taxProfile,
    federalOrdinaryTaxName:
      plannerState.taxProfile.federalOrdinaryTaxName === taxName ? "" : plannerState.taxProfile.federalOrdinaryTaxName,
    federalQualifiedTaxName:
      plannerState.taxProfile.federalQualifiedTaxName === taxName ? "" : plannerState.taxProfile.federalQualifiedTaxName,
    stateTaxName: plannerState.taxProfile.stateTaxName === taxName ? "" : plannerState.taxProfile.stateTaxName,
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
    localTaxName: plannerState.taxProfile.localTaxName === previousName ? nextName : plannerState.taxProfile.localTaxName,
    niitTaxName: plannerState.taxProfile.niitTaxName === previousName ? nextName : plannerState.taxProfile.niitTaxName,
  };
  syncTaxProfileDraft();
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

    const flowVariableField = target.dataset.flowVariableField;
    if (flowVariableField) {
      const [variableId, field] = flowVariableField.split(":");
      const variable = findFlowVariableDraft(variableId);
      if (field === "name" || field === "value") {
        variable[field] = target.value;
      }
      return;
    }

    if (target.name === "name") {
      flowDraft.name = target.value;
    } else if (target.name === "taxTreatment") {
      flowDraft.taxTreatment = target.value as FlowTaxTreatment;
    } else if (target.name === "formula") {
      flowDraft.formula = target.value;
    } else if (target.name === "oneTime" && target instanceof HTMLInputElement) {
      flowDraft.oneTime = target.checked;
    } else if (target.name === "inflationAdjusted" && target instanceof HTMLInputElement) {
      flowDraft.inflationAdjusted = target.checked;
    }

    refreshFormulaEditors(flowForm);
  });

  flowForm.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }

    const removeVariableId = target.dataset.removeFlowVariable;
    if (removeVariableId) {
      flowDraft.variables = flowDraft.variables.filter((variable) => variable.id !== removeVariableId);
      renderPlanner(user);
      return;
    }

    if (target.id === "add-flow-variable") {
      flowDraft.variables.push(createFlowVariableDraft());
      renderPlanner(user);
      return;
    }

    if (target.id === "close-flow-composer" || target.id === "close-flow-composer-secondary") {
      closeFlowComposer();
      renderPlanner(user);
    }
  });

  flowForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (hasInvalidFormulaEditors(flowForm)) {
      return;
    }

    for (const variable of flowDraft.variables) {
      plannerState.variables.push({
        name: variable.name.trim(),
        value: Number(variable.value),
      });
    }
    plannerState.flows.push({
      name: flowDraft.name.trim(),
      type: "expense",
      formula: flowDraft.formula.trim(),
      inflationAdjusted: flowDraft.inflationAdjusted,
      taxTreatment: flowDraft.taxTreatment,
    });
    syncExpenseOneTimeReset(flowDraft.name.trim(), flowDraft.oneTime);
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
    if (hasInvalidFormulaEditors(eventForm)) {
      return;
    }

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
  if (!flowEditForm || !openFlowEventComposerButton) {
    return;
  }

  flowEditForm.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
      return;
    }

    if (target.name === "name") {
      flowEditDraft.name = target.value;
    } else if (target.name === "taxTreatment") {
      flowEditDraft.taxTreatment = target.value as FlowTaxTreatment;
    } else if (target.name === "formula") {
      flowEditDraft.formula = target.value;
    } else if (target.name === "oneTime" && target instanceof HTMLInputElement) {
      flowEditDraft.oneTime = target.checked;
    } else if (target.name === "inflationAdjusted" && target instanceof HTMLInputElement) {
      flowEditDraft.inflationAdjusted = target.checked;
    }
  });

  deleteFlowButton?.addEventListener("click", () => {
      const confirmed = window.confirm(
        `Delete expense "${flowEditDraft.originalName}"? This will also remove related change-over-time overrides and prune unused variables.`
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

  openFlowEventComposerButton.addEventListener("click", () => {
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
    if (hasInvalidFormulaEditors(flowEditForm)) {
      return;
    }

    updateFlow(flowEditDraft.originalName, {
      name: flowEditDraft.name.trim(),
      type: "expense",
      formula: flowEditDraft.formula.trim(),
      inflationAdjusted: flowEditDraft.inflationAdjusted,
      taxTreatment: flowEditDraft.taxTreatment,
    });
    syncExpenseOneTimeReset(flowEditDraft.name.trim(), flowEditDraft.oneTime);
    invalidateSimulationState();
    closeFlowEditor();
    activeSummaryTab = "variables";
    await persistPlannerState(user);
    renderPlanner(user);
  });

  const saveInlineFlowEvent = async (): Promise<void> => {
    try {
      if (!flowEventDraft.formula.trim()) {
        resetFlowEventDraft(flowEditDraft.originalName, flowEditDraft.formula);
        activeFlowEventEdit = null;
        renderPlanner(user);
        return;
      }

      upsertExpenseChangeEvent(
        flowEventDraft.originalName,
        flowEditDraft.originalName,
        normalizeYearInput(flowEventDraft.year),
        flowEventDraft.formula
      );
      resetFlowEventDraft(flowEditDraft.originalName, flowEditDraft.formula);
      activeFlowEventEdit = null;
      await persistPlannerState(user);
      renderPlanner(user);
    } catch {
      renderPlanner(user);
    }
  };

  for (const input of document.querySelectorAll<HTMLInputElement>("[data-inline-flow-event-year]")) {
    input.addEventListener("input", () => {
      flowEventDraft.year = input.value;
    });
    input.addEventListener("blur", () => {
      void saveInlineFlowEvent();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        input.blur();
      }
    });
    input.focus();
    input.select();
  }

  for (const wrapper of document.querySelectorAll<HTMLElement>("[data-inline-flow-event-formula-editor]")) {
    wrapper.addEventListener("focusout", (event) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && wrapper.contains(nextTarget)) {
        return;
      }

      const formulaWrapper = wrapper.querySelector<HTMLElement>("[data-formula-editor]");
      if (formulaWrapper?.dataset.invalid === "true") {
        return;
      }

      void saveInlineFlowEvent();
    });

    const editor = wrapper.querySelector<HTMLElement>(".formula-editor-input");
    if (!editor) {
      continue;
    }

    editor.focus();
    setCaretCharacterOffset(editor, editor.textContent?.length ?? 0);
  }
}

function toEventAction(action: EventActionDraft, flowName: string): EventAction {
  switch (action.kind) {
    case "adjust-variable":
      return {
        kind: "adjust-variable",
        variableName: action.variableName.trim(),
        adjustment: {
          m: Number(action.m),
          b: Number(action.b),
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
          value: Number(action.variableDefinitionValue),
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

function findFlowVariableDraft(variableId: string): FlowVariableDraft {
  const variable = flowDraft.variables.find((candidate) => candidate.id === variableId);
  if (!variable) {
    throw new Error(`Unknown flow variable draft "${variableId}".`);
  }

  return variable;
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

function buildAssetDefinition(draft: AssetDraft): AssetDefinition {
  if (draft.kind === "home") {
    return new Asset({
      kind: "home",
      name: draft.name,
      initialCost: parseEditableNumber(draft.initialCost),
      expectedReturn: Number(draft.expectedReturn),
      volatility: Number(draft.volatility),
      cashPurchasePercent: Number(draft.cashPurchasePercent) / 100,
      mortgageType: draft.mortgageType,
      mortgageRate: Number(draft.mortgageRate),
      mortgageTermYears: Number(draft.mortgageTermYears),
      monthlyNonTaxCosts: Number(draft.monthlyNonTaxCosts),
      propertyTaxRate: Number(draft.propertyTaxRate),
      purchaseYear: Number(draft.purchaseYear),
    }).toDefinition();
  }

  return new Asset({
    name: draft.name,
    startingValue: parseEditableNumber(draft.startingValue),
    expectedReturn: Number(draft.expectedReturn),
    volatility: Number(draft.volatility),
    sellProportion: 0,
    ...(draft.cashGenerationEnabled
      ? {
          cashGenerations: draft.cashGenerations.map(
            (cashGeneration): AssetCashGenerationDefinition => ({
              name: cashGeneration.name.trim(),
              rate: Number(cashGeneration.rate),
              volatility: Number(cashGeneration.volatility),
              taxTreatment: cashGeneration.taxTreatment,
            })
          ),
        }
      : {}),
    ...(draft.saleTaxEnabled
      ? {
          saleTax: {
            costBasis: parseEditableNumber(draft.saleTaxCostBasis),
            taxTreatment: draft.saleTaxTreatment,
          } satisfies AssetSaleTaxDefinition,
        }
      : {}),
  }).toDefinition();
}

function buildTaxDefinition(draft: TaxDraft): TaxDefinition {
  return buildNormalizedTaxDefinition({
    name: draft.name,
    taxRates: draft.rates.map(
      (rate): TaxRateDefinition => ({
        rate: Number(rate.rate),
        ...(rate.upTo.trim() ? { upTo: Number(rate.upTo) } : {}),
      })
    ),
    exclusions: draft.exclusions.map(
      (exclusion): TaxExclusionDefinition => ({
        name: exclusion.name,
        amount: Number(exclusion.amount),
        ...(exclusion.maximum.trim() ? { maximum: Number(exclusion.maximum) } : {}),
      })
    ),
    ...(draft.maximum.trim() ? { maximum: Number(draft.maximum) } : {}),
  });
}

function buildTaxProfileDefinition(draft: TaxProfileDraft): HouseholdTaxProfileDefinition {
  return {
    filingStatus: draft.filingStatus,
    deductionMode: draft.deductionMode,
    federalStandardDeduction: Number(draft.federalStandardDeduction),
    otherSaltTaxesPaid: Number(draft.otherSaltTaxesPaid),
    saltDeductionBaseCap: Number(draft.saltDeductionBaseCap),
    saltDeductionFloorCap: Number(draft.saltDeductionFloorCap),
    saltDeductionPhaseoutThreshold: Number(draft.saltDeductionPhaseoutThreshold),
    saltDeductionPhaseoutRate: Number(draft.saltDeductionPhaseoutRate),
    otherItemizedDeductions: Number(draft.otherItemizedDeductions),
    stateTaxableIncomeAdjustment: Number(draft.stateTaxableIncomeAdjustment),
    localTaxableIncomeAdjustment: Number(draft.localTaxableIncomeAdjustment),
    niitThreshold: Number(draft.niitThreshold),
    federalOrdinaryTaxName: draft.federalOrdinaryTaxName,
    federalQualifiedTaxName: draft.federalQualifiedTaxName,
    stateTaxName: draft.stateTaxName,
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

  const nextDraft = buildAssetDraftFromDefinition(asset);
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
  flowDraft.name = "";
  flowDraft.taxTreatment = "nondeductible-expense";
  flowDraft.formula = "";
  flowDraft.inflationAdjusted = true;
  flowDraft.oneTime = false;
  flowDraft.variables = [];
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
  flowEditDraft.name = flow.name;
  flowEditDraft.taxTreatment = flow.taxTreatment ?? "nondeductible-expense";
  flowEditDraft.formula = flow.formula;
  flowEditDraft.inflationAdjusted = isFlowInflationAdjusted(flow);
  flowEditDraft.oneTime = plannerState.events.some((event) => isOneTimeResetEvent(event, flow.name));
  activeFlowEventEdit = null;
  resetFlowEventDraft(flow.name, flow.formula);
}

function closeFlowEditor(): void {
  flowEditorOpen = false;
  activeFlowEventEdit = null;
  flowEditDraft.originalName = "";
  flowEditDraft.name = "";
  flowEditDraft.taxTreatment = "nondeductible-expense";
  flowEditDraft.formula = "";
  flowEditDraft.inflationAdjusted = true;
  flowEditDraft.oneTime = false;
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

function closeTransientPlannerUi(): void {
  closeAssetComposer();
  closeAssetEditor();
  closeTaxComposer();
  closeFlowComposer();
  closeFlowEditor();
  closeEventComposer();
  activeInlineAssetValueEditName = null;
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
    ? partialState.assets.map(
        (asset) => migratePersistedAsset(asset)
      )
    : fallbackState.assets;
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
    ? partialState.flows.map((flow) => ({
        ...flow,
        inflationAdjusted: flow.type === "expense" ? flow.inflationAdjusted !== false : false,
        taxTreatment:
          flow.taxTreatment ?? (flow.type === "income" ? ("ordinary-income" as const) : ("nondeductible-expense" as const)),
      }))
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
      ? Math.max(5000, Math.min(100000, partialState.simulationAttempts))
      : fallbackSimulationDraft.attempts;
  simulationDraft.taxPreset =
    partialState.simulationTaxPreset === "nyc"
      ? partialState.simulationTaxPreset
      : fallbackSimulationDraft.taxPreset;
  simulationDraft.horizonYears =
    typeof partialState.simulationHorizonYears === "number" && Number.isFinite(partialState.simulationHorizonYears)
      ? Math.max(1, Math.min(50, partialState.simulationHorizonYears))
      : fallbackSimulationDraft.horizonYears;
  simulationDraft.variableSweep.enabled = partialState.simulationVariableSweep?.enabled === true;
  simulationDraft.variableSweep.variableName =
    typeof partialState.simulationVariableSweep?.variableName === "string"
      ? partialState.simulationVariableSweep.variableName
      : fallbackSimulationDraft.variableSweep.variableName;
  simulationDraft.variableSweep.minValue =
    typeof partialState.simulationVariableSweep?.minValue === "number" &&
    Number.isFinite(partialState.simulationVariableSweep.minValue)
      ? formatEditableNumber(partialState.simulationVariableSweep.minValue)
      : fallbackSimulationDraft.variableSweep.minValue;
  simulationDraft.variableSweep.maxValue =
    typeof partialState.simulationVariableSweep?.maxValue === "number" &&
    Number.isFinite(partialState.simulationVariableSweep.maxValue)
      ? formatEditableNumber(partialState.simulationVariableSweep.maxValue)
      : fallbackSimulationDraft.variableSweep.maxValue;
  syncTaxProfileDraft();
  syncSimulationDraftAssetRows();
  syncSimulationVariableSweepDraft();
}

async function persistPlannerState(user: UserIdentity): Promise<void> {
  persistVariableSweepDraftToLocalStorage(user.id);
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

async function bootstrap(): Promise<void> {
  const user = await auth.getCurrentUser();
  const savedState = await storage.getPlannerState(user.id);
  if (savedState) {
    applySavedPlannerState(savedState);
  } else {
    await persistPlannerState(user);
  }
  applyVariableSweepDraftFromLocalStorage(user.id);
  syncSimulationVariableSweepDraft();
  renderPlanner(user);
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  mountedAppRoot.innerHTML = `<div class="app-shell"><p class="error-copy">The planner failed to load. Check the console for details.</p></div>`;
});
