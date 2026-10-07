import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { DOC_LABEL, fmt, get, post, qs, today, type DocType, type Item, type Party, type Project, type StockDoc, type Warehouse } from '../api';
import { useAuth } from '../auth';
import { ErrorBox, Field, Loading, PageHead, useLoad, useToast } from '../ui';
import ItemPicker from '../ItemPicker';

interface Line { item: Item; qty: string }

const TITLE: Record<DocType, string> = { in: 'إذن إضافة للمخزن', out: 'إذن صرف من المخزن', transfer: 'تحويل بين المخازن' };

export default function NewDocument() {
  const { type } = useParams();
  const { can } = useAuth();
  if (type !== 'in' && type !== 'out' && type !== 'transfer') return <Navigate to="/" replace />;
  if (!can(type)) return <div className="empty">ليس لديك صلاحية {DOC_LABEL[type]}.</div>;
  return <Form key={type} type={type} />;
}

function Form({ type }: { type: DocType }) {
  const nav = useNavigate();
  const toast = useToast();
  const whs = useLoad(() => get<Warehouse[]>('/warehouses'));
  const parties = useLoad(() => get<Party[]>('/parties' + qs({ type: type === 'in' ? 'supplier' : type === 'out' ? 'customer' : undefined })), []);

  const [date, setDate] = useState(today());
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [partyId, setPartyId] = useState('');
  const projects = useLoad(() => (type === 'out' ? get<Project[]>('/projects') : Promise.resolve([] as Project[])), []);
  const [projectId, setProjectId] = useState('');
  const [recipient, setRecipient] = useState('');
  const [issueReason, setIssueReason] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [avail, setAvail] = useState<Record<string, number>>({});

  // preselect when there is a single warehouse
  useEffect(() => {
    const w = whs.data;
    if (!w || w.length !== 1) return;
    if (type !== 'in') setFromId(w[0].id);
    if (type !== 'out') setToId(w[0].id);
  }, [whs.data, type]);

  // available quantities in the source warehouse
  useEffect(() => {
    if (type === 'in' || !fromId) { setAvail({}); return; }
    get<Record<string, number>>('/stock/available' + qs({ warehouseId: fromId })).then(setAvail).catch(() => setAvail({}));
  }, [fromId, type]);

  const addItem = (item: Item, qty = 1) =>
    setLines((ls) => {
      const i = ls.findIndex((l) => l.item.id === item.id);
      if (i >= 0) return ls.map((l, k) => (k === i ? { ...l, qty: String((Number(l.qty) || 0) + qty) } : l));
      return [...ls, { item, qty: String(qty) }];
    });

  const checks = lines.map((l) => {
    const q = Number(l.qty);
    const have = avail[l.item.id] ?? 0;
    return { bad: !(q > 0), over: type !== 'in' && q > have, have };
  });
  const hasOver = checks.some((c) => c.over);
  const hasBad = checks.some((c) => c.bad);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    if (!lines.length) return setErr('أضف صنف واحد على الأقل.');
    if (hasBad) return setErr('كل الكميات لازم تكون أكبر من صفر.');
    if (hasOver) return setErr('في أصناف كميتها أكبر من الرصيد المتاح في المخزن.');
    setBusy(true);
    try {
      const doc = await post<StockDoc>('/documents', {
        type, date, partyId: partyId || undefined,
        projectId: projectId || undefined, recipient: recipient || undefined, issueReason: issueReason || undefined, reference: reference || undefined, notes: notes || undefined,
        fromWarehouseId: type !== 'in' ? fromId : undefined, toWarehouseId: type !== 'out' ? toId : undefined,
        lines: lines.map((l) => ({ itemId: l.item.id, qty: Number(l.qty) })),
      });
      toast(`تم تسجيل ${DOC_LABEL[type]} رقم ${doc.number}`);
      nav(`/documents?open=${doc.id}`, { replace: true });
    } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  };

  if (whs.loading && !whs.data) return <Loading />;
  const wOpts = whs.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>);
  const partyLabel = type === 'in' ? 'المورد' : 'العميل / الجهة المستلمة';

  return (
    <>
      <PageHead title={TITLE[type]} />
      <form onSubmit={submit}>
        {err && <ErrorBox message={err} />}
        {whs.error && <ErrorBox message={whs.error} retry={whs.reload} />}
        <div className="panel pad" style={{ marginBottom: 16 }}>
          <div className="grid3">
            <Field label="التاريخ"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
            {type !== 'in' && (
              <Field label={type === 'out' ? 'المخزن المصروف منه' : 'من مخزن'}>
                <select value={fromId} onChange={(e) => setFromId(e.target.value)} required><option value="">اختر المخزن</option>{wOpts}</select>
              </Field>)}
            {type !== 'out' && (
              <Field label={type === 'in' ? 'المخزن المستلم' : 'إلى مخزن'}>
                <select value={toId} onChange={(e) => setToId(e.target.value)} required><option value="">اختر المخزن</option>{wOpts}</select>
              </Field>)}
            {type !== 'transfer' && (
              <Field label={partyLabel}>
                <select value={partyId} onChange={(e) => setPartyId(e.target.value)}><option value="">بدون</option>{parties.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              </Field>)}
            <Field label="رقم المرجع" hint={type === 'in' ? 'رقم فاتورة المورد مثلاً' : undefined}><input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
          </div>
          {type === 'out' && (
            <div className="grid3">
              <Field label="المشروع">
                <select value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">بدون مشروع</option>{projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              </Field>
              <Field label="المستلم (الشخص)"><input value={recipient} onChange={(e) => setRecipient(e.target.value)} /></Field>
              <Field label="سبب الصرف"><input value={issueReason} onChange={(e) => setIssueReason(e.target.value)} /></Field>
            </div>)}
          <Field label="ملاحظات"><input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>

        <div className="panel pad" style={{ marginBottom: 16 }}>
          <h2 style={{ marginBottom: 10 }}>الأصناف</h2>
          <ItemPicker onPick={(it) => addItem(it)} disabled={type !== 'in' && !fromId} disabledHint="اختر المخزن أولاً" />
          {lines.length === 0 ? <p className="muted" style={{ marginTop: 14 }}>امسح الباركود أو ابحث بالاسم أو الكود لإضافة صنف.</p> : (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="doc-lines">
                <thead><tr><th>الصنف</th>{type !== 'in' && <th className="num">المتاح</th>}<th style={{ width: 140 }}>الكمية</th><th>الوحدة</th><th /></tr></thead>
                <tbody>{lines.map((l, i) => (
                  <tr key={l.item.id}>
                    <td>{l.item.name}<div className="muted">{l.item.code}</div></td>
                    {type !== 'in' && <td className="num avail">{fmt(checks[i].have)}</td>}
                    <td>
                      <input type="number" inputMode="decimal" min="0" step="any" value={l.qty} aria-label={'كمية ' + l.item.name}
                        onChange={(e) => setLines((ls) => ls.map((x, k) => (k === i ? { ...x, qty: e.target.value } : x)))} />
                      {checks[i].over && <div className="over">أكبر من المتاح</div>}
                    </td>
                    <td>{l.item.unit}</td>
                    <td className="actions"><button type="button" className="icon-btn" aria-label="حذف السطر" onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}>✕</button></td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </div>
        <div className="form-actions">
          <button className="btn primary" disabled={busy || !lines.length}>{busy ? 'جاري الحفظ…' : `حفظ ${DOC_LABEL[type]}`}</button>
          <button type="button" className="btn" onClick={() => nav(-1)}>إلغاء</button>
        </div>
      </form>
    </>
  );
}
