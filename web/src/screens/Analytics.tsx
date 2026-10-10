import { Card, ErrorState, DemoBadge, Note } from '../components/ui';

export function Analytics() {
  // بینش‌های واقعی تنها پس از اتصال رسمی (مرحله ۵) نمایش داده می‌شوند.
  const connected = false;

  return (
    <div className="card-grid">
      <Card title="بینش‌های حساب" icon={<DemoBadge />}>
        {connected ? (
          <div>نمایش داده‌ها پس از اتصال.</div>
        ) : (
          <ErrorState
            title="داده بینش در دسترس نیست"
            text="بینش‌های اینستاگرام فقط پس از اتصال رسمی حساب حرفه‌ای و همگام‌سازی (مرحله ۵) نمایش داده می‌شوند. هیچ عدد نمایشی به‌عنوان داده واقعی ارائه نمی‌شود."
          />
        )}
      </Card>
      <Card title="درباره داده‌ها">
        <Note tone="info">
          تمام ارقام این داشبورد تا پیش از اتصال، صرفاً نمونه «حالت نمایشی» هستند و داده واقعی کسب‌وکار محسوب نمی‌شوند.
        </Note>
      </Card>
    </div>
  );
}
