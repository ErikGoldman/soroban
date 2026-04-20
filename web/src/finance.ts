export type FormulaContext = Record<string, number>;

type BinaryOperator = "+" | "-" | "*" | "/" | "^";

type FormulaNode =
  | { type: "number"; value: number }
  | { type: "variable"; name: string }
  | { type: "unary"; operator: "+" | "-"; operand: FormulaNode }
  | { type: "binary"; operator: BinaryOperator; left: FormulaNode; right: FormulaNode };

interface Token {
  type: "number" | "identifier" | "operator" | "paren" | "eof";
  value: string;
}

export interface VariableDefinition {
  name: string;
  value: number;
}

export type InvestmentAssetType = "us-stocks" | "federal-bonds" | "local-bonds";

interface AssetDefinitionBase {
  name: string;
  expectedReturn: number;
  volatility: number;
}

export interface InvestmentAssetDefinition extends AssetDefinitionBase {
  kind?: "investment";
  assetType?: InvestmentAssetType;
  startingValue: number;
  startingValueFormula?: string;
  sellProportion: number;
  cashGeneration?: AssetCashGenerationDefinition;
  cashGenerations?: readonly AssetCashGenerationDefinition[];
  saleTax?: AssetSaleTaxDefinition;
}

export interface HomeAssetDefinition extends AssetDefinitionBase {
  kind: "home";
  initialCost: number;
  initialCostFormula?: string;
  alreadyOwned?: boolean;
  cashPurchasePercent: number;
  closingCostPercent?: number;
  mortgageType: "amortizing" | "interest-only";
  interestOnlyMaturityAction?: "payoff" | "refinance" | "sell";
  mortgageRate: number;
  mortgageTermYears: number;
  monthlyNonTaxCosts: number;
  propertyTaxRate: number;
  purchaseYear: number;
}

export type AssetDefinition = InvestmentAssetDefinition | HomeAssetDefinition;

export type FlowTaxTreatment =
  | "wages"
  | "ordinary-income"
  | "qualified-dividends"
  | "short-term-capital-gains"
  | "long-term-capital-gains"
  | "tax-exempt-income"
  | "deductible-expense"
  | "nondeductible-expense";

export type AssetCashTaxTreatment =
  | "ordinary-income"
  | "qualified-dividends"
  | "tax-exempt-income"
  | "state-local-exempt"
  | "triple-exempt"
  | "not-taxable";

export type AssetSaleTaxTreatment =
  | "short-term-capital-gains"
  | "long-term-capital-gains"
  | "not-taxable";

export interface AssetCashGenerationDefinition {
  name?: string;
  rate: number;
  volatility: number;
  inflationCorrelation?: number;
  taxTreatment?: AssetCashTaxTreatment;
}

export interface AssetSaleTaxDefinition {
  costBasis?: number;
  taxTreatment?: AssetSaleTaxTreatment;
}

export interface AssetCorrelationDefinition {
  assetA: string;
  assetB: string;
  correlation: number;
}

export interface LinearAdjustment {
  m: number;
  b: number;
}

export class Variable {
  readonly name: string;
  private currentValue: number;

  constructor({ name, value }: VariableDefinition) {
    if (!name.trim()) {
      throw new Error("Variable name is required.");
    }

    assertFiniteNumber(value, `Initial value for variable "${name}" must be finite.`);

    this.name = name;
    this.currentValue = value;
  }

  get value(): number {
    return this.currentValue;
  }

  setValue(nextValue: number): number {
    assertFiniteNumber(nextValue, `Next value for variable "${this.name}" must be finite.`);
    this.currentValue = nextValue;
    return this.currentValue;
  }

  adjustLinearly({ m, b }: LinearAdjustment): number {
    assertFiniteNumber(m, `Linear multiplier for variable "${this.name}" must be finite.`);
    assertFiniteNumber(b, `Linear offset for variable "${this.name}" must be finite.`);
    this.currentValue = m * this.currentValue + b;
    return this.currentValue;
  }
}

export class Asset {
  readonly name: string;
  readonly expectedReturn: number;
  readonly volatility: number;
  readonly kind: "investment" | "home";
  readonly assetType: InvestmentAssetType | null;
  readonly startingValue: number;
  readonly startingValueFormula?: string;
  readonly sellProportion: number;
  readonly cashGenerations: readonly AssetCashGenerationDefinition[];
  readonly saleTax: AssetSaleTaxDefinition | null;
  readonly initialCost: number;
  readonly initialCostFormula?: string;
  readonly alreadyOwned: boolean;
  readonly cashPurchasePercent: number;
  readonly closingCostPercent: number;
  readonly mortgageType: "amortizing" | "interest-only";
  readonly interestOnlyMaturityAction: "payoff" | "refinance" | "sell";
  readonly mortgageRate: number;
  readonly mortgageTermYears: number;
  readonly monthlyNonTaxCosts: number;
  readonly propertyTaxRate: number;
  readonly purchaseYear: number | null;

