import { z } from 'zod';
export const JobStatus = z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']);
export const JobCreateSchema = z.object({
    draftId: z.string().uuid(),
    scheduledAt: z.string().datetime(),
});
export const JobFinishSchema = z.object({
    status: z.enum(['succeeded', 'failed', 'cancelled']),
    errorMessage: z.string().max(2000).optional(),
});
