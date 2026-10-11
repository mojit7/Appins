import { z } from 'zod';

/** شکل خروجی مدل — اعتبارسنجی سخت سمت سرور، حتی اگر ارائه‌دهنده
 *  خروجی ساختاریافته پشتیبانی کند. پشتیبانی پاسخ ساختاریافته در همه
 *  ارائه‌دهندگان سازگار با OpenAI تضمین‌نشده است؛ بنابراین JSON در پرامپت
 *  + اعتبارسنجی کامل سمت سرور به کار رفت. */

export const CaptionOptionSchema = z.object({
  caption: z.string().min(1, 'کپشن نمی‌تواند خالی باشد.').max(2200, 'کپشن بلندتر از ۲۲۰۰ نویسه است.'),
  factsUsed: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  suggestions: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
});

export type CaptionOption = z.infer<typeof CaptionOptionSchema>;

export const CaptionResultSchema = z.object({
  options: z.array(CaptionOptionSchema).min(1, 'حداقل یک گزینه لازم است.').max(3, 'حداکثر ۳ گزینه مجاز است.'),
});

export type CaptionResult = z.infer<typeof CaptionResultSchema>;
