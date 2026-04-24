import { describe, expect, it } from "vitest";

import {
  Asset,
  applyFlowExpenseInflation,
  createAssetCorrelationDefinition,
  collectReferencedVariableNames,
  createOneTimeExpenseSchedule,
  DEFAULT_EXPENSE_INFLATION_RATE,
  deleteAssetAndPruneCorrelations,
  deleteEventAndPruneVariables,
  deleteFlowAndPruneVariables,
  Event,
  Flow,
  Variable,
  applyEventsForYear,
  createFormulaContext,
  evaluateFormula,
  resolveAssetValueFormula,
  sumSignedYearlyFlows,
} from "./finance.js";

describe("evaluateFormula", () => {
  it("applies arithmetic precedence", () => {
    expect(evaluateFormula("2 + 3 * 4")).toBe(14);
  });

  it("supports parentheses and exponentiation", () => {
    expect(evaluateFormula("(2 + 3) ^ 2")).toBe(25);
  });

  it("treats exponentiation as right associative", () => {
    expect(evaluateFormula("2 ^ 3 ^ 2")).toBe(512);
  });

  it("resolves variables from the provided context", () => {
    expect(evaluateFormula("salary - rent * 2", { salary: 6500, rent: 1800 })).toBe(2900);
  });

  it("supports unary operators", () => {
    expect(evaluateFormula("-bonus + +offset", { bonus: 300, offset: 25 })).toBe(-275);
  });

  it("accepts comma-separated numeric literals", () => {
    expect(evaluateFormula("50,000 + 1,250.75")).toBe(51250.75);
  });

  it("evaluates nested percentage expressions across adjacent parenthesized terms", () => {
    expect(
      evaluateFormula(
        "HomePurchasePrice*(1+(AdditionalHomePurchaseCostPct/100))*(1-(HomeMortgagePct/100))",
        {
          HomePurchasePrice: 500000,
          AdditionalHomePurchaseCostPct: 3,
          HomeMortgagePct: 80,
        }
      )
    ).toBeCloseTo(103000);
  });

  it("throws when a variable is missing", () => {
    expect(() => evaluateFormula("salary + tax")).toThrow('Unknown variable "salary".');
  });

  it("rejects malformed comma-separated numeric literals", () => {
    expect(() => evaluateFormula("50,00 + 1")).toThrow('Invalid number "50,00".');
  });
});

describe("planner cleanup", () => {
  it("deletes a flow and prunes variables that become unused", () => {
    const snapshot = {
      variables: [
        { name: "salary", value: 5000 },
        { name: "rent", value: 1800 },
        { name: "insuranceBase", value: 400 },
      ],
      flows: [
        { name: "Salary", type: "income" as const, formula: "salary" },
        { name: "Rent", type: "expense" as const, formula: "rent + insuranceBase" },
      ],
      events: [
        {
          name: "Lease update",
          schedule: [
            {
              year: { year: 2027 },
              actions: [
                {
                  kind: "set-flow-formula" as const,
                  flowName: "Rent",
                  formula: "rent + insuranceBase * 2",
                },
              ],
            },
          ],
        },
      ],
    };

    const result = deleteFlowAndPruneVariables(snapshot, "Rent");

    expect(result.flows.map((flow) => flow.name)).toEqual(["Salary"]);
    expect(result.events).toEqual([]);
    expect(result.variables.map((variable) => variable.name)).toEqual(["salary"]);
  });

  it("deletes an event and prunes variables no longer referenced anywhere", () => {
    const snapshot = {
      variables: [
        { name: "salary", value: 5000 },
        { name: "bonus", value: 500 },
      ],
      flows: [{ name: "Salary", type: "income" as const, formula: "salary" }],
      events: [
        {
          name: "Bonus launch",
          schedule: [
            {
              year: { year: 2027 },
              actions: [
                {
                  kind: "set-flow-formula" as const,
                  flowName: "Salary",
                  formula: "salary + bonus",
                },
              ],
            },
          ],
        },
      ],
    };

    const result = deleteEventAndPruneVariables(snapshot, "Bonus launch");

    expect(result.events).toEqual([]);
    expect(result.variables.map((variable) => variable.name)).toEqual(["salary"]);
  });

  it("keeps variables that are still referenced by another event", () => {
    const snapshot = {
      variables: [
        { name: "salary", value: 5000 },
        { name: "bonus", value: 500 },
      ],
      flows: [{ name: "Salary", type: "income" as const, formula: "salary" }],
      events: [
        {
          name: "Spring bonus",
          schedule: [
            {
              year: { year: 2027 },
              actions: [
                {
                  kind: "set-flow-formula" as const,
                  flowName: "Salary",
                  formula: "salary + bonus",
                },
              ],
            },
          ],
        },
        {
          name: "Bonus uplift",
          schedule: [
            {
              year: { year: 2027 },
              actions: [
                {
                  kind: "adjust-variable" as const,
                  variableName: "bonus",
                  adjustment: { m: 1.1, b: 0 },
                },
              ],
            },
          ],
        },
      ],
    };

    const result = deleteEventAndPruneVariables(snapshot, "Spring bonus");

    expect(result.variables.map((variable) => variable.name)).toEqual(["salary", "bonus"]);
    expect(result.events.map((event) => event.name)).toEqual(["Bonus uplift"]);
  });

  it("treats variables introduced by events as referenced only when another flow or event uses them", () => {
    const referenced = collectReferencedVariableNames(
      [{ name: "Salary", type: "income", formula: "salary" }],
      [
        {
          name: "Side gig",
          schedule: [
            {
              year: { year: 2027 },
              actions: [
                { kind: "add-variable", variable: { name: "sideGig", value: 900 } },
                { kind: "add-flow", flow: { name: "Side gig", type: "income", formula: "sideGig" } },
              ],
            },
          ],
        },
        {
          name: "Unused variable",
          schedule: [
            {
              year: { year: 2028 },
              actions: [{ kind: "add-variable", variable: { name: "ghost", value: 10 } }],
            },
          ],
        },
      ]
    );

    expect([...referenced].sort()).toEqual(["salary", "sideGig"]);
  });
});

