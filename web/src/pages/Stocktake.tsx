import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { fmt, get, post, qs, today, type BalanceRow, type Item, type Warehouse } from '../api';
import ItemPicker from '../ItemPicker';
import { Badge, ErrorBox, Field, Loading, PageHead, useLoad, useToast } from '../ui';

interface Line { item: Item; counted: string; reason: string }

export default function Stocktake() {
  const nav = useNavigate();
  const toast = useToast();
  const whs = useLoad(() => get<Warehouse[]>('/warehouses'));
  const [wh, setWh] = useState('');
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [avail, setAvail] = useState<Record<string, number>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (whs.data?.length === 1) setWh(whs.data[0].id);
  }, [whs.data]);
  useEffect(() => {
    setLines([]);
    if (!wh) { setAvail({}); return; }
    get<Record<string, number>>('/stock/available' + qs({ warehouseId: wh })).then(setAvail).catch(() => setAvail({}));
  }, [wh]);

  const add = (item: Item) => setLines((ls) => (ls.some((l) => l.item.id === item.id) ? ls : [...ls, { item, counted: '', reason: '' }]));
  const loadAll = async () => {
    try {
      const r = await get<{ rows: BalanceRow[] }>('/stock/balances' + qs({ warehouseId: wh }));
      setLines((ls) => {
        const have = new Set(ls.map((l) => l.item.id));
        return [...ls, ...r.rows.filter((x) => (x.perWarehouse[wh] ?? 0) > 0 && !have.has(x.item.id)).map((x) => ({ item: x.item, counted: '', reason: '' }))];
      });
    } catch (e: any) { setErr(e.message); }
  };

  const rows = lines.map((l) => {
    const sys = avail[l.item.id] ?? 0;
    const has = l.counted.trim() !== '';
    const diff = has ? Number(l.counted) - sys : 0;
    return { sys, has, diff, bad: has && !(Number(l.counted) >= 0), needReason: has && diff !== 0 && !l.reason.trim() };
  });
  const counted = rows.filter((r) => r.has).length;

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    if (!counted) return setErr('أدخل الرصيد الفعلي لصنف واحد على الأقل.');
    if (rows.some((r) => r.bad)) return setErr('الرصيد الفعلي لازم يكون صفر أو أكتر.');
    if (rows.some((r) => r.needReason)) return setErr('اكتب سبب الفرق لكل صنف فيه عجز أو زيادة.');
    setBusy(true);
    try {
      const res = await post<{ number: string; shortage: number; surplus: number }>('/stocktakes', {
        warehouseId: wh, date, notes: notes || undefined,
        lines: lines.filter((_, i) => rows[i].has).map((l) => ({ itemId: l.item.id, countedQty: Number(l.counted), reason: l.reason || undefined })),
      });
      toast(`تم تسجيل الجرد ${res.number} وتسوية الأرصدة`);
      nav('/reports/stocktakes?q=' + res.number, { replace: true });
    } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  };

  if (whs.loading && !whs.data) return <Loading />;
  return (
    <>
      <PageHead title="جرد المخزن" />
      <p className="muted" style={{ marginTop: -8 }}>أدخل الرصيد الفعلي، والنظام بيحسب الفرق ويسوّي الرصيد فورًا. الأصناف اللي ما اتجردتش بتتساب زي ما هي.</p>
      <form onSubmit={submit}>
        {err && <ErrorBox message={err} />}
        <div className="panel pad" style={{ marginBottom: 16 }}>
          <div className="grid3">
            <Field label="المخزن"><select value={wh} onChange={(e) => setWh(e.target.value)} required><option value="">اختر المخزن</option>{whs.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
            <Field label="تاريخ الجرد"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
            <Field label="ملاحظات"><input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
        </div>
        <div className="panel pad" style={{ marginBottom: 16 }}>
          <div className="toolbar" style={{ marginBottom: 8 }}>
            <div className="grow"><ItemPicker onPick={add} disabled={!wh} disabledHint="اختر المخزن أولاً" /></div>
            <button type="button" className="btn shrink" disabled={!wh} onClick={loadAll}>تحميل كل أصناف المخزن</button>
          </div>
          {lines.length === 0 ? <p className="muted">ابحث عن صنف أو اضغط "تحميل كل أصناف المخزن" لجرد المخزن كله.</p> : (
            <div className="table-wrap"><table className="doc-lines">
              <thead><tr><th>الصنف</th><th className="num">رصيد النظام</th><th style={{ width: 150 }}>الرصيد الفعلي</th><th className="num">الفرق</th><th>سبب الفرق</th><th /></tr></thead>
              <tbody>{lines.map((l, i) => (
                <tr key={l.item.id}>
                  <td>{l.item.name}<div className="muted">{l.item.code} · {l.item.unit}</div></td>
                  <td className="num">{fmt(rows[i].sys)}</td>
                  <td><input type="number" inputMode="decimal" min="0" step="any" value={l.counted} aria-label={'الرصيد الفعلي ' + l.item.name}
                    onChange={(e) => setLines((ls) => ls.map((x, k) => (k === i ? { ...x, counted: e.target.value } : x)))} /></td>
                  <td className="num">{rows[i].has ? (rows[i].diff === 0 ? <Badge kind="muted">مطابق</Badge> : <Badge kind={rows[i].diff < 0 ? 'out' : 'ok'}>{(rows[i].diff > 0 ? '+' : '') + fmt(rows[i].diff)}</Badge>) : ''}</td>
                  <td><input value={l.reason} placeholder={rows[i].has && rows[i].diff !== 0 ? 'مطلوب' : ''} aria-label={'سبب الفرق ' + l.item.name}
                    onChange={(e) => setLines((ls) => ls.map((x, k) => (k === i ? { ...x, reason: e.target.value } : x)))} />
                    {rows[i].needReason && <div className="over">اكتب السبب</div>}</td>
                  <td className="actions"><button type="button" className="icon-btn" aria-label="حذف السطر" onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}>✕</button></td>
                </tr>))}</tbody>
            </table></div>
          )}
        </div>
        <div className="form-actions">
          <button className="btn primary" disabled={busy || !counted}>{busy ? 'جاري الحفظ…' : `حفظ الجرد وتسوية الأرصدة (${counted})`}</button>
          <button type="button" className="btn" onClick={() => nav(-1)}>إلغاء</button>
        </div>
      </form>
    </>
  );
}
