// Floor view: every table with live status, waiter assignment, calls, quick takeaway/delivery, reservations.
import { h, empty, money, elapsed, fmtTime, fmtDate, now, uid, parseNum } from '../util.js';
import { store } from '../store.js';
import { t, nameOf } from '../i18n.js';
import { modal, toast, field, pickDlg, confirmDlg } from '../ui.js';
import * as L from '../logic.js';
import { go } from '../app.js';


/** Chair positions (in % of the tile's drawing box) around a round / square / rectangular table. */
export function chairLayout(seats, shape) {
  const n = Math.max(1, Math.min(14, seats | 0)), out = [];
  if (shape === 'round') { for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / n; out.push({ x: 50 + 43 * Math.cos(a), y: 50 + 43 * Math.sin(a), r: a * 180 / Math.PI + 90 }); } return out; }
  let ends = shape === 'rect' && n >= 6 ? 2 : 0, rest = n - ends, top = Math.ceil(rest / 2), bot = rest - top;
  const row = (c, y, r) => { const step = Math.min(24, 64 / Math.max(1, c)); for (let i = 0; i < c; i++) out.push({ x: 50 + (i - (c - 1) / 2) * step, y, r }); };
  row(top, 9, 180); row(bot, 91, 0);
  if (ends) { out.push({ x: 7, y: 50, r: 90 }, { x: 93, y: 50, r: 270 }); }
  return out;
}
export const shapeOf = tb => tb.shape || ((tb.seats | 0) <= 2 ? 'round' : (tb.seats | 0) <= 4 ? 'square' : 'rect');
function tableTile(tb, st, w, rv, tag) {
  const shape = shapeOf(tb), seated = st.order ? Math.min(tb.seats | 0, st.order.guests || (tb.seats | 0)) : 0;
  const chairs = chairLayout(tb.seats, shape).map((c, i) => h('i', { class: 'chair' + (i < seated ? ' taken' : ''), style: { left: c.x + '%', top: c.y + '%', transform: 'translate(-50%,-50%) rotate(' + c.r + 'deg)' } }));
  return h('button', { class: 'tab-tile seat-tile ' + st.status + ' shape-' + shape + (tb.seats > 6 ? ' wide' : ''), onClick: () => go('/order/t/' + tb.id), 'aria-label': t('Table') + ' ' + tb.no },
    tag ? h('span', { class: 'tag' }, tag) : null,
    h('span', { class: 'tbl' }, chairs, h('span', { class: 'top' }, h('span', { class: 'no' }, tb.no), h('small', null, tb.seats + ' ' + t('seats')))),
    h('span', { class: 'meta' }, w ? '🙋 ' + L.userName(w) : '\u00a0'),
    st.order ? h('span', { class: 'meta' }, '⏱ ', h('span', { 'data-since': st.order.created_at }, elapsed(st.order.created_at)), st.order.guests ? ' · 👥' + st.order.guests : '') : (rv ? h('span', { class: 'meta' }, '📅 ' + rv.name) : h('span', { class: 'meta' }, '\u00a0')),
    st.order ? h('span', { class: 'amt' }, money(st.total)) : h('span', { class: 'amt free-lbl' }, t('Free')));
}

