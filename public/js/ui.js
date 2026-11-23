// Dialogs, toasts, sounds. Everything is touch-sized and keyboard friendly (Enter = OK, Esc = cancel).
import { h, empty, parseNum } from './util.js';
import { t } from './i18n.js';

const stack = [];
let toastBox = null;

function modalRoot() {
  let r = document.getElementById('modal-root');
  if (!r) { r = h('div', { id: 'modal-root' }); document.body.append(r); }
  return r;
}

/**
 * modal({title, body, actions:[{label, kind, onClick(close)}], size:'sm'|'md'|'lg'|'xl', dismiss:true})
 * returns {close, el, body}
 */
export function modal({ title, body, actions = [], size = 'md', dismiss = true, onClose, cls = '' }) {
  const wrap = h('div', { class: 'modal-wrap' });
  const box = h('div', { class: 'modal ' + size + ' ' + cls, role: 'dialog', 'aria-modal': 'true' });
  const bodyEl = h('div', { class: 'modal-body' }, body);
  const m = { el: wrap, body: bodyEl, closed: false };
  m.close = (val) => {
    if (m.closed) return;
    m.closed = true;
    const i = stack.indexOf(m); if (i >= 0) stack.splice(i, 1);
    wrap.classList.add('out');
    setTimeout(() => wrap.remove(), 120);
    onClose && onClose(val);
  };
  const head = title ? h('div', { class: 'modal-head' }, h('h3', null, title), dismiss ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Close'), onClick: () => m.close() }, '✕') : null) : null;
  const foot = actions.length ? h('div', { class: 'modal-foot' }, actions.map(a => {
    const b = h('button', { type: 'button', class: 'btn ' + (a.kind || ''), disabled: a.disabled, onClick: async () => { if (a.onClick) { const r = await a.onClick(m.close, b); if (r === false) return; } else m.close(); } }, a.label);
    return b;
  })) : null;
  box.append(...[head, bodyEl, foot].filter(Boolean));
  wrap.append(box);
  if (dismiss) wrap.addEventListener('pointerdown', e => { if (e.target === wrap) m.close(); });
  modalRoot().append(wrap);
  stack.push(m);
  m.dismiss = dismiss;
  const first = box.querySelector('input,textarea,select');
  if (first && !matchMedia('(pointer: coarse)').matches) setTimeout(() => first.focus(), 30);
  return m;
}
document.addEventListener('keydown', e => {
  const m = stack[stack.length - 1];
  if (!m) return;
  if (e.key === 'Escape' && m.dismiss) { e.stopPropagation(); m.close(); }
  if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA' && !e.target.closest('.no-enter')) {
    const primary = m.el.querySelector('.modal-foot .btn.primary:not([disabled]),.modal-foot .btn.danger:not([disabled])');
    if (primary && e.target.tagName !== 'BUTTON') { e.preventDefault(); primary.click(); }
  }
}, true);
export const closeAllModals = () => { while (stack.length) stack[stack.length - 1].close(); };
export const topModal = () => stack[stack.length - 1];

export function confirmDlg(message, { ok, cancel, danger = false, title } = {}) {
  return new Promise(res => {
    modal({
      title: title || null, size: 'sm', dismiss: true, body: h('p', { class: 'dlg-msg' }, message),
      onClose: v => res(v === true),
      actions: [{ label: cancel || t('Cancel'), kind: 'ghost' }, { label: ok || t('OK'), kind: danger ? 'danger' : 'primary', onClick: c => c(true) }]
    });
  });
}
export function alertDlg(message, title) {
  return new Promise(res => modal({ title, size: 'sm', body: h('p', { class: 'dlg-msg' }, message), onClose: () => res(), actions: [{ label: t('OK'), kind: 'primary' }] }));
}
export function promptDlg({ title, label, value = '', placeholder = '', multiline = false, ok, kb }) {
  return new Promise(res => {
    const inp = multiline ? h('textarea', { rows: 3, value, placeholder }) : h('input', { type: 'text', value, placeholder, 'data-kb': kb || null });
    modal({
      title, size: 'sm', body: h('label', { class: 'field' }, label ? h('span', null, label) : null, inp),
      onClose: v => res(typeof v === 'string' ? v : null),
      actions: [{ label: t('Cancel'), kind: 'ghost' }, { label: ok || t('OK'), kind: 'primary', onClick: c => c(inp.value) }]
    });
  });
}

