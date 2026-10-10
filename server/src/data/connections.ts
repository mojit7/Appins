import type { Pool } from 'pg';
import { ValidationError } from '../core/errors.js';
import { ConnectionUpsertSchema, type IntegrationConnection } from '../domain/connection.js';
import { assertActor, type ActorContext } from './context.js';
import { withDbErrors } from '../db/errors.js';

interface ConnRow {
  id: string;
  provider: IntegrationConnection['provider'];
  status: IntegrationConnection['status'];
  account_ref: string | null;
  connected_at: Date | null;
  updated_at: Date;
}

function toConn(r: ConnRow): IntegrationConnection {
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
  constructor(private readonly pool: Pool) {}

  async upsert(ctx: ActorContext | null | undefined, raw: unknown): Promise<IntegrationConnection> {
    assertActor(ctx);
    const parsed = ConnectionUpsertSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError('فراداده اتصال نامعتبر است.', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
    }
    const c = parsed.data;
    return withDbErrors(async () => {
      const r = await this.pool.query<ConnRow>(
        `INSERT INTO integration_connections (provider, status, account_ref, connected_at, updated_at)
         VALUES ($1,$2,$3, CASE WHEN $2 = 'connected' THEN now() ELSE NULL END, now())
         ON CONFLICT (provider) DO UPDATE SET
           status = EXCLUDED.status,
           account_ref = EXCLUDED.account_ref,
           connected_at = CASE WHEN EXCLUDED.status = 'connected' THEN now() ELSE NULL END,
           updated_at = now()
         RETURNING *`,
        [c.provider, c.status, c.accountRef],
      );
      const row = r.rows[0];
      if (!row) throw new Error('ثبت اتصال نتیجه‌ای برنگرداند.');
      return toConn(row);
    });
  }

  async get(ctx: ActorContext | null | undefined, provider: IntegrationConnection['provider']): Promise<IntegrationConnection | null> {
    assertActor(ctx);
    const r = await this.pool.query<ConnRow>('SELECT * FROM integration_connections WHERE provider = $1', [provider]);
    const row = r.rows[0];
    return row ? toConn(row) : null;
  }
}
