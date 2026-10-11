# زمان‌بندی و انتشار ماندگار محتوا (مرحله ۸)

این سند روش‌شناسی گردش‌کار زمان‌بندی/انتشار ماندگار را توضیح می‌دهد. انتشار زنده در محیط واقعی **NOT LIVE-VERIFIED** است (فاقد اعتبارنامه Meta واقعی).

## مدل داده و حالت‌ها

- جدول publishing_jobs: تصویر (image_url)، پیش‌نویس مرتبط، max_attempts، next_run_at، container_id، published_media_id، provider_confirmed، error_code.
- جدول publishing_job_attempts: تاریخچه تلاش‌ها (زمان، نتیجه، کد خطا، پیام).
- حالت‌ها: pending (زمان‌بندی‌شده) / running (در حال پردازش) / succeeded (منتشرشده) / failed / cancelled.
- درون پایگاه، CHECK تضمین می‌کند succeeded همیشه دارای published_media_id و provider_confirmed باشد.
- مهرهای زمانی ISO 8601 با آفست صریح (Z یا ±HH:MM) الزامی است و به صورت timestamptz ذخیره می‌شود.

## چرخه اجرا و idempotency

- poller درون فرایند سرور (setInterval، SCHEDULER_INTERVAL_MS)؛ به‌جای تایمر مرورگر، حالت در Postgres ماندگار است.
- ادعای اتمی کار با SELECT ... FOR UPDATE SKIP LOCKED انجام می‌شود؛ هر کار فقط یک‌بار برداشته می‌شود و اجرای تکراری ممکن نیست.
- در راه‌اندازی، کارهای running رهاشده (پس از کرش/ری‌استارت) با requeueStale به صف برمی‌گردند.
- انتشار دو مرحله‌ای رسمی Meta: ساخت container با POST /{ig-id}/media سپس انتشار با POST /{ig-id}/media_publish. container_id بین تلاش‌های مجدد ذخیره و بازاستفاده می‌شود تا فراخوانی تکراری /media ایجاد نشود.

## سیاست تلاش مجدد

- خطاهای دائم (بدون تلاش مجدد): INSTAGRAM_REAUTH_REQUIRED، PERMISSION_DENIED، INSTAGRAM_PUBLISH_FAILED و خطاهای 401/403/409/422 (توکن منقضی، مجوز رد‌شده، اعتبارسنجی ناموفق).
- سایر خطاها گذرا در نظر گرفته شده و با backoff نمایی (SCHEDULE_RETRY_BASE_MS × 2^(n-1)) حداکثر SCHEDULE_MAX_ATTEMPTS بار تلاش می‌شوند؛ پس از آن کار failed می‌شود.
- برای بازبینی و بازیابی کارهای ناموفق: مسیر GET /schedule/jobs/:id تاریخچه تلاش‌ها را برمی‌گرداند و POST .../retry کار ناموفق را با شمارنده بازنشانی دوباره صف می‌کند.

## مراجع رسمی (مشاوره‌شده ۲۰۲۶-۱۰-۱۱)

- Meta for Developers — Content Publishing: https://developers.facebook.com/docs/instagram-platform/content-publishing/ (مجوز instagram_business_content_publish، انتشار دو مرحله‌ای، انقضای container تا ۲۴ ساعت، سقف ۱۰۰ پست/۲۴ ساعت، بدون پارامتر زمان‌بندی در Graph API).
- Instagram Graph API Reference — IG User Media: https://developers.facebook.com/docs/instagram-graph-api/reference/ig-user/media/ (فیلدها/خطاهای container مانند IN_PROGRESS، ERROR).
- PostgreSQL 16 Documentation — SELECT: https://www.postgresql.org/docs/current/sql-select.html (FOR UPDATE SKIP LOCKED برای ادعای اتمی کار).

## اجرای مجدد ارزیابی

پس از هر تغییر در scheduler یا سیاست تلاش مجدد، تست‌های server/tests/schedule.test.ts باید دوباره اجرا شوند؛ این تست‌ها مرزهای منطقه زمانی، لغو، زمان‌بندی مجدد، اجرای تکراری، توکن منقضی، خطاهای گذرا و دائمی را پوشش می‌دهند.
