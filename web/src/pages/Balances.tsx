import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { downloadCsv, fmt, get, qs, type BalanceRow, type Warehouse } from '../api';
import { Badge, Empty, ErrorBox, Loading, PageHead, ScanModal, StockBar, cameraScanSupported, useDebounced, useLoad } from '../ui';

export default function Balances() {
  const [params] = useSearchParams();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [wh, setWh] = useState('');
  const [low, setLow] = useState(params.get('low') === '1');
  const [scan, setScan] = useState(false);
  const { data, error, loading, reload } = useLoad(
    () => get<{ warehouses: Warehouse[]; rows: BalanceRow[] }>('/stock/balances' + qs({ q: dq, warehouseId: wh, lowOnly: low })), [dq, wh, low]);

  const cols = data ? (wh ? data.warehouses.filter((w) => w.id === wh) : data.warehouses) : [];

  const exportCsv = () => {
    if (!data) return;
    downloadCsv('الأرصدة.csv', [
      ['الكود', 'الصنف', 'التصنيف', 'الوحدة', ...cols.map((w) => w.name), 'الإجمالي', 'الحد الأدنى', 'الحالة'],
      ...data.rows.map((r) => [r.item.code, r.item.name, r.item.category, r.item.unit, ...cols.map((w) => r.perWarehouse[w.id] ?? 0), r.qty, r.item.minQty, r.low ? 'تحت الحد' : 'سليم']),
    ]);
  };

  return (
    <>
      <PageHead title="الأرصدة"><button className="btn" onClick={exportCsv} disabled={!data?.rows.length}>تصدير Excel</button></PageHead>
      <div className="toolbar">
        <div className="grow"><input placeholder="بحث بالاسم أو الكود أو الباركود" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {cameraScanSupported() && <button className="btn shrink" onClick={() => setScan(true)}>مسح باركود</button>}
        <select value={wh} onChange={(e) => setWh(e.target.value)} aria-label="المخزن">
          <option value="">كل المخازن</option>
          {data?.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <label className="check shrink"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} />تحت الحد الأدنى فقط</label>
      </div>
      {error && <ErrorBox message={error} retry={reload} />}
      {loading && !data ? <Loading /> : (
        <div className="panel table-wrap">
          {data?.rows.length === 0 ? <Empty text={low ? 'لا توجد أصناف تحت الحد الأدنى.' : 'لا توجد أرصدة مطابقة.'} /> : (
            <table>
              <thead><tr>
                <th>الصنف</th><th>الوحدة</th>
                {cols.map((w) => <th key={w.id} className="num">{w.name}</th>)}
                {!wh && <th className="num">الإجمالي</th>}<th>الحالة</th>
              </tr></thead>
              <tbody>{data?.rows.map((r) => (
                <tr key={r.item.id} className={r.qty <= 0 && r.item.minQty > 0 ? 'row-out' : r.low ? 'row-low' : ''}>
                  <td>{r.item.name}<div className="muted">{r.item.code}{r.item.category ? ` • ${r.item.category}` : ''}</div></td>
                  <td>{r.item.unit}</td>
                  {cols.map((w) => <td key={w.id} className="num">{fmt(r.perWarehouse[w.id] ?? 0)}</td>)}
                  {!wh && <td className="num"><strong>{fmt(r.total)}</strong></td>}
                  <td className="nowrap">
                    {r.item.minQty > 0 ? (<><Badge kind={r.qty <= 0 ? 'out' : r.low ? 'low' : 'ok'}>{r.qty <= 0 ? 'نفد' : r.low ? 'تحت الحد' : 'سليم'}</Badge><StockBar qty={r.qty} min={r.item.minQty} /></>) : <span className="muted">—</span>}
                  </td>
                </tr>))}</tbody>
            </table>
          )}
        </div>
      )}
      {scan && <ScanModal onClose={() => setScan(false)} onResult={(c) => { setQ(c); setScan(false); }} />}
    </>
  );
}
