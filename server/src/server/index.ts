import pino from 'pino';
import { loadEnv } from '../config/env.js';
import { createDbPool } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';
import { buildApp } from './app.js';
import { createPublishingWorker } from '../scheduler/worker.js';
import { createTokenRefresher } from '../scheduler/tokenRefresh.js';
import { TelegramClient } from '../integrations/telegram/client.js';
import { TelegramOutcomeNotifier } from '../integrations/telegram/notifier.js';

const env = loadEnv();
const log = pino({ level: env.LOG_LEVEL });
const pool = createDbPool(env.DATABASE_URL, { sslMode: env.DATABASE_SSL });

// ماژول تلگرام فقط با پیکربندی کامل (توکن + شناسه مالک + سرّ webhook) فعال می‌شود
const telegramReady = Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_OWNER_ID && env.TELEGRAM_WEBHOOK_SECRET);
const notifier = telegramReady
  ? new TelegramOutcomeNotifier(new TelegramClient(env.TELEGRAM_BOT_TOKEN!), env.TELEGRAM_OWNER_ID!)
  : null;
const worker = createPublishingWorker(
  { env, pool },
  {
    log,
    ...(notifier ? { onOutcome: (job, outcome, detail) => notifier.notify(job, outcome, detail) } : {}),
  },
);
// تازه‌سازی خودکار توکن بلندمدت اینستاگرام (۶۰ روزه) تا نیازمند دخالت انسانی نشود
const tokenRefresher = createTokenRefresher({ env, pool }, { log });
const app = buildApp({
  env,
  db: { pool },
  instagram: { env, pool },
  ai: { env, pool },
  schedule: { env, pool, worker },
  telegram: telegramReady ? { env, pool } : undefined,
  engagement: { env, pool },
});

runMigrations(pool)
  .then(() => app.listen({ port: env.PORT, host: '0.0.0.0' }))
  .then(() => {
    worker.start();
    tokenRefresher.start();
    app.log.info({ intervalMs: worker.intervalMs, telegram: telegramReady }, 'زمان‌بند انتشار فعال شد');
  })
  .catch((err) => {
    log.error(err);
    process.exit(1);
  });

/** توقف نرم (graceful shutdown) — SIGTERM/SIGINT ابتدا کارگران را می‌ایستاند،
 *  اتصال‌های در حال پردازش را می‌بندد و سپس pool را پایان می‌دهد؛
 *  مرجع: nodejs.org/api/process.html#signal-events و قرارداد استقرار OCI/PaaS */
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, 'توقف نرم آغاز شد');
  worker.stop();
  tokenRefresher.stop();
  try {
    await app.close();
  } catch (err) {
    log.error({ err: String(err) }, 'خطا در بستن سرور');
  }
  try {
    await pool.end();
  } catch (err) {
    log.error({ err: String(err) }, 'خطا در پایان pool دیتابیس');
  }
  process.exit(0);
}
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
