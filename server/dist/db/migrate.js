import { MIGRATIONS } from './migrations.js';
/** مهاجرت‌های اعمال‌نشده را در تراکنش‌های جدا اعمال می‌کند و شماره اعمال‌شده‌ها را برمی‌گرداند. */
export async function runMigrations(pool) {
    await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const applied = new Set((await pool.query('SELECT id FROM schema_migrations')).rows.map((r) => r.id));
    let count = 0;
    for (const m of MIGRATIONS) {
        if (applied.has(m.id))
            continue;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(m.sql);
            await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [m.id]);
            await client.query('COMMIT');
            count += 1;
        }
        catch (err) {
            await client.query('ROLLBACK').catch(() => undefined);
            client.release();
            throw err;
        }
        client.release();
    }
    return count;
}
export async function listAppliedMigrations(pool) {
    const r = await pool.query('SELECT id FROM schema_migrations ORDER BY id');
    return r.rows.map((x) => x.id);
}
