// proto-list.jsx — sectioned plan list: rows (hover delete), section headers,
// empty states, inline editors + add forms, and the timeline view.
import React from 'react';

const SECTION_EMPTY = {
  income: 'no income yet — salary, bonuses, equity, one-time windfalls',
  expense: 'no expenses yet — rent, food, childcare, travel',
  asset: 'nothing held yet — stocks, bonds, cash, a home'
};
const ADD_LABEL = { income: 'Add income', expense: 'Add expense', asset: 'Add asset' };

// inject collapse/expand animation once
if (typeof document !== 'undefined' && !document.getElementById('pl-anim-css')) {
  const s = document.createElement('style');
  s.id = 'pl-anim-css';
  s.textContent = `
    @keyframes plExpand {
      from { opacity: 0; transform: translateY(-5px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .pl-expand { animation: plExpand 0.16s ease; }
  `;
  document.head.appendChild(s);
}

if (typeof document !== 'undefined' && !document.getElementById('pr-del-css')) {
  const s = document.createElement('style');
  s.id = 'pr-del-css';
  s.textContent = '.pr-del { opacity: 0.3; transition: opacity .15s; } .pr-row:hover .pr-del { opacity: 0.6; } .pr-del:hover { opacity: 1 !important; }';
  document.head.appendChild(s);
}

