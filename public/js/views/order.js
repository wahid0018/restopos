// Staff ordering + billing screen: /order/t/<tableId> · /order/o/<orderId> · /order/new/<takeaway|delivery>
import { h, empty, money, num, r2, sum, debounce, now, parseNum } from '../util.js';
import { store } from '../store.js';
import { t, nameOf, getLang } from '../i18n.js';
import { modal, toast, confirmDlg, pickDlg, numberDlg, promptDlg, field, stepper, closeAllModals, topModal, switchEl } from '../ui.js';
import * as L from '../logic.js';
import { go, app } from '../app.js';
import { itemTile, itemDialog, billRows, lineEl, vegDot, cartFor, modsText, statusPill, langSwitch } from './shared.js';
import { printReceipt, printKOT, profile } from '../print.js';
import { qrSvg } from '../qr.js';
import { sendToTerminal, terminalConfigured } from '../terminal.js';
import { upiLink, validGSTIN, STATES, gstinState } from '../gst.js';

export function mount(el, { args }) {
  const [kind, a1] = args;
  let tableId = kind === 't' ? a1 : null;
  let orderId = kind === 'o' ? a1 : null;
  let type = kind === 'new' ? a1 : 'dine_in';
  if (orderId) { const o = store.get('orders', orderId); if (o) { tableId = o.table_id; type = o.type; } }
  const key = orderId ? 'o' + orderId : tableId ? 't' + tableId : 'new' + type;
  const cart = cartFor(key);
  const user = L.session.user;
  let cat = null, query = '';
  const draftCustomer = { v: null };   // takeaway / delivery details before the first send

  const order = () => (orderId ? store.get('orders', orderId) : tableId ? L.orderForTable(tableId) : null);
  const table = () => store.get('tables', tableId);
  const root = h('div', { class: 'ord' });
  const main = h('div', { class: 'ord-main' });
  const bar = h('div', { class: 'ord-bar' });
  const catsEl = h('div', { class: 'cats' });
  const itemsEl = h('div', { class: 'items' });
  const cartEl = h('aside', { class: 'cart' });
  const cartBar = h('button', { class: 'mobile-cartbar', type: 'button', onClick: () => cartEl.classList.add('open') });
  main.append(bar, catsEl, itemsEl);
  root.append(main, cartEl, cartBar);
  el.append(root);

  const lines = () => { const o = order(); return o ? L.itemsOf(o.id) : []; };
  const canEditOrder = () => !order() || order().status === 'open';

  // ───── header bar ─────
  function drawBar() {
    empty(bar);
    const o = order();
    const tb = table();
    bar.append(h('button', { class: 'btn sm', onClick: () => go('/tables') }, '← ', t('Tables')));
    bar.append(h('span', { class: 'tname' }, tb ? t('Table') + ' ' + tb.no : t(type === 'delivery' ? 'Delivery' : 'Takeaway'), o && o.no != null ? h('small', { class: 'muted' }, ' · #' + o.no) : null));
    bar.append(h('input', { type: 'search', class: 'ord-search', placeholder: t('Search menu…'), value: query, onInput: e => { query = e.target.value; drawItems(); } }));
    bar.append(h('span', { class: 'spacer' }));
    const w = o ? o.waiter_id : (tb && tb.waiter_id);
    if (L.feature('tables') && (o || tb)) bar.append(h('button', { class: 'chip', title: t('Assign waiter'), onClick: assignWaiter }, '🧑‍🍳 ', w ? L.userName(w) : t('No waiter')));
    if (L.feature('members') && L.can('members') && o) bar.append(h('button', { class: 'chip' + (o.member_id ? ' on' : ''), onClick: memberDialog }, '💳 ', o.member_id ? o.member_name + ' · ' + o.member_pct + '%' : t('Member')));
    if (o && rewardsOn()) bar.append(h('button', { class: 'chip' + (o.customer_id || o.coupon ? ' on' : ''), onClick: () => rewardsDialog(), title: t('Rewards') }, '🎁 ', o.customer_phone ? (o.customer_name || o.customer_phone) + (o.customer_id ? ' · ' + L.pointsOf(o.customer_id) + ' ' + t('pts') : '') : t('Rewards')));
    if (type !== 'dine_in' || (o && L.can('pos'))) bar.append(h('button', { class: 'chip' + (hasCustomer() ? ' on' : ''), onClick: customerDialog }, '👤 ', hasCustomer() ? (curCustomer().name || curCustomer().phone || 'GSTIN') : t('Customer')));
    if (type !== 'dine_in' && L.feature('partners') && L.partners().length) bar.append(h('button', { class: 'chip' + (curPartner() ? ' on' : ''), onClick: partnerDialog }, '🛵 ', curPartner() ? curPartner().name : t('Partner')));
    bar.append(h('button', { class: 'icon-btn', title: t('More'), onClick: moreMenu }, '⋮'));
  }
  const curCustomer = () => { const o = order(); return (o ? o.customer : draftCustomer.v) || {}; };
  const hasCustomer = () => Object.values(curCustomer()).some(Boolean);
  const curPartner = () => { const o = order(); const id = o ? o.partner_id : draftCustomer.partner; return id ? store.get('partners', id) : null; };

  // ───── categories + items ─────
  function drawCats() {
    empty(catsEl);
    const cats = L.categories();
    if (!cat || (cat !== 'all' && !cats.find(c => c.id === cat))) cat = cats.length ? cats[0].id : 'all';
    catsEl.append(h('button', { class: 'cat' + (cat === 'all' ? ' on' : ''), onClick: () => { cat = 'all'; drawCats(); drawItems(); } }, t('All')));
    for (const c of cats) catsEl.append(h('button', { class: 'cat' + (cat === c.id ? ' on' : ''), onClick: () => { cat = c.id; drawCats(); drawItems(); } }, nameOf(c)));
  }
  function drawItems() {
    const sc = itemsEl.scrollTop;
    empty(itemsEl);
    const q = query.trim().toLowerCase();
    let list = L.menuItems();
    if (q) list = list.filter(i => [i.name, i.name_hi, i.name_ur, i.desc].some(x => x && String(x).toLowerCase().includes(q)));
    else if (cat !== 'all') list = list.filter(i => i.category_id === cat);
    if (!list.length) itemsEl.append(h('div', { class: 'empty', style: { gridColumn: '1/-1' } }, h('b', null, L.menuItems().length ? t('Nothing found') : t('The menu is empty')), L.menuItems().length ? null : h('p', null, t('Add dishes under Menu.'))));
    for (const it of list) itemsEl.append(itemTile(it, { inCart: cart.qtyOf(it.id), showImg: !!it.img, onClick: addItem, off: !L.itemAvailable(it) ? t('Out of stock') : null }));
    itemsEl.scrollTop = sc;
  }
  async function addItem(item) {
    if (!canEditOrder()) return toast(t('This bill is already closed'), 'warn');
    if (item.modifiers && item.modifiers.length) { const r = await itemDialog(item); if (r) cart.add(item, r); }
    else cart.add(item, { qty: 1, mods: [], note: '' });
    drawItems(); drawCart();
  }

  // ───── cart ─────
  function drawCart() {
    empty(cartEl);
    const o = order();
    const sent = lines();
    const pend = sent.filter(l => l.status === 'pending');
    const active = sent.filter(l => l.status !== 'pending');
    const totals = L.calcTotals(o || { type }, active.concat(cart.asItems()));
    const body = h('div', { class: 'cart-b' });
    // approval queue (guest orders waiting)
    if (pend.length) {
      body.append(h('div', { class: 'sec-h' }, t('Table orders waiting for approval'), h('button', { class: 'btn sm primary', onClick: () => { L.approveLines(pend, user.id); toast(t('Sent to kitchen'), 'ok'); } }, t('Approve all'))));
      for (const l of pend) body.append(lineEl(l, { actions: [h('button', { class: 'btn sm', onClick: () => L.approveLines([l], user.id) }, t('Approve')), h('button', { class: 'btn sm ghost', onClick: () => L.voidLine(l, 'Rejected', user.id) }, t('Reject'))] }));
    }
    if (cart.lines.length) {
      body.append(h('div', { class: 'sec-h' }, t('New items'), h('button', { class: 'btn sm ghost', onClick: () => { cart.clear(); drawItems(); drawCart(); } }, t('Clear'))));
      for (const l of cart.lines) {
        const stp = stepper(l.qty, { min: 1, max: 99, onChange: n => { l.qty = n; drawItems(); drawCart(); } });
        body.append(lineEl(l, { actions: [stp, h('button', { class: 'btn sm ghost', onClick: async () => { const r = await itemDialog(l.item, { qty: l.qty, note: l.note, sel: l.sel }); if (r) { const i = cart.lines.indexOf(l); const nl = L.makeLine(l.item, r.qty, r.mods, r.note); Object.assign(l, nl, { sel: r.sel, item: l.item }); drawCart(); } } }, '✎'),
          h('button', { class: 'btn sm ghost', onClick: () => { cart.lines.splice(cart.lines.indexOf(l), 1); drawItems(); drawCart(); } }, '✕')] }));
      }
    }
    if (active.length) {
      const rounds = [...new Set(active.map(l => l.round || 1))];
      body.append(h('div', { class: 'sec-h' }, t('Ordered'), h('button', { class: 'btn sm ghost', onClick: reprintKot }, '🖨 KOT')));
      for (const l of active) {
        const acts = [];
        if (l.status === 'ready') acts.push(h('button', { class: 'btn sm ok', onClick: () => L.setLineStatus([l], 'served') }, t('Mark served')));
        if (l.status !== 'void' && canEditOrder()) {
          if (l.status === 'new' || L.can('void')) acts.push(h('button', { class: 'btn sm ghost', onClick: () => voidLine(l) }, t('Cancel item')));
          if (l.status === 'new') acts.push(h('button', { class: 'btn sm ghost', onClick: () => L.changeQty(l, l.qty + 1, user.id) }, '+1'));
        }
        body.append(lineEl(l, { actions: acts.length ? acts : null }));
      }
    }
    if (!body.children.length) body.append(h('div', { class: 'empty' }, h('b', null, t('No items yet')), h('p', null, t('Tap a dish to add it.'))));
    const f = h('div', { class: 'cart-f' }, ...billRows(totals, { compact: true }));
    f.append(h('div', { class: 'tot-row grand' }, h('span', null, t('Total')), h('span', { class: 'num' }, money(totals.total))));
    const btns = h('div', { class: 'row', style: { gap: '.5rem' } });
    if (cart.lines.length) btns.append(h('button', { class: 'btn primary lg', style: { flex: 1 }, onClick: send }, t('Send to kitchen'), ' (', cart.count(), ')'));
    if (o && active.some(l => l.status !== 'void') && canEditOrder()) {
      if (L.can('pay')) btns.append(h('button', { class: 'btn brand lg', style: { flex: 1 }, disabled: !!cart.lines.length, onClick: async () => { if (L.settings().require_phone && !(order() || {}).customer_phone) { await rewardsDialog(true); if (!(order() || {}).customer_phone) return; } payDialog(order()); } }, t('Bill & pay')));
      else btns.append(h('button', { class: 'btn brand lg', style: { flex: 1 }, onClick: () => { L.requestBill(o); toast(t('Cashier notified'), 'ok'); } }, t('Request bill')));
    }
    if (o && L.can('print') && active.some(l => l.status !== 'void')) btns.append(h('button', { class: 'btn lg', title: t('Print bill'), onClick: () => printBill(o) }, '🖨'));
    cartEl.append(h('div', { class: 'cart-h' }, h('h3', null, t('Order')), h('button', { class: 'icon-btn mobile-only', onClick: () => cartEl.classList.remove('open') }, '✕')), body, f);
    f.append(btns);
    cartBar.replaceChildren(h('span', null, '🛒 ', cart.count() + sum(active.filter(l => l.status !== 'void'), l => l.qty), ' ', t('items')), h('span', { class: 'num' }, money(totals.total)));
    cartBar.hidden = !(cart.count() || active.length);
  }

  // ───── actions ─────
  async function send() {
    if (!cart.lines.length) return;
    let o = order();
    const first = !o;
    if (first && type === 'dine_in' && table()) {
      // new table: ask how many guests (one tap)
      const g = await numberDlg({ title: t('How many guests?'), decimals: false, value: '', quick: [1, 2, 3, 4, 5, 6], ok: t('Continue') });
      if (g === null) return;
      return doSend(g || null);
    }
    doSend(null);
  }
  function doSend(guests) {
    const payload = cart.lines.map(l => ({ item_id: l.item_id, name: l.name, name_hi: l.name_hi, name_ur: l.name_ur, qty: l.qty, price: l.price, mods: l.mods, note: l.note, station: l.station, gst: l.gst, hsn: l.hsn, veg: l.veg, comm: l.comm }));
    const res = L.placeOrder({ order: order(), tableId, type, lines: payload, source: 'waiter', userId: user.id, guests, customer: draftCustomer.v });
    if (!order() || order().id !== res.order.id) orderId = res.order.id;
    orderId = res.order.id;
    if (draftCustomer.partner && !res.order.partner_id) { const p = store.get('partners', draftCustomer.partner); store.patch('orders', res.order.id, { partner_id: p.id, partner_pct: Number(p.commission_pct) || 0 }); }
    draftCustomer.v = null; draftCustomer.partner = null;
    cart.clear();
    toast(t('Sent to kitchen'), 'ok');
    cartEl.classList.remove('open');
    if (type === 'dine_in') go('/tables'); else { drawBar(); drawItems(); drawCart(); }
  }
  async function voidLine(l) {
    const reason = await promptDlg({ title: t('Cancel item'), label: t('Reason'), placeholder: t('e.g. customer changed mind'), ok: t('Cancel item') });
    if (reason === null) return;
    L.voidLine(l, reason, user.id);
    toast(t('Item cancelled'));
  }
  function reprintKot() {
    const o = order(); if (!o) return;
    const act = lines().filter(l => l.status !== 'void' && l.status !== 'pending');
    const last = Math.max(...act.map(l => l.round || 1));
    const byStation = new Map();
    for (const l of act.filter(l => (l.round || 1) === last)) { if (!byStation.has(l.station)) byStation.set(l.station, []); byStation.get(l.station).push(l); }
    (async () => { for (const [st, ls] of byStation) { try { await printKOT(o, ls, st); } catch (e) { toast(e.message, 'bad', 5000); } } })();
  }
  async function printBill(o) {
    try { await printReceipt(o, { provisional: false }); } catch (e) { toast(e.message, 'bad', 5000); }
  }
  async function assignWaiter() {
    const list = L.waiters();
    const v = await pickDlg({ title: t('Assign waiter'), options: [{ value: '', label: t('No waiter') }].concat(list.map(u => ({ value: u.id, label: u.name, sub: t(u.role[0].toUpperCase() + u.role.slice(1)) }))) });
    if (v === null) return;
    const o = order();
    if (o) L.setWaiter(o, v || null); else if (tableId) store.patch('tables', tableId, { waiter_id: v || null });
    toast(t('Waiter assigned'), 'ok');
  }
  async function partnerDialog() {
    const list = L.partners();
    const v = await pickDlg({ title: t('Order from'), options: [{ value: '', label: t('Direct (own customer)') }].concat(list.map(p => ({ value: p.id, label: p.name, sub: p.commission_pct + '% ' + t('commission') }))) });
    if (v === null) return;
    const o = order();
    const p = v ? store.get('partners', v) : null;
    if (o) store.patch('orders', o.id, { partner_id: v || null, partner_pct: p ? Number(p.commission_pct) || 0 : 0 }); else draftCustomer.partner = v || null;
    drawBar();
  }
  function moreMenu() {
    const o = order();
    const opts = [];
    if (table() && o && canEditOrder()) opts.push({ value: 'move', label: t('Move / merge table') });
    if (o && L.can('discount') && L.feature('discounts')) opts.push({ value: 'disc', label: t('Discount'), sub: o.discount ? o.discount.value + (o.discount.type === 'pct' ? '%' : '') : '' });
    if (o && table()) opts.push({ value: 'guests', label: t('Number of guests'), sub: o.guests || '' });
    if (o) opts.push({ value: 'note', label: t('Order note') });
    if (o && L.can('void') && canEditOrder()) opts.push({ value: 'void', label: t('Cancel whole order'), danger: true });
    if (!opts.length) return;
    pickDlg({ title: t('More'), options: opts }).then(async v => {
      if (v === 'move') moveDialog(); else if (v === 'disc') discountDialog(); else if (v === 'void') voidWhole();
      else if (v === 'guests') { const g = await numberDlg({ title: t('Number of guests'), decimals: false, value: o.guests || '', quick: [1, 2, 3, 4, 5, 6] }); if (g !== null) store.patch('orders', o.id, { guests: g }); }
      else if (v === 'note') { const n = await promptDlg({ title: t('Order note'), value: o.note || '', multiline: true }); if (n !== null) store.patch('orders', o.id, { note: n }); }
    });
  }
  async function moveDialog() {
    const o = order();
    const opts = L.tables().filter(x => x.id !== tableId).map(x => { const st = L.tableState(x); return { value: x.id, label: t('Table') + ' ' + x.no, sub: st.order ? t('Occupied — will merge') : t('Free') }; });
    const v = await pickDlg({ title: t('Move to table'), options: opts });
    if (!v) return;
    const target = L.moveOrder(o, v);
    toast(t('Moved'), 'ok');
    go('/order/t/' + v);
  }
  async function discountDialog() {
    const o = order();
    const ty = await pickDlg({ title: t('Discount'), options: [{ value: 'pct', label: t('Percentage (%)') }, { value: 'amt', label: t('Fixed amount') }, { value: 'none', label: t('Remove discount'), danger: true }] });
    if (!ty) return;
    if (ty === 'none') return L.setDiscount(o, null);
    const v = await numberDlg({ title: ty === 'pct' ? t('Discount %') : t('Discount amount'), value: o.discount ? o.discount.value : '', quick: ty === 'pct' ? [5, 10, 15, 20] : null });
    if (v !== null) L.setDiscount(o, { type: ty, value: v });
  }
  async function voidWhole() {
    const o = order();
    if (!await confirmDlg(t('Cancel this entire order?'), { danger: true, ok: t('Cancel order') })) return;
    const reason = await promptDlg({ title: t('Reason'), label: t('Reason') });
    L.voidOrder(o, reason || '', user.id);
    go('/tables');
  }

  // ───── member card ─────
  function memberDialog() {
    const o = order();
    if (!o) return toast(t('Add items first'), 'warn');
    const inp = h('input', { type: 'text', placeholder: t('Card number or phone'), 'data-kb': 'num', inputmode: 'numeric', autofocus: true });
    const out = h('div', { style: { marginTop: '.6rem' } });
    let found = null;
    const lookup = () => {
      empty(out); found = null;
      const q = inp.value.trim(); if (!q) return;
      const m = L.findMember(q);
      if (!m) { out.append(h('div', { class: 'hint bad' }, t('No member with this card number.'))); return; }
      const st = L.memberStatus(m);
      found = m;
      const stats = L.memberStats(m);
      out.append(h('div', { class: 'card' }, h('div', { class: 'row sp' }, h('h3', null, m.name), h('span', { class: 'badge ' + (st === 'ok' ? 'ok' : 'bad') }, st === 'ok' ? t('Valid') : st === 'expired' ? t('Expired') : t('Inactive'))),
        h('p', { class: 'muted' }, t('Card') + ' ' + m.card_no + (m.phone ? ' · ' + m.phone : '') + (m.plan ? ' · ' + m.plan : '')),
        h('div', { class: 'big-total' }, m.discount_pct + '% ', h('small', { class: 'muted', style: { fontSize: '1rem' } }, t('discount'))),
        h('p', { class: 'muted center' }, t('{n} visits · saved {amt}', { n: stats.visits, amt: money(stats.saved) })),
        m.valid_until ? h('p', { class: 'muted center' }, t('Valid until') + ' ' + m.valid_until) : null));
      if (st !== 'ok' && L.settings().require_member_valid) found = null;
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); lookup(); } });
    inp.addEventListener('input', () => { if (inp.value.trim().length >= 4) lookup(); });
    const m = modal({
      title: t('Membership card'), size: 'sm', body: h('div', { class: 'no-enter' }, o.member_id ? h('div', { class: 'hint' }, t('Applied') + ': ' + o.member_name + ' · ' + o.member_pct + '%') : null, h('label', { class: 'field' }, h('span', null, t('Scan or type the card number')), inp), out),
      actions: [o.member_id ? { label: t('Remove member'), kind: 'ghost', onClick: c => { L.detachMember(o); c(); } } : { label: t('Cancel'), kind: 'ghost' },
        { label: t('Apply discount'), kind: 'primary', onClick: c => { if (!found) { lookup(); if (!found) return false; } L.attachMember(o, found); toast(t('Member discount applied'), 'ok'); c(); } }]
    });
  }

  // ───── customer / GSTIN ─────
  function customerDialog() {
    const c = curCustomer();
    const name = h('input', { type: 'text', value: c.name || '' });
    const phone = h('input', { type: 'tel', value: c.phone || '', 'data-kb': 'num', inputmode: 'tel' });
    const addr = h('textarea', { rows: 2, value: c.address || '' });
    const gstin = h('input', { type: 'text', value: c.gstin || '', maxlength: 15, placeholder: '27AAAAA0000A1Z5', style: { textTransform: 'uppercase' } });
    const st = h('select', null, h('option', { value: '' }, '—'), STATES.map(s => h('option', { value: s[0], selected: String(c.state_code) === s[0] }, s[0] + ' · ' + s[1])));
    const warn = h('div', { class: 'hint warn', hidden: true });
    gstin.addEventListener('input', () => {
      const g = gstin.value.toUpperCase(); gstin.value = g;
      if (g.length >= 2 && !st.value) st.value = gstinState(g);
      warn.hidden = g.length < 15 || validGSTIN(g);
      warn.textContent = t('This GSTIN does not pass the check-digit test — please double-check it.');
    });
    modal({
      title: t('Customer details'), size: 'md', body: h('div', null, h('div', { class: 'grid2' }, field(t('Name'), name), field(t('Phone'), phone)),
        type === 'delivery' ? field(t('Delivery address'), addr) : null,
        h('div', { class: 'grid2' }, field(t('Customer GSTIN (for B2B invoice)'), gstin), field(t('State'), st)), warn,
        h('p', { class: 'muted' }, t('If the GSTIN belongs to another state the bill uses IGST instead of CGST + SGST.'))),
      actions: [{ label: t('Cancel'), kind: 'ghost' }, { label: t('Save'), kind: 'primary', onClick: close => {
        const cust = { name: name.value.trim(), phone: phone.value.trim(), address: addr.value.trim(), gstin: gstin.value.trim().toUpperCase(), state_code: st.value };
        const o = order(); if (o) L.setCustomer(o, cust); else draftCustomer.v = Object.values(cust).some(Boolean) ? cust : null;
        close(); drawBar(); drawCart();
      } }]
    });
  }

  // ───── rewards: mobile number, reward points, coupon ─────
  const rewardsOn = () => { const st = L.settings(); return (st.loyalty_on && L.feature('loyalty')) || (st.coupons_on && L.feature('coupons')) || st.require_phone; };
  function rewardsDialog(mandatory = false) {
    return new Promise(resolve => {
      const o0 = order();
      if (!o0) { toast(t('Add items first'), 'warn'); return resolve(false); }
      const st = L.settings();
      const loy = st.loyalty_on && L.feature('loyalty'), cpn = st.coupons_on && L.feature('coupons');
      const phone = h('input', { type: 'tel', maxlength: 10, 'data-kb': 'num', inputmode: 'numeric', value: o0.customer_phone || '', placeholder: t('Mobile number (10 digits)') });
      const name = h('input', { type: 'text', value: o0.customer_name || '', placeholder: t('Customer name') });
      const bday = h('input', { type: 'date' }), ann = h('input', { type: 'date' });
      let optin = true;
      const info = h('div', { style: { margin: '.5rem 0' } });
      const redeem = h('input', { type: 'number', min: 0, step: 1, value: o0.points_used || 0, 'data-kb': 'num', style: { maxWidth: '8rem' } });
      const cpIn = h('input', { type: 'text', placeholder: t('Coupon code'), style: { textTransform: 'uppercase' }, value: (o0.coupon && o0.coupon.code) || '' });
      const cpMsg = h('div', { class: 'hint', hidden: true });
      const ptsBox = h('div');
      const fresh = () => order() || o0;
      const lookup = () => {
        empty(info); empty(ptsBox);
        const c = L.customerByPhone(phone.value);
        if (c) {
          if (!name.value) name.value = c.name || '';
          bday.value = c.birthday || ''; ann.value = c.anniversary || ''; optin = c.optin !== false;
          const stt = L.customerStats(c);
          info.append(h('div', { class: 'hint' }, t('Returning customer') + ' · ' + stt.visits + ' ' + t('visits')));
          if (loy) {
            const bal = stt.points, pv = Number(st.point_value) || 0;
            ptsBox.append(h('div', { class: 'card', style: { marginTop: '.5rem' } }, h('div', { class: 'row sp' }, h('b', null, '⭐ ' + bal + ' ' + t('points')), h('span', { class: 'muted' }, '1 ' + t('point') + ' = ' + money(pv))),
              h('div', { class: 'row', style: { marginTop: '.5rem' } }, h('span', null, t('Redeem points')), redeem, h('button', { class: 'btn sm', onClick: () => { redeem.value = bal; } }, t('Max')), h('button', { class: 'btn sm ghost', onClick: () => { redeem.value = 0; } }, t('None'))),
              h('small', { class: 'muted' }, t('Minimum {n} points to redeem', { n: st.min_redeem_points }))));
          }
        } else if (L.cleanPhone(phone.value).length === 10) info.append(h('div', { class: 'hint' }, t('New customer — will be saved')));
      };
      phone.addEventListener('input', () => { phone.value = phone.value.replace(/\D/g, '').slice(0, 10); if (phone.value.length === 10) lookup(); else { empty(info); empty(ptsBox); } });
      const save = () => {
        const ph = L.cleanPhone(phone.value);
        if (ph.length === 10) { L.attachCustomer(fresh(), { phone: ph, name: name.value.trim(), birthday: bday.value, anniversary: ann.value, optin }); if (loy) L.setPointsUsed(fresh(), Number(redeem.value) || 0); }
        else if (phone.value.trim()) { toast(t('Enter a 10-digit mobile number'), 'warn'); return false; }
        else if (fresh().customer_id) L.detachCustomer(fresh());
        if (mandatory && st.require_phone && !fresh().customer_phone) { toast(t('Customer mobile number is required'), 'warn'); return false; }
        return true;
      };
      const applyCp = () => {
        if (L.cleanPhone(phone.value).length === 10) L.attachCustomer(fresh(), { phone: phone.value, name: name.value.trim() });
        const r = L.applyCoupon(fresh(), cpIn.value);
        cpMsg.hidden = false; cpMsg.className = 'hint ' + (r.ok ? '' : 'bad');
        cpMsg.textContent = r.ok ? t('Coupon applied') + ': ' + r.coupon.code + (r.coupon.kind === 'pct' ? ' (' + r.coupon.value + '%)' : ' (' + money(r.coupon.value) + ')') : t(r.reason);
        drawCart(); drawBar();
      };
      const body = h('div', { class: 'no-enter' },
        mandatory && st.require_phone ? h('p', { class: 'muted' }, t('Please take the customer mobile number — we send bills, offers and wishes on WhatsApp.')) : null,
        h('div', { class: 'grid2' }, field(t('Mobile number'), phone), field(t('Name'), name)), info,
        h('details', null, h('summary', { class: 'muted' }, t('Birthday & anniversary (optional)')), h('div', { class: 'grid2', style: { marginTop: '.4rem' } }, field(t('Birthday'), bday), field(t('Anniversary'), ann))),
        h('div', { style: { marginTop: '.4rem' } }, switchEl(true, v => { optin = v; }, t('Customer agrees to receive offers on WhatsApp / SMS'))),
        ptsBox,
        cpn ? h('div', { class: 'card', style: { marginTop: '.6rem' } }, h('b', null, '🏷 ' + t('Coupon')), h('div', { class: 'row', style: { marginTop: '.4rem' } }, cpIn, h('button', { class: 'btn sm', onClick: applyCp }, t('Apply')), o0.coupon ? h('button', { class: 'btn sm ghost', onClick: () => { L.removeCoupon(fresh()); cpIn.value = ''; cpMsg.hidden = true; drawCart(); drawBar(); } }, t('Remove')) : null), cpMsg) : null);
      const m = modal({ title: '🎁 ' + t('Rewards'), size: 'sm', body, dismiss: !mandatory, onClose: () => { drawBar(); drawCart(); resolve(!!fresh().customer_phone || !mandatory); },
        actions: [mandatory ? null : { label: t('Cancel'), kind: 'ghost' }, { label: t('Save'), kind: 'primary', onClick: close => { if (save() === false) return false; close(); } }].filter(Boolean) });
      if (L.cleanPhone(phone.value).length === 10) lookup();
    });
  }

  // ───── payment ─────
  function payDialog(o) {
    const s = L.settings();
    if (s.require_shift && L.feature('shifts') && !L.currentShift()) {
      toast(t('Open your cash shift first'), 'warn'); return go('/cash');
    }
    const tt = L.orderTotals(o);
    let tip = Number(o.tip) || 0;
    const methods = s.payment_methods;
    let pays = [{ method: methods[0].id, amount: tt.total + tip }];
    const split = L.feature('split');
    const grand = () => r2(tt.total + tip);
    const body = h('div');
    const clearDisplay = () => { const cur = store.get('orders', o.id); if (cur && cur.pay_display) store.patch('orders', o.id, { pay_display: null }); };
    const draw = () => {
      empty(body);
      if (!pays.some(p => p.method === 'upi')) clearDisplay();
      body.append(h('div', { class: 'card', style: { marginBottom: '.8rem' } }, ...billRows(tt)));
      if (L.feature('tips') && s.tip_presets && s.tip_presets.length) {
        const chips = h('div', { class: 'pay-methods' }, h('span', { class: 'muted', style: { alignSelf: 'center' } }, t('Tip'), ':'),
          h('button', { class: 'chip' + (tip === 0 ? ' on' : ''), onClick: () => setTip(0) }, t('None')),
          s.tip_presets.map(p => { const v = r2(tt.total * p / 100); return h('button', { class: 'chip' + (tip === v ? ' on' : ''), onClick: () => setTip(v) }, p + '%'); }),
          h('button', { class: 'chip' + (tip && !s.tip_presets.some(p => r2(tt.total * p / 100) === tip) ? ' on' : ''), onClick: async () => { const v = await numberDlg({ title: t('Tip amount'), value: tip || '' }); if (v !== null) setTip(v); } }, t('Custom')));
        body.append(chips);
        if (tip) body.append(h('div', { class: 'tot-row' }, h('span', null, t('Tip')), h('span', { class: 'num' }, money(tip))));
      }
      body.append(h('div', { class: 'big-total' }, money(grand())));
      // payment rows
      pays.forEach((p, i) => {
        const m = methods.find(x => x.id === p.method) || methods[0];
        const sel = h('select', { style: { maxWidth: '180px' }, onChange: e => { p.method = e.target.value; draw(); } }, methods.map(x => h('option', { value: x.id, selected: x.id === p.method }, x.label)));
        const amt = h('button', { class: 'btn', style: { flex: 1, justifyContent: 'space-between' }, onClick: async () => { const v = await numberDlg({ title: t('Amount received') + ' — ' + m.label, value: p.amount || '', quick: m.cash ? [grand(), Math.ceil(grand() / 100) * 100, Math.ceil(grand() / 500) * 500, 2000].filter((x, j, a) => a.indexOf(x) === j) : [grand()] }); if (v !== null) { p.amount = v; draw(); } } }, h('span', null, t('Amount')), h('b', { class: 'num' }, money(p.amount)));
        body.append(h('div', { class: 'pay-row' }, sel, amt, pays.length > 1 ? h('button', { class: 'icon-btn', onClick: () => { pays.splice(i, 1); draw(); } }, '✕') : null));
        if (m.id === 'upi' && s.upi_id && L.feature('upi_qr') && i === 0) {
          const due = Math.max(0, r2(grand() - sum(pays.filter((x, j) => j !== i), x => x.amount)));
          body.append(h('div', { class: 'center', html: qrSvg(upiLink({ vpa: s.upi_id, name: s.upi_name || s.name, amount: pays.length === 1 ? grand() : due, note: 'Order ' + (o.no || '') }), { px: 170, margin: 2 }) }), h('p', { class: 'muted center' }, t('Customer scans this UPI QR · {amt}', { amt: money(pays.length === 1 ? grand() : due) })));
          if (L.feature('terminal')) {
            const amtU = pays.length === 1 ? grand() : due;
            const pd = { amount: amtU, link: upiLink({ vpa: s.upi_id, name: s.upi_name || s.name, amount: amtU, note: 'Order ' + (o.no || '') }) };
            if (!o.pay_display || o.pay_display.amount !== pd.amount) store.patch('orders', o.id, { pay_display: pd });
          }
        }
        if (L.feature('terminal') && (m.id === 'upi' || m.id === 'card')) {
          const rowAmt = m.id === 'upi' && i === 0 && pays.length === 1 ? grand() : p.amount;
          const acts = [];
          if (m.id === 'upi' && s.upi_id) acts.push(h('button', { class: 'btn sm', onClick: () => window.open('#/pay/' + o.id, 'restopos_pay', 'width=520,height=760') }, '🖥 ', t('Show on customer screen')));
          if (terminalConfigured(m.id)) acts.push(h('button', { class: 'btn sm', onClick: async e => { const b = e.currentTarget; b.disabled = true; try { await sendToTerminal(m.id, o, rowAmt); toast(t('Sent to terminal — wait for the customer to pay, then press Collect payment'), 'ok', 5000); } catch (err) { toast(err.message, 'bad', 6000); } b.disabled = false; } }, '📲 ', m.id === 'card' ? t('Send to card machine') : t('Send to payment terminal'), ' · ', money(rowAmt)));
          if (acts.length) body.append(h('div', { class: 'row', style: { margin: '.3rem 0 .6rem', flexWrap: 'wrap' } }, acts));
        }
      });
      const paid = sum(pays, p => p.amount);
      const due = r2(grand() - paid);
      const cashRow = pays.find(p => (methods.find(x => x.id === p.method) || {}).cash);
      const change = due < 0 && cashRow ? Math.min(-due, cashRow.amount) : 0;
      if (split && pays.length < methods.length) body.append(h('button', { class: 'btn sm', onClick: () => { const used = new Set(pays.map(p => p.method)); const nx = methods.find(x => !used.has(x.id)); pays.push({ method: nx.id, amount: Math.max(0, due) }); if (due > 0) { /* keep first as is */ } draw(); } }, '+ ', t('Split payment')));
      body.append(due > 0.004 ? h('div', { class: 'hint bad' }, t('Balance to collect: {amt}', { amt: money(due) })) : change > 0 ? h('div', { class: 'change-box' }, h('small', null, t('Return to customer')), h('b', null, money(change))) : h('div', { class: 'hint' }, t('Fully paid ✓')));
      payBtn.disabled = due > 0.004 || (due < -0.004 && !change) || grand() <= 0 && tt.total > 0;
      payBtn.dataset.change = change;
    };
    const setTip = v => { const wasSingle = pays.length === 1; tip = v; if (wasSingle) pays[0].amount = grand(); draw(); };
    const payBtn = h('button', { class: 'btn ok lg', style: { minWidth: '160px' }, onClick: async () => {
      payBtn.disabled = true;
      const change = Number(payBtn.dataset.change) || 0;
      const rows = pays.filter(p => p.amount > 0).map(p => ({ method: p.method, amount: r2(p.amount), change: 0 }));
      if (change > 0) { const ci = rows.findIndex(p => (methods.find(x => x.id === p.method) || {}).cash); if (ci >= 0) rows[ci].change = r2(change); }
      const paidOrder = L.payOrder(o, rows, user.id, tip);
      m.close();
      afterPay(paidOrder, change);
    } }, t('Collect payment'));
    const m = modal({ title: t('Bill & pay') + ' · ' + (o.no != null ? '#' + o.no : ''), size: 'md', body, onClose: clearDisplay, actions: [{ label: t('Cancel'), kind: 'ghost' }] });
    m.el.querySelector('.modal-foot').append(payBtn);
    draw();
  }
  async function afterPay(o, change) {
    const prof = profile('receipt');
    if (prof.auto && prof.method !== 'none') { try { await printReceipt(o); } catch (e) { toast(e.message, 'bad', 5000); } }
    const mm = modal({
      title: null, size: 'sm', dismiss: false, body: h('div', { class: 'sent-ok' }, h('div', { class: 'big' }, '✅'), h('h2', null, t('Payment received')), h('p', { class: 'muted' }, t('Invoice') + ' ' + (L.billNoLabel(o) || '')),
        change > 0 ? h('div', { class: 'big-total' }, t('Change') + ': ' + money(change)) : null),
      actions: [{ label: '🖨 ' + t('Print bill'), kind: '', onClick: async () => { try { await printReceipt(o); } catch (e) { toast(e.message, 'bad', 5000); } return false; } }, { label: t('Done'), kind: 'primary', onClick: c => { c(); go(type === 'dine_in' ? '/tables' : '/orders'); } }]
    });
  }

  drawBar(); drawCats(); drawItems(); drawCart();
  return {
    update() {
      const o = order();
      if (orderId && !o) return go('/tables');
      if (o && o.status !== 'open' && !topModal()) { go('/tables'); return; }
      drawBar(); drawItems(); drawCart();
    },
    destroy() { /* cart persists in memory by key */ }
  };
}
