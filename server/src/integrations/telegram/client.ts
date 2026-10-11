import { AppError } from '../../core/errors.js';
import type { FetchLike } from '../instagram/oauth.js';

/** کلاینت رسمی Telegram Bot API — https://core.telegram.org/bots/api
 *  همه فراخوانی‌ها HTTPS به https://api.telegram.org/bot<token>/<method>.
 *  توکن هرگز در پیام خطا یا لاگ ظاهر نمی‌شود (حذف از لاگ در app.ts هم پوشش داده می‌شود). */

const API_BASE = 'https://api.telegram.org/bot';

export interface TelegramClientOptions {
  fetcher?: FetchLike;
  /** بیشینه انتظار پس از 429 (retry_after) — از ارسال تکراری بی‌سقف جلوگیری می‌کند. */
  retryAfterCapMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

interface TgBody {
  ok?: boolean;
  result?: unknown;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const globalFetch = globalThis.fetch;

function defaultFetcher(): FetchLike {
  return (url: string, init?: Record<string, unknown>) => {
    const res = globalFetch(url, init as unknown as Parameters<typeof globalFetch>[1]);
    return res.then((r) => ({ ok: r.ok, status: r.status, json: () => r.json() as Promise<unknown> }));
  };
}

export class TelegramClient {
  private readonly fetcher: FetchLike;
  private readonly retryAfterCapMs: number;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(private readonly token: string, options: TelegramClientOptions = {}) {
    this.fetcher = options.fetcher ?? defaultFetcher();
    this.retryAfterCapMs = options.retryAfterCapMs ?? 15000;
    this.sleepFn = options.sleepFn ?? defaultSleep;
  }

  /** فراخوانی متد Bot API؛ در 429 مطابق retry_after حداکثر یک‌بار تلاش مجدد می‌شود. */
  private async call(method: string, payload: Record<string, unknown>, attempt = 0): Promise<unknown> {
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetcher(API_BASE + this.token + '/' + method, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new AppError('ارتباط با تلگرام برقرار نشد.', 'TELEGRAM_API_ERROR', 502);
    }
    const body = (await res.json().catch(() => null)) as TgBody | null;
    if (res.ok && body && body.ok === true) return body.result;
    const code = body && body.ok === false ? (body.error_code ?? res.status) : res.status;
    if (code === 429 && attempt < 1) {
      const waitMs = Math.min((body?.parameters?.retry_after ?? 1) * 1000, this.retryAfterCapMs);
      await this.sleepFn(waitMs);
      return this.call(method, payload, attempt + 1);
    }
    const invalidConfig = code === 401 || code === 404;
    throw new AppError(
      'درخواست تلگرام ناموفق بود (کد ' + code + ').',
      invalidConfig ? 'TELEGRAM_CONFIG_INVALID' : 'TELEGRAM_API_ERROR',
      invalidConfig ? 503 : 502,
    );
  }

  async sendMessage(chatId: number | string, text: string, replyMarkup?: unknown): Promise<unknown> {
    const payload: Record<string, unknown> = { chat_id: String(chatId), text };
    if (replyMarkup !== undefined) payload.reply_markup = replyMarkup;
    return this.call('sendMessage', payload);
  }

  async answerCallbackQuery(callbackQueryId: string, text: string): Promise<unknown> {
    return this.call('answerCallbackQuery', { callback_query_id: callbackQueryId, text });
  }

  async setWebhook(url: string, secretToken: string): Promise<unknown> {
    return this.call('setWebhook', { url, secret_token: secretToken, allowed_updates: ['message', 'callback_query'] });
  }

  async deleteWebhook(): Promise<unknown> {
    return this.call('deleteWebhook', {});
  }

  async getWebhookInfo(): Promise<unknown> {
    return this.call('getWebhookInfo', {});
  }

  async getMe(): Promise<unknown> {
    return this.call('getMe', {});
  }
}
