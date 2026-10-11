import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Dashboard, DashboardView } from './Dashboard';
import { buildSnapshot } from '../lib/dashboard';

const ok = (v: unknown): PromiseSettledResult<unknown> => ({ status: 'fulfilled', value: v });
const fail = (reason: unknown): PromiseSettledResult<unknown> => ({ status: 'rejected', reason });

describe('داشبورد — رندر اولیه (پیش از داده)', () => {
  it('حالت بارگذاری بدون فراخوانی شبکه رندر می‌شود', () => {
    const html = renderToString(<Dashboard />);
    expect(html).toContain('در حال بارگذاری داده‌ها از سرور');
  });

  it('هیچ متریک جعلی (فروش/دنبال‌کننده/بازدید) نمایش داده نمی‌شود', () => {
    const html = renderToString(<Dashboard />);
    expect(html).not.toContain('فروش امروز');
    expect(html).not.toContain('دنبال‌کنندگان');
    expect(html).not.toContain('بازدید پروفایل');
  });
});

describe('داشبورد — نمای بارگذاری‌شده با داده واقعی', () => {
  it('متریک‌ها از snapshot سرور رندر می‌شوند؛ بینش بدون منبع «در دسترس نیست» علامت می‌خورد', () => {
    const snap = buildSnapshot({
      products: ok({ items: [
        { id: 'p1', name: 'شال حریر', sku: 'SHL-01', priceToman: 285000, stock: 12, status: 'active' },
      ], total: 1 }),
      drafts: ok({ items: [], total: 4 }),
      pending: ok({ items: [], total: 2 }),
      failed: ok({ items: [], total: 0 }),
      instagram: ok({ connected: false, tokenExpiresAt: null }),
    }, Date.UTC(2026, 9, 11));
    const html = renderToString(<DashboardView snap={snap} />);
    expect(html).toContain('محصولات فعال');
    expect(html).toContain('شال حریر');
    expect(html).toContain('بینش‌های کسب‌وکار در دسترس نیست');
    expect(html).not.toContain('فروش امروز');
  });

  it('حالت صفر واقعی از ناموجود تفکیک می‌شود', () => {
    const snap = buildSnapshot({
      products: ok({ items: [], total: 0 }),
      drafts: ok({ items: [], total: 0 }),
      pending: ok({ items: [], total: 0 }),
      failed: ok({ items: [], total: 0 }),
      instagram: ok({ connected: false, tokenExpiresAt: null }),
    }, 0);
    const html = renderToString(<DashboardView snap={snap} />);
    expect(html).toContain('هنوز محصولی ثبت نشده است');
    expect(html).toContain('هنوز داده‌ای ثبت نشده است');
    expect(html).toContain('متصل نیست');
  });

  it('خطای ۴۰۱ => پیام «باید وارد حساب شوید» به‌جای عدد', () => {
    const err = Object.assign(new Error('ورود لازم است.'), { status: 401, code: 'UNAUTHORIZED' });
    const snap = buildSnapshot({
      products: fail(err), drafts: fail(err), pending: fail(err), failed: fail(err), instagram: fail(err),
    }, 0);
    const html = renderToString(<DashboardView snap={snap} />);
    expect(html).toContain('برای دیدن داده‌ها باید وارد حساب شوید');
    expect(html).toContain('محصولات در دسترس نیست');
  });

  it('اتصال با توکن منقضی => هشدار کهنگی', () => {
    const snap = buildSnapshot({
      products: ok({ items: [], total: 0 }),
      drafts: ok({ items: [], total: 0 }),
      pending: ok({ items: [], total: 0 }),
      failed: ok({ items: [], total: 0 }),
      instagram: ok({ connected: true, tokenExpiresAt: '2000-01-01T00:00:00.000Z', needsReauthorization: false }),
    }, Date.UTC(2026, 9, 11));
    const html = renderToString(<DashboardView snap={snap} />);
    expect(html).toContain('توکن دسترسی منقضی');
    expect(html).toContain('اتصال ثبت‌شده');
  });
});
