import { useState, type FormEvent } from 'react';
import { del, get, patch, post, PERMS, type User } from '../api';
import { useAuth } from '../auth';
import { Badge, ErrorBox, Field, Loading, Modal, PageHead, useConfirm, useLoad, useToast } from '../ui';

export default function UsersPage() {
  const { user: me } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => get<User[]>('/users'));
  const [edit, setEdit] = useState<Partial<User> | null>(null);
  const confirm = useConfirm();
  const label = (k: string) => PERMS.find((p) => p.key === k)?.label ?? k;

  const remove = (u: User) => confirm.ask(`حذف المستخدم "${u.name}"؟`, async () => {
    try { await del('/users/' + u.id); toast('تم حذف المستخدم'); reload(); } catch (e: any) { toast(e.message, 'err'); }
  });

  return (
    <>
      <PageHead title="المستخدمين والصلاحيات"><button className="btn primary" onClick={() => setEdit({})}>إضافة مستخدم</button></PageHead>
      {error && <ErrorBox message={error} retry={reload} />}
      {loading && !data ? <Loading /> : (
        <div className="panel table-wrap">
          <table>
            <thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>الصلاحيات</th><th>الحالة</th><th /></tr></thead>
            <tbody>{data?.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td><td className="nowrap">{u.username}</td>
                <td>{u.permissions.map(label).join('، ') || <span className="muted">عرض الأرصدة فقط</span>}</td>
                <td><Badge kind={u.isActive ? 'ok' : 'muted'}>{u.isActive ? 'مفعّل' : 'معطّل'}</Badge></td>
                <td className="actions">
                  <button className="btn small" onClick={() => setEdit(u)}>تعديل</button>{' '}
                  {u.id !== me?.id && <button className="btn small ghost" onClick={() => remove(u)}>حذف</button>}
                </td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {edit && <UserForm u={edit} self={edit.id === me?.id} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {confirm.node}
    </>
  );
}

function UserForm({ u, self, onClose, onSaved }: { u: Partial<User>; self: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: u.name ?? '', username: u.username ?? '', password: '', isActive: u.isActive ?? true });
  const [perms, setPerms] = useState<string[]>(u.permissions ?? ['in', 'out']);
  const [err, setErr] = useState('');
  const toggle = (k: string) => setPerms((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    try {
      if (u.id) await patch('/users/' + u.id, { name: f.name, permissions: perms, isActive: f.isActive, ...(f.password ? { password: f.password } : {}) });
      else await post('/users', { name: f.name, username: f.username, password: f.password, permissions: perms });
      toast('تم حفظ المستخدم'); onSaved();
    } catch (x: any) { setErr(x.message); }
  };
  return (
    <Modal title={u.id ? 'تعديل مستخدم' : 'إضافة مستخدم'} onClose={onClose}>
      <form onSubmit={submit}>
        {err && <ErrorBox message={err} />}
        <div className="grid2">
          <Field label="الاسم"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus /></Field>
          <Field label="اسم المستخدم"><input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required disabled={!!u.id} autoCapitalize="none" /></Field>
        </div>
        <Field label={u.id ? 'كلمة مرور جديدة' : 'كلمة المرور'} hint={u.id ? 'اتركها فارغة لو مش عايز تغيّرها' : '6 حروف على الأقل'}>
          <input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required={!u.id} minLength={6} autoComplete="new-password" />
        </Field>
        <Field label="الصلاحيات" hint="أي مستخدم يقدر يشوف الأصناف والأرصدة. الصلاحيات دي بتضيف عليها.">
          <div className="perm-grid">
            {PERMS.map((p) => (
              <label key={p.key} className="check">
                <input type="checkbox" checked={perms.includes(p.key)} onChange={() => toggle(p.key)} disabled={self && p.key === 'users'} />{p.label}
              </label>))}
          </div>
        </Field>
        {u.id && !self && <label className="check"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />الحساب مفعّل</label>}
        <div className="form-actions"><button className="btn primary">حفظ</button><button type="button" className="btn" onClick={onClose}>إلغاء</button></div>
      </form>
    </Modal>
  );
}
