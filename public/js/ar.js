// "View in 3D / AR on your table": full-screen overlay with a live camera background and a hand-written WebGL1 renderer.
// Demo dishes are generated procedurally (no model files). item.glb (data:/http URL) switches to <model-viewer> with native AR.
// Usage: import { openAR } from '../ar.js';  openAR(item).then(() => ...)
import { h, money } from './util.js';
import { t, nameOf } from './i18n.js';
import * as L from './logic.js';

export const KINDS = ['bowl', 'thali', 'bread', 'burger', 'glass', 'pizza', 'skewer', 'rice', 'dessert', 'noodles', 'soup', 'generic'];
const KW = [
  ['bowl', /tikka masala|butter chicken|chicken masala|curry/], ['thali', /thali|combo meal/], ['burger', /burger|sandwich/], ['pizza', /pizza/],
  ['noodles', /noodle|chowmein|chow mein|pasta|spaghetti|maggi|hakka/], ['soup', /soup|shorba|rasam/],
  ['bread', /naan|roti|paratha|parantha|kulcha|bread|chapati|phulka|bhatura|puri\b/], ['skewer', /tikka|kebab|kabab|seekh|tandoori|skewer|malai chop/],
  ['rice', /biryani|biriyani|pulao|pulav|rice|chawal|khichdi/], ['dessert', /jamun|halwa|kheer|kulfi|cake|dessert|sweet|rasmalai|brownie|ice ?cream|gulab|jalebi|rabri|pastry/],
  ['glass', /lassi|juice|shake|soda|coke|cola|drink|lime|lemonade|chai|tea\b|coffee|mojito|water|sharbat|falooda|beverage/],
  ['bowl', /dal|daal|curry|masala|paneer|makhani|korma|gravy|chole|rajma|sabzi|sabji|kadhai|kadai|saag|palak|bhaji|stew/]
];
export function modelKindFor(item) {
  item = item || {};
  if (KINDS.includes(item.model3d)) return item.model3d;
  let cat = '';
  try { const c = (L.categories() || []).find(x => x.id === item.category_id); cat = c ? c.name : ''; } catch (_) { /* no store yet */ }
  for (const txt of [String(item.name || '').toLowerCase(), String(cat).toLowerCase()]) {
    for (const [k, re] of KW) if (re.test(txt)) return k;
  }
  return 'generic';
}

// ───────────── tiny math (column-major 4x4) ─────────────
const M4 = {
  mul(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; },
  persp(fov, asp, n, f) { const k = 1 / Math.tan(fov / 2), o = new Float32Array(16); o[0] = k / asp; o[5] = k; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f); return o; },
  id() { const o = new Float32Array(16); o[0] = o[5] = o[10] = o[15] = 1; return o; },
  tr(x, y, z) { const o = M4.id(); o[12] = x; o[13] = y; o[14] = z; return o; },
  rx(a) { const o = M4.id(), c = Math.cos(a), s = Math.sin(a); o[5] = c; o[6] = s; o[9] = -s; o[10] = c; return o; },
  ry(a) { const o = M4.id(), c = Math.cos(a), s = Math.sin(a); o[0] = c; o[2] = -s; o[8] = s; o[10] = c; return o; },
  sc(k) { const o = M4.id(); o[0] = o[5] = o[10] = k; return o; }
};
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));
const sstep = (a, b, x) => { const k = clampN((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
const mx = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
const hxc = {};
const hx = s => hxc[s] || (hxc[s] = [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16) / 255));
const rgb = c => typeof c === 'string' ? hx(c) : c;
function rng(seed) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
const hsh = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function vn(x, y) { const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (hsh(ix, iy) * (1 - u) + hsh(ix + 1, iy) * u) * (1 - v) + (hsh(ix, iy + 1) * (1 - u) + hsh(ix + 1, iy + 1) * u) * v; }
const fbm = (x, y) => vn(x, y) * .55 + vn(x * 2.1 + 5, y * 2.1 + 3) * .3 + vn(x * 4.3 + 9, y * 4.3 + 1) * .15;

// ───────────── procedural geometry: parametric surfaces with smooth (finite-difference) normals ─────────────
// Vertex = pos3 nor3 col4 mat3(spec, shininess, reflect). Opaque and translucent (alpha<1) lists are kept apart.
let G = null;
const FL = 13;
function chunk(list, n) { let c = list[list.length - 1]; if (!c || c.v.length / FL + n > 60000) list.push(c = { v: [], i: [] }); return c; }
function xf(p, o) {
  let [x, y, z] = p;
  if (o.sc) { x *= o.sc[0]; y *= o.sc[1]; z *= o.sc[2]; }
  if (o.rx) { const c = Math.cos(o.rx), s = Math.sin(o.rx); [y, z] = [y * c - z * s, y * s + z * c]; }
  if (o.rz) { const c = Math.cos(o.rz), s = Math.sin(o.rz); [x, y] = [x * c - y * s, x * s + y * c]; }
  if (o.ry) { const c = Math.cos(o.ry), s = Math.sin(o.ry); [x, z] = [x * c + z * s, -x * s + z * c]; }
  const a = o.at || [0, 0, 0];
  return [x + a[0], y + a[1], z + a[2]];
}
function surf(nu, nv, fn, o) {
  o = o || {};
  const W = nu + 1, P = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) P.push(xf(fn(i / nu, j / nv), o));
  const at = (i, j) => { i = o.closed ? ((i % nu) + nu) % nu : clampN(i, 0, nu); j = o.closedV ? ((j % nv) + nv) % nv : clampN(j, 0, nv); return P[j * W + i]; };
  const N = [], bad = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const a = at(i + 1, j), b = at(i - 1, j), c = at(i, j + 1), d = at(i, j - 1);
    const du = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dv = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
    const n = [du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]], l = Math.hypot(n[0], n[1], n[2]);
    if (l < 1e-9) { bad.push(j * W + i); N.push([0, 1, 0]); } else N.push([n[0] / l, n[1] / l, n[2] / l]);
  }
  for (const k of bad) { const j = Math.floor(k / W), i = k % W, j2 = j === 0 ? 1 : j - 1; N[k] = N[Math.min(nv, j2) * W + i]; }
  const al = o.a == null ? 1 : o.a, c = chunk(al < 1 ? G.tr : G.op, W * (nv + 1)), base = c.v.length / FL, m = o.m || [.15, 12, 0];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const k = j * W + i, p = P[k];
    let col = o.col ? o.col(i / nu, j / nv, p) : o.c; if (col == null) col = [.8, .8, .8];
    const cc = rgb(col);
    c.v.push(p[0], p[1], p[2], N[k][0], N[k][1], N[k][2], cc[0], cc[1], cc[2], al, m[0], m[1], m[2]);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = base + j * W + i, b = a + 1, d = a + W, e = d + 1; c.i.push(a, d, b, b, d, e); }
}
// Catmull-Rom smoothing of a 2D/3D polyline
function smooth(pts, per = 6) {
  const out = [], n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
    for (let s = 0; s < per; s++) { const u = s / per, u2 = u * u, u3 = u2 * u; out.push(p1.map((_, k) => .5 * (2 * p1[k] + (-p0[k] + p2[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u3))); }
  }
  out.push(pts[n - 1]); return out;
}
// lathe: prof = [[r,y],...]; null entries split hard-edged runs. o.warp(p,u,v) -> p, o.col(u,v,p)
function lathe(prof, o) {
  o = o || {};
  const runs = [[]]; for (const p of prof) { if (p) runs[runs.length - 1].push(p); else runs.push([]); }
  for (const r of runs) {
    if (r.length < 2) continue;
    const d = o.raw ? r : smooth(r, o.per || 6), nv = d.length - 1;
    surf(o.n || 48, nv, (u, v) => {
      const f = v * nv, k = Math.min(nv - 1, Math.floor(f)), q = f - k, a = d[k], b = d[k + 1], rr = a[0] + (b[0] - a[0]) * q, y = a[1] + (b[1] - a[1]) * q, th = u * 6.2832;
      const p = [rr * Math.cos(th), y, rr * Math.sin(th)];
      return o.warp ? o.warp(p, u, v) : p;
    }, Object.assign({}, o, { closed: true }));
  }
}
function ell(r, o) { // sphere / ellipsoid (use o.sc for squash)
  const pr = []; for (let k = 0; k <= 16; k++) { const a = k / 16 * Math.PI; pr.push([r * Math.sin(a), -r * Math.cos(a)]); }
  lathe(pr, Object.assign({ raw: true, n: 28 }, o));
}
const sgn = Math.sign, pw = (a, e) => sgn(a) * Math.pow(Math.abs(a), e);
function sq(rx, ry, rz, e1, e2, o) { // superellipsoid: e=1 ellipsoid, e~0.2 rounded box
  surf(20, 14, (u, v) => { const th = u * 6.2832, ph = -1.5708 + v * 3.1416, cp = Math.cos(ph), ct = Math.cos(th), st = Math.sin(th);
    return [rx * pw(cp, e1) * pw(ct, e2), ry * pw(Math.sin(ph), e1), rz * pw(cp, e1) * pw(st, e2)]; }, Object.assign({ closed: true }, o));
}
const box = (w, hh, d, o) => sq(w / 2, hh / 2, d / 2, .16, .16, o);
function torus(R, r, o) { surf(36, 14, (u, v) => { const a = u * 6.2832, b = v * 6.2832, k = R + r * Math.cos(b); return [k * Math.cos(a), r * Math.sin(b), k * Math.sin(a)]; }, Object.assign({ closed: true, closedV: true }, o)); }
function tube(path, rad, o) {
  o = o || {}; const n = path.length, seg = o.seg || 8, T = [];
  for (let i = 0; i < n; i++) { const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)], d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...d) || 1; T.push([d[0] / l, d[1] / l, d[2] / l]); }
  const ref = Math.abs(T[0][1]) > .9 ? [1, 0, 0] : [0, 1, 0], nrm = v => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  let N = nrm(crs(T[0], ref)); const F = [];
  for (let i = 0; i < n; i++) { const d = N[0] * T[i][0] + N[1] * T[i][1] + N[2] * T[i][2]; N = nrm([N[0] - T[i][0] * d, N[1] - T[i][1] * d, N[2] - T[i][2] * d]); F.push([N, crs(T[i], N)]); }
  surf(seg, n - 1, (u, v) => { const i = Math.round(v * (n - 1)), s = v, f = o.cap === false ? 1 : Math.min(1, Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, .07 - Math.min(s, 1 - s)) / .07, 2)))),
    r = (typeof rad === 'function' ? rad(s) : rad) * f, a = u * 6.2832, c = Math.cos(a) * r, d = Math.sin(a) * r, p = path[i];
    return [p[0] + F[i][0][0] * c + F[i][1][0] * d, p[1] + F[i][0][1] * c + F[i][1][1] * d, p[2] + F[i][0][2] * c + F[i][1][2] * d]; }, Object.assign({ closed: true }, o));
}

