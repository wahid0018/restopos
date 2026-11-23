// Table tablet / QR ordering screen (the guest's side). Big touch targets, instant EN | हिन्दी | اردو switch.
// Route: #/guest (device assigned to a table) or #/t/<tableNo> (phone via QR code).
import { h, empty, money, sum, now, debounce } from '../util.js';
import { store } from '../store.js';
import { t, nameOf, getLang, setLang } from '../i18n.js';
import { modal, toast, closeAllModals } from '../ui.js';
import * as L from '../logic.js';
import { app, deviceMode, staffGate, setDeviceMode } from '../app.js';
import { payPanel } from './payscreen.js';
import { itemTile, itemDialog, billRows, lineEl, cartFor, langSwitch, statusPill, vegDot } from './shared.js';

export function mount(el, { args, mode }) {
  const ref = args[0];
  const tb = store.get('tables', ref) || L.tableByNo(ref);
  const s = L.settings();
  if (!tb) { el.append(h('div', { class: 'center-screen' }, h('div', { class: 'panel center' }, h('h2', null, t('This table is not set up')), h('p', { class: 'muted' }, t('Please ask a member of staff.'))))); return {}; }
  const tableId = tb.id;
  const defaultLang = (mode && mode.lang) || null;
  const cart = cartFor('guest' + tableId);
  let cat = null, query = '', vegOnly = false, lastActive = Date.now();
  const order = () => L.orderForTable(tableId);

  const root = h('div', { class: 'ord guest' });
  const main = h('div', { class: 'ord-main' });
  const top = h('div', { class: 'guest-top' });
  const sub = h('div', { class: 'ord-bar' });
  const catsEl = h('div', { class: 'cats' });
  const itemsEl = h('div', { class: 'items' });
  const cartEl = h('aside', { class: 'cart' });
  const cartBar = h('button', { class: 'mobile-cartbar', type: 'button', onClick: () => cartEl.classList.add('open') });
  main.append(top, sub, catsEl, itemsEl);
  root.append(main, cartEl, cartBar);
  el.append(root);

  // ───── header ─────
  let press = null;
  function drawTop() {
    empty(top);
    const brand = h('button', { class: 'gname', type: 'button', 'aria-label': s.name }, s.logo ? h('img', { src: s.logo, alt: '' }) : null, h('span', null, nameOf(s) || s.name));
    // hold the restaurant name for 1.5 s to leave guest mode (staff PIN)
    const start = () => { press = setTimeout(async () => { press = null; if (await staffGate()) { if (deviceMode().role === 'table') { setDeviceMode({ role: 'staff' }); } location.hash = '#/'; location.reload(); } }, 1500); };
    const stop = () => { clearTimeout(press); press = null; };
    ['pointerdown'].forEach(e => brand.addEventListener(e, start)); ['pointerup', 'pointerleave', 'pointercancel'].forEach(e => brand.addEventListener(e, stop));
    top.append(brand, h('span', { class: 'tbadge' }, t('Table') + ' ' + tb.no));
    if (L.feature('multilang')) top.append(langSwitch({ big: true, persist: false, onChange: () => { lastActive = Date.now(); } }));
    top.append(h('button', { class: 'btn', onClick: callWaiter }, '🔔 ', h('span', { class: 'lb' }, t('Call waiter'))));
    if (order() && L.itemsOf(order().id).some(l => l.status !== 'void' && l.status !== 'pending')) top.append(h('button', { class: 'btn', onClick: askBill }, '🧾 ', h('span', { class: 'lb' }, t('Ask for bill'))));
  }
  function drawSub() {
    empty(sub);
    sub.append(h('input', { type: 'search', class: 'ord-search', placeholder: t('Search dishes…'), value: query, onInput: e => { query = e.target.value; drawItems(); } }));
    sub.append(h('span', { class: 'spacer' }));
    sub.append(h('button', { class: 'chip' + (vegOnly ? ' on' : ''), onClick: () => { vegOnly = !vegOnly; drawSub(); drawItems(); } }, vegDot('veg'), ' ', t('Veg only')));
  }
  function drawCats() {
    empty(catsEl);
    const cats = L.categories().filter(c => (L.itemsByCategory().get(c.id) || []).length);
    if (!cat || (cat !== 'all' && !cats.find(c => c.id === cat))) cat = cats.length ? cats[0].id : 'all';
    catsEl.append(h('button', { class: 'cat' + (cat === 'all' ? ' on' : ''), onClick: () => { cat = 'all'; drawCats(); drawItems(); } }, t('All')));
    for (const c of cats) catsEl.append(h('button', { class: 'cat' + (cat === c.id ? ' on' : ''), onClick: () => { cat = c.id; drawCats(); drawItems(); } }, nameOf(c)));
  }
  function drawItems() {
    const sc = itemsEl.scrollTop;
    empty(itemsEl);
    const q = query.trim().toLowerCase();
    let list = L.menuItems().filter(i => L.itemAvailable(i) || true);
    if (vegOnly) list = list.filter(i => i.veg === 'veg');
    if (q) list = list.filter(i => [i.name, i.name_hi, i.name_ur, i.desc].some(x => x && String(x).toLowerCase().includes(q)));
    else if (cat !== 'all') list = list.filter(i => i.category_id === cat);
    if (!list.length) itemsEl.append(h('div', { class: 'empty', style: { gridColumn: '1/-1' } }, h('b', null, t('Nothing found'))));
    for (const it of list) itemsEl.append(itemTile(it, { inCart: cart.qtyOf(it.id), showImg: !!it.img, onClick: add, off: !L.itemAvailable(it) ? t('Not available') : null }));
    itemsEl.scrollTop = sc;
  }
  async function add(item) {
    lastActive = Date.now();
    { const r = await itemDialog(item); if (r) cart.add(item, r); }   // guests always see the dish details first
    drawItems(); drawCart();
  }

  // ───── cart + live order status ─────
  function drawCart() {
    empty(cartEl);
    const o = order();
    const sent = o ? L.itemsOf(o.id).filter(l => l.status !== 'void') : [];
    const totals = L.calcTotals(o || { type: 'dine_in', member_pct: 0 }, sent.filter(L.billed).concat(cart.asItems()));
    const body = h('div', { class: 'cart-b' });
    if (cart.lines.length) {
      body.append(h('div', { class: 'sec-h' }, t('Your selection'), h('button', { class: 'btn sm ghost', onClick: () => { cart.clear(); drawItems(); drawCart(); } }, t('Clear'))));
      for (const l of cart.lines) {
        body.append(lineEl(l, { actions: [
          h('button', { class: 'btn sm', 'aria-label': '−', onClick: () => { l.qty--; if (l.qty < 1) cart.lines.splice(cart.lines.indexOf(l), 1); drawItems(); drawCart(); } }, '−'),
          h('button', { class: 'btn sm', 'aria-label': '+', onClick: () => { l.qty++; drawItems(); drawCart(); } }, '+'),
          h('button', { class: 'btn sm ghost', onClick: () => { cart.lines.splice(cart.lines.indexOf(l), 1); drawItems(); drawCart(); } }, '✕')] }));
      }
    }
    if (sent.length) {
      body.append(h('div', { class: 'sec-h' }, t('Your orders')));
      for (const l of sent) body.append(lineEl(l, { showPrice: false }));
    }
    if (!body.children.length) body.append(h('div', { class: 'empty' }, h('b', null, t('Choose your dishes')), h('p', null, t('Tap a dish to add it. Send it to the kitchen when you are ready.'))));
    const f = h('div', { class: 'cart-f' });
    if (totals.subtotal) {
      f.append(...billRows(totals, { compact: true }), h('div', { class: 'tot-row grand' }, h('span', null, t(sent.length && !cart.lines.length ? 'Bill so far' : 'Total')), h('span', { class: 'num' }, money(totals.total))));
      if (totals.gstOn && !totals.inclusive && s.gst_scheme === 'regular') f.append(h('small', { class: 'muted' }, t('Prices shown are before GST; GST is added in the bill.')));
    }
    if (cart.lines.length) f.append(h('button', { class: 'btn primary lg block', onClick: sendOrder }, t('Send order to kitchen')));
    cartEl.append(h('div', { class: 'cart-h' }, h('h3', null, t('Your order')), h('button', { class: 'icon-btn mobile-only', onClick: () => cartEl.classList.remove('open') }, '✕')), body, f);
    cartBar.replaceChildren(h('span', null, '🛒 ', cart.count() + sum(sent, l => l.qty), ' ', t('items')), h('span', { class: 'num' }, money(totals.total)));
    cartBar.hidden = !(cart.count() || sent.length);
  }

  function sendOrder() {
    if (!cart.lines.length) return;
    const payload = cart.lines.map(l => ({ item_id: l.item_id, name: l.name, name_hi: l.name_hi, name_ur: l.name_ur, qty: l.qty, price: l.price, mods: l.mods, note: l.note, station: l.station, gst: l.gst, hsn: l.hsn, veg: l.veg, comm: l.comm }));
    const res = L.placeOrder({ order: order(), tableId, type: 'dine_in', lines: payload, source: 'table' });
    cart.clear(); cartEl.classList.remove('open');
    drawItems(); drawCart(); drawTop();
    const m = modal({ title: null, size: 'sm', body: h('div', { class: 'sent-ok' }, h('div', { class: 'big' }, '✅'), h('h2', null, t(res.pending ? 'Order received' : 'Order sent!')), h('p', { class: 'muted' }, t(res.pending ? 'A waiter will confirm it shortly.' : 'The kitchen is preparing your food.'))), actions: [{ label: t('OK'), kind: 'primary' }] });
    setTimeout(() => m.close(), 7000);
  }
  function callWaiter() {
    L.callWaiter(tableId, 'waiter');
    toast(t('A waiter is on the way'), 'ok');
  }
  function askBill() {
    const o = order(); if (!o) return;
    L.requestBill(o);
    toast(t('Your bill is being prepared'), 'ok');
  }

  // ───── idle reset (between guests) ─────
  ['pointerdown', 'keydown'].forEach(e => el.addEventListener(e, () => { lastActive = Date.now(); }, true));
  const idle = setInterval(() => {
    const mins = (Date.now() - lastActive) / 60000;
    const lim = Number(s.idle_reset_min) || 0;
    if (!lim) return;
    if (mins >= lim && (query || vegOnly || (cat && cat !== (L.categories()[0] || {}).id))) { query = ''; vegOnly = false; cat = null; closeAllModals(); drawSub(); drawCats(); drawItems(); }
    if (defaultLang && mins >= lim && getLang() !== defaultLang) setLang(defaultLang, false);
    if (mins >= lim * 2 && cart.lines.length) { cart.clear(); drawItems(); drawCart(); }
  }, 15000);

  // while the cashier collects UPI for this table the tablet shows the amount + QR full screen
  const payOv = h('div', { class: 'pay-overlay', hidden: true }); el.append(payOv);
  const drawPay = () => { const o = order(); const show = !!(o && o.status === 'open' && o.pay_display); if (show) { empty(payOv); payOv.append(payPanel(o)); } payOv.hidden = !show; };
  drawTop(); drawSub(); drawCats(); drawItems(); drawCart(); drawPay();
  return {
    update() { drawTop(); drawItems(); drawCart(); drawPay(); },
    destroy() { clearInterval(idle); }
  };
}
