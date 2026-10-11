import { ConflictError, NotFoundError } from '../core/errors.js';
import { jobState } from '../domain/schedule.js';
import { clampPage } from '../domain/product.js';
import { assertActor } from './context.js';
function toJob(r) {
    return {
        id: r.id,
        draftId: r.draft_id,
        draftTitle: r.draft_title ?? '',
        status: r.status,
        state: jobState(r.status),
        scheduledAt: r.scheduled_at.toISOString(),
        nextRunAt: r.next_run_at ? r.next_run_at.toISOString() : null,
        attempt: r.attempt,
        maxAttempts: r.max_attempts,
        imageUrl: r.image_url,
        containerId: r.container_id,
        publishedMediaId: r.published_media_id,
        providerConfirmed: r.provider_confirmed,
        errorCode: r.error_code,
        errorMessage: r.error_message,
        startedAt: r.started_at ? r.started_at.toISOString() : null,
        finishedAt: r.finished_at ? r.finished_at.toISOString() : null,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
    };
}
const SELECT_JOB = 'SELECT j.*, d.title AS draft_title FROM publishing_jobs j JOIN content_drafts d ON d.id = j.draft_id';
const DUMMY_TITLE = ', NULL AS draft_title';
export class PublishingJobRepository {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    /** ایجاد کار + نشانه‌گذاری پیش‌نویس به‌صورت اتمیک؛ تنها یک کار فعال برای هر پیش‌نویس. */
    async create(ctx, input) {
        assertActor(ctx);
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const active = await client.query("SELECT id FROM publishing_jobs WHERE draft_id = $1 AND status IN ('pending','running') FOR UPDATE", [input.draftId]);
            if (active.rows.length > 0) {
                throw new ConflictError('برای این پیش‌نویس کار زمان‌بندی فعال وجود دارد.');
            }
            const draft = await client.query('SELECT title FROM content_drafts WHERE id = $1', [input.draftId]);
            const draftRow = draft.rows[0];
            if (!draftRow)
                throw new NotFoundError('پیش‌نویس یافت نشد.');
            const insertSql = "INSERT INTO publishing_jobs (draft_id, status, attempt, scheduled_at, image_url, max_attempts, next_run_at) VALUES ($1,'pending',0,$2,$3,$4,$2) RETURNING *" + DUMMY_TITLE;
            const r = await client.query(insertSql, [input.draftId, input.scheduledAt, input.imageUrl, input.maxAttempts]);
            const row = r.rows[0];
            if (!row)
                throw new Error('درج کار زمان‌بندی نتیجه‌ای برنگرداند.');
            await client.query("UPDATE content_drafts SET status = 'scheduled', scheduled_at = $2, updated_at = now() WHERE id = $1", [input.draftId, input.scheduledAt]);
            await client.query('COMMIT');
            row.draft_title = draftRow.title;
            return toJob(row);
        }
        catch (err) {
            try {
                await client.query('ROLLBACK');
            }
            catch { /* تراکنش پیش‌تر بسته شده است */ }
            throw err;
        }
        finally {
            client.release();
        }
    }
    async get(ctx, id) {
        assertActor(ctx);
        const r = await this.pool.query(SELECT_JOB + ' WHERE j.id = $1', [id]);
        const row = r.rows[0];
        if (!row)
            throw new NotFoundError('کار زمان‌بندی یافت نشد.');
        return toJob(row);
    }
    async list(ctx, page = 1, pageSize = 20, status) {
        assertActor(ctx);
        const { page: p, pageSize: ps } = clampPage(page, pageSize);
        const where = status !== undefined ? ' WHERE j.status = $3' : '';
        const args = status !== undefined ? [ps, (p - 1) * ps, status] : [ps, (p - 1) * ps];
        const totalRow = await this.pool.query(status !== undefined ? 'SELECT count(*)::int AS c FROM publishing_jobs WHERE status = $1' : 'SELECT count(*)::int AS c FROM publishing_jobs', status !== undefined ? [status] : []);
        const total = totalRow.rows[0]?.c ?? 0;
        const r = await this.pool.query(SELECT_JOB + where + ' ORDER BY j.scheduled_at DESC, j.id LIMIT $1 OFFSET $2', args);
        return { items: r.rows.map(toJob), total, page: p, pageSize: ps };
    }
    /** لغو — فقط کار در صف؛ کار در حال اجرا از این مسیر قابل لغو نیست. */
    async cancel(ctx, id) {
        assertActor(ctx);
        const sql = "UPDATE publishing_jobs SET status = 'cancelled', finished_at = now(), next_run_at = NULL, updated_at = now() WHERE id = $1 AND status = 'pending' RETURNING *" + DUMMY_TITLE;
        const r = await this.pool.query(sql, [id]);
        const row = r.rows[0];
        if (!row) {
            const existing = await this.get(ctx, id);
            throw new ConflictError('فقط کار در صف (pending) قابل لغو است؛ وضعیت فعلی: ' + existing.status);
        }
        await this.pool.query("UPDATE content_drafts SET status = 'ready', scheduled_at = NULL, updated_at = now() WHERE id = $1", [row.draft_id]);
        return this.get(ctx, id);
    }
    /** زمان‌بندی مجدد — فقط کار در صف. */
    async reschedule(ctx, id, scheduledAt) {
        assertActor(ctx);
        const sql = "UPDATE publishing_jobs SET scheduled_at = $2, next_run_at = $2, updated_at = now() WHERE id = $1 AND status = 'pending' RETURNING *" + DUMMY_TITLE;
        const r = await this.pool.query(sql, [id, scheduledAt]);
        const row = r.rows[0];
        if (!row) {
            const existing = await this.get(ctx, id);
            throw new ConflictError('فقط کار در صف (pending) قابل زمان‌بندی مجدد است؛ وضعیت فعلی: ' + existing.status);
        }
        await this.pool.query('UPDATE content_drafts SET scheduled_at = $2, updated_at = now() WHERE id = $1', [row.draft_id, scheduledAt]);
        return this.get(ctx, id);
    }
    /** بازیابی دستی کار ناموفق — شمارش تلاش صفر می‌شود تا سقف تلاش تازه داشته باشد. */
    async retry(ctx, id) {
        assertActor(ctx);
        const sql = "UPDATE publishing_jobs SET status = 'pending', attempt = 0, next_run_at = now(), started_at = NULL, finished_at = NULL, error_code = NULL, error_message = NULL, container_id = NULL, updated_at = now() WHERE id = $1 AND status = 'failed' RETURNING *" + DUMMY_TITLE;
        const r = await this.pool.query(sql, [id]);
        const row = r.rows[0];
        if (!row) {
            const existing = await this.get(ctx, id);
            throw new ConflictError('فقط کار ناموفق (failed) قابل بازیابی است؛ وضعیت فعلی: ' + existing.status);
        }
        return this.get(ctx, id);
    }
    /** برداشت اتمیک سررسیدِ کار بعدی؛ SKIP LOCKED از برداشت هم‌زمان جلوگیری می‌کند. */
    async claimNextDue(excludeIds = []) {
        const sql = "UPDATE publishing_jobs SET status = 'running', attempt = attempt + 1, started_at = now(), updated_at = now() WHERE id = (SELECT id FROM publishing_jobs WHERE status = 'pending' AND next_run_at <= now() AND NOT (id = ANY($1::uuid[])) ORDER BY next_run_at, id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *" + DUMMY_TITLE;
        const r = await this.pool.query(sql, [excludeIds]);
        const row = r.rows[0];
        return row ? toJob(row) : null;
    }
    async getDraftCaption(draftId) {
        const r = await this.pool.query('SELECT caption FROM content_drafts WHERE id = $1', [draftId]);
        const row = r.rows[0];
        if (!row)
            throw new NotFoundError('پیش‌نویس کار زمان‌بندی یافت نشد.');
        return row.caption;
    }
    async saveContainerId(jobId, containerId) {
        await this.pool.query('UPDATE publishing_jobs SET container_id = $2, updated_at = now() WHERE id = $1', [jobId, containerId]);
    }
    async markSucceeded(jobId, containerId, publishedMediaId) {
        const sql = "UPDATE publishing_jobs SET status = 'succeeded', container_id = $2, published_media_id = $3, provider_confirmed = true, finished_at = now(), next_run_at = NULL, error_code = NULL, error_message = NULL, updated_at = now() WHERE id = $1";
        await this.pool.query(sql, [jobId, containerId, publishedMediaId]);
    }
    async markFailed(jobId, code, message) {
        const sql = "UPDATE publishing_jobs SET status = 'failed', finished_at = now(), next_run_at = NULL, error_code = $2, error_message = $3, updated_at = now() WHERE id = $1";
        await this.pool.query(sql, [jobId, code, message.slice(0, 2000)]);
    }
    /** شکست گذرا: تا سقف تلاش با عقب‌نشینی نمایی به صف برمی‌گردد؛ پس از سقف، ناموفق نهایی. */
    async retryOrFail(jobId, backoffMs, code, message) {
        const sql = "UPDATE publishing_jobs SET status = CASE WHEN attempt >= max_attempts THEN 'failed' ELSE 'pending' END, next_run_at = CASE WHEN attempt >= max_attempts THEN NULL ELSE now() + ($2::text || ' milliseconds')::interval END, finished_at = CASE WHEN attempt >= max_attempts THEN now() ELSE NULL END, error_code = $3, error_message = $4, updated_at = now() WHERE id = $1 RETURNING status";
        const r = await this.pool.query(sql, [jobId, backoffMs, code, message.slice(0, 2000)]);
        const row = r.rows[0];
        if (!row)
            throw new Error('به‌روزرسانی کار ناموفق نتیجه‌ای برنگرداند.');
        return row.status;
    }
    async recordAttempt(jobId, attempt, startedAt, finishedAt, outcome, errorCode, errorMessage) {
        await this.pool.query('INSERT INTO publishing_job_attempts (job_id, attempt, started_at, finished_at, outcome, error_code, error_message) VALUES ($1,$2,$3,$4,$5,$6,$7)', [jobId, attempt, startedAt, finishedAt, outcome, errorCode, errorMessage ? errorMessage.slice(0, 2000) : null]);
    }
    async listAttempts(jobId) {
        const r = await this.pool.query('SELECT attempt, started_at, finished_at, outcome, error_code, error_message FROM publishing_job_attempts WHERE job_id = $1 ORDER BY attempt', [jobId]);
        return r.rows.map((row) => ({
            attempt: row.attempt,
            startedAt: row.started_at.toISOString(),
            finishedAt: row.finished_at.toISOString(),
            outcome: row.outcome,
            errorCode: row.error_code,
            errorMessage: row.error_message,
        }));
    }
    /** بازگرداندن کارهای گیرکرده در running (مثلاً پس از توقف فرآیند) به صف. */
    async requeueStale(staleMs) {
        const sql = "UPDATE publishing_jobs SET status = 'pending', next_run_at = now(), updated_at = now() WHERE status = 'running' AND started_at < now() - ($1::text || ' milliseconds')::interval RETURNING id";
        const r = await this.pool.query(sql, [staleMs]);
        return r.rows.map((row) => row.id);
    }
}
