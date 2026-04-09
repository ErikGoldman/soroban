import { describe, expect, it } from "vitest";

import {
  buildSimulationDetails,
  buildSimulationScenarios,
  selectRepresentativeSimulationScenario,
  type SimulationDetailScenario,
  type SimulationYearRow,
} from "./simulation.js";
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
    taxExemptIncome: 0,
    stateLocalExemptIncome: 0,
    tripleExemptIncome: 0,
    deductibleExpenses: 0,
  };
}

function oneYearFromAnnualReturn(returnRate: number): number {
  return 100 * (1 + returnRate);
}

describe("buildSimulationScenarios", () => {
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

  it("selects one representative run for the whole percentile path", () => {
    const targetRows: SimulationYearRow[] = [
      {
        yearNumber: 1,
        label: "2026",
        depletionProbability: 0,
        totalAssets: 100,
      },
      {
        yearNumber: 2,
        label: "2027",
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
            startingAssets: 100,
            endingAssets: 100,
            totalExpenses: 0,
            totalGains: 0,
            taxableGains: 0,
            taxAmount: 0,
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
            startingAssets: 100,
            endingAssets: 90,
            totalExpenses: 0,
            totalGains: -10,
            taxableGains: 0,
            taxAmount: 0,
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
            startingAssets: 100,
            endingAssets: 100,
            totalExpenses: 0,
            totalGains: 0,
            taxableGains: 0,
            taxAmount: 0,
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
            startingAssets: 100,
            endingAssets: 40,
            totalExpenses: 0,
            totalGains: -60,
            taxableGains: 0,
            taxAmount: 0,
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

  it("uses average basis to realize gains on asset sales", () => {
    const profile = {
      ...createDefaultHouseholdTaxProfile(),
      federalStandardDeduction: 0,
      federalOrdinaryTaxName: "",
      federalQualifiedTaxName: "Federal qualified dividends / long-term gains",
      stateTaxName: "",
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
    expect(row?.assetReturns.get("Stocks")?.amount).toBeCloseTo(15, 6);
    expect(row?.taxableGains).toBeCloseTo(0, 6);
    expect(row?.endingAssets).toBeCloseTo(165, 6);
    expect(row?.totalGains).toBeCloseTo(15, 6);
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

  it("applies NIIT using the lesser of net investment income and MAGI above the threshold", () => {
    const profile = {
      ...createDefaultHouseholdTaxProfile(),
      federalStandardDeduction: 0,
      federalOrdinaryTaxName: "",
      federalQualifiedTaxName: "",
      stateTaxName: "",
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
  });
});
