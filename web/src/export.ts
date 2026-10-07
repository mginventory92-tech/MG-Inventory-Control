// تصدير احترافي: Excel حقيقي (.xlsx بتنسيق وRTL وطباعة جاهزة) وPDF (من نفس تصميم الطباعة، نص حقيقي مش صورة).
export const APP_NAME = 'MG Inventory Control';
export const APP_SUB = 'نظام المخازن';

export interface XlsxSpec {
  title: string;
  filters?: string[];
  tiles?: { label: string; text: string }[];
  headers: string[];
  numeric?: boolean[];            // هل العمود رقمي
  rows: (string | number | null | undefined)[][];
  user?: string;
  footnote?: string;
}

const BRAND = 'FF0E4A5A';
const WASH = 'FFE3EFF1';
const ZEBRA = 'FFF6F7F4';
const LINE = 'FFD8DCD4';
const FONT = 'Calibri';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const colLetter = (n: number) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const safeSheet = (t: string) => t.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
const stamp = () => {
  const d = new Date(); const p = (n: number) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
};
export const fileStamp = () => stamp().date;

export async function exportXlsx(spec: XlsxSpec) {
  const ExcelJS: any = (await import('exceljs')).default ?? (await import('exceljs'));
  const wb = new ExcelJS.Workbook();
  wb.creator = APP_NAME; wb.created = new Date(); wb.title = spec.title; wb.company = APP_NAME;
  const ws = wb.addWorksheet(safeSheet(spec.title), {
    views: [{ rightToLeft: true, showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: .4, right: .4, top: .7, bottom: .7, header: .3, footer: .3 } },
    headerFooter: { oddFooter: `&L&"${FONT},Regular"${APP_NAME}&R&P / &N`, oddHeader: `&C&"${FONT},Bold"${spec.title}` },
  });
  const n = Math.max(spec.headers.length, 4);
  const last = colLetter(n);
  const merge = (r: number) => ws.mergeCells(`A${r}:${last}${r}`);
  const st = stamp();
  let r = 1;

  // شريط العلامة
  merge(r); const c1 = ws.getCell(`A${r}`);
  c1.value = `${APP_NAME}  —  ${APP_SUB}`;
  c1.font = { name: FONT, size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  c1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
  c1.alignment = { horizontal: 'right', vertical: 'middle', readingOrder: 'rtl', indent: 1 };
  ws.getRow(r).height = 30; r++;

  merge(r); const c2 = ws.getCell(`A${r}`);
  c2.value = spec.title; c2.font = { name: FONT, size: 15, bold: true, color: { argb: BRAND } };
  c2.alignment = { horizontal: 'right', vertical: 'middle', readingOrder: 'rtl', indent: 1 };
  ws.getRow(r).height = 26; r++;

  const meta = [
    ...(spec.filters?.length ? [`الفلاتر: ${spec.filters.join('  •  ')}`] : []),
    `تاريخ التصدير: \u200E${st.date} ${st.time}\u200E${spec.user ? `   —   بواسطة: ${spec.user}` : ''}`,
  ];
  for (const m of meta) {
    merge(r); const c = ws.getCell(`A${r}`); c.value = m;
    c.font = { name: FONT, size: 10, color: { argb: 'FF5D6877' } };
    c.alignment = { horizontal: 'right', readingOrder: 'rtl', indent: 1, wrapText: true };
    r++;
  }
  r++;

  // الملخص
  if (spec.tiles?.length) {
    for (const t of spec.tiles) {
      const a = ws.getCell(`A${r}`); const b = ws.getCell(`B${r}`);
      ws.mergeCells(`B${r}:${last}${r}`);
      a.value = t.label; b.value = t.text;
      a.font = { name: FONT, size: 10, bold: true, color: { argb: BRAND } };
      b.font = { name: FONT, size: 11, bold: true };
      for (const c of [a, b]) {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WASH } };
        c.alignment = { horizontal: 'right', vertical: 'middle', readingOrder: 'rtl', wrapText: true, indent: 1 };
        c.border = { bottom: { style: 'thin', color: { argb: LINE } } };
      }
      ws.getRow(r).height = t.text.length > 55 ? 34 : 20;
      r++;
    }
    r++;
  }

  // الجدول
  const headRow = r;
  const hr = ws.getRow(r);
  spec.headers.forEach((h, i) => {
    const c = hr.getCell(i + 1); c.value = h;
    c.font = { name: FONT, size: 10.5, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, readingOrder: 'rtl' };
    c.border = { top: { style: 'thin', color: { argb: BRAND } }, bottom: { style: 'thin', color: { argb: BRAND } }, left: { style: 'thin', color: { argb: 'FFFFFFFF' } } };
  });
  hr.height = 30; r++;

  const widths = spec.headers.map((h) => Math.max(8, h.length * 1.25 + 2));
  spec.rows.forEach((row, ri) => {
    const xr = ws.getRow(r);
    spec.headers.forEach((_, i) => {
      let v: any = row[i]; const c = xr.getCell(i + 1);
      const isNum = !!spec.numeric?.[i] && typeof v === 'number';
      if (typeof v === 'string' && DATE_RE.test(v)) { const [y, m, d] = v.split('-').map(Number); v = new Date(Date.UTC(y, m - 1, d)); c.numFmt = 'yyyy-mm-dd'; }
      else if (isNum) c.numFmt = '#,##0.###;[Red]-#,##0.###;0';
      c.value = v === undefined || v === '' ? null : v;
      c.font = { name: FONT, size: 10.5 };
      c.alignment = { horizontal: isNum || v instanceof Date ? 'center' : 'right', vertical: 'middle', wrapText: true, readingOrder: 'rtl' };
      c.border = { bottom: { style: 'hair', color: { argb: LINE } } };
      if (ri % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
      const len = v instanceof Date ? 11 : String(v ?? '').length;
      widths[i] = Math.min(46, Math.max(widths[i], len * 1.15 + 2));
    });
    r++;
  });
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  if (spec.rows.length) ws.autoFilter = { from: { row: headRow, column: 1 }, to: { row: headRow + spec.rows.length, column: spec.headers.length } };
  ws.views = [{ rightToLeft: true, showGridLines: false, state: 'frozen', ySplit: headRow }];
  ws.pageSetup.printTitlesRow = `${headRow}:${headRow}`;

  r++;
  merge(r); const foot = ws.getCell(`A${r}`);
  foot.value = `${spec.rows.length} سطر${spec.footnote ? ' — ' + spec.footnote : ''}  |  ${APP_NAME}`;
  foot.font = { name: FONT, size: 9, italic: true, color: { argb: 'FF5D6877' } };
  foot.alignment = { horizontal: 'right', readingOrder: 'rtl', indent: 1 };

  const buf: ArrayBuffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${APP_NAME} - ${spec.title} - ${st.date}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** PDF: بنفتح معاينة الطباعة بنفس التصميم (A4 بالعرض، رأس بالاسم، أرقام صفحات) وباسم ملف جاهز.
 *  اختار "حفظ كـ PDF" كوجهة. النتيجة PDF بنص حقيقي ينفع يتنسخ ويتبحث فيه. */
export function exportPdf(title: string) {
  const prev = document.title;
  document.title = `${APP_NAME} - ${title} - ${stamp().date}`;
  const restore = () => { document.title = prev; window.removeEventListener('afterprint', restore); };
  window.addEventListener('afterprint', restore);
  window.print();
}
