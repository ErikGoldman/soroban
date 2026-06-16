// proto-editor.jsx — the inline item editor (rename, schedules, links,
// delete) and the inline add-item form for each section.
import React from 'react';

// ── schedule rows (with duplicate-year warning + guarded delete) ──
function ChangeRows({ item, p, label }) {
  const cs = [...(item.changes || [])].map((c, i) => ({ ...c, i })).sort((a, b) => (a.year * 12 + (a.month || 0)) - (b.year * 12 + (b.month || 0)));
  const oneTime = item.recurring === 'one-time';
  // K–12 schooling runs 13 years (kindergarten through 12th grade); for school
  // items the end auto-spans that whenever the start year is changed.
  const isSchool = /private school|k[\s\-–]?12|tuition|grade school|\bschooling\b/i.test(item.label || '');
  const K12_SPAN = 13;
  const isAsset = item.section === 'asset';
  const monthly = item.recurring === 'monthly';
  // K–12 schooling spans 13 years — auto-fill the end for school items that
  // still have the generic default span (don't clobber a custom end).
  React.useEffect(() => {
    if (!isSchool || monthly || cs.length !== 1) return;
    const start = cs[0].year;
    const want = start + K12_SPAN;
    if ((item.endYear === undefined || item.endYear === start + 5) && item.endYear !== want) {
      p.update(item.id, { endYear: want });
    }
  }, [isSchool, monthly, cs.length, cs[0] && cs[0].year]);
  const unit = isAsset ? '' : monthly ? '/mo' : item.recurring === 'yearly' ? '/yr' : '';
  const only = cs.length <= 1;
  const keys = cs.map((c) => monthly ? c.year * 12 + (c.month || 0) : c.year);
  const dupKey = keys.find((k, i) => keys.indexOf(k) !== i);
  const dupLabel = dupKey != null ? (monthly ? `${MONTHS[dupKey % 12]} ${Math.floor(dupKey / 12)}` : String(dupKey)) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {cs.map((c, idx) => {
        const isLast = idx === cs.length - 1;
        const toYear = !isLast ? cs[idx + 1].year - 1 : (item.endYear || c.year + 5);
        const neverEnds = item.endYear == null; // unset end → runs indefinitely
        const showLabels = idx === 0;
        return (
          <div key={c.i} style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
            {/* AMOUNT */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {showLabels && <Eyebrow>amount</Eyebrow>}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <NumCell value={c.amount} onChange={(v) => p.setChange(item.id, c.i, 'amount', v)} w={130} strong />
                {unit && <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10), color: WF.ink3 }}>{unit}</span>}
              </div>
            </div>
            {!oneTime && !isAsset && (
              <>
                {/* STARTS */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {showLabels && <Eyebrow>starts</Eyebrow>}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {monthly && <MonthSelect value={c.month} onChange={(v) => p.setChange(item.id, c.i, 'month', v)} />}
                    <YearCell value={c.year} onChange={(v) => { p.setChange(item.id, c.i, 'year', v); if (isSchool && isLast) p.update(item.id, { endYear: v + K12_SPAN }); }} />
                  </div>
                </div>
                <span style={{ fontFamily: WF.mono, fontSize: WF.fs(13), color: WF.ink3, paddingBottom: 8 }}>→</span>
                {/* ENDS */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {showLabels && <Eyebrow>ends</Eyebrow>}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 33 }}>
                    {isLast ? (
                      neverEnds
                        ? <span style={{ fontFamily: WF.mono, fontSize: WF.fs(12), color: WF.ink3 }}>never</span>
                        : <>
                            {monthly && <MonthSelect value={item.endMonth || 0} onChange={(v) => p.update(item.id, { endMonth: v })} />}
                            <YearCell value={toYear} onChange={(v) => p.update(item.id, { endYear: v })} />
                          </>
                    ) : (
                      <span style={{ fontFamily: WF.mono, fontSize: WF.fs(11.5), color: WF.ink3 }}>
                        {monthly && cs[idx + 1] ? MONTHS[cs[idx + 1].month || 0] + ' ' : ''}{cs[idx + 1] ? cs[idx + 1].year : ''}
                      </span>
                    )}
                  </div>
                  {isLast &&
                  <div style={{ marginTop: 2 }}>
                    <Check checked={neverEnds} label="Never ends" onClick={() => p.update(item.id, neverEnds ? { endYear: c.year + 5 } : { endYear: null })} />
                  </div>
                  }
                </div>
              </>
            )}
            {isAsset && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {showLabels && <Eyebrow>{c.amount === 0 ? 'sell in' : 'in'}</Eyebrow>}
                <YearCell value={c.year} onChange={(v) => p.setChange(item.id, c.i, 'year', v)} />
              </div>
            )}
            {oneTime && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {showLabels && <Eyebrow>in</Eyebrow>}
                <YearCell value={c.year} onChange={(v) => p.setChange(item.id, c.i, 'year', v)} />
              </div>
            )}
            {!only && (
              <button className="wf-tab pr-del" title="remove this change" onClick={() => p.removeChange(item.id, c.i)} style={{ marginBottom: 5, width: 22, height: 22, border: 'none', borderRadius: 0, background: 'transparent', color: WF.ink, cursor: 'pointer', opacity: 0.3, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, transition: 'opacity .15s' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  <line x1="10" y1="11" x2="10" y2="17"></line>
                  <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
              </button>
            )}
          </div>
        );
      })}
      {dupLabel && <ErrNote>two changes land on {dupLabel} — the later one in the list wins. remove or re-date one.</ErrNote>}
      <button className="wf-tab" onClick={() => p.addChange(item.id)} style={{ alignSelf: 'flex-start', padding: '0 11px', height: 32, boxSizing: 'border-box', border: 'none', borderRadius: 0, backgroundColor: WF.paper, backgroundImage: `url("data:image/svg+xml,%3csvg width='100%25' height='100%25' xmlns='http://www.w3.org/2000/svg'%3e%3crect width='100%25' height='100%25' fill='none' stroke='%23c4c4c9' stroke-width='1.5' stroke-dasharray='4%2c4' stroke-linecap='square'/%3e%3c/svg%3e")`, backgroundRepeat: 'no-repeat', backgroundSize: '100% 100%', fontFamily: WF.sans, fontSize: WF.fs(12), fontWeight: 600, color: WF.ink, cursor: 'pointer' }}>+ {label}</button>
    </div>
  );
}

