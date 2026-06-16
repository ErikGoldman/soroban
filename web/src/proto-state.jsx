// proto-state.jsx — live plan state for the prototype: localStorage-backed,
// with full mutators (add / delete / rename / link-conversion) and versions.
import React from 'react';

const P_RETIRE = START_YEAR + (PLAN0.retireAge - PLAN0.startAge);
const P_KEY = 'soroban-proto-plan-v2';
const P_VKEY = 'soroban-proto-versions-v2';
const pdeep = (o) => JSON.parse(JSON.stringify(o));
const puid = () => 'it' + Math.random().toString(36).slice(2, 9);

function pLoadPlan() {
  try {
    const raw = localStorage.getItem(P_KEY);
    if (raw) { const o = JSON.parse(raw); if (o && Array.isArray(o.items) && Array.isArray(o.events)) {
      o.events = o.events.filter((e) => !/^Baby\s*\d+$/i.test(e && e.label || ''));
      // migrate the old "sell = amount:0 waypoint" into the new sale config
      o.items = o.items.map((it) => {
        if (it && it.section === 'asset' && !it.sale && Array.isArray(it.changes)) {
          const zero = it.changes.find((c) => c.amount === 0);
          if (zero) return { ...it, changes: it.changes.filter((c) => c.amount !== 0), sale: { enabled: true, year: zero.year, feePct: 0.07 } };
        }
        return it;
      });
      return o;
    } }
  } catch (e) { /* corrupted storage → fall through to demo data */ }
  return { items: pdeep(ITEMS0), events: pdeep(PLAN0.events), inflation: PLAN0.inflation };
}

