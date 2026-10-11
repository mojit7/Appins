# راه‌اندازی تولید (Go-Live Runbook)

این سند مسیر سریع و حرفه‌ای برای بردن «فروشگاه‌یار» به محیط تولید است.
**وضعیت صادقانه:** استقرار تا فراهم شدن اعتبارنامه‌های مالک BLOCKED است؛ هیچ مرحله‌ای
نباید بدون پیکربندی واقعی «راه‌اندازی‌شده» اعلام شود.

## ۱. پیش‌نیازها

| مورد | جزئیات |
|---|---|
| Node.js | ۲۲ LTS یا جدیدتر (engines: >=22.12) — مرجع: nodejs.org/en/about/previous-releases |
| PostgreSQL | ۱۶ (همان نسخه‌ای که CI با آن آزمون می‌کند) — postgresql.org/support/versioning |
| میزببان | هر میزبان Node با HTTPS عمومی (VPS، PaaS مانند Railway/Render/Fly و مشابه) |
| متا | Business Login for Instagram + App Review — developers.facebook.com/docs/instagram-platform |
| تلگرام | BotFather برای توکن ربات — core.telegram.org/bots |

## ۲. متغیرهای محیطی (همه به‌عنوان secret، نه در مخزن)

الزامی:
- `DATABASE_URL` — رشته اتصال Postgres تولید
- `DATABASE_SSL` — حالت TLS اتصال: `auto` (پیش‌فرض؛ میزبان راه دور با تأیید گواهی کامل)، `require` (TLS بدون تأیید گواهی — برای میزبان‌هایی با گواهی self-signed مانند Railway)، `verify-full`، `disable`. مرجع: node-postgres.com/features/ssl
- `TRUST_PROXY` — اگر سرور پشت reverse proxy/CDN است `true` تا `req.ip` واقعی خوانده شود. مرجع: fastify.dev trustProxy
- `SESSION_SECRET` — ≥۳۲ نویسه تصادفی (`openssl rand -hex 32`)
- `OWNER_PASSWORD` — ≥۱۰ نویسه قوی
- `NODE_ENV=production`

الزامی در تولید:
- `TOTP_SECRET` — سرّ base32 دومرحله‌ای (`openssl rand -base32 20`)؛ ورود علاوه بر رمز نیازمند کد ۶ رقمی از اپ احراز (Google Authenticator/Aegis) است. پیاده‌سازی RFC 6238 با پنجره ±۳۰ ثانیه. **از این نسخه در NODE_ENV=production ورود بدون TOTP_SECRET به‌صورت fail-closed با 503 مسدود است.**
- `INSTAGRAM_TOKEN_ENCRYPTION_KEY` — کلید مستقل (≥۳۲ نویسه، `openssl rand -hex 32`) برای رمزنگاری AES-256-GCM توکن اینستاگرام؛ مستقل از SESSION_SECRET تا دو چرخه امنیتی جدا باشند. اگر تنظیم نشود برای سازگاری به SESSION_SECRET برگشت می‌کند؛ پس از چرخش کلید، توکن ذخیره‌شده نیاز به اتصال مجدد دارد.

اختیاری (فعال‌سازی ماژول‌ها):
- اینستاگرام: `INSTAGRAM_APP_ID`، `INSTAGRAM_APP_SECRET`، `INSTAGRAM_REDIRECT_URI`، `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`
- تازه‌سازی خودکار توکن: `IG_TOKEN_REFRESH_INTERVAL_MS` (پیش‌فرض ۶ ساعت)، `IG_TOKEN_REFRESH_MIN_TTL_MS` (پیش‌فرض ۷ روز)
- تلگرام: `TELEGRAM_BOT_TOKEN`، `TELEGRAM_OWNER_ID`، `TELEGRAM_WEBHOOK_SECRET`
- هوش مصنوعی: `AI_PROVIDER_AP
I_KEY`، `AI_PROVIDER_BASE_URL`، `AI_PROVIDER_MODEL`

## ۳. استقرار (چند دقیقه‌ای)

```bash
npm ci            # نصب قطعی از lockfile ثبت‌شده در main (CI همان را می‌سازد و آزمون می‌کند)
npm run build     # ساخت سرور و وب (build وب، meta CSP را در index.html تزریق می‌کند)
npx tsx server/src/db/migrate.ts   # اجرای مهاجرت‌ها (با قفل مشاوره‌ای Postgres)
NODE_ENV=production node ...       # اجرای server (index.ts) روی PORT
```

