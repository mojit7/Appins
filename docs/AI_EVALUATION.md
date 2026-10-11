# ارزیابی تولید کپشن فارسی (مرحله ۶)

## وضعیت کلی

- نسخه پرامپت: `caption-fa-v1` (ذخیره‌شده همراه کد در `server/src/integrations/ai/prompt.ts`)
- نسخه مجموعه داده ارزیابی: `1` (`server/src/integrations/ai/eval/dataset.json`)
- وضعیت پیاده‌سازی: **پیاده‌سازی و آزمون‌شده با پاسخ‌های ثبت‌شده (recorded)**
- وضعیت تولید زنده: **NOT LIVE-VERIFIED** — هیچ کلید ارائه‌دهنده‌ای در اختیار نبود؛ هیچ اتصال یا تولید واقعی ادعا نمی‌شود.
- بازبینی انسانی کیفیت زنده: **NOT PERFORMED** (وابسته به کلید واقعی و خروجی زنده)

## روش‌شناسی

اجراکننده ارزیابی: `server/tests/ai.eval.test.ts` — هر مورد از مجموعه داده را از مسیر واقعی خط لوله (`generateCaptionOptions`: درخواست ← استخراج JSON ← اعتبارسنجی zod ← اعتبارسنجی واقعیت ← تفکیک) عبور می‌دهد. پاسخ‌های ثبت‌شده قطعی‌اند و اجرا تکرارپذیر است.

پس از هر تغییر در پرامپت یا اعتبارسنجی، نسخه پرامپت باید بالا برود و همین موارد بازاجرا شوند (چرخه: تغییر ← `npm test` در `server` ← همه موارد سبز).

## دسته‌ها و معیارهای PASS/FAIL

| دسته | معیار PASS | موارد |
|---|---|---|
| اطلاعات کامل محصول | خروجی ok با ≥ گزینه موردانتظار؛ بدون قاعده نقض‌شده | EV-01 |
| فقدان قیمت/موجودی | کپشن بدون ادعای قیمت/عدد → ok؛ ادعای ساختگی → خطای `AI_OUTPUT_REJECTED` با قاعده مربوط | EV-02a, EV-02b |
| واقعیت‌های متناقض | قیمت صحیح دیتابیس → ok؛ قیمت غلط در توضیح قدیمی → `price-mismatch` | EV-03a, EV-03b |
| نشانه‌گذاری فارسی/متن مخلوط | متن مخلوط صحیح → ok؛ کپشن بدون نویسه فارسی → `no-persian` | EV-04a, EV-04b |
| ورودی خالی/نامعتبر | گزینه خالی → `AI_MALFORMED_OUTPUT`؛ محصول خالی → `AI_INVALID_PRODUCT`؛ محتوای خالی → `AI_EMPTY_OUTPUT` | EV-05a, EV-05b, EV-05c |
| پاسخ معیوب/ناقص/ردشده | بدون JSON → `AI_MALFORMED_OUTPUT`؛ `content_filter` → `AI_REFUSED`؛ `length` → `AI_INCOMPLETE_OUTPUT` | EV-06a, EV-06b, EV-06c |
| شکست ارائه‌دهنده | 500 → `AI_PROVIDER_ERROR`؛ 429 → `AI_RATE_LIMITED`؛ 401 → `AI_AUTH_FAILED`؛ بی‌پاسخ → `AI_TIMEOUT` | EV-07a تا EV-07d |

قواعد اعتبارسنجی سمت سرور (`server/src/integrations/ai/validator.ts`): `no-persian`, `discount-claim`, `fabricated-proof`, `price-claim-without-price`, `price-mismatch`, `number-claim-without-facts`, `stock-claim-without-stock`, `wrong-stock-claim`.

## نتیجه اجرا (recorded، آفلاین)

اجرای `npx vitest run tests/ai.eval.test.ts` در `server`: هر ۱۶ مورد در ۷ دسته مطابق انتظار سبز است — شمارش واقعی از خروجی CI این شاخه گزارش می‌شود؛ بدون اجرای بازرسی‌شده هیچ نمره کیفیت زنده ادعا نمی‌شود.

## قالب بازبینی انسانی (پس از کلید واقعی)

برای هر نمونه زنده: ۱) دقت واقعیت‌ها (قیمت/موجودی/ویژگی در برابر رکورد) ۲) کیفیت فارسی (نیم‌فاصله، گیومه، روانی) ۳) تناسب با لحن/هدف — نتیجه در جدول زیر ثبت شود.

| شناسه | تاریخ | مدل | دقت واقعیت | کیفیت فارسی | نتیجه |
|---|---|---|---|---|---|
| — | — | — | NOT PERFORMED | NOT PERFORMED | NOT PERFORMED |

## مرجع‌های رسمی مشورت‌شده

- OpenRouter — «Send a chat completion request» / API Reference: https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request (سازگار با OpenAI Chat Completions، احراز Bearer)
- NVIDIA — «NIM Large Language Models API Reference»: https://docs.nvidia.com/nim/large-language-models/latest/api-reference.html (نقطه پایانی `/v1/chat/completions` سازگار با OpenAI)
- Zencoder (zen code): سازگاری OpenAI-تأییدنشده؛ اگر نشانی پایه سازگار ارائه دهد با همان آداپتور کار می‌کند — **not yet verified**

تاریخ بازبینی مستندات: ۲۰۲۶-۱۰-۱۱. انتخاب فنی: یک آداپتور سازگار با OpenAI Chat Completions با نشانی پایه پیکربندی‌شدنی؛ خروجی ساختاریافته در همه ارائه‌دهندگان تضمین‌نشده است، لذا JSON در پرامپت + اعتبارسنجی سخت سمت سرور (zod) به کار رفت.