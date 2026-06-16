// proto-intro.jsx — first-run intake. Shown BEFORE the main plan. The user
// describes their life in plain words; we parse it into real plan items + a
import React from 'react';
// live preview. On "Draft my plan", anything we had to ASSUME (e.g. a house
// price) becomes a quick follow-up question instead of a silent guess.

// ── amount / year parsing ──────────────────────────────────────────────────
function inDollars(raw, suffix) {
  let m = String(raw).replace(/[,$\s]/g, '');
  let mult = 1;
  const suf = (suffix || '').toLowerCase();
  if (suf.startsWith('m')) mult = 1e6;else
  if (suf.startsWith('k') || suf === 'thousand') mult = 1e3;
  const n = parseFloat(m);
  return Number.isFinite(n) ? Math.round(n * mult) : null;
}
function firstAmount(s) {
  const m = String(s).match(/\$\s?([\d][\d.,]*)\s*(k|m|million|thousand)?/i);
  if (!m) return null;
  return inDollars(m[1], m[2]);
}
function firstYear(s) {const m = String(s).match(/\b(20[2-5]\d)\b/);return m ? parseInt(m[1], 10) : null;}
function inYearsFrom(s) {const m = String(s).match(/in\s+(?:about\s+)?(\d{1,2})\s*years?/i);return m ? START_YEAR + parseInt(m[1], 10) : null;}
function largestAmount(s) {
  const re = /\$\s?([\d][\d.,]*)\s*(k|m|million|thousand)?/ig;let m,best = null;
  while (m = re.exec(String(s))) {const v = inDollars(m[1], m[2]);if (v != null && (best == null || v > best)) best = v;}
  return best;
}
function amountNear(s, kw) {
  const str = String(s);const i = str.toLowerCase().indexOf(kw);if (i < 0) return null;
  return firstAmount(str.slice(Math.max(0, i - 20), i + kw.length + 6));
}
function detectAge(text) {
  const t = String(text || '');
  const m = t.match(/\b(?:i['’]?m|i am|im|age|aged)\s+(\d{2})\b/i) || t.match(/\b(\d{2})\s*(?:years?\s*old|y\/?o)\b/i);
  if (m) {const a = parseInt(m[1], 10);if (a >= 16 && a <= 90) return a;}
  return null;
}

// ── city-based childcare estimates (monthly full-time daycare, illustrative) ──
const CITY_CHILDCARE = { 'San Francisco': 2900, 'New York': 2800, 'Boston': 2600, 'Seattle': 2400, 'Washington DC': 2400, 'Washington': 2400, 'Los Angeles': 2200, 'Chicago': 1900, 'Denver': 1800, 'Austin': 1700, 'Miami': 1600, 'Atlanta': 1500, 'Somewhere else': 1600 };
const CITY_OPTIONS = Object.keys(CITY_CHILDCARE);
// A broad list of US cities for autocomplete. Free text is also accepted, so any
// city works; this just powers the suggestion dropdown. Format: "City, ST".
const US_CITIES = [
  'New York, NY','Los Angeles, CA','Chicago, IL','Houston, TX','Phoenix, AZ','Philadelphia, PA','San Antonio, TX','San Diego, CA','Dallas, TX','San Jose, CA',
  'Austin, TX','Jacksonville, FL','Fort Worth, TX','Columbus, OH','Charlotte, NC','San Francisco, CA','Indianapolis, IN','Seattle, WA','Denver, CO','Washington, DC',
  'Boston, MA','El Paso, TX','Nashville, TN','Detroit, MI','Oklahoma City, OK','Portland, OR','Las Vegas, NV','Memphis, TN','Louisville, KY','Baltimore, MD',
  'Milwaukee, WI','Albuquerque, NM','Tucson, AZ','Fresno, CA','Mesa, AZ','Sacramento, CA','Atlanta, GA','Kansas City, MO','Colorado Springs, CO','Omaha, NE',
  'Raleigh, NC','Miami, FL','Long Beach, CA','Virginia Beach, VA','Oakland, CA','Minneapolis, MN','Tulsa, OK','Tampa, FL','Arlington, TX','New Orleans, LA',
  'Wichita, KS','Bakersfield, CA','Cleveland, OH','Aurora, CO','Anaheim, CA','Honolulu, HI','Santa Ana, CA','Riverside, CA','Corpus Christi, TX','Lexington, KY',
  'Stockton, CA','Henderson, NV','Saint Paul, MN','St. Louis, MO','Cincinnati, OH','Pittsburgh, PA','Greensboro, NC','Anchorage, AK','Plano, TX','Lincoln, NE',
  'Orlando, FL','Irvine, CA','Newark, NJ','Toledo, OH','Durham, NC','Chula Vista, CA','Fort Wayne, IN','Jersey City, NJ','St. Petersburg, FL','Laredo, TX',
  'Madison, WI','Chandler, AZ','Buffalo, NY','Lubbock, TX','Scottsdale, AZ','Reno, NV','Glendale, AZ','Gilbert, AZ','Winston-Salem, NC','North Las Vegas, NV',
  'Norfolk, VA','Chesapeake, VA','Garland, TX','Irving, TX','Hialeah, FL','Fremont, CA','Boise, ID','Richmond, VA','Baton Rouge, LA','Spokane, WA',
  'Des Moines, IA','Tacoma, WA','San Bernardino, CA','Modesto, CA','Fontana, CA','Santa Clarita, CA','Birmingham, AL','Oxnard, CA','Fayetteville, NC','Rochester, NY',
  'Moreno Valley, CA','Glendale, CA','Huntington Beach, CA','Salt Lake City, UT','Grand Rapids, MI','Amarillo, TX','Yonkers, NY','Aurora, IL','Montgomery, AL','Akron, OH',
  'Little Rock, AR','Huntsville, AL','Augusta, GA','Port St. Lucie, FL','Grand Prairie, TX','Columbus, GA','Tallahassee, FL','Overland Park, KS','Tempe, AZ','McKinney, TX',
  'Mobile, AL','Cape Coral, FL','Shreveport, LA','Frisco, TX','Knoxville, TN','Worcester, MA','Brownsville, TX','Vancouver, WA','Fort Lauderdale, FL','Sioux Falls, SD',
  'Ontario, CA','Chattanooga, TN','Providence, RI','Newport News, VA','Rancho Cucamonga, CA','Santa Rosa, CA','Oceanside, CA','Salem, OR','Elk Grove, CA','Garden Grove, CA',
  'Pembroke Pines, FL','Peoria, AZ','Eugene, OR','Corona, CA','Cary, NC','Springfield, MO','Fort Collins, CO','Jackson, MS','Alexandria, VA','Hayward, CA',
  'Lancaster, CA','Lakewood, CO','Clarksville, TN','Palmdale, CA','Salinas, CA','Springfield, MA','Hollywood, FL','Pasadena, TX','Sunnyvale, CA','Macon, GA',
  'Kansas City, KS','Pomona, CA','Escondido, CA','Killeen, TX','Naperville, IL','Joliet, IL','Bellevue, WA','Rockford, IL','Savannah, GA','Paterson, NJ',
  'Torrance, CA','Bridgeport, CT','McAllen, TX','Mesquite, TX','Syracuse, NY','Midland, TX','Pasadena, CA','Murfreesboro, TN','Miramar, FL','Dayton, OH',
  'Fullerton, CA','Olathe, KS','Orange, CA','Thornton, CO','Roseville, CA','Denton, TX','Waco, TX','Surprise, AZ','Carrollton, TX','West Valley City, UT',
  'Charleston, SC','Warren, MI','Hampton, VA','Gainesville, FL','Visalia, CA','Coral Springs, FL','Columbia, SC','Cedar Rapids, IA','Sterling Heights, MI','New Haven, CT',
  'Stamford, CT','Concord, CA','Kent, WA','Santa Clara, CA','Elizabeth, NJ','Round Rock, TX','Thousand Oaks, CA','Lafayette, LA','Athens, GA','Topeka, KS',
  'Simi Valley, CA','Norman, OK','Fargo, ND','Wilmington, NC','Abilene, TX','Odessa, TX','Columbia, MO','Pearland, TX','Victorville, CA','Hartford, CT',
  'Vallejo, CA','Allentown, PA','Berkeley, CA','Richardson, TX','Arvada, CO','Ann Arbor, MI','Rochester, MN','Cambridge, MA','Sugar Land, TX','Lansing, MI',
  'Evansville, IN','College Station, TX','Fairfield, CA','Clearwater, FL','Beaumont, TX','Independence, MO','Provo, UT','West Jordan, UT','Murrieta, CA','Palm Bay, FL',
  'El Monte, CA','Carlsbad, CA','North Charleston, SC','Temecula, CA','Clovis, CA','Springfield, IL','Meridian, ID','Westminster, CO','Costa Mesa, CA','High Point, NC',
  'Manchester, NH','Pueblo, CO','Lakeland, FL','Pompano Beach, FL','West Palm Beach, FL','Antioch, CA','Everett, WA','Downey, CA','Lowell, MA','Centennial, CO',
  'Elgin, IL','Richmond, CA','Peoria, IL','Broken Arrow, OK','Miami Gardens, FL','Billings, MT','Jurupa Valley, CA','Sandy Springs, GA','Gresham, OR','Lewisville, TX',
  'Hillsboro, OR','Ventura, CA','Greeley, CO','Inglewood, CA','Waterbury, CT','League City, TX','Santa Maria, CA','Tyler, TX','Davie, FL','Daly City, CA',
  'Boulder, CO','Allen, TX','West Covina, CA','Sparks, NV','Wichita Falls, TX','Green Bay, WI','San Mateo, CA','Norwalk, CA','Rialto, CA','Burbank, CA',
  'Renton, WA','Spokane Valley, WA','El Cajon, CA','Las Cruces, NM','Vista, CA','Davenport, IA','South Bend, IN','Vacaville, CA','Edinburg, TX','Tuscaloosa, AL'
];
const CITY_ALIASES = { 'san francisco': 'San Francisco', 'sf': 'San Francisco', 'bay area': 'San Francisco', 'new york': 'New York', 'nyc': 'New York', 'manhattan': 'New York', 'brooklyn': 'New York', 'boston': 'Boston', 'seattle': 'Seattle', 'washington': 'Washington DC', 'dc': 'Washington DC', 'los angeles': 'Los Angeles', 'la': 'Los Angeles', 'chicago': 'Chicago', 'denver': 'Denver', 'austin': 'Austin', 'miami': 'Miami', 'atlanta': 'Atlanta' };
function detectCity(text) {
  const t = String(text || '').toLowerCase();
  for (const k of Object.keys(CITY_ALIASES)) {if (new RegExp('\\b' + k + '\\b').test(t)) return CITY_ALIASES[k];}
  return null;
}
function childcareFor(city) {
  if (!city) return 1600;
  const base = String(city).split(',')[0].trim();
  return CITY_CHILDCARE[base] || CITY_CHILDCARE[city] || 1600;
}
// Cost-of-living multiplier vs. the national baseline (1.0). Used to scale
// location-sensitive default estimates (housing, tuition, etc.) to the city the
// user lives in. Unknown cities fall back to the national baseline.
const CITY_COL = { 'San Francisco': 1.55, 'New York': 1.5, 'Boston': 1.35, 'Seattle': 1.3, 'Washington DC': 1.3, 'Washington': 1.3, 'Los Angeles': 1.4, 'Chicago': 1.15, 'Denver': 1.15, 'Austin': 1.1, 'Miami': 1.2, 'Atlanta': 1.05, 'Somewhere else': 1.0 };
function colFactor(city) {
  if (!city) return 1;
  const base = String(city).split(',')[0].trim();
  return CITY_COL[base] || CITY_COL[city] || 1;
}
// Annual private-school tuition varies a lot by metro — more than a flat
// cost-of-living scale captures — so known metros get realistic figures and
// everything else falls back to a COL-scaled national average.
const PRIVATE_SCHOOL = { 'New York': 62000, 'San Francisco': 52000, 'Los Angeles': 48000, 'Boston': 50000, 'Washington DC': 48000, 'Washington': 48000, 'Seattle': 42000, 'Chicago': 40000, 'Miami': 38000, 'Denver': 34000, 'Austin': 32000, 'Atlanta': 30000 };
function privateSchoolFor(city) {
  if (!city) return 30000;
  const base = String(city).split(',')[0].trim();
  return PRIVATE_SCHOOL[base] || PRIVATE_SCHOOL[city] || Math.round(30000 * colFactor(city) / 500) * 500;
}
// Pull a bedroom count out of free text: "2br", "2 bed", "three-bedroom",
// "studio" → 0. Returns null when nothing is said.
function detectBeds(s) {
  const t = String(s || '').toLowerCase();
  if (/\bstudio\b/.test(t)) return 0;
  let m = t.match(/(\d+)\s*(?:br\b|bd\b|beds?\b|bedrooms?\b|bdrm\b)/);
  if (m) return Math.min(parseInt(m[1], 10), 8);
  const W = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  m = t.match(/\b(one|two|three|four|five|six)[-\s]?(?:bed|bedroom)/);
  if (m) return W[m[1]];
  return null;
}
// Typical purchase price for a ~3BR home by metro; scaled by bedroom count.
const CITY_HOME = { 'San Francisco': 1500000, 'New York': 1250000, 'Los Angeles': 1100000, 'Boston': 900000, 'Seattle': 850000, 'Washington DC': 780000, 'Washington': 780000, 'Denver': 680000, 'Austin': 600000, 'Chicago': 420000, 'Miami': 600000, 'Atlanta': 470000 };
function homeEstimate(city, beds) {
  const base = (city && (CITY_HOME[String(city).split(',')[0].trim()] || CITY_HOME[city])) || 460000;
  const b = beds == null ? 3 : beds; // assume a 3BR home if size is unstated
  const factor = 0.55 + 0.15 * b; // studio .55, 1BR .70, 2BR .85, 3BR 1.0, 4BR 1.15
  return Math.round(base * factor / 10000) * 10000;
}
// Typical monthly rent for a 1BR by metro; scaled by bedroom count.
const CITY_RENT = { 'San Francisco': 3200, 'New York': 3600, 'Los Angeles': 2700, 'Boston': 2900, 'Seattle': 2300, 'Washington DC': 2300, 'Washington': 2300, 'Denver': 1900, 'Austin': 1700, 'Chicago': 1900, 'Miami': 2400, 'Atlanta': 1700 };
function rentEstimate(city, beds) {
  const base = (city && (CITY_RENT[String(city).split(',')[0].trim()] || CITY_RENT[city])) || 1500;
  const b = beds == null ? 1 : beds; // assume a 1BR if size is unstated
  const factor = 0.8 + 0.2 * b; // studio .8, 1BR 1.0, 2BR 1.2, 3BR 1.4
  return Math.round(base * factor / 50) * 50;
}

// ── lifestyle flesh-out ───────────────────────────────────────────────────────
// After parsing what the user wrote, we fill in the ordinary cost of living for
// where they live and the comfort level they describe — and, if there are kids,
// childcare/schooling/activities phased to each child's birth year. So a short
// description becomes a realistic forward budget, not just the lines they typed.

// pull each child's (approximate) birth year out of the text
function detectKids(text) {
  const t = String(text || '');
  const lower = t.toLowerCase();
  if (!/\b(kids?|child(ren)?|baby|babies|son|daughter|expecting|newborn)\b/.test(lower)) return [];
  const years = (t.match(/\b(20[2-4]\d)\b/g) || []).map(Number).filter((y) => y >= START_YEAR - 1 && y <= START_YEAR + 16);
  const numW = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  let count = null;
  const m = lower.match(/\b(\d+|one|two|three|four|five)\s+(?:kids|children|kid|child)\b/);
  if (m) count = numW[m[1]] || parseInt(m[1], 10) || null;
  let births = years.length ? [...new Set(years)].sort((a, b) => a - b) : [];
  if (count) {
    if (births.length > count) births = births.slice(0, count);
    while (births.length < count) births.push((births[births.length - 1] || START_YEAR) + 2);
  }
  if (!births.length) births = [START_YEAR + 1];
  return births;
}

// infer a spending comfort tier from language + wealth
function detectTier(text, items) {
  const t = String(text || '').toLowerCase();
  const assets = items.filter((i) => i.section === 'asset').reduce((s, i) => s + (i.changes && i.changes[0] ? i.changes[0].amount : 0), 0);
  if (/\b(frugal|tight|modest|paycheck to paycheck|on a budget|cut back|bare ?bones)\b/.test(t)) return 'modest';
  if (/\b(private school|private jet|tutor|affluent|wealthy|high net worth|hamptons|luxury)\b/.test(t) || assets > 3000000) return 'affluent';
  return 'comfortable';
}

// baseline household expenses (national, "comfortable" = 1.0); scaled by tier × city.
// `inc` is the per-child bump (fraction of base) applied while each kid is < 18.
const LIFE_BASE = [
  { label: 'Food & groceries', mo: 650, inc: 0.28, skipIf: /food|grocer/ },
  { label: 'Dining out', mo: 600, inc: 0.12, skipIf: /dining|restaurant/ },
  { label: 'Health & medical', mo: 1200, inc: 0.28, skipIf: /health|medical|insurance/ },
  { label: 'Transportation', mo: 650, inc: 0.08, skipIf: /transport|transit|car\b/ },
  { label: 'Shopping & personal', mo: 850, inc: 0.18, skipIf: /shopping|personal care/ },
  { label: 'Travel & vacations', yr: 18000, inc: 0.18, skipIf: /travel|vacation/ },
  { label: 'Contingency', mo: 800, inc: 0.12, skipIf: /conting|miscellaneous/ }];

// Build a change-schedule for an expense that never ends but scales with how
// many children are at home: it steps up as each kid arrives and back down as
// each turns 18.
function householdChanges(base, recurring, kids, incPer) {
  const step = recurring === 'monthly' ? 50 : 500;
  const years = [...new Set([START_YEAR, ...kids.flatMap((Y) => [Math.max(Y, START_YEAR), Y + 18])])].filter((y) => y >= START_YEAR).sort((a, b) => a - b);
  const activeAt = (y) => kids.filter((Y) => Y <= y && y < Y + 18).length;
  const changes = [];
  let prev = null;
  years.forEach((y) => {
    const amt = Math.round(base * (1 + incPer * activeAt(y)) / step) * step;
    if (amt !== prev) {
      changes.push(recurring === 'monthly' ? { year: y, month: 0, amount: amt } : { year: y, amount: amt });
      prev = amt;
    }
  });
  return changes;
}

function fleshOutPlan(items, city, text) {
  const out = items.map((it) => ({ ...it, changes: it.changes ? it.changes.map((c) => ({ ...c })) : it.changes }));
  const tier = detectTier(text, out);
  const tierF = tier === 'modest' ? 0.6 : tier === 'affluent' ? 1.7 : 1.0;
  const col = colFactor(city);
  const kids = detectKids(text);
  const wantsPrivate = /private school|private education|tutor|private ed/.test(String(text || '').toLowerCase()) || tier === 'affluent';
  const has = (re) => out.some((i) => re.test(i.label.toLowerCase()));

  // if there are kids, the parser's single generic childcare / private-school
  // lines are replaced by the per-child phased lines built below
  const filtered = kids.length ? out.filter((i) => i.label !== 'Childcare' && i.label !== 'Private school') : out;
  const extra = [];
  const addEx = (it) => { if (!filtered.some((x) => x.label === it.label) && !extra.some((x) => x.label === it.label)) extra.push({ id: puid(), ...it }); };

  LIFE_BASE.forEach((b) => {
    if (b.skipIf && has(b.skipIf)) return;
    const recurring = b.mo != null ? 'monthly' : 'yearly';
    const base = (b.mo != null ? b.mo : b.yr) * tierF * col;
    const changes = householdChanges(base, recurring, kids, b.inc || 0);
    addEx({ section: 'expense', label: b.label, recurring, inflation: true, changes });
  });

  // Home costs: owners get a broad "Household" line (utilities + upkeep + supplies);
  // renters just get "Utilities" (electric/gas/water/internet/phone, NYC-based and
  // scaled by city). National monthly baselines, scaled by tier × city.
  if (!has(/household|utilit/)) {
    const owns = out.some((i) => i.section === 'asset' && /\b(house|home|condo|co-?op|property|townhouse)\b/i.test(i.label)) ||
      /\b(own|owns|owning|bought|buying|buy|purchased|got|have|has)\s+(a\s+|our\s+|my\s+|the\s+|their\s+)?(house|home|condo|co-?op|townhouse|place)\b|\bhomeowner|\bmortgage\b|\bour (house|home|place|condo)\b/i.test(String(text || '').toLowerCase());
    const base = (owns ? 900 : 330) * tierF * col;
    addEx({ section: 'expense', label: owns ? 'Household' : 'Utilities', recurring: 'monthly', inflation: true,
      changes: householdChanges(base, 'monthly', kids, owns ? 0.10 : 0.05) });
  }

  kids.forEach((Y, i) => {
    const suffix = kids.length > 1 ? ` — Child ${i + 1}` : '';
    const careType = tier === 'modest' ? 'Daycare' : 'Nanny';
    const care = ccEstimate(city, careType);
    const pre = ccEstimate(city, 'Preschool');
    // childcare: full-time care ages 0–2, preschool 3–4, ends at school age (5)
    addEx({ section: 'expense', label: `Childcare${suffix}`, recurring: 'monthly', inflation: true,
      changes: [{ year: Y, month: 0, amount: care }, { year: Y + 3, month: 0, amount: pre }, { year: Y + 5, month: 0, amount: 0 }] });
    // private school K–12 (ages 5–18)
    if (wantsPrivate) {
      const tuition = privateSchoolFor(city);
      addEx({ section: 'expense', label: `Private school${suffix}`, recurring: 'yearly', inflation: true,
        changes: [{ year: Y + 5, amount: tuition }, { year: Y + 18, amount: 0 }] });
    }
    // sports / tutors / activities, ramping up with age
    const act = Math.round(4000 * tierF * col / 250) * 250;
    addEx({ section: 'expense', label: `Activities & tutors${suffix}`, recurring: 'yearly', inflation: true,
      changes: [{ year: Y + 5, amount: act }, { year: Y + 11, amount: Math.round(act * 1.5 / 250) * 250 }, { year: Y + 18, amount: 0 }] });
  });

  return [...filtered, ...extra];
}
const CARE_TYPES = ['Daycare', 'Nanny', 'Nanny share', 'Au pair', 'Preschool', 'Family help'];
const CARE_FACTOR = { 'Daycare': 1, 'Nanny': 2.3, 'Nanny share': 1.5, 'Au pair': 1.1, 'Preschool': 0.8, 'Family help': 0.2 };
function ccEstimate(city, type) {return Math.round(childcareFor(city) * (CARE_FACTOR[type] || 1) / 50) * 50;}

// ── the parser: text → { items, events, questions } ─────────────────────────
// Any value we couldn't read from the text is left at a sensible default AND a
// follow-up question is queued so the user can confirm or correct it.
function parseIntake(text, selectedCity) {
  const items = [];
  const questions = [];
  const events = [];
  const add = (it) => {if (items.some((x) => x.label === it.label)) return null;const full = { id: puid(), ...it };items.push(full);return full;};
  const q = (item, prompt, opts) => {
    if (!item) return;
    const o = opts || {};const ci = o.changeIdx || 0;const field = o.field || 'amount';
    questions.push({ id: item.id, label: item.label, prompt, kind: o.kind || 'money', unit: o.unit || '', field, changeIdx: ci, suggested: item.changes[ci][field], cityDriven: !!o.cityDriven });
  };
  const whole = (text || '').toLowerCase();
  const detectedCity = detectCity(text);
  // location-sensitive estimates scale to where the user lives
  const costCity = selectedCity || detectedCity || null;
  const col = colFactor(costCity);
  const sentences = (text || '').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const has = (re) => re.test(whole);
  const sentFor = (re) => sentences.find((s) => re.test(s.toLowerCase())) || '';

  // SALARY — monthly income
  if (has(/salary|software|engineer|take[- ]?home|paycheck|wage|\bmake\b|\bearn\b/)) {
    const s = sentFor(/salary|software|take[- ]?home|make|earn|month|\/mo/);
    let amt = firstAmount(s);const explicit = amt != null;
    let monthly = amt;
    if (amt && /year|yr|annually|\/\s?yr/i.test(s)) monthly = Math.round(amt / 12);
    if (amt && amt > 40000 && !/month|\/mo/i.test(s)) monthly = Math.round(amt / 12);
    const it = add({ section: 'income', label: 'Salary', recurring: 'monthly', inflation: false, changes: [{ year: START_YEAR, month: 0, amount: monthly || 9000 }] });
    if (!explicit) q(it, 'About how much do you take home each month?', { unit: '/mo' });
  }
  // SIDE INCOME
  if (has(/side (project|income|gig|hustle)|freelanc/)) {
    const amt = firstAmount(sentFor(/side|freelanc/));
    const it = add({ section: 'income', label: 'Side income', recurring: 'monthly', inflation: false, changes: [{ year: START_YEAR, month: 0, amount: amt || 1500 }] });
    if (amt == null) q(it, 'Roughly how much side income per month?', { unit: '/mo' });
  }
  // 401(k) — employer match (income) and/or balance (asset)
  if (has(/401\(?k\)?/)) {
    const s = sentFor(/401/);
    const amt = amountNear(s, '401') || firstAmount(s);
    if (/match|contribut|max/.test(whole)) add({ section: 'income', label: '401(k) match', recurring: 'yearly', inflation: false, changes: [{ year: START_YEAR, amount: 7600 }] });
    if (amt && amt >= 5000) add({ section: 'asset', label: '401(k)', assetType: '401k', growth: 0.06, changes: [{ year: START_YEAR, amount: amt }] });
  }
  // HOUSE — only when there is clear intent to BUY (not just the word "house",
  // e.g. "hamptons-house"), and never when they're describing renting.
  const wantsHouse = /\b(buy|buying|purchase|purchasing|afford|own|owning)\s+(a\s+|an\s+|our\s+|my\s+|the\s+|another\s+)?(house|home|place|condo|townhouse|co-?op|property|apartment)\b|\bbuy a (home|place)\b|\bmortgage\b|\bdown ?payment\b|\bhouse[-\s]?hunt/i.test(whole);
  const houseSent = sentFor(/buy|purchas|mortgage|down ?payment|house|home|condo/);
  const houseYearExplicit = (inYearsFrom(houseSent) || firstYear(houseSent)) != null;
  const houseYear = inYearsFrom(houseSent) || firstYear(houseSent) || (START_YEAR + 3);
  if (wantsHouse) {
    const amt = largestAmount(houseSent);
    const beds = detectBeds(houseSent);
    const it = add({ section: 'asset', label: 'House', growth: 0.035, changes: [{ year: houseYear, amount: amt != null ? amt : homeEstimate(costCity, beds) }] });
    if (amt == null) q(it, 'About how much will the house cost?', {});
    if (!houseYearExplicit) q(it, 'Which year do you plan to buy?', { kind: 'year', field: 'year' });
  }
  // RENT (expense) — "rent", "renting", "rented". Ends only if they're buying.
  if (/\brent(ing|ed|s)?\b/.test(whole)) {
    const rs = sentFor(/\brent(ing|ed|s)?\b/);
    const amt = firstAmount(rs);
    const beds = detectBeds(rs + ' ' + sentFor(/apartment|bedroom/));
    const it = { section: 'expense', label: 'Rent', recurring: 'monthly', inflation: true, changes: [{ year: START_YEAR, month: 0, amount: amt != null ? amt : rentEstimate(costCity, beds) }] };
    if (wantsHouse) it.endYear = houseYear;
    const added = add(it);
    if (amt == null) q(added, 'What’s your monthly rent?', { unit: '/mo' });
  }
  // KIDS → childcare expense (no baby markers/events)
  if (has(/kid|child|baby|babies|childcare|daycare|nanny|preschool/)) {
    const yrs = (text.match(/\b(20[2-5]\d)\b/g) || []).map(Number).filter((y) => y >= START_YEAR);
    const startKnown = yrs.length > 0;
    const start = startKnown ? Math.min(...yrs) : 2028;
    const endY = start + 6;
    const it = add({ section: 'expense', label: 'Childcare', recurring: 'monthly', inflation: true, changes: [{ year: start, month: 0, amount: ccEstimate(detectedCity, 'Daycare') }, { year: endY, month: 0, amount: 0 }] });
    if (!detectedCity) questions.unshift({ id: '__city', target: 'city', kind: 'city', field: 'city', prompt: 'Which city do you live in?', options: CITY_OPTIONS, suggested: '' });
    if (!startKnown) q(it, 'What year will your first child arrive?', { kind: 'year', field: 'year', changeIdx: 0 });
    questions.push({ id: '__cctype', target: 'cctype', kind: 'choice', field: 'type', prompt: 'What kind of childcare?', options: CARE_TYPES, suggested: 'Daycare' });
    q(it, 'About how much will childcare cost per month?', { unit: '/mo', cityDriven: true });
    q(it, 'Until what year will you pay for childcare?', { kind: 'year', field: 'year', changeIdx: 1 });
  }
  // CAR LOAN
  if (has(/car loan|car payment|auto loan/)) {
    const amt = firstAmount(sentFor(/car/));const explicit = amt != null && amt < 5000;
    const it = add({ section: 'expense', label: 'Car loan', recurring: 'monthly', inflation: false, changes: [{ year: START_YEAR, month: 0, amount: explicit ? amt : 480 }], endYear: START_YEAR + 4 });
    if (!explicit) q(it, 'What’s your monthly car payment?', { unit: '/mo' });
  }
  // STUDENT / OTHER LOANS
  if (has(/student loan|pay off (my )?loans?|personal loan/)) {
    add({ section: 'expense', label: 'Loan payments', recurring: 'monthly', inflation: false, changes: [{ year: START_YEAR, month: 0, amount: 700 }], endYear: START_YEAR + 5 });
  }
  // RENTAL PROPERTY
  if (has(/rental/)) {
    const amtIncome = firstAmount(sentFor(/rental/));const incExplicit = amtIncome != null && amtIncome < 20000;
    const aProp = add({ section: 'asset', label: 'Rental property', growth: 0.035, changes: [{ year: START_YEAR, amount: 450000 }] });
    q(aProp, 'Roughly what’s the rental property worth?', {});
    const aInc = add({ section: 'income', label: 'Rental income', recurring: 'monthly', inflation: true, changes: [{ year: START_YEAR, month: 0, amount: incExplicit ? amtIncome : 2200 }] });
    if (!incExplicit) q(aInc, 'How much rental income per month?', { unit: '/mo' });
  }
  // STARTUP EQUITY — if it goes public later, that's a single liquidity event in
  // the IPO year ($X in 2029); if it's already liquid, it's a holding today.
  if (has(/startup equity|equity|vest|ipo/)) {
    const s = sentFor(/equity|startup|vest/);
    const amt = amountNear(s, 'equity') || amountNear(s, 'startup') || firstAmount(s);
    const v = amt || 500000;
    let ipoYear = null;
    if (has(/go(es|ing)? public|public offering|ipo|liquidity|exit/)) {
      const ipoSent = sentFor(/go(es|ing)? public|public offering|ipo|liquidity|exit/);
      const rel = ipoSent.match(/(?:in|within)\s+(?:about\s+|around\s+|~\s*)?(\d{1,2})\s*years?/i);
      ipoYear = rel ? START_YEAR + parseInt(rel[1], 10) : firstYear(ipoSent) || START_YEAR + 3;
    }
    const it = ipoYear && ipoYear > START_YEAR ?
      add({ section: 'income', label: 'Startup equity', recurring: 'one-time', inflation: false, changes: [{ year: ipoYear, amount: v }] }) :
      add({ section: 'asset', label: 'Startup equity', assetType: 'us-stocks', growth: 0.08, changes: [{ year: START_YEAR, amount: v }] });
    if (amt == null) q(it, 'Estimated value of your startup equity?', {});
  }
  // PRIVATE SCHOOL (yearly expense)
  if (has(/private school|private education|tuition/)) {
    const amt = firstAmount(sentFor(/private school|tuition|private education/));const explicit = amt != null && amt < 200000;
    const it = add({ section: 'expense', label: 'Private school', recurring: 'yearly', inflation: true, changes: [{ year: 2030, amount: explicit ? amt : privateSchoolFor(costCity) }, { year: 2043, amount: 0 }] });
    if (!explicit) q(it, 'Yearly private-school tuition?', { unit: '/yr' });
  }
  // INHERITANCE (one-time income)
  if (has(/inherit/)) {
    const s = sentFor(/inherit/);const amt = firstAmount(s);
    const it = add({ section: 'income', label: 'Inheritance', recurring: 'one-time', inflation: false, changes: [{ year: firstYear(s) || 2035, amount: amt || 250000 }] });
    if (amt == null) q(it, 'About how much do you expect to inherit?', {});
  }
  // NEW CAR (one-time expense)
  if (has(/new car|buy a car/) && !has(/car loan|car payment|auto loan/)) {
    const s = sentFor(/car/);const amt = firstAmount(s);
    const it = add({ section: 'expense', label: 'Car', recurring: 'one-time', inflation: false, changes: [{ year: firstYear(s) || START_YEAR + 1, amount: amt || 45000 }] });
    if (amt == null) q(it, 'About how much for the new car?', {});
  }
  // CHARITABLE GIVING (monthly expense)
  if (has(/charit|donat|giving/)) {
    const amt = firstAmount(sentFor(/charit|donat|giving/));
    add({ section: 'expense', label: 'Charitable giving', recurring: 'monthly', inflation: true, changes: [{ year: START_YEAR, month: 0, amount: amt && amt < 20000 ? amt : 500 }] });
  }
  // ANNUAL BONUS (yearly income)
  if (has(/bonus/)) {
    const amt = firstAmount(sentFor(/bonus/));const explicit = amt != null && amt < 2000000;
    const it = add({ section: 'income', label: 'Annual bonus', recurring: 'yearly', inflation: false, changes: [{ year: START_YEAR, amount: explicit ? amt : 25000 }] });
    if (!explicit) q(it, 'What’s your typical annual bonus?', { unit: '/yr' });
  }
  // TRAVEL (monthly expense)
  if (has(/travel/) || has(/vacation/) && !has(/vacation home|second home/)) {
    const amt = firstAmount(sentFor(/travel|vacation/));
    // only set an explicit amount here; otherwise the city/lifestyle flesh-out
    // adds a scaled "Travel & vacations" line
    if (amt && amt < 20000) add({ section: 'expense', label: 'Travel', recurring: 'monthly', inflation: true, changes: [{ year: START_YEAR, month: 0, amount: amt }] });
  }
  // WEDDING (one-time expense)
  if (has(/wedding/)) {
    const s = sentFor(/wedding/);const amt = firstAmount(s);
    const it = add({ section: 'expense', label: 'Wedding', recurring: 'one-time', inflation: false, changes: [{ year: firstYear(s) || START_YEAR + 1, amount: amt != null ? amt : Math.round(40000 * col / 500) * 500 }] });
    if (amt == null) q(it, 'What’s the wedding budget?', {});
  }
  // GRAD SCHOOL (one-time expense)
  if (has(/grad school|graduate school|\bmba\b/)) {
    const s = sentFor(/grad|mba/);const amt = firstAmount(s);
    const it = add({ section: 'expense', label: 'Grad school', recurring: 'one-time', inflation: false, changes: [{ year: firstYear(s) || START_YEAR + 2, amount: amt || 60000 }] });
    if (amt == null) q(it, 'About how much will grad school cost?', {});
  }
  // AGING PARENTS / FAMILY SUPPORT (monthly expense)
  if (has(/aging parent|eldercare|elder care|support my (parents|mom|dad|family)/)) {
    const amt = firstAmount(sentFor(/parent|eldercare|elder|support/));
    add({ section: 'expense', label: 'Family support', recurring: 'monthly', inflation: true, changes: [{ year: START_YEAR, month: 0, amount: amt && amt < 20000 ? amt : 1000 }] });
  }
  // PET (monthly expense)
  if (has(/\bpet\b|\bdog\b|\bcat\b/)) {
    const amt = firstAmount(sentFor(/pet|dog|cat/));
    add({ section: 'expense', label: 'Pet', recurring: 'monthly', inflation: true, changes: [{ year: START_YEAR, month: 0, amount: amt && amt < 5000 ? amt : 150 }] });
  }
  // CRYPTO (asset)
  if (has(/crypto|bitcoin|ethereum/)) {
    const amt = firstAmount(sentFor(/crypto|bitcoin|ethereum/));
    const it = add({ section: 'asset', label: 'Crypto', growth: 0.10, changes: [{ year: START_YEAR, amount: amt || 30000 }] });
    if (amt == null) q(it, 'How much do you hold in crypto?', {});
  }
  // VACATION / SECOND HOME (asset)
  if (has(/vacation home|second home|beach house/)) {
    const s = sentFor(/vacation home|second home|beach house/);const amt = largestAmount(s);
    const it = add({ section: 'asset', label: 'Vacation home', growth: 0.035, changes: [{ year: firstYear(s) || inYearsFrom(s) || 2032, amount: amt || 600000 }] });
    if (amt == null) q(it, 'About how much for the vacation home?', {});
  }
  // INDEX FUNDS / BROKERAGE / SAVINGS
  if (has(/index fund|brokerage|invest|stocks|savings|saved/)) {
    const s = sentFor(/index|brokerage|invest|stock|savings|saved/);
    const amt = amountNear(s, 'index') || amountNear(s, 'brokerage') || amountNear(s, 'fund') || firstAmount(s);
    const isSavings = /savings|saved/.test(s) && !/index|invest|brokerage/.test(s);
    const label = isSavings ? 'Savings' : 'Index funds';
    const it = add({ section: 'asset', label, assetType: isSavings ? 'federal-bonds' : 'us-stocks', growth: isSavings ? 0.03 : 0.06, changes: [{ year: START_YEAR, amount: amt || 320000 }] });
    if (amt == null) q(it, `How much do you have in ${label.toLowerCase()}?`, {});
  }
  // SINGLE / PUBLIC-COMPANY STOCK, RSUs (a concentrated position, separate from
  // diversified index funds) — e.g. "$6mm in stock from a company that just IPO'd"
  if (/\brsus?\b|\bshares\b|\b(in|of)\s+stock\b|stock from|company stock|public stock|just ipo/.test(whole)) {
    const ss = sentFor(/\brsus?\b|\bshares\b|\bstock\b|ipo/);
    const amt = amountNear(ss, 'stock') || amountNear(ss, 'shares') || amountNear(ss, 'rsu') || firstAmount(ss);
    if (amt) {
      const volatile = /volatile|risky|concentrated|just ipo/.test(ss);
      add({ section: 'asset', label: 'Public stock', assetType: 'us-stocks', growth: 0.06, ...(volatile ? { vol: 0.30 } : {}), changes: [{ year: START_YEAR, amount: amt }] });
    }
  }

  const detectedAge = detectAge(text);
  if (detectedAge == null) {
    questions.unshift({ id: '__age', target: 'age', kind: 'age', field: 'startAge', prompt: 'How old are you today?', unit: '', suggested: 32 });
  }
  return { items, events, questions, detectedAge, detectedCity };
}

// apply follow-up answers (blank → keep the suggested estimate)
function applyAnswers(items, questions, answers) {
  const clone = items.map((it) => ({ ...it, changes: it.changes ? it.changes.map((c) => ({ ...c })) : it.changes }));
  (questions || []).forEach((qq) => {
    const key = qq.id + ':' + qq.field;
    const raw = answers[key];
    let val = raw != null && String(raw) !== '' ? parseInt(String(raw).replace(/[^0-9]/g, ''), 10) : null;
    if (!Number.isFinite(val)) val = qq.suggested;
    const it = clone.find((x) => x.id === qq.id);
    if (it && it.changes && it.changes[qq.changeIdx]) it.changes[qq.changeIdx][qq.field] = val;
  });
  return clone;
}

// ── preview helpers ─────────────────────────────────────────────────────────
const SECTION_TITLE = { income: 'Income', expense: 'Expenses', asset: 'Your money' };
function previewVal(it) {
  if (it.section === 'asset') {
    const c = (it.changes || [])[0] || { amount: 0 };
    return fmtShort(c.amount) + (c.year > START_YEAR ? ` · ${c.year}` : '');
  }
  if (it.recurring === 'monthly') {
    const c = (it.changes || [])[0] || { amount: 0 };
    return `$${(c.amount || 0).toLocaleString()}/mo` + (it.endYear ? ` · ends ${it.endYear}` : '');
  }
  if (it.recurring === 'one-time') {
    const c = (it.changes || [])[0] || { amount: 0 };
    return `${fmtShort(c.amount)} · ${c.year}`;
  }
  const c = (it.changes || [])[0] || { amount: 0 };
  if (it.label === '401(k) match') return '4% of salary';
  return `$${(c.amount || 0).toLocaleString()}/yr`;
}
function previewGroups(items) {
  const order = ['income', 'expense', 'asset'];
  return order.map((sec) => ({ sec, title: SECTION_TITLE[sec], rows: items.filter((i) => i.section === sec) })).filter((g) => g.rows.length);
}

// right-hand live preview pane (shared by both phases)
function PreviewPane({ items, label }) {
  const groups = previewGroups(items);
  const count = items.length;
  return (
    <div style={{ padding: '36px 34px', background: WF.fill, display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: WF.mono, fontSize: WF.fs(9.5), letterSpacing: 0.5, textTransform: 'uppercase', color: WF.ink3 }}>{label || 'we’ll draft this — preview'}</span>
        <span style={{ fontFamily: WF.mono, fontSize: WF.fs(9.5), color: WF.ink3 }}>{count ? `${count} item${count === 1 ? '' : 's'} · editable` : 'waiting for input'}</span>
      </div>
      {!count ?
      <div className="wf-hatch" style={{ flex: 1, border: `1px dashed ${WF.line}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, textAlign: 'center', padding: 30 }}>
          <Sparkle size={20} color={WF.ink3} />
          <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10.5), color: WF.ink3, maxWidth: 220, lineHeight: 1.6 }}>as you describe your life, the items we detect will appear here</span>
        </div> :

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {groups.map((g) =>
        <div key={g.sec} style={{ background: WF.paper, border: `1px solid ${WF.line}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 13px', borderBottom: `1px solid ${WF.line2}` }}>
                <span style={{ fontFamily: WF.sans, fontSize: WF.fs(12.5), fontWeight: 700, color: WF.ink }}>{g.title}</span>
                <span style={{ fontFamily: WF.mono, fontSize: WF.fs(9), color: WF.ink3 }}>{g.rows.length} item{g.rows.length === 1 ? '' : 's'}</span>
              </div>
              {g.rows.map((it, i) =>
          <div key={it.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 13px', borderTop: i ? `1px solid ${WF.line2}` : 'none' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 5, height: 5, borderRadius: 5, background: WF.ink3 }} />
                    <span style={{ fontFamily: WF.sans, fontSize: WF.fs(12.5), color: WF.ink }}>{it.label}</span>
                  </span>
                  <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10.5), color: WF.ink2 }}>{previewVal(it)}</span>
                </div>
          )}
            </div>
        )}
        </div>
      }
      <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 9, fontFamily: WF.mono, fontSize: WF.fs(10), color: WF.ink3 }}>
        <svg width="64" height="22" viewBox="0 0 64 22" fill="none" stroke={WF.ink2} strokeWidth="1.6" strokeLinecap="round"><path d="M2 20C14 20 16 4 30 4s18 10 32 2" /></svg>
        <span style={{ textTransform: 'none' }}>a net-worth projection appears the moment you draft</span>
      </div>
    </div>);

}

