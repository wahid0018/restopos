// Three languages: English (en), हिन्दी (hi), اردو (ur). English text is the key; missing entries fall back to English.
// Switching is instant: setLang() fires 'langchange' and the app re-renders the current screen without a reload.
import { HI } from './hi.js';
import { UR } from './ur.js';
import { glossaryTranslate, glossaryPartial } from './glossary.js';

export const LANGS = [
  { id: 'en', label: 'English', short: 'EN', dir: 'ltr' },
  { id: 'hi', label: 'हिन्दी', short: 'हिं', dir: 'ltr' },
  { id: 'ur', label: 'اردو', short: 'اردو', dir: 'rtl' }
];
const DICT = { en: null, hi: HI, ur: UR };
const LS = 'restopos.lang';
let lang = localStorage.getItem(LS);
if (!DICT.hasOwnProperty(lang)) lang = 'en';
const subs = new Set();

export const getLang = () => lang;
export const isRTL = () => lang === 'ur';
export const onLang = fn => { subs.add(fn); return () => subs.delete(fn); };
export function setLang(l, persist = true) {
  if (!DICT.hasOwnProperty(l) || l === lang) return;
  lang = l;
  if (persist) localStorage.setItem(LS, lang);
  applyLang();
  for (const f of subs) { try { f(lang); } catch (e) { console.error(e); } }
}
export function applyLang() {
  const el = document.documentElement;
  el.lang = lang; el.dir = lang === 'ur' ? 'rtl' : 'ltr';
  el.dataset.lang = lang;
}
function fill(s, vars) { return vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '')) : s; }
// ── automatic translation of screen text that has no hand-written Hindi / Urdu entry ──
// Missing phrases are translated once (via the restaurant server or directly online), cached on the device, and the screen
// refreshes. Only fixed interface text is sent, never customer or order data. Falls back to English offline.
const AUTO = { on: true };
export const setAutoTranslate = v => { AUTO.on = v !== false; };
const loadC = l => { try { return JSON.parse(localStorage.getItem('restopos.autotr.' + l) || '{}'); } catch (_) { return {}; } };
const cache = { hi: loadC('hi'), ur: loadC('ur') };
const queued = { hi: new Set(), ur: new Set() }, failed = new Set();
let timer = null;
function want(l, key) {
  if (!AUTO.on || l === 'en' || failed.has(l + key) || !/[A-Za-z]{3}/.test(key) || key.length > 300) return;
  queued[l].add(key); clearTimeout(timer); timer = setTimeout(flush, 500);
}
export async function translateTexts(texts, to) {
  const body = JSON.stringify({ texts, to });
  try { const r = await fetch('api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }); if (r.ok) return (await r.json()).texts; } catch (_) { }
  const out = [];
  for (const q of texts) { // direct (online / Netlify mode)
    const r = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=' + to + '&dt=t&q=' + encodeURIComponent(q));
    if (!r.ok) throw new Error('translate ' + r.status);
    out.push(((await r.json())[0] || []).map(x => x[0]).join(''));
  }
  return out;
}
/** Dish / category names: dictionary first, then online translation, then partial dictionary. */
export async function autoTranslate(text, to) {
  const g = glossaryTranslate(text, to); if (g) return g;
  try { const [r] = await translateTexts([text], to); if (r) return r; } catch (_) { }
  return glossaryPartial(text, to);
}
async function flush() {
  let changed = false;
  for (const l of ['hi', 'ur']) {
    const keys = [...queued[l]].filter(k => !(DICT[l] && DICT[l][k]) && !cache[l][k]); queued[l].clear();
    for (let i = 0; i < keys.length; i += 40) {
      const part = keys.slice(i, i + 40);
      const prot = part.map(k => { const vs = []; return { s: k.replace(/\{(\w+)\}/g, m => { vs.push(m); return '_V' + (vs.length - 1) + '_'; }), vs }; });
      try {
        const res = await translateTexts(prot.map(p => p.s), l);
        part.forEach((k, j) => { let r = res[j]; if (!r) return failed.add(l + k); prot[j].vs.forEach((v, n) => { r = r.replace(new RegExp('_\\s*V\\s*' + n + '\\s*_', 'i'), v); }); if (prot[j].vs.every(v => r.includes(v))) { cache[l][k] = r; changed = true; } else failed.add(l + k); });
      } catch (_) { part.forEach(k => failed.add(l + k)); }
    }
    try { localStorage.setItem('restopos.autotr.' + l, JSON.stringify(cache[l])); } catch (_) { }
  }
  if (changed) for (const f of subs) { try { f(lang); } catch (e) { console.error(e); } }
}
function lookup(l, key) {
  const d = DICT[l]; if (d && d[key]) return d[key];
  if (l === 'en') return key;
  const c = cache[l][key]; if (c) return c;
  want(l, key); return key;
}
export function t(key, vars) { return fill(lookup(lang, key), vars); }
/** Translate into a specific language (bills / KOTs can differ from the screen language). */
export function tl(l, key, vars) {
  return fill(lookup(l, key), vars);
}
/** Localized name of a menu item / category / etc. (name, name_hi, name_ur) */
export function nameOf(o, l = lang) {
  if (!o) return '';
  if (l === 'hi' && o.name_hi) return o.name_hi;
  if (l === 'ur' && o.name_ur) return o.name_ur;
  return o.name || '';
}
export function descOf(o, l = lang) {
  if (!o) return '';
  if (l === 'hi' && o.desc_hi) return o.desc_hi;
  if (l === 'ur' && o.desc_ur) return o.desc_ur;
  return o.desc || '';
}
