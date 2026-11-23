// WhatsApp helpers. Two ways to reach a customer:
//  1. wa.me click-to-chat link (no setup; staff taps Send in WhatsApp)           -> waLink()
//  2. WhatsApp Business Cloud API through the local server (token stays on server) -> waSend()
import { store } from './store.js';
import { cleanPhone } from './logic.js';

export const waLink = (phone, text) => 'https://wa.me/91' + cleanPhone(phone) + '?text=' + encodeURIComponent(text || '');
export const fillMsg = (text, vars) => String(text || '').replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
let infoCache = null;
export async function waStatus(force) {
  if (store.kind !== 'local') return { api: false, reason: 'API sending needs the restaurant server (not online-only mode).' };
  if (!infoCache || force) { try { infoCache = await (await fetch('api/info')).json(); } catch (_) { infoCache = {}; } }
  return { api: !!infoCache.wa, phone_id: infoCache.wa_phone_id || '' };
}
export async function waSend({ to, text, template, lang = 'en', params = [] }) {
  const r = await fetch('api/whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: '91' + cleanPhone(to), text, template, lang, params }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}
export async function waSetup(cfg) {
  const r = await fetch('api/whatsapp-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) });
  infoCache = null; return r.ok;
}
