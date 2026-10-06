import { Link } from 'react-router-dom';
import { get, DOC_LABEL, fmt, type BalanceRow, type DocType } from '../api';
import { useAuth } from '../auth';
import { Badge, Empty, ErrorBox, Loading, PageHead, StockBar, useLoad } from '../ui';

interface Summary {
  counts: { items: number; warehouses: number; suppliers: number; customers: number; docsToday: number };
  lowCount: number; low: BalanceRow[];
  recent: { id: string; number: string; type: DocType; date: string; fromWarehouse: string | null; toWarehouse: string | null; partyName: string | null; lineCount: number }[];
}

export default function Dashboard() {
  const { can } = useAuth();
  const { data, error, loading, reload } = useLoad(() => get<Summary>('/dashboard'));
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'تعذّر تحميل البيانات'} retry={reload} />;
  const c = data.counts;

  return (
    <>
      <PageHead title="الرئيسية" />
      <div className="quick">
        {can('in') && <Link className="btn primary" to="/new/in">إذن إضافة</Link>}
        {can('out') && <Link className="btn primary" to="/new/out">إذن صرف</Link>}
        {can('transfer') && <Link className="btn primary" to="/new/transfer">تحويل بين المخازن</Link>}
      </div>
      <div className="stats">
        <Link className={'stat' + (data.lowCount ? ' warn' : '')} to="/balances?low=1"><b>{data.lowCount}</b><span>صنف تحت الحد الأدنى</span></Link>
        <Link className="stat" to="/items"><b>{c.items}</b><span>صنف</span></Link>
        <Link className="stat" to="/warehouses"><b>{c.warehouses}</b><span>مخزن</span></Link>
        <div className="stat"><b>{c.docsToday}</b><span>إذن اليوم</span></div>
      </div>
      <div className="two-col">
        <section className="panel">
          <h2>أصناف تحتاج توريد</h2>
          {data.low.length === 0 ? <Empty text="كل الأصناف فوق الحد الأدنى." /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>الصنف</th><th className="num">الرصيد</th><th className="num">الحد الأدنى</th></tr></thead>
              <tbody>{data.low.map((r) => (
                <tr key={r.item.id} className={r.total <= 0 ? 'row-out' : 'row-low'}>
                  <td>{r.item.name}<div className="muted">{r.item.code}</div></td>
                  <td className="num">{fmt(r.total)} {r.item.unit}<StockBar qty={r.total} min={r.item.minQty} /></td>
                  <td className="num">{fmt(r.item.minQty)}</td>
                </tr>))}</tbody>
            </table></div>
          )}
        </section>
        <section className="panel">
          <h2>آخر الحركات</h2>
          {data.recent.length === 0 ? <Empty text="لا توجد حركات بعد. ابدأ بإذن إضافة." /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>الإذن</th><th>النوع</th><th>التفاصيل</th></tr></thead>
              <tbody>{data.recent.map((d) => (
                <tr key={d.id}>
                  <td className="nowrap"><Link to={`/documents?open=${d.id}`}>{d.number}</Link><div className="muted">{d.date}</div></td>
                  <td><Badge kind={d.type === 'in' ? 'in' : d.type === 'out' ? 'out' : 'transfer'}>{DOC_LABEL[d.type]}</Badge></td>
                  <td>{[d.fromWarehouse, d.toWarehouse].filter(Boolean).join(' ← ') || ''}{d.partyName ? ` • ${d.partyName}` : ''}<div className="muted">{d.lineCount} صنف</div></td>
                </tr>))}</tbody>
            </table></div>
          )}
        </section>
      </div>
    </>
  );
}