رفتار تولید:
- **توقف نرم:** روی SIGTERM/SIGINT ابتدا کارگر زمان‌بند و تازه‌ساز توکن می‌ایستند، اتصال‌های در پردازش بسته و سپس pool پایان می‌یابد.
- **سلامت:** `GET /healthz` با `SELECT 1` دیتابیس را بررسی می‌کند؛ در خرابی ۵۰۳ و `status=degraded`.
- **توکن اینستاگرام:** هر ۶ ساعت بررسی و در لزوم تازه‌سازی خودکار (توکن ۶۰ روزه متا؛ توکن منقضی‌شده اتصال مجدد می‌خواهد).
- **درخواست‌های خروجی:** همه فراخوانی‌های متا با تایم‌اوت ۱۵ ثانیه‌ای اجرا می‌شوند.
- **CSRF دومرحله‌ای:** کوکی SameSite=Strict + رد Origin ناهم‌خوان در متدهای تغییردهنده.
- **فونت و CSP وب:** فونت وزیرمتن self-host است (بسته @fontsource از npm — بدون CDN خارجی)؛ در build تولیدی، `Content-Security-Policy` (default-src 'self') در سند تزریق می‌شود. اگر وب را جدا از سرور میزبانی می‌کنید، همین سیاست را به‌صورت هدر روی میزبان استاتیک هم اضافه کنید:
  `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`
- **فشرده‌سازی:** روی میزبان، gzip/brotli را برای JS/CSS فعال کنید (اغلب PaaS خودکار؛ در nginx: `gzip on`).

## ۴. پیکربندی webhookها

1. متا → App → Webhooks: Callback URL = `https://<دامنه>/instagram/webhook`، Verify Token = `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`؛ اشتراک فیلد پیام‌ها و نظرات.
2. تلگرام: `setWebhook` با `secret_token` مطابق `TELEGRAM_WEBHOOK_SECRET` (مسیر setup سمت سرور موجود است).

## ۵. آزمون‌های دود (Smoke) پس از استقرار

1. `GET /healthz` → `{"status":"ok","db":"ok"}`
2. ورود مالک (رمز + در صورت
 فعال‌بودن TOTP، کد) → داشبورد: متریک‌ها از API واقعی
3. جریان OAuth اینستاگرام → وضعیت «متصل» و `tokenExpiresAt` ≈ ۶۰ روز بعد
4. ارسال پیام آزمایشی به حساب متصل → ظهور در صندوق گفت‌وگو با نیت طبقه‌بندی‌شده
5. تأیید پیشنهاد → ارسال واقعی + رکورد ممیزی
6. دستور `/status` ربات تلگرام از حساب مالک
7. ری‌استارت سرویس (SIGTERM) → لاگ «توقف نرم» و بسته‌شدن تمیز
8. دکمه Back مرورگر و refresh در صفحات داشبورد → صفحه همان بمانَد (مسیریابی هش)

فقط پس از موفقیت همه موارد، وضعیت از BLOCKED به DEPLOYED-AND-VERIFIED تغییر می‌کند و
برچسب NOT LIVE-VERIFIED در مستندات برای قابلیت مربوط به‌روزرسانی می‌شود.

## ۶. چک‌لیست امنیتی استقرار

- [ ] همه secretها در مدیر راز میزبان (نه فایل یا مخزن)
- [ ] TLS + HSTS فعال (`NODE_ENV=production`)
- [ ] `DATABASE_SSL` مطابق میزبان تنظیم شده
- [ ] `TRUST_PROXY=true` اگر پشت پروکسی/CDN
- [ ] `TOTP_SECRET` تنظیم شده (الزامی — ورود بدون آن در production مسدود است)
- [ ] رمز مالک قوی و یکتا
- [ ] CSP روی میزبان استاتیک وب هم اعمال شده (اگر جدا از سرور است)
- [ ] پشتیبان‌گیری روزانه Postgres با آزمون بازیابی
- [ ] دسترسی SSH/کنسول با احراز دومرحله‌ای
- [ ] `/healthz` به مانیتورینگ/uptime متصل است (۵۰۳ = خارج از مدار)
