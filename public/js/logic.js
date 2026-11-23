// Business rules (India edition): settings, feature flags, users, GST engine, orders, members,
// commission & tips, stock, shifts, expenses, reports.
import { store } from './store.js';
import { uid, now, bizDay, r2, fmt, sum, groupBy, hashPin } from './util.js';
import { fyOf, stateName } from './gst.js';
import { setAutoTranslate } from './i18n.js';

// ───────── settings ─────────
export const PRINT_DEFAULTS = {
  receipt: { method: 'browser', paper: '80', w: 80, h: 0, margin: 3, font: 12, scale: 100, copies: 1, layout: 'auto', lang: 'en', host: '', port: 9100, dots: 576, cut: true, drawer: false, auto: false, logo: true, qr: true },
  kot: { method: 'browser', paper: '80', w: 80, h: 0, margin: 3, font: 15, scale: 100, copies: 1, layout: 'receipt', lang: 'en', host: '', port: 9100, dots: 576, cut: true, drawer: false, auto: false, logo: false, qr: false }
};
export const DEFAULTS = {
  name: 'My Restaurant', name_hi: '', name_ur: '', tagline: '', address: '', phone: '', email: '', fssai: '',
  gstin: '', state_code: '', pan: '',
  gst_scheme: 'regular',            // regular = tax invoice with GST | composition = bill of supply (no GST shown) | none = not registered
  default_gst: 5, default_hsn: '996331', tax_inclusive: false,
  service_pct: 0, service_takeaway: false, packaging_charge: 0,
  currency: '₹', currency_pos: 'before', decimals: 2, rounding: 1,
  bill_prefix: 'INV/', bill_reset: 'fy', day_start_hour: 4,
  upi_id: '', upi_name: '',
  // rewards (optional)
  loyalty_on: false, points_per_100: 5, point_value: 0.5, min_redeem_points: 100, max_redeem_pct: 50, require_phone: false,
  coupons_on: false, wa_on: false, auto_translate: true,
  terminals: { upi: { on: false, url: '', method: 'POST', headers: '', body: '' }, card: { on: false, url: '', method: 'POST', headers: '', body: '' } },
  online_orders_key: '',
  payment_methods: [{ id: 'cash', label: 'Cash', cash: true }, { id: 'upi', label: 'UPI' }, { id: 'card', label: 'Card' }, { id: 'wallet', label: 'Wallet / Other' }],
  stations: [{ id: 'kitchen', name: 'Kitchen' }, { id: 'tandoor', name: 'Tandoor' }, { id: 'bar', name: 'Beverages' }, { id: 'dessert', name: 'Dessert' }],
  expense_categories: ['Raw material', 'Salary', 'Rent', 'Electricity', 'Gas', 'Repairs', 'Marketing', 'Packaging', 'Other'],
  tips_mode: 'waiter', tip_presets: [5, 10, 15], commission_default_pct: 0, commission_basis: 'net',
  guest_ordering: true, approve_table_orders: false, auto_hide_oos: false, waiter_can_pay: false, waiter_can_print: true, require_shift: false, require_member_valid: true,
  kds_warn_min: 10, kds_late_min: 20, kds_ready_keep_min: 10, idle_reset_min: 3, lock_minutes: 0,
  brand: '#7a1f2b', receipt_footer: 'Thank you! Visit again.', receipt_footer_hi: 'धन्यवाद! फिर पधारिए।', receipt_footer_ur: 'شکریہ! دوبارہ تشریف لائیں۔',
  print: PRINT_DEFAULTS
};
export function settings() {
  const s = Object.assign({}, DEFAULTS, store.get('settings', 'main') || {});
  s.print = {
    receipt: Object.assign({}, PRINT_DEFAULTS.receipt, (s.print || {}).receipt),
    kot: Object.assign({}, PRINT_DEFAULTS.kot, (s.print || {}).kot)
  };
  return s;
}
export const isSetUp = () => !!store.get('settings', 'main');
export function applyFormat() {
  setAutoTranslate(settings().auto_translate);
  const s = settings();
  fmt.dec = Number(s.decimals) || 0; fmt.sym = s.currency; fmt.pos = s.currency_pos;
}
export function saveSettings(patch) { return store.put('settings', Object.assign({}, patch, { id: 'main' })); }

let memoMap = new Map();
export function memo(key, fn) {
  const m = memoMap.get(key);
  if (m && m.v === store.version) return m.val;
  const val = fn();
  memoMap.set(key, { v: store.version, val });
  return val;
}

// ───────── provider feature flags & licence ─────────
export const FEATURES = [
  { id: 'tables', group: 'Service', label: 'Table management & waiter ordering' },
  { id: 'guest', group: 'Service', label: 'Table tablets & QR self-ordering' },
  { id: 'kitchen', group: 'Service', label: 'Kitchen display screen' },
  { id: 'takeaway', group: 'Service', label: 'Takeaway orders' },
  { id: 'delivery', group: 'Service', label: 'Delivery orders' },
  { id: 'partners', group: 'Service', label: 'Zomato / Swiggy / agent partners' },
  { id: 'reservations', group: 'Service', label: 'Table reservations' },
  { id: 'split', group: 'Billing', label: 'Split payments (cash + UPI + card)' },
  { id: 'discounts', group: 'Billing', label: 'Manual discounts' },
  { id: 'members', group: 'Billing', label: 'Membership cards & member discount' },
  { id: 'tips', group: 'Billing', label: 'Tips tracking' },
  { id: 'loyalty', group: 'Billing', label: 'Customers & reward points' },
  { id: 'coupons', group: 'Billing', label: 'Coupons' },
  { id: 'whatsapp', group: 'Billing', label: 'WhatsApp offers & wishes' },
  { id: 'terminal', group: 'Billing', label: 'Payment terminal / customer display' },
  { id: 'ar3d', group: 'Service', label: '3D / AR dish viewer (camera)' },
  { id: 'online_orders', group: 'Service', label: 'Online orders inbox (Zomato / Swiggy etc.)' },
  { id: 'upi_qr', group: 'Billing', label: 'UPI payment QR on bills' },
  { id: 'gst', group: 'Billing', label: 'GST invoices (CGST / SGST / IGST)' },
  { id: 'inventory', group: 'Back office', label: 'Inventory, recipes & purchases' },
  { id: 'shifts', group: 'Back office', label: 'Cash shifts & drawer closing' },
  { id: 'expenses', group: 'Back office', label: 'Expenses' },
  { id: 'commission', group: 'Back office', label: 'Commission tracking (staff & partners)' },
  { id: 'reports', group: 'Reports', label: 'Sales reports' },
  { id: 'gst_reports', group: 'Reports', label: 'GST reports (GSTR-1 data, HSN summary)' },
  { id: 'staff_reports', group: 'Reports', label: 'Staff earnings & payouts' },
  { id: 'net_print', group: 'System', label: 'LAN thermal printer (direct)' },
  { id: 'multilang', group: 'System', label: 'Hindi & Urdu languages' },
  { id: 'backup', group: 'System', label: 'Backup & restore' },
  { id: 'cloud', group: 'System', label: 'Cloud sync (Supabase)' }
];
export const provider = () => store.get('provider', 'flags') || {};
export const TRIAL_DAYS = 30;
/** plan: 'trial' (30 days from first set-up, starts by itself) | 'yearly' (valid_until) | 'lifetime' (never expires).
 *  Only the provider password can change it (server / Supabase check the password; staff cannot write the provider record). */