// ── asset type select (mirrors the engine's InvestmentAssetType + home) ──
function AssetTypeSelect({ value, onChange, w = 150 }) {
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)} style={{ fontFamily: WF.sans, fontSize: WF.fs(12), fontWeight: 600, color: WF.ink, padding: '7px 8px', border: `1px solid ${WF.line}`, borderRadius: 2, background: WF.paper, width: w, cursor: 'pointer' }}>
      {!value && <option value="">pick a type…</option>}
      {ASSET_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
    </select>
  );
}

// ── name + delete header inside the editor ──
function EditorNameRow({ p, item, onDelete }) {
  const empty = !item.label.trim();
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
      <div style={{ flex: 1, maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <Eyebrow>name</Eyebrow>
        <TextInput value={item.label} onChange={(v) => p.update(item.id, { label: v })} placeholder="Give it a name" error={empty} />
        {empty && <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10), color: WF.ink }}>! name can’t be empty</span>}
      </div>
      <button className="wf-tab" onClick={() => onDelete(item)} title="Delete item" style={{ marginLeft: 'auto', marginRight: 30, marginTop: 19, width: 22, height: 22, padding: 0, border: 'none', background: 'transparent', color: WF.ink, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          <line x1="10" y1="11" x2="10" y2="17"></line>
          <line x1="14" y1="11" x2="14" y2="17"></line>
        </svg>
      </button>
    </div>
  );
}

