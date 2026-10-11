import { AppError } from '../../core/errors.js';
import type { ChatMessage } from './prompt.js';

/** کلاینت چت سازگار با OpenAI Chat Completions — بر پایه مستندات رسمی:
 *  OpenRouter: POST https://openrouter.ai/api/v1/chat/completions (احراز Bearer)
 *  NVIDIA NIM:  POST https://integrate.api.nvidia.com/v1/chat/completions (احراز Bearer)
 *  هر سرویس سازگار دیگر با پیکربندی نشانی پایه. کلید فقط سمت سرور است. */

export interface AiProviderConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<FetchResponse>;

export interface ChatCompletion {
  content: string;
  finishReason: string | null;
}

function aiError(message: string, code: string, statusCode: number): AppError {
  return new AppError(message, code, statusCode);
}

/** درخواست چت با مدیریت مشخص خطاها: وقفه، محدودیت نرخ، خطای احراز، خطای ارائه‌دهنده. */
export async function requestChatCompletion(
  cfg: AiProviderConfig,
  messages: ChatMessage[],
  fetcher: FetchLike,
): Promise<ChatCompletion> {
  const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const payload = JSON.stringify({ model: cfg.model, messages, temperature: 0.7 });

  let res: FetchResponse;
  try {
    res = await Promise.race([
      fetcher(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + cfg.apiKey,
        },
        body: payload,
      }),
      new Promise<never>((_, reject) => {
        const t = setTimeout(
          () => reject(aiError('پاسخ سرویس هوش مصنوعی در مهلت مقرر نرسید.', 'AI_TIMEOUT', 504)),
          cfg.timeoutMs,
        );
        if (typeof t === 'object' && typeof (t as { unref?: () => void }).unref === 'function') {
          (t as { unref: () => void }).unref();
        }
      }),
    ]);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw aiError('ارتباط با سرویس هوش مصنوعی برقرار نشد.', 'AI_PROVIDER_ERROR', 502);
  }

  if (res.status === 429) {
    throw aiError('سرویس هوش مصنوعی محدودیت نرخ اعمال کرده است؛ کمی بعد دوباره تلاش کنید.', 'AI_RATE_LIMITED', 502);
  }
  if (res.status === 401 || res.status === 403) {
    // جزئیات اعتبارنامه هرگز به بیرون نشت نمی‌کند.
    throw aiError('اعتبارسنجی سرویس هوش مصنوعی ناموفق بود؛ پیکربندی کلید را بررسی کنید.', 'AI_AUTH_FAILED', 502);
  }
  if (!res.ok) {
    throw aiError('سرویس هوش مصنوعی با خطا پاسخ داد.', 'AI_PROVIDER_ERROR', 502);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw aiError('پاسخ سرویس هوش مصنوعی قابل تجزیه نبود.', 'AI_MALFORMED_RESPONSE', 502);
  }

  const root = body as { choices?: unknown } | null;
  if (root === null || typeof root !== 'object' || !Array.isArray(root.choices) || root.choices.length === 0) {
    throw aiError('پاسخ سرویس فاقد گزینه متن بود.', 'AI_MALFORMED_RESPONSE', 502);
  }
  const choice = root.choices[0] as { message?: { content?: unknown }; finish_reason?: unknown } | undefined;
  const rawContent = typeof choice?.message?.content === 'string' ? choice.message.content : '';
  const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null;

  if (finishReason === 'content_filter') {
    throw aiError('سرویس هوش مصنوعی از تولید این محتوا خودداری کرد.', 'AI_REFUSED', 502);
  }
  if (finishReason === 'length') {
    throw aiError('پاسخ سرویس ناقص (بریده) بود؛ دوباره تلاش کنید.', 'AI_INCOMPLETE_OUTPUT', 502);
  }
  if (rawContent.trim().length === 0) {
    throw aiError('سرویس هوش مصنوعی پاسخ خالی برگرداند.', 'AI_EMPTY_OUTPUT', 502);
  }
  return { content: rawContent, finishReason };
}

const FENCE = String.fromCharCode(96, 96, 96);

/** برداشتن fenceهای سه‌backtick رایج دور پاسخ‌های کد. */
function stripCodeFences(text: string): string {
  const t = text.trim();
  if (!t.startsWith(FENCE)) return t;
  const rest = t.slice(3);
  const nl = rest.indexOf('\n');
  const body = nl >= 0 ? rest.slice(nl + 1) : rest;
  const end = body.lastIndexOf(FENCE);
  return (end >= 0 ? body.slice(0, end) : body).trim();
}

/** استخراج JSON از متن پاسخ — fenceهای کد را برمی‌دارد و بخش JSON را جدا می‌کند. */
export function extractJson(content: string): unknown {
  const text = stripCodeFences(content);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw aiError('در پاسخ سرویس، JSON یافت نشد.', 'AI_MALFORMED_OUTPUT', 502);
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw aiError('JSON پاسخ سرویس نامعتبر بود.', 'AI_MALFORMED_OUTPUT', 502);
  }
}
