import type { Pool } from 'pg';
import { NotFoundError, ValidationError } from '../core/errors.js';
import { JobCreateSchema, JobFinishSchema, type JobCreateInput, type JobFinishInput, type PublishingJob } from '../domain/publishingJob.js';
import { clampPage, type Page } from '../domain/product.js';
import { assertActor, type ActorContext } from './context.js';
import { withDbErrors } from '../db/errors.js';

interface JobRow {
  id: string;
  draft_id: string;
  status: PublishingJob['status'];
  attempt: number;
  scheduled_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  error_message: string | null;
  created_at: Date;
}

function toJob(r: JobRow): PublishingJob {
  return {
    id: r.id,
    draftId: r.draft_id,
    status: r.status,
    attempt: r.attempt,
    scheduledAt: r.scheduled_at.toISOString(),
    startedAt: r.started_at ? r.started_at.toISOString() : null,
    finishedAt: r.finished_at ? r.finished_at.toISOString() : null,
    errorMessage: r.error_message,
    createdAt: r.created_at.toISOString(),
  };
}

export class PublishingJobRepository {
  constructor(private readonly pool: Pool) {}

  async create(ctx: ActorContext | null | undefined, raw: unknown): Promise<PublishingJob> {
    assertActor(ctx);
    const parsed = JobCreateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError('کار انتشار نامعتبر است.', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
    }
    const j: JobCreateInput = parsed.data;
    return withDbErrors(async () => {
      // پیش‌نویس باید موجود باشد؛ یکتایی برای هر پیش‌نویس فقط یک کار فعال اجباری نیست (تلاش مجدد ممکن است).
      const draft = await this.pool.query('SELECT id FROM content_drafts WHERE id = $1', [j.draftId]);
      if (draft.rows.length === 0) throw new NotFoundError('پیش‌نویس مربوطه یافت نشد.');
      const r = await this.pool.query<JobRow>(
        'INSERT INTO publishing_jobs (draft_id, scheduled_at) VALUES ($1,$2) RETURNING *',
        [j.draftId, j.scheduledAt],
      );
      const row = r.rows[0];
      if (!row) throw new Error('درج کار انتشار نتیجه‌ای برنگرداند.');
      return toJob(row);
    });
  }

  async markStarted(ctx: ActorContext | null | undefined, id: string): Promise<PublishingJob> {
    assertActor(ctx);
    return withDbErrors(async () => {
      const r = await this.pool.query<JobRow>(
        "UPDATE publishing_jobs SET status = 'running', started_at = now(), attempt = attempt + 1 WHERE id = $1 RETURNING *",
        [id],
      );
      const row = r.rows[0];
      if (!row) throw new NotFoundError('کار انتشار یافت نشد.');
      return toJob(row);
    });
  }

  async markFinished(ctx: ActorContext | null | undefined, id: string, raw: unknown): Promise<PublishingJob> {
    assertActor(ctx);
    const parsed = JobFinishSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError('نتیجه کار انتشار نامعتبر است.', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
    }
    const f: JobFinishInput = parsed.data;
    return withDbErrors(async () => {
      const r = await this.pool.query<JobRow>(
        'UPDATE publishing_jobs SET status = $1, finished_at = now(), error_message = $2 WHERE id = $3 RETURNING *',
        [f.status, f.errorMessage ?? null, id],
      );
      const row = r.rows[0];
      if (!row) throw new NotFoundError('کار انتشار یافت نشد.');
      return toJob(row);
    });
  }

  /** کارهای در انتظارِ سررسیده — برای زمان‌بند مرحله ۸. */
  async listDue(ctx: ActorContext | null | undefined, limit = 10): Promise<PublishingJob[]> {
    assertActor(ctx);
    const l = Math.min(100, Math.max(1, Math.floor(limit)));
    const r = await this.pool.query<JobRow>(
      "SELECT * FROM publishing_jobs WHERE status = 'pending' AND scheduled_at <= now() ORDER BY scheduled_at LIMIT $1",
      [l],
    );
    return r.rows.map(toJob);
  }

  async list(ctx: ActorContext | null | undefined, page = 1, pageSize = 20): Promise<Page<PublishingJob>> {
    assertActor(ctx);
    const { page: p, pageSize: ps } = clampPage(page, pageSize);
    const total = (await this.pool.query<{ c: number }>('SELECT count(*)::int AS c FROM publishing_jobs')).rows[0]?.c ?? 0;
    const r = await this.pool.query<JobRow>(
      'SELECT * FROM publishing_jobs ORDER BY created_at DESC, id LIMIT $1 OFFSET $2',
      [ps, (p - 1) * ps],
    );
    return { items: r.rows.map(toJob), total, page: p, pageSize: ps };
  }
}
