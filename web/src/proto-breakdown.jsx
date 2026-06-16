// proto-breakdown.jsx — click a percentile line on the net-worth chart to open
// this modal: a representative simulated path for that percentile, broken down
import React from 'react';
// year by year (starting $ per asset, expenses by category, the inflation rate
// applied that year, asset returns, tax paid, and any assets sold to raise cash).

const PCT_LABELS = {
  p10: '10th percentile',
  p25: '25th percentile',
  nw: 'Median outcome',
  p75: '75th percentile',
  p90: '90th percentile',
};
const PCT_BLURB = {
  p10: 'A rough-going path — markets disappoint and cash gets tight.',
  p25: 'A below-average path through this plan.',
  nw: 'The middle-of-the-road path — half of simulations do better, half worse.',
  p75: 'An above-average path through this plan.',
  p90: 'A lucky path — markets cooperate and assets compound fast.',
};

// one labelled value → amount row
function BkRow({ label, value, sub, dim, strong }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '5px 0', borderBottom: `1px solid ${WF.line2}` }}>
      <span style={{ fontFamily: WF.sans, fontSize: WF.fs(12.5), color: dim ? WF.ink3 : WF.ink, fontWeight: strong ? 600 : 400, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexShrink: 0 }}>
        {sub && <span style={{ fontFamily: WF.mono, fontSize: WF.fs(9.5), color: WF.ink3 }}>{sub}</span>}
        <span style={{ fontFamily: WF.mono, fontSize: WF.fs(12), fontWeight: strong ? 700 : 500, color: dim ? WF.ink3 : WF.ink, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      </span>
    </div>
  );
}

// a titled group of rows; renders an empty note if there's nothing to show
function BkSection({ title, count, children, empty }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Eyebrow>{title}</Eyebrow>
        {count != null && <span style={{ fontFamily: WF.mono, fontSize: WF.fs(9.5), color: WF.ink3 }}>{count}</span>}
      </div>
      {empty
        ? <div style={{ fontFamily: WF.mono, fontSize: WF.fs(10.5), color: WF.ink3, padding: '5px 0' }}>{empty}</div>
        : <div>{children}</div>}
    </div>
  );
}

function fmtSigned(v) {
  if (Math.abs(v) < 0.5) return '$0';
  return (v < 0 ? '−' : '+') + fmtMoney(Math.abs(v));
}

