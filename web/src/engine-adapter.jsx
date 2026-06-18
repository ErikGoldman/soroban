// engine-adapter.jsx — maps the prototype's plan model onto the real Soroban
// engine (Monte Carlo simulation with taxes, asset volatility and mortgage-
// aware homes) and returns a chart-ready median net-worth series.

// the engine's asset types (finance.ts InvestmentAssetType + home), with typical defaults
const ASSET_TYPES = [
  { value: 'us-stocks', label: 'US stocks', growth: 0.06, vol: 0.15 },
  { value: 'federal-bonds', label: 'Federal bonds', growth: 0.03, vol: 0.05 },
  { value: 'local-bonds', label: 'Local bonds', growth: 0.025, vol: 0.04 },
  { value: 'ira', label: 'IRA', growth: 0.06, vol: 0.15 },
  { value: 'roth-ira', label: 'Roth IRA', growth: 0.06, vol: 0.15 },
  { value: '401k', label: '401(k)', growth: 0.06, vol: 0.15 },
  { value: 'home', label: 'Home', growth: 0.035, vol: 0.08 },
];
const RETIREMENT_TYPES = ['ira', 'roth-ira', '401k'];

// home settings stored on asset items (all rates as fractions; engine units converted below)
const HOME_DEFAULTS = { down: 0.25, closing: 0.02, rate: 0.06, term: 30, monthly: 0, propTax: 0.01, monthlyInflation: true };

// is this asset treated as a home? explicit type wins; otherwise guess from the label
function homeOf(item) {
  if (!item || item.section !== 'asset') return null;
  if (item.assetType === 'home') return { ...HOME_DEFAULTS, ...(item.home || {}) };
  if (item.assetType) return null;
  if (item.home === false) return null;
  if (item.home) return { ...HOME_DEFAULTS, ...item.home };
  return /house|home|condo|apartment/i.test(item.label || '') ? { ...HOME_DEFAULTS } : null;
}

// per-asset volatility (annual σ); editable, with sensible defaults by type
function volOf(item) {
  if (item.vol != null) return item.vol;
  const t = ASSET_TYPES.find((x) => x.value === item.assetType);
  if (t) return t.vol;
  if (homeOf(item)) return 0.08;
  if (/bond|treasur|cash|saving/i.test(item.label || '')) return 0.05;
  return 0.15;
}

function taxTreatmentOf(item) {
  if (item.section === 'expense') return 'nondeductible-expense';
  if (item.taxAs) return item.taxAs;
  return item.recurring === 'one-time' ? 'long-term-capital-gains' : 'wages';
}

function isCapitalGainTaxTreatment(taxTreatment) {
  return taxTreatment === 'long-term-capital-gains' || taxTreatment === 'short-term-capital-gains';
}

function costBasisForIncomeAmount(item, amount) {
  return Math.max(0, Math.min(amount, item.costBasis != null ? item.costBasis : amount * 0.8));
}

