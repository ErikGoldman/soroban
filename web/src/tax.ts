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
  taxableIncomeMultiplier?: number;
}

export type FilingStatus = "individual" | "married-couple-jointly";

export type LegacyFilingStatus =
  | "single"
  | "married-filing-jointly"
  | "married-filing-separately"
  | "head-of-household";

export type PersistedFilingStatus = FilingStatus | LegacyFilingStatus;

export type DeductionMode = "standard" | "itemized";

export interface HouseholdTaxProfileDefinition {
  filingStatus: FilingStatus;
  deductionMode: DeductionMode;
  federalStandardDeduction: number;
  otherSaltTaxesPaid: number;
  saltDeductionBaseCap: number;
  saltDeductionFloorCap: number;
  saltDeductionPhaseoutThreshold: number;
  saltDeductionPhaseoutRate: number;
  otherItemizedDeductions: number;
  stateTaxableIncomeAdjustment: number;
  localTaxableIncomeAdjustment: number;
  niitThreshold: number;
  federalOrdinaryTaxName: string;
  federalQualifiedTaxName: string;
  stateTaxName: string;
  stateCapitalGainsTaxName: string;
  localTaxName: string;
  niitTaxName: string;
}

export interface TaxPresetOption {
  id: string;
  label: string;
}

export interface HouseholdTaxInput {
  wages: number;
  ordinaryIncome: number;
  qualifiedDividends: number;
  shortTermCapitalGains: number;
  longTermCapitalGains: number;
  capitalLossDeduction?: number;
  taxExemptIncome: number;
  stateLocalExemptIncome: number;
  tripleExemptIncome: number;
  deductibleExpenses: number;
  saltTaxesPaid?: number;
  homeMortgageInterestPaid?: number;
  homeMortgageAverageBalance?: number;
  homeMortgageInterestDebtLimit?: number;
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
  stateOrdinaryTaxableIncome: number;
  stateCapitalGainsTaxableIncome: number;
  localTaxableIncome: number;
  modifiedAdjustedGrossIncome: number;
  netInvestmentIncome: number;
  niitIncomeAboveThreshold: number;
  niitTaxableIncome: number;
  deductionUsed: number;
  deductibleMortgageInterest?: number;
  saltDeductionUsed?: number;
  otherItemizedDeductionsUsed?: number;
  totalTax: number;
  taxByName: Map<string, number>;
}

export interface NetCapitalGainSummary {
  shortTermCapitalGains: number;
  longTermCapitalGains: number;
  shortTermCapitalLossCarryforward: number;
  longTermCapitalLossCarryforward: number;
  ordinaryIncomeDeduction: number;
}

export function normalizeFilingStatus(filingStatus: PersistedFilingStatus | undefined): FilingStatus {
  switch (filingStatus) {
    case "married-couple-jointly":
    case "married-filing-jointly":
      return "married-couple-jointly";
    case "individual":
    case "single":
    case "married-filing-separately":
    case "head-of-household":
    default:
      return "individual";
  }
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
  readonly taxableIncomeMultiplier: number;

  constructor({ name, taxRates, exclusions = [], maximum, taxableIncomeMultiplier = 1 }: TaxDefinition) {
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
    assertFiniteNumber(taxableIncomeMultiplier, `Taxable income multiplier for "${normalizedName}" must be finite.`);
    if (taxableIncomeMultiplier < 0) {
      throw new Error(`Taxable income multiplier for "${normalizedName}" cannot be negative.`);
    }

    this.name = normalizedName;
    this.taxRates = normalizedRates;
    this.exclusions = exclusions.map((exclusion) => new TaxExclusion(exclusion));
    this.maximum = maximum ?? null;
    this.taxableIncomeMultiplier = taxableIncomeMultiplier;
  }

  calculateTax(gains: number): TaxComputationResult {
    assertFiniteNumber(gains, `Gains for tax "${this.name}" must be finite.`);

    const normalizedGains = Math.max(0, gains);
    const excludedGains = this.exclusions.reduce(
      (total, exclusion) => Math.min(normalizedGains, total + exclusion.getExcludedAmount(normalizedGains)),
      0
    );
    const taxableGains = Math.max(0, normalizedGains - excludedGains) * this.taxableIncomeMultiplier;
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
    filingStatus: "individual",
    deductionMode: "standard",
    federalStandardDeduction: 15000,
    otherSaltTaxesPaid: 0,
    saltDeductionBaseCap: 40000,
    saltDeductionFloorCap: 10000,
    saltDeductionPhaseoutThreshold: 500000,
    saltDeductionPhaseoutRate: 0.3,
    otherItemizedDeductions: 0,
    stateTaxableIncomeAdjustment: 0,
    localTaxableIncomeAdjustment: 0,
    niitThreshold: 200000,
    federalOrdinaryTaxName: "Federal ordinary income",
    federalQualifiedTaxName: "Federal qualified dividends / long-term gains",
    stateTaxName: "New York State resident income tax",
    stateCapitalGainsTaxName: "New York State long-term capital gains",
    localTaxName: "New York City resident income tax",
    niitTaxName: "Federal NIIT",
  };
}

