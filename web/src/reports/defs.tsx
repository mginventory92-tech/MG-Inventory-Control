import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { fmt } from '../api';
import { Badge } from '../ui';

export interface Meta {
  warehouses: { id: string; name: string }[]; categories: string[]; units: string[];
  projects: { id: string; name: string; code: string | null }[]; suppliers: { id: string; name: string }[]; users: { id: string; name: string }[];
}
export interface Filter {
  key: string; label: string; type: 'date' | 'meta' | 'item' | 'text' | 'enum';
  meta?: 'warehouses' | 'categories' | 'units' | 'projects' | 'suppliers' | 'users'; options?: [string, string][]; all?: string;
}
export interface Ctx { openDoc: (id: string) => void; params: Record<string, string> }
export interface Col { w?: number; h: string; v: (r: any) => string | number | null | undefined; cell?: (r: any, c: Ctx) => ReactNode; num?: boolean; nowrap?: boolean }
export interface Tile { label: string; value: ReactNode; tone?: 'warn' | 'bad' | 'ok'; wide?: boolean }
export interface Def {
  key: string; title: string; desc: string; filters: Filter[]; cols: Col[]; needItem?: boolean;
  tiles?: (d: any) => Tile[]; sortHint?: string;
}

const F = {
  from: { key: 'from', label: 'من تاريخ', type: 'date' } as Filter,
  to: { key: 'to', label: 'إلى تاريخ', type: 'date' } as Filter,
  warehouse: { key: 'warehouseId', label: 'المخزن', type: 'meta', meta: 'warehouses', all: 'كل المخازن' } as Filter,
  item: { key: 'itemId', label: 'الصنف', type: 'item' } as Filter,
  category: { key: 'category', label: 'التصنيف', type: 'meta', meta: 'categories', all: 'كل التصنيفات' } as Filter,
  unit: { key: 'unit', label: 'الوحدة', type: 'meta', meta: 'units', all: 'كل الوحدات' } as Filter,
  project: { key: 'projectId', label: 'المشروع', type: 'meta', meta: 'projects', all: 'كل المشاريع' } as Filter,
  user: { key: 'userId', label: 'المستخدم', type: 'meta', meta: 'users', all: 'كل المستخدمين' } as Filter,
  q: { key: 'q', label: 'بحث', type: 'text' } as Filter,
};

export const KIND_LABEL: Record<string, string> = {
  in: 'استلام', out: 'صرف', transfer_out: 'تحويل صادر', transfer_in: 'تحويل وارد', adjust: 'تسوية جرد',
};
const KIND_BADGE: Record<string, 'in' | 'out' | 'transfer' | 'low'> = { in: 'in', out: 'out', transfer_out: 'transfer', transfer_in: 'transfer', adjust: 'low' };
const STATUS_LABEL: Record<string, string> = { ok: 'طبيعي', low: 'منخفض', out: 'نافد' };
const STATUS_BADGE: Record<string, 'ok' | 'low' | 'out'> = { ok: 'ok', low: 'low', out: 'out' };
const DIFF_LABEL: Record<string, string> = { shortage: 'عجز', surplus: 'زيادة', match: 'مطابق' };
const DIFF_BADGE: Record<string, 'out' | 'ok' | 'muted'> = { shortage: 'out', surplus: 'ok', match: 'muted' };

