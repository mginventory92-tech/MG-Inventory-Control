import { useState, type FormEvent } from 'react';
import { patch } from '../api';
import { useAuth } from '../auth';
import { ErrorBox, Field, PageHead, useToast } from '../ui';

export default function Account() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    try {
      await patch('/auth/password', { currentPassword: cur, newPassword: next });
      setCur(''); setNext(''); toast('تم تغيير كلمة المرور'); await refresh();
    } catch (x: any) { setErr(x.message); }
  };
  return (
    <>
      <PageHead title="حسابي" />
      <div className="panel pad" style={{ maxWidth: 460 }}>
        <p><strong>{user?.name}</strong> <span className="muted">({user?.username})</span></p>
        <h3 style={{ margin: '16px 0 10px' }}>تغيير كلمة المرور</h3>
        <form onSubmit={submit}>
          {err && <ErrorBox message={err} />}
          <Field label="كلمة المرور الحالية"><input type="password" value={cur} onChange={(e) => setCur(e.target.value)} required autoComplete="current-password" /></Field>
          <Field label="كلمة المرور الجديدة" hint="6 حروف على الأقل"><input type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={6} autoComplete="new-password" /></Field>
          <button className="btn primary">حفظ</button>
        </form>
      </div>
    </>
  );
}
