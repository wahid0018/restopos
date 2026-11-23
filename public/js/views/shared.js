// Pieces shared by the waiter screen, the table tablet and the kitchen.
import { h, empty, money, num, r2, sum, uid } from '../util.js';
import { t, nameOf, descOf, getLang, setLang, LANGS } from '../i18n.js';
import { modal, stepper, toast } from '../ui.js';
import * as L from '../logic.js';
import { openAR } from '../ar.js';

export const vegDot = v => v ? h('span', { class: 'veg ' + (v === 'nonveg' ? 'nv' : v === 'egg' ? 'eg' : 'v'), title: v }, h('i')) : null;

/** EN | हिं | اردو — instant switch, no reload. Only English is offered when the provider has switched multi-language off. */
export function langSwitch({ big = false, onChange, persist = true } = {}) {
  const langs = L.feature('multilang') ? LANGS : LANGS.slice(0, 1);
  const el = h('div', { class: 'langsw' + (big ? ' big' : '') }, langs.map(l => h('button', {
    type: 'button', class: 'lbtn' + (getLang() === l.id ? ' on' : ''), lang: l.id, 'aria-pressed': getLang() === l.id, title: l.label,
    onClick: () => { setLang(l.id, persist); onChange && onChange(l.id); }
  }, l.short)));
  return langs.length > 1 ? el : null;
}

export function itemImg(it) {
  return it.img ? h('img', { src: it.img, alt: '', loading: 'lazy' }) : null;
}

/** Menu grid tile. */
export function itemTile(item, { inCart = 0, onClick, showImg = true, off = null }) {
  const hasImg = showImg && item.img;
  const b = h('button', { type: 'button', class: 'it' + (hasImg ? '' : ' noimg') + (off ? ' off' : ''), 'data-off': off || null, onClick: () => onClick(item) },
    hasImg ? h('div', { class: 'ph' }, itemImg(item)) : null,
    inCart ? h('span', { class: 'qty-b' }, '×' + inCart) : null,
    h('div', { class: 'bd' },
      h('div', { class: 'nm' }, vegDot(item.veg), ' ', nameOf(item)),
      descOf(item) ? h('div', { class: 'ds' }, descOf(item)) : null,
      h('div', { class: 'pr' }, money(item.price))));
  return b;
}

/**
 * Modifier / quantity / note dialog.  Resolves {qty, mods, note} or null.
 * `initial` lets the cart re-open an existing line for editing.
 */
export function itemDialog(item, initial = {}) {
  return new Promise(res => {
    const groups = item.modifiers || [];
    const state = groups.map((g, gi) => new Set((initial.sel && initial.sel[gi]) || []));
    let qty = initial.qty || 1;
    const note = h('input', { type: 'text', value: initial.note || '', placeholder: t('Note for the kitchen (optional)') });
    const err = h('div', { class: 'hint bad', hidden: true });
    const body = h('div');
    const priceEl = h('b', { class: 'num' });
    const stp = stepper(qty, { min: 1, max: 99, onChange: n => { qty = n; calc(); } });
    const calc = () => {
      let p = item.price;
      groups.forEach((g, gi) => state[gi].forEach(oi => { p += Number(g.options[oi].price) || 0; }));
      priceEl.textContent = money(p * qty);
    };
    const chips = [
      item.prep_min ? '⏱ ' + t('{n} min', { n: item.prep_min }) : null,
      item.spice ? '🌶'.repeat(item.spice) + ' ' + t(['', 'Mild', 'Medium', 'Hot'][item.spice]) : null,
      item.serves ? '👥 ' + t('Serves {n}', { n: item.serves }) : null,
      item.kcal ? '🔥 ' + item.kcal + ' kcal' : null,
      item.allergens ? '⚠ ' + t('Contains') + ': ' + item.allergens : null].filter(Boolean);
    const ar = L.feature('ar3d') && L.settings().ar_on !== false;
    if (item.img || descOf(item) || chips.length || ar) body.append(h('div', { class: 'dish-info' },
      item.img ? h('div', { class: 'dish-photo' }, h('img', { src: item.img, alt: '' })) : null,
      ar ? h('button', { type: 'button', class: 'btn ar-open', onClick: () => openAR(item) }, '🧊 ', t('View in 3D on your table')) : null,
      descOf(item) ? h('p', { class: 'dish-desc' }, descOf(item)) : null,
      chips.length ? h('div', { class: 'dish-chips' }, chips.map(c => h('span', null, c))) : null));
    groups.forEach((g, gi) => {
      const wrap = h('div', { class: 'modgrp' }, h('h4', null, nameOf(g), g.required ? h('span', { class: 'badge warn' }, t('Required')) : h('span', { class: 'badge' }, g.multi ? t('Choose any') : t('Optional'))));
      g.options.forEach((o, oi) => {
        const inp = h('input', { type: g.multi ? 'checkbox' : 'radio', name: 'g' + gi, checked: state[gi].has(oi), onChange: () => {
          if (g.multi) { inp.checked ? state[gi].add(oi) : state[gi].delete(oi); } else { state[gi].clear(); state[gi].add(oi); }
          calc();
        } });
        // radio groups that are optional can be un-picked by tapping the picked one again
        const lab = h('label', { class: 'opt' }, inp, h('span', null, nameOf(o)), Number(o.price) ? h('span', { class: 'p' }, '+' + money(o.price)) : null);
        if (!g.multi && !g.required) lab.addEventListener('click', e => { if (e.target === inp && state[gi].size === 1 && state[gi].has(oi) && lab.dataset.was === '1') { state[gi].clear(); inp.checked = false; calc(); } lab.dataset.was = inp.checked ? '1' : ''; });
        if (inp.checked) lab.dataset.was = '1';
        wrap.append(lab);
      });
      body.append(wrap);
    });
    body.append(h('label', { class: 'field' }, h('span', null, t('Note')), note), h('div', { class: 'row sp', style: { margin: '.2rem 0 .6rem' } }, h('b', null, t('Quantity')), stp), err);
    // default first option of a required single-choice group so one tap is enough for the common case
    groups.forEach((g, gi) => { if (g.required && !g.multi && state[gi].size === 0 && !initial.sel) { state[gi].add(0); body.querySelectorAll('input[name=g' + gi + ']')[0].checked = true; } });
    calc();
    modal({
      title: h('span', null, vegDot(item.veg), ' ', nameOf(item)), size: 'md', body,
      onClose: v => res(v || null),
      actions: [
        { label: t('Cancel'), kind: 'ghost' },
        { label: h('span', null, t('Add'), ' · ', priceEl), kind: 'primary', onClick: (close) => {
          for (let gi = 0; gi < groups.length; gi++) if (groups[gi].required && state[gi].size === 0) { err.textContent = t('Please choose: {name}', { name: nameOf(groups[gi]) }); err.hidden = false; return false; }
          const mods = []; groups.forEach((g, gi) => g.options.forEach((o, oi) => { if (state[gi].has(oi)) mods.push(o); }));
          close({ qty, mods, note: note.value.trim(), sel: state.map(s => Array.from(s)) });
        } }
      ]
    });
  });
}