  constructor(definition: AssetDefinition) {
    const normalizedName = definition.name.trim();

    if (!normalizedName) {
      throw new Error("Asset name is required.");
    }

    assertFiniteNumber(definition.expectedReturn, `Expected return for asset "${normalizedName}" must be finite.`);
    assertFiniteNumber(definition.volatility, `Volatility for asset "${normalizedName}" must be finite.`);

    if (definition.kind === "home") {
      const normalizedHome = normalizeHomeAssetDefinition(normalizedName, definition);

      this.name = normalizedName;
      this.kind = "home";
      this.assetType = null;
      this.expectedReturn = definition.expectedReturn;
      this.volatility = definition.volatility;
      this.startingValue = 0;
      this.startingValueFormula = undefined;
      this.sellProportion = 0;
      this.cashGenerations = [];
      this.saleTax = null;
      this.initialCost = normalizedHome.initialCost;
      this.initialCostFormula = definition.initialCostFormula?.trim() || undefined;
      this.alreadyOwned = normalizedHome.alreadyOwned;
      this.cashPurchasePercent = normalizedHome.cashPurchasePercent;
      this.closingCostPercent = normalizedHome.closingCostPercent;
      this.mortgageType = normalizedHome.mortgageType;
      this.interestOnlyMaturityAction = normalizedHome.interestOnlyMaturityAction;
      this.mortgageRate = normalizedHome.mortgageRate;
      this.mortgageTermYears = normalizedHome.mortgageTermYears;
      this.monthlyNonTaxCosts = normalizedHome.monthlyNonTaxCosts;
      this.propertyTaxRate = normalizedHome.propertyTaxRate;
      this.purchaseYear = normalizedHome.purchaseYear;
      return;
    }

    assertFiniteNumber(definition.startingValue, `Starting value for asset "${normalizedName}" must be finite.`);
    assertFiniteNumber(definition.sellProportion, `Sell multiplier for asset "${normalizedName}" must be finite.`);

    if (definition.sellProportion < 0) {
      throw new Error(`Sell multiplier for asset "${normalizedName}" cannot be negative.`);
    }

    const normalizedCashGenerations = normalizeAssetCashGenerations(
      normalizedName,
      definition.assetType ?? null,
      definition.cashGenerations,
      definition.cashGeneration
    );
    const normalizedSaleTax = normalizeAssetSaleTax(normalizedName, definition.saleTax);

    this.name = normalizedName;
    this.kind = "investment";
    this.assetType = definition.assetType ?? null;
    this.startingValue = definition.startingValue;
    this.startingValueFormula = definition.startingValueFormula?.trim() || undefined;
    this.expectedReturn = definition.expectedReturn;
    this.volatility = definition.volatility;
    this.sellProportion = definition.sellProportion;
    this.cashGenerations = normalizedCashGenerations;
    this.saleTax = normalizedSaleTax;
    this.initialCost = 0;
    this.initialCostFormula = undefined;
    this.alreadyOwned = false;
    this.cashPurchasePercent = 0;
    this.closingCostPercent = 0;
    this.mortgageType = "amortizing";
    this.interestOnlyMaturityAction = "payoff";
    this.mortgageRate = 0;
    this.mortgageTermYears = 0;
    this.monthlyNonTaxCosts = 0;
    this.propertyTaxRate = 0;
    this.purchaseYear = null;
  }

  toDefinition(): AssetDefinition {
    if (this.kind === "home") {
      return {
        kind: "home",
        name: this.name,
        initialCost: this.initialCost,
        ...(this.initialCostFormula ? { initialCostFormula: this.initialCostFormula } : {}),
        ...(this.alreadyOwned ? { alreadyOwned: true } : {}),
        cashPurchasePercent: this.cashPurchasePercent,
        closingCostPercent: this.closingCostPercent,
        mortgageType: this.mortgageType,
        ...(this.mortgageType === "interest-only"
          ? {
              interestOnlyMaturityAction: this.interestOnlyMaturityAction,
            }
          : {}),
        mortgageRate: this.mortgageRate,
        mortgageTermYears: this.mortgageTermYears,
        monthlyNonTaxCosts: this.monthlyNonTaxCosts,
        propertyTaxRate: this.propertyTaxRate,
        purchaseYear: this.purchaseYear ?? new Date().getFullYear(),
        expectedReturn: this.expectedReturn,
        volatility: this.volatility,
      };
    }

    return {
      name: this.name,
      ...(this.assetType ? { assetType: this.assetType } : {}),
      startingValue: this.startingValue,
      ...(this.startingValueFormula ? { startingValueFormula: this.startingValueFormula } : {}),
      expectedReturn: this.expectedReturn,
      volatility: this.volatility,
      sellProportion: this.sellProportion,
      ...(this.cashGenerations.length > 0 ? { cashGenerations: this.cashGenerations } : {}),
      ...(this.saleTax ? { saleTax: this.saleTax } : {}),
    };
  }
}

