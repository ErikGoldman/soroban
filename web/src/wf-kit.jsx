// wf-kit.jsx — black/grey/white wireframe primitives.
// All low-fidelity on purpose: square corners, hairline rules, hatched
import React from 'react';
// placeholders, monospace annotations. Exported to window for sibling scripts.

const WF = {
  paper: '#ffffff',
  canvas: '#e7e7e8',
  ink: '#1b1b1d',
  ink2: '#5c5c61',
  ink3: '#9b9ba1',
  line: '#c4c4c9',
  line2: '#dcdce0',
  fill: '#f0f0f2',
  fill2: '#e4e4e7',
  accent: '#1b1b1d',
  sans: 'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  fs: (px) => `calc(${px}px * var(--wf-text-scale))`,
};

// one-time CSS for range inputs + hatch + caret
if (typeof document !== 'undefined' && !document.getElementById('wf-styles')) {
  const s = document.createElement('style');
  s.id = 'wf-styles';
  s.textContent = `
  .wf-range{ -webkit-appearance:none; appearance:none; height:2px; background:${WF.ink}; outline:none; border-radius:0; }
  .wf-range::-webkit-slider-thumb{ -webkit-appearance:none; appearance:none; width:14px; height:14px; border-radius:50%;
     background:${WF.paper}; border:1.5px solid ${WF.ink}; cursor:pointer; box-shadow:0 1px 2px rgba(0,0,0,.15); }
  .wf-range::-moz-range-thumb{ width:14px; height:14px; border-radius:50%; background:${WF.paper}; border:1.5px solid ${WF.ink}; cursor:pointer; }
  .wf-hatch{ background-image:repeating-linear-gradient(135deg, ${WF.line2} 0 1px, transparent 1px 7px); }
  .wf-tab{ cursor:pointer; }
  `;
  document.head.appendChild(s);
}

// ── Annotation: monospace grey caption, optionally with a // prefix ──
function Anno({ children, style }) {
  return (
    <div style={{ fontFamily: WF.mono, fontSize: WF.fs(10.5), lineHeight: 1.45, color: WF.ink3, letterSpacing: 0.1, ...style }}>
      {children}
    </div>
  );
}

// ── Hatched placeholder box (for imagery / map / avatar) ──
function Hatch({ label, w = '100%', h = 80, style }) {
  return (
    <div className="wf-hatch" style={{
      width: w, height: h, border: `1px dashed ${WF.line}`, display: 'flex',
      alignItems: 'center', justifyContent: 'center', color: WF.ink3,
      fontFamily: WF.mono, fontSize: WF.fs(10), textTransform: 'lowercase', letterSpacing: 0.3, ...style,
    }}>{label}</div>
  );
}

// ── Big number readout ──
function Stat({ label, value, sub, emph }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <div style={{ fontFamily: WF.mono, fontSize: WF.fs(9.5), letterSpacing: 0.6, textTransform: 'uppercase', color: WF.ink3 }}>{label}</div>
      <div style={{ fontFamily: WF.sans, fontWeight: 600, fontSize: WF.fs(emph ? 28 : 21), color: WF.ink, lineHeight: 1, letterSpacing: -0.5, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontFamily: WF.mono, fontSize: WF.fs(10), color: WF.ink2 }}>{sub}</div>}
    </div>
  );
}

// ── Generic segmented control (used for scenario, chart-mode, 3-state) ──
function Seg({ options, value, onChange, size = 'md', grow }) {
  const pad = size === 'sm' ? '8px 10px' : '8px 12px';
  const fs = size === 'sm' ? 12 : 12.5;
  return (
    <div style={{ display: 'inline-flex', border: `1px solid ${WF.line}`, borderRadius: 2, overflow: 'hidden', width: grow ? '100%' : 'auto', height: 33, boxSizing: 'border-box' }}>
      {options.map((o, i) => {
        const val = typeof o === 'string' ? o : o.value;
        const lab = typeof o === 'string' ? o : o.label;
        const active = val === value;
        return (
          <button key={val} className="wf-tab" onClick={() => onChange && onChange(val)} style={{
            flex: grow ? 1 : 'none', padding: '0 10px', height: '100%', fontFamily: WF.sans, fontSize: WF.fs(12), fontWeight: active ? 600 : 500,
            border: 'none', borderLeft: i ? `1px solid ${WF.line}` : 'none',
            background: active ? WF.ink : WF.paper, color: active ? WF.paper : WF.ink2, cursor: 'pointer',
            whiteSpace: 'nowrap', transition: 'background .12s,color .12s',
          }}>{lab}</button>
        );
      })}
    </div>
  );
}

