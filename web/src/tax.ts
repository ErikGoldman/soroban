export interface TaxRateDefinition {
  rate: number;
  upTo?: number;
}

export interface TaxExclusionDefinition {
  name: string;
  amount: number;
  maximum?: number;
}

export interface TaxDefinition {
  name: string;
  taxRates: readonly TaxRateDefinition[];
  exclusions?: readonly TaxExclusionDefinition[];
  maximum?: number;
}

export type FilingStatus =
  | "single"
  | "married-filing-jointly"
  | "married-filing-separately"
  | "head-of-household";

export type DeductionMode = "standard" | "itemized";

export interface HouseholdTaxProfileDefinition {
  filingStatus: FilingStatus;
  deductionMode: DeductionMode;
  federalStandardDeduction: number;
  saltDeduction: number;
  saltDeductionCap: number;
  otherItemizedDeductions: number;
  stateTaxableIncomeAdjustment: number;
  localTaxableIncomeAdjustment: number;
  niitThreshold: number;
  federalOrdinaryTaxName: string;
  federalQualifiedTaxName: string;
  stateTaxName: string;
  localTaxName: string;
  niitTaxName: string;
}

export interface HouseholdTaxInput {
  wages: number;
  ordinaryIncome: number;
  qualifiedDividends: number;
  shortTermCapitalGains: number;
  longTermCapitalGains: number;
  taxExemptIncome: number;
  deductibleExpenses: number;
}

export interface TaxComputationResult {
  taxName: string;
  gains: number;
  excludedGains: number;
  taxableGains: number;
  tax: number;
}

export interface TaxComputationSummary {
  gains: number;
  totalExcludedGains: number;
  totalTaxableGains: number;
  totalTax: number;
  taxes: TaxComputationResult[];
}

export interface HouseholdTaxBreakdown {
  federalOrdinaryTaxableIncome: number;
  federalPreferentialIncome: number;
  federalTaxableIncome: number;
  stateTaxableIncome: number;
  localTaxableIncome: number;
  modifiedAdjustedGrossIncome: number;
  netInvestmentIncome: number;
  niitIncomeAboveThreshold: number;
  niitTaxableIncome: number;
  deductionUsed: number;
  totalTax: number;
  taxByName: Map<string, number>;
}

function assertFiniteNumber(value: number, message: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(message);
  }
}

export class TaxRate {
  readonly rate: number;
  readonly upTo: number | null;

  constructor({ rate, upTo }: TaxRateDefinition) {
    assertFiniteNumber(rate, "Tax rate must be finite.");
    if (rate < 0) {
      throw new Error("Tax rate cannot be negative.");
    }

    if (upTo !== undefined) {
      assertFiniteNumber(upTo, "Tax rate upper bound must be finite.");
      if (upTo < 0) {
        throw new Error("Tax rate upper bound cannot be negative.");
      }
    }

    this.rate = rate;
    this.upTo = upTo ?? null;
  }
}

export class TaxExclusion {
  readonly name: string;
  readonly amount: number;
  readonly maximum: number | null;

  constructor({ name, amount, maximum }: TaxExclusionDefinition) {
    const normalizedName = name.trim();
    if (!normalizedName) {
      throw new Error("Tax exclusion name is required.");
    }

    assertFiniteNumber(amount, `Exclusion amount for "${normalizedName}" must be finite.`);
    if (amount < 0) {
      throw new Error(`Exclusion amount for "${normalizedName}" cannot be negative.`);
    }

    if (maximum !== undefined) {
      assertFiniteNumber(maximum, `Exclusion maximum for "${normalizedName}" must be finite.`);
      if (maximum < 0) {
        throw new Error(`Exclusion maximum for "${normalizedName}" cannot be negative.`);
      }
    }

    this.name = normalizedName;
    this.amount = amount;
    this.maximum = maximum ?? null;
  }