/** Numeric entry with a big keypad. Resolves to a number or null. */
export function numberDlg({ title, value = '', decimals = true, hint, ok, quick, suffix }) {
  return new Promise(res => {
    let v = String(value ?? '');
    const disp = h('div', { class: 'np-display' });
    const draw = () => { disp.textContent = (v === '' ? '0' : v) + (suffix ? ' ' + suffix : ''); };
    const press = k => {
      if (k === '⌫') v = v.slice(0, -1);
      else if (k === 'C') v = '';
      else if (k === '.') { if (!decimals || v.includes('.')) return; v = (v || '0') + '.'; }
      else { if (v === '0') v = ''; if (v.length > 9) return; v += k; }
      draw();
    };
    const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', decimals ? '.' : 'C', '0', '⌫'];
    const pad = h('div', { class: 'np-pad' }, keys.map(k => h('button', { type: 'button', class: 'np-key' + (k === '⌫' || k === 'C' ? ' fn' : ''), onClick: () => press(k) }, k)));
    const quickRow = quick ? h('div', { class: 'np-quick' }, quick.map(q => h('button', { type: 'button', class: 'chip', onClick: () => { v = String(q); draw(); } }, String(q)))) : null;
    const onKey = e => {
      if (/^[0-9]$/.test(e.key)) press(e.key); else if (e.key === '.' || e.key === ',') press('.'); else if (e.key === 'Backspace') press('⌫');
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey, true);
    draw();
    modal({
      title, size: 'sm', cls: 'np', body: h('div', { class: 'no-enter' }, hint ? h('p', { class: 'muted center' }, hint) : null, disp, quickRow, pad),
      onClose: val => { document.removeEventListener('keydown', onKey, true); res(typeof val === 'number' ? val : null); },
      actions: [{ label: t('Cancel'), kind: 'ghost' }, { label: ok || t('OK'), kind: 'primary', onClick: c => c(parseNum(v)) }]
    });
  });
}

/** Choose one option from a list of big buttons. */
export function pickDlg({ title, options, cancel = true }) {
  return new Promise(res => {
    modal({
      title, size: 'sm', onClose: v => res(v === undefined ? null : v),
      body: h('div', { class: 'pick' }, options.map(o => h('button', { type: 'button', class: 'pick-opt' + (o.danger ? ' danger' : ''), onClick: () => { const m = topModal(); m.close(o.value); } }, h('b', null, o.label), o.sub ? h('small', null, o.sub) : null))),
      actions: cancel ? [{ label: t('Cancel'), kind: 'ghost' }] : []
    });
  });
}

export function toast(msg, kind = 'info', ms = 3200) {
  if (!toastBox) { toastBox = h('div', { class: 'toasts', 'aria-live': 'polite' }); document.body.append(toastBox); }
  const el = h('div', { class: 'toast ' + kind }, msg);
  toastBox.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 200); }, ms);
}

// ── sound (WebAudio; unlocked by the first tap) ──
let actx = null;
let soundOn = localStorage.getItem('restopos.sound') !== '0';
export const isSoundOn = () => soundOn;
export function setSound(on) { soundOn = on; localStorage.setItem('restopos.sound', on ? '1' : '0'); }
export function unlockAudio() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch (_) { /* no audio */ }
  return actx && actx.state === 'running';
}
['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, unlockAudio, { passive: true }));
export function audioReady() { return !!actx && actx.state === 'running'; }
export function beep(kind = 'new') {
  if (!soundOn || !actx || actx.state !== 'running') return;
  const seqs = { new: [[880, .14], [1175, .22]], ready: [[660, .12], [880, .12], [1320, .24]], call: [[988, .16], [988, .16], [1319, .26]], ok: [[1046, .1]], err: [[220, .28]] };
  let at = actx.currentTime + 0.01;
  for (const [f, d] of seqs[kind] || seqs.new) {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.35, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + d);
    o.connect(g).connect(actx.destination); o.start(at); o.stop(at + d + 0.02);
    at += d + 0.03;
  }
}

// ── small widgets ──
export function stepper(value, { min = 1, max = 99, onChange }) {
  const val = h('span', { class: 'stp-val' }, String(value));
  const set = n => { n = Math.max(min, Math.min(max, n)); value = n; val.textContent = n; onChange && onChange(n); };
  const el = h('div', { class: 'stepper' },
    h('button', { type: 'button', class: 'stp', 'aria-label': '−', onClick: () => set(value - 1) }, '−'), val,
    h('button', { type: 'button', class: 'stp', 'aria-label': '+', onClick: () => set(value + 1) }, '+'));
  el.get = () => value; el.set = set;
  return el;
}
export function switchEl(checked, onChange, label) {
  const i = h('input', { type: 'checkbox', checked: !!checked, onChange: () => onChange && onChange(i.checked) });
  return h('label', { class: 'switch' }, i, h('span', { class: 'track' }), label ? h('span', { class: 'lbl' }, label) : null);
}
export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', null, label), input, hint ? h('small', { class: 'muted' }, hint) : null);
}
export function seg(options, value, onChange) {
  const el = h('div', { class: 'seg', role: 'tablist' });
  const draw = () => { empty(el); options.forEach(o => el.append(h('button', { type: 'button', class: 'seg-b' + (o.value === value ? ' on' : ''), onClick: () => { value = o.value; draw(); onChange(value); } }, o.label))); };
  draw();
  return el;
}
export function emptyState(title, text, action) {
  return h('div', { class: 'empty' }, h('b', null, title), text ? h('p', null, text) : null, action || null);
}