export function mount(el) {
  const user = L.session.user;
  const mine = user.role === 'waiter';
  let area = 'all', onlyMine = mine && L.tables().some(x => x.waiter_id === user.id);
  const wrap = h('div', { class: 'page' });
  el.append(wrap);
  const tick = setInterval(() => { document.querySelectorAll('[data-since]').forEach(n => { n.textContent = elapsed(+n.dataset.since); }); }, 1000);

  function draw() {
    empty(wrap);
    const ar = L.areas();
    const tools = h('div', { class: 'toolbar' });
    tools.append(h('button', { class: 'chip' + (area === 'all' ? ' on' : ''), onClick: () => { area = 'all'; draw(); } }, t('All areas')));
    for (const a of ar) tools.append(h('button', { class: 'chip' + (area === a.id ? ' on' : ''), onClick: () => { area = a.id; draw(); } }, nameOf(a)));
    tools.append(h('span', { class: 'spacer' }));
    if (mine) tools.append(h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: onlyMine, onChange: e => { onlyMine = e.target.checked; draw(); } }), h('span', { class: 'track' }), h('span', { class: 'lbl' }, t('My tables'))));
    if (L.feature('takeaway') && L.can('waiter')) tools.append(h('button', { class: 'btn', onClick: () => go('/order/new/takeaway') }, '🥡 ', t('Takeaway')));
    if (L.feature('delivery') && L.can('waiter')) tools.append(h('button', { class: 'btn', onClick: () => go('/order/new/delivery') }, '🛵 ', t('Delivery')));
    if (L.feature('reservations') && L.can('waiter')) tools.append(h('button', { class: 'btn', onClick: reservations }, '📅 ', t('Reservations'), (() => { const n = L.reservations().filter(r => r.status === 'booked' && r.at > now() - 3600e3 && r.at < now() + 4 * 3600e3).length; return n ? h('span', { class: 'badge warn', style: { marginInlineStart: '.4rem' } }, n) : null; })()));
    wrap.append(tools);

    const calls = L.activeCalls();
    if (calls.length) {
      wrap.append(h('div', { class: 'callbar' }, calls.map(c => {
        const tb = L.tableById(c.table_id);
        return h('div', { class: 'call ' + c.kind }, h('span', null, (c.kind === 'bill' ? '🧾 ' : '🔔 ') + t('Table') + ' ' + (tb ? tb.no : '?') + ' — ' + (c.kind === 'bill' ? t('wants the bill') : t('needs a waiter'))),
          h('button', { class: 'btn sm', onClick: () => { L.clearCall(c.id); if (tb) go('/order/t/' + tb.id); } }, t('Attend')), h('button', { class: 'icon-btn', onClick: () => L.clearCall(c.id) }, '✕'));
      })));
    }
    wrap.append(h('div', { class: 'legend' },
      [['free', 'Free'], ['busy', 'Occupied'], ['ready', 'Food ready'], ['attention', 'Needs attention'], ['bill', 'Bill requested']].map(([k, l]) => h('span', null, h('i', { style: { borderColor: `var(--${k === 'attention' ? 'attn' : k})`, borderStyle: k === 'free' ? 'dashed' : 'solid' } }), t(l)))));

    let list = L.tables();
    if (area !== 'all') list = list.filter(x => x.area_id === area);
    if (onlyMine) list = list.filter(x => x.waiter_id === user.id || L.orderForTable(x.id));
    if (!list.length) { wrap.append(h('div', { class: 'empty' }, h('b', null, t('No tables yet')), h('p', null, t('Add tables under Admin → Tables.')))); return; }
    const grid = h('div', { class: 'tabgrid' });
    for (const tb of list) {
      const st = L.tableState(tb);
      const w = (st.order && st.order.waiter_id) || tb.waiter_id;
      const rv = L.feature('reservations') ? L.upcomingReservation(tb.id) : null;
      const tag = { free: rv ? '📅 ' + fmtTime(rv.at) : '', busy: t('Occupied'), ready: t('Ready'), attention: t('Attention'), bill: t('Bill') }[st.status];
      grid.append(tableTile(tb, st, w, rv, tag));
    }
    wrap.append(grid);
    // open takeaway / delivery orders
    const others = L.openOrders().filter(o => !o.table_id);
    if (others.length) {
      wrap.append(h('h3', { style: { margin: '1.2rem 0 .6rem' } }, t('Takeaway & delivery in progress')));
      wrap.append(h('div', { class: 'tabgrid' }, others.map(o => {
        const its = L.itemsOf(o.id);
        const ready = its.some(i => i.status === 'ready');
        return h('button', { class: 'tab-tile ' + (ready ? 'ready' : 'busy'), onClick: () => go('/order/o/' + o.id) },
          h('span', { class: 'tag' }, o.type === 'delivery' ? '🛵' : '🥡'), h('span', { class: 'no' }, '#' + (o.no ?? '…')),
          h('span', { class: 'meta' }, (o.customer && o.customer.name) || (o.partner_id && (store.get('partners', o.partner_id) || {}).name) || t(o.type === 'delivery' ? 'Delivery' : 'Takeaway')),
          h('span', { class: 'amt' }, money(L.calcTotals(o, its).total)));
      })));
    }
  }

  function reservations() {
    const body = h('div');
    const drawR = () => {
      empty(body);
      const list = L.reservations().filter(r => r.status === 'booked' || r.at > now() - 86400e3);
      body.append(h('button', { class: 'btn primary', style: { marginBottom: '.8rem' }, onClick: () => editResv() }, '+ ', t('New reservation')));
      if (!list.length) body.append(h('div', { class: 'empty' }, h('b', null, t('No reservations'))));
      for (const r of list) {
        const tb = L.tableById(r.table_id);
        body.append(h('div', { class: 'pay-row' }, h('div', { style: { flex: 1 } }, h('b', null, r.name), ' · ', r.pax, ' ', t('guests'), h('div', { class: 'muted' }, fmtDate(r.at) + ' ' + fmtTime(r.at) + (tb ? ' · ' + t('Table') + ' ' + tb.no : '') + (r.phone ? ' · ' + r.phone : '') + (r.note ? ' · ' + r.note : ''))),
          r.status === 'booked' ? [h('button', { class: 'btn sm ok', onClick: () => { store.patch('reservations', r.id, { status: 'seated' }); if (tb) { m.close(); go('/order/t/' + tb.id); } else drawR(); } }, t('Seat')),
            h('button', { class: 'btn sm ghost', onClick: () => { store.patch('reservations', r.id, { status: 'cancelled' }); drawR(); } }, t('Cancel'))] : h('span', { class: 'badge' }, t(r.status === 'seated' ? 'Seated' : 'Cancelled'))));
      }
    };
    const m = modal({ title: t('Reservations'), size: 'md', body });
    drawR();
    const unsub = store.on(tp => { if (tp === 'change' && !m.closed) drawR(); });
  }
  function editResv() {
    const name = h('input', { type: 'text' }), phone = h('input', { type: 'tel', 'data-kb': 'num' }), pax = h('input', { type: 'text', value: '2', 'data-kb': 'num', inputmode: 'numeric' });
    const d = new Date(Date.now() + 3600e3); const pad = n => String(n).padStart(2, '0');
    const when = h('input', { type: 'datetime-local', value: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00` });
    const tb = h('select', null, h('option', { value: '' }, t('Any table')), L.tables().map(x => h('option', { value: x.id }, t('Table') + ' ' + x.no + ' (' + x.seats + ')')));
    const note = h('input', { type: 'text' });
    modal({ title: t('New reservation'), size: 'sm', body: h('div', null, field(t('Name'), name), h('div', { class: 'grid2' }, field(t('Phone'), phone), field(t('Guests'), pax)), field(t('Date & time'), when), field(t('Table'), tb), field(t('Note'), note)),
      actions: [{ label: t('Cancel'), kind: 'ghost' }, { label: t('Save'), kind: 'primary', onClick: c => {
        if (!name.value.trim()) { toast(t('Enter a name'), 'warn'); return false; }
        store.put('reservations', { id: uid(), name: name.value.trim(), phone: phone.value.trim(), pax: parseInt(pax.value) || 2, at: new Date(when.value).getTime(), table_id: tb.value || null, note: note.value.trim(), status: 'booked', by: user.id });
        toast(t('Reservation saved'), 'ok'); c();
      } }] });
  }
  draw();
  return { update: draw, destroy: () => clearInterval(tick) };
}
