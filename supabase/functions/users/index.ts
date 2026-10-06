// Edge Function: إدارة المستخدمين (إنشاء / تعديل / حذف). تشتغل بصلاحية service role،
// وبتتأكد الأول إن المتصل عنده صلاحية "users".
import { createClient } from 'npm:@supabase/supabase-js@2';

const PERMISSIONS = ['items', 'warehouses', 'in', 'out', 'transfer', 'parties', 'reports', 'users'];
const DOMAIN = 'mginv.example.com';
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });
const fail = (status: number, message: string) => reply(status, { message });

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const userJson = (u: any) => ({
  id: u.id, name: u.name, username: u.username, permissions: u.permissions,
  isActive: u.is_active, mustChangePassword: u.must_change_password, createdAt: u.created_at,
});
const cleanPerms = (p: unknown) =>
  Array.isArray(p) && p.every((x) => PERMISSIONS.includes(x)) ? [...new Set(p as string[])] : null;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return fail(405, 'غير مسموح');

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: au } = await admin.auth.getUser(token);
  if (!au?.user) return fail(401, 'يجب تسجيل الدخول');
  const { data: me } = await admin.from('profiles').select('*').eq('id', au.user.id).eq('is_active', true).maybeSingle();
  if (!me) return fail(401, 'يجب تسجيل الدخول');
  if (!me.permissions.includes('users')) return fail(403, 'ليس لديك صلاحية لتنفيذ هذا الإجراء');

  let b: any;
  try { b = await req.json(); } catch { return fail(400, 'بيانات غير صالحة'); }

  if (b.action === 'create') {
    const name = String(b.name ?? '').trim();
    const username = String(b.username ?? '').trim().toLowerCase();
    const password = String(b.password ?? '');
    const permissions = cleanPerms(b.permissions);
    if (!name) return fail(400, 'الاسم مطلوب');
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) return fail(400, 'اسم المستخدم حروف إنجليزية صغيرة وأرقام فقط (3 أحرف على الأقل)');
    if (password.length < 6) return fail(400, 'كلمة المرور لازم تكون 6 حروف على الأقل');
    if (!permissions) return fail(400, 'صلاحيات غير صالحة');
    const { data: dup } = await admin.from('profiles').select('id').eq('username', username).maybeSingle();
    if (dup) return fail(409, 'اسم المستخدم موجود بالفعل');
    const { data: created, error } = await admin.auth.admin.createUser({
      email: `${username}@${DOMAIN}`, password, email_confirm: true,
    });
    if (error || !created.user) return fail(400, 'تعذّر إنشاء المستخدم: ' + (error?.message ?? ''));
    const { data: prof, error: e2 } = await admin.from('profiles')
      .insert({ id: created.user.id, name, username, permissions, must_change_password: false }).select().single();
    if (e2) { await admin.auth.admin.deleteUser(created.user.id); return fail(400, 'تعذّر إنشاء المستخدم'); }
    return reply(200, userJson(prof));
  }

  if (b.action === 'update') {
    const { data: u } = await admin.from('profiles').select('*').eq('id', String(b.id)).maybeSingle();
    if (!u) return fail(404, 'المستخدم غير موجود');
    const patch: Record<string, unknown> = {};
    if (u.id === me.id) {
      if (b.isActive === false) return fail(400, 'لا يمكنك تعطيل حسابك بنفسك');
      if (b.permissions && !b.permissions.includes('users')) return fail(400, 'لا يمكنك إزالة صلاحية إدارة المستخدمين من حسابك');
    }
    if (b.name !== undefined) {
      if (!String(b.name).trim()) return fail(400, 'الاسم مطلوب');
      patch.name = String(b.name).trim();
    }
    if (b.permissions !== undefined) {
      const p = cleanPerms(b.permissions);
      if (!p) return fail(400, 'صلاحيات غير صالحة');
      patch.permissions = p;
    }
    if (b.isActive !== undefined) patch.is_active = !!b.isActive;
    if (b.password) {
      if (String(b.password).length < 6) return fail(400, 'كلمة المرور لازم تكون 6 حروف على الأقل');
      const { error } = await admin.auth.admin.updateUserById(u.id, { password: String(b.password) });
      if (error) return fail(400, 'تعذّر تغيير كلمة المرور');
      patch.must_change_password = false;
    }
    if (Object.keys(patch).length) {
      const { error } = await admin.from('profiles').update(patch).eq('id', u.id);
      if (error) return fail(400, 'تعذّر الحفظ');
    }
    const { data: after } = await admin.from('profiles').select('*').eq('id', u.id).single();
    return reply(200, userJson(after));
  }

  if (b.action === 'delete') {
    const id = String(b.id ?? '');
    if (id === me.id) return fail(400, 'لا يمكنك حذف حسابك بنفسك');
    const { data: u } = await admin.from('profiles').select('id').eq('id', id).maybeSingle();
    if (!u) return fail(404, 'المستخدم غير موجود');
    const { count } = await admin.from('stock_documents').select('id', { count: 'exact', head: true }).eq('created_by', id);
    if (count) return fail(409, 'المستخدم له حركات مسجلة، عطّل الحساب بدل الحذف');
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) return fail(400, 'تعذّر الحذف');
    return reply(200, { ok: true });
  }

  return fail(404, 'غير موجود');
});
