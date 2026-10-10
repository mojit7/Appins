import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { App } from './App';

describe('رندر پوسته فارسی RTL', () => {
  it('ناوبری هشت‌گانه و بنر حالت نمایشی رندر می‌شوند', () => {
    const html = renderToString(<App />);
    expect(html).toContain('داشبورد');
    expect(html).toContain('محصولات');
    expect(html).toContain('استودیوی محتوای هوشمند');
    expect(html).toContain('تقویم محتوا');
    expect(html).toContain('اتصال اینستاگرام');
    expect(html).toContain('تحلیل‌ها');
    expect(html).toContain('ربات تلگرام');
    expect(html).toContain('تنظیمات');
    expect(html).toContain('حالت نمایشی فعال است');
  });

  it('حالت قطع اتصال اینستاگرام بدون ادعای اتصال نمایش داده می‌شود', () => {
    const html = renderToString(<App />);
    expect(html).toContain('متصل نیست');
    expect(html).not.toContain('اتصال برقرار است');
  });
});
