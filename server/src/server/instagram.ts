import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { AppError, ConflictError, ValidationError } from '../core/errors.js';
import type { Env } from '../config/env.js';
import { OWNER } from '../data/context.js';
import { IntegrationConnectionRepository } from '../data/connections.js';
import { InstagramCredentialRepository, type InstagramCredential } from '../data/instagramCredentials.js';
import {
  createImageContainer,
  getContainerStatus,
  getMediaInsights,
  getMeProfile,
  publishContainer,
} from '../integrations/instagram/client.js';
import {
  buildAuthorizeUrl,
  createOAuthState,
  exchangeCodeForShortToken,
  exchangeForLongLivedToken,
  refreshLongLivedToken,
  parseCallback,
  verifyOAuthState,
  type CallbackQuery,
  type FetchLike,
  type InstagramOAuthConfig,
} from '../integrations/instagram/oauth.js';

/** مسیرهای اینستاگرام — همگی پشت گارد نشست سراسری هستند.
 *  وضعیت پیاده‌سازی از «تأیید زنده» جدا است: liveVerified همیشه false مگر بازرسی واقعی. */

export interface InstagramDeps {
  env: Env;
  pool: Pool;
  fetcher?: FetchLike;
}

const DEFAULT_METRIC = 'likes,comments,views';
const MAX_POLL_ATTEMPTS = 3;
const POLL_DELAY_MS = 1000;
const CAPTION_MAX = 2200;
const OUTBOUND_TIMEOUT_MS = 15000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const globalFetch = globalThis.fetch;

/** درخواست خروجی با تایم‌اوت صریح — پاسخ‌ندادن متا نباید درخواست را بی‌پایان معلق کند. */
function defaultFetcher(): FetchLike {
  return (url: string, init?: Record<string, unknown>) => {
    const merged = { ...(init ?? {}), signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS) };
    const res = globalFetch(url, merged as unknown as Parameters<typeof globalFetch>[1]);
    return res.then((r) => ({ ok: r.ok, status: r.status, json: () => r.json() as Promise<unknown> }));
  };
}
       
function oauthConfig(env: Env): InstagramOAuthConfig {
  const appId = env.INSTAGRAM_APP_ID;
  const
 appSecret = env.INSTAGRAM_APP_SECRET;
  const redirectUri = env.INSTAGRAM_REDIRECT_URI;
  if (!appId || !appSecret || !redirectUri) {
    throw new AppError('اینستاگرام در این سرور پیکربندی نشده است.', 'INSTAGRAM_NOT_CONFIGURED', 503);
  }
  return { appId, appSecret, redirectUri };
}

const STUB_ROUTES: Array<{ method: 'GET' | 'POST' | 'DELETE'; url: string }> = [
  { method: 'GET', url: '/instagram/authorize' },
  { method: 'GET', url: '/instagram/callback' },
  { method: 'GET', url: '/instagram/status' },
  { method: 'GET', url: '/instagram/profile' },
  { method: 'GET', url: '/instagram/insights' },
  { method: 'POST', url: '/instagram/publish' },
  { method: 'POST', url: '/instagram/refresh' },
  { method: 'DELETE', url: '/instagram/connection' },
];

