import { Card, Button, Badge, StatusDot, Note } from '../components/ui';

export function Instagram() {
  // تا پیکربندی اعتبارنامه‌های متا روی سرور، هیچ اتصالی ادعا نمی‌شود.
  const connected = false;

  return (
    <div className="card-grid">
      <Card title="وضعیت اتصال حساب">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <StatusDot on={connected} />
          <span style={{ fontWeight: 700 }}>{connected ? 'متصل' : 'قطع'}</span>
          {!connected && <Badge tone="danger">متصل نیست</Badge>}
        </div>
        <p className="state-text" style={{ textAlign: 'right' }}>
          جریان احراز هویت رسمی متا (Instagram Login با Graph API v26.0) روی سرور پیاده‌سازی شده است؛
          برای فعال‌سازی، اعتبارنامه‌های متا (INSTAGRAM_APP_ID، INSTAGRAM_APP_SECRET و
          INSTAGRAM_REDIRECT_URI) باید روی سرور پیکربندی و حساب اینستاگرام از نوع حرفه‌ای
          (Business یا Creator) باشد. راهنمای کامل در docs/GO_LIVE.md آمده است.
        </p>
        <div style={{ marginTop: 16 }}>
          <Button disabled>اتصال حساب اینستاگرام</Button>
        </div>
        <Note tone="info">وضعیت واقعی اتصال پس از پیکربندی، از داشبورد و مسیر رسمی سرور خوانده می‌شود.</Note>
      </Card>

      <Card title="وضعیت انتشار">
        <Note tone="error">
          هیچ انتشار موفقی ثبت نشده است؛ صف انتشار تا برقراری اتصال واقعی غیرفعال می‌ماند.
        </Note>
      </Card>
    </div>
  );
}
