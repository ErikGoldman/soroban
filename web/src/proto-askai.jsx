// proto-askai.jsx — natural-language scenario input. Shows what it will add,
// has an explicit can't-parse error state, and really applies items to the plan.
import React from 'react';

function Sparkle({ size = 14, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill={color || WF.ink} style={{ flexShrink: 0 }}>
      <path d="M8 0l1.4 4.2L13.6 5.6 9.4 7 8 11.2 6.6 7 2.4 5.6 6.6 4.2z" />
      <path d="M13 9l.7 2 2 .7-2 .7L13 14.4 12.3 12.4l-2-.7 2-.7z" />
    </svg>);

}

// ── lightweight scenario parser: turns the typed note into concrete items ──
function A_AMT(s) {
  const m = String(s).match(/\$\s?([\d][\d.,]*)\s*(k|m|mm|million|thousand)?/i) || String(s).match(/\b([\d][\d.,]*)\s*(k|m|mm|million|thousand)\b/i);
  if (!m) return null;
  let n = parseFloat(String(m[1]).replace(/,/g, ''));
  const suf = (m[2] || '').toLowerCase();
  if (suf.startsWith('m')) n *= 1e6; else if (suf.startsWith('k') || suf === 'thousand') n *= 1e3;
  return Number.isFinite(n) ? Math.round(n) : null;
}
function A_YEAR(s) { const m = String(s).match(/\b(20[2-5]\d)\b/); return m ? parseInt(m[1], 10) : null; }
function A_REL(s) { const m = String(s).toLowerCase().match(/(?:in|within)\s+(?:about\s+|around\s+|~\s*)?(\d{1,2})\s*years?/); return m ? START_YEAR + parseInt(m[1], 10) : null; }
function A_KIDYEAR(s, kids) {
  const t = String(s).toLowerCase();
  if (/\b(second|2nd)\b/.test(t)) return kids[1];
  if (/\b(third|3rd)\b/.test(t)) return kids[2];
  if (/\b(first|1st)\b/.test(t)) return kids[0];
  if (/\b(new|next|the)\s+(baby|kid|child|one)\b/.test(t)) return kids[kids.length - 1];
  return undefined;
}

