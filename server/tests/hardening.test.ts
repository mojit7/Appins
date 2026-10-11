import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { loadEnv } from '../src/config/env.js';
import { createDbPool, type SslMode } from '../src/db/pool.js';
import { SlidingWindowRateLimiter } from '../src/server/rateLimit.js';
import { isRefreshDue, refreshTokenIfDue, type CredsLike } from '../src/scheduler/tokenRefresh.js';
import { base32Decode, generateTotp, hotp, verifyTotp } from '../src/auth/totp.js';
import { decryptToken, encryptToken, type InstagramCredential } from '../src/data/instagramCredentials.js';
import { SessionRevocationList } from '../src/auth/session.js';
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

describe('TOTP دومرحله‌ای (RFC 6238 / RFC 4226)', () => {
  // سرّ RFC 4226: '12345678901234567890' → base32
  const RFC_SECRET_B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

  it('base32 رمزگشایی درست (اندازه ۲۰ بایت)', () => {
    expect(base32Decode(RFC_SECRET_B32).toString('utf8')).toBe('12345678901234567890');
  });

  it('بردارهای آزمون رسمی HOTP (RFC 4226 ضمیمه D)', () => {
    const key = base32Decode(RFC_SECRET_B32);
    expect(hotp(key, 0)).toBe('755224');
    expect(hotp(key, 1)).toBe('287082');
    expect(hotp(key, 2)).toBe('359152');
    expect(hotp(key, 3)).toBe('969429');
  });

  it('TOTP در زمان ۵۹ ثانیه (شمارنده ۱) → 287082', () => {
    expect(generateTotp(RFC_SECRET_B32, 59_000)).toBe('287082');
    expect(verifyTotp(RFC_SECRET_B32, '287082', 59_000)).toBe(true);
  });

  it('پنجره ±۱ گام پذیرش دارد و کد نادرست رد می‌شود', () => {
    // در ثانیه ۸۹ شمارنده = 2 (کد 359152)؛ کد شمارنده ۱ باید در پنجره پذیرفته شود
    expect(verifyTotp(RFC_SECRET_B32, '287082', 89_000)).toBe(true);
    expect(verifyTotp(RFC_SECRET_B32, '000000', 59_000)).toBe(false);
    expect(verifyTotp(RFC_SECRET_B32, 'abcd', 59_000)).toBe(false);
  });

  it('ورود با TOTP فعال: بدون کد → TOTP_REQUIRED؛ کد غلط → TOTP_INVALID؛ کد درست → موفق', async () => {
    const env2fa = loadEnv({
      DATABASE_URL: 'postgres://u:p@localhost:5432/test',
      SESSION_SECRET: '0123456789abcdef0123456789abcdef',
      OWNER_PASSWORD: 'test-owner-pass-123',
      LOG_LEVEL: 'fatal',
      TOTP_SECRET: RFC_SECRET_B32,
    });
    const app = buildApp({ env: env2fa });
    // سرور کد را با ساعت واقعی (Date.now) راستی‌آزمایی می‌کند؛ کد باید «اکنون» ساخته شود نه در زمان ثابت آزمونی.
    const now = Date.now();
    const code = generateTotp(RFC_SECRET_B32, now);                   
    // کد غلطِ قطعی: عددی که با هیچ‌یک از کدهای سه شمارنده پنجره (±۱ گام) برابر نیست — بدون شانس تصادفی شکست.
    const key = base32Decode(RFC_SECRET_B32);
    const counter = Math.floor(now / 1000 / 30);
    const windowCodes = new Set([counter - 1, counter, counter + 1].map((c) => hotp(key, c)));
    let badCode = '';
    for (let i = 0; i < 10; i++) {
      const cand = String(i).repeat(6);
      if (!windowCodes.has(cand)) { badCode = cand; break; }
    }
    if (!badCode) throw new Error('کد غلط قطعی پیدا نشد');
    const r0 = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'test-owner-pass-123' } });
    expect(r0.statusCode).toBe(401);
    expect(r0.json().code).toBe('TOTP_REQUIRED');
    const rBad = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'test-owner-pass-123', code: badCode } });
    expect(rBad.statusCode).toBe(401);
    expect(rBad.json().code).toBe('TOTP_INVALID');
    const rOk = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'test-owner-pass-123', code } });
    expect(rOk.statusCode).toBe(200);
    await app.close();
  });
});

