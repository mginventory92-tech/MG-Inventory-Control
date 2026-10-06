import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth';
import { Field } from '../ui';

export default function Login() {
  const { login } = useAuth();
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await login(username, password); } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <h1>نظام المخازن</h1>
        <p>سجّل الدخول للمتابعة</p>
        {err && <div className="error-box" role="alert">{err}</div>}
        <Field label="اسم المستخدم"><input value={username} onChange={(e) => setU(e.target.value)} autoFocus autoComplete="username" required /></Field>
        <Field label="كلمة المرور"><input type="password" value={password} onChange={(e) => setP(e.target.value)} autoComplete="current-password" required /></Field>
        <button className="btn primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'جاري الدخول…' : 'دخول'}</button>
      </form>
    </div>
  );
}