export function normalizeAssetCorrelationPair(assetA: string, assetB: string): {
  assetA: string;
  assetB: string;
} {
  const normalizedA = assetA.trim();
  const normalizedB = assetB.trim();

  if (!normalizedA || !normalizedB) {
    throw new Error("Asset correlation pair requires both asset names.");
  }

  if (normalizedA === normalizedB) {
    throw new Error("Asset correlation pair must reference two different assets.");
  }

  return normalizedA < normalizedB
    ? { assetA: normalizedA, assetB: normalizedB }
    : { assetA: normalizedB, assetB: normalizedA };
}

export function createAssetCorrelationDefinition({
  assetA,
  assetB,
  correlation,
}: AssetCorrelationDefinition): AssetCorrelationDefinition {
  const pair = normalizeAssetCorrelationPair(assetA, assetB);
  assertFiniteNumber(correlation, `Correlation for "${pair.assetA}" and "${pair.assetB}" must be finite.`);

  if (correlation < -1 || correlation > 1) {
    throw new Error(`Correlation for "${pair.assetA}" and "${pair.assetB}" must be between -1 and 1.`);
  }

  return {
    ...pair,
    correlation,
  };
}

export function getDefaultAssetCashGenerationInflationCorrelation(
  assetType: InvestmentAssetType | null | undefined
): number {
  return assetType === "federal-bonds" || assetType === "local-bonds" ? 0.35 : 0;
}

export function deleteAssetAndPruneCorrelations(
  assets: readonly AssetDefinition[],
  correlations: readonly AssetCorrelationDefinition[],
  assetName: string
): {
  assets: AssetDefinition[];
  correlations: AssetCorrelationDefinition[];
} {
  const normalizedName = assetName.trim();

  return {
    assets: assets.filter((asset) => asset.name !== normalizedName),
    correlations: correlations.filter(
      (correlation) => correlation.assetA !== normalizedName && correlation.assetB !== normalizedName
    ),
  };
}

export type FlowType = "income" | "expense";

export interface FlowDefinition {
  name: string;
  type: FlowType;
  formula: string;
  taxTreatment?: FlowTaxTreatment;
  inflationAdjusted?: boolean;
  startYear?: number;
  endYear?: number;
  annualRaisePercent?: number;
}

export const DEFAULT_EXPENSE_INFLATION_RATE = 0.03;

export class Flow {
  readonly name: string;
  readonly type: FlowType;
  readonly taxTreatment: FlowTaxTreatment;
  readonly inflationAdjusted: boolean;
  readonly startYear?: number;
  readonly endYear?: number;
  readonly annualRaisePercent: number;
  private currentFormula: string;

  constructor({ name, type, formula, taxTreatment, inflationAdjusted, startYear, endYear, annualRaisePercent }: FlowDefinition) {
    if (!name.trim()) {
      throw new Error("Name is required.");
    }

    if (type !== "income" && type !== "expense") {
      throw new Error(`Unsupported type: ${type}`);
    }

    if (!formula.trim()) {
      throw new Error(`Flow "${name}" requires a formula.`);
    }

    this.name = name;
    this.type = type;
    this.taxTreatment = normalizeFlowTaxTreatment(type, taxTreatment);
    this.inflationAdjusted = normalizeFlowInflationAdjusted(type, inflationAdjusted);
    this.startYear = normalizeFlowStartYear(type, startYear);
    this.endYear = normalizeFlowEndYear(type, this.startYear, endYear);
    this.annualRaisePercent = normalizeFlowAnnualRaisePercent(type, annualRaisePercent);
    this.currentFormula = formula;
  }

  get formula(): string {
    return this.currentFormula;
  }

  setFormula(nextFormula: string): string {
    if (!nextFormula.trim()) {
      throw new Error(`Flow "${this.name}" requires a formula.`);
    }

    this.currentFormula = nextFormula;
    return this.currentFormula;
  }

  toDefinition(): FlowDefinition {
    return {
      name: this.name,
      type: this.type,
      formula: this.formula,
      taxTreatment: this.taxTreatment,
      inflationAdjusted: this.inflationAdjusted,
      ...(this.startYear === undefined ? {} : { startYear: this.startYear }),
      ...(this.endYear === undefined ? {} : { endYear: this.endYear }),
      ...(this.annualRaisePercent === 0 ? {} : { annualRaisePercent: this.annualRaisePercent }),
    };
  }

  evaluateYearlyAmount(context: FormulaContext, year?: EventYear | number): number {
    const normalizedYear = normalizeOptionalFlowYear(year);
    if (normalizedYear && !isFlowActiveInYear(this, normalizedYear)) {
      return 0;
    }

    const amount = evaluateFormula(this.formula, context);
    const absoluteAmount = Math.abs(amount);
    return normalizedYear ? applyFlowAnnualRaise(this, absoluteAmount, normalizedYear) : absoluteAmount;
  }

