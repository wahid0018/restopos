// Inventory: stock levels, purchases (with supplier + invoice no.), wastage, counts, movements, suppliers.
import { h, empty, money, num, uid, parseNum, fmtDate, fmtTime, download, toCSV, now } from '../util.js';
import { store } from '../store.js';
import { t } from '../i18n.js';
import { modal, toast, confirmDlg, field, numberDlg, promptDlg } from '../ui.js';
import * as L from '../logic.js';
import { tabs, dataTable, kpis, csvBtn } from './kit.js';

export function mount(el) {
  let tab = 'stock', q = '';
  const page = h('div', { class: 'page' }); const body = h('div');
  el.append(page);
  page.append(tabs([{ id: 'stock', label: t('Stock') }, { id: 'moves', label: t('Movements') }, { id: 'sup', label: t('Suppliers') }], tab, id => { tab = id; draw(); }), body);
  const user = L.session.user;
  const qty = v => num(v).replace(/\.00$/, '');

  function draw() {
    empty(body);
    if (tab === 'moves') return drawMoves();
    if (tab === 'sup') return drawSup();
    const lv = L.stockLevels();
    const items = L.stockItems();
    const low = items.filter(s => L.stockStatus(s) !== 'ok');
    const value = items.reduce((a, s) => a + Math.max(0, lv.get(s.id) || 0) * (s.cost || 0), 0);
    body.append(kpis([[t('Items'), items.length], [t('Low / out'), low.length], [t('Stock value'), money(value)]]));
    body.append(h('div', { class: 'toolbar' }, h('input', { type: 'search', placeholder: t('Search stock…'), onInput: e => { q = e.target.value.toLowerCase(); drawTable(); } }), h('span', { class: 'spacer' }),
      csvBtn('CSV', 'stock.csv', items.map(s => ({ name: s.name, unit: s.unit, qty: lv.get(s.id) || 0, min: s.min || 0, cost: s.cost || 0 })), [{ label: 'name', key: 'name' }, { label: 'unit', key: 'unit' }, { label: 'qty', key: 'qty' }, { label: 'min', key: 'min' }, { label: 'cost', key: 'cost' }]),
      h('button', { class: 'btn primary', onClick: () => editStock() }, '+ ', t('Add stock item'))));
    body.append(h('div', { id: 'stbl' })); drawTable();
  }
  function drawTable() {
    const box = body.querySelector('#stbl'); if (!box) return; empty(box);
    const lv = L.stockLevels();
    let list = L.stockItems(); if (q) list = list.filter(s => s.name.toLowerCase().includes(q));
    box.append(dataTable([
      { label: t('Item'), get: s => h('b', null, s.name) },
      { label: t('In stock'), cls: 'r', get: s => qty(lv.get(s.id) || 0) + ' ' + s.unit },
      { label: t('Status'), get: s => { const k = L.stockStatus(s); return h('span', { class: 'badge ' + (k === 'ok' ? 'ok' : k === 'low' ? 'warn' : 'bad') }, t(k === 'ok' ? 'OK' : k === 'low' ? 'Low' : 'Out')); } },
      { label: t('Alert at'), cls: 'r', get: s => s.min ? qty(s.min) : '—' }, { label: t('Cost / unit'), cls: 'r', get: s => s.cost ? money(s.cost) : '—' },
      { label: '', get: s => h('div', { class: 'row wrap' }, h('button', { class: 'btn sm ok', onClick: () => purchase(s) }, '+ ', t('Purchase')), h('button', { class: 'btn sm', onClick: () => adjust(s, 'wastage') }, t('Wastage')), h('button', { class: 'btn sm', onClick: () => adjust(s, 'count') }, t('Count')), h('button', { class: 'btn sm ghost', onClick: () => editStock(s) }, '✎')) }
    ], list, { empty: t('No stock items yet') }));
  }
  function editStock(s) {
    const o = s || {};
    const name = h('input', { type: 'text', value: o.name || '' }), unit = h('input', { type: 'text', value: o.unit || 'kg', list: 'units' }), min = h('input', { type: 'text', value: o.min ?? '', inputmode: 'decimal', 'data-kb': 'num' }), cost = h('input', { type: 'text', value: o.cost ?? '', inputmode: 'decimal', 'data-kb': 'num' });
    const opening = h('input', { type: 'text', value: '', inputmode: 'decimal', 'data-kb': 'num' });
    modal({ title: s ? t('Edit stock item') : t('Add stock item'), size: 'sm', body: h('div', null, field(t('Name'), name), h('div', { class: 'grid2' }, field(t('Unit'), unit), field(t('Alert when below'), min)), field(t('Cost per unit'), cost), s ? null : field(t('Opening quantity'), opening), h('datalist', { id: 'units' }, ['kg', 'g', 'L', 'ml', 'pcs', 'pkt', 'dozen'].map(u => h('option', { value: u })))),
      actions: [s ? { label: t('Delete'), kind: 'danger', onClick: async c => { if (await confirmDlg(t('Delete {name}?', { name: s.name }), { danger: true, ok: t('Delete') })) { store.patch('stock', s.id, { active: false }); c(); draw(); } return false; } } : { label: t('Cancel'), kind: 'ghost' },
        { label: t('Save'), kind: 'primary', onClick: c => {
          if (!name.value.trim()) { toast(t('Enter a name'), 'warn'); return false; }
          const rec = store.put('stock', { id: s ? s.id : uid(), name: name.value.trim(), unit: unit.value.trim() || 'pcs', min: parseNum(min.value), cost: parseNum(cost.value), active: true });
          if (!s && parseNum(opening.value) > 0) L.addStockMove({ stock_id: rec.id, qty: parseNum(opening.value), type: 'opening', note: 'Opening stock', userId: user.id });
          c(); draw();
        } }] });
  }
  function purchase(s) {
    const qy = h('input', { type: 'text', inputmode: 'decimal', 'data-kb': 'num', placeholder: s.unit }), cost = h('input', { type: 'text', inputmode: 'decimal', 'data-kb': 'num', value: s.cost || '' }), inv = h('input', { type: 'text', placeholder: t('Supplier invoice no.') });
    const sup = h('select', null, h('option', { value: '' }, '—'), store.all('suppliers').map(x => h('option', { value: x.id }, x.name)));
    modal({ title: t('Purchase') + ' — ' + s.name, size: 'sm', body: h('div', null, h('div', { class: 'grid2' }, field(t('Quantity') + ' (' + s.unit + ')', qy), field(t('Cost per {unit}', { unit: s.unit }), cost)), field(t('Supplier'), sup), field(t('Invoice no.'), inv)),
      actions: [{ label: t('Cancel'), kind: 'ghost' }, { label: t('Add to stock'), kind: 'primary', onClick: c => {
        const n = parseNum(qy.value); if (!(n > 0)) { toast(t('Enter a quantity'), 'warn'); return false; }
        L.addStockMove({ stock_id: s.id, qty: n, type: 'purchase', cost: parseNum(cost.value), supplier_id: sup.value || null, invoice_no: inv.value.trim(), userId: user.id });
        if (L.feature('expenses') && parseNum(cost.value) > 0 && sup.value) { /* purchases are tracked here; add an expense separately if paid in cash */ }
        toast(t('Stock updated'), 'ok'); c(); draw();
      } }] });
  }
  async function adjust(s, type) {
    const cur = L.stockLevels().get(s.id) || 0;
    const v = await numberDlg({ title: (type === 'count' ? t('Counted quantity') : t('Wastage quantity')) + ' — ' + s.name, value: '', hint: type === 'count' ? t('System shows {n} {u}', { n: qty(cur), u: s.unit }) : t('How much was thrown away or spoiled?') });
    if (v === null) return;
    let note = '';
    if (type === 'wastage') { note = await promptDlg({ title: t('Reason'), label: t('Reason'), placeholder: t('spoiled, spilled, staff meal…') }); if (note === null) return; }
    if (type === 'count') L.addStockMove({ stock_id: s.id, qty: v - cur, type: 'count', note: 'Stock count', userId: user.id });
    else L.addStockMove({ stock_id: s.id, qty: -Math.abs(v), type: 'wastage', note, userId: user.id });
    toast(t('Stock updated'), 'ok'); draw();
  }
  function drawMoves() {
    const list = store.all('stock_moves').sort((a, b) => b.at - a.at).slice(0, 400);
    const label = { sale: 'Sale', purchase: 'Purchase', wastage: 'Wastage', count: 'Count', opening: 'Opening', void_return: 'Returned' };
    body.append(dataTable([
      { label: t('When'), get: m => fmtDate(m.at) + ' ' + fmtTime(m.at) }, { label: t('Item'), get: m => (store.get('stock', m.stock_id) || {}).name || '?' },
      { label: t('Type'), get: m => t(label[m.type] || m.type) }, { label: t('Qty'), cls: 'r', get: m => (m.qty > 0 ? '+' : '') + qty(m.qty) },
      { label: t('Supplier'), get: m => (store.get('suppliers', m.supplier_id) || {}).name || '' }, { label: t('Invoice no.'), get: m => m.invoice_no || '' }, { label: t('Note'), get: m => m.note || '' }, { label: t('By'), get: m => L.userName(m.by) }
    ], list, { empty: t('No movements yet') }));
  }
  function drawSup() {
    body.append(h('div', { class: 'toolbar' }, h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onClick: () => editSup() }, '+ ', t('Add supplier'))));
    body.append(dataTable([{ label: t('Name'), get: s => h('b', null, s.name) }, { label: t('Phone'), get: s => s.phone || '' }, { label: 'GSTIN', get: s => s.gstin || '' }, { label: '', get: s => h('button', { class: 'btn sm', onClick: () => editSup(s) }, t('Edit')) }], store.all('suppliers'), { empty: t('No suppliers yet') }));
  }
  function editSup(s) {
    const o = s || {}; const n = h('input', { type: 'text', value: o.name || '' }), p = h('input', { type: 'tel', value: o.phone || '', 'data-kb': 'num' }), g = h('input', { type: 'text', value: o.gstin || '', maxlength: 15 });
    modal({ title: t('Supplier'), size: 'sm', body: h('div', null, field(t('Name'), n), field(t('Phone'), p), field('GSTIN', g)), actions: [{ label: t('Cancel'), kind: 'ghost' }, { label: t('Save'), kind: 'primary', onClick: c => { if (!n.value.trim()) return false; store.put('suppliers', { id: s ? s.id : uid(), name: n.value.trim(), phone: p.value.trim(), gstin: g.value.trim().toUpperCase() }); c(); draw(); } }] });
  }
  draw();
  return { update() { if (tab === 'stock') drawTable(); } };
}
