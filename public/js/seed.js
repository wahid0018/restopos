// Optional sample data so a new install can be tried in two minutes. Everything is editable or deletable afterwards.
// GST rates here are SAMPLES (restaurant food 5%, packaged drinks 18%) — confirm the rates for your business with your CA.
import { store } from './store.js';
import { uid, hashPin } from './util.js';

export function seedDemo({ withStaff = true } = {}) {
  const A = (name, name_hi, name_ur, sort) => store.put('areas', { id: uid(), name, name_hi, name_ur, sort });
  const hall = A('Main hall', 'मुख्य हॉल', 'مین ہال', 1), fam = A('Family section', 'फैमिली सेक्शन', 'فیملی سیکشن', 2), out = A('Garden', 'गार्डन', 'گارڈن', 3);

  // staff (demo PINs: 1111 2222 3333 4444 5555 — change or delete before going live)
  const U = (name, role, pin, commission_pct, username) => store.put('users', { id: uid(), name, role, pin: hashPin(pin), username, pass: hashPin(pin + pin), commission_pct, active: true, demo: true });
  const staff = withStaff ? {
    rahul: U('Rahul', 'waiter', '1111', 2, 'rahul'), imran: U('Imran', 'waiter', '2222', 2, 'imran'), priya: U('Priya', 'cashier', '3333', '', 'priya'),
    chef: U('Chef Sanjay', 'kitchen', '4444', '', 'chef'), amit: U('Amit (manager)', 'manager', '5555', '', 'amit')
  } : {};
  const mkT = (no, area, seats, w) => store.put('tables', { id: uid(), no: String(no), area_id: area.id, seats, active: true, waiter_id: w ? w.id : null });
  for (let i = 1; i <= 6; i++) mkT(i, hall, i <= 4 ? 4 : 6, staff.rahul);
  for (let i = 7; i <= 10; i++) mkT(i, fam, 6, staff.imran);
  for (let i = 11; i <= 12; i++) mkT(i, out, 4, staff.imran);

  const stock = {};
  const S = (key, name, unit, qty, min, cost) => {
    const r = store.put('stock', { id: uid(), name, unit, min, cost, active: true });
    stock[key] = r.id;
    if (qty) store.put('stock_moves', { id: uid(), stock_id: r.id, qty, type: 'opening', note: 'Opening stock', at: Date.now() });
  };
  S('chicken', 'Chicken', 'kg', 25, 6, 190); S('paneer', 'Paneer', 'kg', 12, 3, 360); S('rice', 'Basmati rice', 'kg', 40, 10, 110); S('atta', 'Atta / maida', 'kg', 30, 8, 42);
  S('tomato', 'Tomato', 'kg', 15, 4, 40); S('onion', 'Onion', 'kg', 20, 5, 35); S('milk', 'Milk', 'L', 25, 6, 56); S('curd', 'Curd', 'kg', 10, 3, 80);
  S('butter', 'Butter', 'kg', 6, 1.5, 560); S('tea', 'Tea leaves', 'kg', 4, 1, 420); S('cola', 'Cold drink bottles', 'pcs', 96, 24, 18); S('water', 'Water bottles', 'pcs', 120, 36, 8);
  S('dal', 'Black dal', 'kg', 10, 3, 130); S('oil', 'Cooking oil', 'L', 30, 8, 125);

  const C = (name, name_hi, name_ur, station, sort) => store.put('categories', { id: uid(), name, name_hi, name_ur, station, sort, active: true });
  const starters = C('Starters', 'स्टार्टर्स', 'اسٹارٹرز', 'kitchen', 1), tandoor = C('Tandoor & Breads', 'तंदूर और रोटी', 'تندور اور روٹی', 'tandoor', 2), mains = C('Main course', 'मुख्य व्यंजन', 'مین کورس', 'kitchen', 3),
    drinks = C('Beverages', 'पेय', 'مشروبات', 'bar', 4), desserts = C('Desserts', 'मिठाई', 'میٹھا', 'dessert', 5);
  const spice = { name: 'Spice level', name_hi: 'तीखापन', name_ur: 'مرچ', required: false, multi: false, options: [{ name: 'Mild', name_hi: 'हल्का', name_ur: 'ہلکا', price: 0 }, { name: 'Medium', name_hi: 'मध्यम', name_ur: 'درمیانہ', price: 0 }, { name: 'Hot', name_hi: 'तीखा', name_ur: 'تیز', price: 0 }] };
  const portion = (extra) => ({ name: 'Portion', name_hi: 'मात्रा', name_ur: 'مقدار', required: true, multi: false, options: [{ name: 'Half', name_hi: 'हाफ', name_ur: 'ہاف', price: 0 }, { name: 'Full', name_hi: 'फुल', name_ur: 'فل', price: extra }] });
  const extras = { name: 'Extras', name_hi: 'एक्स्ट्रा', name_ur: 'اضافی', required: false, multi: true, options: [{ name: 'Extra butter', name_hi: 'एक्स्ट्रा बटर', name_ur: 'اضافی مکھن', price: 15 }, { name: 'Raita', name_hi: 'रायता', name_ur: 'رائتہ', price: 30 }] };
  const I = (cat, name, name_hi, name_ur, price, veg, desc, mods, recipe, extra = {}) => store.put('items', Object.assign({
    id: uid(), category_id: cat.id, name, name_hi, name_ur, price, veg, desc, active: true, available: true, sort: 0, gst: 5, hsn: '996331',
    modifiers: mods || [], recipe: (recipe || []).map(([k, q]) => ({ stock_id: stock[k], qty: q }))
  }, extra));
  I(starters, 'Paneer tikka', 'पनीर टिक्का', 'پنیر ٹکا', 280, 'veg', 'Cottage cheese marinated in spices, grilled in the tandoor', [spice], [['paneer', 0.2]]);
  I(starters, 'Veg manchurian', 'वेज मंचूरियन', 'ویج منچورین', 190, 'veg', 'Crisp vegetable dumplings in a tangy sauce', [spice], [['onion', 0.1], ['oil', 0.05]]);
  I(starters, 'Chicken 65', 'चिकन 65', 'چکن 65', 260, 'nonveg', 'Spicy fried chicken, curry-leaf tempering', [spice], [['chicken', 0.25], ['oil', 0.06]]);
  I(starters, 'Hara bhara kebab', 'हरा भरा कबाब', 'ہرا بھرا کباب', 210, 'veg', 'Spinach and green pea patties', [], [['oil', 0.04]]);
  I(starters, 'Tomato soup', 'टमाटर सूप', 'ٹماٹر سوپ', 110, 'veg', '', [], [['tomato', 0.2], ['butter', 0.01]]);
  I(tandoor, 'Butter naan', 'बटर नान', 'بٹر نان', 60, 'veg', '', [], [['atta', 0.12], ['butter', 0.01]]);
  I(tandoor, 'Tandoori roti', 'तंदूरी रोटी', 'تندوری روٹی', 25, 'veg', '', [], [['atta', 0.08]]);
  I(tandoor, 'Chicken tikka', 'चिकन टिक्का', 'چکن ٹکا', 320, 'nonveg', 'Boneless chicken, yoghurt marinade, charcoal grilled', [spice], [['chicken', 0.25], ['curd', 0.05]]);
  I(mains, 'Butter chicken', 'बटर चिकन', 'بٹر چکن', 340, 'nonveg', 'Tandoori chicken in a creamy tomato gravy', [portion(120), spice], [['chicken', 0.3], ['butter', 0.03], ['tomato', 0.15]]);
  I(mains, 'Dal makhani', 'दाल मखनी', 'دال مکھنی', 230, 'veg', 'Black lentils slow-cooked overnight with butter and cream', [portion(90)], [['dal', 0.12], ['butter', 0.02]]);
  I(mains, 'Paneer butter masala', 'पनीर बटर मसाला', 'پنیر بٹر مسالہ', 290, 'veg', '', [portion(100), spice], [['paneer', 0.2], ['butter', 0.03], ['tomato', 0.15]]);
  I(mains, 'Veg biryani', 'वेज बिरयानी', 'ویج بریانی', 240, 'veg', 'Basmati rice layered with vegetables, served with raita', [extras], [['rice', 0.25], ['onion', 0.1]]);
  I(mains, 'Chicken biryani', 'चिकन बिरयानी', 'چکن بریانی', 320, 'nonveg', 'Dum-cooked basmati rice with chicken', [extras], [['rice', 0.25], ['chicken', 0.25]]);
  I(mains, 'Jeera rice', 'जीरा राइस', 'زیرہ رائس', 150, 'veg', '', [], [['rice', 0.2]]);
  I(drinks, 'Masala chai', 'मसाला चाय', 'مسالہ چائے', 40, 'veg', '', [], [['tea', 0.005], ['milk', 0.1]]);
  I(drinks, 'Sweet lassi', 'मीठी लस्सी', 'میٹھی لسی', 90, 'veg', '', [], [['curd', 0.2]]);
  I(drinks, 'Fresh lime soda', 'फ्रेश लाइम सोडा', 'فریش لائم سوڈا', 80, 'veg', 'Sweet, salted or mixed', [], []);
  I(drinks, 'Cold drink (300 ml)', 'कोल्ड ड्रिंक', 'کولڈ ڈرنک', 40, 'veg', '', [], [['cola', 1]], { gst: 18, hsn: '2202' });
  I(drinks, 'Mineral water (1 L)', 'मिनरल वॉटर', 'منرل واٹر', 30, 'veg', '', [], [['water', 1]], { gst: 18, hsn: '2201' });
  I(desserts, 'Gulab jamun (2 pcs)', 'गुलाब जामुन', 'گلاب جامن', 90, 'veg', 'Warm milk dumplings in rose syrup', [], [['milk', 0.1]]);
  I(desserts, 'Rasmalai (2 pcs)', 'रसमलाई', 'رس ملائی', 120, 'veg', '', [], [['milk', 0.2]]);
  I(desserts, 'Kulfi', 'कुल्फी', 'قلفی', 100, 'veg', 'Pistachio malai kulfi', [], [['milk', 0.15]]);

  // membership cards (pre-printed numbers) + delivery partners
  const nextYear = new Date(); nextYear.setFullYear(nextYear.getFullYear() + 1);
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  store.put('members', { id: uid(), card_no: '1001', name: 'Ramesh Sharma', phone: '9810012345', discount_pct: 10, plan: 'Gold', valid_until: iso(nextYear), active: true });
  store.put('members', { id: uid(), card_no: '1002', name: 'Fatima Khan', phone: '9820023456', discount_pct: 5, plan: 'Silver', valid_until: iso(nextYear), active: true });
  store.put('members', { id: uid(), card_no: '1003', name: 'Gurpreet Singh', phone: '9899034567', discount_pct: 15, plan: 'Platinum', valid_until: iso(nextYear), active: true });
  store.put('partners', { id: uid(), name: 'Zomato', kind: 'aggregator', commission_pct: 22, active: true });
  store.put('partners', { id: uid(), name: 'Swiggy', kind: 'aggregator', commission_pct: 22, active: true });
  store.put('partners', { id: uid(), name: 'Corporate agent', kind: 'agent', commission_pct: 5, active: true });
  store.put('suppliers', { id: uid(), name: 'Fresh Farms Vegetables', phone: '9811100001', gstin: '' });
  store.put('suppliers', { id: uid(), name: 'City Poultry & Meat', phone: '9811100002', gstin: '' });
}
