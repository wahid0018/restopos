// Small building blocks for the back-office screens.
import { h, empty, money, num, download, toCSV, now } from '../util.js';
import { t } from '../i18n.js';
import * as L from '../logic.js';
import { fyOf, fyRange } from '../gst.js';

export function tabs(defs, active, onChange) {
  const el = h('div', { class: 'tabs', role: 'tablist' });
  const draw = () => { empty(el); for (const d of defs) el.append(h('button', { class: 'tab' + (d.id === active ? ' on' : ''), role: 'tab', onClick: () => { active = d.id; draw(); onChange(d.id); } }, d.label)); };
  draw();
  return el;
}
export const kpi = (label, value, sub) => h('div', { class: 'kpi' }, h('small', null, label), h('b', null, value), sub ? h('small', null, sub) : null);
export const kpis = arr => h('div', { class: 'kpis' }, arr.map(a => kpi(...a)));

/** cols: [{label, get(row)|key, cls, fmt}] */
export function dataTable(cols, rows, { empty: emptyText, foot, onRow } = {}) {
  const thead = h('thead', null, h('tr', null, cols.map(c => h('th', { class: c.cls || '' }, c.label))));
  const tbody = h('tbody');
  for (const r of rows) {
    const tr = h('tr', { style: onRow ? { cursor: 'pointer' } : null, onClick: onRow ? () => onRow(r) : null });
    for (const c of cols) { const v = typeof c.get === 'function' ? c.get(r) : r[c.key]; tr.append(h('td', { class: c.cls || '' }, c.fmt ? c.fmt(v, r) : v)); }
    tbody.append(tr);
  }
  const tbl = h('table', { class: 'tbl' }, thead, tbody);
  if (foot) tbl.append(h('tfoot', null, h('tr', null, cols.map((c, i) => h('th', { class: c.cls || '' }, foot[i] ?? '')))));
  if (!rows.length) return h('div', { class: 'empty' }, h('b', null, emptyText || t('Nothing to show')));
  return h('div', { class: 'tbl-wrap' }, tbl);
}
export const csvBtn = (label, filename, rows, cols) => h('button', { class: 'btn sm', onClick: () => download(filename, toCSV(rows, cols), 'text/csv') }, '⬇ ', label || 'CSV');
export const n2 = v => num(v);
export const rupee = v => money(v);

/** Date range chooser with presets. Calls onChange({from,to,label}). */
export function rangePicker(state, onChange) {
  const el = h('div', { class: 'toolbar' });
  const td = () => L.today();
  const presets = [
    ['today', t('Today'), () => [td(), td()]],
    ['yday', t('Yesterday'), () => [L.addDays(td(), -1), L.addDays(td(), -1)]],
    ['7d', t('Last 7 days'), () => [L.addDays(td(), -6), td()]],
    ['month', t('This month'), () => [td().slice(0, 8) + '01', td()]],
    ['lmonth', t('Last month'), () => { const d = new Date(td().slice(0, 8) + '01T12:00:00'); d.setMonth(d.getMonth() - 1); const f = d.toISOString().slice(0, 8) + '01'; const e = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12); return [f, e.toISOString().slice(0, 10)]; }],
    ['fy', t('This financial year'), () => fyRange(fyOf(td()))],
  ];
  const draw = () => {
    empty(el);
    for (const [id, label, fn] of presets) el.append(h('button', { class: 'chip' + (state.preset === id ? ' on' : ''), onClick: () => { const [a, b] = fn(); Object.assign(state, { preset: id, from: a, to: b }); draw(); onChange(state); } }, label));
    const f = h('input', { type: 'date', value: state.from, style: { width: 'auto' }, onChange: e => { state.from = e.target.value; state.preset = 'custom'; draw(); onChange(state); } });
    const to = h('input', { type: 'date', value: state.to, style: { width: 'auto' }, onChange: e => { state.to = e.target.value; state.preset = 'custom'; draw(); onChange(state); } });
    el.append(f, h('span', null, '→'), to);
  };
  draw();
  return el;
}
export const newRange = (preset = 'today') => ({ preset, from: L.today(), to: L.today() });
