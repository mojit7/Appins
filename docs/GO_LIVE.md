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
- `SESSION_SECRET` — ≥۳۲ نویسه تصادفی (`openssl rand -hex 32`)
- `OWNER_PASSWORD` — ≥۱۰ نویسه قوی
- `NODE_ENV=production`

اختیاری (فعال‌سازی ماژول‌ها):
- اینستاگرام: `INSTAGRAM_APP_ID`، `INSTAGRAM_APP_SECRET`، `INSTAGRAM_REDIRECT_URI`، `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`، `INSTAGRAM_APP_SECRET` برای امضای webhook
- تلگرام: `TELEGRAM_BOT_TOKEN`، `TELEGRAM_OWNER_ID`، `TELEGRAM_WEBHOOK_SECRET`
- هوش مصنوعی: `AI_PROVIDER_API_KEY`، `AI_PROVIDER_BASE_URL`، `AI_PROVIDER_MODEL`

## ۳. استقرار (چند دقیقه‌ای)

```bash
npm ci            # نصب قطعی وابستگی‌ها از lockfile
npm run build     # ساخت سرور و وب
npx tsx server/src/db/migrate.ts   # اجرای مهاجرت‌ها (یا معادل اسکریپت اجرای مهاجرت)
NODE_ENV=production node ...       # اجرای server (index.ts) روی PORT
```

- پشت سرور، TLS را فعال کنید (HSTS خودکار در production ارسال می‌شود).
- وب ساخته‌شده را میزبانی کنید و `/api` را به سرور پراکسی کنید؛ `/instagram/webhook` و `/telegram/webhook` باید روی HTTPS عمومی در دسترس باشند.

## ۴. پیکربندی webhookها

1. متا → App → Webhooks: Callback URL = `https://<دامنه>/instagram/webhook`، Verify Token = مقدار `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`؛ اشتراک فیلد پیام‌ها و نظرات.
2. تلگرام: `setWebhook` با `secret_token` مطابق `TELEGRAM_WEBHOOK_SECRET` (مسیر setup سمت سرور موجود است).

## ۵. آزمون‌های دود (Smoke) پس از استقرار

1. `GET /healthz` → ok
2. ورود مالک → داشبورد: متریک‌ها از API واقعی
3. جریان OAuth اینستاگرام → وضعیت «متصل»
4. ارسال پیام آزمایشی به حساب متصل → ظهور در صندوق گفت‌وگو با نیت طبقه‌بندی‌شده
5. تأیید پیشنهاد → ارسال واقعی + رکورد ممیزی
6. دستور `/status` ربات تلگرام از حساب مالک

فقط پس از موفقیت همه موارد، وضعیت از BLOCKED به DEPLOYED-AND-VERIFIED تغییر می‌کند و
برچسب NOT LIVE-VERIFIED در مستندات برای قابلیت مربوط به‌روزرسانی می‌شود.

## ۶. چک‌لیست امنیتی استقرار

- [ ] همه secretها در مدیر راز میزبان (نه فایل یا مخزن)
- [ ] TLS + HSTS فعال (`NODE_ENV=production`)
- [ ] کوکی نشست secure است (خودکار در production)
- [ ] رمز مالک قوی و یکتا
- [ ] پشتیبان‌گیری روزانه Postgres با آزمون بازیابی
- [ ] دسترسی SSH/کنسول با احراز دومرحله‌ای
