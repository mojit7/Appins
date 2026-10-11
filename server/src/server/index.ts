import { loadEnv } from '../config/env.js';
import { createDbPool } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';
import { buildApp } from './app.js';
import { createPublishingWorker } from '../scheduler/worker.js';

const env = loadEnv();
const pool = createDbPool(env.DATABASE_URL);
const worker = createPublishingWorker({ env, pool });
const app = buildApp({ env, instagram: { env, pool }, ai: { env, pool }, schedule: { env, pool, worker } });

runMigrations(pool)
  .then(() => app.listen({ port: env.PORT, host: '0.0.0.0' }))
  .then(() => {
    worker.start();
    app.log.info({ intervalMs: worker.intervalMs }, 'زمان‌بند انتشار فعال شد');
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });