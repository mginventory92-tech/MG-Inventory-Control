import { useState, type FormEvent } from 'react';
import { del, get, patch, post, qs, type Party } from '../api';
import { useAuth } from '../auth';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, PageHead, useConfirm, useLoad, useToast } from '../ui';

export default function Parties() {
  const { can } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<'supplier' | 'customer'>('supplier');
  const { data, error, loading, reload } = useLoad(() => get<Party[]>('/parties' + qs({ type: tab, all: true })), [tab]);
  const [edit, setEdit] = useState<Partial<Party> | null>(null);
  const confirm = useConfirm();
  const manage = can('parties');
  const noun = tab === 'supplier' ? 'مورد' : 'عميل';

  const toggle = async (p: Party) => {
    try { await patch('/parties/' + p.id, { isActive: !p.isActive }); reload(); } catch (e: any) { toast(e.message, 'err'); }
  };
  const remove = (p: Party) => confirm.ask(`حذف "${p.name}"؟`, async () => {
    try { await del('/parties/' + p.id); toast('تم الحذف'); reload(); } catch (e: any) { toast(e.message, 'err'); }
  });

  return (
    <>
      <PageHead title="الموردين والعملاء">{manage && <button className="btn primary" onClick={() => setEdit({ type: tab })}>إضافة {noun}</button>}</PageHead>
      <div className="tabs">
        <button className={tab === 'supplier' ? 'active' : ''} onClick={() => setTab('supplier')}>الموردين</button>
        <button className={tab === 'customer' ? 'active' : ''} onClick={() => setTab('customer')}>العملاء</button>
      </div>
      {error && <ErrorBox message={error} retry={reload} />}
      {loading && !data ? <Loading /> : (
        <div className="panel table-wrap">
          {data?.length === 0 ? <Empty text={`لا يوجد ${tab === 'supplier' ? 'موردين' : 'عملاء'} بعد.`} /> : (
            <table>
              <thead><tr><th>الاسم</th><th>الهاتف</th><th>ملاحظات</th><th>الحالة</th>{manage && <th />}</tr></thead>
              <tbody>{data?.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td><td className="nowrap">{p.phone}</td><td>{p.notes}</td>
                  <td><Badge kind={p.isActive ? 'ok' : 'muted'}>{p.isActive ? 'مفعّل' : 'معطّل'}</Badge></td>
                  {manage && <td className="actions">
                    <button className="btn small" onClick={() => setEdit(p)}>تعديل</button>{' '}
                    <button className="btn small" onClick={() => toggle(p)}>{p.isActive ? 'تعطيل' : 'تفعيل'}</button>{' '}
                    <button className="btn small ghost" onClick={() => remove(p)}>حذف</button>
                  </td>}
                </tr>))}</tbody>
            </table>
          )}
        </div>
      )}
      {edit && <PartyForm p={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {confirm.node}
    </>
  );
}

function PartyForm({ p, onClose, onSaved }: { p: Partial<Party>; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ type: p.type ?? 'supplier', name: p.name ?? '', phone: p.phone ?? '', notes: p.notes ?? '' });
  const [err, setErr] = useState('');
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    try {
      if (p.id) await patch('/parties/' + p.id, f); else await post('/parties', f);
      toast('تم الحفظ'); onSaved();
    } catch (x: any) { setErr(x.message); }
  };
  return (
    <Modal title={p.id ? 'تعديل' : 'إضافة'} onClose={onClose}>
      <form onSubmit={submit}>
        {err && <ErrorBox message={err} />}
        <Field label="النوع">
          <select value={f.type} onChange={(e) => set('type', e.target.value)}><option value="supplier">مورد</option><option value="customer">عميل</option></select>
        </Field>
        <Field label="الاسم"><input value={f.name} onChange={(e) => set('name', e.target.value)} required autoFocus /></Field>
        <Field label="الهاتف"><input value={f.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" /></Field>
        <Field label="ملاحظات"><textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        <div className="form-actions"><button className="btn primary">حفظ</button><button type="button" className="btn" onClick={onClose}>إلغاء</button></div>
      </form>
    </Modal>
  );
}