// ── Bordered button ──
function Btn({ children, kind = 'ghost', size = 'md', onClick, style }) {
  const pad = size === 'sm' ? '0 9px' : '0 14px';
  const h = size === 'sm' ? 28 : 32;
  const fill = kind === 'solid';
  return (
    <button onClick={onClick} className="wf-tab" style={{
      height: h, padding: pad, boxSizing: 'border-box', fontFamily: WF.sans, fontSize: WF.fs(size === 'sm' ? 11.5 : 12.5), fontWeight: 600,
      border: fill ? `1.5px solid ${WF.ink}` : `1px solid ${WF.ink}`, borderRadius: 2, background: fill ? WF.ink : WF.paper,
      color: fill ? WF.paper : WF.ink, cursor: 'pointer', whiteSpace: 'nowrap', letterSpacing: 0.1, display: 'inline-flex', alignItems: 'center', ...style,
    }}>{children}</button>
  );
}

// ── Wireframe field (label + boxed value) ──
function Field({ label, value, sub, w = '100%', tabular }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, width: w }}>
      {label && <span style={{ fontFamily: WF.mono, fontSize: WF.fs(9.5), letterSpacing: 0.4, textTransform: 'uppercase', color: WF.ink3 }}>{label}</span>}
      <span style={{
        border: `1px solid ${WF.line}`, borderRadius: 2, padding: '7px 9px', minHeight: 16, background: WF.paper,
        fontFamily: tabular ? WF.mono : WF.sans, fontSize: WF.fs(12.5), color: value ? WF.ink : WF.ink3,
        fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
      }}>{value || 'placeholder'}{sub && <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10), color: WF.ink3 }}>{sub}</span>}</span>
    </label>
  );
}

