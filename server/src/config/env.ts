import { z } from 'zod';
import { ConfigurationError } from '../core/errors.js';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL الزامی است.'),
  /** حالت TLS اتصال به Postgres — مرجع: node-postgres.com/features/ssl
   *  auto: میزبان محلی بدون SSL؛ میزبان راه دور با تأیید گواهی کامل (rejectUnauthorized).
   *  require: TLS بدون تأیید گواهی (برای میزبان‌هایی با گواهی self-signed مانند Railway).
   *  verify-full: TLS با تأیید گواهی. disable: بدون TLS (فقط توسعه/تست). */
  DATABASE_SSL: z.enum(['auto', 'require', 'verify-full', 'disable']).default('auto'),
  /** پشت reverse proxy مقدار true تا req.ip از X-Forwarded-For خوانده شود — مرجع: fastify.dev/docs/latest/Reference/Server/#trustproxy */
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET باید حداقل ۳۲ نویسه باشد.'),
  OWNER_PASSWORD: z.string().min(10, 'OWNER_PASSWORD باید حداقل ۱۰ نویسه باشد.'),
  INSTAGRAM_APP_ID: z.string().min(1).optional(),
  INSTAGRAM_APP_SECRET: z.string().min(1).optional(),
  INSTAGRAM_REDIRECT_URI: z.string().min(1).optional(),
  // توکن تأیید webhook رسمی متا (hub.verify_token) — ۱ تا ۲۵۶ نویسه
  INSTAGRAM_WEBHOOK_VERIFY_TOKEN: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/, 'INSTAGRAM_WEBHOOK_VERIFY_TOKEN باید ۱ تا ۲۵۶ نویسه از A-Z a-z 0-9 _ - باشد.').optional(),
  // تازه‌سازی خودکار توکن بلندمدت (۶۰ روزه) — مرجع: developers.facebook.com/docs/instagram-platform/reference/refresh_access_token
  IG_TOKEN_REFRESH_INTERVAL_MS: z.coerce.number().int().min(60_000).max(604_800_000).default(6 * 60 * 60 * 1000),
  IG_TOKEN_REFRESH_MIN_TTL_MS: z.coerce.number().int().min(3_600_000).max(2_592_000_000).default(7 * 24 * 60 * 60 * 1000),
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
