import { z } from 'zod';

/** دامنه تعامل با مشتری — صندوق یکپارچه پیام مستقیم و نظرات اینستاگرام.
 *  سه عمل ارسال متمایزند: direct (پیام مستقیم)، comment_public (پاسخ به نظر)،
 *  comment_private (پاسخ خصوصی به نظر) — هر عمل فقط با مجوز رسمی متا اجرا می‌شود. */

export const INTENTS = ['price_inquiry', 'availability', 'purchase_intent', 'order_tracking', 'shipping', 'returns', 'complaint', 'spam', 'general'] as const;
export type Intent = (typeof INTENTS)[number];

export const CONVERSATION_CHANNELS = ['direct', 'comment'] as const;
export type ConversationChannel = (typeof CONVERSATION_CHANNELS)[number];

export const ENGAGEMENT_CHANNELS = ['direct', 'comment_public', 'comment_private'] as const;
export type EngagementChannel = (typeof ENGAGEMENT_CHANNELS)[number];

export const SALES_STAGES = ['new', 'qualified', 'order_initiated', 'completed', 'unresolved'] as const;
export type SalesStage = (typeof SALES_STAGES)[number];

export const CONVERSATION_STATUSES = ['open', 'needs_attention', 'resolved'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const RESPONSE_STATUSES = ['needs_reply', 'replied', 'escalated', 'no_action'] as const;
export type ResponseStatus = (typeof RESPONSE_STATUSES)[number];

/** نیت‌های کم‌خطری که خودکار شدنشان (به تشخیص مالک) مجاز است؛ شکایت/مرجوعی/پیگیری هرگز خودکار نمی‌شوند. */
export const AUTO_ELIGIBLE_INTENTS = ['price_inquiry', 'availability', 'purchase_intent'] as const;
export type AutoEligibleIntent = (typeof AUTO_ELIGIBLE_INTENTS)[number];

/** آستانه‌های پذیرش ارزیابی دسته‌بندی نیت — پیش از سنجش تعیین شده‌اند و در آزمون eval اعمال می‌شوند. */
export const EVAL_THRESHOLDS = {
  macroF1: 0.85,
  accuracy: 0.85,
  criticalRecall: 0.9,
} as const;
export const CRITICAL_INTENTS: readonly Intent[] = ['complaint', 'spam'];

const TimeHHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'زمان باید به شکل HH:MM باشد.');

export const BusinessHoursSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).max(7, 'حداکثر ۷ روز قابل انتخاب است.'),
  start: TimeHHMM,
  end: TimeHHMM,
}).strict();
export type BusinessHours = z.infer<typeof BusinessHoursSchema>;

export const AutomationConfigSchema = z.object({
  enabled: z.boolean(),
  autoIntents: z.array(z.enum(AUTO_ELIGIBLE_INTENTS)),
  businessHours: BusinessHoursSchema,
  duplicateWindowMinutes: z.number().int().min(1, 'پنجره ضدتکرار باید حداقل ۱ دقیقه باشد.').max(1440),
}).strict();
export type AutomationConfig = z.infer<typeof AutomationConfigSchema>;

/** پیکربندی پیش‌فرض: خاموش — ارسال خودکار به‌صورت پیش‌فرض غیرفعال است. */
export const DEFAULT_AUTOMATION: AutomationConfig = {
  enabled: false,
  autoIntents: [],
  businessHours: { days: [6, 0, 1, 2, 3], start: '09:00', end: '21:00' },
  duplicateWindowMinutes: 60,
};

export const StageUpdateSchema = z.object({ stage: z.enum(SALES_STAGES) }).strict();
export const EscalateSchema = z.object({ escalated: z.boolean() }).strict();
export const ReplySendSchema = z.object({
  text: z.string().trim().min(1, 'متن پاسخ خالی است.').max(4000),
}).strict();
export const RejectSchema = z.object({
  reason: z.string().trim().min(1, 'دلیل رد الزامی است.').max(2000),
}).strict();
export const SuggestSchema = z.object({
  messageId: z.string().uuid('شناسه پیام معتبر نیست.').optional(),
}).strict();
export const ApproveSchema = z.object({
  channel: z.enum(['comment_public', 'comment_private']).optional(),
}).strict();

export interface EngagementConversation {
  id: string;
  channel: ConversationChannel;
  instagramConversationId: string | null;
  instagramCommentId: string | null;
  mediaId: string | null;
  customerId: string;
  customerUsername: string;
  customerName: string;
  subject: string;
  status: ConversationStatus;
  salesStage: SalesStage;
  escalated: boolean;
  unreadCount: number;
  lastIntent: Intent | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EngagementMessage {
  id: string;
  conversationId: string;
  externalId: string | null;
  direction: 'inbound' | 'outbound';
  channel: EngagementChannel;
  text: string;
  intent: Intent | null;
  confidence: number | null;
  urgency: 'low' | 'normal' | 'high';
  needsHuman: boolean;
  responseStatus: ResponseStatus | null;
  sentBy: 'customer' | 'owner' | 'automation';
  errorCode: string | null;
  createdAt: string;
}

export interface ReplySuggestion {
  id: string;
  conversationId: string;
  messageId: string | null;
  text: string;
  intent: Intent | null;
  needsHuman: boolean;
  urgency: 'low' | 'normal' | 'high';
  groundedOn: Record<string, unknown>;
  source: 'rule_based' | 'ai_generated';
  status: 'pending' | 'approved' | 'rejected' | 'sent' | 'failed';
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}
