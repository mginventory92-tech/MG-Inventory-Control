// End-to-end test against a running API. Usage: API=http://localhost:3000/api node scripts/e2e.mjs
const API = process.env.API || 'http://localhost:3000/api';
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };
async function call(method, path, body, token) {
  const r = await fetch(API + path, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
const run = Date.now().toString(36);

// auth
let r = await call('POST', '/auth/login', { username: 'admin', password: 'wrong' });
ok(r.status === 401, 'login with wrong password is rejected');
r = await call('GET', '/items');
ok(r.status === 401, 'no token -> 401');
r = await call('POST', '/auth/login', { username: 'admin', password: process.env.ADMIN_PASSWORD || 'admin123' });
ok(r.status === 201 && r.data.token, 'admin login');
const T = r.data.token;

// warehouses
r = await call('GET', '/warehouses', null, T);
const main = r.data[0];
ok(main?.name === 'المخزن الرئيسي', 'default warehouse seeded');
r = await call('POST', '/warehouses', { name: 'مخزن الموقع ' + run }, T);
ok(r.status === 201, 'create warehouse');
const site = r.data;
r = await call('POST', '/warehouses', { name: site.name }, T);
ok(r.status === 409, 'duplicate warehouse name -> 409');

// items
r = await call('POST', '/items', { name: 'دهان أبيض ' + run, barcode: 'BC' + run, unit: 'جركن', minQty: 5, category: 'دهانات' }, T);
ok(r.status === 201 && /^ITM-\d{4}$/.test(r.data.code), 'create item with auto code', JSON.stringify(r.data));
const paint = r.data;
r = await call('POST', '/items', { name: 'سيراميك ' + run, barcode: 'BC' + run }, T);
ok(r.status === 409, 'duplicate barcode -> 409');
r = await call('POST', '/items', { name: 'سيراميك ' + run, unit: 'متر', minQty: 0 }, T);
const tile = r.data;
r = await call('GET', '/items/lookup/BC' + run, null, T);
ok(r.status === 200 && r.data.id === paint.id, 'barcode lookup');
r = await call('GET', '/items/lookup/nope-' + run, null, T);
ok(r.status === 404, 'unknown barcode -> 404');
r = await call('GET', '/items?q=' + encodeURIComponent('دهان'), null, T);
ok(r.data.some((i) => i.id === paint.id), 'search items by name');

// parties
r = await call('POST', '/parties', { type: 'supplier', name: 'مورد ' + run, phone: '0100' }, T);
const sup = r.data;
r = await call('POST', '/parties', { type: 'customer', name: 'عميل ' + run }, T);
const cus = r.data;
ok(sup.id && cus.id, 'create supplier + customer');

// receive
r = await call('POST', '/documents', { type: 'in', toWarehouseId: main.id, partyId: sup.id, reference: 'INV-1', lines: [{ itemId: paint.id, qty: 10 }, { itemId: tile.id, qty: 100.5 }] }, T);
ok(r.status === 201 && /^IN-\d{5}$/.test(r.data.number) && r.data.lines.length === 2, 'receipt (in) created', JSON.stringify(r.data));
const bal = async (wh, item) => (await call('GET', '/stock/available?warehouseId=' + wh, null, T)).data[item] ?? 0;
ok((await bal(main.id, paint.id)) === 10 && (await bal(main.id, tile.id)) === 100.5, 'balances after receipt');

// issue
r = await call('POST', '/documents', { type: 'out', fromWarehouseId: main.id, partyId: cus.id, lines: [{ itemId: paint.id, qty: 4 }] }, T);
ok(r.status === 201 && /^OUT-/.test(r.data.number), 'issue (out) created');
ok((await bal(main.id, paint.id)) === 6, 'balance after issue = 6');

// overdraft
r = await call('POST', '/documents', { type: 'out', fromWarehouseId: main.id, lines: [{ itemId: paint.id, qty: 7 }] }, T);
ok(r.status === 400 && /الرصيد غير كافي/.test(r.data.message), 'overdraft rejected', JSON.stringify(r.data));
ok((await bal(main.id, paint.id)) === 6, 'balance unchanged after rejected issue');

// transfer
r = await call('POST', '/documents', { type: 'transfer', fromWarehouseId: main.id, toWarehouseId: site.id, lines: [{ itemId: paint.id, qty: 2 }, { itemId: paint.id, qty: 1 }] }, T);
ok(r.status === 201 && r.data.lines.length === 1 && r.data.lines[0].qty === 3, 'transfer merges duplicate lines');
ok((await bal(main.id, paint.id)) === 3 && (await bal(site.id, paint.id)) === 3, 'balances after transfer');
r = await call('POST', '/documents', { type: 'transfer', fromWarehouseId: main.id, toWarehouseId: main.id, lines: [{ itemId: paint.id, qty: 1 }] }, T);
ok(r.status === 400, 'transfer to same warehouse rejected');
r = await call('POST', '/documents', { type: 'transfer', fromWarehouseId: main.id, toWarehouseId: site.id, lines: [{ itemId: tile.id, qty: 100.6 }] }, T);
ok(r.status === 400, 'transfer more than available rejected');
r = await call('POST', '/documents', { type: 'in', toWarehouseId: main.id, lines: [{ itemId: paint.id, qty: 0 }] }, T);
ok(r.status === 400, 'zero quantity rejected');
r = await call('POST', '/documents', { type: 'in', toWarehouseId: main.id, lines: [] }, T);
ok(r.status === 400, 'empty document rejected');

// concurrency: 5 parallel issues of 2 from a balance of 3 -> exactly one succeeds
const par = await Promise.all(Array.from({ length: 5 }, () =>
  call('POST', '/documents', { type: 'out', fromWarehouseId: main.id, lines: [{ itemId: paint.id, qty: 2 }] }, T)));
ok(par.filter((x) => x.status === 201).length === 1, 'concurrent issues cannot overdraw', par.map((x) => x.status).join(','));
ok((await bal(main.id, paint.id)) === 1, 'balance after concurrency = 1');

// low stock
r = await call('GET', '/stock/low', null, T);
ok(r.data.some((x) => x.item.id === paint.id), 'low-stock alert includes paint (qty 1+3 <= min 5)');
r = await call('GET', '/stock/balances?lowOnly=true', null, T);
ok(r.data.rows.every((x) => x.low), 'balances lowOnly filter');
r = await call('GET', '/stock/balances', null, T);
const row = r.data.rows.find((x) => x.item.id === paint.id);
ok(row && row.total === 4 && row.perWarehouse[site.id] === 3, 'balances table per-warehouse + total', JSON.stringify(row));

// reports
r = await call('GET', '/reports/movements?itemId=' + paint.id, null, T);
ok(r.status === 200 && r.data.rows.length >= 4 && r.data.totals.length >= 1, 'movement report');
r = await call('GET', '/reports/movements?type=in&warehouseId=' + main.id, null, T);
ok(r.data.rows.every((x) => x.type === 'in'), 'movement report filters');
r = await call('GET', '/documents?limit=5', null, T);
ok(r.data.total >= 4 && r.data.rows.length <= 5, 'documents list paginated');
r = await call('GET', '/dashboard', null, T);
ok(r.data.counts.items >= 2 && r.data.recent.length > 0, 'dashboard');

// delete rules
r = await call('DELETE', '/items/' + paint.id, null, T);
ok(r.status === 409, 'cannot delete item with movements');
r = await call('DELETE', '/warehouses/' + main.id, null, T);
ok(r.status === 409, 'cannot delete warehouse with movements');
r = await call('PATCH', '/warehouses/' + site.id, { isActive: false }, T);
ok(r.status === 400, 'cannot deactivate warehouse that still has stock');

// users & permissions
r = await call('POST', '/users', { name: 'أمين مخزن', username: 'keeper' + run, password: 'secret12', permissions: ['in', 'out'] }, T);
ok(r.status === 201, 'create limited user');
const keeperId = r.data.id;
r = await call('POST', '/auth/login', { username: 'keeper' + run, password: 'secret12' });
const K = r.data.token;
r = await call('POST', '/documents', { type: 'transfer', fromWarehouseId: main.id, toWarehouseId: site.id, lines: [{ itemId: tile.id, qty: 1 }] }, K);
ok(r.status === 403, 'user without transfer permission is blocked');
r = await call('POST', '/documents', { type: 'in', toWarehouseId: main.id, lines: [{ itemId: tile.id, qty: 1 }] }, K);
ok(r.status === 201, 'user with in permission can receive');
r = await call('POST', '/items', { name: 'x' }, K);
ok(r.status === 403, 'user without items permission cannot create items');
r = await call('GET', '/users', null, K);
ok(r.status === 403, 'non-admin cannot list users');
r = await call('GET', '/reports/movements', null, K);
ok(r.status === 403, 'user without reports permission cannot see report');
r = await call('GET', '/stock/balances', null, K);
ok(r.status === 200, 'any user can view balances');
r = await call('PATCH', '/users/' + keeperId, { isActive: false }, T);
ok(r.status === 200, 'admin deactivates user');
r = await call('GET', '/auth/me', null, K);
ok(r.status === 401, 'deactivated user token stops working immediately');
r = await call('PATCH', '/users/' + (await call('GET', '/auth/me', null, T)).data.id, { permissions: ['items'] }, T);
ok(r.status === 400, 'admin cannot remove own users permission');
r = await call('DELETE', '/users/' + keeperId, null, T);
ok(r.status === 409, 'user with documents cannot be deleted');

// password change
r = await call('PATCH', '/auth/password', { currentPassword: 'bad', newPassword: 'newpass123' }, T);
ok(r.status === 400, 'password change needs correct current password');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
