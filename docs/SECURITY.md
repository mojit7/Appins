# ماتریس راستی‌آزمایی امنیتی

منابع: OWASP ASVS 5.0.0 (سازمان OWASP، نسخه ۵.۰.۰) و NIST SP 800-218 SSDF v1.1 (نهایی، فوریه ۲۰۲۲).
این ماتریس فقط پوشش کنترل‌های پیاده‌شده در این معماری را نشان می‌دهد و ادعای انطباق/گواهی ASVS نیست.

| شناسه | منبع | کاربرد | محل پیاده‌سازی | روش راستی‌آزمایی | نتیجه |
|---|---|---|---|---|---|
| V2.1/V2.2 (رمز عبور) | ASVS 5.0.0 | بله — ورود تک‌مالکی | `server/src/auth/password.ts` (مقایسه زمان-ثابت)؛ حداقل طول در `config/env.ts` | تست واحد + تست ورود ناموفق | PASS |
| V2.4 (قفل‌سازی تلاش) | ASVS 5.0.0 | بله — مسیر ورود | `server/src/server/rateLimit.ts` (۵ تلاش/۱۵ دقیقه) | تست ۴۲۹ پس از ۵ تلاش | PASS |
| V3.1/V3.3 (توکن نشست) | ASVS 5.0.0 | بله — نشست امضاشده HMAC-SHA256 با انقضا | `server/src/auth/session.ts` | تست اعتبار/دستکاری/انقضا | PASS |
| V3.2 (کوکی امن) | ASVS 5.0.0 | بله — HttpOnly، SameSite=Strict، Secure در production | `server/src/auth/session.ts` | تست سرصفحه set-cookie | PASS |
| V2.7 (احراز دومرحله‌ای) | ASVS 5.0.0 | بله — TOTP اجباری در production (fail-closed، RFC 6238) | `server/src/server/app.ts`، `server/src/auth/totp.ts` | تست ۵۰۳ بدون TOTP_SECRET + تست ورود با کد درست | PASS |
| V3.4 (ابطال نشست) | ASVS 5.0.0 | بله — ابطال فوری توکن در خروج تا انقضای طبیعی | `server/src/auth/session.ts`، `server/src/server/app.ts` | تست ۴۰۱ با توکن کپی‌شده پس از logout | PASS |
| V4.1 (کنترل دسترسی سمت سرور) | ASVS 5.0.0 | بله — preHandler سراسری + `assertActor` مخازن | `server/src/server/app.ts`، `server/src/data/context.ts` | تست ۴۰۱/۴۰۳ بدون نشست | PASS |
| V5.1/V5.2 (اعتبارسنجی ورودی) | ASVS 5.0.0 | بله — zod در مرز دامنه + پرس‌وجوهای پارامتری pg | `server/src/domain/*`، `server/src/data/*` | تست‌های نامعتبر مرحله ۳ | PASS |
| V5.4 (رمزگذاری خروجی) | ASVS 5.0.0 | محدود — API فقط JSON؛ UI React فرارِ پیش‌فرض XSS دارد | پاسخ‌های JSON بدون انباشت رشته HTML | ضمنی با تست ۴۰۴/۴۰۱ | PASS |
| V7.1/V7.3 (خطا و لاگ) | ASVS 5.0.0 | بله — پیام عمومی + redact pino | `server/src/server/app.ts` | بازبینی کد + تست ۵۰۰ بدون نشت | PASS |
| V8.1 (داده حساس) | ASVS 5.0.0 | بله — توکن/رمز فقط env؛ `integration_connections` بدون توکن | `server/src/db/migrations.ts` | بازبینی اسکیما | PASS |
| V8.2/V8.3 (رمزنگاری داده در سکون) | ASVS 5.0.0 | بله — توکن اینستاگرام با AES-256-GCM و کلید مستقل `INSTAGRAM_TOKEN_ENCRYPTION_KEY` (APP-007) | `server/src/data/instagramCredentials.ts` | تست شکست رمزگشایی با کلید متفاوت | PASS |
| V13.2 (ضد-خودکار/نرخ) | ASVS 5.0.0 | بله — فقط برای ورود | `server/src/server/rateLimit.ts` | تست واحد محدودساز | PASS |
| V14 (سرصفحه‌های امنیتی) | ASVS 5.0.0 | بله — nosniff، X-Frame-Options، Referrer-Policy، HSTS در production | `server/src/server/app.ts` | بازبینی کد | PASS (واحدی محدود) |
| V10 (CORS) | ASVS 5.0.0 | نام applicable — اپ هم‌مبدأ (Vite proxy)؛ CORS فعال نیست | — | — | N/A |
| PS.1 (تعریف الزامات امنیتی) | SP 800-218 v1.1 | بله — همین ماتریس | `docs/SECURITY.md` | داوری | PASS |
| PW.4 (طراحی با محافظت‌ها) | SP 800-218 v1.1 | بله — مرز نشست، redact، RESTRICT | کل `server/src` | تست‌های regression | PASS |
| PW.7 (بازبینی کد) | SP 800-218 v1.1 | بله — CI اجباری + بازبینی در هر مرحله | `.github/workflows/ci.yml` | وضعیت CI | PASS |
| PW.8/PW.7.2 (تحلیل وابستگی‌ها) | SP 800-218 v1.1 | بله — `npm audit --audit-level=high` در CI | `.github/workflows/ci.yml` | نتیجه CI | PASS (وضعیت لحظه‌ای) |

محدودیت‌ها:
- محدودساز نرخ درون-حافظه‌ای است؛ در استقرار چند-نمونه‌ای باید به فروشگاه مشترک منتقل شود.
- HSTS/Secure فقط در NODE_ENV=production فعال‌اند و در CI قابل اجرا نیستند (NOT TESTED در محیط تولید).
- `npm audit` وضعیت لحظه‌ای وابستگی‌هاست؛ قطعیت صفر نقص تضمین نمی‌کند.
- فهرست ابطال نشست (APP-002) درون-حافظه‌ای است؛ در استقرار چندنمونه‌ای باید به فروشگاه مشترک منتقل شود.
