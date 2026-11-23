// Software-provider panel. Locked with the provider password. Lets the vendor switch features/sections on or off per client,
// set a licence expiry, suspend the account and cap users/tables.
// Enforcement: local server and Supabase both verify the password themselves before accepting changes (a restaurant
// staff member cannot just edit the flags from their browser).
import { h, empty, sha256, now } from '../util.js';
import { store, fetchJSON } from '../store.js';
import { t } from '../i18n.js';
import { modal, toast, field, switchEl, confirmDlg } from '../ui.js';
import * as L from '../logic.js';
import { app, go } from '../app.js';
import { PROVIDER_HASH } from '../provider-hash.js';

const PW_KEY = 'restopos.pk';
const hashOf = pw => sha256('restopos-provider:' + pw);
const PRESETS = {
  basic: ['tables', 'kitchen', 'takeaway', 'discounts', 'gst', 'upi_qr', 'multilang', 'net_print', 'backup'],
  standard: ['tables', 'kitchen', 'takeaway', 'delivery', 'guest', 'discounts', 'gst', 'upi_qr', 'inventory', 'split', 'tips', 'expenses', 'shifts', 'reports', 'gst_reports', 'multilang', 'net_print', 'backup', 'members', 'reservations'],
  full: L.FEATURES.map(f => f.id)
};

