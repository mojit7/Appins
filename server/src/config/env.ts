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
  // ارائه‌دهنده هوش مصنوعی — سازگار با OpenAI Chat Completions (OpenRouter، NVIDIA NIM و مشابه)
  AI_PROVIDER_API_KEY: z.string().min(1).optional(),
  AI_PROVIDER_BASE_URL: z.string().url('AI_PROVIDER_BASE_URL باید نشانی معتبر باشد (مثلاً https://openrouter.ai/api/v1).').optional(),
  AI_PROVIDER_MODEL: z.string().min(1).optional(),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(25000),
});

export type Env = z.infer<typeof EnvSchema>;

/** پیکربندی را از منبع (پیش‌فرض: process.env) می‌خواند و اعتبارسنجی می‌کند. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message);
    throw new ConfigurationError('پیکربندی محیط نامعتبر است.', issues);
  }
  return parsed.data;
}
