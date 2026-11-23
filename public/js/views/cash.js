// Cash & expenses: cashier shifts (opening / closing count), expenses, day-end (Z) report.
import { h, empty, money, num, uid, parseNum, fmtDate, fmtTime, now, download, toCSV } from '../util.js';
import { store } from '../store.js';
import { t } from '../i18n.js';
import { modal, toast, confirmDlg, field, numberDlg, promptDlg } from '../ui.js';
import * as L from '../logic.js';
import { tabs, dataTable, kpis, rangePicker, newRange, csvBtn } from './kit.js';
import { printRows } from '../print.js';

export function mount(el) {
  const user = L.session.user;
  const avail = [['shift', 'Shift', 'shifts'], ['exp', 'Expenses', 'expenses'], ['day', 'Day close', null]].filter(x => !x[2] || L.feature(x[2]));
  let tab = avail[0][0];
  const range = newRange('today');
  let dayStr = L.today();
  const page = h('div', { class: 'page' }); const body = h('div');
  el.append(page);
  page.append(tabs(avail.map(a => ({ id: a[0], label: t(a[1]) })), tab, id => { tab = id; draw(); }), body);
  const pm = id => (L.settings().payment_methods.find(m => m.id === id) || { label: id }).label;

  function draw() { empty(body); ({ shift: drawShift, exp: drawExp, day: drawDay })[tab](); }

  // ───── shift ─────
  function drawShift() {
    const sh = L.currentShift();
    if (!sh) {
      body.append(h('div', { class: 'card center' }, h('h2', null, t('No shift open')), h('p', { class: 'muted', style: { margin: '.4rem 0 1rem' } }, t('Open a shift with the cash in the drawer. All cash bills you take are counted against it.')),
        h('button', { class: 'btn primary lg', onClick: async () => { const v = await numberDlg({ title: t('Opening cash in drawer'), value: '', quick: [0, 500, 1000, 2000] }); if (v !== null) { L.openShift(user.id, v); toast(t('Shift opened'), 'ok'); draw(); } } }, t('Open shift'))));
    } else {
      const sm = L.shiftSummary(sh);
      body.append(h('div', { class: 'card' }, h('div', { class: 'row sp wrap' }, h('div', null, h('h2', null, t('Your shift')), h('p', { class: 'muted' }, t('Since {time}', { time: fmtDate(sh.opened_at) + ' ' + fmtTime(sh.opened_at) }))), h('button', { class: 'btn danger lg', onClick: () => closeDlg(sh) }, t('Close shift'))),
        kpis([[t('Bills'), sm.count], [t('Sales'), money(sm.sales)], [t('Tips'), money(sm.tips)], [t('Opening cash'), money(sh.opening_cash)], [t('Cash received'), money(sm.cashIn)], [t('Cash expenses'), money(sm.cashOut)], [t('Cash expected in drawer'), money(sm.expected)]]),
        h('h3', { style: { margin: '.4rem 0' } }, t('Received by method')),
        dataTable([{ label: t('Method'), get: r => pm(r[0]) }, { label: t('Amount'), cls: 'r', get: r => r[1], fmt: v => money(v) }], Object.entries(sm.by), { empty: t('No payments yet') })));
    }
    const past = L.shifts().filter(x => x.closed_at).slice(0, 30);
    if (past.length) body.append(h('h3', { style: { margin: '1.2rem 0 .5rem' } }, t('Previous shifts')), dataTable([
      { label: t('Cashier'), get: s => L.userName(s.user_id) }, { label: t('Opened'), get: s => fmtDate(s.opened_at) + ' ' + fmtTime(s.opened_at) }, { label: t('Closed'), get: s => fmtTime(s.closed_at) },
      { label: t('Sales'), cls: 'r', get: s => s.sales || 0, fmt: v => money(v) }, { label: t('Expected cash'), cls: 'r', get: s => s.expected_cash, fmt: v => money(v) }, { label: t('Counted'), cls: 'r', get: s => s.counted_cash, fmt: v => money(v) },
      { label: t('Difference'), cls: 'r', get: s => s.diff || 0, fmt: v => h('b', { style: { color: Math.abs(v) < 0.01 ? 'var(--ok)' : 'var(--bad)' } }, (v > 0 ? '+' : '') + money(v)) }
    ], past));
  }
  async function closeDlg(sh) {
    const sm = L.shiftSummary(sh);
    const v = await numberDlg({ title: t('Count the cash in the drawer'), hint: t('Expected {amt}', { amt: money(sm.expected) }), value: '', quick: [sm.expected] });
    if (v === null) return;
    const note = Math.abs(v - sm.expected) > 0.009 ? await promptDlg({ title: t('Cash difference') + ': ' + money(v - sm.expected), label: t('Note (optional)') }) : '';
    if (note === null) return;
    L.closeShift(sh, v, note); toast(t('Shift closed'), 'ok'); draw();
  }

  // ───── expenses ─────
  function drawExp() {
    const cats = L.settings().expense_categories;
    const cat = h('select', null, cats.map(c => h('option', { value: c }, c)));
    const amt = h('input', { type: 'text', inputmode: 'decimal', 'data-kb': 'num', placeholder: '0.00' });
    const note = h('input', { type: 'text', placeholder: t('What was it for?') }), vendor = h('input', { type: 'text', placeholder: t('Paid to (optional)') });
    const via = h('select', null, [['cash', t('Cash from drawer')], ['upi', 'UPI'], ['bank', t('Bank / card')]].map(([v, l]) => h('option', { value: v }, l)));
    body.append(h('div', { class: 'card', style: { marginBottom: '1rem' } }, h('h3', null, t('Add expense')), h('div', { class: 'form-row', style: { marginTop: '.6rem' } }, field(t('Category'), cat), field(t('Amount'), amt), field(t('Paid by'), via), field(t('Note'), note), field(t('Paid to'), vendor),
      h('button', { class: 'btn primary', style: { marginBottom: '.9rem' }, onClick: () => { const a = parseNum(amt.value); if (!(a > 0)) return toast(t('Enter the amount'), 'warn'); L.addExpense({ category: cat.value, amount: a, note: note.value.trim(), paid_via: via.value, vendor: vendor.value.trim(), userId: user.id }); toast(t('Expense saved'), 'ok'); draw(); } }, t('Save')))));
    body.append(rangePicker(range, () => draw2()), h('div', { id: 'elist' })); draw2();
  }
  function draw2() {
    const box = body.querySelector('#elist'); if (!box) return; empty(box);
    const list = L.expenses().filter(e => e.day >= range.from && e.day <= range.to);
    const tot = list.reduce((a, e) => a + e.amount, 0);
    box.append(h('div', { class: 'row sp', style: { marginBottom: '.5rem' } }, h('b', null, t('Total') + ': ' + money(tot)), csvBtn('CSV', 'expenses.csv', list, [{ label: 'date', get: e => e.day }, { label: 'category', key: 'category' }, { label: 'amount', key: 'amount' }, { label: 'paid_via', key: 'paid_via' }, { label: 'vendor', key: 'vendor' }, { label: 'note', key: 'note' }])));
    box.append(dataTable([{ label: t('Date'), get: e => e.day + ' ' + fmtTime(e.at) }, { label: t('Category'), get: e => e.category }, { label: t('Note'), get: e => [e.note, e.vendor].filter(Boolean).join(' · ') }, { label: t('Paid by'), get: e => e.paid_via }, { label: t('By'), get: e => L.userName(e.by) }, { label: t('Amount'), cls: 'r', get: e => e.amount, fmt: v => money(v) },
      { label: '', get: e => L.can('void') ? h('button', { class: 'btn sm ghost', onClick: async () => { if (await confirmDlg(t('Delete this expense?'), { danger: true, ok: t('Delete') })) { store.del('expenses', e.id); draw2(); } } }, '🗑') : '' }], list, { empty: t('No expenses in this period') }));
  }

  // ───── day close (Z report) ─────
  function drawDay() {
    const d = h('input', { type: 'date', value: dayStr, style: { width: 'auto' }, onChange: e => { dayStr = e.target.value; draw(); } });
    const r = L.salesReport(dayStr, dayStr);
    const g = L.gstReport(dayStr, dayStr);
    const rows = [
      [t('Bills'), r.count], [t('Items sold'), r.items], [t('Gross items total'), money(r.orders.reduce((a, o) => a + ((o.totals || {}).subtotal || 0), 0))], [t('Discounts'), money(r.discount)], [t('Taxable value'), money(g.totals.taxable)],
      ['CGST', money(g.totals.cgst)], ['SGST', money(g.totals.sgst)], ['IGST', money(g.totals.igst)], [t('Net sales (incl. GST)'), money(r.sales)], [t('Tips (not in sales)'), money(r.tips)], [t('Expenses'), money(r.expenses)], [t('Cancelled bills'), r.cancelledCount], [t('Items cancelled after ordering'), r.voidCount]
    ];
    body.append(h('div', { class: 'toolbar' }, d, h('span', { class: 'spacer' }), h('button', { class: 'btn', onClick: () => {
      const tick = [{ head: fmtDate(Date.now()) + ' — ' + dayStr }, ...rows.map(x => [String(x[0]), String(x[1])]), '-', { head: t('Payments received') }, ...[...r.byPay].map(([m, a]) => [pm(m), money(a)]), '-', { head: t('GST by rate') }, ...g.byRate.map(x => [x.rate + '% ' + t('taxable'), money(x.taxable)]).concat(g.byRate.map(x => [x.rate + '% GST', money(x.tax)]))];
      printRows(t('Day-end report'), tick).catch(e => toast(e.message, 'bad', 5000));
    } }, '🖨 ', t('Print'))));
    body.append(kpis([[t('Net sales'), money(r.sales)], [t('Bills'), r.count], [t('GST collected'), money(g.totals.tax)], [t('Tips'), money(r.tips)]]));
    body.append(h('div', { class: 'card' }, dataTable([{ label: t('Summary'), get: x => x[0] }, { label: '', cls: 'r', get: x => x[1] }], rows)));
    body.append(h('h3', { style: { margin: '1rem 0 .5rem' } }, t('Payments received')), dataTable([{ label: t('Method'), get: x => pm(x[0]) }, { label: t('Amount'), cls: 'r', get: x => x[1], fmt: v => money(v) }], [...r.byPay], { empty: t('No payments') }));
  }
  draw();
  return {};
}