export const timeOf = (ts?: string | null) => (ts ? new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
const signed = (n: number) => (n > 0 ? '+' : '') + fmt(n);

/** مجموع الكميات حسب الوحدة، من غير جمع وحدات مختلفة */
export function ByUnit({ list, sign }: { list: { unit: string; qty: number }[]; sign?: boolean }) {
  if (!list?.length) return <>—</>;
  return <>{list.map((u, i) => <Fragment key={u.unit}>{i > 0 && ' ، '}<span className="unit-chip"><b className="num">{sign ? signed(u.qty) : fmt(u.qty)}</b> {u.unit}</span></Fragment>)}</>;
}
const unitsText = (list: { unit: string; qty: number }[]) => list.map((u) => `${fmt(u.qty)} ${u.unit}`).join(' ، ');

const ledgerLink = (r: any, extra: Record<string, string | undefined> = {}) => {
  const p = new URLSearchParams({ itemId: r.itemId });
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  return '/reports/item-ledger?' + p.toString();
};
const ItemCell = ({ r, extra }: { r: any; extra?: Record<string, string | undefined> }) => (
  <><Link to={ledgerLink(r, extra)} className="rlink">{r.name}</Link><div className="muted">{r.code}</div></>
);
const DocBtn = ({ r, c }: { r: any; c: Ctx }) => (
  <button className="rlink btnlink" onClick={() => c.openDoc(r.docId)}>{r.number}</button>
);
const ProjLink = ({ r }: { r: any }) => (r.project ? <Link className="rlink" to={'/reports/project-usage?projectId=' + r.projectId}>{r.project}</Link> : <span className="muted">—</span>);

const unitTiles = (d: any): Tile[] => [{ label: 'إجمالي الكميات حسب الوحدة', value: <ByUnit list={d.summary.byUnit} />, wide: true }];

export const DEFS: Def[] = [
  {
    key: 'balances', title: 'أرصدة المخزون', desc: 'عندك كام من كل صنف في كل مخزن، مع رصيد أول المدة والوارد والمنصرف والتحويلات والتسويات.',
    filters: [F.warehouse, F.item, F.category, F.unit, { key: 'status', label: 'حالة المخزون', type: 'enum', options: [['ok', 'طبيعي'], ['low', 'منخفض'], ['out', 'نافد']], all: 'كل الحالات' }, F.from, { ...F.to, label: 'حتى تاريخ' }, F.q],
    tiles: (d) => [
      { label: 'إجمالي الأصناف', value: fmt(d.summary.items) },
      { label: 'منخفض', value: fmt(d.summary.low), tone: d.summary.low ? 'warn' : undefined },
      { label: 'نافد', value: fmt(d.summary.out), tone: d.summary.out ? 'bad' : undefined },
      ...unitTiles(d),
    ],
    cols: [
      { h: 'كود الصنف', v: (r) => r.code, nowrap: true },
      { w: 170, h: 'الصنف', v: (r) => r.name, cell: (r) => <Link className="rlink" to={ledgerLink(r, { warehouseId: r.warehouseId })}>{r.name}</Link> },
      { h: 'التصنيف', v: (r) => r.category },
      { h: 'الوحدة', v: (r) => r.unit },
      { w: 110, h: 'المخزن', v: (r) => r.warehouse },
      { h: 'رصيد أول المدة', v: (r) => r.opening, num: true },
      { h: 'الوارد', v: (r) => r.inQty, num: true },
      { h: 'المنصرف', v: (r) => r.outQty, num: true },
      { h: 'تحويل وارد', v: (r) => r.transferIn, num: true },
      { h: 'تحويل صادر', v: (r) => r.transferOut, num: true },
      { h: 'التسويات', v: (r) => r.adjust, num: true, cell: (r) => <span className={r.adjust < 0 ? 'over' : ''}>{r.adjust ? signed(r.adjust) : '0'}</span> },
      { h: 'الرصيد الحالي', v: (r) => r.closing, num: true, cell: (r) => <b>{fmt(r.closing)}</b> },
      { h: 'الحد الأدنى', v: (r) => r.minQty, num: true },
      { h: 'الحالة', v: (r) => STATUS_LABEL[r.status], cell: (r) => <Badge kind={STATUS_BADGE[r.status]}>{STATUS_LABEL[r.status]}</Badge> },
    ],
  },
  {
    key: 'item-ledger', title: 'حركة صنف', desc: 'كل اللي حصل على صنف معيّن: التاريخ، الإذن، الوارد، المنصرف، والرصيد بعد كل حركة.', needItem: true,
    filters: [F.item, F.warehouse, { key: 'kind', label: 'نوع الحركة', type: 'enum', options: [['in', 'استلام'], ['out', 'صرف'], ['transfer', 'تحويل'], ['adjust', 'تسوية جرد']], all: 'كل الأنواع' }, F.project, F.user, F.from, F.to],
    tiles: (d) => [
      { label: 'الصنف', value: <>{d.item.name} <span className="muted">({d.item.code})</span></>, wide: true },
      { label: 'رصيد أول المدة', value: `${fmt(d.opening)} ${d.item.unit}` },
      { label: 'إجمالي الوارد', value: `${fmt(d.summary.in)} ${d.item.unit}`, tone: 'ok' },
      { label: 'إجمالي المنصرف', value: `${fmt(d.summary.out)} ${d.item.unit}` },
      { label: 'الرصيد الختامي', value: `${fmt(d.closing)} ${d.item.unit}` },
    ],
    cols: [
      { h: 'التاريخ', v: (r) => r.date, nowrap: true },
      { h: 'الوقت', v: (r) => timeOf(r.createdAt), nowrap: true },
      { h: 'رقم الحركة', v: (r) => r.number, cell: (r, c) => (r.source === 'doc' ? <DocBtn r={{ ...r, docId: r.docId }} c={c} /> : <Link className="rlink" to={'/reports/stocktakes?q=' + r.number}>{r.number}</Link>), nowrap: true },
      { h: 'نوع الحركة', v: (r) => KIND_LABEL[r.kind], cell: (r) => <Badge kind={KIND_BADGE[r.kind]}>{KIND_LABEL[r.kind]}</Badge> },
      { h: 'المخزن', v: (r) => r.warehouse, cell: (r) => <>{r.warehouse}{r.otherWarehouse && <div className="muted">{r.kind === 'transfer_out' ? 'إلى' : 'من'} {r.otherWarehouse}</div>}</> },
      { h: 'الوارد', v: (r) => r.inQty, num: true, cell: (r) => (r.inQty ? fmt(r.inQty) : '') },
      { h: 'المنصرف', v: (r) => r.outQty, num: true, cell: (r) => (r.outQty ? fmt(r.outQty) : '') },
      { h: 'الرصيد بعد الحركة', v: (r) => r.balance, num: true, cell: (r) => <b>{fmt(r.balance)}</b> },
      { h: 'المشروع', v: (r) => r.project, cell: (r) => (r.project ? <Link className="rlink" to={'/reports/project-usage?projectId=' + r.projectId}>{r.project}</Link> : '') },
      { h: 'الجهة', v: (r) => r.party },
      { h: 'المستخدم', v: (r) => r.user },
      { h: 'المرجع', v: (r) => r.reference },
      { h: 'ملاحظات', v: (r) => r.notes },
    ],
  },
  {
    key: 'issues', title: 'المنصرفات', desc: 'اللي خرج من المخزن، لمين، وليه، وعلى أنهي مشروع.',
    filters: [F.from, F.to, F.warehouse, F.project, F.item, F.category, { key: 'recipient', label: 'المستلم', type: 'text' }, F.user, F.q],
    tiles: (d) => [{ label: 'عدد أذون الصرف', value: fmt(d.summary.docs) }, { label: 'عدد الأصناف', value: fmt(d.summary.items) }, ...unitTiles(d)],
    cols: [
      { h: 'رقم الإذن', v: (r) => r.number, cell: (r, c) => <DocBtn r={r} c={c} />, nowrap: true },
      { h: 'التاريخ', v: (r) => r.date, nowrap: true },
      { h: 'الوقت', v: (r) => timeOf(r.createdAt), nowrap: true },
      { w: 110, h: 'المخزن', v: (r) => r.warehouse },
      { w: 170, h: 'الصنف', v: (r) => r.name, cell: (r) => <ItemCell r={r} />, },
      { h: 'التصنيف', v: (r) => r.category },
      { h: 'الوحدة', v: (r) => r.unit },
      { h: 'الكمية', v: (r) => r.qty, num: true, cell: (r) => <b>{fmt(r.qty)}</b> },
      { h: 'المستلم', v: (r) => r.recipient },
      { h: 'الجهة', v: (r) => r.party },
      { h: 'المشروع', v: (r) => r.project, cell: (r) => <ProjLink r={r} /> },
      { h: 'سبب الصرف', v: (r) => r.reason },
      { h: 'المستخدم', v: (r) => r.user },
    ],
  },
  {
    key: 'receipts', title: 'الواردات / الاستلام', desc: 'اللي دخل المخزن، منين، وإمتى.',
    filters: [F.from, F.to, F.warehouse, { key: 'partyId', label: 'المورد', type: 'meta', meta: 'suppliers', all: 'كل الموردين' }, F.item, F.category, F.user, F.q],
    tiles: (d) => [{ label: 'عدد أذون الاستلام', value: fmt(d.summary.docs) }, { label: 'عدد الأصناف', value: fmt(d.summary.items) }, ...unitTiles(d)],
    cols: [
      { h: 'رقم إذن الاستلام', v: (r) => r.number, cell: (r, c) => <DocBtn r={r} c={c} />, nowrap: true },
      { h: 'التاريخ', v: (r) => r.date, nowrap: true },
      { w: 110, h: 'المخزن', v: (r) => r.warehouse },
      { h: 'المورد / المصدر', v: (r) => r.party },
      { h: 'رقم الفاتورة / المستند', v: (r) => r.reference },
      { w: 170, h: 'الصنف', v: (r) => r.name, cell: (r) => <ItemCell r={r} /> },
      { h: 'التصنيف', v: (r) => r.category },
      { h: 'الوحدة', v: (r) => r.unit },
      { h: 'الكمية', v: (r) => r.qty, num: true, cell: (r) => <b>{fmt(r.qty)}</b> },
      { h: 'المستخدم', v: (r) => r.user },
      { h: 'ملاحظات', v: (r) => r.notes },
    ],
  },
  {
    key: 'transfers', title: 'التحويلات', desc: 'اللي اتحرك من مخزن لمخزن، بوضوح من → إلى.',
    filters: [F.from, F.to, { key: 'fromWarehouseId', label: 'من مخزن', type: 'meta', meta: 'warehouses', all: 'أي مخزن' }, { key: 'toWarehouseId', label: 'إلى مخزن', type: 'meta', meta: 'warehouses', all: 'أي مخزن' }, F.item, F.category, F.user, F.q],
    tiles: (d) => [{ label: 'عدد التحويلات', value: fmt(d.summary.docs) }, { label: 'عدد الأصناف', value: fmt(d.summary.items) }, ...unitTiles(d)],
    cols: [
      { h: 'رقم التحويل', v: (r) => r.number, cell: (r, c) => <DocBtn r={r} c={c} />, nowrap: true },
      { h: 'التاريخ', v: (r) => r.date, nowrap: true },
      { h: 'من مخزن ← إلى مخزن', v: (r) => `${r.fromWarehouse} ← ${r.toWarehouse}`, cell: (r) => <span className="route"><b>{r.fromWarehouse}</b><span className="arrow" aria-hidden>←</span><b>{r.toWarehouse}</b></span> },
      { w: 170, h: 'الصنف', v: (r) => r.name, cell: (r) => <ItemCell r={r} /> },
      { h: 'الكمية', v: (r) => r.qty, num: true, cell: (r) => <b>{fmt(r.qty)}</b> },
      { h: 'الوحدة', v: (r) => r.unit },
      { h: 'المستخدم', v: (r) => r.user },
      { h: 'الحالة', v: () => 'تم الاستلام', cell: () => <Badge kind="ok">تم الاستلام</Badge> },
      { h: 'تاريخ الاستلام', v: (r) => r.receivedDate, nowrap: true },
      { h: 'ملاحظات', v: (r) => r.notes },
    ],
  },
  {
    key: 'project-usage', title: 'المواد المصروفة على المشاريع', desc: 'المشروع استهلك إيه من المخازن، وكام مرة اتصرف له.',
    filters: [F.project, F.from, F.to, F.warehouse, F.category, F.item],
    tiles: (d) => [
      { label: 'أذون الصرف', value: fmt(d.summary.docs) }, { label: 'عدد الأصناف', value: fmt(d.summary.items) }, { label: 'عدد المشاريع', value: fmt(d.summary.projects) },
      { label: 'أذون صرف بدون مشروع', value: fmt(d.summary.unassignedDocs), tone: d.summary.unassignedDocs ? 'warn' : undefined },
      {
        label: 'أكتر الأصناف صرفًا (بعدد المرات)', wide: true,
        value: d.summary.top.length ? <>{d.summary.top.map((t: any, i: number) => <Fragment key={i}>{i > 0 && ' ، '}<span className="unit-chip">{t.name} <b className="num">{t.times}×</b></span></Fragment>)}</> : '—',
      },
    ],
    cols: [
      { h: 'المشروع', v: (r) => r.project, cell: (r) => <Link className="rlink" to={'/reports/project-usage?projectId=' + r.projectId}>{r.project}</Link> },
      { w: 170, h: 'الصنف', v: (r) => r.name, cell: (r) => <ItemCell r={r} extra={{ projectId: r.projectId, kind: 'out' }} /> },
      { h: 'التصنيف', v: (r) => r.category },
      { h: 'الوحدة', v: (r) => r.unit },
      { h: 'الكمية', v: (r) => r.qty, num: true, cell: (r) => <b>{fmt(r.qty)}</b> },
      { w: 110, h: 'المخزن', v: (r) => r.warehouse },
      { h: 'عدد مرات الصرف', v: (r) => r.times, num: true },
      { h: 'آخر صرف', v: (r) => r.lastDate, nowrap: true },
    ],
  },
  {
    key: 'stocktakes', title: 'الجرد وفروقات الجرد', desc: 'رصيد النظام مقابل الرصيد الفعلي، ونوع الفرق وسببه.',
    filters: [F.from, F.to, F.warehouse, F.item, F.category, { key: 'status', label: 'نوع الفرق', type: 'enum', options: [['shortage', 'عجز'], ['surplus', 'زيادة'], ['match', 'مطابق']], all: 'كل الأنواع' }, F.user, F.q],
    tiles: (d) => [
      { label: 'عدد عمليات الجرد', value: fmt(d.summary.counts) },
      { label: 'أصناف فيها عجز', value: fmt(d.summary.shortage), tone: d.summary.shortage ? 'bad' : undefined },
      { label: 'أصناف فيها زيادة', value: fmt(d.summary.surplus), tone: d.summary.surplus ? 'ok' : undefined },
      { label: 'مطابق', value: fmt(d.summary.match) },
      { label: 'صافي الفرق حسب الوحدة', value: <ByUnit list={d.summary.byUnit} sign />, wide: true },
    ],
    cols: [
      { h: 'رقم الجرد', v: (r) => r.number, nowrap: true },
      { h: 'التاريخ', v: (r) => r.date, nowrap: true },
      { w: 110, h: 'المخزن', v: (r) => r.warehouse },
      { w: 170, h: 'الصنف', v: (r) => r.name, cell: (r) => <ItemCell r={r} /> },
      { h: 'الوحدة', v: (r) => r.unit },
      { h: 'رصيد النظام', v: (r) => r.systemQty, num: true },
      { h: 'الرصيد الفعلي', v: (r) => r.countedQty, num: true },
      { h: 'الفرق', v: (r) => r.diff, num: true, cell: (r) => <b className={r.diff < 0 ? 'over' : r.diff > 0 ? 'good' : ''}>{r.diff ? signed(r.diff) : '0'}</b> },
      { h: 'نوع الفرق', v: (r) => DIFF_LABEL[r.diffType], cell: (r) => <Badge kind={DIFF_BADGE[r.diffType]}>{DIFF_LABEL[r.diffType]}</Badge> },
      { h: 'سبب الفرق', v: (r) => r.reason },
      { h: 'حالة التسوية', v: () => 'تمت التسوية' },
      { h: 'المستخدم', v: (r) => r.user },
    ],
  },
  {
    key: 'low-stock', title: 'الأصناف منخفضة / نافدة المخزون', desc: 'إيه اللي محتاج توفير دلوقتي.',
    filters: [F.warehouse, F.category, F.item, { key: 'status', label: 'الحالة', type: 'enum', options: [['out', 'نافد'], ['low', 'منخفض']], all: 'نافد ومنخفض' }, F.q],
    tiles: (d) => [{ label: 'نافد', value: fmt(d.summary.out), tone: d.summary.out ? 'bad' : undefined }, { label: 'منخفض', value: fmt(d.summary.low), tone: d.summary.low ? 'warn' : undefined }],
    cols: [
      { w: 170, h: 'الصنف', v: (r) => r.name, cell: (r) => <ItemCell r={r} /> },
      { h: 'المخزن', v: (r) => r.warehouse ?? 'لم يُستلم بعد' },
      { h: 'الوحدة', v: (r) => r.unit },
      { h: 'الرصيد الحالي', v: (r) => r.balance, num: true, cell: (r) => <b>{fmt(r.balance)}</b> },
      { h: 'الحد الأدنى', v: (r) => r.minQty, num: true },
      { h: 'الفرق عن الحد الأدنى', v: (r) => r.gap, num: true, cell: (r) => <span className="over">{fmt(r.gap)}</span> },
      { h: 'الحالة', v: (r) => STATUS_LABEL[r.status], cell: (r) => <Badge kind={STATUS_BADGE[r.status]}>{STATUS_LABEL[r.status]}</Badge> },
      { h: 'آخر دخول', v: (r) => r.lastIn, nowrap: true },
      { h: 'آخر صرف', v: (r) => r.lastOut, nowrap: true },
      { h: 'تاريخ آخر حركة', v: (r) => r.lastMove, nowrap: true },
    ],
  },
];
export const DEF_BY_KEY = Object.fromEntries(DEFS.map((d) => [d.key, d])) as Record<string, Def>;
export { unitsText };