  getExcludedAmount(gains: number): number {
    assertFiniteNumber(gains, "Gains must be finite.");
    const cappedAmount = this.maximum === null ? this.amount : Math.min(this.amount, this.maximum);
    return Math.max(0, Math.min(gains, cappedAmount));
  }
}

export class Tax {
  readonly name: string;
  readonly taxRates: readonly TaxRate[];
  readonly exclusions: readonly TaxExclusion[];
  readonly maximum: number | null;

  constructor({ name, taxRates, exclusions = [], maximum }: TaxDefinition) {
    const normalizedName = name.trim();
    if (!normalizedName) {
      throw new Error("Tax name is required.");
    }
    if (taxRates.length === 0) {
      throw new Error(`Tax "${normalizedName}" requires at least one tax rate.`);
    }

    const normalizedRates = taxRates.map((taxRate) => new TaxRate(taxRate));
    for (let index = 1; index < normalizedRates.length; index += 1) {
      const previous = normalizedRates[index - 1];
      const current = normalizedRates[index];
      if (previous.upTo === null) {
        throw new Error(`Tax "${normalizedName}" cannot define rates after an uncapped bracket.`);
      }
      if (current.upTo !== null && current.upTo <= previous.upTo) {
        throw new Error(`Tax "${normalizedName}" tax rate upper bounds must increase strictly.`);
      }
    }

    if (maximum !== undefined) {
      assertFiniteNumber(maximum, `Maximum tax for "${normalizedName}" must be finite.`);
      if (maximum < 0) {
        throw new Error(`Maximum tax for "${normalizedName}" cannot be negative.`);
      }
    }

    this.name = normalizedName;
    this.taxRates = normalizedRates;
    this.exclusions = exclusions.map((exclusion) => new TaxExclusion(exclusion));
    this.maximum = maximum ?? null;
  }

  calculateTax(gains: number): TaxComputationResult {
    assertFiniteNumber(gains, `Gains for tax "${this.name}" must be finite.`);

    const normalizedGains = Math.max(0, gains);
    const excludedGains = this.exclusions.reduce(
      (total, exclusion) => Math.min(normalizedGains, total + exclusion.getExcludedAmount(normalizedGains)),
      0
    );
    const taxableGains = Math.max(0, normalizedGains - excludedGains);
    const uncappedTax = calculateGraduatedTax(taxableGains, this.taxRates);

    return {
      taxName: this.name,
      gains: normalizedGains,
      excludedGains,
      taxableGains,
      tax: this.maximum === null ? uncappedTax : Math.min(uncappedTax, this.maximum),
    };
  }
}

export function createDefaultHouseholdTaxProfile(): HouseholdTaxProfileDefinition {
  return {
    filingStatus: "single",
    deductionMode: "standard",
    federalStandardDeduction: 15000,
    saltDeduction: 0,
    saltDeductionCap: 10000,
    otherItemizedDeductions: 0,
    stateTaxableIncomeAdjustment: 0,
    localTaxableIncomeAdjustment: 0,
    niitThreshold: 200000,
    federalOrdinaryTaxName: "Federal ordinary income",
    federalQualifiedTaxName: "Federal qualified dividends / long-term gains",
    stateTaxName: "New York State resident income tax",
    localTaxName: "New York City resident income tax",
    niitTaxName: "Federal NIIT",
  };
}

export function createDefaultNYCHouseholdTaxes(
  filingStatus: FilingStatus = "single"
): { profile: HouseholdTaxProfileDefinition; taxes: TaxDefinition[] } {
  return {
    profile: {
      ...createDefaultHouseholdTaxProfile(),
      filingStatus,
      federalStandardDeduction: getFederalStandardDeduction(filingStatus),
      niitThreshold: getNiitThreshold(filingStatus),
    },
    taxes: [
      {
        name: "Federal ordinary income",
        taxRates: getFederalOrdinaryRates(filingStatus),
      },
      {
        name: "Federal qualified dividends / long-term gains",
        taxRates: getFederalQualifiedRates(filingStatus),
      },
      {
        name: "New York State resident income tax",
        taxRates: getNewYorkStateRates(filingStatus),
      },
      {
        name: "New York City resident income tax",
        taxRates: getNewYorkCityRates(filingStatus),
      },
      {
        name: "Federal NIIT",
        taxRates: [{ rate: 0.038 }],
      },
    ],
  };
}

