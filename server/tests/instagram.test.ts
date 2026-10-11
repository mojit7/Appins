import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server/app.js';
import { loadEnv } from '../src/config/env.js';
import { runMigrations } from '../src/db/migrate.js';
import { OWNER } from '../src/data/context.js';
import { InstagramCredentialRepository, decryptToken, encryptToken } from '../src/data/instagramCredentials.js';
import { IntegrationConnectionRepository } from '../src/data/connections.js';
import { createOAuthState, verifyOAuthState, type FetchLike } from '../src/integrations/instagram/oauth.js';

const CONN = process.env.DATABASE_URL ?? 'postgres://appins:test@localhost:5432/appins_test';

const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: CONN,
  SESSION_SECRET: '0123456789abcdef0123456789abcdef',
  OWNER_PASSWORD: 'test-owner-pass-123',
  LOG_LEVEL: 'fatal',
  INSTAGRAM_APP_ID: '999000111',
  INSTAGRAM_APP_SECRET: 'test-app-secret',
  INSTAGRAM_REDIRECT_URI: 'https://example.app/api/instagram/callback',
});

const envNoIg = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: CONN,
  SESSION_SECRET: '0123456789abcdef0123456789abcdef',
  OWNER_PASSWORD: 'test-owner-pass-123',
  LOG_LEVEL: 'fatal',
});

type Handler = (url: string, init?: Record<string, unknown>) => { status: number; body: unknown } | null;

function makeFetcher(handlers: Handler[]): { fetcher: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetcher: FetchLike = async (url, init) => {
    calls.push(url);
    for (const h of handlers) {
      const r = h(url, init);
      if (r) {
        return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
      }
    }
    return { ok: false, status: 500, json: async () => ({ error: { message: 'بدون مسیر شبیه‌سازی', code: 1 } }) };
  };
  return { fetcher, calls };
}

const ALL_PERMS = 'instagram_business_basic,instagram_business_manage_insights,instagram_business_content_publish';

const SHORT_BODY = { data: [{ access_token: 'SHORT-TOKEN', user_id: 'APPSCOPED-1', permissions: ALL_PERMS }] };
const PROFILE_BODY = { user_id: 'IG-777', username: 'shop', account_type: 'MEDIA_CREATOR', followers_count: 1200, media_count: 34 };

function happyHandlers(statusSequence?: string[]): Handler[] {
  const seq = statusSequence ?? ['FINISHED'];
  let statusCall = 0;
  return [
    (url) => url.startsWith('https://api.instagram.com/oauth/access_token') ? { status: 200, body: SHORT_BODY } : null,
    (url) => url.startsWith('https://graph.instagram.com/access_token') ? { status: 200, body: { access_token: 'LONG-TOKEN', token_type: 'bearer', expires_in: 5184000 } } : null,
    (url) => url.startsWith('https://graph.instagram.com/refresh_access_token') ? { status: 200, body: { access_token: 'LONG-TOKEN-2', token_type: 'bearer', expires_in: 5184000 } } : null,
    (url) => url.indexOf('fields=status_code') >= 0 ? { status: 200, body: { status_code: seq[Math.min(statusCall, seq.length - 1)] ?? 'FINISHED' } } : null,
    (url) => url.indexOf('/media_publish') >= 0 ? { status: 200, body: { id: 'M-900' } } : null,
    (url) => url.indexOf('/insights?metric=') >= 0 ? { status: 200, body: { data: [{ name: 'likes', title: 'Likes', values: [{ value: 42 }] }] } } : null,
    (url) => url.indexOf('/media?') >= 0 ? { status: 200, body: { id: 'C-1' } } : null,
    (url) => url.indexOf('/me?fields=') >= 0 ? { status: 200, body: PROFILE_BODY } : null,
  ];
}

let pool: Pool;
let creds: InstagramCredentialRepository;
let conns: IntegrationConnectionRepository;

beforeAll(async () => {
  pool = new Pool({ connectionString: CONN });
  await runMigrations(pool);
  creds = new InstagramCredentialRepository(pool, env.SESSION_SECRET);
  conns = new IntegrationConnectionRepository(pool);
});

afterAll(async () => { await pool.end(); });

beforeEach(async () => {
  await pool.query('TRUNCATE instagram_credentials, integration_connections RESTART IDENTITY CASCADE');
});