export function licenseState() {
  const p = provider();
  if (p.suspended) return { ok: false, reason: 'suspended', plan: p.plan || 'trial' };
  if (p.plan === 'lifetime') return { ok: true, plan: 'lifetime', until: null };
  if (p.valid_until) {
    const left = daysBetween(today(), p.valid_until);
    const plan = p.plan || 'yearly';
    if (left < 0) return { ok: false, reason: 'expired', plan, until: p.valid_until };
    return { ok: true, plan, until: p.valid_until, daysLeft: left };
  }
  const start = p.trial_start || (settings() || {}).created_at;
  if (p.plan === 'trial' || !p.plan) {
    if (!start) return { ok: true, plan: 'trial', trial: true, until: null, daysLeft: TRIAL_DAYS };
    const end = addDays(bizDay(start, settings().day_start_hour), TRIAL_DAYS);
    const left = daysBetween(today(), end);
    if (left < 0) return { ok: false, reason: 'expired', plan: 'trial', trial: true, until: end };
    return { ok: true, plan: 'trial', trial: true, until: end, daysLeft: left };
  }
  return { ok: true, plan: p.plan, until: null };
}
function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
export function feature(id) {
  const p = provider();
  if (p.features && p.features[id] === false) return false;
  return true;
}
export const limits = () => (provider().limits || {});

// ───────── users & permissions ─────────
export const ROLES = ['admin', 'manager', 'cashier', 'waiter', 'kitchen'];
const PERMS = {
  admin: ['pos', 'waiter', 'kitchen', 'menu', 'inventory', 'reports', 'settings', 'staff', 'void', 'discount', 'pay', 'print', 'members', 'expenses', 'cancel_bill', 'staff_reports'],
  manager: ['pos', 'waiter', 'kitchen', 'menu', 'inventory', 'reports', 'settings', 'void', 'discount', 'pay', 'print', 'members', 'expenses', 'cancel_bill', 'staff_reports'],
  cashier: ['pos', 'waiter', 'discount', 'pay', 'print', 'members', 'expenses'],
  waiter: ['waiter', 'print'],
  kitchen: ['kitchen']
};
export const session = { user: null };
export const can = p => !!session.user && (PERMS[session.user.role] || []).includes(p) && (p !== 'pay' || session.user.role !== 'waiter' || settings().waiter_can_pay);
export function loginPin(pin) {
  const hp = hashPin(pin);
  const u = store.all('users').find(x => x.active !== false && x.pin === hp);
  if (u) { session.user = u; sessionStorage.setItem('restopos.uid', u.id); }
  return u || null;
}
export function loginPassword(username, password) {
  const un = String(username || '').trim().toLowerCase();
  const hp = hashPin(password);
  const u = store.all('users').find(x => x.active !== false && x.username && String(x.username).toLowerCase() === un && (x.pass === hp));
  if (u) { session.user = u; sessionStorage.setItem('restopos.uid', u.id); }
  return u || null;
}
export function restoreSession() {
  const id = sessionStorage.getItem('restopos.uid');
  const u = id && store.get('users', id);
  session.user = u && u.active !== false ? u : null;
  return session.user;
}
export function logout() { session.user = null; sessionStorage.removeItem('restopos.uid'); }
export const pinTaken = (pin, exceptId) => store.all('users').some(u => u.id !== exceptId && u.pin === hashPin(pin));
export const userName = id => (store.get('users', id) || {}).name || '';
export const staff = () => memo('staff', () => store.all('users').filter(u => u.active !== false).sort((a, b) => a.name.localeCompare(b.name)));
export const waiters = () => staff().filter(u => u.role === 'waiter' || u.role === 'manager' || u.role === 'cashier' || u.role === 'admin');

// ───────── menu helpers ─────────
export const categories = () => memo('cats', () => store.all('categories').filter(c => c.active !== false).sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name)));
export const menuItems = () => memo('menu', () => store.all('items').filter(i => i.active !== false).sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name)));
export const itemsByCategory = () => memo('byCat', () => groupBy(menuItems(), i => i.category_id));
export function stationOf(item) {
  if (item.station) return item.station;
  const c = store.get('categories', item.category_id);
  return (c && c.station) || 'kitchen';
}
export function itemAvailable(item) {
  if (item.available === false) return false;
  if (feature('inventory') && settings().auto_hide_oos && item.recipe && item.recipe.length) {
    const lv = stockLevels();
    for (const r of item.recipe) if ((lv.get(r.stock_id) || 0) < r.qty) return false;
  }
  return true;
}
export const itemGst = item => {
  const s = settings();
  if (s.gst_scheme !== 'regular') return 0;
  return item.gst === '' || item.gst == null ? Number(s.default_gst) || 0 : Number(item.gst);
};
export const itemHsn = item => (item.hsn || settings().default_hsn || '').trim();

// ───────── stock ─────────
export const stockLevels = () => memo('stockLv', () => {
  const m = new Map();
  for (const mv of store.all('stock_moves')) m.set(mv.stock_id, (m.get(mv.stock_id) || 0) + (Number(mv.qty) || 0));
  return m;
});
export const stockItems = () => memo('stockItems', () => store.all('stock').filter(s => s.active !== false).sort((a, b) => a.name.localeCompare(b.name)));
export function stockStatus(s) {
  const q = stockLevels().get(s.id) || 0;
  if (q <= 0) return 'out';
  if (s.min && q <= s.min) return 'low';
  return 'ok';
}
export const lowStock = () => memo('lowStock', () => stockItems().filter(s => stockStatus(s) !== 'ok'));
export function addStockMove({ stock_id, qty, type, note = '', cost, ref = '', userId, supplier_id = null, invoice_no = '' }) {
  const rec = store.put('stock_moves', { id: uid(), stock_id, qty: Number(qty), type, note, ref, cost: cost ?? null, supplier_id, invoice_no, at: now(), day: bizDay(now(), settings().day_start_hour), by: userId || (session.user && session.user.id) || null });
  if (type === 'purchase' && cost != null && Number(cost) > 0) store.patch('stock', stock_id, { cost: Number(cost) });
  return rec;
}
function deduct(oi, userId) {
  if (!feature('inventory')) return;
  const it = store.get('items', oi.item_id);
  if (!it || !it.recipe) return;
  for (const r of it.recipe) {
    if (!r.stock_id || !r.qty) continue;
    addStockMove({ stock_id: r.stock_id, qty: -(r.qty * oi.qty), type: 'sale', ref: oi.id, userId });
  }
}
function restore(oi, userId) {
  if (!feature('inventory')) return;
  const it = store.get('items', oi.item_id);
  if (!it || !it.recipe) return;
  for (const r of it.recipe) {
    if (!r.stock_id || !r.qty) continue;
    addStockMove({ stock_id: r.stock_id, qty: r.qty * oi.qty, type: 'void_return', ref: oi.id, userId });
  }
}
export function itemCost(item) {
  if (!item.recipe) return 0;
  return sum(item.recipe, r => (r.qty || 0) * ((store.get('stock', r.stock_id) || {}).cost || 0));
}

