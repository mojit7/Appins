import { z } from 'zod';
export const DraftStatus = z.enum(['draft', 'ready', 'scheduled']);
export const DraftCreateSchema = z
    .object({
    title: z.string().trim().min(1, 'عنوان الزامی است.').max(300),
    caption: z.string().max(2200).default(''),
    productId: z.string().uuid().nullable().default(null),
    status: DraftStatus.default('draft'),
    scheduledAt: z.string().datetime().nullable().default(null),
})
    .refine((d) => d.status !== 'scheduled' || d.scheduledAt !== null, {
    message: 'پیش‌نویس زمان‌بندی‌شده باید زمان انتشار داشته باشد.',
});
export const DraftUpdateSchema = z
    .object({
    title: z.string().trim().min(1, 'عنوان نمی‌تواند خالی باشد.').max(300).optional(),
    caption: z.string().max(2200).optional(),
    productId: z.string().uuid().nullable().optional(),
    status: DraftStatus.optional(),
    scheduledAt: z.string().datetime().nullable().optional(),
})
    .strict()
    .refine((d) => d.status !== 'scheduled' || d.scheduledAt !== null, {
    message: 'پیش‌نویس زمان‌بندی‌شده باید زمان انتشار داشته باشد.',
});
