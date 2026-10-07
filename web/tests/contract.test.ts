// اختبارات الاتفاق بين أجزاء النظام الثلاثة (الواجهة، SQL، دالة المستخدمين).
// لو حد غيّر حاجة في مكان ونسي التاني، الاختبار هنا بيفشل قبل ما تتنشر.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PERMS } from '../src/api';
import { DEFS } from '../src/reports/defs';

const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf-8');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const edge = read('supabase/functions/users/index.ts');
const migrations = readdirSync(join(root, 'supabase/migrations')).sort().map((f) => read('supabase/migrations/' + f));
const sql = migrations.join('\n');
// آخر تعريف فعلي لدالة public.api (الملف الأحدث هو اللي بيكسب)
const lastApi = migrations.reduce((acc, m) => {
  const i = m.indexOf('create or replace function public.api');
  return i >= 0 ? m.slice(i) : acc;
}, '');

describe('تطابق الأجزاء', () => {
  it('قايمة الصلاحيات في الواجهة = قايمة دالة المستخدمين', () => {
    const inEdge = [...edge.match(/PERMISSIONS = \[([^\]]+)\]/)![1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(PERMS.map((p) => p.key).sort()).toEqual(inEdge.sort());
  });
  it('دومين الإيميل الداخلي واحد في الواجهة ودالة المستخدمين', () => {
    const web = read('web/src/api.ts').match(/EMAIL_DOMAIN = '([^']+)'/)![1];
    expect(edge.match(/DOMAIN = '([^']+)'/)![1]).toBe(web);
  });
  it('كل مسار بتناديه الواجهة موجود في راوتر SQL', () => {
    const used = new Set<string>();
    for (const f of walk(join(root, 'web/src')).filter((x) => /\.tsx?$/.test(x))) {
      for (const m of readFileSync(f, 'utf-8').matchAll(/\b(?:get|post|patch|del|api)(?:<[^>]*>)?\(\s*(?:'[A-Z]+',\s*)?['`]\/([a-z-]+)/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(5);
    for (const route of used) {
      if (route === 'users') continue; // الكتابة بتروح لدالة المستخدمين، والقراءة اتفحصت تحت
      expect(lastApi, `المسار /${route} مش موجود في آخر تعريف لدالة api`).toMatch(new RegExp(`r = '${route}'`));
    }
    expect(lastApi).toMatch(/r = 'users' and p_method = 'GET'/);
  });
  it('كل صلاحية في الواجهة مستخدمة فعلًا في SQL أو الواجهة', () => {
    for (const { key } of PERMS) expect(sql + read('web/src/App.tsx')).toContain(`'${key}'`);
  });
});

describe('سجل الـ migrations', () => {
  const files = readdirSync(join(root, 'supabase/migrations')).sort();
  it('الأرقام متتالية من 001 من غير فجوات', () => {
    files.forEach((f, i) => expect(f.startsWith(String(i + 1).padStart(3, '0') + '_'), f).toBe(true));
  });
  it('الجداول مقفولة: RLS مفعّل وصلاحيات anon/authenticated مسحوبة', () => {
    expect(sql).toMatch(/revoke all on all tables in schema public from anon, authenticated/);
    const tables = [...sql.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
    for (const t of tables) expect(sql, t).toMatch(new RegExp(`alter table public\\.${t} enable row level security`));
  });
  it('كل جدول بعد 001 اتسحبت صلاحياته صراحة من anon/authenticated', () => {
    const later = migrations.slice(1).join('\n');
    for (const t of [...later.matchAll(/create table public\.(\w+)/g)].map((m) => m[1])) {
      expect(later, t).toMatch(new RegExp(`revoke all on [^;]*public\\.${t}\\b[^;]*from anon, authenticated`));
    }
  });
  it('دالة public.api بس هي المسموحة للمستخدمين المسجّلين، ومسحوبة من anon', () => {
    expect(sql).toMatch(/revoke all on function public\.api\(text,text,jsonb,jsonb\) from public, anon/);
    expect(sql).toMatch(/grant execute on function public\.api\(text,text,jsonb,jsonb\) to authenticated/);
  });
});

describe('التقارير', () => {
  const rep = migrations.filter((m) => m.includes('function private.r_reports')).pop() ?? '';
  it('كل تقرير في الواجهة له فرع في r_reports', () => {
    expect(DEFS.length).toBe(8);
    for (const d of DEFS) expect(rep, d.key).toMatch(new RegExp(`rep (=|in \\([^)]*) *'${d.key}'`));
    expect(rep).toMatch(/rep = 'meta'/);
  });
  it('فلاتر كل تقرير هي نفس المعاملات اللي بيقراها SQL', () => {
    const known = new Set([...rep.matchAll(/q->>'(\w+)'/g)].map((m) => m[1]));
    for (const d of DEFS) for (const f of d.filters) expect(known.has(f.key), `${d.key}.${f.key}`).toBe(true);
  });
  it('الراوتر فيه المشاريع والجرد والتقارير', () => {
    for (const r of ['projects', 'stocktakes', 'reports']) expect(lastApi).toMatch(new RegExp(`r = '${r}'`));
  });
});

describe('الثيم (فاتح/داكن)', () => {
  const css = read('web/src/styles.css');
  const tokens = (block: string) => [...block.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]).sort();
  const light = css.slice(css.indexOf(":root, :root[data-theme='light']"), css.indexOf(":root[data-theme='dark']"));
  const dark = css.slice(css.indexOf(":root[data-theme='dark']"), css.indexOf('@media (prefers-color-scheme: dark)'));
  const auto = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'), css.indexOf('/* الطباعة دايمًا فاتحة'));
  it('الداكن بيعرّف نفس ألوان الفاتح بالظبط (مفيش لون ناقص)', () => {
    const colorVars = (t: string[]) => t.filter((x) => x !== '--radius' && x !== '--font');
    expect(colorVars(tokens(dark))).toEqual(colorVars(tokens(light)));
    expect(colorVars(tokens(auto))).toEqual(colorVars(tokens(light)));
  });
  it('مفيش لون مكتوب مباشر برّه الـ tokens (علشان أي حاجة جديدة تلبس الداكن تلقائي)', () => {
    const rest = css.replace(/^\s*--[\w-]+:.*$/gm, '');
    expect(rest.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) ?? []).toEqual([]);
    for (const f of walk(join(root, 'web/src')).filter((x) => /\.tsx$/.test(x))) {
      expect(readFileSync(f, 'utf-8').match(/#[0-9a-fA-F]{6}\b|rgba?\(/g) ?? [], f).toEqual([]);
    }
  });
  it('الطباعة بترجع للفاتح', () => {
    expect(css).toMatch(/@media print \{\s*:root, :root\[data-theme\]/);
  });
});
