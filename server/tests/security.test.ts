import { describe, expect, it, beforeEach } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { loadEnv } from '../src/config/env.js';
import { createSessionToken, verifySessionToken } from '../src/auth/session.js';
import { safeEqual } from '../src/auth/password.js';
import { SlidingWindowRateLimiter } from '../src/server/rateLimit.js';

const env = loadEnv({
  DATABASE_URL: 'postgres://u:p@localhost:5432/test',
  SESSION_SECRET: '0123456789abcdef0123456789abcdef',
  OWNER_PASSWORD: 'test-owner-pass-123',
  LOG_LEVEL: 'fatal',
});

const login = (app: any, password: string) =>
  app.inject({ method: 'POST', url: '/auth/login', payload: { password } });

describe('احراز هویت مالک', () => {
  it('ورود با رمز درست کوکی نشست HttpOnly می‌دهد', async () => {
    const app = buildApp({ env });
    const res = await login(app, 'test-owner-pass-123');
    expect(res.statusCode).toBe(200);
    const cookie = res.headers['set-cookie'];
    expect(cookie).toContain('appins_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    await app.close();
  });

  it('ورود با رمز نادرست ۴۰۱ می‌دهد و کوکی نمی‌دهد', async () => {
    const app = buildApp({ env });
    const res = await login(app, 'wrong-password-xx');
    expect(res.statusCode).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
    await app.close();
  });

  it('ورود با بدنه نامعتبر ۴۰۱ می‌دهد (بدون خطای ۵۰۰)', async () => {
    const app = buildApp({ env });
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: {} });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('مسیر محافظت‌شده با نشست معتبر ۲۰۰ و بدون نشست ۴۰۱ است', async () => {
    const app = buildApp({ env });
    const noAuth = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(noAuth.statusCode).toBe(401);

    const res = await login(app, 'test-owner-pass-123');
    const cookie = String(res.headers['set-cookie'] ?? '').split(';')[0];
    const withAuth = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } });
    expect(withAuth.statusCode).toBe(200);
    expect(withAuth.json()).toEqual({ role: 'owner' });
    await app.close();
  });

  it('توکن نشست دستکاری‌شده رد می‌شود', async () => {
    const app = buildApp({ env });
    const res = await login(app, 'test-owner-pass-123');
    const cookie = String(res.headers['set-cookie'] ?? '').split(';')[0];
    const tampered = cookie.slice(0, -2) + 'xx';
    const bad = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: tampered } });
    expect(bad.statusCode).toBe(401);
    await app.close();
  });

  it('خروج کوکی نشست را پاک می‌کند', async () => {
    const app = buildApp({ env });
    const res = await login(app, 'test-owner-pass-123');
    const cookie = String(res.headers['set-cookie'] ?? '').split(';')[0];
    const out = await app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie } });
    expect(out.statusCode).toBe(200);
    expect(String(out.headers['set-cookie'] ?? '')).toContain('Max-Age=0');
    await app.close();
  });

  it('بیش از ۵ تلاش ناموفق ورود ۴۲۹ می‌گیرد', async () => {
    const app = buildApp({ env });
    for (let i = 0; i < 5; i++) {
      const r = await login(app, 'wrong-password-xx');
      expect(r.statusCode).toBe(401);
    }
    const limited = await login(app, 'test-owner-pass-123');
    expect(limited.statusCode).toBe(429);
    await app.close();
  });
});

describe('نشست — واحدی', () => {
  it('توکن ساخته‌شده معتبر است و امضای دستکاری‌شده رد می‌شود', () => {
    const token = createSessionToken('0123456789abcdef0123456789abcdef');
    expect(verifySessionToken('0123456789abcdef0123456789abcdef', token)).toBe(true);
    const parts = token.split('.');
    const forged = `${parts[0]}.${parts[1]!.slice(0, -1)}x`;
    expect(verifySessionToken('0123456789abcdef0123456789abcdef', forged)).toBe(false);
    expect(verifySessionToken('another-secret-0123456789abcdef01234', token)).toBe(false);
  });

  it('توکن منقضی رد می‌شود', () => {
    const token = createSessionToken('0123456789abcdef0123456789abcdef', -10);
    expect(verifySessionToken('0123456789abcdef0123456789abcdef', token)).toBe(false);
  });

  it('safeEqual مقدارها را زمان-ثابت مقایسه می‌کند', () => {
    expect(safeEqual('a', 'a')).toBe(true);
    expect(safeEqual('a', 'b')).toBe(false);
    expect(safeEqual('a', '')).toBe(false);
  });
});

describe('محدودساز نرخ', () => {
  it('اجازه تا سقف و رد پس از آن', () => {
    const rl = new SlidingWindowRateLimiter(3, 60_000);
    expect(rl.allow('k')).toBe(true);
    expect(rl.allow('k')).toBe(true);
    expect(rl.allow('k')).toBe(true);
    expect(rl.allow('k')).toBe(false);
    expect(rl.allow('other')).toBe(true);
  });

  beforeEach(() => { /* حالت مستقل در هر تست */ });
});
