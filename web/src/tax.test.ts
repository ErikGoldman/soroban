import { describe, expect, it } from "vitest";

import { calculateTax, computeHouseholdTaxes, createDefaultHouseholdTaxProfile, Tax, TaxExclusion, TaxRate } from "./tax.js";

describe("TaxRate", () => {
  it("rejects invalid rate inputs", () => {
    expect(() => new TaxRate({ rate: Number.NaN })).toThrow("Tax rate must be finite.");
    expect(() => new TaxRate({ rate: -0.01 })).toThrow("Tax rate cannot be negative.");
    expect(() => new TaxRate({ rate: 0.1, upTo: Number.POSITIVE_INFINITY })).toThrow(
      "Tax rate upper bound must be finite."
    );
    expect(() => new TaxRate({ rate: 0.1, upTo: -1 })).toThrow("Tax rate upper bound cannot be negative.");
  });
});

describe("TaxExclusion", () => {
  it("caps an exclusion by its own maximum and the available gains", () => {
    const exclusion = new TaxExclusion({ name: "SALT", amount: 15000, maximum: 10000 });

    expect(exclusion.getExcludedAmount(20000)).toBe(10000);
    expect(exclusion.getExcludedAmount(8000)).toBe(8000);
  });

  it("rejects invalid exclusion inputs", () => {
    expect(() => new TaxExclusion({ name: "", amount: 1000 })).toThrow("Tax exclusion name is required.");
    expect(() => new TaxExclusion({ name: "SALT", amount: Number.NaN })).toThrow(
      'Exclusion amount for "SALT" must be finite.'
    );
    expect(() => new TaxExclusion({ name: "SALT", amount: -1 })).toThrow(
      'Exclusion amount for "SALT" cannot be negative.'
    );
    expect(() => new TaxExclusion({ name: "SALT", amount: 1000, maximum: -1 })).toThrow(
      'Exclusion maximum for "SALT" cannot be negative.'
    );
  });
});

describe("Tax", () => {
  it("calculates graduated taxes across multiple brackets", () => {
    const tax = new Tax({
      name: "Federal capital gains",
      taxRates: [
        { rate: 0.1, upTo: 10000 },
        { rate: 0.2, upTo: 30000 },
        { rate: 0.3 },
      ],
    });

    expect(tax.calculateTax(50000)).toEqual({
      taxName: "Federal capital gains",
      gains: 50000,
      excludedGains: 0,
      taxableGains: 50000,
      tax: 11000,
    });
  });

  it("treats bracket upper bounds as cumulative thresholds", () => {
    const tax = new Tax({
      name: "Boundary test",
      taxRates: [
        { rate: 0.1, upTo: 10000 },
        { rate: 0.2, upTo: 30000 },
        { rate: 0.3 },
      ],
    });

    expect(tax.calculateTax(10000).tax).toBe(1000);
    expect(tax.calculateTax(30000).tax).toBe(5000);
  });

  it("applies exclusions before computing tax", () => {
    const tax = new Tax({
      name: "State tax",
      exclusions: [
        { name: "SALT", amount: 15000, maximum: 10000 },
        { name: "Personal deduction", amount: 3000 },
      ],
      taxRates: [{ rate: 0.05 }],
    });

    expect(tax.calculateTax(25000)).toEqual({
      taxName: "State tax",
      gains: 25000,
      excludedGains: 13000,
      taxableGains: 12000,
      tax: 600,
    });
  });

  it("does not let combined exclusions exceed gains", () => {
    const tax = new Tax({
      name: "Local tax",
      exclusions: [
        { name: "Exclusion A", amount: 7000 },
        { name: "Exclusion B", amount: 7000 },
      ],
      taxRates: [{ rate: 0.1 }],
    });

    expect(tax.calculateTax(10000)).toEqual({
      taxName: "Local tax",
      gains: 10000,
      excludedGains: 10000,
      taxableGains: 0,
      tax: 0,
    });
  });

  it("caps the resulting tax when a maximum is provided", () => {
    const tax = new Tax({
      name: "NIIT-style surcharge",
      maximum: 300,
      taxRates: [{ rate: 0.038 }],
    });

    expect(tax.calculateTax(10000)).toEqual({
      taxName: "NIIT-style surcharge",
      gains: 10000,
      excludedGains: 0,
      taxableGains: 10000,
      tax: 300,
    });
  });

  it("treats negative gains as zero", () => {
    const tax = new Tax({
      name: "Zero floor tax",
      taxRates: [{ rate: 0.1 }],
    });

    expect(tax.calculateTax(-500)).toEqual({
      taxName: "Zero floor tax",
      gains: 0,
      excludedGains: 0,
      taxableGains: 0,
      tax: 0,
    });
  });

  it("rejects invalid tax definitions", () => {
    expect(() => new Tax({ name: "", taxRates: [{ rate: 0.1 }] })).toThrow("Tax name is required.");
    expect(() => new Tax({ name: "Broken", taxRates: [] })).toThrow('Tax "Broken" requires at least one tax rate.');
    expect(() =>
      new Tax({
        name: "Broken",
        taxRates: [{ rate: 0.1 }, { rate: 0.2, upTo: 1000 }],
      })
    ).toThrow('Tax "Broken" cannot define rates after an uncapped bracket.');
    expect(() =>
      new Tax({
        name: "Broken",
        taxRates: [{ rate: 0.1, upTo: 1000 }, { rate: 0.2, upTo: 1000 }],
      })
    ).toThrow('Tax "Broken" tax rate upper bounds must increase strictly.');
    expect(() => new Tax({ name: "Broken", taxRates: [{ rate: 0.1 }], maximum: -1 })).toThrow(
      'Maximum tax for "Broken" cannot be negative.'
    );
  });
});

