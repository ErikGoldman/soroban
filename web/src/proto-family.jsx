// proto-family.jsx — Family planning band: children count + timing → auto-suggest expenses
import React from 'react';

const FAM_KEY = 'soroban-family-v1';

// ── shared state hook (used by App so chart can also access) ──────────────
function useFamilyState() {
  const [family, setFamilyRaw] = React.useState(() => {
    try {
      const s = localStorage.getItem(FAM_KEY);
      if (s) { const f = JSON.parse(s); if (f && typeof f.count === 'number') return f; }
    } catch (e) {}
    return { count: 0, years: [] };
  });
  const setFamily = (f) => {
    setFamilyRaw(f);
    try { localStorage.setItem(FAM_KEY, JSON.stringify(f)); } catch (e) {}
  };
  return [family, setFamily];
}

// Per-child expense templates. buildChanges(sortedYears) returns a changes array.
const FAM_TEMPLATES = [
  {
    key: 'nanny',
    label: 'Nanny',
    section: 'expense',
    recurring: 'monthly',
    inflation: true,
    buildChanges: (yrs) => {
      const s = [...yrs].sort((a, b) => a - b);
      const cs = [{ year: s[0], month: 0, amount: 5000 }];
      for (let i = 1; i < s.length; i++) {
        cs.push({ year: s[i], month: 0, amount: 5000 * (i + 1) });
      }
      // step down as each child starts school (age 5)
      for (let i = 0; i < s.length - 1; i++) {
        cs.push({ year: s[i] + 5, month: 0, amount: 5000 * (s.length - i - 1) });
      }
      cs.sort((a, b) => (a.year * 12 + (a.month || 0)) - (b.year * 12 + (b.month || 0)));
      return cs;
    },
    buildItem: (yrs) => ({ endYear: yrs[yrs.length - 1] + 5 }),
  },
  {
    key: 'food',
    label: 'Food',
    section: 'expense',
    recurring: 'monthly',
    inflation: true,
    buildChanges: (yrs) => {
      const s = [...yrs].sort((a, b) => a - b);
      const cs = s.map((yr, i) => ({ year: yr, month: 0, amount: (i + 1) * 300 }));
      // step down as each child leaves at 18
      for (let i = 0; i < s.length - 1; i++) {
        cs.push({ year: s[i] + 18, month: 0, amount: (s.length - i - 1) * 300 });
      }
      cs.sort((a, b) => (a.year * 12 + (a.month || 0)) - (b.year * 12 + (b.month || 0)));
      return cs;
    },
    buildItem: (yrs) => ({ endYear: yrs[yrs.length - 1] + 18 }),
  },
  {
    key: 'k12',
    label: 'K–12 education',
    section: 'expense',
    recurring: 'yearly',
    inflation: true,
    buildChanges: (yrs) => {
      const s = [...yrs].sort((a, b) => a - b);
      const cs = [{ year: s[0] + 5, amount: 11000 }];
      for (let i = 1; i < s.length; i++) {
        cs.push({ year: s[i] + 5, amount: 11000 * (i + 1) });
      }
      for (let i = 0; i < s.length - 1; i++) {
        cs.push({ year: s[i] + 18, amount: 11000 * (s.length - i - 1) });
      }
      cs.sort((a, b) => a.year - b.year);
      return cs;
    },
    buildItem: (yrs) => ({ endYear: yrs[yrs.length - 1] + 18 }),
  },
  {
    key: 'activities',
    label: 'Children activities',
    section: 'expense',
    recurring: 'yearly',
    inflation: true,
    buildChanges: (yrs) => {
      const s = [...yrs].sort((a, b) => a - b);
      const cs = [{ year: s[0] + 5, amount: 4000 }];
      for (let i = 1; i < s.length; i++) {
        cs.push({ year: s[i] + 5, amount: 4000 * (i + 1) });
      }
      for (let i = 0; i < s.length - 1; i++) {
        cs.push({ year: s[i] + 18, amount: 4000 * (s.length - i - 1) });
      }
      cs.sort((a, b) => a.year - b.year);
      return cs;
    },
    buildItem: (yrs) => ({ endYear: yrs[yrs.length - 1] + 18 }),
  },
  {
    key: 'college',
    label: 'College',
    section: 'expense',
    recurring: 'yearly',
    inflation: false,
    buildChanges: (yrs) => {
      const s = [...yrs].sort((a, b) => a - b);
      const cs = [{ year: s[0] + 18, amount: 31000 }];
      if (s.length >= 2) {
        cs.push({ year: s[1] + 18, amount: 62000 });
        cs.push({ year: s[0] + 22, amount: 31000 });
      }
      return cs;
    },
    buildItem: (yrs) => ({ endYear: yrs[yrs.length - 1] + 22 }),
  },
];

function isSuggested(tmpl, items) {
  const kw = tmpl.key.toLowerCase().split(/[\s–-]/)[0];
  return !items.some((it) => it.section === 'expense' && it.label.toLowerCase().includes(kw === 'k12' ? 'k–12' : kw));
}

