import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Inbox, InboxView, AutomationPanel } from './Inbox';
import type { InboxItem } from '../lib/engagement';

describe('صفحه صندوق گفت‌وگو', () => {
  it('رندر اولیه SSR-امن با حالت بارگذاری و بدون فراخوانی شبکه', () => {
    const html = renderToString(<Inbox />);
    expect(html).toContain('صندوق گفت‌وگو');
    expect(html).toContain('در حال بارگذاری گفت‌وگوها');
    expect(html).toContain('status');
    expect(html).not.toContain('تأیید زنده: انجام شد');
  });
});

// داده‌های آزمایشی — فقط برای آزمون رندر؛ داده واقعی از سرور می‌آید
const FIXTURES: InboxItem[] = [
  {
    id: 'c-1', channel: 'direct', customerUsername: 'sara', customerName: 'سارا',
    subject: 'سلام قیمت این شال چنده؟', status: 'open', salesStage: 'new',
    escalated: false, unreadCount: 2, lastIntent: 'price_inquiry', lastMessageAt: '2026-10-11T08:00:00Z',
  },
  {
    id: 'c-2', channel: 'comment', customerUsername: 'ali', customerName: 'علی',
    subject: 'مرجوع میکنم', status: 'needs_attention', salesStage: 'unresolved',
    escalated: true, unreadCount: 1, lastIntent: 'returns', lastMessageAt: '2026-10-11T09:00:00Z',
  },
];

describe('فهرست گفت‌وگوها (نمای خالص)', () => {
  it('برچسب کانال، نیت و شمار خوانده‌نشده را نشان می‌دهد', () => {
    const html = renderToString(<InboxView items={FIXTURES} total={2} onSelect={() => {}} />);
    expect(html).toContain('پیام مستقیم');
    expect(html).toContain('نظر پست');
    expect(html).toContain('استعلام قیمت');
    expect(html).toContain('خوانده‌نشده: 2');
    expect(html).toContain('ارجاع به انسان');
    expect(html).toContain('@sara');
  });

  it('حالت خالی صریح است', () => {
    const html = renderToString(<InboxView items={[]} total={0} onSelect={() => {}} />);
    expect(html).toContain('گفت‌وگویی یافت نشد');
  });
});

describe('پنل خودکارسازی', () => {
  it('وضعیت خاموش پیش‌فرض و کلید توقف نمایش داده می‌شوند', () => {
    const html = renderToString(
      <AutomationPanel
        settings={{ enabled: false, autoIntents: [], businessHours: { days: [6, 0, 1, 2, 3], start: '09:00', end: '21:00' }, duplicateWindowMinutes: 60 }}
        onDisable={() => {}}
      />,
    );
    expect(html).toContain('خودکارسازی خاموش است');
    expect(html).toContain('توقف فوری خودکارسازی');
    expect(html).toContain('هیچ');
  });
});
