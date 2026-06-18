// proto-app.jsx — assembles the full Soroban prototype: header, sticky
// graph (condenses on scroll), Ask-AI, sectioned plan list, delete flows,
import React from 'react';
// undo toast, and whole-plan empty state.

// ── translate a real-app scenario export (plannerState) into the prototype's
// { items, events } model: flows → income/expense items, assets → asset items,
// and set-flow-formula events become per-item value changes. ──
function evalScenarioFormula(formula, vars) {
  if (formula == null) return 0;
  let s = String(formula).trim();
  if (!s) return 0;
  // substitute variable names with their numeric values; unknown names → 0
  s = s.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (name) => name in vars ? '(' + vars[name] + ')' : '(0)');
  // drop thousands separators (e.g. "30,000")
  s = s.replace(/,/g, '');
  // only allow safe arithmetic — anything else is rejected
  if (!/^[0-9+\-*/().\s]*$/.test(s)) return 0;
  try {const v = Function('return (' + s + ')')();return Number.isFinite(v) ? v : 0;} catch (e) {return 0;}
}

function scenarioToPlan(ps) {
  const vars = {};
  (ps.variables || []).forEach((v) => {vars[v.name] = Number(v.value) || 0;});
  const startY = parseInt(ps.startYear, 10) || START_YEAR;

  // collect set-flow-formula changes keyed by flow name → [{ year, formula }]
  const flowChanges = {};
  (ps.events || []).forEach((ev) => {
    (ev.schedule || []).forEach((slot) => {
      const yr = slot.year && typeof slot.year === 'object' ? slot.year.year : slot.year;
      (slot.actions || []).forEach((act) => {
        if (act && act.kind === 'set-flow-formula') {
          const fn = act.flowName || ev.flowName;
          if (!fn) return;
          (flowChanges[fn] = flowChanges[fn] || []).push({ year: yr, formula: act.formula });
        }
      });
    });
  });

  const items = [];

  (ps.flows || []).forEach((f) => {
    const section = f.type === 'income' ? 'income' : 'expense';
    const base = { year: f.startYear || startY, amount: Math.round(evalScenarioFormula(f.formula, vars)) };
    const extra = (flowChanges[f.name] || []).map((c) => ({ year: c.year, amount: Math.round(evalScenarioFormula(c.formula, vars)) }));
    // merge base + scheduled changes; a later entry for the same year wins
    const byYear = {};
    [base, ...extra].forEach((c) => {byYear[c.year] = c;});
    const changes = Object.values(byYear).sort((a, b) => a.year - b.year);
    items.push({ id: puid(), section, label: f.name, recurring: 'yearly', inflation: !!f.inflationAdjusted, changes });
  });

  (ps.assets || []).forEach((a) => {
    const growth = (Number(a.expectedReturn) || 0) / 100;
    if (a.kind === 'home') {
      const amount = Math.round(a.initialCost != null ? a.initialCost : evalScenarioFormula(a.initialCostFormula, vars));
      items.push({ id: puid(), section: 'asset', label: a.name, growth, changes: [{ year: a.purchaseYear || startY, amount }] });
    } else {
      const amount = Math.round(a.startingValue != null ? a.startingValue : evalScenarioFormula(a.startingValueFormula, vars));
      items.push({ id: puid(), section: 'asset', label: a.name, growth, changes: [{ year: startY, amount }] });
    }
  });

  return { items, events: [] };
}

// loading / error state while the engine computes the first projection
function SimLoading({ err }) {
  return (
    <div style={{ height: '100%', border: `1px dashed ${WF.line}`, borderRadius: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 9, background: WF.paper, boxSizing: 'border-box' }}>
      {err ?
      <span style={{ fontFamily: WF.mono, fontSize: WF.fs(11), color: WF.ink }}>! the simulation engine failed to load — check the console and reload</span> :

      <React.Fragment>
          <style>{`@keyframes simPulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }`}</style>
          <span style={{ fontFamily: WF.sans, fontSize: WF.fs(14.5), fontWeight: 600, color: WF.ink2, animation: 'simPulse 1.4s ease-in-out infinite' }}>Running {ENGINE_ATTEMPTS} market simulations…</span>
          <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10), color: WF.ink3 }}>taxes · volatility · mortgages — computed by the real engine</span>
        </React.Fragment>
      }
    </div>);

}

