import { loadEnv } from '../config/env.js';
import { createDbPool } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';
import { buildApp } from './app.js';
import { createPublishingWorker } from '../scheduler/worker.js';
import { TelegramClient } from '../integrations/telegram/client.js';
import { TelegramOutcomeNotifier } from '../integrations/telegram/notifier.js';

const env = loadEnv();
const pool = createDbPool(env.DATABASE_URL);
// ماژول تلگرام فقط با پیکربندی کامل (توکن + شناسه مالک + سرّ webhook) فعال می‌شود
const telegramReady = Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_OWNER_ID && env.TELEGRAM_WEBHOOK_SECRET);
const notifier = telegramReady
  ? new TelegramOutcomeNotifier(new TelegramClient(env.TELEGRAM_BOT_TOKEN!), env.TELEGRAM_OWNER_ID!)
  : null;
const worker = createPublishingWorker(
  { env, pool },
  notifier ? { onOutcome: (job, outcome, detail) => notifier.notify(job, outcome, detail) } : {},
);
const app = buildApp({
  env,
  instagram: { env, pool },
  ai: { env, pool },
  schedule: { env, pool, worker },
  telegram: telegramReady ? { env, pool } : undefined,
});

runMigrations(pool)
  .then(() => app.listen({ port: env.PORT, host: '0.0.0.0' }))
  .then(() => {
    worker.start();
    app.log.info({ intervalMs: worker.intervalMs, telegram: telegramReady }, 'زمان‌بند انتشار فعال شد');
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
