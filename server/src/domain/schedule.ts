import { z } from 'zod';

export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type JobState = 'scheduled' | 'processing' | 'published' | 'failed' | 'cancelled';
export type AttemptOutcome = 'succeeded' | 'failed_permanent' | 'failed_transient';

export const TZ_MESSAGE = 'زمان باید ISO 8601 با منطقه زمانی صریح (Z یا ±HH:MM) باشد.';

/** فقط مهر زمانی آگاه از منطقه زمانی پذیرفته می‌شود تا ابهام زمان محلی رفع شود. */
const TzTimestamp = z
  .string()
  .min(1)
  .refine((v) => !Number.isNaN(Date.parse(v)) && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(v), TZ_MESSAGE);

export const ScheduleCreateSchema = z
  .object({
    draftId: z.string().uuid('شناسه پیش‌نویس معتبر نیست.'),
    scheduledAt: TzTimestamp,
    imageUrl: z
      .string().url('نشانی تصویر معتبر نیست.')
      .refine((v) => /^https?:\/\//i.test(v), 'نشانی تصویر باید http(s) باشد.'),
  })
  .strict();

export type ScheduleCreateInput = z.infer<typeof ScheduleCreateSchema>;

export const ScheduleRescheduleSchema = z
  .object({
    scheduledAt: TzTimestamp,
  })
  .strict();

export type ScheduleRescheduleInput = z.infer<typeof ScheduleRescheduleSchema>;

/** نگاشت وضعیت خام ذخیره‌شده به حالت جریان کار قابل فهم برای کاربر. */
export function jobState(status: JobStatus): JobState {
  switch (status) {
    case 'pending': return 'scheduled';
    case 'running': return 'processing';
    case 'succeeded': return 'published';
    default: return status;
  }
}

export interface PublishingJob {
  id: string;
  draftId: string;
  draftTitle: string;
  status: JobStatus;
  state: JobState;
  scheduledAt: string;
  nextRunAt: string | null;
  attempt: number;
  maxAttempts: number;
  imageUrl: string;
  containerId: string | null;
  publishedMediaId: string | null;
  providerConfirmed: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobAttempt {
  id: number;
  jobId: string;
  attempt: number;
  startedAt: string;
  finishedAt: string;
  outcome: AttemptOutcome;
  errorCode: string | null;
  errorMessage: string | null;
}