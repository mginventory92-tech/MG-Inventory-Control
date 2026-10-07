import { useEffect, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { downloadCsv, get, qs, type Item } from '../api';
import { useAuth } from '../auth';
import ItemPicker from '../ItemPicker';
import { Empty, ErrorBox, Field, Loading, PageHead, useDebounced, useLoad } from '../ui';
import DocDetail from '../pages/DocDetail';
import { DEFS, DEF_BY_KEY, unitsText, type Filter, type Meta } from './defs';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const PRESETS: { label: string; range: () => [string, string] }[] = [
  { label: 'اليوم', range: () => [ymd(new Date()), ymd(new Date())] },
  { label: 'هذا الشهر', range: () => { const n = new Date(); return [ymd(new Date(n.getFullYear(), n.getMonth(), 1)), ymd(new Date(n.getFullYear(), n.getMonth() + 1, 0))]; } },
  { label: 'الشهر الماضي', range: () => { const n = new Date(); return [ymd(new Date(n.getFullYear(), n.getMonth() - 1, 1)), ymd(new Date(n.getFullYear(), n.getMonth(), 0))]; } },
  { label: 'هذه السنة', range: () => { const n = new Date(); return [ymd(new Date(n.getFullYear(), 0, 1)), ymd(new Date(n.getFullYear(), 11, 31))]; } },
];

export default function ReportPage() {
  const { key = '' } = useParams();
  const { can } = useAuth();
  const def = DEF_BY_KEY[key];
  if (!def) return <Navigate to="/reports" replace />;
  if (!can('reports')) return <div className="empty">ليس لديك صلاحية التقارير.</div>;
  return <Report key={key} k={key} />;
}

function Report({ k }: { k: string }) {
  const def = DEF_BY_KEY[k];
  const { user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const params: Record<string, string> = {};
  sp.forEach((v, key) => (params[key] = v));
  const [openDoc, setOpenDoc] = useState<string | null>(null);

  const setParam = (key: string, value: string) => {
    const n = new URLSearchParams(sp);
    if (value) n.set(key, value); else n.delete(key);
    setSp(n, { replace: true });
  };
  const setMany = (o: Record<string, string>) => {
    const n = new URLSearchParams(sp);
    for (const [a, b] of Object.entries(o)) if (b) n.set(a, b); else n.delete(a);
    setSp(n, { replace: true });
  };

  const meta = useLoad(() => get<Meta>('/reports/meta'));
  const blocked = !!def.needItem && !params.itemId;
  const query = qs(Object.fromEntries(def.filters.map((f) => [f.key, params[f.key]])));
  const { data, error, loading, reload } = useLoad<any>(() => (blocked ? Promise.resolve(null) : get('/reports/' + k + query)), [k, query, blocked]);

  const itemName = useLoad(() => (params.itemId ? get<Item>('/items/' + params.itemId) : Promise.resolve(null)), [params.itemId]);

  const valueLabel = (f: Filter, v: string): string => {
    if (f.type === 'meta') return (meta.data?.[f.meta!] as any[] | undefined)?.map((x) => (typeof x === 'string' ? { id: x, name: x } : x)).find((x) => x.id === v)?.name ?? v;
    if (f.type === 'enum') return f.options?.find((o) => o[0] === v)?.[1] ?? v;
    if (f.type === 'item') return itemName.data?.name ?? '';
    return v;
  };
  const activeFilters = def.filters.filter((f) => params[f.key]).map((f) => `${f.label}: ${valueLabel(f, params[f.key])}`);

  const rows: any[] = data?.rows ?? [];
  const exportCsv = () => {
    if (!data) return;
    downloadCsv(`${def.title}.csv`, [
      [def.title], activeFilters.length ? ['الفلاتر', activeFilters.join(' | ')] : [], [],
      def.cols.map((c) => c.h),
      ...rows.map((r) => def.cols.map((c) => c.v(r))),
      [], ...(data.summary?.byUnit ? [['إجمالي الكميات حسب الوحدة', unitsText(data.summary.byUnit)]] : []),
    ]);
  };

  const now = new Date();
  return (
    <div className="report">
      <div className="print-head">
        <div><strong>نظام المخازن</strong><span> — MG Matrial control</span></div>
        <h1>{def.title}</h1>
        {activeFilters.length > 0 && <p>{activeFilters.join('  •  ')}</p>}
        <p className="muted">طُبع بتاريخ {now.toLocaleDateString('en-GB')} {now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} — بواسطة {user?.name}</p>
      </div>

      <div className="noprint crumbs"><Link to="/reports">← كل التقارير</Link></div>
      <PageHead title={def.title}>
        <button className="btn" onClick={exportCsv} disabled={!rows.length}>تصدير Excel</button>
        <button className="btn primary" onClick={() => window.print()} disabled={!rows.length && !data}>طباعة</button>
      </PageHead>
      <p className="muted noprint" style={{ marginTop: -8 }}>{def.desc}</p>

      <details className="filters noprint panel pad" open={typeof window === 'undefined' || window.innerWidth > 860}>
        <summary>الفلاتر{def.filters.some((f) => params[f.key]) && <span className="badge low">مفعّلة</span>}</summary>
        <div className="filter-grid">
          {def.filters.map((f) => (
            <FilterInput key={f.key} f={f} value={params[f.key] ?? ''} meta={meta.data} itemName={itemName.data?.name}
              onChange={(v) => setParam(f.key, v)} />
          ))}
        </div>
        {def.filters.some((f) => f.key === 'from') && (
          <div className="presets">
            <span className="muted">الفترة:</span>
            {PRESETS.map((p) => <button key={p.label} className="btn small" onClick={() => { const [a, b] = p.range(); setMany({ from: a, to: b }); }}>{p.label}</button>)}
            <button className="btn small ghost" onClick={() => setMany({ from: '', to: '' })}>كل الفترة</button>
            {Object.keys(params).length > 0 && <button className="btn small ghost" onClick={() => setSp({}, { replace: true })}>مسح كل الفلاتر</button>}
          </div>
        )}
      </details>

      {error && <ErrorBox message={error} retry={reload} />}
      {blocked ? <Empty text="اختر الصنف من الفلتر علشان تشوف حركته. تقدر كمان تفتح الحركة بالضغط على اسم أي صنف في باقي التقارير." />
        : loading && !data ? <Loading /> : data && (
          <>
            {def.tiles && (
              <div className="tiles">
                {def.tiles(data).map((t, i) => (
                  <div key={i} className={'tile' + (t.tone ? ' ' + t.tone : '') + (t.wide ? ' wide' : '')}><span>{t.label}</span><b>{t.value}</b></div>
                ))}
              </div>
            )}
            <div className="panel report-table">
              {rows.length === 0 ? <Empty text="لا توجد بيانات مطابقة للفلاتر." /> : (
                <div className="table-wrap">
                  <table>
                    <thead><tr>{def.cols.map((c) => <th key={c.h} className={c.num ? 'num' : ''} style={c.w ? { minWidth: c.w } : undefined}>{c.h}</th>)}</tr></thead>
                    <tbody>{rows.map((r, i) => (
                      <tr key={i} className={r.status === 'out' ? 'row-out' : r.status === 'low' ? 'row-low' : ''}>
                        {def.cols.map((c) => (
                          <td key={c.h} className={(c.num ? 'num ' : '') + (c.nowrap ? 'nowrap' : '')}>
                            {c.cell ? c.cell(r, { openDoc: setOpenDoc, params }) : c.num ? (c.v(r) == null ? '' : Number(c.v(r)).toLocaleString('en-US', { maximumFractionDigits: 3 })) : c.v(r)}
                          </td>
                        ))}
                      </tr>))}</tbody>
                  </table>
                </div>
              )}
              {data.total > rows.length && <p className="muted" style={{ padding: '8px 14px' }}>معروض {rows.length} من {data.total} سطر. ضيّق الفلاتر لعرض الباقي.</p>}
            </div>
            <p className="muted noprint">{rows.length > 0 && `${rows.length} سطر`}</p>
          </>
        )}
      {openDoc && <DocDetail id={openDoc} onClose={() => setOpenDoc(null)} />}
    </div>
  );
}

function FilterInput({ f, value, meta, itemName, onChange }: { f: Filter; value: string; meta?: Meta | null; itemName?: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  const dt = useDebounced(text, 400);
  useEffect(() => { if (f.type === 'text' && dt !== value) onChange(dt); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [dt]);
  useEffect(() => { if (f.type === 'text') setText(value); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [value]);

  if (f.type === 'date') return <Field label={f.label}><input type="date" value={value} onChange={(e) => onChange(e.target.value)} /></Field>;
  if (f.type === 'text') return <Field label={f.label}><input value={text} onChange={(e) => setText(e.target.value)} placeholder={f.key === 'q' ? 'اسم / كود / رقم' : ''} /></Field>;
  if (f.type === 'item') {
    return (
      <Field label={f.label}>
        {value ? (
          <div className="picked"><span>{itemName ?? '…'}</span><button type="button" className="icon-btn" aria-label="إلغاء اختيار الصنف" onClick={() => onChange('')}>✕</button></div>
        ) : <ItemPicker onPick={(it) => onChange(it.id)} noFocus />}
      </Field>
    );
  }
  const opts: [string, string][] = f.type === 'enum' ? f.options! : ((meta?.[f.meta!] as any[]) ?? []).map((x) => (typeof x === 'string' ? [x, x] : [x.id, x.name]));
  return (
    <Field label={f.label}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{f.all ?? 'الكل'}</option>
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </Field>
  );
}

export function ReportsHub() {
  const { can } = useAuth();
  if (!can('reports')) return <div className="empty">ليس لديك صلاحية التقارير.</div>;
  const star: Record<string, string> = { balances: '★★★★★', 'item-ledger': '★★★★★', issues: '★★★★★', receipts: '★★★★', transfers: '★★★★', 'project-usage': '★★★★★', stocktakes: '★★★★★', 'low-stock': '★★★★' };
  return (
    <>
      <PageHead title="التقارير" />
      <p className="muted" style={{ marginTop: -8 }}>كل تقرير بيفتح التقرير اللي بعده: رصيد الصنف ← حركته ← الإذن ← المشروع.</p>
      <div className="hub">
        {DEFS.map((d, i) => (
          <Link key={d.key} to={'/reports/' + d.key} className="hub-card">
            <span className="hub-no">{i + 1}</span>
            <strong>{d.title}</strong>
            <span className="muted">{d.desc}</span>
            <span className="stars" aria-hidden>{star[d.key]}</span>
          </Link>
        ))}
      </div>
    </>
  );
}
