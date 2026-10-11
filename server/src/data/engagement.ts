/** مخزن تعامل مشتری — ماندگار روی Postgres با idempotency رویداد (کلید external_id یکتا). */

import type { Pool } from 'pg';
import { NotFoundError, ValidationError } from '../core/errors.js';
import { assertActor, type ActorContext } from './context.js';
import { withDbErrors } from '../db/errors.js';
import {
  AutomationConfigSchema, DEFAULT_AUTOMATION,
  type AutomationConfig, type EngagementChannel, type EngagementConversation,
  type EngagementMessage, type Intent, type ReplySuggestion, type SalesStage,
} from '../domain/engagement.js';

interface ConversationRow {
  id: string; channel: string; instagram_conversation_id: string | null; instagram_comment_id: string | null;
  media_id: string | null; customer_id: string; customer_username: string; customer_name: string;
  subject: string; status: string; sales_stage: string; escalated: boolean; unread_count: number;
  last_intent: string | null; last_message_at: Date | null; created_at: Date; updated_at: Date;
}

function toConversation(r: ConversationRow): EngagementConversation {
  return {
    id: r.id,
    channel: r.channel as EngagementConversation['channel'],
    instagramConversationId: r.instagram_conversation_id,
    instagramCommentId: r.instagram_comment_id,
    mediaId: r.media_id,
    customerId: r.customer_id,
    customerUsername: r.customer_username,
    customerName: r.customer_name,
    subject: r.subject,
    status: r.status as EngagementConversation['status'],
    salesStage: r.sales_stage as EngagementConversation['salesStage'],
    escalated: r.escalated,
    unreadCount: r.unread_count,
    lastIntent: (r.last_intent ?? null) as Intent | null,
    lastMessageAt: r.last_message_at === null ? null : r.last_message_at.toISOString(),
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

interface MessageRow {
  id: string; conversation_id: string; external_id: string | null; direction: string; channel: string;
  text: string; intent: string | null; confidence: number | null; urgency: string; needs_human: boolean;
  response_status: string | null; sent_by: string; error_code: string | null; created_at: Date;
}

function toMessage(r: MessageRow): EngagementMessage {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    externalId: r.external_id,
    direction: r.direction as EngagementMessage['direction'],
    channel: r.channel as EngagementChannel,
    text: r.text,
    intent: (r.intent ?? null) as Intent | null,
    confidence: r.confidence,
    urgency: r.urgency as EngagementMessage['urgency'],
    needsHuman: r.needs_human,
    responseStatus: (r.response_status ?? null) as EngagementMessage['responseStatus'],
    sentBy: r.sent_by as EngagementMessage['sentBy'],
    errorCode: r.error_code,
    createdAt: r.created_at.toISOString(),
  };
}

interface SuggestionRow {
  id: string; conversation_id: string; message_id: string | null; text: string; intent: string | null;
  needs_human: boolean; urgency: string; grounded_on: Record<string, unknown>; source: string;
  status: string; rejection_reason: string | null; created_at: Date; updated_at: Date;
}

function toSuggestion(r: SuggestionRow): ReplySuggestion {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    messageId: r.message_id,
    text: r.text,
    intent: (r.intent ?? null) as Intent | null,
    needsHuman: r.needs_human,
    urgency: r.urgency as ReplySuggestion['urgency'],
    groundedOn: r.grounded_on ?? {},
    source: r.source as ReplySuggestion['source'],
    status: r.status as ReplySuggestion['status'],
    rejectionReason: r.rejection_reason,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export interface InboundInput {
  channel: 'direct' | 'comment';
  conversationRef: string;
  mediaId?: string | null;
  customerId: string;
  customerUsername?: string;
  customerName?: string;
  externalId: string;
  text: string;
  intent: Intent;
  confidence: number;
  urgency: 'low' | 'normal' | 'high';
  needsHuman: boolean;
}

export interface ConversationFilters {
  q?: string;
  channel?: string;
  status?: string;
  intent?: string;
  unreadOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export class EngagementRepository {
  constructor(private readonly pool: Pool) {}

  /** دریافت رویداد ورودی — idempotent با کلید یکتا external_id؛ پیام تکراری هیچ تغییری نمی‌دهد. */
  async ingestInbound(ctx: ActorContext | null | undefined, input: InboundInput):
    Promise<{ conversationId: string; messageId: string | null }> {
    assertActor(ctx);
    if (input.conversationRef.trim().length === 0 || input.customerId.trim().length === 0 || input.externalId.trim().length === 0) {
      throw new ValidationError('شناسه‌های رویداد ورودی ناقص است.');
    }
    if (input.text.trim().length === 0) throw new ValidationError('متن پیام ورودی خالی است.');
    const convCol = input.channel === 'direct' ? 'instagram_conversation_id' : 'instagram_comment_id';
    return withDbErrors(async () => {
      await this.pool.query(
        'INSERT INTO engagement_conversations (channel, ' + convCol + ', media_id, customer_id, customer_username, customer_name, subject) '
        + 'VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
        [input.channel, input.conversationRef, input.mediaId ?? null, input.customerId,
          input.customerUsername ?? '', input.customerName ?? '', input.text.slice(0, 120)],
      );
      const conv = await this.pool.query<{ id: string }>(
        'SELECT id FROM engagement_conversations WHERE ' + convCol + ' = $1',
        [input.conversationRef],
      );
      const conversationId = conv.rows[0]?.id;
      if (conversationId === undefined) throw new Error('گفت‌وگو پس از درج یافت نشد.');
      const msgChannel: EngagementChannel = input.channel === 'direct' ? 'direct' : 'comment_public';
      const ins = await this.pool.query<{ id: string }>(
        'INSERT INTO engagement_messages (conversation_id, external_id, direction, channel, text, intent, confidence, urgency, needs_human, response_status, sent_by) '
        + "VALUES ($1,$2,'inbound',$3,$4,$5,$6,$7,$8,$9,'customer') ON CONFLICT (external_id) DO NOTHING RETURNING id",
        [conversationId, input.externalId, msgChannel, input.text, input.intent, input.confidence,
          input.urgency, input.needsHuman, input.needsHuman ? 'escalated' : 'needs_reply'],
      );
      if (ins.rows.length === 0) return { conversationId, messageId: null };
      await this.pool.query(
        'UPDATE engagement_conversations SET unread_count = unread_count + 1, last_message_at = now(), '
        + 'last_intent = $2, subject = $3, updated_at = now(), status = CASE '
        + "WHEN $4 THEN 'needs_attention' WHEN status = 'resolved' THEN 'open' ELSE status END WHERE id = $1",
        [conversationId, input.intent, input.text.slice(0, 120), input.needsHuman],
      );
      return { conversationId, messageId: ins.rows[0]?.id ?? null };
    });
  }

  /** ساخت پرس‌وجوی فیلتر — جاگذاری متوالی پارامترها برای هر شرط. */
  private static buildFilters(f: ConversationFilters): { whereSql: string; params: unknown[] } {
    const parts: string[] = [];
    const params: unknown[] = [];
    const raw = (clause: string, ...values: unknown[]): void => {
      let idx = 0;
      const replaced = clause.replace(/\?/g, () => '$' + (params.length + 1 + (idx++)));
      params.push(...values);
      parts.push(replaced);
    };
    if (typeof f.q === 'string' && f.q.trim().length > 0) {
      const like = '%' + f.q.trim() + '%';
      raw('(customer_username ILIKE ? OR customer_name ILIKE ? OR subject ILIKE ?)', like, like, like);
    }
    if (f.channel === 'direct' || f.channel === 'comment') {
      raw('channel = ?', f.channel);
    }
    if (f.status === 'open' || f.status === 'needs_attention' || f.status === 'resolved') {
      raw('status = ?', f.status);
    }
    if (typeof f.intent === 'string' && f.intent.length > 0) {
      raw('last_intent = ?', f.intent);
    }
    if (f.unreadOnly === true) {
      parts.push('unread_count > 0');
    }
    return { whereSql: parts.length > 0 ? ' WHERE ' + parts.join(' AND ') : '', params };
  }

  async listConversations(ctx: ActorContext | null | undefined, f: ConversationFilters):
    Promise<{ items: EngagementConversation[]; total: number; page: number; pageSize: number }> {
    assertActor(ctx);
    const page = Math.max(1, Math.floor(f.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(f.pageSize ?? 20)));
    const { whereSql, params } = EngagementRepository.buildFilters(f);
    return withDbErrors(async () => {
      const total = (await this.pool.query<{ c: number }>(
        'SELECT count(*)::int AS c FROM engagement_conversations' + whereSql, params,
      )).rows[0]?.c ?? 0;
      const r = await this.pool.query<ConversationRow>(
        'SELECT * FROM engagement_conversations' + whereSql
        + ' ORDER BY COALESCE(last_message_at, created_at) DESC LIMIT $' + (params.length + 1)
        + ' OFFSET $' + (params.length + 2),
        [...params, pageSize, (page - 1) * pageSize],
      );
      return { items: r.rows.map(toConversation), total, page, pageSize };
    });
  }

  async getConversation(ctx: ActorContext | null | undefined, id: string):
    Promise<{ conversation: EngagementConversation; messages: EngagementMessage[]; suggestions: ReplySuggestion[] }> {
    assertActor(ctx);
    const conv = await this.getConversationRow(id);
    const messages = await this.pool.query<MessageRow>(
      'SELECT * FROM engagement_messages WHERE conversation_id = $1 ORDER BY created_at ASC', [id],
    );
    const suggestions = await this.pool.query<SuggestionRow>(
      'SELECT * FROM engagement_reply_suggestions WHERE conversation_id = $1 ORDER BY created_at DESC', [id],
    );
    return {
      conversation: conv,
      messages: messages.rows.map(toMessage),
      suggestions: suggestions.rows.map(toSuggestion),
    };
  }

  private async getConversationRow(id: string): Promise<EngagementConversation> {
    const r = await this.pool.query<ConversationRow>('SELECT * FROM engagement_conversations WHERE id = $1', [id]);
    const row = r.rows[0];
    if (!row) throw new NotFoundError('گفت‌وگو یافت نشد.');
    return toConversation(row);
  }

  async markRead(ctx: ActorContext | null | undefined, id: string): Promise<EngagementConversation> {
    assertActor(ctx);
    return withDbErrors(async () => {
      const r = await this.pool.query<ConversationRow>(
        'UPDATE engagement_conversations SET unread_count = 0, updated_at = now() WHERE id = $1 RETURNING *', [id],
      );
      if (!r.rows[0]) throw new NotFoundError('گفت‌وگو یافت نشد.');
      return toConversation(r.rows[0]);
    });
  }

  async setStage(ctx: ActorContext | null | undefined, id: string, stage: SalesStage): Promise<EngagementConversation> {
    assertActor(ctx);
    return withDbErrors(async () => {
      const r = await this.pool.query<ConversationRow>(
        'UPDATE engagement_conversations SET sales_stage = $2, updated_at = now() WHERE id = $1 RETURNING *', [id, stage],
      );
      if (!r.rows[0]) throw new NotFoundError('گفت‌وگو یافت نشد.');
      return toConversation(r.rows[0]);
    });
  }

  async setEscalated(ctx: ActorContext | null | undefined, id: string, escalated: boolean): Promise<EngagementConversation> {
    assertActor(ctx);
    return withDbErrors(async () => {
      const r = await this.pool.query<ConversationRow>(
        "UPDATE engagement_conversations SET escalated = $2, status = CASE WHEN $2 THEN 'needs_attention' ELSE status END, updated_at = now() WHERE id = $1 RETURNING *",
        [id, escalated],
      );
      if (!r.rows[0]) throw new NotFoundError('گفت‌وگو یافت نشد.');
      return toConversation(r.rows[0]);
    });
  }

  async createSuggestion(ctx: ActorContext | null | undefined, input: {
    conversationId: string; messageId: string | null; text: string; intent: Intent | null;
    needsHuman: boolean; urgency: 'low' | 'normal' | 'high';
    groundedOn: Record<string, unknown>; source: 'rule_based' | 'ai_generated';
  }): Promise<ReplySuggestion> {
    assertActor(ctx);
    if (input.text.trim().length === 0) throw new ValidationError('متن پیشنهاد خالی است.');
    return withDbErrors(async () => {
      const r = await this.pool.query<SuggestionRow>(
        'INSERT INTO engagement_reply_suggestions (conversation_id, message_id, text, intent, needs_human, urgency, grounded_on, source) '
        + 'VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING *',
        [input.conversationId, input.messageId, input.text, input.intent, input.needsHuman,
          input.urgency, JSON.stringify(input.groundedOn), input.source],
      );
      const row = r.rows[0];
      if (!row) throw new Error('درج پیشنهاد نتیجه‌ای برنگرداند.');
      return toSuggestion(row);
    });
  }

  async getSuggestion(ctx: ActorContext | null | undefined, id: string): Promise<ReplySuggestion> {
    assertActor(ctx);
    const r = await this.pool.query<SuggestionRow>('SELECT * FROM engagement_reply_suggestions WHERE id = $1', [id]);
    if (!r.rows[0]) throw new NotFoundError('پیشنهاد پاسخ یافت نشد.');
    return toSuggestion(r.rows[0]);
  }

  async updateSuggestion(ctx: ActorContext | null | undefined, id: string, patch: {
    status?: 'pending' | 'approved' | 'rejected' | 'sent' | 'failed';
    rejectionReason?: string | null;
  }): Promise<ReplySuggestion> {
    assertActor(ctx);
    return withDbErrors(async () => {
      const sets: string[] = ['updated_at = now()'];
      const params: unknown[] = [];
      if (patch.status !== undefined) {
        params.push(patch.status);
        sets.push('status = $' + params.length);
      }
      if (patch.rejectionReason !== undefined) {
        params.push(patch.rejectionReason);
        sets.push('rejection_reason = $' + params.length);
      }
      params.push(id);
      const r = await this.pool.query<SuggestionRow>(
        'UPDATE engagement_reply_suggestions SET ' + sets.join(', ') + ' WHERE id = $' + params.length + ' RETURNING *',
        params,
      );
      if (!r.rows[0]) throw new NotFoundError('پیشنهاد پاسخ یافت نشد.');
      return toSuggestion(r.rows[0]);
    });
  }

  async recordOutbound(ctx: ActorContext | null | undefined, input: {
    conversationId: string; channel: EngagementChannel; text: string;
    sentBy: 'owner' | 'automation'; intent: Intent | null;
  }): Promise<EngagementMessage> {
    assertActor(ctx);
    if (input.text.trim().length === 0) throw new ValidationError('متن پیام خروجی خالی است.');
    return withDbErrors(async () => {
      const r = await this.pool.query<MessageRow>(
        "INSERT INTO engagement_messages (conversation_id, direction, channel, text, intent, response_status, sent_by) "
        + "VALUES ($1,'outbound',$2,$3,$4,'replied',$5) RETURNING *",
        [input.conversationId, input.channel, input.text, input.intent, input.sentBy],
      );
      await this.pool.query(
        'UPDATE engagement_conversations SET last_message_at = now(), updated_at = now() WHERE id = $1',
        [input.conversationId],
      );
      const row = r.rows[0];
      if (!row) throw new Error('درج پیام خروجی نتیجه‌ای برنگرداند.');
      return toMessage(row);
    });
  }

  async recentOutboundTexts(ctx: ActorContext | null | undefined, conversationId: string, windowMinutes: number):
    Promise<string[]> {
    assertActor(ctx);
    const r = await this.pool.query<{ text: string }>(
      "SELECT text FROM engagement_messages WHERE conversation_id = $1 AND direction = 'outbound' "
      + "AND created_at >= now() - interval '1 minute' * $2",
      [conversationId, Math.max(1, Math.floor(windowMinutes))],
    );
    return r.rows.map((row) => row.text);
  }

  async getAutomationConfig(ctx: ActorContext | null | undefined): Promise<AutomationConfig> {
    assertActor(ctx);
    const r = await this.pool.query<{ enabled: boolean; auto_intents: string[]; business_hours: Record<string, unknown>; duplicate_window_minutes: number }>(
      'SELECT enabled, auto_intents, business_hours, duplicate_window_minutes FROM engagement_automation_config WHERE singleton = true',
    );
    const row = r.rows[0];
    if (!row) return DEFAULT_AUTOMATION;
    const parsed = AutomationConfigSchema.safeParse({
      enabled: row.enabled,
      autoIntents: row.auto_intents ?? [],
      businessHours: row.business_hours,
      duplicateWindowMinutes: row.duplicate_window_minutes,
    });
    return parsed.success ? parsed.data : DEFAULT_AUTOMATION;
  }

  async updateAutomationConfig(ctx: ActorContext | null | undefined, raw: unknown): Promise<AutomationConfig> {
    assertActor(ctx);
    const parsed = AutomationConfigSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError('پیکربندی خودکارسازی نامعتبر است.', parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message));
    }
    const cfg = parsed.data;
    return withDbErrors(async () => {
      await this.pool.query(
        'UPDATE engagement_automation_config SET enabled = $1, auto_intents = $2, business_hours = $3::jsonb, duplicate_window_minutes = $4, updated_at = now() WHERE singleton = true',
        [cfg.enabled, cfg.autoIntents, JSON.stringify(cfg.businessHours), cfg.duplicateWindowMinutes],
      );
      return cfg;
    });
  }

  async audit(ctx: ActorContext | null | undefined, entry: {
    action: string; actor: 'owner' | 'automation' | 'webhook';
    conversationId?: string | null; outcome: 'succeeded' | 'failed' | 'blocked'; detail?: Record<string, unknown>;
  }): Promise<void> {
    assertActor(ctx);
    await this.pool.query(
      'INSERT INTO engagement_audit_log (action, actor, conversation_id, outcome, detail) VALUES ($1,$2,$3,$4,$5::jsonb)',
      [entry.action, entry.actor, entry.conversationId ?? null, entry.outcome, JSON.stringify(entry.detail ?? {})],
    );
  }

  async listAudit(ctx: ActorContext | null | undefined, limit = 50):
    Promise<Array<{ id: number; action: string; actor: string; conversationId: string | null; outcome: string; detail: Record<string, unknown>; createdAt: string }>> {
    assertActor(ctx);
    const r = await this.pool.query<{
      id: string; action: string; actor: string; conversation_id: string | null; outcome: string;
      detail: Record<string, unknown>; created_at: Date;
    }>('SELECT * FROM engagement_audit_log ORDER BY created_at DESC LIMIT $1', [Math.min(200, Math.max(1, limit))]);
    return r.rows.map((row) => ({
      id: Number(row.id),
      action: row.action,
      actor: row.actor,
      conversationId: row.conversation_id,
      outcome: row.outcome,
      detail: row.detail ?? {},
      createdAt: row.created_at.toISOString(),
    }));
  }
}
