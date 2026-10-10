import { Card, Button, Badge, StatusDot, Note, Field } from '../components/ui';

export function Instagram() {
  // اتصال واقعی در مرحله ۴ برقرار می‌شود؛ فعلاً هیچ اتصالی ادعا نمی‌شود.
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
          برای اتصال، حساب اینستاگرام باید از نوع حرفه‌ای (Business یا Creator) باشد و توکن دسترسی
          از مسیر رسمی متا صادر شود. جریان احراز هویت در مرحله ۴ پیاده‌سازی خواهد شد.
        </p>
        <div style={{ marginTop: 16 }}>
          <Button disabled>اتصال حساب اینستاگرام</Button>
        </div>
        <Note tone="info">فیس‌بوک پیج اجباری نیست؛ در صورت پشتیبانی رسمی، مسیر سبک‌تر ترجیح داده می‌شود.</Note>
      </Card>

      <Card title="وضعیت انتشار">
        <Field label="آخرین انتشار موفق" hint="پس از اتصال و انتشار واقعی تکمیل می‌شود.">
          <input className="input" value="—" disabled readOnly />
        </Field>
        <div style={{ marginTop: 16 }}>
          <Note tone="error">
            هیچ انتشار موفقی ثبت نشده است؛ صف انتشار تا برقراری اتصال غیرفعال می‌ماند.
          </Note>
        </div>
      </Card>
    </div>
  );
}
