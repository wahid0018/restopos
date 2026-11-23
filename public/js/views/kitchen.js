// Kitchen display: tickets flow New → Preparing → Ready. Big touch targets, colour-coded timers, sound on new orders.
import { h, empty, elapsed, minutesSince, fmtTime, now } from '../util.js';
import { store } from '../store.js';
import { t, nameOf } from '../i18n.js';
import { toast, beep, audioReady, unlockAudio, isSoundOn, setSound } from '../ui.js';
import * as L from '../logic.js';
import { vegDot, modsText, langSwitch } from './shared.js';
import { printKOT } from '../print.js';
import { app, deviceMode, staffGate, setDeviceMode, lock } from '../app.js';

export function mount(el, { kiosk, mode, args }) {
  const s = L.settings();
  const view = (args && args[0] === 'view') || !!(mode && mode.role === 'kitchen' && mode.readonly); // display only: no buttons
  let station = localStorage.getItem('restopos.kds.station') || 'all';
  let seen = null;
  const root = h('div', { class: 'kds' });
  const top = h('div', { class: 'kds-top' });
  const cols = h('div', { class: 'kds-cols' });
  root.append(top, cols);
  el.append(root);
  const tick = setInterval(() => { document.querySelectorAll('[data-t0]').forEach(n => { n.textContent = elapsed(+n.dataset.t0); }); }, 1000);

  function groups(status) {
    // one ticket per order + round, only lines of the chosen station
    const m = new Map();
    const lim = now() - (s.kds_ready_keep_min || 10) * 60000;
    for (const l of store.all('order_items')) {
      if (l.status !== status) continue;
      if (status === 'ready' && (l.ready_at || 0) < lim) continue;
      if (station !== 'all' && l.station !== station) continue;
      const o = store.get('orders', l.order_id);
      if (!o || o.status !== 'open') continue;
      const k = l.order_id + '|' + (l.round || 1);
      if (!m.has(k)) m.set(k, { order: o, round: l.round || 1, lines: [], t0: l.sent_at });
      const g = m.get(k); g.lines.push(l); g.t0 = Math.min(g.t0, l.sent_at);
    }
    return Array.from(m.values()).sort((a, b) => a.t0 - b.t0);
  }
  function ticket(g, status) {
    const tb = L.tableById(g.order.table_id);
    const age = minutesSince(g.t0);
    const cls = status !== 'ready' && age >= s.kds_late_min ? 'late' : status !== 'ready' && age >= s.kds_warn_min ? 'warn' : '';
    const title = tb ? t('Table') + ' ' + tb.no : (g.order.type === 'delivery' ? '🛵 ' : '🥡 ') + '#' + g.order.no;
    const nextS = status === 'new' ? 'preparing' : 'ready';
    const items = g.lines.map(l => h(view ? 'div' : 'button', { class: 'kt-i', onClick: view ? null : () => L.setLineStatus([l], status === 'new' ? 'preparing' : 'ready') },
      h('span', { class: 'q' }, l.qty), h('div', null, h('b', null, vegDot(l.veg), ' ', nameOf(l)), modsText(l) ? h('small', null, modsText(l)) : null, l.note ? h('small', null, '✎ ' + l.note) : null)));
    const foot = h('div', { class: 'kt-f' });
    if (status === 'new') foot.append(h('button', { class: 'btn primary', onClick: () => L.setLineStatus(g.lines, 'preparing') }, '▶ ', t('Start all')));
    if (status !== 'ready') foot.append(h('button', { class: 'btn ok', onClick: () => L.setLineStatus(g.lines, 'ready') }, '✓ ', t('All ready')));
    if (status === 'ready') foot.append(h('button', { class: 'btn', onClick: () => L.setLineStatus(g.lines, 'preparing') }, '↶ ', t('Recall')), h('button', { class: 'btn ok', onClick: () => L.setLineStatus(g.lines, 'served') }, t('Served')));
    if (status === 'preparing') foot.append(h('button', { class: 'btn', title: 'KOT', onClick: () => printKOT(g.order, g.lines, g.lines[0].station).catch(e => toast(e.message, 'bad')) }, '🖨'));
    if (view) foot.replaceChildren();
    const waiter = L.userName(g.order.waiter_id);
    return h('div', { class: 'kt ' + cls }, h('div', { class: 'kt-h' }, h('div', null, h('div', { class: 'tb' }, title), h('div', { class: 'sub' }, '#' + g.order.no + (g.round > 1 ? ' · ' + t('Add-on') + ' ' + g.round : '') + (waiter ? ' · ' + waiter : '') + ' · ' + fmtTime(g.t0))), h('div', { class: 'tm', 'data-t0': g.t0 }, elapsed(g.t0))), ...items, foot);
  }
  function draw() {
    empty(top); empty(cols);
    top.append(h('button', { class: 'chip' + (station === 'all' ? ' on' : ''), onClick: () => { station = 'all'; localStorage.setItem('restopos.kds.station', 'all'); draw(); } }, t('All stations')));
    for (const st of s.stations) top.append(h('button', { class: 'chip' + (station === st.id ? ' on' : ''), onClick: () => { station = st.id; localStorage.setItem('restopos.kds.station', st.id); draw(); } }, st.name));
    top.append(h('span', { class: 'spacer' }));
    top.append(h('button', { class: 'chip', onClick: () => { setSound(!isSoundOn()); unlockAudio(); draw(); } }, isSoundOn() ? '🔔 ' + t('Sound on') : '🔕 ' + t('Sound off')));
    if (view && !(mode && mode.role === 'kitchen')) top.append(langSwitch());
    else if (kiosk) { top.append(langSwitch()); top.append(h('button', { class: 'chip', onClick: async () => { if (await staffGate()) { setDeviceMode({ role: 'staff' }); location.hash = '#/'; location.reload(); } } }, '🔒')); }
    if (!audioReady() && isSoundOn()) top.append(h('span', { class: 'badge warn' }, t('Tap anywhere once to enable sound')));
    const defs = [['new', 'New'], ['preparing', 'Preparing'], ['ready', 'Ready']];
    const cur = new Set();
    for (const [st, label] of defs) {
      const gs = groups(st);
      gs.forEach(g => g.lines.forEach(l => cur.add(l.id)));
      cols.append(h('section', { class: 'kds-col' }, h('h3', null, t(label), h('span', { class: 'cnt' }, gs.reduce((a, g) => a + g.lines.length, 0))), h('div', { class: 'kds-list' }, gs.length ? gs.map(g => ticket(g, st)) : h('div', { class: 'empty' }, t('Nothing here')))));
    }
    const newIds = groups('new').flatMap(g => g.lines.map(l => l.id));
    if (seen && newIds.some(id => !seen.has(id))) beep('new');
    seen = new Set(newIds);
  }
  draw();
  return { update: draw, destroy: () => clearInterval(tick) };
}
