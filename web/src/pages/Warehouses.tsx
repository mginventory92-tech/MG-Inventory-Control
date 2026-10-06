import { useState, type FormEvent } from 'react';
import { del, get, patch, post, type Warehouse } from '../api';
import { useAuth } from '../auth';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, PageHead, useConfirm, useLoad, useToast } from '../ui';

export default function Warehouses() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => get<Warehouse[]>('/warehouses?all=true'));
  const [edit, setEdit] = useState<Partial<Warehouse> | null>(null);
  const confirm = useConfirm();
  const manage = can('warehouses');

  const toggle = async (w: Warehouse) => {
    try { await patch('/warehouses/' + w.id, { isActive: !w.isActive }); reload(); } catch (e: any) { toast(e.message, 'err'); }
  };
  const remove = (w: Warehouse) => confirm.ask(`حذف المخزن "${w.name}"؟`, async () => {
    try { await del('/warehouses/' + w.id); toast('تم حذف المخزن'); reload(); } catch (e: any) { toast(e.message, 'err'); }
  });

  return (
    <>
      <PageHead title="المخازن">{manage && <button className="btn primary" onClick={() => setEdit({})}>إضافة مخزن</button>}</PageHead>
      {error && <ErrorBox message={error} retry={reload} />}
      {loading && !data ? <Loading /> : (
        <div className="panel table-wrap">
          {data?.length === 0 ? <Empty text="لا توجد مخازن." /> : (
            <table>
              <thead><tr><th>المخزن</th><th>الموقع</th><th>الحالة</th>{manage && <th />}</tr></thead>
              <tbody>{data?.map((w) => (
                <tr key={w.id}>
                  <td>{w.name}</td><td>{w.location}</td>
                  <td><Badge kind={w.isActive ? 'ok' : 'muted'}>{w.isActive ? 'مفعّل' : 'معطّل'}</Badge></td>
                  {manage && <td className="actions">
                    <button className="btn small" onClick={() => setEdit(w)}>تعديل</button>{' '}
                    <button className="btn small" onClick={() => toggle(w)}>{w.isActive ? 'تعطيل' : 'تفعيل'}</button>{' '}
                    <button className="btn small ghost" onClick={() => remove(w)}>حذف</button>
                  </td>}
                </tr>))}</tbody>
            </table>
          )}
        </div>
      )}
      {edit && <WarehouseForm w={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {confirm.node}
    </>
  );
}

function WarehouseForm({ w, onClose, onSaved }: { w: Partial<Warehouse>; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(w.name ?? '');
  const [location, setLocation] = useState(w.location ?? '');
  const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    try {
      if (w.id) await patch('/warehouses/' + w.id, { name, location }); else await post('/warehouses', { name, location });
      toast('تم حفظ المخزن'); onSaved();
    } catch (x: any) { setErr(x.message); }
  };
  return (
    <Modal title={w.id ? 'تعديل مخزن' : 'إضافة مخزن'} onClose={onClose}>
      <form onSubmit={submit}>
        {err && <ErrorBox message={err} />}
        <Field label="اسم المخزن"><input value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></Field>
        <Field label="الموقع"><input value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
        <div className="form-actions"><button className="btn primary">حفظ</button><button type="button" className="btn" onClick={onClose}>إلغاء</button></div>
      </form>
    </Modal>
  );
}
