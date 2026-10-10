import { Card, Field, Toggle, DataTable, Badge, DemoBadge } from '../components/ui';
import { demoCommands } from '../lib/demo';

export function TelegramSettings() {
  // راه‌اندازی واقعی ربات در مرحله ۷؛ توکن فقط سمت سرور نگه‌داری می‌شود.
  const botEnabled = false;

  return (
    <div className="card-grid">
      <Card title="پیکربندی ربات">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontWeight: 700 }}>فعال‌سازی ربات</span>
          <Toggle checked={botEnabled} onChange={() => undefined} disabled label="فعال‌سازی ربات تلگرام" />
        </div>
        <Field label="توکن ربات" hint="توکن فقط روی سرور ذخیره می‌شود و هرگز به مرورگر ارسال نمی‌شود.">
          <input className="input" type="password" value="" disabled placeholder="••••••••" readOnly />
        </Field>
        <div style={{ marginTop: 12 }}>
          <Badge tone={botEnabled ? 'success' : 'neutral'}>{botEnabled ? 'در حال کار' : 'غیرفعال — مرحله ۷'}</Badge>
        </div>
      </Card>

      <Card title="دستورهای ربات" icon={<DemoBadge />}>
        <DataTable
          headers={['دستور', 'توضیح']}
          rows={demoCommands.map((c) => [
            <span dir="ltr">{c.cmd}</span>,
            c.desc,
          ])}
        />
      </Card>
    </div>
  );
}
