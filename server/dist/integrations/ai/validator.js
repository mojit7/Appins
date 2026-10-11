const PERSIAN_LETTER = /[\u0600-\u06FF]/;
// تخفیف در هیچ نقطه‌ای از داده‌های محصول وجود نیست؛ هر اشاره تخفیفی ساختگی است.
// درصدِ جنس پارچه (مثل «Cotton 100%» یا «۱۰۰٪ پنبه») تخفیف نیست؛ فقط واژه تخفیف
// یا ترکیب عدد+درصد با off تخفیف شمرده می‌شود (محدودیت مستندشده).
const DISCOUNT_PATTERN = /تخفیف|[\d۰-۹]+\s*(?:%|٪)\s*off/i;
// ادعای اثبات اجتماعی/عملکردی که هیچ رکوردی آن را تأیید نمی‌کند.
const FABRICATED_PROOF_PATTERN = /(نظر مشتری|مشتریان ما می‌گویند|پرفروش|رکورد فروش|محبوب‌ترین|بیشترین فروش|رضایت ۱۰۰٪|رضایت 100%)/;
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
/** ارقام فارسی/عربی را به لاتین و جداکننده‌های هزارگان را حذف می‌کند. */
function normalizeDigits(text) {
    let out = '';
    for (const ch of text) {
        const p = PERSIAN_DIGITS.indexOf(ch);
        const a = ARABIC_DIGITS.indexOf(ch);
        if (p >= 0)
            out += String(p);
        else if (a >= 0)
            out += String(a);
        else if (ch === '٬' || ch === ',' || ch === '.') { /* جداکننده — حذف */ }
        else
            out += ch;
    }
    return out;
}
/** فقط اعداد چهاررقمی و بلندتر (قیمت‌های تومانی)؛ اعداد کوتاه مثل 100 در «Cotton 100%» شامل نمی‌شود. */
function longNumbers(text) {
    return [...normalizeDigits(text).matchAll(/\d{4,}/g)].map((m) => Number(m[0]));
}
export function validateCaptionOption(facts, option) {
    const reasons = [];
    const caption = option.caption;
    if (!PERSIAN_LETTER.test(caption)) {
        reasons.push({ rule: 'no-persian', detail: 'کپشن هیچ نویسه فارسی ندارد.' });
    }
    if (DISCOUNT_PATTERN.test(caption)) {
        reasons.push({ rule: 'discount-claim', detail: 'هیچ واقعیت تخفیفی در رکورد محصول وجود ندارد.' });
    }
    if (FABRICATED_PROOF_PATTERN.test(caption)) {
        reasons.push({ rule: 'fabricated-proof', detail: 'ادعای اثبات اجتماعی یا عملکردی تأییدنشده.' });
    }
    const mentionsPrice = /تومان|قیمت/.test(caption);
    if (facts.priceToman === null) {
        if (mentionsPrice) {
            reasons.push({ rule: 'price-claim-without-price', detail: 'قیمت در رکورد محصول موجود نیست.' });
        }
        const nums = longNumbers(caption);
        if (nums.length > 0) {
            reasons.push({ rule: 'number-claim-without-facts', detail: 'عدد بدون منبع واقعیت: ' + nums.join(', ') });
        }
    }
    else {
        const wrong = longNumbers(caption).filter((n) => n !== facts.priceToman);
        if (wrong.length > 0) {
            reasons.push({ rule: 'price-mismatch', detail: 'عدد بیان‌شده با قیمت ثبت‌شده نمی‌خواند: ' + wrong.join(', ') });
        }
    }
    const inStock = facts.stock !== null && facts.stock > 0;
    if (!inStock && /موجود/.test(caption) && !/ناموجود/.test(caption)) {
        reasons.push({ rule: 'stock-claim-without-stock', detail: 'موجودی در رکورد ثبت نشده یا صفر است.' });
    }
    if (inStock && /ناموجود/.test(caption)) {
        reasons.push({ rule: 'wrong-stock-claim', detail: 'محصول موجود است اما کپشن ناموجودی می‌گوید.' });
    }
    return reasons;
}
