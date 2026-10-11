import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'appins_session';
export const SESSION_TTL_S = 8 * 60 * 60; // ۸ ساعت

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function hmac(secret: string, data: string): Buffer {
  return createHmac('sha256', secret).update(data, 'utf8').digest();
}

/** توکن نشست امضاشده با HMAC-SHA256: payload = انقضا (epoch ثانیه). */
export function createSessionToken(secret: string, ttlS = SESSION_TTL_S): string {
  const exp = Math.floor(Date.now() / 1000) + ttlS;
  const payload = b64url(Buffer.from(String(exp), 'utf8'));
  const sig = b64url(hmac(secret, payload));
  return `${payload}.${sig}`;
}

/** اعتبارسنجی توکن نشست — امضا با زمان-ثابت و انقضای اجباری. */
export function verifySessionToken(secret: string, token: string | undefined | null): boolean {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts as [string, string];
  let expected: Buffer;
  try {
    expected = hmac(secret, payload);
  } catch {
    return false;
  }
  // مقایسه روی رشته کانونی امضا: decode پایه64 رشدهای متفاوت می‌تواند بایت‌های یکسان بدهد
  // (بیت‌های انتهایی حذف‌شده)، پس باید خود رشته امضا دقیقاً با فرم کانونی یکی باشد.
  const expectedSig = b64url(expected);
  const got = Buffer.from(sig, 'utf8');
  const want = Buffer.from(expectedSig, 'utf8');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return false;
  const exp = Number(Buffer.from(payload, 'base64url').toString('utf8'));
  if (!Number.isFinite(exp)) return false;
  return exp > Math.floor(Date.now() / 1000);
}

export function sessionCookie(token: string, secure: boolean): string {
  const flags = ['HttpOnly', 'Path=/', 'SameSite=Strict', `Max-Age=${SESSION_TTL_S}`];
  if (secure) flags.push('Secure');
  return `${SESSION_COOKIE}=${token}; ${flags.join('; ')}`;
}

export function clearSessionCookie(secure: boolean): string {
  const flags = ['HttpOnly', 'Path=/', 'SameSite=Strict', 'Max-Age=0'];
  if (secure) flags.push('Secure');
  return `${SESSION_COOKIE}=; ${flags.join('; ')}`;
}

export function readSessionCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === SESSION_COOKIE) return v.join('=');
  }
  return undefined;
}
