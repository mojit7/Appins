import { z } from 'zod';
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
export const ScheduleRescheduleSchema = z
    .object({
    scheduledAt: TzTimestamp,
})
    .strict();
/** نگاشت وضعیت خام ذخیره‌شده به حالت جریان کار قابل فهم برای کاربر. */
export function jobState(status) {
    switch (status) {
        case 'pending': return 'scheduled';
        case 'running': return 'processing';
        case 'succeeded': return 'published';
        default: return status;
    }
}
