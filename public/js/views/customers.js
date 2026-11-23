// Customers (mobile-number based reward points), coupons and WhatsApp campaigns.
import { h, empty, money, uid, fmtDate, debounce, download, toCSV, now } from '../util.js';
import { store } from '../store.js';
import { t } from '../i18n.js';
import { modal, toast, confirmDlg, field, switchEl } from '../ui.js';
import * as L from '../logic.js';
import { dataTable, kpis, tabs } from './kit.js';
import { waLink, waSend, waStatus, fillMsg } from '../whatsapp.js';

export function mount(el) {
  let tab = 'customers', q = '';
  const page = h('div', { class: 'page' }); const body = h('div');
  el.append(page); page.append(body);
  const defs = () => [L.feature('loyalty') ? { id: 'customers', label: t('Customers') } : null, L.feature('coupons') ? { id: 'coupons', label: t('Coupons') } : null, L.feature('whatsapp') ? { id: 'campaign', label: t('WhatsApp offers & wishes') } : null].filter(Boolean);
  if (!defs().some(d => d.id === tab)) tab = (defs()[0] || {}).id;
  const draw = () => { empty(body); body.append(tabs(defs(), tab, id => { tab = id; draw(); })); const c = h('div'); body.append(c); ({ customers: drawCustomers, coupons: drawCoupons, campaign: drawCampaign }[tab] || (() => { }))(c); };

  // ───── customers ─────
  const mmdd = d => (d || '').slice(5, 10);
  const dayMatch = (d, offset = 0) => { if (!d) return false; const t0 = new Date(Date.now() + offset * 864e5); const m = String(t0.getMonth() + 1).padStart(2, '0') + '-' + String(t0.getDate()).padStart(2, '0'); return mmdd(d) === m; };
  function drawCustomers(c) {
    const all = L.customers();
    const st = new Map(all.map(x => [x.id, L.customerStats(x)]));
    c.append(kpis([[t('Customers'), all.length], [t('Points outstanding'), [...st.values()].reduce((a, s) => a + s.points, 0)], [t('Repeat customers'), [...st.values()].filter(s => s.visits > 1).length], [t('Today'), all.filter(x => dayMatch(x.birthday) || dayMatch(x.anniversary)).length + ' 🎂']]));
    c.append(h('div', { class: 'toolbar' }, h('input', { type: 'search', placeholder: t('Search name or phone…'), value: q, onInput: debounce(e => { q = e.target.value.toLowerCase(); drawL(); }, 120) }), h('span', { class: 'spacer' }),
      h('button', { class: 'btn sm', onClick: () => download('customers.csv', toCSV(all.map(x => ({ ...x, ...st.get(x.id) })), ['name', 'phone', 'birthday', 'anniversary', 'optin', 'visits', 'spent', 'points'].map(k => ({ label: k, key: k }))), 'text/csv') }, '⬇ CSV'),
      h('button', { class: 'btn primary', onClick: () => edit() }, '+ ', t('Add customer'))));
    const box = h('div'); c.append(box);
    function drawL() {
      empty(box);
      let list = all.slice().sort((a, b) => (st.get(b.id).last || 0) - (st.get(a.id).last || 0));
      if (q) list = list.filter(x => [x.name, x.phone].some(v => v && String(v).toLowerCase().includes(q)));
      box.append(dataTable([
        { label: t('Name'), get: x => x.name || '—' }, { label: t('Mobile number'), get: x => h('span', { class: 'mono' }, x.phone) },
        { label: t('Visits'), cls: 'r', get: x => st.get(x.id).visits }, { label: t('Spent'), cls: 'r', get: x => money(st.get(x.id).spent) },
        { label: t('Points'), cls: 'r', get: x => '⭐ ' + st.get(x.id).points }, { label: t('Last visit'), get: x => st.get(x.id).last ? fmtDate(st.get(x.id).last) : '—' },
        { label: '', get: x => h('button', { class: 'btn sm', onClick: () => edit(x) }, t('Edit')) }], list, { empty: t('No customers yet. They are added when a mobile number is taken at billing.') }));
    }
    drawL();
  }
  function edit(x) {
    const o = x || { optin: true };
    const name = h('input', { type: 'text', value: o.name || '' }), phone = h('input', { type: 'tel', maxlength: 10, value: o.phone || '', 'data-kb': 'num' });
    const b = h('input', { type: 'date', value: o.birthday || '' }), a = h('input', { type: 'date', value: o.anniversary || '' });
    const adj = h('input', { type: 'number', value: o.points_adj || 0, step: 1, 'data-kb': 'num' });
    let opt = o.optin !== false;
    modal({ title: x ? t('Edit customer') : t('Add customer'), size: 'sm', body: h('div', null, h('div', { class: 'grid2' }, field(t('Mobile number'), phone), field(t('Name'), name)), h('div', { class: 'grid2' }, field(t('Birthday'), b), field(t('Anniversary'), a)),
      x ? field(t('Points adjustment (+/−)'), adj, t('Added to the points earned from bills')) : null, switchEl(opt, v => { opt = v; }, t('Customer agrees to receive offers on WhatsApp / SMS'))),
      actions: [{ label: t('Cancel'), kind: 'ghost' }, { label: t('Save'), kind: 'primary', onClick: close => {
        const ph = L.cleanPhone(phone.value); if (ph.length !== 10) { toast(t('Enter a 10-digit mobile number'), 'warn'); return false; }
        const dup = L.customerByPhone(ph); if (dup && (!x || dup.id !== x.id)) { toast(t('This mobile number already exists'), 'warn'); return false; }
        store.put('customers', { id: x ? x.id : uid(), phone: ph, name: name.value.trim(), birthday: b.value, anniversary: a.value, optin: opt, points_adj: Number(adj.value) || 0, created_at: o.created_at || now() });
        close(); draw();
      } }] });
  }

  // ───── coupons ─────
  function drawCoupons(c) {
    c.append(h('div', { class: 'toolbar' }, h('span', { class: 'muted' }, t('Switch coupons on under Admin → Rewards.')), h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onClick: () => editCoupon() }, '+ ', t('Add coupon'))));
    c.append(dataTable([
      { label: t('Code'), get: x => h('b', { class: 'mono' }, x.code) }, { label: t('Offer'), get: x => x.kind === 'pct' ? x.value + '%' + (x.max_off ? ' (max ' + money(x.max_off) + ')' : '') : money(x.value) },
      { label: t('Min bill'), cls: 'r', get: x => x.min_bill ? money(x.min_bill) : '—' }, { label: t('Valid'), get: x => (x.valid_from || '…') + ' → ' + (x.valid_to || '…') },
      { label: t('Used'), cls: 'r', get: x => L.couponUses(x.code) + (x.limit_total ? ' / ' + x.limit_total : '') },
      { label: t('Status'), get: x => h('span', { class: 'badge ' + (x.active === false ? 'bad' : 'ok') }, x.active === false ? t('Inactive') : t('Active')) },
      { label: '', get: x => h('button', { class: 'btn sm', onClick: () => editCoupon(x) }, t('Edit')) }], L.coupons(), { empty: t('No coupons yet') }));
  }
  function editCoupon(x) {
    const o = x || { kind: 'pct', value: 10, active: true };
    const code = h('input', { type: 'text', value: o.code || '', style: { textTransform: 'uppercase' } });
    const kind = h('select', null, h('option', { value: 'pct', selected: o.kind === 'pct' }, t('Percentage (%)')), h('option', { value: 'flat', selected: o.kind === 'flat' }, t('Fixed amount')));
    const num = (v, ph) => h('input', { type: 'number', min: 0, step: 'any', value: v || '', placeholder: ph || '', 'data-kb': 'num' });
    const val = num(o.value), max = num(o.max_off, t('no limit')), min = num(o.min_bill, '0'), lim = num(o.limit_total, t('unlimited'));
    const vf = h('input', { type: 'date', value: o.valid_from || '' }), vt = h('input', { type: 'date', value: o.valid_to || '' });
    let once = !!o.once_per_customer, act = o.active !== false;
    modal({ title: x ? t('Edit coupon') : t('Add coupon'), size: 'md', body: h('div', null, h('div', { class: 'grid2' }, field(t('Code'), code), field(t('Type'), kind)), h('div', { class: 'grid2' }, field(t('Value'), val), field(t('Maximum discount (₹)'), max)),
      h('div', { class: 'grid2' }, field(t('Minimum bill (₹)'), min), field(t('Total uses allowed'), lim)), h('div', { class: 'grid2' }, field(t('Valid from'), vf), field(t('Valid until'), vt)),
      switchEl(once, v => { once = v; }, t('Once per customer (needs mobile number)')), switchEl(act, v => { act = v; }, t('Active'))),
      actions: [x ? { label: t('Delete'), kind: 'danger', onClick: async close => { if (await confirmDlg(t('Delete {name}?', { name: o.code }))) { store.del('coupons', x.id); close(); draw(); } return false; } } : { label: t('Cancel'), kind: 'ghost' },
        { label: t('Save'), kind: 'primary', onClick: close => {
          const cd = code.value.trim().toUpperCase().replace(/\s+/g, ''); if (!cd) { toast(t('Enter the coupon code'), 'warn'); return false; }
          if (L.coupons().some(c => c.code.toUpperCase() === cd && (!x || c.id !== x.id))) { toast(t('This coupon code already exists'), 'warn'); return false; }
          if (!(Number(val.value) > 0)) { toast(t('Enter a valid value'), 'warn'); return false; }
          store.put('coupons', { id: x ? x.id : uid(), code: cd, kind: kind.value, value: Number(val.value), max_off: Number(max.value) || 0, min_bill: Number(min.value) || 0, limit_total: Number(lim.value) || 0, valid_from: vf.value, valid_to: vt.value, once_per_customer: once, active: act });
          close(); draw();
        } }] });
  }

  // ───── WhatsApp campaigns ─────
  async function drawCampaign(c) {
    const stt = await waStatus();
    const st = new Map(L.customers().map(x => [x.id, L.customerStats(x)]));
    const AUD = [['all', t('All who agreed')], ['bday', t('Birthday today')], ['ann', t('Anniversary today')], ['idle', t('Not visited for 30+ days')], ['top', t('Top 20 by spending')], ['points', t('Have unused points')]];
    let aud = 'all', msg = t('Hi {name}! Enjoy a special offer at {restaurant} — show this message at billing.'), tpl = '', mode = stt.api ? 'api' : 'link';
    const pick = () => {
      let l = L.customers().filter(x => x.optin !== false && L.cleanPhone(x.phone).length === 10);
      if (aud === 'bday') l = l.filter(x => dayMatch(x.birthday)); else if (aud === 'ann') l = l.filter(x => dayMatch(x.anniversary));
      else if (aud === 'idle') l = l.filter(x => st.get(x.id).last && now() - st.get(x.id).last > 30 * 864e5);
      else if (aud === 'top') l = l.sort((a, b) => st.get(b.id).spent - st.get(a.id).spent).slice(0, 20);
      else if (aud === 'points') l = l.filter(x => st.get(x.id).points > 0);
      return l;
    };
    const vars = x => ({ name: x.name || '', restaurant: L.settings().name, points: st.get(x.id).points });
    const count = h('b'); const ta = h('textarea', { rows: 4, value: msg, onInput: e => { msg = e.target.value; } });
    const refresh = () => { count.textContent = pick().length + ' ' + t('customers'); };
    const sel = h('select', { onChange: e => { aud = e.target.value; refresh(); if (aud === 'bday') ta.value = msg = t('Happy Birthday {name}! 🎂 Dinner is on us — enjoy a treat at {restaurant}.'); if (aud === 'ann') ta.value = msg = t('Happy Anniversary {name}! 💐 Celebrate with us at {restaurant}.'); } }, AUD.map(([v, l]) => h('option', { value: v }, l)));
    const progress = h('div', { class: 'muted' });
    c.append(h('div', { class: 'card' },
      h('div', { class: 'hint' + (stt.api ? '' : ' warn') }, stt.api ? '✅ ' + t('WhatsApp Business API connected — messages are sent automatically.') : t('WhatsApp API is not connected. You can still open each chat and press Send (click-to-chat). Connect the API under Admin → Rewards.')),
      h('div', { class: 'grid2', style: { marginTop: '.6rem' } }, field(t('Send to'), sel), h('div', { style: { alignSelf: 'end', padding: '.6rem' } }, count)),
      field(t('Message') + ' — {name} {points} {restaurant}', ta),
      stt.api ? field(t('Approved template name (needed for offers outside 24 hours)'), h('input', { type: 'text', value: tpl, onInput: e => { tpl = e.target.value.trim(); }, placeholder: 'offer_message' }), t('Template variables: {{1}} = name, {{2}} = message text')) : null,
      h('div', { class: 'row', style: { marginTop: '.6rem' } }, h('button', { class: 'btn primary', onClick: send }, '💬 ', stt.api ? t('Send now') : t('Open chats one by one')), progress)));
    refresh();
    async function send() {
      const list = pick(); if (!list.length) return toast(t('Nobody to send to'), 'warn');
      if (!await confirmDlg(t('Send to {n} customers?', { n: list.length }))) return;
      if (stt.api) {
        let ok = 0, bad = 0;
        for (const x of list) { try { const text = fillMsg(msg, vars(x)); await waSend({ to: x.phone, text, template: tpl || undefined, params: [x.name || 'Guest', text] }); ok++; } catch (e) { bad++; if (bad === 1) toast(e.message, 'bad', 6000); } progress.textContent = ok + ' ✓  ' + bad + ' ✗'; await new Promise(r => setTimeout(r, 120)); }
        toast(t('Sent') + ': ' + ok, ok ? 'ok' : 'bad');
      } else {
        let i = 0;
        const next = () => { if (i >= list.length) return; const x = list[i++]; window.open(waLink(x.phone, fillMsg(msg, vars(x))), '_blank'); progress.textContent = i + ' / ' + list.length; };
        modal({ title: t('Open chats one by one'), size: 'sm', body: h('p', null, t('Press Next, then press Send inside WhatsApp. Repeat for each customer.')), actions: [{ label: t('Close'), kind: 'ghost' }, { label: t('Next'), kind: 'primary', onClick: () => { next(); return false; } }] });
        next();
      }
    }
  }
  draw();
  return { update() { /* keep dialogs stable */ } };
}
