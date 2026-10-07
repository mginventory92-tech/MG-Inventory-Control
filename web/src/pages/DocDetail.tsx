import { DOC_LABEL, fmt, get, type StockDoc } from '../api';
import { Badge, ErrorBox, Loading, Modal, useLoad } from '../ui';

export default function DocDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: d, error, loading } = useLoad(() => get<StockDoc>('/documents/' + id), [id]);
  const party = d?.type === 'in' ? 'المورد' : 'العميل / الجهة';
  return (
    <Modal title={d ? `${DOC_LABEL[d.type]} ${d.number}` : 'الإذن'} onClose={onClose} wide>
      {error && <ErrorBox message={error} />}
      {loading && !d ? <Loading /> : d && (
        <>
          <dl className="detail-grid">
            <div><dt>النوع</dt><dd><Badge kind={d.type === 'in' ? 'in' : d.type === 'out' ? 'out' : 'transfer'}>{DOC_LABEL[d.type]}</Badge></dd></div>
            <div><dt>التاريخ</dt><dd>{d.date}</dd></div>
            {d.fromWarehouse && <div><dt>من مخزن</dt><dd>{d.fromWarehouse.name}</dd></div>}
            {d.toWarehouse && <div><dt>إلى مخزن</dt><dd>{d.toWarehouse.name}</dd></div>}
            {d.party && <div><dt>{party}</dt><dd>{d.party.name}</dd></div>}
            {d.project && <div><dt>المشروع</dt><dd>{d.project.name}</dd></div>}
            {d.recipient && <div><dt>المستلم</dt><dd>{d.recipient}</dd></div>}
            {d.issueReason && <div><dt>سبب الصرف</dt><dd>{d.issueReason}</dd></div>}
            {d.reference && <div><dt>المرجع</dt><dd>{d.reference}</dd></div>}
            <div><dt>سجّله</dt><dd>{d.createdBy?.name}</dd></div>
          </dl>
          <div className="table-wrap"><table>
            <thead><tr><th>الكود</th><th>الصنف</th><th>الوحدة</th><th className="num">الكمية</th></tr></thead>
            <tbody>{d.lines.map((l) => <tr key={l.id}><td>{l.item.code}</td><td>{l.item.name}</td><td>{l.item.unit}</td><td className="num">{fmt(l.qty)}</td></tr>)}</tbody>
          </table></div>
          {d.notes && <p><strong>ملاحظات:</strong> {d.notes}</p>}
          <div className="form-actions noprint"><button className="btn primary" onClick={() => window.print()}>طباعة</button></div>
        </>
      )}
    </Modal>
  );
}
