// Admin: restaurant details, tax & charges, tables & waiter assignment, staff, partners, ordering rules, printing, devices, sync & backup.
import { h, empty, money, uid, parseNum, resizeImage, hashPin, download, readFileText, fmtDateTime, now } from '../util.js';
import { store, fetchJSON } from '../store.js';
import { t, nameOf, LANGS } from '../i18n.js';
import { modal, toast, confirmDlg, field, switchEl, pickDlg, promptDlg } from '../ui.js';
import * as L from '../logic.js';
import { app, setDeviceMode, deviceMode, saveBrowserCloud, go } from '../app.js';
import { STATES, GST_RATES, validGSTIN, gstinState } from '../gst.js';
import { PAPERS, profile, deviceOverride, saveDeviceOverride, printTest } from '../print.js';
import { qrSvg } from '../qr.js';
import { tabs, dataTable } from './kit.js';
import { tri } from './menu.js';
import { waStatus, waSetup } from '../whatsapp.js';

export function mount(el, { args }) {
  const all = [['rest', 'Restaurant', null], ['tax', 'Tax & charges', null], ['tables', 'Tables & waiters', null], ['staff', 'Staff', null, 'staff'], ['partners', 'Partners', 'partners'], ['rules', 'Ordering & kitchen', null], ['print', 'Printing', null], ['rewards', 'Rewards & integrations', null, 'settings'], ['device', 'This device', null], ['sync', 'Sync & backup', null]];
  const defs = all.filter(d => (!d[2] || L.feature(d[2])) && (!d[3] || L.can(d[3])));
  let tab = args[0] && defs.find(d => d[0] === args[0]) ? args[0] : 'rest';
  const page = h('div', { class: 'page' }); const body = h('div');
  el.append(page);
  page.append(tabs(defs.map(d => ({ id: d[0], label: t(d[1]) })), tab, id => { tab = id; draw(); }), body);
  const S = () => L.settings();
  const draw = () => { empty(body); ({ rest: drawRest, tax: drawTax, tables: drawTables, staff: drawStaff, partners: drawPartners, rules: drawRules, rewards: drawRewards, print: drawPrint, device: drawDevice, sync: drawSync })[tab](); };
  const saveBtn = fn => h('button', { class: 'btn primary lg', style: { marginTop: '.5rem' }, onClick: fn }, t('Save changes'));
  const ok = () => toast(t('Saved'), 'ok');
  const num = (v, ph) => h('input', { type: 'text', value: v ?? '', inputmode: 'decimal', 'data-kb': 'num', placeholder: ph || '' });

  // ───────── restaurant ─────────
  function drawRest() {
    const s = S();
    const nm = tri(s, 'name', t('Restaurant name'));
    const address = h('textarea', { rows: 2, value: s.address || '' }), phone = h('input', { type: 'tel', value: s.phone || '', 'data-kb': 'num' }), email = h('input', { type: 'text', value: s.email || '' });
    const gstin = h('input', { type: 'text', value: s.gstin || '', maxlength: 15, placeholder: '27AAAAA0000A1Z5', style: { textTransform: 'uppercase' } });
    const warn = h('div', { class: 'hint warn', hidden: true }, t('This GSTIN does not pass the check-digit test — please double-check it.'));
    const stateSel = h('select', null, h('option', { value: '' }, '—'), STATES.map(x => h('option', { value: x[0], selected: s.state_code === x[0] }, x[0] + ' · ' + x[1])));
    gstin.addEventListener('input', () => { gstin.value = gstin.value.toUpperCase(); if (gstin.value.length >= 2 && !stateSel.value) stateSel.value = gstinState(gstin.value); warn.hidden = gstin.value.length < 15 || validGSTIN(gstin.value); });
    const fssai = h('input', { type: 'text', value: s.fssai || '', maxlength: 14, 'data-kb': 'num' }), pan = h('input', { type: 'text', value: s.pan || '', maxlength: 10 });
    const upi = h('input', { type: 'text', value: s.upi_id || '', placeholder: 'yourshop@bank' }), upiName = h('input', { type: 'text', value: s.upi_name || '' });
    const brand = h('input', { type: 'color', value: s.brand || '#7a1f2b', style: { height: '48px', padding: '4px' } });
    let logo = s.logo || '';
    const logoBox = h('div', { class: 'imgbox' }, logo ? h('img', { src: logo }) : t('No logo'));
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onChange: async e => { const f = e.target.files[0]; if (!f) return; logo = await resizeImage(f, 360, 0.85); empty(logoBox); logoBox.append(h('img', { src: logo })); } });
    const tagline = h('input', { type: 'text', value: s.tagline || '' });
    const foot = tri({ receipt_footer: s.receipt_footer, receipt_footer_hi: s.receipt_footer_hi, receipt_footer_ur: s.receipt_footer_ur }, 'receipt_footer', t('Bill footer message'));
    body.append(h('div', { class: 'card' }, nm, field(t('Address'), address), h('div', { class: 'grid2' }, field(t('Phone'), phone), field(t('Email'), email)),
      h('h3', { style: { margin: '.6rem 0' } }, t('Tax registration')), h('div', { class: 'grid2' }, field('GSTIN', gstin), field(t('State (place of supply)'), stateSel), field('FSSAI licence no.', fssai), field('PAN', pan)), warn,
      h('h3', { style: { margin: '.6rem 0' } }, t('UPI payment QR')), h('div', { class: 'grid2' }, field(t('UPI ID (VPA)'), upi), field(t('Name shown in UPI app'), upiName)),
      h('h3', { style: { margin: '.6rem 0' } }, t('Look')), h('div', { class: 'row', style: { marginBottom: '1rem' } }, logoBox, h('label', { class: 'btn sm' }, t('Choose logo'), file), logo ? h('button', { class: 'btn sm ghost', onClick: () => { logo = ''; empty(logoBox); logoBox.append(t('No logo')); } }, t('Remove')) : null, h('div', { style: { marginInlineStart: '1rem' } }, field(t('Brand colour'), brand))), foot,
      saveBtn(() => {
        if (!nm.vals().name) return toast(t('Enter the restaurant name'), 'warn');
        const g = gstin.value.trim().toUpperCase();
        if (g && !/^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return toast(t('GSTIN must be 15 characters like 27AAAAA0000A1Z5'), 'bad', 5000);
        L.saveSettings({ ...nm.vals(), address: address.value.trim(), phone: phone.value.trim(), email: email.value.trim(), gstin: g, state_code: stateSel.value, fssai: fssai.value.trim(), pan: pan.value.trim().toUpperCase(), upi_id: upi.value.trim(), upi_name: upiName.value.trim(), logo, brand: brand.value, ...foot.vals() });
        ok();
      })));
  }

  // ───────── tax & charges ─────────
  function drawTax() {
    const s = S();
    const scheme = h('select', null, [['regular', t('Regular — Tax invoice with GST')], ['composition', t('Composition scheme — Bill of supply, no GST')], ['none', t('Not registered — plain bill')]].map(([v, l]) => h('option', { value: v, selected: s.gst_scheme === v }, l)));
    const dg = h('select', null, GST_RATES.map(r => h('option', { value: r, selected: Number(s.default_gst) === r }, r + '%')));
    const hsn = h('input', { type: 'text', value: s.default_hsn || '' });
    let incl = !!s.tax_inclusive, svcTake = !!s.service_takeaway;
    const svc = num(s.service_pct), pack = num(s.packaging_charge);
    const round = h('select', null, [[0, t('No rounding')], [1, t('Nearest ₹1')], [0.5, t('Nearest ₹0.50')], [5, t('Nearest ₹5')]].map(([v, l]) => h('option', { value: v, selected: Number(s.rounding) === v }, l)));
    const prefix = h('input', { type: 'text', value: s.bill_prefix ?? 'INV/', maxlength: 8 });
    const reset = h('select', null, [['fy', t('Restart every financial year (1 April) — recommended')], ['never', t('Never restart')]].map(([v, l]) => h('option', { value: v, selected: s.bill_reset === v }, l)));
    const tipsMode = h('select', null, [['waiter', t('Goes to the waiter who served the table')], ['pool', t('Shared equally among waiters working that day')]].map(([v, l]) => h('option', { value: v, selected: s.tips_mode === v }, l)));
    const tipPresets = h('input', { type: 'text', value: (s.tip_presets || []).join(', '), placeholder: '5, 10, 15' });
    const commDef = num(s.commission_default_pct);
    const dayStart = num(s.day_start_hour);
    // payment methods
    let methods = JSON.parse(JSON.stringify(s.payment_methods));
    const mBox = h('div');
    const dm = () => { empty(mBox); methods.forEach((m, i) => mBox.append(h('div', { class: 'row', style: { marginBottom: '.4rem' } }, h('input', { type: 'text', value: m.label, onInput: e => { m.label = e.target.value; } }), switchEl(!!m.cash, v => { m.cash = v; }, t('Cash drawer')), h('button', { class: 'icon-btn', onClick: () => { if (methods.length > 1) { methods.splice(i, 1); dm(); } } }, '✕')))); mBox.append(h('button', { class: 'btn sm', onClick: () => { methods.push({ id: 'm' + uid().slice(-5), label: '' }); dm(); } }, '+ ', t('Add method'))); };
    dm();
    const cats = h('input', { type: 'text', value: (s.expense_categories || []).join(', ') });
    body.append(h('div', { class: 'card' },
      h('h3', null, 'GST'), h('div', { class: 'grid2', style: { marginTop: '.6rem' } }, field(t('GST scheme'), scheme), field(t('Default GST rate for dishes'), dg), field(t('Default HSN / SAC'), hsn, t('996331 = restaurant service')), h('div', null, switchEl(incl, v => { incl = v; }, t('Menu prices already include GST')))),
      h('div', { class: 'hint' }, t('Restaurant food is usually 5% GST without input tax credit; AC / liquor-licensed / packaged items can differ. You can set a different rate for each dish under Menu. Check your rates with your CA.')),
      h('h3', { style: { margin: '1rem 0 .6rem' } }, t('Charges')), h('div', { class: 'grid2' }, field(t('Service charge %'), svc, t('Taxed at the same GST rate as the food')), field(t('Packaging charge per takeaway / delivery order'), pack), h('div', null, switchEl(svcTake, v => { svcTake = v; }, t('Also charge service charge on takeaway')))),
      h('h3', { style: { margin: '1rem 0 .6rem' } }, t('Invoice numbering')), h('div', { class: 'grid2' }, field(t('Invoice prefix'), prefix), field(t('Numbering'), reset), field(t('Round off the bill'), round), field(t('Business day starts at (hour, 0–23)'), dayStart, t('Sales after midnight count for the previous day until this hour'))),
      h('h3', { style: { margin: '1rem 0 .6rem' } }, t('Tips & commission')), h('div', { class: 'grid2' }, field(t('Tips are given to'), tipsMode), field(t('Tip buttons (%)'), tipPresets), field(t('Default staff commission %'), commDef)),
      h('h3', { style: { margin: '1rem 0 .6rem' } }, t('Payment methods')), mBox,
      h('h3', { style: { margin: '1rem 0 .6rem' } }, t('Expense categories')), field(t('Comma separated'), cats),
      saveBtn(() => {
        const dsh = parseNum(dayStart.value);
        L.saveSettings({ gst_scheme: scheme.value, default_gst: Number(dg.value), default_hsn: hsn.value.trim(), tax_inclusive: incl, service_pct: parseNum(svc.value), service_takeaway: svcTake, packaging_charge: parseNum(pack.value), bill_prefix: prefix.value.trim(), bill_reset: reset.value, rounding: Number(round.value), day_start_hour: dsh >= 0 && dsh < 24 ? Math.floor(dsh) : 4,
          tips_mode: tipsMode.value, tip_presets: tipPresets.value.split(',').map(x => parseNum(x)).filter(x => x > 0), commission_default_pct: parseNum(commDef.value), payment_methods: methods.filter(m => m.label.trim()), expense_categories: cats.value.split(',').map(x => x.trim()).filter(Boolean) });
        ok();
      })));
  }

  // ───────── tables, areas, waiter assignment ─────────
  function drawTables() {
    const ar = L.areas();
    body.append(h('div', { class: 'toolbar' }, h('button', { class: 'btn primary', onClick: () => editTable() }, '+ ', t('Add table')), h('button', { class: 'btn', onClick: bulkTables }, t('Add many tables')), h('button', { class: 'btn', onClick: () => editArea() }, '+ ', t('Add area')), h('span', { class: 'spacer' }),
      L.feature('guest') ? h('button', { class: 'btn', onClick: qrCards }, '🔳 ', t('Table QR cards')) : null, h('button', { class: 'btn', onClick: autoAssign }, '🧑‍🍳 ', t('Assign waiters to tables'))));
    if (ar.length) body.append(h('div', { class: 'row wrap', style: { marginBottom: '.8rem' } }, ar.map(a => h('button', { class: 'chip', onClick: () => editArea(a) }, nameOf(a) + ' ✎'))));
    body.append(dataTable([{ label: t('Table'), get: x => h('b', null, x.no) }, { label: t('Area'), get: x => nameOf(store.get('areas', x.area_id)) || '—' }, { label: t('Seats'), cls: 'r', get: x => x.seats }, { label: t('Waiter'), get: x => x.waiter_id ? L.userName(x.waiter_id) : h('span', { class: 'muted' }, t('Not assigned')) }, { label: '', get: x => h('button', { class: 'btn sm', onClick: () => editTable(x) }, t('Edit')) }], L.tables(), { empty: t('No tables yet') }));
  }
  function editArea(a) {
    const o = a || {}; const nm = tri(o, 'name', t('Area name'));
    modal({ title: t('Area'), size: 'md', body: nm, actions: [a ? { label: t('Delete'), kind: 'danger', onClick: async c => { if (L.tables().some(x => x.area_id === a.id)) { toast(t('Move the tables out of this area first'), 'warn'); return false; } store.del('areas', a.id); c(); draw(); } } : { label: t('Cancel'), kind: 'ghost' }, { label: t('Save'), kind: 'primary', onClick: c => { const v = nm.vals(); if (!v.name) return false; store.put('areas', { id: a ? a.id : uid(), ...v, sort: a ? a.sort : L.areas().length }); c(); draw(); } }] });
  }
  function editTable(tb) {
    const o = tb || { seats: 4 };
    const no = h('input', { type: 'text', value: o.no || '', placeholder: '1, 2, A1…' }), seats = num(o.seats);
    const area = h('select', null, h('option', { value: '' }, '—'), L.areas().map(a => h('option', { value: a.id, selected: o.area_id === a.id }, nameOf(a))));
    const shape = h('select', null, [['', t('Automatic')], ['round', t('Round')], ['square', t('Square')], ['rect', t('Rectangle')]].map(([v, l]) => h('option', { value: v, selected: (o.shape || '') === v }, l)));
    const wt = h('select', null, h('option', { value: '' }, t('Not assigned')), L.waiters().map(u => h('option', { value: u.id, selected: o.waiter_id === u.id }, u.name)));
    modal({ title: tb ? t('Edit table') : t('Add table'), size: 'sm', body: h('div', null, h('div', { class: 'grid2' }, field(t('Table number / name'), no), field(t('Seats'), seats)), h('div', { class: 'grid2' }, field(t('Area'), area), field(t('Table shape'), shape)), field(t('Default waiter'), wt)),
      actions: [tb ? { label: t('Delete'), kind: 'danger', onClick: async c => { if (L.orderForTable(tb.id)) { toast(t('This table has an open order'), 'warn'); return false; } store.patch('tables', tb.id, { active: false }); c(); draw(); } } : { label: t('Cancel'), kind: 'ghost' },
        { label: t('Save'), kind: 'primary', onClick: c => { const n = no.value.trim(); if (!n) return false; if (L.tables().some(x => x.id !== (tb && tb.id) && String(x.no) === n)) { toast(t('A table with this number already exists'), 'bad'); return false; }
          const lim = L.limits().max_tables; if (!tb && lim && L.tables().length >= lim) { toast(t('Table limit of your plan reached ({n})', { n: lim }), 'bad', 5000); return false; }
          store.put('tables', { id: tb ? tb.id : uid(), no: n, seats: parseInt(seats.value) || 4, shape: shape.value, area_id: area.value || null, waiter_id: wt.value || null, active: true }); c(); draw(); } }] });
  }
  function bulkTables() {
    const from = num('1'), to = num('10'), seats = num('4'); const area = h('select', null, h('option', { value: '' }, '—'), L.areas().map(a => h('option', { value: a.id }, nameOf(a))));
    modal({ title: t('Add many tables'), size: 'sm', body: h('div', null, h('div', { class: 'grid2' }, field(t('From number'), from), field(t('To number'), to)), field(t('Seats each'), seats), field(t('Area'), area)), actions: [{ label: t('Cancel'), kind: 'ghost' }, { label: t('Create'), kind: 'primary', onClick: c => {
      const a = parseInt(from.value), b = parseInt(to.value); if (!(a >= 0 && b >= a && b - a < 200)) return toast(t('Enter a valid range'), 'warn') || false;
      let n = 0; const lim = L.limits().max_tables;
      for (let i = a; i <= b; i++) { if (L.tables().some(x => String(x.no) === String(i))) continue; if (lim && L.tables().length >= lim) { toast(t('Table limit of your plan reached ({n})', { n: lim }), 'bad', 5000); break; } store.put('tables', { id: uid(), no: String(i), seats: parseInt(seats.value) || 4, area_id: area.value || null, active: true }); n++; }
      toast(t('{n} tables added', { n }), 'ok'); c(); draw();
    } }] });
  }
  function autoAssign() {
    const ws = L.waiters().filter(u => u.role === 'waiter');
    if (!ws.length) return toast(t('Add waiter logins under Staff first'), 'warn');
    const tbs = L.tables();
    const per = Math.ceil(tbs.length / ws.length);
    const rows = ws.map(w => ({ w, from: null }));
    const sel = h('select', null, [['even', t('Spread tables evenly in order')], ['clear', t('Clear all assignments')]].map(([v, l]) => h('option', { value: v }, l)));
    modal({ title: t('Assign waiters to tables'), size: 'sm', body: h('div', null, h('p', { class: 'muted' }, t('You can fine-tune any table afterwards with Edit.')), field(t('Method'), sel), h('p', null, ws.map(w => w.name).join(', '))), actions: [{ label: t('Cancel'), kind: 'ghost' }, { label: t('Apply'), kind: 'primary', onClick: c => { tbs.forEach((tb, i) => store.patch('tables', tb.id, { waiter_id: sel.value === 'clear' ? null : ws[Math.min(ws.length - 1, Math.floor(i / per))].id })); toast(t('Done'), 'ok'); c(); draw(); } }] });
  }
  function qrCards() {
    const ips = (app.info && app.info.ips) || []; const port = (app.info && app.info.port) || location.port;
    const guess = app.kind === 'local' && ips.length ? 'http://' + ips[0] + (port && port !== '80' ? ':' + port : '') + '/' : location.origin + location.pathname.replace(/[^/]*$/, '');
    const base = h('input', { type: 'text', value: guess });
    const box = h('div', { class: 'qrcards', style: { marginTop: '1rem' } });
    const d = () => { empty(box); for (const tb of L.tables()) box.append(h('div', { class: 'qrcard' }, h('div', { html: qrSvg(base.value.replace(/\/+$/, '') + '/#/t/' + encodeURIComponent(tb.no), { px: 170, margin: 1 }) }), h('b', null, t('Table') + ' ' + tb.no), h('div', null, t('Scan to order')), h('small', null, base.value))); };
    base.addEventListener('input', d); d();
    modal({ title: t('Table QR cards'), size: 'xl', body: h('div', null, h('p', { class: 'muted' }, t('Guests scan the code with their phone (same Wi-Fi) to see the menu and order. Print and stick one on each table.')), field(t('Address tablets and phones use to open the app'), base), box), actions: [{ label: '🖨 ' + t('Print'), kind: 'primary', onClick: () => { window.print(); return false; } }, { label: t('Close') }] });
  }

  // ───────── staff ─────────
  function drawStaff() {
    body.append(h('div', { class: 'toolbar' }, h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onClick: () => editUser() }, '+ ', t('Add staff login'))));
    body.append(dataTable([{ label: t('Name'), get: u => h('b', null, u.name) }, { label: t('Role'), get: u => t(u.role[0].toUpperCase() + u.role.slice(1)) }, { label: t('Username'), get: u => u.username || '—' }, { label: t('Commission'), cls: 'r', get: u => u.commission_pct === '' || u.commission_pct == null ? '—' : u.commission_pct + '%' }, { label: t('Status'), get: u => h('span', { class: 'badge ' + (u.active === false ? 'bad' : 'ok') }, u.active === false ? t('Disabled') : t('Active')) }, { label: '', get: u => h('button', { class: 'btn sm', onClick: () => editUser(u) }, t('Edit')) }], store.all('users').sort((a, b) => a.name.localeCompare(b.name)), { empty: t('No staff yet') }));
    if (store.all('users').some(u => u.demo)) body.append(h('div', { class: 'hint warn', style: { marginTop: '1rem' } }, t('Demo staff accounts (PIN 1111, 2222, 3333, 4444, 5555) were added with the sample data. Disable or delete them before going live.')));
  }
  function editUser(u) {
    const o = u || { role: 'waiter', active: true };
    const name = h('input', { type: 'text', value: o.name || '' });
    const role = h('select', null, L.ROLES.map(r => h('option', { value: r, selected: o.role === r }, t(r[0].toUpperCase() + r.slice(1)))));
    const pin = h('input', { type: 'password', inputmode: 'numeric', 'data-kb': 'pin', maxlength: 6, placeholder: u ? t('Leave blank to keep the current PIN') : '4–6 digits' });
    const uname = h('input', { type: 'text', value: o.username || '', placeholder: t('optional') }), pass = h('input', { type: 'password', placeholder: u ? t('Leave blank to keep') : t('optional') });
    const comm = num(o.commission_pct, t('default'));
    let act = o.active !== false;
    modal({ title: u ? t('Edit staff') : t('Add staff login'), size: 'md', body: h('div', null, h('div', { class: 'grid2' }, field(t('Name'), name), field(t('Role'), role), field(t('PIN (4–6 digits)'), pin), field(t('Commission % (blank = default)'), comm), field(t('Username (optional)'), uname), field(t('Password (optional)'), pass)),
      h('p', { class: 'muted' }, t('Each person signs in with their own PIN, or with username + password. Orders, bills, tips and commission are recorded against that person.')), switchEl(act, v => { act = v; }, t('Account is active'))),
      actions: [{ label: t('Cancel'), kind: 'ghost' }, { label: t('Save'), kind: 'primary', onClick: c => {
        if (!name.value.trim()) return toast(t('Enter a name'), 'warn') || false;
        if (!u && !/^\d{4,6}$/.test(pin.value)) return toast(t('PIN must be 4 to 6 digits'), 'bad') || false;
        if (pin.value && !/^\d{4,6}$/.test(pin.value)) return toast(t('PIN must be 4 to 6 digits'), 'bad') || false;
        if (pin.value && L.pinTaken(pin.value, u && u.id)) return toast(t('This PIN is already used by someone else'), 'bad') || false;
        const un = uname.value.trim().toLowerCase();
        if (un && store.all('users').some(x => x.id !== (u && u.id) && x.username && x.username.toLowerCase() === un)) return toast(t('This username is taken'), 'bad') || false;
        if (u && u.role === 'admin' && (role.value !== 'admin' || !act) && store.all('users').filter(x => x.role === 'admin' && x.active !== false && x.id !== u.id).length === 0) return toast(t('There must be at least one active admin'), 'bad') || false;
        const lim = L.limits().max_users; if (!u && lim && store.all('users').filter(x => x.active !== false).length >= lim) return toast(t('User limit of your plan reached ({n})', { n: lim }), 'bad', 5000) || false;
        const rec = { id: u ? u.id : uid(), name: name.value.trim(), role: role.value, username: un, commission_pct: comm.value.trim() === '' ? '' : parseNum(comm.value), active: act };
        if (pin.value) rec.pin = hashPin(pin.value); if (pass.value) rec.pass = hashPin(pass.value);
        store.put('users', rec); toast(t('Saved'), 'ok'); c(); draw();
      } }] });
  }

  // ───────── partners ─────────
  function drawPartners() {
    body.append(h('div', { class: 'toolbar' }, h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onClick: () => editPartner() }, '+ ', t('Add partner'))));
    body.append(dataTable([{ label: t('Name'), get: p => h('b', null, p.name) }, { label: t('Type'), get: p => t({ aggregator: 'Delivery app', agent: 'Agent / referrer', corporate: 'Corporate' }[p.kind] || p.kind) }, { label: t('Commission'), cls: 'r', get: p => p.commission_pct + '%' }, { label: '', get: p => h('button', { class: 'btn sm', onClick: () => editPartner(p) }, t('Edit')) }], store.all('partners').filter(p => p.active !== false), { empty: t('No partners yet') }));
    body.append(h('p', { class: 'muted', style: { marginTop: '.8rem' } }, t('When a takeaway or delivery order is tagged with a partner, the commission payable to them is calculated on the order value before GST and tracked under Reports → Staff earnings.')));
  }
  function editPartner(p) {
    const o = p || { kind: 'aggregator', commission_pct: 20 };
    const name = h('input', { type: 'text', value: o.name || '' }), kind = h('select', null, [['aggregator', t('Delivery app')], ['agent', t('Agent / referrer')], ['corporate', t('Corporate')]].map(([v, l]) => h('option', { value: v, selected: o.kind === v }, l))), pct = num(o.commission_pct);
    modal({ title: t('Partner'), size: 'sm', body: h('div', null, field(t('Name'), name), field(t('Type'), kind), field(t('Commission %'), pct)), actions: [p ? { label: t('Delete'), kind: 'danger', onClick: c => { store.patch('partners', p.id, { active: false }); c(); draw(); } } : { label: t('Cancel'), kind: 'ghost' }, { label: t('Save'), kind: 'primary', onClick: c => { if (!name.value.trim()) return false; store.put('partners', { id: p ? p.id : uid(), name: name.value.trim(), kind: kind.value, commission_pct: parseNum(pct.value), active: true }); c(); draw(); } }] });
  }

  // ───────── ordering & kitchen rules ─────────
  function drawRules() {
    const s = S();
    const v = { guest_ordering: !!s.guest_ordering, approve_table_orders: !!s.approve_table_orders, auto_hide_oos: !!s.auto_hide_oos, waiter_can_pay: !!s.waiter_can_pay, require_shift: !!s.require_shift, require_member_valid: s.require_member_valid !== false };
    const warn = num(s.kds_warn_min), late = num(s.kds_late_min), keep = num(s.kds_ready_keep_min), idle = num(s.idle_reset_min), lock = num(s.lock_minutes);
    let stations = JSON.parse(JSON.stringify(s.stations));
    const sBox = h('div'); const ds = () => { empty(sBox); stations.forEach((x, i) => sBox.append(h('div', { class: 'row', style: { marginBottom: '.4rem' } }, h('input', { type: 'text', value: x.name, onInput: e => { x.name = e.target.value; } }), h('button', { class: 'icon-btn', onClick: () => { if (stations.length > 1) { stations.splice(i, 1); ds(); } } }, '✕')))); sBox.append(h('button', { class: 'btn sm', onClick: () => { stations.push({ id: 's' + uid().slice(-5), name: '' }); ds(); } }, '+ ', t('Add station'))); }; ds();
    const sw = (k, label) => h('div', null, switchEl(v[k], x => { v[k] = x; }, label));
    body.append(h('div', { class: 'card' }, h('h3', { style: { marginBottom: '.6rem' } }, t('Ordering')),
      L.feature('guest') ? [sw('guest_ordering', t('Guests can order from the table tablet / QR code')), sw('approve_table_orders', t('A waiter must approve table orders before they reach the kitchen'))] : null,
      sw('auto_hide_oos', t('Mark dishes "not available" when ingredient stock runs out')), sw('waiter_can_pay', t('Waiters can take payment (otherwise only cashier / manager)')), L.feature('shifts') ? sw('require_shift', t('Cashier must open a cash shift before taking payment')) : null,
      L.feature('members') ? sw('require_member_valid', t('Reject expired / inactive membership cards')) : null,
      h('h3', { style: { margin: '1rem 0 .6rem' } }, t('Kitchen')), h('div', { class: 'grid2' }, field(t('Turn amber after (minutes)'), warn), field(t('Turn red after (minutes)'), late), field(t('Keep "ready" tickets for (minutes)'), keep)),
      h('h4', { style: { margin: '.4rem 0' } }, t('Kitchen stations')), sBox,
      h('h3', { style: { margin: '1rem 0 .6rem' } }, t('Screens')), h('div', { class: 'grid2' }, field(t('Table tablet resets after idle (minutes, 0 = never)'), idle), field(t('Auto-lock staff screens after (minutes, 0 = never)'), lock)),
      saveBtn(() => { L.saveSettings({ ...v, kds_warn_min: parseNum(warn.value), kds_late_min: parseNum(late.value), kds_ready_keep_min: parseNum(keep.value) || 10, idle_reset_min: parseNum(idle.value), lock_minutes: parseNum(lock.value), stations: stations.filter(x => x.name.trim()) }); ok(); })));
  }

  // ───────── rewards, coupons, WhatsApp, payment terminals, online orders ─────────
  function drawRewards() {
    const s = S();
    const v = { loyalty_on: !!s.loyalty_on, require_phone: !!s.require_phone, coupons_on: !!s.coupons_on, wa_on: !!s.wa_on, auto_translate: s.auto_translate !== false, ar_on: s.ar_on !== false };
    const ppc = num(s.points_per_100), pv = num(s.point_value), minr = num(s.min_redeem_points), maxp = num(s.max_redeem_pct);
    const T = JSON.parse(JSON.stringify(s.terminals || { upi: {}, card: {} }));
    const okey = h('input', { type: 'text', value: s.online_orders_key || '', placeholder: t('Secret key for the webhook') });
    const sw = (k, label) => h('div', null, switchEl(v[k], x => { v[k] = x; }, label));
    const termCard = (kind, title, hint) => {
      const c = T[kind] = Object.assign({ on: false, url: '', method: 'POST', headers: '', body: '' }, T[kind]);
      return h('div', { class: 'card', style: { marginTop: '.6rem' } }, h('b', null, title), h('div', { class: 'muted' }, hint),
        switchEl(!!c.on, x => { c.on = x; }, t('Enabled')),
        h('div', { class: 'grid2' }, field(t('Terminal address (URL)'), h('input', { type: 'text', value: c.url, placeholder: 'http://192.168.1.50:8080/pay', onInput: e => { c.url = e.target.value.trim(); } })),
          field(t('Method'), h('select', { onChange: e => { c.method = e.target.value; } }, ['POST', 'GET', 'PUT'].map(m => h('option', { value: m, selected: c.method === m }, m))))),
        field(t('Extra headers (one per line, Name: value)'), h('textarea', { rows: 2, onInput: e => { c.headers = e.target.value; } }, c.headers || '')),
        field(t('Request body'), h('textarea', { rows: 3, placeholder: '{"amount":"{amount}","ref":"{ref}","vpa":"{upi_vpa}"}', onInput: e => { c.body = e.target.value; } }, c.body || '')));
    };
    const wa = h('div', { class: 'card', style: { marginTop: '.6rem' } });
    (async () => {
      const st = await waStatus(true);
      const pid = h('input', { type: 'text', placeholder: 'Phone number ID', value: st.phone_id || '' }), tok = h('input', { type: 'password', placeholder: st.api ? '•••••••• (saved)' : 'Permanent access token' });
      wa.append(h('b', null, t('WhatsApp Business API')), h('div', { class: 'muted' }, t('Optional. Needs a Meta WhatsApp Business account. Without it you can still send offers with click-to-chat links.')),
        store.kind === 'local' ? [h('div', { class: 'grid2' }, field(t('Phone number ID'), pid), field(t('Access token'), tok)),
          h('div', { class: 'row' }, h('button', { class: 'btn sm', onClick: async () => { await waSetup({ phone_id: pid.value.trim(), token: tok.value.trim() }); toast(t('Saved'), 'ok'); } }, t('Save connection')), st.api ? h('button', { class: 'btn sm ghost', onClick: async () => { await waSetup({ disable: true }); toast(t('Disconnected'), 'ok'); drawRewards(); } }, t('Disconnect')) : null, st.api ? h('span', { class: 'badge ok' }, t('Connected')) : null)]
          : h('div', { class: 'hint warn' }, t('The token is kept on the restaurant server, so this is only available when you use the local server.')));
    })();
    body.append(h('div', { class: 'card' }, h('h3', { style: { marginBottom: '.6rem' } }, '⭐ ', t('Customers & reward points')),
      L.feature('loyalty') ? [sw('loyalty_on', t('Give reward points to returning customers (identified by mobile number)')),
        h('div', { class: 'grid2' }, field(t('Points earned per ₹100 spent'), ppc), field(t('Value of 1 point (₹)'), pv), field(t('Minimum points to redeem'), minr), field(t('Max share of a bill payable by points (%)'), maxp))] : h('p', { class: 'muted' }, t('Not enabled by your software provider.')),
      sw('require_phone', t('Ask for the customer mobile number before every bill (to keep in touch on WhatsApp)')),
      L.feature('coupons') ? sw('coupons_on', t('Coupons (create them under Customers & offers)')) : null,
      L.feature('whatsapp') ? sw('wa_on', t('WhatsApp offers & wishes')) : null),
      L.feature('whatsapp') ? wa : null,
      h('div', { class: 'card', style: { marginTop: '.6rem' } }, h('h3', { style: { marginBottom: '.6rem' } }, t('Language & viewing')),
        sw('auto_translate', t('Automatically translate screens into Hindi / Urdu where no translation exists (needs internet once)')),
        L.feature('ar3d') ? sw('ar_on', t('Let guests view dishes in 3D with the camera')) : null),
      L.feature('terminal') ? h('div', { style: { marginTop: '.6rem' } }, h('h3', null, '💳 ', t('Payment terminals')),
        h('p', { class: 'muted' }, t('The UPI QR with the exact amount is created automatically from your UPI ID (Tax & charges). To also push the amount to a payment machine, enter the machine’s address and request format from its vendor. Placeholders: {amount} {amount_paise} {order} {ref} {upi_vpa} {name} {upi_link}.')),
        termCard('upi', t('UPI soundbox / QR terminal'), t('Pushes the amount to the machine when the cashier selects UPI.')),
        termCard('card', t('Card swipe machine'), t('Sends the bill amount to the card machine on your network.'))) : null,
      L.feature('online_orders') ? h('div', { class: 'card', style: { marginTop: '.6rem' } }, h('h3', null, '🛵 ', t('Online orders (Zomato, Swiggy…)')),
        field(t('Webhook key'), h('div', { class: 'row' }, okey, h('button', { class: 'btn sm', onClick: () => { okey.value = uid().replace(/-/g, '') + uid().replace(/-/g, '').slice(0, 8); } }, t('Generate')))),
        h('small', { class: 'muted' }, t('Address for your integration partner') + ': ' + location.origin + '/api/online-order?key=…')) : null,
      saveBtn(() => { L.saveSettings({ ...v, points_per_100: parseNum(ppc.value) || 0, point_value: parseNum(pv.value) || 0, min_redeem_points: parseNum(minr.value) || 0, max_redeem_pct: parseNum(maxp.value) || 100, terminals: T, online_orders_key: okey.value.trim() }); ok(); }));
  }

  // ───────── printing ─────────
  function drawPrint() {
    let scope = Object.keys(deviceOverride()).length ? 'device' : 'shared';
    const holder = h('div');
    const drawP = () => {
      empty(holder);
      holder.append(h('div', { class: 'row wrap', style: { marginBottom: '.8rem' } }, h('span', { class: 'muted' }, t('Settings apply to')), h('div', { class: 'seg' }, [['shared', t('All devices')], ['device', t('This device only')]].map(([v, l]) => h('button', { class: 'seg-b' + (scope === v ? ' on' : ''), onClick: () => { scope = v; drawP(); } }, l)))));
      holder.append(h('p', { class: 'muted', style: { marginBottom: '1rem' } }, t('Tip: pick "This device only" when this computer or tablet has its own USB / Bluetooth printer. Use "All devices" for a network printer everyone shares.')));
      for (const kind of ['receipt', 'kot']) holder.append(printCard(kind, scope));
    };
    drawP(); body.append(holder);
  }
  function printCard(kind, scope) {
    const eff = profile(kind);
    const base = scope === 'device' ? { ...eff } : { ...L.settings().print[kind] };
    const p = { ...base };
    const paper = h('select', { onChange: e => { p.paper = e.target.value; const pp = PAPERS.find(x => x.id === p.paper); if (!pp.custom) { p.w = pp.w; p.h = pp.h; w.value = pp.w; hh.value = pp.h; if (pp.dots) { p.dots = pp.dots; dots.value = pp.dots; } } custom.hidden = !pp.custom; } }, PAPERS.map(x => h('option', { value: x.id, selected: p.paper === x.id }, x.label)));
    const w = num(p.w), hh = num(p.h), dots = num(p.dots), margin = num(p.margin), font = num(p.font), scale = num(p.scale), copies = num(p.copies);
    const custom = h('div', { class: 'grid2', hidden: !(PAPERS.find(x => x.id === p.paper) || {}).custom }, field(t('Width (mm)'), w), field(t('Height (mm, 0 = continuous roll)'), hh));
    const method = h('select', { onChange: e => { p.method = e.target.value; net.hidden = p.method !== 'network'; } }, [['browser', t('System print dialog (any printer: thermal, laser, inkjet, PDF)')], ['network', t('Direct to LAN thermal printer (no dialog, fastest)')], ['none', t('Do not print')]].filter(x => x[0] !== 'network' || L.feature('net_print')).map(([v, l]) => h('option', { value: v, selected: p.method === v }, l)));
    const host = h('input', { type: 'text', value: p.host || '', placeholder: '192.168.1.50' }), port = num(p.port || 9100);
    const stHosts = kind === 'kot' ? S().stations.map(st => ({ st, inp: h('input', { type: 'text', value: (p.hosts || {})[st.id] || '', placeholder: t('same as above') }) })) : [];
    const net = h('div', { hidden: p.method !== 'network' }, h('div', { class: 'grid2' }, field(t('Printer IP address'), host), field(t('Port'), port)), stHosts.length ? h('div', null, h('h4', { style: { margin: '.2rem 0 .4rem' } }, t('Separate printer per kitchen station (optional)')), h('div', { class: 'grid2' }, stHosts.map(x => field(x.st.name, x.inp)))) : null,
      h('div', { class: 'grid2' }, field(t('Print width in dots (58mm=384, 80mm=576)'), dots)));
    const layout = h('select', { onChange: e => { p.layout = e.target.value; } }, [['auto', t('Automatic (roll = receipt, sheet = full invoice)')], ['receipt', t('Narrow receipt')], ['invoice', t('Full A4-style invoice')]].map(([v, l]) => h('option', { value: v, selected: p.layout === v }, l)));
    const lang = h('select', { onChange: e => { p.lang = e.target.value; } }, [['en', 'English'], ['hi', 'हिन्दी'], ['ur', 'اردو'], ['en+hi', 'English + हिन्दी'], ['en+ur', 'English + اردو']].map(([v, l]) => h('option', { value: v, selected: p.lang === v }, l)));
    const tog = (k, label) => h('div', null, switchEl(!!p[k], v => { p[k] = v; }, label));
    const card = h('div', { class: 'card', style: { marginBottom: '1rem' } }, h('h3', null, kind === 'kot' ? t('Kitchen order tickets (KOT)') : t('Bills & receipts')),
      h('div', { class: 'grid2', style: { marginTop: '.6rem' } }, field(t('Paper size'), paper), field(t('How to print'), method)), custom, net,
      h('div', { class: 'grid2' }, field(t('Margin (mm)'), margin), field(t('Font size (px)'), font), field(t('Scale %'), scale), field(t('Copies'), copies), kind === 'receipt' ? field(t('Layout'), layout) : null, field(t('Print language'), lang)),
      tog('cut', t('Cut paper after printing (network printers)')), kind === 'receipt' ? tog('drawer', t('Open cash drawer (network printers)')) : null, kind === 'receipt' ? tog('logo', t('Print logo')) : null, kind === 'receipt' ? tog('qr', t('Print UPI QR')) : null, kind === 'kot' ? tog('auto', t('Print kitchen tickets automatically on this device')) : tog('auto', t('Print the bill automatically after payment')),
      h('div', { class: 'row wrap', style: { marginTop: '.8rem' } }, h('button', { class: 'btn primary', onClick: () => {
        const out = { ...p, w: parseNum(w.value), h: parseNum(hh.value), dots: parseNum(dots.value) || 576, margin: parseNum(margin.value), font: parseNum(font.value) || 12, scale: parseNum(scale.value) || 100, copies: Math.max(1, parseInt(copies.value) || 1), host: host.value.trim(), port: parseNum(port.value) || 9100 };
        if (kind === 'kot') { out.hosts = {}; stHosts.forEach(x => { if (x.inp.value.trim()) out.hosts[x.st.id] = x.inp.value.trim(); }); }
        if (scope === 'device') { const d = deviceOverride(); d[kind] = out; saveDeviceOverride(d); }
        else { const cur = L.settings().print; L.saveSettings({ print: { ...cur, [kind]: out } }); const d = deviceOverride(); if (d[kind]) { delete d[kind]; saveDeviceOverride(d); } }
        ok();
      } }, t('Save')), h('button', { class: 'btn', onClick: async () => { try { await printTest(kind); } catch (e) { toast(e.message, 'bad', 6000); } } }, '🖨 ', t('Print test page')),
        scope === 'device' && deviceOverride()[kind] ? h('button', { class: 'btn ghost', onClick: () => { const d = deviceOverride(); delete d[kind]; saveDeviceOverride(d); draw(); } }, t('Use shared settings on this device')) : null));
    return card;
  }

  // ───────── this device ─────────
  function drawDevice() {
    const mode = deviceMode();
    let kro = !!mode.readonly, role = mode.role || 'staff', table = mode.table || (L.tables()[0] || {}).id, dlang = mode.lang || 'en', station = mode.station || 'all';
    const holder = h('div');
    const drawD = () => {
      empty(holder);
      const opts = [['staff', '🧑‍🍳', t('Staff device'), t('Waiter / cashier / manager signs in with a PIN. Full app.')], L.feature('guest') ? ['table', '🍽', t('Table tablet'), t('Locked to one table. Guests browse the menu and order. Staff PIN needed to leave.')] : null, L.feature('kitchen') ? ['kitchen', '🍳', t('Kitchen screen'), t('Shows tickets only. No sign-in needed, staff PIN needed to leave.')] : null].filter(Boolean);
      holder.append(h('div', { class: 'role-grid' }, opts.map(([id, ic, name, desc]) => h('button', { class: 'role-card' + (role === id ? ' on' : ''), style: role === id ? { borderColor: 'var(--brand)', background: 'var(--brand-soft)' } : null, onClick: () => { role = id; drawD(); } }, h('span', { class: 'ic' }, ic), h('b', null, name), h('span', null, desc)))));
      const extra = h('div', { class: 'card', style: { marginTop: '1rem' } });
      if (role === 'table') extra.append(h('div', { class: 'grid2' }, field(t('Which table is this tablet on?'), h('select', { onChange: e => { table = e.target.value; } }, L.tables().map(x => h('option', { value: x.id, selected: x.id === table }, t('Table') + ' ' + x.no)))), field(t('Default language (resets after each guest)'), h('select', { onChange: e => { dlang = e.target.value; } }, LANGS.map(l => h('option', { value: l.id, selected: l.id === dlang }, l.label))))));
      if (role === 'kitchen') extra.append(h('label', { class: 'switch', style: { margin: '.2rem 0 .8rem' } }, h('input', { type: 'checkbox', checked: kro, onChange: e => { kro = e.target.checked; } }), h('span', { class: 'track' }), h('span', { class: 'lbl' }, t('Display only (no buttons) — for a wall TV'))), h('p', { class: 'muted' }, t('Any screen can also open this display directly at') + ' ' + location.origin + '/#/kds'), field(t('Show tickets for'), h('select', { onChange: e => { station = e.target.value; } }, h('option', { value: 'all' }, t('All stations')), S().stations.map(x => h('option', { value: x.id, selected: x.id === station }, x.name)))));
      extra.append(h('p', { class: 'muted' }, t('Current mode of this device') + ': ' + t({ staff: 'Staff device', table: 'Table tablet', kitchen: 'Kitchen screen' }[mode.role || 'staff'])), h('button', { class: 'btn primary lg', onClick: () => {
        if (role === 'table' && !table) return toast(t('Add tables first'), 'warn');
        setDeviceMode({ role, table, lang: dlang, station, readonly: role === 'kitchen' && kro }); if (role === 'kitchen') localStorage.setItem('restopos.kds.station', station);
        if (role === 'table') localStorage.setItem('restopos.lang', dlang);
        location.hash = '#/'; location.reload();
      } }, t('Apply to this device')));
      holder.append(extra);
    };
    drawD(); body.append(holder);
  }

  // ───────── sync & backup ─────────
  async function drawSync() {
    const box = h('div', { class: 'card' });
    box.append(h('h3', null, t('Connection')), h('p', null, app.kind === 'local' ? '🟢 ' + t('Connected to the restaurant server on this Wi-Fi network.') : app.kind === 'cloud' ? '☁ ' + t('Online mode (Supabase).') : '📴 ' + t('Standalone: data stays on this device only.')),
      h('p', { class: 'muted' }, t('Waiting to sync: {n} change(s)', { n: store.status.pending }) + (store.status.error ? ' · ' + store.status.error : '')));
    body.append(box);
    { // software updates
      const repo = h('input', { type: 'text', value: S().update_repo || '', placeholder: 'owner/repo  (e.g. ziyad/restopos)' });
      const res = h('div', { class: 'muted', style: { marginTop: '.5rem' } });
      const { VERSION } = await import('../version.js');
      const chk = async () => {
        L.saveSettings({ update_repo: repo.value.trim() }); res.textContent = t('Checking…');
        const { checkUpdate, updateDialog } = await import('../update.js');
        const r = await checkUpdate(true, repo.value.trim());
        if (!r.configured) res.textContent = t('Enter the GitHub repository first.');
        else if (!r.ok) res.textContent = t('Could not check') + ': ' + (r.error || '');
        else if (r.update) { res.textContent = t('New version') + ' ' + r.latest; updateDialog(r); }
        else res.textContent = '✓ ' + t('You are up to date') + ' (' + VERSION + ')';
      };
      body.append(h('div', { class: 'card', style: { marginTop: '1rem' } }, h('h3', null, t('Software updates')), h('p', { class: 'muted' }, t('Version') + ' ' + VERSION + ' · ' + t('RestoPOS checks GitHub once a day and shows a pop-up to managers when a newer release exists.')), field(t('GitHub repository'), repo), h('button', { class: 'btn', onClick: chk }, t('Check for updates now')), res));
    }
    if (app.kind === 'local' && L.feature('cloud')) {
      let info = app.info; try { info = await fetchJSON('api/info'); } catch (_) { /* offline */ }
      const c = info.cloud || {};
      const url = h('input', { type: 'text', value: c.url || '', placeholder: 'https://xxxx.supabase.co' }), key = h('input', { type: 'text', placeholder: t('anon public key') }), em = h('input', { type: 'text', value: c.email || '' }), pw = h('input', { type: 'password', placeholder: c.enabled ? t('leave blank to keep') : '' });
      body.append(h('div', { class: 'card', style: { marginTop: '1rem' } }, h('h3', null, t('Online backup & remote access (Supabase)')), h('p', { class: 'muted', style: { margin: '.3rem 0 .8rem' } }, t('The restaurant server keeps working offline and copies everything to Supabase whenever the internet is available.')),
        c.enabled ? h('div', { class: 'hint ' + (c.ok ? '' : 'warn') }, c.ok ? t('Connected · last sync {time} · {n} waiting', { time: fmtDateTime(c.lastOk), n: c.pending }) : t('Not connected: {e}', { e: c.error || '…' })) : null,
        h('div', { class: 'grid2' }, field('Supabase URL', url), field('anon key', key), field(t('Restaurant account email'), em), field(t('Password'), pw)),
        h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onClick: async () => { try { const r = await fetchJSON('api/cloud-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.value, key: key.value || undefined, email: em.value, password: pw.value, keepPassword: !pw.value }) }, 25000); toast(r.ok ? t('Connected to Supabase') : r.error, r.ok ? 'ok' : 'bad', 5000); drawSyncAgain(); } catch (e) { toast(e.message, 'bad', 6000); } } }, t('Save & connect')), c.enabled ? h('button', { class: 'btn ghost', onClick: async () => { await fetchJSON('api/cloud-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disable: true }) }); drawSyncAgain(); } }, t('Disconnect')) : null)));
    }
    if (app.kind === 'standalone' && L.feature('cloud')) {
      const url = h('input', { type: 'text', placeholder: 'https://xxxx.supabase.co' }), key = h('input', { type: 'text', placeholder: t('anon public key') });
      body.append(h('div', { class: 'card', style: { marginTop: '1rem' } }, h('h3', null, t('Connect to online database (Supabase)')), h('p', { class: 'muted', style: { margin: '.3rem 0 .8rem' } }, t('Use this when the app is hosted on Netlify. After saving you will sign in with the restaurant account.')), h('div', { class: 'grid2' }, field('Supabase URL', url), field('anon public key', key)),
        h('button', { class: 'btn primary', onClick: () => { if (!/^https:\/\//.test(url.value) || !key.value.trim()) return toast(t('Enter both the URL and the key'), 'warn'); saveBrowserCloud(url.value, key.value); location.reload(); } }, t('Save & reload'))));
    }
    if (L.feature('backup')) {
      body.append(h('div', { class: 'card', style: { marginTop: '1rem' } }, h('h3', null, t('Backup & restore')), h('div', { class: 'row wrap', style: { marginTop: '.6rem' } },
        h('button', { class: 'btn', onClick: backup }, '⬇ ', t('Download full backup')),
        app.kind === 'local' ? h('label', { class: 'btn' }, '⬆ ', t('Restore from backup'), h('input', { type: 'file', accept: '.json', hidden: true, onChange: restore })) : null),
        h('p', { class: 'muted', style: { marginTop: '.6rem' } }, app.kind === 'local' ? t('The server also keeps a daily copy in its data folder (last 30 days).') : t('Download a backup regularly; browsers can lose data if the user clears site data.'))));
    }
  }
  const drawSyncAgain = () => { empty(body); drawSync(); };
  async function backup() {
    if (app.kind === 'local') { const a = document.createElement('a'); a.href = 'api/backup'; a.download = ''; document.body.append(a); a.click(); a.remove(); return; }
    const recs = []; for (const c of ['settings', 'users', 'areas', 'tables', 'categories', 'items', 'stock', 'stock_moves', 'orders', 'order_items', 'members', 'partners', 'suppliers', 'expenses', 'shifts', 'payouts', 'reservations', 'calls']) for (const r of store.all(c)) recs.push(r);
    download('restopos-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify({ app: 'restopos', version: 1, at: Date.now(), meta: {}, records: recs }), 'application/json');
  }
  async function restore(e) {
    const f = e.target.files[0]; if (!f) return;
    if (!await confirmDlg(t('Replace ALL current data with this backup? A copy of the current data is kept on the server first.'), { danger: true, ok: t('Restore') })) return;
    try { const j = JSON.parse(await readFileText(f)); const r = await fetchJSON('api/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(j) }, 120000); toast(t('Restored {n} records. Reloading…', { n: r.records }), 'ok'); setTimeout(() => location.reload(), 1200); } catch (err) { toast(err.message, 'bad', 6000); }
  }
  draw();
  return {};
}
