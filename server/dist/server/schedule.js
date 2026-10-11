import { AppError, ValidationError } from '../core/errors.js';
import { OWNER } from '../data/context.js';
import { PublishingJobRepository } from '../data/publishingJobs.js';
import { ScheduleCreateSchema, ScheduleRescheduleSchema } from '../domain/schedule.js';
const JOB_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'cancelled'];
const STUB_ROUTES = [
    { method: 'GET', url: '/schedule/jobs' },
    { method: 'POST', url: '/schedule/jobs' },
    { method: 'GET', url: '/schedule/jobs/:id' },
    { method: 'POST', url: '/schedule/jobs/:id/cancel' },
    { method: 'POST', url: '/schedule/jobs/:id/reschedule' },
    { method: 'POST', url: '/schedule/jobs/:id/retry' },
];
export function registerScheduleRoutes(app, deps) {
    if (!deps) {
        for (const r of STUB_ROUTES) {
            app.route({
                method: r.method,
                url: r.url,
                handler: async () => {
                    throw new AppError('ماژول زمان‌بندی در این فرآیند فعال نیست.', 'CONTENT_MODULE_NOT_CONFIGURED', 503);
                },
            });
        }
        return;
    }
    const { env, pool } = deps;
    const repo = new PublishingJobRepository(pool);
    app.post('/schedule/jobs', async (req) => {
        const parsed = ScheduleCreateSchema.safeParse(req.body);
        if (!parsed.success) {
            throw new ValidationError('درخواست زمان‌بندی نامعتبر است.', parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message));
        }
        const b = parsed.data;
        return repo.create(OWNER, {
            draftId: b.draftId,
            scheduledAt: new Date(b.scheduledAt),
            imageUrl: b.imageUrl,
            maxAttempts: env.SCHEDULE_MAX_ATTEMPTS,
        });
    });
    app.get('/schedule/jobs', async (req) => {
        const page = typeof req.query.page === 'number' ? req.query.page : 1;
        const pageSize = typeof req.query.pageSize === 'number' ? req.query.pageSize : 20;
        const rawStatus = req.query.status;
        if (rawStatus !== undefined && !JOB_STATUSES.includes(rawStatus)) {
            throw new ValidationError('وضعیت فیلتر نامعتبر است.');
        }
        const status = rawStatus === undefined ? undefined : rawStatus;
        return repo.list(OWNER, page, pageSize, status);
    });
    app.get('/schedule/jobs/:id', async (req) => {
        const job = await repo.get(OWNER, req.params.id);
        const attempts = await repo.listAttempts(job.id);
        return { ...job, attempts };
    });
    app.post('/schedule/jobs/:id/cancel', async (req) => {
        return repo.cancel(OWNER, req.params.id);
    });
    app.post('/schedule/jobs/:id/reschedule', async (req) => {
        const parsed = ScheduleRescheduleSchema.safeParse(req.body);
        if (!parsed.success) {
            throw new ValidationError('درخواست زمان‌بندی مجدد نامعتبر است.', parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message));
        }
        return repo.reschedule(OWNER, req.params.id, new Date(parsed.data.scheduledAt));
    });
    app.post('/schedule/jobs/:id/retry', async (req) => {
        return repo.retry(OWNER, req.params.id);
    });
}
