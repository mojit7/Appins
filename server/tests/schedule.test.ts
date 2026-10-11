import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server/app.js';
import { loadEnv } from '../src/config/env.js';
import { runMigrations } from '../src/db/migrate.js';
import { OWNER } from '../src/data/context.js';
import { DraftRepository } from '../src/data/drafts.js';
import { IntegrationConnectionRepository } from '../src/data/connections.js';
import { InstagramCredentialRepository } from '../src/data/instagramCredentials.js';
import { PublishingJobRepository } from '../src/data/publishingJobs.js';
import { createPublishingWorker, type PublishingWorker } from '../src/scheduler/worker.js';
import type { FetchLike } from '../src/integrations/instagram/oauth.js';

const CONN = process.env.DATABASE_URL ?? 'postgres://appins:test@localhost:5432/appins_test';

const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: CONN,
  SESSION_SECRET: '0123456789abcdef0123456789abcdef',
  OWNER_PASSWORD: 'test-owner-pass-123',
  LOG_LEVEL: 'fatal',
  SCHEDULE_MAX_ATTEMPTS: 2,
});

interface Handler { (url: string): { status: number; body: unknown } | null }

function makeFetcher(handler: Handler): { fetcher: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetcher: FetchLike = async (url) => {
    calls.push(url);
    const r = handler(url);
    if (r === null) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
  return { fetcher, calls };
}

const CONTAINER = { status: 200, body: { id: 'C-1' } };
const FINISHED = { status: 200, body: { status_code: 'FINISHED' } };
const PUBLISHED = { status: 200, body: { id: 'M-900' } };

function happyHandler(url: string): { status: number; body: unknown } | null {
  if (url.endsWith('/IG-777/media_publish')) return PUBLISHED;
  if (url.includes('/C-1?fields=status_code')) return FINISHED;
  if (url.endsWith('/IG-777/media')) return CONTAINER;
  return null;
}

let pool: Pool;
let drafts: DraftRepository;
let creds: InstagramCredentialRepository;
let conns: IntegrationConnectionRepository;
let jobs: PublishingJobRepository;

beforeAll(async () => {
  pool = new Pool({ connectionString: CONN });
  await runMigrations(pool);
  drafts = new DraftRepository(pool);
  creds = new InstagramCredentialRepository(pool, env.SESSION_SECRET);
  conns = new IntegrationConnectionRepository(pool);
  jobs = new PublishingJobRepository(pool);
});

afterAll(async () => { await pool.end(); });

beforeEach(async () => {
  await pool.query('TRUNCATE products, content_drafts, publishing_jobs, publishing_job_attempts, instagram_credentials, integration_connections RESTART IDENTITY CASCADE');
});

async function login(app: FastifyInstance): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'test-owner-pass-123' } });
  const setCookie = res.headers['set-cookie'];
  const first = Array.isArray(setCookie) ? setCookie[0] : (setCookie as string | undefined);
  expect(first).toBeTruthy();
  return (first as string).split(';')[0];
}

async function seedDraft(title: string): Promise<string> {
  const d = await drafts.create(OWNER, { title, caption: 'متن کپشن آزمون' });
  return d.id;
}

async function connectIg(opts?: { expiresAt?: Date; permissions?: string[] }): Promise<void> {
  await creds.save(OWNER, {
    token: 'test-token',
    expiresAt: opts?.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
    permissions: opts?.permissions ?? ['instagram_business_content_publish'],
  });
  await conns.upsert(OWNER, { provider: 'instagram', status: 'connected', accountRef: 'IG-777' });
}

async function makeApp(handler: Handler): Promise<{ app: FastifyInstance; cookie: string; worker: PublishingWorker; calls: string[] }> {
  const { fetcher, calls } = makeFetcher(handler);
  const worker = createPublishingWorker({ env, pool, fetcher }, { backoffBaseMs: 0, pollAttempts: 2, pollDelayMs: 1, staleMs: 600000 });
  const app = buildApp({ env, ai: { env, pool }, schedule: { env, pool, worker } });
  const cookie = await login(app);
  return { app, cookie, worker, calls };
}

