// Customer-facing payment screen: big amount + UPI QR. Opened from the cashier's payment dialog on a second screen / tablet,
// or shown automatically on the table tablet while the cashier is collecting UPI for that table.
import { h, empty, money } from '../util.js';
import { store } from '../store.js';
import { t } from '../i18n.js';
import * as L from '../logic.js';
import { qrSvg } from '../qr.js';
import { langSwitch } from './shared.js';

export function payPanel(o) {
  const s = L.settings();
  if (!o) return h('div', { class: 'payscreen' }, h('h2', null, s.name));
  if (o.status === 'paid') return h('div', { class: 'payscreen' }, h('div', { class: 'sent-ok' }, h('div', { class: 'big' }, '✅'), h('h1', null, t('Payment received')), h('p', { class: 'muted' }, t('Thank you! Visit again.'))));
  const pd = o.pay_display;
  if (!pd) return h('div', { class: 'payscreen' }, h('h2', null, s.name), h('p', { class: 'muted' }, t('Your bill is being prepared')), h('div', { class: 'big-total' }, money(L.orderTotals(o).total)));
  return h('div', { class: 'payscreen' },
    h('h2', null, s.name), h('p', { class: 'muted' }, t('Scan with any UPI app') + ' · GPay · PhonePe · Paytm'),
    h('div', { class: 'big-total xl' }, money(pd.amount)),
    h('div', { class: 'qr-card', html: qrSvg(pd.link, { px: 300, margin: 2 }) }),
    h('p', { class: 'muted' }, s.upi_id));
}
export function mount(el, { args }) {
  const id = args[0];
  const host = h('div', { class: 'center-screen' });
  const draw = () => { empty(host); host.append(h('div', { class: 'panel center' }, h('div', { style: { textAlign: 'end' } }, langSwitch({ big: false, persist: false })), payPanel(store.get('orders', id)))); };
  el.append(host); draw();
  return { update: draw, onLang: draw };
}