async function login(app: FastifyInstance): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'test-owner-pass-123' } });
  const setCookie = res.headers['set-cookie'];
  const first = Array.isArray(setCookie) ? setCookie[0] : (setCookie as string | undefined);
  expect(first).toBeTruthy();
  return (first as string).split(';')[0];
}

async function makeApp(fetcher: FetchLike): Promise<{ app: FastifyInstance; cookie: string }> {
  const app = buildApp({ env, instagram: { env, pool, fetcher } });
  const cookie = await login(app);
  return { app, cookie };
}

async function connect(app: FastifyInstance, cookie: string): Promise<void> {
  const state = createOAuthState(env.SESSION_SECRET);
  const res = await app.inject({
    method: 'GET',
    url: '/instagram/callback?code=AUTHCODE&state=' + encodeURIComponent(state),
    headers: { cookie },
  });
  expect(res.statusCode).toBe(200);
}

async function saveCreds(perms: string[], expiresAt?: Date): Promise<void> {
  await creds.save(OWNER, {
    token: 'LONG-TOKEN',
    expiresAt: expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
    permissions: perms,
  });
  await conns.upsert(OWNER, { provider: 'instagram', status: 'connected', accountRef: 'IG-777' });
}

function signedState(secret: string, payload: string): string {
  const sig = createHmac('sha256', secret).update('ig-oauth:' + payload).digest('base64url');
  return payload + '.' + sig;
}

describe('state اُاث — دفاع CSRF', () => {
  it('state ساخته‌شده تأیید می‌شود', () => {
    const state = createOAuthState(env.SESSION_SECRET);
    expect(() => verifyOAuthState(env.SESSION_SECRET, state)).not.toThrow();
  });

  it('state دستکاری‌شده رد می‌شود', () => {
    const state = createOAuthState(env.SESSION_SECRET);
    const tampered = 'forged.' + state.split('.').slice(1).join('.');
    expect(() => verifyOAuthState(env.SESSION_SECRET, tampered)).toThrowError(/امضای state/);
  });

  it('state منقضی رد می‌شود', () => {
    const state = signedState(env.SESSION_SECRET, 'nonce.1');
    expect(() => verifyOAuthState(env.SESSION_SECRET, state)).toThrowError(/منقضی/);
  });
});

describe('رمزنگاری توکن', () => {
  it('دوره کامل رمز و بازگشایی کار می‌کند و متن روشن ذخیره نمی‌شود', () => {
    const blob = encryptToken(env.SESSION_SECRET, 'LONG-TOKEN');
    expect(blob).not.toContain('LONG-TOKEN');
    expect(decryptToken(env.SESSION_SECRET, blob)).toBe('LONG-TOKEN');
  });
});

