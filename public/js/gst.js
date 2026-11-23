// India GST reference data + GSTIN validation.
export const STATES = [
  ['01', 'Jammu & Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'], ['04', 'Chandigarh'], ['05', 'Uttarakhand'], ['06', 'Haryana'], ['07', 'Delhi'], ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'],
  ['10', 'Bihar'], ['11', 'Sikkim'], ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'], ['15', 'Mizoram'], ['16', 'Tripura'], ['17', 'Meghalaya'], ['18', 'Assam'], ['19', 'West Bengal'],
  ['20', 'Jharkhand'], ['21', 'Odisha'], ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'], ['24', 'Gujarat'], ['26', 'Dadra & Nagar Haveli and Daman & Diu'], ['27', 'Maharashtra'], ['29', 'Karnataka'],
  ['30', 'Goa'], ['31', 'Lakshadweep'], ['32', 'Kerala'], ['33', 'Tamil Nadu'], ['34', 'Puducherry'], ['35', 'Andaman & Nicobar'], ['36', 'Telangana'], ['37', 'Andhra Pradesh'], ['38', 'Ladakh'], ['97', 'Other Territory']
];
export const stateName = code => (STATES.find(s => s[0] === String(code)) || [0, ''])[1];
export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28, 40];
export const UQC = ['NOS', 'KGS', 'LTR', 'PCS', 'PKT', 'BOX', 'GMS', 'OTH'];

const CH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Format + check-digit validation of a 15-character GSTIN. */
export function validGSTIN(g) {
  g = String(g || '').trim().toUpperCase();
  if (!/^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = CH.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return CH[(36 - (sum % 36)) % 36] === g[14];
}
export const gstinState = g => String(g || '').trim().slice(0, 2);
/** Financial year label for a YYYY-MM-DD business day: '2026-04-02' -> '26-27' */
export function fyOf(day) {
  const [y, m] = String(day).split('-').map(Number);
  const fy = m >= 4 ? y : y - 1;
  return String(fy).slice(2) + '-' + String(fy + 1).slice(2);
}
export function fyRange(label) {
  const a = 2000 + Number(label.slice(0, 2));
  return [a + '-04-01', (a + 1) + '-03-31'];
}
export function currentFY(day) { return fyOf(day); }
/** UPI deep link used for the payment QR printed on bills. */
export function upiLink({ vpa, name, amount, note }) {
  const q = new URLSearchParams({ pa: vpa, pn: name || '', am: Number(amount).toFixed(2), cu: 'INR', tn: note || '' });
  return 'upi://pay?' + q.toString().replace(/\+/g, '%20');
}
