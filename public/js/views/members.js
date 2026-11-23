// Membership cards: the owner enters each pre-printed card number by hand (or imports a CSV) with a discount rate.
// At billing the cashier types / scans the number and the discount is applied automatically.
import { h, empty, money, uid, parseNum, fmtDate, fmtTime, readFileText, download, toCSV, debounce } from '../util.js';
import { store } from '../store.js';
import { t } from '../i18n.js';
import { modal, toast, confirmDlg, field, switchEl, numberDlg } from '../ui.js';
import * as L from '../logic.js';
import { dataTable, kpis, csvBtn } from './kit.js';

const DEFAULT_PLANS = [{ name: 'Silver', pct: 5 }, { name: 'Gold', pct: 10 }, { name: 'Platinum', pct: 15 }];
export const plans = () => (L.settings().member_plans && L.settings().member_plans.length ? L.settings().member_plans : DEFAULT_PLANS);

export function mount(el) {
  let q = '', filter = 'all';
  const page = h('div', { class: 'page' }); const body = h('div');
  el.append(page, );
  page.append(body);

  function draw() {
    empty(body);
    const all = L.members();
    const stats = new Map(all.map(m => [m.id, L.memberStats(m)]));
    const active = all.filter(m => L.memberStatus(m) === 'ok').length;
    body.append(kpis([[t('Members'), all.length], [t('Active'), active], [t('Total saved by members'), money([...stats.values()].reduce((a, s) => a + s.saved, 0))], [t('Member sales'), money([...stats.values()].reduce((a, s) => a + s.spent, 0))]]));
    body.append(h('div', { class: 'toolbar' },
      h('input', { type: 'search', placeholder: t('Search card number, name or phone…'), value: q, onInput: debounce(e => { q = e.target.value.toLowerCase(); drawList(); }, 120) }),
      h('select', { style: { width: 'auto' }, onChange: e => { filter = e.target.value; drawList(); } }, [['all', t('All')], ['ok', t('Valid')], ['expired', t('Expired')], ['inactive', t('Inactive')]].map(([v, l]) => h('option', { value: v, selected: filter === v }, l))),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn sm', onClick: editPlans }, t('Plans')),
      h('button', { class: 'btn sm', onClick: () => download('members.csv', toCSV(all.map(m => ({ ...m })), ['card_no', 'name', 'phone', 'discount_pct', 'plan', 'valid_until', 'active'].map(k => ({ label: k, key: k }))), 'text/csv') }, '⬇ CSV'),
      h('label', { class: 'btn sm' }, '⬆ ', t('Import CSV'), h('input', { type: 'file', accept: '.csv,text/csv', hidden: true, onChange: importCsv })),
      h('button', { class: 'btn primary', onClick: () => edit() }, '+ ', t('Add member'))));
    body.append(h('div', { id: 'mlist' }));
    drawList();
  }
  function drawList() {
    const box = body.querySelector('#mlist'); if (!box) return; empty(box);
    let list = L.members();
    if (filter !== 'all') list = list.filter(m => L.memberStatus(m) === filter);
    if (q) list = list.filter(m => [m.card_no, m.name, m.phone].some(x => x && String(x).toLowerCase().includes(q)));
    box.append(dataTable([
      { label: t('Card no.'), get: m => h('b', { class: 'mono' }, m.card_no) }, { label: t('Name'), get: m => m.name }, { label: t('Phone'), get: m => m.phone || '' }, { label: t('Plan'), get: m => m.plan || '' },
      { label: t('Discount'), cls: 'r', get: m => m.discount_pct + '%' }, { label: t('Valid until'), get: m => m.valid_until || '—' },
      { label: t('Status'), get: m => { const s = L.memberStatus(m); return h('span', { class: 'badge ' + (s === 'ok' ? 'ok' : 'bad') }, t(s === 'ok' ? 'Valid' : s === 'expired' ? 'Expired' : 'Inactive')); } },
      { label: t('Visits'), cls: 'r', get: m => L.memberStats(m).visits }, { label: t('Spent'), cls: 'r', get: m => L.memberStats(m).spent, fmt: v => money(v) },
      { label: '', get: m => h('button', { class: 'btn sm', onClick: () => detail(m) }, t('Open')) }
    ], list, { empty: t('No members yet. Add the first card.') }));
  }
  function edit(m) {
    const o = m || { discount_pct: plans()[0].pct, plan: plans()[0].name, active: true };
    const card = h('input', { type: 'text', value: o.card_no || '', placeholder: t('Number printed on the card'), 'data-kb': 'num', inputmode: 'numeric' });
    const name = h('input', { type: 'text', value: o.name || '' }), phone = h('input', { type: 'tel', value: o.phone || '', 'data-kb': 'num' });
    const pct = h('input', { type: 'text', value: o.discount_pct ?? '', inputmode: 'decimal', 'data-kb': 'num' });
    const plan = h('input', { type: 'text', value: o.plan || '' });
    const valid = h('input', { type: 'date', value: o.valid_until || '' });
    const note = h('input', { type: 'text', value: o.note || '' });
    let act = o.active !== false;
    const quick = h('div', { class: 'row wrap', style: { marginBottom: '.7rem' } }, plans().map(p => h('button', { class: 'chip', onClick: () => { pct.value = p.pct; plan.value = p.name; } }, p.name + ' ' + p.pct + '%')));
    modal({ title: m ? t('Edit member') : t('Add member'), size: 'md', body: h('div', null, h('div', { class: 'grid2' }, field(t('Card number'), card), field(t('Member name'), name), field(t('Phone'), phone), field(t('Discount %'), pct)), quick, h('div', { class: 'grid2' }, field(t('Plan'), plan), field(t('Valid until (optional)'), valid)), field(t('Note'), note), switchEl(act, v => { act = v; }, t('Card is active'))),
      actions: [{ label: t('Cancel'), kind: 'ghost' }, { label: t('Save'), kind: 'primary', onClick: c => {
        const cn = card.value.trim();
        if (!cn) { toast(t('Enter the card number'), 'warn'); return false; }
        if (L.cardTaken(cn, m && m.id)) { toast(t('This card number already exists'), 'bad'); return false; }
        if (!name.value.trim()) { toast(t('Enter the member name'), 'warn'); return false; }
        const p = parseNum(pct.value); if (p < 0 || p > 100) { toast(t('Discount must be between 0 and 100'), 'warn'); return false; }
        store.put('members', { id: m ? m.id : uid(), card_no: cn, name: name.value.trim(), phone: phone.value.trim(), discount_pct: p, plan: plan.value.trim(), valid_until: valid.value || '', note: note.value.trim(), active: act });
        toast(t('Member saved'), 'ok'); c(); draw();
      } }] });
  }
  function detail(m) {
    const st = L.memberStats(m);
    const orders = store.all('orders').filter(o => o.member_id === m.id && o.status === 'paid').sort((a, b) => b.paid_at - a.paid_at).slice(0, 30);
    modal({ title: m.name + ' · ' + m.card_no, size: 'md', body: h('div', null, kpis([[t('Visits'), st.visits], [t('Spent'), money(st.spent)], [t('Saved'), money(st.saved)], [t('Last visit'), st.last ? fmtDate(st.last) : '—']]),
      dataTable([{ label: t('Invoice'), get: o => L.billNoLabel(o) }, { label: t('Date'), get: o => fmtDate(o.paid_at) + ' ' + fmtTime(o.paid_at) }, { label: t('Discount'), cls: 'r', get: o => (o.totals || {}).memberDiscount || 0, fmt: v => money(v) }, { label: t('Total'), cls: 'r', get: o => (o.totals || {}).total || 0, fmt: v => money(v) }], orders, { empty: t('No visits yet') })),
      actions: [{ label: t('Edit'), kind: '', onClick: c => { c(); edit(m); } }, { label: t('Delete'), kind: 'danger', onClick: async c => { if (await confirmDlg(t('Delete {name}?', { name: m.name }), { danger: true, ok: t('Delete') })) { store.patch('members', m.id, { active: false, deleted: true }); c(); draw(); } return false; } }, { label: t('Close'), kind: 'primary' }] });
  }
  function editPlans() {
    const rows = JSON.parse(JSON.stringify(plans()));
    const box = h('div');
    const d = () => { empty(box); rows.forEach((p, i) => box.append(h('div', { class: 'row', style: { marginBottom: '.4rem' } }, h('input', { type: 'text', value: p.name, onInput: e => { p.name = e.target.value; } }), h('input', { type: 'text', value: p.pct, style: { width: '90px' }, inputmode: 'decimal', 'data-kb': 'num', onInput: e => { p.pct = parseNum(e.target.value); } }), h('span', null, '%'), h('button', { class: 'icon-btn', onClick: () => { rows.splice(i, 1); d(); } }, '✕')))); box.append(h('button', { class: 'btn sm', onClick: () => { rows.push({ name: '', pct: 5 }); d(); } }, '+ ', t('Add plan'))); };
    d();
    modal({ title: t('Membership plans'), size: 'sm', body: h('div', null, h('p', { class: 'muted' }, t('Plans are shortcuts for the discount rate when adding a member. You can still set any rate per member.')), box), actions: [{ label: t('Cancel'), kind: 'ghost' }, { label: t('Save'), kind: 'primary', onClick: c => { L.saveSettings({ member_plans: rows.filter(r => r.name.trim()) }); c(); } }] });
  }
  async function importCsv(e) {
    const f = e.target.files[0]; if (!f) return;
    const lines = (await readFileText(f)).replace(/^﻿/, '').split(/\r?\n/).filter(x => x.trim());
    const head = lines.shift().split(',').map(x => x.trim().toLowerCase());
    const ix = k => head.indexOf(k);
    if (ix('card_no') < 0 || ix('name') < 0) return toast(t('CSV needs the columns: card_no, name, discount_pct (phone, plan, valid_until optional)'), 'bad', 7000);
    let add = 0, upd = 0, skip = 0;
    for (const ln of lines) {
      const r = ln.split(',').map(x => x.trim().replace(/^"|"$/g, ''));
      const g = k => (ix(k) >= 0 ? r[ix(k)] || '' : '');
      if (!g('card_no') || !g('name')) { skip++; continue; }
      const ex = L.members().find(x => String(x.card_no).trim().toUpperCase() === g('card_no').toUpperCase());
      store.put('members', { id: ex ? ex.id : uid(), card_no: g('card_no'), name: g('name'), phone: g('phone'), discount_pct: parseNum(g('discount_pct')), plan: g('plan'), valid_until: g('valid_until'), active: g('active') === '' ? true : !/^(0|false|no)$/i.test(g('active')) });
      ex ? upd++ : add++;
    }
    toast(t('Imported: {a} new, {u} updated', { a: add, u: upd }) + (skip ? ' · ' + skip + ' ' + t('skipped') : ''), 'ok', 5000); draw();
  }
  draw();
  return { update: drawList };
}