export function mount(el) {
  const page = h('div', { class: 'page', style: { maxWidth: '900px' } });
  el.append(h('div', { class: 'topbar' }, h('button', { class: 'brandname', onClick: () => { sessionStorage.removeItem(PW_KEY); location.hash = '#/'; location.reload(); } }, '← RestoPOS'), h('span', { class: 'spacer' }), h('span', { style: { fontWeight: 700 } }, t('Provider panel'))), page);
  const pw = sessionStorage.getItem(PW_KEY);
  if (pw && hashOf(pw) === PROVIDER_HASH) draw(pw); else gate();

  function gate() {
    empty(page);
    const inp = h('input', { type: 'password', placeholder: t('Provider password'), autocomplete: 'off', autofocus: true });
    const err = h('div', { class: 'hint bad', hidden: true });
    const go1 = () => {
      if (hashOf(inp.value) !== PROVIDER_HASH) { err.textContent = t('Wrong password'); err.hidden = false; inp.value = ''; return; }
      sessionStorage.setItem(PW_KEY, inp.value); draw(inp.value);
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') go1(); });
    page.append(h('div', { class: 'panel', style: { margin: '3rem auto' } }, h('h2', null, '🔐 ', t('Provider panel')), h('p', { class: 'muted', style: { margin: '.4rem 0 1rem' } }, t('Only the software provider can change licence and feature settings.')), field(t('Password'), inp), err, h('button', { class: 'btn primary lg block', onClick: go1 }, t('Unlock'))));
  }

  function draw(password) {
    empty(page);
    const cur = L.provider();
    const st = { features: { ...(cur.features || {}) }, valid_until: cur.valid_until || '', suspended: !!cur.suspended, client_name: cur.client_name || '', support: cur.support || '', message: cur.message || '', notes: cur.notes || '', max_users: (cur.limits || {}).max_users || '', max_tables: (cur.limits || {}).max_tables || '', plan: cur.plan || '', trial_start: cur.trial_start || 0, activated_at: cur.activated_at || 0 };
    const on = id => st.features[id] !== false;
    const lic = L.licenseState();
    const nm = h('input', { type: 'text', value: st.client_name, placeholder: t('Client / restaurant (for your records)') }), until = h('input', { type: 'date', value: st.valid_until }), support = h('input', { type: 'text', value: st.support, placeholder: t('Phone / email shown to the client when blocked') });
    const msg = h('input', { type: 'text', value: st.message, placeholder: t('Message shown when the licence is expired or suspended') }), notes = h('textarea', { rows: 2, value: st.notes, placeholder: t('Private notes') });
    const mu = h('input', { type: 'text', value: st.max_users, inputmode: 'numeric', 'data-kb': 'num', placeholder: t('unlimited') }), mt = h('input', { type: 'text', value: st.max_tables, inputmode: 'numeric', 'data-kb': 'num', placeholder: t('unlimited') });
    const boxes = new Map();
    const grid = h('div');
    const drawGrid = () => {
      empty(grid);
      const groups = [...new Set(L.FEATURES.map(f => f.group))];
      for (const g of groups) {
        grid.append(h('h4', { style: { margin: '1rem 0 .4rem' } }, t(g)));
        grid.append(h('div', { class: 'grid2' }, L.FEATURES.filter(f => f.group === g).map(f => h('div', { class: 'pay-row', style: { margin: 0 } }, h('span', { style: { flex: 1 } }, t(f.label)), switchEl(on(f.id), v => { if (v) delete st.features[f.id]; else st.features[f.id] = false; }, null)))));
      }
    };
    drawGrid();
    const preset = name => { st.features = {}; for (const f of L.FEATURES) if (!PRESETS[name].includes(f.id)) st.features[f.id] = false; drawGrid(); };
    const planLine = lic.plan === 'lifetime' ? t('Lifetime — never expires') : lic.plan === 'yearly' ? t('Yearly — valid until') + ' ' + (lic.until || '') : t('Free trial') + (lic.until ? ' — ' + t('ends') + ' ' + lic.until : '');
    const activate = async kind => {
      if (kind === 'lifetime') { st.plan = 'lifetime'; until.value = ''; }
      else if (kind === 'yearly') { const base = cur.valid_until && cur.valid_until > L.today() && cur.plan === 'yearly' ? cur.valid_until : L.today(); st.plan = 'yearly'; until.value = L.addDays(base, 365); }
      else { if (!await confirmDlg(t('Restart the 30-day trial from today?'))) return; st.plan = 'trial'; st.trial_start = now(); until.value = ''; }
      st.suspended = false; st.activated_at = now(); await save();
    };
    page.append(
      h('div', { class: 'card', style: { marginBottom: '1rem' } }, h('div', { class: 'row sp wrap' }, h('h2', null, t('Activation')), h('span', { class: 'badge ' + (lic.ok ? 'ok' : 'bad') }, planLine)),
        h('p', { class: 'muted', style: { margin: '.4rem 0 .8rem' } }, t('A new restaurant starts a 30-day free trial by itself. Activate a plan here after payment.')),
        h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onClick: () => activate('yearly') }, t('Activate yearly (+1 year)')), h('button', { class: 'btn primary', onClick: () => activate('lifetime') }, t('Activate lifetime')), h('button', { class: 'btn ghost', onClick: () => activate('trial') }, t('Restart trial')))),
      h('div', { class: 'card', style: { marginBottom: '1rem' } }, h('div', { class: 'row sp wrap' }, h('h2', null, t('Licence')), h('span', { class: 'badge ' + (lic.ok ? 'ok' : 'bad') }, lic.ok ? t('Active') : lic.reason === 'suspended' ? t('Suspended') : t('Expired'))),
        h('div', { class: 'grid2', style: { marginTop: '.8rem' } }, field(t('Client name'), nm), field(t('Valid until'), until, t('Blank = no expiry')), field(t('Max staff logins'), mu), field(t('Max tables'), mt), field(t('Support contact'), support), field(t('Blocked-screen message'), msg)), notes,
        h('div', { style: { marginTop: '.4rem' } }, switchEl(st.suspended, v => { st.suspended = v; }, t('Suspend this client (blocks all screens except this panel)')))),
      h('div', { class: 'card' }, h('div', { class: 'row sp wrap' }, h('h2', null, t('Features & sections')), h('div', { class: 'row wrap' }, h('span', { class: 'muted' }, t('Presets')), ['basic', 'standard', 'full'].map(p => h('button', { class: 'btn sm', onClick: () => preset(p) }, t(p[0].toUpperCase() + p.slice(1)))))), grid),
      h('div', { class: 'row wrap', style: { marginTop: '1rem' } }, h('button', { class: 'btn primary lg', onClick: save }, t('Save for this client')), h('button', { class: 'btn ghost', onClick: () => { sessionStorage.removeItem(PW_KEY); gate(); } }, t('Lock panel'))),
      h('p', { class: 'muted', style: { marginTop: '1rem' } }, t('Changes reach every tablet on this restaurant within a few seconds. Turned-off sections disappear from menus and screens.')));
    async function save() {
      const flags = { features: st.features, plan: st.plan || (until.value ? 'yearly' : 'trial'), trial_start: st.trial_start || 0, activated_at: st.activated_at || 0, valid_until: until.value || '', suspended: st.suspended, client_name: nm.value.trim(), support: support.value.trim(), message: msg.value.trim(), notes: notes.value.trim(), limits: { max_users: parseInt(mu.value) || 0, max_tables: parseInt(mt.value) || 0 } };
      try {
        if (app.kind === 'local') await fetchJSON('api/provider', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password, flags }) });
        else if (app.kind === 'cloud') { await app.transport.rpc('set_provider_flags', { p_key: password, p_data: flags }); await store.syncNow(); }
        else store.put('provider', { id: 'flags', ...flags });
        toast(t('Saved — applied to all devices'), 'ok');
        if (app.kind !== 'standalone') await store.syncNow();
        draw(password);
      } catch (e) { toast(e.status === 403 ? t('Wrong password') : e.message, 'bad', 6000); }
    }
  }
  return {};
}
