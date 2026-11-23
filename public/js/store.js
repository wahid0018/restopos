// Offline-first record store.
//
//  • Every record lives in memory + IndexedDB, so the app keeps working with no network.
//  • Writes are applied instantly, then queued in an "outbox" as field-level patches.
//  • A transport moves patches out / pulls changes in:
//        local  → the RestoPOS server on the Wi-Fi (live push via SSE)
//        cloud  → Supabase REST (polling)
//        none   → standalone, this device only
//  • Patches merge per field on both sides, so a waiter editing a note and the cashier
//    taking payment on the same order never overwrite each other.
import { uid, now, clock } from './util.js';

const DEVICE_KEY = 'restopos.device';
export const deviceId = (() => {
  let d = localStorage.getItem(DEVICE_KEY);
  if (!d) { d = uid(); localStorage.setItem(DEVICE_KEY, d); }
  return d;
})();

// ───────── IndexedDB ─────────
let idb = null;
let writeQ = [];
let writeTimer = null;
function openDB(scope) {
  return new Promise((ok, bad) => {
    if (!window.indexedDB) return ok(null);
    const r = indexedDB.open('restopos:' + scope, 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('recs'); d.createObjectStore('outbox'); d.createObjectStore('meta'); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ok(null);
  });
}
function readAll(db, name) {
  return new Promise(ok => {
    const out = [];
    const rq = db.transaction(name).objectStore(name).openCursor();
    rq.onsuccess = () => { const c = rq.result; if (c) { out.push([c.key, c.value]); c.continue(); } else ok(out); };
    rq.onerror = () => ok(out);
  });
}
function qw(storeName, op, key, val) {
  if (!idb) return;
  writeQ.push([storeName, op, key, val]);
  if (!writeTimer) writeTimer = setTimeout(flushWrites, 25);
}
function flushWrites() {
  writeTimer = null;
  const ops = writeQ; writeQ = [];
  if (!idb || !ops.length) return;
  try {
    const t = idb.transaction(['recs', 'outbox', 'meta'], 'readwrite');
    for (const [s, op, k, v] of ops) { const st = t.objectStore(s); if (op === 'put') st.put(v, k); else st.delete(k); }
  } catch (e) { console.warn('IndexedDB write failed', e); }
}
window.addEventListener('pagehide', flushWrites);

// ───────── state ─────────
const mem = Object.create(null);      // collection -> Map(id -> record)
const outbox = new Map();             // "c:id" -> {c,id,patch,n}
const listeners = new Set();
const cache = Object.create(null);    // collection -> {v, arr}
let version = 0;
let cursor = null;
let transport = null;
let scope = 'standalone';
let unsubscribe = null;
let pollTimer = null;
let syncing = false, syncAgain = false, retryMs = 1500, retryTimer = null;
const status = { kind: 'none', online: true, pending: 0, lastSync: 0, error: null, firstDone: false };
const col = c => mem[c] || (mem[c] = new Map());
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
let notifyScheduled = false;
function bump() {
  version++;
  if (notifyScheduled) return;
  notifyScheduled = true;
  queueMicrotask(() => { notifyScheduled = false; emit('change'); });
}
function emit(type) { for (const f of listeners) { try { f(type); } catch (e) { console.error(e); } } }
function setStatus(p) { Object.assign(status, p, { pending: outbox.size }); emit('status'); }

export const store = {
  get version() { return version; },
  get status() { return status; },
  get scope() { return scope; },
  get kind() { return status.kind; },
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  all(c) {
    const ch = cache[c];
    if (ch && ch.v === version) return ch.arr;
    const arr = [];
    for (const r of col(c).values()) if (!r.deleted) arr.push(r);
    cache[c] = { v: version, arr };
    return arr;
  },
  get(c, id) { const r = col(c).get(id); return r && !r.deleted ? r : undefined; },
  getAny(c, id) { return col(c).get(id); },

  /** Create or update. Only the fields you pass are changed. Returns the new record (treat as read-only). */
  put(c, rec) {
    const id = rec.id || uid();
    const m = col(c);
    const cur = m.get(id);
    const patch = {};
    for (const k of Object.keys(rec)) {
      if (k === 'id' || k.startsWith('_')) continue;
      if (!cur || !same(cur[k], rec[k])) patch[k] = rec[k] === undefined ? null : rec[k];
    }
    if (cur && !Object.keys(patch).length) return cur;
    const next = Object.assign({}, cur || {}, patch, { id, _c: c });
    m.set(id, next);
    qw('recs', 'put', c + ':' + id, next);
    enqueue(c, id, patch);
    bump();
    return next;
  },
  patch(c, id, p) { return this.put(c, Object.assign({}, p, { id })); },
  del(c, id) { return this.put(c, { id, deleted: true }); },

  async init({ scopeName, kind, transport: tr }) {
    scope = scopeName;
    status.kind = kind;
    transport = tr || null;
    idb = await openDB(scope);
    if (idb) {
      for (const [k, v] of await readAll(idb, 'recs')) col(v._c).set(v.id, v);
      for (const [k, v] of await readAll(idb, 'outbox')) outbox.set(k, v);
      const meta = new Map(await readAll(idb, 'meta'));
      cursor = meta.get('cursor') ?? null;
      const off = meta.get('clockOffset');
      if (typeof off === 'number') clock.offset = off;
    }
    version++;
    status.pending = outbox.size;
    if (!transport) { status.firstDone = true; return; }
    const startSync = () => {
      if (unsubscribe) unsubscribe();
      unsubscribe = transport.subscribe ? transport.subscribe(() => this.syncNow(), s => setStatus(s)) : null;
      clearInterval(pollTimer);
      pollTimer = setInterval(() => this.syncNow(), 20000);
      window.addEventListener('online', () => this.syncNow());
      document.addEventListener('visibilitychange', () => { if (!document.hidden) this.syncNow(); });
    };
    startSync();
    await Promise.race([this.syncNow(), new Promise(r => setTimeout(r, 4500))]);
  },

  /** Push queued patches, then pull anything new. Safe to call as often as you like. */
  async syncNow() {
    if (!transport) return;
    if (syncing) { syncAgain = true; return; }
    syncing = true;
    clearTimeout(retryTimer);
    try {
      // push
      while (outbox.size) {
        const batch = Array.from(outbox.values()).slice(0, 100);
        const res = await transport.push(batch.map(b => ({ c: b.c, id: b.id, patch: b.patch })));
        for (const b of batch) { const cur = outbox.get(b.c + ':' + b.id); if (cur && cur.n === b.n) { outbox.delete(b.c + ':' + b.id); qw('outbox', 'del', b.c + ':' + b.id); } }
        applyRemote(res.records);
        if (res.now) setClock(res.now);
      }
      // pull
      for (let guard = 0; guard < 100; guard++) {
        const res = await transport.pull(cursor);
        applyRemote(res.records);
        if (res.now) setClock(res.now);
        if (res.cursor != null && res.cursor !== cursor) { cursor = res.cursor; qw('meta', 'put', 'cursor', cursor); }
        if (!res.more) break;
      }
      retryMs = 1500;
      setStatus({ online: true, error: null, lastSync: Date.now(), firstDone: true });
    } catch (e) {
      const fatal = e && (e.status === 401 || e.status === 403 || e.code === 'AUTH');
      setStatus({ online: false, error: String(e.message || e), authNeeded: fatal, firstDone: true });
      if (!fatal) retryTimer = setTimeout(() => this.syncNow(), retryMs = Math.min(retryMs * 1.7, 15000));
    } finally {
      syncing = false;
      if (syncAgain) { syncAgain = false; setTimeout(() => this.syncNow(), 30); }
    }
  },

  /** Wipe local cache (used when switching restaurants / restoring). */
  async resetLocal() {
    flushWrites();
    if (idb) idb.close();
    await new Promise(r => { const q = indexedDB.deleteDatabase('restopos:' + scope); q.onsuccess = q.onerror = q.onblocked = () => r(); });
  }
};

function setClock(serverNow) {
  const off = serverNow - Date.now();
  if (Math.abs(off - clock.offset) > 400) { clock.offset = off; qw('meta', 'put', 'clockOffset', off); }
}

function enqueue(c, id, patch) {
  if (!transport) return;
  const key = c + ':' + id;
  const ob = outbox.get(key);
  if (ob) { Object.assign(ob.patch, patch); ob.n++; } else outbox.set(key, { c, id, patch: Object.assign({}, patch), n: 1 });
  qw('outbox', 'put', key, outbox.get(key));
  status.pending = outbox.size;
  emit('status');
  clearTimeout(enqueue.t);
  enqueue.t = setTimeout(() => store.syncNow(), 40);
}

function applyRemote(records) {
  let changed = false;
  for (const r of records || []) {
    const key = r.c + ':' + r.id;
    const m = col(r.c);
    const cur = m.get(r.id);
    const ob = outbox.get(key);
    if (cur && !ob && cur._rv === r.rv) continue;
    const data = Object.assign({}, r.data, ob ? ob.patch : null);
    const next = Object.assign({}, data, { id: r.id, _c: r.c, _rv: r.rv });
    if (cur) {
      const keys = new Set([...Object.keys(next), ...Object.keys(cur)]);
      let diff = false;
      for (const k of keys) { if (k === '_rv') continue; if (!same(cur[k], next[k])) { diff = true; break; } }
      if (!diff) { cur._rv = r.rv; continue; }
    }
    m.set(r.id, next);
    qw('recs', 'put', key, next);
    changed = true;
  }
  if (changed) bump();
}

// ───────── transports ─────────
async function fetchJSON(url, opts = {}, timeout = 9000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, Object.assign({}, opts, { signal: ctl.signal, cache: 'no-store' }));
    const txt = await r.text();
    let j = null;
    try { j = txt ? JSON.parse(txt) : null; } catch (_) { /* not json */ }
    if (!r.ok) throw Object.assign(new Error((j && (j.message || j.error || j.msg || j.error_description)) || 'HTTP ' + r.status), { status: r.status, body: j });
    return j;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Network timeout');
    throw e;
  } finally { clearTimeout(t); }
}
export { fetchJSON };

