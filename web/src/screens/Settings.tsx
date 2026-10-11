import { Card, Field, Note, Badge } from '../components/ui';

/** تنظیمات عمومی — به‌روزرسانی پایایی سمت سرور هنوز پیاده‌سازی نشده است؛
 *  هیچ دکمه «ذخیره» نمایشی یا پیام موفقیت ساختگی وجود ندارد. */

export function Settings() {
  return (
    <div className="card-grid">
      <Card title="تنظیمات عمومی">
        <div className="form-row">
          <Field label="نام فروشگاه" hint="پایدارسازی سمت سرور در نسخه‌های بعدی فعال می‌شود.">
            <input className="input" value="فروشگاه‌یار" disabled readOnly />
          </Field>
          <Field label="منطقه زمانی" hint="زمان‌بندی انتشار و ساعات کاری خودکارسازی با آفست صریح ISO 8601 ذخیره می‌شوند.">
            <select className="select" defaultValue="tehran" disabled>
              <option value="tehran">تهران (UTC+03:30)</option>
            </select>
          </Field>
        </div>
        <Note tone="info">
          این مقادیر صرفاً نمایش وضعیت فعلی هستند؛ تغییرات هنوز روی سرور ذخیره نمی‌شوند.
          به‌محض پیاده‌سازی پایدارسازی، این صفحه متصل می‌شود.
        </Note>
      </Card>

      <Card title="درباره">
        <div style={{ marginBottom: 12 }}>
          <Badge tone="neutral">نسخه ۱٫۱٫۰</Badge>
        </div>
        <Note tone="info">
          فروشگاه‌یار — دستیار فروشگاه اینستاگرام. وضعیت صادقانه قابلیت‌ها و مراجع رسمی
          هر ادعا در docs/INSTAGRAM_CAPABILITY_MATRIX.md و docs/ENGAGEMENT.md مستند است.
        </Note>
      </Card>
    </div>
  );
}
