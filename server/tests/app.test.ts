import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { loadEnv } from '../src/config/env.js';

const env = loadEnv({
  DATABASE_URL: 'postgres://u:p@localhost:5432/test',
  SESSION_SECRET: '0123456789abcdef0123456789abcdef',
  LOG_LEVEL: 'fatal',
});

describe('buildApp', () => {
  it('healthz با ۲۰۰ و وضعیت ok پاسخ می‌دهد', async () => {
    const app = buildApp({ env });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', service: 'appins-server' });
    await app.close();
  });

  it('مسیر ناشناخته با پیام فارسی ۴۰۴ می‌دهد', async () => {
    const app = buildApp({ env });
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toBe('مسیر درخواستی یافت نشد.');
    await app.close();
  });
});