describe("Variable", () => {
  it("sets a variable to a new value", () => {
    const variable = new Variable({ name: "rent", value: 1500 });

    variable.setValue(1700);

    expect(variable.value).toBe(1700);
  });

  it("applies a linear update using m * x + b", () => {
    const variable = new Variable({ name: "salary", value: 5000 });

    variable.adjustLinearly({ m: 1.05, b: 200 });

    expect(variable.value).toBe(5450);
  });

  it("builds a formula context from variables", () => {
    const variables = [
      new Variable({ name: "salary", value: 5000 }),
      new Variable({ name: "rent", value: 1700 }),
    ];

    expect(createFormulaContext(variables)).toEqual({
      salary: 5000,
      rent: 1700,
    });
  });
});

describe("Asset", () => {
  it("captures an asset definition", () => {
    const asset = new Asset({
      name: "Index fund",
      assetType: "us-stocks",
      startingValue: 12000,
      expectedReturn: 7.5,
      volatility: 14.2,
      sellProportion: 0.25,
      cashGenerations: [
        {
          name: "Qualified dividends",
          rate: 1.8,
          volatility: 0.5,
          inflationCorrelation: 0,
          taxTreatment: "qualified-dividends",
        },
      ],
      saleTax: {
        costBasis: 4800,
        taxTreatment: "long-term-capital-gains",
      },
    });

    expect(asset.toDefinition()).toEqual({
      name: "Index fund",
      assetType: "us-stocks",
      startingValue: 12000,
      expectedReturn: 7.5,
      volatility: 14.2,
      sellProportion: 0.25,
      cashGenerations: [
        {
          name: "Qualified dividends",
          rate: 1.8,
          volatility: 0.5,
          inflationCorrelation: 0,
          taxTreatment: "qualified-dividends",
        },
      ],
      saleTax: {
        costBasis: 4800,
        taxTreatment: "long-term-capital-gains",
      },
    });
  });

  it("preserves an investment starting value formula", () => {
    const asset = new Asset({
      name: "Index fund",
      startingValue: 12000,
      startingValueFormula: "salary * 2",
      expectedReturn: 7.5,
      volatility: 14.2,
      sellProportion: 0.25,
    });

    expect(asset.toDefinition()).toEqual({
      name: "Index fund",
      startingValue: 12000,
      startingValueFormula: "salary * 2",
      expectedReturn: 7.5,
      volatility: 14.2,
      sellProportion: 0.25,
    });
  });

  it("captures retirement asset desired contributions", () => {
    for (const assetType of ["ira", "roth-ira", "401k"] as const) {
      const asset = new Asset({
        name: assetType,
        assetType,
        startingValue: 12000,
        desiredAnnualContribution: 7500,
        expectedReturn: 4,
        volatility: 16,
        sellProportion: 1,
      });

      expect(asset.toDefinition()).toEqual({
        name: assetType,
        assetType,
        startingValue: 12000,
        desiredAnnualContribution: 7500,
        expectedReturn: 4,
        volatility: 16,
        sellProportion: 1,
      });
    }
  });

  it("rejects negative desired retirement contributions", () => {
    expect(
      () =>
        new Asset({
          name: "IRA",
          assetType: "ira",
          startingValue: 0,
          desiredAnnualContribution: -1,
          expectedReturn: 4,
          volatility: 16,
          sellProportion: 1,
        })
    ).toThrow('Desired annual contribution for asset "IRA" cannot be negative.');
  });

  it("rejects non-finite desired retirement contributions", () => {
    expect(
      () =>
        new Asset({
          name: "IRA",
          assetType: "ira",
          startingValue: 0,
          desiredAnnualContribution: Number.NaN,
          expectedReturn: 4,
          volatility: 16,
          sellProportion: 1,
        })
    ).toThrow('Desired annual contribution for asset "IRA" must be finite.');
  });

  it("allows sale tax without an explicit starting cost basis", () => {
    const asset = new Asset({
      name: "Index fund",
      startingValue: 12000,
      expectedReturn: 7.5,
      volatility: 14.2,
      sellProportion: 0.25,
      saleTax: {
        taxTreatment: "long-term-capital-gains",
      },
    });

    expect(asset.toDefinition()).toEqual({
      name: "Index fund",
      startingValue: 12000,
      expectedReturn: 7.5,
      volatility: 14.2,
      sellProportion: 0.25,
      saleTax: {
        taxTreatment: "long-term-capital-gains",
      },
    });
  });

  it("captures a home asset definition", () => {
    const asset = new Asset({
      kind: "home",
      name: "Primary residence",
      initialCost: 800000,
      expectedReturn: 4,
      volatility: 12,
      cashPurchasePercent: 0.2,
      closingCostPercent: 0.03,
      mortgageType: "amortizing",
      mortgageRate: 6.5,
      mortgageTermYears: 30,
      monthlyNonTaxCosts: 1200,
      propertyTaxRate: 1.25,
      purchaseYear: 2024,
    });

    expect(asset.toDefinition()).toEqual({
      kind: "home",
      name: "Primary residence",
      initialCost: 800000,
      expectedReturn: 4,
      volatility: 12,
      cashPurchasePercent: 0.2,
      closingCostPercent: 0.03,
      mortgageType: "amortizing",
      mortgageRate: 6.5,
      mortgageTermYears: 30,
      monthlyNonTaxCosts: 1200,
      propertyTaxRate: 1.25,
      purchaseYear: 2024,
    });
  });

  it("captures a home purchase year", () => {
    const asset = new Asset({
      kind: "home",
      name: "Primary residence",
      initialCost: 800000,
      expectedReturn: 4,
      volatility: 12,
      cashPurchasePercent: 0.2,
      closingCostPercent: 0.03,
      mortgageType: "amortizing",
      mortgageRate: 6.5,
      mortgageTermYears: 30,
      monthlyNonTaxCosts: 1200,
      propertyTaxRate: 1.25,
      purchaseYear: 2024,
    });

    expect(asset.toDefinition()).toEqual({
      kind: "home",
      name: "Primary residence",
      initialCost: 800000,
      expectedReturn: 4,
      volatility: 12,
      cashPurchasePercent: 0.2,
      closingCostPercent: 0.03,
      mortgageType: "amortizing",
      mortgageRate: 6.5,
      mortgageTermYears: 30,
      monthlyNonTaxCosts: 1200,
      propertyTaxRate: 1.25,
      purchaseYear: 2024,
    });
  });

  it("rejects a zero home price", () => {
    expect(
      () =>
        new Asset({
          kind: "home",
          name: "Primary residence",
          initialCost: 0,
          expectedReturn: 4,
          volatility: 12,
          cashPurchasePercent: 0.2,
          closingCostPercent: 0.03,
          mortgageType: "amortizing",
          mortgageRate: 6.5,
          mortgageTermYears: 30,
          monthlyNonTaxCosts: 1200,
          propertyTaxRate: 1.25,
          purchaseYear: 2024,
        })
    ).toThrow('Home price for asset "Primary residence" must be greater than zero.');
  });

  it("preserves a home initial cost formula", () => {
    const asset = new Asset({
      kind: "home",
      name: "Primary residence",
      initialCost: 800000,
      initialCostFormula: "salary * 3",
      expectedReturn: 4,
      volatility: 12,
      cashPurchasePercent: 0.2,
      closingCostPercent: 0.03,
      mortgageType: "amortizing",
      mortgageRate: 6.5,
      mortgageTermYears: 30,
      monthlyNonTaxCosts: 1200,
      propertyTaxRate: 1.25,
      purchaseYear: 2024,
    });

    expect(asset.toDefinition()).toEqual({
      kind: "home",
      name: "Primary residence",
      initialCost: 800000,
      initialCostFormula: "salary * 3",
      expectedReturn: 4,
      volatility: 12,
      cashPurchasePercent: 0.2,
      closingCostPercent: 0.03,
      mortgageType: "amortizing",
      mortgageRate: 6.5,
      mortgageTermYears: 30,
      monthlyNonTaxCosts: 1200,
      propertyTaxRate: 1.25,
      purchaseYear: 2024,
    });
  });

  it("captures an interest-only maturity action for home assets", () => {
    const asset = new Asset({
      kind: "home",
      name: "IO residence",
      initialCost: 800000,
      expectedReturn: 4,
      volatility: 12,
      cashPurchasePercent: 0.2,
      closingCostPercent: 0.03,
      mortgageType: "interest-only",
      interestOnlyMaturityAction: "sell",
      mortgageRate: 6.5,
      mortgageTermYears: 30,
      monthlyNonTaxCosts: 1200,
      propertyTaxRate: 1.25,
      purchaseYear: 2024,
    });

    expect(asset.toDefinition()).toEqual({
      kind: "home",
      name: "IO residence",
      initialCost: 800000,
      expectedReturn: 4,
      volatility: 12,
      cashPurchasePercent: 0.2,
      closingCostPercent: 0.03,
      mortgageType: "interest-only",
      interestOnlyMaturityAction: "sell",
      mortgageRate: 6.5,
      mortgageTermYears: 30,
      monthlyNonTaxCosts: 1200,
      propertyTaxRate: 1.25,
      purchaseYear: 2024,
    });
  });

  it("rejects non-finite asset inputs", () => {
    expect(() =>
      new Asset({
        name: "Broken asset",
        startingValue: Number.POSITIVE_INFINITY,
        expectedReturn: 7,
        volatility: 12,
        sellProportion: 0.5,
      })
    ).toThrow('Starting value for asset "Broken asset" must be finite.');
  });

  it("rejects invalid asset cash generation and sale tax inputs", () => {
    expect(() =>
      new Asset({
        name: "Broken asset",
        startingValue: 1000,
        expectedReturn: 7,
        volatility: 12,
        sellProportion: 0.5,
        cashGenerations: [
          {
            rate: -1,
            volatility: 0,
          },
        ],
      })
    ).toThrow('Cash generation rate for asset "Broken asset" cannot be negative.');

    expect(() =>
      new Asset({
        name: "Broken asset",
        startingValue: 1000,
        expectedReturn: 7,
        volatility: 12,
        sellProportion: 0.5,
        saleTax: {
          costBasis: -1,
        },
      })
    ).toThrow('Cost basis for asset "Broken asset" cannot be negative.');

    expect(() =>
      new Asset({
        name: "Broken asset",
        startingValue: 1000,
        expectedReturn: 7,
        volatility: 12,
        sellProportion: -0.5,
      })
    ).toThrow('Sell multiplier for asset "Broken asset" cannot be negative.');
  });

  it("supports multiple cash generation streams on one asset", () => {
    const asset = new Asset({
      name: "Dividend fund",
      startingValue: 10000,
      expectedReturn: 6,
      volatility: 12,
      sellProportion: 0.25,
      cashGenerations: [
        {
          name: "Qualified dividends",
          rate: 1.2,
          volatility: 0.1,
          taxTreatment: "qualified-dividends",
        },
        {
          name: "Non-qualified dividends",
          rate: 0.4,
          volatility: 0.05,
          taxTreatment: "ordinary-income",
        },
      ],
    });

    const definition = asset.toDefinition();
    expect("cashGenerations" in definition ? definition.cashGenerations : undefined).toEqual([
      {
        name: "Qualified dividends",
        rate: 1.2,
        volatility: 0.1,
        inflationCorrelation: 0,
        taxTreatment: "qualified-dividends",
      },
      {
        name: "Non-qualified dividends",
        rate: 0.4,
        volatility: 0.05,
        inflationCorrelation: 0,
        taxTreatment: "ordinary-income",
      },
    ]);
  });

  it("defaults cash generation inflation correlation by asset type", () => {
    const bondAsset = new Asset({
      name: "Treasury fund",
      assetType: "federal-bonds",
      startingValue: 10000,
      expectedReturn: 0,
      volatility: 4,
      sellProportion: 0.25,
      cashGenerations: [
        {
          name: "Coupon",
          rate: 4,
          volatility: 0.2,
        },
      ],
    });

    const stockAsset = new Asset({
      name: "Stock fund",
      assetType: "us-stocks",
      startingValue: 10000,
      expectedReturn: 6,
      volatility: 12,
      sellProportion: 0.25,
      cashGenerations: [
        {
          name: "Dividend",
          rate: 1.2,
          volatility: 0.1,
        },
      ],
    });

    const bondDefinition = bondAsset.toDefinition();
    const stockDefinition = stockAsset.toDefinition();

    expect("cashGenerations" in bondDefinition ? bondDefinition.cashGenerations : undefined).toEqual([
      {
        name: "Coupon",
        rate: 4,
        volatility: 0.2,
        inflationCorrelation: 0.35,
        taxTreatment: "ordinary-income",
      },
    ]);
    expect("cashGenerations" in stockDefinition ? stockDefinition.cashGenerations : undefined).toEqual([
      {
        name: "Dividend",
        rate: 1.2,
        volatility: 0.1,
        inflationCorrelation: 0,
        taxTreatment: "ordinary-income",
      },
    ]);
  });

  it("normalizes correlation pairs and validates their range", () => {
    expect(
      createAssetCorrelationDefinition({
        assetA: "Bonds",
        assetB: "Stocks",
        correlation: -0.35,
      })
    ).toEqual({
      assetA: "Bonds",
      assetB: "Stocks",
      correlation: -0.35,
    });

    expect(() =>
      createAssetCorrelationDefinition({
        assetA: "Stocks",
        assetB: "Stocks",
        correlation: 0.5,
      })
    ).toThrow("Asset correlation pair must reference two different assets.");

    expect(() =>
      createAssetCorrelationDefinition({
        assetA: "Bonds",
        assetB: "Stocks",
        correlation: -1.1,
      })
    ).toThrow('Correlation for "Bonds" and "Stocks" must be between -1 and 1.');
  });

  it("deletes an asset and removes all attached correlations", () => {
    const result = deleteAssetAndPruneCorrelations(
      [
        { name: "Stocks", startingValue: 10000, expectedReturn: 8, volatility: 16, sellProportion: 0.5 },
        { name: "Bonds", startingValue: 5000, expectedReturn: 4, volatility: 6, sellProportion: 0.25 },
        { name: "Cash", startingValue: 2000, expectedReturn: 2, volatility: 1, sellProportion: 0 },
      ],
      [
        { assetA: "Bonds", assetB: "Stocks", correlation: 0.4 },
        { assetA: "Cash", assetB: "Stocks", correlation: 0.1 },
        { assetA: "Bonds", assetB: "Cash", correlation: 0.2 },
      ],
      "Stocks"
    );

    expect(result.assets.map((asset) => asset.name)).toEqual(["Bonds", "Cash"]);
    expect(result.correlations).toEqual([{ assetA: "Bonds", assetB: "Cash", correlation: 0.2 }]);
  });

  it("allows sell multipliers above one", () => {
    const asset = new Asset({
      name: "Tilting fund",
      startingValue: 5000,
      expectedReturn: 6,
      volatility: 10,
      sellProportion: 2.5,
    });

    expect(asset.toDefinition()).toMatchObject({
      name: "Tilting fund",
      sellProportion: 2.5,
    });
  });
});