// condensed sticky bar shown after scrolling
function CondensedBar({ series, plan, onExpand, nwMode, showNwToggle }) {
  const last = series[series.length - 1];
  const lbl = showNwToggle && nwMode === 'liquid' ? 'liquid net worth' : 'net worth';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 14px', background: WF.paper }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
        <Eyebrow style={{ fontSize: WF.fs(8.5) }}>{lbl} · age {last.age}</Eyebrow>
        <FlipNum value={fmtMoney(last.nw)} style={{ fontFamily: WF.sans, fontWeight: 700, fontSize: WF.fs(21), letterSpacing: -0.5, color: WF.ink, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }} />
      </div>
      <div style={{ width: 1, height: 30, background: WF.line2, flexShrink: 0 }} />
      <MiniNW series={series} plan={plan} h={44} />
      <button onClick={onExpand} title="Expand chart" className="wf-tab"
      style={{ marginLeft: 'auto', flexShrink: 0, width: 28, height: 28, border: `1px solid ${WF.line}`, borderRadius: 2, background: WF.paper, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: WF.ink2 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </button>
    </div>);
}

// headline sentence above the chart — the age is editable and decides
// how far the projection (and the graph) runs
function HeadlineP({ series, age, onAge, nwMode, showNwToggle }) {
  const minAge = series[0].age + 1;
  const maxAge = 100;
  const [draft, setDraft] = React.useState(String(age));
  const [focused, setFocused] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const inputRef = React.useRef(null);
  React.useEffect(() => {
    if (!hovered) return;
    const onKey = (e) => {
      if (document.activeElement === inputRef.current) return; // input handles it
      if (e.key === 'ArrowUp') {e.preventDefault();commit(age + 1);} else
      if (e.key === 'ArrowDown') {e.preventDefault();commit(age - 1);}
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [hovered, age]);
  React.useEffect(() => {setDraft(String(age));}, [age]);
  const at = series.find((d) => d.age === age) || series[series.length - 1];
  const commit = (v) => {
    const n = parseInt(v != null ? v : draft, 10);
    const next = Number.isFinite(n) ? Math.min(Math.max(n, minAge), maxAge) : age;
    setDraft(String(next));
    onAge(next);
  };
  return (
    <p style={{ margin: '8px 0', fontFamily: WF.sans, fontSize: WF.fs(28), fontWeight: 400, letterSpacing: -0.5, color: WF.ink, lineHeight: 1.2, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0 6px' }}>
      <span>At age</span>
      <span
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => {if (inputRef.current) {inputRef.current.focus();inputRef.current.select();}}}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'text',
          borderRadius: 0,
          borderTop: `2px solid ${focused ? WF.ink : hovered ? WF.ink2 : 'transparent'}`,
          borderLeft: `2px solid ${focused ? WF.ink : hovered ? WF.ink2 : 'transparent'}`,
          borderRight: `2px solid ${focused ? WF.ink : hovered ? WF.ink2 : 'transparent'}`,
          borderBottom: `2px solid ${focused ? WF.ink : hovered ? WF.ink2 : WF.ink}`,
          padding: '1px 5px',
          background: focused ? `${WF.ink}07` : 'transparent',
          transition: 'border-color .1s, border-radius .1s, background .1s' }}>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
          onBlur={() => {commit();setFocused(false);}}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.target.blur();else
            if (e.key === 'ArrowUp') {e.preventDefault();commit(age + 1);} else
            if (e.key === 'ArrowDown') {e.preventDefault();commit(age - 1);}
          }}
          onFocus={(e) => {e.target.select();setFocused(true);}}
          inputMode="numeric"
          title={`edit age (${minAge}–${maxAge})`}
          style={{ width: `${Math.max(draft.length, 2) + 0.3}ch`, font: 'inherit', fontWeight: 700, color: WF.ink, textAlign: 'center', border: 'none', background: 'transparent', padding: 0, outline: 'none', fontVariantNumeric: 'tabular-nums', cursor: 'text' }}>
        </input>
        <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, lineHeight: 1, userSelect: 'none', opacity: hovered || focused ? 0.8 : 0.45, transition: 'opacity .1s' }}>
          <svg width="8" height="5" viewBox="0 0 8 5" fill={WF.ink} style={{ cursor: 'pointer' }}
          onClick={(e) => {e.stopPropagation();commit(age + 1);}}><path d="M4 0L8 5H0z" /></svg>
          <svg width="8" height="5" viewBox="0 0 8 5" fill={WF.ink} style={{ cursor: 'pointer' }}
          onClick={(e) => {e.stopPropagation();commit(age - 1);}}><path d="M4 5L0 0h8z" /></svg>
        </span>
      </span>
      <span>your projected {showNwToggle && nwMode === 'liquid' ? 'liquid net worth (excl. house)' : 'net worth'} is</span>
      <FlipNum value={fmtMoney(at.nw)} style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', letterSpacing: -1 }} />
    </p>);

}

