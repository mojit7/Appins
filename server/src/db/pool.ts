import { Pool, type PoolClient, type PoolConfig } from 'pg';

export type SslMode = 'auto' | 'require' | 'verify-full' | 'disable';

export interface CreateDbPoolOptions {
  sslMode?: SslMode;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** تعیین TLS اتصال — مرجع رسمی: node-postgres.com/features/ssl
 *  auto: میزبان محلی بدون SSL؛ میزبان راه‌.remote با تأیید گواهی کامل (rejectUnauthorized=true).
 *  require: TLS بدون تأیید گواهی (میزبان‌های با گواهی self-signed مانند Railway) — رمزنگاری هست، تأیید هویت نه؛ در GO_LIVE.md توضیح داده شده.
 *  اگر خود DATABASE_URL دارای sslmode= باشد، تصمیم به pg سپرده می‌شود. */
function resolveSsl(connectionString: string, mode: SslMode): { rejectUnauthorized: boolean } | undefined {
  if (mode === 'disable') return undefined;
  if (mode === 'require') return { rejectUnauthorized: false };
  if (mode === 'verify-full') return { rejectUnauthorized: true };
  let host = '';
  try { host = new URL(connectionString).hostname; } catch { host = ''; }
  if (/sslmode=/.test(connectionString)) return undefined;
  if (LOCAL_HOSTS.has(host)) return undefined;
  return { rejectUnauthorized: true };
}

export function createDbPool(connectionString: string, options: CreateDbPoolOptions = {}): Pool {
  const config: PoolConfig = {
    connectionString,
    max: 10,
    ssl: resolveSsl(connectionString, options.sslMode ?? 'auto'),
  };
  return new Pool(config);
}

/** اجرای کار چندمرحله‌ای در یک تراکنش؛ در خطا rollback کامل. */
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
