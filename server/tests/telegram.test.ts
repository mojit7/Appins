import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server/app.js';
import { loadEnv } from '../src/config/env.js';
import { runMigrations } from '../src/db/migrate.js';
import { OWNER } from '../src/data/context.js';
import { DraftRepository } from '../src/data/drafts.js';
import { PublishingJobRepository } from '../src/data/publishingJobs.js';
import { TelegramClient } from '../src/integrations/telegram/client.js';
import { TelegramOutcomeNotifier } from '../src/integrations/telegram/notifier.js';
import type { PublishingJob } from '../src/domain/schedule.js';
import type { FetchLike } from '../src/integrations/instagram/oauth.js';

const CONN = process.env.DATABASE_URL ?? 'postgres://appins:test@localhost:5432/appins_test';

const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: CONN,
  SESSION_SECRET: '0123456789abcdef0123456789abcdef',
  OWNER_PASSWORD: 'test-owner-pass-123',
  LOG_LEVEL: 'fatal',
  TELEGRAM_BOT_TOKEN: 'TESTTOKEN',
  TELEGRAM_OWNER_ID: '111',
  TELEGRAM_WEBHOOK_SECRET: 'sec-1',
});

interface Handler { (url: string): { status: number; body: unknown } | null }

function makeFetcher(handler: Handler): { fetcher: FetchLike; calls: Array<{ url: string; body: any }> } {
  const calls: Array<{ url: string; body: any }> = [];
  const fetcher: FetchLike = async (url, init) => {
    const initO = init as { body?: string } | undefined;
    calls.push({ url, body: initO?.body ? JSON.parse(initO.body) : null });
    const r = handler(url);
    if (r === null) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
  return { fetcher, calls };
}

const OK = { status: 200, body: { ok: true, result: { message_id: 1 } } };
const allOk: Handler = (url) => (url.includes('TESTTOKEN/') ? OK : null);

let pool: Pool;
let drafts: DraftRepository;
let jobs: PublishingJobRepository;

beforeAll(async () => {
  pool = new Pool({ connectionString: CONN });
  await runMigrations(pool);
  drafts = new DraftRepository(pool);
  jobs = new PublishingJobRepository(pool);
});

afterAll(async () => { await pool.end(); });

beforeEach(async () => {
  await pool.query('TRUNCATE products, content_drafts, publishing_jobs, publishing_job_attempts RESTART IDENTITY CASCADE');
});

async function login(app: FastifyInstance): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'test-owner-pass-123' } });
  const setCookie = res.headers['set-cookie'];
  const first = Array.isArray(setCookie) ? setCookie[0] : (setCookie as string | undefined);
  expect(first).toBeTruthy();
  return (first as string).split(';')[0];
}

async function makeApp(handler: Handler): Promise<{ app: FastifyInstance; cookie: string; calls: Array<{ url: string; body: any }> }> {
  const { fetcher, calls } = makeFetcher(handler);
  const app = buildApp({ env, ai: { env, pool }, telegram: { env, pool, fetcher } });
  const cookie = await login(app);
  return { app, cookie, calls };
}

async function webhook(app: FastifyInstance, update: unknown, secret = 'sec-1'): Promise<{ statusCode: number; body: any }> {
  const res = await app.inject({
    method: 'POST', url: '/telegram/webhook', payload: update,
    headers: { 'x-telegram-bot-api-secret-token': secret },
  });
  return { statusCode: res.statusCode, body: res.json() };
}

function msgUpdate(updateId: number, chatId: number, text: string): unknown {
  return { update_id: updateId, message: { message_id: 1, from: { id: chatId }, chat: { id: chatId }, date: 0, text } };
}

function cbUpdate(updateId: number, fromId: number, data: string, cqId = 'cq1'): unknown {
  return { update_id: updateId, callback_query: { id: cqId, from: { id: fromId }, message: { message_id: 1, chat: { id: fromId }, date: 0 }, data } };
}

function sent(calls: Array<{ url: string; body: any }>): any[] {
  return calls.filter((c) => c.url.endsWith('/sendMessage')).map((c) => c.body);
}

function answered(calls: Array<{ url: string; body: any }>): any[] {
  return calls.filter((c) => c.url.endsWith('/answerCallbackQuery')).map((c) => c.body);
}

