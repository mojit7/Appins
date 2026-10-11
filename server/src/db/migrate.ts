import type { Pool } from 'pg';
import { MIGRATIONS } from './migrations.js';

/** قفل مشاوره‌ای سراسری Postgres تا دو نمونه فرآیند (استقرار blue-green) نتوانند هم‌زمان
 *  مهاجرت را اعمال کنند — مرجع: postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS */
const MIGRATION_LOCK_ID = 724713;

/** مهاجرت‌های اعمال‌نشده را در تراکنش‌های جدا اعمال می‌کند و شماره اعمال‌شده‌ها را برمی‌گرداند. */
export async function runMigrations(pool: Pool): Promise<number> {
  const lockClient = await pool.connect();
  try {
    await lockClient.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await lockClient.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = new Set(
      (await pool.query<{ id: string }>('SELECT id FROM schema_migrations')).rows.map((r) => r.id),
    );
    let count = 0;
    for (const m of MIGRATIONS) {
      if (applied.has(m.id)) continue;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [m.id]);
        await client.query('COMMIT');
        count += 1;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
        throw err;
      }
      client.release();
    }
    return count;
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    lockClient.release();
  }
}

export async function listAppliedMigrations(pool: Pool): Promise<string[]> {
  const r = await pool.query<{ id: string }>('SELECT id FROM schema_migrations ORDER BY id');
  return r.rows.map((x) => x.id);
}
