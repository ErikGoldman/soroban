export interface SavedCalculation {
  userId: string;
  email: string;
  amount: number;
  years: number;
  finalValue: number;
  updatedAt: string;
}

export interface PersistedEventYear {
  year: number;
}

export interface PersistedFlowDefinition {
  name: string;
  type: "income" | "expense";
  formula: string;
  inflationAdjusted?: boolean;
  startYear?: number;
  endYear?: number;
  annualRaisePercent?: number;
  taxTreatment?:
    | "wages"
    | "ordinary-income"
    | "qualified-dividends"
    | "short-term-capital-gains"
    | "long-term-capital-gains"
    | "tax-exempt-income"
    | "deductible-expense"
    | "nondeductible-expense";
}

export interface PersistedVariableDefinition {
  name: string;
  value: number;
}

export interface PersistedAssetDefinition {
  name: string;
  kind?: "investment" | "home";
  assetType?: "us-stocks" | "federal-bonds" | "local-bonds" | "ira" | "roth-ira" | "401k";
  startingValue?: number;
  startingValueFormula?: string;
  desiredAnnualContribution?: number;
  expectedReturn: number;
  volatility: number;
  sellProportion?: number;
  initialCost?: number;
  initialCostFormula?: string;
  alreadyOwned?: boolean;
  cashPurchasePercent?: number;
  closingCostPercent?: number;
  mortgageType?: "amortizing" | "interest-only";
  interestOnlyMaturityAction?: "payoff" | "refinance" | "sell";
  mortgageRate?: number;
  mortgageTermYears?: number;
  monthlyNonTaxCosts?: number;
  propertyTaxRate?: number;
  purchaseYear?: number;
  cashGeneration?: {
    name?: string;
    rate: number;
    volatility: number;
    inflationCorrelation?: number;
    taxTreatment?:
      | "ordinary-income"
      | "qualified-dividends"
      | "tax-exempt-income"
      | "state-local-exempt"
      | "triple-exempt"
      | "not-taxable";
  };
  cashGenerations?: {
    name?: string;
    rate: number;
    volatility: number;
    inflationCorrelation?: number;
    taxTreatment?:
      | "ordinary-income"
      | "qualified-dividends"
      | "tax-exempt-income"
      | "state-local-exempt"
      | "triple-exempt"
      | "not-taxable";
  }[];
  saleTax?: {
    costBasis?: number;
    taxTreatment?: "short-term-capital-gains" | "long-term-capital-gains" | "not-taxable";
  };
}

export interface PersistedAssetCorrelationDefinition {
  assetA: string;
  assetB: string;
  correlation: number;
}

export interface PersistedEventAction {
  kind: "set-flow-formula" | "adjust-variable" | "add-variable" | "add-flow";
  flowName?: string;
  formula?: string;
  variableName?: string;
  adjustment?: {
    m: number;
    b: number;
  };
  variable?: PersistedVariableDefinition;
  flow?: PersistedFlowDefinition;
}

export interface PersistedScheduledEventAction {
  year: PersistedEventYear;
  actions: PersistedEventAction[];
}

export interface PersistedEventDefinition {
  name: string;
  flowName?: string;
  schedule: PersistedScheduledEventAction[];
}

export interface SavedPlannerState {
  userId: string;
  email: string;
  variables: PersistedVariableDefinition[];
  assets: PersistedAssetDefinition[];
  assetSellWeightMode?: "portfolio-proportion-multiplier";
  taxes?: {
    name: string;
    taxRates: {
      rate: number;
      upTo?: number;
    }[];
    exclusions?: {
      name: string;
      amount: number;
      maximum?: number;
    }[];
    maximum?: number;
    taxableIncomeMultiplier?: number;
  }[];
  taxProfile?: {
    filingStatus?:
      | "individual"
      | "married-couple-jointly"
      | "single"
      | "married-filing-jointly"
      | "married-filing-separately"
      | "head-of-household";
    deductionMode?: "standard" | "itemized";
    federalStandardDeduction?: number;
    saltDeduction?: number;
    saltDeductionCap?: number;
    otherSaltTaxesPaid?: number;
    saltDeductionBaseCap?: number;
    saltDeductionFloorCap?: number;
    saltDeductionPhaseoutThreshold?: number;
    saltDeductionPhaseoutRate?: number;
    otherItemizedDeductions?: number;
    stateTaxableIncomeAdjustment?: number;
    localTaxableIncomeAdjustment?: number;
    niitThreshold?: number;
    federalOrdinaryTaxName?: string;
    federalQualifiedTaxName?: string;
    stateTaxName?: string;
    stateCapitalGainsTaxName?: string;
    localTaxName?: string;
    niitTaxName?: string;
  };
  assetCorrelations: PersistedAssetCorrelationDefinition[];
  flows: PersistedFlowDefinition[];
  events: PersistedEventDefinition[];
  startYear: string;
  yearsToShow: number;
  simulationAttempts?: number;
  simulationCurrentAge?: number;
  simulationTaxPreset?: "nyc" | `state:${string}` | "custom";
  simulationHorizonYears?: number;
  simulationCustomAssetLiquidation?: boolean;
  simulationInflationRate?: number;
  simulationInflation?: {
    preset?: "fixed" | "fixed-custom" | "regime" | "regime-custom";
    mode?: "fixed" | "regime-switching";
    fixedRate?: number;
    regimeSwitching?: {
      lowAverageRate?: number;
      lowVolatility?: number;
      highAverageRate?: number;
      highVolatility?: number;
      lowRate?: number;
      highRate?: number;
      stayLowProbability?: number;
      stayHighProbability?: number;
    };
  };
  simulationVariableSweep?: {
    enabled?: boolean;
    variableName?: string;
    minValue?: number;
    maxValue?: number;
  };
  updatedAt: string;
}

