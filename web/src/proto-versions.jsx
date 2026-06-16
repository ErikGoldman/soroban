// proto-versions.jsx — save / restore / delete named plan snapshots,
// with an empty state and a name-required error in the save modal.
import React from 'react';

function SaveVersionModal({ nwNow, count, onSave, onClose }) {
  const [name, setName] = React.useState('');
  const [desc, setDesc] = React.useState('');
  const [err, setErr] = React.useState(false);
  const trySave = () => {
    if (!name.trim()) { setErr(true); return; }
    onSave(name.trim(), desc.trim());
    onClose();
  };
  return (
    <ModalShell onClose={onClose}>
      <ModalHead eyebrow="" title="Save this plan" onClose={onClose} />
      <Rule />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Eyebrow>name</Eyebrow>
        <TextInput value={name} onChange={(v) => { setName(v); if (v.trim()) setErr(false); }} placeholder="e.g. Buy house in 2031" autoFocus error={err}
          onKeyDown={(e) => { if (e.key === 'Enter') trySave(); }} />
        {err && <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10), color: WF.ink }}>! give this version a name so you can find it later</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Eyebrow>description</Eyebrow>
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What's different about this version? (optional)" rows={3}
          style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${WF.line}`, borderRadius: 2, padding: '9px 10px', fontFamily: WF.sans, fontSize: WF.fs(13), color: WF.ink, outline: 'none', background: WF.paper, resize: 'none', lineHeight: 1.5 }}></textarea>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', border: `1px solid ${WF.line}`, borderRadius: 2, background: WF.fill }}>
        <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10), color: WF.ink2 }}>net worth at 65: <strong style={{ color: WF.ink }}>{fmtMoney(nwNow)}</strong></span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn kind="solid" onClick={trySave} style={{ opacity: name.trim() ? 1 : 0.4 }}>Save version</Btn>
      </div>
    </ModalShell>
  );
}

function VersionControls({ vs, nwNow, onSave, onRestore }) {
  const [menu, setMenu] = React.useState(false);
  const [modal, setModal] = React.useState(false);
  const currentName = vs.currentId ? ((vs.versions.find((v) => v.id === vs.currentId) || {}).name || 'Working draft') : 'Working draft';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button className="wf-tab" onClick={() => setModal(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 11px', boxSizing: 'border-box', border: `1.5px solid ${WF.ink}`, borderRadius: 2, background: WF.paper, fontFamily: WF.sans, fontSize: WF.fs(12), fontWeight: 600, color: WF.ink, cursor: 'pointer' }}>
        <span style={{ fontSize: WF.fs(13), lineHeight: 1 }}>+</span> Save version
      </button>
      <div style={{ position: 'relative' }}>
        <button className="wf-tab" onClick={() => setMenu((o) => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 32, padding: '0 11px', boxSizing: 'border-box', border: `1px solid ${WF.line}`, borderRadius: 2, background: WF.paper, fontFamily: WF.sans, fontSize: WF.fs(12), fontWeight: 500, color: WF.ink2, cursor: 'pointer' }}>
          <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10), color: WF.ink3 }}>version</span>
          <span style={{ fontWeight: 600, color: WF.ink, maxWidth: 150, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentName}</span>
          <span className="wf-caret" style={{ fontFamily: WF.mono, fontSize: WF.fs(9), color: WF.ink3 }}>▾</span>
        </button>
        {menu && <div onClick={() => setMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 54 }} />}
        {menu && (
          <div style={{ position: 'absolute', top: 36, right: 0, width: 320, background: WF.paper, border: `1.5px solid ${WF.ink}`, borderRadius: 3, boxShadow: '0 14px 34px rgba(0,0,0,0.16)', zIndex: 55, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 13px', borderBottom: `1.5px solid ${WF.ink}` }}>
              <span style={{ fontFamily: WF.sans, fontWeight: 700, fontSize: WF.fs(12.5), color: WF.ink }}>Saved versions</span>
              <span style={{ fontFamily: WF.mono, fontSize: WF.fs(9.5), color: WF.ink3 }}>{vs.versions.length} saved</span>
            </div>
            <div style={{ maxHeight: 280, overflow: 'auto' }}>
              {!vs.currentId && (
                <div style={{ padding: '10px 13px', borderBottom: `1px solid ${WF.line2}`, background: WF.fill, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ fontFamily: WF.sans, fontSize: WF.fs(12.5), fontWeight: 600, color: WF.ink }}>Working draft</span>
                    <span style={{ fontFamily: WF.mono, fontSize: WF.fs(9.5), color: WF.ink3 }}>unsaved changes</span>
                  </span>
                  <button className="wf-tab" onClick={() => { setMenu(false); setModal(true); }} style={{ padding: '4px 9px', border: `1.5px solid ${WF.ink}`, borderRadius: 2, background: WF.paper, fontFamily: WF.sans, fontSize: WF.fs(10.5), fontWeight: 600, color: WF.ink, cursor: 'pointer' }}>Save</button>
                </div>
              )}
              {vs.versions.length === 0 && (
                <div style={{ padding: '22px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, textAlign: 'center' }}>
                  <span style={{ width: 26, height: 26, border: `1.5px dashed ${WF.line}`, borderRadius: '50%', display: 'grid', placeItems: 'center', fontFamily: WF.mono, fontSize: WF.fs(13), color: WF.ink3 }}>+</span>
                  <span style={{ fontFamily: WF.sans, fontSize: WF.fs(12), fontWeight: 600, color: WF.ink }}>No saved versions yet</span>
                </div>
              )}
              {vs.versions.map((v) => {
                const active = v.id === vs.currentId;
                return (
                  <div key={v.id} className="pr-hv pr-vrow" onClick={() => { onRestore(v); setMenu(false); }} style={{ padding: '11px 13px', borderBottom: `1px solid ${WF.line2}`, cursor: 'pointer', background: active ? WF.fill : WF.paper, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: active ? WF.ink : 'transparent', border: `1.5px solid ${active ? WF.ink : WF.line}` }} />
                        <span style={{ fontFamily: WF.sans, fontSize: WF.fs(12.5), fontWeight: 600, color: WF.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.name}</span>
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
                        <span style={{ fontFamily: WF.mono, fontSize: WF.fs(10), color: WF.ink, fontWeight: 600 }}>{fmtShort(v.nw)}</span>
                        <button className="pr-vdel pr-del" title="delete this version" onClick={(e) => { e.stopPropagation(); vs.remove(v.id); }} style={{ width: 18, height: 18, border: 'none', borderRadius: 0, background: 'transparent', color: WF.ink, cursor: 'pointer', fontSize: WF.fs(11), lineHeight: 1, padding: 0, opacity: 0.3, transition: 'opacity .15s', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                      </span>
                    </div>
                    {v.desc && <span style={{ fontFamily: WF.sans, fontSize: WF.fs(11), color: WF.ink2, lineHeight: 1.4, paddingLeft: 13 }}>{v.desc}</span>}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 13 }}>
                      <span style={{ fontFamily: WF.mono, fontSize: WF.fs(9.5), color: WF.ink3 }}>saved {v.date} · NW at 65</span>
                      <span style={{ fontFamily: WF.mono, fontSize: WF.fs(9.5), color: active ? WF.ink : WF.ink3 }}>{active ? 'current' : 'restore →'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {modal && <SaveVersionModal nwNow={nwNow} count={vs.versions.length} onSave={onSave} onClose={() => setModal(false)} />}
    </div>
  );
}

Object.assign(window, { VersionControls, SaveVersionModal });