describe('مسیرهای اینستاگرام', () => {
  it('authorize نشانی رسمی با پارامترهای درست می‌سازد', async () => {
    const { fetcher } = makeFetcher([]);
    const { app, cookie } = await makeApp(fetcher);
    try {
      const res = await app.inject({ method: 'GET', url: '/instagram/authorize', headers: { cookie } });
      expect(res.statusCode).toBe(200);
      const url = res.json().authorizationUrl as string;
      expect(url).toContain('https://www.instagram.com/oauth/authorize');
      expect(url).toContain('client_id=999000111');
      expect(url).toContain('response_type=code');
      expect(url).toContain('state=');
    } finally { await app.close(); }
  });

  it('authorize بدون پیکربندی 503 می‌دهد', async () => {
    const app = buildApp({ env: envNoIg, instagram: { env: envNoIg, pool } });
    try {
      const cookie = await login(app);
      const res = await app.inject({ method: 'GET', url: '/instagram/authorize', headers: { cookie } });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('INSTAGRAM_NOT_CONFIGURED');
    } finally { await app.close(); }
  });

  it('بدون ماژول اینستاگرام، مسیرها stub با 503 پاسخ می‌دهند', async () => {
    const app = buildApp({ env });
    try {
      const cookie = await login(app);
      const res = await app.inject({ method: 'GET', url: '/instagram/status', headers: { cookie } });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('INSTAGRAM_NOT_CONFIGURED');
    } finally { await app.close(); }
  });

  it('callback با لغو مجوز کاربر 403 می‌دهد', async () => {
    const { fetcher } = makeFetcher([]);
    const { app, cookie } = await makeApp(fetcher);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/instagram/callback?error=access_denied&error_reason=user_denied',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('PERMISSION_DENIED');
    } finally { await app.close(); }
  });

  it('callback با state نامعتبر 400 می‌دهد', async () => {
    const { fetcher } = makeFetcher([]);
    const { app, cookie } = await makeApp(fetcher);
    try {
      const res = await app.inject({ method: 'GET', url: '/instagram/callback?code=x&state=bad.bad.bad', headers: { cookie } });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('INVALID_OAUTH_STATE');
    } finally { await app.close(); }
  });

  it('callback با کد استفاده‌شده 502 می‌دهد', async () => {
    const { fetcher } = makeFetcher([
      (url) => url.startsWith('https://api.instagram.com/oauth/access_token')
        ? { status: 400, body: { error_type: 'OAuthException', code: 400, error_message: 'Matching code was not found or was already used' } }
        : null,
    ]);
    const { app, cookie } = await makeApp(fetcher);
    try {
      const state = createOAuthState(env.SESSION_SECRET);
      const res = await app.inject({
        method: 'GET',
        url: '/instagram/callback?code=USED&state=' + encodeURIComponent(state),
        headers: { cookie },
      });
      expect(res.statusCode).toBe(502);
      expect(res.json().code).toBe('INTEGRATION_ERROR');
    } finally { await app.close(); }
  });

  it('callback موفق: اتصال متصل و توکن رمزنگاری‌شده ذخیره می‌شود', async () => {
    const { fetcher } = makeFetcher(happyHandlers());
    const { app, cookie } = await makeApp(fetcher);
    try {
      const state = createOAuthState(env.SESSION_SECRET);
      const res = await app.inject({
        method: 'GET',
        url: '/instagram/callback?code=AUTHCODE&state=' + encodeURIComponent(state),
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.connected).toBe(true);
      expect(body.liveVerified).toBe(false);
      expect(body.profile.username).toBe('shop');
      expect(body.profile.accountType).toBe('MEDIA_CREATOR');

      const raw = await creds.getRawCiphertext(OWNER);
      expect(raw).toBeTruthy();
      expect(raw as string).not.toContain('LONG-TOKEN');
      const stored = await creds.get(OWNER);
      expect(stored?.token).toBe('LONG-TOKEN');
      expect(stored?.permissions.length).toBe(3);
      const conn = await conns.get(OWNER, 'instagram');
      expect(conn?.status).toBe('connected');
      expect(conn?.accountRef).toBe('IG-777');
    } finally { await app.close(); }
  });

  it('status پیش از اتصال: disconnected و بدون ادعای زنده', async () => {
    const { fetcher } = makeFetcher([]);
    const { app, cookie } = await makeApp(fetcher);
    try {
      const res = await app.inject({ method: 'GET', url: '/instagram/status', headers: { cookie } });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.connected).toBe(false);
      expect(body.needsReauthorization).toBe(false);
      expect(body.liveVerified).toBe(false);
    } finally { await app.close(); }
  });

  it('profile بدون اتصال 409 می‌دهد', async () => {
    const { fetcher } = makeFetcher([]);
    const { app, cookie } = await makeApp(fetcher);
    try {
      const res = await app.inject({ method: 'GET', url: '/instagram/profile', headers: { cookie } });
      expect(res.statusCode).toBe(409);
    } finally { await app.close(); }
  });

  it('profile با توکن منقضی 401 می‌دهد', async () => {
    await saveCreds(['instagram_business_basic'], new Date(Date.now() - 1000));
    const { fetcher } = makeFetcher([]);
    const { app, cookie } = await makeApp(fetcher);
    try {
      const res = await app.inject({ method: 'GET', url: '/instagram/profile', headers: { cookie } });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('INSTAGRAM_REAUTH_REQUIRED');
    } finally { await app.close(); }
  });

  it('profile با خطای 190 از API 401 می‌دهد', async () => {
    await saveCreds(['instagram_business_basic']);
    const { fetcher } = makeFetcher([
      (url) => url.indexOf('/me?fields=') >= 0 ? { status: 401, body: { error: { message: 'token expired', code: 190 } } } : null,
    ]);
    const { app, cookie } = await makeApp(fetcher);
    try {
      const res = await app.inject({ method: 'GET', url: '/instagram/profile', headers: { cookie } });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('INSTAGRAM_REAUTH_REQUIRED');
    } finally { await app.close(); }
  });

  it('profile با خطای دیگر API 502 می‌دهد', async () => {
    await saveCreds(['instagram_business_basic']);
    const { fetcher } = makeFetcher([
      (url) => url.indexOf('/me?fields=') >= 0 ? { status: 500, body: { error: { message: 'boom', code: 2 } } } : null,
    ]);
    const { app, cookie } = await makeApp(fetcher);
    try {
      const res = await app.inject({ method: 'GET', url: '/instagram/profile', headers: { cookie } });
      expect(res.statusCode).toBe(502);
      expect(res.json().code).toBe('INTEGRATION_ERROR');
    } finally { await app.close(); }
  });

  it('profile موفق داده‌های رسمی را برمی‌گرداند', async () => {
    await saveCreds(['instagram_business_basic']);
    const { fetcher } = makeFetcher(happyHandlers());
    const { app, cookie } = await makeApp(fetcher);
    try {
      const res = await app.inject({ method: 'GET', url: '/instagram/profile', headers: { cookie } });
      expect(res.statusCode).toBe(200);
      expect(res.json().username).toBe('shop');
    } finally { await app.close(); }
  });

  it('insights بدون mediaId 422 می‌دهد', async () => {
    const { fetcher } = makeFetcher([]);
    const { app, cookie } = await makeApp(fetcher);
    try {
      const res = await app.inject({ method: 'GET', url: '/instagram/insights', headers: { cookie } });
      expect(res.statusCode).toBe(422);
    } finally { await app.close(); }
  });

  it('insights بدون مجوز 403 می‌دهد', async () => {
    await saveCreds(['instagram_business_basic']);
    const { fetcher } = makeFetcher(happyHandlers());
    const { app, cookie } = await makeApp(fetcher);
    try {
      const res = await app.inject({ method: 'GET', url: '/instagram/insights?mediaId=M-9', headers: { cookie } });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('PERMISSION_DENIED');
    } finally { await app.close(); }
  });

  it('insights موفق داده برمی‌گرداند', async () => {
    await saveCreds(['instagram_business_basic', 'instagram_business_manage_insights']);
    const { fetcher } = makeFetcher(happyHandlers());
    const { app, cookie } = await makeApp(fetcher);
    try {
      const res = await app.inject({ method: 'GET', url: '/instagram/insights?mediaId=M-9', headers: { cookie } });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.insights[0].name).toBe('likes');
      expect(body.insights[0].value).toBe(42);
    } finally { await app.close(); }
  });

  it('publish بدون اتصال 409 می‌دهد', async () => {
    const { fetcher } = makeFetcher([]);
    const { app, cookie } = await makeApp(fetcher);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/instagram/publish',
        payload: { imageUrl: 'https://cdn.example.com/pic.jpg', caption: 'تست' },
        headers: { cookie },
      });
      expect(res.statusCode).toBe(409);
    } finally { await app.close(); }
  });

  it('publish با نشانی تصویر نامعتبر 422 می‌دهد', async () => {
    const { fetcher } = makeFetcher([]);
    const { app, cookie } = await makeApp(fetcher);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/instagram/publish',
        payload: { imageUrl: 'ftp://x/pic.jpg', caption: 'تست' },
        headers: { cookie },
      });
      expect(res.statusCode).toBe(422);
    } finally { await app.close(); }
  });

  it('publish با مجوز ناقص 403 می‌دهد', async () => {
    await saveCreds(['instagram_business_basic']);
    const { fetcher } = makeFetcher(happyHandlers());
    const { app, cookie } = await makeApp(fetcher);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/instagram/publish',
        payload: { imageUrl: 'https://cdn.example.com/pic.jpg', caption: 'تست' },
        headers: { cookie },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('PERMISSION_DENIED');
    } finally { await app.close(); }
  });

  it('publish موفق: ظرف ← وضعیت FINISHED ← انتشار', async () => {
    await saveCreds(['instagram_business_basic', 'instagram_business_content_publish']);
    const { fetcher, calls } = makeFetcher(happyHandlers());
    const { app, cookie } = await makeApp(fetcher);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/instagram/publish',
        payload: { imageUrl: 'https://cdn.example.com/pic.jpg', caption: 'کپشن تست' },
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.publishedMediaId).toBe('M-900');
      expect(body.liveVerified).toBe(false);
      expect(calls[0]).toContain('/media?');
      expect(calls[1]).toContain('fields=status_code');
      expect(calls[2]).toContain('/media_publish');
    } finally { await app.close(); }
  });

  it('publish با ظرف IN_PROGRESS سپس FINISHED موفق می‌شود', async () => {
    await saveCreds(['instagram_business_basic', 'instagram_business_content_publish']);
    const { fetcher } = makeFetcher(happyHandlers(['IN_PROGRESS', 'FINISHED']));
    const { app, cookie } = await makeApp(fetcher);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/instagram/publish',
        payload: { imageUrl: 'https://cdn.example.com/pic.jpg', caption: 'کپشن تست' },
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().publishedMediaId).toBe('M-900');
    } finally { await app.close(); }
  });

  it('قطع اتصال: توکن حذف و وضعیت disconnected می‌شود', async () => {
    const { fetcher } = makeFetcher(happyHandlers());
    const { app, cookie } = await makeApp(fetcher);
    try {
      await connect(app, cookie);
      const res = await app.inject({ method: 'DELETE', url: '/instagram/connection', headers: { cookie } });
      expect(res.statusCode).toBe(200);
      expect(res.json().connected).toBe(false);

      const status = await app.inject({ method: 'GET', url: '/instagram/status', headers: { cookie } });
      expect(status.json().connected).toBe(false);

      const profile = await app.inject({ method: 'GET', url: '/instagram/profile', headers: { cookie } });
      expect(profile.statusCode).toBe(409);

      expect(await creds.getRawCiphertext(OWNER)).toBeNull();
    } finally { await app.close(); }
  });
});