// ── chips (append a detail sentence). City-sensitive amounts (house, childcare,
// private school, wedding) adjust to the city entered in the form. ─────────────
function introChips(city) {
  const col = colFactor(city);
  const chipM = (v) => v >= 1e6 ? '$' + (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : '$' + Math.round(v / 1000) + 'k';
  const house = homeEstimate(city, null);
  const ps = privateSchoolFor(city);
  const wedding = Math.round(40000 * col / 500) * 500;
  const cc = ccEstimate(city, 'Daycare');
  return [
    { label: '+ Buy a house', add: ` We want to buy a ~${chipM(house)} house in about 3 years.` },
    { label: '+ Two kids', add: ` Planning two kids, around 2028 and 2030, daycare about $${cc.toLocaleString()}/mo.` },
    { label: '+ Private school', add: ` We plan private school for the kids, about ${chipM(ps)}/yr each.` },
    { label: '+ Max out 401(k)', add: ' I contribute the max to my 401(k) with a 4% match.' },
    { label: '+ Startup equity', add: ' I also hold startup equity that may vest soon.' },
    { label: '+ Pay off loans', add: ' I have student loans I want paid off in 5 years.' },
    { label: '+ Car loan', add: ' We have a $480/mo car loan with 4 years left.' },
    { label: '+ New car', add: ' We will buy a new car for $45k in 2027.' },
    { label: '+ Side income', add: ' I make about $1,500/mo from a side project.' },
    { label: '+ Rental property', add: ' We own a rental that brings in $2,200/mo.' },
    { label: '+ Inheritance', add: ' I expect an inheritance of about $250k around 2035.' },
    { label: '+ Charitable giving', add: ' We give about $500/mo to charity.' },
    { label: '+ Annual bonus', add: ' I get an annual bonus of about $25k.' },
    { label: '+ Travel', add: ' We spend about $800/mo on travel.' },
    { label: '+ Wedding', add: ` We are paying for a wedding, about ${chipM(wedding)} in 2027.` },
    { label: '+ Grad school', add: ' I plan grad school costing about $60k around 2028.' },
    { label: '+ Aging parents', add: ' I help support my parents, about $1,000/mo.' },
    { label: '+ Pet', add: ' We have a dog that costs about $150/mo.' },
    { label: '+ Crypto', add: ' I hold about $30k in crypto.' },
    { label: '+ Vacation home', add: ' We want a vacation home for $600k in 2032.' }];
}

const INTRO_EXAMPLE = "I'm 32, take home about $14k/month from a software job. We rent for $4,200 and want to buy a ~$1.4M house in 3 years. Two kids planned around 2028 and 2030. I have ~$320k in index funds and $90k in my 401k, contributing the max.";

// ── header chrome ─────────────────────────────────────────────────────────────
function IntroHeader({ step }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', borderBottom: `1px solid ${WF.line}`, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ fontFamily: WF.sans, fontWeight: 700, fontSize: WF.fs(18), letterSpacing: -0.2, color: WF.ink }}>Soroban</span>
        <span style={{ fontFamily: WF.mono, fontSize: WF.fs(9), color: WF.ink3, letterSpacing: 0.5, textTransform: 'uppercase' }}>beta</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {[0, 1].map((i) => <span key={i} style={{ width: i === step ? 18 : 7, height: 7, borderRadius: 4, background: i <= step ? WF.ink : WF.line, transition: 'all .2s' }} />)}
      </div>
    </div>);

}

