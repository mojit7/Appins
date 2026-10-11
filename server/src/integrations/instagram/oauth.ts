import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError, IntegrationError, ValidationError } from '../../core/errors.js';

/** بر پایه مستندات رسمی «Business Login for Instagram» (developers.facebook.com، API v26.0):
 *  authorize، تبادل کد، توکن بلندمدت ۶۰ روزه و تمدید آن؛ scope های instagram_business_* از ۲۷ ژانویه ۲۰۲۵. */

export const IG_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_insights',
  'instagram_business_content_publish',
] as const;

export interface InstagramOAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<FetchResponse>;

const STATE_TTL_MS = 10 * 60 * 1000;

function signState(secret: string, payload: string): string {
  return createHmac('sha256', secret).update('ig-oauth:' + payload).digest('base64url');
}

/** state امضاشده با HMAC برای دفاع CSRF؛ نیازی به ذخیره سمت سرور ندارد. */
export function createOAuthState(secret: string): string {
  const nonce = randomBytes(16).toString('base64url');
  const payload = nonce + '.' + (Date.now() + STATE_TTL_MS);
  return payload + '.' + signState(secret, payload);
}

export function verifyOAuthState(secret: string, state: unknown): void {
  if (typeof state !== 'string' || state.length === 0) {
    throw new ValidationError('پارامتر state نامعتبر است.');
  }
  const parts = state.split('.');
  if (parts.length !== 3) {
    throw new AppError('امضای state معتبر نیست.', 'INVALID_OAUTH_STATE', 400);
  }
  const noncePart = parts[0];
  const expPart = parts[1];
  const sigPart = parts[2];
  if (noncePart === undefined || expPart === undefined || sigPart === undefined) {
    throw new AppError('امضای state معتبر نیست.', 'INVALID_OAUTH_STATE', 400);
  }
  const payload = noncePart + '.' + expPart;
  const expected = signState(secret, payload);
  const a = Buffer.from(sigPart);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AppError('امضای state معتبر نیست.', 'INVALID_OAUTH_STATE', 400);
  }
  const expMs = Number(expPart);
  if (!Number.isFinite(expMs) || Date.now() > expMs) {
    throw new AppError('state منقضی شده است؛ جریان اتصال را از نو آغاز کنید.', 'OAUTH_STATE_EXPIRED', 400);
  }
}

export function buildAuthorizeUrl(cfg: InstagramOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.appId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: IG_SCOPES.join(','),
    state,
  });
  return 'https://www.instagram.com/oauth/authorize?' + params.toString();
}

export interface CallbackQuery {
  error?: unknown;
  errorReason?: unknown;
  code?: unknown;
  state?: unknown;
}

/** لغو توسط کاربر: error=access_denied&error_reason=user_denied مطابق مستندات رسمی. */
export function parseCallback(q: CallbackQuery):
  | { kind: 'denied' }
  | { kind: 'code'; code: string; state: string } {
  if (typeof q.error === 'string' && q.error.length > 0) {
    if (q.error === 'access_denied') return { kind: 'denied' };
    throw new AppError('خطای بازگشتی از اینستاگرام در جریان مجوز.', 'OAUTH_ERROR', 400, q.error);
  }
  if (typeof q.code !== 'string' || q.code.length === 0) {
    throw new ValidationError('کد مجوز در پاسخ بازگشتی وجود ندارد.');
  }
  return { kind: 'code', code: q.code, state: typeof q.state === 'string' ? q.state : '' };
}

export interface ShortLivedToken {
  accessToken: string;
  userId: string;
  permissions: string[];
}

export async function exchangeCodeForShortToken(
  cfg: InstagramOAuthConfig,
  code: string,
  fetcher: FetchLike,
): Promise<ShortLivedToken> {
  const body = new URLSearchParams({
    client_id: cfg.appId,
    client_secret: cfg.appSecret,
    grant_type: 'authorization_code',
    redirect_uri: cfg.redirectUri,
    code,
  });
  const res = await fetcher('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const entry = (Array.isArray(data?.data) ? (data?.data as Record<string, unknown>[])[0] : data) ?? null;
  if (!res.ok || !entry || typeof entry.access_token !== 'string' || typeof entry.user_id !== 'string') {
    throw new IntegrationError('تبادل کد مجوز با اینستاگرام ناموفق بود.', {
      errorType: (entry?.error_type as string) ?? null,
      httpStatus: res.status,
    });
  }
  const perms = typeof entry.permissions === 'string'
    ? entry.permissions.split(',').map((p) => p.trim()).filter((p) => p.length > 0)
    : [];
  return { accessToken: entry.access_token, userId: entry.user_id, permissions: perms };
}

export interface LongLivedToken {
  accessToken: string;
  expiresInSeconds: number;
}

/** تبادل توکن کوتاه‌مدت با بلندمدت — طبق مستندات باید سمت سرور انجام شود. */
export async function exchangeForLongLivedToken(
  cfg: InstagramOAuthConfig,
  shortLivedToken: string,
  fetcher: FetchLike,
): Promise<LongLivedToken> {
  const params = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: cfg.appSecret,
    access_token: shortLivedToken,
  });
  const res = await fetcher('https://graph.instagram.com/access_token?' + params.toString());
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !data || typeof data.access_token !== 'string' || typeof data.expires_in !== 'number') {
    throw new IntegrationError('دریافت توکن بلندمدت ناموفق بود.');
  }
  return { accessToken: data.access_token, expiresInSeconds: data.expires_in };
}

/** تمدید توکن بلندمدت برای ۶۰ روز دیگر؛ توکن باید دست‌کم ۲۴ ساعت قدمت داشته باشد. */
export async function refreshLongLivedToken(token: string, fetcher: FetchLike): Promise<LongLivedToken> {
  const params = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token });
  const res = await fetcher('https://graph.instagram.com/refresh_access_token?' + params.toString());
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !data || typeof data.access_token !== 'string' || typeof data.expires_in !== 'number') {
    throw new IntegrationError('تمدید توکن اینستاگرام ناموفق بود.');
  }
  return { accessToken: data.access_token, expiresInSeconds: data.expires_in };
}
