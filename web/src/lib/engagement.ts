/** کلاینت صندوق گفت‌وگو — همان الگوی dashboard.ts: واکشی تزریق‌پذیر، حالت‌های صریح، بدون داده جعلی. */

export const API_ROOT = '/api';

export type Fetcher = (path: string, init?: { method?: string; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface ApiFailure extends Error { status: number; code: string }

function defaultFetcher(): Fetcher {
  return (path, init) => fetch(API_ROOT + path, {
    method: init?.method ?? 'GET',
    headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init?.body,
  });
}

async function request(path: string, init: { method?: string; body?: unknown } | undefined, fetcher: Fetcher): Promise<unknown> {
  let res: { ok: boolean; status: number; json(): Promise<unknown> };
  try {
    res = await fetcher(path, init?.body === undefined
      ? { method: init?.method }
      : { method: init?.method ?? 'POST', body: JSON.stringify(init.body) });
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
    } catch { /* بدنه معتبر نبود */ }
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

export interface InboxItem {
  id: string;
  channel: 'direct' | 'comment';
  customerUsername: string;
  customerName: string;
  subject: string;
  status: 'open' | 'needs_attention' | 'resolved';
  salesStage: string;
  escalated: boolean;
  unreadCount: number;
  lastIntent: string | null;
  lastMessageAt: string | null;
}

export interface InboxMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  channel: string;
  text: string;
  intent: string | null;
  needsHuman: boolean;
  sentBy: string;
  createdAt: string;
}

export interface InboxSuggestion {
  id: string;
  text: string;
  intent: string | null;
  needsHuman: boolean;
  source: string;
  status: string;
  rejectionReason: string | null;
  groundedOn: Record<string, unknown>;
}

export interface ConversationDetail {
  conversation: InboxItem;
  messages: InboxMessage[];
  suggestions: InboxSuggestion[];
}

export interface AutomationSettings {
  enabled: boolean;
  autoIntents: string[];
  businessHours: { days: number[]; start: string; end: string };
  duplicateWindowMinutes: number;
}

export const INTENT_LABELS: Record<string, string> = {
  price_inquiry: 'استعلام قیمت',
  availability: 'موجودی',
  purchase_intent: 'قصد خرید',
  order_tracking: 'پیگیری سفارش',
  shipping: 'ارسال',
  returns: 'مرجوعی',
  complaint: 'شکایت',
  spam: 'هرزنامه',
  general: 'عمومی',
};

export const CHANNEL_LABELS: Record<string, string> = {
  direct: 'پیام مستقیم',
  comment: 'نظر پست',
  comment_public: 'پاسخ عمومی به نظر',
  comment_private: 'پاسخ خصوصی به نظر',
};

export const STAGE_LABELS: Record<string, string> = {
  new: 'پیام جدید',
  qualified: 'سرنخ واجد شرایط',
  order_initiated: 'شروع سفارش',
  completed: 'خرید کامل‌شده',
  unresolved: 'بی‌نتیجه',
};

export function intentLabel(intent: string | null): string {
  if (intent === null) return 'نامشخص';
  return INTENT_LABELS[intent] ?? intent;
}

export async function loadInbox(params: { q?: string; channel?: string; unread?: boolean }, fetcher: Fetcher = defaultFetcher()): Promise<{ items: InboxItem[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.q !== undefined && params.q.length > 0) qs.set('q', params.q);
  if (params.channel !== undefined && params.channel.length > 0) qs.set('channel', params.channel);
  if (params.unread === true) qs.set('unread', 'true');
  const page = await request('/engagement/inbox?' + qs.toString(), undefined, fetcher) as { items: InboxItem[]; total: number };
  return { items: Array.isArray(page.items) ? page.items : [], total: page.total ?? 0 };
}

export async function loadConversation(id: string, fetcher: Fetcher = defaultFetcher()): Promise<ConversationDetail> {
  return request('/engagement/conversations/' + encodeURIComponent(id), undefined, fetcher) as Promise<ConversationDetail>;
}

export async function markConversationRead(id: string, fetcher: Fetcher = defaultFetcher()): Promise<InboxItem> {
  return request('/engagement/conversations/' + encodeURIComponent(id) + '/read', { method: 'POST' }, fetcher) as Promise<InboxItem>;
}

export async function updateStage(id: string, stage: string, fetcher: Fetcher = defaultFetcher()): Promise<InboxItem> {
  return request('/engagement/conversations/' + encodeURIComponent(id) + '/stage', { method: 'POST', body: { stage } }, fetcher) as Promise<InboxItem>;
}

export async function setEscalated(id: string, escalated: boolean, fetcher: Fetcher = defaultFetcher()): Promise<InboxItem> {
  return request('/engagement/conversations/' + encodeURIComponent(id) + '/escalate', { method: 'POST', body: { escalated } }, fetcher) as Promise<InboxItem>;
}

export async function suggestReply(id: string, fetcher: Fetcher = defaultFetcher()): Promise<{ action: string; suggestion: InboxSuggestion | null }> {
  return request('/engagement/conversations/' + encodeURIComponent(id) + '/suggest', { method: 'POST', body: {} }, fetcher) as Promise<{ action: string; suggestion: InboxSuggestion | null }>;
}

export async function approveSuggestion(id: string, fetcher: Fetcher = defaultFetcher()): Promise<{ ok: boolean; sent: boolean; channel?: string }> {
  return request('/engagement/suggestions/' + encodeURIComponent(id) + '/approve', { method: 'POST', body: {} }, fetcher) as Promise<{ ok: boolean; sent: boolean; channel?: string }>;
}

export async function rejectSuggestion(id: string, reason: string, fetcher: Fetcher = defaultFetcher()): Promise<InboxSuggestion> {
  return request('/engagement/suggestions/' + encodeURIComponent(id) + '/reject', { method: 'POST', body: { reason } }, fetcher) as Promise<InboxSuggestion>;
}

export async function loadAutomation(fetcher: Fetcher = defaultFetcher()): Promise<AutomationSettings> {
  return request('/engagement/automation', undefined, fetcher) as Promise<AutomationSettings>;
}

export async function updateAutomation(cfg: AutomationSettings, fetcher: Fetcher = defaultFetcher()): Promise<AutomationSettings> {
  return request('/engagement/automation', { method: 'PUT', body: cfg }, fetcher) as Promise<AutomationSettings>;
}

export async function disableAutomation(fetcher: Fetcher = defaultFetcher()): Promise<AutomationSettings> {
  return request('/engagement/automation/disable', { method: 'POST' }, fetcher) as Promise<AutomationSettings>;
}
