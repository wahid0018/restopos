// "Check for updates": asks GitHub (through the local server when there is one) whether a newer release exists.
import { h } from './util.js';
import { fetchJSON } from './store.js';
import { t } from './i18n.js';
import { modal } from './ui.js';
import * as L from './logic.js';
import { app } from './app.js';
import { VERSION } from './version.js';

const SKIP = 'restopos.update.skip', LAST = 'restopos.update.last';
const vparts = v => String(v || '').replace(/^v/i, '').split(/[.+-]/).map(x => parseInt(x, 10) || 0);
const newer = (a, b) => { const x = vparts(a), y = vparts(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

export async function checkUpdate(force, repoArg) {
  if (app.kind === 'local') return fetchJSON('api/update-check?force=' + (force ? 1 : 0) + (repoArg ? '&repo=' + encodeURIComponent(repoArg) : ''), {}, 15000);
  const repo = String(repoArg || ((window.RESTOPOS_CONFIG || {}).updateRepo) || (L.settings() || {}).update_repo || '').replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
  const base = { current: VERSION, repo };
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || /^YOUR-/.test(repo)) return { ...base, configured: false };
  try {
    const r = await fetch('https://api.github.com/repos/' + repo + '/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error('GitHub answered ' + r.status);
    const j = await r.json();
    return { ...base, configured: true, ok: true, latest: j.tag_name, update: newer(j.tag_name, VERSION), notes: String(j.body || '').slice(0, 1500), url: j.html_url, zip: j.zipball_url };
  } catch (e) { return { ...base, configured: true, ok: false, error: e.message }; }
}

export function updateDialog(r) {
  return modal({
    title: '🎉 ' + t('Update available'),
    body: h('div', null,
      h('p', null, t('New version') + ' ', h('b', null, r.latest), ' · ' + t('you have') + ' ' + r.current),
      r.notes ? h('pre', { style: { whiteSpace: 'pre-wrap', maxHeight: '14rem', overflow: 'auto', background: 'var(--surface2, #0001)', padding: '.6rem', borderRadius: '8px', font: 'inherit', fontSize: '.85rem' } }, r.notes) : null,
      h('p', { class: 'muted', style: { marginTop: '.8rem' } }, t('To update: download the new version, copy its files over the old folder (keep the data and clients folders), then restart RestoPOS.'))),
    actions: [
      { label: t('Skip this version'), onClick: () => { try { localStorage.setItem(SKIP, r.latest); } catch (_) { /* ignore */ } } },
      { label: t('Later'), onClick: () => { } },
      { label: '⬇ ' + t('Download update'), kind: 'primary', onClick: () => { window.open(r.url || r.zip, '_blank', 'noopener'); } }
    ]
  });
}

/** once a day, for managers/admins only, never on table or kitchen screens */
let busy = false;
export async function autoCheck() {
  if (busy) return; busy = true;
  try {
    if (!L.can('settings')) return;
    if (Date.now() - Number(localStorage.getItem(LAST) || 0) < 86400000) return;
    const r = await checkUpdate(false);
    if (!r || !r.ok) return;                      // offline / not configured: stay silent
    localStorage.setItem(LAST, String(Date.now()));
    if (r.update && localStorage.getItem(SKIP) !== r.latest) updateDialog(r);
  } catch (_) { /* never bother the user */ } finally { setTimeout(() => { busy = false; }, 5000); }
}