// ── Checkbox / toggle pill ──
function Check({ checked, label, onClick }) {
  return (
    <button className="wf-tab" onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'none', border: 'none', cursor: 'pointer', padding: 0, height: 24, lineHeight: 1 }}>
      <span style={{ width: 15, height: 15, flexShrink: 0, border: `1.5px solid ${WF.ink}`, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', background: checked ? WF.ink : WF.paper }}>
        {checked && <svg width="9" height="7" viewBox="0 0 9 7" fill="none" stroke={WF.paper} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 3.5 3.5 6 8 1" /></svg>}
      </span>
      <span style={{ fontFamily: WF.sans, fontSize: WF.fs(12), color: WF.ink2 }}>{label}</span>
    </button>
  );
}

// ── Section divider rule ──
function Rule({ style }) { return <div style={{ height: 1, background: WF.line2, ...style }} />; }

// ── App chrome: faux top bar with logo block + tabs ──
function WChrome({ tab, tabs = ['Dashboard', 'Plan', 'Compare'], compact }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 10 : 18, padding: compact ? '0 0 0 0' : '0 0 0 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: compact ? 18 : 22, height: compact ? 18 : 22, border: `1.5px solid ${WF.ink}`, borderRadius: 3, display: 'grid', placeItems: 'center', fontFamily: WF.mono, fontSize: WF.fs(compact ? 11 : 13), fontWeight: 700, color: WF.ink }}>S</div>
        {!compact && <span style={{ fontFamily: WF.sans, fontWeight: 700, fontSize: WF.fs(14), letterSpacing: -0.2, color: WF.ink }}>Soroban</span>}
      </div>
      {!compact && (
        <div style={{ display: 'flex', gap: 2, marginLeft: 6 }}>
          {tabs.map((t) => (
            <span key={t} style={{ fontFamily: WF.sans, fontSize: WF.fs(12.5), fontWeight: t === tab ? 600 : 500, color: t === tab ? WF.ink : WF.ink3, padding: '4px 2px', borderBottom: t === tab ? `2px solid ${WF.ink}` : '2px solid transparent' }}>{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Card container with hairline border ──
function Panel({ children, style, pad = 16 }) {
  return <div style={{ border: `1px solid ${WF.line}`, borderRadius: 2, background: WF.paper, padding: pad, ...style }}>{children}</div>;
}

// ── Small caption/eyebrow ──
function Eyebrow({ children, style }) {
  return <div style={{ fontFamily: WF.mono, fontSize: WF.fs(9.5), letterSpacing: 0.8, textTransform: 'uppercase', color: WF.ink3, ...style }}>{children}</div>;
}

// parse "300k" → 300000, "1.5m" → 1500000, "2b" → 2000000000, else parse as plain int
function parseShortNum(s) {
  const t = String(s || '').trim().toLowerCase().replace(/,/g, '');
  const m = t.match(/^([0-9]*\.?[0-9]+)\s*([kmb]?)$/);
  if (!m) return parseInt(t.replace(/[^0-9]/g, ''), 10) || 0;
  const n = parseFloat(m[1]);
  const mult = m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : m[2] === 'b' ? 1e9 : 1;
  return Math.round(n * mult);
}
Object.assign(window, { parseShortNum });

// ── Editable money cell (user types their own numbers) ──
function NumCell({ value, onChange, w = 82, strong, align = 'right' }) {
  const [foc, setFoc] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const inputRef = React.useRef(null);

  // format a raw string with commas, but leave shorthand suffixes (k/m/b) untouched
  const fmtDraft = (raw) => {
    const lower = raw.toLowerCase();
    if (/[kmb]$/.test(lower)) return raw; // shorthand — don't add commas
    const digits = raw.replace(/,/g, '');
    if (!/^[0-9]*$/.test(digits) || !digits) return raw;
    return Number(digits).toLocaleString('en-US');
  };

  const handleChange = (e) => {
    const el = e.target;
    const pos = el.selectionStart;
    // count non-comma chars before cursor to restore cursor after reformat
    const digitsBefore = el.value.slice(0, pos).replace(/,/g, '').length;
    const stripped = el.value.replace(/,/g, '');
    const formatted = fmtDraft(stripped);
    setDraft(formatted);
    // restore cursor position relative to digit count
    requestAnimationFrame(() => {
      if (!inputRef.current) return;
      let dc = 0, newPos = formatted.length;
      for (let i = 0; i < formatted.length; i++) {
        if (formatted[i] !== ',') dc++;
        if (dc === digitsBefore) { newPos = i + 1; break; }
      }
      inputRef.current.setSelectionRange(newPos, newPos);
    });
  };

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 2, boxSizing: 'border-box',
      border: `1px solid ${foc ? WF.ink : WF.line}`, borderRadius: 2, padding: '0 7px', width: w, height: 33,
      background: WF.paper, boxShadow: foc ? `0 0 0 2px ${WF.fill2}` : 'none',
    }}>
      <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10.5), color: WF.ink3 }}>$</span>
      <input
        ref={inputRef}
        value={foc ? draft : Number(value || 0).toLocaleString()}
        onFocus={(e) => { setFoc(true); setDraft(fmtDraft(String(value || 0))); e.target.select(); }}
        onBlur={() => { setFoc(false); onChange(parseShortNum(draft) || 0); }}
        onChange={handleChange}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const n = parseShortNum(draft);
            onChange(n || 0);
            setDraft(n ? n.toLocaleString('en-US') : '0');
            e.target.blur();
          }
        }}
        style={{ border: 'none', outline: 'none', width: '100%', minWidth: 0, background: 'transparent', padding: 0,
          fontFamily: WF.mono, fontSize: WF.fs(strong ? 12.5 : 11.5), fontWeight: strong ? 600 : 400, color: WF.ink, textAlign: align }}
      />
    </span>
  );
}

// ── View switcher (Net worth ⇆ Timeline) — a VIEW control, not an input ──
function ViewSwitch({ value, onChange, options = [{ value: 'graph', label: 'Graph' }, { value: 'timeline', label: 'Timeline' }] }) {
  return (
    <div style={{ display: 'inline-flex', gap: 4 }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} className="wf-tab" onClick={() => onChange(o.value)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 2,
            border: `1.5px solid ${active ? WF.ink : WF.line}`, background: active ? WF.ink : WF.paper,
            color: active ? WF.paper : WF.ink2, fontFamily: WF.sans, fontSize: WF.fs(12), fontWeight: 600, cursor: 'pointer',
          }}>
            <span style={{ width: 12, height: 10, display: 'inline-grid', placeItems: 'center' }}>
              {o.value === 'graph'
                ? <svg width="12" height="10" viewBox="0 0 12 10" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M1 9C3 9 3 2 6 2s3 4 5 4" /></svg>
                : <svg width="12" height="10" viewBox="0 0 12 10" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M1 3h7M1 7h10" /><rect x="7" y="1.5" width="3" height="3" fill="currentColor" stroke="none" /></svg>}
            </span>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

Object.assign(window, { WF, Anno, Hatch, Stat, Seg, Btn, Field, Check, Rule, WChrome, Panel, Eyebrow, NumCell, ViewSwitch });
