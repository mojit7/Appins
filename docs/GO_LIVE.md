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
- `DATABASE_SSL` — حالت TLS اتصال: `auto` (پیش‌فرض؛ میزبان راه‌.remote با تأیید گواهی کامل)، `require` (TLS بدون تأیید گواهی — برای میزبان‌هایی با گواهی self-signed مانند Railway)، `verify-full`، `disable`. مرجع: node-postgres.com/features/ssl
- `TRUST_PROXY` — اگر سرور پشت reverse proxy/CDN است `true` تا `req.ip` واقعی از `X-Forwarded-For` خوانده شود (لازم برای درستی محدودساز نرخ ورود). مرجع: fastify.dev/docs/latest/Reference/Server/#trustproxy
- `SESSION_SECRET` — ≥۳۲ نویسه تصادفی (`openssl rand -hex 32`)
- `OWNER_PASSWORD` — ≥۱۰ نویسه قوی
- `NODE_ENV=production`

اختیاری (فعال‌سازی ماژول‌ها):
- اینستاگرام: `INSTAGRAM_APP_ID`، `INSTAGRAM_APP_SECRET`، `INSTAGRAM_REDIRECT_URI`، `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`
- تازه‌سازی خودکار توکن: `IG_TOKEN_REFRESH_INTERVAL_MS` (پیش‌فرض ۶ ساعت)، `IG_TOKEN_REFRESH_MIN_TTL_MS` (پیش‌فرض ۷ روز — اگر کمتر از این زمان تا انقضا مانده باشد، تازه‌سازی خودکار اجرا می‌شود)
- تلگرام: `TELEGRAM_BOT_TOKEN`، `TELEGRAM_OWNER_ID`، `TELEGRAM_WEBHOOK_SECRET`
- هوش مصنوعی: `AI_PROVIDER_API_KEY`، `AI_PROVIDER_BASE_URL`، `AI_PROVIDER_MODEL`

## ۳. استقرار (چند دقیقه‌ای)

```bash
npm ci            # نصب قطعی از lockfile ثبت‌شده در main (CI همان را می‌سازد و آزمون می‌کند)
npm run build     # ساخت سرور و وب
npx tsx server/src/db/migrate.ts   # اجرای مهاجرت‌ها (با قفل مشاوره‌ای Postgres — امن برای چند نمونه)
NODE_ENV=production node ...       # اجرای server (index.ts) روی PORT
```

رفتار تولید:
- **توقف نرم:** روی SIGTERM/SIGINT ابتدا کارگر زمان‌بند و تازه‌ساز توکن می‌ایستند، اتصال‌های در پردازش بسته و سپس pool پایان می‌یابد — مناسب چرخه استقرار PaaS/کانتینر.
- **سلامت:** `GET /healthz` با `SELECT 1` دیتابیس را بررسی می‌کند؛ در خرابی ۵۰۳ و `status=degraded` می‌دهد تا load balancer نمونه ناسالم را از مدار خارج کند.
- **توکن اینستاگرام:** هر ۶ ساعت بررسی و در لزوم تازه‌سازی خودکار (توکن ۶۰ روزه متا بدون دخالت انسانی تمدید می‌شود؛ توکن منقضی‌شده اتصال مجدد می‌خواهد).
- **درخواست‌های خروجی:** همه فراخوانی‌های متا از سمت زمان‌بند با تایم‌اوت ۱۵ ثانیه‌ای اجرا می‌شوند.

## ۴. پیکربندی webhookها

1. متا → App → Webhooks: Callback URL = `https://<دامنه>/instagram/webhook`، Verify Token = مقدار `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`؛ اشتراک فیلد پیام‌ها و نظرات.
2. تلگرام: `setWebhook` با `secret_token` مطابق `TELEGRAM_WEBHOOK_SECRET` (مسیر setup سمت سرور موجود است).

## ۵. آزمون‌های دود (Smoke) پس از استقرار

1. `GET /healthz` → `{"status":"ok","db":"ok"}`
2. ورود مالک → داشبورد: متریک‌ها از API واقعی
3. جریان OAuth اینستاگرام → وضعیت «متصل» و `tokenExpiresAt` ≈ ۶۰ روز بعد
4. ارسال پیام آزمایشی به حساب متصل → ظهور در صندوق گفت‌وگو با نیت طبقه‌بندی‌شده
5. تأیید پیشنهاد → ارسال واقعی + رکورد ممیزی
6. دستور `/status` ربات تلگرام از حساب مالک
7. ری‌استارت سرویس (SIGTERM) → لاگ «توقف نرم» و بسته‌شدن تمیز بدون خطا

فقط پس از موفقیت همه موارد، وضعیت از BLOCKED به DEPLOYED-AND-VERIFIED تغییر می‌کند و
برچسب NOT LIVE-VERIFIED در مستندات برای قابلیت مربوط به‌روزرسانی می‌شود.

## ۶. چک‌لیست امنیتی استقرار

- [ ] همه secretها در مدیر راز میزبان (نه فایل یا مخزن)
- [ ] TLS + HSTS فعال (`NODE_ENV=production`)
- [ ] `DATABASE_SSL` مطابق میزبان تنظیم شده (پیش‌فرض auto برای اکثر سرویس‌های ابری کافی است)
- [ ] `TRUST_PROXY=true` اگر پشت پروکسی/CDN
- [ ] کوکی نشست secure است (خودکار در production)
- [ ] رمز مالک قوی و یکتا
- [ ] پشتیبان‌گیری روزانه Postgres با آزمون بازیابی
- [ ] دسترسی SSH/کنسول با احراز دومرحله‌ای
- [ ] `/healthz` به مانیتورینگ/uptime متصل است (۵۰۳ = خارج از مدار)
