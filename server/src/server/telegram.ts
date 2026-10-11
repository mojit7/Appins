import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { AppError, ForbiddenError, ValidationError } from '../core/errors.js';
import type { Env } from '../config/env.js';
import { safeEqual } from '../auth/password.js';
import { OWNER } from '../data/context.js';
import { DraftRepository } from '../data/drafts.js';
import { TelegramClient } from '../integrations/telegram/client.js';
import type { FetchLike } from '../integrations/instagram/oauth.js';

/** ربات دستیار مالک — معماری webhook رسمی تلگرام (setWebhook + سرصفحه X-Telegram-Bot-Api-Secret-Token).
 *  دسترسی: فقط هویت مالکِ پیکربندی‌شده (TELEGRAM_OWNER_ID). پاکسازی تکرار: شناسه آپدیت + وضعیت idempotent. */

export interface TelegramDeps {
  env: Env;
  pool: Pool;
  fetcher?: FetchLike;
}

const WELCOME = 'سلام! ربات دستیار فروشگاه‌یار 🛍️\nوضعیت فروشگاه، محتوای پیش‌رو و نتیجه انتشارها را دنبال کنید. فرمان /help راهنمای کامل است.';
const HELP = 'راهنمای فرمان‌ها:\n/status — وضعیت فروشگاه (محصولات، پیش‌نویس‌ها، کارهای انتشار)\n/upcoming — پنج زمان‌بندی بعدی\n/drafts — پنج پیش‌نویس اخیر با دکمه تأیید\nتوجه: این ربات فقط برای مالک فروشگاه فعال است.';
const DENIED = 'این ربات فقط برای مالک فروشگاه فعال است.';
const UNKNOWN_CMD = 'فرمان ناشناخته است؛ /help را ببینید.';
const CB_INVALID = 'داده درخواست نامعتبر است.';
const CB_DONE = 'این پیش‌نویس قبلاً پردازش شده است.';
const CB_OK = '✅ پیش‌نویس تأیید و آماده انتشار شد.';
const CB_NOT_FOUND = 'پیش‌نویس یافت نشد.';

const APPROVE_RE = /^approve:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DRAFT_STATUS_FA: Record<string, string> = { draft: 'در حال نگارش', ready: 'آماده', scheduled: 'زمان‌بندی‌شده' };