function BreakdownModal({ pctKey, rows, onClose, initialYear }) {
  const valid = Array.isArray(rows) && rows.length > 0;
  const yearToIdx = (yr) => {
    if (!valid || yr == null) return 0;
    const i = rows.findIndex((r) => r.year === yr);
    return i >= 0 ? i : 0;
  };
  const [sel, setSel] = React.useState(() => yearToIdx(initialYear));
  React.useEffect(() => { setSel(yearToIdx(initialYear)); }, [pctKey, initialYear]);
  const selRef = React.useRef(null);
  React.useEffect(() => { selRef.current?.scrollIntoView({ block: 'nearest' }); }, [sel]);
  const d = valid ? rows[Math.min(sel, rows.length - 1)] : null;

  return (
    <ModalShell onClose={onClose} width={820}>
      <ModalHead
        eyebrow="year-by-year breakdown"
        title={PCT_LABELS[pctKey] || 'Percentile path'}
        onClose={onClose} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginTop: -6 }}>
        <div style={{ fontFamily: WF.sans, fontSize: WF.fs(12.5), color: WF.ink2, lineHeight: 1.5 }}>
          {PCT_BLURB[pctKey] || ''} <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10), color: WF.ink3 }}>One representative simulated path — taxes, market returns and home costs from the engine.</span>
        </div>
        {valid && (
          <button
            title="Export full timeline to JSON"
            onClick={() => {
              const payload = JSON.stringify({ percentile: pctKey, label: PCT_LABELS[pctKey] || pctKey, rows }, null, 2);
              const blob = new Blob([payload], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `soroban-${pctKey}-timeline.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5, padding: '0 9px', height: 26, border: `1px solid ${WF.line}`, borderRadius: 2, background: WF.paper, fontFamily: WF.mono, fontSize: WF.fs(10), color: WF.ink2, cursor: 'pointer', letterSpacing: 0.3, transition: 'border-color .12s, color .12s' }}
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
        )}
      </div>
      <Rule />

      {!valid ?
        <div style={{ fontFamily: WF.mono, fontSize: WF.fs(11), color: WF.ink3, padding: '24px 0', textAlign: 'center' }}>
          No detailed path is available for this line yet — adjust the plan and try again.
        </div> :
        <div style={{ display: 'flex', gap: 16, height: 'min(540px, 64vh)' }}>

          {/* ── left rail: pick a year ── */}
          <div style={{ width: 188, flexShrink: 0, border: `1px solid ${WF.line}`, borderRadius: 2, overflow: 'auto' }}>
            <div style={{ position: 'sticky', top: 0, background: WF.fill, borderBottom: `1px solid ${WF.line}`, padding: '7px 11px', display: 'flex', justifyContent: 'space-between' }}>
              <Eyebrow>year</Eyebrow>
              <Eyebrow>net worth</Eyebrow>
            </div>
            {rows.map((r, i) => {
              const on = i === sel;
              return (
                <button key={r.year} ref={on ? selRef : null} className="wf-tab" onClick={() => setSel(i)}
                  style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 11px', border: 'none', borderBottom: `1px solid ${WF.line2}`, background: on ? WF.ink : 'transparent', cursor: 'pointer' }}>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ fontFamily: WF.sans, fontSize: WF.fs(12.5), fontWeight: 600, color: on ? WF.paper : WF.ink, fontVariantNumeric: 'tabular-nums' }}>{r.year}</span>
                    <span style={{ fontFamily: WF.mono, fontSize: WF.fs(9), color: on ? WF.paper : WF.ink3, opacity: on ? 0.75 : 1 }}>age {r.age}{r.sales.length ? ' · sold' : ''}</span>
                  </span>
                  <span style={{ fontFamily: WF.mono, fontSize: WF.fs(11), fontWeight: 600, color: on ? WF.paper : WF.ink2, fontVariantNumeric: 'tabular-nums' }}>{fmtShort(r.endAssets)}</span>
                </button>
              );
            })}
          </div>

          {/* ── right pane: the selected year's breakdown ── */}
          <div style={{ flex: 1, minWidth: 0, overflow: 'auto', paddingRight: 4, display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* headline stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: WF.line2, border: `1px solid ${WF.line2}`, borderRadius: 2, overflow: 'hidden' }}>
              {[
                { k: 'start assets', v: fmtMoney(d.startAssets) },
                { k: 'end assets', v: fmtMoney(d.endAssets) },
                { k: 'inflation', v: (d.inflation * 100).toFixed(1) + '%' },
                { k: 'tax paid', v: d.taxPaid > 0.5 ? fmtMoney(d.taxPaid) : '—' },
              ].map((s) => (
                <div key={s.k} style={{ background: WF.paper, padding: '9px 11px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <Eyebrow style={{ fontSize: WF.fs(8.5) }}>{s.k}</Eyebrow>
                  <span style={{ fontFamily: WF.sans, fontWeight: 700, fontSize: WF.fs(15), color: WF.ink, letterSpacing: -0.3, fontVariantNumeric: 'tabular-nums' }}>{s.v}</span>
                </div>
              ))}
            </div>

            {/* assets: starting $, this year's return, ending $ */}
            <BkSection title={`Holdings · ${d.year}`} empty={d.assets.length ? null : 'no holdings tracked this year'}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 0, paddingBottom: 3 }}>
                <span style={{ fontFamily: WF.mono, fontSize: WF.fs(8.5), color: WF.ink3, width: 96, textAlign: 'right' }}>START</span>
                <span style={{ fontFamily: WF.mono, fontSize: WF.fs(8.5), color: WF.ink3, width: 110, textAlign: 'right' }}>RETURN</span>
                <span style={{ fontFamily: WF.mono, fontSize: WF.fs(8.5), color: WF.ink3, width: 96, textAlign: 'right' }}>END</span>
              </div>
              {d.assets.map((a) => (
                <div key={a.name} style={{ display: 'flex', alignItems: 'baseline', gap: 0, padding: '5px 0', borderBottom: `1px solid ${WF.line2}` }}>
                  <span style={{ flex: 1, minWidth: 0, fontFamily: WF.sans, fontSize: WF.fs(12.5), color: WF.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                  <span style={{ width: 96, textAlign: 'right', fontFamily: WF.mono, fontSize: WF.fs(11.5), color: WF.ink2, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(a.start)}</span>
                  <span style={{ width: 110, textAlign: 'right', fontFamily: WF.mono, fontSize: WF.fs(11), color: a.retAmt < -0.5 ? WF.ink : WF.ink2, fontVariantNumeric: 'tabular-nums' }}>
                    {Math.abs(a.retAmt) < 0.5 ? '—' : fmtSigned(a.retAmt) + (a.retPct ? '  ' + (a.retPct > 0 ? '+' : '−') + Math.abs(a.retPct).toFixed(1) + '%' : '')}
                  </span>
                  <span style={{ width: 96, textAlign: 'right', fontFamily: WF.mono, fontSize: WF.fs(11.5), fontWeight: 600, color: WF.ink, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(a.end)}</span>
                </div>
              ))}
            </BkSection>

            {/* two columns: income & expenses */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <BkSection title="Income" count={d.income.length || null} empty={d.income.length ? null : 'none this year'}>
                {d.income.map((it) => <BkRow key={it.name} label={it.name} value={fmtMoney(it.amount)} />)}
                {d.income.length > 1 && <BkRow label="Total" value={fmtMoney(d.income.reduce((s, x) => s + x.amount, 0))} strong />}
              </BkSection>
              <BkSection title="Expenses by category" count={d.expenses.length || null} empty={d.expenses.length ? null : 'none this year'}>
                {d.expenses.map((it) => <BkRow key={it.name} label={it.name} value={fmtMoney(it.amount)} />)}
                {d.expenses.length > 1 && <BkRow label="Total" value={fmtMoney(d.expenses.reduce((s, x) => s + x.amount, 0))} strong />}
              </BkSection>
            </div>

            {/* tax + assets sold */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <BkSection title="Tax paid">
                <BkRow label="Total tax this year" value={d.taxPaid > 0.5 ? fmtMoney(d.taxPaid) : '$0'} strong={d.taxPaid > 0.5} dim={d.taxPaid <= 0.5} />
              </BkSection>
              <BkSection title="Assets sold to raise cash" count={d.sales.length || null} empty={d.sales.length ? null : 'nothing sold — cash flow covered spending'}>
                {d.sales.map((it) => <BkRow key={it.name} label={it.name} value={fmtMoney(it.amount)} sub="proceeds" />)}
              </BkSection>
            </div>
          </div>
        </div>}
    </ModalShell>
  );
}

Object.assign(window, { BreakdownModal });
