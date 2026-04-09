import { buildSimulationExecution, type BuildSimulationScenariosInput } from "./simulation.js";
import { Tax, type TaxDefinition } from "./tax.js";

export interface SimulationWorkerRunInput
  extends Omit<BuildSimulationScenariosInput, "taxes" | "nextStandardNormal"> {
  taxes: readonly TaxDefinition[];
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
        ...message.input,
        taxes: message.input.taxes.map((tax) => new Tax(tax)),
      },
      {
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
