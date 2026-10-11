import { AppError, IntegrationError, ValidationError } from '../../core/errors.js';
import type { FetchLike } from './oauth.js';

/** کلاینت Graph اینستاگرام — فقط قابلیت‌های تأییدشده در مستندات رسمی متا (v25.0):
 *  GET /me، GET /{media-id}/insights، POST /{ig-id}/media و /{ig-id}/media_publish. */

const API_VERSION = 'v25.0';
const HOST = 'https://graph.instagram.com';

export interface InstagramProfile {
  id: string;
  username: string;
  accountType: 'BUSINESS' | 'MEDIA_CREATOR';
  followersCount: number;
  mediaCount: number;
}

interface GraphError {
  message?: unknown;
  type?: unknown;
  code?: unknown;
}

/** خطای Graph را به خطای دامنه ترجمه می‌کند؛ کد ۱۹۰ یعنی توکن منقضی/بی‌اعتبار. */
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
  if (!res.ok || data === null || typeof data !== 'object') {
    throwGraphError(data, res);
  }
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
  if (!res.ok || data === null || typeof data !== 'object') {
    throwGraphError(data, res);
  }
  return data as Record<string, unknown>;
}

export async function getMeProfile(token: string, fetcher: FetchLike): Promise<InstagramProfile> {
  const data = await graphGet('me?fields=user_id,username,account_type,followers_count,media_count', token, fetcher);
  const entry = (Array.isArray(data.data) ? (data.data as Record<string, unknown>[])[0] : data) ?? null;
  const id = typeof entry?.user_id === 'string' ? entry.user_id : '';
  const username = typeof entry?.username === 'string' ? entry.username : '';
  if (id.length === 0 || username.length === 0) {
    throw new IntegrationError('پاسخ پروفایل اینستاگرام کامل نبود.');
  }
  const rawType = typeof entry?.account_type === 'string' ? entry.account_type.toUpperCase() : '';
  if (rawType !== 'BUSINESS' && rawType !== 'MEDIA_CREATOR') {
    throw new IntegrationError('نوع حساب در پاسخ اینستاگرام پشتیبانی‌نشده یا نامعتبر بود.', { accountType: rawType });
  }
  return {
    id,
    username,
    accountType: rawType,
    followersCount: typeof entry?.followers_count === 'number' ? entry.followers_count : 0,
    mediaCount: typeof entry?.media_count === 'number' ? entry.media_count : 0,
  };
}

export interface MediaInsight {
  name: string;
  value: number;
  title: string;
}

export async function getMediaInsights(mediaId: string, token: string, metric: string, fetcher: FetchLike): Promise<MediaInsight[]> {
  if (!/^[A-Za-z_,]+$/.test(metric)) {
    throw new ValidationError('پارامتر metric نامعتبر است.');
  }
  const data = await graphGet(encodeURIComponent(mediaId) + '/insights?metric=' + encodeURIComponent(metric), token, fetcher);
  const rows = Array.isArray(data.data) ? (data.data as Record<string, unknown>[]) : [];
  return rows
    .filter((r) => typeof r.name === 'string')
    .map((r) => ({
      name: r.name as string,
      value: Array.isArray(r.values) ? Number((r.values as { value?: unknown }[])[0]?.value ?? 0) : 0,
      title: typeof r.title === 'string' ? r.title : (r.name as string),
    }));
}

export interface PublishImageInput {
  imageUrl: string;
  caption: string;
}

export async function createImageContainer(igId: string, token: string, input: PublishImageInput, fetcher: FetchLike): Promise<string> {
  if (!/^https?:\/\//i.test(input.imageUrl)) {
    throw new ValidationError('نشانی تصویر باید http(s) باشد.');
  }
  const data = await graphPost(encodeURIComponent(igId) + '/media', token, {
    image_url: input.imageUrl,
    caption: input.caption,
  }, fetcher);
  const id = typeof data.id === 'string' ? data.id : '';
  if (id.length === 0) {
    throw new IntegrationError('ایجاد ظرف رسانه ناموفق بود.');
  }
  return id;
}

export type ContainerStatusCode = 'FINISHED' | 'IN_PROGRESS' | 'ERROR';

export async function getContainerStatus(containerId: string, token: string, fetcher: FetchLike): Promise<ContainerStatusCode> {
  const data = await graphGet(encodeURIComponent(containerId) + '?fields=status_code', token, fetcher);
  const code = typeof data.status_code === 'string' ? data.status_code : '';
  if (code === 'FINISHED' || code === 'IN_PROGRESS' || code === 'ERROR') return code;
  throw new IntegrationError('وضعیت ظرف رسانه نامعتبر بود.', { statusCode: code });
}

export async function publishContainer(igId: string, token: string, containerId: string, fetcher: FetchLike): Promise<string> {
  const data = await graphPost(encodeURIComponent(igId) + '/media_publish', token, {
    media_container_id: containerId,
  }, fetcher);
  const id = typeof data.id === 'string' ? data.id : '';
  if (id.length === 0) {
    throw new IntegrationError('انتشار پست ناموفق بود.');
  }
  return id;
}
