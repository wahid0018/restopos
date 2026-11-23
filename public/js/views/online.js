// Online orders inbox: orders pushed by Zomato / Swiggy / any aggregator or integrator (Petpooja, UrbanPiper, Zapier…)
// to the restaurant server's webhook land here. Staff accept (→ delivery order + kitchen ticket) or reject.
import { h, empty, money, fmtTime, now, download } from '../util.js';
import { store } from '../store.js';
import { t } from '../i18n.js';
import { modal, toast, promptDlg, field } from '../ui.js';
import * as L from '../logic.js';
import { go } from '../app.js';

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9ऀ-ॿ؀-ۿ]/g, '');
export const pendingOnline = () => store.all('online_orders').filter(o => o.status === 'new');

export function matchItem(li) {
  const items = L.menuItems ? L.menuItems() : store.all('items').filter(i => i.active !== false);
  if (li.ext_id) { const byCode = items.find(i => i.id === li.ext_id || (i.code && String(i.code) === li.ext_id)); if (byCode) return byCode; }
  const n = norm(li.name);
  return items.find(i => norm(i.name) === n) || items.find(i => n && (norm(i.name).includes(n) || n.includes(norm(i.name))) && norm(i.name).length > 3) || null;
}
export function acceptOnline(rec, userId) {
  const partner = L.partners().find(p => norm(p.name) === norm(rec.platform)) || L.partners().find(p => norm(rec.platform).includes(norm(p.name)) || norm(p.name).includes(norm(rec.platform)));
  const cust = Object.assign({}, rec.customer);
  const o = L.createOrder({ type: 'delivery', source: 'online', userId, customer: Object.values(cust).some(Boolean) ? cust : null, partner_id: partner ? partner.id : null });
  const lines = rec.items.map(li => {
    const m = matchItem(li);
    const base = m ? L.makeLine(m, li.qty, [], '') : { item_id: null, name: li.name, qty: li.qty, price: li.price, mods: [], note: '', station: 'kitchen', gst: undefined, hsn: undefined, veg: '' };
    if (li.price > 0) base.price = li.price;
    return Object.assign(base, { qty: li.qty });
  });
  L.placeOrder({ order: o, type: 'delivery', lines, source: 'online', userId });
  store.patch('orders', o.id, { online_ref: rec.id, online_platform: rec.platform, online_ext_id: rec.ext_id, note: rec.note || '', partner_pct: partner ? (partner.commission_pct ?? partner.pct ?? null) : null });
  store.patch('online_orders', rec.id, { status: 'accepted', order_id: o.id, accepted_at: now(), accepted_by: userId || null });
  return o;
}

