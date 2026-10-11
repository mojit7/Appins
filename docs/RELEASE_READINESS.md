# سند تأیید آمادگی Go-Live (Release Readiness)

وضعیت نهایی: **CODE-READY — استقرار BLOCKED به اعتبارنامه‌های مالک**
هر ادعا در این سند به شواهد قابل‌راستی‌آزمایی (کامیت/تست CI) گره خورده است.

## ۱. ماتریس شواهد

| حوزه | وضعیت | شواهد |
|---|---|---|
| نصب قطعی (lockfile) | ✅ | `npm ci` در CI؛ lockfile خودکار ثبت‌شده روی main (کامیت "pin dependency lockfile") |
| TLS دیتابیس | ✅ | `DATABASE_SSL` با ۴ حالت + ۳ تست (hardening.test.ts) — مرجع node-postgres/features/ssl |
| توقف نرم | ✅ | SIGTERM/SIGINT → توقف کارگران → close تمیز — مرجع nodejs signal-events |
| سلامت واقعی | ✅ | healthz با SELECT 1؛ خرابی → ۵۰۳ degraded (۲ تست) |
| خطاهای زمان‌بند | ✅ | لاگ pino روی هر tick/requeue (بدون بلعیدن بی‌صدا) |
| تازه‌سازی توکن IG | ✅ | TokenRefresher هر ۶h، آستانه ۷ روز (۵ تست با بردار واقعی پاسخ متا) — مرجع Meta refresh_access_token |
| مهاجرت هم‌زمان‌امن | ✅ | pg_advisory_lock — مرجع PostgreSQL explicit-locking |
| محدودساز نرخ | ✅ | sweep حافظه + trustProxy درست (۱ تست) |
| تایم‌اوت خروجی | ✅ | AbortSignal.timeout(15s) در زمان‌بند و مسیرهای IG |
| CSP API | ✅ | default-src 'none' روی همه پاسخ‌های سرور |
| CSP وب | ✅ | تزریق در build تولیدی (vite plugin) + دستور هدر برای میزبان استاتیک |
| CSRF دومرحله‌ای | ✅ | SameSite=Strict + رد Origin ناهم‌خوان (۳ تست) — ASVS V4.7 |
| ورود دومرحله‌ای مالک | ✅ | TOTP RFC 6238 با بردارهای رسمی RFC 4226/6238 (۶ تست) |
| فونت self-host | ✅ | @fontsource/vazirmatn از npm — حذف CDN خارجی (jsdelivr) از index.html |
| مسیریابی URL | ✅ | hash router؛ back/refresh/لینک مستقیم کار می‌کند؛ SSR-امن |
| تم تاریک/روشن | ✅ | توکن‌های تم + prefers-color-scheme + سوییچ کاربر (localStorage) |
| مرز خطای UI | ✅ | ErrorBoundary روی هر صفحه؛ خطای رندر = پیام بازیابی نه صفحه سفید |
| تایم‌اوت کلاینت | ✅ | fetchJson با AbortSignal.timeout(15s) |
| ارزیابی نیت فارسی | ✅ | intent-fa-v1: accuracy=1.000, macro-F1=1.000 (آزمون CI) |
| آزمون‌ها | ✅ | سرور ۱۷۷+۱۹ جدید سبز در CI؛ وب ۳۵ سبز |
| وابستگی‌ها | ✅ | همه در آخرین نسخه پایدار npm (راستی‌آزمایی مستقیم registry)؛ npm audit: ۰ آسیب‌پذیری |

## ۲. چیزهایی که صادقانه NOT VERIFIED است

1. جریان‌های زنده اینستاگرام/تلگرام/AI — نیازمند اعتبارنامه مالک؛ تا آن زمان ماژول‌ها ۵۰۳ صادقانه برمی‌گردانند.
2. عملکرد واقعی (LCP/INP/CLS) — نیازمند استقرار؛ بهینه‌سازی‌های انجام‌شده مبتنی بر اصول web.dev است نه اندازه‌گیری میدانی.
3. مانیتورینگ/آلرت تولید (Sentry/OTel) — پیاده نشده؛ healthz به uptime متصل شود.
4. مهاجرت کامل style های درون‌خطی صفحات قدیمی (Dashboard/Inbox/AiStudio/Calendar) به کلاس — بدهی ثبت‌شده؛ صفحات بازنویسی‌شده (Products/Settings/…) کلاس‌محورند.

## ۳. شرط تغییر وضعیت به DEPLOYED-AND-VERIFIED

اجرای کامل docs/GO_LIVE.md (بخش ۳ تا ۵) + موفقیت هر ۸ آزمون دود. پیشنهاد انتشار:
ریلیز بعدی v1.2.0 (prerelease) شامل PR #7، #8 و این PR.

## ۴. مراجع استاندارد

OWASP ASVS 5.0.0 · OWASP Secure Headers/CSP Cheatsheet · RFC 6238/4226 (TOTP/HOTP) ·
Twelve-Factor App V (dev/prod parity) · web.dev (LCP/CLS، self-host fonts) ·
W3C prefers-color-scheme · PostgreSQL Advisory Locks · Meta Instagram Platform v26.0 · Telegram Bot API.
