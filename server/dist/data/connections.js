import { ValidationError } from '../core/errors.js';
import { ConnectionUpsertSchema } from '../domain/connection.js';
import { assertActor } from './context.js';
import { withDbErrors } from '../db/errors.js';
function toConn(r) {
    return {
        id: r.id,
        provider: r.provider,
        status: r.status,
        accountRef: r.account_ref,
        connectedAt: r.connected_at ? r.connected_at.toISOString() : null,
        updatedAt: r.updated_at.toISOString(),
    };
}
/** فراداده اتصال ادغام‌ها — بدون هیچ رمز یا توکن. */
export class IntegrationConnectionRepository {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async upsert(ctx, raw) {
        assertActor(ctx);
        const parsed = ConnectionUpsertSchema.safeParse(raw);
        if (!parsed.success) {
            throw new ValidationError('فراداده اتصال نامعتبر است.', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
        }
        const c = parsed.data;
        return withDbErrors(async () => {
            const r = await this.pool.query(`INSERT INTO integration_connections (provider, status, account_ref, connected_at, updated_at)
         VALUES ($1,$2,$3, CASE WHEN $2 = 'connected' THEN now() ELSE NULL END, now())
         ON CONFLICT (provider) DO UPDATE SET
           status = EXCLUDED.status,
           account_ref = EXCLUDED.account_ref,
           connected_at = CASE WHEN EXCLUDED.status = 'connected' THEN now() ELSE NULL END,
           updated_at = now()
         RETURNING *`, [c.provider, c.status, c.accountRef]);
            const row = r.rows[0];
            if (!row)
                throw new Error('ثبت اتصال نتیجه‌ای برنگرداند.');
            return toConn(row);
        });
    }
    async get(ctx, provider) {
        assertActor(ctx);
        const r = await this.pool.query('SELECT * FROM integration_connections WHERE provider = $1', [provider]);
        const row = r.rows[0];
        return row ? toConn(row) : null;
    }
}
