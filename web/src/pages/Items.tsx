import { useState, type FormEvent } from 'react';
import { del, get, patch, post, qs, fmt, type Item } from '../api';
import { useAuth } from '../auth';
import {
  Badge, Empty, ErrorBox, Field, Loading, Modal, PageHead, ScanModal, cameraScanSupported, useConfirm, useDebounced, useLoad, useToast,
} from '../ui';

export default function Items() {
  const { can } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [showAll, setShowAll] = useState(false);
  const { data, error, loading, reload } = useLoad(() => get<Item[]>('/items' + qs({ q: dq, all: showAll })), [dq, showAll]);
  const [edit, setEdit] = useState<Partial<Item> | null>(null);
  const [scan, setScan] = useState(false);
  const confirm = useConfirm();
  const manage = can('items');

  const remove = (it: Item) =>
    confirm.ask(`حذف الصنف "${it.name}"؟`, async () => {
      try { await del('/items/' + it.id); toast('تم حذف الصنف'); reload(); } catch (e: any) { toast(e.message, 'err'); }
    });

  return (
    <>
      <PageHead title="الأصناف">{manage && <button className="btn primary" onClick={() => setEdit({})}>إضافة صنف</button>}</PageHead>
      <div className="toolbar">
        <div className="grow"><input placeholder="بحث بالاسم أو الكود أو الباركود أو التصنيف" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {cameraScanSupported() && <button className="btn shrink" onClick={() => setScan(true)}>مسح باركود</button>}
        {manage && <label className="check shrink"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />عرض الأصناف المعطّلة</label>}
      </div>
      {error && <ErrorBox message={error} retry={reload} />}
      {loading && !data ? <Loading /> : (
        <div className="panel table-wrap">
          {data && data.length === 0 ? <Empty text={q ? 'لا توجد أصناف مطابقة للبحث.' : 'لا توجد أصناف بعد.'}>{manage && !q && <button className="btn primary" onClick={() => setEdit({})}>إضافة أول صنف</button>}</Empty> : (
            <table>
              <thead><tr><th>الكود</th><th>الصنف</th><th>التصنيف</th><th>الوحدة</th><th className="num">الحد الأدنى</th><th>الباركود</th><th />{manage && <th />}</tr></thead>
              <tbody>{data?.map((it) => (
                <tr key={it.id}>
                  <td className="nowrap">{it.code}</td>
                  <td>{it.name}{!it.isActive && <> <Badge kind="muted">معطّل</Badge></>}</td>
                  <td>{it.category}</td><td>{it.unit}</td><td className="num">{fmt(it.minQty)}</td><td className="nowrap">{it.barcode}</td><td />
                  {manage && <td className="actions">
                    <button className="btn small" onClick={() => setEdit(it)}>تعديل</button>{' '}
                    <button className="btn small ghost" onClick={() => remove(it)}>حذف</button>
                  </td>}
                </tr>))}</tbody>
            </table>
          )}
        </div>
      )}
      {edit && <ItemForm item={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {scan && <ScanModal onClose={() => setScan(false)} onResult={(c) => { setQ(c); setScan(false); }} />}
      {confirm.node}
    </>
  );
}

function ItemForm({ item, onClose, onSaved }: { item: Partial<Item>; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: item.name ?? '', code: item.code ?? '', barcode: item.barcode ?? '', category: item.category ?? '',
    unit: item.unit ?? 'قطعة', minQty: String(item.minQty ?? 0), notes: item.notes ?? '', isActive: item.isActive ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    const body = { ...f, minQty: Number(f.minQty) || 0, code: f.code || undefined };
    try {
      if (item.id) await patch('/items/' + item.id, body); else await post('/items', body);
      toast('تم حفظ الصنف');
      onSaved();
    } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={item.id ? 'تعديل صنف' : 'إضافة صنف'} onClose={onClose}>
      <form onSubmit={submit}>
        {err && <ErrorBox message={err} />}
        <Field label="اسم الصنف"><input value={f.name} onChange={(e) => set('name', e.target.value)} required autoFocus /></Field>
        <div className="grid2">
          <Field label="الكود" hint={item.id ? undefined : 'اتركه فارغ ليتولد تلقائياً'}><input value={f.code} onChange={(e) => set('code', e.target.value)} /></Field>
          <Field label="الباركود"><input value={f.barcode} onChange={(e) => set('barcode', e.target.value)} /></Field>
          <Field label="التصنيف"><input value={f.category} onChange={(e) => set('category', e.target.value)} /></Field>
          <Field label="الوحدة"><input value={f.unit} onChange={(e) => set('unit', e.target.value)} placeholder="قطعة، متر، جركن…" /></Field>
        </div>
        <Field label="الحد الأدنى للمخزون" hint="يظهر تنبيه عندما يصل إجمالي الرصيد لهذا الحد أو أقل. اتركه 0 لإلغاء التنبيه.">
          <input type="number" min="0" step="any" value={f.minQty} onChange={(e) => set('minQty', e.target.value)} />
        </Field>
        <Field label="ملاحظات"><textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        {item.id && <label className="check"><input type="checkbox" checked={f.isActive} onChange={(e) => set('isActive', e.target.checked)} />الصنف مفعّل</label>}
        <div className="form-actions"><button className="btn primary" disabled={busy}>حفظ</button><button type="button" className="btn" onClick={onClose}>إلغاء</button></div>
      </form>
    </Modal>
  );
}
