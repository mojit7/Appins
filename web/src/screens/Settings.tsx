import { useState } from 'react';
import { Card, Field, Button, Toggle, Note, DemoBadge } from '../components/ui';

export function Settings() {
  const [shopName, setShopName] = useState('فروشگاه‌یار');
  const [demoMode, setDemoMode] = useState(true);
  const [saved, setSaved] = useState(false);

  return (
    <div className="card-grid">
      <Card title="تنظیمات عمومی">
        <div className="form-row">
          <Field label="نام فروشگاه">
            <input className="input" value={shopName} onChange={(e) => { setShopName(e.target.value); setSaved(false); }} />
          </Field>
          <Field label="منطقه زمانی">
            <select className="select" defaultValue="tehran">
              <option value="tehran">تهران (UTC+03:30)</option>
              <option value="kabul">کابل (UTC+04:30)</option>
              <option value="dubai">دبی (UTC+04:00)</option>
            </select>
          </Field>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '16px 0' }}>
          <span style={{ fontWeight: 700 }}>حالت نمایشی <DemoBadge /></span>
          <Toggle checked={demoMode} onChange={setDemoMode} label="حالت نمایشی" />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button onClick={() => setSaved(true)} disabled={!shopName.trim()}>ذخیره تغییرات</Button>
          {saved && <Note tone="success">تنظیمات ذخیره شد.</Note>}
        </div>
      </Card>

      <Card title="درباره">
        <Note tone="info">
          فروشگاه‌یار — نسخه ۰٫۲ (مرحله ۲ از ۱۰). این صفحه صرفاً بخش تنظیمات پوسته است؛
          داده‌ها پس از پیاده‌سازی لایه ماندگاری (مرحله ۲ سرور) واقعی می‌شوند.
        </Note>
      </Card>
    </div>
  );
}
