import { $, h, empty, now, uid, hashPin, debounce } from './util.js';
import { store, localTransport, cloudTransport, fetchJSON } from './store.js';
import { t, applyLang, getLang, setLang, onLang, LANGS } from './i18n.js';
import { initKeyboard, getKbMode, setKbMode } from './kb.js';
import { modal, toast, beep, closeAllModals, field, pickDlg, switchEl } from './ui.js';
import * as L from './logic.js';
import { startAutoKot } from './print.js';
import { seedDemo } from './seed.js';
import { STATES, validGSTIN } from './gst.js';
import { langSwitch } from './views/shared.js';

const DEV_MODE_KEY = 'restopos.mode';          // {role:'staff'|'table'|'kitchen', table, station, lang}
const THEME_KEY = 'restopos.theme';
export const app = { kind: 'standalone', info: null, cloud: null, transport: null };

export const deviceMode = () => { try { return JSON.parse(localStorage.getItem(DEV_MODE_KEY) || '{"role":"staff"}'); } catch (_) { return { role: 'staff' }; } };
export const setDeviceMode = m => localStorage.setItem(DEV_MODE_KEY, JSON.stringify(m));

// ───────── theme ─────────
function applyTheme() {
  document.documentElement.dataset.theme = localStorage.getItem(THEME_KEY) || 'light';
  const b = L.settings().brand;
  if (b) document.documentElement.style.setProperty('--brand', b);
}
export function toggleTheme() { localStorage.setItem(THEME_KEY, (localStorage.getItem(THEME_KEY) || 'light') === 'dark' ? 'light' : 'dark'); applyTheme(); }