// ───────── orders ─────────
export const openOrders = () => memo('openOrders', () => store.all('orders').filter(o => o.status === 'open'));
export const orderItemsIndex = () => memo('oiIdx', () => {
  const m = new Map();
  for (const i of store.all('order_items')) { if (!m.has(i.order_id)) m.set(i.order_id, []); m.get(i.order_id).push(i); }
  for (const arr of m.values()) arr.sort((a, b) => (a.round || 0) - (b.round || 0) || (a.sent_at || 0) - (b.sent_at || 0));
  return m;
});
export const itemsOf = orderId => orderItemsIndex().get(orderId) || [];
export const orderForTable = tableId => openOrders().find(o => o.table_id === tableId);
export const billed = i => i.status !== 'void' && i.status !== 'pending';
export const lineTotal = l => r2(l.price * l.qty);
export const orderNoLabel = o => (o && o.no != null ? '#' + o.no : '#…');
export function billNoLabel(o) {
  if (!o || o.bill_no == null) return '';
  const s = settings();
  const pre = (s.bill_prefix || '') + (o.bill_fy && o.bill_fy !== 'all' ? o.bill_fy + '/' : '');
  return pre + String(o.bill_no).padStart(5, '0');
}
export const invoiceTitleKey = () => { const g = settings().gst_scheme; return g === 'regular' ? 'Tax Invoice' : g === 'composition' ? 'Bill of Supply' : 'Bill'; };
function localNext(field, filter) {
  if (store.kind === 'local') return undefined;
  let mx = 0;
  for (const o of store.all('orders')) if (filter(o) && o[field] > mx) mx = o[field];
  return mx + 1;
}

/**
 * GST engine. Works rate-by-rate (as GSTR-1 wants it).
 *  – item prices may be GST-inclusive or exclusive (settings.tax_inclusive)
 *  – discounts (member + manual) are spread across all lines pro-rata
 *  – service charge / packaging / delivery are taxed at the rate of the goods they go with
 *  – CGST+SGST for same-state supply, IGST when the buyer GSTIN is in another state
 *  – optional round-off to the nearest ₹1 (settings.rounding)
 */
export function calcTotals(order, items) {
  const s = settings();
  const live = items.filter(billed);
  const gstOn = s.gst_scheme === 'regular';
  const subtotal = r2(sum(live, lineTotal));
  const memberPct = order && order.member_pct > 0 ? Math.min(100, Number(order.member_pct)) : 0;
  const memberDiscount = r2(subtotal * memberPct / 100);
  const d = order && order.discount;
  let manual = 0;
  const afterMember = subtotal - memberDiscount;
  if (d && d.value > 0) manual = d.type === 'pct' ? r2(afterMember * Math.min(100, d.value) / 100) : Math.min(afterMember, r2(d.value));
  let couponDiscount = 0, pointsDiscount = 0;
  const base1 = afterMember - manual;
  const cp = order && order.coupon;
  if (cp && base1 > 0) {
    couponDiscount = cp.kind === 'pct' ? r2(base1 * Math.min(100, Number(cp.value) || 0) / 100) : Math.min(base1, r2(Number(cp.value) || 0));
    if (cp.max_off > 0) couponDiscount = Math.min(couponDiscount, Number(cp.max_off));
    couponDiscount = Math.min(base1, couponDiscount);
  }
  const base2 = base1 - couponDiscount;
  if (order && order.points_used > 0 && base2 > 0) pointsDiscount = Math.min(base2, r2(order.points_used * (Number(s.point_value) || 0)));
  const discountTotal = Math.min(subtotal, r2(memberDiscount + manual + couponDiscount + pointsDiscount));
  const f = subtotal > 0 ? (subtotal - discountTotal) / subtotal : 1;

  const type = order ? order.type : 'dine_in';
  const dine = type === 'dine_in';
  const svcPct = (dine || s.service_takeaway) ? Number(s.service_pct) || 0 : 0;
  const packaging = !dine && order ? Number(s.packaging_charge) || 0 : 0;
  const delivery = order && order.delivery_fee ? Number(order.delivery_fee) : 0;
  const extra = r2(packaging + delivery);
  const interstate = !!(order && order.customer && order.customer.state_code && s.state_code && order.customer.state_code !== s.state_code && order.customer.gstin);

  const byRate = new Map();   // rate -> { goods }
  for (const l of live) {
    const rate = gstOn ? (l.gst == null ? Number(s.default_gst) || 0 : Number(l.gst)) : 0;
    const a = l.price * l.qty * f;
    const goods = s.tax_inclusive && gstOn ? a / (1 + rate / 100) : a;
    const g = byRate.get(rate) || { rate, goods: 0 };
    g.goods += goods; byRate.set(rate, g);
  }
  const goodsAll = sum(Array.from(byRate.values()), g => g.goods);
  const groups = [];
  let service = 0;
  for (const g of byRate.values()) {
    const svc = g.goods * svcPct / 100;
    const ex = goodsAll > 0 ? extra * g.goods / goodsAll : 0;
    service += svc;
    const taxable = r2(g.goods + svc + ex);
    const row = { rate: g.rate, goods: r2(g.goods), taxable, cgst: 0, sgst: 0, igst: 0, tax: 0 };
    if (g.rate > 0) {
      if (interstate) { row.igst = r2(taxable * g.rate / 100); row.tax = row.igst; }
      else { row.cgst = r2(taxable * g.rate / 200); row.sgst = row.cgst; row.tax = r2(row.cgst + row.sgst); }
    }
    groups.push(row);
  }
  groups.sort((a, b) => a.rate - b.rate);
  if (!live.length && extra > 0) { /* nothing billed yet */ }
  service = r2(service);
  const taxable = r2(sum(groups, g => g.taxable));
  const cgst = r2(sum(groups, g => g.cgst)), sgst = r2(sum(groups, g => g.sgst)), igst = r2(sum(groups, g => g.igst));
  const tax = r2(cgst + sgst + igst);
  let total = r2(taxable + tax);
  let rounding = 0;
  const step = Number(s.rounding) || 0;
  if (step > 0) { rounding = r2(Math.round(total / step) * step - total); total = r2(total + rounding); }
  return {
    subtotal, memberDiscount, memberPct, discount: manual, couponDiscount, pointsDiscount, discountTotal, service, packaging: r2(packaging), delivery: r2(delivery), extra,
    taxable, goodsNet: r2(sum(groups, g => g.goods)), groups, cgst, sgst, igst, tax, rounding, total, inclusive: !!s.tax_inclusive && gstOn, gstOn, interstate, scheme: s.gst_scheme,
    count: sum(live, l => l.qty), f
  };
}
export function orderTotals(order) {
  if ((order.status === 'paid' || order.status === 'cancelled') && order.totals) return order.totals;
  return calcTotals(order, itemsOf(order.id));
}
export const orderGrand = o => { const t = orderTotals(o); return r2(t.total + (Number(o.tip) || 0)); };