export function calculateTax(gains: number, taxes: readonly Tax[]): TaxComputationSummary {
  assertFiniteNumber(gains, "Gains must be finite.");

  const normalizedGains = Math.max(0, gains);
  const results = taxes.map((tax) => tax.calculateTax(normalizedGains));

  return {
    gains: normalizedGains,
    totalExcludedGains: results.reduce((total, result) => total + result.excludedGains, 0),
    totalTaxableGains: results.reduce((total, result) => total + result.taxableGains, 0),
    totalTax: results.reduce((total, result) => total + result.tax, 0),
    taxes: results,
  };
}

export function computeHouseholdTaxes(
  input: HouseholdTaxInput,
  profile: HouseholdTaxProfileDefinition,
  taxes: readonly Tax[]
): HouseholdTaxBreakdown {
  const taxesByName = new Map(taxes.map((tax) => [tax.name, tax]));
  const taxByName = new Map<string, number>();

  const wages = sanitizeAmount(input.wages);
  const ordinaryIncome = sanitizeAmount(input.ordinaryIncome);
  const qualifiedDividends = sanitizeAmount(input.qualifiedDividends);
  const shortTermCapitalGains = sanitizeAmount(input.shortTermCapitalGains);
  const longTermCapitalGains = sanitizeAmount(input.longTermCapitalGains);
  const deductibleExpenses = sanitizeAmount(input.deductibleExpenses);
  const federalDeduction = getFederalDeduction(profile);

  const ordinaryTaxBase = Math.max(0, wages + ordinaryIncome + shortTermCapitalGains - deductibleExpenses);
  const preferentialIncome = Math.max(0, qualifiedDividends + longTermCapitalGains);
  const federalTaxableIncome = Math.max(0, ordinaryTaxBase + preferentialIncome - federalDeduction);
  const federalPreferentialIncome = Math.min(preferentialIncome, federalTaxableIncome);
  const federalOrdinaryTaxableIncome = Math.max(0, federalTaxableIncome - federalPreferentialIncome);
  const stateTaxableIncome = Math.max(
    0,
    ordinaryTaxBase + preferentialIncome - sanitizeAmount(profile.stateTaxableIncomeAdjustment)
  );
  const localTaxableIncome = Math.max(
    0,
    ordinaryTaxBase + preferentialIncome - sanitizeAmount(profile.localTaxableIncomeAdjustment)
  );
  const netInvestmentIncome = Math.max(
    0,
    ordinaryIncome + qualifiedDividends + shortTermCapitalGains + longTermCapitalGains - deductibleExpenses
  );
  const modifiedAdjustedGrossIncome = Math.max(
    0,
    wages + ordinaryIncome + qualifiedDividends + shortTermCapitalGains + longTermCapitalGains - deductibleExpenses
  );
  const niitIncomeAboveThreshold = Math.max(0, modifiedAdjustedGrossIncome - sanitizeAmount(profile.niitThreshold));
  const niitTaxableIncome = Math.max(0, Math.min(netInvestmentIncome, niitIncomeAboveThreshold));

  applyNamedTax(taxByName, taxesByName, profile.federalOrdinaryTaxName, federalOrdinaryTaxableIncome);
  applyPreferentialTax(
    taxByName,
    taxesByName,
    profile.federalQualifiedTaxName,
    federalOrdinaryTaxableIncome,
    federalPreferentialIncome
  );
  applyNamedTax(taxByName, taxesByName, profile.stateTaxName, stateTaxableIncome);
  applyNamedTax(taxByName, taxesByName, profile.localTaxName, localTaxableIncome);
  applyNamedTax(taxByName, taxesByName, profile.niitTaxName, niitTaxableIncome);

  return {
    federalOrdinaryTaxableIncome,
    federalPreferentialIncome,
    federalTaxableIncome,
    stateTaxableIncome,
    localTaxableIncome,
    modifiedAdjustedGrossIncome,
    netInvestmentIncome,
    niitIncomeAboveThreshold,
    niitTaxableIncome,
    deductionUsed: federalDeduction,
    totalTax: [...taxByName.values()].reduce((total, value) => total + value, 0),
    taxByName,
  };
}

