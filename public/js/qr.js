// Minimal QR Code generator (byte mode, ECC level L or M, versions 1-20 = up to ~660 bytes).
// Used for table QR cards and the Saudi ZATCA (Phase 1) invoice QR. Verified against OpenCV's decoder.

// version -> [ecPerBlock, blocksG1, dataG1, blocksG2, dataG2]
const EC = {
  L: [null, [7, 1, 19, 0, 0], [10, 1, 34, 0, 0], [15, 1, 55, 0, 0], [20, 1, 80, 0, 0], [26, 1, 108, 0, 0], [18, 2, 68, 0, 0], [20, 2, 78, 0, 0], [24, 2, 97, 0, 0], [30, 2, 116, 0, 0], [18, 2, 68, 2, 69],
    [20, 4, 81, 0, 0], [24, 2, 92, 2, 93], [26, 4, 107, 0, 0], [30, 3, 115, 1, 116], [22, 5, 87, 1, 88], [24, 5, 98, 1, 99], [28, 1, 107, 5, 108], [30, 5, 120, 1, 121], [28, 3, 113, 4, 114], [28, 3, 107, 5, 108]],
  M: [null, [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0], [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44],
    [30, 1, 50, 4, 51], [22, 6, 36, 2, 37], [22, 8, 37, 1, 38], [24, 4, 40, 5, 41], [24, 5, 41, 5, 42], [28, 7, 45, 3, 46], [28, 10, 46, 1, 47], [26, 9, 43, 4, 44], [26, 3, 44, 11, 45], [26, 3, 41, 13, 42]]
};
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90]];
const FMT_BITS = { L: 1, M: 0 };

// GF(256)
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
const gmul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];
function rsGen(deg) {
  let g = [1];
  for (let i = 0; i < deg; i++) {
    const n = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { n[j] ^= g[j]; n[j + 1] ^= gmul(g[j], EXP[i]); }
    g = n;
  }
  return g;
}
function rsEncode(data, deg) {
  const gen = rsGen(deg);
  const res = new Array(deg).fill(0);
  for (const b of data) {
    const f = b ^ res[0];
    res.shift(); res.push(0);
    for (let i = 0; i < deg; i++) res[i] ^= gmul(gen[i + 1], f);
  }
  return res;
}
const utf8 = s => Array.from(new TextEncoder().encode(s));

function maskFn(m, r, c) {
  switch (m) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return (r * c) % 2 + (r * c) % 3 === 0;
    case 6: return ((r * c) % 2 + (r * c) % 3) % 2 === 0;
    default: return ((r + c) % 2 + (r * c) % 3) % 2 === 0;
  }
}
function bch(val, gen, bits) {
  let r = val << bits;
  const glen = gen.toString(2).length;
  for (let i = r.toString(2).length - glen; i >= 0; i--) if ((r >> (i + glen - 1)) & 1) r ^= gen << i;
  return r;
}

