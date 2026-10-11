import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { Env } from '../config/env.js';
import { AppError } from '../core/errors.js';
import { JobRegistry } from '../jobs/registry.js';
import { safeEqual } from '../auth/password.js';
import { verifyTotp } from '../auth/totp.js';
import { clearSessionCookie, createSessionToken, readSessionCookie, SessionRevocationList, sessionCookie, verifySessionToken } from '../auth/session.js';
import { SlidingWindowRateLimiter } from './rateLimit.js';
import { registerInstagramRoutes, type InstagramDeps } from './instagram.js';
import { registerAiRoutes, type AiDeps } from './ai.js';
import { registerScheduleRoutes, type ScheduleDeps } from './schedule.js';
import { registerTelegramRoutes, type TelegramDeps } from './telegram.js';
import { registerEngagementRoutes, type EngagementDeps } from './engagement.js';

export interface AppDeps {
  env: Env;
  /** اتصال دیتابیس برای بررسی سلامت healthz — نبود آن یعنی «نامعلوم»، نه «سالم». */
  db?: { pool: Pool };
  instagram?: InstagramDeps;
  ai?: AiDeps;
  schedule?: ScheduleDeps;
  telegram?: TelegramDeps;
  engagement?: EngagementDeps;
}

const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function buildApp(deps: AppDeps): FastifyInstance {
  const { env } = deps;
  const secure = env.NODE_ENV === 'production';
  const loginLimiter = new SlidingWindowRateLimiter(LOGIN_LIMIT, LOGIN_WINDOW_MS);
  const revokedSessions = new SessionRevocationList();
               
  const app = Fastify({
    // پشت reverse proxy باید TRUST_PROXY=true تا req.ip واقعی خوانده شود (fastify.dev trustProxy)
    trustProxy: env.TRUST_PROXY === 'true',
    logger: {
      level: env.LOG_LEVEL,
      // حذف داده حساس از لاگ‌ها (ASVS V7)
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-telegram-bot-api-secret-token"]',
          'res.headers["set-cooki
e"]',
          '*.password',
          '*.token',
          '*.secret',
        ],
        censor: '[حذف شد]',
      },
    },
  });
  const jobs = new JobRegistry();
  app.decorate('jobs', jobs);

  // سرصفحه‌های امنیتی (ASVS V14/V3 + OWASP Secure Headers)
  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    // این سرور فقط JSON/API می‌دهد؛ سیاست محدود پیش‌فرض (OWASP CSP Cheatsheet)
    reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    if (secure) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  });

  // تجزیه JSON با نگه‌داشتن متن خام برای احراز امضای webhook متا (X-Hub-Signature-256)
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    const raw = typeof body === 'string' ? body : Buffer.isBuffer(body) ? body.toString('utf8') : '';
    (req as { rawBody?: string }).rawBody = raw;
    try {
      done(null, JSON.parse(raw));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // مسیرهای عمومی (بدون نشست و بدون بررسی CSRF)
  const PUBLIC = new Set(['/healthz', '/auth/login', '/telegram/webhook', '/instagram/webhook']);
  app.addHook('preHandler', async (req, reply) => {
    // fastify 5: مسیر از routeOptions خوانده می‌شود؛ برای مسیر ناشناخته undefined است
    const path = req.routeOptions?.url;
    if (path === undefined || PUBLIC.has(path)) return;
                                                   
    // دفاع CSRF لایه دوم (ASVS V4.7): در متدهای تغییردهنده، Origin/Referer اگر موجود باشد
    // باید با Host درخواست هم‌خوان باشد؛ نبود سرصفحه (کلاینت غیرمرورگری) رد نمی‌شود.
    if (MUTATING_METHODS.has(req.method)) {
      const originHeader = req.headers.origin ?? req.headers.referer;
      if (typeof originHeader === 'string' && originHeader.length > 0) {
  
      let originHost: string | null = null;
        try { originHost = new URL(originHeader).host; } catch { originHost = null; }
        const requestHost = req.headers.host;
        if (originHost !== null && requestHost !== undefined && originHost !== requestHost) {
          reply.status(403).send({ code: 'CSRF_REJECTED', message: 'درخواست از مبدأ ناشناس رد شد.' });
          return reply;
        }
      }
    }

    // گارد نشست سراسری (ASVS V4)
    const token = readSessionCookie(req.headers.cookie);
    if (!verifySessionToken(env.SESSION_SECRET, token) || revokedSessions.isRevoked(token)) {
      reply.status(401).send({ code: 'UNAUTHORIZED', message: 'برای دسترسی باید وارد حساب شوید.' });
      return reply;
    }
  });

  // سلامت: بدون pool «نامعلوم»؛ با pool واقعی SELECT 1 بررسی می‌شود و در خرابی ۵۰۳ می‌دهد
  app.get('/healthz', async (_req, reply) => {
    const base = {
      service: 'appins-server',
      env: env.NODE_ENV,
      jobs: jobs.list().map((j) => j.name),
    };
    const pool = deps.db?.pool;
    if (pool === undefined) return { ...base, status: 'ok', db: 'unknown' };
    try {
      await pool.query('SELECT 1');
      return { ...base, status: 'ok', db: 'ok' };
    } catch {
      reply.status(503);
      return { ...base, status: 'degraded', db: 'unreachable' };
    }
  });
                                                
  app.post<{ Body: { password?: unknown; code?: unknown } }>('/auth/login', async (req, reply) => {
    const key = 'login:' + req.ip;
    if (!loginLimiter.allow(key)) {
      reply.status(429).send({ code: 'RATE_LIMITED', message: 'تلاش‌های بیش از حد؛ کمی بعد دوباره تلاش کنید.' });
      return;
    }
    // قفل تک‌مرحله‌ای در تولید (APP-001، fail-closed): داشبورد عمومی بدون 2FA راه‌اندازی نمی‌شود.
    if (env.NODE_ENV === 'production' && env.TOTP_SECRET === undefined) {
      reply.status(503).send({ code: '2FA_NOT_CONFIGURED', message: 'ورود تک‌مرحله‌ای در محیط تولید مسدود است؛ TOTP_SECRET را تنظیم کنید.' });
      return;
    }
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as { password?: unknown; code?: unknown };
    const password = typeof body.password === 'string' ? body.password : '';
    if (password.length === 0 || !safeEqual(password, env.OWNER_PASSWORD)) {
      reply.status(401).send({ code: 'UNAUTHORIZED', message: 'رمز عبور نادرست است.' });
      return;
    }
    // ورود 
دومرحله‌ای اختیاری (RFC 6238) — با تنظیم TOTP_SECRET فعال می‌شود
    if (env.TOTP_SECRET !== undefined) {
      const code = typeof body.code === 'string' ? body.code : '';
      if (code.length === 0) {
        reply.status(401).send({ code: 'TOTP_REQUIRED', message: 'کد تأیید دومرحله‌ای الزامی است.' });
        return;
      }
      if (!verifyTotp(env.TOTP_SECRET, code)) {
        reply.status(401).send({ code: 'TOTP_INVALID', message: 'کد تأیید نادرست یا منقضی است.' });
        return;
      }
    }
    const token = createSessionToken(env.SESSION_SECRET);
    reply.header('set-cookie', sessionCookie(token, secure));
    reply.send({ ok: true });
  });

  app.post('/auth/logout', async (req, reply) => {
    // ابطال فوری توکن سرویس‌شده (APP-002): کپی توکن پس از خروج تا انقضای طبیعی معتبر نمی‌ماند
    const token = readSessionCookie(req.headers.cookie);
    if (token !== undefined) revokedSessions.revoke(token);
    reply.header('set-cookie', clearSessionCookie(secure));
    reply.send({ ok: true });
  });

  app.get('/auth/me', async () => ({ role: 'owner' }));

  registerInstagramRoutes(app, deps.instagram);
  registerAiRoutes(app, deps.ai);
  registerScheduleRoutes(app, deps.schedule);
  registerTelegramRoutes(app, deps.telegram);
  registerEngagementRoutes(app, deps.engagement);
                                                                     
  const worker = deps.schedule?.worker;
  if (worker) {
    jobs.register({ name: 'publishing-scheduler', intervalMs: worker.intervalMs, handler: async () => { await worker.tick(); } });
    app.addHook('onClose', async () => { worker.stop(); });
  }

  app.setNotFoundHandler(async (_req, reply) => {
    reply.status(404).send({ code: 'NOT_FOUND', message: 'مسیر درخواستی یافت نشد.' });
  });

  app.setErrorHandler((err: unknown, _req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof AppError) {
      reply.status(err.statusCode).send(err.toPayload());
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    const maybeCode = (err as { code?: unknown } | null | undefined)?.code;
    const code = typeof maybeCode === 'string' ? maybeCode : undefined;
    app.log.error({ err: message, code }, 'خطای غیرمنتظره');
    reply.status(500).send({ c
ode: 'INTERNAL_ERROR', message: 'خطای داخلی سرور.' });
  });

  return app;
}