// ───────────── building blocks for dishes ─────────────
const STEEL = [.9, 90, .45], GLOSS = [.9, 80, .2], MATTE = [.12, 10, 0], SAUCE = [.95, 70, .22];
const flat = (r, y, k = 14) => Array.from({ length: k + 1 }, (_, i) => [r * i / k, y]);
const dome = (R, H, k = 10, pw2 = 1) => Array.from({ length: k + 1 }, (_, i) => { const a = i / k * Math.PI / 2; return [R * Math.sin(a), H * Math.pow(Math.cos(a), pw2)]; });
function board(R, col) { // wooden round board
  lathe([[0, 0], [R * .96, 0], [R, .015], [R, .05], [R * .97, .065], [0, .065]], { per: 3, n: 56, m: [.25, 20, 0],
    col: (u, v, p) => mx(hx('#8a5a32'), hx('#a8774a'), vn(p[0] * 1.6, p[2] * 14) * .8 + vn(p[0] * 7, p[2] * 40) * .2) });
  return .065;
}
function plate(R, col, m, at) { // returns top y
  lathe([[0, .022], [.55 * R, .022], [.78 * R, .05], [.93 * R, .105], [R, .135], [R * .99, .118], [.9 * R, .07], [.6 * R, .0], [0, 0]], { n: 64, per: 5, c: col, m: m || [.8, 70, .2], at });
  return (at ? at[1] : 0) + .025;
}
function bowlBody(R, H, col, m, at) { // returns [fillRadius, fillY] for a surface at ~78% height
  lathe([[0, H * .28], [R * .45, H * .27], [R * .78, H * .5], [R * .96, H * .98], [R, H], [R * 1.03, H * .97], [R * .98, H * .8], [R * .78, H * .38], [R * .48, H * .05], [R * .38, 0], [0, 0]], { n: 56, per: 5, c: col, m, at });
  return [R * .87, at[1] + H * .76];
}
function pool(r, y, at, col, m, bump) { // liquid / sauce surface
  lathe(flat(r, 0, 16), { raw: true, n: 48, at: [at[0], y, at[1]], m: m || SAUCE, [typeof col === 'function' ? 'col' : 'c']: col,
    warp: (p) => { const d = Math.hypot(p[0], p[2]) / r; return [p[0], p[1] + (bump ? (fbm(p[0] * 7, p[2] * 7) - .5) * bump * (1 - d * .5) + bump * .6 * (1 - d * d) : 0), p[2]]; } });
}
function scatter(n, seed, R, fn) { const r = rng(seed); for (let i = 0; i < n; i++) { const a = r() * 6.283, d = Math.sqrt(r()) * R; fn(d * Math.cos(a), d * Math.sin(a), r, i); } }
function leaf(x, y, z, r, s, c) { ell(s, { sc: [1.1, .16, .7], at: [x, y, z], ry: r * 6.283, rz: (r - .5) * .6, c: c || mx(hx('#2f7d27'), hx('#5bb03a'), r), m: [.3, 20, 0] }); }
function flatbread(R, at, o) {
  o = o || {}; const th = o.th || .07, sd = o.seed || 1, tear = o.tear, type = o.type || 'naan';
  lathe([[0, th], [R * .5, th * .95], [R * .88, th * .8], [R, th * .45], [R * .98, th * .12], [R * .8, 0], [0, 0]], { n: 64, per: 4, at, ry: o.ry || 0, m: [.18, 14, 0],
    warp: (p) => { const a = Math.atan2(p[2], p[0]); let k = 1 + (vn(Math.cos(a) * 1.4 + sd, Math.sin(a) * 1.4) - .5) * .16, x = p[0] * k, z = p[2] * k, y = p[1];
      if (tear) { x *= 1.3; z *= 1 - .3 * sstep(-R, R * 1.3, x) ; }
      if (y > .02) y += (fbm(x * 6 + sd, z * 6) - .5) * th * .9;
      return [x, y, z]; },
    col: (u, v, p) => { const x = p[0] - at[0], z = p[2] - at[2], f = fbm(x * 5 + sd * 3, z * 5), g = fbm(x * 2 + 4, z * 2);
      let c = mx(hx('#e2ad5f'), hx('#f2d08e'), g);
      if (type === 'paratha') c = mx(c, hx('#c98a3e'), .5 + .5 * Math.sin(Math.hypot(x, z) * 55 + g * 6));
      c = mx(c, hx(type === 'roti' ? '#7a4a1d' : '#5a3010'), sstep(type === 'roti' ? .56 : .62, .72, f) * (type === 'roti' ? .8 : 1));
      return mx(c, hx('#f6e3b5'), (1 - v) * .0 + sstep(.8, .95, vn(x * 9, z * 9)) * .25); } });
}
function sprig(x, y, z, seed) { const r = rng(seed); for (let i = 0; i < 5; i++) leaf(x + (r() - .5) * .12, y + i * .004, z + (r() - .5) * .12, r(), .05 + r() * .03); }
function lemon(x, y, z, ry) { ell(.15, { sc: [1.05, .55, .6], at: [x, y + .07, z], ry, c: '#f1d23a', m: [.6, 40, .1] }); ell(.12, { sc: [1.0, .06, .55], at: [x, y + .12, z], ry, c: '#fff0a0', m: [.6, 40, 0] }); }
function katori(x, z, r, hh, y0, fillCol, m, bump) {
  const [fr, fy] = bowlBody(r, hh, '#c9cfd8', STEEL, [x, y0, z]);
  if (fillCol) pool(fr, fy, [x, z], fillCol, m, bump || .012);
  return fy;
}
// ── models ──
function curryCols(n) {
  if (/dal|daal|lentil|tadka/.test(n)) return ['#e0a828', '#b87a12'];
  if (/palak|saag|spinach|green|methi/.test(n)) return ['#5f8a2a', '#3f6a1c'];
  if (/chole|rajma|chana|keema|bhuna|kadhai|kadai|rogan|mutton|lamb/.test(n)) return ['#a2501a', '#6c300e'];
  if (/korma|malai|shahi|white|raita/.test(n)) return ['#f0d9a8', '#d9bb80'];
  return ['#d9561c', '#a8340e'];
}
function genBowl(item) {
  const nm = String(item.name || '').toLowerCase(), [c1, c2] = curryCols(nm), Y = board(1.25);
  const [fr, fy] = bowlBody(.72, .52, '#2e3a4c', GLOSS, [-.14, Y, -.12]);
  pool(fr, fy, [-.14, -.12], (u, v, p) => { const x = p[0] + .14, z = p[2] + .12, f = fbm(x * 5, z * 5), r = Math.hypot(x, z), sw = Math.sin(Math.atan2(z, x) + r * 9);
    return mx(mx(hx(c1), hx(c2), f), hx('#f6e8cc'), sstep(.93, 1, sw) * (r < .55 ? 1 : 0) * (/dal|daal/.test(nm) ? 0 : .8)); }, SAUCE, .035);
  const bits = /chole|chana/.test(nm) ? 'chick' : /rajma/.test(nm) ? 'bean' : /dal|daal|palak|saag/.test(nm) ? '' : 'cube';
  const bc = /paneer|korma|malai/.test(nm) || !/chicken|mutton|lamb|keema|egg/.test(nm) ? '#f2dfae' : '#a9622f';
  if (bits) scatter(bits === 'cube' ? 5 : 16, 7, .48, (x, z, r) => {
    const o = { at: [-.14 + x, fy + .005, -.12 + z], ry: r() * 6, m: SAUCE, c: mx(hx(bits === 'bean' ? '#8e2a1a' : bc), hx(c2), .25 + r() * .2) };
    if (bits === 'cube') box(.2, .15, .18, o); else ell(bits === 'chick' ? .07 : .06, Object.assign(o, { sc: [1, .85, bits === 'bean' ? .65 : 1] })); });
  scatter(12, 11, .5, (x, z, r) => leaf(-.14 + x, fy + .03, -.12 + z, r(), .05 + r() * .03));
  tube(smooth([[-.4, fy + .035, -.12], [-.15, fy + .04, .15], [.12, fy + .04, -.1], [.2, fy + .035, -.35]], 6), .018, { c: '#fff3dc', m: SAUCE, seg: 6 });
  ell(.025, { at: [-.13, fy + .05, -.12], c: '#cc2a14', m: GLOSS });
  ell(.17, { sc: [.8, .26, 1.1], at: [.86, Y + .06, .5], c: '#cfd5dd', m: STEEL });
  tube(smooth([[.86, Y + .06, .28], [.86, Y + .06, -.3], [.86, Y + .1, -.85]], 5), .034, { c: '#cfd5dd', m: STEEL });
  return 1.1;
}
function genThali() {
  const y = plate(1.12, '#c4cad3', STEEL), cols = [['#e0a828', 'dal'], ['#c9421a'], ['#f4efe2'], ['#6b3d17']];
  [[-.62, -.42], [-.22, -.72], [.22, -.72], [.62, -.42]].forEach(([x, z], i) => katori(x, z, .25, .15, y, cols[i][0], i === 2 ? [.6, 40, .1] : SAUCE, .01));
  flatbread(.36, [-.36, y, .33], { th: .05, type: 'roti', seed: 3 });
  flatbread(.34, [-.3, y + .05, .4], { th: .05, type: 'roti', seed: 8, ry: 1 });
  lathe(dome(.34, .3, 10, .7), { n: 40, at: [.4, y, .3], m: [.3, 20, 0], warp: p => [p[0] * (1 + (vn(p[1] * 9, p[0] * 9) - .5) * .06), p[1] + (vn(p[0] * 30, p[2] * 30) - .5) * .02, p[2]],
    col: (u, v, p) => mx(hx('#f7f2e5'), hx('#e6dbbd'), vn(p[0] * 42, p[2] * 42 + p[1] * 20)) });
  scatter(5, 2, .12, (x, z, r) => ell(.02, { sc: [1, .4, 1], at: [.4 + x, y + .3, .3 + z], c: '#c58a2b' }));
  for (let i = 0; i < 4; i++) lathe(flat(.12, .015, 3), { raw: true, n: 24, at: [-.12 + i * .08, y + .02 + i * .012, .0 - i * .02], c: mx(hx('#c9e9a0'), hx('#9bd06c'), i / 3), m: [.5, 30, 0] });
  for (let i = 0; i < 3; i++) ell(.1, { sc: [1, .25, 1], at: [.1 + i * .09, y + .035, -.1 + i * .04], c: '#df3b2a', m: GLOSS });
  lemon(.7, y, .62, .4); sprig(.1, y + .15, .05, 3);
  return .6;
}
function genBread(item) {
  const nm = String(item.name || '').toLowerCase(), type = /paratha|parantha/.test(nm) ? 'paratha' : /roti|chapati|phulka/.test(nm) ? 'roti' : 'naan';
  const y = plate(1.2, '#343a44', GLOSS);
  const R = type === 'naan' ? .62 : .72;
  flatbread(R, [type === 'naan' ? -.08 : 0, y, 0], { tear: type === 'naan', type, th: type === 'naan' ? .08 : .065, seed: 4, ry: type === 'naan' ? .35 : 0 });
  if (type === 'naan') { ell(.14, { sc: [1.2, .55, 1], at: [.0, y + .12, -.02], c: '#ffe27a', m: GLOSS }); pool(.24, y + .09, [.0, -.02], '#f5cf55', GLOSS, .01);
    scatter(16, 5, .45, (x, z, r) => ell(.016, { at: [x * .9 - .04, y + .105, z * .5 - .02], sc: [1, .2, 1.3], c: '#3c8a2a' })); }
  else { ell(.1, { sc: [1.2, .55, 1], at: [.05, y + .1, .0], c: '#ffe27a', m: GLOSS }); }
  return .35;
}
function genRice() {
  const y = plate(1.1, '#f4f1ea', [.7, 60, .12]);
  lathe(dome(.66, .56, 14, .85), { n: 56, at: [-.1, y - .01, -.08], m: [.25, 18, 0],
    warp: (p) => { const k = 1 + (fbm(p[0] * 6, p[2] * 6) - .5) * .12; return [p[0] * k, p[1] + (vn(p[0] * 40, p[2] * 40) - .5) * .02, p[2] * k]; },
    col: (u, v, p) => { const g = vn(p[0] * 55, p[2] * 55 + p[1] * 30), s = sstep(.55, .75, fbm(p[0] * 5 + 3, p[2] * 5 + p[1] * 4)); return mx(mx(hx('#faf4e4'), hx('#e8dcbc'), g), hx('#f0aa2c'), s * .8); } });
  const d = x => .56 * Math.sqrt(Math.max(0, 1 - Math.pow(Math.hypot(x[0] + .1, x[1] + .08) / .66, 2))) + y;
  const rr = rng(9);
  for (let i = 0; i < 16; i++) { const a = rr() * 6.28, r0 = rr() * .4, pts = []; for (let k = 0; k < 6; k++) { const aa = a + k * .35 * (rr() - .3), r1 = r0 + k * .02, x = -.1 + r1 * Math.cos(aa), z = -.08 + r1 * Math.sin(aa); pts.push([x, d([x, z]) + .015, z]); }
    tube(smooth(pts, 3), .014, { seg: 5, c: mx(hx('#8a4d1c'), hx('#d09a3a'), rr()), m: [.4, 20, 0] }); }
  scatter(14, 4, .45, (x, z, r) => leaf(-.1 + x, d([-.1 + x, -.08 + z]) + .02, -.08 + z, r(), .045 + r() * .03));
  scatter(8, 6, .4, (x, z, r) => ell(.035, { sc: [1.3, .8, .8], at: [-.1 + x, d([-.1 + x, -.08 + z]) + .02, -.08 + z], ry: r() * 6, c: r() > .5 ? '#d9a350' : '#7a2f4a', m: GLOSS }));
  katori(.62, .6, .22, .14, y, '#f6f2ea', [.6, 40, .1], .01); lemon(.5, y, -.6, 2.4);
  return .75;
}
function genSkewer() {
  const y = plate(1.15, '#2a2e35', GLOSS), r = rng(21);
  for (let i = 0; i < 4; i++) torus(.2 + i * .02, .035, { at: [-.2 + i * .25, y + .04 + (i % 2) * .02, .02 * i - .1], sc: [1, 1.1, 1], rx: (r() - .5) * .3, c: mx(hx('#e9c6e0'), hx('#a8559c'), r() * .6), m: [.5, 30, 0] });
  const yy = x => .33 + (x + 1) * .05;
  tube([[-1.0, yy(-1), 0], [1.0, yy(1), 0]], .025, { c: '#d7dce3', m: STEEL, seg: 8 }); ell(.06, { at: [-1.0, yy(-1), 0], c: '#d7dce3', m: STEEL });
  const kinds = ['t', 'g', 't', 'p', 't', 'r', 't']; let x = -.72;
  for (const k of kinds) { const o = { at: [x, yy(x), 0], ry: r() * 3, rx: (r() - .5) * .2 };
    if (k === 't') sq(.17, .15, .16, .55, .45, Object.assign(o, { m: [.5, 30, .05], col: (u, v, p) => { const f = fbm(p[0] * 11, p[1] * 11 + p[2] * 9); return mx(mx(hx('#e0641f'), hx('#b73c12'), fbm(p[0] * 4, p[2] * 4)), hx('#2e170a'), sstep(.6, .7, f)); } }));
    else sq(.15, .14, .15, k === 'r' ? .8 : .35, .4, Object.assign(o, { c: k === 'g' ? '#3f9a35' : k === 'p' ? '#a1479a' : '#d93a22', m: GLOSS }));
    x += .27; }
  katori(.7, .62, .22, .13, y, '#6fae3c', SAUCE, .01); lemon(.35, y, .7, 1); sprig(-.5, y + .06, .55, 4); sprig(.1, y + .06, -.7, 6);
  return .6;
}
function genBurger() {
  const Y = board(1.25), r = rng(5);
  lathe([[0, .0], [.62, .0], [.66, .05], [.64, .16], [0, .16]], { n: 48, per: 3, at: [0, Y, 0], m: [.2, 14, 0], col: (u, v, p) => mx(hx('#e9b266'), hx('#c9893a'), vn(p[0] * 5, p[2] * 5)) });
  const y1 = Y + .15;
  lathe([[0, .0], [.6, .0], [.62, .04], [.55, .11], [0, .11]], { n: 48, per: 3, at: [0, y1, 0], m: [.5, 40, .05], c: '#6b3a1c', warp: p => [p[0], p[1] + (fbm(p[0] * 9, p[2] * 9) - .5) * .03, p[2]] });
  const y2 = y1 + .1;
  surf(16, 16, (u, v) => { const x = (u - .5) * 1.28, z = (v - .5) * 1.28, d = Math.max(Math.abs(x), Math.abs(z)); return [x, -.04 * sstep(.45, .65, d) + (fbm(x * 8, z * 8) - .5) * .015, z]; }, { at: [0, y2, 0], ry: .78, c: '#f2b524', m: [.7, 60, .1] });
  const y3 = y2 + .02;
  lathe([[0, 0], [.6, 0], [.7, .02], [.76, .06], [.7, .1]], { n: 64, per: 2, raw: true, at: [0, y3, 0], m: [.35, 25, 0], c: '#58a832',
    warp: p => { const a = Math.atan2(p[2], p[0]), f = Math.sin(a * 13) * .05 + Math.sin(a * 7 + 1) * .03; return [p[0] * (1 + f * .6), p[1] + f * .35, p[2] * (1 + f * .6)]; },
    col: (u, v, p) => mx(hx('#3f8a25'), hx('#8ccf4e'), clampN(Math.hypot(p[0], p[2]) * 1.1 - .3, 0, 1)) });
  for (let i = 0; i < 2; i++) lathe([[0, 0], [.5, 0], [.52, .02], [0, .02]], { n: 36, per: 1, raw: true, at: [(i - .5) * .18, y3 + .09 + i * .05, (i - .5) * -.1], m: GLOSS, c: i ? '#d6361f' : '#cf3a22',
    warp: p => [p[0] * .85, p[1] + (fbm(p[0] * 5, p[2] * 5) - .5) * .02, p[2] * .85] });
  const y4 = y3 + .2;
  lathe(dome(.66, .52, 14, .6).concat([[.66, 0]]).reverse().map((p, i, a) => p), { n: 56, per: 3, raw: false, at: [0, y4, 0], m: [.6, 50, .06],
    warp: p => [p[0], p[1], p[2]], col: (u, v, p) => mx(hx('#c9812f'), hx('#f0b866'), clampN(p[1] / .5, 0, 1) * .8 + vn(p[0] * 6, p[2] * 6) * .2) });
  scatter(22, 3, .45, (x, z) => { const hh = .5 * Math.sqrt(Math.max(0, 1 - Math.pow(Math.hypot(x, z) / .66, 2))) ** .6 * 1; ell(.032, { sc: [1.5, .6, .8], at: [x, y4 + hh * .95 + .01, z], ry: r() * 6, rz: (r() - .5) * .3, c: '#fbf0cf', m: [.5, 30, 0] }); });
  ell(.04, { at: [0, y4 + .53, 0], sc: [1, .3, 1], c: '#c98a3a' });
  return .95;
}
function genGlass(item) {
  const nm = String(item.name || '').toLowerCase(), Y = board(1.1) + .0;
  const L0 = /lassi|shake|milk|kulfi|falooda/.test(nm) ? ['#f6ecd9', '#e8d3ac'] : /mango/.test(nm) ? ['#f6a91c', '#e08a0c'] : /cola|coke|pepsi|soda|thums/.test(nm) ? ['#3b1c10', '#59301a'] : /lime|lemon|mojito|nimbu|mint/.test(nm) ? ['#d7e98a', '#a9cf55'] : /chai|tea|coffee/.test(nm) ? ['#b27339', '#7a4a21'] : /orange|juice/.test(nm) ? ['#f59a1d', '#ef7d10'] : ['#e86d6d', '#c43f3f'];
  const creamy = /lassi|shake|milk|falooda/.test(nm), hot = /chai|tea|coffee/.test(nm);
  const gp = hot ? [[0, 0], [.3, 0], [.34, .04], [.37, .55], [.4, .7], [.41, .72], [.37, .69], [.33, .5], [.28, .06], [0, .04]] : [[0, 0], [.34, 0], [.4, .05], [.42, .12], [.5, 1.15], [.52, 1.2], [.47, 1.17], [.38, .2], [0, .17]];
  const top = hot ? .66 : 1.0;
  lathe(hot ? [[0, .01], [.28, .02], [.3, .07], [.32, .1], [.37, .5], [.34, .66], [0, .66]] : [[0, .17], [.36, .17], [.38, .22], [.45, .78], [.47, top], [0, top]], { n: 48, per: 3, at: [0, Y, 0], m: SAUCE, col: (u, v, p) => mx(hx(L0[1]), hx(L0[0]), clampN(p[1] / 1.1 + .1, 0, 1)) });
  if (creamy) lathe(dome(.47, .06, 8), { n: 40, at: [0, Y + top, 0], c: '#fffaf0', m: [.4, 30, 0], warp: p => [p[0], p[1] + (fbm(p[0] * 8, p[2] * 8) - .5) * .025, p[2]] });
  if (!hot && !creamy) { const r = rng(8); for (let i = 0; i < 4; i++) box(.24, .22, .22, { at: [(r() - .5) * .4, Y + .75 + i * .06, (r() - .5) * .4], ry: r() * 3, rx: r() * .6, a: .5, c: '#eef8ff', m: GLOSS }); }
  if (!hot) { tube([[.12, Y + .35, .0], [.2, Y + 1.0, -.02], [.27, Y + 1.5, -.05], [.34, Y + 1.58, -.08]], .028, { seg: 8, m: GLOSS, col: (u, v) => Math.sin(v * 40) > 0 ? '#e63b3b' : '#fafafa' }); }
  lathe(gp, { n: 56, per: 3, at: [0, Y, 0], a: .2, m: [1, 120, .5], c: hot ? '#ffffff' : '#dff1ff' });
  if (hot) { torus(.15, .035, { rx: 1.5708, at: [.43, Y + .38, 0], sc: [1, 1, .8], c: '#f4f4f4', m: GLOSS }); lathe(flat(.62, 0, 4), { raw: true, n: 48, at: [0, Y - .0, 0], c: '#f4f4f4', m: GLOSS }); }
  else { lemon(.34, Y + .98, 0, 1.2); }
  return hot ? .8 : 1.55;
}
function genPizza(item) {
  const nm = String(item.name || '').toLowerCase(), nonveg = item.veg === 'nonveg' || /chicken|pepperoni|salami|meat/.test(nm), Y = board(1.35), R = .98, r = rng(14);
  const wob = p => { const a = Math.atan2(p[2], p[0]), k = 1 + (vn(Math.cos(a) * 1.5 + 4, Math.sin(a) * 1.5) - .5) * .06; return [p[0] * k, p[1], p[2] * k]; };
  lathe([[0, .0], [R * .85, .0], [R, .03], [R * 1.02, .08], [R * .99, .12], [R * .9, .09], [R * .86, .055], [0, .055]], { n: 64, per: 4, at: [0, Y, 0], m: [.15, 10, 0], warp: wob,
    col: (u, v, p) => mx(hx('#d9a24a'), hx('#b8742a'), clampN(Math.hypot(p[0], p[2]) / R, 0, 1) ** 4 * .8 + vn(p[0] * 14, p[2] * 14) * .3) });
  pool(R * .86, Y + .062, [0, 0], (u, v, p) => mx(mx(hx('#f4c54d'), hx('#e8a928'), fbm(p[0] * 6, p[2] * 6)), hx('#cf3d22'), sstep(.62, .75, vn(p[0] * 9 + 3, p[2] * 9)) * .55), [.6, 45, .12], .02);
  const top = (x, z) => Y + .075 + (fbm(x * 6, z * 6) - .5) * .02;
  scatter(nonveg ? 11 : 6, 3, R * .72, (x, z, rr) => { if (nonveg) { lathe(flat(.15, .03, 3), { raw: true, n: 28, at: [x, top(x, z) + .005, z], m: GLOSS, col: (u, v) => mx(hx('#b02a1c'), hx('#d44a2f'), v), warp: p => [p[0], p[1] + (1 - Math.hypot(p[0], p[2]) / .15) * .02, p[2]] }); scatter(3, x * 9 + 2, .08, (a, b) => ell(.02, { sc: [1, .3, 1], at: [x + a, top(x, z) + .035, z + b], c: '#f2d58a' })); }
    else { torus(.07, .02, { at: [x, top(x, z) + .02, z], sc: [1, .8, 1], c: '#1d1a18', m: GLOSS }); } });
  if (!nonveg) { scatter(9, 6, R * .72, (x, z, rr) => ell(.045, { sc: [1.8, .35, .55], at: [x, top(x, z) + .035, z], ry: rr() * 6, c: rr() > .5 ? '#3d9a2d' : '#d03d27', m: GLOSS })); scatter(8, 12, R * .72, (x, z, rr) => torus(.06, .008, { at: [x, top(x, z) + .02, z], rx: 0, c: '#d9a5c8', m: [.4, 30, 0] })); }
  scatter(6, 8, R * .7, (x, z, rr) => leaf(x, top(x, z) + .03, z, rr(), .09, '#2f8a23'));
  for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + .3; box(R * 1.9, .02, .012, { at: [0, Y + .105, 0], ry: -a, c: '#4a2a10', m: MATTE }); }
  return .55;
}
function genDessert(item) {
  const nm = String(item.name || '').toLowerCase(), Y = board(1.2);
  if (/cake|pastry|brownie|ice ?cream|kulfi/.test(nm)) {
    const ice = /ice ?cream|kulfi/.test(nm), y = plate(1.0, '#f6f3ee', [.7, 60, .12]) + Y - .0;
    if (ice) { [['#f7e3b6', 0], ['#e9a0b8', .3], ['#7a4a2a', .6]].forEach(([c, a], i) => ell(.26, { at: [-.28 + i * .28, y + .24, (i % 2 ? .12 : -.08)], sc: [1, .95, 1], c, m: [.5, 35, .08] })); tube([[.42, y + .1, .3], [.46, y + .95, .2]], .035, { c: '#d9b077', seg: 6 }); }
    else { const L2 = [['#6b3a1c', .2], ['#f2d8a6', .12], ['#6b3a1c', .2], ['#f2d8a6', .12], ['#6b3a1c', .2]]; let yy = y;
      L2.forEach(([c, hh]) => { box(.9, hh, .9, { at: [0, yy + hh / 2, 0], c, m: [.25, 14, 0], col: (u, v, p) => mx(hx(c), hx('#3b1d0c'), vn(p[0] * 20, p[1] * 20 + p[2] * 20) * .35) }); yy += hh; });
      box(.92, .05, .92, { at: [0, yy + .025, 0], c: '#fff2e0', m: GLOSS }); ell(.09, { at: [.0, yy + .12, .0], c: '#cf1d2c', m: GLOSS }); tube(smooth([[0, yy + .2, 0], [.04, yy + .32, .02], [.1, yy + .34, .06]], 3), .008, { c: '#3a6b22', seg: 4 }); }
    return .8;
  }
  const kheer = /kheer|halwa|rasmalai|payasam|rabri/.test(nm);
  const [fr, fy] = bowlBody(.62, .42, kheer ? '#f1ece2' : '#b04a2a', GLOSS, [0, Y, 0]);
  if (kheer) { pool(fr, fy, [0, 0], (u, v, p) => mx(hx('#fbf1d4'), hx('#efd9a2'), fbm(p[0] * 6, p[2] * 6)), SAUCE, .02); scatter(22, 5, .5, (x, z, rr) => ell(.025, { sc: [1.6, .5, .8], at: [x, fy + .02, z], ry: rr() * 6, c: rr() > .4 ? '#e9d49a' : '#8aa84a', m: [.3, 20, 0] })); scatter(8, 3, .3, (x, z, rr) => ell(.01, { at: [x, fy + .02, z], c: '#f0a22b' })); }
  else { pool(fr, fy, [0, 0], (u, v, p) => mx(hx('#e8a43a'), hx('#c97a12'), fbm(p[0] * 5, p[2] * 5)), [1, 90, .3], .01);
    [[-.22, -.12], [.2, -.16], [0, .24]].forEach(([x, z], i) => ell(.19, { at: [x, fy + .08, z], c: i % 2 ? '#7a3510' : '#6a2c0b', m: [1, 85, .25], warp: p => [p[0], p[1] + (fbm(p[0] * 30, p[2] * 30) - .5) * .004, p[2]] }));
    scatter(16, 9, .35, (x, z, rr) => ell(.017, { sc: [1.6, .5, .8], at: [x, fy + .34, z], ry: rr() * 6, c: '#8dba4a', m: [.3, 20, 0] })); }
  return .6;
}
function genNoodles() {
  const Y = board(1.2), R = .72;
  const [fr, fy] = bowlBody(R, .62, '#f3efe6', GLOSS, [0, Y, 0]);
  const r = rng(31);
  for (let i = 0; i < 46; i++) { const a = r() * 6.28, rad = r() * .5, pts = []; let ang = a, rr0 = rad;
    for (let k = 0; k < 9; k++) { ang += (r() - .35) * 1.2; rr0 = clampN(rr0 + (r() - .5) * .2, 0, .58); const x = rr0 * Math.cos(ang), z = rr0 * Math.sin(ang), hh = fy + .2 * Math.sqrt(Math.max(0, 1 - (rr0 / .66) ** 2)) + (r() - .3) * .05; pts.push([x, hh, z]); }
    tube(smooth(pts, 3), .02, { seg: 5, m: [.5, 30, .05], c: mx(hx('#f1cf8a'), hx('#c98a3a'), r() * .8) }); }
  scatter(14, 5, .45, (x, z, rr) => torus(.045, .014, { at: [x, fy + .22 * Math.sqrt(Math.max(0, 1 - (Math.hypot(x, z) / .66) ** 2)) + .03, z], rx: (rr() - .5) * 1.5, c: '#4fa238', m: GLOSS }));
  scatter(8, 8, .4, (x, z, rr) => box(.14, .03, .03, { at: [x, fy + .2 * Math.sqrt(Math.max(0, 1 - (Math.hypot(x, z) / .66) ** 2)) + .03, z], ry: rr() * 6, c: '#e56b1c', m: GLOSS }));
  tube([[.95, Y + .05, .85], [.1, Y + .95, .12], [-.2, Y + 1.25, -.04]], .018, { c: '#2a1810', seg: 6 }); tube([[1.0, Y + .05, .75], [.2, Y + 1.0, .2], [-.1, Y + 1.3, .02]], .018, { c: '#2a1810', seg: 6 });
  return 1.1;
}
function genSoup(item) {
  const nm = String(item.name || '').toLowerCase(), cr = /tomato/.test(nm) ? ['#d8431f', '#b32d12'] : /corn|chicken|cream|mushroom/.test(nm) ? ['#efd68a', '#d6b25a'] : /palak|spinach|green|veg/.test(nm) ? ['#7ea53a', '#5a8228'] : ['#d98a2f', '#b0641a'];
  const y = plate(1.15, '#f6f3ee', [.7, 60, .12]) + .0;
  const [fr, fy] = bowlBody(.58, .38, '#f7f5ee', GLOSS, [0, y, 0]);
  pool(fr, fy, [0, 0], (u, v, p) => mx(hx(cr[0]), hx(cr[1]), fbm(p[0] * 5, p[2] * 5)), SAUCE, .012);
  const sp = []; for (let k = 0; k <= 24; k++) { const a = k / 24 * 5.5; sp.push([Math.cos(a) * (.04 + a * .035), fy + .012, Math.sin(a) * (.04 + a * .035)]); }
  tube(sp, .012, { c: '#fff5e2', m: SAUCE, seg: 5 });
  scatter(6, 3, .3, (x, z, rr) => box(.07, .04, .07, { at: [x, fy + .02, z], ry: rr() * 6, c: '#d3984a', m: MATTE })); sprig(.12, fy + .02, -.1, 3);
  ell(.16, { sc: [.8, .22, 1.1], at: [.9, y + .08, .1], c: '#cfd5dd', m: STEEL }); tube([[.9, y + .08, -.1], [.9, y + .1, -.75]], .03, { c: '#cfd5dd', m: STEEL, seg: 6 });
  return .6;
}
function genGeneric() {
  const y = plate(1.2, '#ece9e2', [.7, 60, .12]);
  lathe(dome(.8, .78, 18, .55).concat([[.86, 0]]), { n: 56, at: [0, y, 0], c: '#cfd5dd', m: [1, 110, .55] });
  torus(.88, .03, { at: [0, y + .02, 0], c: '#cfd5dd', m: STEEL }); ell(.09, { at: [0, y + .82, 0], c: '#cfd5dd', m: STEEL });
  return .95;
}
const GENS = { bowl: genBowl, thali: genThali, bread: genBread, burger: genBurger, glass: genGlass, pizza: genPizza, skewer: genSkewer, rice: genRice, dessert: genDessert, noodles: genNoodles, soup: genSoup, generic: genGeneric };
function buildModel(kind, item) {
  G = { op: [], tr: [] };
  let hgt = 1;
  try { hgt = (GENS[kind] || genGeneric)(item || {}) || 1; } catch (e) { console.error('AR model', kind, e); }
  const out = G; G = null; out.h = hgt; return out;
}