// ── income distribution panel (advanced section for income items) ──
function IncomeDistributionPanel({ item, p, plan }) {
  const investable = plan.items.filter((a) => a.section === 'asset' && !a.hidden && !homeOf(a));
  const dist = item.distribute || { enabled: false, weights: {} };
  const enabled = !!dist.enabled;
  const weights = dist.weights || {};
  const totalW = investable.reduce((s, a) => s + (Number(weights[a.id]) || 0), 0);

  const setDist = (patch) => p.update(item.id, { distribute: { ...dist, ...patch } });
  const setWeight = (id, val) => {
    const w = Math.max(0, Number(val) || 0);
    setDist({ weights: { ...weights, [id]: w } });
  };
  const toggle = () => {
    if (!enabled) {
      const init = {};
      investable.forEach((a) => { init[a.id] = weights[a.id] != null ? Number(weights[a.id]) : 1; });
      setDist({ enabled: true, weights: init });
    } else {
      setDist({ enabled: false });
    }
  };

  return (
    <div style={{ border: `1px solid ${WF.line}`, borderRadius: 3, padding: '12px 14px', background: WF.paper, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontFamily: WF.sans, fontSize: WF.fs(12.5), fontWeight: 600, color: WF.ink }}>Savings allocation</span>
        <Check checked={enabled} label={enabled ? 'Custom' : 'Auto (proportional)'} onClick={toggle} />
      </div>
      {!enabled && (
        <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10), color: WF.ink3, lineHeight: 1.6 }}>Surplus income is invested proportionally across all assets. Enable Custom to choose a target split.</span>
      )}
      {enabled && investable.length === 0 && (
        <ErrNote>No investable assets — add stocks, bonds, or retirement accounts under Your money.</ErrNote>
      )}
      {enabled && investable.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontFamily: WF.mono, fontSize: WF.fs(9.5), color: WF.ink3, lineHeight: 1.5 }}>RELATIVE WEIGHTS — equal = equal split. RETIREMENT ACCOUNTS (IRA, 401K) CAPPED AT IRS ANNUAL LIMITS.</span>
          {investable.map((a) => {
            const w = Number(weights[a.id]) || 0;
            const pct = totalW > 0 ? (w / totalW) * 100 : 0;
            const isRet = RETIREMENT_TYPES.includes(a.assetType);
            return (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ fontFamily: WF.sans, fontSize: WF.fs(12), color: WF.ink, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{a.label}</span>
                {isRet && <span title="IRS annual contribution limits apply" style={{ fontFamily: WF.mono, fontSize: WF.fs(8.5), color: WF.ink3, background: WF.fill, border: `1px solid ${WF.line}`, borderRadius: 2, padding: '1px 4px', flexShrink: 0 }}>cap</span>}
                <input type="number" min="0" step="1" value={w}
                  onChange={(e) => setWeight(a.id, e.target.value)}
                  style={{ width: 44, textAlign: 'center', border: `1px solid ${WF.line}`, borderRadius: 2, padding: '4px 4px', fontFamily: WF.mono, fontSize: WF.fs(12), fontWeight: 600, color: WF.ink, background: WF.paper, outline: 'none', boxSizing: 'border-box' }}
                />
                <div style={{ width: 72, height: 3, background: WF.line2, borderRadius: 2, overflow: 'hidden', flexShrink: 0 }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: WF.ink, borderRadius: 2, transition: 'width .15s' }} />
                </div>
                <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10), color: pct > 0 ? WF.ink : WF.ink3, width: 30, textAlign: 'right', flexShrink: 0 }}>{Math.round(pct)}%</span>
              </div>
            );
          })}
          {totalW === 0 && <ErrNote>all weights are zero — income will stay in cash</ErrNote>}
        </div>
      )}
    </div>
  );
}

// remaining balance on an amortizing mortgage, `yrs` years after origination
function _payoffAt(buyAmount, downFrac, rateFrac, term, yrs) {
  const loan = buyAmount * (1 - (downFrac || 0));
  if (loan <= 0 || term <= 0 || yrs >= term) return 0;
  if (rateFrac <= 0) return loan * (1 - yrs / term);
  const r = rateFrac / 12, n = term * 12, m = Math.min(yrs * 12, n);
  return loan * (Math.pow(1 + r, n) - Math.pow(1 + r, m)) / (Math.pow(1 + r, n) - 1);
}

