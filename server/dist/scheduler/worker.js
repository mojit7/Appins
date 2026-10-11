import { AppError, ConflictError } from '../core/errors.js';
import { OWNER } from '../data/context.js';
import { IntegrationConnectionRepository } from '../data/connections.js';
import { InstagramCredentialRepository } from '../data/instagramCredentials.js';
import { PublishingJobRepository } from '../data/publishingJobs.js';
import { createImageContainer, getContainerStatus, publishContainer } from '../integrations/instagram/client.js';
/** کدهای خطای دائمی — تلاش مجدد بی‌فایده یا نیازمند اقدام انسانی است. */
const PERMANENT_CODES = new Set(['INSTAGRAM_REAUTH_REQUIRED', 'PERMISSION_DENIED', 'INSTAGRAM_PUBLISH_FAILED']);
function classify(err) {
    if (err instanceof AppError) {
        const permanent = PERMANENT_CODES.has(err.code)
            || err.statusCode === 401
            || err.statusCode === 403
            || err.statusCode === 409
            || err.statusCode === 422;
        return { kind: permanent ? 'permanent' : 'transient', code: err.code, message: err.message };
    }
    return { kind: 'transient', code: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : String(err) };
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
const globalFetch = globalThis.fetch;
function defaultFetcher() {
    return (url, init) => {
        const res = globalFetch(url, init);
        return res.then((r) => ({ ok: r.ok, status: r.status, json: () => r.json() }));
    };
}
export class PublishingWorker {
    intervalMs;
    fetcher;
    backoffBaseMs;
    pollAttempts;
    pollDelayMs;
    staleMs;
    onOutcome;
    repo;
    creds;
    conns;
    timer = null;
    ticking = false;
    constructor(deps, options = {}) {
        const { env, pool } = deps;
        this.repo = new PublishingJobRepository(pool);
        this.creds = new InstagramCredentialRepository(pool, env.SESSION_SECRET);
        this.conns = new IntegrationConnectionRepository(pool);
        this.fetcher = deps.fetcher ?? defaultFetcher();
        this.intervalMs = options.intervalMs ?? env.SCHEDULER_INTERVAL_MS;
        this.backoffBaseMs = options.backoffBaseMs ?? env.SCHEDULE_RETRY_BASE_MS;
        this.pollAttempts = options.pollAttempts ?? 3;
        this.pollDelayMs = options.pollDelayMs ?? 1000;
        this.staleMs = options.staleMs ?? 10 * 60 * 1000;
        this.onOutcome = options.onOutcome;
    }
    /** یک گذر: همه کارهای سررسیده را تا تهِ صف پردازش می‌کند؛ هر کار حداکثر یک‌بار در هر گذر
     *  اجرا می‌شود (کارِ تلاش‌مجددشده با عقب‌نشینی کوتاه تا گذر بعدی صبر می‌کند)؛ خروجی = تعداد کارهای اجراشده. */
    async tick() {
        let count = 0;
        const processed = new Set();
        for (;;) {
            const job = await this.repo.claimNextDue([...processed]);
            if (job === null)
                break;
            processed.add(job.id);
            count += 1;
            await this.runJob(job);
        }
        return count;
    }
    async runJob(job) {
        const startedAt = new Date();
        try {
            const cred = await this.creds.get(OWNER);
            if (cred === null) {
                throw new ConflictError('اینستاگرام متصل نیست؛ ابتدا اتصال را انجام دهید.');
            }
            if (new Date(cred.expiresAt).getTime() <= Date.now()) {
                throw new AppError('توکن اینستاگرام منقضی شده است؛ اتصال مجدد لازم است.', 'INSTAGRAM_REAUTH_REQUIRED', 401);
            }
            if (!cred.permissions.includes('instagram_business_content_publish')) {
                throw new AppError('مجوز instagram_business_content_publish اعطا نشده است؛ اتصال مجدد با مجوز کامل لازم است.', 'PERMISSION_DENIED', 403);
            }
            const conn = await this.conns.get(OWNER, 'instagram');
            const igId = conn?.accountRef;
            if (!igId) {
                throw new ConflictError('شناسه حساب اینستاگرام در وضعیت اتصال موجود نیست؛ اتصال را از نو انجام دهید.');
            }
            const caption = await this.repo.getDraftCaption(job.draftId);
            let containerId = job.containerId;
            if (containerId === null) {
                containerId = await createImageContainer(igId, cred.token, { imageUrl: job.imageUrl, caption }, this.fetcher);
                await this.repo.saveContainerId(job.id, containerId);
            }
            let ready = false;
            for (let i = 0; i < this.pollAttempts; i++) {
                const status = await getContainerStatus(containerId, cred.token, this.fetcher);
                if (status === 'FINISHED') {
                    ready = true;
                    break;
                }
                if (status === 'ERROR') {
                    throw new AppError('ظرف رسانه با خطا مواجه شد؛ انتشار انجام نشد.', 'INSTAGRAM_PUBLISH_FAILED', 502);
                }
                if (i < this.pollAttempts - 1)
                    await sleep(this.pollDelayMs);
            }
            if (!ready) {
                throw new AppError('ظرف رسانه در زمان انتظار آماده نشد؛ تلاش بعدی ظرف را بازبینی می‌کند.', 'INSTAGRAM_PUBLISH_TIMEOUT', 502, { containerId });
            }
            const mediaId = await publishContainer(igId, cred.token, containerId, this.fetcher);
            await this.repo.markSucceeded(job.id, containerId, mediaId);
            await this.repo.recordAttempt(job.id, job.attempt, startedAt, new Date(), 'succeeded', null, null);
            await this.notifyOutcome(job, 'succeeded', { mediaId });
        }
        catch (err) {
            const { kind, code, message } = classify(err);
            const finishedAt = new Date();
            if (kind === 'permanent') {
                await this.repo.markFailed(job.id, code, message);
                await this.repo.recordAttempt(job.id, job.attempt, startedAt, finishedAt, 'failed_permanent', code, message);
                await this.notifyOutcome(job, 'failed_permanent', { code, message });
            }
            else {
                const backoffMs = this.backoffBaseMs * Math.pow(2, job.attempt - 1);
                await this.repo.retryOrFail(job.id, backoffMs, code, message);
                await this.repo.recordAttempt(job.id, job.attempt, startedAt, finishedAt, 'failed_transient', code, message);
                await this.notifyOutcome(job, 'failed_transient', { code, message });
            }
        }
    }
    /** اعلان نتیجه به بیرون — شکست اعلان هرگز سرنوشت کار را عوض نمی‌کند. */
    async notifyOutcome(job, outcome, detail) {
        if (!this.onOutcome)
            return;
        try {
            await this.onOutcome(job, outcome, detail);
        }
        catch { /* اعلان نباید جریان کار را مختل کند */ }
    }
    /** شروع نظرسنجی دوره‌ای؛ کارهای گیرکرده در running به صف بازمی‌گردند. */
    start() {
        if (this.timer !== null)
            return;
        void this.repo.requeueStale(this.staleMs).catch(() => { });
        this.timer = setInterval(() => {
            if (this.ticking)
                return;
            this.ticking = true;
            this.tick().catch(() => { }).finally(() => { this.ticking = false; });
        }, this.intervalMs);
    }
    stop() {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
}
export function createPublishingWorker(deps, options = {}) {
    return new PublishingWorker(deps, options);
}
