import React from "react";
import ReactDOM from "react-dom/client";

// ── Engine: wire the real Soroban TS modules onto window.SorobanEngine.
// engine-adapter.jsx accesses this lazily (inside runEngineProjection, called
// from React effects — never at module load time), so it's fine that the
// assignment here runs after all the static imports have executed.
import * as FinanceExports from "./finance.js";
import * as TaxExports from "./tax.js";
import * as SimExports from "./simulation.js";
import * as SimInputExports from "./simulation-input.js";
import * as ScenarioExports from "./scenario.js";

(window as any).SorobanEngine = {
  ...FinanceExports,
  ...TaxExports,
  ...SimExports,
  ...SimInputExports,
  ...ScenarioExports,
};
// proto-state.jsx checks SorobanEngineReady to know when to run the first
// projection. Since the engine is available synchronously, resolve immediately.
(window as any).SorobanEngineReady = Promise.resolve((window as any).SorobanEngine);

// ── UI component modules — imported in dependency order.
// Each file runs its Object.assign(window, { ... }) side effect, making its
// exports available as globals before the next file and before React renders.
// JSX files use globals rather than explicit imports; Vite preserves this
// side-effect import order, so every dependency is on window before it's needed.
import "./wf-kit.jsx";
import "./wf-model.jsx";
import "./proto-flipnum.jsx";
import "./engine-adapter.jsx";
import "./wf-chart.jsx";
import "./proto-ui.jsx";
import "./proto-state.jsx";
import "./proto-family.jsx";
import "./proto-versions.jsx";
import "./proto-editor.jsx";
import "./proto-list.jsx";
import "./proto-askai.jsx";
import "./proto-intro.jsx";
import "./proto-breakdown.jsx";
import { App } from "./proto-app.jsx";

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
