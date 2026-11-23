// Printing: thermal rolls (58/76/80/112 mm or custom) and sheet printers (A3…A6, Letter, Legal, custom).
// Two delivery methods per printer profile:
//   browser — opens the system print dialog (silent with Chrome's --kiosk-printing flag)
//   network — renders the ticket to a bitmap and sends ESC/POS raster data to a LAN printer (port 9100) through the
//             RestoPOS server. Works with Arabic and logos, no dialog, ideal for kitchen printers.
import { store, fetchJSON, deviceId } from './store.js';
import { esc, fmtDate, fmtTime, hasRTL, now, money, num, h } from './util.js';
import { settings, orderTotals, itemsOf, billed, billNoLabel, tableById, userName, session, lineTotal, PRINT_DEFAULTS, feature, invoiceTitleKey, pointsOf } from './logic.js';
import { tl, nameOf } from './i18n.js';
import { qrSvg, qrDraw } from './qr.js';
import { upiLink, stateName } from './gst.js';

export const PAPERS = [
  { id: '58', label: 'Thermal 58 mm', w: 58, h: 0, dots: 384, thermal: true },
  { id: '76', label: 'Thermal 76 mm', w: 76, h: 0, dots: 512, thermal: true },
  { id: '80', label: 'Thermal 80 mm', w: 80, h: 0, dots: 576, thermal: true },
  { id: '112', label: 'Thermal 112 mm', w: 112, h: 0, dots: 832, thermal: true },
  { id: 'a3', label: 'A3 (297 × 420 mm)', w: 297, h: 420 },
  { id: 'a4', label: 'A4 (210 × 297 mm)', w: 210, h: 297 },
  { id: 'a5', label: 'A5 (148 × 210 mm)', w: 148, h: 210 },
  { id: 'a6', label: 'A6 (105 × 148 mm)', w: 105, h: 148 },
  { id: 'b5', label: 'B5 (176 × 250 mm)', w: 176, h: 250 },
  { id: 'letter', label: 'Letter (8.5 × 11 in)', w: 215.9, h: 279.4 },
  { id: 'legal', label: 'Legal (8.5 × 14 in)', w: 215.9, h: 355.6 },
  { id: 'half', label: 'Half Letter (5.5 × 8.5 in)', w: 139.7, h: 215.9 },
  { id: 'exec', label: 'Executive (7.25 × 10.5 in)', w: 184.1, h: 266.7 },
  { id: 'custom', label: 'Custom size…', w: 80, h: 0, custom: true }
];
const DEV_KEY = 'restopos.devprint';
export function deviceOverride() { try { return JSON.parse(localStorage.getItem(DEV_KEY) || '{}'); } catch (_) { return {}; } }
export function saveDeviceOverride(o) { localStorage.setItem(DEV_KEY, JSON.stringify(o)); }
/** Effective printer profile for this device: defaults < shared settings < this device's override */
export function profile(kind) {
  const p = Object.assign({}, PRINT_DEFAULTS[kind], settings().print[kind], (deviceOverride()[kind]) || {});
  const pp = PAPERS.find(x => x.id === p.paper) || PAPERS[2];
  if (!pp.custom) { p.w = pp.w; p.h = pp.h; if (pp.dots && !p.dotsCustom) p.dots = pp.dots; }
  p.thermal = !!pp.thermal || (p.h === 0);
  return p;
}