// ── money / year field used in the follow-up step ─────────────────────────────
function QField({ q, value, onChange }) {
  const [hov, setHov] = React.useState(null);
  if (q.kind === 'city' || q.kind === 'choice') {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {q.options.map((c) => {const on = value === c;return (
            <button key={c} className="wf-tab" onMouseEnter={() => setHov(c)} onMouseLeave={() => setHov((h) => h === c ? null : h)} onClick={() => onChange(c)} style={{ fontFamily: WF.sans, fontSize: WF.fs(11.5), color: on ? WF.paper : WF.ink2, background: on ? WF.ink : hov === c ? WF.fill : WF.paper, border: `1px solid ${on || hov === c ? WF.ink : WF.line}`, padding: '5px 11px', cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none' }}>{c}</button>);
        })}
      </div>);

  }
  if (q.kind === 'age') {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
        <input type="text" inputMode="numeric" value={value} placeholder={String(q.suggested)}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
        style={{ width: 70, textAlign: 'center', border: `1.5px solid ${WF.ink}`, padding: '9px 6px', fontFamily: WF.mono, fontSize: WF.fs(16), fontWeight: 700, color: WF.ink, outline: 'none', background: WF.paper }} />
        <span style={{ fontFamily: WF.sans, fontSize: WF.fs(14), color: WF.ink2 }}>years old</span>
      </div>);

  }
  if (q.kind === 'year') {
    return (
      <input type="text" inputMode="numeric" value={value} placeholder={String(q.suggested)}
      onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
      style={{ width: 110, textAlign: 'left', border: `1.5px solid ${WF.ink}`, padding: '9px 11px', fontFamily: WF.mono, fontSize: WF.fs(14), fontWeight: 600, color: WF.ink, outline: 'none', background: WF.paper }} />);

  }
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: `1.5px solid ${WF.ink}`, padding: '0 11px', height: 40, width: 240, background: WF.paper }}>
      <span style={{ fontFamily: WF.mono, fontSize: WF.fs(13), color: WF.ink3 }}>$</span>
      <input type="text" inputMode="numeric" value={value ? Number(value).toLocaleString() : ''} placeholder={Number(q.suggested).toLocaleString()}
      onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
      style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontFamily: WF.mono, fontSize: WF.fs(14), fontWeight: 600, color: WF.ink, padding: 0 }} />
      {q.unit && <span style={{ fontFamily: WF.mono, fontSize: WF.fs(12), color: WF.ink3 }}>{q.unit}</span>}
    </div>);

}

