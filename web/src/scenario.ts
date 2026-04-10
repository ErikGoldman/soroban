import type { SavedPlannerState } from "./storage.js";

export interface ScenarioFile {
  format: "soroban-scenario";
  version: 1;
  exportedAt: string;
  plannerState: ScenarioPlannerState;
}

export type ScenarioPlannerState = Omit<SavedPlannerState, "userId" | "email" | "updatedAt">;

const SCENARIO_FILE_FORMAT = "soroban-scenario";
const SCENARIO_FILE_VERSION = 1;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function buildScenarioFileContents(
  plannerState: ScenarioPlannerState,
  exportedAt = new Date().toISOString()
): string {
  const scenarioFile: ScenarioFile = {
    format: SCENARIO_FILE_FORMAT,
    version: SCENARIO_FILE_VERSION,
    exportedAt,
    plannerState,
  };

  return JSON.stringify(scenarioFile, null, 2);
}

export function extractScenarioPlannerState(value: unknown): ScenarioPlannerState {
  if (!isObjectRecord(value)) {
    throw new Error("Scenario file must contain a JSON object.");
  }

  if (value.format === SCENARIO_FILE_FORMAT) {
    if (value.version !== SCENARIO_FILE_VERSION) {
      throw new Error("Scenario file version is not supported.");
    }
    if (!isObjectRecord(value.plannerState)) {
      throw new Error("Scenario file is missing planner state data.");
    }

    return value.plannerState as ScenarioPlannerState;
  }

  return value as ScenarioPlannerState;
}