// ───────────── WebGL renderer ─────────────
const VS = `attribute vec3 aP; attribute vec3 aN; attribute vec4 aC; attribute vec3 aM;
uniform mat4 uVP, uM; varying vec3 vP, vN; varying vec4 vC; varying vec3 vM;
void main(){ vec4 w = uM * vec4(aP,1.0); vP = w.xyz; vN = mat3(uM) * aN; vC = aC; vM = aM; gl_Position = uVP * w; }`;
const FS = `precision mediump float; varying vec3 vP, vN; varying vec4 vC; varying vec3 vM;
uniform vec3 uEye; uniform float uK;
void main(){
  vec3 N = normalize(vN), V = normalize(uEye - vP); if (dot(N,V) < 0.0) N = -N;
  vec3 L1 = normalize(vec3(-0.45, 0.85, 0.55)), L2 = normalize(vec3(0.7, 0.35, -0.5)), H = normalize(L1 + V);
  float d1 = max(dot(N,L1),0.0), d2 = max(dot(N,L2),0.0);
  vec3 amb = mix(vec3(0.34,0.31,0.30), vec3(0.55,0.60,0.68), N.y*0.5+0.5);
  vec3 col = vC.rgb * (amb + vec3(1.0,0.96,0.88)*d1*0.85 + vec3(0.55,0.62,0.75)*d2*0.28);
  float sp = pow(max(dot(N,H),0.0), vM.y) * vM.x * (0.35 + 0.65*d1);
  float fr = pow(1.0 - max(dot(N,V),0.0), 3.0);
  vec3 env = mix(vec3(0.22,0.20,0.19), vec3(0.85,0.92,1.0), clamp(reflect(-V,N).y*0.5+0.5,0.0,1.0));
  col = mix(col, env, vM.z * (0.25 + 0.75*fr)) + vec3(sp) + vec3(0.06)*fr;
  gl_FragColor = vec4(col * uK, vC.a);
}`;
const VS2 = `attribute vec2 aP; uniform mat4 uVP; uniform vec3 uAt; uniform vec2 uS; varying vec2 vU;
void main(){ vU = aP; gl_Position = uVP * vec4(uAt + vec3(aP.x*uS.x, 0.0, aP.y*uS.y), 1.0); }`;
const FS2 = `precision mediump float; varying vec2 vU; void main(){ float d = length(vU); float a = (1.0 - smoothstep(0.25, 1.0, d)) * 0.55; gl_FragColor = vec4(0.0,0.0,0.0,a); }`;
function prog(gl, vs, fs) {
  const mk = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
  const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p;
}
function makeRenderer(canvas) {
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false, preserveDrawingBuffer: true }) || canvas.getContext('experimental-webgl');
  if (!gl) throw new Error('WebGL is not available');
  const P = prog(gl, VS, FS), P2 = prog(gl, VS2, FS2);
  const loc = (p, n) => gl.getAttribLocation(p, n), uni = (p, n) => gl.getUniformLocation(p, n);
  const A = { p: loc(P, 'aP'), n: loc(P, 'aN'), c: loc(P, 'aC'), m: loc(P, 'aM') }, U = { vp: uni(P, 'uVP'), m: uni(P, 'uM'), eye: uni(P, 'uEye'), k: uni(P, 'uK') };
  const A2 = loc(P2, 'aP'), U2 = { vp: uni(P2, 'uVP'), at: uni(P2, 'uAt'), s: uni(P2, 'uS') };
  const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
  let model = null;
  const up = list => list.map(c => { const vb = gl.createBuffer(), ib = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(c.v), gl.STATIC_DRAW); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(c.i), gl.STATIC_DRAW); return { vb, ib, n: c.i.length }; });
  const draw = (chs) => { for (const c of chs) {
    gl.bindBuffer(gl.ARRAY_BUFFER, c.vb); const S = FL * 4;
    gl.enableVertexAttribArray(A.p); gl.vertexAttribPointer(A.p, 3, gl.FLOAT, false, S, 0);
    gl.enableVertexAttribArray(A.n); gl.vertexAttribPointer(A.n, 3, gl.FLOAT, false, S, 12);
    gl.enableVertexAttribArray(A.c); gl.vertexAttribPointer(A.c, 4, gl.FLOAT, false, S, 24);
    gl.enableVertexAttribArray(A.m); gl.vertexAttribPointer(A.m, 3, gl.FLOAT, false, S, 40);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.ib); gl.drawElements(gl.TRIANGLES, c.n, gl.UNSIGNED_SHORT, 0); } };
  return {
    gl, setModel(m) { model = { op: up(m.op), tr: up(m.tr), h: m.h }; },
    resize(w, h2, dpr) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h2 * dpr); gl.viewport(0, 0, canvas.width, canvas.height); },
    frame(v) { // v: {yaw, pitch, scale, dist}
      if (!model) return;
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const asp = canvas.width / canvas.height, fov = asp < 1 ? 0.95 : 0.7;
      const cy = model.h * .38, dist = v.dist, ep = [0, cy + Math.sin(v.pitch) * dist, Math.cos(v.pitch) * dist];
      const view = M4.mul(M4.tr(0, 0, -dist), M4.mul(M4.rx(v.pitch), M4.tr(0, -cy, 0)));
      const vp = M4.mul(M4.persp(fov, asp, .1, 60), view);
      const M = M4.mul(M4.ry(v.yaw), M4.sc(v.scale));
      gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(P2); gl.uniformMatrix4fv(U2.vp, false, vp); gl.uniform3f(U2.at, 0, .002, 0); gl.uniform2f(U2.s, 1.75 * v.scale, 1.75 * v.scale);
      gl.disable(gl.DEPTH_TEST); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(A2); gl.vertexAttribPointer(A2, 2, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.enable(gl.DEPTH_TEST);
      gl.useProgram(P); gl.uniformMatrix4fv(U.vp, false, vp); gl.uniformMatrix4fv(U.m, false, M);
      const e = [ep[0], ep[1], ep[2]]; // eye is fixed in world space (model rotates), so lighting stays put
      gl.uniform3f(U.eye, e[0], e[1], e[2]); gl.uniform1f(U.k, 1);
      gl.depthMask(true); draw(model.op); gl.depthMask(false); draw(model.tr); gl.depthMask(true);
    }
  };
}

