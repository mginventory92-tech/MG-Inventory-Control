import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DOC_LABEL, get, qs, type DocType, type StockDoc, type Warehouse } from '../api';
import { Badge, Empty, ErrorBox, Loading, PageHead, useDebounced, useLoad } from '../ui';
import DocDetail from './DocDetail';

const PAGE = 50;

export default function Documents() {
  const [params, setParams] = useSearchParams();
  const open = params.get('open');
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [wh, setWh] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = useState(0);
  const whs = useLoad(() => get<Warehouse[]>('/warehouses'));
  const { data, error, loading, reload } = useLoad(
    () => get<{ total: number; rows: StockDoc[] }>('/documents' + qs({ type, from, to, warehouseId: wh, q: dq, limit: PAGE, offset: page * PAGE })),
    [type, from, to, wh, dq, page]);
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(0); };

  return (
    <>
      <PageHead title="سجل الإذون" />
      <div className="toolbar">
        <div className="grow"><input placeholder="بحث برقم الإذن أو المرجع أو الاسم" value={q} onChange={(e) => reset(setQ)(e.target.value)} /></div>
        <select value={type} onChange={(e) => reset(setType)(e.target.value)} aria-label="النوع">
          <option value="">كل الأنواع</option>{(Object.keys(DOC_LABEL) as DocType[]).map((t) => <option key={t} value={t}>{DOC_LABEL[t]}</option>)}
        </select>
        <select value={wh} onChange={(e) => reset(setWh)(e.target.value)} aria-label="المخزن">
          <option value="">كل المخازن</option>{whs.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <input type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} aria-label="من تاريخ" />
        <input type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} aria-label="إلى تاريخ" />
      </div>
      {error && <ErrorBox message={error} retry={reload} />}
      {loading && !data ? <Loading /> : (
        <div className="panel table-wrap">
          {data?.rows.length === 0 ? <Empty text="لا توجد إذون مطابقة." /> : (
            <table>
              <thead><tr><th>رقم الإذن</th><th>النوع</th><th>التاريخ</th><th>المخزن</th><th>الطرف</th><th>المرجع</th><th>سجّله</th></tr></thead>
              <tbody>{data?.rows.map((d) => (
                <tr key={d.id}>
                  <td><button className="btn small ghost" onClick={() => setParams({ open: d.id })}>{d.number}</button></td>
                  <td><Badge kind={d.type === 'in' ? 'in' : d.type === 'out' ? 'out' : 'transfer'}>{DOC_LABEL[d.type]}</Badge></td>
                  <td className="nowrap">{d.date}</td>
                  <td>{[d.fromWarehouse?.name, d.toWarehouse?.name].filter(Boolean).join(' ← ')}</td>
                  <td>{d.party?.name}</td><td>{d.reference}</td><td>{d.createdBy?.name}</td>
                </tr>))}</tbody>
            </table>
          )}
        </div>
      )}
      {data && data.total > PAGE && (
        <div className="form-actions">
          <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>السابق</button>
          <span className="muted" style={{ alignSelf: 'center' }}>{page * PAGE + 1}–{Math.min((page + 1) * PAGE, data.total)} من {data.total}</span>
          <button className="btn" disabled={(page + 1) * PAGE >= data.total} onClick={() => setPage(page + 1)}>التالي</button>
        </div>
      )}
      {open && <DocDetail id={open} onClose={() => setParams({})} />}
    </>
  );
}
