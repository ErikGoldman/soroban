import { describe, expect, it } from "vitest";

import { buildScenarioFileContents, extractScenarioPlannerState, type ScenarioPlannerState } from "./scenario.js";

function createScenarioPlannerState(): ScenarioPlannerState {
  return {
    variables: [
      { name: "salary", value: 250000 },
      { name: "rent", value: 4200 },
      { name: "bonusRate", value: 0.2 },
    ],
    assets: [
      {
        name: "Brokerage",
        kind: "investment",
        startingValue: 1500000,
        expectedReturn: 7,
        volatility: 15,
        sellProportion: 0.4,
        cashGenerations: [
          {
            name: "Qualified dividends",
            rate: 1.8,
            volatility: 0.5,
            taxTreatment: "qualified-dividends",
          },
        ],
        saleTax: {
          costBasis: 900000,
          taxTreatment: "long-term-capital-gains",
        },
      },
      {
        name: "Primary home",
        kind: "home",
        initialCost: 1200000,
        expectedReturn: 3,
        volatility: 6,
        cashPurchasePercent: 0.25,
        mortgageType: "amortizing",
        mortgageRate: 6.2,
        mortgageTermYears: 30,
        monthlyNonTaxCosts: 1400,
        propertyTaxRate: 1.15,
        purchaseYear: 2028,
      },
    ],
    taxes: [
      {
        name: "Federal ordinary",
        taxRates: [
          { rate: 0.1, upTo: 10000 },
          { rate: 0.24, upTo: 200000 },
          { rate: 0.32 },
        ],
        exclusions: [{ name: "Deduction", amount: 15000 }],
      },
      {
        name: "NY State",
        taxRates: [{ rate: 0.0685 }],
        maximum: 50000,
      },
    ],
    taxProfile: {
      filingStatus: "married-couple-jointly",
      deductionMode: "itemized",
      federalStandardDeduction: 29200,
      otherSaltTaxesPaid: 12000,
      saltDeductionBaseCap: 10000,
      saltDeductionFloorCap: 40000,
      saltDeductionPhaseoutThreshold: 500000,
      saltDeductionPhaseoutRate: 0.3,
      otherItemizedDeductions: 9000,
      stateTaxableIncomeAdjustment: 2500,
      localTaxableIncomeAdjustment: 500,
      niitThreshold: 250000,
      federalOrdinaryTaxName: "Federal ordinary",
      federalQualifiedTaxName: "Federal capital gains",
      stateTaxName: "NY State",
      localTaxName: "NYC",
      niitTaxName: "NIIT",
    },
    assetCorrelations: [
      { assetA: "Brokerage", assetB: "Primary home", correlation: 0.12 },
    ],
    flows: [
      {
        name: "Salary",
        type: "income",
        formula: "salary + salary * bonusRate",
        taxTreatment: "wages",
      },
      {
        name: "Rent",
        type: "expense",
        formula: "rent",
        inflationAdjusted: true,
        taxTreatment: "nondeductible-expense",
      },
    ],
    events: [
      {
        name: "Promotion",
        flowName: "Salary",
        schedule: [
          {
            year: { year: 2029 },
            actions: [
              {
                kind: "adjust-variable",
                variableName: "salary",
                adjustment: { m: 1.1, b: 15000 },
              },
              {
                kind: "set-flow-formula",
                flowName: "Salary",
                formula: "salary + salary * bonusRate + 10000",
              },
            ],
          },
        ],
      },
    ],
    startYear: "2028",
    yearsToShow: 7,
    simulationAttempts: 25000,
    simulationTaxPreset: "nyc",
    simulationHorizonYears: 18,
    simulationInflation: {
      mode: "regime-switching",
      regimeSwitching: {
        lowRate: 2.5,
        highRate: 6,
        stayLowProbability: 90,
        stayHighProbability: 60,
      },
    },
    simulationVariableSweep: {
      enabled: true,
      variableName: "salary",
      minValue: 200000,
      maxValue: 350000,
    },
  };
}

describe("scenario save and load", () => {
  it("round-trips scenario data through the JSON file format", () => {
    const plannerState = createScenarioPlannerState();

    const fileContents = buildScenarioFileContents(plannerState, "2026-04-10T12:00:00.000Z");
    const parsedFile = JSON.parse(fileContents) as {
      format: string;
      version: number;
      exportedAt: string;
      plannerState: ScenarioPlannerState;
    };

    expect(parsedFile.format).toBe("soroban-scenario");
    expect(parsedFile.version).toBe(1);
    expect(parsedFile.exportedAt).toBe("2026-04-10T12:00:00.000Z");
    expect(parsedFile.plannerState.assets[0]?.saleTax?.costBasis).toBe(900000);
    expect(parsedFile.plannerState.assets[1]?.purchaseYear).toBe(2028);
    expect(parsedFile.plannerState.flows[1]?.formula).toBe("rent");
    expect(parsedFile.plannerState.events[0]?.schedule[0]?.actions[1]).toEqual({
      kind: "set-flow-formula",
      flowName: "Salary",
      formula: "salary + salary * bonusRate + 10000",
    });
    expect(parsedFile.plannerState.simulationAttempts).toBe(25000);
    expect(parsedFile.plannerState.simulationInflation).toEqual({
      mode: "regime-switching",
      regimeSwitching: {
        lowRate: 2.5,
        highRate: 6,
        stayLowProbability: 90,
        stayHighProbability: 60,
      },
    });
    expect(parsedFile.plannerState.simulationVariableSweep).toEqual({
      enabled: true,
      variableName: "salary",
      minValue: 200000,
      maxValue: 350000,
    });

    expect(extractScenarioPlannerState(parsedFile)).toEqual(plannerState);
  });

  it("loads a raw saved planner state object for backwards compatibility", () => {
    const plannerState = createScenarioPlannerState();

    expect(extractScenarioPlannerState(plannerState)).toEqual(plannerState);
  });

  it("rejects an unsupported scenario file version", () => {
    const plannerState = createScenarioPlannerState();

    expect(() =>
      extractScenarioPlannerState({
        format: "soroban-scenario",
        version: 2,
        exportedAt: "2026-04-10T12:00:00.000Z",
        plannerState,
      })
    ).toThrow("Scenario file version is not supported.");
  });
});
