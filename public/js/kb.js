// On-screen touch keyboard + numeric keypad.
// • Works with mouse and a physical keyboard too — the real keyboard is never blocked.
// • mode 'on'  : always show for text fields
//   mode 'auto': show on touch screens until a physical key is pressed
//   mode 'off' : never (native OS keyboard / physical keyboard only)
import { h, empty } from './util.js';
import { t, getLang, onLang } from './i18n.js';

const LS = 'restopos.kb';
let mode = localStorage.getItem(LS) || 'auto';
let hwSeen = false;
let root = null, body = null, target = null;
let shift = false, layer = 'alpha', lang = 'en';
let repeatT = null, repeatI = null;

export const getKbMode = () => mode;
export function setKbMode(m) {
  mode = m; localStorage.setItem(LS, m);
  if (!isEnabled()) hide(); else if (document.activeElement && isField(document.activeElement)) show(document.activeElement);
}
function isEnabled() {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return matchMedia('(pointer: coarse)').matches && !hwSeen;
}
const isField = el => el && ((el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|file|color|range|date|time|datetime-local)$/.test(el.type)) || el.tagName === 'TEXTAREA') && !el.readOnly && !el.disabled;
function layoutFor(el) {
  const k = el.dataset.kb;
  if (k === 'num' || k === 'pin') return k;
  const im = el.getAttribute('inputmode') || el.dataset.im || '';
  if (/^(numeric|decimal|tel)$/.test(im) || el.type === 'number' || el.type === 'tel') return 'num';
  return 'text';
}