// ── one collapsed row ──
function PItemRow({ plan, item, open, onToggle, onDelete, onSetChange, onToggleHidden, dragId, dragOverId, dragOverPos, onDragStart, onDragOver, onDrop, onDragEnd, secDragActive }) {
  const [rowHovered, setRowHovered] = React.useState(false);
  const isAsset = item.section === 'asset';
  const linked = !!item.link;
  const cs = item.changes ? [...item.changes].sort((a, b) => a.year - b.year) : [];
  const unit = isAsset ? '' : item.recurring === 'monthly' ? '/mo' : item.recurring === 'yearly' ? '/yr' : '';
  let amountStr = '—',sub = '';
  if (linked) {
    const ref = plan.items.find((i) => i.id === item.link.ref);
    if (ref) {
      let sy = START_YEAR;
      for (let y = START_YEAR; y <= P_RETIRE; y++) {if (valueAt(ref, y) > 0) {sy = y;break;}}
      amountStr = fmtShort(annualOf(plan, item, sy)) + '/yr';
    }
  } else if (cs.length) {
    const first = cs.find((c) => c.amount) || cs[0];
    if (isAsset) {
      amountStr = fmtShort(first.amount);
      const isHouse = item.assetType === 'home' || (item.home && typeof item.home === 'object');
      if (isHouse) {
        const buyChange = cs.find(c => c.amount > 0);
        const sale = saleOf(item);
        const parts = [];
        if (buyChange) parts.push(`purchased in ${buyChange.year}`);
        if (sale) parts.push(`sold in ${sale.year}`);
        sub = parts.join(' · ');
      } else {
        sub = `grows ${((item.growth || 0) * 100).toFixed(1).replace(/\.0$/, '')}%/yr`;
      }
    } else {
      amountStr = fmtShort(first.amount) + unit;
      if (item.recurring === 'one-time') {
        if (item.section === 'income') {
          const taxAs = item.taxAs || 'long-term-capital-gains';
          const taxLabel = taxAs === 'long-term-capital-gains' ? 'capital gain' : taxAs === 'tax-exempt-income' ? 'untaxed income' : 'ordinary income';
          sub = `${taxLabel} in ${first.year}`;
        } else {
          sub = `one-time in ${first.year}`;
        }
      } else if (item.section === 'expense' && first.year > START_YEAR) {
        sub = `starts in ${first.year}`;
      } else if (item.section === 'expense' && cs.length > 1) {
        const shown = cs.slice(0, 3);
        const parts = shown.map(c => `${fmtShort(c.amount)}${unit} in ${c.year}`);
        if (cs.length > 3) parts.push('…');
        sub = parts.join(' → ');
      } else {
        sub = '';
      }
    }
  }
  const label = item.label.trim() || '(unnamed)';
  // inline amount editing
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const inlineInputRef = React.useRef(null);
  const startEdit = (e) => {
    if (linked || !cs.length) return;
    e.stopPropagation();
    const raw = cs.find((c) => c.amount) || cs[0];
    setDraft((raw.amount || 0).toLocaleString('en-US'));
    setEditing(true);
  };
  const commitEdit = (e) => {
    if (e) e.stopPropagation();
    const n = parseShortNum(draft);
    if (Number.isFinite(n) && item.changes && item.changes.length > 0) {
      const idx = item.changes.findIndex((c) => c.amount) >= 0 ?
      item.changes.findIndex((c) => c.amount) :
      0;
      if (onSetChange) onSetChange(item.id, idx, 'amount', n);
    }
    setEditing(false);
  };
  const handleInlineChange = (e) => {
    const el = e.target;
    const pos = el.selectionStart;
    const digitsBefore = el.value.slice(0, pos).replace(/,/g, '').length;
    const stripped = el.value.replace(/,/g, '');
    const lower = stripped.toLowerCase();
    let formatted;
    if (/[kmb]$/.test(lower)) {
      formatted = stripped;
    } else if (/^[0-9]*$/.test(stripped)) {
      formatted = stripped ? Number(stripped).toLocaleString('en-US') : '';
    } else {
      formatted = stripped;
    }
    setDraft(formatted);
    requestAnimationFrame(() => {
      if (!inlineInputRef.current) return;
      let dc = 0, newPos = formatted.length;
      for (let i = 0; i < formatted.length; i++) {
        if (formatted[i] !== ',') dc++;
        if (dc === digitsBefore) { newPos = i + 1; break; }
      }
      inlineInputRef.current.setSelectionRange(newPos, newPos);
    });
  };

  return (
    <div className="pr-row"
    onMouseEnter={() => setRowHovered(true)}
    onMouseLeave={() => setRowHovered(false)}
    draggable={true}
    onDragStart={(e) => {e.dataTransfer.effectAllowed = 'move';e.dataTransfer.setData('text/plain', item.id);if (onDragStart) onDragStart(item.id);}}
    onDragOver={(e) => {if (secDragActive) return; e.preventDefault();const rect = e.currentTarget.getBoundingClientRect();const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';if (onDragOver) onDragOver(item.id, pos);}}
    onDrop={(e) => {e.preventDefault();const rect = e.currentTarget.getBoundingClientRect();const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';if (onDrop) onDrop(item.id, pos);}}
    onDragEnd={onDragEnd}
    onClick={(e) => {if (dragId) return;onToggle();}}
    style={{ display: 'grid', gridTemplateColumns: '118px minmax(0, 1fr) 26px 26px 16px', gap: 14, alignItems: 'center', padding: '12px 6px',
      borderTop: dragOverId === item.id && dragOverPos === 'before' && dragId !== item.id ? `2px solid ${WF.ink}` : '2px solid transparent',
      borderBottom: dragOverId === item.id && dragOverPos === 'after' && dragId !== item.id ? `2px solid ${WF.ink}` : `1px solid ${WF.line2}`,
      cursor: rowHovered ? 'grab' : 'pointer', background: open ? '#f7f7f8' : undefined,
      opacity: item.hidden ? 0.38 : 1, transition: 'opacity .2s' }}>
      {editing ?
      <input
        ref={inlineInputRef}
        autoFocus
        value={draft}
        onChange={handleInlineChange}
        onClick={(e) => e.stopPropagation()}
        onBlur={commitEdit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const n = parseShortNum(draft);
            if (Number.isFinite(n) && item.changes && item.changes.length > 0) {
              const idx = item.changes.findIndex((c) => c.amount) >= 0 ? item.changes.findIndex((c) => c.amount) : 0;
              if (onSetChange) onSetChange(item.id, idx, 'amount', n);
            }
            setDraft(n ? n.toLocaleString('en-US') : '0');
            setEditing(false);
          } else if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); }
        }}
        style={{ justifySelf: 'stretch', width: '100%', textAlign: 'left', fontFamily: WF.mono, fontSize: WF.fs(13.5), fontWeight: 600, color: WF.ink, border: 'none', borderBottom: `2px solid ${WF.ink}`, background: 'transparent', outline: 'none', fontVariantNumeric: 'tabular-nums', padding: '0 2px' }} /> :


      <span onClick={startEdit} style={{ justifySelf: 'start', fontFamily: WF.mono, fontSize: WF.fs(13.5), fontWeight: 600, color: WF.ink, fontVariantNumeric: 'tabular-nums', cursor: linked ? 'default' : 'text', borderBottom: linked ? 'none' : `1px dashed ${WF.line}`, whiteSpace: 'nowrap' }}>{amountStr}</span>
      }
      <span style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ fontFamily: WF.sans, fontSize: WF.fs(13), fontWeight: 600, color: item.label.trim() ? WF.ink : WF.ink3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: 1 }}>{label}</span>
            <span style={{ flexShrink: 0 }}><ItemTags item={item} /></span>
          </span>
          {linked ? <LinkChip plan={plan} item={item} /> : sub ? <span style={{ fontFamily: WF.mono, color: WF.ink3, fontSize: WF.fs(12) }}>{sub}</span> : null}
        </span>
      </span>
      <button className="pr-del" title={item.hidden ? 'show item' : 'hide item'} onClick={(e) => { e.stopPropagation(); onToggleHidden && onToggleHidden(); }} style={{ width: 22, height: 22, border: 'none', borderRadius: 0, background: 'transparent', color: WF.ink, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: item.hidden ? 0.7 : undefined }}>
        {item.hidden
          ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
          : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        }
      </button>
      <button className="pr-del" title={`delete ${label}`} onClick={(e) => {e.stopPropagation();onDelete(item);}} style={{ width: 22, height: 22, border: 'none', borderRadius: 0, background: 'transparent', color: WF.ink, cursor: 'pointer', fontSize: WF.fs(13), lineHeight: 1, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          <line x1="10" y1="11" x2="10" y2="17"></line>
          <line x1="14" y1="11" x2="14" y2="17"></line>
        </svg>
      </button>
      <span className="wf-caret" style={{ fontFamily: WF.mono, fontSize: WF.fs(13), color: WF.ink3, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', justifySelf: 'center' }}>›</span>
    </div>);

}

// ── section header with running total ──
function PSectionHeader({ section, plan, collapsed, onToggle, onDragStart, onDragEnd }) {
  const items = plan.items.filter((i) => i.section === section.id);
  let total, unit;
  if (section.id === 'asset') {total = items.reduce((s, a) => s + valueAt(a, START_YEAR), 0);unit = 'today';} else
  {total = items.reduce((s, it) => s + annualOf(plan, it, START_YEAR + (section.id === 'income' ? 0 : 4)), 0);unit = '/yr now';}
  return (
    <div className="wf-tab" draggable={true} onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={onToggle} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 4px 8px', borderBottom: `1.5px solid ${WF.ink}`, cursor: 'grab' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span className="wf-caret" style={{ fontFamily: WF.mono, fontSize: WF.fs(12), color: WF.ink3, display: 'inline-block', transform: collapsed ? 'none' : 'rotate(90deg)', transition: 'transform .15s' }}>›</span>
        <span style={{ fontFamily: WF.sans, color: WF.ink, fontWeight: "700", fontSize: WF.fs(14) }}>{section.label}</span>
        <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10), color: WF.ink3 }}>{collapsed ? (() => { const hidden = items.filter(i => i.hidden).length; return `${items.length} item${items.length === 1 ? '' : 's'}${hidden ? `, ${hidden} hidden` : ''}`; })() : ''}</span>
      </span>
      {section.id !== 'income' && items.length > 0 && <span style={{ fontFamily: WF.mono, fontSize: WF.fs(11.5), color: WF.ink, fontWeight: 600 }}>{fmtShort(total)} <span style={{ color: WF.ink3, fontWeight: 400 }}>{unit}</span></span>}
    </div>);

}

