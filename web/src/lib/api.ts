/** کلاینت HTTP مشترک — تایم‌اوت اجباری و خطای نرمال‌شده.
 *  بدون این لایه، fetch می‌تواند بی‌پایان معلق بماند و state صفحه در «بارگذاری» گیر کند. */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface FetchJsonOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** تایم‌اوت پیش‌فرض ۱۵ ثانیه — مرجع: web.dev/optimize-lcp (نبود تایم‌اوت = تجربه گیرکرده) */
  timeoutMs?: number;
}

export async function fetchJson<T>(path: string, options: FetchJsonOptions = {}): Promise<T> {
  const { method = 'GET', body, timeoutMs = 15000 } = options;
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const b = (payload ?? {}) as { message?: string; code?: string };
    throw new ApiError(b.message ?? 'خطای ناشناخته (کد ' + res.status + ')', res.status, b.code);
  }
  return payload as T;
}
