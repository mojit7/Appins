import { Pool, type PoolClient } from 'pg';

export function createDbPool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 10 });
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
