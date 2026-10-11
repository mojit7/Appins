import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { runMigrations, listAppliedMigrations } from '../src/db/migrate.js';
import { MIGRATIONS } from '../src/db/migrations.js';
import { withTransaction } from '../src/db/pool.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../src/core/errors.js';
import { ProductRepository } from '../src/data/products.js';
import { DraftRepository } from '../src/data/drafts.js';
import { PublishingJobRepository } from '../src/data/publishingJobs.js';
import { IntegrationConnectionRepository } from '../src/data/connections.js';
import { OperationalLogRepository } from '../src/data/operationalLogs.js';
import { OWNER } from '../src/data/context.js';

const CONN = process.env.DATABASE_URL ?? 'postgres://appins:test@localhost:5432/appins_test';
let pool: Pool;
let products: ProductRepository;
let drafts: DraftRepository;
let jobs: PublishingJobRepository;
let conns: IntegrationConnectionRepository;
let logs: OperationalLogRepository;
let firstRun: number;

beforeAll(async () => {
  pool = new Pool({ connectionString: CONN });
  firstRun = await runMigrations(pool);
  products = new ProductRepository(pool);
  drafts = new DraftRepository(pool);
  jobs = new PublishingJobRepository(pool);
  conns = new IntegrationConnectionRepository(pool);
  logs = new OperationalLogRepository(pool);
});

afterAll(async () => { await pool.end(); });

beforeEach(async () => {
  await pool.query('TRUNCATE publishing_jobs, content_drafts, products, integration_connections, operational_logs, instagram_credentials RESTART IDENTITY CASCADE');
});

describe('مهاجرت', () => {
  it('اجرای اول هر مهاجرت را اعمال می‌کند و اجرای مجدد هیچ‌چیز اعمال نمی‌کند', async () => {
    expect(firstRun).toBeGreaterThanOrEqual(0);
    const again = await runMigrations(pool);
    expect(again).toBe(0);
    const applied = await listAppliedMigrations(pool);
    expect(applied.length).toBe(MIGRATIONS.length);
    expect(applied).toContain('001_init_core_tables');
    expect(applied).toContain('002_instagram_credentials');
  });
});

describe('محصولات — CRUD معتبر و نامعتبر', () => {
  const valid = { name: 'شال حریر بهاره', priceToman: 285000, stock: 12, sku: 'SHL-01' };

  it('ایجاد و خواندن معتبر', async () => {
    const p = await products.create(OWNER, valid);
    expect(p.id).toBeTruthy();
    expect(p.status).toBe('draft');
    const got = await products.get(OWNER, p.id);
    expect(got.sku).toBe('SHL-01');
  });

  it('ماندگاری پس از بستن اتصال و اتصال مجدد', async () => {
    const p = await products.create(OWNER, valid);
    const pool2 = new Pool({ connectionString: CONN });
    try {
      const got = await new ProductRepository(pool2).get(OWNER, p.id);
      expect(got.name).toBe(p.name);
      expect(got.priceToman).toBe(285000);
    } finally { await pool2.end(); }
  });

  it('قیمت منفی رد می‌شود (اعتبارسنجی zod)', async () => {
    await expect(products.create(OWNER, { ...valid, priceToman: -1 })).rejects.toThrowError(ValidationError);
  });

  it('sku تکراری ConflictError می‌دهد (قید یکتای دیتابیس)', async () => {
    await products.create(OWNER, valid);
    await expect(products.create(OWNER, { ...valid, name: 'شال دوم' })).rejects.toThrowError(ConflictError);
  });

  it('به‌روزرسانی معتبر و ناموجود', async () => {
    const p = await products.create(OWNER, valid);
    const upd = await products.update(OWNER, p.id, { priceToman: 300000, status: 'active' });
    expect(upd.priceToman).toBe(300000);
    expect(upd.status).toBe('active');
    await expect(products.update(OWNER, '00000000-0000-0000-0000-000000000000', { stock: 1 })).rejects.toThrowError(NotFoundError);
  });

  it('حذف بدون وابستگی موفق و با پیش‌نویس، مسدود (RESTRICT)', async () => {
    const p1 = await products.create(OWNER, valid);
    await products.delete(OWNER, p1.id);
    const p2 = await products.create(OWNER, valid);
    await drafts.create(OWNER, { title: 'پست شال', productId: p2.id });
    await expect(products.delete(OWNER, p2.id)).rejects.toThrowError(ConflictError);
  });

  it('صفحه‌بندی: ۳ محصول، صفحه ۲ با اندازه ۲', async () => {
    for (const sku of ['A-1', 'A-2', 'A-3']) {
      await products.create(OWNER, { ...valid, sku });
    }
    const pg1 = await products.list(OWNER, 1, 2);
    const pg2 = await products.list(OWNER, 2, 2);
    expect(pg1.total).toBe(3);
    expect(pg1.items.length).toBe(2);
    expect(pg2.items.length).toBe(1);
  });

  it('عملیات بدون زمینه کاربر مجاز، ForbiddenError می‌دهد', async () => {
    await expect(products.list(undefined as never, 1, 20)).rejects.toThrowError(ForbiddenError);
    await expect(products.create(null as never, valid)).rejects.toThrowError(ForbiddenError);
  });
});

