// End-to-end sign-in and role tests against the stand-in Supabase (see standin_supabase.py).
// Needs: Postgres with migrations applied, standin on :54321, backend_e2e on :8000, and the
// frontend built with NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 running on :3000.
//   node e2e/auth_flows.js [screenshot-dir]
const m = require('@sparticuz/chromium'); const chromium = m.default || m; const puppeteer = require('puppeteer-core');
const { execFileSync } = require('child_process');

const APP = 'http://localhost:3000';
const STANDIN = 'http://127.0.0.1:54321';
const PSQL_URL = process.env.STANDIN_DB || 'postgresql://postgres@127.0.0.1:54329/ls03_e2e';
const SHOTS = process.argv[2];
const run = Date.now().toString(36);
const PW = 'Recover2026';
let passed = 0; const failures = [];

function check(name, cond, detail = '') {
  if (cond) { passed++; console.log('  ok  ', name); } else { failures.push(name); console.log('  FAIL', name, detail); }
}
const sql = (q) => execFileSync('psql', [PSQL_URL, '-tAc', q]).toString().trim();
const path = (page) => { const u = new URL(page.url()); return u.pathname + u.search; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); }
async function go(page, p) { await page.goto(APP + p, { waitUntil: 'networkidle0' }); }
async function submit(page, selector = 'form button[type=submit]') {
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => null), page.click(selector)]);
  await wait(300);
}
async function text(page) { return page.evaluate(() => document.body.innerText); }
async function mailLink(email, type = 'signup') {
  const r = await fetch(`${STANDIN}/__test/mail?to=${encodeURIComponent(email)}&type=${type}`);
  return r.ok ? (await r.json()).link : null;
}

async function register(page, { type, name, business, email, address, udyam, role, quals }) {
  await go(page, '/register');
  await page.click(`label[for=type-${type}]`);
  await page.type('#fullName', name);
  if (business) await page.type('#businessName', business);
  await page.type('#email', email);
  await page.type('#mobile', '98765 43210');
  await page.type('#password', PW);
  await page.type('#confirmPassword', PW);
  if (address) await page.type('#businessAddress', address);
  if (udyam) await page.type('#udyam', udyam);
  if (role) await page.select('#professionalRole', role);
  if (quals) await page.type('#qualifications', quals);
  await submit(page);
}

async function signIn(page, email, password = PW, { remember = false, from = '/login' } = {}) {
  await go(page, from);
  await page.type('#email', email);
  await page.type('#password', password);
  if (remember) await page.click('input[name=remember]');
  await submit(page);
}

