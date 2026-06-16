// wf-chart.jsx — net-worth chart with 5 separate percentile lines.
// Hovering snaps to the nearest percentile line and shows a single-line tooltip.
import React from 'react';

if (typeof document !== 'undefined' && !document.getElementById('chart-anim-css')) {
  const s = document.createElement('style');
  s.id = 'chart-anim-css';
  s.textContent = '@keyframes chartHoverIn { from { opacity: 0; } to { opacity: 1; } } .chart-hover { animation: chartHoverIn 0.12s ease; }';
  document.head.appendChild(s);
}

// push overlapping right-edge label y-positions apart so they never visually collide
function resolveYLabels(items, minGap) {
  const arr = items.map((it) => ({ ...it }));
  arr.sort((a, b) => a.y - b.y);
  for (let pass = 0; pass < 30; pass++) {
    let moved = false;
    for (let i = 1; i < arr.length; i++) {
      const gap = arr[i].y - arr[i - 1].y;
      if (gap < minGap) {
        const mid = (arr[i].y + arr[i - 1].y) / 2;
        arr[i - 1].y = mid - minGap / 2;
        arr[i].y = mid + minGap / 2;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return arr;
}

// render order = z-order: p50 drawn last so it's always on top
const PCT_SPECS = [
  { key: 'p10', label: '10th',   sw: 1.0, basOp: 0.22, da: '2 5'  },
  { key: 'p90', label: '90th',   sw: 1.0, basOp: 0.22, da: '2 5'  },
  { key: 'p25', label: '25th',   sw: 1.5, basOp: 0.42, da: '4 3'  },
  { key: 'p75', label: '75th',   sw: 1.5, basOp: 0.42, da: '4 3'  },
  { key: 'nw',  label: 'median', sw: 2.6, basOp: 1.0,  da: null   },
];

function NetWorthChart({ plan, series, w = 1000, h = 360, showMarks = true, onMilestoneDrag, onDragStart, onDragEnd, childMarkers = [], onChildDrag, onLineClick }) {
  const pad = { l: 58, r: 100, t: 26, b: 32 };
  const [hover, setHover] = React.useState(null); // { idx, key } | null
  const [drag, setDrag] = React.useState(null);
  const [childDrag, setChildDrag] = React.useState(null); // { childIdx } | null
  const svgRef = React.useRef(null);

  const maxNW = series.length ? Math.max(...series.map((d) => Math.abs(d.nw || 0))) : 0;
  const hasBands = series.length > 0 && series[0].p90 != null && maxNW > 1;
  const activeSpecs = hasBands ? PCT_SPECS : PCT_SPECS.filter((p) => p.key === 'nw');
  const canClick = !!onLineClick && !!(series && series.breakdowns);

  // Y-range: include all percentile extremes when present
  const nwYs = series.map((d) => d.nw);
  const hiSrc = hasBands ? [...nwYs, ...series.map((d) => d.p90)] : nwYs;
  const loSrc = hasBands ? [...nwYs, ...series.map((d) => d.p10)] : nwYs;
  const hi = Math.max(...hiSrc) * 1.06;
  const lo = Math.min(0, ...loSrc);

  const xs = series.map((d) => d.year);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const px = (yr) => pad.l + ((yr - x0) / (x1 - x0)) * (w - pad.l - pad.r);
  const py = (v) => h - pad.b - ((v - lo) / (hi - lo || 1)) * (h - pad.t - pad.b);

  // SVG path for one percentile key; null values are skipped
  const fwdPath = (key) =>
    series
      .filter((s) => s[key] != null)
      .map((s, i) => (i ? 'L' : 'M') + px(s.year).toFixed(1) + ' ' + py(s[key]).toFixed(1))
      .join(' ');

  const ticks = 4;
  const gy = Array.from({ length: ticks + 1 }, (_, i) => lo + (i / ticks) * (hi - lo));
  const xt = xs.filter((y, i) => i % 6 === 0 || i === xs.length - 1);
  const last = series[series.length - 1];
  let marks = showMarks ? milestones(plan) : [];
  if (childMarkers && childMarkers.length > 0) {
    marks = marks.filter((mk) => !mk.event || !/^Baby\s*\d+$/i.test(mk.label));
  }

  // snap hover to whichever percentile line is nearest in y-space at the cursor x
  const onMove = (e) => {
    if (drag) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const viewX = ((e.clientX - rect.left) / rect.width) * w;
    const viewY = ((e.clientY - rect.top) / rect.height) * h;
    const frac = (viewX - pad.l) / (w - pad.l - pad.r);
    const idx = Math.max(0, Math.min(series.length - 1, Math.round(frac * (series.length - 1))));
    let key = 'nw';
    if (hasBands) {
      let minDist = Infinity;
      for (const spec of activeSpecs) {
        const val = series[idx][spec.key];
        if (val == null) continue;
        const dist = Math.abs(py(val) - viewY);
        if (dist < minDist) { minDist = dist; key = spec.key; }
      }
    }
    setHover({ idx, key });
  };

  React.useEffect(() => {
    if (childDrag == null || !onChildDrag) return;
    const move = (e) => {
      const rect = svgRef.current.getBoundingClientRect();
      const viewX = ((e.clientX - rect.left) / rect.width) * w;
      let yr = Math.round(x0 + ((viewX - pad.l) / (w - pad.l - pad.r)) * (x1 - x0));
      yr = Math.max(x0, Math.min(x1, yr));
      onChildDrag(childDrag.childIdx, yr);
    };
    const up = () => { setChildDrag(null); if (onDragEnd) onDragEnd(); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [childDrag, onChildDrag, x0, x1, w]);

  React.useEffect(() => {
    if (!drag || !onMilestoneDrag) return;
    const move = (e) => {
      const rect = svgRef.current.getBoundingClientRect();
      const viewX = ((e.clientX - rect.left) / rect.width) * w;
      let yr = Math.round(x0 + ((viewX - pad.l) / (w - pad.l - pad.r)) * (x1 - x0));
      yr = Math.max(x0, Math.min(x1, yr));
      onMilestoneDrag(drag, yr);
    };
    const up = () => { setDrag(null); if (onDragEnd) onDragEnd(); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [drag, onMilestoneDrag, x0, x1, w]);

  const hd    = hover ? series[hover.idx] : null;
  const hKey  = hover ? hover.key : null;
  const hVal  = hd ? hd[hKey] : null;
  const hSpec = hKey ? activeSpecs.find((p) => p.key === hKey) : null;
  const hx    = hd ? px(hd.year) : 0;
  const hy    = hd && hVal != null ? py(hVal) : 0;

  // when hovering: active line stays at full opacity; others dim
  const lineOp = (key, basOp) => {
    if (!hover) return basOp;
    return key === hKey ? 1.0 : basOp * 0.28;
  };

  // compact single-percentile tooltip
  const tipW = 130, tipH = canClick ? 70 : 55;
  const tipX = hd ? Math.max(pad.l, Math.min(w - pad.r - tipW, hx - tipW / 2)) : 0;
  const tipY = hd && hVal != null ? Math.max(pad.t, Math.min(h - pad.b - tipH, hy + 12)) : 0;

  const rEdgeX = w - pad.r + 9;
  let rightLabels = null;
  if (hasBands) {
    const pcts = [
      { key: 'p90', label: '90th', val: last.p90, strong: false },
      { key: 'p75', label: '75th', val: last.p75, strong: false },
      { key: 'nw',  label: '50th', val: last.nw,  strong: true  },
      { key: 'p25', label: '25th', val: last.p25, strong: false },
      { key: 'p10', label: '10th', val: last.p10, strong: false },
    ].map((p) => ({ ...p, y: py(p.val) }));
    rightLabels = resolveYLabels(pcts, 16);
  }

  return (
    <svg ref={svgRef} viewBox={`0 0 ${w} ${h}`} width="100%" height="100%"
      preserveAspectRatio="none" style={{ display: 'block' }}
      onMouseMove={onMove} onMouseLeave={() => setHover(null)}>

      {/* baseline */}
      <line x1={pad.l} y1={py(0)} x2={w - pad.r} y2={py(0)} stroke={WF.ink} strokeWidth="1.2" />

      {/* horizontal grid lines + y-axis labels */}
      {gy.map((v, i) => (
        <g key={i}>
          <line x1={pad.l} y1={py(v)} x2={w - pad.r} y2={py(v)} stroke={WF.line2} strokeWidth="1" strokeDasharray="2 4" />
          <text x={pad.l - 8} y={py(v) + 3} textAnchor="end" fontFamily={WF.mono} fontSize={WF.fs(9.5)} fill={WF.ink3}>{fmtMoney(v)}</text>
        </g>
      ))}

      {/* x-axis year labels */}
      {xt.map((yr) => (
        <text key={yr} x={px(yr)} y={h - pad.b + 16} textAnchor="middle" fontFamily={WF.mono} fontSize={WF.fs(9.5)} fill={WF.ink3}>{yr}</text>
      ))}

      {/* child birth-year markers — draggable, hilite diamonds */}
      {childMarkers && childMarkers.map((cm, i) => {
        const x = px(cm.year);
        const isDragging = childDrag && childDrag.childIdx === cm.childIdx;
        const iy = pad.t;
        return (
          <g key={'c' + i}>
            <line x1={x} y1={iy + 3.5} x2={x} y2={h - pad.b} stroke={WF.ink} strokeWidth="1" strokeDasharray="2 4" opacity="0.3" />
            <circle cx={x} cy={iy} r={3.5} fill={WF.paper} stroke={WF.ink} strokeWidth={isDragging ? 2.2 : 1.5} />
            <text x={x + 6} y={iy + 8} fontFamily={WF.mono} fontSize={WF.fs(8.5)} fill={WF.ink2}>CHILD {i + 1}</text>
            <rect x={x - 12} y={iy - 12} width="24" height="30" fill="transparent"
              style={{ cursor: 'ew-resize' }}
              onMouseDown={(e) => { e.stopPropagation(); setHover(null); setChildDrag({ childIdx: cm.childIdx }); if (onDragStart) onDragStart(); }} />
          </g>
        );
      })}

      {/* milestone marks */}
      {marks.map((m, i) => {
        const x = px(m.year), ly = pad.t + 8 + (i % 2) * 13;
        const canDrag = onMilestoneDrag && m.id;
        const active = drag && drag.id === m.id && drag.idx === m.idx;
        return (
          <g key={i}>
            <line x1={x} y1={pad.t} x2={x} y2={h - pad.b} stroke={WF.ink3} strokeWidth="1" strokeDasharray="1 4" opacity="0.6" />
            <rect x={x - 3.4} y={pad.t - 3.4} width="6.8" height="6.8"
              fill={active ? WF.accent : WF.ink} transform={`rotate(45 ${x} ${pad.t})`}
              stroke={WF.paper} strokeWidth={active ? 1.4 : 0} />
            <text x={x + 6} y={ly} fontFamily={WF.mono} fontSize={WF.fs(8.5)} fill={WF.ink2}>{m.label.toUpperCase()}</text>
            {canDrag && (
              <rect x={x - 9} y={pad.t - 10} width="18" height="20" fill="transparent"
                style={{ cursor: 'ew-resize' }}
                onMouseDown={(e) => { e.stopPropagation(); setHover(null); setDrag({ id: m.id, idx: m.idx }); if (onDragStart) onDragStart(); }} />
            )}
          </g>
        );
      })}

      {/* ── 5 individual percentile lines ── */}
      {activeSpecs.map(({ key, sw, basOp, da }) => (
        <path key={key} d={fwdPath(key)} fill="none" stroke={WF.ink}
          strokeWidth={sw}
          strokeDasharray={da || undefined}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ opacity: lineOp(key, basOp), transition: 'opacity 0.14s ease' }} />
      ))}

      {/* ── fat invisible hit-paths: click a line to open its year-by-year breakdown ── */}
      {canClick && activeSpecs.map(({ key }) => (
        <path key={'hit' + key} d={fwdPath(key)} fill="none" stroke="transparent" strokeWidth={14}
          strokeLinecap="round" strokeLinejoin="round" style={{ cursor: 'pointer' }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            const svg = e.currentTarget.ownerSVGElement;
            const rect = svg.getBoundingClientRect();
            const svgX = ((e.clientX - rect.left) / rect.width) * w;
            const frac = Math.max(0, Math.min(1, (svgX - pad.l) / (w - pad.l - pad.r)));
            const idx = Math.round(frac * (series.length - 1));
            const year = series[Math.max(0, Math.min(series.length - 1, idx))].year;
            onLineClick(key, year);
          }} />
      ))}

      {/* ── right-edge labels (resting state, no hover) ── */}
      {rightLabels && rightLabels.map(({ key, label, val, strong, y }) =>
        strong ? (
          <g key={key}>
            <circle cx={px(last.year)} cy={py(last.nw)} r="3.6" fill={WF.paper} stroke={WF.ink} strokeWidth="2" />
            <text x={rEdgeX} y={y + 4} fontFamily={WF.sans} fontWeight="700" fontSize={WF.fs(14)} fill={WF.ink} letterSpacing="-0.3">{fmtMoney(val)}</text>
          </g>
        ) : (
          <text key={key} x={rEdgeX} y={y + 4} fontFamily={WF.mono} fontSize={WF.fs(9.5)} fill={WF.ink3}
            style={{ textTransform: 'uppercase' }}>
            {label} {fmtShort(val)}
          </text>
        )
      )}

      {/* fallback when engine hasn't returned bands yet */}
      {!hd && !hasBands && (
        <>
          <circle cx={px(last.year)} cy={py(last.nw)} r="3.6" fill={WF.paper} stroke={WF.ink} strokeWidth="2" />
          <text x={w - pad.r + 8} y={py(last.nw) - 2} fontFamily={WF.sans} fontWeight="700" fontSize={WF.fs(14)} fill={WF.ink}>{fmtMoney(last.nw)}</text>
          <text x={w - pad.r + 8} y={py(last.nw) + 10} fontFamily={WF.mono} fontSize={WF.fs(8.5)} fill={WF.ink3}>at age {last.age}</text>
        </>
      )}

      {/* ── hover: crosshair + dot snapped to the active percentile line ── */}
      {hd && hVal != null && (
        <g className="chart-hover" style={{ pointerEvents: 'none' }}>
          <line x1={hx} y1={pad.t} x2={hx} y2={h - pad.b} stroke={WF.ink} strokeWidth="1" strokeOpacity="0.3" />
          <circle cx={hx} cy={hy} r="4" fill={WF.paper} stroke={WF.ink} strokeWidth="2" />
          <rect x={tipX} y={tipY} width={tipW} height={tipH} fill="#CBFF37" rx="2" stroke="#1b1b1d" strokeWidth="1.5" />
          <text x={tipX + 10} y={tipY + 14} fontFamily={WF.mono} fontSize={WF.fs(9)} fill="#1b1b1d">
            {hd.year} · age {hd.age}
          </text>
          <text x={tipX + 10} y={tipY + 33} fontFamily={WF.sans} fontWeight="700" fontSize={WF.fs(15)} fill="#1b1b1d">
            {fmtMoney(hVal)}
          </text>
          {hSpec && (
            <text x={tipX + 10} y={tipY + 48} textAnchor="start"
              fontFamily={WF.mono} fontSize={WF.fs(8.5)} fill="#1b1b1d" fillOpacity="0.6">
              {hSpec.key === 'nw' ? 'median' : hSpec.label + ' percentile'}
            </text>
          )}
          {canClick && (
            <text x={tipX + 10} y={tipY + 63} textAnchor="start"
              fontFamily={WF.mono} fontSize={WF.fs(8)} fill="#1b1b1d" fillOpacity="0.85" style={{ fontWeight: 700 }}>
              → CLICK FOR YEARLY DETAIL
            </text>
          )}
        </g>
      )}
    </svg>
  );
}

// step sparkline: how a category's amount changes over the years
function StepSpark({ data, w = 150, h = 34, max }) {
  if (!data.length) return null;
  const pad = 3;
  const x0 = data[0].year, x1 = data[data.length - 1].year;
  const hi = max || Math.max(1, ...data.map((d) => d.v));
  const px = (yr) => pad + ((yr - x0) / (x1 - x0 || 1)) * (w - pad * 2);
  const py = (v) => h - pad - (v / hi) * (h - pad * 2);
  let d = '';
  data.forEach((pt, i) => {
    const X = px(pt.year), Y = py(pt.v);
    if (i === 0) d += `M${X.toFixed(1)} ${Y.toFixed(1)}`;
    else { const prevY = py(data[i - 1].v); d += ` L${X.toFixed(1)} ${prevY.toFixed(1)} L${X.toFixed(1)} ${Y.toFixed(1)}`; }
  });
  d += ` L${px(x1).toFixed(1)} ${py(data[data.length - 1].v).toFixed(1)}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{ display: 'block' }}>
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke={WF.line2} strokeWidth="1" />
      <path d={d} fill="none" stroke={WF.ink} strokeWidth="1.6" />
    </svg>
  );
}

// tiny smooth net-worth sparkline for the condensed sticky bar
// interactive mini chart for the condensed sticky bar — hover scrubs a tooltip, same data as the big chart
function MiniNW({ series, plan, w = 300, h = 44 }) {
  const svgRef = React.useRef(null);
  const [hoverIdx, setHoverIdx] = React.useState(null);
  const padL = 2, padR = 12, padT = 4, padB = 4;
  const xs = series.map((d) => d.year);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const ys = series.map((d) => d.nw);
  const hi = Math.max(...ys), lo = Math.min(0, ...ys);
  const px = (yr) => padL + ((yr - x0) / (x1 - x0 || 1)) * (w - padL - padR);
  const py = (v) => h - padB - ((v - lo) / (hi - lo || 1)) * (h - padT - padB);
  const d = series.map((s, i) => (i ? 'L' : 'M') + px(s.year).toFixed(1) + ' ' + py(s.nw).toFixed(1)).join(' ');
  const area = d + ` L${px(x1).toFixed(1)} ${h - padB} L${px(x0).toFixed(1)} ${h - padB} Z`;

  const onMouseMove = (e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const svgAspect = w / h;
    const boxAspect = rect.width / rect.height;
    let scaleX, offsetX;
    if (boxAspect > svgAspect) {
      const drawn = rect.height * svgAspect;
      offsetX = (rect.width - drawn) / 2;
      scaleX = w / drawn;
    } else {
      offsetX = 0;
      scaleX = w / rect.width;
    }
    const relX = (e.clientX - rect.left - offsetX) * scaleX;
    let best = 0, bestDist = Infinity;
    series.forEach((s, i) => { const dist = Math.abs(px(s.year) - relX); if (dist < bestDist) { bestDist = dist; best = i; } });
    setHoverIdx(best);
  };

  const hov = hoverIdx != null ? series[hoverIdx] : null;
  const last = series[series.length - 1];

  return (
    <div style={{ position: 'relative', width: 220, flexShrink: 0 }}>
      <svg ref={svgRef} viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block' }}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHoverIdx(null)}>
        <path d={area} fill={WF.fill2} stroke="none" />
        <path d={d} fill="none" stroke={WF.ink} strokeWidth="1.8" strokeLinejoin="round" />
        {hov && (
          <g>
            <line x1={px(hov.year)} y1={padT} x2={px(hov.year)} y2={h - padB} stroke={WF.ink3} strokeWidth="1" strokeDasharray="2 3" />
            <circle cx={px(hov.year)} cy={py(hov.nw)} r="3" fill={WF.paper} stroke={WF.ink} strokeWidth="1.5" />
          </g>
        )}
        {!hov && <circle cx={px(last.year)} cy={py(last.nw)} r="2.4" fill={WF.paper} stroke={WF.ink} strokeWidth="1.5" />}
      </svg>
      {hov && (
        <div style={{ position: 'absolute', top: 0, left: Math.min(px(hov.year) / w * 100, 72) + '%', transform: 'translateX(-50%)',
          pointerEvents: 'none', background: '#CCFF36', border: `1px solid ${WF.ink}`, padding: '2px 7px',
          fontFamily: WF.mono, fontSize: WF.fs(9.5), color: WF.ink, whiteSpace: 'nowrap', lineHeight: 1.5 }}>
          <span style={{ fontWeight: 700 }}>{fmtMoney(hov.nw)}</span>
          <span style={{ color: WF.ink3, marginLeft: 5 }}>age {hov.age}</span>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { NetWorthChart, StepSpark, MiniNW });
