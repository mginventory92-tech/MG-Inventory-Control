const SB_URL = ((import.meta.env.VITE_SUPABASE_URL as string | undefined) || '').replace(/\/$/, '');
const SB_KEY = (import.meta.env.VITE_SUPABASE_KEY as string | undefined) || '';
const SESSION_KEY = 'inv_session';
const EMAIL_DOMAIN = 'mginv.example.com'; // لازم يتطابق مع DOMAIN في supabase/functions/users/index.ts

interface Session { access_token: string; refresh_token: string; expires_at: number }

const readSession = (): Session | null => {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
};
export const hasSession = () => !!readSession();
export const clearSession = () => localStorage.removeItem(SESSION_KEY);
const saveSession = (r: any) => {
  const s: Session = { access_token: r.access_token, refresh_token: r.refresh_token, expires_at: Date.now() + (r.expires_in ?? 3600) * 1000 };
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  return s;
};

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const NET_ERR = 'تعذّر الاتصال بالسيرفر. تأكد من الإنترنت.';
async function raw(url: string, init: RequestInit): Promise<{ status: number; data: any }> {
  let res: Response;
  try { res = await fetch(url, init); } catch { throw new ApiError(0, NET_ERR); }
  let data: any = null;
  try { data = await res.json(); } catch { /* empty body */ }
  return { status: res.status, data };
}
const baseHeaders = (token?: string): Record<string, string> => ({
  'content-type': 'application/json', apikey: SB_KEY, ...(token ? { authorization: 'Bearer ' + token } : {}),
});

/** تسجيل الدخول باسم المستخدم وكلمة المرور */
export async function signIn(username: string, password: string) {
  const email = `${username.trim().toLowerCase()}@${EMAIL_DOMAIN}`;
  const { status, data } = await raw(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: baseHeaders(), body: JSON.stringify({ email, password }),
  });
  if (status !== 200) throw new ApiError(status, 'اسم المستخدم أو كلمة المرور غير صحيحة');
  saveSession(data);
}

async function freshToken(force = false): Promise<string> {
  const s = readSession();
  if (!s) throw new ApiError(401, 'يجب تسجيل الدخول');
  if (!force && s.expires_at - Date.now() > 60_000) return s.access_token;
  const { status, data } = await raw(`${SB_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: baseHeaders(), body: JSON.stringify({ refresh_token: s.refresh_token }),
  });
  if (status !== 200) { clearSession(); throw new ApiError(401, 'انتهت الجلسة، سجّل الدخول من جديد'); }
  return saveSession(data).access_token;
}

async function authed(url: string, body: unknown): Promise<{ status: number; data: any }> {
  let token = await freshToken();
  let r = await raw(url, { method: 'POST', headers: baseHeaders(token), body: JSON.stringify(body) });
  if (r.status === 401) {
    token = await freshToken(true);
    r = await raw(url, { method: 'POST', headers: baseHeaders(token), body: JSON.stringify(body) });
  }
  return r;
}

function fromError(status: number, data: any): ApiError {
  // أخطاء الدوال: PostgREST بيرجع message + hint (كود الخطأ الأصلي)
  const code = Number(data?.hint) || status;
  return new ApiError(code, data?.message || data?.msg || 'حدث خطأ غير متوقع');
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    const [p, query = ''] = path.split('?');
    // تغيير كلمة المرور
    if (p === '/auth/password' && method === 'PATCH') {
      const { currentPassword, newPassword } = body as { currentPassword: string; newPassword: string };
      const me = await api<User>('GET', '/auth/me');
      const chk = await raw(`${SB_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: baseHeaders(),
        body: JSON.stringify({ email: `${me.username}@${EMAIL_DOMAIN}`, password: currentPassword }),
      });
      if (chk.status !== 200) throw new ApiError(400, 'كلمة المرور الحالية غير صحيحة');
      if (newPassword.length < 6) throw new ApiError(400, 'كلمة المرور لازم تكون 6 حروف على الأقل');
      const token = await freshToken();
      const up = await raw(`${SB_URL}/auth/v1/user`, { method: 'PUT', headers: baseHeaders(token), body: JSON.stringify({ password: newPassword }) });
      if (up.status !== 200) throw new ApiError(400, up.data?.msg || 'تعذّر تغيير كلمة المرور');
      saveSession(chk.data);
      return (await api('POST', '/auth/password-changed', {})) as T;
    }
    // إدارة المستخدمين (إنشاء / تعديل / حذف) بتمر على دالة السيرفر
    if (p.startsWith('/users') && method !== 'GET') {
      const id = p.split('/')[2];
      const payload = method === 'POST' ? { action: 'create', ...(body as object) }
        : method === 'PATCH' ? { action: 'update', id, ...(body as object) } : { action: 'delete', id };
      const r = await authed(`${SB_URL}/functions/v1/users`, payload);
      if (r.status >= 400) {
        if (r.status === 401) onUnauthorized();
        throw new ApiError(r.status, r.data?.message || 'حدث خطأ غير متوقع');
      }
      return r.data as T;
    }
    const q: Record<string, string> = {};
    new URLSearchParams(query).forEach((v, k) => (q[k] = v));
    const r = await authed(`${SB_URL}/rest/v1/rpc/api`, { p_method: method, p_path: p, p_query: q, p_body: body ?? {} });
    if (r.status >= 400) {
      const err = fromError(r.status, r.data);
      if (err.status === 401) onUnauthorized();
      throw err;
    }
    return r.data as T;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) { clearSession(); onUnauthorized(); }
    throw e;
  }
}
export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b?: unknown) => api<T>('POST', p, b ?? {});
export const patch = <T = any>(p: string, b?: unknown) => api<T>('PATCH', p, b ?? {});
export const del = <T = any>(p: string) => api<T>('DELETE', p);

