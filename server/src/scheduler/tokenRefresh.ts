import type { Pool } from 'pg';
import type { Env } from '../config/env.js';
import { OWNER } from '../data/context.js';
import { InstagramCredentialRepository, type InstagramCredential } from '../data/instagramCredentials.js';
import { refreshLongLivedToken, type FetchLike } from '../integrations/instagram/oauth.js';

/** تازه‌ساز خودکار توکن بلندمدت اینستاگرام — مرجع رسمی:
 *  developers.facebook.com/docs/instagram-platform/reference/refresh_access_token
 *  توکن بلندمدت ۶۰ روزه است؛ توکن منقضی تازه‌سازی نمی‌شود و اتصال مجدد لازم است. */

const globalFetch = globalThis.fetch;

export interface MinimalLogger {
  error: (obj: unknown, msg?: string) => void;
  info?: (obj: unknown, msg?: string) => void;
}

export interface CredsLike {
  get(ctx: unknown): Promise<InstagramCredential | null>;
  save(ctx: unknown, rec: { token: string; expiresAt: Date; permissions: string[] }): Promise<void>;
}

export interface TokenRefreshDeps {
  env: Env;
  pool: Pool;
  /** تزریس مخزن اعتبارنامه برای آزمونپذیری؛ پیش‌فرض مخزن واقعی روی pool. */
  creds?: CredsLike;
}

export interface TokenRefreshOptions {
  log?: MinimalLogger;
  fetcher?: FetchLike;
}

function defaultFetcher(): FetchLike {
  return (url, init) => {
    const merged = { ...(init ?? {}), signal: AbortSignal.timeout(15000) };
    const res = globalFetch(url, merged as unknown as Parameters<typeof globalFetch>[1]);
    return res.then((r) => ({ ok: r.ok, status: r.status, json: () => r.json() as Promise<unknown> }));
  };
}

/** آیا توکن به پایان عمر خود نزدیک است؟ (زیر آستانه TTL کمینه) */
export function isRefreshDue(expiresAt: string | Date, now: number, minTtlMs: number): boolean {
  return new Date(expiresAt).getTime() - now < minTtlMs;
}

export type RefreshOutcome = 'no-credential' | 'expired' | 'skipped' | 'refreshed';

/** اگر توکن به انقضا نزدیک باشد تازه‌سازی می‌کند؛ توکن منقضی تازه‌سازی نمی‌شود (محدودیت رسمی متا). */
export async function refreshTokenIfDue(
  deps: TokenRefreshDeps,
  fetcher: FetchLike,
  now: number = Date.now(),
): Promise<RefreshOutcome> {
  const creds: CredsLike = deps.creds ?? new InstagramCredentialRepository(deps.pool, deps.env.SESSION_SECRET);
  const cred = await creds.get(OWNER);
  if (cred === null) return 'no-credential';
  const expMs = new Date(cred.expiresAt).getTime();
  if (expMs <= now) return 'expired';
  if (!isRefreshDue(cred.expiresAt, now, deps.env.IG_TOKEN_REFRESH_MIN_TTL_MS)) return 'skipped';
  const refreshed = await refreshLongLivedToken(cred.token, fetcher);
  await creds.save(OWNER, {
    token: refreshed.accessToken,
    expiresAt: new Date(now + refreshed.expiresInSeconds * 1000),
    permissions: cred.permissions,
  });
  return 'refreshed';
}

export class TokenRefresher {
  readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly deps: TokenRefreshDeps;
  private readonly options: TokenRefreshOptions;

  constructor(deps: TokenRefreshDeps, options: TokenRefreshOptions = {}) {
    this.deps = deps;
    this.options = options;
    this.intervalMs = deps.env.IG_TOKEN_REFRESH_INTERVAL_MS;
  }

  /** دوره تازه‌سازی؛ خطای هر گذر لاگ می‌شود و گذر بعدی ادامه می‌دهد. */
  start(): void {
    if (this.timer !== null) return;
    const run = () => {
      refreshTokenIfDue(this.deps, this.options.fetcher ?? defaultFetcher())
        .then((outcome) => {
          if (outcome === 'refreshed') this.options.log?.info?.({ outcome }, 'توکن اینستاگرام تازه‌سازی شد');
        })
        .catch((err: unknown) => {
          this.options.log?.error({ err: String(err) }, 'تازه‌سازی توکن اینستاگرام ناموفق بود');
        });
    };
    void run();
    this.timer = setInterval(run, this.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export function createTokenRefresher(deps: TokenRefreshDeps, options: TokenRefreshOptions = {}): TokenRefresher {
  return new TokenRefresher(deps, options);
}
