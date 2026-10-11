import { ValidationError } from '../core/errors.js';
import { LogAppendSchema } from '../domain/operationalLog.js';
import { assertActor } from './context.js';
import { withDbErrors } from '../db/errors.js';
function toLog(r) {
    return { id: r.id, level: r.level, event: r.event, payload: r.payload, createdAt: r.created_at.toISOString() };
}
/** لاگ عملیاتی فقط-افزودنی؛ متد حذف وجود ندارد (قاعده نگه‌داری). */
export class OperationalLogRepository {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async append(ctx, raw) {
        assertActor(ctx);
        const parsed = LogAppendSchema.safeParse(raw);
        if (!parsed.success) {
            throw new ValidationError('رکورد لاگ نامعتبر است.', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
        }
        const l = parsed.data;
        return withDbErrors(async () => {
            const r = await this.pool.query('INSERT INTO operational_logs (level, event, payload) VALUES ($1,$2,$3::jsonb) RETURNING *', [l.level, l.event, JSON.stringify(l.payload)]);
            const row = r.rows[0];
            if (!row)
                throw new Error('درج لاگ نتیجه‌ای برنگرداند.');
            return toLog(row);
        });
    }
    async recent(ctx, limit = 50) {
        assertActor(ctx);
        const l = Math.min(200, Math.max(1, Math.floor(limit)));
        const r = await this.pool.query('SELECT * FROM operational_logs ORDER BY id DESC LIMIT $1', [l]);
        return r.rows.map(toLog);
    }
}