// ───────── models ─────────
// lang is 'en' | 'hi' | 'ur' | 'en+hi' | 'en+ur'  (bilingual prints both, separated by " / ")
const parts = lang => String(lang || 'en').split('+');
const uniq = (v, i, a) => v && a.indexOf(v) === i;
function labeler(lang) { const ps = parts(lang); return (k, vars) => ps.map(l => tl(l, k, vars)).filter(uniq).join(' / '); }
function nm(o, lang) { return parts(lang).map(l => nameOf(o, l)).filter(uniq).join(' / '); }
const isRtlLang = lang => lang === 'ur';
const words = n => {
  // Indian-style amount in words (English): "Rupees One Thousand Two Hundred Thirty Four and Fifty Paise Only"
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = x => x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? ' ' + a[x % 10] : '');
  const three = x => (x >= 100 ? a[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' : '') : '') + (x % 100 ? two(x % 100) : '');
  let rup = Math.floor(n + 1e-9), pai = Math.round((n - rup) * 100);
  if (pai === 100) { rup++; pai = 0; }
  const out = [];
  const cr = Math.floor(rup / 1e7); rup %= 1e7; const lk = Math.floor(rup / 1e5); rup %= 1e5; const th = Math.floor(rup / 1e3); rup %= 1e3;
  if (cr) out.push(three(cr) + ' Crore'); if (lk) out.push(two(lk) + ' Lakh'); if (th) out.push(two(th) + ' Thousand'); if (rup) out.push(three(rup));
  let r = 'Rupees ' + (out.join(' ') || 'Zero');
  if (pai) r += ' and ' + two(pai) + ' Paise';
  return r + ' Only';
};
export const amountInWords = words;

export function receiptModel(order, lang, { provisional = false } = {}) {
  const s = settings();
  const items = itemsOf(order.id).filter(billed);
  const t = orderTotals(order);
  const table = tableById(order.table_id);
  const L = labeler(lang);
  const paid = order.status === 'paid' || order.status === 'cancelled';
  const typeName = { dine_in: 'Dine-in', takeaway: 'Takeaway', delivery: 'Delivery' }[order.type] || order.type;
  const staff = userName(order.waiter_id || order.cashier_id || (session.user && session.user.id));
  const when = order.paid_at || now();
  const pm = id => { const m = s.payment_methods.find(x => x.id === id); return m ? parts(lang).map(l => (l === 'hi' && m.label_hi) || (l === 'ur' && m.label_ur) || tl(l, m.label)).filter(uniq).join(' / ') : id; };
  const cust = order.customer || {};
  const gst = t.scheme === 'regular';
  const tip = Number(order.tip) || 0;
  const rate = r => (Number.isInteger(r) ? r : r.toFixed(2)) + '%';
  const totals = [
    [L('Items total'), money(t.subtotal)],
    t.memberDiscount ? [L('Member discount') + ' ' + t.memberPct + '%' + (order.member_card ? ' (' + order.member_card + ')' : ''), '-' + money(t.memberDiscount)] : null,
    t.couponDiscount ? [L('Coupon') + (order.coupon ? ' ' + order.coupon.code : ''), '-' + money(t.couponDiscount)] : null,
    t.pointsDiscount ? [L('Reward points') + ' (' + order.points_used + ')', '-' + money(t.pointsDiscount)] : null,
    t.discount ? [L('Discount') + (order.discount && order.discount.type === 'pct' ? ' ' + order.discount.value + '%' : ''), '-' + money(t.discount)] : null,
    t.service ? [L('Service charge') + ' ' + s.service_pct + '%', money(t.service)] : null,
    t.packaging ? [L('Packaging'), money(t.packaging)] : null,
    t.delivery ? [L('Delivery charge'), money(t.delivery)] : null,
    gst ? [L('Taxable value'), money(t.taxable)] : null
  ];
  if (gst) for (const g of t.groups) {
    if (!g.rate) continue;
    if (g.igst) totals.push(['IGST ' + rate(g.rate), money(g.igst)]);
    else { totals.push(['CGST ' + rate(g.rate / 2), money(g.cgst)]); totals.push(['SGST ' + rate(g.rate / 2), money(g.sgst)]); }
  }
  if (t.rounding) totals.push([L('Round off'), (t.rounding > 0 ? '+' : '') + money(t.rounding)]);
  let upi = null;
  if (!paid && s.upi_id && feature('upi_qr') && !provisional) upi = upiLink({ vpa: s.upi_id, name: s.upi_name || s.name, amount: t.total, note: 'Order ' + (order.no || '') });
  return {
    L, lang, s, t, paid, upi, logo: s.logo || '', gst, cancelled: order.status === 'cancelled',
    shop: { name: parts(lang).map(l => nameOf(s, l)).filter(uniq).join(' / '), address: s.address, phone: s.phone, gstin: gst ? s.gstin : '', fssai: s.fssai, state: s.state_code ? s.state_code + '-' + stateName(s.state_code) : '' },
    title: L(paid ? invoiceTitleKey() : 'Bill (not paid)') + (order.status === 'cancelled' ? ' — ' + L('CANCELLED') : ''),
    meta: [
      paid && order.bill_no != null ? [L(gst ? 'Invoice no.' : 'Bill no.'), billNoLabel(order)] : null,
      [L('Order'), order.no != null ? '#' + order.no : '—'],
      [L('Date'), fmtDate(when) + ' ' + fmtTime(when)],
      [L('Type'), L(typeName) + (table ? ' · ' + L('Table') + ' ' + table.no : '')],
      staff ? [L('Served by'), staff] : null,
      order.guests ? [L('Guests'), String(order.guests)] : null,
      cust.name ? [L('Customer'), cust.name + (cust.phone ? ' ' + cust.phone : '')] : null,
      cust.gstin ? ['GSTIN', cust.gstin + (cust.state_code ? ' (' + cust.state_code + ')' : '')] : null,
      cust.address && order.type === 'delivery' ? [L('Address'), cust.address] : null,
      order.member_name ? [L('Member'), order.member_name + ' · ' + order.member_card] : null
    ].filter(Boolean),
    lines: items.map(l => ({ qty: l.qty, name: nm(l, lang), mods: (l.mods || []).map(m => '+ ' + nm(m, lang) + (m.price ? ' (' + money(m.price) + ')' : '')), note: l.note, price: l.price, total: lineTotal(l), hsn: l.hsn, gst: l.gst, veg: l.veg })),
    totals,
    total: [L('TOTAL'), money(t.total)],
    tip: tip ? [L('Tip'), money(tip)] : null,
    payable: tip ? [L('Amount paid'), money(t.total + tip)] : null,
    words: amountInWords(t.total),
    pays: (order.payments || []).map(p => [pm(p.method), money(p.amount)]).concat((order.payments || []).some(p => p.change > 0) ? [[L('Change'), money(order.payments.reduce((a, p) => a + (p.change || 0), 0))]] : []),
    groups: t.groups, inclusive: t.inclusive,
    footer: (order.points_earned > 0 && order.customer_id ? parts(lang).map(l => tl(l, 'You earned {n} points · balance {b}', { n: order.points_earned, b: pointsOf(order.customer_id) })).filter(uniq).join('\n') + '\n' : '') + parts(lang).map(l => (l === 'hi' ? s.receipt_footer_hi : l === 'ur' ? s.receipt_footer_ur : s.receipt_footer)).filter(uniq).join('\n')
  };
}
/** Generic ticket lines used by the thermal HTML + raster renderers */
export function receiptTicket(m, prof) {
  const o = [];
  if (m.logo && prof.logo) o.push({ k: 'logo', src: m.logo });
  o.push({ k: 'text', text: m.shop.name, size: 1.9, bold: true, align: 'c' });
  if (m.shop.address) o.push({ k: 'text', text: m.shop.address, align: 'c' });
  if (m.shop.phone) o.push({ k: 'text', text: 'Ph: ' + m.shop.phone, align: 'c' });
  if (m.shop.gstin) o.push({ k: 'text', text: 'GSTIN: ' + m.shop.gstin, align: 'c', bold: true });
  if (m.shop.fssai) o.push({ k: 'text', text: 'FSSAI: ' + m.shop.fssai, align: 'c' });
  o.push({ k: 'hr' }, { k: 'text', text: m.title, bold: true, align: 'c', size: 1.2 }, { k: 'gap', n: 0.3 });
  for (const [a, b] of m.meta) o.push({ k: 'row', l: a, r: b });
  o.push({ k: 'hr' });
  for (const l of m.lines) {
    o.push({ k: 'row', l: l.qty + ' × ' + l.name, r: money(l.total), bold: true });
    for (const md of l.mods) o.push({ k: 'text', text: '   ' + md, align: 'l', small: true });
    if (l.note) o.push({ k: 'text', text: '   ✎ ' + l.note, align: 'l', small: true });
  }
  o.push({ k: 'hr' });
  for (const r of m.totals) if (r) o.push({ k: 'row', l: r[0], r: r[1] });
  o.push({ k: 'row', l: m.total[0], r: m.total[1], bold: true, size: 1.5 });
  if (m.tip) { o.push({ k: 'row', l: m.tip[0], r: m.tip[1] }); o.push({ k: 'row', l: m.payable[0], r: m.payable[1], bold: true }); }
  if (m.pays.length) { o.push({ k: 'hr', style: 'dash' }); for (const [a, b] of m.pays) o.push({ k: 'row', l: a, r: b }); }
  if (m.upi && prof.qr) o.push({ k: 'gap', n: 0.5 }, { k: 'text', text: m.L('Scan to pay by UPI'), align: 'c', bold: true }, { k: 'qr', data: m.upi });
  if (m.footer) o.push({ k: 'gap', n: 0.4 }, ...m.footer.split('\n').map(f => ({ k: 'text', text: f, align: 'c' })));
  return o;
}
export function kotTicket(order, lines, { station, lang = 'en' } = {}) {
  const L = labeler(lang);
  const s = settings();
  const table = tableById(order.table_id);
  const st = s.stations.find(x => x.id === station);
  const round = Math.max(...lines.map(l => l.round || 1));
  const o = [];
  if (st) o.push({ k: 'text', text: st.name, bold: true, align: 'c', size: 1.3 });
  o.push({ k: 'text', text: table ? L('Table') + ' ' + table.no : (order.type === 'delivery' ? L('Delivery') : L('Takeaway')) + (order.customer && order.customer.name ? ' · ' + order.customer.name : ''), bold: true, align: 'c', size: 2.4 });
  if (order.partner_id) { const pr = store.get('partners', order.partner_id); if (pr) o.push({ k: 'text', text: pr.name, bold: true, align: 'c' }); }
  o.push({ k: 'row', l: L('Order') + ' ' + (order.no != null ? '#' + order.no : ''), r: fmtTime(lines[0].sent_at || now()) });
  const who = userName(order.waiter_id || lines[0].by) || (lines[0].src === 'table' ? L('Table tablet') : '');
  if (who) o.push({ k: 'row', l: who, r: round > 1 ? L('ADD-ON') + ' ' + round : '' });
  o.push({ k: 'hr', style: 'double' });
  for (const l of lines) {
    o.push({ k: 'text', text: l.qty + ' × ' + nm(l, lang), bold: true, size: 1.5, align: 'l' });
    for (const md of l.mods || []) o.push({ k: 'text', text: '   + ' + nm(md, lang), bold: true, align: 'l' });
    if (l.note) o.push({ k: 'text', text: '   ✎ ' + l.note, bold: true, align: 'l' });
    o.push({ k: 'gap', n: 0.25 });
  }
  o.push({ k: 'hr', style: 'double' });
  if (order.note) o.push({ k: 'text', text: L('Note') + ': ' + order.note, bold: true, align: 'l' });
  return o;
}
export function reportTicket(title, rows, lang = 'en') {
  const s = settings();
  const o = [{ k: 'text', text: s.name, bold: true, size: 1.5, align: 'c' }, { k: 'text', text: title, bold: true, align: 'c' }, { k: 'text', text: fmtDate(now()) + ' ' + fmtTime(now()), align: 'c' }, { k: 'hr' }];
  for (const r of rows) {
    if (r === '-') o.push({ k: 'hr', style: 'dash' });
    else if (r.head) o.push({ k: 'text', text: r.head, bold: true, align: 'l' });
    else o.push({ k: 'row', l: r[0], r: r[1], bold: !!r[2] });
  }
  return o;
}

// ───────── HTML (browser printing) ─────────
const nl = s => esc(s).replace(/\n/g, '<br>');
function baseCSS(prof, pageW, pageH, wrapW) {
  const fs = prof.font * (prof.scale / 100);
  return `@page{size:${pageW}mm ${pageH ? pageH + 'mm' : '__H__mm'};margin:0}
*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font:${fs}px/1.35 Tahoma,"Segoe UI",Arial,sans-serif}
.sheet{width:${wrapW}mm;padding:${prof.margin}mm;page-break-after:always;break-after:page;overflow:hidden}
.sheet:last-child{page-break-after:auto;break-after:auto}
.c{text-align:center}.b{font-weight:700}.sm{font-size:.86em}
.row{display:flex;justify-content:space-between;gap:.6em;align-items:flex-start}.row .l{flex:1;min-width:0;overflow-wrap:anywhere}.row .r{white-space:nowrap;font-variant-numeric:tabular-nums}
.hr{border:0;border-top:1px solid #000;margin:.45em 0}.hr.dash{border-top-style:dashed}.hr.double{border-top:3px double #000}
.logo{display:block;margin:0 auto .3em;max-width:60%;max-height:22mm;filter:grayscale(1) contrast(1.4)}
.qr{display:flex;justify-content:center;margin:.4em 0}.qr svg{width:34mm;height:34mm}`;
}
function ticketBody(lines, rtl) {
  return lines.map(l => {
    const sz = l.size && l.size !== 1 ? `font-size:${l.size}em;` : '';
    switch (l.k) {
      case 'logo': return `<img class="logo" src="${l.src}">`;
      case 'text': return `<div class="${l.align === 'c' ? 'c ' : ''}${l.bold ? 'b ' : ''}${l.small ? 'sm' : ''}" style="${sz}${l.align === 'l' ? 'text-align:start;' : ''}">${nl(l.text)}</div>`;
      case 'row': return `<div class="row ${l.bold ? 'b' : ''}" style="${sz}"><span class="l">${esc(l.l)}</span><span class="r">${esc(l.r)}</span></div>`;
      case 'hr': return `<hr class="hr ${l.style || ''}">`;
      case 'gap': return `<div style="height:${(l.n || 0.5)}em"></div>`;
      case 'qr': return `<div class="qr">${qrSvg(l.data, { px: 120, margin: 1 })}</div>`;
      default: return '';
    }
  }).join('');
}
export function ticketHTML(lines, prof, rtl) {
  const wrapW = prof.w;
  const css = baseCSS(prof, prof.w, prof.h, wrapW);
  const sheet = `<div class="sheet">${ticketBody(lines, rtl)}</div>`;
  return { css, sheet };
}
export function invoiceHTML(m, prof, rtl) {
  const css = baseCSS(prof, prof.w, prof.h, prof.w) + `
.inv-head{display:flex;justify-content:space-between;gap:8mm;align-items:flex-start;margin-bottom:4mm}
.inv-head img{max-height:22mm;max-width:46mm;filter:grayscale(1)}
.inv-head h1{margin:0 0 1mm;font-size:1.8em}
.inv-title{font-size:1.45em;font-weight:700;text-align:end}
.box{border:1px solid #000;padding:2mm 3mm;margin-bottom:3mm}
.cols{display:flex;gap:4mm}.cols>div{flex:1}
.meta{width:100%;border-collapse:collapse}.meta td{padding:.6mm 0;vertical-align:top}.meta td:first-child{color:#333;width:38%}
table.items{width:100%;border-collapse:collapse;margin-bottom:3mm}
table.items th{text-align:start;border:1px solid #000;background:#eee;padding:1.4mm 1.2mm;font-size:.85em}
table.items td{padding:1.4mm 1.2mm;border:1px solid #888;vertical-align:top}
.n{text-align:end;font-variant-numeric:tabular-nums;white-space:nowrap}
.tot{margin-inline-start:auto;width:min(86mm,52%)}.tot .row{padding:.7mm 0}
.tot .grand{border-top:2px solid #000;margin-top:1.5mm;padding-top:1.5mm;font-size:1.3em;font-weight:700}
.taxsum{border-collapse:collapse;font-size:.85em;margin:2mm 0}.taxsum th,.taxsum td{border:1px solid #888;padding:.8mm 1.6mm}.taxsum th{background:#eee}
.foot{margin-top:6mm;text-align:center}
.inv-bottom{display:flex;justify-content:space-between;align-items:flex-start;gap:6mm}
.words{font-weight:600;margin:2mm 0}`;
  const showHsn = m.gst && m.lines.some(l => l.hsn);
  const taxRows = m.groups.filter(g => g.rate > 0);
  const sheet = `<div class="sheet">
<div class="inv-head"><div>${m.logo && prof.logo ? `<img src="${m.logo}"><br>` : ''}<h1>${esc(m.shop.name)}</h1>
<div>${esc(m.shop.address || '')}</div><div>${m.shop.phone ? 'Ph: ' + esc(m.shop.phone) : ''}</div>${m.shop.gstin ? `<div class="b">GSTIN: ${esc(m.shop.gstin)}</div>` : ''}${m.shop.fssai ? `<div>FSSAI: ${esc(m.shop.fssai)}</div>` : ''}${m.shop.state ? `<div>State: ${esc(m.shop.state)}</div>` : ''}</div>
<div class="inv-title">${esc(m.title)}</div></div>
<div class="box"><table class="meta">${m.meta.map(([a, b]) => `<tr><td>${esc(a)}</td><td class="b">${esc(b)}</td></tr>`).join('')}</table></div>
<table class="items"><thead><tr><th style="width:5%">#</th><th>${esc(m.L('Item'))}</th>${showHsn ? '<th style="width:11%">HSN/SAC</th>' : ''}<th style="width:7%" class="n">${esc(m.L('Qty'))}</th><th class="n" style="width:14%">${esc(m.L('Price'))}</th>${m.gst ? '<th class="n" style="width:8%">GST</th>' : ''}<th class="n" style="width:15%">${esc(m.L('Total'))}</th></tr></thead><tbody>
${m.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.name)}${l.mods.map(x => `<div class="sm">${esc(x)}</div>`).join('')}${l.note ? `<div class="sm">✎ ${esc(l.note)}</div>` : ''}</td>${showHsn ? `<td>${esc(l.hsn || '')}</td>` : ''}<td class="n">${l.qty}</td><td class="n">${esc(num(l.price))}</td>${m.gst ? `<td class="n">${l.gst}%</td>` : ''}<td class="n">${esc(num(l.total))}</td></tr>`).join('')}
</tbody></table>
<div class="inv-bottom"><div style="flex:1">
${taxRows.length ? `<table class="taxsum"><thead><tr><th>GST %</th><th class="n">${esc(m.L('Taxable value'))}</th>${taxRows.some(g => g.igst) ? '<th class="n">IGST</th>' : '<th class="n">CGST</th><th class="n">SGST</th>'}</tr></thead><tbody>${taxRows.map(g => `<tr><td>${g.rate}%</td><td class="n">${esc(num(g.taxable))}</td>${g.igst ? `<td class="n">${esc(num(g.igst))}</td>` : `<td class="n">${esc(num(g.cgst))}</td><td class="n">${esc(num(g.sgst))}</td>`}</tr>`).join('')}</tbody></table>` : ''}
${m.upi && prof.qr ? `<div class="qr" style="justify-content:flex-start;flex-direction:column;align-items:flex-start">${qrSvg(m.upi, { px: 130, margin: 1 })}<div class="sm b">${esc(m.L('Scan to pay by UPI'))}</div></div>` : ''}</div>
<div class="tot">${m.totals.filter(Boolean).map(([a, b]) => `<div class="row"><span class="l">${esc(a)}</span><span class="r">${esc(b)}</span></div>`).join('')}
<div class="row grand"><span class="l">${esc(m.total[0])}</span><span class="r">${esc(m.total[1])}</span></div>
${m.tip ? `<div class="row"><span class="l">${esc(m.tip[0])}</span><span class="r">${esc(m.tip[1])}</span></div><div class="row b"><span class="l">${esc(m.payable[0])}</span><span class="r">${esc(m.payable[1])}</span></div>` : ''}
${m.pays.map(([a, b]) => `<div class="row sm"><span class="l">${esc(a)}</span><span class="r">${esc(b)}</span></div>`).join('')}</div></div>
<div class="words">${esc(m.words)}</div>
${m.gst ? `<div class="sm">${m.inclusive ? 'Prices include GST. ' : ''}${esc(m.L('Subject to local jurisdiction. This is a computer generated invoice.'))}</div>` : ''}
${m.footer ? `<div class="foot">${nl(m.footer)}</div>` : ''}</div>`;
  return { css, sheet };
}
function docHTML({ css, sheet }, prof, rtl, extraH) {
  const copies = Math.max(1, Math.min(9, prof.copies | 0));
  return `<!doctype html><html dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>Print</title><style>${css}</style></head><body>${Array(copies).fill(sheet).join('')}</body></html>`;
}
function waitImages(doc) {
  return Promise.all(Array.from(doc.images).map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
}
/** Open the print dialog for prepared HTML. For roll printers the page height is measured so no paper is wasted. */
export async function printHTML(parts, prof, rtl) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;inset-inline-end:0;bottom:0;width:' + prof.w + 'mm;height:10px;border:0;opacity:0;pointer-events:none';
  document.body.append(iframe);
  const doc = iframe.contentDocument;
  doc.open(); doc.write(docHTML(parts, prof, rtl)); doc.close();
  await new Promise(r => setTimeout(r, 30));
  await waitImages(doc);
  if (!prof.h) {
    const sh = doc.querySelector('.sheet');
    const mm = Math.ceil(sh.getBoundingClientRect().height * 25.4 / 96) + 3;
    const st = doc.querySelector('style');
    st.textContent = st.textContent.replace('__H__', String(mm));
    sh.style.height = mm + 'mm';
    doc.querySelectorAll('.sheet').forEach(x => { x.style.height = mm + 'mm'; });
  }
  await new Promise(r => setTimeout(r, 60));
  iframe.contentWindow.focus();
  iframe.contentWindow.print();
  setTimeout(() => iframe.remove(), 60000);
}

// ───────── raster ESC/POS ─────────
const loadImg = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
export async function ticketCanvas(lines, prof, rtlMode) {
  const W = prof.dots;
  const base = Math.max(14, Math.round(W / 26 * (prof.font / 12) * (prof.scale / 100)));
  const FONT = (px, bold) => `${bold ? 'bold ' : ''}${Math.round(px)}px Tahoma,"Segoe UI",Arial,sans-serif`;
  const pad = Math.round(prof.margin * W / prof.w);
  const logos = {};
  for (const l of lines) if (l.k === 'logo' && !logos[l.src]) logos[l.src] = await loadImg(l.src);
  const run = (ctx, draw) => {
    let y = pad;
    const inner = W - pad * 2;
    const wrap = (text, font, maxW) => {
      ctx.font = font;
      const out = [];
      for (const para of String(text).split('\n')) {
        const words = para.split(/(\s+)/);
        let cur = '';
        for (const w of words) {
          if (ctx.measureText(cur + w).width > maxW && cur.trim()) { out.push(cur.trimEnd()); cur = w.trimStart(); } else cur += w;
          while (ctx.measureText(cur).width > maxW && cur.length > 1) { let k = cur.length - 1; while (k > 1 && ctx.measureText(cur.slice(0, k)).width > maxW) k--; out.push(cur.slice(0, k)); cur = cur.slice(k); }
        }
        out.push(cur.trimEnd());
      }
      return out;
    };
    const put = (text, x, yy, align, rtl) => { ctx.direction = rtl ? 'rtl' : 'ltr'; ctx.textAlign = align; ctx.fillText(text, x, yy); };
    for (const l of lines) {
      const px = base * (l.size || 1) * (l.small ? 0.88 : 1);
      const lh = Math.round(px * 1.32);
      if (l.k === 'text') {
        const font = FONT(px, l.bold);
        const rows = wrap(l.text, font, inner);
        for (const r of rows) {
          if (draw) {
            ctx.font = font; ctx.fillStyle = '#000'; ctx.textBaseline = 'top';
            const rtl = hasRTL(r);
            const al = l.align === 'c' ? 'center' : (l.align === 'l' ? (rtlMode || rtl ? 'right' : 'left') : 'left');
            const x = al === 'center' ? W / 2 : al === 'right' ? W - pad : pad;
            put(r, x, y, al, rtl);
          }
          y += lh;
        }
      } else if (l.k === 'row') {
        const font = FONT(px, l.bold);
        ctx.font = font;
        const rw = Math.ceil(ctx.measureText(l.r).width);
        const rows = wrap(l.l, font, Math.max(40, inner - rw - 12));
        if (draw) {
          ctx.fillStyle = '#000'; ctx.textBaseline = 'top'; ctx.font = font;
          const rtlL = rtlMode || hasRTL(l.l);
          rows.forEach((r, i) => { put(r, rtlMode ? W - pad : pad, y + i * lh, rtlMode ? 'right' : 'left', hasRTL(r)); });
          put(l.r, rtlMode ? pad : W - pad, y, rtlMode ? 'left' : 'right', false);
        }
        y += lh * Math.max(1, rows.length);
      } else if (l.k === 'hr') {
        if (draw) {
          ctx.fillStyle = '#000';
          if (l.style === 'dash') for (let x = pad; x < W - pad; x += 10) ctx.fillRect(x, y + 3, 6, 2);
          else if (l.style === 'double') { ctx.fillRect(pad, y + 2, inner, 2); ctx.fillRect(pad, y + 7, inner, 2); }
          else ctx.fillRect(pad, y + 3, inner, 2);
        }
        y += l.style === 'double' ? 14 : 10;
      } else if (l.k === 'gap') y += Math.round(base * (l.n || 0.5));
      else if (l.k === 'logo') {
        const im = logos[l.src];
        if (im) {
          const k = Math.min(1, (W * 0.6) / im.width, 150 / im.height);
          const w = Math.round(im.width * k), hh = Math.round(im.height * k);
          if (draw) ctx.drawImage(im, Math.round((W - w) / 2), y, w, hh);
          y += hh + 8;
        }
      } else if (l.k === 'qr') {
        const side = Math.min(Math.round(W * 0.6), 280);
        if (draw) qrDraw(ctx, l.data, Math.round((W - side) / 2), y, side, { margin: 1 });
        y += side + 8;
      }
    }
    return y + pad;
  };
  const c0 = document.createElement('canvas'); c0.width = W; c0.height = 10;
  const H = Math.ceil(run(c0.getContext('2d'), false));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  run(ctx, true);
  return c;
}
export function escposBytes(canvas, prof) {
  const w = canvas.width, hgt = canvas.height, wb = Math.ceil(w / 8);
  const px = canvas.getContext('2d').getImageData(0, 0, w, hgt).data;
  const out = [0x1b, 0x40];
  for (let y0 = 0; y0 < hgt; y0 += 240) {
    const hh = Math.min(240, hgt - y0);
    out.push(0x1d, 0x76, 0x30, 0x00, wb & 255, wb >> 8, hh & 255, hh >> 8);
    for (let y = y0; y < y0 + hh; y++) {
      for (let bx = 0; bx < wb; bx++) {
        let byte = 0;
        for (let b = 0; b < 8; b++) {
          const x = bx * 8 + b;
          let on = 0;
          if (x < w) { const i = (y * w + x) * 4; const lum = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114; on = lum < 165 ? 1 : 0; }
          byte |= on << (7 - b);
        }
        out.push(byte);
      }
    }
  }
  out.push(0x1b, 0x64, 4);
  if (prof.cut) out.push(0x1d, 0x56, 0x42, 0x00);
  if (prof.drawer) out.push(0x1b, 0x70, 0x00, 0x3c, 0x78);
  return Uint8Array.from(out);
}
function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
export async function sendNetwork(bytes, host, port) {
  if (store.kind !== 'local') throw new Error('Network printing needs the local RestoPOS server (it relays to the printer). Use "Browser" printing in cloud mode.');
  if (!host) throw new Error('No printer IP address set. Open Admin → Printing.');
  await fetchJSON('api/print', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host, port, b64: b64(bytes) }) }, 15000);
}

// ───────── public actions ─────────
async function output(lines, prof, { station, invoiceModel } = {}) {
  const lang = prof.lang;
  const rtl = isRtlLang(lang);
  if (prof.method === 'none') return;
  if (prof.method === 'network') {
    const c = await ticketCanvas(lines, prof, rtl);
    const host = (prof.hosts && station && prof.hosts[station]) || prof.host;
    const bytes = escposBytes(c, prof);
    for (let i = 0; i < Math.max(1, prof.copies | 0); i++) await sendNetwork(bytes, host, prof.port || 9100);
    return;
  }
  const wide = invoiceModel && (prof.layout === 'invoice' || (prof.layout === 'auto' && prof.w >= 120));
  const parts = wide ? invoiceHTML(invoiceModel, prof, rtl) : ticketHTML(lines, prof, rtl);
  if (!wide && !prof.thermal && prof.w > 100) {
    // ticket printed on a sheet: keep it ticket-width at the top of the page
    parts.css += `.sheet{width:${Math.min(prof.w, 80)}mm}`;
  }
  await printHTML(parts, prof, rtl);
}
export async function printReceipt(order, opts = {}) {
  const prof = profile('receipt');
  const m = receiptModel(order, prof.lang, opts);
  return output(receiptTicket(m, prof), prof, { invoiceModel: m });
}
export async function printKOT(order, lines, station) {
  const prof = profile('kot');
  return output(kotTicket(order, lines, { station, lang: prof.lang }), prof, { station });
}
export async function printRows(title, rows) {
  const prof = profile('receipt');
  return output(reportTicket(title, rows, prof.lang), prof);
}
export async function printTest(kind) {
  const prof = profile(kind);
  const s = settings();
  const lines = [
    { k: 'text', text: s.name, bold: true, size: 1.6, align: 'c' }, { k: 'text', text: kind === 'kot' ? 'KITCHEN PRINTER TEST' : 'RECEIPT PRINTER TEST', bold: true, align: 'c' },
    { k: 'hr' }, { k: 'row', l: 'Paper', r: prof.w + (prof.h ? ' × ' + prof.h : '') + ' mm' }, { k: 'row', l: 'Method', r: prof.method }, { k: 'row', l: 'Font', r: prof.font + ' · ' + prof.scale + '%' },
    { k: 'hr', style: 'dash' }, { k: 'row', l: '2 × Paneer tikka', r: money(560) }, { k: 'row', l: 'हिन्दी: पनीर टिक्का', r: money(280) }, { k: 'row', l: 'اردو: پنیر ٹکا', r: money(280) },
    { k: 'hr', style: 'double' }, { k: 'text', text: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789 ₹', align: 'c' }, { k: 'text', text: 'If you can read this, printing works ✓', align: 'c', bold: true }, { k: 'qr', data: 'RestoPOS test' }
  ];
  const L = k => k;
  const m = { logo: s.logo, gst: false, shop: { name: s.name, address: s.address, phone: s.phone, gstin: '', fssai: '', state: '' }, L, title: 'Test page', meta: [['Printer', kind]], lines: [{ qty: 2, name: 'Paneer tikka', mods: [], note: '', price: 280, total: 560, hsn: '', gst: 0 }], totals: [['Items total', money(560)]], total: ['TOTAL', money(560)], pays: [], groups: [], words: amountInWords(560), footer: 'Printer test page', upi: null };
  return output(lines, prof, { invoiceModel: m });
}

/** Kitchen auto-print: run on the one device that has a kitchen printer connected. */
let autoStop = null;
export function startAutoKot() {
  if (autoStop) return;
  const t0 = now() - 10 * 60000;
  const busy = new Set();
  const check = async () => {
    const prof = profile('kot');
    if (!prof.auto || prof.method === 'none') return;
    const fresh = store.all('order_items').filter(i => i.status === 'new' && !i.kot_printed && i.sent_at >= t0 && !busy.has(i.id));
    if (!fresh.length) return;
    const groups = new Map();
    for (const i of fresh) { const k = i.order_id + '|' + i.round + '|' + i.station; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
    for (const [k, lines] of groups) {
      const order = store.get('orders', lines[0].order_id);
      if (!order) continue;
      lines.forEach(l => { busy.add(l.id); store.patch('order_items', l.id, { kot_printed: now(), kot_by: deviceId }); });
      try { await printKOT(order, lines, lines[0].station); } catch (e) { console.warn('KOT print failed', e); window.dispatchEvent(new CustomEvent('print-error', { detail: e })); }
    }
  };
  autoStop = store.on(t => { if (t === 'change') check(); });
  check();
}