describe("resolveAssetValueFormula", () => {
  it("resolves investment starting value formulas from the provided context", () => {
    expect(
      resolveAssetValueFormula(
        {
          name: "Brokerage",
          startingValue: 0,
          startingValueFormula: "salary * 2",
          expectedReturn: 7,
          volatility: 15,
          sellProportion: 1,
        },
        { salary: 250000 }
      )
    ).toEqual({
      name: "Brokerage",
      startingValue: 500000,
      startingValueFormula: "salary * 2",
      expectedReturn: 7,
      volatility: 15,
      sellProportion: 1,
    });
  });

  it("resolves home initial cost formulas from the provided context", () => {
    expect(
      resolveAssetValueFormula(
        {
          kind: "home",
          name: "Primary home",
          initialCost: 0,
          initialCostFormula: "salary * 3",
          expectedReturn: 3,
          volatility: 6,
          cashPurchasePercent: 0.25,
          closingCostPercent: 0.03,
          mortgageType: "amortizing",
          mortgageRate: 6.2,
          mortgageTermYears: 30,
          monthlyNonTaxCosts: 1400,
          propertyTaxRate: 1.15,
          purchaseYear: 2028,
        },
        { salary: 250000 }
      )
    ).toEqual({
      kind: "home",
      name: "Primary home",
      initialCost: 750000,
      initialCostFormula: "salary * 3",
      expectedReturn: 3,
      volatility: 6,
      cashPurchasePercent: 0.25,
      closingCostPercent: 0.03,
      mortgageType: "amortizing",
      mortgageRate: 6.2,
      mortgageTermYears: 30,
      monthlyNonTaxCosts: 1400,
      propertyTaxRate: 1.15,
      purchaseYear: 2028,
    });
  });
});

