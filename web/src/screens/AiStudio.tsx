import { useState } from 'react';
import { Card, Button, Field, LoadingPanel, ErrorState, DemoBadge, Note } from '../components/ui';
import { demoProducts, demoCaption } from '../lib/demo';

type Phase = 'idle' | 'loading' | 'done' | 'error';

export function AiStudio() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [product, setProduct] = useState(demoProducts[0]?.name ?? '');

  // کلید سرویس هوش مصنوعی هنوز پیکربندی نشده است؛ تولید واقعی در مرحله ۶ فعال می‌شود.
  const aiConfigured = false;

  const generate = () => {
    if (aiConfigured) { setPhase('loading'); } else { setPhase('error'); }
  };

  return (
    <div className="card-grid">
      <Card title="تولید کپشن فارسی" icon={<DemoBadge />}>
        <div className="form-row">
          <Field label="محصول">
            <select className="select" value={product} onChange={(e) => setProduct(e.target.value)}>
              {demoProducts.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="لحن متن">
            <select className="select" defaultValue="friendly">
              <option value="friendly">صمیمی و فروش‌محور</option>
              <option value="formal">رسمی و مینیمال</option>
              <option value="story">روایتی و داستانی</option>
            </select>
          </Field>
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <Button onClick={generate} disabled={phase === 'loading'}>تولید کپشن</Button>
          <Button variant="ghost" disabled>انتشار مستقیم (نیازمند اتصال اینستاگرام)</Button>
        </div>
        <Note tone="info">
          تا مرحله ۶، تولید متن واقعی متصل نیست و خروجی زیر صرفاً نمونه نمایشی است.
        </Note>
      </Card>

      <Card title="پیش‌نویس کپشن">
        {phase === 'idle' && (
          <p className="state-text" style={{ textAlign: 'right' }}>
            محصول «{product}» را انتخاب کرده و دکمه تولید را بزنید.
          </p>
        )}
        {phase === 'loading' && <LoadingPanel rows={5} label="در حال تولید کپشن…" />}
        {phase === 'done' && <div className="caption-box">{demoCaption}</div>}
        {phase === 'error' && (
          <ErrorState
            title="سرویس هوش مصنوعی در دسترس نیست"
            text="کلید سرویس در تنظیمات پیکربندی نشده است. پس از تنظیم، تولید واقعی در مرحله ۶ فعال می‌شود."
          />
        )}
      </Card>
    </div>
  );
}
