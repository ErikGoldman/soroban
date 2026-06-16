// wf-model.jsx — three sections (income / expense / asset) + linked values.
// A line item's amount can be a schedule of changes, OR a LINK to another item
// (e.g. House maintenance = 1.5% of House value) that auto-updates.

const START_YEAR = 2026;

const SECTIONS = [
  { id: 'expense', label: 'Expenses', hint: 'recurring & one-time spending' },
  { id: 'income', label: 'Income', hint: 'salary, liquidity events, payouts' },
  { id: 'asset', label: 'Your money', hint: 'stocks, bonds, house — what you hold' },
];

const ITEMS0 = [
  // ── INCOME ──
  { id: 'salary', section: 'income', label: 'Salary', recurring: 'yearly', inflation: false,
    changes: [{ year: 2026, amount: 165000 }, { year: 2031, amount: 188000 }, { year: 2041, amount: 205000 }] },
  { id: 'vanta', section: 'income', label: 'Vanta IPO', recurring: 'one-time', inflation: false,
    changes: [{ year: 2028, amount: 1400000 }] },
  { id: 'startup', section: 'income', label: 'Startup investments', recurring: 'one-time', inflation: false,
    changes: [{ year: 2034, amount: 250000 }] },

  // ── EXPENSES ──
  { id: 'housing', section: 'expense', label: 'Housing cost', recurring: 'yearly', inflation: true,
    changes: [{ year: 2026, amount: 42000 }, { year: 2029, amount: 30000 }, { year: 2044, amount: 22000 }] },
  // ↓ LINKED: tracks the House asset's value automatically
  { id: 'maint', section: 'expense', label: 'House maintenance', recurring: 'yearly', inflation: false,
    link: { ref: 'house', rate: 0.015 } },
  { id: 'food', section: 'expense', label: 'Food & daily', recurring: 'monthly', inflation: true,
    changes: [{ year: 2026, month: 0, amount: 1300 }, { year: 2031, month: 0, amount: 1800 }] },
  // Nanny — month-stepped: $30/hr one child, $40/hr while both overlap, ends at each child's fall 2s program.
  // monthly figures assume ~2,000 hrs/yr (40 hrs/wk): $30→$5,000/mo, $40→$6,667/mo.
  { id: 'nanny', section: 'expense', label: 'Nanny', recurring: 'monthly', inflation: true,
    changes: [
      { year: 2026, month: 1, amount: 5000, note: 'Child 1 born · 1 child @ $30/hr' },
      { year: 2027, month: 10, amount: 6667, note: 'Child 2 born · both @ $40/hr' },
      { year: 2028, month: 8, amount: 5000, note: 'Child 1 → 2s program · 1 child @ $30/hr' },
      { year: 2030, month: 8, amount: 0, note: 'Child 2 → 2s program · nanny ends' },
    ] },

  // ── YOUR MONEY (assets, tracked by value) ──
  { id: 'stocks', section: 'asset', label: 'Stocks', growth: 0.06,
    changes: [{ year: 2026, amount: 120000 }] },
  { id: 'bonds', section: 'asset', label: 'Bonds', growth: 0.03,
    changes: [{ year: 2026, amount: 60000 }] },
  { id: 'house', section: 'asset', label: 'House', growth: 0.035,
    changes: [{ year: 2029, amount: 800000 }], sale: { enabled: true, year: 2044, feePct: 0.07 } }, // buy 2029, sell 2044 (7% costs)
];

const PLAN0 = { startAge: 32, retireAge: 65, startCash: 0, invReturn: 0.05, inflation: 0.025, items: ITEMS0,
  events: [] };

const RECUR_LABEL = { yearly: 'Yearly', monthly: 'Monthly', 'one-time': 'One-time' };

// most-recent change at or before `year`
function waypoint(item, year) {
  let amt = 0, yr = year;
  for (const c of [...(item.changes || [])].sort((a, b) => a.year - b.year)) if (c.year <= year) { amt = c.amount; yr = c.year; }
  return { amt, yr };
}
function amountAt(item, year) { return waypoint(item, year).amt; }

// month-aware: rate active during a given absolute month (year*12 + mo)
function rateAtMonth(item, absMonth) {
  let amt = 0, best = -Infinity;
  for (const c of item.changes || []) {
    const key = c.year * 12 + (c.month || 0);
    if (key <= absMonth && key >= best) { best = key; amt = c.amount; }
  }
  return amt;
}

// optional asset-sale config — { enabled, year, feePct(fraction) } → normalized, or null
function saleOf(item) {
  const s = item && item.sale;
  if (!s || !s.enabled || s.year == null) return null;
  return { year: s.year, feePct: s.feePct != null ? s.feePct : 0.07 };
}

// asset value at a given year (waypoint value grown by its appreciation rate)
function valueAt(item, year) {
  const sale = saleOf(item);
  if (sale && year >= sale.year) return 0; // sold — drops out of the portfolio
  const { amt, yr } = waypoint(item, year);
  if (amt === 0) return 0;
  return amt * Math.pow(1 + (item.growth || 0), year - yr);
}