export const qs = (o: Record<string, string | number | boolean | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? '?' + s : '';
};

/* ---------- types ---------- */
export type DocType = 'in' | 'out' | 'transfer';
export interface Project { id: string; name: string; code: string | null; notes: string | null; isActive: boolean }
export interface User { id: string; name: string; username: string; permissions: string[]; isActive: boolean; mustChangePassword: boolean }
export interface Warehouse { id: string; name: string; location: string | null; isActive: boolean }
export interface Item { id: string; code: string; name: string; barcode: string | null; category: string | null; unit: string; minQty: number; notes: string | null; isActive: boolean }
export interface Party { id: string; type: 'supplier' | 'customer'; name: string; phone: string | null; notes: string | null; isActive: boolean }
interface DocLine { id: string; itemId: string; qty: number; item: Item }
export interface StockDoc {
  id: string; number: string; type: DocType; date: string; reference: string | null; notes: string | null;
  fromWarehouse: Warehouse | null; toWarehouse: Warehouse | null; party: Party | null;
  project: Project | null; recipient: string | null; issueReason: string | null;
  createdBy: { id: string; name: string } | null; createdAt: string; lines: DocLine[];
}
export interface BalanceRow { item: Item; perWarehouse: Record<string, number>; total: number; qty: number; low: boolean }

// لازم تتطابق مع PERMISSIONS في supabase/functions/users/index.ts
export const PERMS: { key: string; label: string }[] = [
  { key: 'items', label: 'إدارة الأصناف' },
  { key: 'warehouses', label: 'إدارة المخازن' },
  { key: 'in', label: 'إذن إضافة' },
  { key: 'out', label: 'إذن صرف' },
  { key: 'transfer', label: 'تحويل بين المخازن' },
  { key: 'parties', label: 'الموردين والعملاء والمشاريع' },
  { key: 'reports', label: 'التقارير' },
  { key: 'stocktake', label: 'الجرد' },
  { key: 'users', label: 'المستخدمين والصلاحيات' },
];
export const DOC_LABEL: Record<DocType, string> = { in: 'إذن إضافة', out: 'إذن صرف', transfer: 'تحويل' };
export const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 }));
export const today = () => new Date().toISOString().slice(0, 10);

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob(['﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
