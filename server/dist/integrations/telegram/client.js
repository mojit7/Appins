import { AppError } from '../../core/errors.js';
/** کلاینت رسمی Telegram Bot API — https://core.telegram.org/bots/api
 *  همه فراخوانی‌ها HTTPS به https://api.telegram.org/bot<token>/<method>.
 *  توکن هرگز در پیام خطا یا لاگ ظاهر نمی‌شود (حذف از لاگ در app.ts هم پوشش داده می‌شود). */
const API_BASE = 'https://api.telegram.org/bot';
function defaultSleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
const globalFetch = globalThis.fetch;
function defaultFetcher() {
    return (url, init) => {
        const res = globalFetch(url, init);
        return res.then((r) => ({ ok: r.ok, status: r.status, json: () => r.json() }));
    };
}
export class TelegramClient {
    token;
    fetcher;
    retryAfterCapMs;
    sleepFn;
    constructor(token, options = {}) {
        this.token = token;
        this.fetcher = options.fetcher ?? defaultFetcher();
        this.retryAfterCapMs = options.retryAfterCapMs ?? 15000;
        this.sleepFn = options.sleepFn ?? defaultSleep;
    }
    /** فراخوانی متد Bot API؛ در 429 مطابق retry_after حداکثر یک‌بار تلاش مجدد می‌شود. */
    async call(method, payload, attempt = 0) {
        let res;
        try {
            res = await this.fetcher(API_BASE + this.token + '/' + method, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
            });
        }
        catch {
            throw new AppError('ارتباط با تلگرام برقرار نشد.', 'TELEGRAM_API_ERROR', 502);
        }
        const body = (await res.json().catch(() => null));
        if (res.ok && body && body.ok === true)
            return body.result;
        const code = body && body.ok === false ? (body.error_code ?? res.status) : res.status;
        if (code === 429 && attempt < 1) {
            const waitMs = Math.min((body?.parameters?.retry_after ?? 1) * 1000, this.retryAfterCapMs);
            await this.sleepFn(waitMs);
            return this.call(method, payload, attempt + 1);
        }
        const invalidConfig = code === 401 || code === 404;
        throw new AppError('درخواست تلگرام ناموفق بود (کد ' + code + ').', invalidConfig ? 'TELEGRAM_CONFIG_INVALID' : 'TELEGRAM_API_ERROR', invalidConfig ? 503 : 502);
    }
    async sendMessage(chatId, text, replyMarkup) {
        const payload = { chat_id: String(chatId), text };
        if (replyMarkup !== undefined)
            payload.reply_markup = replyMarkup;
        return this.call('sendMessage', payload);
    }
    async answerCallbackQuery(callbackQueryId, text) {
        return this.call('answerCallbackQuery', { callback_query_id: callbackQueryId, text });
    }
    async setWebhook(url, secretToken) {
        return this.call('setWebhook', { url, secret_token: secretToken, allowed_updates: ['message', 'callback_query'] });
    }
    async deleteWebhook() {
        return this.call('deleteWebhook', {});
    }
    async getWebhookInfo() {
        return this.call('getWebhookInfo', {});
    }
    async getMe() {
        return this.call('getMe', {});
    }
}