// ── controlled component — family state lives in App ──────────────────────
function FamilyBand({ family, setFamily, p, onToast }) {

  const adjustCount = (delta) => {
    const next = Math.max(0, Math.min(5, family.count + delta));
    const years = [...family.years];
    while (years.length < next) {
      const last = years[years.length - 1] || (START_YEAR + 2);
      years.push(Math.min(last + 2, START_YEAR + 20));
    }
    setFamily({ count: next, years: years.slice(0, next) });
    setDismissed(new Set());
  };

  const setChildYear = (i, yr) => {
    const years = [...family.years];
    years[i] = yr;
    setFamily({ ...family, years });
    setDismissed(new Set());
  };

  const [dismissed, setDismissed] = React.useState(new Set());

  const visibleSuggestions = React.useMemo(() => {
    if (!family.count || !family.years.length) return [];
    return FAM_TEMPLATES.filter((t) => !dismissed.has(t.key) && isSuggested(t, p.items));
  }, [family.count, family.years, p.items, dismissed]);

  const addSuggestion = (tmpl) => {
    const extraProps = tmpl.buildItem ? tmpl.buildItem(family.years.slice(0, family.count)) : {};
    const item = {
      id: puid(),
      section: tmpl.section,
      label: tmpl.label,
      recurring: tmpl.recurring,
      inflation: tmpl.inflation,
      familyKey: tmpl.key,
      changes: tmpl.buildChanges(family.years.slice(0, family.count)),
      ...extraProps,
    };
    p.addItem(item);
    onToast && onToast({ msg: `Added "${tmpl.label}" to expenses` });
  };

  const [hidden, setHidden] = React.useState(false);
  const btnBase = { cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, border: 'none' };

  if (hidden) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px 8px 23px', background: `${WF.fill}88`, borderBottom: `1px solid ${WF.line2}` }}>
        <span style={{ fontFamily: WF.sans, fontSize: WF.fs(13), fontWeight: 700, color: WF.ink }}>Children</span>
        {family.count > 0 && <span style={{ fontFamily: WF.mono, fontSize: WF.fs(11), color: WF.ink3 }}>{family.count}</span>}
        <button onClick={() => setHidden(false)} style={{ ...btnBase, marginLeft: 'auto', background: 'none', fontFamily: WF.mono, fontSize: WF.fs(11), fontWeight: 700, color: WF.ink2, letterSpacing: 0.3 }}>SHOW</button>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 0 }}>
      {/* ── configurator band ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 14px 10px 23px', background: `${WF.fill}88`, borderBottom: `1px solid ${WF.line2}`, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: WF.sans, fontSize: WF.fs(13), fontWeight: 700, color: WF.ink, flexShrink: 0 }}>Children</span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button onClick={() => adjustCount(-1)} className="btn-circle" style={{ ...btnBase, width: 21, height: 21, border: `1.5px solid ${WF.line}`, background: WF.paper, fontSize: WF.fs(14), color: WF.ink }}>–</button>
          <span style={{ fontFamily: WF.sans, fontSize: WF.fs(18), fontWeight: 700, color: WF.ink, minWidth: 16, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{family.count}</span>
          <button onClick={() => adjustCount(1)} className="btn-circle" style={{ ...btnBase, width: 21, height: 21, border: `1.5px solid ${WF.ink}`, background: WF.ink, fontSize: WF.fs(14), color: WF.paper }}>+</button>
        </div>

        {family.count > 0 && <>
          <div style={{ width: 1, height: 20, background: WF.line, flexShrink: 0 }} />
          {family.years.slice(0, family.count).map((yr, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
              <span style={{ fontFamily: WF.mono, fontSize: WF.fs(11.5), color: WF.ink2 }}>Child {i + 1} →</span>
              <YearCell value={yr} onChange={(v) => setChildYear(i, v)} w={62} />
            </div>
          ))}
        </>}

        <button onClick={() => setHidden(true)} style={{ ...btnBase, marginLeft: 'auto', background: 'none', fontFamily: WF.mono, fontSize: WF.fs(11), fontWeight: 700, color: WF.ink2, letterSpacing: 0.3 }}>HIDE</button>
      </div>

      {/* ── suggestions bar ── */}
      {visibleSuggestions.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px 8px 23px', borderBottom: `1px solid ${WF.line2}`, flexWrap: 'wrap', background: `${WF.fill}88` }}>
          <span style={{ fontFamily: WF.mono, fontSize: WF.fs(9), color: WF.ink3, textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0 }}>Suggested</span>
          {visibleSuggestions.map((s) => (
            <button key={s.key} className="wf-tab wf-try-btn" onClick={() => addSuggestion(s)}
              style={{ padding: '5px 10px', border: `1px solid ${WF.line}`, borderRadius: '999px', appearance: 'none', WebkitAppearance: 'none', background: WF.paper, fontFamily: WF.sans, fontSize: WF.fs(11.5), color: WF.ink2, cursor: 'pointer' }}>
              + {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { useFamilyState, FamilyBand, FAM_TEMPLATES });
