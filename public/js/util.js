// Small helpers shared by every screen. No dependencies.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Tiny hyperscript: h('button', {class:'btn', onClick: fn}, 'Label') */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  const deferredValue = [];
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value' || k === 'selected') deferredValue.push([k, v]);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'for') el.htmlFor = v;
    else if (k in el && !k.includes('-') && k !== 'list' && k !== 'form') { try { el[k] = v; } catch (_) { el.setAttribute(k, v === true ? '' : v); } }
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  for (const [dk, dv] of deferredValue) el[dk] = dv;
  return el;
}
export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return el;
}
export const empty = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── ids & time ──
export function uid() {
  const a = new Uint8Array(5);
  crypto.getRandomValues(a);
  return Date.now().toString(36) + Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}
/** Clock synced to the server so every tablet agrees on "now". */
export const clock = { offset: 0 };
export const now = () => Date.now() + clock.offset;
export function bizDay(ts = now(), startHour = 4) {
  const d = new Date(ts - startHour * 3600e3);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const pad = n => String(n).padStart(2, '0');
export const fmtTime = ts => { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
export const fmtDate = ts => { const d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
export const fmtDateTime = ts => fmtDate(ts) + ' ' + fmtTime(ts);
export function elapsed(ts) {
  const s = Math.max(0, Math.floor((now() - ts) / 1000));
  const m = Math.floor(s / 60);
  if (m >= 60) return Math.floor(m / 60) + 'h ' + pad(m % 60) + 'm';
  return m + ':' + pad(s % 60);
}
export const minutesSince = ts => Math.max(0, (now() - ts) / 60000);

// ── money ──
export const fmt = { dec: 2, sym: '₹', pos: 'before' };
export function num(n) {
  n = Number(n) || 0;
  // en-IN gives lakh/crore grouping: 1,23,456.00
  return n.toLocaleString('en-IN', { minimumFractionDigits: fmt.dec, maximumFractionDigits: fmt.dec });
}
export function money(n) {
  const v = num(n);
  if (!fmt.sym) return v;
  return fmt.pos === 'before' ? fmt.sym + ' ' + v : v + ' ' + fmt.sym;
}
export const r2 = n => { const f = Math.pow(10, fmt.dec); return Math.round((Number(n) + Number.EPSILON) * f) / f; };
export const parseNum = s => {
  const v = parseFloat(String(s ?? '').replace(/[^\d.\-]/g, ''));
  return isNaN(v) ? 0 : v;
};

// ── collections ──
export const sum = (arr, f = x => x) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
export function groupBy(arr, f) {
  const m = new Map();
  for (const x of arr) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
}
export const sortBy = (arr, f, dir = 1) => arr.slice().sort((a, b) => {
  const x = f(a), y = f(b);
  return (x < y ? -1 : x > y ? 1 : 0) * dir;
});
export const clone = o => JSON.parse(JSON.stringify(o));
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export const initials = s => String(s || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
export function hueOf(s) { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) % 360; return x; }
export const hasRTL = s => /[\u0590-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(s || '');
export const hasIndic = s => /[\u0900-\u097F]/.test(s || '');

// ── files ──
export function download(filename, text, mime = 'text/plain') {
  const blob = text instanceof Blob ? text : new Blob([text], { type: mime + ';charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
export function toCSV(rows, cols) {
  const q = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return '﻿' + [cols.map(c => q(c.label)).join(',')].concat(rows.map(r => cols.map(c => q(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','))).join('\r\n');
}
/** Resize an uploaded photo to a small JPEG data-URL so it syncs quickly. */
export function resizeImage(file, max = 480, quality = 0.74) {
  return new Promise((ok, bad) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      x.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      ok(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); bad(new Error('Could not read image')); };
    img.src = url;
  });
}
export const readFileText = f => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsText(f); });

// ── SHA-256 (PINs are stored hashed; crypto.subtle is unavailable on plain-http LAN pages) ──
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);
export function sha256(str) {
  const bytes = new TextEncoder().encode(str);
  const l = bytes.length;
  const total = (((l + 9 + 63) >> 6) << 6);
  const buf = new Uint8Array(total);
  buf.set(bytes); buf[l] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 4, (l * 8) >>> 0);
  dv.setUint32(total - 8, Math.floor((l * 8) / 4294967296));
  let H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H = H.map((v, i) => (v + [a, b, c, d, e, f, g, hh][i]) >>> 0);
  }
  return Array.from(H, v => v.toString(16).padStart(8, '0')).join('');
}
export const hashPin = pin => sha256('restopos:' + String(pin));