// ── the whole grouped list ──
function PSectionList({ p, openId, setOpenId, requestDelete, addOpen, setAddOpen, onAdded, family, setFamily, onToast, onImport }) {
  const [collapsed, setCollapsed] = React.useState({});
  const [dragId, setDragId] = React.useState(null);
  const [dragOver, setDragOver] = React.useState(null); // { id, pos: 'before'|'after' }
  const [sectionOrder, setSectionOrder] = React.useState(() => SECTIONS.map(s => s.id));
  const [secDragId, setSecDragId] = React.useState(null);
  const [secDragOver, setSecDragOver] = React.useState(null);
  const [listLayout, setListLayout] = React.useState(() => localStorage.getItem('soroban-list-layout') || 'stack');
  const toggleLayout = () => {
    const next = listLayout === 'stack' ? 'columns' : 'stack';
    setListLayout(next);
    try { localStorage.setItem('soroban-list-layout', next); } catch(e) {}
  };
  const orderedSections = sectionOrder.map(id => SECTIONS.find(s => s.id === id)).filter(Boolean);
  const toggle = (id) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));
  const navigateTo = (id) => {
    const it = p.items.find((i) => i.id === id);
    if (it) setCollapsed((c) => ({ ...c, [it.section]: false }));
    setOpenId(id);
  };
  const handleSecDrop = (targetId) => {
    if (secDragId && secDragId !== targetId) {
      setSectionOrder(prev => {
        const arr = [...prev];
        const fromIdx = arr.indexOf(secDragId);
        const toIdx = arr.indexOf(targetId);
        arr.splice(fromIdx, 1);
        arr.splice(toIdx, 0, secDragId);
        return arr;
      });
    }
    setSecDragId(null);
    setSecDragOver(null);
  };
  const handleDrop = (targetId, pos) => {
    if (dragId && targetId !== dragId) {
      if (pos === 'after') {
        // find the item after targetId in same section, insert before it; else append
        // exclude dragId so we don't accidentally land on the dragged item itself as the beforeId
        const sectionId = p.items.find((i) => i.id === targetId)?.section;
        const sectionItems = p.items.filter((i) => i.section === sectionId && i.id !== dragId);
        const idx = sectionItems.findIndex((i) => i.id === targetId);
        const nextItem = sectionItems[idx + 1];
        p.moveItem(dragId, nextItem ? nextItem.id : null);
      } else {
        p.moveItem(dragId, targetId);
      }
    }
    setDragId(null);setDragOver(null);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 2 }}>
        <button className="wf-tab" title={listLayout === 'stack' ? 'Switch to columns' : 'Switch to stacked'} onClick={toggleLayout}
          style={{ width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${WF.line}`, borderRadius: 2, background: 'transparent', cursor: 'pointer' }}>
          {listLayout === 'stack'
            ? <svg width="13" height="11" viewBox="0 0 13 11" fill="none" stroke={WF.ink2} strokeWidth="1.6" strokeLinecap="round"><line x1="2" y1="1.5" x2="2" y2="9.5"/><line x1="6.5" y1="1.5" x2="6.5" y2="9.5"/><line x1="11" y1="1.5" x2="11" y2="9.5"/></svg>
            : <svg width="13" height="11" viewBox="0 0 13 11" fill="none" stroke={WF.ink2} strokeWidth="1.6" strokeLinecap="round"><line x1="1" y1="2" x2="12" y2="2"/><line x1="1" y1="5.5" x2="12" y2="5.5"/><line x1="1" y1="9" x2="12" y2="9"/></svg>
          }
        </button>
      </div>
      <div style={listLayout === 'columns'
        ? { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, alignItems: 'start' }
        : { display: 'flex', flexDirection: 'column', gap: 4 }}>
      {orderedSections.map((sec) => {
        const items = p.items.filter((i) => i.section === sec.id);
        return (
          <div key={sec.id}
            style={{ marginBottom: 6, borderTop: secDragOver === sec.id && secDragId !== sec.id ? `2px solid ${WF.ink}` : '2px solid transparent', transition: 'border-color .1s' }}
            data-screen-label={`Section: ${sec.label}`}
            onDragOver={(e) => { if (secDragId && secDragId !== sec.id) { e.preventDefault(); setSecDragOver(sec.id); } }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setSecDragOver(null); }}
            onDrop={(e) => { e.preventDefault(); handleSecDrop(sec.id); }}
          >
            <PSectionHeader section={sec} plan={p.plan} collapsed={!!collapsed[sec.id]} onToggle={() => toggle(sec.id)}
              onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'sec:' + sec.id); setSecDragId(sec.id); }}
              onDragEnd={() => { setSecDragId(null); setSecDragOver(null); }}
            />
            {!collapsed[sec.id] &&
            <div className="pl-expand">
                {false && sec.id === 'expense' && family && setFamily && (
                  <FamilyBand family={family} setFamily={setFamily} p={p} onToast={onToast} />
                )}
                {items.map((item) =>
              <div key={item.id}>
                    <PItemRow plan={p.plan} item={item} open={openId === item.id} onToggle={() => setOpenId(openId === item.id ? null : item.id)} onDelete={requestDelete} onSetChange={p.setChange}
                onToggleHidden={() => p.update(item.id, { hidden: !item.hidden })}
                dragId={dragId} dragOverId={dragOver?.id} dragOverPos={dragOver?.pos}
                onDragStart={(id) => setDragId(id)}
                onDragOver={(id, pos) => setDragOver(id ? { id, pos } : null)}
                onDrop={handleDrop}
                onDragEnd={() => {setDragId(null);setDragOver(null);}}
                secDragActive={!!secDragId} />
                    {openId === item.id &&
                <div className="pl-expand" style={{ padding: '16px 6px 20px 26px', background: '#f7f7f8', borderBottom: `1px solid ${WF.line2}` }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                          <button
                            title="Export timeline to JSON"
                            onClick={(e) => {
                              e.stopPropagation();
                              const timeline = [];
                              for (let y = START_YEAR; y <= P_RETIRE; y++) {
                                timeline.push({ year: y, value: item.section === 'asset' ? valueAt(item, y) : annualOf(p.plan, item, y) });
                              }
                              const payload = JSON.stringify({ item: { ...item }, timeline }, null, 2);
                              const blob = new Blob([payload], { type: 'application/json' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = (item.label.trim() || 'item').replace(/[^a-z0-9_\-]/gi, '_') + '.json';
                              a.click();
                              URL.revokeObjectURL(url);
                            }}
                            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '0 9px', height: 24, border: `1px solid ${WF.line}`, borderRadius: 2, background: WF.paper, fontFamily: WF.mono, fontSize: WF.fs(10), color: WF.ink2, cursor: 'pointer', letterSpacing: 0.3, transition: 'border-color .12s, color .12s' }}
                            onMouseEnter={(e) => { e.currentTarget.style.borderColor = WF.ink; e.currentTarget.style.color = WF.ink; }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderColor = WF.line; e.currentTarget.style.color = WF.ink2; }}
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                              <polyline points="7 10 12 15 17 10"/>
                              <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                            export json
                          </button>
                        </div>
                        <ItemEditor p={p} item={item} onNavigate={navigateTo} onDelete={requestDelete} />
                      </div>
                }
                  </div>
              )}
                {addOpen === sec.id ? (
              <AddItemForm section={sec.id} p={p} onClose={() => setAddOpen(null)} onAdded={(item) => {setAddOpen(null);onAdded(item);}} />
            ) : items.length === 0 ? (
              <div className="wf-hatch" style={{ marginTop: 10, border: `1px dashed ${WF.line}`, borderRadius: 2, padding: '26px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
                <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10.5), color: WF.ink, textAlign: 'center' }}>{SECTION_EMPTY[sec.id]}</span>
                <button className="wf-tab" onClick={() => {setAddOpen(sec.id);}} style={{ padding: '0 13px', height: 32, boxSizing: 'border-box', border: 'none', borderRadius: 0, backgroundColor: WF.paper, backgroundImage: `url("data:image/svg+xml,%3csvg width='100%25' height='100%25' xmlns='http://www.w3.org/2000/svg'%3e%3crect width='100%25' height='100%25' fill='none' stroke='%23c4c4c9' stroke-width='1.5' stroke-dasharray='4%2c4' stroke-linecap='square'/%3e%3c/svg%3e")`, backgroundRepeat: 'no-repeat', backgroundSize: '100% 100%', fontFamily: WF.sans, fontSize: WF.fs(12), fontWeight: 600, color: WF.ink, cursor: 'pointer' }}>+ {ADD_LABEL[sec.id]}</button>
              </div>
            ) : (
              <button className="wf-tab" onClick={() => {setAddOpen(sec.id);}} style={{ marginTop: 8, padding: '0 11px', height: 32, boxSizing: 'border-box', border: 'none', borderRadius: 0, backgroundColor: WF.paper, backgroundImage: `url("data:image/svg+xml,%3csvg width='100%25' height='100%25' xmlns='http://www.w3.org/2000/svg'%3e%3crect width='100%25' height='100%25' fill='none' stroke='%23c4c4c9' stroke-width='1.5' stroke-dasharray='4%2c4' stroke-linecap='square'/%3e%3c/svg%3e")`, backgroundRepeat: 'no-repeat', backgroundSize: '100% 100%', fontFamily: WF.sans, fontSize: WF.fs(12), fontWeight: 600, color: WF.ink, cursor: 'pointer' }}>+ {ADD_LABEL[sec.id]}</button>
            )}
              </div>
            }
          </div>);

      })}
      </div>
    </div>);

}

// ── timeline view (bars across the years) ──
const PTL_YEARS = [2026, 2032, 2038, 2044, 2050, 2056, 2059];
function pSpanOf(plan, item) {
  if (item.link) {const ref = plan.items.find((i) => i.id === item.link.ref);return ref ? pSpanOf(plan, ref) : { start: START_YEAR, end: P_RETIRE, ticks: [], pts: [] };}
  const cs = [...(item.changes || [{ year: START_YEAR, amount: 0 }])].sort((a, b) => a.year - b.year);
  const endsZero = cs.length > 1 && cs[cs.length - 1].amount === 0;
  return { start: cs[0].year, end: endsZero ? cs[cs.length - 1].year : P_RETIRE, ticks: cs.slice(1).map((c) => c.year), oneTime: item.recurring === 'one-time', pts: cs };
}
function PTimeline({ plan }) {
  const pct = (yr) => (yr - START_YEAR) / (P_RETIRE - START_YEAR) * 100;
  const any = plan.items.length > 0;
  if (!any) return <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}><Anno>no items to plot — add income, expenses or holdings below</Anno></div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {SECTIONS.map((sec) => plan.items.filter((i) => i.section === sec.id).map((item, idx) => {
          const s = pSpanOf(plan, item);
          return (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', borderTop: `1px solid ${idx === 0 ? WF.line : WF.line2}`, flex: 1, minHeight: 24 }}>
              <div style={{ width: 150, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
                {idx === 0 ? <span style={{ fontFamily: WF.mono, fontSize: WF.fs(8), letterSpacing: 0.4, textTransform: 'uppercase', color: WF.ink3, width: 16 }}>{sec.label[0]}</span> : <span style={{ width: 16 }} />}
                <span style={{ width: 6, height: 6, borderRadius: item.section === 'asset' ? 1 : '50%', transform: item.section === 'asset' ? 'rotate(45deg)' : 'none', background: item.section === 'income' ? WF.ink : WF.paper, border: `1.5px solid ${WF.ink}`, flexShrink: 0 }} />
                <span style={{ fontFamily: WF.sans, fontSize: WF.fs(11.5), color: WF.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label.trim() || '(unnamed)'}</span>
              </div>
              <div style={{ position: 'relative', flex: 1, height: '100%' }}>
                {PTL_YEARS.map((y) => <div key={y} style={{ position: 'absolute', left: pct(y) + '%', top: 0, bottom: 0, width: 1, background: WF.line2 }} />)}
                {s.oneTime ?
                s.pts.map((c, i) => c.amount > 0 ? <span key={i} style={{ position: 'absolute', left: pct(c.year) + '%', top: '50%', transform: 'translate(-50%,-50%) rotate(45deg)', width: 10, height: 10, background: WF.ink }} /> : null) :

                <div style={{ position: 'absolute', left: pct(s.start) + '%', width: Math.max(0.5, pct(s.end) - pct(s.start)) + '%', top: '50%', transform: 'translateY(-50%)', height: 15, border: `1.5px solid ${WF.ink}`, borderRadius: 2, background: item.link ? WF.fill2 : WF.paper }}>
                      {s.ticks.map((ty, i) => ty > s.start && ty < s.end ? <span key={i} style={{ position: 'absolute', left: (pct(ty) - pct(s.start)) / (pct(s.end) - pct(s.start)) * 100 + '%', top: -2, bottom: -2, width: 1.5, background: WF.ink }} /> : null)}
                    </div>
                }
              </div>
            </div>);

        }))}
      </div>
      <div style={{ display: 'flex', borderTop: `1.5px solid ${WF.ink}` }}>
        <div style={{ width: 150, flexShrink: 0 }} />
        <div style={{ position: 'relative', flex: 1, height: 20 }}>
          {PTL_YEARS.map((y) => <span key={y} style={{ position: 'absolute', left: pct(y) + '%', top: 3, transform: 'translateX(-50%)', fontFamily: WF.mono, fontSize: WF.fs(9), color: WF.ink3 }}>{y}</span>)}
        </div>
      </div>
    </div>);

}

// ── import-from-institution modal (demo) ──
function ImportAccountsModal({ onClose, onImport }) {
  const PROVIDERS = [
    { name: 'Chase', tag: 'bank', build: () => ({ items: [{ id: puid(), section: 'income', label: 'Paycheck — Chase', recurring: 'monthly', inflation: false, changes: [{ year: START_YEAR, month: 0, amount: 8200 }] }, { id: puid(), section: 'asset', label: 'Chase checking', growth: 0.005, changes: [{ year: START_YEAR, amount: 18000 }] }], events: [] }) },
    { name: 'Bank of America', tag: 'bank', build: () => ({ items: [{ id: puid(), section: 'income', label: 'Direct deposit', recurring: 'monthly', inflation: false, changes: [{ year: START_YEAR, month: 0, amount: 7600 }] }, { id: puid(), section: 'asset', label: 'BofA savings', growth: 0.01, changes: [{ year: START_YEAR, amount: 32000 }] }], events: [] }) },
    { name: 'Vanguard', tag: 'brokerage', build: () => ({ items: [{ id: puid(), section: 'asset', label: 'Vanguard brokerage', growth: 0.06, changes: [{ year: START_YEAR, amount: 145000 }] }, { id: puid(), section: 'asset', label: 'Roth IRA', growth: 0.06, changes: [{ year: START_YEAR, amount: 72000 }] }], events: [] }) },
    { name: 'Fidelity', tag: 'brokerage', build: () => ({ items: [{ id: puid(), section: 'asset', label: 'Fidelity 401(k)', growth: 0.06, changes: [{ year: START_YEAR, amount: 96000 }] }], events: [] }) },
    { name: 'Charles Schwab', tag: 'brokerage', build: () => ({ items: [{ id: puid(), section: 'asset', label: 'Schwab brokerage', growth: 0.06, changes: [{ year: START_YEAR, amount: 60000 }] }], events: [] }) },
    { name: 'Robinhood', tag: 'brokerage', build: () => ({ items: [{ id: puid(), section: 'asset', label: 'Robinhood stocks', growth: 0.08, changes: [{ year: START_YEAR, amount: 14000 }] }], events: [] }) },
  ];
  const [connecting, setConnecting] = React.useState(null);
  const connect = (prov) => { if (connecting) return; setConnecting(prov.name); setTimeout(() => onImport(prov.build(), prov.name), 850); };
  return (
    <ModalShell onClose={onClose} width={540}>
      <ModalHead eyebrow="connect an account" title="Import from an institution" onClose={onClose} />
      <Rule />
      <span style={{ fontFamily: WF.sans, fontSize: WF.fs(12.5), color: WF.ink2, lineHeight: 1.5 }}>Pick where your money lives — we’ll pull in balances and recurring deposits as editable items. Nothing leaves your browser.</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {PROVIDERS.map((prov) => {
          const on = connecting === prov.name;
          return (
            <button key={prov.name} className="wf-tab" onClick={() => connect(prov)} disabled={!!connecting}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, padding: 12, border: `1px solid ${on ? WF.ink : WF.line}`, borderRadius: 2, background: WF.paper, cursor: connecting ? 'default' : 'pointer', opacity: connecting && !on ? 0.45 : 1 }}>
              <div className="wf-hatch" style={{ width: '100%', height: 28, border: `1px solid ${WF.line2}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: WF.mono, fontSize: WF.fs(9.5), color: WF.ink2, letterSpacing: 0.3 }}>{prov.name}</div>
              <span style={{ fontFamily: WF.mono, fontSize: WF.fs(9), color: WF.ink3, textTransform: 'uppercase', letterSpacing: 0.4 }}>{on ? 'connecting…' : prov.tag}</span>
            </button>
          );
        })}
      </div>
      <Anno>demo only · no real accounts are connected</Anno>
    </ModalShell>
  );
}

Object.assign(window, { PItemRow, PSectionHeader, PSectionList, PTimeline, ImportAccountsModal });
