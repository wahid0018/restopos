// Orders & bills: open orders, today's invoices (reprint / cancel / change waiter), approvals.
import { h, empty, money, fmtTime, fmtDate, now } from '../util.js';
import { store } from '../store.js';
import { t } from '../i18n.js';
import { modal, toast, confirmDlg, pickDlg, promptDlg } from '../ui.js';
import * as L from '../logic.js';
import { go } from '../app.js';
import { tabs, dataTable, rangePicker, newRange, csvBtn } from './kit.js';
import { printReceipt } from '../print.js';
import { statusPill } from './shared.js';

export function mount(el) {
  const user = L.session.user;
  let tab = 'open', q = '';
  const range = newRange('today');
  const page = h('div', { class: 'page' });
  const body = h('div');
  el.append(page);
  page.append(tabs([{ id: 'open', label: t('Open orders') }, { id: 'bills', label: t('Bills') }, { id: 'cancelled', label: t('Cancelled') }], tab, id => { tab = id; draw(); }), body);

  const tableOf = o => { const tb = L.tableById(o.table_id); return tb ? t('Table') + ' ' + tb.no : t(o.type === 'delivery' ? 'Delivery' : 'Takeaway'); };
  const search = h('input', { type: 'search', placeholder: t('Search invoice, table, customer…'), onInput: e => { q = e.target.value.toLowerCase(); draw(true); } });
  const matches = o => !q || [L.billNoLabel(o), String(o.no), tableOf(o), (o.customer || {}).name, (o.customer || {}).phone, o.member_name, L.userName(o.waiter_id)].some(x => x && String(x).toLowerCase().includes(q));

  function draw(keepSearch) {
    empty(body);
    const tools = h('div', { class: 'toolbar' }, search);
    if (tab !== 'open') tools.append(rangePicker(range, () => draw(true)));
    body.append(tools);
    if (tab === 'open') {
      const list = L.openOrders().filter(matches).sort((a, b) => b.created_at - a.created_at);
      body.append(dataTable([
        { label: '#', get: o => o.no ?? '…' }, { label: t('Table / type'), get: tableOf }, { label: t('Waiter'), get: o => L.userName(o.waiter_id) },
        { label: t('Started'), get: o => fmtTime(o.created_at) }, { label: t('Status'), get: o => { const its = L.itemsOf(o.id); const p = its.filter(i => i.status === 'pending').length; return p ? h('span', { class: 'badge bad' }, t('{n} awaiting approval', { n: p })) : its.some(i => i.status === 'ready') ? statusPill('ready') : statusPill('new'); } },
        { label: t('Amount'), cls: 'r', get: o => L.calcTotals(o, L.itemsOf(o.id)).total, fmt: v => money(v) },
        { label: '', get: o => h('button', { class: 'btn sm primary', onClick: () => go('/order/o/' + o.id) }, t('Open')) }
      ], list, { empty: t('No open orders') }));
    } else {
      const status = tab === 'bills' ? 'paid' : 'cancelled';
      const list = store.all('orders').filter(o => o.status === status && o.day >= range.from && o.day <= range.to && matches(o)).sort((a, b) => (b.paid_at || b.cancelled_at || 0) - (a.paid_at || a.cancelled_at || 0));
      const tot = list.reduce((a, o) => a + ((o.totals || {}).total || 0), 0);
      body.append(h('p', { class: 'muted', style: { marginBottom: '.5rem' } }, t('{n} bills · total {amt}', { n: list.length, amt: money(tot) })));
      body.append(dataTable([
        { label: t('Invoice'), get: o => L.billNoLabel(o) }, { label: t('Date'), get: o => fmtDate(o.paid_at || o.created_at) + ' ' + fmtTime(o.paid_at || o.created_at) }, { label: t('Table / type'), get: tableOf },
        { label: t('Customer'), get: o => (o.member_name ? '💳 ' : '') + ((o.customer && o.customer.name) || o.member_name || '') }, { label: t('Waiter'), get: o => L.userName(o.waiter_id) },
        { label: t('Paid by'), get: o => (o.payments || []).map(p => (L.settings().payment_methods.find(m => m.id === p.method) || {}).label || p.method).join(' + ') },
        { label: t('GST'), cls: 'r', get: o => (o.totals || {}).tax || 0, fmt: v => money(v) }, { label: t('Tip'), cls: 'r', get: o => o.tip || 0, fmt: v => v ? money(v) : '' },
        { label: t('Total'), cls: 'r', get: o => (o.totals || {}).total || 0, fmt: v => money(v) },
        { label: '', get: o => h('button', { class: 'btn sm', onClick: () => details(o) }, t('View')) }
      ], list, { empty: t('No bills in this period') }));
    }
    if (keepSearch) { const s = body.querySelector('input[type=search]'); if (s) { s.value = search.value; } }
  }

  function details(o) {
    const items = L.itemsOf(o.id).filter(L.billed);
    const tt = L.orderTotals(o);
    const body = h('div', null,
      h('div', { class: 'row sp wrap' }, h('div', null, h('b', null, L.billNoLabel(o)), h('div', { class: 'muted' }, fmtDate(o.paid_at || o.created_at) + ' ' + fmtTime(o.paid_at || o.created_at) + ' · ' + tableOf(o) + (o.waiter_id ? ' · ' + L.userName(o.waiter_id) : ''))), h('span', { class: 'badge ' + (o.status === 'paid' ? 'ok' : 'bad') }, o.status === 'paid' ? t('Paid') : t('Cancelled'))),
      h('hr', { class: 'sep' }),
      ...items.map(l => h('div', { class: 'tot-row' }, h('span', null, l.qty + ' × ' + l.name), h('span', { class: 'num' }, money(L.lineTotal(l))))),
      h('hr', { class: 'sep' }),
      h('div', { class: 'tot-row' }, h('span', null, t('Taxable value')), h('span', { class: 'num' }, money(tt.taxable))),
      tt.cgst ? h('div', { class: 'tot-row' }, h('span', null, 'CGST'), h('span', { class: 'num' }, money(tt.cgst))) : null, tt.sgst ? h('div', { class: 'tot-row' }, h('span', null, 'SGST'), h('span', { class: 'num' }, money(tt.sgst))) : null, tt.igst ? h('div', { class: 'tot-row' }, h('span', null, 'IGST'), h('span', { class: 'num' }, money(tt.igst))) : null,
      tt.memberDiscount ? h('div', { class: 'tot-row' }, h('span', null, t('Member discount')), h('span', { class: 'num' }, '-' + money(tt.memberDiscount))) : null,
      h('div', { class: 'tot-row grand' }, h('span', null, t('Total')), h('span', { class: 'num' }, money(tt.total))),
      o.tip ? h('div', { class: 'tot-row' }, h('span', null, t('Tip')), h('span', { class: 'num' }, money(o.tip))) : null,
      o.cancel_reason ? h('div', { class: 'hint bad', style: { marginTop: '.6rem' } }, t('Reason') + ': ' + o.cancel_reason) : null);
    const acts = [{ label: '🖨 ' + t('Reprint'), onClick: async () => { try { await printReceipt(o); } catch (e) { toast(e.message, 'bad', 5000); } return false; } }];
    if (L.can('pos') && L.feature('tables')) acts.push({ label: t('Change waiter'), kind: 'ghost', onClick: async (c) => { const v = await pickDlg({ title: t('Assign waiter'), options: L.waiters().map(u => ({ value: u.id, label: u.name })) }); if (v) { L.setWaiter(o, v); toast(t('Waiter assigned'), 'ok'); c(); draw(true); } return false; } });
    if (o.status === 'paid' && L.can('cancel_bill')) acts.push({ label: t('Cancel bill'), kind: 'danger', onClick: async (c) => { const r = await promptDlg({ title: t('Cancel bill'), label: t('Reason (required)') }); if (!r) return false; L.cancelBill(o, r, user.id); toast(t('Bill cancelled — the invoice number stays on record'), 'warn', 5000); c(); draw(true); } });
    acts.push({ label: t('Close'), kind: 'primary' });
    modal({ title: t('Bill details'), size: 'md', body, actions: acts });
  }
  draw();
  return { update: () => { if (tab === 'open') draw(true); } };
}