const PAST = '2020-01-01T00:00:00Z';
const FUTURE = '2030-01-01T00:00:00Z';

async function createJob(app: FastifyInstance, cookie: string, draftId: string, scheduledAt: string): Promise<{ statusCode: number; body: any }> {
  const res = await app.inject({
    method: 'POST',
    url: '/schedule/jobs',
    payload: { draftId, scheduledAt, imageUrl: 'https://cdn.example.com/photo.jpg' },
    headers: { cookie },
  });
  return { statusCode: res.statusCode, body: res.json() };
}

describe('زمان‌بندی ماندگار انتشار', () => {
  it('بدون ماژول زمان‌بندی، مسیرها stub با 503 پاسخ می‌دهند', async () => {
    const app = buildApp({ env });
    try {
      const cookie = await login(app);
      const res = await app.inject({ method: 'GET', url: '/schedule/jobs', headers: { cookie } });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('CONTENT_MODULE_NOT_CONFIGURED');
    } finally { await app.close(); }
  });

  it('ایجاد کار با مهر زمانی آگاه از منطقه زمانی؛ حالت scheduled و هم‌ارزی UTC', async () => {
    const { app, cookie } = await makeApp(happyHandler);
    try {
      const draftId = await seedDraft('کپشن یلدا');
      const r = await createJob(app, cookie, draftId, '2026-12-01T08:00:00+03:30');
      expect(r.statusCode).toBe(200);
      expect(r.body.state).toBe('scheduled');
      expect(r.body.status).toBe('pending');
      expect(r.body.scheduledAt).toBe('2026-12-01T04:30:00.000Z');
      const d = await app.inject({ method: 'GET', url: '/drafts/' + draftId, headers: { cookie } });
      expect(d.json().status).toBe('scheduled');
    } finally { await app.close(); }
  });

  it('ورودی‌های نامعتبر: زمان بدون منطقه زمانی، نشانی غیر http(s)، پیش‌نویس ناموجود، کار تکراری', async () => {
    const { app, cookie } = await makeApp(happyHandler);
    try {
      const draftId = await seedDraft('کپشن تکراری');
      const naive = await createJob(app, cookie, draftId, '2026-12-01T08:00:00');
      expect(naive.statusCode).toBe(422);
      const badUrl = await app.inject({ method: 'POST', url: '/schedule/jobs', payload: { draftId, scheduledAt: FUTURE, imageUrl: 'ftp://x/y.jpg' }, headers: { cookie } });
      expect(badUrl.statusCode).toBe(422);
      const missing = await createJob(app, cookie, '00000000-0000-0000-0000-000000000000', FUTURE);
      expect(missing.statusCode).toBe(404);
      const first = await createJob(app, cookie, draftId, FUTURE);
      expect(first.statusCode).toBe(200);
      const dup = await createJob(app, cookie, draftId, FUTURE);
      expect(dup.statusCode).toBe(409);
    } finally { await app.close(); }
  });

  it('اجرا در زمان سررسید: انتشار دو مرحله‌ای، تأیید ارائه‌دهنده، تاریخ تلاش', async () => {
    const { app, cookie, worker, calls } = await makeApp(happyHandler);
    try {
      const draftId = await seedDraft('کپشن سررسید');
      await connectIg();
      const r = await createJob(app, cookie, draftId, PAST);
      const ran = await worker.tick();
      expect(ran).toBe(1);
      const job = await app.inject({ method: 'GET', url: '/schedule/jobs/' + r.body.id, headers: { cookie } });
      const body = job.json();
      expect(body.state).toBe('published');
      expect(body.providerConfirmed).toBe(true);
      expect(body.publishedMediaId).toBe('M-900');
      expect(body.containerId).toBe('C-1');
      expect(body.attempts.length).toBe(1);
      expect(body.attempts[0].outcome).toBe('succeeded');
      expect(calls.length).toBe(3);
    } finally { await app.close(); }
  });

  it('اجرای تکراری کار منتشرشده ممکن نیست', async () => {
    const { app, cookie, worker, calls } = await makeApp(happyHandler);
    try {
      const draftId = await seedDraft('کپشن یک‌بار');
      await connectIg();
      const r = await createJob(app, cookie, draftId, PAST);
      await worker.tick();
      const again = await worker.tick();
      expect(again).toBe(0);
      expect(calls.length).toBe(3);
      const job = await jobs.get(OWNER, r.body.id);
      expect(job.state).toBe('published');
    } finally { await app.close(); }
  });

  it('برداشت اتمیک: کار در حال اجرا دوباره برداشت نمی‌شود', async () => {
    const draftId = await seedDraft('کپشن اتمیک');
    await connectIg();
    await jobs.create(OWNER, { draftId, scheduledAt: new Date(PAST), imageUrl: 'https://cdn.example.com/p.jpg', maxAttempts: 2 });
    const first = await jobs.claimNextDue();
    expect(first).not.toBeNull();
    const second = await jobs.claimNextDue();
    expect(second).toBeNull();
    await jobs.markFailed(first!.id, 'TEST', 'پاک‌سازی آزمون');
  });

  it('شکست گذرا: تلاش مجدد محدود و سپس موفقیت؛ تاریخ تلاش ثبت می‌شود', async () => {
    let failOnce = true;
    const handler = (url: string) => {
      if (url.endsWith('/IG-777/media_publish') && failOnce) {
        failOnce = false;
        return { status: 500, body: { error: { message: 'خطای موقت شبکه', code: 2 } } };
      }
      return happyHandler(url);
    };
    const { app, cookie, worker } = await makeApp(handler);
    try {
      const draftId = await seedDraft('کپشن گذرا');
      await connectIg();
      const r = await createJob(app, cookie, draftId, PAST);
      await worker.tick();
      let job = await jobs.get(OWNER, r.body.id);
      expect(job.state).toBe('scheduled');
      expect(job.attempt).toBe(1);
      expect(job.nextRunAt).not.toBeNull();
      await worker.tick();
      job = await jobs.get(OWNER, r.body.id);
      expect(job.state).toBe('published');
      const attempts = await jobs.listAttempts(r.body.id);
      expect(attempts.map((a) => a.outcome)).toEqual(['failed_transient', 'succeeded']);
    } finally { await app.close(); }
  });

  it('سقف تلاش: پس از دو شکست گذرا کار ناموفق نهایی می‌شود و دیگر برداشت نمی‌شود', async () => {
    const handler = (url: string) => {
      if (url.endsWith('/IG-777/media_publish')) {
        return { status: 500, body: { error: { message: 'خطای مداوم', code: 2 } } };
      }
      return happyHandler(url);
    };
    const { app, cookie, worker } = await makeApp(handler);
    try {
      const draftId = await seedDraft('کپشن سقف');
      await connectIg();
      const r = await createJob(app, cookie, draftId, PAST);
      await worker.tick();
      await worker.tick();
      let job = await jobs.get(OWNER, r.body.id);
      expect(job.state).toBe('failed');
      expect(job.attempt).toBe(2);
      expect(job.errorCode).toBe('INTEGRATION_ERROR');
      const third = await worker.tick();
      expect(third).toBe(0);
      job = await jobs.get(OWNER, r.body.id);
      expect(job.state).toBe('failed');
      const attempts = await jobs.listAttempts(r.body.id);
      expect(attempts.length).toBe(2);
    } finally { await app.close(); }
  });

  it('توکن منقضی: شکست دائمی بدون تلاش مجدد', async () => {
    const { app, cookie, worker } = await makeApp(happyHandler);
    try {
      const draftId = await seedDraft('کپشن توکن');
      await connectIg({ expiresAt: new Date(Date.now() - 1000) });
      const r = await createJob(app, cookie, draftId, PAST);
      await worker.tick();
      const job = await jobs.get(OWNER, r.body.id);
      expect(job.state).toBe('failed');
      expect(job.errorCode).toBe('INSTAGRAM_REAUTH_REQUIRED');
      expect(job.attempt).toBe(1);
      const again = await worker.tick();
      expect(again).toBe(0);
    } finally { await app.close(); }
  });

  it('خطای Graph کد ۱۹۰: شکست دائمی INSTAGRAM_REAUTH_REQUIRED', async () => {
    const handler = (url: string) => {
      if (url.endsWith('/IG-777/media')) {
        return { status: 401, body: { error: { message: 'token expired', code: 190 } } };
      }
      return happyHandler(url);
    };
    const { app, cookie, worker } = await makeApp(handler);
    try {
      const draftId = await seedDraft('کپشن ۱۹۰');
      await connectIg();
      const r = await createJob(app, cookie, draftId, PAST);
      await worker.tick();
      const job = await jobs.get(OWNER, r.body.id);
      expect(job.state).toBe('failed');
      expect(job.errorCode).toBe('INSTAGRAM_REAUTH_REQUIRED');
      const attempts = await jobs.listAttempts(r.body.id);
      expect(attempts.length).toBe(1);
      expect(attempts[0]!.outcome).toBe('failed_permanent');
    } finally { await app.close(); }
  });

  it('ظرف رسانه با خطای ERROR: شکست دائمی INSTAGRAM_PUBLISH_FAILED', async () => {
    const handler = (url: string) => {
      if (url.includes('/C-1?fields=status_code')) {
        return { status: 200, body: { status_code: 'ERROR' } };
      }
      return happyHandler(url);
    };
    const { app, cookie, worker } = await makeApp(handler);
    try {
      const draftId = await seedDraft('کپشن ظرف خطا');
      await connectIg();
      const r = await createJob(app, cookie, draftId, PAST);
      await worker.tick();
      const job = await jobs.get(OWNER, r.body.id);
      expect(job.state).toBe('failed');
      expect(job.errorCode).toBe('INSTAGRAM_PUBLISH_FAILED');
    } finally { await app.close(); }
  });

  it('آماده‌نشدن ظرف: شکست گذرا و استفاده مجدد از ظرف در تلاش بعدی', async () => {
    const handler = (url: string) => {
      if (url.includes('/C-1?fields=status_code')) {
        return { status: 200, body: { status_code: 'IN_PROGRESS' } };
      }
      return happyHandler(url);
    };
    const { app, cookie, worker, calls } = await makeApp(handler);
    try {
      const draftId = await seedDraft('کپشن ظرف کند');
      await connectIg();
      const r = await createJob(app, cookie, draftId, PAST);
      await pool.query('UPDATE publishing_jobs SET max_attempts = 5 WHERE id = $1', [r.body.id]);
      await worker.tick();
      let job = await jobs.get(OWNER, r.body.id);
      expect(job.state).toBe('scheduled');
      expect(job.errorCode).toBe('INSTAGRAM_PUBLISH_TIMEOUT');
      const mediaCalls1 = calls.filter((c) => c.endsWith('/IG-777/media')).length;
      expect(mediaCalls1).toBe(1);
      await worker.tick();
      job = await jobs.get(OWNER, r.body.id);
      expect(job.state).toBe('scheduled');
      const mediaCalls2 = calls.filter((c) => c.endsWith('/IG-777/media')).length;
      expect(mediaCalls2).toBe(1);
    } finally { await app.close(); }
  });

  it('بدون اتصال اینستاگرام: شکست دائمی CONFLICT', async () => {
    const { app, cookie, worker } = await makeApp(happyHandler);
    try {
      const draftId = await seedDraft('کپشن بدون اتصال');
      const r = await createJob(app, cookie, draftId, PAST);
      await worker.tick();
      const job = await jobs.get(OWNER, r.body.id);
      expect(job.state).toBe('failed');
      expect(job.errorCode).toBe('CONFLICT');
    } finally { await app.close(); }
  });

  it('لغو: فقط کار در صف؛ پیش‌نویس به ready برمی‌گردد', async () => {
    const { app, cookie } = await makeApp(happyHandler);
    try {
      const draftId = await seedDraft('کپشن لغو');
      const r = await createJob(app, cookie, draftId, FUTURE);
      const cancel = await app.inject({ method: 'POST', url: '/schedule/jobs/' + r.body.id + '/cancel', headers: { cookie } });
      expect(cancel.statusCode).toBe(200);
      expect(cancel.json().state).toBe('cancelled');
      const d = await app.inject({ method: 'GET', url: '/drafts/' + draftId, headers: { cookie } });
      expect(d.json().status).toBe('ready');
      expect(d.json().scheduledAt).toBeNull();
      const again = await app.inject({ method: 'POST', url: '/schedule/jobs/' + r.body.id + '/cancel', headers: { cookie } });
      expect(again.statusCode).toBe(409);
      const missing = await app.inject({ method: 'POST', url: '/schedule/jobs/00000000-0000-0000-0000-000000000000/cancel', headers: { cookie } });
      expect(missing.statusCode).toBe(404);
    } finally { await app.close(); }
  });

  it('زمان‌بندی مجدد: فقط کار در صف؛ زمان جدید اعمال می‌شود', async () => {
    const { app, cookie } = await makeApp(happyHandler);
    try {
      const draftId = await seedDraft('کپشن باززمان‌بندی');
      const r = await createJob(app, cookie, draftId, FUTURE);
      const resch = await app.inject({
        method: 'POST',
        url: '/schedule/jobs/' + r.body.id + '/reschedule',
        payload: { scheduledAt: '2031-06-15T12:00:00Z' },
        headers: { cookie },
      });
      expect(resch.statusCode).toBe(200);
      expect(resch.json().scheduledAt).toBe('2031-06-15T12:00:00.000Z');
      await app.inject({ method: 'POST', url: '/schedule/jobs/' + r.body.id + '/cancel', headers: { cookie } });
      const after = await app.inject({
        method: 'POST',
        url: '/schedule/jobs/' + r.body.id + '/reschedule',
        payload: { scheduledAt: '2031-06-16T12:00:00Z' },
        headers: { cookie },
      });
      expect(after.statusCode).toBe(409);
    } finally { await app.close(); }
  });

  it('بازیابی کار ناموفق: تلاش مجدد با شمارش تازه و اجرای موفق', async () => {
    let alwaysFail = true;
    const handler = (url: string) => {
      if (url.endsWith('/IG-777/media_publish') && alwaysFail) {
        return { status: 500, body: { error: { message: 'خطای مداوم', code: 2 } } };
      }
      return happyHandler(url);
    };
    const { app, cookie, worker } = await makeApp(handler);
    try {
      const draftId = await seedDraft('کپشن بازیابی');
      await connectIg();
      const r = await createJob(app, cookie, draftId, PAST);
      await worker.tick();
      await worker.tick();
      let job = await jobs.get(OWNER, r.body.id);
      expect(job.state).toBe('failed');
      alwaysFail = false;
      const retry = await app.inject({ method: 'POST', url: '/schedule/jobs/' + r.body.id + '/retry', headers: { cookie } });
      expect(retry.statusCode).toBe(200);
      expect(retry.json().state).toBe('scheduled');
      expect(retry.json().attempt).toBe(0);
      await worker.tick();
      job = await jobs.get(OWNER, r.body.id);
      expect(job.state).toBe('published');
      expect(job.providerConfirmed).toBe(true);
    } finally { await app.close(); }
  });

  it('فهرست و فیلتر وضعیت؛ کار گیرکرده به صف بازمی‌گردد', async () => {
    const { app, cookie } = await makeApp(happyHandler);
    try {
      const draftId = await seedDraft('کپشن فهرست');
      const r = await createJob(app, cookie, draftId, FUTURE);
      const list = await app.inject({ method: 'GET', url: '/schedule/jobs?status=pending', headers: { cookie } });
      expect(list.statusCode).toBe(200);
      expect(list.json().total).toBe(1);
      const bad = await app.inject({ method: 'GET', url: '/schedule/jobs?status=weird', headers: { cookie } });
      expect(bad.statusCode).toBe(422);
      // شبیه‌سازی گیرکردن در running (مثلاً توقف فرآیند): بازگرداندن به صف
      await pool.query("UPDATE publishing_jobs SET status = 'running', started_at = now() - interval '1 hour' WHERE id = $1", [r.body.id]);
      const requeued = await jobs.requeueStale(10 * 60 * 1000);
      expect(requeued).toContain(r.body.id);
      const job = await jobs.get(OWNER, r.body.id);
      expect(job.status).toBe('pending');
    } finally { await app.close(); }
  });
});