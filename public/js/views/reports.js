// Reports: sales · GST (GSTR-1 style data) · staff commission, tips & payouts.
import { h, empty, money, num, r2, fmtDate, fmtTime, download, toCSV, sum, now } from '../util.js';
import { store } from '../store.js';
import { t, nameOf } from '../i18n.js';
import { modal, toast, numberDlg, promptDlg, confirmDlg, pickDlg } from '../ui.js';
import * as L from '../logic.js';
import { stateName } from '../gst.js';
import { tabs, dataTable, kpis, rangePicker, newRange, csvBtn } from './kit.js';

export function mount(el) {
  const defs = [['sales', 'Sales', 'reports'], ['gst', 'GST', 'gst_reports'], ['staff', 'Staff earnings', 'staff_reports']].filter(d => L.feature(d[2]) && (d[0] !== 'staff' || L.can('staff_reports')));
  if (!defs.length) { el.append(h('div', { class: 'page' }, h('div', { class: 'empty' }, h('b', null, t('Reports are not enabled for this restaurant.'))))); return {}; }
  let tab = defs[0][0], gtab = 'rate';
  const range = newRange('today');
  const page = h('div', { class: 'page' }); const body = h('div');
  el.append(page);
  page.append(tabs(defs.map(d => ({ id: d[0], label: t(d[1]) })), tab, id => { tab = id; draw(); }), rangePicker(range, () => draw()), body);
  const pm = id => (L.settings().payment_methods.find(m => m.id === id) || { label: id }).label;
  const pct = (a, b) => (b ? Math.round(a * 100 / b) : 0);
  const draw = () => { empty(body); ({ sales: drawSales, gst: drawGst, staff: drawStaff })[tab](); };

  // ───────── sales ─────────
  function drawSales() {
    const r = L.salesReport(range.from, range.to);
    const profit = r.sales - r.tax - r.cogs - r.expenses;
    body.append(kpis([[t('Net sales'), money(r.sales)], [t('Bills'), r.count], [t('Average bill'), money(r.avg)], [t('GST collected'), money(r.tax)], [t('Taxable sales'), money(r.taxable)], [t('Items sold'), r.items],
      [t('Discounts'), money(r.discount), r.memberDisc ? t('of which members {amt}', { amt: money(r.memberDisc) }) : null], [t('Tips'), money(r.tips)], [t('Expenses'), money(r.expenses)],
      L.feature('inventory') ? [t('Est. profit'), money(profit), t('sales − GST − food cost − expenses')] : null, [t('Cancelled bills'), r.cancelledCount], [t('Cancelled items'), r.voidCount]].filter(Boolean)));
    // by day
    if (r.byDay.length > 1) {
      const mx = Math.max(...r.byDay.map(d => d.sales), 1);
      body.append(h('div', { class: 'card', style: { marginBottom: '1rem' } }, h('h3', null, t('Sales by day')), h('div', { class: 'bars', style: { marginBottom: '1.6rem' } }, r.byDay.map(d => h('div', { class: 'bar', style: { height: Math.max(2, d.sales / mx * 100) + '%' }, title: d.day + ' — ' + money(d.sales) + ' (' + d.orders + ')' }, h('span', null, d.day.slice(8)))))));
    }
    const cols = h('div', { class: 'grid2', style: { gap: '1rem', alignItems: 'start' } });
    const cats = [...r.byCat].map(([id, v]) => ({ name: (store.get('categories', id) || {}).name || '—', ...v })).sort((a, b) => b.revenue - a.revenue);
    const totalRev = sum(cats, c => c.revenue);
    cols.append(h('div', { class: 'card' }, h('h3', null, t('By category')), dataTable([{ label: t('Category'), get: c => c.name }, { label: t('Qty'), cls: 'r', get: c => c.qty }, { label: t('Sales'), cls: 'r', get: c => c.revenue, fmt: v => money(v) }, { label: '', get: c => h('div', { class: 'hbar' }, h('i', { style: { width: pct(c.revenue, totalRev) + '%' } })) }], cats)));
    cols.append(h('div', { class: 'card' }, h('h3', null, t('Payment methods')), dataTable([{ label: t('Method'), get: x => pm(x[0]) }, { label: t('Amount'), cls: 'r', get: x => x[1], fmt: v => money(v) }], [...r.byPay]),
      h('h3', { style: { margin: '1rem 0 .5rem' } }, t('Order type')), dataTable([{ label: t('Type'), get: x => t({ dine_in: 'Dine-in', takeaway: 'Takeaway', delivery: 'Delivery' }[x[0]] || x[0]) }, { label: t('Bills'), cls: 'r', get: x => x[1].orders }, { label: t('Sales'), cls: 'r', get: x => x[1].sales, fmt: v => money(v) }], [...r.byType])));
    body.append(cols);
    const hrMax = Math.max(...r.byHour, 1);
    body.append(h('div', { class: 'card', style: { margin: '1rem 0' } }, h('h3', null, t('Busy hours')), h('div', { class: 'bars', style: { marginBottom: '1.6rem' } }, r.byHour.map((v, i) => h('div', { class: 'bar', style: { height: Math.max(2, v / hrMax * 100) + '%' }, title: i + ':00 — ' + money(v) }, h('span', null, i % 2 === 0 ? i : ''))))));
    body.append(h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, t('Items sold')), csvBtn('CSV', 'items.csv', r.byItem, [{ label: 'item', key: 'name' }, { label: 'qty', key: 'qty' }, { label: 'sales', get: i => i.revenue.toFixed(2) }, { label: 'cost', get: i => i.cost.toFixed(2) }])),
      dataTable([{ label: t('Dish'), get: i => i.name }, { label: t('Qty'), cls: 'r', get: i => i.qty }, { label: t('Sales'), cls: 'r', get: i => i.revenue, fmt: v => money(v) }, ...(L.feature('inventory') ? [{ label: t('Food cost'), cls: 'r', get: i => i.cost, fmt: v => money(v) }] : [])], r.byItem.slice(0, 60))));
  }

  // ───────── GST ─────────
  function drawGst() {
    const s = L.settings();
    if (s.gst_scheme !== 'regular') body.append(h('div', { class: 'hint warn' }, t('GST scheme is "{x}" — bills carry no GST. Switch to Regular in Admin → Tax & charges to use GST reports.', { x: s.gst_scheme })));
    if (s.gst_scheme === 'regular' && !s.gstin) body.append(h('div', { class: 'hint warn' }, t('Add your GSTIN under Admin → Restaurant so it prints on invoices and appears in these reports.')));
    const g = L.gstReport(range.from, range.to);
    const T = g.totals;
    body.append(kpis([[t('Invoices'), T.invoices], [t('Taxable value'), money(T.taxable)], ['CGST', money(T.cgst)], ['SGST', money(T.sgst)], ['IGST', money(T.igst)], [t('Total GST'), money(T.tax)], [t('Invoice value'), money(T.total)]]));
    body.append(tabs([['rate', t('Rate-wise summary')], ['hsn', 'HSN / SAC'], ['b2b', t('B2B invoices')], ['b2c', t('B2C by state')], ['docs', t('Documents issued')], ['reg', t('Invoice register')]].map(([id, label]) => ({ id, label })), gtab, id => { gtab = id; drawG(); }));
    body.append(h('div', { id: 'gbody' }));
    body.append(h('p', { class: 'muted', style: { marginTop: '.8rem' } }, t('Tip: figures are calculated per invoice and rate. Always confirm with your CA before filing; rounding can differ by a few paise.')));
    const pos = x => (x ? x + '-' + stateName(x) : '');
    function drawG() {
      const box = body.querySelector('#gbody'); empty(box);
      const rd = v => v.toFixed(2);
      if (gtab === 'rate') {
        box.append(dataTable([{ label: 'GST %', get: x => x.rate + '%' }, { label: t('Taxable value'), cls: 'r', get: x => x.taxable, fmt: money }, { label: 'CGST', cls: 'r', get: x => x.cgst, fmt: money }, { label: 'SGST', cls: 'r', get: x => x.sgst, fmt: money }, { label: 'IGST', cls: 'r', get: x => x.igst, fmt: money }, { label: t('Total GST'), cls: 'r', get: x => x.tax, fmt: money }], g.byRate, { empty: t('No invoices in this period'), foot: ['', money(T.taxable), money(T.cgst), money(T.sgst), money(T.igst), money(T.tax)] }));
      } else if (gtab === 'hsn') {
        const rows = g.hsn;
        box.append(h('div', { class: 'toolbar' }, csvBtn('CSV (GSTR-1 table 12)', 'gstr1-hsn.csv', rows, [{ label: 'HSN', key: 'hsn' }, { label: 'Description', get: x => (x.hsn === '996331' ? 'Restaurant services' : '') }, { label: 'UQC', get: () => 'NOS-NUMBERS' }, { label: 'Total Quantity', key: 'qty' }, { label: 'Total Value', get: x => rd(x.taxable + x.tax) }, { label: 'Rate', key: 'rate' }, { label: 'Taxable Value', get: x => rd(x.taxable) }, { label: 'Integrated Tax Amount', get: x => rd(x.igst) }, { label: 'Central Tax Amount', get: x => rd(x.cgst) }, { label: 'State/UT Tax Amount', get: x => rd(x.sgst) }, { label: 'Cess Amount', get: () => '0' }])));
        box.append(dataTable([{ label: 'HSN / SAC', get: x => x.hsn }, { label: 'GST %', cls: 'r', get: x => x.rate + '%' }, { label: t('Qty'), cls: 'r', get: x => x.qty }, { label: t('Taxable value'), cls: 'r', get: x => x.taxable, fmt: money }, { label: 'CGST', cls: 'r', get: x => x.cgst, fmt: money }, { label: 'SGST', cls: 'r', get: x => x.sgst, fmt: money }, { label: 'IGST', cls: 'r', get: x => x.igst, fmt: money }], rows, { empty: t('No invoices in this period') }));
      } else if (gtab === 'b2b') {
        const rows = []; for (const i of g.b2b) for (const gr of (i.order.totals.groups || [])) rows.push({ i, gr });
        box.append(h('div', { class: 'toolbar' }, csvBtn('CSV (GSTR-1 table 4)', 'gstr1-b2b.csv', rows, [{ label: 'GSTIN/UIN of Recipient', get: x => x.i.gstin }, { label: 'Receiver Name', get: x => x.i.customer }, { label: 'Invoice Number', get: x => x.i.no }, { label: 'Invoice date', get: x => x.i.date }, { label: 'Invoice Value', get: x => rd(x.i.total) }, { label: 'Place Of Supply', get: x => pos(x.i.pos) }, { label: 'Reverse Charge', get: () => 'N' }, { label: 'Invoice Type', get: () => 'Regular' }, { label: 'Rate', get: x => x.gr.rate }, { label: 'Taxable Value', get: x => rd(x.gr.taxable) }, { label: 'Cess Amount', get: () => '0' }])));
        box.append(dataTable([{ label: t('Invoice'), get: i => i.no }, { label: t('Date'), get: i => i.date }, { label: 'GSTIN', get: i => i.gstin }, { label: t('Customer'), get: i => i.customer }, { label: t('Place of supply'), get: i => pos(i.pos) }, { label: t('Taxable value'), cls: 'r', get: i => i.taxable, fmt: money }, { label: t('Total GST'), cls: 'r', get: i => i.tax, fmt: money }, { label: t('Invoice value'), cls: 'r', get: i => i.total, fmt: money }], g.b2b, { empty: t('No B2B invoices (add the customer GSTIN while billing)') }));
      } else if (gtab === 'b2c') {
        box.append(h('div', { class: 'toolbar' }, csvBtn('CSV (GSTR-1 table 7)', 'gstr1-b2cs.csv', g.b2cs, [{ label: 'Type', get: () => 'OE' }, { label: 'Place Of Supply', get: x => pos(x.pos) }, { label: 'Rate', key: 'rate' }, { label: 'Taxable Value', get: x => rd(x.taxable) }, { label: 'Cess Amount', get: () => '0' }, { label: 'E-Commerce GSTIN', get: () => '' }])));
        box.append(dataTable([{ label: t('Place of supply'), get: x => pos(x.pos) }, { label: 'GST %', cls: 'r', get: x => x.rate + '%' }, { label: t('Taxable value'), cls: 'r', get: x => x.taxable, fmt: money }, { label: 'CGST', cls: 'r', get: x => x.cgst, fmt: money }, { label: 'SGST', cls: 'r', get: x => x.sgst, fmt: money }, { label: 'IGST', cls: 'r', get: x => x.igst, fmt: money }], g.b2cs, { empty: t('No invoices in this period') }));
      } else if (gtab === 'docs') {
        box.append(h('div', { class: 'toolbar' }, csvBtn('CSV (GSTR-1 table 13)', 'gstr1-docs.csv', g.docs, [{ label: 'Nature of Document', get: () => 'Invoices for outward supply' }, { label: 'Sr. No. From', get: d => d.from }, { label: 'Sr. No. To', get: d => d.to }, { label: 'Total Number', get: d => d.total }, { label: 'Cancelled', get: d => d.cancelled }])));
        box.append(dataTable([{ label: t('Series (financial year)'), get: d => d.fy }, { label: t('From no.'), cls: 'r', get: d => d.from }, { label: t('To no.'), cls: 'r', get: d => d.to }, { label: t('Total'), cls: 'r', get: d => d.total }, { label: t('Cancelled'), cls: 'r', get: d => d.cancelled }], g.docs, { empty: t('No invoices in this period') }));
      } else {
        box.append(h('div', { class: 'toolbar' }, csvBtn('CSV', 'invoice-register.csv', g.invoices, [{ label: 'Invoice', get: i => i.no }, { label: 'Date', get: i => i.date }, { label: 'Type', key: 'type' }, { label: 'GSTIN', key: 'gstin' }, { label: 'Customer', key: 'customer' }, { label: 'Taxable', get: i => rd(i.taxable) }, { label: 'CGST', get: i => rd(i.cgst) }, { label: 'SGST', get: i => rd(i.sgst) }, { label: 'IGST', get: i => rd(i.igst) }, { label: 'Round off', get: i => rd(i.rounding || 0) }, { label: 'Total', get: i => rd(i.total) }, { label: 'Tip (not taxable)', get: i => rd(i.tip) }])));
        box.append(dataTable([{ label: t('Invoice'), get: i => i.no }, { label: t('Date'), get: i => i.date }, { label: t('Type'), get: i => i.type }, { label: t('Taxable value'), cls: 'r', get: i => i.taxable, fmt: money }, { label: 'CGST', cls: 'r', get: i => i.cgst, fmt: money }, { label: 'SGST', cls: 'r', get: i => i.sgst, fmt: money }, { label: 'IGST', cls: 'r', get: i => i.igst, fmt: money }, { label: t('Total'), cls: 'r', get: i => i.total, fmt: money }], g.invoices, { empty: t('No invoices in this period') }));
        if (g.cancelled.length) box.append(h('p', { class: 'muted', style: { marginTop: '.6rem' } }, t('{n} cancelled invoice(s) in this period: {list}', { n: g.cancelled.length, list: g.cancelled.map(o => L.billNoLabel(o)).join(', ') })));
      }
    }
    drawG();
  }

  // ───────── staff earnings ─────────
  function drawStaff() {
    const e = L.earningsReport(range.from, range.to);
    const cm = L.feature('commission'), tp = L.feature('tips');
    const tipsTotal = sum(e.staff, x => x.tips), commTotal = sum(e.staff, x => x.commission), partnerTotal = sum(e.partners, x => x.commission);
    body.append(kpis([[t('Staff sales'), money(sum(e.staff, x => x.sales))], cm ? [t('Staff commission'), money(commTotal)] : null, tp ? [t('Tips'), money(tipsTotal)] : null, cm && e.partners.length ? [t('Partner commission'), money(partnerTotal)] : null].filter(Boolean)));
    const cols = [{ label: t('Staff'), get: x => h('div', null, h('b', null, x.name), h('div', { class: 'muted' }, t(x.role ? x.role[0].toUpperCase() + x.role.slice(1) : ''))) }, { label: t('Bills'), cls: 'r', get: x => x.orders }, { label: t('Net sales'), cls: 'r', get: x => x.sales, fmt: money }];
    if (cm) cols.push({ label: t('Commission'), cls: 'r', get: x => x.commission, fmt: money }, { label: t('Paid'), cls: 'r', get: x => x.commPaid, fmt: money }, { label: t('Balance due'), cls: 'r', get: x => L.outstanding('commission', x.id), fmt: v => h('b', { style: { color: v > 0.009 ? 'var(--warn)' : '' } }, money(v)) });
    if (tp) cols.push({ label: t('Tips'), cls: 'r', get: x => x.tips, fmt: money }, { label: t('Tips paid'), cls: 'r', get: x => x.tipPaid, fmt: money }, { label: t('Tips due'), cls: 'r', get: x => L.outstanding('tip', x.id), fmt: v => h('b', { style: { color: v > 0.009 ? 'var(--warn)' : '' } }, money(v)) });
    cols.push({ label: '', get: x => h('div', { class: 'row wrap' }, cm ? h('button', { class: 'btn sm', onClick: () => payout('commission', x.id, x.name) }, t('Pay commission')) : null, tp ? h('button', { class: 'btn sm', onClick: () => payout('tip', x.id, x.name) }, t('Pay tips')) : null) });
    body.append(h('div', { class: 'card', style: { marginBottom: '1rem' } }, h('div', { class: 'card-h' }, h('h3', null, t('Waiters & cashiers')), csvBtn('CSV', 'staff-earnings.csv', e.staff, [{ label: 'staff', key: 'name' }, { label: 'bills', key: 'orders' }, { label: 'net_sales', key: 'sales' }, { label: 'commission', key: 'commission' }, { label: 'tips', key: 'tips' }])), dataTable(cols, e.staff, { empty: t('No staff sales in this period') }),
      h('p', { class: 'muted', style: { marginTop: '.5rem' } }, t('Commission is on net sales before GST and service charge, after discounts. Set rates under Admin → Staff, or per dish under Menu.'))));
    if (cm && (e.partners.length || L.partners().length)) {
      body.append(h('div', { class: 'card', style: { marginBottom: '1rem' } }, h('h3', null, t('Delivery partners & agents')), dataTable([{ label: t('Partner'), get: x => h('b', null, x.name) }, { label: t('Orders'), cls: 'r', get: x => x.orders }, { label: t('Order value'), cls: 'r', get: x => x.sales, fmt: money }, { label: t('Commission payable'), cls: 'r', get: x => x.commission, fmt: money }, { label: t('Paid'), cls: 'r', get: x => x.paid, fmt: money }, { label: t('Balance due'), cls: 'r', get: x => L.outstanding('partner', x.id), fmt: money }, { label: '', get: x => h('button', { class: 'btn sm', onClick: () => payout('partner', x.id, x.name) }, t('Record payment')) }], e.partners, { empty: t('No partner orders in this period') })));
    }
    body.append(h('div', { class: 'card' }, h('h3', null, t('Payout history')), dataTable([{ label: t('Date'), get: p => fmtDate(p.at) + ' ' + fmtTime(p.at) }, { label: t('To'), get: p => p.kind === 'partner' ? (store.get('partners', p.who) || {}).name : L.userName(p.who) }, { label: t('For'), get: p => t({ commission: 'Commission', tip: 'Tips', partner: 'Partner commission' }[p.kind]) }, { label: t('Note'), get: p => p.note || '' }, { label: t('By'), get: p => L.userName(p.by) }, { label: t('Amount'), cls: 'r', get: p => p.amount, fmt: money }], e.payouts, { empty: t('No payouts recorded in this period') })));
  }
  async function payout(kind, who, name) {
    const due = L.outstanding(kind, who);
    const v = await numberDlg({ title: name + ' — ' + t({ commission: 'Pay commission', tip: 'Pay tips', partner: 'Record payment' }[kind]), hint: t('Balance due: {amt}', { amt: money(due) }), value: due > 0 ? String(due) : '', quick: due > 0 ? [due] : null });
    if (v === null || v <= 0) return;
    const note = await promptDlg({ title: t('Note (optional)'), label: t('Note (optional)'), placeholder: t('e.g. paid in cash') });
    if (note === null) return;
    L.recordPayout({ kind, who, amount: v, note, userId: L.session.user.id });
    toast(t('Payout recorded'), 'ok'); draw();
  }
  draw();
  return {};
}
