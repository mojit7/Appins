# ماتریس قابلیت اینستاگرام (Instagram Login) — Appins

تاریخ تدوین: ۲۰۲۶-۱۰-۱۱ · نسخه Graph API هدف: **v26.0** (آخرین نسخه پایدار — Graph API Changelog رسمی متا)
وضعیت کلی: پیاده‌سازی‌ها بر پایه مستندات رسمی **VERIFIED**؛ اتصال واقعی با اعتبارنامه معتبر انجام نشده ⇒ کل یکپارچه‌سازی **NOT LIVE-VERIFIED**.

| گردش‌کار کاربر | API رسمی و نقطه پایانی | نوع حساب لازم | مجوز لازم | الزام توکن/احراز | محدودیت‌ها | الزام پیکربندی/بازبینی | مستند رسمی | وضعیت |
|---|---|---|---|---|---|---|---|---|
| شروع اتصال | GET https://www.instagram.com/oauth/authorize (response_type=code) | حرفه‌ای (Business یا Creator) | instagram_business_basic (+ manage_insights, content_publish) | app id/secret و redirect URI سمت سرور | state امضاشده با HMAC با TTL ۱۰ دقیقه | App Dashboard > Instagram > API setup with Instagram login | Business Login for Instagram (developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login) | VERIFIED / NOT LIVE-VERIFIED |
| بازگشت و تبادل کد | POST https://api.instagram.com/oauth/access_token | حرفه‌ای | همان‌ها | کد یک‌بارمصرف؛ خطای access_denied رد کاربر | کد استفاده‌شده/نامعتبر ⇒ خطا | همان | همان | VERIFIED / NOT LIVE-VERIFIED |
| توکن بلندمدت | GET https://graph.instagram.com/access_token (grant_type=ig_exchange_token) | حرفه‌ای | — | app secret فقط سمت سرور | اعتبار ۶۰ روز | همان | همان | VERIFIED / NOT LIVE-VERIFIED |
| تازه‌سازی توکن | GET https://graph.instagram.com/refresh_access_token (grant_type=ig_refresh_token) | حرفه‌ای | — | توکن ≥۲۴ ساعت قدمت و منقضی‌نشده | توکن تازه ۶۰ روز از زمان تازه‌سازی؛ توکن ۶۰ روز تازه‌نشده برای همیشه باطل است | همان | Refresh Access Token (developers.facebook.com/docs/instagram-platform/reference/refresh_access_token) | VERIFIED / NOT LIVE-VERIFIED |
| پروفایل | GET https://graph.instagram.com/v26.0/me (fields: user_id, username, account_type, followers_count, media_count) | حرفه‌ای | instagram_business_basic | توکن بلندمدت | فقط فیلدهای مستندشده | همان | Instagram API with Instagram Login | VERIFIED / NOT LIVE-VERIFIED |
| بینش رسانه | GET /{media-id}/insights | حرفه‌ای | instagram_business_manage_insights | توکن بلندمدت | متریک‌های مجاز (likes, comments, views و…) | همان | Instagram Platform — Insights | VERIFIED / NOT LIVE-VERIFIED |
| انتشار تصویر | POST /{ig-id}/media سپس /{ig-id}/media_publish | حرفه‌ای | instagram_business_content_publish | توکن بلندمدت | تصویر JPEG با نشانی عمومی http(s)؛ کپشن ≤۲۲۰۰ نویسه؛ سهمیه انتشار روزانه؛ نظرسنجی status_code تا FINISHED | Advanced Access (بازبینی اپ) برای کاربران واقعی | Content Publishing API (developers.facebook.com/docs/instagram-platform/content-publishing) | VERIFIED / NOT LIVE-VERIFIED |
| قطع اتصال | حذف توکن و وضعیت disconnected در پایگاه‌داده | — | — | — | توکن ذخیره‌شده حذف می‌شود | — | — | VERIFIED |

## یادداشت‌ها
- بدون Facebook Login / صفحه فیس‌بوک: هیچ قابلیت مرحله ۴ به آن وابسته نیست؛ همه گردش‌کارها با Instagram Login مستقیم تأیید شده‌اند.
- حساب‌های شخصی (Personal) پشتیبانی نمی‌شوند — API رسمی فقط حساب‌های حرفه‌ای (Business/Creator) را می‌پذیرد.
- scopeهای قدیمی (instagram_basic و…) جای خود را به instagram_business_* داده‌اند (از ۲۷ ژانویه ۲۰۲۵).
- خطای Graph کد ۱۹۰ ⇔ توکن منقضی/باطل ⇒ الزام اتصال مجدد.
