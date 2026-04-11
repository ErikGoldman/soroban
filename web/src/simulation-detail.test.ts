import { describe, expect, it } from "vitest";

import {
  getSimulationAssetReturnEntries,
  getSimulationAssetValueEntries,
  getSimulationCashFlowEntries,
} from "./simulation-detail.js";
import type { SimulationDetailYearRow } from "./simulation.js";

function createRow(overrides: Partial<SimulationDetailYearRow> = {}): SimulationDetailYearRow {
  return {
    yearNumber: 1,
    label: "2027",
    inflationMode: "fixed",
    inflationRateApplied: 0,
    inflationRegime: "fixed",
    startingAssets: 20,
    endingAssets: 32.666666666666664,
    totalExpenses: 0,
    totalGains: 12.666666666666664,
    taxableGains: 0,
    taxAmount: 0,
    depleted: false,
    depletionProbability: 0,
    householdTaxInput: {
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
    },
    flowTotals: new Map([["Home property tax", -1.2]]),
    assetValues: new Map([["Home", 32.666666666666664]]),
    assetMarketValues: new Map([["Home", 110]]),
    assetReturns: new Map([["Home", { amount: 10, percentage: 10 }]]),
    totalAssets: 32.666666666666664,
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
    ...overrides,
  };
}

describe("simulation detail helpers", () => {
  it("keeps asset returns out of cash flow entries", () => {
    const row = createRow();

    expect(getSimulationCashFlowEntries(row)).toEqual([
      {
        label: "Home property tax",
        amount: -1.2,
        detail: "",
      },
    ]);
    expect(getSimulationAssetReturnEntries(row)).toEqual([
      {
        label: "Home return",
        amount: 10,
        detail: " (10.00%)",
      },
    ]);
  });

  it("shows home market value separately from home equity", () => {
    const row = createRow();

    expect(getSimulationAssetValueEntries(row)).toEqual([
      {
        label: "Home market value",
        amount: 110,
        detail: "",
      },
      {
        label: "Home equity",
        amount: 32.666666666666664,
        detail: "",
      },
    ]);
  });
});
