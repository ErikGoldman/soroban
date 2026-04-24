import { buildSimulationExecution, type BuildSimulationScenariosInput } from "./simulation.js";
import { Tax, type TaxDefinition } from "./tax.js";

export interface SimulationWorkerRunInput
  extends Omit<BuildSimulationScenariosInput, "taxes" | "nextStandardNormal"> {
  taxes: readonly TaxDefinition[];
  detailSampleLimit?: number | null;
  includeAggregates?: boolean;
}

export interface SimulationWorkerProgressMessage {
  type: "progress";
  requestId: number;
  completedAttempts: number;
  totalAttempts: number;
}

export interface SimulationWorkerCompleteMessage {
  type: "complete";
  requestId: number;
  scenarios: ReturnType<typeof buildSimulationExecution>["scenarios"];
  details: ReturnType<typeof buildSimulationExecution>["details"];
  yearlyTotals?: ReturnType<typeof buildSimulationExecution>["yearlyTotals"];
  yearlyLiquidTotals?: ReturnType<typeof buildSimulationExecution>["yearlyLiquidTotals"];
  bankruptcyCountsByYear?: ReturnType<typeof buildSimulationExecution>["bankruptcyCountsByYear"];
  depletionCountsByYear?: ReturnType<typeof buildSimulationExecution>["depletionCountsByYear"];
}

export interface SimulationWorkerErrorMessage {
  type: "error";
  requestId: number;
  message: string;
}

export type SimulationWorkerResponse =
  | SimulationWorkerProgressMessage
  | SimulationWorkerCompleteMessage
  | SimulationWorkerErrorMessage;

interface SimulationWorkerRunMessage {
  type: "run";
  requestId: number;
  input: SimulationWorkerRunInput;
}

type SimulationWorkerRequest = SimulationWorkerRunMessage;

self.onmessage = (event: MessageEvent<SimulationWorkerRequest>) => {
  const message = event.data;
  if (!message || message.type !== "run") {
    return;
  }

  try {
    const result = buildSimulationExecution(
      {
        attempts: message.input.attempts,
        horizonYears: message.input.horizonYears,
        currentAge: message.input.currentAge,
        yearlyPlans: message.input.yearlyPlans,
        assets: message.input.assets,
        assetCorrelations: message.input.assetCorrelations,
        inflation: message.input.inflation,
        householdTaxProfile: message.input.householdTaxProfile,
        taxes: message.input.taxes.map((tax) => new Tax(tax)),
      },
      {
        detailSampleLimit: message.input.detailSampleLimit,
        includeAggregates: message.input.includeAggregates,
        onProgress: ({ completedAttempts, totalAttempts }) => {
          const progressMessage: SimulationWorkerProgressMessage = {
            type: "progress",
            requestId: message.requestId,
            completedAttempts,
            totalAttempts,
          };
          self.postMessage(progressMessage);
        },
      }
    );
    const completeMessage: SimulationWorkerCompleteMessage = {
      type: "complete",
      requestId: message.requestId,
      scenarios: result.scenarios,
      details: result.details,
      ...(result.yearlyTotals ? { yearlyTotals: result.yearlyTotals } : {}),
      ...(result.yearlyLiquidTotals ? { yearlyLiquidTotals: result.yearlyLiquidTotals } : {}),
      ...(result.bankruptcyCountsByYear ? { bankruptcyCountsByYear: result.bankruptcyCountsByYear } : {}),
      ...(result.depletionCountsByYear ? { depletionCountsByYear: result.depletionCountsByYear } : {}),
    };
    self.postMessage(completeMessage);
  } catch (error) {
    const errorMessage: SimulationWorkerErrorMessage = {
      type: "error",
      requestId: message.requestId,
      message: error instanceof Error ? error.message : "Simulation failed.",
    };
    self.postMessage(errorMessage);
  }
};