  evaluateSignedYearlyAmount(context: FormulaContext, year?: EventYear | number): number {
    const amount = this.evaluateYearlyAmount(context, year);
    return this.type === "expense" ? -amount : amount;
  }
}

export function createFormulaContext(variables: readonly Variable[]): FormulaContext {
  return Object.fromEntries(variables.map((variable) => [variable.name, variable.value]));
}

export function evaluateFormula(formula: string, context: FormulaContext = {}): number {
  const parser = new FormulaParser(formula);
  const ast = parser.parse();
  return evaluateNode(ast, context);
}

export function resolveAssetValueFormula(
  definition: AssetDefinition,
  context: FormulaContext = {}
): AssetDefinition {
  if (definition.kind === "home") {
    const formula = definition.initialCostFormula?.trim();
    if (!formula) {
      return definition;
    }

    const initialCost = evaluateFormula(formula, context);
    assertFiniteNumber(initialCost, `Initial cost for asset "${definition.name}" must resolve to a finite number.`);
    return {
      ...definition,
      initialCost,
      initialCostFormula: formula,
    };
  }

  const formula = definition.startingValueFormula?.trim();
  if (!formula) {
    return definition;
  }

  const startingValue = evaluateFormula(formula, context);
  assertFiniteNumber(startingValue, `Starting value for asset "${definition.name}" must resolve to a finite number.`);
  return {
    ...definition,
    startingValue,
    startingValueFormula: formula,
  };
}

export function sumSignedYearlyFlows(flows: readonly Flow[], context: FormulaContext, year?: EventYear | number): number {
  return flows.reduce((total, flow) => total + flow.evaluateSignedYearlyAmount(context, year), 0);
}

export function isFlowInflationAdjusted(
  flow: Pick<FlowDefinition, "type" | "inflationAdjusted">
): boolean {
  return normalizeFlowInflationAdjusted(flow.type, flow.inflationAdjusted);
}

export function applyFlowExpenseInflation(
  flow: Pick<FlowDefinition, "type" | "inflationAdjusted">,
  signedAmount: number,
  yearOffset: number,
  annualInflationRate: number = DEFAULT_EXPENSE_INFLATION_RATE
): number {
  assertFiniteNumber(signedAmount, "Flow amount must be finite.");
  assertFiniteNumber(yearOffset, "Flow year offset must be finite.");
  assertFiniteNumber(annualInflationRate, "Annual inflation rate must be finite.");

  if (!isFlowInflationAdjusted(flow)) {
    return signedAmount;
  }

  return signedAmount * Math.pow(1 + annualInflationRate, Math.max(0, yearOffset));
}

export interface EventYear {
  year: number;
}

export interface FlowFormulaSetAction {
  kind: "set-flow-formula";
  flowName: string;
  formula: string;
}

export interface VariableAdjustAction {
  kind: "adjust-variable";
  variableName: string;
  adjustment: LinearAdjustment;
}

export interface AddVariableAction {
  kind: "add-variable";
  variable: VariableDefinition;
}

export interface AddFlowAction {
  kind: "add-flow";
  flow: FlowDefinition;
}

export type EventAction =
  | FlowFormulaSetAction
  | VariableAdjustAction
  | AddVariableAction
  | AddFlowAction;

export interface ScheduledEventAction {
  year: EventYear;
  actions: readonly EventAction[];
}

export interface OneTimeExpenseDefinition {
  flowName: string;
  year: EventYear;
  formula: string;
}

export interface EventDefinition {
  name: string;
  flowName?: string;
  schedule: readonly ScheduledEventAction[];
}

export interface PlannerSnapshot {
  variables: VariableDefinition[];
  flows: FlowDefinition[];
  events: EventDefinition[];
}

export interface FinancialState {
  variables: Variable[];
  flows: Flow[];
}

export class Event {
  readonly name: string;
  readonly flowName: string;
  readonly schedule: readonly ScheduledEventAction[];

  constructor({ name, flowName, schedule }: EventDefinition) {
    if (!name.trim()) {
      throw new Error("Event name is required.");
    }

    if (schedule.length === 0) {
      throw new Error(`Event "${name}" requires at least one scheduled action.`);
    }

    this.name = name;
    this.flowName = flowName?.trim() ?? inferEventFlowName(schedule);
    this.schedule = [...schedule]
      .map((entry) => ({
        year: normalizeEventYear(entry.year),
        actions: [...entry.actions],
      }))
      .sort((left, right) => compareEventYears(left.year, right.year));
  }

  applyForYear(year: EventYear, state: FinancialState): void {
    const targetYear = normalizeEventYear(year);

    for (const scheduledAction of this.schedule) {
      if (sameYear(scheduledAction.year, targetYear)) {
        applyEventActions(scheduledAction.actions, state);
      }
    }
  }
}

export function applyEventsForYear(
  events: readonly Event[],
  year: EventYear,
  state: FinancialState
): void {
  for (const event of events) {
    event.applyForYear(year, state);
  }
}

