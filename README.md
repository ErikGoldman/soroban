# Soroban Financial Planner

Minimal web app scaffold for a financial planning tool.

## Current state

- Stub auth exposes a current user `id` and `email`.
- Storage is abstracted behind a small interface and currently uses IndexedDB.
- The first feature calculates future value at 4% annual interest and persists the latest result per user.

## Run it

```bash
yarn install
yarn dev
```

Then open the local Vite URL, typically `http://127.0.0.1:5173`.

## Tooling

- `vite` handles the dev server and production build
- `tsc --noEmit` handles typechecking
- App source lives in `web/` and Vite is configured to treat that as the frontend root

## Next obvious extension

Replace `createPlanningStorage()` in `web/src/storage.ts` with a Supabase-backed implementation while keeping the rest of the app unchanged.
