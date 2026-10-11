/** عملیات پیام‌رسانی رسمی اینستاگرام (Instagram API with Instagram Login — Graph v26.0):
 *  GET /me/conversations?platform=instagram — فهرست گفت‌وگوهای مستقیم
 *  POST /{ig-id}/messages با recipient/message — پیام مستقیم (فقط به آغازگر گفت‌وگو)
 *  POST /{comment-id}/replies — پاسخ عمومی به نظر
 *  POST /{ig-id}/messages با recipient:{comment_id} — پاسخ خصوصی به نظر
 *  هیچ مسیر غیررسمی یا scraping وجود ندارد؛ بدون توکن معتبر همه فراخوانی‌ها شکست می‌خورند (شبیه‌سازی ممنوع). */

import { AppError, IntegrationError, ValidationError } from '../../core/errors.js';
import type { FetchLike } from './oauth.js';

const API_VERSION = 'v26.0';
const HOST = 'https://graph.instagram.com';

interface GraphError { message?: unknown; code?: unknown }

function throwGraphError(data: unknown, res: { ok: boolean; status: number }): never {
  const err = (data as { error?: GraphError } | null)?.error ?? (data as GraphError | null);
  const message = typeof err?.message === 'string' ? err.message : 'فراخوانی API اینستاگرام ناموفق بود.';
  const code = typeof err?.code === 'number' ? err.code : null;
  if (code === 190) {
    throw new AppError('توکن اینستاگرام منقضی یا باطل شده است؛ اتصال مجدد لازم است.', 'INSTAGRAM_REAUTH_REQUIRED', 401);
  }
  throw new IntegrationError(message, { graphCode: code, httpStatus: res.status });
}

async function graphGet(path: string, token: string, fetcher: FetchLike): Promise<Record<string, unknown>> {
  const sep = path.indexOf('?') >= 0 ? '&' : '?';
  const res = await fetcher(HOST + '/' + API_VERSION + '/' + path + sep + 'access_token=' + encodeURIComponent(token));
  const data = await res.json().catch(() => null);
  if (!res.ok || data === null || typeof data !== 'object') throwGraphError(data, res);
  return data as Record<string, unknown>;
}

async function graphPost(path: string, token: string, form: Record<string, string>, fetcher: FetchLike): Promise<Record<string, unknown>> {
  const body = new URLSearchParams(form).toString();
  const res = await fetcher(HOST + '/' + API_VERSION + '/' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data === null || typeof data !== 'object') throwGraphError(data, res);
  return data as Record<string, unknown>;
}

function assertText(text: string): void {
  const t = text.trim();
  if (t.length === 0) throw new ValidationError('متن پیام خالی است.');
  if (t.length > 1000) throw new ValidationError('متن پیام از سقف مجاز اینستاگرام (۱۰۰۰ نویسه) بلندتر است.');
}

export interface DirectConversationSummary {
  id: string;
  updatedAt: string | null;
  participants: string[];
  snippet: string | null;
}

/** فهرست گفت‌وگوهای مستقیم — نقطه شروع همگام‌سازی صندوق. */
export async function listDirectConversations(
  token: string, fetcher: FetchLike, limit = 25,
): Promise<DirectConversationSummary[]> {
  const safeLimit = Math.min(100, Math.max(1, limit));
  const data = await graphGet(
    'me/conversations?platform=instagram&fields=participants,updated_time,last_message&limit=' + safeLimit,
    token, fetcher,
  );
  const rows = Array.isArray(data.data) ? (data.data as Record<string, unknown>[]) : [];
  return rows.map((row) => {
    const id = typeof row.id === 'string' ? row.id : '';
    const participants = Array.isArray(row.participants)
      ? (row.participants as Array<{ username?: unknown }>).map((p) => typeof p.username === 'string' ? p.username : '')
      : [];
    const lastMessage = (row.last_message ?? null) as { message?: { text?: unknown } } | null;
    const snippet = typeof lastMessage?.message?.text === 'string' ? lastMessage.message.text : null;
    return {
      id,
      updatedAt: typeof row.updated_time === 'string' ? row.updated_time : null,
      participants: participants.filter((p) => p.length > 0),
      snippet,
    };
  }).filter((c) => c.id.length > 0);
}

/** ارسال پیام مستقیم — recipient باید IGSID مشتری‌ای باشد که گفت‌وگو را آغاز کرده است. */
export async function sendDirectMessage(
  token: string, igId: string, recipientId: string, text: string, fetcher: FetchLike,
): Promise<string> {
  assertText(text);
  if (igId.trim().length === 0) throw new ValidationError('شناسه حساب اینستاگرام برای ارسال لازم است.');
  if (recipientId.trim().length === 0) throw new ValidationError('شناسه دریافت‌کننده برای ارسال لازم است.');
  const data = await graphPost(encodeURIComponent(igId) + '/messages', token, {
    recipient: JSON.stringify({ id: recipientId }),
    message: JSON.stringify({ text: text.trim() }),
  }, fetcher);
  const mid = typeof data.message_id === 'string' ? data.message_id : (typeof data.id === 'string' ? data.id : '');
  if (mid.length === 0) throw new IntegrationError('ارسال پیام مستقیم ناموفق بود؛ شناسه پیام برنگشت.');
  return mid;
}

/** پاسخ عمومی به نظر — عملیات رسمی POST /{comment-id}/replies. */
export async function replyToComment(token: string, commentId: string, text: string, fetcher: FetchLike): Promise<string> {
  assertText(text);
  if (commentId.trim().length === 0) throw new ValidationError('شناسه نظر برای پاسخ لازم است.');
  const data = await graphPost(encodeURIComponent(commentId) + '/replies', token, {
    message: text.trim(),
  }, fetcher);
  const id = typeof data.id === 'string' ? data.id : '';
  if (id.length === 0) throw new IntegrationError('پاسخ به نظر ناموفق بود؛ شناسه پاسخ برنگشت.');
  return id;
}

/** پاسخ خصوصی به نظر — عملیات رسمی با recipient:{comment_id} (Private Replies). */
export async function privateReplyToComment(
  token: string, igId: string, commentId: string, text: string, fetcher: FetchLike,
): Promise<string> {
  assertText(text);
  if (igId.trim().length === 0 || commentId.trim().length === 0) {
    throw new ValidationError('شناسه حساب و نظر برای پاسخ خصوصی لازم است.');
  }
  const data = await graphPost(encodeURIComponent(igId) + '/messages', token, {
    recipient: JSON.stringify({ comment_id: commentId.trim() }),
    message: JSON.stringify({ text: text.trim() }),
  }, fetcher);
  const mid = typeof data.message_id === 'string' ? data.message_id : (typeof data.id === 'string' ? data.id : '');
  if (mid.length === 0) throw new IntegrationError('پاسخ خصوصی به نظر ناموفق بود.');
  return mid;
}