export function makeLine(item, qty, mods, note) {
  const modTotal = sum(mods || [], m => m.price);
  return {
    item_id: item.id, name: item.name, name_hi: item.name_hi || '', name_ur: item.name_ur || '', qty, price: r2(item.price + modTotal),
    mods: (mods || []).map(m => ({ name: m.name, name_hi: m.name_hi || '', name_ur: m.name_ur || '', price: m.price || 0 })), note: note || '', station: stationOf(item),
    gst: itemGst(item), hsn: itemHsn(item), veg: item.veg || '', comm: item.comm_pct === '' || item.comm_pct == null ? null : Number(item.comm_pct)
  };
}

export function waiterForTable(tableId) { const t = store.get('tables', tableId); return (t && t.waiter_id) || null; }
export function createOrder({ tableId = null, type = 'dine_in', source = 'waiter', userId = null, guests = null, customer = null, partner_id = null }) {
  const s = settings();
  const ts = now();
  const day = bizDay(ts, s.day_start_hour);
  const u = userId && store.get('users', userId);
  const waiter = (u && u.role === 'waiter') ? u.id : (waiterForTable(tableId) || (u ? u.id : null));
  const no = localNext('no', o => o.day === day);
  const rec = { id: uid(), table_id: tableId, type, status: 'open', source, waiter_id: waiter, created_by: userId, created_at: ts, day, guests, customer, discount: null, note: '', partner_id };
  if (partner_id) { const p = store.get('partners', partner_id); if (p) rec.partner_pct = Number(p.commission_pct) || 0; }
  if (no !== undefined) rec.no = no;
  return store.put('orders', rec);
}

export function placeOrder({ order, tableId, type = 'dine_in', lines, source = 'waiter', userId = null, guests = null, customer = null }) {
  const s = settings();
  let o = order || (tableId ? orderForTable(tableId) : null);
  if (!o) o = createOrder({ tableId, type, source, userId, guests, customer });
  const ts = now();
  const items = itemsOf(o.id);
  const round = Math.max(0, ...items.map(i => i.round || 0)) + 1;
  const approval = source === 'table' && s.approve_table_orders;
  const created = [];
  for (const l of lines) {
    const rec = store.put('order_items', {
      id: uid(), order_id: o.id, item_id: l.item_id, name: l.name, name_hi: l.name_hi || '', name_ur: l.name_ur || '', price: l.price, qty: l.qty, mods: l.mods || [], note: l.note || '',
      station: l.station || 'kitchen', gst: l.gst, hsn: l.hsn, veg: l.veg || '', comm: l.comm == null ? null : l.comm,
      status: approval ? 'pending' : 'new', round, sent_at: ts, by: userId, src: source
    });
    if (!approval) deduct(rec, userId);
    created.push(rec);
  }
  const p = { last_at: ts, bill_requested: false };
  if (guests) p.guests = guests;
  store.patch('orders', o.id, p);
  return { order: store.get('orders', o.id), created, pending: approval };
}

export function setLineStatus(lines, status) {
  const ts = now();
  for (const l of lines) {
    const p = { status };
    if (status === 'preparing') p.started_at = ts;
    if (status === 'ready') { p.ready_at = ts; if (!l.started_at) p.started_at = ts; }
    if (status === 'served') p.served_at = ts;
    if (status === 'new') { p.started_at = null; p.ready_at = null; }
    store.patch('order_items', l.id, p);
  }
}
export function voidLine(line, reason, userId) {
  const returnStock = line.status === 'new' || line.status === 'pending';
  store.patch('order_items', line.id, { status: 'void', void_reason: reason || '', void_by: userId || null, void_at: now(), void_from: line.status });
  if (returnStock && line.status !== 'pending') restore(line, userId);
  tidyOrder(line.order_id);
}
export function approveLines(lines, userId) {
  const ts = now();
  for (const l of lines) { store.patch('order_items', l.id, { status: 'new', sent_at: ts, approved_by: userId || null }); deduct(l, userId); }
}
export function changeQty(line, qty, userId) {
  if (qty === line.qty) return;
  const diff = qty - line.qty;
  store.patch('order_items', line.id, { qty });
  const it = store.get('items', line.item_id);
  if (feature('inventory') && it && it.recipe && line.status !== 'pending') for (const r of it.recipe) addStockMove({ stock_id: r.stock_id, qty: -(r.qty * diff), type: diff > 0 ? 'sale' : 'void_return', ref: line.id, userId });
}
export function tidyOrder(orderId) {
  const o = store.get('orders', orderId);
  if (!o || o.status !== 'open') return;
  const its = itemsOf(orderId);
  if (its.length && its.every(i => i.status === 'void')) store.patch('orders', orderId, { status: 'void', note: (o.note ? o.note + ' · ' : '') + 'all items voided', closed_at: now() });
}
export function voidOrder(order, reason, userId) {
  for (const l of itemsOf(order.id)) if (l.status !== 'void') voidLine(l, reason, userId);
  store.patch('orders', order.id, { status: 'void', void_reason: reason || '', closed_at: now(), void_by: userId || null });
}
export function setDiscount(order, discount) { store.patch('orders', order.id, { discount: discount && discount.value > 0 ? discount : null }); }
export function setWaiter(order, waiterId) { store.patch('orders', order.id, { waiter_id: waiterId || null }); }
export function setCustomer(order, customer) { store.patch('orders', order.id, { customer: customer && Object.values(customer).some(Boolean) ? customer : null }); }
export function setTip(order, tip) { store.patch('orders', order.id, { tip: Math.max(0, r2(Number(tip) || 0)) }); }

