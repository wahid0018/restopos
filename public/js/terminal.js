// Sends the amount to a payment terminal / soundbox / card machine over HTTP (through the restaurant server, which can reach the LAN).
// Every terminal vendor has its own API, so the request is fully configurable in Admin → Payment terminals using {placeholders}.
import { settings } from './logic.js';
import { store } from './store.js';
import { upiLink } from './gst.js';

export const terminalConfigured = kind => { const c = (settings().terminals || {})[kind]; return !!(c && c.on && c.url); };
export const fillTpl = (str, vars) => String(str || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
export function parseHeaders(txt) {
  const h = {};
  for (const line of String(txt || '').split('\n')) { const i = line.indexOf(':'); if (i > 0) h[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  return h;
}
export function terminalVars(order, amount) {
  const s = settings();
  const ref = (order.no != null ? order.no : '') + '-' + Date.now().toString(36);
  return { amount: Number(amount).toFixed(2), amount_paise: String(Math.round(Number(amount) * 100)), order: order.no != null ? String(order.no) : '', order_id: order.id, ref,
    upi_vpa: s.upi_id || '', name: s.upi_name || s.name || '', upi_link: s.upi_id ? upiLink({ vpa: s.upi_id, name: s.upi_name || s.name, amount, note: 'Order ' + (order.no || '') }) : '', phone: order.customer_phone || '' };
}
export async function sendToTerminal(kind, order, amount) {
  const c = (settings().terminals || {})[kind];
  if (!c || !c.url) throw new Error('Terminal is not configured (Admin → Payment terminals)');
  if (store.kind !== 'local') throw new Error('Sending to a terminal needs the restaurant server on the Wi-Fi.');
  const v = terminalVars(order, amount);
  const hd = parseHeaders(c.headers); for (const k of Object.keys(hd)) hd[k] = fillTpl(hd[k], v);
  const r = await fetch('api/terminal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: fillTpl(c.url, v), method: c.method || 'POST', headers: hd, body: fillTpl(c.body, v) }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || ('Terminal replied ' + (j.status || r.status) + ' ' + (j.response || '')));
  return j;
}