// Parse free text into a set of plan items. `kids` = known child birth years
// (from the plan), so phrases like "for our second" resolve to a real year.
function buildParse(text, kids, city) {
  kids = (kids || []).slice().sort((a, b) => a - b);
  const t = text.toLowerCase();
  const sents = text.split(/(?<=[.!?,;])\s+|\n+|\band\b/i).map((s) => s.trim()).filter(Boolean);
  const sentFor = (re) => sents.find((s) => re.test(s.toLowerCase())) || text;
  const rows = [];
  const items = [];
  const events = [];
  const nextYear = START_YEAR + 1;
  const lastKid = kids.length ? kids[kids.length - 1] : null;
  // city-based cost models (shared from the intake); fall back to national
  const cityName = city ? String(city).split(',')[0].trim() : null;
  const COL = window.colFactor ? window.colFactor(city) : 1;
  const PS = window.privateSchoolFor ? window.privateSchoolFor(city) : 30000;
  const CC = window.ccEstimate ? window.ccEstimate(city, 'Daycare') : 2500;
  const NANNY = window.ccEstimate ? window.ccEstimate(city, 'Nanny') : 6000;
  const HOME = (beds) => window.homeEstimate ? window.homeEstimate(city, beds) : 900000;
  const placeLabel = cityName || 'a typical U.S. city';
  // is the user asking a question rather than stating something to add?
  const isQuestion = /\?|^\s*(how|what|whats|how's|how much|roughly|about how)\b|how much|what.*(cost|spend|run)|cost (of|to|for)|how expensive|how many|average|typical/.test(t);
  let answer = null;

  const addExpense = (label, recurring, amount, year, opts) => {
    opts = opts || {};
    const ch = recurring === 'monthly' ? [{ year, month: 0, amount }] : [{ year, amount }];
    items.push({ section: 'expense', label, recurring, inflation: opts.inflation !== false, changes: ch, ...(opts.endYear ? { endYear: opts.endYear } : {}) });
    const det = recurring === 'monthly' ? `monthly · $${amount.toLocaleString()}/mo · from ${year}` :
      recurring === 'one-time' ? `one-time · ${fmtShort(amount)} · ${year}` : `yearly · ${fmtShort(amount)}/yr · from ${year}`;
    rows.push({ kind: 'expense', label, detail: det });
  };
  const addIncome = (label, recurring, amount, year) => {
    const ch = recurring === 'monthly' ? [{ year, month: 0, amount }] : [{ year, amount }];
    items.push({ section: 'income', label, recurring, inflation: false, changes: ch });
    rows.push({ kind: 'income', label, detail: recurring === 'one-time' ? `one-time · ${fmtShort(amount)} · ${year}` : `${recurring} · ${fmtShort(amount)}${recurring === 'monthly' ? '/mo' : '/yr'} · from ${year}` });
  };
  const addAsset = (label, amount, year, growth) => {
    items.push({ section: 'asset', label, assetType: 'us-stocks', growth: growth != null ? growth : 0.06, changes: [{ year, amount }] });
    rows.push({ kind: 'asset', label, detail: `${fmtShort(amount)}${year > START_YEAR ? ' · ' + year : ''} · grows ${Math.round((growth != null ? growth : 0.06) * 100)}%/yr` });
  };

  // NIGHT NURSE / NIGHT NANNY / DOULA — a one-time newborn cost
  if (/night\s*(nurse|nanny)|\bdoula\b|night nursing/.test(t)) {
    const s = sentFor(/night|doula/);
    const amt = A_AMT(s) || 40000;
    const yr = A_YEAR(s) || A_KIDYEAR(s, kids) || A_REL(s) || lastKid || nextYear;
    addExpense('Night nurse', 'one-time', amt, yr, { inflation: false });
    if (isQuestion) answer = `A night nurse typically runs about ${fmtShort(amt)} as a one-time newborn cost.`;
  }
  // NANNY (monthly)
  if (/\bnanny\b|au pair|\bnannies\b/.test(t) && !/night\s*nanny/.test(t)) {
    const s = sentFor(/nanny|au pair/);
    const amt = A_AMT(s) || NANNY;
    const yr = A_YEAR(s) || A_KIDYEAR(s, kids) || lastKid || nextYear;
    addExpense('Nanny', 'monthly', amt, yr, { endYear: yr + 5 });
    if (isQuestion) answer = `A full-time nanny in ${placeLabel} runs about $${amt.toLocaleString()}/mo (~${fmtShort(amt * 12)}/yr).`;
  }
  // DAYCARE / CHILDCARE (monthly)
  if (/daycare|child\s*care|childcare|preschool/.test(t)) {
    const s = sentFor(/daycare|child\s*care|childcare|preschool/);
    const amt = A_AMT(s) || CC;
    const yr = A_YEAR(s) || A_KIDYEAR(s, kids) || (kids[0] || nextYear);
    addExpense('Childcare', 'monthly', amt, yr, { endYear: yr + 5 });
    if (isQuestion) answer = `Full-time daycare in ${placeLabel} is about $${amt.toLocaleString()}/mo (~${fmtShort(amt * 12)}/yr per child).`;
  }
  // PRIVATE SCHOOL / TUITION (yearly)
  if (/private school|tuition|private education/.test(t)) {
    const s = sentFor(/school|tuition/);
    const amt = A_AMT(s) || PS;
    const start = A_YEAR(s) || (kids[0] ? kids[0] + 5 : 2030);
    addExpense('Private school', 'yearly', amt, start, { endYear: start + 13 });
    if (isQuestion) answer = `Private school in ${placeLabel} runs about ${fmtShort(amt)}/yr per child — roughly ${fmtShort(amt * 13)} across K–12.`;
  }
  // COLLEGE (yearly)
  if (/\bcollege\b|university/.test(t)) {
    const s = sentFor(/college|university/);
    const amt = A_AMT(s) || 35000;
    const start = A_YEAR(s) || (kids[0] ? kids[0] + 18 : 2040);
    addExpense('College', 'yearly', amt, start, { endYear: start + 4, inflation: false });
    if (isQuestion) answer = `College runs about ${fmtShort(amt)}/yr — ~${fmtShort(amt * 4)} for four years per child.`;
  }
  // TUTORS / ACTIVITIES / SPORTS (yearly)
  if (/tutor|\bsports?\b|activities|lessons/.test(t)) {
    const s = sentFor(/tutor|sport|activit|lesson/);
    const amt = A_AMT(s) || Math.round(8000 * COL / 250) * 250;
    const yr = A_YEAR(s) || (kids[0] ? kids[0] + 5 : nextYear);
    addExpense('Activities & tutors', 'yearly', amt, yr);
    if (isQuestion) answer = `Kids' activities & tutoring in ${placeLabel} run about ${fmtShort(amt)}/yr per child.`;
  }
  // BUY A HOUSE (asset) — needs real buy intent
  if (/\b(buy|buying|purchase|purchasing|afford)\s+(a\s+|our\s+|the\s+)?(house|home|place|condo|apartment)\b|\bmortgage\b|\bdown ?payment\b/.test(t)) {
    const s = sentFor(/house|home|condo|mortgage/);
    const beds = /studio|\d\s*(br|bed)/.test(s) ? (parseInt((s.match(/(\d)\s*(br|bed)/) || [])[1], 10) || null) : null;
    const amt = A_AMT(s) || HOME(beds);
    const yr = A_YEAR(s) || A_REL(s) || (START_YEAR + 3);
    addAsset('House', amt, yr, 0.035);
    if (isQuestion) answer = `A home in ${placeLabel} runs about ${fmtShort(amt)}.`;
  }
  // CAR / NEW CAR (one-time)
  if (/\b(car|vehicle|truck|suv)\b/.test(t) && !/car(e|eer)/.test(t)) {
    const s = sentFor(/\bcar\b|vehicle|truck|suv/);
    const amt = A_AMT(s) || 45000;
    const yr = A_YEAR(s) || A_REL(s) || nextYear;
    addExpense('Car', 'one-time', amt, yr, { inflation: false });
    if (isQuestion) answer = `A new car is about ${fmtShort(amt)} one-time.`;
  }
  // WEDDING (one-time)
  if (/wedding/.test(t)) {
    const s = sentFor(/wedding/);
    const amt = A_AMT(s) || Math.round(40000 * COL / 500) * 500;
    addExpense('Wedding', 'one-time', amt, A_YEAR(s) || A_REL(s) || nextYear, { inflation: false });
    if (isQuestion) answer = `A wedding in ${placeLabel} runs about ${fmtShort(amt)}.`;
  }
  // TRAVEL (monthly)
  if (/travel|vacation/.test(t) && !/vacation home/.test(t)) {
    const s = sentFor(/travel|vacation/);
    const amt = A_AMT(s) || Math.round(1500 * COL / 50) * 50;
    addExpense('Travel', 'monthly', amt, A_YEAR(s) || START_YEAR);
    if (isQuestion) answer = `Comfortable travel in ${placeLabel} runs about $${amt.toLocaleString()}/mo (~${fmtShort(amt * 12)}/yr).`;
  }
  // BONUS (yearly income)
  if (/\bbonus\b/.test(t)) {
    const s = sentFor(/bonus/);
    addIncome('Annual bonus', 'yearly', A_AMT(s) || 25000, A_YEAR(s) || START_YEAR);
  }
  // RAISE / NEW SALARY (income)
  if (/\b(raise|promotion|new salary|new job|salary)\b/.test(t)) {
    const s = sentFor(/raise|promotion|salary|new job/);
    const amt = A_AMT(s);
    if (amt) addIncome('Salary', /month|\/mo/.test(s) ? 'monthly' : 'yearly', amt, A_YEAR(s) || A_REL(s) || nextYear);
  }
  // INHERITANCE / WINDFALL / IPO proceeds (one-time income)
  if (/inherit|windfall|payout|liquidity|ipo|sell|exit/.test(t)) {
    const s = sentFor(/inherit|windfall|payout|liquidity|ipo|sell|exit/);
    const amt = A_AMT(s);
    if (amt) addIncome(/inherit/.test(s) ? 'Inheritance' : 'Liquidity event', 'one-time', amt, A_YEAR(s) || A_REL(s) || nextYear);
  }

  if (!items.length) return null;
  const labels = rows.map((r) => r.label);
  const summary = labels.length <= 2 ? labels.join(' + ') : `${labels.slice(0, 2).join(', ')} +${labels.length - 2} more`;
  const noteBits = [];
  if (cityName) noteBits.push(`Costs use ${cityName} prices.`);
  if (kids.length && rows.some((r) => /night nurse|nanny|childcare|school|college|activities/i.test(r.label))) noteBits.push(`Timed to your children's years (${kids.join(', ')}).`);
  return {
    answer,
    summary,
    rows,
    note: (noteBits.join(' ') || 'Parsed from your note.'),
    build: () => ({ items: items.map((it) => ({ ...it, id: puid(), changes: (it.changes || []).map((c) => ({ ...c })) })), events: events.slice() }),
  };
}
function parsePromptP(text, kids, city) { return buildParse(text, kids, city); }

const P_EXAMPLES = [
  'Two kids, nanny until each starts preschool',
  'Buy a $900k house in 2030',
  'Retire at 58 and live off investments',
  'Start a business in 2027 with $80k',
  'Send both kids to private college',
];


const P_KIND_GLYPH = {
  income: { shape: 'circle', fill: true },
  expense: { shape: 'circle', fill: false },
  asset: { shape: 'diamond', fill: false },
  event: { shape: 'event', fill: true }
};
function KindMark({ kind }) {
  const g = P_KIND_GLYPH[kind] || P_KIND_GLYPH.expense;
  if (g.shape === 'event') return <span style={{ width: 8, height: 8, background: WF.ink, transform: 'rotate(45deg)', flexShrink: 0 }} />;
  return <span style={{ width: 8, height: 8, flexShrink: 0, borderRadius: g.shape === 'diamond' ? 1 : '50%', transform: g.shape === 'diamond' ? 'rotate(45deg)' : 'none', background: g.fill ? WF.ink : WF.paper, border: `1.5px solid ${WF.ink}` }} />;
}

function AskAI({ onApply, kidYears, city }) {
  const [text, setText] = React.useState('');
  const [phase, setPhase] = React.useState('idle'); // idle | thinking | result | error | success
  const [result, setResult] = React.useState(null);
  const [phIdx, setPhIdx] = React.useState(0);
  const [phVis, setPhVis] = React.useState(true);
  const tRef = React.useRef();
  const phRef = React.useRef();

  // cycle placeholder
  React.useEffect(() => {
    const tick = () => {
      setPhVis(false);
      setTimeout(() => {
        setPhIdx(i => (i + 1) % P_EXAMPLES.length);
        setPhVis(true);
      }, 400);
    };
    phRef.current = setInterval(tick, 13200);
    return () => clearInterval(phRef.current);
  }, []);

  React.useEffect(() => () => clearTimeout(tRef.current), []);
  const placeholder = P_EXAMPLES[phIdx];

  const run = (q) => {
    const query = (q != null ? q : text).trim();
    if (!query) return;
    if (q != null) setText(q);
    setPhase('thinking');
    clearTimeout(tRef.current);
    tRef.current = setTimeout(() => {
      let cty = city;
      if (!cty) { try { cty = localStorage.getItem('soroban-city-v1'); } catch (e) {} }
      const parsed = parsePromptP(query, kidYears, cty);
      if (parsed) {setResult(parsed);setPhase('result');} else
      {setResult(null);setPhase('error');}
    }, 750);
  };
  const reset = () => {setPhase('idle');setText('');setResult(null);};
  const empty = !text.trim();

  const [boxHovered, setBoxHovered] = React.useState(false);
  const [boxFocused, setBoxFocused] = React.useState(false);

  return (
    <div data-screen-label="Ask AI"
      onMouseEnter={() => setBoxHovered(true)}
      onMouseLeave={() => setBoxHovered(false)}
      onFocusCapture={() => setBoxFocused(true)}
      onBlurCapture={() => setBoxFocused(false)}
      style={{ border: `1px solid ${boxFocused ? WF.ink : boxHovered ? WF.line : 'transparent'}`, borderRadius: 0, background: '#f7f7f8', overflow: 'hidden', transition: 'border-color .15s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px' }}>
        <span className="wf-sparkle-hov"><Sparkle size={15} /></span>
        <div style={{ flex: 1, position: 'relative' }}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') run(); else if (e.key === 'Escape') e.target.blur(); }}
            placeholder=""
            style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent', fontFamily: WF.sans, fontSize: WF.fs(13.5), color: WF.ink }} />
          {empty && (
            <span style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none',
              fontFamily: WF.sans, fontSize: WF.fs(13.5), color: WF.ink3, whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: '100%',
              opacity: phVis ? 1 : 0, transition: 'opacity 0.35s ease' }}>
              {placeholder}
            </span>
          )}
        </div>
        <button className={empty ? '' : 'wf-tab'} onClick={empty ? undefined : () => run()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', border: `1.5px solid ${WF.ink}`, borderRadius: 3, background: WF.ink, color: WF.paper, fontFamily: WF.sans, fontSize: WF.fs(12.5), fontWeight: 600, cursor: empty ? 'not-allowed' : 'pointer', opacity: empty ? 0.4 : 1, transition: 'background .15s' }}>
          {phase === 'thinking' ? 'Reading…' : 'Apply'}
        </button>
      </div>

      {phase === 'idle' &&
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: boxHovered ? '0 12px 6px' : '0 12px 0', flexWrap: 'wrap', maxHeight: boxHovered ? 60 : 0, overflow: 'hidden', opacity: boxHovered ? 1 : 0, transition: 'max-height .2s ease, opacity .15s ease, padding .2s ease' }}>
          <span style={{ fontFamily: WF.mono, fontSize: WF.fs(9.5), color: WF.ink3 }}>TRY:</span>
          {P_EXAMPLES.slice(0, 2).map((ex) =>
        <button key={ex} className="wf-tab wf-try-btn" onClick={() => run(ex)} style={{ padding: '5px 10px', border: `1px solid ${WF.line}`, borderRadius: '999px', appearance: 'none', WebkitAppearance: 'none', background: WF.paper, fontFamily: WF.sans, fontSize: WF.fs(11.5), color: WF.ink2, cursor: 'pointer' }}>{ex}</button>
        )}
        </div>
      }


      {phase === 'error' &&
      <div style={{ borderTop: `1px solid ${WF.line2}`, background: WF.fill, padding: '13px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <ErrNote>couldn’t turn that into plan items. try mentioning concrete things — kids &amp; childcare, or buying a house.</ErrNote>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: WF.mono, fontSize: WF.fs(9.5), color: WF.ink3 }}>these work:</span>
            {P_EXAMPLES.map((ex) =>
          <button key={ex} className="wf-tab wf-try-btn" onClick={() => run(ex)} style={{ padding: '5px 10px', border: `1px solid ${WF.line}`, borderRadius: '999px', appearance: 'none', WebkitAppearance: 'none', background: WF.paper, fontFamily: WF.sans, fontSize: WF.fs(11.5), color: WF.ink2, cursor: 'pointer' }}>{ex}</button>
          )}
            <button className="wf-tab" onClick={reset} style={{ marginLeft: 'auto', padding: '5px 10px', border: 'none', background: 'none', fontFamily: WF.mono, fontSize: WF.fs(10), color: WF.ink3, cursor: 'pointer', textDecoration: 'underline' }}>dismiss</button>
          </div>
        </div>
      }

      {phase === 'success' &&
      <div style={{ borderTop: `1px solid ${WF.line2}`, background: '#CBFF37', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10, animation: 'successSlideIn .25s ease' }}>
        <span style={{ fontFamily: WF.sans, fontSize: WF.fs(13.5), fontWeight: 600, color: '#1b1b1d' }}>Added to your plan</span>
        <svg style={{ flexShrink: 0, animation: 'checkPop .4s .1s cubic-bezier(.17,.67,.35,1.3) both' }} width="16" height="13" viewBox="0 0 16 13" fill="none" stroke="#1b1b1d" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1.5 6.5 5.5 10.5 14.5 1.5" /></svg>
      </div>
      }

      {phase === 'result' && result &&
      <div style={{ borderTop: `1px solid ${WF.line2}`, background: WF.fill, padding: '13px 14px', display: 'flex', flexDirection: 'column', gap: 11 }}>
          {result.answer &&
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', border: `1px solid ${WF.line}`, borderRadius: 3, background: WF.paper }}>
            <Sparkle size={13} color={WF.ink2} />
            <span style={{ fontFamily: WF.sans, fontSize: WF.fs(13), lineHeight: 1.5, color: WF.ink }}>{result.answer}</span>
          </div>
          }
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkle size={13} color={WF.ink2} />
              <span style={{ fontFamily: WF.sans, fontSize: WF.fs(12.5), fontWeight: 600, color: WF.ink }}>{result.answer ? 'Add it to your plan' : 'Soroban will add'}</span>
              <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10), color: WF.ink3 }}>— {result.summary}</span>
            </span>
            <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10), color: WF.ink3 }}>{result.rows.length} items</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, border: `1px solid ${WF.line}`, borderRadius: 3, background: WF.paper, overflow: 'hidden' }}>
            {result.rows.map((r, i) =>
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: i < result.rows.length - 1 ? `1px solid ${WF.line2}` : 'none' }}>
                <KindMark kind={r.kind} />
                <span style={{ fontFamily: WF.sans, fontSize: WF.fs(12.5), fontWeight: 600, color: WF.ink, width: 132, flexShrink: 0 }}>{r.label}</span>
                <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10), color: WF.ink2 }}>{r.detail}</span>
                <span style={{ marginLeft: 'auto', fontFamily: WF.mono, fontSize: WF.fs(8.5), letterSpacing: 0.4, textTransform: 'uppercase', color: WF.ink3, border: `1px solid ${WF.line}`, borderRadius: 2, padding: '1px 6px' }}>{r.kind}</span>
              </div>
          )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Anno style={{ maxWidth: 440 }}>{result.note} You can fine-tune every value after adding.</Anno>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn size="sm" onClick={reset}>Discard</Btn>
              <Btn size="sm" kind="solid" onClick={() => { const built = result.build(); setPhase('success'); onApply && onApply(built); clearTimeout(tRef.current); tRef.current = setTimeout(() => reset(), 2200); }}>Add to plan</Btn>
            </div>
          </div>
        </div>
      }
    </div>);

}

if (typeof document !== 'undefined' && !document.getElementById('wf-pulse-css')) {
  const s = document.createElement('style');
  s.id = 'wf-pulse-css';
  s.textContent = '@keyframes wfpulse{0%,100%{opacity:.25}50%{opacity:1}} .wf-pulse{animation:wfpulse 1s ease-in-out infinite} @keyframes sparkle{0%,100%{transform:scale(1) rotate(0deg)}50%{transform:scale(1.2) rotate(15deg)}} .wf-sparkle-hov:hover svg{animation:sparkle .5s ease} @keyframes checkPop{0%{transform:scale(0);opacity:0}60%{transform:scale(1.2)}100%{transform:scale(1);opacity:1}} @keyframes successSlideIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}';
  document.head.appendChild(s);
}

Object.assign(window, { AskAI, Sparkle });