export function payOrder(order, payments, userId, tip = 0) {
  const items = itemsOf(order.id);
  const totals = calcTotals(order, items);
  const cur = store.get('orders', order.id) || order;
  const p = { status: 'paid', paid_at: now(), payments, totals, tip: Math.max(0, r2(Number(tip) || 0)), cashier_id: userId || null, bill_requested: false };
  const s = settings();
  if (store.kind !== 'local') {
    const fy = s.bill_reset === 'never' ? 'all' : fyOf(cur.day);
    p.bill_fy = fy;
    p.bill_no = localNext('bill_no', o => o.status !== 'open' && o.bill_fy === fy && o.bill_no != null);
  }
  if (s.loyalty_on && cur.customer_id) {
    const net = Math.max(0, totals.total);
    p.points_earned = Math.floor(net / 100 * (Number(s.points_per_100) || 0));
    store.patch('customers', cur.customer_id, { last_visit: p.paid_at });
  }
  const sh = currentShift(userId);
  if (sh) p.shift_id = sh.id;
  store.patch('orders', order.id, p);
  if (cur.member_id) { /* stats derive from orders — nothing extra to store */ }
  for (const c of store.all('calls')) if (c.table_id === order.table_id && !c.done) store.patch('calls', c.id, { done: true });
  return store.get('orders', order.id);
}
export function cancelBill(order, reason, userId) {
  store.patch('orders', order.id, { status: 'cancelled', cancel_reason: reason || '', cancelled_at: now(), cancelled_by: userId || null });
}
export function moveOrder(order, toTableId) {
  const target = orderForTable(toTableId);
  if (target && target.id !== order.id) {
    for (const l of itemsOf(order.id)) store.patch('order_items', l.id, { order_id: target.id });
    store.patch('orders', order.id, { status: 'void', note: 'merged into #' + target.no, merged_into: target.id, closed_at: now() });
    return target;
  }
  store.patch('orders', order.id, { table_id: toTableId, waiter_id: waiterForTable(toTableId) || order.waiter_id });
  return order;
}

// ───────── members (pre-printed cards) ─────────
export const members = () => memo('members', () => store.all('members').sort((a, b) => String(a.card_no).localeCompare(String(b.card_no), undefined, { numeric: true })));
const normCard = c => String(c || '').trim().toUpperCase().replace(/\s+/g, '');
export function findMember(q) {
  const n = normCard(q);
  if (!n) return null;
  return members().find(m => normCard(m.card_no) === n) || members().find(m => m.phone && String(m.phone).replace(/\D/g, '') === n.replace(/\D/g, '') && n.replace(/\D/g, '').length >= 8) || null;
}
export const cardTaken = (card, exceptId) => members().some(m => m.id !== exceptId && normCard(m.card_no) === normCard(card));
export function memberStatus(m) {
  if (m.active === false) return 'inactive';
  if (m.valid_until && today() > m.valid_until) return 'expired';
  return 'ok';
}
export function attachMember(order, m) {
  store.patch('orders', order.id, { member_id: m.id, member_pct: Number(m.discount_pct) || 0, member_card: m.card_no, member_name: m.name });
}
export function detachMember(order) { store.patch('orders', order.id, { member_id: null, member_pct: 0, member_card: null, member_name: null }); }
export function memberStats(m) {
  let visits = 0, spent = 0, saved = 0, last = 0;
  for (const o of store.all('orders')) {
    if (o.member_id !== m.id || o.status !== 'paid') continue;
    visits++; const t = o.totals || {}; spent += t.total || 0; saved += t.memberDiscount || 0; last = Math.max(last, o.paid_at || 0);
  }
  return { visits, spent, saved, last };
}

// ───────── customers, reward points, coupons ─────────
export const cleanPhone = v => { const d = String(v || '').replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d; };
export const customers = () => memo('customers', () => store.all('customers'));
export const customerByPhone = ph => { const p = cleanPhone(ph); return p.length === 10 ? customers().find(c => c.phone === p) || null : null; };
/** Points are derived from paid orders so two tablets can never overwrite each other's balance. */
export function pointsOf(customerId) {
  return memo('pts:' + customerId, () => {
    const c = store.get('customers', customerId);
    let pts = Number(c && c.points_adj) || 0;
    for (const o of store.all('orders')) if (o.customer_id === customerId && o.status === 'paid') pts += (Number(o.points_earned) || 0) - (Number(o.points_used) || 0);
    return Math.max(0, pts);
  });
}
export function customerStats(c) {
  let visits = 0, spent = 0, last = 0;
  for (const o of store.all('orders')) if (o.customer_id === c.id && o.status === 'paid') { visits++; spent += (o.totals || {}).total || 0; last = Math.max(last, o.paid_at || 0); }
  return { visits, spent, last, points: pointsOf(c.id) };
}
/** Attach (creating if needed) a customer by mobile number to an open order. */
export function attachCustomer(order, { phone, name, birthday, anniversary, optin }) {
  const ph = cleanPhone(phone);
  if (ph.length !== 10) throw new Error('Enter a 10-digit mobile number');
  let c = customerByPhone(ph);
  const patch = {};
  if (name) patch.name = name; if (birthday !== undefined) patch.birthday = birthday || ''; if (anniversary !== undefined) patch.anniversary = anniversary || ''; if (optin !== undefined) patch.optin = !!optin;
  c = store.put('customers', Object.assign({ id: c ? c.id : uid(), phone: ph, created_at: c ? c.created_at : now() }, c ? {} : { name: name || '', optin: optin !== false }, patch));
  store.patch('orders', order.id, { customer_id: c.id, customer_phone: ph, customer_name: c.name || '', points_used: 0 });
  return c;
}
export function detachCustomer(order) { store.patch('orders', order.id, { customer_id: null, customer_phone: null, customer_name: null, points_used: 0 }); }
export function setPointsUsed(order, pts) {
  const s = settings(); const o = store.get('orders', order.id) || order;
  if (!o.customer_id) return 0;
  const bal = pointsOf(o.customer_id);
  const t0 = calcTotals(Object.assign({}, o, { points_used: 0 }), itemsOf(o.id));
  const maxByPct = Math.floor((t0.subtotal - t0.discountTotal) * (Number(s.max_redeem_pct) || 100) / 100 / (Number(s.point_value) || 1));
  let n = Math.max(0, Math.min(Math.floor(pts), bal, maxByPct));
  if (n > 0 && n < (Number(s.min_redeem_points) || 0)) n = 0;
  store.patch('orders', o.id, { points_used: n });
  return n;
}
export const coupons = () => memo('coupons', () => store.all('coupons').sort((a, b) => String(a.code).localeCompare(String(b.code))));
export const findCoupon = code => { const c = String(code || '').trim().toUpperCase(); return c ? coupons().find(x => String(x.code).toUpperCase() === c) || null : null; };
export function couponUses(code, exceptOrderId, customerId) {
  let n = 0;
  for (const o of store.all('orders')) if (o.status === 'paid' && o.id !== exceptOrderId && o.coupon && o.coupon.code === code && (!customerId || o.customer_id === customerId)) n++;
  return n;
}
/** -> { ok, reason?, coupon } */
export function couponCheck(code, order) {
  const c = findCoupon(code);
  if (!c || c.active === false) return { ok: false, reason: 'Invalid coupon code' };
  const day = today();
  if (c.valid_from && day < c.valid_from) return { ok: false, reason: 'Coupon is not valid yet' };
  if (c.valid_to && day > c.valid_to) return { ok: false, reason: 'Coupon has expired' };
  const sub = calcTotals(Object.assign({}, order, { coupon: null, points_used: 0 }), itemsOf(order.id)).subtotal;
  if (Number(c.min_bill) > sub) return { ok: false, reason: 'Minimum bill ₹' + c.min_bill + ' needed' };
  if (Number(c.limit_total) > 0 && couponUses(c.code, order.id) >= Number(c.limit_total)) return { ok: false, reason: 'Coupon usage limit reached' };
  if (c.once_per_customer) {
    if (!order.customer_id) return { ok: false, reason: 'Add the customer mobile number first' };
    if (couponUses(c.code, order.id, order.customer_id) > 0) return { ok: false, reason: 'Already used by this customer' };
  }
  return { ok: true, coupon: c };
}
export function applyCoupon(order, code) {
  const r = couponCheck(code, order);
  if (r.ok) store.patch('orders', order.id, { coupon: { code: r.coupon.code, kind: r.coupon.kind || 'pct', value: Number(r.coupon.value) || 0, max_off: Number(r.coupon.max_off) || 0 } });
  return r;
}
export const removeCoupon = order => store.patch('orders', order.id, { coupon: null });