describe('دفاع CSRF لایه دوم (بررسی Origin)', () => {
  it('درخواست تغییردهنده با Origin خارجی → 403 CSRF_REJECTED', async () => {
    const app = buildApp({ env });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { origin: 'https://evil.example', host: 'appins.example' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('CSRF_REJECTED');
    await app.close();
  });

  it('بدون سرصفحه Origin (کلاینت غیرمرورگری) رد نمی‌شود — فقط گارد نشست اعمال می‌شود', async () => {
    const app = buildApp({ env });
    const res = await app.inject({ method: 'POST', url: '/auth/logout' });
    expect(res.statusCode).toBe(401); // نه 403
    await app.close();
  });

  it('Origin هم‌خوان با Host → عبور از CSRF و رسیدن به گارد نشست', async () => {                         
    const app = buildApp({ env });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { origin: 'https://appins.example', host: 'appins.example' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('APP-001: قفل fail-closed دومرحله‌ای در تولید', () => {
  const RFC_SECRET_B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const baseEnv = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/test',
    SESSION_SECRET: '0123456789abcdef0123456789abcdef',
    OWNER_PASSWORD: 'test-owner-pass-123',
    LOG_LEVEL: 'fatal',
  };

  it('production بدون TOTP_SECRET → ورود با 503 و 2FA_NOT_CONFIGURED مسدود می‌شود', async () => {
    const envProd = loadEnv({ ...baseEnv, NODE_ENV: 'production' });
    const app = buildApp({ env: envProd });
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'test-owner-pass-123' } });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('2FA_NOT_CONFIGURED');
    await app.close();
  });

  it('production با TOTP_SECRET → ورود دومرحله‌ای موفق', async () => {
    const envProd2fa = loadEnv({ ...baseEnv, NODE_ENV: 'production', TOTP_SECRET: RFC_SECRET_B32 });
    const app = buildApp({ env: envProd2fa });
    const code = generateTotp(RFC_SECRET_B32, Date.now());
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'test-owner-pass-123', code } });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe('APP-002: ابطال فوری نشست در خروج', () => {
  it('توکن کپی‌شده پس از logout بلافاصله 401 می‌گیرد', async () => {
    const app = buildApp({ env });
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'test-owner-pass-123' } });
    expect(login.statusCode).toBe(200);
    const setCookie = login.headers['set-cookie'];                                                                                            
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(';')[0] ?? '';
    expect(cookie.startsWith('appins_session=')).toBe(true);
    const authed = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } });
    expect(authed.statusCode).toBe(200);
    const out = await app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie } });
    expect(out.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } });
    expect(after.statusCode).toBe(401);
    await app.close();
  });
});

describe('APP-007: کلید مستقل رمزنگاری توکن اینستاگرام', () => {
  it('رمزگشایی با کلید متفاوت شکست می‌خورد (یکپارچگی AES-256-GCM)', () => {
    const blob = encryptToken('a'.repeat(32), 'secret-token');
    expect(() => decryptToken('b'.repeat(32), blob)).toThrow();
    expect(decryptToken('a'.repeat(32), blob)).toBe('secret-token');
  });
});

describe('APP-009: پاک‌سازی فهرست ابطال نشست', () => {
  const mkTok = (expS: number) => Buffer.from(String(expS), 'utf8').toString('base64url') + '.sig';

  it('توکن منقضی ثبت نمی‌شود؛ توکن معتبر باطل می‌ماند', () => {
    const list = new SessionRevocationList();
    const now = Math.floor(Date.now() / 1000);
    list.revoke(mkTok(now - 100));
    list.revoke(mkTok(now - 50));
    expect(list.size).toBe(0); // منقضی: اثبات‌پذیر توسط verifySessionToken، نیازی به ابطال ندارد
    list.revoke(mkTok(now + 3600));
    expect(list.size).toBe(1);
    expect(list.isRevoked(mkTok(now + 3600), now)).toBe(true);
  });

  it('prune ورودی‌هایی که زمانشان رسیده را حذف می‌کند', () => {
    const list = new SessionRevocationList();
    const now = Math.floor(Date.now() / 1000);
    list.revoke(mkTok(now + 60));
    list.revoke(mkTok(now + 120));
    list.revoke(mkTok(now + 3600));
    expect(list.size).toBe(3);
    expect(list.prune(now + 130)).toBe(2);
    expect(list.size).toBe(1);
    expect(list.isRevoked(mkTok(now + 3600), now)).toBe(true);
    expect(list.isRevoked(mkTok(now + 60), now + 130)).toBe(false);
  });

  it('رشد حافظه محدود: ثبت‌های متوالی منقضی جمع نمی‌شوند', () => {
    const list = new SessionRevocationList();
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 50; i++) list.revoke(mkTok(now - 1000 - i));
    expect(list.size).toBe(0);
    list.revoke(mkTok(now + 60));
    expect(list.size).toBe(1);
  });
});