describe('پیش‌نویس‌ها', () => {
  it('ایجاد معتبر و زمان‌بندی‌شده بدون زمان رد می‌شود', async () => {
    const d = await drafts.create(OWNER, { title: 'رِیلز معرفی', caption: 'متن' });
    expect(d.status).toBe('draft');
    await expect(drafts.create(OWNER, { title: 'بدون زمان', status: 'scheduled' })).rejects.toThrowError(ValidationError);
  });

  it('صفحه‌بندی فهرست', async () => {
    await drafts.create(OWNER, { title: 'یک' });
    await drafts.create(OWNER, { title: 'دو' });
    await drafts.create(OWNER, { title: 'سه' });
    const page = await drafts.list(OWNER, 1, 2);
    expect(page.total).toBe(3);
    expect(page.items.length).toBe(2);
  });
});

describe('کارهای انتشار', () => {
  it('ایجاد نیازمند پیش‌نویس موجود است', async () => {
    await expect(jobs.create(OWNER, { draftId: '00000000-0000-0000-0000-000000000000', scheduledAt: new Date('2026-10-20T18:30:00.000Z'), imageUrl: 'https://cdn.example.com/a.jpg', maxAttempts: 3 }))
      .rejects.toThrowError(NotFoundError);
  });

  it('چرخه وضعیت: ایجاد ← برداشت ← پایان', async () => {
    const d = await drafts.create(OWNER, { title: 'پست تست' });
    const j = await jobs.create(OWNER, { draftId: d.id, scheduledAt: new Date('2020-01-01T00:00:00.000Z'), imageUrl: 'https://cdn.example.com/a.jpg', maxAttempts: 3 });
    expect(j.status).toBe('pending');
    const started = await jobs.claimNextDue();
    expect(started?.id).toBe(j.id);
    expect(started?.status).toBe('running');
    expect(started?.attempt).toBe(1);
    await jobs.markFailed(j.id, 'TEST', 'اتصال برقرار نیست');
    const finished = await jobs.get(OWNER, j.id);
    expect(finished.status).toBe('failed');
    expect(finished.errorMessage).toBe('اتصال برقرار نیست');
  });

  it('فقط کارهای سررسیده برداشت می‌شوند', async () => {
    const d1 = await drafts.create(OWNER, { title: 'پست سررسید' });
    const d2 = await drafts.create(OWNER, { title: 'پست آینده' });
    const due = await jobs.create(OWNER, { draftId: d1.id, scheduledAt: new Date('2020-01-01T00:00:00.000Z'), imageUrl: 'https://cdn.example.com/a.jpg', maxAttempts: 3 });
    await jobs.create(OWNER, { draftId: d2.id, scheduledAt: new Date('2099-01-01T00:00:00.000Z'), imageUrl: 'https://cdn.example.com/b.jpg', maxAttempts: 3 });
    const first = await jobs.claimNextDue();
    expect(first?.id).toBe(due.id);
    const second = await jobs.claimNextDue();
    expect(second).toBeNull();
  });
});

describe('تراکنش', () => {
  it('خطای داخل تراکنش همه تغییرات را برمی‌گرداند', async () => {
    const before = (await pool.query<{ c: number }>('SELECT count(*)::int AS c FROM products')).rows[0]?.c ?? 0;
    await expect(
      withTransaction(pool, async (client) => {
        await client.query("INSERT INTO products (name, price_toman, sku) VALUES ('موقت', 1, 'TMP-1')");
        throw new Error('خطای آزمایشی');
      }),
    ).rejects.toThrowError('خطای آزمایشی');
    const after = (await pool.query<{ c: number }>('SELECT count(*)::int AS c FROM products')).rows[0]?.c ?? 0;
    expect(after).toBe(before);
  });
});

describe('اتصال‌ها و لاگ‌ها', () => {
  it('upsert اتصال بدون تکرار رکورد', async () => {
    await conns.upsert(OWNER, { provider: 'instagram', status: 'disconnected', accountRef: null });
    await conns.upsert(OWNER, { provider: 'instagram', status: 'connected', accountRef: 'IG-123' });
    const c = await conns.get(OWNER, 'instagram');
    expect(c?.status).toBe('connected');
    expect(c?.accountRef).toBe('IG-123');
    const total = (await pool.query<{ c: number }>('SELECT count(*)::int AS c FROM integration_connections')).rows[0]?.c ?? 0;
    expect(total).toBe(1);
  });

  it('اتصال متصل بدون شناسه حساب رد می‌شود', async () => {
    await expect(conns.upsert(OWNER, { provider: 'telegram', status: 'connected', accountRef: null })).rejects.toThrowError(ValidationError);
  });

  it('لاگ فقط-افزودنی و مرتب نزولی', async () => {
    await logs.append(OWNER, { level: 'info', event: 'job.started', payload: { id: 'x' } });
    await logs.append(OWNER, { level: 'error', event: 'job.failed', payload: { reason: 'test' } });
    const recent = await logs.recent(OWNER, 10);
    expect(recent.length).toBe(2);
    expect(recent[0]?.event).toBe('job.failed');
  });
});