// full graph block
function FullViz({ plan, series, onMilestoneDrag, horizon, setHorizon, sim, canUndo, canRedo, onUndo, onRedo, suppressClearRef, childMarkers, onChildDrag, hideControls, onLineClick, nwMode, setNwMode, showNwToggle }) {
  const h = 252;
  const handleDragStart = () => {if (suppressClearRef) suppressClearRef.current = true;};
  const handleDragEnd = () => {if (suppressClearRef) suppressClearRef.current = false;};
  // segmented control: liquid (exclude house) vs total net worth
  const nwToggle =
  <div title="Liquid leaves your home equity out of net worth; Total includes it."
    style={{ display: 'inline-flex', alignItems: 'center', border: `1px solid ${WF.line}`, borderRadius: 2, overflow: 'hidden', flexShrink: 0, height: 26, boxSizing: 'border-box' }}>
      {[['liquid', 'Liquid'], ['total', 'Total']].map(([key, label], i) => {
        const on = (nwMode || 'total') === key;
        return (
          <button key={key} className="wf-tab" onClick={() => setNwMode && setNwMode(key)}
            title={key === 'liquid' ? "Liquid net worth — excludes your house" : "Total net worth — includes your house"}
            style={{ height: 24, padding: '0 9px', border: 'none', borderLeft: i === 0 ? 'none' : `1px solid ${WF.line}`, background: on ? WF.ink : 'transparent', color: on ? WF.paper : WF.ink2, fontFamily: WF.sans, fontSize: WF.fs(11), fontWeight: on ? 600 : 500, cursor: 'pointer', letterSpacing: -0.1 }}>
            {label}
          </button>);
      })}
    </div>;
  const undoRedoBtns =
  <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
      <button className="wf-tab" title="Undo (⌘Z)" onClick={onUndo} disabled={!canUndo}
    style={{ width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${WF.line}`, borderRadius: 2, background: 'transparent', cursor: canUndo ? 'pointer' : 'default', opacity: canUndo ? 0.8 : 0.25, transition: 'opacity .15s' }}>
        <svg width="12" height="12" viewBox="0 0 13 13" fill="none" stroke={WF.ink} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2 5H8a3 3 0 010 6H5" /><polyline points="2,2 2,5 5,5" /></svg>
      </button>
      <button className="wf-tab" title="Redo (⌘⇧Z)" onClick={onRedo} disabled={!canRedo}
    style={{ width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${WF.line}`, borderRadius: 2, background: 'transparent', cursor: canRedo ? 'pointer' : 'default', opacity: canRedo ? 0.8 : 0.25, transition: 'opacity .15s' }}>
        <svg width="12" height="12" viewBox="0 0 13 13" fill="none" stroke={WF.ink} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5H5a3 3 0 000 6h3" /><polyline points="11,2 11,5 8,5" /></svg>
      </button>
    </div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <HeadlineP series={series} age={horizon} onAge={setHorizon} nwMode={nwMode} showNwToggle={showNwToggle} />
        {!hideControls &&
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {showNwToggle && nwToggle}
          {undoRedoBtns}
        </div>}
      </div>
      <div style={{ height: h, border: 'none', borderRadius: 4, padding: '8px 6px 4px', background: '#f7f7f8', boxSizing: 'border-box' }}>
        <NetWorthChart plan={plan} series={series} w={1100} h={h - 14} onMilestoneDrag={onMilestoneDrag} onDragStart={handleDragStart} onDragEnd={handleDragEnd} childMarkers={childMarkers} onChildDrag={onChildDrag} onLineClick={onLineClick} />
      </div>
    </div>);
}

// whole-plan empty state (no items at all)
function EmptyPlan({ onRestore }) {
  return (
    <div className="wf-hatch" style={{ border: `1px dashed ${WF.line}`, borderRadius: 3, padding: '46px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
      <svg width="44" height="30" viewBox="0 0 44 30" fill="none" stroke={WF.ink3} strokeWidth="1.6"><path d="M2 27C10 27 12 5 22 5s12 14 20 14" strokeDasharray="3 4" /></svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
        <span style={{ fontFamily: WF.sans, fontSize: WF.fs(14), fontWeight: 700, color: WF.ink }}>Your plan is empty</span>
        <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10.5), color: WF.ink3, maxWidth: 380, lineHeight: 1.55 }}>add income, expenses and holdings below — or describe your life in the box above — and your net-worth projection appears here</span>
      </div>
      <Btn size="sm" onClick={onRestore}>Restore demo plan</Btn>
    </div>);

}

// plural noun for a set of linked dependents, e.g. "linked expenses"
function depNoun(deps) {
  const sections = new Set(deps.map((d) => d.section));
  const one = sections.size === 1 ? [...sections][0] : null;
  const word = one === 'expense' ? 'expense' : one === 'income' ? 'income item' : one === 'asset' ? 'asset' : 'item';
  return deps.length === 1 ? `linked ${word}` : `linked ${word === 'income item' ? 'income items' : word + 's'}`;
}

// confirm-delete modal for items that other items link to
function ConfirmDeleteModal({ confirm, plan, onCancel, onConfirm }) {
  const { item, deps } = confirm;
  const noun = depNoun(deps);
  return (
    <ModalShell onClose={onCancel} width={480}>
      <ModalHead eyebrow="delete item" title={`Delete “${item.label.trim() || '(unnamed)'}”?`} onClose={onCancel} />
      <Rule />
      <span style={{ fontFamily: WF.sans, fontSize: WF.fs(12.5), color: WF.ink2, lineHeight: 1.5 }}>
        {deps.length === 1 ? 'One item is calculated from this value and will be deleted along with it.' : `${deps.length} items are calculated from this value and will be deleted along with it.`} This can’t be undone from here — use Undo if you change your mind.
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {deps.map((r) => {
          let sy = START_YEAR;
          for (let y = START_YEAR; y <= P_RETIRE; y++) {if (valueAt(item, y) > 0) {sy = y;break;}}
          const amt = Math.round(annualOf(plan, r, sy));
          return (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 11px', border: `1px solid ${WF.line}`, borderRadius: 2, background: WF.fill }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ChainIcon size={12} />
                <span style={{ fontFamily: WF.sans, fontSize: WF.fs(12.5), fontWeight: 600, color: WF.ink }}>{r.label}</span>
              </span>
              <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10.5), color: WF.ink2 }}>{(r.link.rate * 100).toFixed(1).replace(/\.0$/, '')}% linked · {fmtShort(amt)}/yr</span>
            </div>);

        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <Btn onClick={onCancel}>Cancel</Btn>
        <Btn kind="solid" onClick={onConfirm}>Delete {deps.length} {noun}</Btn>
      </div>
    </ModalShell>);

}

