import { Card, DataTable, Badge, Note } from '../components/ui';

/** تنظیمات ربات تلگرام — فهرست دستورها با پیاده‌سازی واقعی سرور مطابقت دارد (docs/TELEGRAM.md).
 *  توکن هرگز به مرورگر نمی‌آید؛ فعال‌سازی صرفاً با متغیرهای محیطی سرور انجام می‌شود. */

const REAL_COMMANDS = [
  { cmd: '/start', desc: 'خوش‌آمدگویی و راهنمای شروع (فقط مالک پیکربندی‌شده)' },
  { cmd: '/help', desc: 'فهرست دستورهای در دسترس' },
  { cmd: '/status', desc: 'وضعیت اتصال اینستاگرام و سلامت سرویس' },
  { cmd: '/upcoming', desc: 'کارهای زمان‌بندی‌شده انتشار پیش رو' },
  { cmd: '/drafts', desc: 'پیش‌نویس‌های محتوا با دکمه تأیید انتشار' },
];

export function TelegramSettings() {
  return (
    <div className="card-grid">
      <Card title="پیکربندی ربات">
        <div style={{ marginBottom: 12 }}>
          <Badge tone="neutral">وضعیت ماژول: سمت سرور تعیین می‌شود</Badge>
        </div>
        <Note tone="info">
          ربات فقط وقتی هر سه متغیر محیطی TELEGRAM_BOT_TOKEN، TELEGRAM_OWNER_ID و
          TELEGRAM_WEBHOOK_SECRET روی سرور تنظیم شوند فعال می‌شود؛ تا آن زمان مسیرهای
          تلگرام با خطای صادقانه ۵۰۳ پاسخ می‌دهند. توکن به‌صورت رمزنگاری‌نشده هرگز به
          مرورگر ارسال نمی‌شود و از لاگ‌ها حذف می‌شود.
        </Note>
      </Card>

      <Card title="دستورهای ربات">
        <DataTable
          headers={['دستور', 'توضیح']}
          rows={REAL_COMMANDS.map((c) => [
            <span dir="ltr" key={c.cmd}>{c.cmd}</span>,
            c.desc,
          ])}
        />
      </Card>
    </div>
  );
}