async function verify(page, email) {
  const link = await mailLink(email);
  await page.goto(link, { waitUntil: 'networkidle0' });
  await wait(300);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter((a) => a !== '--single-process'), headless: true });
  const fresh = async () => { const ctx = await browser.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport({ width: 1366, height: 900 }); return p; };
  const supplierEmail = `supplier-${run}@example.com`;
  const buyerEmail = `buyer-${run}@example.com`;
  const adviserEmail = `adviser-${run}@example.com`;
  const adminEmail = `admin-${run}@example.com`;

  console.log('Signed out');
  let p = await fresh();
  await go(p, '/contracts');
  check('protected page redirects to login with return path', path(p) === '/login?next=%2Fcontracts', path(p));
  await shot(p, 'a01-login');
  await submit(p);
  check('empty sign-in shows field errors without a request', (await text(p)).includes('Enter your email address.'));
  await p.type('#email', 'nobody@example.com'); await p.type('#password', 'whatever1');
  await submit(p);
  check('unknown account is refused with a clear message', (await text(p)).includes('Email or password is incorrect.'));

  console.log('Register MSME supplier');
  await go(p, '/register');
  await shot(p, 'a02-register-supplier');
  await submit(p);
  const regErrors = await text(p);
  check('registration validates every required field', regErrors.includes('Enter your full name.') && regErrors.includes('Enter your mobile number.') && regErrors.includes('Enter your business address.'));
  await register(p, { type: 'supplier', name: 'Rajesh Sharma', business: 'Sri Lakshmi Packaging', email: supplierEmail, address: 'Peenya, Bengaluru', udyam: 'UDYAM-KA-01-1234567' });
  check('registration success screen', path(p) === '/registered?type=supplier', path(p));
  await shot(p, 'a03-registered');
  check('profile created by trigger as approved supplier',
    sql(`select role||'/'||approval_status||'/'||udyam_number from profiles where email='${supplierEmail}'`) === 'supplier/approved/UDYAM-KA-01-1234567');

  await signIn(p, supplierEmail);
  check('unverified email cannot sign in', path(p).startsWith('/verify-email'), path(p));
  await shot(p, 'a04-verify-email');
  await verify(p, supplierEmail);
  check('verification link signs in and lands on MSME dashboard', path(p) === '/', path(p));
  const cookies = await p.cookies();
  const sb = cookies.filter((c) => c.name.startsWith('sb-'));
  check('session cookie is HttpOnly, SameSite=Lax', sb.length > 0 && sb.every((c) => c.httpOnly && c.sameSite === 'Lax'), JSON.stringify(sb.map((c) => [c.name, c.httpOnly, c.sameSite])));
  check('session cookie ends with the browser (remember me off)', sb.every((c) => c.session));
  check('page scripts cannot read the session', !(await p.evaluate(() => document.cookie)).includes('sb-'));
  check('no tokens in localStorage', await p.evaluate(() => !Object.keys(localStorage).some((k) => k.includes('sb-') || k.includes('auth'))));

  console.log('Supplier data through the proxy');
  const api = (method, url, body) => p.evaluate(async (method, url, body) => {
    const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, method, url, body);
  let r = await api('GET', '/proxy/api/businesses/me');
  check('new supplier has no business yet (backend saw the real user)', r.status === 404, JSON.stringify(r));
  r = await api('POST', '/proxy/api/businesses', { name: 'Sri Lakshmi Packaging', size: 'micro', activity: 'manufacturing' });
  check('supplier creates their business via proxy + JWT', r.status === 200 && r.body.owner_id === sql(`select id from profiles where email='${supplierEmail}'`), JSON.stringify(r));
  r = await api('GET', '/proxy/api/cases/33333333-3333-3333-3333-333333333333');
  check("supplier cannot read another business's case", r.status === 404, JSON.stringify(r));
  const cross = await p.evaluate(async () => {
    const r = await fetch('/proxy/api/cases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', referrerPolicy: 'no-referrer' });
    return r.status;
  });
  check('same-origin write via proxy is allowed (gets past CSRF check)', cross !== 403, String(cross));
  const forged = await fetch(`${APP}/proxy/api/cases`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json', Cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') }, body: '{}' });
  check('cross-site write via proxy is blocked', forged.status === 403, String(forged.status));
  await go(p, '/');
  await shot(p, 'a05-supplier-dashboard');
  const supplierNav = await p.$$eval('nav[aria-label=Main] a', (as) => as.map((a) => a.textContent.trim()));
  check('supplier sidebar has supplier pages, not buyer/admin', supplierNav.includes('Contracts') && !supplierNav.includes('Admin Dashboard') && !supplierNav.includes('Buyer Dashboard') && !supplierNav.includes('Adviser Portal'), supplierNav.join(','));
  for (const url of ['/buyer', '/admin', '/adviser']) {
    await go(p, url);
    check(`supplier typing ${url} gets Access denied`, path(p).startsWith('/access-denied'), path(p));
  }
  await shot(p, 'a06-access-denied');
  await go(p, '/login');
  check('signed-in user visiting /login goes to their dashboard', path(p) === '/', path(p));

  console.log('Expired / revoked session');
  await fetch(`${STANDIN}/__test/revoke?email=${encodeURIComponent(supplierEmail)}`, { method: 'POST' });
  await go(p, '/contracts');
  check('revoked session sends to login, says expired', path(p) === '/login?next=%2Fcontracts&expired=1', path(p));
  check('expired message shown', (await text(p)).includes('Your session expired'));

  console.log('Remember me and sign out');
  await signIn(p, supplierEmail, PW, { remember: true, from: '/login?next=%2Fcontracts' });
  check('sign-in returns to the page they asked for', path(p) === '/contracts', path(p));
  const kept = (await p.cookies()).filter((c) => c.name.startsWith('sb-'));
  const days = (kept[0].expires - Date.now() / 1000) / 86400;
  check('remember me keeps the session up to 30 days', kept.every((c) => !c.session) && days > 29 && days <= 30.01, String(days));
  await p.click('button[aria-label="Account menu"]');
  await submit(p, 'header form button[type=submit]');
  check('sign out goes to login with a message', path(p) === '/login?signed_out=1' && (await text(p)).includes("You've signed out."), path(p));
  check('sign out clears session cookies', (await p.cookies()).filter((c) => c.name.startsWith('sb-')).length === 0);
  await go(p, '/');
  check('after sign out, dashboard needs sign-in again', path(p).startsWith('/login'), path(p));

  console.log('Buyer');
  const b = await fresh();
  await go(b, '/register');
  await b.click('label[for=type-buyer]');
  await b.evaluate(() => { document.querySelector('#type-buyer').value = 'admin'; });   // tamper
  await b.type('#fullName', 'Meera Rao'); await b.type('#businessName', 'Kaveri Foods'); await b.type('#email', buyerEmail);
  await b.type('#mobile', '9876543210'); await b.type('#password', PW); await b.type('#confirmPassword', PW); await b.type('#businessAddress', 'Mysuru');
  await submit(b);
  check('tampered account type "admin" is refused', (await text(b)).includes('Choose an account type.') && sql(`select count(*) from profiles where email='${buyerEmail}'`) === '0');
  await register(b, { type: 'buyer', name: 'Meera Rao', business: 'Kaveri Foods Pvt Ltd', email: buyerEmail, address: 'Mysuru, Karnataka' });
  await verify(b, buyerEmail);
  check('buyer lands on Buyer Dashboard', path(b) === '/buyer', path(b));
  await shot(b, 'a07-buyer-dashboard');
  const buyerNav = await b.$$eval('nav[aria-label=Main] a', (as) => as.map((a) => a.textContent.trim()));
  check('buyer sidebar: Buyer Dashboard, Legal Assistant, Marketplace, Settings only', JSON.stringify(buyerNav) === JSON.stringify(['Legal Assistant', 'Marketplace', 'Buyer Dashboard', 'Settings']), buyerNav.join(','));
  for (const url of ['/contracts', '/invoices', '/', '/admin']) {
    await go(b, url);
    const expect = url === '/' ? '/buyer' : '/access-denied';
    check(`buyer typing ${url} → ${expect}`, path(b).startsWith(expect), path(b));
  }
  r = await b.evaluate(async () => (await fetch('/proxy/api/cases')).status);
  check('buyer is refused business data by the backend (403)', r === 403, String(r));
  r = await b.evaluate(async () => (await fetch('/proxy/api/rates')).status);
  check('buyer can use the rate table / calculator', r === 200, String(r));
  await b.setExtraHTTPHeaders({ 'x-ls03-viewer': encodeURIComponent(JSON.stringify({ id: 'x', role: 'admin', approval: 'approved', emailVerified: true, name: 'Forged', email: 'f@x' })) });
  await go(b, '/admin');
  check('forged viewer header does not grant admin', path(b).startsWith('/access-denied'), path(b));
  await b.setExtraHTTPHeaders({});

  console.log('Adviser and admin approval');
  const a = await fresh();
  await go(a, '/register'); await a.click('label[for=type-adviser]');
  await shot(a, 'a08-register-adviser');
  await register(a, { type: 'adviser', name: 'Anita Desai', business: 'Desai & Co', email: adviserEmail, role: 'Chartered Accountant', quals: 'FCA, ICAI member no. 123456' });
  check('adviser success screen mentions review', path(a) === '/registered?type=adviser' && (await text(a)).includes('administrator then reviews'), path(a));
  await verify(a, adviserEmail);
  check('verified adviser waits for approval', path(a) === '/pending-approval', path(a));
  await shot(a, 'a09-pending-approval');
  await go(a, '/adviser');
  check('pending adviser cannot open the portal', path(a) === '/pending-approval', path(a));
  r = await a.evaluate(async () => (await fetch('/proxy/api/rates')).status);
  check('pending adviser is refused by the backend too', r === 403, String(r));

  const ad = await fresh();
  await register(ad, { type: 'supplier', name: 'Platform Admin', business: 'LS-03 Team', email: adminEmail, address: 'Bengaluru' });
  await verify(ad, adminEmail);
  sql(`update profiles set role='admin', approval_status='approved' where email='${adminEmail}'`);   // documented bootstrap step
  await go(ad, '/');
  check('admin is sent to Admin Dashboard', path(ad) === '/admin', path(ad));
  check('admin sees the pending adviser', (await text(ad)).includes('Anita Desai'));
  await shot(ad, 'a10-admin-dashboard');
  await ad.type('input[name=note]', 'Checked ICAI membership');
  await ad.click('button[value=approved]');
  await ad.waitForFunction(() => document.body.innerText.includes('Adviser approved.'), { timeout: 10000 }).catch(() => null);
  check('admin approves the adviser', sql(`select approval_status from profiles where email='${adviserEmail}'`) === 'approved');
  check('decision is logged with the note', sql(`select decision||':'||note from adviser_reviews r join profiles p on p.id=r.adviser_id where p.email='${adviserEmail}'`) === 'approved:Checked ICAI membership');
  await go(a, '/pending-approval');
  check('approved adviser now goes to the Adviser Portal', path(a) === '/adviser', path(a));
  await shot(a, 'a11-adviser-portal');
  const direct = await a.evaluate(async () => (await fetch('/proxy/api/cases')).status);
  check('adviser cannot read supplier data', direct === 403, String(direct));

  console.log('Forgot / reset password');
  const f = await fresh();
  await go(f, '/forgot-password');
  await f.type('#email', supplierEmail);
  await submit(f);
  check('reset request gives the same neutral message', (await text(f)).includes("If an account exists for that email"));
  await shot(f, 'a12-forgot-password');
  await f.goto(await mailLink(supplierEmail, 'recovery'), { waitUntil: 'networkidle0' });
  check('recovery link opens reset page', path(f) === '/reset-password', path(f));
  await shot(f, 'a13-reset-password');
  await f.type('#password', 'short'); await f.type('#confirmPassword', 'short');
  await submit(f);
  check('weak new password is refused', (await text(f)).includes('Use at least 8 characters.'));
  await f.evaluate(() => { document.querySelector('#password').value = ''; document.querySelector('#confirmPassword').value = ''; });
  await f.type('#password', 'NewPassw0rd!'); await f.type('#confirmPassword', 'NewPassw0rd!');
  await submit(f);
  check('new password saved, lands on dashboard', path(f) === '/', path(f));
  const g = await fresh();
  await signIn(g, supplierEmail, PW);
  check('old password no longer works', (await text(g)).includes('Email or password is incorrect.'));
  await g.evaluate(() => { document.querySelector('#password').value = ''; });
  await g.type('#password', 'NewPassw0rd!');
  await submit(g);
  check('new password works', path(g) === '/', path(g));
  const used = await mailLink(supplierEmail, 'recovery');
  const h = await fresh();
  await h.goto(used, { waitUntil: 'networkidle0' });
  check('used recovery link cannot be reused', path(h) === '/forgot-password?expired=1', path(h));
  check('expired reset link explains itself', (await text(h)).includes('expired or was already used'));
  await go(h, '/reset-password');
  check('reset page without a recovery session is refused', path(h) === '/forgot-password?expired=1', path(h));

  console.log('Mobile layout');
  const mob = await fresh();
  await mob.setViewport({ width: 390, height: 844, isMobile: true });
  await go(mob, '/register');
  const over = await mob.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('registration fits a phone screen (no sideways scroll)', !over);
  await shot(mob, 'a14-register-phone');

  await browser.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log('Failed:', failures.join(' | ')); process.exit(1); }
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