describe("Flow", () => {
  it("evaluates yearly income from a formula", () => {
    const variables = [
      new Variable({ name: "salary", value: 5000 }),
      new Variable({ name: "bonus", value: 500 }),
    ];
    const flow = new Flow({
      name: "Primary income",
      type: "income",
      formula: "salary + bonus / 2",
    });

    expect(flow.evaluateYearlyAmount(createFormulaContext(variables))).toBe(5250);
    expect(flow.evaluateSignedYearlyAmount(createFormulaContext(variables))).toBe(5250);
  });

  it("returns expenses as negative signed amounts", () => {
    const variables = [new Variable({ name: "rent", value: 1800 })];
    const flow = new Flow({
      name: "Rent",
      type: "expense",
      formula: "rent",
    });

    expect(flow.evaluateYearlyAmount(createFormulaContext(variables))).toBe(1800);
    expect(flow.evaluateSignedYearlyAmount(createFormulaContext(variables))).toBe(-1800);
  });

  it("defaults expenses to inflation adjustment and incomes to none", () => {
    const expense = new Flow({
      name: "Rent",
      type: "expense",
      formula: "rent",
    });
    const income = new Flow({
      name: "Salary",
      type: "income",
      formula: "salary",
      inflationAdjusted: true,
    });

    expect(expense.inflationAdjusted).toBe(true);
    expect(income.inflationAdjusted).toBe(false);
  });

  it("applies annual inflation to opted-in expenses only", () => {
    expect(
      applyFlowExpenseInflation(
        { type: "expense", inflationAdjusted: true },
        -1000,
        2,
        DEFAULT_EXPENSE_INFLATION_RATE
      )
    ).toBeCloseTo(-1060.9, 6);
    expect(
      applyFlowExpenseInflation(
        { type: "expense", inflationAdjusted: false },
        -1000,
        2,
        DEFAULT_EXPENSE_INFLATION_RATE
      )
    ).toBe(-1000);
    expect(
      applyFlowExpenseInflation(
        { type: "income", inflationAdjusted: true },
        1000,
        2,
        DEFAULT_EXPENSE_INFLATION_RATE
      )
    ).toBe(1000);
  });

  it("can activate income for a bounded year range and compound annual raises", () => {
    const variables = [new Variable({ name: "salary", value: 1000 })];
    const context = createFormulaContext(variables);
    const flow = new Flow({
      name: "Salary",
      type: "income",
      formula: "salary",
      startYear: 2027,
      endYear: 2029,
      annualRaisePercent: 10,
    });

    expect(flow.evaluateSignedYearlyAmount(context, { year: 2026 })).toBe(0);
    expect(flow.evaluateSignedYearlyAmount(context, { year: 2027 })).toBe(1000);
    expect(flow.evaluateSignedYearlyAmount(context, { year: 2028 })).toBeCloseTo(1100, 6);
    expect(flow.evaluateSignedYearlyAmount(context, { year: 2029 })).toBeCloseTo(1210, 6);
    expect(flow.evaluateSignedYearlyAmount(context, { year: 2030 })).toBe(0);
  });

  it("can sum flows for a specific year when income timing rules apply", () => {
    const variables = [
      new Variable({ name: "salary", value: 1000 }),
      new Variable({ name: "rent", value: 400 }),
    ];
    const context = createFormulaContext(variables);
    const flows = [
      new Flow({
        name: "Salary",
        type: "income",
        formula: "salary",
        startYear: 2027,
        annualRaisePercent: 5,
      }),
      new Flow({ name: "Rent", type: "expense", formula: "rent" }),
    ];

    expect(sumSignedYearlyFlows(flows, context, { year: 2026 })).toBe(-400);
    expect(sumSignedYearlyFlows(flows, context, { year: 2028 })).toBeCloseTo(650, 6);
  });

  it("can sum multiple yearly flows into a net amount", () => {
    const variables = [
      new Variable({ name: "salary", value: 5000 }),
      new Variable({ name: "rent", value: 1800 }),
      new Variable({ name: "utilities", value: 250 }),
    ];
    const context = createFormulaContext(variables);
    const flows = [
      new Flow({ name: "Salary", type: "income", formula: "salary" }),
      new Flow({ name: "Rent", type: "expense", formula: "rent" }),
      new Flow({ name: "Utilities", type: "expense", formula: "utilities + 50" }),
    ];

    expect(sumSignedYearlyFlows(flows, context)).toBe(2900);
  });

  it("can change a flow formula after creation", () => {
    const variables = [
      new Variable({ name: "salary", value: 5000 }),
      new Variable({ name: "bonus", value: 200 }),
    ];
    const flow = new Flow({ name: "Salary", type: "income", formula: "salary" });

    flow.setFormula("salary + bonus");

    expect(flow.formula).toBe("salary + bonus");
    expect(flow.evaluateSignedYearlyAmount(createFormulaContext(variables))).toBe(5200);
  });
});