function sanitizeAmount(value: number): number {
  assertFiniteNumber(value, "Tax inputs must be finite.");
  return Math.max(0, value);
}

function getFederalDeduction(profile: HouseholdTaxProfileDefinition): number {
  if (profile.deductionMode === "standard") {
    return sanitizeAmount(profile.federalStandardDeduction);
  }

  return Math.max(
    0,
    Math.min(sanitizeAmount(profile.saltDeduction), sanitizeAmount(profile.saltDeductionCap)) +
      sanitizeAmount(profile.otherItemizedDeductions)
  );
}

function applyNamedTax(
  taxByName: Map<string, number>,
  taxesByName: ReadonlyMap<string, Tax>,
  taxName: string,
  amount: number
): void {
  const normalizedTaxName = taxName.trim();
  if (!normalizedTaxName) {
    return;
  }

  const tax = taxesByName.get(normalizedTaxName);
  if (!tax) {
    throw new Error(`Unknown household tax "${normalizedTaxName}".`);
  }

  taxByName.set(normalizedTaxName, tax.calculateTax(amount).tax);
}

function applyPreferentialTax(
  taxByName: Map<string, number>,
  taxesByName: ReadonlyMap<string, Tax>,
  taxName: string,
  ordinaryTaxableIncome: number,
  preferentialIncome: number
): void {
  const normalizedTaxName = taxName.trim();
  if (!normalizedTaxName) {
    return;
  }

  const tax = taxesByName.get(normalizedTaxName);
  if (!tax) {
    throw new Error(`Unknown household tax "${normalizedTaxName}".`);
  }

  taxByName.set(
    normalizedTaxName,
    calculatePreferentialTax(ordinaryTaxableIncome, preferentialIncome, tax)
  );
}

function calculatePreferentialTax(
  ordinaryTaxableIncome: number,
  preferentialIncome: number,
  tax: Tax
): number {
  let remainingPreferentialIncome = Math.max(0, preferentialIncome);
  let currentIncome = Math.max(0, ordinaryTaxableIncome);
  let totalTax = 0;

  for (const taxRate of tax.taxRates) {
    if (remainingPreferentialIncome <= 0) {
      break;
    }

    const bracketWidth =
      taxRate.upTo === null ? remainingPreferentialIncome : Math.max(0, taxRate.upTo - currentIncome);
    const taxableAmount = Math.min(remainingPreferentialIncome, bracketWidth);
    totalTax += taxableAmount * taxRate.rate;
    remainingPreferentialIncome -= taxableAmount;
    if (taxRate.upTo !== null) {
      currentIncome = Math.max(currentIncome, taxRate.upTo);
    }
  }

  return tax.maximum === null ? totalTax : Math.min(totalTax, tax.maximum);
}

function calculateGraduatedTax(gains: number, taxRates: readonly TaxRate[]): number {
  let remainingGains = gains;
  let previousUpperBound = 0;
  let totalTax = 0;

  for (const taxRate of taxRates) {
    if (remainingGains <= 0) {
      break;
    }

    const bracketWidth =
      taxRate.upTo === null ? remainingGains : Math.max(0, taxRate.upTo - previousUpperBound);
    const taxableAmount = Math.min(remainingGains, bracketWidth);
    totalTax += taxableAmount * taxRate.rate;
    remainingGains -= taxableAmount;

    if (taxRate.upTo !== null) {
      previousUpperBound = taxRate.upTo;
    }
  }

  return totalTax;
}