export function createOneTimeExpenseSchedule({
  flowName,
  year,
  formula,
}: OneTimeExpenseDefinition): ScheduledEventAction[] {
  if (!flowName.trim()) {
    throw new Error("One-time expense name is required.");
  }

  if (!formula.trim()) {
    throw new Error(`One-time expense formula for "${flowName}" is required.`);
  }

  const normalizedYear = normalizeEventYear(year);

  return [
    {
      year: normalizedYear,
      actions: [
        {
          kind: "add-flow",
          flow: { name: flowName, type: "expense", formula },
        },
      ],
    },
  ];
}

export function deleteFlowAndPruneVariables(
  snapshot: PlannerSnapshot,
  flowName: string
): PlannerSnapshot {
  const flows = snapshot.flows.filter((flow) => flow.name !== flowName);
  const events = snapshot.events
    .filter((event) => event.flowName !== flowName)
    .map((event) => ({
      ...event,
      schedule: event.schedule
        .map((entry) => ({
          ...entry,
          actions: entry.actions.filter(
            (action) => action.kind !== "set-flow-formula" || action.flowName !== flowName
          ),
        }))
        .filter((entry) => entry.actions.length > 0),
    }))
    .filter((event) => event.schedule.length > 0);

  return {
    variables: pruneUnusedVariables({ variables: snapshot.variables, flows, events }),
    flows,
    events,
  };
}

export function deleteEventAndPruneVariables(
  snapshot: PlannerSnapshot,
  eventName: string
): PlannerSnapshot {
  const events = snapshot.events.filter((event) => event.name !== eventName);

  return {
    variables: pruneUnusedVariables({
      variables: snapshot.variables,
      flows: snapshot.flows,
      events,
    }),
    flows: [...snapshot.flows],
    events,
  };
}

export function pruneUnusedVariables(snapshot: PlannerSnapshot): VariableDefinition[] {
  const referencedVariableNames = collectReferencedVariableNames(snapshot.flows, snapshot.events);
  return snapshot.variables.filter((variable) => referencedVariableNames.has(variable.name));
}

export function collectReferencedVariableNames(
  flows: readonly FlowDefinition[],
  events: readonly EventDefinition[]
): Set<string> {
  const referencedVariableNames = new Set<string>();

  for (const flow of flows) {
    for (const variableName of collectFormulaVariableNames(flow.formula)) {
      referencedVariableNames.add(variableName);
    }
  }

  for (const event of events) {
    const eventVariableDefinitions = new Set<string>();

    for (const entry of event.schedule) {
      for (const action of entry.actions) {
        switch (action.kind) {
          case "adjust-variable":
            referencedVariableNames.add(action.variableName);
            break;
          case "set-flow-formula":
            for (const variableName of collectFormulaVariableNames(action.formula)) {
              referencedVariableNames.add(variableName);
            }
            break;
          case "add-variable":
            eventVariableDefinitions.add(action.variable.name);
            break;
          case "add-flow":
            for (const variableName of collectFormulaVariableNames(action.flow.formula)) {
              referencedVariableNames.add(variableName);
            }
            break;
        }
      }
    }

    for (const variableName of eventVariableDefinitions) {
      if (referencedVariableNames.has(variableName)) {
        referencedVariableNames.add(variableName);
      }
    }
  }

  return referencedVariableNames;
}

function assertFiniteNumber(value: number, message: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(message);
  }
}

function normalizeAssetCashGenerations(
  assetName: string,
  assetType: InvestmentAssetType | null | undefined,
  cashGenerations: readonly AssetCashGenerationDefinition[] | undefined,
  legacyCashGeneration: AssetCashGenerationDefinition | undefined
): readonly AssetCashGenerationDefinition[] {
  const candidateCashGenerations =
    cashGenerations && cashGenerations.length > 0
      ? cashGenerations
      : legacyCashGeneration
        ? [legacyCashGeneration]
        : [];

  if (candidateCashGenerations.length === 0) {
    return [];
  }

  return candidateCashGenerations.map((cashGeneration, index) => {
    assertFiniteNumber(cashGeneration.rate, `Cash generation rate for asset "${assetName}" must be finite.`);
    assertFiniteNumber(
      cashGeneration.volatility,
      `Cash generation volatility for asset "${assetName}" must be finite.`
    );
    assertFiniteNumber(
      cashGeneration.inflationCorrelation ?? getDefaultAssetCashGenerationInflationCorrelation(assetType),
      `Cash generation inflation correlation for asset "${assetName}" must be finite.`
    );

    if (cashGeneration.rate < 0) {
      throw new Error(`Cash generation rate for asset "${assetName}" cannot be negative.`);
    }

    if (cashGeneration.volatility < 0) {
      throw new Error(`Cash generation volatility for asset "${assetName}" cannot be negative.`);
    }

    const normalizedName = cashGeneration.name?.trim() || `Cash generation ${index + 1}`;

    return {
      name: normalizedName,
      rate: cashGeneration.rate,
      volatility: cashGeneration.volatility,
      inflationCorrelation:
        cashGeneration.inflationCorrelation ?? getDefaultAssetCashGenerationInflationCorrelation(assetType),
      taxTreatment: normalizeAssetCashTaxTreatment(cashGeneration.taxTreatment),
    };
  });
}

