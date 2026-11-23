// Menu manager: dishes (EN/हिन्दी/اردو names, GST + HSN, veg mark, photo, modifiers, recipe) and categories.
import { h, empty, money, uid, parseNum, resizeImage, readFileText, download, toCSV, debounce } from '../util.js';
import { store } from '../store.js';
import { t, nameOf, autoTranslate } from '../i18n.js';
import { modal, toast, confirmDlg, field, switchEl } from '../ui.js';
import * as L from '../logic.js';
import { GST_RATES } from '../gst.js';
import { tabs, dataTable } from './kit.js';
import { vegDot } from './shared.js';
import { KINDS, openAR } from '../ar.js';

const tri = (o, base, label, opts = {}) => {
  const mk = (suffix, ph, dir) => h(opts.area ? 'textarea' : 'input', { type: 'text', rows: 2, value: o[base + suffix] || '', placeholder: ph, dir: dir || null, lang: suffix === '_hi' ? 'hi' : suffix === '_ur' ? 'ur' : 'en' });
  const en = mk('', 'English'), hi = mk('_hi', 'हिन्दी'), ur = mk('_ur', 'اردو', 'rtl');
  // fills Hindi + Urdu from the English text (dictionary → online translation). Existing entries are kept unless forced.
  const auto = async force => {
    const src = en.value.trim(); if (!src) return;
    for (const [el, to] of [[hi, 'hi'], [ur, 'ur']]) if (force || !el.value.trim()) { const ph = el.placeholder; el.placeholder = '…'; try { el.value = await autoTranslate(src, to); } finally { el.placeholder = ph; } }
  };
  if (!opts.area) en.addEventListener('blur', () => auto(false));
  const wrap = h('div', { class: 'field' }, h('div', { class: 'row sp' }, h('span', null, label), L.feature('multilang') ? h('button', { type: 'button', class: 'btn sm ghost', title: t('Fill Hindi and Urdu from English'), onClick: () => auto(true) }, '✨ ' + t('Auto-translate')) : null), h('div', { class: 'tri' }, en, hi, ur));
  wrap.vals = () => ({ [base]: en.value.trim(), [base + '_hi']: hi.value.trim(), [base + '_ur']: ur.value.trim() });
  wrap.en = en; wrap.auto = auto;
  return wrap;
};
export { tri };