export function mount(el) {
  const page = h('div', { class: 'page' }), body = h('div'); el.append(page); page.append(body);
  let showAll = false;
  function draw() {
    empty(body);
    const st = L.settings();
    const url = (location.origin || '') + '/api/online-order?key=' + (st.online_orders_key || '<key>');
    body.append(h('div', { class: 'toolbar' }, h('h2', null, '🛵 ', t('Online orders')), h('span', { class: 'spacer' }),
      h('label', { class: 'chip' + (showAll ? ' on' : ''), onClick: () => { showAll = !showAll; draw(); } }, t('Show all')),
      h('button', { class: 'btn sm', onClick: manual }, '+ ', t('Enter order manually')),
      h('button', { class: 'btn sm', onClick: info }, 'ℹ ', t('How orders arrive'))));
    let list = store.all('online_orders').sort((a, b) => b.received_at - a.received_at);
    if (!showAll) list = list.filter(o => o.status === 'new');
    if (!list.length) return body.append(h('div', { class: 'empty' }, h('b', null, t('No new online orders')), h('p', { class: 'muted' }, t('Orders pushed by your delivery platforms appear here with a sound.'))));
    body.append(h('div', { class: 'online-list' }, list.map(card)));
  }
  function card(o) {
    const tot = o.total || o.items.reduce((a, i) => a + i.price * i.qty, 0);
    const stat = { new: t('New'), accepted: t('Accepted'), rejected: t('Rejected') }[o.status] || o.status;
    return h('div', { class: 'card online-card ' + o.status },
      h('div', { class: 'row sp' }, h('h3', null, o.platform + ' · #' + o.ext_id), h('span', { class: 'badge ' + (o.status === 'new' ? 'warn' : o.status === 'accepted' ? 'ok' : 'bad') }, stat)),
      h('div', { class: 'muted' }, fmtTime(o.received_at) + (o.customer && o.customer.name ? ' · ' + o.customer.name : '') + (o.customer && o.customer.phone ? ' · ' + o.customer.phone : '')),
      o.customer && o.customer.address ? h('div', null, '📍 ' + o.customer.address) : null,
      h('ul', { class: 'plain' }, o.items.map(i => { const m = matchItem(i); return h('li', null, h('b', null, i.qty + ' × '), i.name, ' ', h('span', { class: 'muted' }, money(i.price)), m ? null : h('span', { class: 'badge warn', title: t('Not found on your menu — will be billed as typed') }, '?')); })),
      o.note ? h('div', { class: 'hint' }, '✎ ' + o.note) : null,
      h('div', { class: 'row sp' }, h('b', { class: 'num' }, money(tot)), o.status === 'new' ? h('div', { class: 'row' },
        h('button', { class: 'btn sm danger', onClick: async () => { const r = await promptDlg({ title: t('Reject order'), label: t('Reason') }); if (r === null) return; store.patch('online_orders', o.id, { status: 'rejected', reason: r, rejected_at: now() }); draw(); } }, t('Reject')),
        h('button', { class: 'btn ok', onClick: () => { const ord = acceptOnline(o, L.session.user && L.session.user.id); toast(t('Accepted — sent to kitchen'), 'ok'); draw(); } }, '✓ ', t('Accept & send to kitchen'))) :
        o.order_id ? h('button', { class: 'btn sm', onClick: () => go('/order/o/' + o.order_id) }, t('Open bill')) : null));
  }
  function manual() {
    const ta = h('textarea', { rows: 8, placeholder: '{"platform":"Swiggy","order_id":"1234","customer":{"name":"Asha","phone":"9876543210","address":"…"},"items":[{"name":"Paneer tikka","qty":2,"price":280}],"total":560}' });
    modal({ title: t('Enter order manually'), size: 'md', body: h('div', null, h('p', { class: 'muted' }, t('Paste the order JSON (same format the webhook accepts). Useful for testing.')), ta),
      actions: [{ label: t('Cancel'), kind: 'ghost' }, { label: t('Add'), kind: 'primary', onClick: close => {
        try {
          const b = JSON.parse(ta.value); const cu = b.customer || {};
          const items = (b.items || []).map(i => ({ ext_id: String(i.id || ''), name: String(i.name || ''), qty: Number(i.qty || i.quantity || 1), price: Number(i.price || 0) }));
          if (!items.length) throw new Error('No items');
          const ext = String(b.order_id || b.id || Date.now()); const plat = String(b.platform || 'Online');
          store.put('online_orders', { id: 'oo_' + norm(plat) + '_' + ext, platform: plat, ext_id: ext, status: 'new', received_at: now(), customer: { name: cu.name || '', phone: cu.phone || '', address: cu.address || '' }, items, total: Number(b.total) || 0, note: b.note || b.instructions || '' });
          close(); draw();
        } catch (e) { toast(e.message, 'bad'); return false; }
      } }] });
  }
  function info() {
    const st = L.settings();
    const url = location.origin + '/api/online-order?key=' + (st.online_orders_key || '<set a key in Admin → Rewards & integrations>');
    modal({ title: t('How orders arrive'), size: 'md', body: h('div', null,
      h('p', null, t('Zomato and Swiggy do not let a restaurant app read orders directly. Orders reach RestoPOS through their approved integration partner (for example Petpooja, UrbanPiper, Dotpe) or an automation tool (Zapier / Make), which can send each order to this web address:')),
      h('pre', { class: 'code' }, 'POST ' + url + '\nContent-Type: application/json'),
      h('pre', { class: 'code' }, '{ "platform": "Zomato", "order_id": "ZMT123", "customer": {"name":"…","phone":"…","address":"…"},\n  "items": [ {"name":"Paneer tikka","qty":2,"price":280} ], "total": 560, "instructions": "less spicy" }'),
      h('p', { class: 'muted' }, t('The restaurant server must be reachable from the internet for this (for example through a Cloudflare Tunnel or ngrok), or you can use the manual entry button.')))
    , actions: [{ label: t('Close'), kind: 'primary' }] });
  }
  draw();
  return { update() { if (!document.querySelector('.modal-wrap')) draw(); } };
}