function normalizeHomeAssetDefinition(
  assetName: string,
  definition: HomeAssetDefinition
): Omit<HomeAssetDefinition, "name" | "expectedReturn" | "volatility" | "kind" | "closingCostPercent"> & {
  closingCostPercent: number;
  alreadyOwned: boolean;
  interestOnlyMaturityAction: "payoff" | "refinance" | "sell";
} {
  assertFiniteNumber(definition.initialCost, `Home price for asset "${assetName}" must be finite.`);
  assertFiniteNumber(
    definition.cashPurchasePercent,
    `Cash purchase percent for asset "${assetName}" must be finite.`
  );
  assertFiniteNumber(
    definition.closingCostPercent ?? 0,
    `Closing cost percent for asset "${assetName}" must be finite.`
  );
  assertFiniteNumber(definition.mortgageRate, `Mortgage rate for asset "${assetName}" must be finite.`);
  assertFiniteNumber(
    definition.mortgageTermYears,
    `Mortgage term for asset "${assetName}" must be finite.`
  );
  assertFiniteNumber(
    definition.monthlyNonTaxCosts,
    `Monthly non-tax costs for asset "${assetName}" must be finite.`
  );
  assertFiniteNumber(definition.propertyTaxRate, `Property tax rate for asset "${assetName}" must be finite.`);
  assertFiniteNumber(definition.purchaseYear, `Purchase year for asset "${assetName}" must be finite.`);

  if (definition.initialCost <= 0) {
    throw new Error(`Home price for asset "${assetName}" must be greater than zero.`);
  }
  if (definition.cashPurchasePercent < 0 || definition.cashPurchasePercent > 1) {
    throw new Error(`Cash purchase percent for asset "${assetName}" must be between 0 and 1.`);
  }
  if ((definition.closingCostPercent ?? 0) < 0 || (definition.closingCostPercent ?? 0) > 1) {
    throw new Error(`Closing cost percent for asset "${assetName}" must be between 0 and 1.`);
  }
  if (definition.mortgageRate < 0) {
    throw new Error(`Mortgage rate for asset "${assetName}" cannot be negative.`);
  }
  if (!Number.isInteger(definition.mortgageTermYears) || definition.mortgageTermYears < 1) {
    throw new Error(`Mortgage term for asset "${assetName}" must be a whole number of years.`);
  }
  if (definition.monthlyNonTaxCosts < 0) {
    throw new Error(`Monthly non-tax costs for asset "${assetName}" cannot be negative.`);
  }
  if (definition.propertyTaxRate < 0) {
    throw new Error(`Property tax rate for asset "${assetName}" cannot be negative.`);
  }
  if (!Number.isInteger(definition.purchaseYear)) {
    throw new Error(`Purchase year for asset "${assetName}" must be a whole number.`);
  }

  return {
    initialCost: definition.initialCost,
    alreadyOwned: definition.alreadyOwned ?? false,
    cashPurchasePercent: definition.cashPurchasePercent,
    closingCostPercent: definition.closingCostPercent ?? 0,
    mortgageType: definition.mortgageType ?? "amortizing",
    interestOnlyMaturityAction: definition.interestOnlyMaturityAction ?? "payoff",
    mortgageRate: definition.mortgageRate,
    mortgageTermYears: definition.mortgageTermYears,
    monthlyNonTaxCosts: definition.monthlyNonTaxCosts,
    propertyTaxRate: definition.propertyTaxRate,
    purchaseYear: definition.purchaseYear,
  };
}

function normalizeAssetSaleTax(
  assetName: string,
  saleTax: AssetSaleTaxDefinition | undefined
): AssetSaleTaxDefinition | null {
  if (!saleTax) {
    return null;
  }

  if (saleTax.costBasis !== undefined) {
    assertFiniteNumber(saleTax.costBasis, `Cost basis for asset "${assetName}" must be finite.`);
    if (saleTax.costBasis < 0) {
      throw new Error(`Cost basis for asset "${assetName}" cannot be negative.`);
    }
  }

  return {
    ...(saleTax.costBasis !== undefined ? { costBasis: saleTax.costBasis } : {}),
    taxTreatment: normalizeAssetSaleTaxTreatment(saleTax.taxTreatment),
  };
}

function normalizeFlowTaxTreatment(type: FlowType, taxTreatment: FlowTaxTreatment | undefined): FlowTaxTreatment {
  if (!taxTreatment) {
    return type === "income" ? "wages" : "nondeductible-expense";
  }

  return taxTreatment;
}

