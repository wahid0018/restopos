#!/usr/bin/env node
/* RestoPOS local server — zero dependencies (Node 18+).
 * Serves the web app, keeps the restaurant database on disk, pushes live
 * updates to every tablet over Server-Sent Events, relays raw print jobs to
 * LAN thermal printers, and (optionally) mirrors everything to Supabase.
 *
 *   node server.js                      -> ./data, port 3000
 *   node server.js --client acme        -> ./clients/acme  (config.json inside)
 *   node server.js --port 8080 --data D:\restopos-data
 */
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');

// ───────────────────────── config ─────────────────────────
function parseArgs(a) {
  const o = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) {
      const k = a[i].slice(2);
      const v = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
      o[k] = v;
    }
  }
  return o;
}
const args = parseArgs(process.argv.slice(2));
const ROOT = __dirname;
const PUBLIC = path.resolve(args.public || path.join(ROOT, 'public'));
const DATA = path.resolve(
  args.data || (args.client ? path.join(ROOT, 'clients', String(args.client)) : path.join(ROOT, 'data'))
);
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(path.join(DATA, 'backups'), { recursive: true });
const CFG_FILE = path.join(DATA, 'config.json');
let cfg = { name: 'Restaurant', port: 3000, cloud: null };
try { cfg = Object.assign(cfg, JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'))); } catch (_) { /* first run */ }
const PORT = +args.port || +process.env.PORT || +cfg.port || 3000;
const saveCfg = () => fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2));

// ───────────────────────── database (snapshot + journal) ─────────────────────────
const SNAP = path.join(DATA, 'db.json');
const JOURNAL = path.join(DATA, 'journal.ndjson');
let db = { meta: { seq: 0, billSeq: 0, bills: {}, days: {}, cloudPushed: 0, cloudCursor: null }, records: {} };
let journalLines = 0;

function loadDb() {
  try { db = JSON.parse(fs.readFileSync(SNAP, 'utf8')); } catch (e) {
    if (fs.existsSync(SNAP)) {
      console.error('! db.json unreadable (' + e.message + ') — trying backups');
      const b = fs.readdirSync(path.join(DATA, 'backups')).filter(f => f.endsWith('.json')).sort().pop();
      if (b) db = JSON.parse(fs.readFileSync(path.join(DATA, 'backups', b), 'utf8'));
    }
  }
  db.meta = Object.assign({ seq: 0, billSeq: 0, bills: {}, days: {}, cloudPushed: 0, cloudCursor: null }, db.meta);
  db.records = db.records || {};
  if (fs.existsSync(JOURNAL)) {
    for (const line of fs.readFileSync(JOURNAL, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        for (const r of e.recs || []) db.records[r._c + ':' + r.id] = r;
        if (e.meta) Object.assign(db.meta, e.meta);
      } catch (_) { /* torn last line after power cut — ignore */ }
    }
  }
}
function snapshot() {
  const tmp = SNAP + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, SNAP);
  fs.writeFileSync(JOURNAL, '');
  journalLines = 0;
  dailyBackup();
}
let lastBackupDay = '';
function dailyBackup() {
  const d = new Date().toISOString().slice(0, 10);
  if (d === lastBackupDay) return;
  lastBackupDay = d;
  try {
    fs.copyFileSync(SNAP, path.join(DATA, 'backups', 'db-' + d + '.json'));
    const files = fs.readdirSync(path.join(DATA, 'backups')).filter(f => f.startsWith('db-')).sort();
    while (files.length > 30) fs.unlinkSync(path.join(DATA, 'backups', files.shift()));
  } catch (e) { console.error('backup failed', e.message); }
}
function journal(recs) {
  const m = db.meta;
  fs.appendFileSync(JOURNAL, JSON.stringify({ recs, meta: { seq: m.seq, billSeq: m.billSeq, bills: m.bills, days: m.days, cloudPushed: m.cloudPushed, cloudCursor: m.cloudCursor } }) + '\n');
  if (++journalLines > 400) snapshot();
}