// seeded RNG so the simulation is stable across edits/re-renders
function pMulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pSeededNormal(seed) {
  const rand = pMulberry32(seed);
  return function () {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

const ENGINE_ATTEMPTS = 250;

function horizonOf(plan) { return plan.horizonAge || plan.retireAge; }

function planToEngineInput(plan) {
  const years = horizonOf(plan) - plan.startAge;

  // yearly flow plans — amounts already carry the plan's deterministic inflation,
  // links, and monthly step logic via annualOf, so inflationAdjusted is false here
  const yearlyPlans = [];
  for (let y = 0; y <= years; y++) {
    const year = START_YEAR + y;
    const flows = [];
    for (const it of plan.items) {
      if (it.hidden) continue;
      if (it.section === 'asset') continue;
      const amt = annualOf(plan, it, year);
      if (!amt) continue;
      const taxTreatment = taxTreatmentOf(it);
      if (it.section === 'income' && isCapitalGainTaxTreatment(taxTreatment)) {
        const costBasis = costBasisForIncomeAmount(it, amt);
        if (costBasis > 0.5) {
          flows.push({
            name: it.label || it.id,
            type: it.section,
            taxTreatment: 'not-taxable',
            inflationAdjusted: false,
            baseSignedAmount: costBasis,
          });
        }
        const taxableGain = Math.max(0, amt - costBasis);
        if (taxableGain > 0.5) {
          flows.push({
            name: it.label || it.id,
            type: it.section,
            taxTreatment,
            inflationAdjusted: false,
            baseSignedAmount: taxableGain,
          });
        }
        continue;
      }
      flows.push({
        name: it.label || it.id,
        type: it.section,
        taxTreatment,
        inflationAdjusted: false,
        baseSignedAmount: it.section === 'expense' ? -amt : amt,
      });
    }
    // home upkeep with inflation — when monthlyInflation is set, monthlyNonTaxCosts
    // on the home asset is zeroed and we inject an inflation-adjusted flow here instead.
    for (const hit of plan.items) {
      if (hit.hidden || hit.section !== 'asset') continue;
      const hh = homeOf(hit);
      if (!hh || !hh.monthlyInflation || !hh.monthly) continue;
      const hbuy = [...(hit.changes || [])].sort((a, b) => a.year - b.year).find((c) => c.amount > 0);
      if (!hbuy || year < hbuy.year) continue;
      const hsale = saleOf(hit);
      if (hsale && year >= hsale.year) continue;
      flows.push({
        name: (hit.label || hit.id) + ' upkeep',
        type: 'expense',
        taxTreatment: 'nondeductible-expense',
        inflationAdjusted: false,
        baseSignedAmount: -(hh.monthly * 12 * Math.pow(1 + plan.inflation, year - START_YEAR)),
      });
    }
    yearlyPlans.push({ year, label: String(year), flows });
  }

  // assets — cash buffer + each holding (homes get full mortgage treatment)
  const assets = [{
    kind: 'investment', name: 'Cash', startingValue: plan.startCash,
    desiredAnnualContribution: 0, expectedReturn: 0, volatility: 0, sellProportion: 3,
  }];
  for (const it of plan.items) {
    if (it.hidden) continue;
    if (it.section !== 'asset' || !it.label) continue;
    const home = homeOf(it);
    if (home) {
      const buy = [...(it.changes || [])].sort((a, b) => a.year - b.year).find((c) => c.amount > 0);
      if (!buy) continue;
      const sale = saleOf(it);
      assets.push({
        kind: 'home', name: it.label,
        initialCost: buy.amount,
        alreadyOwned: buy.year <= START_YEAR,
        purchaseYear: Math.max(buy.year, START_YEAR),
        expectedReturn: (it.growth || 0) * 100, volatility: volOf(it) * 100,
        cashPurchasePercent: home.down, closingCostPercent: home.closing,
        mortgageType: 'amortizing', mortgageRate: home.rate * 100,
        mortgageTermYears: home.term, monthlyNonTaxCosts: home.monthlyInflation ? 0 : home.monthly,
        propertyTaxRate: home.propTax * 100,
        ...(sale && sale.year > Math.max(buy.year, START_YEAR)
          ? { saleYear: sale.year, saleCostPercent: sale.feePct }
          : {}),
      });
    } else {
      const sv = amountAt(it, START_YEAR);

      // ── Bonds: yield is annual interest income, not price appreciation ──
      // Without cashGeneration the engine treats the full return as unrealized capital
      // gains and taxes nothing annually. Federal/Treasury bonds are state-/local-exempt;
      // munis are triple-exempt.
      const isFederalBond = it.assetType === 'federal-bonds' || /treasur/i.test(it.label || '');
      const isLocalBond   = it.assetType === 'local-bonds';
      const isBond = isFederalBond || isLocalBond || (!it.assetType && /\bbond/i.test(it.label || ''));
      const bondTaxTreatment = isFederalBond ? 'state-local-exempt'
        : isLocalBond ? 'triple-exempt'
        : 'ordinary-income';

      // ── Stocks: split total return into dividends + price appreciation ──
      // Qualified dividends taxed at preferential rates (20% + NIIT);
      // ordinary dividends at income rates. Default qualified yield: 1.5% for
      // us-stocks / stock labels. Override via item.dividendYield (qualified,
      // fraction) and item.dividendYieldOrd (ordinary, fraction).
      const isStock = it.assetType === 'us-stocks' || (!it.assetType && !isBond && /stock/i.test(it.label || ''));
      const STOCK_DIV_YIELD = 0.015;
      const qualifiedYield = isStock ? (it.dividendYield    != null ? it.dividendYield    : STOCK_DIV_YIELD) : 0;
      const ordinaryYield  = isStock ? (it.dividendYieldOrd != null ? it.dividendYieldOrd : 0)               : 0;
      const totalDivYield  = qualifiedYield + ordinaryYield;
      const priceReturn    = it.growth || 0;

      const stockCashGens = [
        ...(qualifiedYield > 0.000001 ? [{ name: 'qualified dividends', rate: qualifiedYield * 100, volatility: 0, taxTreatment: 'qualified-dividends' }] : []),
        ...(ordinaryYield  > 0.000001 ? [{ name: 'ordinary dividends',  rate: ordinaryYield  * 100, volatility: 0, taxTreatment: 'ordinary-income'     }] : []),
      ];

      assets.push({
        kind: 'investment', name: it.label,
        ...(it.assetType && it.assetType !== 'home' ? { assetType: it.assetType } : {}),
        startingValue: sv, desiredAnnualContribution: it.contrib || 0,
        expectedReturn: isBond ? 0 : priceReturn * 100,
        volatility:     isBond ? 0 : volOf(it) * 100,
        sellProportion: 1,
        ...(!RETIREMENT_TYPES.includes(it.assetType) ? {
          saleTax: {
            costBasis: it.costBasis != null ? Math.max(0, Math.min(sv, it.costBasis)) : sv * 0.8,
            taxTreatment: 'long-term-capital-gains',
          },
        } : {}),
        ...(isBond && it.growth ? {
          cashGeneration: {
            name: 'interest',
            rate: (it.growth || 0) * 100,
            volatility: volOf(it) * 100,
            taxTreatment: bondTaxTreatment,
          },
        } : stockCashGens.length > 0 ? {
          cashGenerations: stockCashGens,
        } : {}),
      });
    }
  }

  // ── income distribution weights → per-asset allocation ──
  // When an income item has distribute.enabled, its surplus is steered toward
  // specific assets by weight. Retirement accounts are funded via
  // desiredAnnualContribution (the engine caps them at IRS limits); every other
  // (non-home) asset gets an explicit reinvestmentWeight so the engine splits
  // surplus by the chosen ratio instead of by current holdings. Weights from
  // multiple income streams combine, scaled by each stream's size.
  const distIncome = plan.items.filter((it) => !it.hidden && it.section === 'income' && it.distribute && it.distribute.enabled);
  if (distIncome.length > 0) {
    const shareByName = {}; // assetName → combined dollar-weighted share
    for (const inc of distIncome) {
      const w = inc.distribute.weights || {};
      const totalW = Object.values(w).reduce((s, v) => s + (Number(v) || 0), 0);
      if (totalW === 0) continue;
      let incTotal = 0, incCount = 0;
      for (let y = 0; y <= years; y++) {
        const amt = annualOf(plan, inc, START_YEAR + y);
        if (amt > 0) { incTotal += amt; incCount++; }
      }
      if (incCount === 0) continue;
      const avgAmt = incTotal / incCount;
      for (const [assetId, wv] of Object.entries(w)) {
        const n = Number(wv) || 0;
        if (n <= 0) continue;
        const assetItem = plan.items.find((a) => a.id === assetId && a.section === 'asset' && !a.hidden);
        if (!assetItem || homeOf(assetItem)) continue;
        shareByName[assetItem.label] = (shareByName[assetItem.label] || 0) + (n / totalW) * avgAmt;
      }
    }
    for (const asset of assets) {
      const share = shareByName[asset.name];
      if (!share) continue;
      if (asset.assetType && RETIREMENT_TYPES.includes(asset.assetType)) {
        asset.desiredAnnualContribution = (asset.desiredAnnualContribution || 0) + share;
      } else {
        asset.reinvestmentWeight = (asset.reinvestmentWeight || 0) + share;
      }
    }
  }

  return {
    years,
    input: {
      attempts: ENGINE_ATTEMPTS,
      horizonYears: years + 1,
      currentAge: plan.startAge,
      yearlyPlans,
      assets,
      assetCorrelations: [],
      inflation: { mode: 'fixed', fixedRate: plan.inflation },
    },
  };
}

// turn ONE representative detail scenario into a clean year-by-year breakdown
// (starting $ per asset, expenses by category, inflation, returns, tax, sales)
function scenarioBreakdown(scenario, plan, engine, taxProfile, taxes) {
  if (!scenario || !scenario.rows || !scenario.rows.length) return null;
  const get = (m, k) => (m && typeof m.get === 'function' ? m.get(k) : undefined);
  return scenario.rows.map((row) => {
    const yi = (row.yearNumber || 1) - 1;
    const startMap = row.startingAssetValues || new Map();
    const endMap = row.assetValues || new Map();
    const retMap = row.assetReturns || new Map();
    const names = [...new Set([...startMap.keys(), ...endMap.keys()])];
    const assets = names.map((name) => {
      const ret = get(retMap, name) || {};
      return {
        name,
        start: get(startMap, name) || 0,
        end: get(endMap, name) || 0,
        retAmt: ret.amount || 0,
        retPct: ret.percentage || 0,
      };
    }).filter((a) => Math.abs(a.start) > 0.5 || Math.abs(a.end) > 0.5);

    const income = [], expenses = [], sales = [], taxSourceInputs = [];
    (row.flowTotals || new Map()).forEach((v, k) => {
      if (k === 'Taxes paid') return;                       // shown separately
      if (/ contribution$/.test(k)) return;                 // internal reinvestment
      if (/ sale proceeds$/.test(k)) {
        if (Math.abs(v) > 0.5) sales.push({ name: k.replace(/ sale proceeds$/, ''), amount: v });
        return;
      }
      if (/ realized gain$/.test(k)) {
        if (v > 0.5) taxSourceInputs.push({ name: `Asset sale: ${k.replace(/ realized gain$/, '')}`, amount: v, taxTreatment: 'long-term-capital-gains' });
        return;
      }
      if (Math.abs(v) <= 0.5) return;
      if (v >= 0) {
        income.push({ name: k, amount: v });
        const taxTreatment = taxTreatmentForBreakdownEntry(k, plan);
        const taxableAmount = taxableAmountForBreakdownEntry(k, v, taxTreatment, plan);
        if (isTaxableBreakdownTreatment(taxTreatment) && taxableAmount > 0.5) {
          taxSourceInputs.push({ name: k, amount: taxableAmount, taxTreatment });
        }
      } else {
        expenses.push({ name: k, amount: -v });
      }
    });
    const incomeWithSales = [
      ...income,
      ...sales.map((sale) => ({ name: `Asset sale: ${sale.name}`, amount: sale.amount })),
    ];
    const taxSources = buildAttributedTaxSources({
      sources: taxSourceInputs,
      totalTax: row.taxAmount || 0,
      engine,
      taxProfile,
      taxes,
    });
    incomeWithSales.sort((a, b) => b.amount - a.amount);
    expenses.sort((a, b) => b.amount - a.amount);
    sales.sort((a, b) => b.amount - a.amount);

    return {
      year: START_YEAR + yi,
      age: plan.startAge + yi,
      startAssets: row.startingAssets || 0,
      endAssets: row.endingAssets != null ? row.endingAssets : (row.totalAssets || 0),
      inflation: row.inflationRateApplied || 0,
      taxPaid: row.taxAmount || 0,
      assets, income: incomeWithSales, expenses, sales, taxSources,
    };
  });
}

function taxTreatmentForBreakdownEntry(entryName, plan) {
  const item = (plan.items || []).find((candidate) => candidate && !candidate.hidden && candidate.label === entryName);
  if (item) return taxTreatmentOf(item);
  if (/ qualified dividends$/.test(entryName)) return 'qualified-dividends';
  if (/ ordinary dividends$/.test(entryName)) return 'ordinary-income';
  if (/ interest$/.test(entryName)) return 'ordinary-income';
  return 'ordinary-income';
}

function taxableAmountForBreakdownEntry(entryName, amount, taxTreatment, plan) {
  const item = (plan.items || []).find((candidate) => candidate && !candidate.hidden && candidate.label === entryName);
  if (item && item.section === 'income' && isCapitalGainTaxTreatment(taxTreatment)) {
    return Math.max(0, amount - costBasisForIncomeAmount(item, amount));
  }
  return amount;
}

function isTaxableBreakdownTreatment(taxTreatment) {
  return !['tax-exempt-income', 'triple-exempt', 'nondeductible-expense', 'deductible-expense', 'not-taxable'].includes(taxTreatment);
}

function buildAttributedTaxSources({ sources, totalTax, engine, taxProfile, taxes }) {
  if (!sources.length || totalTax <= 0.5) return [];
  const weights = sources.map((source) => ({
    name: source.name,
    amount: source.amount,
    weight: calculateStandaloneSourceTax(source, engine, taxProfile, taxes),
  }));
  const totalWeight = weights.reduce((sum, source) => sum + source.weight, 0);
  const fallbackWeight = weights.reduce((sum, source) => sum + Math.max(0, source.amount), 0);
  return weights
    .map((source) => {
      const share =
        totalWeight > 0.5
          ? source.weight / totalWeight
          : Math.max(0, source.amount) / Math.max(fallbackWeight, 1);
      return { name: source.name, amount: totalTax * share };
    })
    .filter((source) => source.amount > 0.5)
    .sort((a, b) => b.amount - a.amount);
}

function calculateStandaloneSourceTax(source, engine, taxProfile, taxes) {
  if (!engine || !taxProfile || !taxes) return 0;
  const input = createBreakdownTaxInput();
  applyBreakdownTaxTreatment(input, source.taxTreatment, source.amount);
  return engine.computeHouseholdTaxes(input, taxProfile, taxes).totalTax || 0;
}

function createBreakdownTaxInput() {
  return {
    wages: 0,
    ordinaryIncome: 0,
    qualifiedDividends: 0,
    shortTermCapitalGains: 0,
    longTermCapitalGains: 0,
    capitalLossDeduction: 0,
    taxExemptIncome: 0,
    stateLocalExemptIncome: 0,
    tripleExemptIncome: 0,
    deductibleExpenses: 0,
    saltTaxesPaid: 0,
    homeMortgageInterestPaid: 0,
    homeMortgageAverageBalance: 0,
    homeMortgageInterestDebtLimit: 0,
  };
}

function applyBreakdownTaxTreatment(input, taxTreatment, amount) {
  if (taxTreatment === 'wages') input.wages += amount;
  else if (taxTreatment === 'ordinary-income') input.ordinaryIncome += amount;
  else if (taxTreatment === 'qualified-dividends') input.qualifiedDividends += amount;
  else if (taxTreatment === 'short-term-capital-gains') input.shortTermCapitalGains += amount;
  else if (taxTreatment === 'long-term-capital-gains') input.longTermCapitalGains += amount;
  else if (taxTreatment === 'state-local-exempt') input.stateLocalExemptIncome += amount;
  else if (taxTreatment === 'tax-exempt-income') input.taxExemptIncome += amount;
  else if (taxTreatment === 'triple-exempt') input.tripleExemptIncome += amount;
}

// run the real engine; returns a chart-ready series (array) with a `.breakdowns`
// map ({p10,p25,nw,p75,p90} → representative year-by-year breakdown) attached.
function runEngineProjection(plan) {
  const E = window.SorobanEngine;
  if (!E) return null;
  const { years, input } = planToEngineInput(plan);
  const nyc = E.createDefaultNYCHouseholdTaxes('individual');
  const taxes = nyc.taxes.map((t) => new E.Tax(t));
  const res = E.buildSimulationExecution(
    {
      ...input,
      taxes,
      householdTaxProfile: nyc.profile,
      nextStandardNormal: pSeededNormal(0xC0FFEE),
      nextRandom: pMulberry32(0xBEEF),
    },
    // capture a generous pool of full detail scenarios so each percentile line
    // can be matched to a representative path the user can drill into
    { detailSampleLimit: 120, includeAggregates: false }
  );
  const p50 = res.scenarios.get(50);
  if (!p50 || !p50.rows.length) return null;
  const getBand = (pct) => {
    const sc = res.scenarios.get(pct);
    return sc ? sc.rows.slice(0, years + 1).map((r) => r.totalAssets) : null;
  };
  const b10 = getBand(10), b25 = getBand(25), b75 = getBand(75), b90 = getBand(90);

  // pick the simulated path closest to each percentile's summary line, then
  // expand it into a per-year breakdown for the click-through modal
  let breakdowns = null;
  try {
    const details = res.details || [];
    const repFor = (pct) => {
      const sc = res.scenarios.get(pct);
      return sc ? E.selectRepresentativeSimulationScenario(details, sc.rows) : null;
    };
    breakdowns = {
      p10: scenarioBreakdown(repFor(10), plan, E, nyc.profile, taxes),
      p25: scenarioBreakdown(repFor(25), plan, E, nyc.profile, taxes),
      nw:  scenarioBreakdown(repFor(50), plan, E, nyc.profile, taxes),
      p75: scenarioBreakdown(repFor(75), plan, E, nyc.profile, taxes),
      p90: scenarioBreakdown(repFor(90), plan, E, nyc.profile, taxes),
    };
  } catch (e) {
    console.warn('Soroban: could not build percentile breakdowns', e);
    breakdowns = null;
  }

  const series = p50.rows.slice(0, years + 1).map((row, i) => ({
    year: START_YEAR + i,
    age: plan.startAge + i,
    nw: row.totalAssets,
    depletion: row.depletionProbability,
    p10: b10 ? b10[i] : null,
    p25: b25 ? b25[i] : null,
    p75: b75 ? b75[i] : null,
    p90: b90 ? b90[i] : null,
  }));
  series.breakdowns = breakdowns;
  return series;
}

// ── liquid net worth: total minus home EQUITY (market value − mortgage owed) ──
// Lets the UI toggle the house out of the net-worth figure. Equity is derived
// deterministically from each home asset's purchase price, growth, down payment
// and amortizing mortgage — it's 0 before purchase and snaps back to 0 once the
// home is sold (its value flows back into cash, i.e. becomes liquid).
function homeEquityAt(plan, year) {
  let eq = 0;
  for (const it of plan.items) {
    if (it.hidden) continue;
    const home = homeOf(it);
    if (!home) continue;
    const buy = [...(it.changes || [])].sort((a, b) => a.year - b.year).find((c) => c.amount > 0);
    if (!buy || year < buy.year) continue;
    const market = valueAt(it, year); // 0 after the sale waypoint
    if (market <= 0) continue;
    // remaining balance on an amortizing mortgage
    const loan = buy.amount * (1 - (home.down || 0));
    let bal = 0;
    if (loan > 0 && home.rate > 0 && home.term > 0) {
      const r = home.rate / 12, n = home.term * 12;
      const m = Math.min((year - buy.year) * 12, n);
      bal = loan * (Math.pow(1 + r, n) - Math.pow(1 + r, m)) / (Math.pow(1 + r, n) - 1);
    }
    eq += Math.max(0, market - bal);
  }
  return eq;
}

// derive a chart-ready series that excludes home equity from every band.
// Once a band's liquid net worth reaches zero (or goes negative) it stays at 0
// — the run is treated as depleted and cannot recover.
function toLiquidSeries(series, plan) {
  if (!series) return series;
  const depleted = { nw: false, p10: false, p25: false, p75: false, p90: false };
  const clamp = (v, key) => {
    if (v == null) return v;
    if (depleted[key] || v <= 0) { depleted[key] = true; return 0; }
    return v;
  };
  const out = series.map((d) => {
    const eq = homeEquityAt(plan, d.year);
    const liquid = (v) => (v == null ? v : v - eq);
    return {
      ...d,
      nw:  clamp(liquid(d.nw),  'nw'),
      p10: clamp(liquid(d.p10), 'p10'),
      p25: clamp(liquid(d.p25), 'p25'),
      p75: clamp(liquid(d.p75), 'p75'),
      p90: clamp(liquid(d.p90), 'p90'),
    };
  });
  out.breakdowns = series.breakdowns; // detail table still reflects the full plan
  return out;
}

// derive a chart-ready series that KEEPS home equity in the totals but still
// zeros every band once its liquid value (total − equity) hits zero. A house
// worth $8M doesn't help you pay bills, so the run is considered wiped out.
function toTotalSeriesWithDepletion(series, plan) {
  if (!series) return series;
  const depleted = { nw: false, p10: false, p25: false, p75: false, p90: false };
  const clamp = (total, liq, key) => {
    if (total == null) return total;
    if (depleted[key] || liq <= 0) { depleted[key] = true; return 0; }
    return total;
  };
  const out = series.map((d) => {
    const eq = homeEquityAt(plan, d.year);
    const liq = (v) => (v == null ? v : v - eq);
    return {
      ...d,
      nw:  clamp(d.nw,  liq(d.nw),  'nw'),
      p10: clamp(d.p10, liq(d.p10), 'p10'),
      p25: clamp(d.p25, liq(d.p25), 'p25'),
      p75: clamp(d.p75, liq(d.p75), 'p75'),
      p90: clamp(d.p90, liq(d.p90), 'p90'),
    };
  });
  out.breakdowns = series.breakdowns;
  return out;
}

Object.assign(window, { HOME_DEFAULTS, ASSET_TYPES, RETIREMENT_TYPES, homeOf, volOf, scenarioBreakdown, runEngineProjection, ENGINE_ATTEMPTS, homeEquityAt, toLiquidSeries, toTotalSeriesWithDepletion });