function normalizeFlowInflationAdjusted(type: FlowType, inflationAdjusted: boolean | undefined): boolean {
  return type === "expense" ? inflationAdjusted !== false : false;
}

function normalizeFlowStartYear(type: FlowType, startYear: number | undefined): number | undefined {
  if (type !== "income" || startYear === undefined) {
    return undefined;
  }

  assertFiniteNumber(startYear, "Income start year must be finite.");
  if (!Number.isInteger(startYear)) {
    throw new Error(`Income start year "${startYear}" must be a whole year.`);
  }

  return startYear;
}

function normalizeFlowEndYear(
  type: FlowType,
  startYear: number | undefined,
  endYear: number | undefined
): number | undefined {
  if (type !== "income" || endYear === undefined) {
    return undefined;
  }

  assertFiniteNumber(endYear, "Income end year must be finite.");
  if (!Number.isInteger(endYear)) {
    throw new Error(`Income end year "${endYear}" must be a whole year.`);
  }

  if (startYear !== undefined && endYear < startYear) {
    throw new Error(`Income end year "${endYear}" cannot be earlier than start year "${startYear}".`);
  }

  return endYear;
}

function normalizeFlowAnnualRaisePercent(type: FlowType, annualRaisePercent: number | undefined): number {
  if (type !== "income" || annualRaisePercent === undefined) {
    return 0;
  }

  assertFiniteNumber(annualRaisePercent, "Income annual raise percent must be finite.");
  return annualRaisePercent;
}

function normalizeOptionalFlowYear(year: EventYear | number | undefined): EventYear | null {
  if (year === undefined) {
    return null;
  }

  return typeof year === "number" ? normalizeEventYear({ year }) : normalizeEventYear(year);
}

function isFlowActiveInYear(
  flow: Pick<FlowDefinition, "type" | "startYear" | "endYear">,
  year: EventYear
): boolean {
  if (flow.type !== "income") {
    return true;
  }

  if (flow.startYear !== undefined && year.year < flow.startYear) {
    return false;
  }

  if (flow.endYear !== undefined && year.year > flow.endYear) {
    return false;
  }

  return true;
}

function applyFlowAnnualRaise(
  flow: Pick<FlowDefinition, "type" | "startYear" | "annualRaisePercent">,
  amount: number,
  year: EventYear
): number {
  if (flow.type !== "income") {
    return amount;
  }

  const annualRaisePercent = flow.annualRaisePercent ?? 0;
  if (annualRaisePercent === 0) {
    return amount;
  }

  const baseYear = flow.startYear ?? year.year;
  const yearsSinceStart = Math.max(0, year.year - baseYear);
  return amount * Math.pow(1 + annualRaisePercent / 100, yearsSinceStart);
}

function normalizeAssetCashTaxTreatment(
  taxTreatment: AssetCashTaxTreatment | undefined
): AssetCashTaxTreatment {
  return taxTreatment ?? "ordinary-income";
}

function normalizeAssetSaleTaxTreatment(
  taxTreatment: AssetSaleTaxTreatment | undefined
): AssetSaleTaxTreatment {
  return taxTreatment ?? "long-term-capital-gains";
}

function compareEventYears(left: EventYear, right: EventYear): number {
  return left.year - right.year;
}

function inferEventFlowName(schedule: readonly ScheduledEventAction[]): string {
  const flowNames = new Set<string>();

  for (const entry of schedule) {
    for (const action of entry.actions) {
      if (action.kind === "set-flow-formula" && action.flowName.trim()) {
        flowNames.add(action.flowName.trim());
      }
    }
  }

  return flowNames.size === 1 ? [...flowNames][0] : "";
}

function normalizeEventYear(year: EventYear): EventYear {
  if (!Number.isInteger(year.year)) {
    throw new Error(`Invalid event year "${year.year}".`);
  }

  return year;
}

function sameYear(left: EventYear, right: EventYear): boolean {
  return left.year === right.year;
}

function applyEventActions(actions: readonly EventAction[], state: FinancialState): void {
  for (const action of actions) {
    switch (action.kind) {
      case "set-flow-formula":
        findFlow(state.flows, action.flowName).setFormula(action.formula);
        break;
      case "adjust-variable":
        findVariable(state.variables, action.variableName).adjustLinearly(action.adjustment);
        break;
      case "add-variable":
        state.variables.push(new Variable(action.variable));
        break;
      case "add-flow":
        state.flows.push(new Flow(action.flow));
        break;
    }
  }
}

function findVariable(variables: readonly Variable[], name: string): Variable {
  const variable = variables.find((entry) => entry.name === name);
  if (!variable) {
    throw new Error(`Unknown variable "${name}".`);
  }

  return variable;
}

function findFlow(flows: readonly Flow[], name: string): Flow {
  const flow = flows.find((entry) => entry.name === name);
  if (!flow) {
    throw new Error(`Unknown flow "${name}".`);
  }

  return flow;
}

