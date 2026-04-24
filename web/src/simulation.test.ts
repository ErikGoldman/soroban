import { describe, expect, it } from "vitest";

import {
  buildVariableSweepValues,
  buildSimulationDetails,
  buildSimulationScenarios,
  buildSimulationScenariosFromAggregates,
  selectRepresentativeSimulationScenario,
  type SimulationDetailScenario,
  type SimulationYearRow,
} from "./simulation.js";
import { getSimulationSellProportion, shouldAvoidEarlyWithdrawalPenalty } from "./simulation-input.js";
import { createDefaultHouseholdTaxProfile, Tax } from "./tax.js";

const ANNUAL_VOLATILITY_10_PERCENT = 10;

function createDeterministicNormals(values: number[]): () => number {
  let index = 0;

  return () => {
    const value = values[index];
    index += 1;
    return value ?? 0;
  };
}

function createEmptyHouseholdTaxInput() {
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

function createYearlyPlan(
  label: string,
  flows: Array<{
    name: string;
    amount: number;
    type?: "income" | "expense";
    inflationAdjusted?: boolean;
    taxTreatment?:
      | "wages"
      | "ordinary-income"
      | "qualified-dividends"
      | "short-term-capital-gains"
      | "long-term-capital-gains"
      | "tax-exempt-income"
      | "deductible-expense"
      | "nondeductible-expense";
  }>,
  year?: number
) {
  return {
    ...(year === undefined ? {} : { year }),
    label,
    flows: flows.map((flow) => ({
      name: flow.name,
      type: flow.type ?? (flow.amount < 0 ? "expense" : "income"),
      taxTreatment: flow.taxTreatment ?? (flow.amount < 0 ? "nondeductible-expense" : "ordinary-income"),
      inflationAdjusted: flow.inflationAdjusted ?? false,
      baseSignedAmount: flow.amount,
    })),
  };
}

function oneYearFromAnnualReturn(returnRate: number): number {
  return 100 * (1 + returnRate);
}

describe("buildSimulationScenarios", () => {
  it("builds 10 inclusive variable sweep values by default", () => {
    expect(buildVariableSweepValues(100, 190)).toEqual([100, 110, 120, 130, 140, 150, 160, 170, 180, 190]);
  });

  it("selects percentile scenarios from a single simulation run", () => {
    const scenarios = buildSimulationScenarios({
      attempts: 20,
      horizonYears: 1,
      yearlySnapshots: [
        {
          label: "2027",
          netAmount: 0,
          totalExpenses: 0,
          flowAmounts: new Map(),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          name: "Stocks",
          startingValue: 100,
          expectedReturn: 0,
          volatility: ANNUAL_VOLATILITY_10_PERCENT,
          sellProportion: 0,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([
        0, 0.1, 0.2, 0.3, 0.4,
        0.5, 0.6, 0.7, 0.8, 0.9,
        1.0, 1.1, 1.2, 1.3, 1.4,
        1.5, 1.6, 1.7, 1.8, 1.9,
      ]),
    });

    expect(scenarios.get(5)?.finalTotalAssets).toBeCloseTo(oneYearFromAnnualReturn(0), 6);
    expect(scenarios.get(50)?.finalTotalAssets).toBeCloseTo(oneYearFromAnnualReturn(0.09), 6);
    expect(scenarios.get(90)?.finalTotalAssets).toBeCloseTo(oneYearFromAnnualReturn(0.17), 6);
  });

  it("applies one annual draw to the full year", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      yearlySnapshots: [
        {
          label: "2027",
          netAmount: 0,
          totalExpenses: 0,
          flowAmounts: new Map(),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          name: "Stocks",
          startingValue: 100,
          expectedReturn: 0,
          volatility: ANNUAL_VOLATILITY_10_PERCENT,
          sellProportion: 0,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([1]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.assetValues.get("Stocks")).toBeCloseTo(110, 6);
    expect(row?.assetReturns.get("Stocks")?.amount).toBeCloseTo(10, 6);
    expect(row?.assetReturns.get("Stocks")?.percentage).toBeCloseTo(10, 6);
  });

  it("preserves fixed inflation compounding semantics in fixed mode", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 3,
      yearlyPlans: [
        createYearlyPlan("2027", [{ name: "Rent", amount: -100, inflationAdjusted: true }], 2027),
        createYearlyPlan("2028", [{ name: "Rent", amount: -100, inflationAdjusted: true }], 2028),
        createYearlyPlan("2029", [{ name: "Rent", amount: -100, inflationAdjusted: true }], 2029),
      ],
      assets: [
        {
          name: "Cash",
          startingValue: 400,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
      ],
      assetCorrelations: [],
      inflation: {
        mode: "fixed",
        fixedRate: 0.03,
      },
      nextStandardNormal: createDeterministicNormals([0, 0, 0]),
    });

    const [yearOne, yearTwo, yearThree] = scenarios[0]?.rows ?? [];
    expect(yearOne?.flowTotals.get("Rent")).toBeCloseTo(-100, 6);
    expect(yearTwo?.flowTotals.get("Rent")).toBeCloseTo(-103, 6);
    expect(yearThree?.flowTotals.get("Rent")).toBeCloseTo(-106.09, 6);
    expect(yearOne?.inflationRateApplied).toBeCloseTo(0.03, 6);
    expect(yearOne?.inflationRegime).toBe("fixed");
    expect(yearTwo?.inflationRegime).toBe("fixed");
    expect(yearThree?.inflationRegime).toBe("fixed");
  });

  it("switches inflation regimes yearly and compounds only opted-in expenses", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 3,
      yearlyPlans: [
        createYearlyPlan(
          "2027",
          [
            { name: "Rent", amount: -100, inflationAdjusted: true },
            { name: "Insurance", amount: -50, inflationAdjusted: false },
            { name: "Salary", amount: 80, type: "income", taxTreatment: "wages" },
          ],
          2027
        ),
        createYearlyPlan(
          "2028",
          [
            { name: "Rent", amount: -100, inflationAdjusted: true },
            { name: "Insurance", amount: -50, inflationAdjusted: false },
            { name: "Salary", amount: 80, type: "income", taxTreatment: "wages" },
          ],
          2028
        ),
        createYearlyPlan(
          "2029",
          [
            { name: "Rent", amount: -100, inflationAdjusted: true },
            { name: "Insurance", amount: -50, inflationAdjusted: false },
            { name: "Salary", amount: 80, type: "income", taxTreatment: "wages" },
          ],
          2029
        ),
      ],
      assets: [
        {
          name: "Cash",
          startingValue: 500,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
      ],
      assetCorrelations: [],
      inflation: {
        mode: "regime-switching",
        lowRegime: {
          averageRate: 0.02,
          volatility: 0,
        },
        highRegime: {
          averageRate: 0.08,
          volatility: 0,
        },
        stayLowProbability: 0.9,
        stayHighProbability: 0.6,
      },
      nextRandom: (() => {
        const values = [0.1, 0.95, 0.2];
        let index = 0;
        return () => values[index++] ?? 0;
      })(),
      nextStandardNormal: createDeterministicNormals([0, 0, 0]),
    });

    const [yearOne, yearTwo, yearThree] = scenarios[0]?.rows ?? [];
    expect(yearOne?.inflationRegime).toBe("high");
    expect(yearTwo?.inflationRegime).toBe("low");
    expect(yearThree?.inflationRegime).toBe("low");
    expect(yearOne?.inflationRateApplied).toBeCloseTo(0.08, 6);
    expect(yearTwo?.inflationRateApplied).toBeCloseTo(0.02, 6);
    expect(yearThree?.inflationRateApplied).toBeCloseTo(0.02, 6);
    expect(yearOne?.flowTotals.get("Rent")).toBeCloseTo(-100, 6);
    expect(yearTwo?.flowTotals.get("Rent")).toBeCloseTo(-102, 6);
    expect(yearThree?.flowTotals.get("Rent")).toBeCloseTo(-104.04, 6);
    expect(yearOne?.flowTotals.get("Insurance")).toBeCloseTo(-50, 6);
    expect(yearTwo?.flowTotals.get("Insurance")).toBeCloseTo(-50, 6);
    expect(yearThree?.flowTotals.get("Insurance")).toBeCloseTo(-50, 6);
    expect(yearTwo?.flowTotals.get("Salary")).toBeCloseTo(80, 6);
    expect(yearThree?.flowTotals.get("Salary")).toBeCloseTo(80, 6);
    expect(yearThree?.householdTaxInput.wages).toBeCloseTo(80, 6);
    expect(yearThree?.totalExpenses).toBeCloseTo(154.04, 6);
  });

  it("caps IRA and Roth IRA contributions to the shared 2026 limit", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      currentAge: 35,
      yearlyPlans: [
        createYearlyPlan(
          "2027",
          [{ name: "Salary", amount: 50_000, type: "income", taxTreatment: "wages" }],
          2027
        ),
      ],
      assets: [
        {
          name: "IRA",
          assetType: "ira",
          startingValue: 0,
          desiredAnnualContribution: 5_000,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
        {
          name: "Roth IRA",
          assetType: "roth-ira",
          startingValue: 0,
          desiredAnnualContribution: 5_000,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0, 0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.assetValues.get("IRA")).toBeCloseTo(5_000, 6);
    expect(row?.assetValues.get("Roth IRA")).toBeCloseTo(2_500, 6);
    expect(row?.flowTotals.get("IRA contribution")).toBeCloseTo(5_000, 6);
    expect(row?.flowTotals.get("Roth IRA contribution")).toBeCloseTo(2_500, 6);
  });

  it("applies the 401k age 60 to 63 catch-up limit", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      currentAge: 60,
      yearlyPlans: [
        createYearlyPlan(
          "2027",
          [{ name: "Salary", amount: 100_000, type: "income", taxTreatment: "wages" }],
          2027
        ),
      ],
      assets: [
        {
          name: "Work 401k",
          assetType: "401k",
          startingValue: 0,
          desiredAnnualContribution: 40_000,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.assetValues.get("Work 401k")).toBeCloseTo(35_750, 6);
    expect(row?.flowTotals.get("Work 401k contribution")).toBeCloseTo(35_750, 6);
  });

  it("applies 401k contribution limits at age boundaries", () => {
    const cases = [
      { age: 49, expectedLimit: 24_500 },
      { age: 50, expectedLimit: 32_500 },
      { age: 59, expectedLimit: 32_500 },
      { age: 60, expectedLimit: 35_750 },
      { age: 63, expectedLimit: 35_750 },
      { age: 64, expectedLimit: 32_500 },
    ];

    for (const { age, expectedLimit } of cases) {
      const scenarios = buildSimulationDetails({
        attempts: 1,
        horizonYears: 1,
        currentAge: age,
        yearlyPlans: [
          createYearlyPlan(
            "2027",
            [{ name: "Salary", amount: 100_000, type: "income", taxTreatment: "wages" }],
            2027
          ),
        ],
        assets: [
          {
            name: "Work 401k",
            assetType: "401k",
            startingValue: 0,
            desiredAnnualContribution: 40_000,
            expectedReturn: 0,
            volatility: 0,
            sellProportion: 1,
          },
        ],
        assetCorrelations: [],
        nextStandardNormal: createDeterministicNormals([0]),
      });

      expect(scenarios[0]?.rows[0]?.assetValues.get("Work 401k")).toBeCloseTo(expectedLimit, 6);
    }
  });

  it("applies IRA and Roth IRA shared contribution limits at age boundaries", () => {
    const cases = [
      { age: 49, expectedRoth: 7_500 },
      { age: 50, expectedRoth: 8_600 },
    ];

    for (const { age, expectedRoth } of cases) {
      const scenarios = buildSimulationDetails({
        attempts: 1,
        horizonYears: 1,
        currentAge: age,
        yearlyPlans: [
          createYearlyPlan(
            "2027",
            [{ name: "Salary", amount: 100_000, type: "income", taxTreatment: "wages" }],
            2027
          ),
        ],
        assets: [
          {
            name: "Roth IRA",
            assetType: "roth-ira",
            startingValue: 0,
            desiredAnnualContribution: 10_000,
            expectedReturn: 0,
            volatility: 0,
            sellProportion: 1,
          },
        ],
        assetCorrelations: [],
        nextStandardNormal: createDeterministicNormals([0]),
      });

      expect(scenarios[0]?.rows[0]?.assetValues.get("Roth IRA")).toBeCloseTo(expectedRoth, 6);
    }
  });

  it("keeps retirement contributions below the cap when desired contribution is lower", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      currentAge: 35,
      yearlyPlans: [
        createYearlyPlan(
          "2027",
          [{ name: "Salary", amount: 100_000, type: "income", taxTreatment: "wages" }],
          2027
        ),
      ],
      assets: [
        {
          name: "Roth IRA",
          assetType: "roth-ira",
          startingValue: 0,
          desiredAnnualContribution: 3_000,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0]),
    });

    expect(scenarios[0]?.rows[0]?.assetValues.get("Roth IRA")).toBeCloseTo(3_000, 6);
  });

  it("ages into retirement catch-up limits across simulation years", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 2,
      currentAge: 49,
      yearlyPlans: [
        createYearlyPlan(
          "2027",
          [{ name: "Salary", amount: 100_000, type: "income", taxTreatment: "wages" }],
          2027
        ),
        createYearlyPlan(
          "2028",
          [{ name: "Salary", amount: 100_000, type: "income", taxTreatment: "wages" }],
          2028
        ),
      ],
      assets: [
        {
          name: "Work 401k",
          assetType: "401k",
          startingValue: 0,
          desiredAnnualContribution: 40_000,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0, 0]),
    });

    const [yearOne, yearTwo] = scenarios[0]?.rows ?? [];
    expect(yearOne?.assetValues.get("Work 401k")).toBeCloseTo(24_500, 6);
    expect(yearTwo?.assetValues.get("Work 401k")).toBeCloseTo(57_000, 6);
    expect(yearTwo?.flowTotals.get("Work 401k contribution")).toBeCloseTo(32_500, 6);
  });

  it("shares the 401k cap across multiple 401k assets in asset order", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      currentAge: 35,
      yearlyPlans: [
        createYearlyPlan(
          "2027",
          [{ name: "Salary", amount: 100_000, type: "income", taxTreatment: "wages" }],
          2027
        ),
      ],
      assets: [
        {
          name: "Primary 401k",
          assetType: "401k",
          startingValue: 0,
          desiredAnnualContribution: 20_000,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
        {
          name: "Side 401k",
          assetType: "401k",
          startingValue: 0,
          desiredAnnualContribution: 20_000,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0, 0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.assetValues.get("Primary 401k")).toBeCloseTo(20_000, 6);
    expect(row?.assetValues.get("Side 401k")).toBeCloseTo(4_500, 6);
  });

  it("uses one earned-compensation ceiling across IRA, Roth IRA, and 401k contributions", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      currentAge: 35,
      yearlyPlans: [
        createYearlyPlan(
          "2027",
          [{ name: "Salary", amount: 30_000, type: "income", taxTreatment: "wages" }],
          2027
        ),
      ],
      assets: [
        {
          name: "Roth IRA",
          assetType: "roth-ira",
          startingValue: 0,
          desiredAnnualContribution: 5_000,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
        {
          name: "IRA",
          assetType: "ira",
          startingValue: 0,
          desiredAnnualContribution: 5_000,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
        {
          name: "Work 401k",
          assetType: "401k",
          startingValue: 0,
          desiredAnnualContribution: 24_500,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0, 0, 0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.assetValues.get("Roth IRA")).toBeCloseTo(5_000, 6);
    expect(row?.assetValues.get("IRA")).toBeCloseTo(2_500, 6);
    expect(row?.assetValues.get("Work 401k")).toBeCloseTo(22_500, 6);
  });

  it("does not fund retirement contributions without wage income", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      currentAge: 35,
      yearlyPlans: [
        createYearlyPlan(
          "2027",
          [{ name: "Consulting", amount: 50_000, type: "income", taxTreatment: "ordinary-income" }],
          2027
        ),
      ],
      assets: [
        {
          name: "Work 401k",
          assetType: "401k",
          startingValue: 0,
          desiredAnnualContribution: 24_500,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.assetValues.get("Work 401k")).toBeCloseTo(0, 6);
    expect(row?.flowTotals.get("Work 401k contribution")).toBeUndefined();
  });

  it("limits retirement contributions by earned compensation and available surplus", () => {
    const compensationLimited = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      currentAge: 35,
      yearlyPlans: [
        createYearlyPlan(
          "2027",
          [
            { name: "Salary", amount: 10_000, type: "income", taxTreatment: "wages" },
            { name: "Bonus", amount: 30_000, type: "income", taxTreatment: "ordinary-income" },
          ],
          2027
        ),
      ],
      assets: [
        {
          name: "Work 401k",
          assetType: "401k",
          startingValue: 0,
          desiredAnnualContribution: 24_500,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0]),
    });
    expect(compensationLimited[0]?.rows[0]?.assetValues.get("Work 401k")).toBeCloseTo(10_000, 6);

    const surplusLimited = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      currentAge: 35,
      yearlyPlans: [
        createYearlyPlan(
          "2027",
          [
            { name: "Salary", amount: 50_000, type: "income", taxTreatment: "wages" },
            { name: "Rent", amount: -45_000, type: "expense" },
          ],
          2027
        ),
      ],
      assets: [
        {
          name: "Work 401k",
          assetType: "401k",
          startingValue: 0,
          desiredAnnualContribution: 24_500,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0]),
    });
    expect(surplusLimited[0]?.rows[0]?.assetValues.get("Work 401k")).toBeCloseTo(5_000, 6);
  });

  it("limits retirement contributions by post-tax surplus", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      currentAge: 35,
      yearlyPlans: [
        createYearlyPlan(
          "2027",
          [
            { name: "Salary", amount: 50_000, type: "income", taxTreatment: "wages" },
            { name: "Rent", amount: -20_000, type: "expense" },
          ],
          2027
        ),
      ],
      assets: [
        {
          name: "Work 401k",
          assetType: "401k",
          startingValue: 0,
          desiredAnnualContribution: 24_500,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
      ],
      taxes: [
        new Tax({ name: "Federal ordinary income", taxRates: [{ rate: 0.2 }] }),
        new Tax({ name: "Federal qualified dividends / long-term gains", taxRates: [{ rate: 0.1 }] }),
      ],
      householdTaxProfile: {
        ...createDefaultHouseholdTaxProfile(),
        federalStandardDeduction: 0,
        federalQualifiedTaxName: "",
        stateTaxName: "",
        stateCapitalGainsTaxName: "",
        localTaxName: "",
        niitTaxName: "",
      },
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.taxAmount).toBeCloseTo(10_000, 6);
    expect(row?.assetValues.get("Work 401k")).toBeCloseTo(20_000, 6);
  });

  it("reinvests surplus above retirement caps into non-retirement assets", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      currentAge: 35,
      yearlyPlans: [
        createYearlyPlan(
          "2027",
          [{ name: "Salary", amount: 50_000, type: "income", taxTreatment: "wages" }],
          2027
        ),
      ],
      assets: [
        {
          name: "Work 401k",
          assetType: "401k",
          startingValue: 0,
          desiredAnnualContribution: 24_500,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
        {
          name: "Brokerage",
          assetType: "us-stocks",
          startingValue: 0,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0, 0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.assetValues.get("Work 401k")).toBeCloseTo(24_500, 6);
    expect(row?.assetValues.get("Brokerage")).toBeCloseTo(25_500, 6);
  });

  it("starts from the stationary distribution when sampling the initial inflation regime", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      yearlyPlans: [createYearlyPlan("2027", [{ name: "Rent", amount: -100, inflationAdjusted: true }], 2027)],
      assets: [
        {
          name: "Cash",
          startingValue: 100,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
      ],
      assetCorrelations: [],
      inflation: {
        mode: "regime-switching",
        lowRegime: {
          averageRate: 0.02,
          volatility: 0,
        },
        highRegime: {
          averageRate: 0.08,
          volatility: 0,
        },
        stayLowProbability: 0.9,
        stayHighProbability: 0.6,
      },
      nextRandom: () => 0.25,
      nextStandardNormal: createDeterministicNormals([0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.inflationRegime).toBe("low");
    expect(row?.inflationRateApplied).toBeCloseTo(0.02, 6);
    expect(row?.flowTotals.get("Rent")).toBeCloseTo(-100, 6);
  });

  it("samples yearly inflation from each regime average and volatility", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 3,
      yearlyPlans: [
        createYearlyPlan("2027", [{ name: "Rent", amount: -100, inflationAdjusted: true }], 2027),
        createYearlyPlan("2028", [{ name: "Rent", amount: -100, inflationAdjusted: true }], 2028),
        createYearlyPlan("2029", [{ name: "Rent", amount: -100, inflationAdjusted: true }], 2029),
      ],
      assets: [
        {
          name: "Cash",
          startingValue: 500,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
      ],
      assetCorrelations: [],
      inflation: {
        mode: "regime-switching",
        lowRegime: {
          averageRate: 0.02,
          volatility: 0.01,
        },
        highRegime: {
          averageRate: 0.08,
          volatility: 0.02,
        },
        stayLowProbability: 0.9,
        stayHighProbability: 0.6,
      },
      nextRandom: (() => {
        const values = [0.1, 0.95, 0.2];
        let index = 0;
        return () => values[index++] ?? 0;
      })(),
      nextStandardNormal: createDeterministicNormals([1, -2, 0, 0, 0, 0]),
    });

    const [yearOne, yearTwo, yearThree] = scenarios[0]?.rows ?? [];
    expect(yearOne?.inflationRegime).toBe("high");
    expect(yearTwo?.inflationRegime).toBe("low");
    expect(yearThree?.inflationRegime).toBe("low");
    expect(yearOne?.inflationRateApplied).toBeCloseTo(0.1, 6);
    expect(yearTwo?.inflationRateApplied).toBeCloseTo(0, 6);
    expect(yearThree?.inflationRateApplied).toBeCloseTo(0.02, 6);
    expect(yearOne?.flowTotals.get("Rent")).toBeCloseTo(-100, 6);
    expect(yearTwo?.flowTotals.get("Rent")).toBeCloseTo(-100, 6);
    expect(yearThree?.flowTotals.get("Rent")).toBeCloseTo(-102, 6);
  });

  it("starts home appreciation in year 2 and tracks market value separately from equity", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 2,
      yearlySnapshots: [
        {
          year: 2027,
          label: "2027",
          netAmount: 0,
          totalExpenses: 0,
          flowAmounts: new Map(),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
        {
          year: 2028,
          label: "2028",
          netAmount: 0,
          totalExpenses: 0,
          flowAmounts: new Map(),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          kind: "home",
          name: "Home",
          initialCost: 100,
          expectedReturn: 10,
          volatility: 0,
          cashPurchasePercent: 0.2,
          closingCostPercent: 0,
          mortgageType: "amortizing",
          mortgageRate: 0,
          mortgageTermYears: 30,
          monthlyNonTaxCosts: 0,
          propertyTaxRate: 0,
          purchaseYear: 2027,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0, 0]),
    });

    const [yearOne, yearTwo] = scenarios[0]?.rows ?? [];
    expect(yearOne?.flowTotals.get("Home return")).toBeUndefined();
    expect(yearOne?.assetReturns.get("Home")?.amount).toBeCloseTo(0, 6);
    expect(yearOne?.assetReturns.get("Home")?.percentage).toBeCloseTo(0, 6);
    expect(yearOne?.assetMarketValues?.get("Home")).toBeCloseTo(100, 6);
    expect(yearOne?.assetValues.get("Home")).toBeCloseTo(22.666666666666664, 6);
    expect(yearTwo?.assetReturns.get("Home")?.amount).toBeCloseTo(10, 6);
    expect(yearTwo?.assetReturns.get("Home")?.percentage).toBeCloseTo(10, 6);
    expect(yearTwo?.assetMarketValues?.get("Home")).toBeCloseTo(110, 6);
    expect(yearTwo?.assetValues.get("Home")).toBeCloseTo(35.33333333333333, 6);
  });

  it("treats home closing costs as a one-time purchase expense", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      yearlySnapshots: [
        {
          year: 2027,
          label: "2027",
          netAmount: 0,
          totalExpenses: 0,
          flowAmounts: new Map(),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          name: "Reserve",
          startingValue: 25000,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
        {
          kind: "home",
          name: "Home",
          initialCost: 100000,
          expectedReturn: 0,
          volatility: 0,
          cashPurchasePercent: 0.2,
          closingCostPercent: 0.03,
          mortgageType: "amortizing",
          mortgageRate: 0,
          mortgageTermYears: 30,
          monthlyNonTaxCosts: 0,
          propertyTaxRate: 0,
          purchaseYear: 2027,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0, 0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.flowTotals.get("Home down payment")).toBeCloseTo(-20000, 6);
    expect(row?.flowTotals.get("Home closing costs")).toBeCloseTo(-3000, 6);
    expect(row?.totalExpenses).toBeCloseTo(3000, 6);
  });

  it("initializes a past home purchase with a partially paid-down mortgage", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      yearlySnapshots: [
        {
          year: 2027,
          label: "2027",
          netAmount: 25000,
          totalExpenses: 0,
          flowAmounts: new Map([["Reserve", 25000]]),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          kind: "home",
          name: "Home",
          initialCost: 100000,
          expectedReturn: 0,
          volatility: 0,
          cashPurchasePercent: 0.2,
          closingCostPercent: 0.03,
          mortgageType: "amortizing",
          mortgageRate: 0,
          mortgageTermYears: 30,
          monthlyNonTaxCosts: 0,
          propertyTaxRate: 0,
          purchaseYear: 2026,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.flowTotals.get("Home down payment")).toBeUndefined();
    expect(row?.flowTotals.get("Home closing costs")).toBeUndefined();
    expect(row?.totalExpenses).toBeCloseTo(0, 6);
    expect(row?.assetValues.get("Home")).toBeCloseTo(25333.33333333333, 6);
  });

  it("carries forward reduced balances after a one-time first-year draw", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 2,
      yearlySnapshots: [
        {
          label: "2027",
          netAmount: -24,
          totalExpenses: 24,
          flowAmounts: new Map([["One-time expense", -24]]),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
        {
          label: "2028",
          netAmount: 0,
          totalExpenses: 0,
          flowAmounts: new Map(),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          name: "Portfolio",
          startingValue: 40,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0, 0]),
    });

    const firstYear = scenarios[0]?.rows[0];
    const secondYear = scenarios[0]?.rows[1];
    expect(firstYear?.assetValues.get("Portfolio")).toBeCloseTo(16, 6);
    expect(secondYear?.assetValues.get("Portfolio")).toBeCloseTo(16, 6);
  });

  it("saves positive cash flow when there are no user-created assets", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 2,
      yearlyPlans: [
        createYearlyPlan("2027", [{ name: "Salary", amount: 100, type: "income", taxTreatment: "wages" }], 2027),
        createYearlyPlan("2028", [{ name: "Salary", amount: 100, type: "income", taxTreatment: "wages" }], 2028),
      ],
      assets: [],
      assetCorrelations: [],
    });

    const [firstYear, secondYear] = scenarios[0]?.rows ?? [];
    expect(firstYear?.assetValues.get("Cash savings")).toBeCloseTo(100, 6);
    expect(firstYear?.totalAssets).toBeCloseTo(100, 6);
    expect(firstYear?.liquidAssets).toBeCloseTo(100, 6);
    expect(secondYear?.assetValues.get("Cash savings")).toBeCloseTo(200, 6);
    expect(secondYear?.totalAssets).toBeCloseTo(200, 6);
    expect(secondYear?.liquidAssets).toBeCloseTo(200, 6);
  });

  it("selects one representative run for the whole percentile path", () => {
    const targetRows: SimulationYearRow[] = [
      {
        yearNumber: 1,
        label: "2026",
        bankruptcyProbability: 0,
        depletionProbability: 0,
        totalAssets: 100,
      },
      {
        yearNumber: 2,
        label: "2027",
        bankruptcyProbability: 0,
        depletionProbability: 0,
        totalAssets: 90,
      },
    ];
    const detailScenarios: SimulationDetailScenario[] = [
      {
        rows: [
          {
            yearNumber: 1,
            label: "2026",
            inflationMode: "fixed",
            inflationRateApplied: 0,
            inflationRegime: "fixed",
            startingAssets: 100,
            endingAssets: 100,
            totalExpenses: 0,
            totalGains: 0,
            taxableGains: 0,
            taxAmount: 0,
            depleted: false,
            bankruptcyProbability: 0,
            depletionProbability: 0,
            householdTaxInput: createEmptyHouseholdTaxInput(),
            flowTotals: new Map(),
            assetValues: new Map(),
            assetReturns: new Map(),
            totalAssets: 100,
            taxBreakdown: {
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
              totalTax: 0,
              taxByName: new Map(),
            },
          },
          {
            yearNumber: 2,
            label: "2027",
            inflationMode: "fixed",
            inflationRateApplied: 0,
            inflationRegime: "fixed",
            startingAssets: 100,
            endingAssets: 90,
            totalExpenses: 0,
            totalGains: -10,
            taxableGains: 0,
            taxAmount: 0,
            depleted: false,
            bankruptcyProbability: 0,
            depletionProbability: 0,
            householdTaxInput: createEmptyHouseholdTaxInput(),
            flowTotals: new Map(),
            assetValues: new Map(),
            assetReturns: new Map(),
            totalAssets: 90,
            taxBreakdown: {
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
              totalTax: 0,
              taxByName: new Map(),
            },
          },
        ],
        finalTotalAssets: 90,
      },
      {
        rows: [
          {
            yearNumber: 1,
            label: "2026",
            inflationMode: "fixed",
            inflationRateApplied: 0,
            inflationRegime: "fixed",
            startingAssets: 100,
            endingAssets: 100,
            totalExpenses: 0,
            totalGains: 0,
            taxableGains: 0,
            taxAmount: 0,
            depleted: false,
            bankruptcyProbability: 0,
            depletionProbability: 0,
            householdTaxInput: createEmptyHouseholdTaxInput(),
            flowTotals: new Map(),
            assetValues: new Map(),
            assetReturns: new Map(),
            totalAssets: 100,
            taxBreakdown: {
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
              totalTax: 0,
              taxByName: new Map(),
            },
          },
          {
            yearNumber: 2,
            label: "2027",
            inflationMode: "fixed",
            inflationRateApplied: 0,
            inflationRegime: "fixed",
            startingAssets: 100,
            endingAssets: 40,
            totalExpenses: 0,
            totalGains: -60,
            taxableGains: 0,
            taxAmount: 0,
            depleted: false,
            bankruptcyProbability: 0,
            depletionProbability: 0,
            householdTaxInput: createEmptyHouseholdTaxInput(),
            flowTotals: new Map(),
            assetValues: new Map(),
            assetReturns: new Map(),
            totalAssets: 40,
            taxBreakdown: {
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
              totalTax: 0,
              taxByName: new Map(),
            },
          },
        ],
        finalTotalAssets: 40,
      },
    ];

    expect(selectRepresentativeSimulationScenario(detailScenarios, targetRows)).toBe(detailScenarios[0]);
  });

  it("computes household taxes from wages plus asset cash generation", () => {
    const profile = {
      ...createDefaultHouseholdTaxProfile(),
      federalStandardDeduction: 0,
      federalOrdinaryTaxName: "Federal ordinary income",
      federalQualifiedTaxName: "",
      stateTaxName: "",
      stateCapitalGainsTaxName: "",
      localTaxName: "",
      niitTaxName: "",
    };

    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      yearlySnapshots: [
        {
          label: "2027",
          netAmount: 10,
          totalExpenses: 0,
          flowAmounts: new Map([["Salary", 10]]),
          householdTaxInput: {
            ...createEmptyHouseholdTaxInput(),
            wages: 10,
          },
        },
      ],
      assets: [
        {
          name: "Bond fund",
          startingValue: 100,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 0,
          cashGeneration: {
            rate: 5,
            volatility: 0,
            taxTreatment: "ordinary-income",
          },
        },
      ],
      assetCorrelations: [],
      taxes: [new Tax({ name: "Federal ordinary income", taxRates: [{ rate: 0.2 }] })],
      householdTaxProfile: profile,
      nextStandardNormal: createDeterministicNormals([0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.taxAmount).toBeCloseTo(3, 6);
    expect(row?.taxBreakdown.federalOrdinaryTaxableIncome).toBeCloseTo(15, 6);
    expect(row?.flowTotals.get("Bond fund Cash generation 1")).toBeCloseTo(5, 6);
    expect(row?.flowTotals.get("Taxes paid")).toBeCloseTo(-3, 6);
    expect(row?.flowTotals.has("Federal ordinary income tax")).toBe(false);
    expect(row?.assetValues.get("Bond fund")).toBeCloseTo(112, 6);
  });

  it("taxes multiple cash generation streams on one asset separately", () => {
    const profile = {
      ...createDefaultHouseholdTaxProfile(),
      federalStandardDeduction: 0,
      federalOrdinaryTaxName: "Federal ordinary income",
      federalQualifiedTaxName: "Federal qualified dividends / long-term gains",
      stateTaxName: "",
      stateCapitalGainsTaxName: "",
      localTaxName: "",
      niitTaxName: "",
    };

    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      yearlySnapshots: [
        {
          label: "2027",
          netAmount: 0,
          totalExpenses: 0,
          flowAmounts: new Map(),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          name: "Dividend fund",
          startingValue: 100,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 0,
          cashGenerations: [
            {
              name: "Qualified dividends",
              rate: 2,
              volatility: 0,
              taxTreatment: "qualified-dividends",
            },
            {
              name: "Non-qualified dividends",
              rate: 3,
              volatility: 0,
              taxTreatment: "ordinary-income",
            },
          ],
        },
      ],
      assetCorrelations: [],
      taxes: [
        new Tax({ name: "Federal ordinary income", taxRates: [{ rate: 0.2 }] }),
        new Tax({ name: "Federal qualified dividends / long-term gains", taxRates: [{ rate: 0.1 }] }),
      ],
      householdTaxProfile: profile,
      nextStandardNormal: createDeterministicNormals([0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.flowTotals.get("Dividend fund Qualified dividends")).toBeCloseTo(2, 6);
    expect(row?.flowTotals.get("Dividend fund Non-qualified dividends")).toBeCloseTo(3, 6);
    expect(row?.flowTotals.get("Taxes paid")).toBeCloseTo(-0.8, 6);
    expect(row?.flowTotals.has("Federal ordinary income tax")).toBe(false);
    expect(row?.flowTotals.has("Federal qualified dividends / long-term gains tax")).toBe(false);
    expect(row?.taxBreakdown.federalPreferentialIncome).toBeCloseTo(2, 6);
    expect(row?.taxBreakdown.federalOrdinaryTaxableIncome).toBeCloseTo(3, 6);
    expect(row?.taxAmount).toBeCloseTo(0.8, 6);
  });

  it("does not adjust first-year bond cash generation by the inflation level alone", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      yearlySnapshots: [
        {
          label: "2027",
          netAmount: 0,
          totalExpenses: 0,
          flowAmounts: new Map(),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          name: "Bond fund",
          assetType: "federal-bonds",
          startingValue: 100,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 0,
          cashGeneration: {
            name: "Coupon",
            rate: 5,
            volatility: 0,
            inflationCorrelation: 1,
            taxTreatment: "not-taxable",
          },
        },
      ],
      assetCorrelations: [],
      inflation: {
        mode: "fixed",
        fixedRate: 0.04,
      },
      nextStandardNormal: createDeterministicNormals([0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.inflationRateApplied).toBeCloseTo(0.04, 6);
    expect(row?.flowTotals.get("Bond fund Coupon")).toBeCloseTo(5, 6);
    expect(row?.assetValues.get("Bond fund")).toBeCloseTo(105, 6);
  });

  it("adjusts cash generation by year-over-year inflation deltas", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 3,
      yearlyPlans: [
        createYearlyPlan("2027", [], 2027),
        createYearlyPlan("2028", [], 2028),
        createYearlyPlan("2029", [], 2029),
      ],
      assets: [
        {
          name: "Bond fund",
          assetType: "federal-bonds",
          startingValue: 100,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 0,
          cashGeneration: {
            name: "Coupon",
            rate: 5,
            volatility: 0,
            inflationCorrelation: 1,
            taxTreatment: "not-taxable",
          },
        },
      ],
      assetCorrelations: [],
      inflation: {
        mode: "regime-switching",
        lowRegime: {
          averageRate: 0.02,
          volatility: 0,
        },
        highRegime: {
          averageRate: 0.05,
          volatility: 0,
        },
        stayLowProbability: 0,
        stayHighProbability: 0,
      },
      nextRandom: (() => {
        const values = [0.1, 0.1, 0.1];
        let index = 0;
        return () => values[index++] ?? 0;
      })(),
      nextStandardNormal: createDeterministicNormals([0, 0, 0]),
    });

    const [yearOne, yearTwo, yearThree] = scenarios[0]?.rows ?? [];
    expect(yearOne?.inflationRateApplied).toBeCloseTo(0.05, 6);
    expect(yearTwo?.inflationRateApplied).toBeCloseTo(0.02, 6);
    expect(yearThree?.inflationRateApplied).toBeCloseTo(0.05, 6);
    expect(yearOne?.flowPercentages?.get("Bond fund Coupon")).toBeCloseTo(5, 6);
    expect(yearTwo?.flowPercentages?.get("Bond fund Coupon")).toBeCloseTo(2, 6);
    expect(yearThree?.flowPercentages?.get("Bond fund Coupon")).toBeCloseTo(8, 6);
    expect(yearOne?.flowTotals.get("Bond fund Coupon")).toBeCloseTo(5, 6);
    expect(yearTwo?.flowTotals.get("Bond fund Coupon")).toBeCloseTo(2.1, 6);
    expect(yearThree?.flowTotals.get("Bond fund Coupon")).toBeCloseTo(8.568, 6);
  });

  it("uses average basis to realize gains on asset sales", () => {
    const profile = {
      ...createDefaultHouseholdTaxProfile(),
      federalStandardDeduction: 0,
      federalOrdinaryTaxName: "",
      federalQualifiedTaxName: "Federal qualified dividends / long-term gains",
      stateTaxName: "",
      stateCapitalGainsTaxName: "",
      localTaxName: "",
      niitTaxName: "",
    };

    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      yearlySnapshots: [
        {
          label: "2027",
          netAmount: -20,
          totalExpenses: 20,
          flowAmounts: new Map(),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          name: "Stocks",
          startingValue: 100,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
          saleTax: {
            costBasis: 60,
            taxTreatment: "long-term-capital-gains",
          },
        },
      ],
      assetCorrelations: [],
      taxes: [new Tax({ name: "Federal qualified dividends / long-term gains", taxRates: [{ rate: 0.1 }] })],
      householdTaxProfile: profile,
      nextStandardNormal: createDeterministicNormals([0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.startingAssets).toBeCloseTo(100, 6);
    expect(row?.endingAssets).toBeCloseTo(79.166666752, 5);
    expect(row?.totalGains).toBeCloseTo(0, 5);
    expect(row?.taxableGains).toBeCloseTo(8.33333248, 6);
    expect(row?.taxAmount).toBeCloseTo(0.833333248, 6);
    expect(row?.flowTotals.get("Taxes paid")).toBeCloseTo(-0.833333248, 6);
    expect(row?.flowTotals.has("Federal qualified dividends / long-term gains tax")).toBe(false);
    expect(row?.flowTotals.get("Stocks sale proceeds")).toBeCloseTo(20.833333248, 5);
    expect(row?.flowTotals.get("Stocks realized gain")).toBeCloseTo(8.33333248, 6);
    expect(row?.assetValues.get("Stocks")).toBeCloseTo(79.166666752, 5);
  });

  it("uses starting value as cost basis when sale tax basis is omitted", () => {
    const profile = {
      ...createDefaultHouseholdTaxProfile(),
      federalStandardDeduction: 0,
      federalOrdinaryTaxName: "",
      federalQualifiedTaxName: "Federal qualified dividends / long-term gains",
      stateTaxName: "",
      stateCapitalGainsTaxName: "",
      localTaxName: "",
      niitTaxName: "",
    };

    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      yearlySnapshots: [
        {
          label: "2027",
          netAmount: -20,
          totalExpenses: 20,
          flowAmounts: new Map(),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          name: "Stocks",
          startingValue: 100,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
          saleTax: {
            taxTreatment: "long-term-capital-gains",
          },
        },
      ],
      assetCorrelations: [],
      taxes: [new Tax({ name: "Federal qualified dividends / long-term gains", taxRates: [{ rate: 0.1 }] })],
      householdTaxProfile: profile,
      nextStandardNormal: createDeterministicNormals([0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.taxableGains).toBeCloseTo(0, 6);
    expect(row?.taxAmount).toBeCloseTo(0, 6);
    expect(row?.flowTotals.get("Taxes paid")).toBeUndefined();
    expect(row?.flowTotals.get("Stocks realized gain")).toBeUndefined();
  });

  it("carries forward realized capital losses to offset realized gains in later years", () => {
    const profile = {
      ...createDefaultHouseholdTaxProfile(),
      federalStandardDeduction: 0,
      federalOrdinaryTaxName: "",
      federalQualifiedTaxName: "Federal qualified dividends / long-term gains",
      stateTaxName: "",
      stateCapitalGainsTaxName: "",
      localTaxName: "",
      niitTaxName: "",
    };

    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 3,
      yearlySnapshots: [
        {
          label: "2027",
          netAmount: 0,
          totalExpenses: 0,
          flowAmounts: new Map(),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
        {
          label: "2028",
          netAmount: -50,
          totalExpenses: 50,
          flowAmounts: new Map(),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
        {
          label: "2029",
          netAmount: -100,
          totalExpenses: 100,
          flowAmounts: new Map(),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          name: "Winner",
          startingValue: 100,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 0,
          saleTax: {
            costBasis: 50,
            taxTreatment: "long-term-capital-gains",
          },
        },
        {
          name: "Loser",
          startingValue: 100,
          expectedReturn: 0,
          volatility: 50,
          sellProportion: 1,
          saleTax: {
            costBasis: 100,
            taxTreatment: "long-term-capital-gains",
          },
        },
      ],
      assetCorrelations: [],
      taxes: [new Tax({ name: "Federal qualified dividends / long-term gains", taxRates: [{ rate: 0.1 }] })],
      householdTaxProfile: profile,
      nextStandardNormal: createDeterministicNormals([0, -1, 0, 0, 0, 0]),
    });

    const lossYear = scenarios[0]?.rows[1];
    const gainYear = scenarios[0]?.rows[2];
    expect(lossYear?.startingAssets).toBeCloseTo(150, 6);
    expect(lossYear?.taxableGains).toBeCloseTo(-50, 6);
    expect(lossYear?.taxAmount).toBeCloseTo(0, 6);
    expect(lossYear?.householdTaxInput.longTermCapitalGains).toBeCloseTo(0, 6);
    expect(lossYear?.householdTaxInput.capitalLossDeduction).toBeCloseTo(50, 6);
    expect(lossYear?.flowTotals.get("Loser realized gain")).toBeCloseTo(-50, 6);
    expect(lossYear?.flowTotals.get("Taxes paid")).toBeUndefined();
    expect(lossYear?.assetValues.get("Winner")).toBeCloseTo(100, 6);
    expect(lossYear?.assetValues.get("Loser")).toBeCloseTo(0, 6);

    expect(gainYear?.startingAssets).toBeCloseTo(100, 6);
    expect(gainYear?.taxableGains).toBeCloseTo(50, 6);
    expect(gainYear?.taxAmount).toBeCloseTo(5, 6);
    expect(gainYear?.householdTaxInput.longTermCapitalGains).toBeCloseTo(50, 6);
    expect(gainYear?.householdTaxInput.capitalLossDeduction).toBeCloseTo(0, 6);
    expect(gainYear?.taxBreakdown.federalPreferentialIncome).toBeCloseTo(50, 6);
    expect(gainYear?.flowTotals.get("Winner realized gain")).toBeCloseTo(50, 6);
    expect(gainYear?.flowTotals.get("Taxes paid")).toBeCloseTo(-5, 6);
    expect(gainYear?.assetValues.get("Winner")).toBeCloseTo(0, 6);
  });

  it("falls back to other assets when the preferred sale bucket is exhausted", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      yearlySnapshots: [
        {
          label: "2027",
          netAmount: -150,
          totalExpenses: 150,
          flowAmounts: new Map([["Living expenses", -150]]),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          name: "Municipal bonds",
          startingValue: 100,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
        {
          name: "Stocks",
          startingValue: 200,
          expectedReturn: 10,
          volatility: 0,
          sellProportion: 0,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0, 0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.flowTotals.get("Municipal bonds sale proceeds")).toBeCloseTo(100, 6);
    expect(row?.flowTotals.get("Stocks sale proceeds")).toBeCloseTo(50, 6);
    expect(row?.flowTotals.get("Stocks realized gain")).toBeCloseTo(4.545454545454554, 6);
    expect(row?.assetReturns.get("Stocks")?.amount).toBeCloseTo(20, 6);
    expect(row?.taxableGains).toBeCloseTo(4.545454545454554, 6);
    expect(row?.endingAssets).toBeCloseTo(170, 6);
    expect(row?.totalGains).toBeCloseTo(20, 6);
  });

  it("sells in proportion to current portfolio weights when multipliers match", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      yearlySnapshots: [
        {
          label: "2027",
          netAmount: -60,
          totalExpenses: 60,
          flowAmounts: new Map([["Living expenses", -60]]),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          name: "Stocks",
          startingValue: 200,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
        {
          name: "Bonds",
          startingValue: 100,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0, 0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.flowTotals.get("Stocks sale proceeds")).toBeCloseTo(40, 6);
    expect(row?.flowTotals.get("Bonds sale proceeds")).toBeCloseTo(20, 6);
    expect(row?.assetValues.get("Stocks")).toBeCloseTo(160, 6);
    expect(row?.assetValues.get("Bonds")).toBeCloseTo(80, 6);
  });

  it("uses sell multipliers to tilt proportional sales", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      yearlySnapshots: [
        {
          label: "2027",
          netAmount: -60,
          totalExpenses: 60,
          flowAmounts: new Map([["Living expenses", -60]]),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          name: "Stocks",
          startingValue: 200,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 0.5,
        },
        {
          name: "Bonds",
          startingValue: 100,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 2,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0, 0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.flowTotals.get("Stocks sale proceeds")).toBeCloseTo(21.176470588235293, 6);
    expect(row?.flowTotals.get("Bonds sale proceeds")).toBeCloseTo(38.82352941176471, 6);
    expect(row?.assetValues.get("Stocks")).toBeCloseTo(178.8235294117647, 6);
    expect(row?.assetValues.get("Bonds")).toBeCloseTo(61.17647058823529, 6);
  });

  it("does not sell retirement assets by default before age 60 when taxable assets can fund cash needs", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      currentAge: 35,
      yearlySnapshots: [
        {
          label: "2027",
          netAmount: -60,
          totalExpenses: 60,
          flowAmounts: new Map([["Living expenses", -60]]),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          name: "Brokerage",
          startingValue: 100,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
        {
          name: "IRA",
          assetType: "ira",
          startingValue: 100,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
          avoidEarlyWithdrawalPenalty: true,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0, 0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.flowTotals.get("Brokerage sale proceeds")).toBeCloseTo(60, 6);
    expect(row?.flowTotals.get("IRA sale proceeds")).toBeUndefined();
    expect(row?.assetValues.get("Brokerage")).toBeCloseTo(40, 6);
    expect(row?.assetValues.get("IRA")).toBeCloseTo(100, 6);
    expect(row?.liquidAssets).toBeCloseTo(40, 6);
  });

  it("marks depletion before age 60 when only penalty-gated retirement assets remain", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      currentAge: 35,
      yearlySnapshots: [
        {
          label: "2027",
          netAmount: -60,
          totalExpenses: 60,
          flowAmounts: new Map([["Living expenses", -60]]),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          name: "401k",
          assetType: "401k",
          startingValue: 100,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
          avoidEarlyWithdrawalPenalty: true,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.flowTotals.get("401k sale proceeds")).toBeUndefined();
    expect(row?.assetValues.get("401k")).toBeCloseTo(100, 6);
    expect(row?.totalAssets).toBeCloseTo(100, 6);
    expect(row?.liquidAssets).toBeCloseTo(0, 6);
    expect(row?.depleted).toBe(true);
  });

  it("sells penalty-gated retirement assets once simulated age reaches 60", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      currentAge: 60,
      yearlySnapshots: [
        {
          label: "2027",
          netAmount: -60,
          totalExpenses: 60,
          flowAmounts: new Map([["Living expenses", -60]]),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          name: "Roth IRA",
          assetType: "roth-ira",
          startingValue: 100,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
          avoidEarlyWithdrawalPenalty: true,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.flowTotals.get("Roth IRA sale proceeds")).toBeCloseTo(60, 6);
    expect(row?.assetValues.get("Roth IRA")).toBeCloseTo(40, 6);
    expect(row?.liquidAssets).toBeCloseTo(40, 6);
    expect(row?.depleted).toBe(false);
  });

  it("blocks retirement sales at age 59 and permits them in the following simulation year", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 2,
      currentAge: 59,
      yearlySnapshots: [
        {
          label: "2027",
          netAmount: -60,
          totalExpenses: 60,
          flowAmounts: new Map([["Living expenses", -60]]),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
        {
          label: "2028",
          netAmount: -60,
          totalExpenses: 60,
          flowAmounts: new Map([["Living expenses", -60]]),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          name: "IRA",
          assetType: "ira",
          startingValue: 100,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
          avoidEarlyWithdrawalPenalty: true,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0, 0]),
    });

    const firstYear = scenarios[0]?.rows[0];
    const secondYear = scenarios[0]?.rows[1];
    expect(firstYear?.flowTotals.get("IRA sale proceeds")).toBeUndefined();
    expect(firstYear?.liquidAssets).toBeCloseTo(0, 6);
    expect(firstYear?.depleted).toBe(true);
    expect(secondYear?.flowTotals.get("IRA sale proceeds")).toBeCloseTo(60, 6);
    expect(secondYear?.assetValues.get("IRA")).toBeCloseTo(40, 6);
    expect(secondYear?.liquidAssets).toBeCloseTo(40, 6);
  });

  it("returns to equal-proportion liquidation after custom asset liquidation is untoggled", () => {
    let customAssetLiquidation = false;
    customAssetLiquidation = true;

    const editedAssets = [
      {
        name: "Stocks",
        startingValue: 200,
        expectedReturn: 0,
        volatility: 0,
        sellProportion: 0.5,
      },
      {
        name: "Bonds",
        startingValue: 100,
        expectedReturn: 0,
        volatility: 0,
        sellProportion: 2,
      },
    ];

    expect(editedAssets.map((asset) => getSimulationSellProportion(asset, customAssetLiquidation))).toEqual([0.5, 2]);

    customAssetLiquidation = false;

    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      yearlySnapshots: [
        {
          label: "2027",
          netAmount: -60,
          totalExpenses: 60,
          flowAmounts: new Map([["Living expenses", -60]]),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: editedAssets.map((asset) => ({
        ...asset,
        sellProportion: getSimulationSellProportion(asset, customAssetLiquidation),
      })),
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0, 0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.flowTotals.get("Stocks sale proceeds")).toBeCloseTo(40, 6);
    expect(row?.flowTotals.get("Bonds sale proceeds")).toBeCloseTo(20, 6);
    expect(row?.assetValues.get("Stocks")).toBeCloseTo(160, 6);
    expect(row?.assetValues.get("Bonds")).toBeCloseTo(80, 6);
  });

  it("derives early-withdrawal avoidance only for default retirement liquidation", () => {
    const retirementAsset = {
      assetType: "401k" as const,
      sellProportion: 1,
    };
    const taxableAsset = {
      assetType: "us-stocks" as const,
      sellProportion: 1,
    };

    expect(shouldAvoidEarlyWithdrawalPenalty(retirementAsset, false)).toBe(true);
    expect(shouldAvoidEarlyWithdrawalPenalty(retirementAsset, true)).toBe(false);
    expect(shouldAvoidEarlyWithdrawalPenalty(taxableAsset, false)).toBe(false);
  });

  it("does not report a stock price return percentage after dividends fund a full liquidation", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      yearlySnapshots: [
        {
          label: "2026",
          netAmount: -3036000,
          totalExpenses: 3036000,
          flowAmounts: new Map(),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          name: "Stocks",
          startingValue: 3000000,
          expectedReturn: 10.78,
          volatility: 0,
          sellProportion: 1,
          cashGenerations: [
            {
              name: "Qualified dividends",
              rate: 1.1,
              volatility: 0,
              taxTreatment: "qualified-dividends",
            },
            {
              name: "Non-qualified dividends",
              rate: 0.1,
              volatility: 0,
              taxTreatment: "ordinary-income",
            },
          ],
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.flowTotals.get("Stocks sale proceeds")).toBeCloseTo(3008054.62589443, 6);
    expect(row?.flowTotals.get("Stocks Qualified dividends")).toBeCloseTo(25616.59293010578, 6);
    expect(row?.flowTotals.get("Stocks Non-qualified dividends")).toBeCloseTo(2328.781175464162, 6);
    expect(row?.assetValues.get("Stocks")).toBeCloseTo(236564.19864140893, 6);
    expect(row?.assetReturns.get("Stocks")?.amount).toBeCloseTo(244618.82453583903, 6);
    expect(row?.assetReturns.get("Stocks")?.percentage).toBeCloseTo(10.78, 6);
  });

  it("does not backfill unfunded withdrawals into total gains when the portfolio is depleted", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      yearlySnapshots: [
        {
          label: "2027",
          netAmount: -150,
          totalExpenses: 150,
          flowAmounts: new Map([["Living expenses", -150]]),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          name: "Portfolio",
          startingValue: 100,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.flowTotals.get("Portfolio sale proceeds")).toBeCloseTo(100, 6);
    expect(row?.endingAssets).toBeCloseTo(0, 6);
    expect(row?.totalGains).toBeCloseTo(0, 6);
  });

  it("does not sell a home asset to fund cash needs", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      yearlySnapshots: [
        {
          year: 2027,
          label: "2027",
          netAmount: -50,
          totalExpenses: 50,
          flowAmounts: new Map([["Living expenses", -50]]),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          kind: "home",
          name: "Home",
          initialCost: 100,
          expectedReturn: 0,
          volatility: 0,
          cashPurchasePercent: 1,
          mortgageType: "amortizing",
          mortgageRate: 0,
          mortgageTermYears: 30,
          monthlyNonTaxCosts: 0,
          propertyTaxRate: 0,
          purchaseYear: 2026,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.flowTotals.get("Home sale proceeds")).toBeUndefined();
    expect(row?.assetValues.get("Home")).toBeCloseTo(100, 6);
    expect(row?.totalAssets).toBeCloseTo(100, 6);
  });

  it("marks depletion when expenses hit a home-only household with no investable assets", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 2,
      yearlySnapshots: [
        {
          year: 2027,
          label: "2027",
          netAmount: -50,
          totalExpenses: 50,
          flowAmounts: new Map([["Living expenses", -50]]),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
        {
          year: 2028,
          label: "2028",
          netAmount: 0,
          totalExpenses: 0,
          flowAmounts: new Map(),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          kind: "home",
          name: "Home",
          initialCost: 100,
          expectedReturn: 0,
          volatility: 0,
          cashPurchasePercent: 1,
          mortgageType: "amortizing",
          mortgageRate: 0,
          mortgageTermYears: 30,
          monthlyNonTaxCosts: 0,
          propertyTaxRate: 0,
          purchaseYear: 2026,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0]),
    });

    const firstYear = scenarios[0]?.rows[0];
    const secondYear = scenarios[0]?.rows[1];
    expect(firstYear?.assetValues.get("Home")).toBeCloseTo(100, 6);
    expect(firstYear?.totalAssets).toBeCloseTo(100, 6);
    expect(firstYear?.depleted).toBe(true);
    expect(firstYear?.depletionProbability).toBeCloseTo(100, 6);
    expect(secondYear?.depleted).toBe(true);
    expect(secondYear?.depletionProbability).toBeCloseTo(100, 6);
  });

  it("does not mark depletion when non-home assets remain after funding expenses", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      yearlySnapshots: [
        {
          year: 2027,
          label: "2027",
          netAmount: -50,
          totalExpenses: 50,
          flowAmounts: new Map([["Living expenses", -50]]),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          name: "Portfolio",
          startingValue: 200,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
        {
          kind: "home",
          name: "Home",
          initialCost: 100,
          expectedReturn: 0,
          volatility: 0,
          cashPurchasePercent: 1,
          mortgageType: "amortizing",
          mortgageRate: 0,
          mortgageTermYears: 30,
          monthlyNonTaxCosts: 0,
          propertyTaxRate: 0,
          purchaseYear: 2026,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0, 0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.assetValues.get("Portfolio")).toBeCloseTo(150, 6);
    expect(row?.assetValues.get("Home")).toBeCloseTo(100, 6);
    expect(row?.liquidAssets).toBeCloseTo(150, 6);
    expect(row?.depleted).toBe(false);
    expect(row?.depletionProbability).toBeCloseTo(0, 6);
  });

  it("applies NIIT using the lesser of net investment income and MAGI above the threshold", () => {
    const profile = {
      ...createDefaultHouseholdTaxProfile(),
      federalStandardDeduction: 0,
      federalOrdinaryTaxName: "",
      federalQualifiedTaxName: "",
      stateTaxName: "",
      stateCapitalGainsTaxName: "",
      localTaxName: "",
      niitThreshold: 200000,
      niitTaxName: "Federal NIIT",
    };

    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      yearlySnapshots: [
        {
          label: "2027",
          netAmount: 0,
          totalExpenses: 0,
          flowAmounts: new Map(),
          householdTaxInput: {
            ...createEmptyHouseholdTaxInput(),
            wages: 190000,
            qualifiedDividends: 30000,
            deductibleExpenses: 15000,
          },
        },
      ],
      assets: [],
      assetCorrelations: [],
      taxes: [new Tax({ name: "Federal NIIT", taxRates: [{ rate: 0.038 }] })],
      householdTaxProfile: profile,
      nextStandardNormal: createDeterministicNormals([]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.taxAmount).toBeCloseTo(190, 6);
    expect(row?.flowTotals.get("Taxes paid")).toBeCloseTo(-190, 6);
    expect(row?.taxBreakdown.modifiedAdjustedGrossIncome).toBeCloseTo(205000, 6);
    expect(row?.taxBreakdown.netInvestmentIncome).toBeCloseTo(15000, 6);
    expect(row?.taxBreakdown.niitIncomeAboveThreshold).toBeCloseTo(5000, 6);
    expect(row?.taxBreakdown.niitTaxableIncome).toBeCloseTo(5000, 6);
  });

  it("models mortgage interest, property tax, and home monthlies with itemized deductions", () => {
    const profile = {
      ...createDefaultHouseholdTaxProfile(),
      deductionMode: "itemized" as const,
      federalStandardDeduction: 0,
      federalOrdinaryTaxName: "Federal ordinary income",
      federalQualifiedTaxName: "",
      stateTaxName: "",
      stateCapitalGainsTaxName: "",
      localTaxName: "",
      niitTaxName: "",
    };

    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      yearlySnapshots: [
        {
          year: 2027,
          label: "2027",
          netAmount: 0,
          totalExpenses: 0,
          flowAmounts: new Map(),
          householdTaxInput: {
            ...createEmptyHouseholdTaxInput(),
            wages: 100000,
          },
        },
      ],
      assets: [
        {
          name: "Portfolio",
          startingValue: 50000,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
        {
          kind: "home",
          name: "Home",
          initialCost: 100000,
          expectedReturn: 0,
          volatility: 0,
          cashPurchasePercent: 0.2,
          mortgageType: "amortizing",
          mortgageRate: 6,
          mortgageTermYears: 30,
          monthlyNonTaxCosts: 100,
          propertyTaxRate: 1.2,
          purchaseYear: 2027,
        },
      ],
      assetCorrelations: [],
      taxes: [new Tax({ name: "Federal ordinary income", taxRates: [{ rate: 0.1 }] })],
      householdTaxProfile: profile,
      nextStandardNormal: createDeterministicNormals([0, 0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.flowTotals.get("Home down payment")).toBeCloseTo(-20000, 6);
    expect((row?.flowTotals.get("Home mortgage interest") ?? 0) < 0).toBe(true);
    expect(row?.flowTotals.get("Home property tax")).toBeCloseTo(-1200, 6);
    expect(row?.flowTotals.get("Home home monthlies")).toBeCloseTo(-1200, 6);
    expect((row?.taxBreakdown.deductibleMortgageInterest ?? 0) > 0).toBe(true);
    expect(row?.taxBreakdown.saltDeductionUsed).toBeCloseTo(1200, 6);
  });

  it("supports interest-only mortgages without paying principal", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      yearlySnapshots: [
        {
          year: 2027,
          label: "2027",
          netAmount: 0,
          totalExpenses: 0,
          flowAmounts: new Map(),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          kind: "home",
          name: "IO Home",
          initialCost: 100000,
          expectedReturn: 0,
          volatility: 0,
          cashPurchasePercent: 0.2,
          mortgageType: "interest-only",
          mortgageRate: 6,
          mortgageTermYears: 30,
          monthlyNonTaxCosts: 0,
          propertyTaxRate: 0,
          purchaseYear: 2027,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.flowTotals.get("IO Home mortgage principal") ?? 0).toBeCloseTo(0, 6);
    expect(row?.flowTotals.get("IO Home mortgage interest")).toBeCloseTo(-4800, 6);
    expect(row?.assetValues.get("IO Home")).toBeCloseTo(20000, 6);
  });

  it("forces an interest-only balloon payoff at maturity", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      yearlySnapshots: [
        {
          year: 2027,
          label: "2027",
          netAmount: 0,
          totalExpenses: 0,
          flowAmounts: new Map(),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          name: "Reserve",
          startingValue: 80000,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
        {
          kind: "home",
          name: "IO Home",
          initialCost: 100000,
          expectedReturn: 0,
          volatility: 0,
          cashPurchasePercent: 0.2,
          mortgageType: "interest-only",
          interestOnlyMaturityAction: "payoff",
          mortgageRate: 6,
          mortgageTermYears: 30,
          monthlyNonTaxCosts: 0,
          propertyTaxRate: 0,
          purchaseYear: 1997,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0, 0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.flowTotals.get("IO Home mortgage balloon principal")).toBeCloseTo(-80000, 6);
    expect(row?.flowTotals.get("Reserve sale proceeds")).toBeCloseTo(80000, 6);
    expect(row?.assetValues.get("IO Home")).toBeCloseTo(100000, 6);
    expect(row?.assetValues.get("Reserve")).toBeCloseTo(0, 6);
  });

  it("refinances an interest-only mortgage into an amortizing loan at maturity", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      yearlySnapshots: [
        {
          year: 2027,
          label: "2027",
          netAmount: 0,
          totalExpenses: 0,
          flowAmounts: new Map(),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          kind: "home",
          name: "IO Home",
          initialCost: 100000,
          expectedReturn: 0,
          volatility: 0,
          cashPurchasePercent: 0.2,
          mortgageType: "interest-only",
          interestOnlyMaturityAction: "refinance",
          mortgageRate: 6,
          mortgageTermYears: 30,
          monthlyNonTaxCosts: 0,
          propertyTaxRate: 0,
          purchaseYear: 1997,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.flowTotals.get("IO Home mortgage balloon principal")).toBeUndefined();
    expect((row?.flowTotals.get("IO Home mortgage principal") ?? 0) < 0).toBe(true);
    expect((row?.flowTotals.get("IO Home mortgage interest") ?? 0) < 0).toBe(true);
    expect((row?.assetValues.get("IO Home") ?? 0) > 20000).toBe(true);
  });

  it("auto-sells an interest-only home at maturity and preserves the residual equity", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      yearlySnapshots: [
        {
          year: 2027,
          label: "2027",
          netAmount: 0,
          totalExpenses: 0,
          flowAmounts: new Map(),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          name: "Reserve",
          startingValue: 0,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
        {
          kind: "home",
          name: "IO Home",
          initialCost: 100000,
          expectedReturn: 0,
          volatility: 0,
          cashPurchasePercent: 0.2,
          mortgageType: "interest-only",
          interestOnlyMaturityAction: "sell",
          mortgageRate: 6,
          mortgageTermYears: 30,
          monthlyNonTaxCosts: 0,
          propertyTaxRate: 0,
          purchaseYear: 1997,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0, 0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.flowTotals.get("IO Home sale proceeds")).toBeCloseTo(100000, 6);
    expect(row?.flowTotals.get("IO Home mortgage balloon principal")).toBeCloseTo(-80000, 6);
    expect(row?.assetValues.get("IO Home")).toBeCloseTo(0, 6);
    expect(row?.assetValues.get("Reserve")).toBeCloseTo(20000, 6);
  });

  it("rejects duplicate asset names before running a simulation", () => {
    expect(() =>
      buildSimulationDetails({
        attempts: 1,
        horizonYears: 1,
        yearlySnapshots: [
          {
            label: "2027",
            netAmount: 0,
            totalExpenses: 0,
            flowAmounts: new Map(),
            householdTaxInput: createEmptyHouseholdTaxInput(),
          },
        ],
        assets: [
          {
            name: "Duplicate",
            startingValue: 100,
            expectedReturn: 0,
            volatility: 0,
            sellProportion: 1,
          },
          {
            name: "Duplicate",
            startingValue: 50,
            expectedReturn: 0,
            volatility: 0,
            sellProportion: 1,
          },
        ],
        assetCorrelations: [],
        nextStandardNormal: createDeterministicNormals([0, 0]),
      })
    ).toThrow('Asset name "Duplicate" is already in use.');
  });

  it("reinvests yearly surplus cash into the asset that generated it", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      yearlySnapshots: [
        {
          label: "2027",
          netAmount: 50,
          totalExpenses: 0,
          flowAmounts: new Map([
            ["Stocks", 20],
            ["Bonds", 30],
          ]),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          name: "Stocks",
          startingValue: 100,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
        {
          name: "Bonds",
          startingValue: 300,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 0,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0, 0]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.assetValues.get("Stocks")).toBeCloseTo(120, 6);
    expect(row?.assetValues.get("Bonds")).toBeCloseTo(330, 6);
  });

  it("applies correlations to asset shocks", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      yearlySnapshots: [
        {
          label: "2027",
          netAmount: 0,
          totalExpenses: 0,
          flowAmounts: new Map(),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          name: "Stocks",
          startingValue: 100,
          expectedReturn: 0,
          volatility: ANNUAL_VOLATILITY_10_PERCENT,
          sellProportion: 0,
        },
        {
          name: "Bonds",
          startingValue: 100,
          expectedReturn: 0,
          volatility: ANNUAL_VOLATILITY_10_PERCENT,
          sellProportion: 0,
        },
      ],
      assetCorrelations: [{ assetA: "Bonds", assetB: "Stocks", correlation: 1 }],
      nextStandardNormal: createDeterministicNormals([0.5, -0.7]),
    });

    const row = scenarios[0]?.rows[0];
    const oneYearValue = oneYearFromAnnualReturn(0.05);
    expect(row?.assetValues.get("Stocks")).toBeCloseTo(oneYearValue, 6);
    expect(row?.assetValues.get("Bonds")).toBeCloseTo(oneYearValue, 4);
  });

  it("supports negative correlations between assets", () => {
    const scenarios = buildSimulationDetails({
      attempts: 1,
      horizonYears: 1,
      yearlySnapshots: [
        {
          label: "2027",
          netAmount: 0,
          totalExpenses: 0,
          flowAmounts: new Map(),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          name: "Stocks",
          startingValue: 100,
          expectedReturn: 0,
          volatility: ANNUAL_VOLATILITY_10_PERCENT,
          sellProportion: 0,
        },
        {
          name: "Bonds",
          startingValue: 100,
          expectedReturn: 0,
          volatility: ANNUAL_VOLATILITY_10_PERCENT,
          sellProportion: 0,
        },
      ],
      assetCorrelations: [{ assetA: "Bonds", assetB: "Stocks", correlation: -1 }],
      nextStandardNormal: createDeterministicNormals([0.5, -0.7]),
    });

    const row = scenarios[0]?.rows[0];
    expect(row?.assetValues.get("Stocks")).toBeCloseTo(oneYearFromAnnualReturn(0.05), 6);
    expect(row?.assetValues.get("Bonds")).toBeCloseTo(oneYearFromAnnualReturn(-0.05), 6);
  });

  it("computes percentiles independently for each year instead of reusing one representative path", () => {
    const simulationInput = {
      attempts: 3,
      horizonYears: 2,
      yearlySnapshots: [
        {
          label: "2027",
          netAmount: 0,
          totalExpenses: 0,
          flowAmounts: new Map(),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
        {
          label: "2028",
          netAmount: 0,
          totalExpenses: 0,
          flowAmounts: new Map(),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          name: "Stocks",
          startingValue: 100,
          expectedReturn: 0,
          volatility: ANNUAL_VOLATILITY_10_PERCENT,
          sellProportion: 0,
        },
      ],
      assetCorrelations: [],
    };
    const detailScenarios = buildSimulationDetails({
      ...simulationInput,
      nextStandardNormal: createDeterministicNormals([3, -5, 1, 1, 0, 2]),
    });
    const scenarios = buildSimulationScenarios({
      ...simulationInput,
      nextStandardNormal: createDeterministicNormals([3, -5, 1, 1, 0, 2]),
    });

    const medianRows = scenarios.get(50)?.rows ?? [];
    const expectedMedianTotals = [0, 1].map((yearIndex) =>
      [...detailScenarios.map((scenario) => scenario.rows[yearIndex]?.totalAssets ?? 0)].sort((left, right) => left - right)[1]
    );
    expect(medianRows).toHaveLength(2);
    expect(medianRows[0]?.totalAssets).toBeCloseTo(expectedMedianTotals[0] ?? 0, 6);
    expect(medianRows[1]?.totalAssets).toBeCloseTo(expectedMedianTotals[1] ?? 0, 6);
  });

  it("tracks liquid-asset percentiles separately from total assets", () => {
    const input = {
      attempts: 3,
      horizonYears: 1,
      yearlySnapshots: [
        {
          year: 2027,
          label: "2027",
          netAmount: 0,
          totalExpenses: 0,
          flowAmounts: new Map(),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          name: "Stocks",
          startingValue: 100,
          expectedReturn: 0,
          volatility: ANNUAL_VOLATILITY_10_PERCENT,
          sellProportion: 0,
        },
        {
          kind: "home",
          name: "Home",
          initialCost: 100,
          expectedReturn: 0,
          volatility: ANNUAL_VOLATILITY_10_PERCENT,
          cashPurchasePercent: 1,
          mortgageType: "amortizing",
          mortgageRate: 0,
          mortgageTermYears: 30,
          monthlyNonTaxCosts: 0,
          propertyTaxRate: 0,
          purchaseYear: 2026,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0, 0, 1, -1, -1, 1]),
    } satisfies Parameters<typeof buildSimulationScenarios>[0];
    const scenarios = buildSimulationScenarios(input);
    const medianRow = scenarios.get(50)?.rows[0];
    expect(medianRow?.totalAssets).toBeCloseTo(200, 6);
    expect(medianRow?.liquidAssets).toBeCloseTo(100, 6);
  });

  it("reports bankruptcy probability from yearly zero liquid asset counts", () => {
    const scenarios = buildSimulationScenariosFromAggregates({
      attempts: 4,
      horizonYears: 1,
      yearlyPlans: [{ label: "2027", flows: [] }],
      yearlyTotals: [[0, 10, 20, 30]],
      yearlyLiquidTotals: [[0, 0, 10, 20]],
      bankruptcyCountsByYear: [2],
      depletionCountsByYear: [3],
    });

    const row = scenarios.get(50)?.rows[0];
    expect(row?.bankruptcyProbability).toBe(50);
    expect(row?.depletionProbability).toBe(75);
  });

  it("rejects invalid correlation matrices instead of coercing them", () => {
    expect(() =>
      buildSimulationScenarios({
        attempts: 1,
        horizonYears: 1,
        yearlySnapshots: [
          {
            label: "2027",
            netAmount: 0,
            totalExpenses: 0,
            flowAmounts: new Map(),
            householdTaxInput: createEmptyHouseholdTaxInput(),
          },
        ],
        assets: [
          { name: "Stocks", startingValue: 100, expectedReturn: 0, volatility: ANNUAL_VOLATILITY_10_PERCENT, sellProportion: 0 },
          { name: "Bonds", startingValue: 100, expectedReturn: 0, volatility: ANNUAL_VOLATILITY_10_PERCENT, sellProportion: 0 },
          { name: "Gold", startingValue: 100, expectedReturn: 0, volatility: ANNUAL_VOLATILITY_10_PERCENT, sellProportion: 0 },
        ],
        assetCorrelations: [
          { assetA: "Bonds", assetB: "Stocks", correlation: -0.9 },
          { assetA: "Gold", assetB: "Stocks", correlation: -0.9 },
          { assetA: "Bonds", assetB: "Gold", correlation: -0.9 },
        ],
      })
    ).toThrow("Correlation matrix must be positive semidefinite.");
  });

  it("reports the share of scenarios depleted by each year", () => {
    const scenarios = buildSimulationScenarios({
      attempts: 2,
      horizonYears: 2,
      yearlySnapshots: [
        {
          label: "2027",
          netAmount: -100,
          totalExpenses: 100,
          flowAmounts: new Map([["Rent", -100]]),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
        {
          label: "2028",
          netAmount: 0,
          totalExpenses: 0,
          flowAmounts: new Map(),
          householdTaxInput: createEmptyHouseholdTaxInput(),
        },
      ],
      assets: [
        {
          name: "Stocks",
          startingValue: 50,
          expectedReturn: 0,
          volatility: 0,
          sellProportion: 1,
        },
      ],
      assetCorrelations: [],
      nextStandardNormal: createDeterministicNormals([0, 0]),
    });

    const rows = scenarios.get(50)?.rows ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.depletionProbability).toBeCloseTo(100, 6);
    expect(rows[1]?.depletionProbability).toBeCloseTo(100, 6);
  });
});
