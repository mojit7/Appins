/** دسته‌بندی نیت پیام‌های فارسی مشتری — قانون‌محور و قطعی (بدون فراخوانی بیرونی).
 *  نرمال‌سازی: یکسان‌سازی نویسه‌های عربی/فارسی، حذف اعراب و نیم‌فاصله، تبدیل ارقام فارسی/عربی.
 *  نسخه برای ردیابی ارزیابی (eval) ثبت می‌شود. */

export const CLASSIFIER_VERSION = 'fa-intent-lex-v1';

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

function toAsciiDigit(ch: string): string {
  const fa = FA_DIGITS.indexOf(ch);
  if (fa >= 0) return String(fa);
  const ar = AR_DIGITS.indexOf(ch);
  return ar >= 0 ? String(ar) : ch;
}

export function normalizeFa(input: string): string {
  return input
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/\u0643/g, 'ک')
    .replace(/[\u0649\u064A\u06CC]/g, 'ی')
    .replace(/[\u0623\u0625]/g, 'ا')
    .replace(/\u0629/g, 'ه')
    .replace(/[\u200C\u200E\u200F]/g, ' ')
    .replace(/[۰-۹٠-٩]/g, toAsciiDigit)
    .replace(/[.,،؛:!؟?«»"'()\-–—_/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

type Term = [string, number];

/** واژگان نیت‌ها — عبارت محاوره‌ای با وزن؛ امتیاز جمع، تساوی با اولویت شکسته می‌شود. */
const LEXICON: Record<string, Term[]> = {
  price_inquiry: [
    ['قیمت', 3], ['چنده', 3], ['چقیمت', 3], ['قیمته', 3], ['چند تومنه', 3],
    ['چند میگیری', 3], ['چقدره', 3], ['چند', 1],
  ],
  availability: [
    ['موجود', 3], ['موجودی', 3], ['استوک', 3], ['انبار', 2], ['مونده', 2],
    ['دارید', 1], ['هستش', 1], ['هست', 1],
  ],
  purchase_intent: [
    ['میخوام', 3], ['می خوام', 3], ['بخرم', 3], ['میخرم', 3], ['سفارش', 3],
    ['رزرو', 2], ['بگیرم', 2], ['ثبت کنم', 2],
  ],
  order_tracking: [
    ['کد رهگیری', 4], ['کد پیگیری', 4], ['رهگیری', 3], ['مرسوله', 3], ['پیگیری', 3],
    ['پست شد', 3], ['رسید نکرده', 3], ['بسته', 2],
  ],
  shipping: [
    ['ارسال', 3], ['ارسالش', 3], ['چند روزه', 3], ['چند روز', 3], ['تحویل', 2],
    ['پست', 2], ['پیک', 2], ['شیپینگ', 2], ['برسونید', 2],
  ],
  returns: [
    ['مرجوع', 4], ['برگردونم', 4], ['استرداد', 4], ['برگشت', 3], ['پس میدم', 3], ['پس بدم', 3],
  ],
  complaint: [
    ['شکایت', 4], ['فالو بک', 0], ['ناراضی', 3], ['خراب', 3], ['کلاه', 3],
    ['بی کیفیت', 3], ['مسخره', 3], ['تاخیر', 2], ['چرا هنوز', 2], ['بد بود', 2], ['ناراحت', 2],
  ],
  spam: [
    ['فالو بک', 4], ['f4f', 4], ['لایک متقابل', 4], ['تبادل', 3], ['فالو میکنم', 3], ['سریال', 2],
  ],
};

/** اولویت شکست تساوی: پرریسک‌ها برنده می‌شوند (نگرش محافظه‌کارانه). */
const PRIORITY = ['spam', 'complaint', 'returns', 'order_tracking', 'purchase_intent', 'shipping', 'price_inquiry', 'availability'] as const;

export interface IntentResult {
  intent: import('../../domain/engagement.js').Intent;
  confidence: number;
  urgency: 'low' | 'normal' | 'high';
  needsHuman: boolean;
  matched: string[];
}

/** دسته‌بندی قطعی نیت — اعتماد بر پایه امتیاز واژگانی؛ پیچیده یا مبهم به بررسی انسانی می‌رود. */
export function classifyIntent(text: string): IntentResult {
  const t = normalizeFa(text);
  const scores = new Map<string, number>();
  const hits = new Map<string, string[]>();
  for (const intent of Object.keys(LEXICON)) {
    let score = 0;
    const found: string[] = [];
    for (const [term, weight] of LEXICON[intent] ?? []) {
      if (weight > 0 && t.includes(term)) {
        score += weight;
        found.push(term);
      }
    }
    if (score > 0) {
      scores.set(intent, score);
      hits.set(intent, found);
    }
  }
  let best = 'general';
  let bestScore = 0;
  for (const intent of PRIORITY) {
    const s = scores.get(intent) ?? 0;
    if (s > bestScore) {
      best = intent;
      bestScore = s;
    }
  }
  const confidence = bestScore >= 4 ? 0.9 : bestScore === 3 ? 0.85 : bestScore === 2 ? 0.7 : bestScore === 1 ? 0.6 : 0.4;
  const needsHuman = best === 'complaint' || best === 'returns' || best === 'order_tracking'
    || best === 'general' || confidence < 0.7;
  const urgency: IntentResult['urgency'] = best === 'complaint' ? 'high'
    : (best === 'price_inquiry' || best === 'purchase_intent' || best === 'order_tracking' || best === 'returns') ? 'normal'
    : 'low';
  return {
    intent: best as IntentResult['intent'],
    confidence,
    urgency,
    needsHuman,
    matched: hits.get(best) ?? [],
  };
}
