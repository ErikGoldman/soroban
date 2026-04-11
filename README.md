# Soroban Financial Planner

Soroban is a browser-based financial planning sandbox built with TypeScript and Vite. It lets you model household cash flows with formulas, apply scheduled events over time, define taxable assets, and run Monte Carlo portfolio simulations directly in the browser.

## What the app does

- Creates planner variables such as `salary`, `rent`, and `groceries`
- Defines recurring income and expense flows using formulas
- Applies dated events that can:
  - change a flow formula
  - adjust a variable with `m * x + b`
  - add a new variable
  - add a new flow
  - create one-time expenses
- Models assets with:
  - starting value
  - expected annual return
  - volatility
  - optional cash generation streams
  - optional sale tax basis and tax treatment
  - pairwise correlations
- Configures household taxes and tax profiles, including a built-in NYC 2025 preset
- Runs Monte Carlo simulations with percentile views, depletion probability, and representative scenario detail
- Persists planner state locally in IndexedDB

## Tech stack

- TypeScript
- Vite
- Vitest
- Browser APIs: IndexedDB and Web Workers

## Getting started

### Requirements

- Node.js 18+
- Yarn 1.x

### Install

```bash
yarn install
```

### Start the dev server

```bash
yarn dev
```

Vite serves the frontend from [`web/`](/home/erikg/projects/soroban/main/web), usually at `http://127.0.0.1:5173` or `http://localhost:5173`.

### Build for production

```bash
yarn build
```

The production build is emitted to [`dist/`](/home/erikg/projects/soroban/main/dist).

### Run tests

```bash
yarn test
```

## Available scripts

- `yarn dev` starts the Vite dev server
- `yarn build` runs typechecking and creates a production bundle
- `yarn preview` previews the production build locally
- `yarn test` runs the Vitest suite

## How to use it

1. Open the app and review the default planner state.
2. Add or edit variables, flows, assets, taxes, and scheduled events in the Setup view.
3. Optionally load the NYC 2025 tax preset.
4. Move to the Simulation view, choose the start year, horizon, and attempt count.
5. Optionally adjust each asset's sell multiplier. A multiplier of `1` sells in line with the asset's current portfolio weight.
6. Run the simulation and review percentile paths, depletion probability, and detailed example years.

## Project structure

- [`package.json`](/home/erikg/projects/soroban/main/package.json) contains scripts and tool metadata
- [`vite.config.ts`](/home/erikg/projects/soroban/main/vite.config.ts) configures Vite with [`web/`](/home/erikg/projects/soroban/main/web) as the frontend root
- [`web/src/main.ts`](/home/erikg/projects/soroban/main/web/src/main.ts) contains the application UI, state management, persistence wiring, and simulation orchestration
- [`web/src/finance.ts`](/home/erikg/projects/soroban/main/web/src/finance.ts) contains formula parsing, planner domain objects, and event logic
- [`web/src/tax.ts`](/home/erikg/projects/soroban/main/web/src/tax.ts) contains the tax engine and default household tax profile logic
- [`web/src/simulation.ts`](/home/erikg/projects/soroban/main/web/src/simulation.ts) contains the Monte Carlo engine and percentile aggregation
- [`web/src/simulation-worker.ts`](/home/erikg/projects/soroban/main/web/src/simulation-worker.ts) runs simulation work in browser workers
- [`web/src/storage.ts`](/home/erikg/projects/soroban/main/web/src/storage.ts) persists planner data in IndexedDB
- [`web/src/*.test.ts`](/home/erikg/projects/soroban/main/web/src) covers the formula engine, taxes, and simulation behavior

## Deploy with Firebase Hosting

This app is a static Vite frontend, so the production deploy only needs the built files in [`dist/`](/home/erikg/projects/soroban/main/dist). Firebase Hosting is a better fit than Cloud Run here because it serves the built assets directly from a CDN, gives you default `*.web.app` and `*.firebaseapp.com` URLs, and supports custom domains with managed SSL.

### Files used for hosting

- [`firebase.json`](/home/erikg/projects/soroban/main/firebase.json) points Hosting at the built `dist/` directory
- [`package.json`](/home/erikg/projects/soroban/main/package.json) includes deploy and local Hosting commands

### Requirements

- Node.js 18+
- Yarn 1.x
- Firebase CLI installed locally
- a Firebase project linked to a Google Cloud project with billing if you expect usage beyond the free tier

Install the Firebase CLI if needed:

```bash
npm install -g firebase-tools
```

### One-time setup

Log in and attach this repo to your Firebase project:

```bash
firebase login
firebase use --add
```

The second command creates a local `.firebaserc` file with your selected project alias.

### Deploy

From the repo root:

```bash
yarn deploy:firebase
```

That builds the Vite app and deploys Hosting only. Firebase will print your public site URLs, usually `PROJECT_ID.web.app` and `PROJECT_ID.firebaseapp.com`.

### Local preview

```bash
yarn build
yarn serve:firebase
```

### Custom domain

After the first deploy, connect your custom domain in the Firebase console under Hosting. Firebase Hosting provisions SSL certificates for custom domains and tells you which DNS records to create.

Typical flow:

1. Open Hosting in the Firebase console.
2. Choose `Add custom domain`.
3. Enter the apex domain or subdomain you want to use.
4. Add the DNS records Firebase gives you at your DNS provider.
5. Wait for verification and certificate provisioning.

Official docs:

- https://firebase.google.com/docs/hosting/quickstart
- https://firebase.google.com/docs/hosting/full-config
- https://firebase.google.com/docs/hosting/custom-domain

## Current behavior and constraints

- Authentication is currently a stubbed demo user defined in [`web/src/auth.ts`](/home/erikg/projects/soroban/main/web/src/auth.ts).
- Persistence is local to the browser via IndexedDB. There is no backend sync, multi-user support, or server-side storage.
- The simulation operates on yearly snapshots and annual return assumptions.
- The simulation UI currently exposes a single tax preset option: `NYC`.
- Simulations require at least one asset. By default, sales track current portfolio weights, and sell multipliers let you tilt that mix.

## Notes for future extension

- Swap the IndexedDB storage implementation behind `createPlanningStorage()` for a server-backed store without rewriting the rest of the app.
- Replace the stub auth service with a real identity provider.
- Expand the domain model if the planner needs account wrappers, liabilities, or more detailed household planning behavior.