// ───────────────────────── record logic ─────────────────────────
const settings = () => db.records['settings:main'] || {};
function bizDay(ts) {
  const start = Number(settings().day_start_hour ?? 4);
  const d = new Date(ts - start * 3600e3);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function hooks(rec) {
  if (rec._c === 'orders') {
    if (!rec.no) {
      const day = rec.day || bizDay(Date.now());
      rec.day = day;
      db.meta.days[day] = (db.meta.days[day] || 0) + 1;
      rec.no = db.meta.days[day];
      const keys = Object.keys(db.meta.days).sort();
      while (keys.length > 10) delete db.meta.days[keys.shift()];
    }
    if (rec.status === 'paid' && !rec.bill_no) {
      // GST invoices must run in one unbroken series per financial year (1 Apr – 31 Mar)
      const dd = String(rec.day || bizDay(Date.now())).split('-');
      const y = +dd[0], mo = +dd[1];
      const fy = mo >= 4 ? y : y - 1;
      const lab = settings().bill_reset === 'never' ? 'all' : String(fy).slice(2) + '-' + String(fy + 1).slice(2);
      db.meta.bills = db.meta.bills || {};
      db.meta.bills[lab] = (db.meta.bills[lab] || 0) + 1;
      rec.bill_fy = lab;
      rec.bill_no = db.meta.bills[lab];
      db.meta.billSeq++;
    }
  }
}
const META_KEYS = new Set(['_seq', '_c', '_cs', 'updated_at']);
// ── update check against GitHub releases (cached 6 h; never blocks the app) ──
let PKG = {}; try { PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')); } catch (_) { /* ignore */ }
const GH_API = process.env.GITHUB_API || 'https://api.github.com';
const VERSION = PKG.version || '0.0.0';
let updCache = { at: 0, val: null };
const vparts = v => String(v || '').replace(/^v/i, '').split(/[.+-]/).map(x => parseInt(x, 10) || 0);
function vnewer(a, b) { const x = vparts(a), y = vparts(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; }
async function checkUpdate(force, repoArg) {
  const st = db.records['settings:main'] || {};
  const repo = String(repoArg || st.update_repo || PKG.repository || '').replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
  const base = { current: VERSION, repo };
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || /^YOUR-/.test(repo)) return Object.assign(base, { configured: false });
  if (!force && updCache.val && updCache.repo === repo && Date.now() - updCache.at < 6 * 3600e3) return updCache.val;
  const hd = { 'User-Agent': 'RestoPOS', Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) hd.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
  let out;
  try {
    let r = await httpCall(GH_API + '/repos/' + repo + '/releases/latest', { headers: hd, timeout: 8000 });
    let tag = null, notes = '', url = 'https://github.com/' + repo + '/releases', zip = '';
    if (r.status === 200) { const j = JSON.parse(r.text); tag = j.tag_name; notes = String(j.body || '').slice(0, 1500); url = j.html_url || url; zip = j.zipball_url || ''; }
    else if (r.status === 404) {
      r = await httpCall(GH_API + '/repos/' + repo + '/tags?per_page=1', { headers: hd, timeout: 8000 });
      if (r.status === 200) { const j = JSON.parse(r.text); if (j[0]) tag = j[0].name; }
      else if (r.status !== 404) throw new Error('GitHub answered ' + r.status);
    } else throw new Error('GitHub answered ' + r.status);
    out = Object.assign(base, { configured: true, ok: true, latest: tag, update: !!tag && vnewer(tag, VERSION), notes, url, zip });
  } catch (e) { out = Object.assign(base, { configured: true, ok: false, error: String(e.message || e) }); }
  if (out.ok) updCache = { at: Date.now(), val: out, repo };
  return out;
}
// Self-activating 30-day trial: stamped by the server (staff cannot write the provider record) the first time the restaurant exists.
function startTrialIfNeeded() {
  const f = db.records['provider:flags'];
  if (!db.records['settings:main'] || (f && (f.plan || f.trial_start || f.valid_until))) return;
  applyPatches([{ c: 'provider', id: 'flags', patch: { plan: 'trial', trial_start: Date.now() } }]);
}
function applyPatches(patches, opts = {}) {
  const out = [];
  for (const p of patches) {
    if (!p || typeof p.c !== 'string' || typeof p.id !== 'string' || !p.patch || typeof p.patch !== 'object') continue;
    const key = p.c + ':' + p.id;
    const cur = db.records[key];
    const rec = Object.assign({}, cur || {}, p.patch, { id: p.id, _c: p.c });
    hooks(rec);
    rec._seq = ++db.meta.seq;
    if (opts.fromCloud) rec._cs = rec._seq; else delete rec._cs;
    rec.updated_at = Date.now();
    db.records[key] = rec;
    out.push(rec);
  }
  if (out.length) { journal(out); notify(); }
  return out;
}

// ───────────────────────── live events (SSE) ─────────────────────────
const sse = new Set();
let notifyTimer = null;
function notify() {
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    for (const res of sse) res.write('data: ' + db.meta.seq + '\n\n');
  }, 15);
}
setInterval(() => { for (const res of sse) res.write(': ping\n\n'); }, 20000).unref();