function usePlanState(onMutate, horizonAge) {
  const [st, setSt] = React.useState(pLoadPlan);
  React.useEffect(() => { try { localStorage.setItem(P_KEY, JSON.stringify(st)); } catch (e) {} }, [st]);

  // ── undo / redo history ──
  const histRef = React.useRef([]);
  const futRef = React.useRef([]);
  const [_histTick, setHistTick] = React.useState(0);
  const bumpHist = () => setHistTick((t) => t + 1);

  const plan = { ...PLAN0, items: st.items, events: st.events, horizonAge: horizonAge || PLAN0.retireAge, startAge: st.startAge != null ? st.startAge : PLAN0.startAge, inflation: st.inflation != null ? st.inflation : PLAN0.inflation };

  // series comes ONLY from the real Soroban engine (Monte Carlo median).
  // Until the first result lands, series is null and the UI shows a loading state.
  const planKey = JSON.stringify([st.items, st.events, plan.horizonAge, plan.inflation]);
  const [eng, setEng] = React.useState(null);
  const [engineErr, setEngineErr] = React.useState(false);
  const [engineTick, setEngineTick] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    if (!window.SorobanEngine && window.SorobanEngineReady) {
      window.SorobanEngineReady
        .then(() => { if (alive) setEngineTick((t) => t + 1); })
        .catch(() => { if (alive) setEngineErr(true); });
    } else if (!window.SorobanEngine && !window.SorobanEngineReady) {
      setEngineErr(true);
    }
    return () => { alive = false; };
  }, []);
  // used by chart drag to suppress the loading flash during milestone drags
  const suppressClearRef = React.useRef(false);

  React.useEffect(() => {
    if (!window.SorobanEngine) return undefined;
    let alive = true;
    if (!suppressClearRef.current) setEng(null); // clear old projection immediately (but not during drags)
    const t = setTimeout(() => {
      if (!alive) return;
      try {
        const s = runEngineProjection(plan);
        if (alive && s) setEng({ key: planKey, series: s });
      } catch (e) {
        console.error('Soroban engine projection failed.', e);
        if (alive) setEngineErr(true);
      }
    }, 80);
    return () => { alive = false; clearTimeout(t); };
  }, [planKey, engineTick]);
  const engineLive = !!(eng && eng.key === planKey);
  const series = eng ? eng.series : null;

  const mut = (fn) => {
    setSt((s) => {
      histRef.current = [...histRef.current.slice(-49), { items: s.items, events: s.events }];
      futRef.current = [];
      return { ...s, ...fn(s) };
    });
    bumpHist();
    onMutate && onMutate();
  };
  const mutItems = (fn) => mut((s) => ({ items: fn(s.items) }));

  const canUndo = histRef.current.length > 0;
  const canRedo = futRef.current.length > 0;
  const undo = () => {
    if (!histRef.current.length) return;
    setSt((s) => {
      const prev = histRef.current[histRef.current.length - 1];
      histRef.current = histRef.current.slice(0, -1);
      futRef.current = [{ items: s.items, events: s.events }, ...futRef.current.slice(0, 49)];
      return { ...s, items: prev.items, events: prev.events };
    });
    bumpHist();
    onMutate && onMutate();
  };
  const redo = () => {
    if (!futRef.current.length) return;
    setSt((s) => {
      const next = futRef.current[0];
      histRef.current = [...histRef.current.slice(-49), { items: s.items, events: s.events }];
      futRef.current = futRef.current.slice(1);
      return { ...s, items: next.items, events: next.events };
    });
    bumpHist();
    onMutate && onMutate();
  };

  const update = (id, patch) => mutItems((its) => its.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const setChange = (id, idx, field, val) => mutItems((its) => its.map((it) => (it.id === id ? { ...it, changes: it.changes.map((c, i) => (i === idx ? { ...c, [field]: val } : c)) } : it)));
  const addChange = (id) => mutItems((its) => its.map((it) => {
    if (it.id !== id) return it;
    const cs = it.changes || [];
    const last = cs[cs.length - 1];
    const ny = Math.min(P_RETIRE, (last ? last.year : START_YEAR) + 5);
    const extra = it.recurring === 'monthly' ? { month: 0 } : {};
    return { ...it, changes: [...cs, { year: ny, ...extra, amount: last ? last.amount : 0 }] };
  }));
  const removeChange = (id, idx) => mutItems((its) => its.map((it) => (it.id === id && it.changes && it.changes.length > 1 ? { ...it, changes: it.changes.filter((_, i) => i !== idx) } : it)));
  const setLink = (id, patch) => mutItems((its) => its.map((it) => (it.id === id ? { ...it, link: { ...it.link, ...patch } } : it)));
  const toggleLink = (id, on) => mutItems((its) => its.map((it) => {
    if (it.id !== id) return it;
    if (on) {
      const firstAsset = its.find((a) => a.section === 'asset' && a.id !== id);
      if (!firstAsset) return it; // no possible source — UI disables this path
      return { ...it, link: { ref: firstAsset.id, rate: 0.015 } };
    }
    const refIt = it.link ? its.find((a) => a.id === it.link.ref) : null;
    const cur = refIt ? valueAt(refIt, START_YEAR) * it.link.rate : 0;
    return { ...it, link: undefined, changes: it.changes || [{ year: START_YEAR, amount: Math.round(cur) || 0 }] };
  }));

  const addItem = (item) => mutItems((items) => {
    const idx = items.map((i) => i.section).lastIndexOf(item.section);
    const arr = [...items];
    arr.splice(idx === -1 ? arr.length : idx + 1, 0, item);
    return arr;
  });
  const removeItem = (id) => mutItems((items) => items.filter((i) => i.id !== id));
  const moveItem = (id, beforeId) => mutItems((items) => {
    const item = items.find((i) => i.id === id);
    if (!item) return items;
    const arr = items.filter((i) => i.id !== id);
    if (beforeId) {
      const idx = arr.findIndex((i) => i.id === beforeId);
      if (idx !== -1) { arr.splice(idx, 0, item); return arr; }
    }
    const lastIdx = arr.reduce((best, cur, i) => cur.section === item.section ? i : best, -1);
    arr.splice(lastIdx + 1, 0, item);
    return arr;
  });

  // delete an item AND every item whose value is linked to it (cascade)
  const cascadeRemove = (id) => mutItems((items) => items.filter((i) => i.id !== id && !(i.link && i.link.ref === id)));

  // delete an asset that other items link to: those items become fixed amounts
  const convertDepsAndRemove = (id) => mutItems((items) => {
    const plan2 = { ...PLAN0, items };
    const ref = items.find((a) => a.id === id);
    return items.filter((i) => i.id !== id).map((i) => {
      if (i.link && i.link.ref === id) {
        let sy = START_YEAR;
        if (ref) for (let y = START_YEAR; y <= P_RETIRE; y++) { if (valueAt(ref, y) > 0) { sy = y; break; } }
        const amt = Math.round(annualOf(plan2, i, sy));
        return { ...i, link: undefined, recurring: i.recurring || 'yearly', changes: [{ year: START_YEAR, amount: amt }] };
      }
      return i;
    });
  });

  const setInflation = (v) => mut((s) => ({ ...s, inflation: v }));
  const setStartAge = (v) => mut((s) => ({ ...s, startAge: v }));

  const replaceItems = (items, events) => mut((s) => ({ ...s, items, events: events || s.events }));
  const resetDemo = () => replaceItems(pdeep(ITEMS0), pdeep(PLAN0.events));
  const clearAll = () => replaceItems([], []);

  // apply an Ask-AI build: insert items (deduping labels) + merge events
  const addParsed = (built) => {
    const ids = [];
    mut((s) => {
      let items = [...s.items];
      const events = [...s.events];
      const labels = new Set(items.map((i) => i.label));
      (built.items || []).forEach((raw) => {
        const it = pdeep(raw);
        if (labels.has(it.label)) { let n = 2; while (labels.has(it.label + ' ' + n)) n++; it.label = it.label + ' ' + n; }
        labels.add(it.label);
        ids.push(it.id);
        const idx = items.map((i) => i.section).lastIndexOf(it.section);
        items.splice(idx === -1 ? items.length : idx + 1, 0, it);
      });
      (built.events || []).forEach((e) => { if (!events.some((x) => x.label === e.label)) events.push(pdeep(e)); });
      return { items, events };
    });
    return ids;
  };

  return { plan, items: st.items, events: st.events, series, engineLive, engineErr, update, setChange, addChange, removeChange, setLink, toggleLink, addItem, removeItem, moveItem, convertDepsAndRemove, cascadeRemove, replaceItems, resetDemo, clearAll, addParsed, undo, redo, canUndo, canRedo, suppressClearRef, setInflation, setStartAge };
}

// ── saved versions (snapshots of the whole plan) ──
function useVersionsState() {
  const [versions, setVersions] = React.useState(() => {
    try { const r = localStorage.getItem(P_VKEY); if (r) { const a = JSON.parse(r); if (Array.isArray(a)) return a; } } catch (e) {}
    return [];
  });
  React.useEffect(() => { try { localStorage.setItem(P_VKEY, JSON.stringify(versions)); } catch (e) {} }, [versions]);
  const [currentId, setCurrentId] = React.useState(null); // null = working draft
  const save = (name, desc, items, events, nw) => {
    const id = Date.now();
    const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    setVersions((v) => [{ id, name, desc, date, nw, items, events }, ...v]);
    setCurrentId(id);
    return id;
  };
  const remove = (id) => { setVersions((v) => v.filter((x) => x.id !== id)); setCurrentId((c) => (c === id ? null : c)); };
  return { versions, save, remove, currentId, setCurrentId };
}

Object.assign(window, { P_RETIRE, pdeep, puid, usePlanState, useVersionsState });