// ───────── partners (Zomato, Swiggy, agents) ─────────
export const partners = () => memo('partners', () => store.all('partners').filter(p => p.active !== false).sort((a, b) => a.name.localeCompare(b.name)));

// ───────── calls ─────────
export const activeCalls = () => memo('calls', () => store.all('calls').filter(c => !c.done && now() - c.at < 6 * 3600e3).sort((a, b) => a.at - b.at));
export function callWaiter(tableId, kind = 'waiter') {
  const dup = activeCalls().find(c => c.table_id === tableId && c.kind === kind);
  if (dup) return dup;
  return store.put('calls', { id: uid(), table_id: tableId, kind, at: now(), done: false });
}
export const clearCall = id => store.patch('calls', id, { done: true, done_at: now() });
export function requestBill(order) {
  store.patch('orders', order.id, { bill_requested: true, bill_requested_at: now() });
  if (order.table_id) callWaiter(order.table_id, 'bill');
}

// ───────── tables ─────────
export const tables = () => memo('tables', () => store.all('tables').filter(t => t.active !== false).sort((a, b) => String(a.no).localeCompare(String(b.no), undefined, { numeric: true })));
export const areas = () => memo('areas', () => store.all('areas').sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name)));
export function tableState(table) {
  const order = orderForTable(table.id);
  const calls = activeCalls().filter(c => c.table_id === table.id);
  const st = { table, order, calls, counts: { pending: 0, new: 0, preparing: 0, ready: 0, served: 0 }, total: 0, status: 'free' };
  if (order) {
    const its = itemsOf(order.id);
    for (const i of its) if (st.counts[i.status] !== undefined) st.counts[i.status]++;
    st.total = calcTotals(order, its).total;
    st.status = 'busy';
    if (order.bill_requested || calls.some(c => c.kind === 'bill')) st.status = 'bill';
    if (st.counts.ready > 0) st.status = st.status === 'bill' ? 'bill' : 'ready';
    if (st.counts.pending > 0 || calls.some(c => c.kind === 'waiter')) st.status = 'attention';
    if (!its.some(i => i.status !== 'void')) st.status = 'free';
  } else if (calls.length) st.status = 'attention';
  return st;
}
export const tableById = id => store.get('tables', id);
export function tableByNo(no) { return store.all('tables').find(t => String(t.no) === String(no)); }

// ───────── reservations ─────────
export const reservations = () => memo('resv', () => store.all('reservations').sort((a, b) => a.at - b.at));
export function upcomingReservation(tableId, withinMin = 90) {
  const t = now();
  return reservations().find(r => r.table_id === tableId && r.status === 'booked' && r.at > t - 20 * 60000 && r.at < t + withinMin * 60000);
}

// ───────── shifts & expenses ─────────
export const shifts = () => memo('shifts', () => store.all('shifts').sort((a, b) => b.opened_at - a.opened_at));
export const currentShift = userId => shifts().find(x => !x.closed_at && x.user_id === (userId || (session.user && session.user.id)));
export function openShift(userId, openingCash) {
  return store.put('shifts', { id: uid(), user_id: userId, opened_at: now(), day: bizDay(now(), settings().day_start_hour), opening_cash: Number(openingCash) || 0, closed_at: null });
}
export function shiftSummary(sh) {
  const end = sh.closed_at || now();
  const orders = store.all('orders').filter(o => o.status === 'paid' && o.cashier_id === sh.user_id && o.paid_at >= sh.opened_at && o.paid_at <= end);
  const by = {};
  let cashIn = 0, tips = 0, sales = 0;
  for (const o of orders) {
    sales += (o.totals && o.totals.total) || 0; tips += Number(o.tip) || 0;
    for (const p of o.payments || []) { const net = p.amount - (p.change || 0); by[p.method] = (by[p.method] || 0) + net; }
  }
  cashIn = by.cash || 0;
  const exp = store.all('expenses').filter(e => e.paid_via === 'cash' && e.by === sh.user_id && e.at >= sh.opened_at && e.at <= end);
  const cashOut = sum(exp, e => e.amount);
  const expected = r2(sh.opening_cash + cashIn - cashOut);
  return { orders, by, sales, tips, cashIn, cashOut, expected, count: orders.length };
}
export function closeShift(sh, counted, note) {
  const sm = shiftSummary(sh);
  store.patch('shifts', sh.id, { closed_at: now(), counted_cash: Number(counted) || 0, expected_cash: sm.expected, diff: r2((Number(counted) || 0) - sm.expected), sales: r2(sm.sales), tips: r2(sm.tips), note: note || '' });
}
export const expenses = () => memo('expenses', () => store.all('expenses').sort((a, b) => b.at - a.at));
export function addExpense({ category, amount, note, paid_via = 'cash', vendor = '', userId }) {
  const s = settings();
  const sh = currentShift(userId);
  return store.put('expenses', { id: uid(), category, amount: r2(amount), note, paid_via, vendor, at: now(), day: bizDay(now(), s.day_start_hour), by: userId || (session.user && session.user.id), shift_id: sh ? sh.id : null });
}

