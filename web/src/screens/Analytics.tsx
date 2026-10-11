import { Card, ErrorState, Note } from '../components/ui';

export function Analytics() {
  return (
    <div className="card-grid">
      <Card title="بینش‌های حساب">
        <ErrorState
          title="داده بینش در دسترس نیست"
          text="بینش‌های اینستاگرام فقط پس از اتصال رسمی حساب حرفه‌ای و اعطای مجوز instagram_business_manage_insights از مسیر رسمی متا نمایش داده می‌شوند. هیچ عدد ساختگی نمایش داده نمی‌شود."
        />
      </Card>
      <Card title="درباره داده‌ها">
        <Note tone="info">
          هر عدد در این داشبورد فقط از مسیر رسمی متا خوانده می‌شود؛ وضعیت هر قابلیت و
          مرجع رسمی آن در docs/INSTAGRAM_CAPABILITY_MATRIX.md مستند است.
        </Note>
      </Card>
    </div>
  );
}
