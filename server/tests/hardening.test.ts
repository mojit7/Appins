import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { loadEnv } from '../src/config/env.js';
import { createDbPool, type SslMode } from '../src/db/pool.js';
import { SlidingWindowRateLimiter } from '../src/server/rateLimit.js';
import { isRefreshDue, refreshTokenIfDue, type CredsLike } from '../src/scheduler/tokenRefresh.js';
import type { InstagramCredential } from '../src/data/instagramCredentials.js';
import type { Pool } from 'pg';

const env = loadEnv({
  DATABASE_URL: 'postgres://u:p@localhost:5432/test',
  SESSION_SECRET: '0123456789abcdef0123456789abcdef',
  OWNER_PASSWORD: 'test-owner-pass-123',
  LOG_LEVEL: 'fatal',
});

describe('سلامت healthz', () => {
  it('با pool سالم ۲۰۰ و db=ok پاسخ می‌دهد', async () => {
    const pool = { query: async () => ({ rows: [] }) } as unknown as Pool;
    const app = buildApp({ env, db: { pool } });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', db: 'ok' });
    await app.close();
  });

  it('با دیتابیس ازدست‌رفته ۵۰۳ و degraded می‌دهد نه ok', async () => {
    const pool = { query: async () => { throw new Error('db unreachable'); } } as unknown as Pool;
    const app = buildApp({ env, db: { pool } });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'degraded', db: 'unreachable' });
    await app.close();
  });
});

describe('SSL pool دیتابیس', () => {
  const sslOf = (p: unknown): unknown => {
    const o = p as { options?: { ssl?: unknown }; _options?: { ssl?: unknown } };
    return o.options?.ssl ?? o._options?.ssl;
  };
  it('میزبان محلی در حالت auto بدون SSL می‌ماند', () => {
    expect(sslOf(createDbPool('postgres://u:p@localhost:5432/db', { sslMode: 'auto' as SslMode }))).toBeUndefined();
  });
  it('میزبان راه دور در auto تأیید گواهی کامل دارد', () => {
    expect(sslOf(createDbPool('postgres://u:p@db.example.com:5432/db', { sslMode: 'auto' as SslMode })))
      .toEqual({ rejectUnauthorized: true });
  });
  it('require بدون تأیید گواهی و disable بدون SSL است', () => {
    expect(sslOf(createDbPool('postgres://u:p@db.example.com:5432/db', { sslMode: 'require' as SslMode })))
      .toEqual({ rejectUnauthorized: false });
    expect(sslOf(createDbPool('postgres://u:p@db.example.com:5432/db', { sslMode: 'disable' as SslMode }))).toBeUndefined();
  });
});

describe('پاکسازی حافظه محدودساز نرخ', () => {
  it('کلیدهای کهنه در حجم بالا پاک می‌شوند', () => {
    const rl = new SlidingWindowRateLimiter(1, 1000);
    const t0 = 100_000;
    rl.allow('seed', t0);
    for (let i = 0; i < 1100; i++) rl.allow('k' + i, t0);
    const before = (rl as unknown as { hits: Map<string, number[]> }).hits.size;
    expect(before).toBe(1101);
    // گذر از آستانه sweep: همه کلیدهای قبلی کهنه‌اند و حذف می‌شوند
    expect(rl.allow('fresh', t0 + 1001)).toBe(true);
    const after = (rl as unknown as { hits: Map<string, number[]> }).hits.size;
    expect(after).toBeLessThan(100);
    // رفتار پنجره همچنان درست است
    expect(rl.allow('fresh', t0 + 1001)).toBe(false);
  });
});

describe('تازه‌سازی خودکار توکن اینستاگرام', () => {
  const fetchOk = (accessToken: string): Parameters<typeof refreshTokenIfDue>[1] =>
    async () => ({ ok: true, status: 200, json: async () => ({ access_token: accessToken, expires_in: 5184000 }) });

  class StubCreds implements CredsLike {
    saved: { token: string; expiresAt: Date; permissions: string[] } | null = null;
    constructor(private cred: InstagramCredential | null) {}
    async get(): Promise<InstagramCredential | null> { return this.cred; }
    async save(_ctx: unknown, rec: { token: string; expiresAt: Date; permissions: string[] }): Promise<void> { this.saved = rec; }
  }

  it('isRefreshDue فقط زیر آستانه TTL صادق است', () => {
    const now = 1_000_000;
    expect(isRefreshDue(new Date(now + 3 * 24 * 3600 * 1000), now, 7 * 24 * 3600 * 1000)).toBe(true);
    expect(isRefreshDue(new Date(now + 30 * 24 * 3600 * 1000), now, 7 * 24 * 3600 * 1000)).toBe(false);
  });

  it('بدون اعتبارنامه → no-credential و بدون فراخوانی شبکه', async () => {
    const stub = new StubCreds(null);
    const out = await refreshTokenIfDue({ env, pool: {} as Pool, creds: stub }, fetchOk('x'));
    expect(out).toBe('no-credential');
    expect(stub.saved).toBeNull();
  });

  it('توکن منقضی تازه‌سازی نمی‌شود → expired', async () => {
    const stub = new StubCreds({ token: 't', expiresAt: new Date(Date.now() - 1000).toISOString(), permissions: [] });
    const out = await refreshTokenIfDue({ env, pool: {} as Pool, creds: stub }, fetchOk('x'));
    expect(out).toBe('expired');
  });

  it('توکن دور از انقضا → skipped', async () => {
    const stub = new StubCreds({ token: 't', expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(), permissions: ['instagram_business_basic'] });
    const out = await refreshTokenIfDue({ env, pool: {} as Pool, creds: stub }, fetchOk('x'));
    expect(out).toBe('skipped');
    expect(stub.saved).toBeNull();
  });

  it('توکن نزدیک انقضا تازه‌سازی و ذخیره می‌شود → refreshed', async () => {
    const stub = new StubCreds({ token: 'old-token', expiresAt: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(), permissions: ['instagram_business_content_publish'] });
    const before = Date.now();
    const out = await refreshTokenIfDue({ env, pool: {} as Pool, creds: stub }, fetchOk('new-token'));
    expect(out).toBe('refreshed');
    expect(stub.saved?.token).toBe('new-token');
    expect(stub.saved?.permissions).toEqual(['instagram_business_content_publish']);
    const savedExp = stub.saved?.expiresAt.getTime() ?? 0;
    expect(savedExp).toBeGreaterThanOrEqual(before + 59 * 24 * 3600 * 1000);
    expect(savedExp).toBeLessThanOrEqual(Date.now() + 61 * 24 * 3600 * 1000);
  });
});
