import { useState } from 'react';
import { DOC_LABEL, downloadCsv, fmt, get, qs, type DocType, type Item, type Warehouse } from '../api';
import { Badge, Empty, ErrorBox, Loading, PageHead, useLoad } from '../ui';
import DocDetail from './DocDetail';

interface Row {
  documentId: string; number: string; type: DocType; date: string; reference: string | null; itemId: string; itemCode: string;
  itemName: string; unit: string; qty: number; fromWarehouse: string | null; toWarehouse: string | null; partyName: string | null; userName: string | null;
}
const LIMIT = 500;

export default function Movements() {
  const [itemId, setItemId] = useState('');
  const [wh, setWh] = useState('');
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const items = useLoad(() => get<Item[]>('/items?all=true'));
  const whs = useLoad(() => get<Warehouse[]>('/warehouses?all=true'));
  const { data, error, loading, reload } = useLoad(
    () => get<{ rows: Row[]; totals: { type: DocType; qty: number; docs: number }[] }>('/reports/movements' + qs({ itemId, warehouseId: wh, type, from, to, limit: LIMIT })),
    [itemId, wh, type, from, to]);

  const exportCsv = () => data && downloadCsv('حركة-الأصناف.csv', [
    ['التاريخ', 'رقم الإذن', 'النوع', 'الكود', 'الصنف', 'الوحدة', 'الكمية', 'من مخزن', 'إلى مخزن', 'الطرف', 'المرجع', 'سجّله'],
    ...data.rows.map((r) => [r.date, r.number, DOC_LABEL[r.type], r.itemCode, r.itemName, r.unit, r.qty, r.fromWarehouse, r.toWarehouse, r.partyName, r.reference, r.userName]),
  ]);
  const tot = (t: DocType) => data?.totals.find((x) => x.type === t);

  return (
    <>
      <PageHead title="حركة الأصناف"><button className="btn" onClick={exportCsv} disabled={!data?.rows.length}>تصدير Excel</button></PageHead>
      <div className="toolbar">
        <div className="grow">
          <select value={itemId} onChange={(e) => setItemId(e.target.value)} aria-label="الصنف">
            <option value="">كل الأصناف</option>{items.data?.map((i) => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
          </select>
        </div>
        <select value={wh} onChange={(e) => setWh(e.target.value)} aria-label="المخزن"><option value="">كل المخازن</option>{whs.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="النوع"><option value="">كل الأنواع</option>{(Object.keys(DOC_LABEL) as DocType[]).map((t) => <option key={t} value={t}>{DOC_LABEL[t]}</option>)}</select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="من تاريخ" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="إلى تاريخ" />
      </div>
      {error && <ErrorBox message={error} retry={reload} />}
      {loading && !data ? <Loading /> : (
        <div className="panel">
          {data && data.rows.length > 0 && (
            <div className="total-row">
              <span>إضافة: {fmt(tot('in')?.qty ?? 0)} ({tot('in')?.docs ?? 0} إذن)</span>
              <span>صرف: {fmt(tot('out')?.qty ?? 0)} ({tot('out')?.docs ?? 0} إذن)</span>
              <span>تحويل: {fmt(tot('transfer')?.qty ?? 0)} ({tot('transfer')?.docs ?? 0} إذن)</span>
            </div>
          )}
          <div className="table-wrap">
            {data?.rows.length === 0 ? <Empty text="لا توجد حركات مطابقة." /> : (
              <table>
                <thead><tr><th>التاريخ</th><th>الإذن</th><th>النوع</th><th>الصنف</th><th className="num">الكمية</th><th>من</th><th>إلى</th><th>الطرف</th></tr></thead>
                <tbody>{data?.rows.map((r, i) => (
                  <tr key={r.documentId + r.itemId + i}>
                    <td className="nowrap">{r.date}</td>
                    <td><button className="btn small ghost" onClick={() => setOpen(r.documentId)}>{r.number}</button></td>
                    <td><Badge kind={r.type === 'in' ? 'in' : r.type === 'out' ? 'out' : 'transfer'}>{DOC_LABEL[r.type]}</Badge></td>
                    <td>{r.itemName}<div className="muted">{r.itemCode}</div></td>
                    <td className="num">{fmt(r.qty)} {r.unit}</td>
                    <td>{r.fromWarehouse}</td><td>{r.toWarehouse}</td><td>{r.partyName}</td>
                  </tr>))}</tbody>
              </table>
            )}
          </div>
          {data && data.rows.length >= LIMIT && <p className="muted" style={{ padding: '0 14px 12px' }}>معروض أحدث {LIMIT} حركة. ضيّق الفلاتر لتشوف باقي الحركات.</p>}
        </div>
      )}
      {open && <DocDetail id={open} onClose={() => setOpen(null)} />}
    </>
  );
}
