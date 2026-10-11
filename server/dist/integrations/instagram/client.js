import { AppError, IntegrationError, ValidationError } from '../../core/errors.js';
/** کلاینت Graph اینستاگرام — فقط قابلیت‌های تأییدشده در مستندات رسمی متا (v26.0 — آخرین نسخه پایدار، تأییدشده از Graph API Changelog در ۲۰۲۶-۱۰-۱۱):
 *  GET /me، GET /{media-id}/insights، POST /{ig-id}/media و /{ig-id}/media_publish. */
const API_VERSION = 'v26.0';
const HOST = 'https://graph.instagram.com';
/** خطای Graph را به خطای دامنه ترجمه می‌کند؛ کد ۱۹۰ یعنی توکن منقضی/بی‌اعتبار. */
function throwGraphError(data, res) {
    const err = data?.error ?? data;
    const message = typeof err?.message === 'string' ? err.message : 'فراخوانی API اینستاگرام ناموفق بود.';
    const code = typeof err?.code === 'number' ? err.code : null;
    if (code === 190) {
        throw new AppError('توکن اینستاگرام منقضی یا باطل شده است؛ اتصال مجدد لازم است.', 'INSTAGRAM_REAUTH_REQUIRED', 401);
    }
    throw new IntegrationError(message, { graphCode: code, httpStatus: res.status });
}
async function graphGet(path, token, fetcher) {
    const sep = path.indexOf('?') >= 0 ? '&' : '?';
    const res = await fetcher(HOST + '/' + API_VERSION + '/' + path + sep + 'access_token=' + encodeURIComponent(token));
    const data = await res.json().catch(() => null);
    if (!res.ok || data === null || typeof data !== 'object') {
        throwGraphError(data, res);
    }
    return data;
}
async function graphPost(path, token, form, fetcher) {
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
    return data;
}
export async function getMeProfile(token, fetcher) {
    const data = await graphGet('me?fields=user_id,username,account_type,followers_count,media_count', token, fetcher);
    const entry = (Array.isArray(data.data) ? data.data[0] : data) ?? null;
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
export async function getMediaInsights(mediaId, token, metric, fetcher) {
    if (!/^[A-Za-z_,]+$/.test(metric)) {
        throw new ValidationError('پارامتر metric نامعتبر است.');
    }
    const data = await graphGet(encodeURIComponent(mediaId) + '/insights?metric=' + encodeURIComponent(metric), token, fetcher);
    const rows = Array.isArray(data.data) ? data.data : [];
    return rows
        .filter((r) => typeof r.name === 'string')
        .map((r) => ({
        name: r.name,
        value: Array.isArray(r.values) ? Number(r.values[0]?.value ?? 0) : 0,
        title: typeof r.title === 'string' ? r.title : r.name,
    }));
}
export async function createImageContainer(igId, token, input, fetcher) {
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
export async function getContainerStatus(containerId, token, fetcher) {
    const data = await graphGet(encodeURIComponent(containerId) + '?fields=status_code', token, fetcher);
    const code = typeof data.status_code === 'string' ? data.status_code : '';
    if (code === 'FINISHED' || code === 'IN_PROGRESS' || code === 'ERROR')
        return code;
    throw new IntegrationError('وضعیت ظرف رسانه نامعتبر بود.', { statusCode: code });
}
export async function publishContainer(igId, token, containerId, fetcher) {
    const data = await graphPost(encodeURIComponent(igId) + '/media_publish', token, {
        media_container_id: containerId,
    }, fetcher);
    const id = typeof data.id === 'string' ? data.id : '';
    if (id.length === 0) {
        throw new IntegrationError('انتشار پست ناموفق بود.');
    }
    return id;
}
