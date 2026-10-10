import { z } from 'zod';

export const JobStatus = z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']);
export type JobStatus = z.infer<typeof JobStatus>;

export const JobCreateSchema = z.object({
  draftId: z.string().uuid(),
  scheduledAt: z.string().datetime(),
});
export type JobCreateInput = z.infer<typeof JobCreateSchema>;

export const JobFinishSchema = z.object({
  status: z.enum(['succeeded', 'failed', 'cancelled']),
  errorMessage: z.string().max(2000).optional(),
});
export type JobFinishInput = z.infer<typeof JobFinishSchema>;

export interface PublishingJob {
  id: string;
  draftId: string;
  status: JobStatus;
  attempt: number;
  scheduledAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}
