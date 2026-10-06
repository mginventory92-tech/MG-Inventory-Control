// Integration test: renders the real UI against the live Supabase project and walks the main flow.
// بيضيف بيانات تجريبية فعلية، فمش بيشتغل إلا لما تضبط VITE_RUN_E2E=1 و VITE_TEST_PASSWORD=<باسورد admin>.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from '../src/App';
import { AuthProvider } from '../src/auth';
import { ToastProvider } from '../src/ui';

const run = Date.now().toString(36);
const mount = (path = '/') => render(
  <MemoryRouter initialEntries={[path]}><ToastProvider><AuthProvider><App /></AuthProvider></ToastProvider></MemoryRouter>);

afterEach(() => cleanup());

describe.skipIf(!import.meta.env.VITE_RUN_E2E)('warehouse UI against the real API', () => {
  const u = userEvent.setup();

  it('logs in, adds an item, receives stock, issues stock, blocks overdraft, shows balance', async () => {
    localStorage.clear();
    mount('/');
    // wrong password
    await u.type(await screen.findByLabelText('اسم المستخدم'), 'admin');
    await u.type(screen.getByLabelText('كلمة المرور'), 'bad');
    await u.click(screen.getByRole('button', { name: 'دخول' }));
    expect(await screen.findByText(/غير صحيحة/)).toBeTruthy();
    // correct
    await u.clear(screen.getByLabelText('كلمة المرور'));
    await u.type(screen.getByLabelText('كلمة المرور'), (import.meta.env.VITE_TEST_PASSWORD as string | undefined) || 'admin123');
    await u.click(screen.getByRole('button', { name: 'دخول' }));
    expect(await screen.findByText('أصناف تحتاج توريد')).toBeTruthy();
    cleanup();

    // add an item through the form
    mount('/items');
    await u.click(await screen.findByRole('button', { name: 'إضافة صنف' }));
    const dlg = await screen.findByRole('dialog');
    await u.type(within(dlg).getByLabelText('اسم الصنف'), 'لاصق سيراميك ' + run);
    await u.type(within(dlg).getByLabelText('الباركود'), 'UI' + run);
    const min = within(dlg).getByLabelText(/الحد الأدنى/);
    await u.clear(min); await u.type(min, '10');
    await u.click(within(dlg).getByRole('button', { name: 'حفظ' }));
    expect(await screen.findByText('لاصق سيراميك ' + run)).toBeTruthy();
    cleanup();

    // receipt: scan barcode (type + Enter) then quantity
    mount('/new/in');
    await u.selectOptions(await screen.findByLabelText('المخزن المستلم'), 'المخزن الرئيسي');
    const box = await screen.findByPlaceholderText('باركود / كود / اسم الصنف');
    await u.type(box, 'UI' + run + '{Enter}');
    const qty = await screen.findByLabelText('كمية لاصق سيراميك ' + run);
    await u.clear(qty); await u.type(qty, '25');
    await u.click(screen.getByRole('button', { name: /حفظ إذن إضافة/ }));
    expect(await screen.findByText(/IN-\d{5}/, {}, { timeout: 8000 })).toBeTruthy();
    cleanup();

    // issue 40 > 25 must be blocked in the UI
    mount('/new/out');
    const whSel = await screen.findByLabelText('المخزن المصروف منه');
    await u.selectOptions(whSel, 'المخزن الرئيسي');
    const box2 = await screen.findByPlaceholderText('باركود / كود / اسم الصنف');
    await u.type(box2, 'UI' + run + '{Enter}');
    const q2 = await screen.findByLabelText('كمية لاصق سيراميك ' + run);
    await u.clear(q2); await u.type(q2, '40');
    expect(await screen.findByText('أكبر من المتاح')).toBeTruthy();
    await u.click(screen.getByRole('button', { name: /حفظ إذن صرف/ }));
    expect(await screen.findByText(/أكبر من الرصيد المتاح/)).toBeTruthy();
    // fix quantity to 20 and save
    await u.clear(q2); await u.type(q2, '20');
    await u.click(screen.getByRole('button', { name: /حفظ إذن صرف/ }));
    expect(await screen.findByText(/OUT-\d{5}/, {}, { timeout: 8000 })).toBeTruthy();
    cleanup();

    // balances: 25 - 20 = 5, below min 10 -> flagged
    mount('/balances');
    const row = (await screen.findByText('لاصق سيراميك ' + run)).closest('tr')!;
    expect(within(row).getAllByText('5').length).toBeGreaterThanOrEqual(2); // warehouse column + total
    expect(within(row).getByText('تحت الحد')).toBeTruthy();
  });
});