// ───────────────────────── Supabase mirror ─────────────────────────
const cloud = { auth: null, ok: false, lastOk: 0, error: null, running: false, timer: null };
const cloudOn = () => !!(cfg.cloud && cfg.cloud.url && cfg.cloud.key && cfg.cloud.email && cfg.cloud.password);
function cloudPending() {
  const m = db.meta.cloudPushed;
  let n = 0;
  for (const r of Object.values(db.records)) if (r._seq > m && r._cs !== r._seq) n++;
  return n;
}
async function cloudFetch(url, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, Object.assign({}, opts, { signal: ctl.signal }));
    const txt = await r.text();
    let j = null; try { j = txt ? JSON.parse(txt) : null; } catch (_) { /* non-json */ }
    if (!r.ok) throw Object.assign(new Error((j && (j.message || j.error_description || j.msg)) || 'HTTP ' + r.status), { status: r.status });
    return j;
  } finally { clearTimeout(t); }
}
async function cloudToken() {
  const c = cfg.cloud;
  if (cloud.auth && cloud.auth.exp - Date.now() > 60000) return cloud.auth.access;
  const base = c.url.replace(/\/+$/, '');
  let j;
  if (cloud.auth && cloud.auth.refresh) {
    try {
      j = await cloudFetch(base + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: c.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: cloud.auth.refresh }) });
    } catch (_) { j = null; }
  }
  if (!j) j = await cloudFetch(base + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: c.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.password }) });
  cloud.auth = { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cloud.auth.access;
}
async function cloudRest(p, opts = {}) {
  const c = cfg.cloud;
  const tok = await cloudToken();
  return cloudFetch(c.url.replace(/\/+$/, '') + '/rest/v1/' + p, Object.assign({}, opts, {
    headers: Object.assign({ apikey: c.key, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, opts.headers || {})
  }));
}
function stripMeta(r) {
  const o = {};
  for (const k of Object.keys(r)) if (!META_KEYS.has(k) && k !== 'id') o[k] = r[k];
  return o;
}
async function cloudCycle() {
  if (!cloudOn() || cloud.running) return;
  cloud.running = true;
  try {
    // push
    const dirty = Object.values(db.records).filter(r => r._seq > db.meta.cloudPushed && r._cs !== r._seq).sort((a, b) => a._seq - b._seq);
    for (let i = 0; i < dirty.length; i += 100) {
      const chunk = dirty.slice(i, i + 100);
      await cloudRest('rpc/apply_patches', { method: 'POST', body: JSON.stringify({ p_rows: chunk.map(r => ({ c: r._c, id: r.id, patch: stripMeta(r) })) }) });
      db.meta.cloudPushed = chunk[chunk.length - 1]._seq;
    }
    if (dirty.length === 0) db.meta.cloudPushed = db.meta.seq;
    // pull
    let since = db.meta.cloudCursor ? new Date(Date.parse(db.meta.cloudCursor) - 10000).toISOString() : null;
    let maxTs = db.meta.cloudCursor;
    const incoming = [];
    for (let guard = 0; guard < 200; guard++) {
      const q = 'records?select=coll,id,data,updated_at&order=updated_at.asc&limit=1000' + (since ? '&updated_at=gt.' + encodeURIComponent(since) : '');
      const rows = await cloudRest(q);
      for (const r of rows) incoming.push(r);
      if (rows.length) { since = rows[rows.length - 1].updated_at; if (!maxTs || Date.parse(since) > Date.parse(maxTs)) maxTs = since; }
      if (rows.length < 1000) break;
    }
    const patches = [];
    for (const r of incoming) {
      const cur = db.records[r.coll + ':' + r.id];
      const data = r.data || {};
      if (cur && Object.keys(data).every(k => JSON.stringify(cur[k]) === JSON.stringify(data[k]))) continue;
      if (cur && cur._seq > db.meta.cloudPushed && cur._cs !== cur._seq) continue; // local edit not yet pushed wins
      patches.push({ c: r.coll, id: r.id, patch: data });
    }
    if (patches.length) applyPatches(patches, { fromCloud: true });
    if (maxTs) db.meta.cloudCursor = maxTs;
    journal([]);
    cloud.ok = true; cloud.lastOk = Date.now(); cloud.error = null;
  } catch (e) {
    cloud.ok = false; cloud.error = String(e.message || e);
    cloud.auth = e.status === 400 || e.status === 401 ? null : cloud.auth;
  } finally { cloud.running = false; }
}
function cloudLoop() {
  clearTimeout(cloud.timer);
  const next = cloud.ok || !cloudOn() ? 5000 : 20000;
  cloud.timer = setTimeout(async () => { await cloudCycle(); cloudLoop(); }, next);
}

// ───────────────────────── provider (software vendor) password ─────────────────────────
let PROVIDER_HASH = '';
try { PROVIDER_HASH = JSON.parse(fs.readFileSync(path.join(ROOT, 'provider.json'), 'utf8')).hash || ''; } catch (_) { console.error('! provider.json missing — provider panel disabled'); }
const crypto = require('crypto');
let provFails = 0, provLock = 0;
function providerOk(pw) {
  if (!PROVIDER_HASH || Date.now() < provLock) return false;
  const ok = crypto.createHash('sha256').update('restopos-provider:' + String(pw || '')).digest('hex') === PROVIDER_HASH;
  if (ok) provFails = 0; else if (++provFails >= 5) { provLock = Date.now() + 60000; provFails = 0; }
  return ok;
}

// ───────────────────────── helpers ─────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};
function send(res, code, body, headers = {}) {
  res.writeHead(code, Object.assign({ 'Cache-Control': 'no-store' }, headers));
  res.end(body);
}
const json = (res, code, obj) => send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
function readBody(req, limit = 8e6) {
  return new Promise((ok, bad) => {
    let n = 0; const chunks = [];
    req.on('data', c => {
      n += c.length;
      if (n > limit) { bad(Object.assign(new Error('Payload too large'), { status: 413 })); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => { try { ok(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { bad(Object.assign(new Error('Bad JSON'), { status: 400 })); } });
    req.on('error', bad);
  });
}
function isPrivateIp(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip || '');
  if (!m) return false;
  const [a, b] = [+m[1], +m[2]];
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}
function fromLan(req) {
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return ip === '::1' || isPrivateIp(ip);
}
function tcpSend(host, port, buf) {
  return new Promise((ok, bad) => {
    const s = net.createConnection({ host, port });
    const kill = setTimeout(() => { s.destroy(); bad(new Error('Printer did not respond (timeout)')); }, 8000);
    s.on('connect', () => s.write(buf, () => s.end()));
    s.on('finish', () => { clearTimeout(kill); ok(); setTimeout(() => s.destroy(), 1500); });
    s.on('error', e => { clearTimeout(kill); bad(e); });
  });
}


// ── outbound HTTP helper (payment terminals, WhatsApp, translation) ──
function httpCall(urlStr, { method = 'GET', headers = {}, body = null, timeout = 12000 } = {}) {
  return new Promise((ok, bad) => {
    let u; try { u = new URL(urlStr); } catch (_) { return bad(new Error('Invalid URL')); }
    const lib = u.protocol === 'https:' ? https : u.protocol === 'http:' ? http : null;
    if (!lib) return bad(new Error('URL must start with http:// or https://'));
    const r = lib.request(u, { method, headers, timeout }, resp => {
      const ch = []; resp.on('data', d => ch.push(d)); resp.on('end', () => ok({ status: resp.statusCode, text: Buffer.concat(ch).toString('utf8') }));
    });
    r.on('timeout', () => r.destroy(new Error('Timeout')));
    r.on('error', bad);
    if (body != null) r.write(body);
    r.end();
  });
}

// ───────────────────────── API ─────────────────────────
async function api(req, res, u) {
  const p = u.pathname;
  const M = req.method;
  // Public webhook for aggregator / integrator order push (protected by the shared key in Admin → Rewards & integrations)
  if (p === '/api/online-order' && M === 'POST') {
    const key = (db.records['settings:main'] || {}).online_orders_key || '';
    if (!key || (u.searchParams.get('key') || req.headers['x-api-key'] || '') !== key) return json(res, 401, { error: 'Invalid key' });
    const b = await readBody(req, 2e6);
    const o = b.order && typeof b.order === 'object' ? Object.assign({}, b, b.order) : b;
    const cu = o.customer || {};
    const items = (o.items || o.order_items || o.cart || []).map(i => ({ ext_id: String(i.id || i.item_id || i.sku || ''), name: String(i.name || i.item_name || i.title || ''), qty: Number(i.qty || i.quantity || 1) || 1, price: Number(i.price || i.unit_price || 0) || 0 }));
    if (!items.length) return json(res, 400, { error: 'No items in order' });
    const extId = String(o.order_id || o.orderId || o.id || o.external_id || ('wh' + Date.now()));
    const platform = String(o.platform || o.source || o.channel || u.searchParams.get('platform') || 'online');
    const id = 'oo_' + platform.toLowerCase().replace(/[^a-z0-9]/g, '') + '_' + extId.replace(/[^A-Za-z0-9_-]/g, '');
    if (db.records['online_orders:' + id]) return json(res, 200, { ok: true, duplicate: true, id });
    applyPatches([{ c: 'online_orders', id, patch: { platform, ext_id: extId, status: 'new', received_at: Date.now(), customer: { name: cu.name || o.customer_name || '', phone: cu.phone || o.customer_phone || o.phone || '', address: cu.address || o.delivery_address || o.address || '' },
      items, total: Number(o.total || o.order_total || o.amount || 0) || 0, note: String(o.instructions || o.note || o.notes || ''), payment: String(o.payment || o.payment_mode || ''), raw: JSON.stringify(b).slice(0, 6000) } }]);
    return json(res, 200, { ok: true, id });
  }
  if (!fromLan(req)) return json(res, 403, { error: 'LAN access only' });
  if (p === '/api/terminal' && M === 'POST') {
    const b = await readBody(req);
    let host = ''; try { host = new URL(String(b.url || '')).hostname; } catch (_) { }
    if (!/^https:/i.test(String(b.url || '')) && !isPrivateIp(host)) return json(res, 400, { error: 'Terminal URL must be a local network address (http://192.168.x.x…) or https://' });
    try {
      const hd = Object.assign({}, b.headers || {}); const body = b.body != null && b.body !== '' ? String(b.body) : null;
      if (body && !Object.keys(hd).some(k => k.toLowerCase() === 'content-type')) hd['Content-Type'] = /^\s*[{\[]/.test(body) ? 'application/json' : 'application/x-www-form-urlencoded';
      if (body) hd['Content-Length'] = Buffer.byteLength(body);
      const r = await httpCall(String(b.url), { method: String(b.method || 'POST').toUpperCase(), headers: hd, body });
      return json(res, r.status < 400 ? 200 : 502, { ok: r.status < 400, status: r.status, response: r.text.slice(0, 600) });
    } catch (e) { return json(res, 502, { error: 'Terminal not reachable: ' + e.message }); }
  }
  if (p === '/api/whatsapp-config' && M === 'POST') {
    const b = await readBody(req);
    if (b.disable) cfg.wa = null; else cfg.wa = { phone_id: String(b.phone_id || '').trim(), token: String(b.token || (cfg.wa && cfg.wa.token) || '').trim() };
    saveCfg(); return json(res, 200, { ok: true });
  }
  if (p === '/api/whatsapp' && M === 'POST') {
    if (!cfg.wa || !cfg.wa.token || !cfg.wa.phone_id) return json(res, 400, { error: 'WhatsApp API is not configured (Admin → Rewards & integrations)' });
    const b = await readBody(req);
    const to = String(b.to || '').replace(/\D/g, ''); if (to.length < 11) return json(res, 400, { error: 'Invalid number' });
    const payload = b.template
      ? { messaging_product: 'whatsapp', to, type: 'template', template: { name: String(b.template), language: { code: String(b.lang || 'en') }, components: [{ type: 'body', parameters: (b.params || []).map(x => ({ type: 'text', text: String(x).slice(0, 1000) })) }] } }
      : { messaging_product: 'whatsapp', to, type: 'text', text: { body: String(b.text || '').slice(0, 4000) } };
    try {
      const data = JSON.stringify(payload);
      const r = await httpCall('https://graph.facebook.com/v20.0/' + encodeURIComponent(cfg.wa.phone_id) + '/messages', { method: 'POST', headers: { Authorization: 'Bearer ' + cfg.wa.token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, body: data });
      let j = {}; try { j = JSON.parse(r.text); } catch (_) { }
      if (r.status >= 400) return json(res, 502, { error: (j.error && j.error.message) || ('WhatsApp error ' + r.status) });
      return json(res, 200, { ok: true });
    } catch (e) { return json(res, 502, { error: 'Cannot reach WhatsApp: ' + e.message }); }
  }
  if (p === '/api/translate' && M === 'POST') {
    const b = await readBody(req, 2e5);
    const to = ['hi', 'ur'].includes(b.to) ? b.to : 'hi';
    const texts = (Array.isArray(b.texts) ? b.texts : [b.text]).map(x => String(x || '').slice(0, 500)).slice(0, 60);
    try {
      const out = [];
      for (const q of texts) {
        if (!q.trim()) { out.push(''); continue; }
        const r = await httpCall('https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=' + to + '&dt=t&q=' + encodeURIComponent(q));
        if (r.status >= 400) throw new Error('Translation service error ' + r.status);
        const j = JSON.parse(r.text); out.push((j[0] || []).map(x => x[0]).join(''));
      }
      return json(res, 200, { ok: true, texts: out });
    } catch (e) { return json(res, 502, { error: 'Translation unavailable: ' + e.message }); }
  }

  if (p === '/api/update-check') {
    const r = await checkUpdate(u.searchParams.get('force') === '1', u.searchParams.get('repo') || '');
    return json(res, 200, r);
  }
  if (p === '/api/info') {
    const ips = [];
    for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
    return json(res, 200, {
      ips, port: PORT, version: VERSION, https_port: httpsUp ? HTTPS_PORT : 0, wa: !!(cfg.wa && cfg.wa.token), wa_phone_id: cfg.wa ? cfg.wa.phone_id : '',
      app: 'restopos', client: path.basename(DATA), name: cfg.name, seq: db.meta.seq, now: Date.now(),
      cloud: { enabled: cloudOn(), ok: cloud.ok, lastOk: cloud.lastOk, error: cloud.error, pending: cloudOn() ? cloudPending() : 0, url: cfg.cloud ? cfg.cloud.url : null, email: cfg.cloud ? cfg.cloud.email : null }
    });
  }
  if (p === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\ndata: ' + db.meta.seq + '\n\n');
    sse.add(res);
    req.on('close', () => sse.delete(res));
    return;
  }
  if (p === '/api/sync' && M === 'GET') {
    const since = +u.searchParams.get('since') || 0;
    const LIMIT = 4000;
    let recs = [];
    for (const r of Object.values(db.records)) if (r._seq > since) recs.push(r);
    let more = false;
    let seq = db.meta.seq;
    if (recs.length > LIMIT) {
      recs.sort((a, b) => a._seq - b._seq);
      recs = recs.slice(0, LIMIT);
      more = true;
      seq = recs[recs.length - 1]._seq;
    }
    return json(res, 200, { seq, more, now: Date.now(), records: recs });
  }
  if (p === '/api/sync' && M === 'POST') {
    const b = await readBody(req, 20e6);
    const out = applyPatches((Array.isArray(b.patches) ? b.patches : []).filter(x => x && x.c !== 'provider'));
    startTrialIfNeeded();
    return json(res, 200, { seq: db.meta.seq, now: Date.now(), records: out });
  }
  if (p === '/api/backup') {
    const name = 'restopos-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    return send(res, 200, JSON.stringify({ app: 'restopos', version: 1, at: Date.now(), meta: db.meta, records: Object.values(db.records) }), {
      'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="' + name + '"'
    });
  }
  if (p === '/api/restore' && M === 'POST') {
    const b = await readBody(req, 200e6);
    if (b.app !== 'restopos' || !Array.isArray(b.records)) return json(res, 400, { error: 'Not a RestoPOS backup file' });
    snapshot();
    fs.copyFileSync(SNAP, path.join(DATA, 'backups', 'before-restore-' + Date.now() + '.json'));
    const keepSeq = db.meta.seq;
    const nm = { seq: keepSeq, billSeq: (b.meta && b.meta.billSeq) || 0, bills: (b.meta && b.meta.bills) || {}, days: (b.meta && b.meta.days) || {}, cloudPushed: 0, cloudCursor: db.meta.cloudCursor };
    const rec = {};
    let s = keepSeq;
    for (const r of b.records) { if (!r || !r._c || !r.id) continue; r._seq = ++s; delete r._cs; rec[r._c + ':' + r.id] = r; }
    nm.seq = s;
    db = { meta: nm, records: rec };
    snapshot();
    notify();
    return json(res, 200, { ok: true, records: Object.keys(rec).length });
  }
  if (p === '/api/print' && M === 'POST') {
    const b = await readBody(req, 12e6);
    const host = String(b.host || '');
    const port = +b.port || 9100;
    if (!isPrivateIp(host)) return json(res, 400, { error: 'Printer must be a local network IP address (e.g. 192.168.1.50)' });
    if (!b.b64) return json(res, 400, { error: 'No data' });
    try { await tcpSend(host, port, Buffer.from(b.b64, 'base64')); return json(res, 200, { ok: true }); }
    catch (e) { return json(res, 502, { error: 'Printer error: ' + e.message }); }
  }
  if (p === '/api/provider' && M === 'POST') {
    const b = await readBody(req);
    if (!providerOk(b.password)) return json(res, 403, { error: 'Wrong provider password' });
    if (b.flags && typeof b.flags === 'object') applyPatches([{ c: 'provider', id: 'flags', patch: b.flags }]);
    return json(res, 200, { ok: true, record: db.records['provider:flags'] || null });
  }
  if (p === '/api/provider-check' && M === 'POST') {
    const b = await readBody(req);
    return json(res, providerOk(b.password) ? 200 : 403, { ok: providerOk(b.password) });
  }
  if (p === '/api/cloud-config' && M === 'POST') {
    const b = await readBody(req);
    if (b.disable) cfg.cloud = null;
    else {
      const prev = cfg.cloud;
      cfg.cloud = {
        url: String(b.url || '').trim(), key: String(b.key || '').trim(), email: String(b.email || '').trim(),
        password: String(b.password || (b.keepPassword && prev ? prev.password : ''))
      };
    }
    saveCfg();
    cloud.auth = null; cloud.ok = false; cloud.error = null;
    if (cloudOn()) await cloudCycle();
    cloudLoop();
    return json(res, cloud.error ? 400 : 200, { ok: !cloud.error, error: cloud.error, enabled: cloudOn() });
  }
  return json(res, 404, { error: 'Not found' });
}

function serveStatic(req, res, u) {
  let rel = decodeURIComponent(u.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep) && file !== PUBLIC) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

// ───────────────────────── start ─────────────────────────
loadDb();
snapshot();
const handler = async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/api/')) return await api(req, res, u);
    return serveStatic(req, res, u);
  } catch (e) {
    if (!res.headersSent) json(res, e.status || 500, { error: String(e.message || e) });
    else res.end();
  }
};
const server = http.createServer(handler);
server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error('\nPort ' + PORT + ' is already in use. Start with --port <other> or close the other copy.\n');
  else console.error(e);
  process.exit(1);
});
// ── optional HTTPS (browsers only allow camera / AR / install-as-app in secure contexts; http://192.168.x.x is not one) ──
const HTTPS_PORT = +args['https-port'] || +process.env.HTTPS_PORT || (PORT + 443);
const CERT_DIR = path.join(DATA, 'cert');
let httpsUp = false, httpsHint = '';
function lanIps() {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
  return ips;
}
function ensureCert() {
  const key = path.join(CERT_DIR, 'key.pem'), crt = path.join(CERT_DIR, 'cert.pem');
  if (fs.existsSync(key) && fs.existsSync(crt)) return { key, crt };
  try {
    fs.mkdirSync(CERT_DIR, { recursive: true });
    const san = ['DNS:localhost', 'IP:127.0.0.1'].concat(lanIps().map(ip => 'IP:' + ip)).join(',');
    require('child_process').execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt,
      '-days', '3650', '-subj', '/CN=RestoPOS', '-addext', 'subjectAltName=' + san], { stdio: 'ignore', timeout: 30000 });
    if (fs.existsSync(key) && fs.existsSync(crt)) return { key, crt };
  } catch (e) { httpsHint = 'openssl not available'; }
  return null;
}
try {
  const c = args.https === 'off' || args['no-https'] ? null : ensureCert();
  if (c) {
    const sv = https.createServer({ key: fs.readFileSync(c.key), cert: fs.readFileSync(c.crt) }, handler);
    sv.on('error', e => { httpsUp = false; console.error('  (HTTPS not started: ' + e.message + ')'); });
    sv.listen(HTTPS_PORT, '0.0.0.0');
    httpsUp = true;
  } else if (!httpsHint) httpsHint = 'HTTPS disabled';
} catch (e) { httpsHint = 'HTTPS setup failed: ' + e.message; }

server.listen(PORT, '0.0.0.0', () => {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
  console.log('\n  RestoPOS — ' + cfg.name);
  console.log('  Data folder : ' + DATA);
  console.log('  This computer: http://localhost:' + PORT);
  for (const ip of ips) console.log('  Wi-Fi / LAN  : http://' + ip + ':' + PORT + '   <- open this on tablets');
  if (httpsUp) {
    for (const ip of ips.length ? ips : ['localhost']) console.log('  Secure (camera / AR / install-as-app): https://' + ip + ':' + HTTPS_PORT + ' (accept the one-time certificate warning)');
  } else console.log('  (Camera / AR on tablets needs https: put key.pem + cert.pem in ' + CERT_DIR + ' or run: node tools/make-cert.js)');
  console.log('  Cloud mirror : ' + (cloudOn() ? 'on (' + cfg.cloud.url + ')' : 'off') + '\n');
  if (cloudOn()) { cloudCycle().then(cloudLoop); } else cloudLoop();
});
let closing = false;
function bye() { if (closing) return; closing = true; try { snapshot(); } catch (_) { /* ignore */ } process.exit(0); }
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