function evaluateNode(node: FormulaNode, context: FormulaContext): number {
  switch (node.type) {
    case "number":
      return node.value;
    case "variable": {
      const value = context[node.name];
      if (value === undefined) {
        throw new Error(`Unknown variable "${node.name}".`);
      }

      assertFiniteNumber(value, `Variable "${node.name}" must resolve to a finite number.`);
      return value;
    }
    case "unary": {
      const operand = evaluateNode(node.operand, context);
      return node.operator === "-" ? -operand : operand;
    }
    case "binary": {
      const left = evaluateNode(node.left, context);
      const right = evaluateNode(node.right, context);

      switch (node.operator) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/":
          return left / right;
        case "^":
          return Math.pow(left, right);
      }
    }
  }
}

export function collectFormulaVariableNames(formula: string): Set<string> {
  const parser = new FormulaParser(formula);
  const ast = parser.parse();
  const names = new Set<string>();
  collectNodeVariableNames(ast, names);
  return names;
}

function collectNodeVariableNames(node: FormulaNode, names: Set<string>): void {
  switch (node.type) {
    case "number":
      return;
    case "variable":
      names.add(node.name);
      return;
    case "unary":
      collectNodeVariableNames(node.operand, names);
      return;
    case "binary":
      collectNodeVariableNames(node.left, names);
      collectNodeVariableNames(node.right, names);
      return;
  }
}

function tokenize(formula: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < formula.length) {
    const char = formula[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      let end = index + 1;
      while (end < formula.length && /[0-9.,]/.test(formula[end])) {
        end += 1;
      }

      const value = formula.slice(index, end);
      if (!/^\d+(\.\d+)?$|^\d{1,3}(,\d{3})+(\.\d+)?$|^\.\d+$/.test(value)) {
        throw new Error(`Invalid number "${value}".`);
      }

      tokens.push({ type: "number", value: value.replaceAll(",", "") });
      index = end;
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      let end = index + 1;
      while (end < formula.length && /[A-Za-z0-9_]/.test(formula[end])) {
        end += 1;
      }

      tokens.push({ type: "identifier", value: formula.slice(index, end) });
      index = end;
      continue;
    }

    if ("+-*/^".includes(char)) {
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }

    if ("()".includes(char)) {
      tokens.push({ type: "paren", value: char });
      index += 1;
      continue;
    }

    throw new Error(`Unexpected token "${char}".`);
  }

  tokens.push({ type: "eof", value: "" });
  return tokens;
}

class FormulaParser {
  private readonly tokens: Token[];
  private position = 0;

  constructor(formula: string) {
    this.tokens = tokenize(formula);
  }

  parse(): FormulaNode {
    const expression = this.parseExpression();

    if (!this.is("eof")) {
      throw new Error(`Unexpected token "${this.current().value}".`);
    }

    return expression;
  }

  private parseExpression(): FormulaNode {
    let node = this.parseTerm();

    while (this.is("operator", "+") || this.is("operator", "-")) {
      const operator = this.consume("operator").value as BinaryOperator;
      const right = this.parseTerm();
      node = { type: "binary", operator, left: node, right };
    }

    return node;
  }

  private parseTerm(): FormulaNode {
    let node = this.parsePower();

    while (this.is("operator", "*") || this.is("operator", "/")) {
      const operator = this.consume("operator").value as BinaryOperator;
      const right = this.parsePower();
      node = { type: "binary", operator, left: node, right };
    }

    return node;
  }

  private parsePower(): FormulaNode {
    let node = this.parseUnary();

    if (this.is("operator", "^")) {
      this.consume("operator", "^");
      node = {
        type: "binary",
        operator: "^",
        left: node,
        right: this.parsePower(),
      };
    }

    return node;
  }

  private parseUnary(): FormulaNode {
    if (this.is("operator", "+") || this.is("operator", "-")) {
      const operator = this.consume("operator").value as "+" | "-";
      return { type: "unary", operator, operand: this.parseUnary() };
    }

    return this.parsePrimary();
  }

  private parsePrimary(): FormulaNode {
    if (this.is("number")) {
      return { type: "number", value: Number(this.consume("number").value) };
    }

    if (this.is("identifier")) {
      return { type: "variable", name: this.consume("identifier").value };
    }

    if (this.is("paren", "(")) {
      this.consume("paren", "(");
      const expression = this.parseExpression();
      this.consume("paren", ")");
      return expression;
    }

    throw new Error(`Unexpected token "${this.current().value || "end of formula"}".`);
  }

  private current(): Token {
    return this.tokens[this.position];
  }

  private is(type: Token["type"], value?: string): boolean {
    const token = this.current();
    return token.type === type && (value === undefined || token.value === value);
  }

  private consume(type: Token["type"], value?: string): Token {
    const token = this.current();
    if (!this.is(type, value)) {
      const expected = value ? `${type} "${value}"` : type;
      const actual = token.value || token.type;
      throw new Error(`Expected ${expected}, received "${actual}".`);
    }

    this.position += 1;
    return token;
  }
}