export interface PlanningStorage {
  getLatestCalculation(userId: string): Promise<SavedCalculation | null>;
  saveCalculation(record: Omit<SavedCalculation, "updatedAt">): Promise<SavedCalculation>;
  getPlannerState(userId: string): Promise<SavedPlannerState | null>;
  deletePlannerState(userId: string): Promise<void>;
  savePlannerState(
    record: Omit<SavedPlannerState, "updatedAt">
  ): Promise<SavedPlannerState>;
}

const DB_NAME = "soroban-financial-planner";
const DB_VERSION = 2;
const CALCULATION_STORE_NAME = "calculations";
const PLANNER_STORE_NAME = "planner_state";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.addEventListener("upgradeneeded", () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(CALCULATION_STORE_NAME)) {
        database.createObjectStore(CALCULATION_STORE_NAME, { keyPath: "userId" });
      }

      if (!database.objectStoreNames.contains(PLANNER_STORE_NAME)) {
        database.createObjectStore(PLANNER_STORE_NAME, { keyPath: "userId" });
      }
    });

    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  callback: (
    store: IDBObjectStore,
    resolve: (value: T) => void,
    reject: (error?: unknown) => void
  ) => void
): Promise<T> {
  return openDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        let settled = false;

        const finishResolve = (value: T) => {
          if (!settled) {
            settled = true;
            resolve(value);
          }
        };

        const finishReject = (error?: unknown) => {
          if (!settled) {
            settled = true;
            reject(error);
          }
        };

        transaction.addEventListener("complete", () => {
          database.close();
        });
        transaction.addEventListener("error", () => {
          database.close();
          finishReject(transaction.error);
        });
        transaction.addEventListener("abort", () => {
          database.close();
          finishReject(transaction.error || new Error("IndexedDB transaction aborted"));
        });

        callback(store, finishResolve, finishReject);
      })
  );
}

export class IndexedDbPlanningStorage implements PlanningStorage {
  async getLatestCalculation(userId: string): Promise<SavedCalculation | null> {
    return withStore<SavedCalculation | null>(CALCULATION_STORE_NAME, "readonly", (store, resolve, reject) => {
      const request = store.get(userId);

      request.addEventListener("success", () => {
        resolve((request.result as SavedCalculation | undefined) || null);
      });
      request.addEventListener("error", () => {
        reject(request.error);
      });
    });
  }

  async saveCalculation({
    userId,
    email,
    amount,
    years,
    finalValue,
  }: Omit<SavedCalculation, "updatedAt">): Promise<SavedCalculation> {
    const record: SavedCalculation = {
      userId,
      email,
      amount,
      years,
      finalValue,
      updatedAt: new Date().toISOString(),
    };

    await withStore<void>(CALCULATION_STORE_NAME, "readwrite", (store, resolve, reject) => {
      const request = store.put(record);

      request.addEventListener("success", () => {
        resolve();
      });
      request.addEventListener("error", () => {
        reject(request.error);
      });
    });

    return record;
  }

  async getPlannerState(userId: string): Promise<SavedPlannerState | null> {
    return withStore<SavedPlannerState | null>(PLANNER_STORE_NAME, "readonly", (store, resolve, reject) => {
      const request = store.get(userId);

      request.addEventListener("success", () => {
        resolve((request.result as SavedPlannerState | undefined) || null);
      });
      request.addEventListener("error", () => {
        reject(request.error);
      });
    });
  }

  async deletePlannerState(userId: string): Promise<void> {
    await withStore<void>(PLANNER_STORE_NAME, "readwrite", (store, resolve, reject) => {
      const request = store.delete(userId);

      request.addEventListener("success", () => {
        resolve();
      });
      request.addEventListener("error", () => {
        reject(request.error);
      });
    });
  }

  async savePlannerState({
    userId,
    email,
    variables,
    assets,
    taxes,
    taxProfile,
    assetCorrelations,
    flows,
    events,
    startYear,
    yearsToShow,
    simulationCurrentAge,
    simulationHorizonYears,
    simulationVariableSweep,
  }: Omit<SavedPlannerState, "updatedAt">): Promise<SavedPlannerState> {
    const record: SavedPlannerState = {
      userId,
      email,
      variables,
      assets,
      taxes,
      taxProfile,
      assetCorrelations,
      flows,
      events,
      startYear,
      yearsToShow,
      simulationCurrentAge,
      simulationHorizonYears,
      simulationVariableSweep,
      updatedAt: new Date().toISOString(),
    };

    await withStore<void>(PLANNER_STORE_NAME, "readwrite", (store, resolve, reject) => {
      const request = store.put(record);

      request.addEventListener("success", () => {
        resolve();
      });
      request.addEventListener("error", () => {
        reject(request.error);
      });
    });

    return record;
  }
}

export function createPlanningStorage(): PlanningStorage {
  return new IndexedDbPlanningStorage();
}