const ROWS = {
  en: [['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'], ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'], ['z', 'x', 'c', 'v', 'b', 'n', 'm']],
  // Hindi: varnamala order (easy for anyone who learned Hindi at school), with a second page for matras
  hi: [['अ', 'आ', 'इ', 'ई', 'उ', 'ऊ', 'ऋ', 'ए', 'ऐ', 'ओ', 'औ'], ['क', 'ख', 'ग', 'घ', 'च', 'छ', 'ज', 'झ', 'ट', 'ठ', 'ड'], ['ढ', 'ण', 'त', 'थ', 'द', 'ध', 'न', 'प', 'फ', 'ब', 'भ'], ['म', 'य', 'र', 'ल', 'व', 'श', 'ष', 'स', 'ह', 'ळ', 'ड़']],
  hiM: [['ा', 'ि', 'ी', 'ु', 'ू', 'े', 'ै', 'ो', 'ौ', 'ं', 'ः'], ['ँ', '्', '़', 'ृ', 'ॉ', 'ज्ञ', 'क्ष', 'त्र', 'श्र', 'ढ़', 'फ़'], ['ज़', 'ख़', 'ग़', 'क़', '।', ',', '.', '-', '/', '(', ')']],
  ur: [['ق', 'و', 'ع', 'ر', 'ت', 'ے', 'ء', 'ی', 'ہ', 'پ'], ['ا', 'س', 'د', 'ف', 'گ', 'ح', 'ج', 'ک', 'ل', 'ن'], ['ز', 'ش', 'چ', 'ط', 'ب', 'م', 'ٹ', 'ڈ', 'ڑ', 'ں'], ['ث', 'ص', 'ض', 'ذ', 'ظ', 'غ', 'خ', 'ھ', 'ژ', 'آ', 'ۓ']],
  sym: [['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], ['-', '/', ':', ';', '(', ')', '@', '&', '#', '%'], ['.', ',', '?', '!', "'", '"', '+', '=', '*']]
};
const NEXT_LANG = { en: 'hi', hi: 'ur', ur: 'en' };
const LANG_KEY = { en: 'EN', hi: 'हिं', ur: 'اردو' };

function build() {
  root = h('div', { class: 'kbd', 'aria-hidden': 'true' });
  root.addEventListener('mousedown', e => e.preventDefault());
  root.addEventListener('touchstart', e => { if (e.target.closest('.k')) e.preventDefault(); }, { passive: false });
  document.body.append(root);
}
function key(label, opts = {}) {
  const b = h('button', { type: 'button', class: 'k' + (opts.cls ? ' ' + opts.cls : ''), tabindex: -1, style: opts.w ? { flexGrow: opts.w } : null }, label);
  const act = e => { e.preventDefault(); opts.fn(); if (opts.repeat) { clearTimeout(repeatT); clearInterval(repeatI); repeatT = setTimeout(() => { repeatI = setInterval(opts.fn, 70); }, 380); } };
  b.addEventListener('pointerdown', act);
  const stop = () => { clearTimeout(repeatT); clearInterval(repeatI); };
  b.addEventListener('pointerup', stop); b.addEventListener('pointerleave', stop); b.addEventListener('pointercancel', stop);
  return b;
}
function render() {
  if (!root) build();
  empty(root);
  const kind = layoutFor(target);
  const rows = [];
  if (kind === 'num' || kind === 'pin') {
    root.classList.add('num');
    const dec = kind === 'num' && target.dataset.int !== '1' && target.getAttribute('inputmode') !== 'numeric' && target.type !== 'tel';
    const mk = c => key(c, { fn: () => type(c) });
    rows.push(h('div', { class: 'kr' }, mk('1'), mk('2'), mk('3')));
    rows.push(h('div', { class: 'kr' }, mk('4'), mk('5'), mk('6')));
    rows.push(h('div', { class: 'kr' }, mk('7'), mk('8'), mk('9')));
    rows.push(h('div', { class: 'kr' },
      dec ? mk('.') : key('', { cls: 'ghost', fn: () => { } }),
      mk('0'),
      key('⌫', { cls: 'fn', fn: back, repeat: true })));
    rows.push(h('div', { class: 'kr' },
      key(t('Hide'), { cls: 'fn', fn: hide }),
      key('↵', { cls: 'go', w: 2, fn: enter })));
  } else {
    root.classList.remove('num');
    const set = layer === 'sym' ? ROWS.sym : layer === 'matra' ? ROWS.hiM : ROWS[lang];
    const cap = c => (lang === 'en' && layer === 'alpha' && shift) ? c.toUpperCase() : c;
    const lastRow = set.length - 1;
    set.forEach((r, i) => {
      const cells = r.map(c => key(cap(c), { fn: () => { type(cap(c)); if (shift && !caps) { shift = false; render(); } } }));
      if (i === lastRow) {
        if (lang === 'en' && layer !== 'matra') cells.unshift(key(layer === 'sym' ? '' : '⇧', { cls: 'fn' + (shift ? ' on' : ''), w: 1.5, fn: () => { if (layer === 'sym') return; shift = !shift; caps = false; render(); } }));
        cells.push(key('⌫', { cls: 'fn', w: 1.5, fn: back, repeat: true }));
      }
      rows.push(h('div', { class: 'kr' }, cells));
    });
    const abc = lang === 'hi' ? 'अ' : lang === 'ur' ? 'ا' : 'ABC';
    rows.push(h('div', { class: 'kr' },
      key(layer === 'sym' ? abc : '123', { cls: 'fn', w: 1.4, fn: () => { layer = layer === 'sym' ? 'alpha' : 'sym'; render(); } }),
      lang === 'hi' ? key(layer === 'matra' ? 'अक' : 'ा ि', { cls: 'fn', w: 1.2, fn: () => { layer = layer === 'matra' ? 'alpha' : 'matra'; render(); } }) : null,
      key(LANG_KEY[NEXT_LANG[lang]], { cls: 'fn', w: 1.2, fn: () => { lang = NEXT_LANG[lang]; layer = 'alpha'; render(); } }),
      key(' ', { cls: 'space', w: 4, fn: () => type(' ') }),
      key('.', { fn: () => type('.') }),
      key(t('Hide'), { cls: 'fn', w: 1.3, fn: hide }),
      key('↵', { cls: 'go', w: 1.5, fn: enter })));
  }
  root.append(...rows);
}
let caps = false;

function type(ch) {
  if (!target) return;
  let s, e;
  try { s = target.selectionStart; e = target.selectionEnd; } catch (_) { s = null; }
  if (s == null) { target.value += ch; } else {
    if (target.dataset.maxlen && target.value.length >= +target.dataset.maxlen && s === e) return;
    target.setRangeText(ch, s, e, 'end');
  }
  target.dispatchEvent(new Event('input', { bubbles: true }));
}
function back() {
  if (!target) return;
  let s, e;
  try { s = target.selectionStart; e = target.selectionEnd; } catch (_) { s = null; }
  if (s == null) target.value = target.value.slice(0, -1);
  else if (s !== e) target.setRangeText('', s, e, 'end');
  else if (s > 0) target.setRangeText('', s - 1, s, 'end');
  target.dispatchEvent(new Event('input', { bubbles: true }));
}
function enter() {
  if (!target) return;
  if (target.tagName === 'TEXTAREA') { type('\n'); return; }
  const ev = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
  const notCancelled = target.dispatchEvent(ev);
  if (notCancelled) {
    target.dispatchEvent(new Event('change', { bubbles: true }));
    const form = target.closest('form');
    if (form) form.requestSubmit ? form.requestSubmit() : form.submit();
  }
  hide();
}

function show(el) {
  if (!isEnabled()) return;
  target = el;
  if (!el.dataset.origIm) el.dataset.origIm = el.getAttribute('inputmode') || '-';
  el.setAttribute('inputmode', 'none');
  lang = layoutFor(el) === 'text' ? getLang() : 'en';
  layer = 'alpha'; shift = false;
  render();
  root.classList.add('open');
  document.body.classList.add('kb-open');
  requestAnimationFrame(() => {
    document.documentElement.style.setProperty('--kb-h', root.offsetHeight + 'px');
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) { /* ignore */ }
  });
}
export function hide() {
  if (!root) return;
  root.classList.remove('open');
  document.body.classList.remove('kb-open');
  document.documentElement.style.setProperty('--kb-h', '0px');
  if (target && target.dataset.origIm) {
    if (target.dataset.origIm === '-') target.removeAttribute('inputmode'); else target.setAttribute('inputmode', target.dataset.origIm);
    delete target.dataset.origIm;
  }
  target = null;
}

export function initKeyboard() {
  onLang(() => { if (root && root.classList.contains('open') && target) render(); });
  document.addEventListener('focusin', e => {
    const el = e.target;
    if (root && root.contains(el)) return;
    if (isField(el)) { if (!(el.dataset.kb === 'off')) show(el); } else hide();
  });
  document.addEventListener('pointerdown', e => {
    if (!root || !root.classList.contains('open')) return;
    if (root.contains(e.target) || (target && e.target === target)) return;
    if (isField(e.target)) return;
    // tapping on empty UI closes the keyboard; buttons still work because pointerdown doesn't cancel clicks
    if (!e.target.closest('input,textarea,label')) { document.activeElement && document.activeElement.blur && document.activeElement.blur(); hide(); }
  }, true);
  window.addEventListener('keydown', e => {
    if (e.isTrusted && !hwSeen && mode === 'auto' && (e.key.length === 1 || /^(Backspace|Tab|Enter|Escape|Arrow)/.test(e.key)) && !(root && root.contains(e.target))) {
      hwSeen = true; hide();
    }
  }, true);
  window.addEventListener('resize', () => { if (root && root.classList.contains('open')) document.documentElement.style.setProperty('--kb-h', root.offsetHeight + 'px'); });
}