describe("Event", () => {
  it("infers the associated flow from a single formula-update target", () => {
    const event = new Event({
      name: "Lease reset",
      schedule: [
        {
          year: { year: 2027 },
          actions: [
            {
              kind: "set-flow-formula",
              flowName: "Rent",
              formula: "rent + 100",
            },
          ],
        },
      ],
    });

    expect(event.flowName).toBe("Rent");
  });

  it("can expand a one-time expense formula into turn-on and turn-off actions", () => {
    const schedule = createOneTimeExpenseSchedule({
      flowName: "Laptop",
      formula: "2400",
      year: { year: 2027 },
    });
    expect(schedule).toHaveLength(1);
    const state = {
      variables: [] as Variable[],
      flows: [] as Flow[],
    };

    applyEventsForYear([new Event({ name: "Laptop purchase", schedule })], { year: 2027 }, state);
    expect(sumSignedYearlyFlows(state.flows, createFormulaContext(state.variables))).toBe(-2400);
  });

  it("can use a formula with variables for a one-time expense", () => {
    const schedule = createOneTimeExpenseSchedule({
      flowName: "Tax bill",
      formula: "taxBillAmount * 0.5",
      year: { year: 2027 },
    });
    const state = {
      variables: [new Variable({ name: "taxBillAmount", value: 1800 })],
      flows: [] as Flow[],
    };

    applyEventsForYear([new Event({ name: "Tax payment", schedule })], { year: 2027 }, state);
    expect(sumSignedYearlyFlows(state.flows, createFormulaContext(state.variables))).toBe(-900);
  });

  it("applies scheduled variable adjustments for a matching year", () => {
    const salary = new Variable({ name: "salary", value: 5000 });
    const event = new Event({
      name: "Annual raise",
      schedule: [
        {
          year: { year: 2027 },
          actions: [
            {
              kind: "adjust-variable",
              variableName: "salary",
              adjustment: { m: 1.1, b: 100 },
            },
          ],
        },
      ],
    });

    event.applyForYear({ year: 2027 }, { variables: [salary], flows: [] });

    expect(salary.value).toBe(5600);
  });

  it("does not apply actions for non-matching years", () => {
    const salary = new Variable({ name: "salary", value: 5000 });
    const event = new Event({
      name: "Annual raise",
      schedule: [
        {
          year: { year: 2027 },
          actions: [
            {
              kind: "adjust-variable",
              variableName: "salary",
              adjustment: { m: 1.1, b: 100 },
            },
          ],
        },
      ],
    });

    event.applyForYear({ year: 2026 }, { variables: [salary], flows: [] });

    expect(salary.value).toBe(5000);
  });

  it("can contain multiple scheduled action groups across years", () => {
    const salary = new Variable({ name: "salary", value: 5000 });
    const bonus = new Variable({ name: "bonus", value: 200 });
    const income = new Flow({ name: "Salary", type: "income", formula: "salary" });
    const event = new Event({
      name: "Comp plan changes",
      schedule: [
        {
          year: { year: 2027 },
          actions: [
            {
              kind: "adjust-variable",
              variableName: "salary",
              adjustment: { m: 1.1, b: 100 },
            },
          ],
        },
        {
          year: { year: 2028 },
          actions: [
            {
              kind: "set-flow-formula",
              flowName: "Salary",
              formula: "salary + bonus",
            },
          ],
        },
      ],
    });

    event.applyForYear({ year: 2027 }, { variables: [salary, bonus], flows: [income] });
    expect(salary.value).toBe(5600);
    expect(income.formula).toBe("salary");

    event.applyForYear({ year: 2028 }, { variables: [salary, bonus], flows: [income] });
    expect(income.formula).toBe("salary + bonus");
    expect(income.evaluateSignedYearlyAmount(createFormulaContext([salary, bonus]))).toBe(5800);
  });

  it("can apply multiple actions in the same year", () => {
    const salary = new Variable({ name: "salary", value: 5000 });
    const stipend = new Variable({ name: "stipend", value: 300 });
    const income = new Flow({ name: "Salary", type: "income", formula: "salary" });
    const event = new Event({
      name: "Promotion",
      schedule: [
        {
          year: { year: 2027 },
          actions: [
            {
              kind: "adjust-variable",
              variableName: "salary",
              adjustment: { m: 1.05, b: 250 },
            },
            {
              kind: "set-flow-formula",
              flowName: "Salary",
              formula: "salary + stipend",
            },
          ],
        },
      ],
    });

    event.applyForYear({ year: 2027 }, { variables: [salary, stipend], flows: [income] });

    expect(salary.value).toBe(5500);
    expect(income.evaluateSignedYearlyAmount(createFormulaContext([salary, stipend]))).toBe(5800);
  });

  it("can apply multiple events for one year", () => {
    const salary = new Variable({ name: "salary", value: 5000 });
    const rent = new Variable({ name: "rent", value: 1800 });
    const income = new Flow({ name: "Salary", type: "income", formula: "salary" });
    const housing = new Flow({ name: "Rent", type: "expense", formula: "rent" });
    const events = [
      new Event({
        name: "Raise",
        schedule: [
          {
            year: { year: 2027 },
            actions: [
              {
                kind: "adjust-variable",
                variableName: "salary",
                adjustment: { m: 1.1, b: 0 },
              },
            ],
          },
        ],
      }),
      new Event({
        name: "Lease reset",
        schedule: [
          {
            year: { year: 2027 },
            actions: [
              {
                kind: "set-flow-formula",
                flowName: "Rent",
                formula: "rent + 100",
              },
            ],
          },
        ],
      }),
    ];

    applyEventsForYear(events, { year: 2027 }, { variables: [salary, rent], flows: [income, housing] });

    expect(sumSignedYearlyFlows([income, housing], createFormulaContext([salary, rent]))).toBe(3600);
  });

  it("can add a variable and a flow from an event", () => {
    const salary = new Variable({ name: "salary", value: 5000 });
    const events = [
      new Event({
        name: "Start side hustle",
        schedule: [
          {
            year: { year: 2027 },
            actions: [
              {
                kind: "add-variable",
                variable: { name: "sideGig", value: 900 },
              },
              {
                kind: "add-flow",
                flow: { name: "Side gig", type: "income", formula: "sideGig" },
              },
            ],
          },
        ],
      }),
    ];
    const state = { variables: [salary], flows: [] as Flow[] };

    applyEventsForYear(events, { year: 2027 }, state);

    expect(state.variables.map((variable) => variable.name)).toEqual(["salary", "sideGig"]);
    expect(state.flows.map((flow) => flow.name)).toEqual(["Side gig"]);
    expect(sumSignedYearlyFlows(state.flows, createFormulaContext(state.variables))).toBe(900);
  });
});