describe("calculateTax", () => {
  it("aggregates the results across multiple taxes", () => {
    const taxes = [
      new Tax({
        name: "Federal",
        taxRates: [
          { rate: 0.1, upTo: 10000 },
          { rate: 0.2 },
        ],
      }),
      new Tax({
        name: "State",
        exclusions: [{ name: "State deduction", amount: 5000 }],
        taxRates: [{ rate: 0.05 }],
      }),
    ];

    expect(calculateTax(25000, taxes)).toEqual({
      gains: 25000,
      totalExcludedGains: 5000,
      totalTaxableGains: 45000,
      totalTax: 5000,
      taxes: [
        {
          taxName: "Federal",
          gains: 25000,
          excludedGains: 0,
          taxableGains: 25000,
          tax: 4000,
        },
        {
          taxName: "State",
          gains: 25000,
          excludedGains: 5000,
          taxableGains: 20000,
          tax: 1000,
        },
      ],
    });
  });

  it("rejects non-finite gains", () => {
    expect(() => calculateTax(Number.POSITIVE_INFINITY, [])).toThrow("Gains must be finite.");
  });
});

describe("computeHouseholdTaxes", () => {
  it("nets short-term losses against long-term gains before taxing the remainder", () => {
    const profile = {
      ...createDefaultHouseholdTaxProfile(),
      federalStandardDeduction: 0,
      federalOrdinaryTaxName: "Federal ordinary income",
      federalQualifiedTaxName: "Federal qualified dividends / long-term gains",
      stateTaxName: "",
      localTaxName: "",
      niitTaxName: "",
    };
    const taxes = [
      new Tax({ name: "Federal ordinary income", taxRates: [{ rate: 0.2 }] }),
      new Tax({ name: "Federal qualified dividends / long-term gains", taxRates: [{ rate: 0.1 }] }),
    ];

    const result = computeHouseholdTaxes(
      {
        wages: 0,
        ordinaryIncome: 0,
        qualifiedDividends: 0,
        shortTermCapitalGains: -400,
        longTermCapitalGains: 1000,
        taxExemptIncome: 0,
        stateLocalExemptIncome: 0,
        tripleExemptIncome: 0,
        deductibleExpenses: 0,
      },
      profile,
      taxes
    );

    expect(result.federalOrdinaryTaxableIncome).toBe(0);
    expect(result.federalPreferentialIncome).toBe(600);
    expect(result.totalTax).toBeCloseTo(60, 6);
  });

  it("does not let net capital losses reduce ordinary taxable income below zero", () => {
    const profile = {
      ...createDefaultHouseholdTaxProfile(),
      federalStandardDeduction: 0,
      federalOrdinaryTaxName: "Federal ordinary income",
      federalQualifiedTaxName: "Federal qualified dividends / long-term gains",
      stateTaxName: "",
      localTaxName: "",
      niitTaxName: "",
    };
    const taxes = [
      new Tax({ name: "Federal ordinary income", taxRates: [{ rate: 0.2 }] }),
      new Tax({ name: "Federal qualified dividends / long-term gains", taxRates: [{ rate: 0.1 }] }),
    ];

    const result = computeHouseholdTaxes(
      {
        wages: 1000,
        ordinaryIncome: 0,
        qualifiedDividends: 0,
        shortTermCapitalGains: -1500,
        longTermCapitalGains: 0,
        taxExemptIncome: 0,
        stateLocalExemptIncome: 0,
        tripleExemptIncome: 0,
        deductibleExpenses: 0,
      },
      profile,
      taxes
    );

    expect(result.federalOrdinaryTaxableIncome).toBe(1000);
    expect(result.federalPreferentialIncome).toBe(0);
    expect(result.totalTax).toBeCloseTo(200, 6);
  });

  it("limits NIIT to MAGI above the threshold when investment income is larger", () => {
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
    const taxes = [new Tax({ name: "Federal NIIT", taxRates: [{ rate: 0.038 }] })];

    const result = computeHouseholdTaxes(
      {
        wages: 210000,
        ordinaryIncome: 0,
        qualifiedDividends: 50000,
        shortTermCapitalGains: 0,
        longTermCapitalGains: 0,
        taxExemptIncome: 0,
        stateLocalExemptIncome: 0,
        tripleExemptIncome: 0,
        deductibleExpenses: 0,
      },
      profile,
      taxes
    );

    expect(result.modifiedAdjustedGrossIncome).toBe(260000);
    expect(result.netInvestmentIncome).toBe(50000);
    expect(result.niitIncomeAboveThreshold).toBe(60000);
    expect(result.niitTaxableIncome).toBe(50000);
    expect(result.taxByName.get("Federal NIIT")).toBeCloseTo(1900, 6);
  });

  it("limits NIIT to net investment income when MAGI above threshold is larger", () => {
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
    const taxes = [new Tax({ name: "Federal NIIT", taxRates: [{ rate: 0.038 }] })];

    const result = computeHouseholdTaxes(
      {
        wages: 300000,
        ordinaryIncome: 0,
        qualifiedDividends: 20000,
        shortTermCapitalGains: 0,
        longTermCapitalGains: 0,
        taxExemptIncome: 0,
        stateLocalExemptIncome: 0,
        tripleExemptIncome: 0,
        deductibleExpenses: 0,
      },
      profile,
      taxes
    );

    expect(result.modifiedAdjustedGrossIncome).toBe(320000);
    expect(result.netInvestmentIncome).toBe(20000);
    expect(result.niitIncomeAboveThreshold).toBe(120000);
    expect(result.niitTaxableIncome).toBe(20000);
    expect(result.taxByName.get("Federal NIIT")).toBeCloseTo(760, 6);
  });

  it("reduces NIIT MAGI and net investment income by deductible expenses", () => {
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
    const taxes = [new Tax({ name: "Federal NIIT", taxRates: [{ rate: 0.038 }] })];

    const result = computeHouseholdTaxes(
      {
        wages: 190000,
        ordinaryIncome: 0,
        qualifiedDividends: 30000,
        shortTermCapitalGains: 0,
        longTermCapitalGains: 0,
        taxExemptIncome: 0,
        stateLocalExemptIncome: 0,
        tripleExemptIncome: 0,
        deductibleExpenses: 15000,
      },
      profile,
      taxes
    );

    expect(result.modifiedAdjustedGrossIncome).toBe(205000);
    expect(result.netInvestmentIncome).toBe(15000);
    expect(result.niitIncomeAboveThreshold).toBe(5000);
    expect(result.niitTaxableIncome).toBe(5000);
    expect(result.taxByName.get("Federal NIIT")).toBeCloseTo(190, 6);
  });

  it("produces no NIIT when deductions fully offset investment income", () => {
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
    const taxes = [new Tax({ name: "Federal NIIT", taxRates: [{ rate: 0.038 }] })];

    const result = computeHouseholdTaxes(
      {
        wages: 220000,
        ordinaryIncome: 0,
        qualifiedDividends: 10000,
        shortTermCapitalGains: 0,
        longTermCapitalGains: 0,
        taxExemptIncome: 0,
        stateLocalExemptIncome: 0,
        tripleExemptIncome: 0,
        deductibleExpenses: 10000,
      },
      profile,
      taxes
    );

    expect(result.modifiedAdjustedGrossIncome).toBe(220000);
    expect(result.netInvestmentIncome).toBe(0);
    expect(result.niitIncomeAboveThreshold).toBe(20000);
    expect(result.niitTaxableIncome).toBe(0);
    expect(result.taxByName.get("Federal NIIT")).toBeCloseTo(0, 6);
  });

  it("computes itemized deductions from mortgage interest plus SALT with the cap rules", () => {
    const profile = {
      ...createDefaultHouseholdTaxProfile(),
      deductionMode: "itemized" as const,
      federalStandardDeduction: 0,
      otherSaltTaxesPaid: 5000,
      saltDeductionBaseCap: 40000,
      saltDeductionFloorCap: 10000,
      saltDeductionPhaseoutThreshold: 500000,
      saltDeductionPhaseoutRate: 0.3,
      otherItemizedDeductions: 2000,
      federalOrdinaryTaxName: "Federal ordinary income",
      federalQualifiedTaxName: "",
      stateTaxName: "",
      localTaxName: "",
      niitTaxName: "",
    };
    const taxes = [new Tax({ name: "Federal ordinary income", taxRates: [{ rate: 0.1 }] })];

    const result = computeHouseholdTaxes(
      {
        wages: 300000,
        ordinaryIncome: 0,
        qualifiedDividends: 0,
        shortTermCapitalGains: 0,
        longTermCapitalGains: 0,
        taxExemptIncome: 0,
        stateLocalExemptIncome: 0,
        tripleExemptIncome: 0,
        deductibleExpenses: 0,
        saltTaxesPaid: 15000,
        homeMortgageInterestPaid: 36000,
        homeMortgageAverageBalance: 700000,
        homeMortgageInterestDebtLimit: 750000,
      },
      profile,
      taxes
    );

    expect(result.saltDeductionUsed).toBe(20000);
    expect(result.deductibleMortgageInterest).toBe(36000);
    expect(result.otherItemizedDeductionsUsed).toBe(2000);
    expect(result.deductionUsed).toBe(58000);
    expect(result.federalOrdinaryTaxableIncome).toBe(242000);
  });

  it("treats tax-exempt income as exempt federally but taxable to state and local by default", () => {
    const profile = {
      ...createDefaultHouseholdTaxProfile(),
      federalStandardDeduction: 0,
      federalOrdinaryTaxName: "Federal ordinary income",
      federalQualifiedTaxName: "",
      stateTaxName: "State tax",
      localTaxName: "Local tax",
      niitTaxName: "",
    };
    const taxes = [
      new Tax({ name: "Federal ordinary income", taxRates: [{ rate: 0.2 }] }),
      new Tax({ name: "State tax", taxRates: [{ rate: 0.1 }] }),
      new Tax({ name: "Local tax", taxRates: [{ rate: 0.05 }] }),
    ];

    const result = computeHouseholdTaxes(
      {
        wages: 0,
        ordinaryIncome: 0,
        qualifiedDividends: 0,
        shortTermCapitalGains: 0,
        longTermCapitalGains: 0,
        taxExemptIncome: 100,
        stateLocalExemptIncome: 0,
        tripleExemptIncome: 0,
        deductibleExpenses: 0,
      },
      profile,
      taxes
    );

    expect(result.federalOrdinaryTaxableIncome).toBe(0);
    expect(result.stateTaxableIncome).toBe(100);
    expect(result.localTaxableIncome).toBe(100);
    expect(result.taxByName.get("Federal ordinary income")).toBeCloseTo(0, 6);
    expect(result.taxByName.get("State tax")).toBeCloseTo(10, 6);
    expect(result.taxByName.get("Local tax")).toBeCloseTo(5, 6);
  });

  it("treats state-local exempt income as federally taxable but exempt from state and local tax", () => {
    const profile = {
      ...createDefaultHouseholdTaxProfile(),
      federalStandardDeduction: 0,
      federalOrdinaryTaxName: "Federal ordinary income",
      federalQualifiedTaxName: "",
      stateTaxName: "State tax",
      localTaxName: "Local tax",
      niitTaxName: "Federal NIIT",
      niitThreshold: 0,
    };
    const taxes = [
      new Tax({ name: "Federal ordinary income", taxRates: [{ rate: 0.2 }] }),
      new Tax({ name: "State tax", taxRates: [{ rate: 0.1 }] }),
      new Tax({ name: "Local tax", taxRates: [{ rate: 0.05 }] }),
      new Tax({ name: "Federal NIIT", taxRates: [{ rate: 0.038 }] }),
    ];

    const result = computeHouseholdTaxes(
      {
        wages: 0,
        ordinaryIncome: 0,
        qualifiedDividends: 0,
        shortTermCapitalGains: 0,
        longTermCapitalGains: 0,
        taxExemptIncome: 0,
        stateLocalExemptIncome: 100,
        tripleExemptIncome: 0,
        deductibleExpenses: 0,
      },
      profile,
      taxes
    );

    expect(result.federalOrdinaryTaxableIncome).toBe(100);
    expect(result.stateTaxableIncome).toBe(0);
    expect(result.localTaxableIncome).toBe(0);
    expect(result.netInvestmentIncome).toBe(100);
    expect(result.modifiedAdjustedGrossIncome).toBe(100);
    expect(result.taxByName.get("Federal ordinary income")).toBeCloseTo(20, 6);
    expect(result.taxByName.get("State tax")).toBeCloseTo(0, 6);
    expect(result.taxByName.get("Local tax")).toBeCloseTo(0, 6);
    expect(result.taxByName.get("Federal NIIT")).toBeCloseTo(3.8, 6);
  });

  it("treats triple-exempt income as exempt from federal, state, and local tax", () => {
    const profile = {
      ...createDefaultHouseholdTaxProfile(),
      federalStandardDeduction: 0,
      federalOrdinaryTaxName: "Federal ordinary income",
      federalQualifiedTaxName: "",
      stateTaxName: "State tax",
      localTaxName: "Local tax",
      niitTaxName: "Federal NIIT",
      niitThreshold: 0,
    };
    const taxes = [
      new Tax({ name: "Federal ordinary income", taxRates: [{ rate: 0.2 }] }),
      new Tax({ name: "State tax", taxRates: [{ rate: 0.1 }] }),
      new Tax({ name: "Local tax", taxRates: [{ rate: 0.05 }] }),
      new Tax({ name: "Federal NIIT", taxRates: [{ rate: 0.038 }] }),
    ];

    const result = computeHouseholdTaxes(
      {
        wages: 0,
        ordinaryIncome: 0,
        qualifiedDividends: 0,
        shortTermCapitalGains: 0,
        longTermCapitalGains: 0,
        taxExemptIncome: 0,
        stateLocalExemptIncome: 0,
        tripleExemptIncome: 100,
        deductibleExpenses: 0,
      },
      profile,
      taxes
    );

    expect(result.federalOrdinaryTaxableIncome).toBe(0);
    expect(result.stateTaxableIncome).toBe(0);
    expect(result.localTaxableIncome).toBe(0);
    expect(result.netInvestmentIncome).toBe(0);
    expect(result.modifiedAdjustedGrossIncome).toBe(0);
    expect(result.totalTax).toBeCloseTo(0, 6);
  });
});