/** @returns {{size:number, get:(r:number,c:number)=>boolean}} */
export function qrMatrix(text, ecl = 'M') {
  const bytes = utf8(text);
  let ver = 0;
  for (let v = 1; v <= 20; v++) {
    const e = EC[ecl][v];
    const cap = (e[1] * e[2] + e[3] * e[4]) * 8;
    if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= cap) { ver = v; break; }
  }
  if (!ver) throw new Error('QR: text too long');
  const [ecPer, b1, d1, b2, d2] = EC[ecl][ver];
  const dataCw = b1 * d1 + b2 * d2;
  // bit stream
  const bits = [];
  const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  put(4, 4); put(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, dataCw * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const cw = [];
  for (let i = 0; i < bits.length; i += 8) cw.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let p = 0; cw.length < dataCw; p++) cw.push(p % 2 ? 0x11 : 0xec);
  // blocks
  const blocks = []; let pos = 0;
  for (let i = 0; i < b1 + b2; i++) { const n = i < b1 ? d1 : d2; blocks.push(cw.slice(pos, pos + n)); pos += n; }
  const ecs = blocks.map(b => rsEncode(b, ecPer));
  const final = [];
  for (let i = 0; i < Math.max(d1, d2); i++) for (const b of blocks) if (i < b.length) final.push(b[i]);
  for (let i = 0; i < ecPer; i++) for (const e of ecs) final.push(e[i]);

  const size = ver * 4 + 17;
  const mod = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (r, c, v) => { mod[r][c] = v; fn[r][c] = true; };
  // finders + separators
  for (const [fr, fc] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const rr = fr + r, cc = fc + c;
      if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
      const on = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6)) || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      set(rr, cc, on);
    }
  }
  // timing
  for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  // alignment
  const al = ALIGN[ver];
  for (const r of al) for (const c of al) {
    if ((r === 6 && c === 6) || (r === 6 && c === al[al.length - 1]) || (r === al[al.length - 1] && c === 6)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }
  // reserve format areas + dark module
  const reserveFmt = () => {
    for (let i = 0; i < 9; i++) { fn[8][i] = true; fn[i][8] = true; }
    for (let i = 0; i < 8; i++) { fn[8][size - 1 - i] = true; fn[size - 1 - i][8] = true; }
    set(size - 8, 8, true);
  };
  reserveFmt();
  // version info
  if (ver >= 7) {
    const vi = (ver << 12) | bch(ver, 0x1f25, 12);
    for (let i = 0; i < 18; i++) {
      const bit = ((vi >> i) & 1) === 1;
      const a = Math.floor(i / 3), b = i % 3 + size - 11;
      set(a, b, bit); set(b, a, bit);
    }
  }
  // place data (zig-zag)
  const allBits = [];
  for (const b of final) for (let i = 7; i >= 0; i--) allBits.push((b >> i) & 1);
  let bi = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const up = ((right + 1) & 2) === 0;
        const r = up ? size - 1 - vert : vert;
        if (!fn[r][c] && bi < allBits.length) { mod[r][c] = allBits[bi++] === 1; }
      }
    }
  }
  const apply = m => {
    const g = mod.map(r => r.slice());
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!fn[r][c] && maskFn(m, r, c)) g[r][c] = !g[r][c];
    // format bits
    const f = (((FMT_BITS[ecl] << 3) | m) << 10 | bch((FMT_BITS[ecl] << 3) | m, 0x537, 10)) ^ 0x5412;
    const fb = i => ((f >> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) g[i][8] = fb(i);
    g[7][8] = fb(6); g[8][8] = fb(7); g[8][7] = fb(8);
    for (let i = 9; i < 15; i++) g[8][14 - i] = fb(i);
    for (let i = 0; i < 8; i++) g[8][size - 1 - i] = fb(i);
    for (let i = 8; i < 15; i++) g[size - 15 + i][8] = fb(i);
    g[size - 8][8] = true;
    return g;
  };
  const penalty = g => {
    let p = 0;
    const line = get => {
      let run = 1, s = '';
      for (let i = 0; i < size; i++) { s += get(i) ? '1' : '0'; if (i && get(i) === get(i - 1)) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; }
      for (const pat of ['10111010000', '00001011101']) { let k = -1; while ((k = s.indexOf(pat, k + 1)) !== -1) p += 40; }
    };
    for (let r = 0; r < size; r++) line(c => g[r][c]);
    for (let c = 0; c < size; c++) line(r => g[r][c]);
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) if (g[r][c] === g[r][c + 1] && g[r][c] === g[r + 1][c] && g[r][c] === g[r + 1][c + 1]) p += 3;
    let dark = 0; for (const r of g) for (const v of r) if (v) dark++;
    p += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    return p;
  };
  let best = null, bp = Infinity;
  for (let m = 0; m < 8; m++) { const g = apply(m); const p = penalty(g); if (p < bp) { bp = p; best = g; } }
  return { size, version: ver, get: (r, c) => best[r][c] };
}

/** Crisp inline SVG string (dark modules as one path). */
export function qrSvg(text, { px = 160, margin = 2, ecl = 'M', fg = '#000', bg = '#fff' } = {}) {
  const q = qrMatrix(text, ecl);
  const n = q.size + margin * 2;
  let d = '';
  for (let r = 0; r < q.size; r++) {
    let c = 0;
    while (c < q.size) {
      if (q.get(r, c)) { let e = c; while (e < q.size && q.get(r, e)) e++; d += `M${c + margin} ${r + margin}h${e - c}v1h-${e - c}z`; c = e; } else c++;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="${bg}"/><path d="${d}" fill="${fg}"/></svg>`;
}
/** Draw on a canvas context at (x,y) with side length `side` px. */
export function qrDraw(ctx, text, x, y, side, { margin = 2, ecl = 'M' } = {}) {
  const q = qrMatrix(text, ecl);
  const n = q.size + margin * 2;
  const k = Math.floor(side / n);
  const off = Math.floor((side - k * n) / 2);
  ctx.fillStyle = '#fff'; ctx.fillRect(x, y, side, side);
  ctx.fillStyle = '#000';
  for (let r = 0; r < q.size; r++) for (let c = 0; c < q.size; c++) if (q.get(r, c)) ctx.fillRect(x + off + (c + margin) * k, y + off + (r + margin) * k, k, k);
  return k * n;
}

/** ZATCA (Saudi e-invoicing, Phase 1) QR payload: base64 of TLV(seller, VAT no., ISO time, total, VAT). */
export function zatcaPayload({ seller, vat, time, total, vatAmount }) {
  const parts = [seller, vat, time, total, vatAmount].map(String);
  const out = [];
  parts.forEach((v, i) => { const b = utf8(v); out.push(i + 1, b.length, ...b); });
  let s = ''; for (const b of out) s += String.fromCharCode(b);
  return btoa(s);
}
