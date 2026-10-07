import { useEffect, useRef, useState } from 'react';
import { get, qs, type Item } from './api';
import { ScanModal, cameraScanSupported, useDebounced } from './ui';

/** Search box that also works with USB/Bluetooth barcode scanners (they type the code then press Enter). */
export default function ItemPicker({ onPick, disabled, disabledHint, noFocus }: { onPick: (i: Item) => void; disabled?: boolean; disabledHint?: string; noFocus?: boolean }) {
  const [text, setText] = useState('');
  const dt = useDebounced(text, 200);
  const [results, setResults] = useState<Item[]>([]);
  const [msg, setMsg] = useState('');
  const [scan, setScan] = useState(false);
  const [hot, setHot] = useState(0);
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!dt.trim()) { setResults([]); return; }
    let live = true;
    get<Item[]>('/items' + qs({ q: dt.trim() })).then((r) => { if (live) { setResults(r.slice(0, 8)); setHot(0); } }).catch(() => {});
    return () => { live = false; };
  }, [dt]);

  const pick = (it: Item) => { onPick(it); setText(''); setResults([]); setMsg(''); box.current?.focus(); };

  const byCode = async (code: string) => {
    try { pick(await get<Item>('/items/lookup/' + encodeURIComponent(code.trim()))); return true; } catch { return false; }
  };
  const onEnter = async () => {
    const t = text.trim();
    if (!t) return;
    if (await byCode(t)) return;
    const r = results.length ? results : await get<Item[]>('/items' + qs({ q: t }));
    if (r.length === 1) return pick(r[0]);
    if (r.length > 1 && results.length) return pick(results[hot]);
    setMsg(`لا يوجد صنف مطابق لـ "${t}"`);
  };

  return (
    <div>
      <div className="pick-row">
        <div className="pick">
          <input ref={box} value={text} disabled={disabled} placeholder={disabled ? disabledHint : 'باركود / كود / اسم الصنف'} autoFocus={!disabled && !noFocus}
            onChange={(e) => { setText(e.target.value); setMsg(''); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); onEnter(); }
              else if (e.key === 'ArrowDown') { e.preventDefault(); setHot((h) => Math.min(h + 1, results.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHot((h) => Math.max(h - 1, 0)); }
            }} />
          {results.length > 0 && (
            <div className="pick-results">
              {results.map((r, i) => (
                <button type="button" key={r.id} className={i === hot ? 'hot' : ''} onClick={() => pick(r)}>
                  <span>{r.name}</span><span className="muted">{r.code}</span>
                </button>))}
            </div>)}
        </div>
        {cameraScanSupported() && <button type="button" className="btn" disabled={disabled} onClick={() => setScan(true)}>مسح بالكاميرا</button>}
      </div>
      {msg && <div className="over" style={{ marginTop: 6 }}>{msg}</div>}
      {scan && <ScanModal onClose={() => setScan(false)} onResult={async (c) => { setScan(false); if (!(await byCode(c))) setMsg(`لا يوجد صنف بالباركود ${c}`); }} />}
    </div>
  );
}
