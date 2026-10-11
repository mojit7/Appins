import { describe, expect, it } from 'vitest';
import { buildSnapshot, loadDashboard, summarizeCount, summarizeInstagram, summarizeProducts } from './dashboard';

const page = (items: unknown[], total = items.length) => ({ items, total });
const ok = (v: unknown): PromiseSettledResult<unknown> => ({ status: 'fulfilled', value: v });
const fail = (reason: unknown): PromiseSettledResult<unknown> => ({ status: 'rejected', reason });

describe('summarizeProducts', () => {
  it('فعال‌ها و ناموجودها را جدا می‌کند', () => {
    const s = summarizeProducts(page([
      { id: 'a', name: 'الف', sku: 'A', priceToman: 100, stock: 2, status: 'active' },
      { id: 'b', name: 'ب', sku: 'B', priceToman: 200, stock: 0, status: 'active' },
      { id: 'c', name: 'ج', sku: 'C', priceToman: 300, stock: 5, status: 'draft' },
    ]));
    expect(s.total).toBe(3);
    expect(s.active).toBe(2);
    expect(s.outOfStock).toBe(1);
    expect(s.partial).toBe(false);
  });

  it('total بیش از سقف ۱۰۰ => partial', () => {
    const s = summarizeProducts({ items: [], total: 150 });
    expect(s.partial).toBe(true);
    expect(s.total).toBe(150);
    expect(s.active).toBe(0);
  });
});

describe('summarizeCount', () => {
  it('total سرور ملاک است، نه طول items', () => {
    expect(summarizeCount(page([{}], 42)).total).toBe(42);
    expect(summarizeCount(page([])).total).toBe(0);
  });
});

describe('summarizeInstagram', () => {
  const now = Date.UTC(2026, 9, 11);

  it('قطع => متصل نیست و کهنه نیست', () => {
    const s = summarizeInstagram({ connected: false, tokenExpiresAt: null }, now);
    expect(s.connected).toBe(false);
    expect(s.stale).toBe(false);
  });

  it('توکن منقضی => کهنه', () => {
    const s = summarizeInstagram({ connected: true, tokenExpiresAt: new Date(now - 1000).toISOString(), needsReauthorization: false }, now);
    expect(s.connected).toBe(true);
    expect(s.stale).toBe(true);
  });

  it('نیازمند اتصال مجدد => کهنه حتی با توکن معتبر', () => {
    const s = summarizeInstagram({ connected: true, tokenExpiresAt: new Date(now + 86400000).toISOString(), needsReauthorization: true }, now);
    expect(s.stale).toBe(true);
  });

  it('متصل با توکن معتبر => ok', () => {
    const s = summarizeInstagram({ connected: true, tokenExpiresAt: new Date(now + 86400000).toISOString(), needsReauthorization: false }, now);
    expect(s.connected).toBe(true);
    expect(s.stale).toBe(false);
  });
});

describe('buildSnapshot', () => {
  it('صفحات خالی => حالت صفر (نه خطا، نه ناموجود)', () => {
    const snap = buildSnapshot({
      products: ok(page([])), drafts: ok(page([])), pending: ok(page([])), failed: ok(page([])),
      instagram: ok({ connected: false }),
    }, 0);
    expect(snap.products.state).toBe('zero');
    expect(snap.drafts.state).toBe('zero');
    expect(snap.pendingJobs.state).toBe('zero');
    expect(snap.failedJobs.state).toBe('zero');
    expect(snap.instagram.state).toBe('ok');
    expect(snap.instagram.data?.connected).toBe(false);
    expect(snap.fetchedAt).toBe(new Date(0).toISOString());
  });

  it('خطای ۴۰۱/۴۰۳ => ناموجود (نیاز به ورود)', () => {
    const err = Object.assign(new Error('ورود لازم است.'), { status: 401, code: 'UNAUTHORIZED' });
    const snap = buildSnapshot({
      products: fail(err), drafts: ok(page([])), pending: ok(page([])), failed: ok(page([])),
      instagram: fail(err),
    }, 0);
    expect(snap.products.state).toBe('unavailable');
    expect(snap.instagram.state).toBe('unavailable');
    expect(snap.drafts.state).toBe('zero');
  });

  it('خطای ۵۰۳ ماژول غیرفعال => ناموجود', () => {
    const err = Object.assign(new Error('ماژول فعال نیست.'), { status: 503, code: 'CONTENT_MODULE_NOT_CONFIGURED' });
    const snap = buildSnapshot({
      products: ok(page([])), drafts: fail(err), pending: fail(err), failed: ok(page([])),
      instagram: ok({ connected: false }),
    }, 0);
    expect(snap.drafts.state).toBe('unavailable');
    expect(snap.pendingJobs.state).toBe('unavailable');
    expect(snap.failedJobs.state).toBe('zero');
  });

  it('خطای شبکه => error با پیام', () => {
    const snap = buildSnapshot({
      products: fail(new Error('fetch failed')), drafts: ok(page([])), pending: ok(page([])), failed: ok(page([])),
      instagram: ok({ connected: false }),
    }, 0);
    expect(snap.products.state).toBe('error');
    expect(snap.products.message).toContain('fetch failed');
  });

  it('اتصال متصل ولی توکن منقضی => stale', () => {
    const snap = buildSnapshot({
      products: ok(page([])), drafts: ok(page([])), pending: ok(page([])), failed: ok(page([])),
      instagram: ok({ connected: true, tokenExpiresAt: '2000-01-01T00:00:00.000Z', needsReauthorization: false }),
    }, Date.UTC(2026, 9, 11));
    expect(snap.instagram.state).toBe('stale');
    expect(snap.instagram.data?.stale).toBe(true);
  });
});

describe('loadDashboard', () => {
  it('دقیقاً پنج درخواست با مسیرهای تعریف‌شده صادر می‌کند', async () => {
    const calls: string[] = [];
    const fetcher = async (path: string) => {
      calls.push(path);
      if (path.includes('instagram')) return { ok: true, status: 200, json: async () => ({ connected: false }) };
      return { ok: true, status: 200, json: async () => ({ items: [], total: 0 }) };
    };
    const snap = await loadDashboard(fetcher, undefined, 0);
    expect(calls).toHaveLength(5);
    expect(calls).toContain('/products?page=1&pageSize=100');
    expect(calls).toContain('/drafts?page=1&pageSize=1');
    expect(calls).toContain('/schedule/jobs?page=1&pageSize=1&status=pending');
    expect(calls).toContain('/schedule/jobs?page=1&pageSize=1&status=failed');
    expect(calls).toContain('/instagram/status');
    expect(snap.fetchedAt).toBe(new Date(0).toISOString());
  });

  it('پیام خطای فارسی سرور منتقل می‌شود', async () => {
    const fetcher = async () => ({ ok: false, status: 429, json: async () => ({ code: 'RATE_LIMITED', message: 'تلاش بیش از حد.' }) });
    const snap = await loadDashboard(fetcher);
    expect(snap.products.state).toBe('error');
    expect(snap.products.message).toContain('تلاش بیش از حد');
  });

  it('خطای شبکه به پیام فارسی تبدیل می‌شود', async () => {
    const fetcher = async () => { throw new Error('boom'); };
    const snap = await loadDashboard(fetcher);
    expect(snap.products.state).toBe('error');
    expect(snap.products.message).toContain('ارتباط با سرور');
  });
});