// sticky viz geometry — the block keeps a constant flow height so collapsing
// never shifts the scroll content (that shift was the source of the jank)
const VIZ_BLOCK = 334; // full graph block incl. padding
const VIZ_BAR = 78; // visible strip that stays stuck (condensed bar + padding)

function App() {
  const vs = useVersionsState();
  const onMutate = React.useCallback(() => vs.setCurrentId(null), [vs.setCurrentId]);
  const [horizon, setHorizonRaw] = React.useState(() => {
    const s = parseInt(localStorage.getItem('soroban-horizon-age'), 10);
    return Number.isFinite(s) ? Math.min(Math.max(s, PLAN0.startAge + 1), 100) : 70;
  });
  const setHorizon = (n) => {
    setHorizonRaw(n);
    try {localStorage.setItem('soroban-horizon-age', String(n));} catch (e) {}
  };
  const p = usePlanState(onMutate, horizon);
  const [family, setFamily] = useFamilyState();

  // ── one-time migration: tag existing items that match FAM_TEMPLATES labels ──
  const migratedRef = React.useRef(false);
  React.useEffect(() => {
    if (migratedRef.current) return;
    migratedRef.current = true;
    if (!family.count) return;
    const yrs = family.years.slice(0, family.count);
    if (!yrs.length) return;
    const findTmpl = (it) => FAM_TEMPLATES.find((t) => t.key === it.familyKey || t.label === it.label || t.key === 'activities' && it.label === 'Activities');
    const migrated = p.items.map((it) => {
      const tmpl = findTmpl(it);
      if (!tmpl) return it;
      const newChanges = tmpl.buildChanges(yrs);
      const extraProps = tmpl.buildItem ? tmpl.buildItem(yrs) : {};
      return { ...it, familyKey: tmpl.key, label: tmpl.label, changes: newChanges, ...extraProps };
    });
    if (migrated.some((it, i) => it !== p.items[i])) p.replaceItems(migrated, p.events);
  }, [p.items.length]);
  const setFamilyAndSync = React.useCallback((newFamily) => {
    setFamily(newFamily);
    const yrs = newFamily.years.slice(0, newFamily.count);
    if (!yrs.length) return;
    const updatedItems = p.items.map((it) => {
      if (!it.familyKey) return it;
      const tmpl = FAM_TEMPLATES.find((t) => t.key === it.familyKey);
      if (!tmpl) return it;
      const newChanges = tmpl.buildChanges(yrs);
      const extraProps = tmpl.buildItem ? tmpl.buildItem(yrs) : {};
      return { ...it, changes: newChanges, ...extraProps };
    });
    if (updatedItems.some((it, i) => it !== p.items[i])) {
      p.replaceItems(updatedItems, p.events);
    }
  }, [p.items, p.events]);

  // children portion removed for now (may re-add later) — hide birth-year markers
  const childMarkers = [];
  const onChildDrag = (childIdx, newYear) => {
    const years = [...family.years];
    years[childIdx] = newYear;
    setFamilyAndSync({ ...family, years });
  };

  const fileInputRef = React.useRef(null);

  const exportJSON = () => {
    const data = { items: p.items, events: p.events };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'soroban-plan.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        let built = null;
        if (data && Array.isArray(data.items)) {
          // native prototype plan export
          built = { items: data.items, events: data.events || [] };
        } else if (data && (data.format === 'soroban-scenario' || data.plannerState)) {
          // real-app scenario export → translate into the prototype model
          built = scenarioToPlan(data.plannerState || data);
        }
        if (built && built.items.length) {
          const snapItems = pdeep(p.items);
          const snapEvents = pdeep(p.events);
          p.replaceItems(built.items, built.events);
          setOpenId(null);
          setToast({ msg: `Imported ${built.items.length} item${built.items.length === 1 ? '' : 's'} from ${file.name}`, undo: () => {p.replaceItems(snapItems, snapEvents);setToast(null);} });
        } else {
          setToast({ msg: '! invalid JSON — expected a plan or a Soroban scenario export' });
        }
      } catch (err) {
        setToast({ msg: '! could not parse JSON file' });
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  const [openId, setOpenId] = React.useState(null);
  const [introDone, setIntroDone] = React.useState(() => {try {return localStorage.getItem('soroban-proto-intake-v1') === '1';} catch (e) {return false;}});
  const [addOpen, setAddOpen] = React.useState(null);
  const [condensed, setCondensed] = React.useState(false);
  const [intakeOpen, setIntakeOpen] = React.useState(false);
  const [chartModal, setChartModal] = React.useState(false);
  const [pinExpanded, setPinExpanded] = React.useState(false);
  const [toast, setToast] = React.useState(null);
  const [confirmDel, setConfirmDel] = React.useState(null);
  const [importOpen, setImportOpen] = React.useState(false);
  const [ioMenu, setIoMenu] = React.useState(false);
  const [breakdownPct, setBreakdownPct] = React.useState(null);
  const [breakdownYear, setBreakdownYear] = React.useState(null);
  // net-worth display mode: 'total' (incl. house) or 'liquid' (excl. house)
  const [nwMode, setNwMode] = React.useState(() => {try {return localStorage.getItem('soroban-nw-mode-v1') === 'liquid' ? 'liquid' : 'total';} catch (e) {return 'total';}});
  React.useEffect(() => {try {localStorage.setItem('soroban-nw-mode-v1', nwMode);} catch (e) {}}, [nwMode]);
  const scrollRef = React.useRef(null);

  // auto-dismiss toast
  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const lastSeriesRef = React.useRef(null);
  if (p.series) lastSeriesRef.current = p.series;
  const displaySeries = p.series || lastSeriesRef.current;

  const condenseSentinelRef = React.useRef(null);
  // Flip to the condensed summary once the full chart scrolls past the top — a
  // pure geometry read that only toggles opacity. The layout height never
  // changes (the bar overlaps the chart's base via a negative margin), so this
  // can't feedback-loop or blink the way the old height-collapsing sticky did.
  React.useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return undefined;
    const handle = () => {
      const sen = condenseSentinelRef.current;
      if (!sen) return;
      const past = sen.getBoundingClientRect().top <= sc.getBoundingClientRect().top + 0.5;
      setCondensed((c) => (c === past ? c : past));
    };
    sc.addEventListener('scroll', handle, { passive: true });
    handle();
    return () => sc.removeEventListener('scroll', handle);
  }, [displaySeries]);

  // ── delete flow: undo toast; linked deps go through a confirm modal ──
  const doDelete = (item, cascade) => {
    const snapItems = pdeep(p.items);
    const snapEvents = pdeep(p.events);
    const depCount = cascade ? referencedBy(p.plan, item.id).length : 0;
    if (cascade) p.cascadeRemove(item.id);else p.removeItem(item.id);
    if (openId === item.id) setOpenId(null);
    setToast({
      msg: depCount ? `Deleted “${item.label.trim() || '(unnamed)'}” + ${depCount} linked` : `Deleted “${item.label.trim() || '(unnamed)'}”`,
      undo: () => {p.replaceItems(snapItems, snapEvents);setToast(null);}
    });
  };
  const requestDelete = (item) => {
    const deps = referencedBy(p.plan, item.id);
    if (deps.length) setConfirmDel({ item, deps });else
    doDelete(item, false);
  };

  // ── Ask-AI apply ──
  const applyParsed = (built) => {
    const ids = p.addParsed(built);
    if (ids.length) setOpenId(ids[0]);
    setToast({ msg: `Added ${built.items.length} item${built.items.length === 1 ? '' : 's'} to your plan` });
  };
  // child birth years known to the plan — lets Ask-AI resolve "our second kid"
  // to a real year. Pulls from the family band and any per-child plan items.
  const kidYears = React.useMemo(() => {
    const fromFamily = (family.years || []).slice(0, family.count || 0);
    const fromItems = p.items
      .filter((i) => i.section === 'expense' && /^(childcare|nanny|daycare)\b/i.test(i.label))
      .map((i) => (i.changes && i.changes[0] && i.changes[0].year))
      .filter((y) => typeof y === 'number');
    return [...new Set([...fromFamily, ...fromItems])].sort((a, b) => a - b);
  }, [family, p.items]);
  // saved intake (age / city / situation text) for the collapsible header + prefill
  const savedIntake = (() => { try { return { text: localStorage.getItem('soroban-intake-text') || '', age: localStorage.getItem('soroban-intake-age') || '', city: localStorage.getItem('soroban-city-v1') || '' }; } catch (e) { return { text: '', age: '', city: '' }; } })();
  const intakeSummary = [savedIntake.age && `${savedIntake.age} yrs`, savedIntake.city, savedIntake.text].filter(Boolean).join('  ·  ') || 'Age, city & situation — tap to edit';

  // ── versions ──
  const nwNow = p.series ? p.series[p.series.length - 1].nw : null;
  const saveVersion = (name, desc) => {
    vs.save(name, desc, pdeep(p.items), pdeep(p.events), nwNow);
    setToast({ msg: `Saved version “${name}”` });
  };
  const restoreVersion = (v) => {
    p.replaceItems(pdeep(v.items), pdeep(v.events || []));
    vs.setCurrentId(v.id);
    setOpenId(null);
    setToast({ msg: `Restored “${v.name}”` });
  };

  // keyboard shortcuts: Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z = redo
  React.useEffect(() => {
    const handler = (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      // let inputs / textareas keep their native undo/redo
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'z' && !e.shiftKey) {e.preventDefault();p.undo();}
      if (e.key === 'z' && e.shiftKey || e.key === 'y') {e.preventDefault();p.redo();}
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [p.undo, p.redo]);

  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const inflationPct = Math.round((p.plan.inflation || 0.025) * 1000) / 10;
  // apply the liquid (exclude-house) toggle to whatever we display
  const vizSeries = React.useMemo(
    () => displaySeries
      ? (nwMode === 'liquid' ? toLiquidSeries(displaySeries, p.plan) : toTotalSeriesWithDepletion(displaySeries, p.plan))
      : displaySeries,
    [displaySeries, nwMode, p.plan]);
  // is there a house to exclude? (controls whether the toggle is meaningful)
  const hasHome = React.useMemo(() => p.items.some((it) => !it.hidden && homeOf(it)), [p.items]);

  const empty = p.items.length === 0;
  const [emptyVisible, setEmptyVisible] = React.useState(false);
  React.useEffect(() => {
    if (empty) {const t = setTimeout(() => setEmptyVisible(true), 300);return () => clearTimeout(t);} else
    setEmptyVisible(false);
  }, [empty]);
  const dip = displaySeries && displaySeries.find((d) => d.nw < 0);

  // intake handlers — the describe box is now embedded on the plan page (shown
  // as the empty state); drafting it populates the plan and the graph appears.
  const introDraft = (built) => { if (Number.isFinite(built.startAge)) p.setStartAge(built.startAge); p.replaceItems(pdeep(built.items), pdeep(built.events || [])); setOpenId(null); };
  const introSkip = () => { p.resetDemo(); setOpenId(null); };

  return (
    <div data-screen-label="Soroban — Plan" style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: WF.paper, fontFamily: WF.sans }}>
      {/* ── scrollable content (header scrolls away with it — not sticky) ── */}
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {/* ── app header ── */}
        <div style={{ borderBottom: `1px solid ${WF.line}`, background: WF.paper }}>
        <div style={{ maxWidth: 1148, margin: '0 auto', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ fontFamily: WF.sans, fontWeight: 700, letterSpacing: -0.2, color: WF.ink, fontSize: WF.fs(18) }}>Soroban</span>
            <span style={{ fontFamily: WF.mono, fontSize: WF.fs(9), fontWeight: 400, color: WF.ink3, letterSpacing: 0.5, textTransform: 'uppercase' }}>beta</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="wf-tab" title="Clear the plan and start over from the describe box" onClick={() => { const si = pdeep(p.items), se = pdeep(p.events); p.clearAll(); setOpenId(null); setToast({ msg: 'Cleared — describe your situation to start over', undo: () => { p.replaceItems(si, se); setToast(null); } }); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 10px', boxSizing: 'border-box', border: `1px solid ${WF.line}`, borderRadius: 2, background: WF.paper, fontFamily: WF.sans, fontSize: WF.fs(12), fontWeight: 500, color: WF.ink2, cursor: 'pointer' }}>
              <svg width="12" height="11" viewBox="0 0 13 11" fill="none" stroke={WF.ink2} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5.5H2M6 1.5l-4 4 4 4" /></svg>
              Welcome
            </button>
            <div style={{ width: 1, height: 26, background: WF.line2 }} />
            <VersionControls vs={vs} nwNow={nwNow} onSave={saveVersion} onRestore={restoreVersion} />
            <div style={{ width: 1, height: 26, background: WF.line2 }} />
            <div style={{ position: 'relative' }}>
              <button className="wf-tab" onClick={() => setIoMenu((o) => !o)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 10px', boxSizing: 'border-box', border: `1px solid ${WF.line}`, borderRadius: 2, background: WF.paper, fontFamily: WF.sans, fontSize: WF.fs(12), fontWeight: 500, color: WF.ink2, cursor: 'pointer' }}>
                Import / Export
                <span className="wf-caret" style={{ fontFamily: WF.mono, fontSize: WF.fs(9), color: WF.ink3 }}>▾</span>
              </button>
              {ioMenu && <div onClick={() => setIoMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 54 }} />}
              {ioMenu &&
                <div style={{ position: 'absolute', top: 34, right: 0, width: 170, background: WF.paper, border: `1.5px solid ${WF.ink}`, borderRadius: 3, boxShadow: '0 12px 30px rgba(0,0,0,0.14)', zIndex: 55, overflow: 'hidden' }}>
                  <div className="pr-hv" onClick={() => {setIoMenu(false);fileInputRef.current && fileInputRef.current.click();}}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 13px', cursor: 'pointer' }}>
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke={WF.ink2} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5.5 7V1M2.5 4l3-3 3 3" /><path d="M1 9h9" /></svg>
                    <span style={{ fontFamily: WF.sans, fontSize: WF.fs(12), fontWeight: 500, color: WF.ink }}>Import JSON</span>
                  </div>
                  <div style={{ height: 1, background: WF.line2 }} />
                  <div className="pr-hv" onClick={() => {setIoMenu(false);exportJSON();}}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 13px', cursor: 'pointer' }}>
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke={WF.ink2} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5.5 4v6M2.5 7l3 3 3-3" /><path d="M1 1h9" /></svg>
                    <span style={{ fontFamily: WF.sans, fontSize: WF.fs(12), fontWeight: 500, color: WF.ink }}>Export JSON</span>
                  </div>
                </div>
                }
              <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImport} />
            </div>
            {/* settings */}
            <div style={{ position: 'relative' }}>
              <button className="wf-tab" onClick={() => setSettingsOpen((o) => !o)}
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, padding: 0, border: 'none', borderRadius: 2, background: settingsOpen ? WF.ink : 'transparent', color: settingsOpen ? WF.paper : WF.ink2, cursor: 'pointer' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={settingsOpen ? WF.paper : WF.ink} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
              </button>
              {settingsOpen && <div onClick={() => setSettingsOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 54 }} />}
              {settingsOpen &&
                <div style={{ position: 'absolute', top: 38, right: 0, width: 340, background: WF.paper, border: `1.5px solid ${WF.ink}`, borderRadius: 3, boxShadow: '0 12px 30px rgba(0,0,0,0.12)', zIndex: 55, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: WF.sans, fontWeight: 700, fontSize: WF.fs(13), color: WF.ink }}>Settings</span>
                    <button className="wf-tab" title="Reset to default (2.5%)" onClick={() => p.setInflation(0.025)}
                    style={{ width: 22, height: 22, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, color: WF.ink, opacity: Math.abs(inflationPct - 2.5) > 0.05 ? 1 : 0.25 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
                    </button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ fontFamily: WF.sans, fontSize: WF.fs(12.5), color: WF.ink }}>Your age today</span>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                      <input type="text" inputMode="numeric" value={p.plan.startAge}
                      onChange={(e) => {const d = e.target.value.replace(/[^0-9]/g, '').slice(0, 3);if (d === '') return;let v = parseInt(d, 10);if (v > 90) v = 90;p.setStartAge(v);if (v >= horizon) setHorizon(Math.min(v + 1, 100));}}
                      onBlur={() => {if (p.plan.startAge < 16) p.setStartAge(16);}}
                      style={{ width: 52, textAlign: 'center', border: `1.5px solid ${WF.line}`, borderRadius: 2, padding: '6px 6px', fontFamily: WF.mono, fontSize: WF.fs(13), fontWeight: 700, color: WF.ink, outline: 'none', background: WF.paper }} />
                      <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10.5), color: WF.ink3 }}>yrs</span>
                    </div>
                  </div>
                  <div style={{ height: 1, background: WF.line2 }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span style={{ fontFamily: WF.sans, fontSize: WF.fs(12.5), color: WF.ink }}>Inflation rate</span>
                      <span style={{ fontFamily: WF.mono, fontSize: WF.fs(13), fontWeight: 700, color: WF.ink }}>{inflationPct.toFixed(1)}%</span>
                    </div>
                    <div style={{ position: 'relative', height: 20, display: 'flex', alignItems: 'center' }}>
                      <div style={{ position: 'absolute', left: 0, right: 0, height: 2, background: WF.ink }} />
                      <div style={{ position: 'absolute', left: `${2.5 / 10 * 100}%`, transform: 'translateX(-50%)', width: 10, height: 10, borderRadius: '50%', background: WF.ink, pointerEvents: 'none', zIndex: 1 }} />
                      <input type="range" min="0" max="10" step="0.1" value={inflationPct}
                      onChange={(e) => p.setInflation(parseFloat(e.target.value) / 100)}
                      style={{ position: 'absolute', left: 0, width: '100%', opacity: 0, height: 20, cursor: 'pointer', zIndex: 2, margin: 0 }} />
                      <div style={{ position: 'absolute', left: `${inflationPct / 10 * 100}%`, transform: 'translateX(-50%)', width: 16, height: 16, borderRadius: '50%', background: WF.paper, border: `2px solid ${WF.ink}`, pointerEvents: 'none', zIndex: 3 }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontFamily: WF.mono, fontSize: WF.fs(9.5), color: WF.ink3 }}>0%</span>
                      <span style={{ fontFamily: WF.mono, fontSize: WF.fs(9.5), color: WF.ink3 }}>10%</span>
                    </div>
                    <div style={{ fontFamily: WF.mono, fontSize: WF.fs(10), color: WF.ink3, letterSpacing: '0.04em' }}>APPLIED TO ALL ITEMS WITH INFLATION.</div>
                  </div>
                </div>}
            </div>
            <div style={{ width: 1, height: 26, background: WF.line2 }} />
            <ProfileMenu onReset={() => {p.resetDemo();setOpenId(null);setToast({ msg: 'Demo plan restored' });}}
              onClear={() => {
                const snapItems = pdeep(p.items);const snapEvents = pdeep(p.events);
                p.clearAll();setOpenId(null);
                setToast({ msg: 'Plan cleared', undo: () => {p.replaceItems(snapItems, snapEvents);setToast(null);} });
              }} />
          </div>
        </div>
      </div>

        <div style={{ maxWidth: 1148, margin: '0 auto', padding: '0 24px 32px', boxSizing: 'border-box' }}>
          {empty ?
          <div style={{ paddingTop: 10 }}>
            <IntroIntake embedded onDraft={introDraft} onSkip={introSkip}
              initialText={savedIntake.text} initialAge={savedIntake.age} initialCity={savedIntake.city} />
          </div> :
          <React.Fragment>

          {/* collapsed “your situation” header — expands to the full describe box */}
          <div style={{ paddingTop: 12 }}>
            <button onClick={() => setIntakeOpen((o) => !o)}
              style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 13px', border: `1px solid ${intakeOpen ? WF.ink : WF.line}`, borderRadius: 0, background: WF.fill, cursor: 'pointer' }}>
              <Sparkle size={12} color={WF.ink2} />
              <span style={{ fontFamily: WF.sans, fontSize: WF.fs(12.5), fontWeight: 600, color: WF.ink, flexShrink: 0 }}>Your situation</span>
              <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10.5), color: WF.ink3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{intakeSummary}</span>
              <svg width="12" height="8" viewBox="0 0 12 8" fill="none" stroke={WF.ink2} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: intakeOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}><path d="M1 1.5L6 6.5L11 1.5" /></svg>
            </button>
          </div>
          {intakeOpen &&
          <div style={{ paddingTop: 10 }}>
            <IntroIntake embedded onDraft={(b) => { introDraft(b); setIntakeOpen(false); }} onSkip={() => { introSkip(); setIntakeOpen(false); }}
              initialText={savedIntake.text} initialAge={savedIntake.age} initialCity={savedIntake.city} />
          </div>
          }

          {/* sticky viz — always mounted once we have series, no layout-shift blink */}
          {displaySeries ?
          <React.Fragment>
            {/* full chart — scrolls away normally. The -VIZ_BAR margin lets the
                sticky summary overlap its base, so total height never changes
                (which is what used to make the sticky blink). */}
            <div style={{ height: VIZ_BLOCK, boxSizing: 'border-box', paddingTop: 14, paddingBottom: 16, marginBottom: -VIZ_BAR }}>
              <FullViz plan={p.plan} series={vizSeries} horizon={horizon} setHorizon={setHorizon} sim={p.engineLive} onMilestoneDrag={(ref, yr) => p.setChange(ref.id, ref.idx, 'year', yr)} canUndo={p.canUndo} canRedo={p.canRedo} onUndo={p.undo} onRedo={p.redo} suppressClearRef={p.suppressClearRef} childMarkers={childMarkers} onChildDrag={onChildDrag} hideControls={false} nwMode={nwMode} setNwMode={setNwMode} showNwToggle={hasHome} onLineClick={(key, year) => { if (displaySeries && displaySeries.breakdowns && displaySeries.breakdowns[key]) { setBreakdownPct(key); setBreakdownYear(year ?? null); } }} />
            </div>
            <div ref={condenseSentinelRef} aria-hidden="true" style={{ height: 1, marginBottom: -1 }} />
            <div style={{ position: 'sticky', top: 0, zIndex: 10, height: VIZ_BAR, boxSizing: 'border-box', background: WF.paper, borderBottom: `1.5px solid ${condensed ? WF.ink : 'transparent'}`, opacity: condensed ? 1 : 0, pointerEvents: condensed ? 'auto' : 'none', transition: 'opacity .2s ease, border-color .2s ease', padding: '7px 24px 8px', margin: '0 -24px' }}>
              <CondensedBar series={vizSeries} plan={p.plan} nwMode={nwMode} showNwToggle={hasHome} onExpand={() => { if (scrollRef.current) scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' }); }} />
            </div>
          </React.Fragment> :
          <div style={{ height: VIZ_BLOCK, paddingTop: 14, paddingBottom: 12, boxSizing: 'border-box' }}>
              <SimLoading err={p.engineErr} />
            </div>
          }

          {!empty && displaySeries &&
          <p style={{ margin: '2px 0 0', fontFamily: WF.mono, fontSize: WF.fs(10), lineHeight: 1.5, color: WF.ink3, textAlign: 'center' }}>ILLUSTRATIVE PROJECTION ONLY — NOT FINANCIAL ADVICE. AI CAN MAKE MISTAKES. ALWAYS CHECK IMPORTANT INFO.

          </p>
          }

          {/* negative net-worth warning */}
          {!empty && dip &&
          <ErrNote style={{ marginBottom: 12 }}>heads up — your plan dips below $0 in {dip.year} (age {dip.age}). adjust income, expenses or holdings so cash stays positive.</ErrNote>
          }

          {/* ask AI — hidden for now */}
          {false &&
          <div style={{ paddingTop: empty ? 16 : 12, paddingBottom: 0 }}>
            <AskAI onApply={applyParsed} kidYears={kidYears} city={(function(){try{return localStorage.getItem('soroban-city-v1');}catch(e){return null;}})()} />
          </div>
          }

          

          <PSectionList p={p} openId={openId} setOpenId={(id) => {setOpenId(id);setAddOpen(null);}} requestDelete={requestDelete}
          addOpen={addOpen} setAddOpen={setAddOpen}
          onAdded={(item) => {setOpenId(item.id);setToast({ msg: `Added "${item.label}"` });}}
          family={family} setFamily={setFamilyAndSync} onToast={setToast} onImport={() => setImportOpen(true)} />

          {/* (sticky summary handles its own constant-height layout — no compensator needed) */}
          </React.Fragment>
          }
        </div>
      </div>

      {/* overlays */}
      {confirmDel &&
      <ConfirmDeleteModal confirm={confirmDel} plan={p.plan}
      onCancel={() => setConfirmDel(null)}
      onConfirm={() => {doDelete(confirmDel.item, true);setConfirmDel(null);}} />
      }
      {importOpen &&
      <ImportAccountsModal onClose={() => setImportOpen(false)}
      onImport={(built, name) => {const ids = p.addParsed(built);setImportOpen(false);if (ids && ids[0]) setOpenId(ids[0]);setToast({ msg: `Imported ${built.items.length} item${built.items.length === 1 ? '' : 's'} from ${name}` });}} />
      }
      {breakdownPct && displaySeries && displaySeries.breakdowns &&
      <BreakdownModal pctKey={breakdownPct} rows={displaySeries.breakdowns[breakdownPct]} initialYear={breakdownYear} onClose={() => { setBreakdownPct(null); setBreakdownYear(null); }} />
      }
      <Toast toast={toast} onClose={() => setToast(null)} />

    </div>);

}

export { App };