export function registerInstagramRoutes(app: FastifyInstance, deps: InstagramDeps | undefined): void {
  if (!deps) {
    for (const r of STUB_ROUTES) {
      app.route({
        method: r.method,
        url: r.url,
        handler: async () => {
          throw new AppError('ماژول اینستاگرام در این فرآیند فعال نیست.', 'INSTAGRAM_NOT_CONFIGURED', 503);
        },
      });
    }
    return;
  }

  const { env, pool } = deps;
  const fetcher: FetchLike = deps.fetcher ?? defaultFetcher();
  const conns = new IntegrationConnectionRepository(pool);
  // کلید رمزنگاری مستقل (APP-007): INSTAGRAM_TOKEN_ENCRYPTION_KEY یا برگشت سازگار به SESSION_SECRET
  const creds = new InstagramCredentialRepository(pool, env.INSTAGRAM_TOKEN_ENCRYPTION_KEY ?? env.SESSION_SECRET);
                                  
  async function loadCredentials(requiredPermission: string): Promise<InstagramCredential> {
    const cred = await creds.get(OWNER);
    if (!cred) {
      throw new ConflictError('اینستاگرام متصل نیست؛ ابتدا اتصال را انجام دهید.');
    }
    if (new Date(cred.expiresAt).getTime() <= Date.now()) {
      throw new AppError('توکن اینستاگرام منقضی شده است؛ اتصال مجدد لازم است.', 'INSTAGRAM_REAUTH_REQUIRED', 401);
    }
    if (!cred.permissions.includes(requiredPermission)) {
      throw new AppError('مجوز لازم برای این عملیات اعطا نشده است؛ اتصال مجدد با مجوز کامل لازم است.', 'PERMISSION_DENIED',
 403);
    }
    return cred;
  }

  app.get('/instagram/authorize', async () => {
    const cfg = oauthConfig(env);
    const state = createOAuthState(env.SESSION_SECRET);
    return { authorizationUrl: buildAuthorizeUrl(cfg, state) };
  });

  app.get<{ Querystring: CallbackQuery }>('/instagram/callback', async (req) => {
    const cfg = oauthConfig(env);
    const parsed = parseCallback(req.query);
    if (parsed.kind === 'denied') {
      throw new AppError('اجازه دسترسی به اینستاگرام از سوی شما رد شد.', 'PERMISSION_DENIED', 403);
    }
    verifyOAuthState(env.SESSION_SECRET, parsed.state);
    const short = await exchangeCodeForShortToken(cfg, parsed.code, fetcher);
    const long = await exchangeForLongLivedToken(cfg, short.accessToken, fetcher);
    const profile = await getMeProfile(long.accessToken, fetcher);
    await creds.save(OWNER, {
      token: long.accessToken,
      expiresAt: new Date(Date.now() + long.expiresInSeconds * 1000),
      permissions: short.permissions,
    });
    await conns.upsert(OWNER, { provider: 'instagram', status: 'connected', accountRef: profile.id });
    return {
      connected: true,
      liveVerified: false,
      profile: {
        id: profile.id,
        username: profile.username,
        accountType: profile.accountType,
        followersCount: profile.followersCount,
        mediaCount: profile.mediaCount,
      },
    };
  });
                                
  app.get('/instagram/status', async () => {
    const conn = await conns.get(OWNER, 'instagram');
    const cred = await creds.get(OWNER);
    const now = Date.now();
    return {
      connected: conn?.status === 'connected' && cred !== null,
      accountRef: conn?.accountRef ?? null,
      connectedAt: conn?.connectedAt ?? null,
      tokenExpiresAt: cred?.expiresAt ?? null,
      needsReauthorization: cred !== null && new Date(cred.expiresAt).getTime() <= now,
      grantedPermissions: cred?.permissions ?? [],
      liveVerified: false,
    };
  });

  app.delete('/instagram/connectio
n', async () => {
    await creds.clear(OWNER);
    await conns.upsert(OWNER, { provider: 'instagram', status: 'disconnected', accountRef: null });
    return { connected: false };
  });

  /** تازه‌سازی توکن بلندمدت — طبق مستندات رسمی: توکن باید دست‌کم ۲۴ ساعت قدمت داشته و منقضی نشده باشد؛
   *  توکن تازه‌شده ۶۰ روز از زمان تازه‌سازی اعتبار دارد (GET /refresh_access_token). */
  app.post('/instagram/refresh', async () => {
    const cred = await creds.get(OWNER);
    if (!cred) {
      throw new ConflictError('اینستاگرام متصل نیست؛ ابتدا اتصال را انجام دهید.');
    }
    if (new Date(cred.expiresAt).getTime() <= Date.now()) {
      throw new AppError('توکن اینستاگرام منقضی شده است؛ تازه‌سازی ممکن نیست، اتصال مجدد لازم است.', 'INSTAGRAM_REAUTH_REQUIRED', 401);
    }
    const refreshed = await refreshLongLivedToken(cred.token, fetcher);
    const expiresAt = new Date(Date.now() + refreshed.expiresInSeconds * 1000);
    await creds.save(OWNER, { token: refreshed.accessToken, expiresAt, permissions: cred.permissions });
    return { refreshed: true, tokenExpiresAt: expiresAt.toISOString(), liveVerified: false };
  });

  app.get('/instagram/profile', async () => {
    const cred = await loadCredentials('instagram_business_basic');
    return getMeProfile(cred.token, fetcher);
  });
        
  app.get<{ Querystring: { mediaId?: unknown; metric?: unknown } }>('/instagram/insights', async (req) => {
    if (typeof req.query.mediaId !== 'string' || req.query.mediaId.length === 0) {
      throw new ValidationError('پارامتر mediaId الزامی است.');
    }
    const metric = typeof req.query.metric === 'string' && req.query.metric.length > 0
      ? req.query.metric
      : DEFAULT_METRIC;
    const cred = await loadCredentials('instagram_business_manage_insights');
    const insights = await getMediaInsights(req.query.mediaId, cred.token, metric, fetcher);
    return { metric, insights };
  });
                                                    
  app.post<{ Body: { imageUrl?: unknown; caption?: unknown } }>('/instagram/publish', asyn
c (req) => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as { imageUrl?: unknown; caption?: unknown };
    if (typeof body.imageUrl !== 'string' || body.imageUrl.length === 0) {
      throw new ValidationError('نشانی تصویر الزامی است.');
    }
    if (!/^https?:\/\//i.test(body.imageUrl)) {
      throw new ValidationError('نشانی تصویر باید http(s) باشد.');
    }
    const caption = typeof body.caption === 'string' ? body.caption : '';
    if (caption.length > CAPTION_MAX) {
      throw new ValidationError('متن کپشن بلندتر از حد مجاز اینستاگرام (۲۲۰۰ نویسه) است.');
    }
    const cred = await loadCredentials('instagram_business_content_publish');
    const conn = await conns.get(OWNER, 'instagram');
    const igId = conn?.accountRef;
    if (!igId) {
      throw new ConflictError('شناسه حساب اینستاگرام در وضعیت اتصال موجود نیست؛ اتصال را از نو انجام دهید.');
    }
    const containerId = await createImageContainer(igId, cred.token, { imageUrl: body.imageUrl, caption }, fetcher);
    let ready = false;
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      const status = await getContainerStatus(containerId, cred.token, fetcher);
      if (status === 'FINISHED') { ready = true; break; }
      if (status === 'ERROR') {
        throw new AppError('ظرف رسانه با خطا مواجه شد؛ انتشار انجام نشد.', 'INSTAGRAM_PUBLISH_FAILED', 502);
      }
      if (attempt < MAX_POLL_ATTEMPTS - 1) await sleep(POLL_DELAY_MS);
    }
    if (!ready) {
      throw new AppError('ظرف رسانه در زمان انتظار آماده نشد.', 'INSTAGRAM_PUBLISH_TIMEOUT', 502, { containerId });
    }
    const publishedMediaId = await publishContainer(igId, cred.token, containerId, fetcher);
    return { publishedMediaId, liveVerified: false };
  });
}