// ───────── reports ─────────
export const today = () => bizDay(now(), settings().day_start_hour);
export function addDays(day, n) {
  const d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export const paidOrders = (from, to) => store.all('orders').filter(o => o.status === 'paid' && o.day >= from && o.day <= to);

export function salesReport(fromDay, toDay) {
  const s = settings();
  const orders = paidOrders(fromDay, toDay);
  const idx = orderItemsIndex();
  const byDay = new Map(), byItem = new Map(), byCat = new Map(), byPay = new Map(), byHour = new Array(24).fill(0), byStaff = new Map(), byType = new Map(), byPartner = new Map();
  let sales = 0, tax = 0, service = 0, discount = 0, items = 0, cogs = 0, guests = 0, tips = 0, taxable = 0, memberDisc = 0;
  for (const o of orders) {
    const t = o.totals || calcTotals(o, idx.get(o.id) || []);
    sales += t.total; tax += t.tax; service += t.service; discount += t.discountTotal || t.discount || 0; guests += o.guests || 0; tips += Number(o.tip) || 0; taxable += t.taxable || 0; memberDisc += t.memberDiscount || 0;
    const d = byDay.get(o.day) || { day: o.day, orders: 0, sales: 0 };
    d.orders++; d.sales += t.total; byDay.set(o.day, d);
    byHour[new Date(o.paid_at || o.created_at).getHours()] += t.total;
    for (const p of o.payments || []) byPay.set(p.method, (byPay.get(p.method) || 0) + (p.amount - (p.change || 0)));
    const sf = o.waiter_id || o.cashier_id || '-'; const sv = byStaff.get(sf) || { orders: 0, sales: 0 }; sv.orders++; sv.sales += t.total; byStaff.set(sf, sv);
    const ty = byType.get(o.type) || { orders: 0, sales: 0 }; ty.orders++; ty.sales += t.total; byType.set(o.type, ty);
    if (o.partner_id) { const pv = byPartner.get(o.partner_id) || { orders: 0, sales: 0 }; pv.orders++; pv.sales += t.total; byPartner.set(o.partner_id, pv); }
    for (const l of (idx.get(o.id) || []).filter(billed)) {
      items += l.qty;
      const it = store.get('items', l.item_id);
      const rev = l.price * l.qty;
      const e = byItem.get(l.item_id || l.name) || { name: l.name, qty: 0, revenue: 0, cost: 0, category_id: it && it.category_id };
      e.qty += l.qty; e.revenue += rev;
      const c = it ? itemCost(it) * l.qty : 0; e.cost += c; cogs += c;
      byItem.set(l.item_id || l.name, e);
      const cat = it ? it.category_id : '-'; const ce = byCat.get(cat) || { qty: 0, revenue: 0 }; ce.qty += l.qty; ce.revenue += rev; byCat.set(cat, ce);
    }
  }
  const dayOf = ts => bizDay(ts, s.day_start_hour);
  const voids = store.all('order_items').filter(i => i.status === 'void' && i.void_at && dayOf(i.void_at) >= fromDay && dayOf(i.void_at) <= toDay && i.void_from !== 'pending');
  const cancelled = store.all('orders').filter(o => o.status === 'cancelled' && o.day >= fromDay && o.day <= toDay);
  const exps = store.all('expenses').filter(e => e.day >= fromDay && e.day <= toDay);
  return {
    orders, count: orders.length, sales, tax, taxable, service, discount, memberDisc, items, cogs, guests, tips, avg: orders.length ? sales / orders.length : 0,
    byDay: Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day)),
    byItem: Array.from(byItem.values()).sort((a, b) => b.revenue - a.revenue),
    byCat, byPay, byHour, byStaff, byType, byPartner, voidCount: voids.length, voidValue: sum(voids, l => l.price * l.qty),
    cancelledCount: cancelled.length, cancelledValue: sum(cancelled, o => (o.totals && o.totals.total) || 0),
    expenses: sum(exps, e => e.amount), expenseList: exps
  };
}

/** GST data for a period, shaped like the GSTR-1 tables an accountant files from. */
export function gstReport(fromDay, toDay) {
  const s = settings();
  const orders = paidOrders(fromDay, toDay).sort((a, b) => (a.bill_fy || '').localeCompare(b.bill_fy || '') || a.bill_no - b.bill_no);
  const cancelled = store.all('orders').filter(o => o.status === 'cancelled' && o.day >= fromDay && o.day <= toDay && o.bill_no != null);
  const idx = orderItemsIndex();
  const byRate = new Map(), hsn = new Map(), b2b = [], b2cs = new Map(), invoices = [];
  const ownState = s.state_code || '';
  for (const o of orders) {
    const t = o.totals || calcTotals(o, idx.get(o.id) || []);
    const cust = o.customer || {};
    const isB2B = !!(cust.gstin);
    const pos = isB2B ? (cust.state_code || String(cust.gstin).slice(0, 2)) : ownState;
    const inv = { order: o, no: billNoLabel(o), date: o.day, customer: cust.name || '', gstin: cust.gstin || '', pos, total: t.total, taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, tax: t.tax, rounding: t.rounding, type: isB2B ? 'B2B' : 'B2C', tip: Number(o.tip) || 0 };
    invoices.push(inv);
    if (isB2B) b2b.push(inv);
    for (const g of t.groups || []) {
      const r = byRate.get(g.rate) || { rate: g.rate, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, invoices: 0 };
      r.taxable += g.taxable; r.cgst += g.cgst; r.sgst += g.sgst; r.igst += g.igst; r.tax += g.tax; r.invoices++; byRate.set(g.rate, r);
      if (!isB2B) {
        const k = pos + '|' + g.rate; const e = b2cs.get(k) || { pos, rate: g.rate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
        e.taxable += g.taxable; e.cgst += g.cgst; e.sgst += g.sgst; e.igst += g.igst; b2cs.set(k, e);
      }
    }
    // HSN summary: spread each invoice-rate group over its lines pro-rata to goods value
    const live = (idx.get(o.id) || []).filter(billed);
    const gstOn = t.gstOn !== false && t.scheme !== 'none' && t.scheme !== 'composition';
    const f = t.f == null ? 1 : t.f;
    const lineGoods = live.map(l => {
      const rate = gstOn ? (l.gst == null ? 0 : Number(l.gst)) : 0;
      const a = l.price * l.qty * f;
      return { l, rate, goods: t.inclusive ? a / (1 + rate / 100) : a };
    });
    for (const g of t.groups || []) {
      const mine = lineGoods.filter(x => x.rate === g.rate);
      const gSum = sum(mine, x => x.goods) || 1;
      for (const x of mine) {
        const share = x.goods / gSum;
        const key = (x.l.hsn || s.default_hsn || '') + '|' + g.rate;
        const e = hsn.get(key) || { hsn: x.l.hsn || s.default_hsn || '', rate: g.rate, qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0 };
        e.qty += x.l.qty; e.taxable += g.taxable * share; e.cgst += g.cgst * share; e.sgst += g.sgst * share; e.igst += g.igst * share; e.tax += g.tax * share;
        hsn.set(key, e);
      }
    }
  }
  // documents issued (table 13): first / last number per FY series
  const docs = new Map();
  for (const o of orders.concat(cancelled)) {
    const k = o.bill_fy || 'all'; const d = docs.get(k) || { fy: k, from: Infinity, to: 0, total: 0, cancelled: 0 };
    d.from = Math.min(d.from, o.bill_no); d.to = Math.max(d.to, o.bill_no); d.total++; if (o.status === 'cancelled') d.cancelled++; docs.set(k, d);
  }
  const totals = { invoices: orders.length, taxable: sum(invoices, i => i.taxable), cgst: sum(invoices, i => i.cgst), sgst: sum(invoices, i => i.sgst), igst: sum(invoices, i => i.igst), tax: sum(invoices, i => i.tax), total: sum(invoices, i => i.total) };
  return { invoices, b2b, byRate: Array.from(byRate.values()).sort((a, b) => a.rate - b.rate), hsn: Array.from(hsn.values()).sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate), b2cs: Array.from(b2cs.values()).sort((a, b) => a.rate - b.rate), docs: Array.from(docs.values()).map(d => ({ ...d, from: d.from === Infinity ? 0 : d.from })), cancelled, totals, stateName };
}

