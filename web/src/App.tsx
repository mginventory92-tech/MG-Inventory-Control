import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { Loading } from './ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Items from './pages/Items';
import Warehouses from './pages/Warehouses';
import Balances from './pages/Balances';
import NewDocument from './pages/NewDocument';
import Documents from './pages/Documents';
import Movements from './pages/Movements';
import Parties from './pages/Parties';
import UsersPage from './pages/Users';
import Account from './pages/Account';

const NAV: { to: string; label: string; perm?: string | string[]; group?: string }[] = [
  { to: '/', label: 'الرئيسية' },
  { to: '/balances', label: 'الأرصدة' },
  { to: '/items', label: 'الأصناف' },
  { to: '/new/in', label: 'إذن إضافة', perm: 'in', group: 'الحركات' },
  { to: '/new/out', label: 'إذن صرف', perm: 'out' },
  { to: '/new/transfer', label: 'تحويل بين المخازن', perm: 'transfer' },
  { to: '/documents', label: 'سجل الإذون', perm: ['reports', 'in', 'out', 'transfer'] },
  { to: '/movements', label: 'حركة الأصناف', perm: 'reports', group: 'التقارير' },
  { to: '/warehouses', label: 'المخازن', group: 'البيانات' },
  { to: '/parties', label: 'الموردين والعملاء' },
  { to: '/users', label: 'المستخدمين والصلاحيات', perm: 'users', group: 'الإدارة' },
  { to: '/account', label: 'حسابي' },
];

function Shell({ children }: { children: ReactNode }) {
  const { user, can, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const allowed = (p?: string | string[]) => !p || (Array.isArray(p) ? p.some(can) : can(p));

  return (
    <div className="shell">
      <div className="topbar noprint">
        <button onClick={() => setOpen(true)} aria-label="القائمة">☰</button>
        <strong>نظام المخازن</strong>
      </div>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={'side noprint' + (open ? ' open' : '')}>
        <div className="brand"><strong>نظام المخازن</strong><span>MG Matrial control</span></div>
        <nav className="nav">
          {NAV.filter((n) => allowed(n.perm)).map((n) => (
            <div key={n.to}>
              {n.group && <div className="group">{n.group}</div>}
              <NavLink to={n.to} end={n.to === '/'}>{n.label}</NavLink>
            </div>
          ))}
        </nav>
        <div className="side-foot">
          {user?.name}
          <br />
          <button className="btn small" onClick={logout}>تسجيل الخروج</button>
        </div>
      </aside>
      <main className="main">
        {user?.mustChangePassword && (
          <div className="warn-box noprint">
            <span>كلمة المرور الحالية افتراضية. غيّرها الآن لحماية البيانات.</span>
            <NavLink className="btn small" to="/account">تغيير كلمة المرور</NavLink>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

function Guard({ perm, children }: { perm?: string | string[]; children: ReactNode }) {
  const { can } = useAuth();
  const ok = !perm || (Array.isArray(perm) ? perm.some(can) : can(perm));
  return ok ? <>{children}</> : <div className="empty">ليس لديك صلاحية لفتح هذه الصفحة.</div>;
}

export default function App() {
  const { user, ready } = useAuth();
  if (!ready) return <Loading />;
  if (!user) return <Login />;
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/balances" element={<Balances />} />
        <Route path="/items" element={<Items />} />
        <Route path="/new/:type" element={<NewDocument />} />
        <Route path="/documents" element={<Guard perm={['reports', 'in', 'out', 'transfer']}><Documents /></Guard>} />
        <Route path="/movements" element={<Guard perm="reports"><Movements /></Guard>} />
        <Route path="/warehouses" element={<Warehouses />} />
        <Route path="/parties" element={<Parties />} />
        <Route path="/users" element={<Guard perm="users"><UsersPage /></Guard>} />
        <Route path="/account" element={<Account />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