// ── “Sell this house”: checkbox + year + selling-cost %, with a live preview ──
// When on, the engine liquidates the home that year at its market value, takes
// the costs off the top, pays off the mortgage, taxes profit above the
// primary-residence exclusion as a long-term gain, and reinvests the proceeds
// through the same surplus split as income (auto or weighted).
function SellHouseControl({ p, item, home }) {
  const sale = item.sale || {};
  const on = !!sale.enabled;
  const buy = [...(item.changes || [])].sort((a, b) => a.year - b.year).find((c) => c.amount > 0);
  const buyYear = buy ? buy.year : START_YEAR;
  const buyAmount = buy ? buy.amount : 0;
  const defYear = Math.min(P_RETIRE, Math.max(buyYear + 15, START_YEAR + 10));
  const year = sale.year != null ? sale.year : defYear;
  const feePct = sale.feePct != null ? sale.feePct : 0.07;
  const setSale = (patch) => p.update(item.id, { sale: { enabled: on, year, feePct, ...sale, ...patch } });
  const toggle = () => p.update(item.id, on ? { sale: { ...sale, enabled: false } } : { sale: { enabled: true, year: defYear, feePct: 0.07 } });

  // deterministic preview — the Monte Carlo run adds market volatility on top
  const yrs = Math.max(0, year - buyYear);
  const gross = buyAmount * Math.pow(1 + (item.growth || 0), yrs);
  const fees = gross * feePct;
  const payoff = _payoffAt(buyAmount, home.down, home.rate, home.term, yrs);
  const net = gross - fees - payoff;
  const gain = (gross - fees) - buyAmount;
  const taxable = Math.max(0, gain - 250000); // §121 single-filer exclusion

  const PreviewRow = ({ label, value, minus, strong }) => (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, padding: strong ? '8px 0 0' : '4px 0', borderTop: strong ? `1px solid ${WF.line}` : 'none' }}>
      <span style={{ fontFamily: WF.sans, fontSize: WF.fs(12), fontWeight: strong ? 700 : 500, color: minus ? WF.ink2 : WF.ink }}>{label}</span>
      <span style={{ fontFamily: WF.mono, fontSize: WF.fs(strong ? 13 : 11.5), fontWeight: strong ? 700 : 600, color: minus ? WF.ink2 : WF.ink, fontVariantNumeric: 'tabular-nums' }}>{minus ? '− ' : ''}{fmtShort(Math.abs(value))}</span>
    </div>
  );

  return (
    <div style={{ border: `1.5px solid ${on ? WF.ink : WF.line}`, borderRadius: 3, background: WF.paper, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: on ? 12 : 0, transition: 'border-color .15s' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Check checked={on} label="Sell this house" onClick={toggle} />
        {on && <span style={{ fontFamily: WF.mono, fontSize: WF.fs(9.5), color: WF.ink3 }}>reinvested as income · auto or weighted</span>}
      </div>
      {on && (
        <React.Fragment>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <Eyebrow>sell in</Eyebrow>
              <YearCell value={year} onChange={(v) => setSale({ year: v })} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <Eyebrow>selling costs</Eyebrow>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <PctCell value={feePct} onChange={(v) => setSale({ feePct: v })} />
                <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10), color: WF.ink3 }}>agent + closing</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 2 }}>
              <Eyebrow style={{ fontSize: WF.fs(8.5) }}>held</Eyebrow>
              <span style={{ fontFamily: WF.mono, fontSize: WF.fs(11), color: WF.ink2 }}>{yrs} yrs</span>
            </div>
          </div>
          <div style={{ background: WF.fill, border: `1px solid ${WF.line2}`, borderRadius: 3, padding: '10px 12px' }}>
            <PreviewRow label={`Market value in ${year} (est.)`} value={gross} />
            <PreviewRow label={`Selling costs (${(feePct * 100).toFixed(1).replace(/\.0$/, '')}%)`} value={fees} minus />
            {payoff > 1 && <PreviewRow label="Mortgage payoff" value={payoff} minus />}
            <PreviewRow label="Proceeds reinvested" value={net} strong />
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${WF.line2}`, display: 'flex', alignItems: 'flex-start', gap: 7 }}>
              <span style={{ fontFamily: WF.mono, fontSize: WF.fs(9.5), color: WF.ink3, lineHeight: 1.55 }}>
                {taxable > 1
                  ? <>Profit is {fmtShort(gain)} — the first $250k is tax-free (primary home), so <strong style={{ color: WF.ink }}>{fmtShort(taxable)}</strong> is taxed as a long-term capital gain in the simulation.</>
                  : <>Profit of {fmtShort(Math.max(0, gain))} sits under the $250k primary-home exclusion — no capital-gains tax.</>}
              </span>
            </div>
          </div>
        </React.Fragment>
      )}
    </div>
  );
}

function ItemEditor({ p, item, onNavigate, onDelete }) {
  const [showAdv, setShowAdv] = React.useState(false); // asset / income "advanced" disclosure
  const plan = p.plan;
  const isAsset = item.section === 'asset';
  const linked = !!item.link;
  const refs = plan.items.filter((i) => i.section === 'asset' && i.id !== item.id);
  const refItem = linked ? plan.items.find((i) => i.id === item.link.ref) : null;
  const refBy = referencedBy(plan, item.id);

  // ─ ASSET editor ─
  if (isAsset) {
    const home = homeOf(item);
    const setHome = (patch) => p.update(item.id, { home: { ...(home || HOME_DEFAULTS), ...patch } });
    const hasSell = (item.changes || []).some((c) => c.amount === 0);
    const retirement = RETIREMENT_TYPES.includes(item.assetType);
    const isEditorBond = item.assetType === 'federal-bonds' || item.assetType === 'local-bonds' ||
      (!item.assetType && !home && /\bbond/i.test(item.label || ''));
    const showDividends = !home && !retirement && !isEditorBond;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignSelf: 'flex-start' }}>
          <Eyebrow>asset type</Eyebrow>
          <AssetTypeSelect value={item.assetType || (home ? 'home' : '')} onChange={(v) => {
            const t = ASSET_TYPES.find((x) => x.value === v);
            p.update(item.id, { assetType: v, growth: t.growth, vol: t.vol, home: v === 'home' ? { ...(item.home || HOME_DEFAULTS) } : false });
          }} />
        </div>
        <EditorNameRow p={p} item={item} onDelete={onDelete} />
        {retirement && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Eyebrow>auto-contribute / yr</Eyebrow>
              <NumCell value={item.contrib || 0} onChange={(v) => p.update(item.id, { contrib: Math.max(0, v) })} w={104} strong />
            </div>
            <Anno style={{ maxWidth: 320, paddingBottom: 4 }}>moved in from cash each year when there's surplus — the simulation caps retirement accounts at IRS limits and applies early-withdrawal rules</Anno>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {home && (
            <div style={{ border: `1px solid ${WF.line}`, borderRadius: 3, padding: '12px 14px', background: WF.paper, display: 'flex', flexDirection: 'column', gap: 11 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <Eyebrow>down payment</Eyebrow>
                  <PctCell value={home.down} onChange={(v) => setHome({ down: v })} w={64} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <Eyebrow>mortgage rate</Eyebrow>
                  <PctCell value={home.rate} onChange={(v) => setHome({ rate: v })} w={64} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <Eyebrow>term (years)</Eyebrow>
                  <NumCell value={home.term} onChange={(v) => setHome({ term: Math.max(1, Math.round(v)) })} w={56} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <Eyebrow>property tax / yr</Eyebrow>
                  <PctCell value={home.propTax} onChange={(v) => setHome({ propTax: v })} w={64} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <Eyebrow>upkeep $ / mo</Eyebrow>
                  <NumCell value={home.monthly} onChange={(v) => setHome({ monthly: v })} w={84} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <Eyebrow>closing costs</Eyebrow>
                  <PctCell value={home.closing} onChange={(v) => setHome({ closing: v })} w={64} />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', paddingTop: 6 }}>
                <Check checked={home.interestOnly || false} label="Interest-only mortgage" onClick={() => setHome({ interestOnly: !home.interestOnly })} />
              </div>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Eyebrow>value over time</Eyebrow>
          </div>
          <ChangeRows item={item} p={p} label="Add a value change" />
        </div>
        {home && <SellHouseControl p={p} item={item} home={home} />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button className="wf-tab" onClick={() => setShowAdv(!showAdv)} style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, padding: 0, border: 'none', background: 'none', fontFamily: WF.sans, fontSize: WF.fs(12), fontWeight: 600, color: WF.ink2, cursor: 'pointer' }}>
            <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10) }}>{showAdv ? '▾' : '▸'}</span>
            Advanced — return & volatility
          </button>
          {showAdv && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-end', border: `1px solid ${WF.line}`, borderRadius: 3, padding: '12px 14px', background: WF.paper }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Eyebrow>total return</Eyebrow>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <PctCell value={item.growth || 0} onChange={(v) => p.update(item.id, { growth: v })} w={70} />
                  <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10), color: WF.ink3 }}>per year</span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Eyebrow>volatility</Eyebrow>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <PctCell value={volOf(item)} onChange={(v) => p.update(item.id, { vol: v })} w={70} />
                  <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10), color: WF.ink3 }}>swing / yr</span>
                </div>
              </div>
              {home && (
                <React.Fragment>
                  <div style={{ width: '100%', height: 1, background: WF.line2 }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7, width: '100%' }}>
                    <Eyebrow>upkeep $ / mo</Eyebrow>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                      <Check
                        checked={!!home.monthlyInflation}
                        label="Grows with inflation"
                        onClick={() => setHome({ monthlyInflation: !home.monthlyInflation })}
                      />
                      {home.monthlyInflation && home.monthly > 0 && (
                        <span style={{ fontFamily: WF.mono, fontSize: WF.fs(9.5), color: WF.ink3 }}>
                          {fmtShort(home.monthly * 12)}/yr now
                          {' → '}
                          {fmtShort(Math.round(home.monthly * 12 * Math.pow(1 + (plan.inflation || 0.025), 10)))}/yr in {START_YEAR + 10}
                        </span>
                      )}
                    </div>
                  </div>
                </React.Fragment>
              )}
              {showDividends && (
                <React.Fragment>
                  <div style={{ width: '100%', height: 1, background: WF.line2 }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <Eyebrow>qualified dividends</Eyebrow>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <PctCell
                        value={item.dividendYield != null ? item.dividendYield : (item.assetType === 'us-stocks' ? 0.015 : 0)}
                        onChange={(v) => p.update(item.id, { dividendYield: Math.max(0, v) })} w={70} />
                      <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10), color: WF.ink3 }}>per year</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <Eyebrow>ordinary dividends</Eyebrow>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <PctCell
                        value={item.dividendYieldOrd != null ? item.dividendYieldOrd : 0}
                        onChange={(v) => p.update(item.id, { dividendYieldOrd: Math.max(0, v) })} w={70} />
                      <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10), color: WF.ink3 }}>per year</span>
                    </div>
                  </div>
                  <Anno style={{ width: '100%', marginTop: 2 }}>Qualified dividends taxed at preferential rates (20% + NIIT); ordinary at income rates. Both are generated on top of price appreciation.</Anno>
                </React.Fragment>
              )}
            </div>
          )}
        </div>
        {refBy.length > 0 && (
          <div style={{ border: `1.5px solid ${WF.ink}`, borderRadius: 3, padding: '13px 14px', background: WF.paper, display: 'flex', flexDirection: 'column', gap: 9 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <ChainIcon size={14} />
              <span style={{ fontFamily: WF.sans, fontSize: WF.fs(12.5), fontWeight: 600, color: WF.ink }}>Other items use this value</span>
            </span>
            {refBy.map((r) => (
              <div key={r.id} className="pr-hv" onClick={() => onNavigate && onNavigate(r.id)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', border: `1px solid ${WF.line}`, borderRadius: 2, background: WF.paper, cursor: 'pointer' }}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontFamily: WF.sans, fontSize: WF.fs(12), fontWeight: 600, color: WF.ink }}>{r.label}</span>
                  <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10), color: WF.ink3 }}>{(r.link.rate * 100).toFixed(1).replace(/\.0$/, '')}% of this value</span>
                </span>
                <span style={{ fontFamily: WF.sans, fontSize: WF.fs(13), fontWeight: 700, color: WF.ink, fontVariantNumeric: 'tabular-nums' }}>{fmtShort(annualOf(plan, r, START_YEAR + 4))}<span style={{ fontSize: WF.fs(10), fontWeight: 500, color: WF.ink3 }}>/yr</span></span>
              </div>
            ))}
            <Anno>change the value above and these recalculate instantly — no need to touch them.</Anno>
          </div>
        )}
      </div>
    );
  }

  // ─ INCOME / EXPENSE editor ─
  const rate = linked ? item.link.rate : 0;
  let sampleYear = START_YEAR;
  if (refItem) { for (let y = START_YEAR; y <= P_RETIRE; y++) { if (valueAt(refItem, y) > 0) { sampleYear = y; break; } } }
  const nowVal = refItem ? valueAt(refItem, sampleYear) : 0;
  const nowAmt = nowVal * rate;
  let phases = [];
  if (refItem) {
    const cs2 = [...(refItem.changes || [])].sort((a, b) => a.year - b.year);
    if (cs2.length && cs2[0].year > START_YEAR) phases.push({ year: START_YEAR, amt: 0, note: 'before you buy' });
    cs2.forEach((c) => phases.push({ year: c.year, amt: valueAt(refItem, c.year) * rate, note: c.amount > 0 ? 'while owned' : 'after you sell' }));
    phases = phases.slice(0, 3);
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <EditorNameRow p={p} item={item} onDelete={onDelete} />


      {linked ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          {!refItem && <ErrNote>the item this was linked to no longer exists — pick another source below, or switch back to setting the amount yourself.</ErrNote>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontFamily: WF.sans, fontSize: WF.fs(13.5), color: WF.ink2, padding: '12px 14px', border: `1px solid ${WF.line}`, borderRadius: 3, background: WF.paper }}>
            <span style={{ fontWeight: 700, color: WF.ink }}>{item.label.trim() || '(unnamed)'}</span>
            <span style={{ color: WF.ink3 }}>is</span>
            <PctCell value={item.link.rate} onChange={(v) => p.setLink(item.id, { rate: v })} />
            <span style={{ color: WF.ink3 }}>of</span>
            <RefSelect value={refItem ? item.link.ref : ''} options={refs} onChange={(id) => p.setLink(item.id, { ref: id })} placeholder="pick an item…" />
            <span style={{ color: WF.ink3 }}>value, recalculated every year.</span>
          </div>

          {refItem && (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18, border: `1.5px solid ${WF.ink}`, borderRadius: 3, padding: '14px 16px', background: WF.paper, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Eyebrow style={{ fontSize: WF.fs(8.5) }}>{sampleYear === START_YEAR ? 'right now that’s' : `from ${sampleYear} that’s`}</Eyebrow>
                <span style={{ fontFamily: WF.sans, fontWeight: 700, fontSize: WF.fs(25), letterSpacing: -0.6, color: WF.ink, lineHeight: 1 }}>{fmtShort(nowAmt)}<span style={{ fontSize: WF.fs(13), fontWeight: 500, color: WF.ink3 }}>/yr</span></span>
                <span style={{ fontFamily: WF.mono, fontSize: WF.fs(9.5), color: WF.ink3 }}>{refItem.label} {fmtShort(nowVal)} × {(rate * 100).toFixed(1).replace(/\.0$/, '')}%</span>
              </div>
              {phases.length > 0 && <div style={{ width: 1, alignSelf: 'stretch', background: WF.line }} />}
              <div style={{ display: 'flex', gap: 18 }}>
                {phases.map((ph, i) => (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ fontFamily: WF.mono, fontSize: WF.fs(9.5), color: WF.ink3 }}>{ph.year}</span>
                    <span style={{ fontFamily: WF.sans, fontSize: WF.fs(13), fontWeight: 600, color: WF.ink }}>{fmtShort(ph.amt)}/yr</span>
                    <span style={{ fontFamily: WF.mono, fontSize: WF.fs(8.5), color: WF.ink3 }}>{ph.note}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {refItem && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', border: `1px solid ${WF.line}`, borderRadius: 3, background: WF.paper }}>
              <ChainIcon size={14} />
              <span style={{ fontFamily: WF.sans, fontSize: WF.fs(11.5), color: WF.ink2 }}>Linked to <button className="wf-tab" onClick={() => onNavigate && onNavigate(refItem.id)} style={{ font: 'inherit', fontWeight: 700, color: WF.ink, background: 'none', border: 'none', borderBottom: `1px solid ${WF.ink}`, padding: 0, cursor: 'pointer' }}>{refItem.label} ↗</button>. Edit it under <strong style={{ color: WF.ink }}>Your money</strong> and this updates automatically.</span>
            </div>
          )}
        </div>
      ) : (
        <React.Fragment>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Eyebrow>Repeats</Eyebrow>
              <Seg size="sm" options={[{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }, { value: 'one-time', label: 'One-time' }]} value={item.recurring} onChange={(v) => p.update(item.id, { recurring: v })} />
            </div>
            {item.section === 'income' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Eyebrow>Taxed as</Eyebrow>
                <Seg size="sm" options={[{ value: 'wages', label: 'Salary' }, { value: 'long-term-capital-gains', label: 'Capital gain' }, { value: 'tax-exempt-income', label: 'Untaxed' }]} value={item.taxAs || (item.recurring === 'one-time' ? 'long-term-capital-gains' : 'wages')} onChange={(v) => p.update(item.id, { taxAs: v })} />
              </div>
            )}
            {item.section !== 'income' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Eyebrow>Inflation</Eyebrow>
                <Check checked={item.inflation} label={"Grow with inflation\n"} onClick={() => p.update(item.id, { inflation: !item.inflation })} />
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <ChangeRows item={item} p={p} label={item.recurring === 'one-time' ? 'Add a payment' : 'Add a change'} />
          </div>
        </React.Fragment>
      )}
      {item.section === 'income' && !linked && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button className="wf-tab" onClick={() => setShowAdv(!showAdv)}
            style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, padding: 0, border: 'none', background: 'none', fontFamily: WF.sans, fontSize: WF.fs(12), fontWeight: 600, color: WF.ink2, cursor: 'pointer' }}>
            <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10) }}>{showAdv ? '▾' : '▸'}</span>
            Advanced — savings allocation
          </button>
          {showAdv && <IncomeDistributionPanel item={item} p={p} plan={plan} />}
        </div>
      )}
    </div>
  );
}

// ── inline add-item form (expands in place of the + Add button) ──
const ADD_DEFAULTS = {
  income: { recurring: 'yearly', inflation: false, amount: 100000, placeholder: 'e.g. Salary, Bonus, RSU vest' },
  expense: { recurring: 'monthly', inflation: true, amount: 1000, placeholder: 'e.g. Rent, Food, Childcare' },
  asset: { amount: 100000, placeholder: 'e.g. Stocks, Bonds, House' },
};
function AddItemForm({ section, p, onClose, onAdded }) {
  const d = ADD_DEFAULTS[section];
  const isAsset = section === 'asset';
  const [name, setName] = React.useState('');
  const [err, setErr] = React.useState(false);
  const [recurring, setRecurring] = React.useState(d.recurring);
  const [inflation, setInflation] = React.useState(!!d.inflation);
  const [amount, setAmount] = React.useState(d.amount);
  const [year, setYear] = React.useState(START_YEAR);
  const [month, setMonth] = React.useState(0);
  const [endYear, setEndYear] = React.useState(START_YEAR + 5);
  const [endMonth, setEndMonth] = React.useState(0);
  const [growth, setGrowth] = React.useState(0.06);
  const [atype, setAtype] = React.useState('us-stocks');
  const isHome = isAsset && atype === 'home';
  const unit = isAsset ? '' : recurring === 'monthly' ? '/mo' : recurring === 'yearly' ? '/yr' : 'once';

  const save = () => {
    if (!name.trim()) { setErr(true); return; }
    const base = { id: puid(), section, label: name.trim() };
    const t = ASSET_TYPES.find((x) => x.value === atype);
    const item = isAsset
      ? { ...base, assetType: atype, growth, vol: t.vol, changes: [{ year, amount }], ...(isHome ? { home: { ...HOME_DEFAULTS } } : {}) }
      : { ...base, recurring, inflation, changes: [recurring === 'monthly' ? { year, month, amount } : { year, amount }], ...(endYear ? { endYear, ...(recurring === 'monthly' ? { endMonth } : {}) } : {}) };
    p.addItem(item);
    onAdded(item);
  };
  const keys = (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onClose(); };

  return (
    <div style={{ marginTop: 8, border: `1.5px solid ${WF.ink}`, borderRadius: 3, background: WF.fill, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ fontFamily: WF.sans, fontSize: WF.fs(13), fontWeight: 600, color: WF.ink }}>Add a new {section === 'asset' ? 'holding' : section}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
        {isAsset && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <Eyebrow>type</Eyebrow>
            <AssetTypeSelect value={atype} onChange={(v) => { setAtype(v); const t = ASSET_TYPES.find((x) => x.value === v); setGrowth(t.growth); }} w={130} />
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, width: 240 }}>
          <Eyebrow>name</Eyebrow>
          <TextInput value={name} onChange={(v) => { setName(v); if (v.trim()) setErr(false); }} placeholder={d.placeholder} autoFocus error={err} onKeyDown={keys} />
        </div>
        {!isAsset && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <Eyebrow>repeats</Eyebrow>
            <Seg size="sm" options={[{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }, { value: 'one-time', label: 'One-time' }]} value={recurring} onChange={setRecurring} />
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <Eyebrow>{isHome ? 'purchase price' : isAsset ? 'value' : 'amount'}</Eyebrow>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <NumCell value={amount} onChange={setAmount} w={104} strong />
            <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10), color: WF.ink3 }}>{unit}</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <Eyebrow>{isHome ? 'purchase year' : isAsset ? 'starting in' : recurring === 'one-time' ? 'in' : 'starts'}</Eyebrow>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {!isAsset && recurring === 'monthly' && <MonthSelect value={month} onChange={setMonth} />}
            <YearCell value={year} onChange={setYear} />
          </div>
        </div>
        {!isAsset && section !== 'income' && (
          <div style={{ paddingBottom: 7 }}>
            <Check checked={inflation} label="Grows with inflation" onClick={() => setInflation(!inflation)} />
          </div>
        )}
        {!isAsset && recurring !== 'one-time' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <Eyebrow>ends</Eyebrow>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {recurring === 'monthly' && <MonthSelect value={endMonth} onChange={setEndMonth} />}
              <YearCell value={endYear} onChange={setEndYear} />
            </div>
          </div>
        )}
      </div>
      {err && <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10), color: WF.ink }}>! give it a name first</span>}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="solid" onClick={save}>Add to plan</Btn>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ChangeRows, ItemEditor, AddItemForm });
