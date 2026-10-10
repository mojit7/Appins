import Fastify, { type FastifyInstance } from 'fastify';
import type { Env } from '../config/env.js';
import { AppError } from '../core/errors.js';
import { JobRegistry } from '../jobs/registry.js';

export interface AppDeps {
  env: Env;
  logger?: never;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: { level: deps.env.LOG_LEVEL } });
  const jobs = new JobRegistry();
  app.decorate('jobs', jobs);

  app.get('/healthz', async () => ({
    status: 'ok',
    service: 'appins-server',
    env: deps.env.NODE_ENV,
    jobs: jobs.list().map((j) => j.name),
  }));

  app.setNotFoundHandler(async (_req, reply) => {
    reply.status(404).send({ code: 'NOT_FOUND', message: 'مسیر درخواستی یافت نشد.' });
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      reply.status(err.statusCode).send(err.toPayload());
      return;
    }
    app.log.error({ err }, 'خطای غیرمنتظره');
    reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'خطای داخلی سرور.' });
  });

  return app;
}