/** Rows for bill totals: items, discounts, service, taxable, CGST/SGST by rate, round off, total. */
export function billRows(tt, { compact = false } = {}) {
  const rows = [];
  const row = (a, b, cls = '') => rows.push(h('div', { class: 'tot-row ' + cls }, h('span', null, a), h('span', { class: 'num' }, b)));
  row(t('Items total'), money(tt.subtotal));
  if (tt.memberDiscount) row(t('Member discount') + ' ' + tt.memberPct + '%', '-' + money(tt.memberDiscount), 'disc');
  if (tt.discount) row(t('Discount'), '-' + money(tt.discount), 'disc');
  if (tt.couponDiscount) row(t('Coupon'), '-' + money(tt.couponDiscount), 'disc');
  if (tt.pointsDiscount) row(t('Reward points'), '-' + money(tt.pointsDiscount), 'disc');
  if (tt.service) row(t('Service charge'), money(tt.service));
  if (tt.packaging) row(t('Packaging'), money(tt.packaging));
  if (tt.delivery) row(t('Delivery charge'), money(tt.delivery));
  if (tt.gstOn && tt.tax > 0) {
    if (!compact) row(t('Taxable value'), money(tt.taxable));
    for (const g of tt.groups) {
      if (!g.rate) continue;
      const r = n => (Number.isInteger(n) ? n : n.toFixed(2)) + '%';
      if (g.igst) row('IGST ' + r(g.rate), money(g.igst), 'tax');
      else if (compact) { /* merged below */ } else { row('CGST ' + r(g.rate / 2), money(g.cgst), 'tax'); row('SGST ' + r(g.rate / 2), money(g.sgst), 'tax'); }
    }
    if (compact) row(tt.interstate ? 'IGST' : 'GST (CGST+SGST)', money(tt.tax), 'tax');
  }
  if (tt.rounding) row(t('Round off'), (tt.rounding > 0 ? '+' : '') + money(tt.rounding));
  return rows;
}

export function statusPill(s) {
  const names = { pending: 'Awaiting approval', new: 'Sent', preparing: 'Preparing', ready: 'Ready', served: 'Served', void: 'Cancelled' };
  return h('span', { class: 'st ' + s }, t(names[s] || s));
}

export const modsText = l => (l.mods || []).map(m => nameOf(m)).join(', ');
export function lineEl(l, { actions = null, showPrice = true } = {}) {
  const tt = h('div', { class: 'tx' }, h('b', null, vegDot(l.veg), ' ', nameOf(l)), modsText(l) ? h('small', null, modsText(l)) : null, l.note ? h('small', null, '✎ ' + l.note) : null, l.status ? statusPill(l.status) : null);
  return h('div', { class: 'ln' + (l.status === 'void' ? ' void' : '') }, h('span', { class: 'q' }, l.qty), h('div', { style: { flex: 1, minWidth: 0 } }, tt, actions ? h('div', { class: 'acts' }, actions) : null), showPrice ? h('span', { class: 'am' }, money(L.lineTotal(l))) : null);
}

/** Draft cart kept per screen key so a language switch / re-render never loses what the guest picked. */
const carts = new Map();
export function cartFor(key) {
  if (!carts.has(key)) carts.set(key, []);
  const lines = carts.get(key);
  return {
    lines,
    add(item, opt) {
      const line = L.makeLine(item, opt.qty, opt.mods, opt.note);
      line.sel = opt.sel || null; line.uid = uid(); line.item = item;
      const same = lines.find(x => x.item_id === line.item_id && x.price === line.price && x.note === line.note && JSON.stringify(x.mods) === JSON.stringify(line.mods));
      if (same) same.qty += line.qty; else lines.push(line);
    },
    qtyOf: id => sum(lines.filter(x => x.item_id === id), x => x.qty),
    clear: () => { lines.length = 0; },
    count: () => sum(lines, x => x.qty),
    /** pseudo order-items so the GST engine can price the draft */
    asItems: () => lines.map(l => ({ price: l.price, qty: l.qty, gst: l.gst, status: 'new' }))
  };
}
export const isTouch = () => matchMedia('(pointer: coarse)').matches;
