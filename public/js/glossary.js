// Offline word list for common menu words (English -> Hindi / Urdu). Used when the translation service is unreachable
// and to keep well-known dish names consistent. Add words freely.
const G = `paneer|पनीर|پنیر
tikka|टिक्का|ٹکا
butter|बटर|بٹر
naan|नान|نان
roti|रोटी|روٹی
tandoori|तंदूरी|تندوری
chicken|चिकन|چکن
mutton|मटन|مٹن
fish|फ़िश|فش
egg|अंडा|انڈا
veg|वेज|ویج
non|नॉन|نان
biryani|बिरयानी|بریانی
rice|राइस|رائس
fried|फ्राइड|فرائیڈ
curry|करी|کری
masala|मसाला|مصالحہ
dal|दाल|دال
makhani|मखनी|مکھنی
tadka|तड़का|تڑکا
palak|पालक|پالک
aloo|आलू|آلو
gobi|गोभी|گوبھی
matar|मटर|مٹر
chole|छोले|چھولے
rajma|राजमा|راجما
kebab|कबाब|کباب
seekh|सीख|سیخ
tawa|तवा|توا
chilli|चिली|چلی
manchurian|मंचूरियन|منچورین
noodles|नूडल्स|نوڈلز
soup|सूप|سوپ
tomato|टमाटर|ٹماٹر
sweet|मीठा|میٹھا
salty|नमकीन|نمکین
lassi|लस्सी|لسی
chai|चाय|چائے
tea|चाय|چائے
coffee|कॉफ़ी|کافی
cold|कोल्ड|کولڈ
drink|ड्रिंक|ڈرنک
juice|जूस|جوس
water|पानी|پانی
lime|नींबू|لیموں
soda|सोडा|سوڈا
mango|आम|آم
shake|शेक|شیک
ice|आइस|آئس
cream|क्रीम|کریم
kulfi|कुल्फ़ी|قلفی
gulab|गुलाब|گلاب
jamun|जामुन|جامن
halwa|हलवा|حلوہ
kheer|खीर|کھیر
rasmalai|रसमलाई|رسملائی
jalebi|जलेबी|جلیبی
samosa|समोसा|سموسہ
pakora|पकोड़ा|پکوڑا
bhaji|भाजी|بھاجی
pav|पाव|پاؤ
dosa|डोसा|ڈوسا
idli|इडली|اڈلی
vada|वड़ा|وڑا
sambar|सांभर|سانبھر
thali|थाली|تھالی
paratha|पराठा|پراٹھا
kulcha|कुलचा|کلچہ
raita|रायता|رائتہ
salad|सलाद|سلاد
papad|पापड़|پاپڑ
pizza|पिज़्ज़ा|پیزا
burger|बर्गर|برگر
sandwich|सैंडविच|سینڈوچ
fries|फ्राइज़|فرائز
pasta|पास्ता|پاستا
momos|मोमोज़|مومو
roll|रोल|رول
wrap|रैप|ریپ
special|स्पेशल|اسپیشل
spicy|तीखा|تیز
mild|हल्का|ہلکا
hot|गर्म|گرم
full|फुल|فل
half|हाफ़|ہاف
plate|प्लेट|پلیٹ
combo|कॉम्बो|کومبو
starters|स्टार्टर्स|اسٹارٹرز
main|मुख्य|مین
course|कोर्स|کورس
desserts|मिठाई|میٹھا
beverages|पेय|مشروبات
breads|रोटी|روٹی
and|और|اور
with|के साथ|کے ساتھ
size|साइज़|سائز
small|छोटा|چھوٹا
medium|मध्यम|درمیانہ
large|बड़ा|بڑا
extra|एक्स्ट्रा|ایکسٹرا
cheese|चीज़|چیز
onion|प्याज़|پیاز
garlic|लहसुन|لہسن
ginger|अदरक|ادرک
green|हरा|ہرا
bhara|भरा|بھرا
hara|हरा|ہرا
dum|दम|دم
handi|हांडी|ہانڈی
kadai|कड़ाही|کڑاہی
korma|कोरमा|قورمہ
tikka masala|टिक्का मसाला|ٹکا مصالحہ
malai|मलाई|ملائی
shahi|शाही|شاہی
jeera|जीरा|زیرہ
plain|सादा|سادہ
sweet lassi|मीठी लस्सी|میٹھی لسی`;
const MAP = new Map(G.split('\n').map(l => l.split('|')).map(([e, h, u]) => [e, { hi: h, ur: u }]));
/** Returns the translation if every word is known, else null. */
export function glossaryTranslate(text, to) {
  const s = String(text || '').trim(); if (!s) return '';
  const whole = MAP.get(s.toLowerCase()); if (whole) return whole[to];
  const words = s.split(/\s+/); const out = [];
  for (let i = 0; i < words.length; i++) {
    const two = words[i + 1] ? (words[i] + ' ' + words[i + 1]).toLowerCase() : '';
    if (two && MAP.has(two)) { out.push(MAP.get(two)[to]); i++; continue; }
    const w = words[i].toLowerCase().replace(/[^a-z]/g, '');
    const m = MAP.get(w); if (!m) return null; out.push(m[to]);
  }
  return out.join(' ');
}
/** Best effort even if some words are unknown (unknown words stay in English). */
export function glossaryPartial(text, to) {
  return String(text || '').split(/\s+/).map(w => { const m = MAP.get(w.toLowerCase().replace(/[^a-z]/g, '')); return m ? m[to] : w; }).join(' ');
}
