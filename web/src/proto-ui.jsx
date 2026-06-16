// proto-ui.jsx — shared prototype primitives: inputs, tags, link chip,
// toast, modal shell, error note, profile menu, hover CSS.
import React from 'react';

if (typeof document !== 'undefined' && !document.getElementById('proto-styles')) {
  const s = document.createElement('style');
  s.id = 'proto-styles';
  s.textContent = `
  .wf-tab:hover { filter: brightness(0.96); }
  .pr-row { transition: background .12s; }
  .pr-row:hover { background: #f6f6f8; }
  .pr-del { opacity: 0; transition: opacity .12s; }
  .pr-row:hover .pr-del, .pr-del:focus { opacity: 1; }
  .pr-hv { transition: background .12s; }
  .pr-hv:hover { background: #f0f0f2; }
  .pr-vrow .pr-vdel { opacity: 0; transition: opacity .12s; }
  .pr-vrow:hover .pr-vdel { opacity: 1; }
  input::placeholder, textarea::placeholder { color: #9b9ba1; }
  `;
  document.head.appendChild(s);
}

// ── small inputs ──
function YearCell({ value, onChange, w = 62 }) {
  const [foc, setFoc] = React.useState(false);
  const [draft, setDraft] = React.useState(String(value));
  // keep the draft in sync with the committed value while NOT editing
  React.useEffect(() => { if (!foc) setDraft(String(value)); }, [value, foc]);
  const commit = (raw) => {
    let n = parseInt(String(raw).replace(/[^0-9]/g, ''), 10) || START_YEAR;
    n = Math.max(START_YEAR, Math.min(P_RETIRE, n));
    onChange(n);
    return n;
  };
  return (
    <input value={foc ? draft : value}
      onFocus={(e) => { setFoc(true); setDraft(String(value)); e.target.select(); }}
      onBlur={(e) => { setFoc(false); setDraft(String(commit(e.target.value))); }}
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); const n = Math.min(P_RETIRE, (parseInt(draft, 10) || START_YEAR) + 1); setDraft(String(n)); onChange(n); }
        if (e.key === 'ArrowDown') { e.preventDefault(); const n = Math.max(START_YEAR, (parseInt(draft, 10) || START_YEAR) - 1); setDraft(String(n)); onChange(n); }
      }}
      style={{ width: w, height: 33, boxSizing: 'border-box', border: `1px solid ${foc ? WF.ink : WF.line}`, borderRadius: 2, padding: '0 8px', fontFamily: WF.mono, fontSize: WF.fs(11.5), color: WF.ink, textAlign: 'center', outline: 'none', background: WF.paper }} />
  );
}
function PctCell({ value, onChange, w = 64 }) {
  const [foc, setFoc] = React.useState(false);
  const fmt = (v) => String(Math.round(v * 100 * 100) / 100);
  const [draft, setDraft] = React.useState(fmt(value));
  React.useEffect(() => { if (!foc) setDraft(fmt(value)); }, [value, foc]);
  const commit = (raw) => {
    const n = parseFloat(String(raw).replace(/[^0-9.]/g, ''));
    onChange((Number.isFinite(n) ? n : 0) / 100);
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, border: `1px solid ${foc ? WF.ink : WF.line}`, borderRadius: 2, padding: '0 7px', width: w, height: 33, boxSizing: 'border-box', background: WF.paper }}>
      <input value={foc ? draft : fmt(value)}
        onFocus={(e) => { setFoc(true); setDraft(fmt(value)); e.target.select(); }}
        onBlur={(e) => { setFoc(false); commit(e.target.value); }}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))}
        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
        style={{ border: 'none', outline: 'none', width: '100%', minWidth: 0, background: 'transparent', padding: 0, fontFamily: WF.mono, fontSize: WF.fs(11.5), color: WF.ink, textAlign: 'right' }} />
      <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10.5), color: WF.ink3 }}>%</span>
    </span>
  );
}
function MonthSelect({ value, onChange }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', border: `1px solid ${WF.line}`, borderRadius: 2, height: 33, boxSizing: 'border-box', background: WF.paper }}>
      <select value={value || 0} onChange={(e) => onChange(+e.target.value)} style={{ appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none', border: 'none', outline: 'none', background: 'transparent', fontFamily: WF.mono, fontSize: WF.fs(11.5), color: WF.ink, cursor: 'pointer', padding: '0 20px 0 8px', height: '100%' }}>
        {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
      </select>
      <span className="wf-caret" style={{ position: 'absolute', right: 6, fontFamily: WF.mono, fontSize: WF.fs(9), color: WF.ink3, pointerEvents: 'none' }}>▾</span>
    </span>
  );
}
function RefSelect({ value, options, onChange, placeholder }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', border: `1px solid ${WF.line}`, borderRadius: 2, padding: '0 24px 0 9px', height: 33, boxSizing: 'border-box', background: WF.paper }}>
      <select value={value || ''} onChange={(e) => onChange(e.target.value)} style={{ appearance: 'none', border: 'none', outline: 'none', background: 'transparent', fontFamily: WF.sans, fontSize: WF.fs(12), fontWeight: 600, color: WF.ink, cursor: 'pointer' }}>
        {placeholder && <option value="" disabled>{placeholder}</option>}
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <span className="wf-caret" style={{ position: 'absolute', right: 8, fontFamily: WF.mono, fontSize: WF.fs(10), color: WF.ink3, pointerEvents: 'none' }}>▾</span>
    </span>
  );
}
function TextInput({ value, onChange, placeholder, autoFocus, error, onKeyDown, onFocus, style }) {
  const [foc, setFoc] = React.useState(false);
  return (
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} onKeyDown={onKeyDown}
      onFocus={(e) => { setFoc(true); if (onFocus) onFocus(e); }} onBlur={() => setFoc(false)}
      style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${(error || foc) ? WF.ink : WF.line}`, boxShadow: error ? `0 0 0 2px ${WF.fill2}` : 'none', borderRadius: 2, padding: '8px 10px', fontFamily: WF.sans, fontSize: WF.fs(13), color: WF.ink, outline: 'none', background: WF.paper, ...style }} />
  );
}

// ── glyphs & tags ──
function ChainIcon({ size = 13, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color || WF.ink} strokeWidth="1.5" strokeLinecap="round" style={{ flexShrink: 0 }}>
      <path d="M6.5 9.5l3-3" />
      <path d="M7.2 4.6l1-1a2.4 2.4 0 013.4 3.4l-1 1" />
      <path d="M8.8 11.4l-1 1a2.4 2.4 0 01-3.4-3.4l1-1" />
    </svg>
  );
}
function Tag({ children, dark, icon }) {
  const [h, setH] = React.useState(false);
  const border = dark ? WF.ink : (h ? WF.ink3 : WF.line);
  const color = dark ? WF.paper : (h ? WF.ink : WF.ink2);
  return (
    <span onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      className="wf-tag"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: WF.mono, fontSize: WF.fs(9), letterSpacing: 0.3, padding: icon ? '2px 7px 2px 5px' : '2px 6px', border: `1px solid ${border}`, borderRadius: 2, background: dark ? WF.ink : WF.paper, color, transition: 'color .12s, border-color .12s', cursor: 'default', whiteSpace: 'nowrap' }}>
      {icon}{children}
    </span>
  );
}
function ItemTags({ item }) {
  if (item.section === 'asset') return <Tag>grows {((item.growth || 0) * 100).toFixed(1).replace(/\.0$/, '')}%/yr</Tag>;
  if (item.link) return <Tag dark icon={<ChainIcon size={10} color={WF.paper} />}>linked</Tag>;

  if (item.section === 'income') {
    if (item.recurring === 'one-time') return <Tag dark>one-time</Tag>;
    return (
      <span style={{ display: 'inline-flex', gap: 6 }}>
        <Tag>{RECUR_LABEL[item.recurring].toLowerCase()}</Tag>
        <Tag>{item.inflation ? 'inflation' : 'fixed'}</Tag>
      </span>
    );
  }

  // expense
  const chips = [];
  if (item.recurring === 'one-time') chips.push(<Tag dark key="ot">one-time</Tag>);
  if (!item.inflation) chips.push(<Tag dark key="ni">not inflation adjusted</Tag>);
  if (chips.length === 0) return null;
  return <span style={{ display: 'inline-flex', gap: 6 }}>{chips}</span>;
}
function LinkChip({ plan, item }) {
  const ref = plan.items.find((i) => i.id === item.link.ref);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: WF.mono, fontSize: WF.fs(10.5), color: WF.ink2 }}>
      <span style={{ color: WF.ink3 }}>=</span>
      <span style={{ color: WF.ink, fontWeight: 600 }}>{(item.link.rate * 100).toFixed(1).replace(/\.0$/, '')}%</span>
      <span style={{ color: WF.ink3 }}>of</span>
      <span style={{ borderBottom: `1px solid ${WF.line}`, color: ref ? WF.ink : WF.ink3 }}>{ref ? ref.label : 'missing source'}</span>
    </span>
  );
}
function ChoiceCard({ active, onClick, title, desc, icon, disabled, disabledNote }) {
  return (
    <button className={disabled ? '' : 'wf-tab'} onClick={disabled ? undefined : onClick} style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 5, padding: '12px 13px', border: `1px solid ${active ? WF.ink : WF.line}`, borderRadius: 3, background: active ? WF.fill : WF.paper, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 15, height: 15, borderRadius: '50%', border: `1.5px solid ${active ? WF.ink : WF.line}`, display: 'grid', placeItems: 'center', flexShrink: 0 }}>{active && <span style={{ width: 7, height: 7, borderRadius: '50%', background: WF.ink }} />}</span>
        {icon && <ChainIcon size={13} />}
        <span style={{ fontFamily: WF.sans, fontSize: WF.fs(12.5), fontWeight: 600, color: WF.ink }}>{title}</span>
      </span>
      <span style={{ fontFamily: WF.sans, fontSize: WF.fs(11), color: WF.ink2, lineHeight: 1.4, paddingLeft: 23 }}>{disabled && disabledNote ? disabledNote : desc}</span>
    </button>
  );
}

// ── monochrome inline error / warning note ──
function ErrNote({ children, style }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', border: `1px solid ${WF.ink}`, borderRadius: 2, background: WF.fill, ...style }}>
      <span style={{ width: 14, height: 14, flexShrink: 0, border: `1.5px solid ${WF.ink}`, borderRadius: '50%', display: 'grid', placeItems: 'center', fontFamily: WF.mono, fontSize: WF.fs(9.5), fontWeight: 700, color: WF.ink, lineHeight: 1 }}>!</span>
      <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10.5), color: WF.ink2, lineHeight: 1.45 }}>{children}</span>
    </div>
  );
}

// ── toast with optional undo ──
function Toast({ toast, onClose }) {
  if (!toast) return null;
  return (
    <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 90, display: 'flex', alignItems: 'center', gap: 14, background: WF.ink, color: WF.paper, padding: '11px 16px', borderRadius: 3, boxShadow: '0 12px 32px rgba(0,0,0,0.28)', fontFamily: WF.sans, fontSize: WF.fs(12.5) }}>
      <span>{toast.msg}</span>
      {toast.undo && <button onClick={toast.undo} style={{ background: 'none', border: 'none', borderBottom: `1px solid ${WF.paper}`, color: WF.paper, fontFamily: WF.sans, fontSize: WF.fs(12.5), fontWeight: 700, cursor: 'pointer', padding: 0 }}>Undo</button>}
      <button onClick={onClose} style={{ background: 'none', border: 'none', color: WF.ink3, cursor: 'pointer', fontSize: WF.fs(14), padding: 0, lineHeight: 1 }}>×</button>
    </div>
  );
}

// ── modal shell (esc / backdrop closes) ──
function ModalShell({ onClose, children, width = 460 }) {
  React.useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,20,22,0.32)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width, maxWidth: '92vw', maxHeight: '86vh', overflow: 'auto', background: WF.paper, border: `1.5px solid ${WF.ink}`, borderRadius: 3, boxShadow: '0 24px 60px rgba(0,0,0,0.25)', padding: 22, display: 'flex', flexDirection: 'column', gap: 15, boxSizing: 'border-box' }}>{children}</div>
    </div>
  );
}
function ModalHead({ eyebrow, title, onClose }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <span style={{ fontFamily: WF.sans, fontWeight: 700, fontSize: WF.fs(18), color: WF.ink }}>{title}</span>
      </div>
      <button className="wf-tab" onClick={onClose} style={{ width: 26, height: 26, border: `1px solid ${WF.line}`, borderRadius: 2, background: WF.paper, color: WF.ink2, cursor: 'pointer', fontSize: WF.fs(16), lineHeight: 1 }}>×</button>
    </div>
  );
}

// ── profile avatar + dropdown ──
function ProfileMenu({ onReset, onClear }) {
  const [open, setOpen] = React.useState(false);
  const act = (fn) => () => { setOpen(false); fn && fn(); };
  const rows = [
    { t: 'Settings' },
    { t: 'Reset demo data', fn: onReset },
    { t: 'Clear plan', fn: onClear },
    { t: 'Log out', top: true },
  ];
  return (
    <div style={{ position: 'relative' }}>
      <button className="wf-tab" onClick={() => setOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
        <span style={{ width: 29, height: 29, borderRadius: '50%', border: `1.5px solid ${WF.ink}`, background: WF.fill, overflow: 'hidden', display: 'block' }}>
          <svg width="27" height="27" viewBox="0 0 28 28"><circle cx="14" cy="11" r="4.4" fill={WF.ink3} /><path d="M5 24c0-4.5 4-7.5 9-7.5s9 3 9 7.5" fill={WF.ink3} /></svg>
        </span>
        <span className="wf-caret" style={{ fontFamily: WF.mono, fontSize: WF.fs(9), color: WF.ink3 }}>▾</span>
      </button>
      {open && <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 39 }} />}
      {open && (
        <div style={{ position: 'absolute', top: 38, right: 0, width: 186, background: WF.paper, border: `1.5px solid ${WF.ink}`, borderRadius: 3, boxShadow: '0 12px 30px rgba(0,0,0,0.16)', zIndex: 40, overflow: 'hidden' }}>
          <div style={{ padding: '11px 13px', borderBottom: `1px solid ${WF.line2}` }}>
            <div style={{ fontFamily: WF.sans, fontSize: WF.fs(12), fontWeight: 600, color: WF.ink }}>Alex Stone</div>
            <div style={{ fontFamily: WF.mono, fontSize: WF.fs(9.5), color: WF.ink3 }}>alex@email.com</div>
          </div>
          {rows.map((r) => (
            <div key={r.t} className="pr-hv" onClick={act(r.fn)} style={{ padding: '9px 13px', fontFamily: WF.sans, fontSize: WF.fs(12), fontWeight: r.top ? 600 : 500, color: WF.ink2, cursor: 'pointer', borderTop: r.top ? `1px solid ${WF.line2}` : 'none' }}>{r.t}</div>
          ))}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { YearCell, PctCell, MonthSelect, RefSelect, TextInput, ChainIcon, Tag, ItemTags, LinkChip, ChoiceCard, ErrNote, Toast, ModalShell, ModalHead, ProfileMenu });
