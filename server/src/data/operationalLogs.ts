import type { Pool } from 'pg';
import { ValidationError } from '../core/errors.js';
import { LogAppendSchema, type LogAppendInput, type LogLevel, type OperationalLog } from '../domain/operationalLog.js';
import { assertActor, type ActorContext } from './context.js';
import { withDbErrors } from '../db/errors.js';

interface LogRow {
  id: number;
  level: LogLevel;
  event: string;
  payload: Record<string, unknown>;
  created_at: Date;
}

function toLog(r: LogRow): OperationalLog {
  return { id: r.id, level: r.level, event: r.event, payload: r.payload, createdAt: r.created_at.toISOString() };
}

/** لاگ عملیاتی فقط-افزودنی؛ متد حذف وجود ندارد (قاعده نگه‌داری). */
export class OperationalLogRepository {
  constructor(private readonly pool: Pool) {}

  async append(ctx: ActorContext | null | undefined, raw: unknown): Promise<OperationalLog> {
    assertActor(ctx);
    const parsed = LogAppendSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError('رکورد لاگ نامعتبر است.', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
    }
    const l: LogAppendInput = parsed.data;
    return withDbErrors(async () => {
      const r = await this.pool.query<LogRow>(
        'INSERT INTO operational_logs (level, event, payload) VALUES ($1,$2,$3::jsonb) RETURNING *',
        [l.level, l.event, JSON.stringify(l.payload)],
      );
      const row = r.rows[0];
      if (!row) throw new Error('درج لاگ نتیجه‌ای برنگرداند.');
      return toLog(row);
    });
  }

  async recent(ctx: ActorContext | null | undefined, limit = 50): Promise<OperationalLog[]> {
    assertActor(ctx);
    const l = Math.min(200, Math.max(1, Math.floor(limit)));
    const r = await this.pool.query<LogRow>('SELECT * FROM operational_logs ORDER BY id DESC LIMIT $1', [l]);
    return r.rows.map(toLog);
  }
}
