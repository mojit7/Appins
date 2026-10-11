import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { Env } from '../config/env.js';
import { AppError } from '../core/errors.js';
import { JobRegistry } from '../jobs/registry.js';
import { safeEqual } from '../auth/password.js';
import { clearSessionCookie, createSessionToken, readSessionCookie, sessionCookie,
  verifySessionToken } from '../auth/session.js';
import { SlidingWindowRateLimiter } from './rateLimit.js';

export interface AppDeps {
  env: Env;
}

const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export function buildApp(deps: AppDeps): FastifyInstance {
  const { env } = deps;
  const secure = env.NODE_ENV === 'production';
  const loginLimiter = new SlidingWindowRateLimiter(LOGIN_LIMIT, LOGIN_WINDOW_MS);

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          '*.password',
          '*.token',
          '*.secret',
        ],
        censor: '[REDACTED]',
      },
    },
  });
  const jobs = new JobRegistry();
  app.decorate('jobs', jobs);

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    if (secure) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  });

  const PUBLIC = new Set(['/healthz', '/auth/login']);
  app.addHook('preHandler', async (req, reply) => {
    const path = req.routeOptions?.url ?? '';
    if (PUBLIC.has(path)) return;
    const token = readSessionCookie(req.headers.cookie);
    if (!verifySessionToken(env.SESSION_SECRET, token)) {
      reply.status(401).send({ code: 'UNAUTHORIZED', message: 'برای دسترسی باید وارد حساب شوید.' });
      return reply;
    }
  });

  app.get('/healthz', async () => ({
    status: 'ok',
    service: 'appins-server',
    env: env.NODE_ENV,
    jobs: jobs.list().map((j) => j.name),
  }));

  app.post<{ Body: { password?: unknown } }>('/auth/login', async (req, reply) => {
    const key = `login:${req.ip}`;
    if (!loginLimiter.allow(key)) {
      reply.status(429).send({ code: 'RATE_LIMITED', message: 'تلاش‌های بیش از حد؛ کمی بعد دوباره تلاش کنید.' });
      return;
    }
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as { password?: unknown };
    const password = typeof body.password === 'string' ? body.password : '';
    if (password.length === 0 || !safeEqual(password, env.OWNER_PASSWORD)) {
      reply.status(401).send({ code: 'UNAUTHORIZED', message: 'رمز عبور نادرست است.' });
      return;
    }
    const token = createSessionToken(env.SESSION_SECRET);
    reply.header('set-cookie', sessionCookie(token, secure));
    reply.send({ ok: true });
  });

  app.post('/auth/logout', async (_req, reply) => {
    reply.header('set-cookie', clearSessionCookie(secure));
    reply.send({ ok: true });
  });

  app.get('/auth/me', async () => ({ role: 'owner' }));

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
    reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'خطای داخلی سرور.' });
  });

  return app;
}