/** Commission (staff + partners) and tips, with what has already been paid out. */
export function earningsReport(fromDay, toDay) {
  const s = settings();
  const idx = orderItemsIndex();
  const staffM = new Map(), partnerM = new Map();
  const get = id => { let e = staffM.get(id); if (!e) { const u = store.get('users', id) || {}; e = { id, name: u.name || '—', role: u.role || '', orders: 0, sales: 0, commission: 0, tips: 0, rate: Number(u.commission_pct) || 0 }; staffM.set(id, e); } return e; };
  const orders = paidOrders(fromDay, toDay);
  const poolByDay = new Map();
  for (const o of orders) {
    const t = o.totals || calcTotals(o, idx.get(o.id) || []);
    const wid = o.waiter_id;
    if (wid) {
      const e = get(wid); e.orders++; e.sales += t.goodsNet;
      const u = store.get('users', wid) || {};
      const base = Number(u.commission_pct);
      const fall = isNaN(base) || u.commission_pct === '' || u.commission_pct == null ? Number(s.commission_default_pct) || 0 : base;
      const f = t.f == null ? 1 : t.f;
      for (const l of (idx.get(o.id) || []).filter(billed)) {
        const rate = t.gstOn && t.scheme === 'regular' ? Number(l.gst || 0) : 0;
        const a = l.price * l.qty * f;
        const goods = t.inclusive ? a / (1 + rate / 100) : a;
        const pct = l.comm != null ? l.comm : fall;
        e.commission += goods * pct / 100;
      }
    }
    const tip = Number(o.tip) || 0;
    if (tip > 0) {
      if (s.tips_mode === 'pool') { const d = poolByDay.get(o.day) || { tips: 0, staff: new Set() }; d.tips += tip; poolByDay.set(o.day, d); }
      else if (wid) get(wid).tips += tip; else if (o.cashier_id) get(o.cashier_id).tips += tip;
    }
    if (o.partner_id) {
      const p = store.get('partners', o.partner_id) || { name: '—' };
      const e = partnerM.get(o.partner_id) || { id: o.partner_id, name: p.name, kind: p.kind, orders: 0, sales: 0, commission: 0 };
      e.orders++; e.sales += t.total; e.commission += t.goodsNet * (Number(o.partner_pct) || 0) / 100; partnerM.set(o.partner_id, e);
    }
  }
  if (s.tips_mode === 'pool') {
    for (const [day, d] of poolByDay) {
      const crew = new Set(orders.filter(o => o.day === day && o.waiter_id && (store.get('users', o.waiter_id) || {}).role === 'waiter').map(o => o.waiter_id));
      if (!crew.size) orders.filter(o => o.day === day && Number(o.tip)).forEach(o => (o.waiter_id || o.cashier_id) && crew.add(o.waiter_id || o.cashier_id));
      for (const id of crew) get(id).tips += d.tips / crew.size;
    }
  }
  // payouts (all time, for outstanding balance) + in-period
  const pay = store.all('payouts');
  const paidIn = (kind, who) => sum(pay.filter(p => p.kind === kind && p.who === who && p.day >= fromDay && p.day <= toDay), p => p.amount);
  const paidAll = (kind, who) => sum(pay.filter(p => p.kind === kind && p.who === who), p => p.amount);
  for (const e of staffM.values()) { e.commission = r2(e.commission); e.tips = r2(e.tips); e.sales = r2(e.sales); e.commPaid = paidIn('commission', e.id); e.tipPaid = paidIn('tip', e.id); }
  for (const e of partnerM.values()) { e.commission = r2(e.commission); e.sales = r2(e.sales); e.paid = paidIn('partner', e.id); }
  return { staff: Array.from(staffM.values()).sort((a, b) => b.sales - a.sales), partners: Array.from(partnerM.values()).sort((a, b) => b.sales - a.sales), paidAll, payouts: pay.filter(p => p.day >= fromDay && p.day <= toDay).sort((a, b) => b.at - a.at) };
}
/** Outstanding (all time earned − all time paid) for one person; used on the payout screen. */
export function outstanding(kind, who) {
  const rep = earningsReport('2000-01-01', '2999-12-31');
  const pay = sum(store.all('payouts').filter(p => p.kind === kind && p.who === who), p => p.amount);
  if (kind === 'partner') { const e = rep.partners.find(x => x.id === who); return r2((e ? e.commission : 0) - pay); }
  const e = rep.staff.find(x => x.id === who);
  return r2((e ? (kind === 'tip' ? e.tips : e.commission) : 0) - pay);
}
export function recordPayout({ kind, who, amount, note, userId }) {
  return store.put('payouts', { id: uid(), kind, who, amount: r2(amount), note: note || '', at: now(), day: bizDay(now(), settings().day_start_hour), by: userId || (session.user && session.user.id) });
}