export function localTransport(base = '') {
  const norm = r => {
    const { id, _c, _seq, updated_at, ...data } = r;
    return { c: _c, id, data, rv: _seq };
  };
  return {
    kind: 'local',
    info: () => fetchJSON(base + 'api/info'),
    async pull(cur) { const r = await fetchJSON(base + 'api/sync?since=' + (cur || 0)); return { records: r.records.map(norm), cursor: r.seq, more: r.more, now: r.now }; },
    async push(patches) { const r = await fetchJSON(base + 'api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ patches, device: deviceId }) }); return { records: r.records.map(norm), now: r.now }; },
    subscribe(cb, setSt) {
      const es = new EventSource(base + 'api/events');
      es.onmessage = () => { cb(); };
      es.onopen = () => cb();
      es.onerror = () => { setSt && setSt({ online: false }); };
      return () => es.close();
    }
  };
}

const AUTH_KEY = 'restopos.cloudAuth';
export function cloudTransport({ url, key }) {
  url = url.replace(/\/+$/, '');
  let auth = null;
  try { auth = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (_) { /* ignore */ }
  const saveAuth = a => { auth = a; if (a) localStorage.setItem(AUTH_KEY, JSON.stringify(a)); else localStorage.removeItem(AUTH_KEY); };
  const authErr = m => Object.assign(new Error(m || 'Sign in required'), { code: 'AUTH', status: 401 });
  async function tokenCall(grant, body) {
    const j = await fetchJSON(url + '/auth/v1/token?grant_type=' + grant, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    saveAuth({
      access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000,
      email: j.user && j.user.email, clientId: j.user && j.user.app_metadata && j.user.app_metadata.client_id
    });
    return auth;
  }
  async function token() {
    if (!auth) throw authErr();
    if (auth.exp - Date.now() < 60000) {
      try { await tokenCall('refresh_token', { refresh_token: auth.refresh }); }
      catch (e) { if (e.status === 400 || e.status === 401) { saveAuth(null); throw authErr('Session expired — sign in again'); } throw e; }
    }
    return auth.access;
  }
  async function rest(path, opts = {}) {
    const t = await token();
    return fetchJSON(url + '/rest/v1/' + path, Object.assign({}, opts, { headers: Object.assign({ apikey: key, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, opts.headers || {}) }));
  }
  const norm = r => ({ c: r.coll, id: r.id, data: r.data || {}, rv: r.updated_at });
  return {
    kind: 'cloud',
    get auth() { return auth; },
    rpc(name, args) { return rest('rpc/' + name, { method: 'POST', body: JSON.stringify(args) }); },
    async login(email, password) { const a = await tokenCall('password', { email, password }); if (!a.clientId) throw new Error('This account has no restaurant assigned (missing client_id). See supabase/schema.sql.'); return a; },
    logout() { saveAuth(null); },
    async pull(cur) {
      let since = cur ? new Date(Date.parse(cur) - 10000).toISOString() : null;
      let max = cur, all = [];
      for (let g = 0; g < 200; g++) {
        const rows = await rest('records?select=coll,id,data,updated_at&order=updated_at.asc&limit=1000' + (since ? '&updated_at=gt.' + encodeURIComponent(since) : ''));
        all = all.concat(rows.map(norm));
        if (rows.length) { since = rows[rows.length - 1].updated_at; if (!max || Date.parse(since) > Date.parse(max)) max = since; }
        if (rows.length < 1000) break;
      }
      return { records: all, cursor: max };
    },
    async push(patches) {
      const out = [];
      for (let i = 0; i < patches.length; i += 100) {
        const rows = await rest('rpc/apply_patches', { method: 'POST', body: JSON.stringify({ p_rows: patches.slice(i, i + 100) }) });
        for (const r of rows || []) out.push(norm(r));
      }
      return { records: out };
    },
    subscribe(cb) {
      const tick = () => { if (!document.hidden) cb(); };
      const t = setInterval(tick, 3000);
      return () => clearInterval(t);
    }
  };
}
