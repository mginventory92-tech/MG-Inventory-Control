// اختبارات عميل الـ API: بتتأكد إن الواجهة بتكلّم Supabase بالشكل المتفق عليه (من غير اتصال حقيقي).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, clearSession, hasSession, setUnauthorizedHandler, signIn } from '../src/api';

type Call = { url: string; init: RequestInit; body: any };
let calls: Call[];
let responder: (c: Call) => { status: number; data: any };

const json = (status: number, data: any) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const session = (expiresInMs: number) => localStorage.setItem('inv_session',
  JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_at: Date.now() + expiresInMs }));

beforeEach(() => {
  calls = [];
  responder = () => ({ status: 200, data: {} });
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const c: Call = { url, init, body: init?.body ? JSON.parse(init.body as string) : undefined };
    calls.push(c);
    const r = responder(c);
    return json(r.status, r.data);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); setUnauthorizedHandler(() => {}); });

describe('تسجيل الدخول', () => {
  it('بيحوّل اسم المستخدم لإيميل داخلي بحروف صغيرة ويحفظ الجلسة', async () => {
    responder = () => ({ status: 200, data: { access_token: 'A', refresh_token: 'R', expires_in: 3600 } });
    await signIn('  Ahmed ', 'secret1');
    expect(calls[0].url).toContain('/auth/v1/token?grant_type=password');
    expect(calls[0].body.email).toBe('ahmed@mginv.example.com');
    expect(hasSession()).toBe(true);
  });
  it('بيرجّع رسالة عربية واضحة لو البيانات غلط ومبيحفظش جلسة', async () => {
    responder = () => ({ status: 400, data: { error: 'invalid_grant' } });
    await expect(signIn('x', 'y')).rejects.toThrow('اسم المستخدم أو كلمة المرور غير صحيحة');
    expect(hasSession()).toBe(false);
  });
});

describe('استدعاءات الـ API', () => {
  it('GET بيتحوّل لاستدعاء الدالة public.api مع الـ query والتوكن', async () => {
    session(3_600_000);
    responder = () => ({ status: 200, data: [{ id: 1 }] });
    const out = await api('GET', '/items?q=سيراميك&all=true');
    expect(out).toEqual([{ id: 1 }]);
    const c = calls[0];
    expect(c.url).toMatch(/\/rest\/v1\/rpc\/api$/);
    expect((c.init.headers as any).authorization).toBe('Bearer AT');
    expect(c.body).toEqual({ p_method: 'GET', p_path: '/items', p_query: { q: 'سيراميك', all: 'true' }, p_body: {} });
  });
  it('كود الخطأ الحقيقي بيتاخد من hint (409 مثلًا) والرسالة العربية بتفضل زي ما هي', async () => {
    session(3_600_000);
    responder = () => ({ status: 400, data: { message: 'الباركود مستخدم', hint: '409' } });
    await expect(api('POST', '/items', { name: 'x' })).rejects.toMatchObject({ status: 409, message: 'الباركود مستخدم' });
  });
  it('لو التوكن قرّب يخلص بيجدّده الأول قبل الطلب', async () => {
    session(10_000);
    responder = (c) => c.url.includes('grant_type=refresh_token')
      ? { status: 200, data: { access_token: 'NEW', refresh_token: 'R2', expires_in: 3600 } }
      : { status: 200, data: {} };
    await api('GET', '/dashboard');
    expect(calls[0].url).toContain('grant_type=refresh_token');
    expect((calls[1].init.headers as any).authorization).toBe('Bearer NEW');
  });
  it('لو الجلسة انتهت وفشل التجديد: بيمسح الجلسة وينده معالج الخروج', async () => {
    session(3_600_000);
    const onOut = vi.fn(); setUnauthorizedHandler(onOut);
    responder = (c) => c.url.includes('grant_type=refresh_token') ? { status: 400, data: {} } : { status: 401, data: { message: 'JWT expired' } };
    await expect(api('GET', '/dashboard')).rejects.toMatchObject({ status: 401 });
    expect(onOut).toHaveBeenCalled();
    expect(hasSession()).toBe(false);
  });
  it('لو مفيش جلسة أصلًا بيرفض من غير ما يبعت طلب', async () => {
    clearSession();
    await expect(api('GET', '/items')).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(0);
  });
  it('لو النت مقطوع بيرجّع رسالة اتصال', async () => {
    session(3_600_000);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    await expect(api('GET', '/items')).rejects.toMatchObject({ status: 0 });
  });
});

describe('إدارة المستخدمين (دالة السيرفر)', () => {
  beforeEach(() => session(3_600_000));
  it('إنشاء', async () => {
    await api('POST', '/users', { name: 'م', username: 'm1', password: '123456', permissions: ['in'] });
    expect(calls[0].url).toMatch(/\/functions\/v1\/users$/);
    expect(calls[0].body).toMatchObject({ action: 'create', username: 'm1', permissions: ['in'] });
  });
  it('تعديل', async () => {
    await api('PATCH', '/users/abc', { isActive: false });
    expect(calls[0].body).toEqual({ action: 'update', id: 'abc', isActive: false });
  });
  it('حذف', async () => {
    await api('DELETE', '/users/abc');
    expect(calls[0].body).toEqual({ action: 'delete', id: 'abc' });
  });
  it('قراءة قايمة المستخدمين بتروح للـ API العادي مش الدالة', async () => {
    await api('GET', '/users');
    expect(calls[0].url).toMatch(/\/rest\/v1\/rpc\/api$/);
  });
});