describe('تازه‌سازی توکن (POST /instagram/refresh)', () => {
  it('refresh بدون اتصال 409 می‌دهد', async () => {
    const { fetcher } = makeFetcher([]);
    const { app, cookie } = await makeApp(fetcher);
    try {
      const res = await app.inject({ method: 'POST', url: '/instagram/refresh', headers: { cookie } });
      expect(res.statusCode).toBe(409);
    } finally { await app.close(); }
  });

  it('refresh با توکن منقضی 401 می‌دهد و تازه‌سازی نمی‌کند', async () => {
    await saveCreds(['instagram_business_basic'], new Date(Date.now() - 1000));
    const { fetcher, calls } = makeFetcher(happyHandlers());
    const { app, cookie } = await makeApp(fetcher);
    try {
      const res = await app.inject({ method: 'POST', url: '/instagram/refresh', headers: { cookie } });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('INSTAGRAM_REAUTH_REQUIRED');
      expect(calls.length).toBe(0);
    } finally { await app.close(); }
  });

  it('refresh موفق: توکن تازه و انقضای جدید رمزنگاری‌شده ذخیره می‌شود', async () => {
    await saveCreds(['instagram_business_basic', 'instagram_business_manage_insights']);
    const { fetcher, calls } = makeFetcher(happyHandlers());
    const { app, cookie } = await makeApp(fetcher);
    try {
      const res = await app.inject({ method: 'POST', url: '/instagram/refresh', headers: { cookie } });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.refreshed).toBe(true);
      expect(body.liveVerified).toBe(false);
      expect(calls[0]).toContain('https://graph.instagram.com/refresh_access_token');
      expect(calls[0]).toContain('grant_type=ig_refresh_token');
      const stored = await creds.get(OWNER);
      expect(stored?.token).toBe('LONG-TOKEN-2');
      expect(stored?.permissions.length).toBe(2);
      expect(new Date(stored!.expiresAt).getTime()).toBeGreaterThan(Date.now());
    } finally { await app.close(); }
  });

  it('refresh با شکست API 502 می‌دهد', async () => {
    await saveCreds(['instagram_business_basic']);
    const { fetcher } = makeFetcher([
      (url) => url.startsWith('https://graph.instagram.com/refresh_access_token')
        ? { status: 400, body: { error: { message: 'Token cannot be refreshed', code: 1 } } }
        : null,
    ]);
    const { app, cookie } = await makeApp(fetcher);
    try {
      const res = await app.inject({ method: 'POST', url: '/instagram/refresh', headers: { cookie } });
      expect(res.statusCode).toBe(502);
      expect(res.json().code).toBe('INTEGRATION_ERROR');
      const stored = await creds.get(OWNER);
      expect(stored?.token).toBe('LONG-TOKEN');
    } finally { await app.close(); }
  });
});