function getFederalStandardDeduction(filingStatus: FilingStatus): number {
  switch (filingStatus) {
    case "married-filing-jointly":
      return 30000;
    case "married-filing-separately":
      return 15000;
    case "head-of-household":
      return 22500;
    case "single":
    default:
      return 15000;
  }
}

function getNiitThreshold(filingStatus: FilingStatus): number {
  switch (filingStatus) {
    case "married-filing-jointly":
      return 250000;
    case "married-filing-separately":
      return 125000;
    case "head-of-household":
    case "single":
    default:
      return 200000;
  }
}

function getFederalOrdinaryRates(filingStatus: FilingStatus): TaxRateDefinition[] {
  switch (filingStatus) {
    case "married-filing-jointly":
      return [
        { rate: 0.1, upTo: 23850 },
        { rate: 0.12, upTo: 96950 },
        { rate: 0.22, upTo: 206700 },
        { rate: 0.24, upTo: 394600 },
        { rate: 0.32, upTo: 501050 },
        { rate: 0.35, upTo: 751600 },
        { rate: 0.37 },
      ];
    case "married-filing-separately":
      return [
        { rate: 0.1, upTo: 11925 },
        { rate: 0.12, upTo: 48475 },
        { rate: 0.22, upTo: 103350 },
        { rate: 0.24, upTo: 197300 },
        { rate: 0.32, upTo: 250525 },
        { rate: 0.35, upTo: 375800 },
        { rate: 0.37 },
      ];
    case "head-of-household":
      return [
        { rate: 0.1, upTo: 17000 },
        { rate: 0.12, upTo: 64850 },
        { rate: 0.22, upTo: 103350 },
        { rate: 0.24, upTo: 197300 },
        { rate: 0.32, upTo: 250500 },
        { rate: 0.35, upTo: 626350 },
        { rate: 0.37 },
      ];
    case "single":
    default:
      return [
        { rate: 0.1, upTo: 11925 },
        { rate: 0.12, upTo: 48475 },
        { rate: 0.22, upTo: 103350 },
        { rate: 0.24, upTo: 197300 },
        { rate: 0.32, upTo: 250525 },
        { rate: 0.35, upTo: 626350 },
        { rate: 0.37 },
      ];
  }
}

function getFederalQualifiedRates(filingStatus: FilingStatus): TaxRateDefinition[] {
  switch (filingStatus) {
    case "married-filing-jointly":
      return [
        { rate: 0, upTo: 96700 },
        { rate: 0.15, upTo: 600050 },
        { rate: 0.2 },
      ];
    case "married-filing-separately":
      return [
        { rate: 0, upTo: 48350 },
        { rate: 0.15, upTo: 300000 },
        { rate: 0.2 },
      ];
    case "head-of-household":
      return [
        { rate: 0, upTo: 64750 },
        { rate: 0.15, upTo: 566700 },
        { rate: 0.2 },
      ];
    case "single":
    default:
      return [
        { rate: 0, upTo: 48350 },
        { rate: 0.15, upTo: 533400 },
        { rate: 0.2 },
      ];
  }
}

function getNewYorkStateRates(_filingStatus: FilingStatus): TaxRateDefinition[] {
  return [
    { rate: 0.04, upTo: 8500 },
    { rate: 0.045, upTo: 11700 },
    { rate: 0.0525, upTo: 13900 },
    { rate: 0.055, upTo: 21400 },
    { rate: 0.06, upTo: 80650 },
    { rate: 0.0685, upTo: 215400 },
    { rate: 0.0965, upTo: 1077550 },
    { rate: 0.103, upTo: 5000000 },
    { rate: 0.109, upTo: 25000000 },
    { rate: 0.109 },
  ];
}

function getNewYorkCityRates(_filingStatus: FilingStatus): TaxRateDefinition[] {
  return [
    { rate: 0.03078, upTo: 12000 },
    { rate: 0.03762, upTo: 25000 },
    { rate: 0.03819, upTo: 50000 },
    { rate: 0.03876 },
  ];
}