// ───────── router ─────────
const views = {};
export function register(name, mod) { views[name] = mod; }
let current = null, rootEl = null;
export function go(path) { if (location.hash === '#' + path) route(); else location.hash = path; }
function parseHash() {
  const p = (location.hash.replace(/^#\/?/, '') || '').split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
  return { name: p[0] || '', args: p.slice(1) };
}
const LOADERS = {
  tables: () => import('./views/tables.js'), order: () => import('./views/order.js'), orders: () => import('./views/orders.js'), kitchen: () => import('./views/kitchen.js'),
  menu: () => import('./views/menu.js'), stock: () => import('./views/stock.js'), reports: () => import('./views/reports.js'), admin: () => import('./views/admin.js'),
  guest: () => import('./views/guest.js'), t: () => import('./views/guest.js'), members: () => import('./views/members.js'), customers: () => import('./views/customers.js'), pay: () => import('./views/payscreen.js'), online: () => import('./views/online.js'), cash: () => import('./views/cash.js'), provider: () => import('./views/provider.js')
};
// route -> [permission, feature test]
const ROUTE_RULES = {
  tables: ['waiter', () => L.feature('tables')], order: ['waiter', () => true], orders: ['pos', () => true], kitchen: ['kitchen', () => L.feature('kitchen')],
  menu: ['menu', () => true], stock: ['inventory', () => L.feature('inventory')], reports: ['reports', () => L.feature('reports') || L.feature('gst_reports') || L.feature('staff_reports')],
  admin: ['settings', () => true], members: ['members', () => L.feature('members')], online: ['pos', () => L.feature('online_orders')], customers: ['members', () => (L.feature('loyalty') && L.settings().loyalty_on) || (L.feature('coupons') && L.settings().coupons_on) || (L.feature('whatsapp') && L.settings().wa_on)], cash: ['expenses', () => L.feature('shifts') || L.feature('expenses')]
};
async function route() {
  closeAllModals();
  if (current && current.destroy) try { current.destroy(); } catch (e) { console.error(e); }
  current = null;
  let { name, args } = parseHash();
  const mode = deviceMode();

  if (name === 'provider') return mountView('provider', args, mode, false);
  if (!L.isSetUp()) return renderSetup();
  const lic = L.licenseState();
  if (!lic.ok) return renderBlocked();

  if (name === 'kds') { name = 'kitchen'; args = ['view']; }
  const guestRoute = name === 't' || name === 'guest' || name === 'pay' || (name === 'kitchen' && args && args[0] === 'view');
  if (mode.role === 'table' && !guestRoute) { name = 'guest'; args = [mode.table]; }
  else if (mode.role === 'kitchen' && name !== 'kitchen') { name = 'kitchen'; args = []; }
  else if (name === 't') { if (!L.settings().guest_ordering || !L.feature('guest')) return renderGuestOff(); }
  else if (name === 'guest' && mode.role !== 'table') { name = 't'; }

  if (name === 'kitchen' && !L.feature('kitchen')) return renderGuestOff();
  const kiosk = mode.role === 'table' || mode.role === 'kitchen' || guestRoute;
  if (!kiosk) {
    if (!L.session.user) L.restoreSession();
    if (!L.session.user) return renderLogin();
    if (!name) name = defaultRoute();
    const rule = ROUTE_RULES[name];
    if (!rule || !L.can(rule[0]) || !rule[1]()) { const d = defaultRoute(); if (name !== d) return go('/' + d); }
  }
  await mountView(name, args, mode, kiosk);
}
async function mountView(name, args, mode, kiosk) {
  if (!views[name] && LOADERS[name]) { const m = await LOADERS[name](); register(name, m); }
  if (!views[name]) return go('/' + defaultRoute());
  const host = h('div', { class: 'view' });
  empty(rootEl);
  if (name === 'provider') rootEl.append(host); else if (kiosk) rootEl.append(host); else {
    rootEl.append(topbar(name));
    const lic = L.licenseState();
    if (lic.ok && lic.trial) rootEl.append(h('a', { href: '#/provider', class: 'trial-bar' }, '⏳ ' + t('Free trial') + ': ' + t('{n} day(s) left', { n: lic.daysLeft }) + ' · ' + t('Activate')));
    rootEl.append(host);
  }
  document.title = L.settings().name || 'RestoPOS';
  if (!kiosk && name !== 'provider') import('./update.js').then(m => m.autoCheck()).catch(() => { });
  try { current = await views[name].mount(host, { args, kiosk, mode }) || {}; } catch (e) { console.error(e); host.append(h('div', { class: 'page' }, h('div', { class: 'hint bad' }, 'Screen error: ' + e.message))); }
}
function defaultRoute() {
  const r = L.session.user && L.session.user.role;
  if (r === 'kitchen') return 'kitchen';
  if (!L.feature('tables')) return L.can('pos') ? 'orders' : r === 'admin' || r === 'manager' ? 'admin' : 'orders';
  return 'tables';
}
store.on(type => {
  if (type === 'change') { applyTheme(); L.applyFormat(); schedUpdate(); }
  if (type === 'status') updateSync();
});
const schedUpdate = debounce(() => {
  if (!L.licenseState().ok && L.isSetUp() && parseHash().name !== 'provider') return route();
  if (current && current.update) { try { current.update(); } catch (e) { console.error(e); } }
  updateNavBadges();
  if (!L.isSetUp() && store.status.firstDone) route();
}, 60);
// switching language re-renders the current screen instantly (carts and drafts live outside the DOM)
onLang(() => { applyTheme(); route(); });

// ───────── shell ─────────
const NAV = [
  ['tables', 'Tables', '▦'], ['orders', 'Orders & bills', '🧾'], ['kitchen', 'Kitchen', '🍳'], ['members', 'Members', '💳'], ['online', 'Online orders', '🛵'], ['customers', 'Customers & offers', '🎁'], ['menu', 'Menu', '📖'],
  ['stock', 'Inventory', '📦'], ['cash', 'Cash & expenses', '💰'], ['reports', 'Reports', '📈'], ['admin', 'Admin', '⚙']
];
function topbar(active) {
  const s = L.settings();
  const items = NAV.filter(n => { const r = ROUTE_RULES[n[0]]; return L.can(r[0]) && r[1](); });
  return h('header', { class: 'topbar' },
    h('button', { class: 'brandname', onClick: () => go('/' + defaultRoute()), 'aria-label': s.name }, s.logo ? h('img', { src: s.logo, alt: '' }) : null, h('span', null, s.name)),
    h('nav', null, items.map(n => h('a', { class: 'nav-a' + (n[0] === active || (active === 'order' && n[0] === 'tables') ? ' on' : ''), href: '#/' + n[0] }, n[2] + ' ', t(n[1]), n[0] === 'kitchen' || n[0] === 'tables' || n[0] === 'online' ? h('span', { class: 'n', hidden: true, 'data-badge': n[0] }) : null))),
    h('span', { class: 'sync', id: 'sync' }, h('i'), h('span')),
    langSwitch({ onChange: () => { } }),
    h('button', { class: 'icon-btn', title: t('Touch keyboard'), onClick: kbMenu }, '⌨'),
    h('button', { class: 'icon-btn', title: t('Dark mode'), onClick: toggleTheme }, '◐'),
    h('button', { class: 'icon-btn', title: (L.session.user ? L.session.user.name + ' — ' : '') + t('Lock'), onClick: lock }, '🔒'));
}
function kbMenu() {
  const labels = { auto: 'Auto (touch screens)', on: 'Always on', off: 'Off (physical keyboard)' };
  pickDlg({ title: t('Touch keyboard'), options: ['auto', 'on', 'off'].map(v => ({ value: v, label: t(labels[v]) + (getKbMode() === v ? '  ✓' : '') })) }).then(v => { if (v) setKbMode(v); });
}
export function lock() { L.logout(); route(); }
function updateSync() {
  const el = $('#sync'); if (!el) return;
  const st = store.status;
  const txt = app.kind === 'standalone' ? t('This device only') : !st.online ? (st.pending ? t('Offline · {n} waiting', { n: st.pending }) : t('Offline')) : st.pending ? t('Syncing…') : t('Live');
  el.className = 'sync' + (app.kind !== 'standalone' && !st.online ? ' off' : st.pending ? ' busy' : '');
  el.lastChild.textContent = txt;
  el.title = st.error || '';
}
function updateNavBadges() {
  const k = $('[data-badge=kitchen]'); const tb = $('[data-badge=tables]'); const ob = $('[data-badge=online]');
  if (ob) { const n = store.all('online_orders').filter(o => o.status === 'new').length; ob.textContent = n; ob.hidden = !n; }
  if (k) { const n = store.all('order_items').filter(i => i.status === 'new' || i.status === 'preparing').length; k.textContent = n; k.hidden = !n; }
  if (tb) { const n = L.activeCalls().length + store.all('order_items').filter(i => i.status === 'ready' || i.status === 'pending').length; tb.textContent = n; tb.hidden = !n; }
}

// ───────── attention sounds (staff devices) ─────────
let seenReady = null, seenCalls = null, seenPending = null, seenOnline = null;
store.on(type => {
  if (type !== 'change' || !L.session.user || deviceMode().role !== 'staff') return;
  const ready = new Set(store.all('order_items').filter(i => i.status === 'ready').map(i => i.id));
  const calls = new Set(L.activeCalls().map(c => c.id));
  const pend = new Set(store.all('order_items').filter(i => i.status === 'pending').map(i => i.id));
  if (seenReady && L.can('waiter')) {
    if ([...ready].some(i => !seenReady.has(i))) beep('ready');
    else if ([...calls].some(i => !seenCalls.has(i)) || [...pend].some(i => !seenPending.has(i))) beep('call');
  }
  const onl = new Set(store.all('online_orders').filter(o => o.status === 'new').map(o => o.id));
  if (seenOnline && L.feature('online_orders') && [...onl].some(i => !seenOnline.has(i))) beep('call');
  seenOnline = onl;
  seenReady = ready; seenCalls = calls; seenPending = pend;
});

// ───────── login ─────────
function pinPad({ onSubmit, title, sub }) {
  let pin = '';
  const dots = h('div', { class: 'pin-dots' });
  const msg = h('div', { class: 'center muted', style: { minHeight: '1.4rem' } });
  const draw = () => { empty(dots); for (let i = 0; i < Math.max(4, pin.length); i++) dots.append(h('i', { class: i < pin.length ? 'f' : '' })); };
  const wrap = h('div');
  const press = k => {
    if (k === '⌫') pin = pin.slice(0, -1); else if (k === 'C') pin = ''; else if (pin.length < 8) pin += k;
    msg.textContent = ''; draw();
    if (k !== '⌫' && k !== 'C' && pin.length >= 4) { const r = onSubmit(pin, false); if (r === 'ok') pin = ''; }
  };
  const submit = () => { const r = onSubmit(pin, true); if (r === 'bad') { wrap.classList.remove('shake'); void wrap.offsetWidth; wrap.classList.add('shake'); msg.textContent = t('Wrong PIN'); pin = ''; draw(); } };
  const key = k => h('button', { type: 'button', class: 'pin-key' + (/[⌫C]/.test(k) ? ' fn' : ''), onClick: () => press(k) }, k === 'C' ? t('Clear') : k);
  wrap.append(h('h2', { class: 'center' }, title), sub ? h('p', { class: 'center muted' }, sub) : null, dots, msg,
    h('div', { class: 'pin-pad' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(key), key('C'), key('0'), key('⌫')),
    h('div', { style: { maxWidth: '330px', margin: '.8rem auto 0' } }, h('button', { class: 'btn primary lg block', onClick: submit }, t('Unlock'))));
  const onKey = e => {
    if (!wrap.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (e.target.tagName === 'INPUT') return;
    if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('⌫'); else if (e.key === 'Enter') submit(); else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);
  draw();
  return wrap;
}
let loginMode = 'pin';
function renderLogin() {
  empty(rootEl);
  const s = L.settings();
  const done = u => { if (u) { go('/' + defaultRoute()); route(); return 'ok'; } };
  let form;
  if (loginMode === 'pin') {
    form = pinPad({ title: t('Enter your PIN'), sub: s.name, onSubmit: (pin, final) => done(L.loginPin(pin)) || (final ? 'bad' : null) });
  } else {
    const un = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none' }), pw = h('input', { type: 'password', autocomplete: 'current-password' });
    const err = h('div', { class: 'hint bad', hidden: true }, t('Wrong username or password'));
    const go1 = () => { if (!done(L.loginPassword(un.value, pw.value))) err.hidden = false; };
    pw.addEventListener('keydown', e => { if (e.key === 'Enter') go1(); });
    form = h('div', null, h('h2', { class: 'center' }, t('Sign in')), h('p', { class: 'center muted', style: { marginBottom: '1rem' } }, s.name), field(t('Username'), un), field(t('Password'), pw), err, h('button', { class: 'btn primary lg block', onClick: go1 }, t('Sign in')));
  }
  rootEl.append(h('div', { class: 'center-screen' }, h('div', { class: 'panel' },
    s.logo ? h('div', { class: 'center', style: { marginBottom: '.6rem' } }, h('img', { src: s.logo, style: { height: '56px', borderRadius: '10px' } })) : null,
    form,
    h('div', { class: 'row wrap', style: { justifyContent: 'center', marginTop: '1rem' } },
      h('button', { class: 'btn ghost sm', onClick: () => { loginMode = loginMode === 'pin' ? 'pass' : 'pin'; renderLogin(); } }, loginMode === 'pin' ? t('Use username & password') : t('Use PIN')),
      langSwitch(), h('button', { class: 'btn ghost sm', onClick: toggleTheme }, '◐'), h('button', { class: 'btn ghost sm', onClick: kbMenu }, '⌨'),
      h('span', { class: 'sync', style: { background: 'var(--surface-2)', color: 'var(--ink-2)' }, id: 'sync' }, h('i'), h('span'))),
    h('div', { class: 'center' }, h('a', { href: '#/provider', class: 'muted', style: { fontSize: '.78rem' } }, t('Provider'))))));
  updateSync();
}
function renderBlocked() {
  empty(rootEl);
  const p = L.provider();
  const lic = L.licenseState();
  rootEl.append(h('div', { class: 'center-screen' }, h('div', { class: 'panel center' }, h('div', { style: { fontSize: '3rem' } }, '🔒'), h('h2', null, t(lic.reason === 'expired' ? (lic.trial ? 'Free trial ended' : 'Licence expired') : 'Service paused')),
    h('p', { class: 'muted', style: { margin: '.6rem 0' } }, p.message || t(lic.trial ? 'Your 30-day free trial has ended. Contact your software provider to activate a yearly or lifetime licence.' : 'Please contact your software provider to continue.')), p.support ? h('p', null, h('b', null, p.support)) : null,
    h('p', null, h('a', { href: '#/provider', class: 'btn primary' }, t('Activate (provider password)'))))));
}
function renderGuestOff() {
  empty(rootEl);
  rootEl.append(h('div', { class: 'center-screen' }, h('div', { class: 'panel center' }, h('h2', null, t('Ordering from the table is switched off')), h('p', { class: 'muted' }, t('Please ask a member of staff.')))));
}

/** Ask for a manager/admin PIN before leaving a kiosk screen. */
export function staffGate() {
  return new Promise(res => {
    const m = modal({
      title: null, size: 'sm', dismiss: true, onClose: v => res(v === true),
      body: pinPad({ title: t('Staff PIN'), onSubmit: (pin, final) => { const u = store.all('users').find(x => x.active !== false && x.pin === hashPin(pin)); if (u && (u.role === 'admin' || u.role === 'manager')) { m.close(true); return 'ok'; } return final ? 'bad' : null; } })
    });
  });
}

// ───────── first-run setup ─────────
function renderSetup() {
  empty(rootEl);
  if (!store.status.firstDone && app.kind !== 'standalone') { rootEl.append(h('div', { class: 'splash' }, h('div', null, h('div', { class: 'spin' }), t('Loading…')))); return; }
  // Setup is done once, on the server computer. Tablets / phones never create their own restaurant.
  const hostIsServer = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);
  if (app.kind === 'local' && !hostIsServer || (app.kind !== 'standalone' && store.status.error)) {
    const bad = !!store.status.error;
    rootEl.append(h('div', { class: 'center-screen' }, h('div', { class: 'panel', style: { textAlign: 'center' } },
      h('div', { class: 'row sp' }, h('h1', null, bad ? t('Cannot reach the restaurant server') : t('Waiting for restaurant setup')), langSwitch()),
      h('p', { class: 'muted', style: { margin: '.6rem 0 1.2rem' } }, bad ? t('Check the Wi-Fi connection, then try again.') : t('The restaurant has not been set up yet. Open RestoPOS once on the main computer (http://localhost) and create the restaurant there. All tablets will then pick it up automatically.')),
      h('button', { class: 'btn primary lg block', onClick: () => location.reload() }, t('Try again')))));
    return;
  }
  const name = h('input', { type: 'text', placeholder: 'e.g. Sharma Family Restaurant' });
  const stateSel = h('select', null, h('option', { value: '' }, '—'), STATES.map(x => h('option', { value: x[0] }, x[0] + ' · ' + x[1])));
  const gstin = h('input', { type: 'text', maxlength: 15, placeholder: '27AAAAA0000A1Z5 (optional)', style: { textTransform: 'uppercase' } });
  const scheme = h('select', null, [['regular', t('Regular — Tax invoice with GST')], ['composition', t('Composition scheme — Bill of supply, no GST')], ['none', t('Not registered — plain bill')]].map(([v, l]) => h('option', { value: v }, l)));
  const adm = h('input', { type: 'text', placeholder: t('Your name') });
  const pin = h('input', { type: 'password', inputmode: 'numeric', placeholder: '4–6 digits', maxlength: 6, 'data-kb': 'pin' });
  const demo = h('input', { type: 'checkbox', checked: true });
  const err = h('div', { class: 'hint bad', hidden: true });
  gstin.addEventListener('input', () => { gstin.value = gstin.value.toUpperCase(); if (gstin.value.length >= 2 && !stateSel.value) stateSel.value = gstin.value.slice(0, 2); });
  const go1 = () => {
    err.hidden = true;
    if (!name.value.trim()) { err.textContent = t('Enter the restaurant name'); err.hidden = false; return; }
    if (!/^\d{4,6}$/.test(pin.value)) { err.textContent = t('PIN must be 4 to 6 digits'); err.hidden = false; return; }
    const g = gstin.value.trim();
    if (g && g.length !== 15) { err.textContent = t('GSTIN must be 15 characters like 27AAAAA0000A1Z5'); err.hidden = false; return; }
    L.saveSettings({ name: name.value.trim(), gstin: g, state_code: stateSel.value, gst_scheme: scheme.value, created_at: now() });
    store.put('users', { id: uid(), name: adm.value.trim() || 'Admin', role: 'admin', pin: hashPin(pin.value), active: true });
    if (demo.checked) seedDemo();
    toast(t('Restaurant created'), 'ok');
    route();
  };
  rootEl.append(h('div', { class: 'center-screen' }, h('div', { class: 'panel' },
    h('div', { class: 'row sp' }, h('h1', null, t('Set up your restaurant')), langSwitch()), h('p', { class: 'muted', style: { margin: '.3rem 0 1.2rem' } }, t('Takes one minute. You can change everything later in Admin.')),
    field(t('Restaurant name'), name), h('div', { class: 'grid2' }, field('GSTIN', gstin), field(t('State (place of supply)'), stateSel)), field(t('GST scheme'), scheme),
    h('hr', { style: { border: 0, borderTop: '1px solid var(--line)', margin: '.5rem 0 1rem' } }),
    h('div', { class: 'grid2' }, field(t('Admin name'), adm), field(t('Admin PIN'), pin)),
    h('label', { class: 'switch', style: { margin: '.3rem 0 1rem' } }, demo, h('span', { class: 'track' }), h('span', { class: 'lbl' }, t('Add a sample menu, tables, staff and stock to try things out'))),
    err, h('button', { class: 'btn primary lg block', onClick: go1 }, t('Create restaurant')))));
}

// ───────── cloud sign-in ─────────
function renderCloudLogin(tr, cfgSource) {
  return new Promise(resolve => {
    empty(rootEl);
    const em = h('input', { type: 'email', placeholder: 'owner@restaurant.com', autocomplete: 'username' });
    const pw = h('input', { type: 'password', autocomplete: 'current-password' });
    const err = h('div', { class: 'hint bad', hidden: true });
    const btn = h('button', { class: 'btn primary lg block' }, t('Sign in'));
    const doit = async () => {
      err.hidden = true; btn.disabled = true;
      try { await tr.login(em.value.trim(), pw.value); resolve(); } catch (e) { err.textContent = String(e.message); err.hidden = false; btn.disabled = false; }
    };
    btn.onclick = doit;
    pw.addEventListener('keydown', e => { if (e.key === 'Enter') doit(); });
    rootEl.append(h('div', { class: 'center-screen' }, h('div', { class: 'panel' }, h('div', { class: 'row sp' }, h('h1', null, 'RestoPOS'), langSwitch()), h('p', { class: 'muted', style: { margin: '.3rem 0 1.2rem' } }, t('Sign in with the restaurant account (online mode).')),
      field(t('Email'), em), field(t('Password'), pw), err, btn,
      cfgSource === 'browser' ? h('button', { class: 'btn ghost sm block', style: { marginTop: '.8rem' }, onClick: () => { localStorage.removeItem('restopos.cloudcfg'); location.reload(); } }, t('Disconnect from online database')) : null)));
  });
}

// ───────── boot ─────────
async function detectLocal() {
  try { const r = await fetchJSON('api/info', {}, 2500); if (r && r.app === 'restopos') return r; } catch (_) { /* not served by RestoPOS server */ }
  return null;
}
function cloudConfig() {
  const c = window.RESTOPOS_CONFIG || {};
  if (c.supabaseUrl && c.supabaseKey) return { url: c.supabaseUrl, key: c.supabaseKey, source: 'file' };
  try { const b = JSON.parse(localStorage.getItem('restopos.cloudcfg') || 'null'); if (b && b.url && b.key) return { url: b.url, key: b.key, source: 'browser' }; } catch (_) { /* ignore */ }
  return null;
}
export function saveBrowserCloud(url, key) { if (url && key) localStorage.setItem('restopos.cloudcfg', JSON.stringify({ url: url.trim(), key: key.trim() })); else localStorage.removeItem('restopos.cloudcfg'); }

async function boot() {
  rootEl = $('#app');
  applyLang(); applyTheme(); initKeyboard();
  rootEl.append(h('div', { class: 'splash' }, h('div', null, h('div', { class: 'spin' }), 'RestoPOS')));
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => { });

  const info = await detectLocal();
  let scope, tr = null, kind;
  if (info) { kind = 'local'; app.info = info; scope = 'local:' + info.client; tr = localTransport(''); }
  else {
    const cc = cloudConfig();
    if (cc) {
      kind = 'cloud'; tr = cloudTransport(cc); app.cloud = tr;
      if (!tr.auth) await renderCloudLogin(tr, cc.source);
      scope = 'cloud:' + (tr.auth.clientId || 'x');
    } else { kind = 'standalone'; scope = 'standalone'; }
  }
  app.kind = kind; app.transport = tr;
  await store.init({ scopeName: scope, kind, transport: tr });
  L.applyFormat(); applyTheme();
  startAutoKot();
  window.addEventListener('hashchange', route);
  window.addEventListener('print-error', e => toast('Print failed: ' + (e.detail && e.detail.message), 'bad', 6000));
  store.on(tp => { if (tp === 'status' && store.status.authNeeded && kind === 'cloud') { tr.logout(); location.reload(); } });
  idleWatch();
  await route();
}
let idleT = null;
function idleWatch() {
  const reset = () => {
    clearTimeout(idleT);
    const m = Number(L.settings().lock_minutes) || 0;
    if (!m || !L.session.user || deviceMode().role !== 'staff') return;
    idleT = setTimeout(() => { if (L.session.user) lock(); }, m * 60000);
  };
  ['pointerdown', 'keydown'].forEach(e => window.addEventListener(e, reset, { passive: true }));
  reset();
}
window.addEventListener('DOMContentLoaded', () => boot().catch(e => { console.error(e); $('#app').innerHTML = '<div style="padding:2rem;font-family:sans-serif"><h2>RestoPOS could not start</h2><pre>' + String(e.stack || e).replace(/</g, '&lt;') + '</pre></div>'; }));
