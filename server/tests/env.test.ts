import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';

const validEnv = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/appins',
  SESSION_SECRET: '0123456789abcdef0123456789abcdef',
  OWNER_PASSWORD: 'test-owner-pass-123',
};

describe('loadEnv', () => {
  it('مقادیر پیش‌فرض را اعمال می‌کند', () => {
    const env = loadEnv(validEnv);
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
  });

  it('با نبود DATABASE_URL خطای پیکربندی می‌دهد', () => {
    expect(() => loadEnv({ ...validEnv, DATABASE_URL: '' })).toThrowError(/پیکربندی/);
  });

  it('SESSION_SECRET کوتاه رد می‌شود', () => {
    expect(() => loadEnv({ ...validEnv, SESSION_SECRET: 'short' })).toThrowError(/پیکربندی/);
  });

  it('OWNER_PASSWORD کوتاه رد می‌شود', () => {
    expect(() => loadEnv({ ...validEnv, OWNER_PASSWORD: 'short' })).toThrowError(/پیکربندی/);
  });
});