export function createDefaultNYCHouseholdTaxes(
  filingStatus: FilingStatus = "individual"
): { profile: HouseholdTaxProfileDefinition; taxes: TaxDefinition[] } {
  return {
    profile: {
      ...createDefaultHouseholdTaxProfile(),
      filingStatus,
      federalStandardDeduction: getFederalStandardDeduction(filingStatus),
      ...getSaltDeductionDefaults(filingStatus),
      stateTaxableIncomeAdjustment: filingStatus === "married-couple-jointly" ? 16050 : 8000,
      localTaxableIncomeAdjustment: filingStatus === "married-couple-jointly" ? 16050 : 8000,
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
        name: "New York State long-term capital gains",
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

export function getStateHouseholdTaxPresetOptions(): readonly TaxPresetOption[] {
  return STATE_HOUSEHOLD_TAX_PRESETS.map(({ id, label }) => ({ id, label }));
}

export function isStateHouseholdTaxPresetId(id: string): boolean {
  return STATE_HOUSEHOLD_TAX_PRESETS.some((preset) => preset.id === id);
}

export function createStateHouseholdTaxes(
  presetId: string,
  filingStatus: FilingStatus = "individual"
): { profile: HouseholdTaxProfileDefinition; taxes: TaxDefinition[] } {
  const preset = STATE_HOUSEHOLD_TAX_PRESETS.find((candidate) => candidate.id === presetId);
  if (!preset) {
    throw new Error(`Unknown household tax preset "${presetId}".`);
  }

  const stateRates = parseTaxRatePreset(
    filingStatus === "married-couple-jointly" ? preset.joint : preset.single
  );
  const stateCapitalGainsRates = parseTaxRatePreset(
    filingStatus === "married-couple-jointly"
      ? preset.jointCapitalGains ?? preset.joint
      : preset.singleCapitalGains ?? preset.single
  );
  const stateTaxName = stateRates.length > 0 ? `${preset.label} state income tax` : "";
  const stateCapitalGainsTaxName =
    stateCapitalGainsRates.length > 0 ? `${preset.label} long-term capital gains` : "";

  return {
    profile: {
      ...createDefaultHouseholdTaxProfile(),
      filingStatus,
      federalStandardDeduction: getFederalStandardDeduction(filingStatus),
      ...getSaltDeductionDefaults(filingStatus),
      stateTaxableIncomeAdjustment:
        filingStatus === "married-couple-jointly" ? preset.jointAdjustment : preset.singleAdjustment,
      localTaxableIncomeAdjustment: 0,
      niitThreshold: getNiitThreshold(filingStatus),
      stateTaxName,
      stateCapitalGainsTaxName,
      localTaxName: "",
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
      ...(stateRates.length > 0
        ? [
            {
              name: stateTaxName,
              taxRates: stateRates,
            },
          ]
        : []),
      ...(stateCapitalGainsRates.length > 0
        ? [
            {
              name: stateCapitalGainsTaxName,
              taxRates: stateCapitalGainsRates,
              ...(preset.capitalGainsExclusion
                ? { exclusions: [{ name: "Capital gains exclusion", amount: preset.capitalGainsExclusion }] }
                : {}),
              ...((preset.capitalGainsTaxableIncomeMultiplier ?? 1) !== 1
                ? { taxableIncomeMultiplier: preset.capitalGainsTaxableIncomeMultiplier }
                : {}),
            },
          ]
        : []),
      {
        name: "Federal NIIT",
        taxRates: [{ rate: 0.038 }],
      },
    ],
  };
}

interface StateHouseholdTaxPreset {
  id: string;
  label: string;
  single: string;
  joint: string;
  singleCapitalGains?: string;
  jointCapitalGains?: string;
  singleAdjustment: number;
  jointAdjustment: number;
  capitalGainsTaxableIncomeMultiplier?: number;
  capitalGainsExclusion?: number;
}

// 2026 state individual income tax rates and standard deduction / personal exemption amounts.
const STATE_HOUSEHOLD_TAX_PRESETS: readonly StateHouseholdTaxPreset[] = [
  { id: "alabama", label: "Alabama", single: "0.02:500,0.04:3000,0.05", joint: "0.02:1000,0.04:6000,0.05", singleAdjustment: 4500, jointAdjustment: 11500 },
  { id: "alaska", label: "Alaska", single: "", joint: "", singleAdjustment: 0, jointAdjustment: 0 },
  { id: "arizona", label: "Arizona", single: "0.025", joint: "0.025", singleAdjustment: 8350, jointAdjustment: 16700, capitalGainsTaxableIncomeMultiplier: 0.75 },
  { id: "arkansas", label: "Arkansas", single: "0.02:4600,0.039", joint: "0.02:4600,0.039", singleAdjustment: 2470, jointAdjustment: 4940, capitalGainsTaxableIncomeMultiplier: 0.5 },
  { id: "california", label: "California", single: "0.01:11079,0.02:26264,0.04:41452,0.06:57542,0.08:72724,0.093:371479,0.103:445771,0.113:742953,0.123:1000000,0.133", joint: "0.01:22158,0.02:52528,0.04:82904,0.06:115084,0.08:145448,0.093:742958,0.103:891542,0.113:1000000,0.123:1485906,0.133", singleAdjustment: 5540, jointAdjustment: 11080 },
  { id: "colorado", label: "Colorado", single: "0.044", joint: "0.044", singleAdjustment: 16100, jointAdjustment: 32200 },
  { id: "connecticut", label: "Connecticut", single: "0.02:10000,0.045:50000,0.055:100000,0.06:200000,0.065:250000,0.069:500000,0.0699", joint: "0.02:20000,0.045:100000,0.055:200000,0.06:400000,0.065:500000,0.069:1000000,0.0699", singleAdjustment: 15000, jointAdjustment: 24000 },
  { id: "delaware", label: "Delaware", single: "0.022:5000,0.039:10000,0.048:20000,0.052:25000,0.0555:60000,0.066", joint: "0.022:5000,0.039:10000,0.048:20000,0.052:25000,0.0555:60000,0.066", singleAdjustment: 3250, jointAdjustment: 6500 },
  { id: "florida", label: "Florida", single: "", joint: "", singleAdjustment: 0, jointAdjustment: 0 },
  { id: "georgia", label: "Georgia", single: "0.0519", joint: "0.0519", singleAdjustment: 12000, jointAdjustment: 24000 },
  { id: "hawaii", label: "Hawaii", single: "0.014:9600,0.032:14400,0.055:19200,0.064:24000,0.068:36000,0.072:48000,0.076:125000,0.079:175000,0.0825:225000,0.09:275000,0.1:325000,0.11", joint: "0.014:19200,0.032:28800,0.055:38400,0.064:48000,0.068:72000,0.072:96000,0.076:250000,0.079:350000,0.0825:450000,0.09:550000,0.1:650000,0.11", singleAdjustment: 5544, jointAdjustment: 11088, singleCapitalGains: "0.0725", jointCapitalGains: "0.0725" },
  { id: "idaho", label: "Idaho", single: "0.053", joint: "0.053", singleAdjustment: 16100, jointAdjustment: 32200 },
  { id: "illinois", label: "Illinois", single: "0.0495", joint: "0.0495", singleAdjustment: 2925, jointAdjustment: 5850 },
  { id: "indiana", label: "Indiana", single: "0.0295", joint: "0.0295", singleAdjustment: 1000, jointAdjustment: 2000 },
  { id: "iowa", label: "Iowa", single: "0.038", joint: "0.038", singleAdjustment: 16100, jointAdjustment: 32200 },
  { id: "kansas", label: "Kansas", single: "0.052:23000,0.0558", joint: "0.052:46000,0.0558", singleAdjustment: 12765, jointAdjustment: 26560 },
  { id: "kentucky", label: "Kentucky", single: "0.035", joint: "0.035", singleAdjustment: 3360, jointAdjustment: 3360 },
  { id: "louisiana", label: "Louisiana", single: "0.03", joint: "0.03", singleAdjustment: 12875, jointAdjustment: 25750 },
  { id: "maine", label: "Maine", single: "0.058:27399,0.0675:64849,0.0715", joint: "0.058:54849,0.0675:129749,0.0715", singleAdjustment: 13650, jointAdjustment: 27300 },
  { id: "maryland", label: "Maryland", single: "0.02:1000,0.03:2000,0.04:3000,0.0475:100000,0.05:125000,0.0525:150000,0.055:250000,0.0575:500000,0.0625:1000000,0.065", joint: "0.02:1000,0.03:2000,0.04:3000,0.0475:150000,0.05:175000,0.0525:225000,0.055:300000,0.0575:600000,0.0625:1200000,0.065", singleAdjustment: 6550, jointAdjustment: 13100 },
  { id: "massachusetts", label: "Massachusetts", single: "0.05:1083150,0.09", joint: "0.05:1083150,0.09", singleAdjustment: 4400, jointAdjustment: 8800 },
  { id: "michigan", label: "Michigan", single: "0.0425", joint: "0.0425", singleAdjustment: 5900, jointAdjustment: 11800 },
  { id: "minnesota", label: "Minnesota", single: "0.0535:33310,0.068:109430,0.0785:203150,0.0985", joint: "0.0535:48700,0.068:193480,0.0785:337930,0.0985", singleAdjustment: 15300, jointAdjustment: 30600 },
  { id: "mississippi", label: "Mississippi", single: "0.04", joint: "0.04", singleAdjustment: 8300, jointAdjustment: 16600 },
  { id: "missouri", label: "Missouri", single: "0.02:2696,0.025:4044,0.03:5392,0.035:6740,0.04:8088,0.045:9436,0.047", joint: "0.02:2696,0.025:4044,0.03:5392,0.035:6740,0.04:8088,0.045:9436,0.047", singleAdjustment: 16100, jointAdjustment: 32200, singleCapitalGains: "", jointCapitalGains: "" },
  { id: "montana", label: "Montana", single: "0.047:47500,0.0565", joint: "0.047:95000,0.0565", singleAdjustment: 16100, jointAdjustment: 32200, capitalGainsTaxableIncomeMultiplier: 0.7 },
  { id: "nebraska", label: "Nebraska", single: "0.0246:4130,0.0351:24760,0.0455", joint: "0.0246:8250,0.0351:49530,0.0455", singleAdjustment: 8850, jointAdjustment: 17700 },
  { id: "nevada", label: "Nevada", single: "", joint: "", singleAdjustment: 0, jointAdjustment: 0 },
  { id: "new-hampshire", label: "New Hampshire", single: "", joint: "", singleAdjustment: 0, jointAdjustment: 0 },
  { id: "new-jersey", label: "New Jersey", single: "0.014:20000,0.0175:35000,0.035:40000,0.0553:75000,0.0637:500000,0.0897:1000000,0.1075", joint: "0.014:20000,0.0175:50000,0.0245:70000,0.035:80000,0.0553:150000,0.0637:500000,0.0897:1000000,0.1075", singleAdjustment: 1000, jointAdjustment: 2000 },
  { id: "new-mexico", label: "New Mexico", single: "0.015:5500,0.032:16500,0.043:33500,0.047:66500,0.049:210000,0.059", joint: "0.015:8000,0.032:25000,0.043:50000,0.047:100000,0.049:315000,0.059", singleAdjustment: 16100, jointAdjustment: 32200, capitalGainsTaxableIncomeMultiplier: 0.6 },
  { id: "new-york", label: "New York", single: "0.039:8500,0.044:11700,0.0515:13900,0.054:80650,0.059:215400,0.0685:1077550,0.0965:5000000,0.103:25000000,0.109", joint: "0.039:17150,0.044:23600,0.0515:27900,0.054:161550,0.059:323200,0.0685:2155350,0.0965:5000000,0.103:25000000,0.109", singleAdjustment: 8000, jointAdjustment: 16050 },
  { id: "north-carolina", label: "North Carolina", single: "0.0399", joint: "0.0399", singleAdjustment: 12750, jointAdjustment: 25500 },
  { id: "north-dakota", label: "North Dakota", single: "0.0195:244825,0.025", joint: "0.0195:298075,0.025", singleAdjustment: 16100, jointAdjustment: 32200, capitalGainsTaxableIncomeMultiplier: 0.6 },
  { id: "ohio", label: "Ohio", single: "0.0275", joint: "0.0275", singleAdjustment: 2400, jointAdjustment: 4800 },
  { id: "oklahoma", label: "Oklahoma", single: "0.025:4900,0.035:7200,0.045", joint: "0.025:9800,0.035:14400,0.045", singleAdjustment: 7350, jointAdjustment: 14700 },
  { id: "oregon", label: "Oregon", single: "0.0475:4550,0.0675:11400,0.0875:125000,0.099", joint: "0.0475:9100,0.0675:22800,0.0875:250000,0.099", singleAdjustment: 2910, jointAdjustment: 5820 },
  { id: "pennsylvania", label: "Pennsylvania", single: "0.0307", joint: "0.0307", singleAdjustment: 0, jointAdjustment: 0 },
  { id: "rhode-island", label: "Rhode Island", single: "0.0375:82050,0.0475:186450,0.0599", joint: "0.0375:82050,0.0475:186450,0.0599", singleAdjustment: 16450, jointAdjustment: 32900 },
  { id: "south-carolina", label: "South Carolina", single: "0:3640,0.03:18230,0.06", joint: "0:3640,0.03:18230,0.06", singleAdjustment: 8350, jointAdjustment: 16700, capitalGainsTaxableIncomeMultiplier: 0.56 },
  { id: "south-dakota", label: "South Dakota", single: "", joint: "", singleAdjustment: 0, jointAdjustment: 0 },
  { id: "tennessee", label: "Tennessee", single: "", joint: "", singleAdjustment: 0, jointAdjustment: 0 },
  { id: "texas", label: "Texas", single: "", joint: "", singleAdjustment: 0, jointAdjustment: 0 },
  { id: "utah", label: "Utah", single: "0.045", joint: "0.045", singleAdjustment: 0, jointAdjustment: 0 },
  { id: "vermont", label: "Vermont", single: "0.0335:49400,0.066:119700,0.076:249700,0.0875", joint: "0.0335:82500,0.066:199450,0.076:304000,0.0875", singleAdjustment: 12950, jointAdjustment: 25900, capitalGainsTaxableIncomeMultiplier: 0.6 },
  { id: "virginia", label: "Virginia", single: "0.02:3000,0.03:5000,0.05:17000,0.0575", joint: "0.02:3000,0.03:5000,0.05:17000,0.0575", singleAdjustment: 9680, jointAdjustment: 19360 },
  { id: "washington", label: "Washington", single: "", joint: "", singleCapitalGains: "0.07:1000000,0.099", jointCapitalGains: "0.07:1000000,0.099", singleAdjustment: 0, jointAdjustment: 0, capitalGainsExclusion: 278000 },
  { id: "west-virginia", label: "West Virginia", single: "0.0222:10000,0.0296:25000,0.0333:40000,0.0444:60000,0.0482", joint: "0.0222:10000,0.0296:25000,0.0333:40000,0.0444:60000,0.0482", singleAdjustment: 2000, jointAdjustment: 4000 },
  { id: "wisconsin", label: "Wisconsin", single: "0.035:15110,0.044:51950,0.053:332720,0.0765", joint: "0.035:20150,0.044:69260,0.053:443630,0.0765", singleAdjustment: 14660, jointAdjustment: 27240, capitalGainsTaxableIncomeMultiplier: 0.7 },
  { id: "wyoming", label: "Wyoming", single: "", joint: "", singleAdjustment: 0, jointAdjustment: 0 },
  { id: "district-of-columbia", label: "District of Columbia", single: "0.04:10000,0.06:40000,0.065:60000,0.085:250000,0.0925:500000,0.0975:1000000,0.1075", joint: "0.04:10000,0.06:40000,0.065:60000,0.085:250000,0.0925:500000,0.0975:1000000,0.1075", singleAdjustment: 16100, jointAdjustment: 32200 },
];

function parseTaxRatePreset(preset: string): TaxRateDefinition[] {
  if (!preset) {
    return [];
  }

  return preset.split(",").map((entry) => {
    const [rate, upTo] = entry.split(":");
    return upTo === undefined ? { rate: Number(rate) } : { rate: Number(rate), upTo: Number(upTo) };
  });
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
  const { shortTermCapitalGains, longTermCapitalGains, ordinaryIncomeDeduction } = summarizeNetCapitalGainAmounts(
    sanitizeSignedAmount(input.shortTermCapitalGains),
    sanitizeSignedAmount(input.longTermCapitalGains),
    profile.filingStatus
  );
  const capitalLossDeduction = Math.max(ordinaryIncomeDeduction, sanitizeAmount(input.capitalLossDeduction));
  const taxExemptIncome = sanitizeAmount(input.taxExemptIncome);
  const stateLocalExemptIncome = sanitizeAmount(input.stateLocalExemptIncome);
  const deductibleExpenses = sanitizeAmount(input.deductibleExpenses);
  const preferentialIncome = Math.max(0, qualifiedDividends + longTermCapitalGains);
  const adjustedGrossIncome =
    wages +
    ordinaryIncome +
    stateLocalExemptIncome +
    qualifiedDividends +
    shortTermCapitalGains +
    longTermCapitalGains -
    capitalLossDeduction;
  const saltDeductionUsed = getSaltDeduction(
    profile,
    sanitizeAmount(input.saltTaxesPaid) + sanitizeAmount(profile.otherSaltTaxesPaid),
    adjustedGrossIncome
  );
  const deductibleMortgageInterest = calculateDeductibleMortgageInterest({
    interestPaid: sanitizeAmount(input.homeMortgageInterestPaid),
    averageBalance: sanitizeAmount(input.homeMortgageAverageBalance),
    debtLimit: sanitizeAmount(input.homeMortgageInterestDebtLimit),
  });
  const otherItemizedDeductionsUsed = sanitizeAmount(profile.otherItemizedDeductions);
  const federalDeduction = getFederalDeduction(
    profile,
    saltDeductionUsed,
    deductibleMortgageInterest,
    otherItemizedDeductionsUsed
  );
  const ordinaryTaxBase = Math.max(
    0,
    wages + ordinaryIncome + stateLocalExemptIncome + shortTermCapitalGains - deductibleExpenses - capitalLossDeduction
  );
  const federalTaxableIncome = Math.max(0, ordinaryTaxBase + preferentialIncome - federalDeduction);
  const federalPreferentialIncome = Math.min(preferentialIncome, federalTaxableIncome);
  const federalOrdinaryTaxableIncome = Math.max(0, federalTaxableIncome - federalPreferentialIncome);
  const stateOrdinaryIncomeBeforeAdjustment = Math.max(
    0,
    wages +
      ordinaryIncome +
      shortTermCapitalGains +
      qualifiedDividends +
      taxExemptIncome -
      deductibleExpenses -
      capitalLossDeduction
  );
  const stateTaxableIncomeAdjustment = sanitizeAmount(profile.stateTaxableIncomeAdjustment);
  const stateOrdinaryTaxableIncome = Math.max(0, stateOrdinaryIncomeBeforeAdjustment - stateTaxableIncomeAdjustment);
  const stateCapitalGainsTaxableIncome = Math.max(
    0,
    longTermCapitalGains - Math.max(0, stateTaxableIncomeAdjustment - stateOrdinaryIncomeBeforeAdjustment)
  );
  const stateTaxableIncome = stateOrdinaryTaxableIncome + stateCapitalGainsTaxableIncome;
  const localTaxableIncome = Math.max(
    0,
    wages +
      ordinaryIncome +
      shortTermCapitalGains +
      preferentialIncome +
      taxExemptIncome -
      deductibleExpenses -
      capitalLossDeduction -
      sanitizeAmount(profile.localTaxableIncomeAdjustment)
  );
  const netInvestmentIncome = Math.max(
    0,
    ordinaryIncome +
      stateLocalExemptIncome +
      qualifiedDividends +
      shortTermCapitalGains +
      longTermCapitalGains -
      deductibleExpenses
  );
  const modifiedAdjustedGrossIncome = Math.max(
    0,
    wages +
      ordinaryIncome +
      stateLocalExemptIncome +
      qualifiedDividends +
      shortTermCapitalGains +
      longTermCapitalGains -
      capitalLossDeduction -
      deductibleExpenses
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
  applyNamedTax(taxByName, taxesByName, profile.stateTaxName, stateOrdinaryTaxableIncome);
  applyPreferentialTax(
    taxByName,
    taxesByName,
    profile.stateCapitalGainsTaxName,
    stateOrdinaryTaxableIncome,
    stateCapitalGainsTaxableIncome
  );
  applyNamedTax(taxByName, taxesByName, profile.localTaxName, localTaxableIncome);
  applyNamedTax(taxByName, taxesByName, profile.niitTaxName, niitTaxableIncome);

  return {
    federalOrdinaryTaxableIncome,
    federalPreferentialIncome,
    federalTaxableIncome,
    stateTaxableIncome,
    stateOrdinaryTaxableIncome,
    stateCapitalGainsTaxableIncome,
    localTaxableIncome,
    modifiedAdjustedGrossIncome,
    netInvestmentIncome,
    niitIncomeAboveThreshold,
    niitTaxableIncome,
    deductionUsed: federalDeduction,
    deductibleMortgageInterest,
    saltDeductionUsed,
    otherItemizedDeductionsUsed,
    totalTax: [...taxByName.values()].reduce((total, value) => total + value, 0),
    taxByName,
  };
}

function sanitizeAmount(value: number | undefined): number {
  const normalizedValue = value ?? 0;
  assertFiniteNumber(normalizedValue, "Tax inputs must be finite.");
  return Math.max(0, normalizedValue);
}

function sanitizeSignedAmount(value: number | undefined): number {
  const normalizedValue = value ?? 0;
  assertFiniteNumber(normalizedValue, "Tax inputs must be finite.");
  return normalizedValue;
}

export function summarizeNetCapitalGainAmounts(
  shortTermCapitalGains: number,
  longTermCapitalGains: number,
  filingStatus: FilingStatus = "individual"
): NetCapitalGainSummary {
  assertFiniteNumber(shortTermCapitalGains, "Tax inputs must be finite.");
  assertFiniteNumber(longTermCapitalGains, "Tax inputs must be finite.");

  let netShortTermCapitalGains = shortTermCapitalGains;
  let netLongTermCapitalGains = longTermCapitalGains;

  if (netShortTermCapitalGains > 0 && netLongTermCapitalGains < 0) {
    const offsetAmount = Math.min(netShortTermCapitalGains, Math.abs(netLongTermCapitalGains));
    netShortTermCapitalGains -= offsetAmount;
    netLongTermCapitalGains += offsetAmount;
  } else if (netShortTermCapitalGains < 0 && netLongTermCapitalGains > 0) {
    const offsetAmount = Math.min(Math.abs(netShortTermCapitalGains), netLongTermCapitalGains);
    netShortTermCapitalGains += offsetAmount;
    netLongTermCapitalGains -= offsetAmount;
  }

  const shortTermCapitalLossCarryforward = Math.max(0, -netShortTermCapitalGains);
  const longTermCapitalLossCarryforward = Math.max(0, -netLongTermCapitalGains);
  const capitalLossDeductionLimit = 3000;
  let remainingOrdinaryIncomeDeduction = Math.min(
    capitalLossDeductionLimit,
    shortTermCapitalLossCarryforward + longTermCapitalLossCarryforward
  );
  const shortTermLossAfterDeduction = Math.max(0, shortTermCapitalLossCarryforward - remainingOrdinaryIncomeDeduction);
  remainingOrdinaryIncomeDeduction = Math.max(0, remainingOrdinaryIncomeDeduction - shortTermCapitalLossCarryforward);
  const longTermLossAfterDeduction = Math.max(0, longTermCapitalLossCarryforward - remainingOrdinaryIncomeDeduction);

  return {
    shortTermCapitalGains: Math.max(0, netShortTermCapitalGains),
    longTermCapitalGains: Math.max(0, netLongTermCapitalGains),
    shortTermCapitalLossCarryforward: shortTermLossAfterDeduction,
    longTermCapitalLossCarryforward: longTermLossAfterDeduction,
    ordinaryIncomeDeduction: Math.min(
      capitalLossDeductionLimit,
      shortTermCapitalLossCarryforward + longTermCapitalLossCarryforward
    ),
  };
}

function getFederalDeduction(
  profile: HouseholdTaxProfileDefinition,
  saltDeductionUsed: number,
  deductibleMortgageInterest: number,
  otherItemizedDeductionsUsed: number
): number {
  if (profile.deductionMode === "standard") {
    return sanitizeAmount(profile.federalStandardDeduction);
  }

  return Math.max(0, saltDeductionUsed + deductibleMortgageInterest + otherItemizedDeductionsUsed);
}

function calculateDeductibleMortgageInterest({
  interestPaid,
  averageBalance,
  debtLimit,
}: {
  interestPaid: number;
  averageBalance: number;
  debtLimit: number;
}): number {
  if (interestPaid <= 0 || averageBalance <= 0 || debtLimit <= 0) {
    return 0;
  }

  return interestPaid * Math.min(1, debtLimit / averageBalance);
}

function getSaltDeduction(
  profile: HouseholdTaxProfileDefinition,
  saltTaxesPaid: number,
  adjustedGrossIncome: number
): number {
  const baseCap = sanitizeAmount(profile.saltDeductionBaseCap);
  const floorCap = sanitizeAmount(profile.saltDeductionFloorCap);
  const threshold = sanitizeAmount(profile.saltDeductionPhaseoutThreshold);
  const phaseoutRate = sanitizeAmount(profile.saltDeductionPhaseoutRate);
  const phasedCap = Math.max(floorCap, baseCap - Math.max(0, adjustedGrossIncome - threshold) * phaseoutRate);

  return Math.max(0, Math.min(saltTaxesPaid, phasedCap));
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
  const normalizedPreferentialIncome = Math.max(0, preferentialIncome);
  const excludedPreferentialIncome = tax.exclusions.reduce(
    (total, exclusion) => Math.min(normalizedPreferentialIncome, total + exclusion.getExcludedAmount(normalizedPreferentialIncome)),
    0
  );
  let remainingPreferentialIncome =
    Math.max(0, normalizedPreferentialIncome - excludedPreferentialIncome) * tax.taxableIncomeMultiplier;
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
    case "married-couple-jointly":
      return 32200;
    case "individual":
    default:
      return 16100;
  }
}

function getNiitThreshold(filingStatus: FilingStatus): number {
  switch (filingStatus) {
    case "married-couple-jointly":
      return 250000;
    case "individual":
    default:
      return 200000;
  }
}

function getSaltDeductionDefaults(filingStatus: FilingStatus): {
  saltDeductionBaseCap: number;
  saltDeductionFloorCap: number;
  saltDeductionPhaseoutThreshold: number;
  saltDeductionPhaseoutRate: number;
} {
  switch (filingStatus) {
    case "married-couple-jointly":
    case "individual":
    default:
      return {
        saltDeductionBaseCap: 40000,
        saltDeductionFloorCap: 10000,
        saltDeductionPhaseoutThreshold: 500000,
        saltDeductionPhaseoutRate: 0.3,
      };
  }
}

function getFederalOrdinaryRates(filingStatus: FilingStatus): TaxRateDefinition[] {
  switch (filingStatus) {
    case "married-couple-jointly":
      return [
        { rate: 0.1, upTo: 24800 },
        { rate: 0.12, upTo: 100800 },
        { rate: 0.22, upTo: 211400 },
        { rate: 0.24, upTo: 403550 },
        { rate: 0.32, upTo: 512450 },
        { rate: 0.35, upTo: 768700 },
        { rate: 0.37 },
      ];
    case "individual":
    default:
      return [
        { rate: 0.1, upTo: 12400 },
        { rate: 0.12, upTo: 50400 },
        { rate: 0.22, upTo: 105700 },
        { rate: 0.24, upTo: 201775 },
        { rate: 0.32, upTo: 256225 },
        { rate: 0.35, upTo: 640600 },
        { rate: 0.37 },
      ];
  }
}

function getFederalQualifiedRates(filingStatus: FilingStatus): TaxRateDefinition[] {
  switch (filingStatus) {
    case "married-couple-jointly":
      return [
        { rate: 0, upTo: 98900 },
        { rate: 0.15, upTo: 613700 },
        { rate: 0.2 },
      ];
    case "individual":
    default:
      return [
        { rate: 0, upTo: 49450 },
        { rate: 0.15, upTo: 545500 },
        { rate: 0.2 },
      ];
  }
}

function getNewYorkStateRates(_filingStatus: FilingStatus): TaxRateDefinition[] {
  return parseTaxRatePreset(
    _filingStatus === "married-couple-jointly"
      ? "0.039:17150,0.044:23600,0.0515:27900,0.054:161550,0.059:323200,0.0685:2155350,0.0965:5000000,0.103:25000000,0.109"
      : "0.039:8500,0.044:11700,0.0515:13900,0.054:80650,0.059:215400,0.0685:1077550,0.0965:5000000,0.103:25000000,0.109"
  );
}

function getNewYorkCityRates(_filingStatus: FilingStatus): TaxRateDefinition[] {
  return [
    { rate: 0.03078, upTo: 12000 },
    { rate: 0.03762, upTo: 25000 },
    { rate: 0.03819, upTo: 50000 },
    { rate: 0.03876 },
  ];
}