describe('ربات تلگرام دستیار مالک', () => {
  it('بدون پیکربندی تلگرام، همه مسیرها stub با 503 پاسخ می‌دهند', async () => {
    const app = buildApp({ env });
    try {
      const cookie = await login(app);
      const wh = await app.inject({ method: 'POST', url: '/telegram/webhook', payload: msgUpdate(1, 111, '/start') });
      expect(wh.statusCode).toBe(503);
      expect(wh.json().code).toBe('TELEGRAM_MODULE_NOT_CONFIGURED');
      const info = await app.inject({ method: 'GET', url: '/telegram/webhook/info', headers: { cookie } });
      expect(info.statusCode).toBe(503);
    } finally { await app.close(); }
  });

  it('webhook با سرّ نادرست یا بدون سرّ رد می‌شود (403)', async () => {
    const { app } = await makeApp(allOk);
    try {
      const noHeader = await app.inject({ method: 'POST', url: '/telegram/webhook', payload: msgUpdate(1, 111, '/start') });
      expect(noHeader.statusCode).toBe(403);
      const bad = await webhook(app, msgUpdate(1, 111, '/start'), 'wrong-secret');
      expect(bad.statusCode).toBe(403);
    } finally { await app.close(); }
  });

  it('خوش‌آمد و راهنمای فارسی برای مالک', async () => {
    const { app, calls } = await makeApp(allOk);
    try {
      const r1 = await webhook(app, msgUpdate(1, 111, '/start'));
      expect(r1.statusCode).toBe(200);
      expect(r1.body.ok).toBe(true);
      expect(sent(calls)[0].chat_id).toBe('111');
      expect(sent(calls)[0].text).toContain('سلام');
      const r2 = await webhook(app, msgUpdate(2, 111, '/help'));
      expect(r2.statusCode).toBe(200);
      expect(sent(calls)[1].text).toContain('/status');
    } finally { await app.close(); }
  });

  it('کاربر غیرمجاز پیام رد می‌گیرد و داده فروشگاه را نمی‌بیند', async () => {
    const { app, calls } = await makeApp(allOk);
    try {
      await pool.query("INSERT INTO products (name, price_toman, sku) VALUES ('کالا', 1000, 'SKU-T1')");
      const r = await webhook(app, msgUpdate(1, 999, '/status'));
      expect(r.statusCode).toBe(200);
      const msgs = sent(calls);
      expect(msgs.length).toBe(1);
      expect(msgs[0].text).toContain('فقط برای مالک');
      expect(msgs[0].text).not.toContain('محصولات');
    } finally { await app.close(); }
  });

  it('فرمان /status وضعیت فروشگاه را برمی‌گرداند', async () => {
    const { app, calls } = await makeApp(allOk);
    try {
      await pool.query("INSERT INTO products (name, price_toman, sku) VALUES ('کالا', 1000, 'SKU-T1')");
      const d = await drafts.create(OWNER, { title: 'پست آزمون', caption: 'کپشن' });
      await jobs.create(OWNER, { draftId: d.id, scheduledAt: new Date('2030-01-01T00:00:00Z'), imageUrl: 'https://cdn.example.com/a.jpg', maxAttempts: 3 });
      await webhook(app, msgUpdate(1, 111, '/status'));
      const text = sent(calls)[0].text as string;
      expect(text).toContain('محصولات');
      expect(text).toContain('زمان‌بندی‌شده');
      expect(text).toContain('در صف 1');
    } finally { await app.close(); }
  });

  it('فرمان /upcoming زمان‌بندی‌های بعدی را فهرست می‌کند', async () => {
    const { app, calls } = await makeApp(allOk);
    try {
      const d = await drafts.create(OWNER, { title: 'پست یلدا', caption: 'کپشن' });
      await jobs.create(OWNER, { draftId: d.id, scheduledAt: new Date('2030-01-01T00:00:00Z'), imageUrl: 'https://cdn.example.com/a.jpg', maxAttempts: 3 });
      await webhook(app, msgUpdate(1, 111, '/upcoming'));
      expect(sent(calls)[0].text).toContain('پست یلدا');
    } finally { await app.close(); }
  });

  it('فرمان /drafts فقط برای پیش‌نویس‌های در حال نگارش دکمه تأیید می‌سازد', async () => {
    const { app, calls } = await makeApp(allOk);
    try {
      const d1 = await drafts.create(OWNER, { title: 'نگارش', caption: '' });
      const d2 = await drafts.create(OWNER, { title: 'آماده', caption: '', status: 'ready' });
      await webhook(app, msgUpdate(1, 111, '/drafts'));
      const msg = sent(calls)[0];
      const markup = JSON.stringify(msg.reply_markup);
      expect(markup).toContain('approve:' + d1.id);
      expect(markup).not.toContain('approve:' + d2.id);
    } finally { await app.close(); }
  });

  it('callback از کاربر غیرمجاز رد و بدون تغییر وضعیت می‌ماند', async () => {
    const { app, calls } = await makeApp(allOk);
    try {
      const d = await drafts.create(OWNER, { title: 'نگارش', caption: '' });
      await webhook(app, cbUpdate(1, 999, 'approve:' + d.id));
      const ans = answered(calls);
      expect(ans.length).toBe(1);
      expect(ans[0].text).toContain('فقط برای مالک');
      expect((await drafts.get(OWNER, d.id)).status).toBe('draft');
    } finally { await app.close(); }
  });

  it('callback با داده نامعتبر یا پیش‌نویس ناموجود بدون تغییر وضعیت پاسخ می‌گیرد', async () => {
    const { app, calls } = await makeApp(allOk);
    try {
      const d = await drafts.create(OWNER, { title: 'نگارش', caption: '' });
      await webhook(app, cbUpdate(1, 111, 'approve:not-a-uuid'));
      await webhook(app, cbUpdate(2, 111, 'delete:' + d.id));
      await webhook(app, cbUpdate(3, 111, 'approve:00000000-0000-0000-0000-000000000000'));
      const ans = answered(calls);
      expect(ans.length).toBe(3);
      expect(ans[0].text).toContain('نامعتبر');
      expect(ans[1].text).toContain('نامعتبر');
      expect(ans[2].text).toContain('یافت نشد');
      expect((await drafts.get(OWNER, d.id)).status).toBe('draft');
    } finally { await app.close(); }
  });

  it('تأیید پیش‌نویس idempotent است: تکرار آپدیت و تکرار فرمان تغییری ایجاد نمی‌کند', async () => {
    const { app, calls } = await makeApp(allOk);
    try {
      const d = await drafts.create(OWNER, { title: 'نگارش', caption: '' });
      const first = await webhook(app, cbUpdate(10, 111, 'approve:' + d.id));
      expect(first.statusCode).toBe(200);
      expect((await drafts.get(OWNER, d.id)).status).toBe('ready');
      expect(answered(calls)[0].text).toContain('تأیید');
      // ارسال دوباره همان آپدیت (بازپخش تلگرام) — dedupe
      const dup = await webhook(app, cbUpdate(10, 111, 'approve:' + d.id));
      expect(dup.body.duplicate).toBe(true);
      expect(answered(calls).length).toBe(1);
      // آپدیت جدید با همان فرمان — پاسخ «قبلاً» بدون تغییر وضعیت
      await webhook(app, cbUpdate(11, 111, 'approve:' + d.id));
      expect(answered(calls).length).toBe(2);
      expect(answered(calls)[1].text).toContain('قبلاً');
      expect((await drafts.get(OWNER, d.id)).status).toBe('ready');
    } finally { await app.close(); }
  });

  it('شکست تحویل پیام: webhook همچنان ۲۰۰ می‌ماند و تلاش بی‌سقف انجام نمی‌شود', async () => {
    let sendCount = 0;
    const rateLimited: Handler = (url) => {
      if (url.endsWith('/sendMessage')) {
        sendCount += 1;
        return { status: 429, body: { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 1 } } };
      }
      return OK;
    };
    const { app, calls } = await makeApp(rateLimited);
    try {
      const r = await webhook(app, msgUpdate(1, 111, '/start'));
      expect(r.statusCode).toBe(200);
      expect(r.body.ok).toBe(true);
      expect(sent(calls).length).toBe(2); // یک تلاش اولیه + حداکثر یک تلاش مجدد — نه بیشتر
    } finally { await app.close(); }
  });

  it('خطای دائم تحویل (500) بدون تلاش مجدد رها می‌شود و webhook ۲۰۰ می‌ماند', async () => {
    const failing: Handler = (url) => {
      if (url.endsWith('/sendMessage')) return { status: 500, body: { ok: false, error_code: 500, description: 'err' } };
      return OK;
    };
    const { app, calls } = await makeApp(failing);
    try {
      const r = await webhook(app, msgUpdate(1, 111, '/start'));
      expect(r.statusCode).toBe(200);
      expect(sent(calls).length).toBe(1);
    } finally { await app.close(); }
  });

  it('مسیرهای راه‌اندازی webhook: setup با سرّ رسمی، teardown و info', async () => {
    const { app, cookie, calls } = await makeApp(allOk);
    try {
      const bad = await app.inject({ method: 'POST', url: '/telegram/webhook/setup', payload: { url: 'http://insecure.example.com' }, headers: { cookie } });
      expect(bad.statusCode).toBe(422);
      const setup = await app.inject({ method: 'POST', url: '/telegram/webhook/setup', payload: { url: 'https://example.com/hook' }, headers: { cookie } });
      expect(setup.statusCode).toBe(200);
      expect(setup.json().ok).toBe(true);
      const setupCall = calls.find((c) => c.url.endsWith('/setWebhook'));
      expect(setupCall?.body.url).toBe('https://example.com/hook');
      expect(setupCall?.body.secret_token).toBe('sec-1');
      const teardown = await app.inject({ method: 'POST', url: '/telegram/webhook/teardown', headers: { cookie } });
      expect(teardown.statusCode).toBe(200);
      expect(calls.some((c) => c.url.endsWith('/deleteWebhook'))).toBe(true);
      const info = await app.inject({ method: 'GET', url: '/telegram/webhook/info', headers: { cookie } });
      expect(info.statusCode).toBe(200);
      expect(calls.some((c) => c.url.endsWith('/getWebhookInfo'))).toBe(true);
    } finally { await app.close(); }
  });

  it('اعلان نتیجه کار: موفق/ناموفق دائم پیام می‌فرستد، گذرا نه؛ شکست ارسال رها می‌شود', async () => {
    const { fetcher, calls } = makeFetcher(allOk);
    const warnings: string[] = [];
    const notifier = new TelegramOutcomeNotifier(new TelegramClient('TESTTOKEN', { fetcher }), '111', (m) => warnings.push(m));
    const job = { draftTitle: 'پست یلدا', draftId: 'd-1', errorCode: null, errorMessage: null } as unknown as PublishingJob;
    await notifier.notify(job, 'failed_transient', { code: 'X', message: 'گذرا' });
    expect(sent(calls).length).toBe(0);
    await notifier.notify(job, 'succeeded', { mediaId: 'M-1' });
    expect(sent(calls).length).toBe(1);
    expect(sent(calls)[0].text).toContain('پست یلدا');
    const failedJob = { draftTitle: 'پست یلدا', draftId: 'd-1', errorCode: 'INSTAGRAM_REAUTH_REQUIRED', errorMessage: 'توکن منقضی' } as unknown as PublishingJob;
    await notifier.notify(failedJob, 'failed_permanent', { code: 'INSTAGRAM_REAUTH_REQUIRED', message: 'توکن منقضی' });
    expect(sent(calls).length).toBe(2);
    expect(sent(calls)[1].text).toContain('ناموفق');
    // شکست ارسال: بدون پرتاب و بدون تکرار
    const { fetcher: failFetcher, calls: failCalls } = makeFetcher((url) => (url.endsWith('/sendMessage') ? { status: 500, body: { ok: false, error_code: 500, description: 'err' } } : OK));
    const failingNotifier = new TelegramOutcomeNotifier(new TelegramClient('TESTTOKEN', { fetcher: failFetcher }), '111', (m) => warnings.push(m));
    await expect(failingNotifier.notify(job, 'succeeded', { mediaId: 'M-1' })).resolves.toBeUndefined();
    expect(sent(failCalls).length).toBe(1);
    expect(warnings.some((m) => m.includes('رها شد'))).toBe(true);
  });
});
