import {
  createContext, useCallback, useContext, useEffect, useRef, useState, type DependencyList, type ReactNode,
} from 'react';

/* ---------- data loading ---------- */
export function useLoad<T>(fn: () => Promise<T>, deps: DependencyList = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    fn().then((d) => { if (live) { setData(d); setError(null); } })
      .catch((e) => { if (live) setError(e.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: useCallback(() => setTick((t) => t + 1), []) };
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/* ---------- toasts ---------- */
const ToastCtx = createContext<(msg: string, kind?: 'ok' | 'err') => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; kind: 'ok' | 'err' }[]>([]);
  const push = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'err' ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={'toast ' + t.kind}>{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- layout bits ---------- */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn noprint" onClick={onClose} aria-label="إغلاق">✕</button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="page-head"><h1>{title}</h1><div className="page-actions">{children}</div></div>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function ErrorBox({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="error-box" role="alert">{message}{retry && <button className="btn small" onClick={retry}>إعادة المحاولة</button>}</div>;
}

export function Empty({ text, children }: { text: string; children?: ReactNode }) {
  return <div className="empty"><p>{text}</p>{children}</div>;
}

export function Loading() { return <div className="loading">جاري التحميل…</div>; }

export function Badge({ kind, children }: { kind: 'ok' | 'low' | 'out' | 'muted' | 'in' | 'transfer'; children: ReactNode }) {
  return <span className={'badge ' + kind}>{children}</span>;
}

/** Quantity against its minimum, drawn like a tape measure: the notch marks the reorder level. */
export function StockBar({ qty, min }: { qty: number; min: number }) {
  if (!min) return null;
  const max = Math.max(min * 3, qty, 1);
  const pct = Math.min(100, (qty / max) * 100);
  const notch = (min / max) * 100;
  const state = qty <= 0 ? 'out' : qty <= min ? 'low' : 'ok';
  return (
    <span className={'stockbar ' + state} title={`الحد الأدنى ${min}`}>
      <span className="fill" style={{ width: pct + '%' }} />
      <span className="notch" style={{ insetInlineStart: notch + '%' }} />
    </span>
  );
}

/* ---------- camera barcode scanning (where the browser supports it) ---------- */
declare global { interface Window { BarcodeDetector?: any } }
export const cameraScanSupported = () => typeof window !== 'undefined' && !!window.BarcodeDetector && !!navigator.mediaDevices?.getUserMedia;

export function ScanModal({ onResult, onClose }: { onResult: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let stream: MediaStream | null = null; let stop = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const det = new window.BarcodeDetector();
        const loop = async () => {
          if (stop || !video.current) return;
          try {
            const found = await det.detect(video.current);
            if (found.length) { onResult(found[0].rawValue); return; }
          } catch { /* keep scanning */ }
          setTimeout(loop, 250);
        };
        loop();
      } catch { setErr('تعذّر تشغيل الكاميرا. اسمح للمتصفح باستخدامها وحاول تاني.'); }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Modal title="مسح باركود" onClose={onClose}>
      {err ? <ErrorBox message={err} /> : <video ref={video} className="scan-video" playsInline muted />}
      <p className="muted">وجّه الكاميرا ناحية الباركود</p>
    </Modal>
  );
}

export function useConfirm() {
  const [state, setState] = useState<{ msg: string; ok: () => void } | null>(null);
  const ask = (msg: string, ok: () => void) => setState({ msg, ok });
  const node = state && (
    <Modal title="تأكيد" onClose={() => setState(null)}>
      <p>{state.msg}</p>
      <div className="form-actions">
        <button className="btn danger" onClick={() => { const f = state.ok; setState(null); f(); }}>تأكيد</button>
        <button className="btn" onClick={() => setState(null)}>إلغاء</button>
      </div>
    </Modal>
  );
  return { ask, node };
}

/** علامة مائية خفيفة فوق الصفحة كلها (بتظهر في الطباعة كمان). مش بتمنع الضغط. */
export function Watermark({ text = 'MG Inventory Control' }: { text?: string }) {
  return (
    <svg className="watermark" aria-hidden="true" focusable="false">
      <defs>
        <pattern id="wm" width="360" height="220" patternUnits="userSpaceOnUse" patternTransform="rotate(-25)">
          <text x="180" y="110" textAnchor="middle" dominantBaseline="middle">{text}</text>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#wm)" />
    </svg>
  );
}
