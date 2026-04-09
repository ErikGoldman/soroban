 Findings

  - Critical: Surplus cash is never invested. The engine computes monthly netAmount, but it only reacts
    when that number is negative by liquidating assets; positive cash flow disappears instead of
    building cash or funding accounts. That makes accumulation plans materially wrong. web/src/
    simulation.ts:199 web/src/simulation.ts:228 web/src/main.ts:457
  - Critical: There is no real account model. Assets only carry startingValue, expectedReturn,
    volatility, and sellProportion, and events can only change flows/variables or add new flows/
    variables. That rules out taxable vs IRA/401(k), contribution limits, RMDs, Roth conversions, cost
    basis, debt amortization, insurance cash value, trust entities, and goal buckets. web/src/
    finance.ts:21 web/src/finance.ts:266 web/src/main.ts:620
  - High: Correlation handling is not suitable for professional portfolio modeling. Negative
    correlations are rejected outright, and the Cholesky step silently forces invalid matrices through
    instead of failing validation. That can fabricate diversification behavior. web/src/finance.ts:142
    web/src/simulation.ts:77 web/src/simulation.ts:88
  - High: Return paths are overly smoothed. One annual shock is drawn and then spread across all 12
    months, which understates timing and sequence risk around withdrawals and lumpy events. The test
    suite explicitly locks this behavior in. web/src/simulation.ts:179 web/src/simulation.test.ts:50
  - High: This is not deployable as an advisor tool operationally. Auth is a fixed demo user and
    persistence is browser-local IndexedDB, so there is no household record, permissions, collaboration,
    audit history, scenario versioning, or compliance trail. web/src/auth.ts:6 web/src/storage.ts:88
  - Medium: The formula language is useful but too limited for planning logic. It supports arithmetic
    over variables, not tax brackets, conditionals, date-aware rules, lookup tables, guardrails, or
    policy logic. web/src/finance.ts:3 web/src/finance.ts:229

  What It Gets Right

  - The core mental model is good: recurring flows plus dated events is the right foundation for
    planning. web/src/main.ts:579 web/src/finance.ts:300
  - The simulation engine is cleanly separated from UI and storage, which makes a later engine rewrite
    practical. web/src/simulation.ts:144 web/src/storage.ts:79
  - Percentile outputs, depletion probabilities, and per-asset yearly detail are useful advisor-facing
    presentation primitives. web/src/simulation.ts:25 web/src/main.ts:1065
  - The test coverage is solid for a small system, especially around parser behavior and simulation
    mechanics. web/src/finance.test.ts:20 web/src/simulation.test.ts:21

  What To Add Or Change

  - First, redesign the domain model around household, person, account, asset holding, liability, income
    source, goal, tax profile, and planning scenario.
  - Next, build a real cash engine: surplus cash should sweep somewhere, contributions should fund named
    accounts, withdrawals should follow configurable ordering, and liabilities should amortize.
  - Then add tax/account rules: taxable income, payroll tax, capital gains, dividends/interest, account
    wrappers, contribution caps, RMDs, Social Security and pension timing.
  - Upgrade the Monte Carlo layer: monthly or quarterly draws, inflation as its own process, negative
    correlations, matrix validation, optional fat tails/regimes, and assumptions sets by asset class.
  - Add advisor workflow features: saved scenarios, compare view, notes, assumptions provenance, client-
    ready output, and server-backed auth/storage with audit history