export function registerTelegramRoutes(app: FastifyInstance, deps: TelegramDeps | undefined): void {
  const stubHandler = async () => {
    throw new AppError('ماژول تلگرام در این فرآیند فعال نیست.', 'TELEGRAM_MODULE_NOT_CONFIGURED', 503);
  };
  if (!deps) {
    app.post('/telegram/webhook', stubHandler);
    app.post('/telegram/webhook/setup', stubHandler);
    app.post('/telegram/webhook/teardown', stubHandler);
    app.get('/telegram/webhook/info', stubHandler);
    return;
  }

  const { env, pool } = deps;
  const token = env.TELEGRAM_BOT_TOKEN;
  const ownerId = env.TELEGRAM_OWNER_ID;
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !ownerId || !secret) {
    // triple-guard: بدون پیکربندی کامل ماژول فعال نمی‌شود
    app.post('/telegram/webhook', stubHandler);
    app.post('/telegram/webhook/setup', stubHandler);
    app.post('/telegram/webhook/teardown', stubHandler);
    app.get('/telegram/webhook/info', stubHandler);
    return;
  }

  const client = new TelegramClient(token, { fetcher: deps.fetcher });
  const drafts = new DraftRepository(pool);

  // پاکسازی تکرار آپدیت‌ها (تلگرام در شکست تحویل دوباره می‌فرستد) — حافظه محدود به ۵۰۰ شناسه اخیر
  const seen = new Set<number>();
  const seenOrder: number[] = [];

  function isOwner(id: unknown): boolean {
    return typeof id === 'number' ? String(id) === ownerId : typeof id === 'string' && id === ownerId;
  }

  async function statusText(): Promise<string> {
    const [prodRows, draftRows, jobRows] = await Promise.all([
      pool.query<{ status: string; c: number }>('SELECT status, count(*)::int AS c FROM products GROUP BY status'),
      pool.query<{ status: string; c: number }>('SELECT status, count(*)::int AS c FROM content_drafts GROUP BY status'),
      pool.query<{ status: string; c: number }>('SELECT status, count(*)::int AS c FROM publishing_jobs GROUP BY status'),
    ]);
    const pick = (rows: { status: string; c: number }[], k: string) => rows.find((r) => r.status === k)?.c ?? 0;
    const p = prodRows.rows;
    const productsTotal = p.reduce((a, r) => a + r.c, 0);
    const j = jobRows.rows;
    return 'وضعیت فروشگاه:\n'
      + '📦 محصولات: فعال ' + pick(p, 'active') + ' / پیش‌نویس ' + pick(p, 'draft') + ' / بایگانی ' + pick(p, 'archived') + ' (مجموع ' + productsTotal + ')\n'
      + '📝 پیش‌نویس محتوا: ' + pick(draftRows.rows, 'draft') + ' در نگارش، ' + pick(draftRows.rows, 'ready') + ' آماده، ' + pick(draftRows.rows, 'scheduled') + ' زمان‌بندی‌شده\n'
      + '🚀 کارهای انتشار: در صف ' + pick(j, 'pending') + ' / در حال اجرا ' + pick(j, 'running') + ' / منتشرشده ' + pick(j, 'succeeded') + ' / ناموفق ' + pick(j, 'failed') + ' / لغوشده ' + pick(j, 'cancelled');
  }

  async function upcomingText(): Promise<string> {
    const r = await pool.query<{ title: string; scheduled_at: Date }>(
      "SELECT d.title, j.scheduled_at FROM publishing_jobs j JOIN content_drafts d ON d.id = j.draft_id WHERE j.status = 'pending' ORDER BY j.next_run_at ASC LIMIT 5",
    );
    if (r.rows.length === 0) return 'زمان‌بندی بازی در صف نیست.';
    return 'زمان‌بندی‌های بعدی:\n' + r.rows
      .map((row) => '• ' + row.title + ' — ' + new Date(row.scheduled_at).toLocaleString('fa-IR'))
      .join('\n');
  }

  async function draftsText(): Promise<{ text: string; markup: { inline_keyboard: unknown[][] } | undefined }> {
    const page = await drafts.list(OWNER, 1, 5);
    if (page.items.length === 0) return { text: 'پیش‌نویسی ثبت نشده است.', markup: undefined };
    const lines = page.items.map((d) => '• ' + d.title + ' (' + (DRAFT_STATUS_FA[d.status] ?? d.status) + ')');
    const buttons = page.items
      .filter((d) => d.status === 'draft')
      .map((d) => [{ text: '✅ تأیید «' + d.title + '»', callback_data: 'approve:' + d.id }]);
    return {
      text: 'پیش‌نویس‌های اخیر:\n' + lines.join('\n') + (buttons.length > 0 ? '\nبرای تأیید از دکمه‌های زیر استفاده کنید.' : ''),
      markup: buttons.length > 0 ? { inline_keyboard: buttons } : undefined,
    };
  }

  async function handleUpdate(raw: unknown): Promise<{ ok: boolean; duplicate?: boolean }> {
    const u = (typeof raw === 'object' && raw !== null ? raw : {}) as {
      update_id?: unknown;
      message?: { chat?: { id?: unknown }; text?: unknown } | null;
      callback_query?: { id?: unknown; from?: { id?: unknown }; data?: unknown } | null;
    };
    if (typeof u.update_id !== 'number') return { ok: true };
    if (seen.has(u.update_id)) return { ok: true, duplicate: true };
    seen.add(u.update_id);
    seenOrder.push(u.update_id);
    if (seenOrder.length > 500) {
      const old = seenOrder.shift();
      if (old !== undefined) seen.delete(old);
    }

    // پاسخ به callback — همیشه answerCallbackQuery می‌شود (الزام رسمی Bot API)
    const cb = u.callback_query;
    if (cb && typeof cb.id === 'string' && cb.from && typeof cb.from.id !== 'undefined') {
      const answer = (text: string) => client.answerCallbackQuery(cb.id as string, text).catch(() => {});
      if (!isOwner(cb.from.id)) {
        await answer(DENIED);
        return { ok: true };
      }
      if (typeof cb.data !== 'string' || !APPROVE_RE.test(cb.data)) {
        await answer(CB_INVALID);
        return { ok: true };
      }
      const draftId = (cb.data as string).slice('approve:'.length);
      let draft;
      try {
        draft = await drafts.get(OWNER, draftId);
      } catch {
        await answer(CB_NOT_FOUND);
        return { ok: true };
      }
      if (draft.status !== 'draft') {
        await answer(CB_DONE);
        return { ok: true };
      }
      await drafts.update(OWNER, draftId, { status: 'ready' });
      await answer(CB_OK);
      return { ok: true };
    }

    // پیام متنی
    const m = u.message;
    if (m && m.chat && typeof m.chat.id !== 'undefined' && typeof m.text === 'string') {
      const chatId = m.chat.id;
      const reply = (text: string, markup?: { inline_keyboard: unknown[][] }) =>
        client.sendMessage(chatId, text, markup).catch(() => {});
      if (!isOwner(chatId)) {
        await reply(DENIED);
        return { ok: true };
      }
      const text = (m.text as string).trim();
      if (text === '/start') await reply(WELCOME);
      else if (text === '/help') await reply(HELP);
      else if (text === '/status') await reply(await statusText());
      else if (text === '/upcoming') await reply(await upcomingText());
      else if (text === '/drafts') {
        const d = await draftsText();
        await reply(d.text, d.markup);
      } else await reply(UNKNOWN_CMD);
      return { ok: true };
    }

    return { ok: true };
  }

  // webhook عمومی — احراز با سرّ رسمی setWebhook (سرصفحه X-Telegram-Bot-Api-Secret-Token)
  app.post('/telegram/webhook', async (req, reply) => {
    const h = req.headers['x-telegram-bot-api-secret-token'];
    const provided = Array.isArray(h) ? h[0] : h;
    if (typeof provided !== 'string' || provided.length === 0 || !safeEqual(provided, secret)) {
      throw new ForbiddenError('درخواست webhook معتبر نیست.');
    }
    let result: { ok: boolean; duplicate?: boolean };
    try {
      result = await handleUpdate(req.body);
    } catch (err) {
      // پاسخ همیشه ۲۰۰ تا تلگرام ارسال تکراری نکند؛ خطا ثبت و رها می‌شود
      app.log.warn({ err: err instanceof Error ? err.message : String(err) }, 'پردازش آپدیت تلگرام ناموفق بود');
      result = { ok: true };
    }
    reply.send(result);
  });

  // راه‌اندازی webhook — پشت گارد نشست سراسری
  app.post<{ Body: { url?: unknown } }>('/telegram/webhook/setup', async (req) => {
    const b = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as { url?: unknown };
    if (typeof b.url !== 'string' || !/^https:\/\/.+/i.test(b.url)) {
      throw new ValidationError('نشانی webhook باید HTTPS معتبر باشد.');
    }
    const result = await client.setWebhook(b.url, secret);
    return { ok: true, result };
  });

  app.post('/telegram/webhook/teardown', async () => {
    const result = await client.deleteWebhook();
    return { ok: true, result };
  });

  app.get('/telegram/webhook/info', async () => {
    return client.getWebhookInfo();
  });
}