export function mount(el) {
  let tab = 'dishes', q = '', catF = 'all';
  const page = h('div', { class: 'page' }); const body = h('div');
  el.append(page);
  page.append(tabs([{ id: 'dishes', label: t('Dishes') }, { id: 'cats', label: t('Categories') }], tab, id => { tab = id; draw(); }), body);
  const st = L.settings();

  function draw() {
    empty(body);
    if (tab === 'cats') return drawCats();
    const cats = L.categories();
    const tools = h('div', { class: 'toolbar' },
      h('input', { type: 'search', placeholder: t('Search dishes…'), value: q, onInput: debounce(e => { q = e.target.value.toLowerCase(); drawList(); }, 120) }),
      h('select', { style: { width: 'auto' }, onChange: e => { catF = e.target.value; drawList(); } }, h('option', { value: 'all' }, t('All categories')), cats.map(c => h('option', { value: c.id, selected: catF === c.id }, c.name))),
      h('span', { class: 'spacer' }),
      L.feature('multilang') ? h('button', { class: 'btn sm', onClick: translateMissing }, '✨ ' + t('Translate missing')) : null,
      h('button', { class: 'btn sm', onClick: exportCsv }, '⬇ CSV'), h('label', { class: 'btn sm' }, '⬆ ', t('Import CSV'), h('input', { type: 'file', accept: '.csv,text/csv', hidden: true, onChange: importCsv })),
      h('button', { class: 'btn primary', onClick: () => editItem() }, '+ ', t('Add dish')));
    body.append(tools, h('div', { id: 'dlist' }));
    drawList();
  }
  function drawList() {
    const box = body.querySelector('#dlist'); if (!box) return; empty(box);
    let list = store.all('items').filter(i => i.active !== false).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if (catF !== 'all') list = list.filter(i => i.category_id === catF);
    if (q) list = list.filter(i => [i.name, i.name_hi, i.name_ur].some(x => x && x.toLowerCase().includes(q)));
    box.append(dataTable([
      { label: '', get: i => i.img ? h('img', { src: i.img, style: { width: '42px', height: '42px', objectFit: 'cover', borderRadius: '8px' } }) : '' },
      { label: t('Dish'), get: i => h('div', null, h('b', null, vegDot(i.veg), ' ', i.name), h('div', { class: 'muted' }, [i.name_hi, i.name_ur].filter(Boolean).join(' · '))) },
      { label: t('Category'), get: i => (store.get('categories', i.category_id) || {}).name || '—' },
      { label: t('Price'), cls: 'r', get: i => i.price, fmt: v => money(v) },
      { label: 'GST', cls: 'r', get: i => L.itemGst(i) + '%' }, { label: 'HSN', get: i => i.hsn || '' },
      { label: t('Available'), get: i => switchEl(i.available !== false, v => store.patch('items', i.id, { available: v })) },
      { label: '', get: i => h('div', { class: 'row' }, h('button', { class: 'btn sm', onClick: () => editItem(i) }, t('Edit')), h('button', { class: 'btn sm ghost', onClick: async () => { if (await confirmDlg(t('Delete {name}?', { name: i.name }), { danger: true, ok: t('Delete') })) store.patch('items', i.id, { active: false }); drawList(); } }, '🗑')) }
    ], list, { empty: t('No dishes yet. Add one or import a CSV.') }));
  }

  async function translateMissing() {
    const jobs = [];
    for (const rec of [...store.all('items'), ...store.all('categories')]) for (const f of ['name', 'desc']) if (rec[f] && (!rec[f + '_hi'] || !rec[f + '_ur'])) jobs.push([rec, f]);
    if (!jobs.length) return toast(t('Everything is already translated'), 'ok');
    toast(t('Translating {n} entries…', { n: jobs.length }), '', 4000);
    let n = 0;
    for (const [rec, f] of jobs) {
      const p = {};
      if (!rec[f + '_hi']) p[f + '_hi'] = await autoTranslate(rec[f], 'hi');
      if (!rec[f + '_ur']) p[f + '_ur'] = await autoTranslate(rec[f], 'ur');
      store.patch(rec._c, rec.id, p); n++;
    }
    toast(t('Translated {n} entries — please review', { n }), 'ok', 5000);
  }
  function editItem(item) {
    const o = item ? JSON.parse(JSON.stringify(item)) : { veg: 'veg', gst: '', modifiers: [], recipe: [], available: true };
    const cats = L.categories();
    if (!cats.length) { toast(t('Add a category first'), 'warn'); tab = 'cats'; return draw(); }
    const names = tri(o, 'name', t('Name'));
    const descs = tri(o, 'desc', t('Description (optional)'), { area: true });
    const cat = h('select', null, cats.map(c => h('option', { value: c.id, selected: o.category_id === c.id }, c.name)));
    const price = h('input', { type: 'text', value: o.price ?? '', inputmode: 'decimal', 'data-kb': 'num' });
    const veg = h('select', null, [['veg', t('Veg')], ['nonveg', t('Non-veg')], ['egg', t('Egg')], ['', t('Not marked')]].map(([v, l]) => h('option', { value: v, selected: (o.veg || '') === v }, l)));
    const gst = h('select', null, h('option', { value: '' }, t('Default') + ' (' + st.default_gst + '%)'), GST_RATES.map(r => h('option', { value: r, selected: o.gst !== '' && o.gst != null && Number(o.gst) === r }, r + '%')));
    const hsn = h('input', { type: 'text', value: o.hsn || '', placeholder: st.default_hsn });
    const station = h('select', null, h('option', { value: '' }, t('Same as category')), st.stations.map(s => h('option', { value: s.id, selected: o.station === s.id }, s.name)));
    const prep = h('input', { type: 'number', min: 0, value: o.prep_min || '', 'data-kb': 'num', placeholder: '15' });
    const spice = h('select', null, [[0, '—'], [1, t('Mild')], [2, t('Medium')], [3, t('Hot')]].map(([v, l]) => h('option', { value: v, selected: Number(o.spice || 0) === v }, l)));
    const serves = h('input', { type: 'text', value: o.serves || '', placeholder: '1' });
    const kcal = h('input', { type: 'number', min: 0, value: o.kcal || '', 'data-kb': 'num', placeholder: '350' });
    const allergens = h('input', { type: 'text', value: o.allergens || '', placeholder: t('e.g. nuts, dairy, gluten') });
    const KL = { bowl: 'Curry bowl', thali: 'Thali', bread: 'Bread', burger: 'Burger', glass: 'Drink glass', pizza: 'Pizza', skewer: 'Kebab / tikka', rice: 'Biryani / rice', dessert: 'Dessert', noodles: 'Noodles', soup: 'Soup', generic: 'Covered dish' };
    const m3 = h('select', null, h('option', { value: '' }, t('Automatic (from the dish name)')), KINDS.map(k => h('option', { value: k, selected: o.model3d === k }, t(KL[k]))));
    const glbIn = h('input', { type: 'file', accept: '.glb,model/gltf-binary', hidden: true, onChange: async e => { const f = e.target.files[0]; if (!f) return; if (f.size > 6e6) return toast(t('Model file is too large (max 6 MB)'), 'warn'); o.glb = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); }); glbMsg.textContent = '✓ ' + f.name; } });
    const glbMsg = h('span', { class: 'muted' }, o.glb ? '✓ ' + t('Custom 3D model attached') : '');
    const comm = h('input', { type: 'text', value: o.comm_pct ?? '', inputmode: 'decimal', 'data-kb': 'num', placeholder: '—' });
    const imgBox = h('div', { class: 'imgbox' }, o.img ? h('img', { src: o.img }) : t('No photo'));
    const onPick = async e => { const f = e.target.files[0]; if (!f) return; try { o.img = await resizeImage(f); empty(imgBox); imgBox.append(h('img', { src: o.img })); } catch (err) { toast(err.message, 'bad'); } };
    const cam = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onChange: onPick });
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onChange: async e => { const f = e.target.files[0]; if (!f) return; try { o.img = await resizeImage(f); empty(imgBox); imgBox.append(h('img', { src: o.img })); } catch (err) { toast(err.message, 'bad'); } } });
    // modifiers
    const modsBox = h('div');
    const drawMods = () => {
      empty(modsBox);
      o.modifiers.forEach((g, gi) => {
        const gt = tri(g, 'name', t('Group name'));
        g._t = gt;
        const opts = h('div');
        const drawOpts = () => {
          empty(opts);
          g.options.forEach((op, oi) => {
            const ot = tri(op, 'name', t('Option')); op._t = ot;
            const pr = h('input', { type: 'text', value: op.price ?? 0, inputmode: 'decimal', 'data-kb': 'num', style: { width: '90px' }, onInput: e => { op.price = parseNum(e.target.value); } });
            opts.append(h('div', { class: 'row', style: { alignItems: 'flex-end' } }, h('div', { style: { flex: 1 } }, ot), field(t('Extra price'), pr), h('button', { class: 'icon-btn', onClick: () => { g.options.splice(oi, 1); drawOpts(); } }, '✕')));
          });
          opts.append(h('button', { class: 'btn sm', onClick: () => { g.options.push({ name: '', price: 0 }); drawOpts(); } }, '+ ', t('Add option')));
        };
        drawOpts();
        modsBox.append(h('div', { class: 'mod-edit' }, gt, h('div', { class: 'row wrap' }, switchEl(g.required, v => { g.required = v; }, t('Required')), switchEl(g.multi, v => { g.multi = v; }, t('Allow several')), h('span', { class: 'spacer' }), h('button', { class: 'btn sm ghost', onClick: () => { o.modifiers.splice(gi, 1); drawMods(); } }, t('Remove group'))), opts));
      });
      modsBox.append(h('button', { class: 'btn sm', onClick: () => { o.modifiers.push({ name: '', required: false, multi: false, options: [{ name: '', price: 0 }] }); drawMods(); } }, '+ ', t('Add choice group (size, spice, extras…)')));
    };
    drawMods();
    // recipe
    const recBox = h('div');
    const drawRec = () => {
      empty(recBox);
      (o.recipe || []).forEach((r, i) => {
        const s = h('select', { onChange: e => { r.stock_id = e.target.value; drawRec(); } }, h('option', { value: '' }, '—'), L.stockItems().map(x => h('option', { value: x.id, selected: r.stock_id === x.id }, x.name + ' (' + x.unit + ')')));
        const qty = h('input', { type: 'text', value: r.qty ?? '', inputmode: 'decimal', 'data-kb': 'num', style: { width: '100px' }, onInput: e => { r.qty = parseNum(e.target.value); } });
        recBox.append(h('div', { class: 'row', style: { marginBottom: '.4rem' } }, s, qty, h('span', { class: 'muted' }, (L.stockItems().find(x => x.id === r.stock_id) || {}).unit || ''), h('button', { class: 'icon-btn', onClick: () => { o.recipe.splice(i, 1); drawRec(); } }, '✕')));
      });
      recBox.append(h('button', { class: 'btn sm', onClick: () => { o.recipe = o.recipe || []; o.recipe.push({ stock_id: '', qty: 0 }); drawRec(); } }, '+ ', t('Add ingredient')));
    };
    drawRec();
    const bodyEl = h('div', null, names,
      h('div', { class: 'grid2' }, field(t('Category'), cat), field(t('Price'), price), field(t('Food type'), veg), field('GST %', gst), field('HSN / SAC', hsn), field(t('Kitchen station'), station)),
      L.feature('commission') ? field(t('Commission % for waiter (blank = staff default)'), comm) : null,
      descs,
      h('div', { class: 'grid2' }, field(t('Preparation time (minutes)'), prep), field(t('Spice level'), spice), field(t('Serves'), serves), field(t('Calories (kcal)'), kcal)), field(t('Allergens'), allergens),
      L.feature('ar3d') ? h('div', { class: 'card', style: { margin: '.6rem 0' } }, h('b', null, '🧊 ', t('3D / AR view')), h('div', { class: 'grid2', style: { marginTop: '.4rem' } }, field(t('Demo 3D model'), m3), h('div', { class: 'stack' }, h('label', { class: 'btn sm' }, t('Upload your own .glb model'), glbIn), glbMsg, o.glb ? h('button', { class: 'btn sm ghost', onClick: () => { o.glb = ''; glbMsg.textContent = ''; } }, t('Remove')) : null)), h('button', { class: 'btn sm', onClick: () => openAR(Object.assign({}, o, { name: names.vals().name || o.name || '', price: parseNum(price.value) || 0, model3d: m3.value })) }, '▶ ', t('Preview'))) : null,
      h('div', { class: 'row', style: { marginBottom: '1rem' } }, imgBox, h('div', { class: 'stack' }, h('label', { class: 'btn sm' }, t('Choose photo'), file), h('label', { class: 'btn sm' }, '📷 ' + t('Take photo'), cam), o.img ? h('button', { class: 'btn sm ghost', onClick: () => { o.img = ''; empty(imgBox); imgBox.append(t('No photo')); } }, t('Remove photo')) : null)),
      h('h4', { style: { margin: '.4rem 0' } }, t('Choices')), modsBox,
      L.feature('inventory') ? [h('h4', { style: { margin: '1rem 0 .4rem' } }, t('Recipe (stock used per portion)')), recBox] : null);
    modal({
      title: item ? t('Edit dish') : t('Add dish'), size: 'lg', body: bodyEl, actions: [{ label: t('Cancel'), kind: 'ghost' }, { label: t('Save'), kind: 'primary', onClick: c => {
        const nm = names.vals();
        if (!nm.name) { toast(t('Enter the dish name'), 'warn'); return false; }
        const p = parseNum(price.value); if (!(p >= 0)) { toast(t('Enter a valid price'), 'warn'); return false; }
        const mods = o.modifiers.map(g => ({ ...g._t.vals(), required: !!g.required, multi: !!g.multi, options: g.options.map(op => ({ ...op._t.vals(), price: Number(op.price) || 0 })).filter(op => op.name) })).filter(g => g.name && g.options.length);
        store.put('items', { id: item ? item.id : uid(), ...nm, ...descs.vals(), category_id: cat.value, price: p, veg: veg.value, gst: gst.value === '' ? '' : Number(gst.value), hsn: hsn.value.trim(), station: station.value, comm_pct: comm.value.trim() === '' ? '' : parseNum(comm.value),
          img: o.img || '', model3d: m3.value, glb: o.glb || '', prep_min: Number(prep.value) || 0, spice: Number(spice.value) || 0, serves: serves.value.trim(), kcal: Number(kcal.value) || 0, allergens: allergens.value.trim(), modifiers: mods, recipe: (o.recipe || []).filter(r => r.stock_id && r.qty > 0), active: true, available: o.available !== false });
        toast(t('Saved'), 'ok'); c(); drawList();
      } }]
    });
  }

  function drawCats() {
    const cats = L.categories();
    body.append(h('div', { class: 'toolbar' }, h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onClick: () => editCat() }, '+ ', t('Add category'))));
    body.append(dataTable([
      { label: t('Name'), get: c => h('div', null, h('b', null, c.name), h('div', { class: 'muted' }, [c.name_hi, c.name_ur].filter(Boolean).join(' · '))) },
      { label: t('Kitchen station'), get: c => (st.stations.find(s => s.id === c.station) || {}).name || '' },
      { label: t('Dishes'), cls: 'r', get: c => (L.itemsByCategory().get(c.id) || []).length },
      { label: t('Order'), get: c => h('div', { class: 'row' }, h('button', { class: 'btn sm ghost', onClick: () => move(c, -1) }, '↑'), h('button', { class: 'btn sm ghost', onClick: () => move(c, 1) }, '↓')) },
      { label: '', get: c => h('div', { class: 'row' }, h('button', { class: 'btn sm', onClick: () => editCat(c) }, t('Edit')), h('button', { class: 'btn sm ghost', onClick: async () => { if ((L.itemsByCategory().get(c.id) || []).length) return toast(t('Move or delete the dishes first'), 'warn'); if (await confirmDlg(t('Delete {name}?', { name: c.name }), { danger: true, ok: t('Delete') })) { store.patch('categories', c.id, { active: false }); draw(); } } }, '🗑')) }
    ], cats, { empty: t('No categories yet') }));
  }
  function move(c, d) {
    const cats = L.categories(); const i = cats.findIndex(x => x.id === c.id); const j = i + d;
    if (j < 0 || j >= cats.length) return;
    cats.forEach((x, k) => store.patch('categories', x.id, { sort: k }));
    store.patch('categories', cats[i].id, { sort: j }); store.patch('categories', cats[j].id, { sort: i }); draw();
  }
  function editCat(c) {
    const o = c || {};
    const nm = tri(o, 'name', t('Name'));
    const stn = h('select', null, st.stations.map(s => h('option', { value: s.id, selected: o.station === s.id }, s.name)));
    modal({ title: c ? t('Edit category') : t('Add category'), size: 'md', body: h('div', null, nm, field(t('Kitchen station'), stn)), actions: [{ label: t('Cancel'), kind: 'ghost' }, { label: t('Save'), kind: 'primary', onClick: close => {
      const v = nm.vals(); if (!v.name) { toast(t('Enter a name'), 'warn'); return false; }
      store.put('categories', { id: c ? c.id : uid(), ...v, station: stn.value, active: true, sort: c ? c.sort : L.categories().length });
      close(); draw();
    } }] });
  }

  // ───── CSV import / export ─────
  const COLS = ['name', 'name_hi', 'name_ur', 'category', 'price', 'gst', 'hsn', 'veg', 'description'];
  function exportCsv() {
    const rows = L.menuItems().map(i => ({ ...i, category: (store.get('categories', i.category_id) || {}).name || '', description: i.desc || '', gst: L.itemGst(i) }));
    download('menu.csv', toCSV(rows, COLS.map(c => ({ label: c, key: c }))), 'text/csv');
  }
  function parseCSV(text) {
    const rows = []; let row = [], cur = '', q = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { row.push(cur); cur = ''; } else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else if (ch !== '\r') cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim()));
  }
  async function importCsv(e) {
    const f = e.target.files[0]; if (!f) return;
    const rows = parseCSV(await readFileText(f));
    const head = rows.shift().map(x => x.trim().toLowerCase());
    const ix = k => head.indexOf(k);
    if (ix('name') < 0 || ix('price') < 0) return toast(t('CSV needs at least the columns: name, price (and ideally category)'), 'bad', 6000);
    let added = 0, updated = 0;
    const cats = new Map(L.categories().map(c => [c.name.toLowerCase(), c]));
    for (const r of rows) {
      const g = k => (ix(k) >= 0 ? (r[ix(k)] || '').trim() : '');
      if (!g('name')) continue;
      let cname = g('category') || 'Menu'; let c = cats.get(cname.toLowerCase());
      if (!c) { c = store.put('categories', { id: uid(), name: cname, station: 'kitchen', active: true, sort: cats.size }); cats.set(cname.toLowerCase(), c); }
      const ex = store.all('items').find(i => i.active !== false && i.name.toLowerCase() === g('name').toLowerCase() && i.category_id === c.id);
      const rec = { id: ex ? ex.id : uid(), name: g('name'), name_hi: g('name_hi'), name_ur: g('name_ur'), category_id: c.id, price: parseNum(g('price')), gst: g('gst') === '' ? '' : parseNum(g('gst')), hsn: g('hsn'), veg: ['veg', 'nonveg', 'egg'].includes(g('veg').toLowerCase()) ? g('veg').toLowerCase() : '', desc: g('description'), active: true, available: true };
      if (!ex) { rec.modifiers = []; rec.recipe = []; }
      store.put('items', rec); ex ? updated++ : added++;
    }
    toast(t('Imported: {a} new, {u} updated', { a: added, u: updated }), 'ok', 5000); draw();
  }
  draw();
  return { update() { if (tab === 'dishes') drawList(); } };
}