// annual cash-flow contribution of an income/expense item (assets return 0)
function annualOf(plan, item, year) {
  if (item.section === 'asset') return 0;
  if (item.hidden) return 0;
  if (item.endYear && year > item.endYear) return 0;
  if (item.link) {
    const ref = plan.items.find((i) => i.id === item.link.ref);
    return ref ? valueAt(ref, year) * item.link.rate : 0;
  }
  const f = item.inflation ? Math.pow(1 + plan.inflation, year - START_YEAR) : 1;
  if (item.recurring === 'one-time') {
    let s = 0; for (const c of item.changes) if (c.year === year) s += c.amount; return s * f;
  }
  if (item.recurring === 'monthly') {
    // sum the active monthly rate across the 12 months of this year (handles mid-year starts/stops)
    let s = 0; for (let mo = 0; mo < 12; mo++) s += rateAtMonth(item, year * 12 + mo);
    return s * f;
  }
  return amountAt(item, year) * f;
}

// per-year series of an income/expense item's annual amount (for sparklines)
function sparkSeries(plan, item) {
  const years = horizonOf(plan) - plan.startAge;
  const out = [];
  for (let y = 0; y <= years; y++) out.push({ year: START_YEAR + y, v: annualOf(plan, item, START_YEAR + y) });
  return out;
}
// per-year series of an asset's value
function valueSeries(plan, item) {
  const years = horizonOf(plan) - plan.startAge;
  const out = [];
  for (let y = 0; y <= years; y++) out.push({ year: START_YEAR + y, v: valueAt(item, START_YEAR + y) });
  return out;
}

// items that reference `id` via a link
function referencedBy(plan, id) { return plan.items.filter((i) => i.link && i.link.ref === id); }

// projection horizon — plans may carry a horizonAge that extends past retirement
function horizonOf(plan) { return plan.horizonAge || plan.retireAge; }

function project(plan) {
  const years = horizonOf(plan) - plan.startAge;
  const assets = plan.items.filter((i) => i.section === 'asset');
  const vs = {};
  assets.forEach((a) => { vs[a.id] = []; for (let y = 0; y <= years; y++) vs[a.id].push(valueAt(a, START_YEAR + y)); });

  let cash = plan.startCash;
  const out = [];
  for (let y = 0; y <= years; y++) {
    const year = START_YEAR + y, age = plan.startAge + y;
    // asset purchases / sales move cash so net worth stays continuous
    assets.forEach((a) => {
      const cur = vs[a.id][y], prev = y > 0 ? vs[a.id][y - 1] : 0;
      if (prev === 0 && cur > 0) cash -= cur;                      // bought
      else if (prev > 0 && cur === 0) cash += prev * (1 + (a.growth || 0)); // sold
    });
    let inc = 0, exp = 0;
    for (const it of plan.items) {
      if (it.section === 'income') inc += annualOf(plan, it, year);
      else if (it.section === 'expense') exp += annualOf(plan, it, year);
    }
    cash = cash * (1 + plan.invReturn) + inc - exp;
    const assetsVal = assets.reduce((s, a) => s + vs[a.id][y], 0);
    out.push({ year, age, nw: cash + assetsVal, cash, assetsVal, inc, exp, surplus: inc - exp });
  }
  return out;
}

function milestones(plan) {
  const m = [];
  plan.items.forEach((it) => {
    if (it.hidden) return;
    if (it.section === 'asset') {
      (it.changes || []).forEach((c, idx) => { if (!(c.year <= START_YEAR && c.amount > 0)) m.push({ year: c.year + (c.month || 0) / 12, label: (c.amount > 0 ? 'Buy ' : 'Sell ') + it.label, id: it.id, idx }); });
      const s = saleOf(it);
      if (s) m.push({ year: s.year, label: 'Sell ' + it.label, id: it.id, idx: 'sale' });
    }
    else if (it.recurring === 'one-time') (it.changes || []).forEach((c, idx) => { if (c.amount) m.push({ year: c.year + (c.month || 0) / 12, label: it.label, id: it.id, idx }); });
  });
  const hiddenLabels = new Set((plan.items || []).filter(i => i.hidden).map(i => i.label));
  (plan.events || []).forEach((e) => { if (!hiddenLabels.has(e.label)) m.push({ year: e.year + (e.month || 0) / 12, label: e.label, event: true }); });
  const max = START_YEAR + (horizonOf(plan) - plan.startAge);
  return m.filter((x) => x.year >= START_YEAR && x.year <= max).sort((a, b) => a.year - b.year);
}

function fmtMoney(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return (v < 0 ? '-' : '') + '$' + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (v < 0 ? '-' : '') + '$' + Math.round(a / 1e3) + 'k';
  return (v < 0 ? '-' : '') + '$' + Math.round(a);
}
function fmtShort(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return (v < 0 ? '-' : '') + '$' + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M';
  if (a >= 1e3) return (v < 0 ? '-' : '') + '$' + (a / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k';
  return (v < 0 ? '-' : '') + '$' + Math.round(a);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

Object.assign(window, { START_YEAR, MONTHS, SECTIONS, ITEMS0, PLAN0, RECUR_LABEL, waypoint, amountAt, rateAtMonth, valueAt, annualOf, sparkSeries, valueSeries, referencedBy, project, milestones, fmtMoney, fmtShort, saleOf });