// ───────────── overlay ─────────────
let openNow = null;
export function openAR(item) {
  if (openNow) return openNow;
  openNow = new Promise(resolve => {
    const kind = modelKindFor(item), hasGlb = !!item.glb;
    const video = h('video', { class: 'ar-video', playsinline: true, muted: true, autoplay: true });
    const canvas = h('canvas', { class: 'ar-canvas' });
    const note = h('div', { class: 'ar-note', hidden: true });
    const stage = h('div', { class: 'ar-stage' }, video, canvas);
    let stream = null, raf = 0, dead = false, auto = true, glFail = false;
    const view = { yaw: -.5, pitch: .62, scale: 1, dist: 4.1 }, home = Object.assign({}, view);
    const close = () => { if (dead) return; dead = true; cancelAnimationFrame(raf); try { stream && stream.getTracks().forEach(x => x.stop()); } catch (_) { } window.removeEventListener('resize', size); document.removeEventListener('keydown', onKey); wrap.remove(); openNow = null; resolve(); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    const btn = (icon, label, on) => h('button', { type: 'button', class: 'ar-btn', title: label, 'aria-label': label, onClick: on }, icon);
    const autoB = btn('⟳', t('Auto-rotate'), () => { auto = !auto; autoB.classList.toggle('off', !auto); });
    const shot = btn('📸', t('Take a picture'), snapshot);
    const reset = btn('⌖', t('Reset view'), () => Object.assign(view, home));
    const chips = [item.prep_min ? '⏱ ' + t('{n} min', { n: item.prep_min }) : null, item.veg === 'veg' ? '🟢 ' + t('Veg') : item.veg === 'nonveg' ? '🔴 ' + t('Non-veg') : null].filter(Boolean);
    const wrap = h('div', { class: 'ar-wrap', role: 'dialog', 'aria-modal': 'true' }, stage,
      h('div', { class: 'ar-top' }, h('button', { type: 'button', class: 'ar-btn', 'aria-label': t('Close'), onClick: close }, '✕'),
        h('div', { class: 'ar-title' }, h('b', null, nameOf(item)), h('span', null, [money(item.price)].concat(chips).join('  ·  '))), h('span', { class: 'ar-spacer' })),
      h('div', { class: 'ar-side' }, autoB, reset, shot), note,
      h('div', { class: 'ar-hint' }, t('Drag to turn · pinch to resize · double-tap to reset')));
    document.body.append(wrap); document.addEventListener('keydown', onKey);

    function say(msg) { note.textContent = msg; note.hidden = !msg; }
    async function startCam() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { stage.classList.add('studio'); say(window.isSecureContext ? t('Camera is not available on this device — showing the dish on a plain background.') : t('The camera needs a secure (https) connection — showing the dish on a plain background.')); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (dead) { stream.getTracks().forEach(x => x.stop()); return; }
        video.srcObject = stream; await video.play().catch(() => { }); say('');
      } catch (_) { stage.classList.add('studio'); say(t('Camera permission was not given — showing the dish on a plain background.')); }
    }
    function size() { if (!r) return; const w = stage.clientWidth, hh = stage.clientHeight; r.resize(w, hh, Math.min(2, window.devicePixelRatio || 1)); }
    function snapshot() {
      const c = document.createElement('canvas'), W = canvas.width, H = canvas.height; c.width = W; c.height = H; const x = c.getContext('2d');
      x.fillStyle = '#20252b'; x.fillRect(0, 0, W, H);
      if (video.videoWidth) { const s = Math.max(W / video.videoWidth, H / video.videoHeight), vw = video.videoWidth * s, vh = video.videoHeight * s; x.drawImage(video, (W - vw) / 2, (H - vh) / 2, vw, vh); }
      x.drawImage(canvas, 0, 0);
      c.toBlob(async b => { if (!b) return; const f = new File([b], (nameOf(item) || 'dish').replace(/\W+/g, '-') + '.png', { type: 'image/png' });
        try { if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: nameOf(item) }); return; } } catch (_) { }
        const a = h('a', { href: URL.createObjectURL(b), download: f.name }); document.body.append(a); a.click(); a.remove(); }, 'image/png');
    }
    // gestures
    const ptr = new Map(); let pinch0 = 0, scale0 = 1, lastTap = 0;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); ptr.set(e.pointerId, [e.clientX, e.clientY]); if (ptr.size === 2) { const [a, b] = [...ptr.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); scale0 = view.scale; }
      const n = Date.now(); if (ptr.size === 1 && n - lastTap < 320) Object.assign(view, home); lastTap = n; });
    canvas.addEventListener('pointermove', e => { const p = ptr.get(e.pointerId); if (!p) return; const dx = e.clientX - p[0], dy = e.clientY - p[1]; ptr.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptr.size === 1) { view.yaw += dx * .012; view.pitch = clampN(view.pitch + dy * .006, .12, 1.3); auto = false; autoB.classList.add('off'); }
      else if (ptr.size === 2) { const [a, b] = [...ptr.values()]; view.scale = clampN(scale0 * Math.hypot(a[0] - b[0], a[1] - b[1]) / (pinch0 || 1), .45, 2.4); } });
    const up2 = e => { ptr.delete(e.pointerId); }; canvas.addEventListener('pointerup', up2); canvas.addEventListener('pointercancel', up2);
    canvas.addEventListener('wheel', e => { e.preventDefault(); view.scale = clampN(view.scale * Math.exp(-e.deltaY * .001), .45, 2.4); }, { passive: false });
    window.addEventListener('resize', size);

    let r = null;
    startCam();
    if (hasGlb) {
      const mv = () => { const el = document.createElement('model-viewer'); el.setAttribute('src', item.glb); el.setAttribute('ar', ''); el.setAttribute('ar-modes', 'webxr scene-viewer quick-look'); el.setAttribute('camera-controls', ''); el.setAttribute('auto-rotate', ''); el.setAttribute('shadow-intensity', '1'); el.setAttribute('alt', nameOf(item)); el.className = 'ar-mv'; stage.append(el); canvas.hidden = true; };
      const s = document.createElement('script'); s.type = 'module'; s.src = 'https://unpkg.com/@google/model-viewer@3.5.0/dist/model-viewer.min.js'; s.onload = mv; s.onerror = () => { glb(false); }; document.head.append(s);
    }
    function glb() { initGL(); }
    function initGL() {
      if (r || dead) return;
      try { r = makeRenderer(canvas); r.setModel(buildModel(kind, item)); size(); } catch (e) { console.error(e); glFail = true; say(t('3D view is not supported on this device.')); return; }
      canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); glFail = true; }); 
      let t0 = performance.now();
      const loop = now => { if (dead) return; const dt = Math.min(.05, (now - t0) / 1000); t0 = now; if (auto && !ptr.size) view.yaw += dt * .5; if (!glFail) r.frame(view); raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
    }
    if (!hasGlb) initGL();
  });
  return openNow;
}
