/** متریک‌های داشبورد — هر عدد یک منبع قابل ردیابی دارد؛ هیچ داده‌ای ساخته یا جعل نمی‌شود.
 *  منبع و شیوه محاسبه هر متریک در docs/DASHBOARD_DATA.md مستند است.
 *  حالت‌های داده تفکیک می‌شوند: ok / zero / error / unavailable / stale (و loading در UI). */

export const API_ROOT = '/api';

/** تابع واکشی تزریق‌پذیر — در آزمون‌ها جایگزین می‌شود؛ در مرورگر fetch سراسری است. */
export type Fetcher = (path: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface ApiFailure extends Error {
  status: number;
  code: string;
}

function defaultFetcher(): Fetcher {
  return (path) => fetch(API_ROOT + path);
}

async function getJson(path: string, fetcher: Fetcher): Promise<unknown> {
  let res: { ok: boolean; status: number; json(): Promise<unknown> };
  try {
    res = await fetcher(path);
  } catch {
    throw new Error('ارتباط با سرور برقرار نشد.');
  }
  if (!res.ok) {
    let code = '';
    let message = 'خطای ناشناخته (کد ' + res.status + ')';
    try {
      const body = (await res.json()) as { code?: unknown; message?: unknown } | null;
      if (body !== null && typeof body === 'object') {
        if (typeof body.code === 'string') code = body.code;
        if (typeof body.message === 'string' && body.message.length > 0) message = body.message;
      }
    } catch { /* بدنه JSON معتبر نبود؛ پیام پیش‌فرض باقی می‌ماند */ }
    const err = new Error(message) as ApiFailure;
    err.status = res.status;
    err.code = code;
    throw err;
  }
  try {
    return await res.json();
  } catch {
    throw new Error('پاسخ سرور معتبر نبود.');
  }
}

/* ——— خلاصه‌سازی خالص (آزمون‌پذیر) ——— */

export interface ProductItem {
  id: string;
  name: string;
  sku: string;
  priceToman: number;
  stock: number;
  status: string;
}

export interface PageOf<T> {
  items: T[];
  total: number;
}

export interface ProductsSummary {
  total: number;
  active: number;
  outOfStock: number;
  partial: boolean;
  items: ProductItem[];
}

/** active = تعداد items با status==='active' در ۱۰۰ مورد اخیر؛ total از count(*) سرور دقیق است.
 *  partial=true یعنی total از سقف ۱۰۰ ردیف سرور فراتر است و ریزشمارش فقط برگه اول را می‌بیند. */
export function summarizeProducts(page: unknown): ProductsSummary {
  const p = (page ?? {}) as Partial<PageOf<ProductItem>>;
  const items = Array.isArray(p.items) ? p.items : [];
  const total = typeof p.total === 'number' && p.total >= 0 ? p.total : items.length;
  return {
    total,
    active: items.filter((x) => x.status === 'active').length,
    outOfStock: items.filter((x) => x.status === 'active' && x.stock === 0).length,
    partial: total > items.length,
    items,
  };
}

export interface CountsSummary { total: number }

/** total سرور از count(*) دقیق است؛ برای کاهش بار شبکه فقط ۱ ردیف درخواست می‌شود. */
export function summarizeCount(page: unknown): CountsSummary {
  const p = (page ?? {}) as Partial<PageOf<unknown>>;
  const items = Array.isArray(p.items) ? p.items : [];
  const total = typeof p.total === 'number' && p.total >= 0 ? p.total : items.length;
  return { total };
}

export interface InstagramSummary {
  connected: boolean;
  stale: boolean;
  accountRef: string | null;
  tokenExpiresAt: string | null;
}

/** stale = متصل ولی توکن منقضی یا نیازمند اتصال مجدد (پاسخ رسمی /instagram/status). */
export function summarizeInstagram(status: unknown, now: number): InstagramSummary {
  const s = (status ?? {}) as Record<string, unknown>;
  const connected = s.connected === true;
  const expires = typeof s.tokenExpiresAt === 'string' ? s.tokenExpiresAt : null;
  let expired = false;
  if (expires !== null) {
    const t = new Date(expires).getTime();
    expired = !Number.isNaN(t) && t <= now;
  }
  const stale = connected && (s.needsReauthorization === true || expired);
  return { connected, stale, accountRef: typeof s.accountRef === 'string' ? s.accountRef : null, tokenExpiresAt: expires };
}

/* ——— ساخت گزارش از نتایج مستقل هر بخش ——— */

export type SectionState = 'ok' | 'zero' | 'error' | 'unavailable' | 'stale';

export interface Section<T> {
  state: SectionState;
  data: T | null;
  message: string;
}

function classifyFailure(err: unknown): { state: SectionState; message: string } {
  const e = err as Partial<ApiFailure> | null;
  const status = e !== null && typeof e.status === 'number' ? e.status : 0;
  if (status === 401 || status === 403) return { state: 'unavailable', message: 'برای دیدن داده‌ها باید وارد حساب شوید.' };
  if (status === 503) return { state: 'unavailable', message: 'این ماژول روی سرور فعال نیست.' };
  return { state: 'error', message: err instanceof Error && err.message.length > 0 ? err.message : 'خطای ناشناخته' };
}

export interface DashboardSnapshot {
  products: Section<ProductsSummary>;
  drafts: Section<CountsSummary>;
  pendingJobs: Section<CountsSummary>;
  failedJobs: Section<CountsSummary>;
  instagram: Section<InstagramSummary>;
  fetchedAt: string;
}

type Settled = PromiseSettledResult<unknown>;

function countSection(result: Settled): Section<CountsSummary> {
  if (result.status === 'fulfilled') {
    const s = summarizeCount(result.value);
    return { state: s.total === 0 ? 'zero' : 'ok', data: s, message: '' };
  }
  const c = classifyFailure(result.reason);
  return { state: c.state, data: null, message: c.message };
}

function productsSection(result: Settled): Section<ProductsSummary> {
  if (result.status === 'fulfilled') {
    const s = summarizeProducts(result.value);
    return { state: s.total === 0 ? 'zero' : 'ok', data: s, message: '' };
  }
  const c = classifyFailure(result.reason);
  return { state: c.state, data: null, message: c.message };
}

function instagramSection(result: Settled, now: number): Section<InstagramSummary> {
  if (result.status === 'fulfilled') {
    const s = summarizeInstagram(result.value, now);
    return { state: s.stale ? 'stale' : 'ok', data: s, message: '' };
  }
  const c = classifyFailure(result.reason);
  return { state: c.state, data: null, message: c.message };
}

export function buildSnapshot(
  results: { products: Settled; drafts: Settled; pending: Settled; failed: Settled; instagram: Settled },
  now: number,
): DashboardSnapshot {
  return {
    products: productsSection(results.products),
    drafts: countSection(results.drafts),
    pendingJobs: countSection(results.pending),
    failedJobs: countSection(results.failed),
    instagram: instagramSection(results.instagram, now),
    fetchedAt: new Date(now).toISOString(),
  };
}

/* ——— واکشی: پنج درخواست موازی، یک‌باره؛ بدون polling ——— */

export interface DashboardPaths {
  products: string;
  drafts: string;
  pending: string;
  failed: string;
  instagram: string;
}

export const DEFAULT_PATHS: DashboardPaths = {
  products: '/products?page=1&pageSize=100',
  drafts: '/drafts?page=1&pageSize=1',
  pending: '/schedule/jobs?page=1&pageSize=1&status=pending',
  failed: '/schedule/jobs?page=1&pageSize=1&status=failed',
  instagram: '/instagram/status',
};

export async function loadDashboard(
  fetcher: Fetcher = defaultFetcher(),
  paths: DashboardPaths = DEFAULT_PATHS,
  now: number = Date.now(),
): Promise<DashboardSnapshot> {
  const [products, drafts, pending, failed, instagram] = await Promise.allSettled([
    getJson(paths.products, fetcher),
    getJson(paths.drafts, fetcher),
    getJson(paths.pending, fetcher),
    getJson(paths.failed, fetcher),
    getJson(paths.instagram, fetcher),
  ]);
  return buildSnapshot({ products, drafts, pending, failed, instagram }, now);
}