// ── city combobox: free-text entry with a filtered dropdown of known cities ──
function CityCombo({ value, onChange }) {
  const [open, setOpen] = React.useState(false);
  const [hi, setHi] = React.useState(0);
  const boxRef = React.useRef(null);
  const q = (value || '').trim().toLowerCase();
  const list = q ? US_CITIES.filter((c) => c.toLowerCase().includes(q)).slice(0, 60) : [];
  React.useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const pick = (c) => { onChange(c); setOpen(false); };
  const chevron = { backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none' stroke='%239b9b9b' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' };
  return (
    <div ref={boxRef} style={{ position: 'relative', width: 240 }}>
      <input type="text" value={value} placeholder="Start typing your city…"
        onChange={(e) => { onChange(e.target.value); setOpen(true); setHi(0); }}
        onFocus={() => { if (q) setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, list.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter') { if (open && list[hi]) { e.preventDefault(); pick(list[hi]); } }
          else if (e.key === 'Escape') setOpen(false);
        }}
        style={{ width: '100%', boxSizing: 'border-box', height: 40, border: `1.5px solid ${value ? WF.ink : WF.line}`, padding: '0 34px 0 11px', fontFamily: WF.sans, fontSize: WF.fs(14), fontWeight: 400, color: WF.ink, outline: 'none', background: WF.paper, ...chevron }} />
      {open && list.length > 0 && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, maxHeight: 224, overflowY: 'auto', background: WF.paper, border: `1.5px solid ${WF.ink}`, zIndex: 30, boxShadow: '0 6px 22px rgba(0,0,0,0.10)' }}>
          {list.map((c, i) => (
            <div key={c} onMouseDown={(e) => { e.preventDefault(); pick(c); }} onMouseEnter={() => setHi(i)}
              style={{ padding: '8px 11px', fontFamily: WF.sans, fontSize: WF.fs(13.5), color: WF.ink, cursor: 'pointer', background: i === hi ? WF.fill : WF.paper }}>{c}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── the screen ────────────────────────────────────────────────────────────────
function IntroIntake({ onDraft, onSkip, embedded, initialText, initialAge, initialCity }) {
  const [text, setText] = React.useState(initialText || '');
  const [age, setAge] = React.useState(initialAge != null ? String(initialAge) : '');
  const [city, setCity] = React.useState(initialCity || '');
  const ref = React.useRef(null);

  const ageNum = parseInt(String(age).replace(/[^0-9]/g, ''), 10);
  const ageOk = Number.isFinite(ageNum) && ageNum >= 16 && ageNum <= 90;
  const ready = text.trim().length > 12 && ageOk && !!city;
  const addChip = (s) => {
    const ta = ref.current;const add = s.trim();
    const fallback = () => setText((t) => (t + (t && !t.endsWith(' ') ? ' ' : '') + add).trim());
    if (ta) {
      ta.focus();
      const cur = ta.value;const sep = cur && !cur.endsWith(' ') ? ' ' : '';
      ta.setSelectionRange(cur.length, cur.length);
      if (!document.execCommand('insertText', false, sep + add)) fallback();
    } else fallback();
  };

  // No follow-up screen: age + city are collected right here, and every other
  // detail we couldn't read from the text falls back to its built-in estimate.
  const draft = () => {
    const p = parseIntake(text, city || null);
    const effectiveCity = city || p.detectedCity || null;
    const resolvedQuestions = p.questions.map((qq) => qq.cityDriven ? { ...qq, suggested: ccEstimate(effectiveCity, 'Daycare') } : qq);
    const applied = applyAnswers(p.items, resolvedQuestions, {});
    // flesh out the ordinary cost of living for their city + lifestyle, plus
    // per-child childcare / schooling phased to each kid's birth year
    const full = fleshOutPlan(applied, effectiveCity, text);
    // persist the city so cost estimates everywhere (e.g. Ask AI) use it
    try { if (effectiveCity) localStorage.setItem('soroban-city-v1', effectiveCity); localStorage.setItem('soroban-intake-text', text); localStorage.setItem('soroban-intake-age', String(age || '')); } catch (e) {}
    let sa = parseInt(String(age).replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(sa)) sa = p.detectedAge || 32;
    sa = Math.min(Math.max(sa, 16), 90);
    onDraft({ items: full, events: p.events, startAge: sa });
  };

  // ── single intake step (no follow-up screen) ──
  return (
    <div data-screen-label="Soroban — Welcome" style={embedded ? { fontFamily: WF.sans } : { position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: WF.paper, fontFamily: WF.sans }}>
      {!embedded && <IntroHeader step={0} />}
      <div style={embedded ? { display: 'flex', justifyContent: 'center' } : { flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: 740, padding: embedded ? '6px 0 4px' : '40px 44px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22, alignItems: 'flex-start', padding: '2px 0 2px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <span style={{ fontFamily: WF.sans, fontSize: WF.fs(13.5), fontWeight: 600, color: WF.ink }}>How old are you today?<span style={{ color: '#c0392b', marginLeft: 2 }}>*</span></span>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
                <input type="text" inputMode="numeric" value={age} placeholder="32"
                onChange={(e) => setAge(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
                style={{ width: 70, height: 40, boxSizing: 'border-box', textAlign: 'left', border: `1.5px solid ${age ? WF.ink : WF.line}`, padding: '0 11px', fontFamily: WF.sans, fontSize: WF.fs(14), fontWeight: 400, color: WF.ink, outline: 'none', background: WF.paper }} />
                <span style={{ fontFamily: WF.sans, fontSize: WF.fs(14), color: WF.ink2 }}>years old</span>
              </div>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <span style={{ fontFamily: WF.sans, fontSize: WF.fs(13.5), fontWeight: 600, color: WF.ink }}>Where do you live?<span style={{ color: '#c0392b', marginLeft: 2 }}>*</span></span>
              <CityCombo value={city} onChange={setCity} />
            </label>
          </div>
          <div style={{ border: `1.5px solid ${WF.ink}`, padding: '13px 15px', minHeight: 200, display: 'flex', flexDirection: 'column', gap: 9, background: WF.paper, boxShadow: '0 0 0 3px ' + WF.fill2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Sparkle size={13} />
              <span style={{ fontFamily: WF.mono, fontSize: WF.fs(9.5), letterSpacing: 0.5, textTransform: 'uppercase', color: WF.ink3 }}>describe your situation</span>
            </div>
            <textarea ref={ref} value={text} onChange={(e) => setText(e.target.value)} autoFocus
            placeholder="Start typing… e.g. “I make $9k/month, rent is $2,800, I have $40k saved and want to buy a place in 5 years.”"
            style={{ flex: 1, border: 'none', outline: 'none', resize: 'none', background: 'transparent', fontFamily: WF.sans, fontSize: WF.fs(14.5), lineHeight: 1.6, color: WF.ink, padding: 0 }} />
            <div style={{ display: 'flex', justifyContent: 'flex-start', paddingTop: 4 }}>
              <button onClick={() => {const ta = ref.current;if (ta) {ta.focus();ta.select();if (!document.execCommand('insertText', false, INTRO_EXAMPLE)) setText(INTRO_EXAMPLE);} else setText(INTRO_EXAMPLE);}} style={{ fontFamily: WF.sans, fontSize: WF.fs(12), color: WF.ink3, cursor: 'pointer', background: 'none', border: 'none', padding: 0, textDecoration: 'underline', textUnderlineOffset: 2 }}>Paste an example</button>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            <span style={{ fontFamily: WF.mono, fontSize: WF.fs(9.5), color: WF.ink3, alignSelf: 'center', marginRight: 2, textTransform: 'uppercase' }}>or add a detail:</span>
            {introChips(city).map((c) =>
            <button key={c.label} className="wf-tab wf-try-btn" onClick={() => addChip(c.add)} style={{ fontFamily: WF.sans, fontSize: WF.fs(11.5), color: WF.ink2, border: `1px solid ${WF.line}`, padding: '5px 11px', cursor: 'pointer', background: WF.paper, appearance: 'none', WebkitAppearance: 'none' }}>{c.label}</button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 'auto', paddingTop: 6 }}>
            <span style={{ flex: 1 }} />
            {!ready && (text.trim().length > 12) && (!ageOk || !city) && (
            <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10.5), color: '#c0392b', marginRight: 4 }}>
              {(!ageOk && !city) ? 'Age and city are required' : !ageOk ? 'Age is required' : 'City is required'}
            </span>
            )}
            <button onClick={ready ? draft : undefined}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 9, height: 42, padding: '0 20px', border: `1.5px solid ${WF.ink}`, background: WF.ink, color: WF.paper, fontFamily: WF.sans, fontSize: WF.fs(14), fontWeight: 700, cursor: ready ? 'pointer' : 'not-allowed', opacity: ready ? 1 : 0.4 }}>
              <Sparkle size={14} color={WF.paper} /> Draft my plan
            </button>
          </div>
        </div>
      </div>
    </div>);

}

Object.assign(window, { IntroIntake, parseIntake, privateSchoolFor, ccEstimate, colFactor, homeEstimate, rentEstimate });