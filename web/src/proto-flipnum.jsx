// proto-flipnum.jsx — split-flap digit animation
import React from 'react';

if (typeof document !== 'undefined' && !document.getElementById('sf-css')) {
  const s = document.createElement('style');
  s.id = 'sf-css';
  s.textContent = `
    @keyframes sfOut {
      0%   { transform: perspective(280px) rotateX(0deg);    opacity: 1; }
      100% { transform: perspective(280px) rotateX(-86deg);  opacity: 0; }
    }
    @keyframes sfIn {
      0%   { transform: perspective(280px) rotateX(86deg);   opacity: 0; }
      100% { transform: perspective(280px) rotateX(0deg);    opacity: 1; }
    }
  `;
  document.head.appendChild(s);
}

function FlipChar({ ch }) {
  const [shown, setShown] = React.useState(ch);
  const [phase, setPhase] = React.useState('idle');
  const prev = React.useRef(ch);
  const t1 = React.useRef(null);
  const t2 = React.useRef(null);

  React.useEffect(() => {
    if (ch === prev.current) return;
    prev.current = ch;
    clearTimeout(t1.current);
    clearTimeout(t2.current);
    setPhase('out');
    t1.current = setTimeout(() => { setShown(ch); setPhase('in'); }, 85);
    t2.current = setTimeout(() => setPhase('idle'), 260);
    return () => { clearTimeout(t1.current); clearTimeout(t2.current); };
  }, [ch]);

  return (
    <span style={{
      display: 'inline-block',
      animation: phase === 'out' ? 'sfOut 85ms ease-in forwards'
               : phase === 'in'  ? 'sfIn 175ms ease-out forwards'
               : 'none',
    }}>{shown}</span>
  );
}

function FlipNum({ value, style }) {
  return (
    <span style={style}>
      {String(value).split('').map((ch, i) => <FlipChar key={i} ch={ch} />)}
    </span>
  );
}

Object.assign(window, { FlipNum });
