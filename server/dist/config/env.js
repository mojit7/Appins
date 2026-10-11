import { z } from 'zod';
import { ConfigurationError } from '../core/errors.js';
const EnvSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL الزامی است.'),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET باید حداقل ۳۲ نویسه باشد.'),
    OWNER_PASSWORD: z.string().min(10, 'OWNER_PASSWORD باید حداقل ۱۰ نویسه باشد.'),
    INSTAGRAM_APP_ID: z.string().min(1).optional(),
    INSTAGRAM_APP_SECRET: z.string().min(1).optional(),
    INSTAGRAM_REDIRECT_URI: z.string().min(1).optional(),
    TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
    // ربات دستیار مالک — هر سه مقدار باید هم‌زمان تنظیم شوند تا ماژول فعال شود
    TELEGRAM_OWNER_ID: z.string().regex(/^\d+$/, 'TELEGRAM_OWNER_ID باید شناسه عددی چت مالک باشد.').optional(),
    // سرّ webhook رسمی تلگرام: ۱ تا ۲۵۶ نویسه از A-Z a-z 0-9 _ -
    TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/, 'TELEGRAM_WEBHOOK_SECRET باید ۱ تا ۲۵۶ نویسه از A-Z a-z 0-9 _ - باشد.').optional(),
    // ارائه‌دهنده هوش مصنوعی — سازگار با OpenAI Chat Completions (OpenRouter، NVIDIA NIM و مشابه)
    AI_PROVIDER_API_KEY: z.string().min(1).optional(),
    AI_PROVIDER_BASE_URL: z.string().url('AI_PROVIDER_BASE_URL باید نشانی معتبر باشد (مثلاً https://openrouter.ai/api/v1).').optional(),
    AI_PROVIDER_MODEL: z.string().min(1).optional(),
    AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(25000),
    // زمان‌بند انتشار — نظرسنجی درون‌فرآیندی روی مخزن ماندگار Postgres
    SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(1000).max(600000).default(30000),
    SCHEDULE_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    SCHEDULE_RETRY_BASE_MS: z.coerce.number().int().min(100).max(3600000).default(60000),
});
/** پیکربندی را از منبع (پیش‌فرض: process.env) می‌خواند و اعتبارسنجی می‌کند. */
export function loadEnv(source = process.env) {
    const parsed = EnvSchema.safeParse(source);
    if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message);
        throw new ConfigurationError('پیکربندی محیط نامعتبر است.', issues);
    }
    return parsed.data;
}
