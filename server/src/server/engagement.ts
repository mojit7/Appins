/** مسیرهای تعامل مشتری — پشت گارد نشست سراسری (به‌جز webhook اینستاگرام).
 *  اصل طلایی: هیچ ارسال واقعی بدون توکن معتبر اینستاگرام انجام نمی‌شود؛ شکست صادقانه گزارش می‌شود.
 *  ممیزی: هر ارسال/رد/تغییر پیکربندی در engagement_audit_log ثبت می‌شود. */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError, ConflictError, ForbiddenError, ValidationError } from '../core/errors.js';
import type { Env } from '../config/env.js';
import { OWNER } from '../data/context.js';
import { EngagementRepository } from '../data/engagement.js';
import { IntegrationConnectionRepository } from '../data/connections.js';
import { InstagramCredentialRepository } from '../data/instagramCredentials.js';
import { ProductRepository } from '../data/products.js';
import { classifyIntent, CLASSIFIER_VERSION, normalizeFa } from '../integrations/ai/intent.js';
import { generateReplySuggestion, REPLY_RULES_VERSION, type VerifiedProductFacts } from '../integrations/ai/reply.js';
import { evaluateAutomation } from '../engagement/automation.js';
import { aiConfigFromEnv } from './ai.js';
import {
  sendDirectMessage, replyToComment, privateReplyToComment,
} from '../integrations/instagram/messaging.js';
import type { FetchLike } from '../integrations/instagram/oauth.js';
import {
  ApproveSchema, EscalateSchema, ReplySendSchema, RejectSchema, StageUpdateSchema, SuggestSchema,
  type EngagementChannel, type Intent,
} from '../domain/engagement.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

export interface EngagementDeps {
  env: Env;
  pool: Pool;
  fetcher?: FetchLike;
}

function stub(code: string): () => never {
  const handler = (): never => {
    throw new AppError('ماژول تعامل مشتری در این فرآیند فعال نیست.', code, 503);
  };
  return handler;
}

interface InboundEvent {
  channel: 'direct' | 'comment';
  conversationRef: string;
  mediaId: string | null;
  customerId: string;
  customerUsername: string;
  externalId: string;
  text: string;
}

/** تجزیه رویداد webhook رسمی متا — پیام مستقیم (messaging) و نظر (changes/field=comments). */
function parseWebhookPayload(body: unknown): InboundEvent[] {
  const root = (typeof body === 'object' && body !== null ? body : {}) as {
    entry?: unknown;
  };
  const events: InboundEvent[] = [];
  if (!Array.isArray(root.entry)) return events;
  for (const entryRaw of root.entry as unknown[]) {
    const entry = (typeof entryRaw === 'object' && entryRaw !== null ? entryRaw : {}) as {
      id?: unknown; messaging?: unknown; changes?: unknown;
    };
    const entryId = typeof entry.id === 'string' ? entry.id : '';
    if (Array.isArray(entry.messaging)) {
      for (const mRaw of entry.messaging as unknown[]) {
        const m = (typeof mRaw === 'object' && mRaw !== null ? mRaw : {}) as {
          sender?: { id?: unknown }; message?: { mid?: unknown; text?: unknown };
        };
        const customerId = typeof m.sender?.id === 'string' ? m.sender.id : '';
        const mid = typeof m.message?.mid === 'string' ? m.message.mid : '';
        const text = typeof m.message?.text === 'string' ? m.message.text : '';
        if (entryId.length > 0 && customerId.length > 0 && mid.length > 0 && text.trim().length > 0) {
          events.push({
            channel: 'direct', conversationRef: entryId, mediaId: null, customerId,
            customerUsername: '', externalId: mid, text,
          });
        }
      }
    }
    if (Array.isArray(entry.changes)) {
      for (const cRaw of entry.changes as unknown[]) {
        const c = (typeof cRaw === 'object' && cRaw !== null ? cRaw : {}) as {
          field?: unknown;
          value?: { id?: unknown; text?: unknown; media_id?: unknown; from?: { id?: unknown; username?: unknown } };
        };
        if (c.field !== 'comments' || typeof c.value !== 'object' || c.value === null) continue;
        const v = c.value;
        const commentId = typeof v.id === 'string' ? v.id : '';
        const text = typeof v.text === 'string' ? v.text : '';
        const customerId = typeof v.from?.id === 'string' ? v.from.id : '';
        if (commentId.length > 0 && customerId.length > 0 && text.trim().length > 0) {
          events.push({
            channel: 'comment', conversationRef: commentId,
            mediaId: typeof v.media_id === 'string' ? v.media_id : null,
            customerId,
            customerUsername: typeof v.from?.username === 'string' ? v.from.username : '',
            externalId: commentId, text,
          });
        }
      }
    }
  }
  return events;
}

export function registerEngagementRoutes(app: FastifyInstance, deps: EngagementDeps | undefined): void {
  const stubbed = (method: 'GET' | 'POST' | 'PUT', url: string): void => {
    app.route({ method, url, handler: stub('ENGAGEMENT_MODULE_NOT_CONFIGURED') });
  };
  const engagementUrls: Array<['GET' | 'POST' | 'PUT', string]> = [
    ['GET', '/engagement/inbox'],
    ['GET', '/engagement/automation'],
    ['GET', '/engagement/audit'],
    ['PUT', '/engagement/automation'],
    ['POST', '/engagement/automation/disable'],
    ['GET', '/engagement/conversations/:id'],
    ['POST', '/engagement/conversations/:id/read'],
    ['POST', '/engagement/conversations/:id/stage'],
    ['POST', '/engagement/conversations/:id/escalate'],
    ['POST', '/engagement/conversations/:id/suggest'],
    ['POST', '/engagement/conversations/:id/reply'],
    ['POST', '/engagement/suggestions/:id/approve'],
    ['POST', '/engagement/suggestions/:id/reject'],
  ];
  if (deps === undefined) {
    for (const [method, url] of engagementUrls) stubbed(method, url);
    stubbed('GET', '/instagram/webhook');
    stubbed('POST', '/instagram/webhook');
    return;
  }

  const { env, pool } = deps;
  const globalFetch = globalThis.fetch;
  const fetcher: FetchLike = deps.fetcher ?? ((url, init) => {
    const res = globalFetch(url as unknown as Parameters<typeof globalFetch>[0], init as unknown as Parameters<typeof globalFetch>[1]);
    return res.then((r) => ({ ok: r.ok, status: r.status, json: () => r.json() as Promise<unknown> }));
  });
  const repo = new EngagementRepository(pool);
  const products = new ProductRepository(pool);
  const credentials = new InstagramCredentialRepository(pool, env.SESSION_SECRET);
  const connections = new IntegrationConnectionRepository(pool);
  const aiCfg = aiConfigFromEnv(env);

  const webhookReady = Boolean(env.INSTAGRAM_APP_SECRET && env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN);
  if (!webhookReady) {
    stubbed('GET', '/instagram/webhook');
    stubbed('POST', '/instagram/webhook');
  }

  async function catalogFacts(): Promise<VerifiedProductFacts[]> {
    const page = await products.list(OWNER, 1, 100);
    return page.items
      .filter((p) => p.status === 'active')
      .map((p) => ({ id: p.id, name: p.name, priceToman: p.priceToman, stock: p.stock }));
  }

  async function connectedToken():
    Promise<{ token: string; igId: string | null } | null> {
    const cred = await credentials.get(OWNER);
    if (cred === null) return null;
    if (new Date(cred.expiresAt).getTime() <= Date.now()) {
      throw new AppError('توکن اینستاگرام منقضی شده است؛ اتصال مجدد لازم است.', 'INSTAGRAM_REAUTH_REQUIRED', 401);
    }
    const conn = await connections.get(OWNER, 'instagram');
    const igId = conn !== null && conn.status === 'connected' ? conn.accountRef : null;
    return { token: cred.token, igId };
  }

  async function sendSuggestionText(conv: {
    id: string; channel: 'direct' | 'comment'; customerId: string; instagramCommentId: string | null;
  }, text: string, op?: 'comment_public' | 'comment_private'):
    Promise<{ messageId: string; channel: EngagementChannel }> {
    const access = await connectedToken();
    if (access === null) {
      throw new AppError('اتصال اینستاگرام پیکربندی نشده است؛ ارسال واقعی ممکن نیست.', 'INSTAGRAM_NOT_CONFIGURED', 503);
    }
    if (conv.channel === 'direct') {
      if (access.igId === null) {
        throw new AppError('شناسه حساب اینستاگرام متصل نیست؛ اتصال را کامل کنید.', 'INSTAGRAM_NOT_CONFIGURED', 503);
      }
      const mid = await sendDirectMessage(access.token, access.igId, conv.customerId, text, fetcher);
      return { messageId: mid, channel: 'direct' };
    }
    if (conv.instagramCommentId === null) {
      throw new AppError('شناسه نظر برای پاسخ موجود نیست.', 'ENGAGEMENT_INVALID_TARGET', 409);
    }
    const channel: EngagementChannel = op === 'comment_private' ? 'comment_private' : 'comment_public';
    if (channel === 'comment_private') {
      if (access.igId === null) {
        throw new AppError('شناسه حساب اینستاگرام متصل نیست؛ پاسخ خصوصی ممکن نیست.', 'INSTAGRAM_NOT_CONFIGURED', 503);
      }
      const mid = await privateReplyToComment(access.token, access.igId, conv.instagramCommentId, text, fetcher);
      return { messageId: mid, channel };
    }
    const mid = await replyToComment(access.token, conv.instagramCommentId, text, fetcher);
    return { messageId: mid, channel };
  }

  async function processInboundEvent(evt: InboundEvent): Promise<{ duplicate: boolean }> {
    const cls = classifyIntent(evt.text);
    const ingested = await repo.ingestInbound(OWNER, {
      channel: evt.channel,
      conversationRef: evt.conversationRef,
      mediaId: evt.mediaId,
      customerId: evt.customerId,
      customerUsername: evt.customerUsername,
      externalId: evt.externalId,
      text: evt.text,
      intent: cls.intent,
      confidence: cls.confidence,
      urgency: cls.urgency,
      needsHuman: cls.needsHuman,
    });
    await repo.audit(OWNER, {
      action: 'engagement.inbound', actor: 'webhook', conversationId: ingested.conversationId,
      outcome: 'succeeded', detail: { intent: cls.intent, duplicate: ingested.messageId === null },
    });
    if (ingested.messageId === null) return { duplicate: true };

    // پیشنهاد پاسخ زمینه‌دار + ارزیابی خودکارسازی — فقط برای پیام مستقیم
    if (evt.channel === 'direct') {
      const facts = await catalogFacts();
      const gen = await generateReplySuggestion({
        intent: cls.intent, text: evt.text, products: facts,
        aiCfg: null, fetcher: undefined,
      });
      if (gen.candidate !== null) {
        const suggestion = await repo.createSuggestion(OWNER, {
          conversationId: ingested.conversationId, messageId: ingested.messageId,
          text: gen.candidate.text, intent: cls.intent,
          needsHuman: gen.candidate.needsHuman, urgency: cls.urgency,
          groundedOn: gen.candidate.groundedOn, source: 'rule_based',
        });
        const cfg = await repo.getAutomationConfig(OWNER);
        const recent = await repo.recentOutboundTexts(OWNER, ingested.conversationId, cfg.duplicateWindowMinutes);
        const decision = evaluateAutomation(cfg, {
          intent: cls.intent, channel: 'direct', needsHuman: cls.needsHuman,
          candidateText: gen.candidate.text, recentOutbound: recent, now: new Date(),
        });
        if (decision.action === 'auto_reply') {
          try {
            const detail = await repo.getConversation(OWNER, ingested.conversationId);
            const sent = await sendSuggestionText(detail.conversation, gen.candidate.text);
            await repo.recordOutbound(OWNER, {
              conversationId: ingested.conversationId, channel: sent.channel,
              text: gen.candidate.text, sentBy: 'automation', intent: cls.intent,
            });
            await repo.updateSuggestion(OWNER, suggestion.id, { status: 'sent' });
            await repo.audit(OWNER, {
              action: 'engagement.auto_reply', actor: 'automation',
              conversationId: ingested.conversationId, outcome: 'succeeded',
              detail: { intent: cls.intent, channel: sent.channel },
            });
          } catch (err) {
            // ارسال خودکار شکست خورد — پیشنهاد برای تأیید انسانی می‌ماند؛ هیچ موفقیت جعلی ثبت نمی‌شود.
            await repo.audit(OWNER, {
              action: 'engagement.auto_reply', actor: 'automation',
              conversationId: ingested.conversationId, outcome: 'blocked',
              detail: { reason: 'instagram_not_configured', error: err instanceof Error ? ((err as { code?: string }).code ?? err.message) : 'unknown' },
            });
          }
        } else {
          await repo.audit(OWNER, {
            action: 'engagement.automation_decision', actor: 'automation',
            conversationId: ingested.conversationId,
            outcome: decision.action === 'blocked' ? 'blocked' : 'succeeded',
            detail: { reason: decision.reason },
          });
        }
      }
    }
    return { duplicate: false };
  }

  // ——— webhook رسمی متا (عمومی؛ امضا/توکن را خودش احراز می‌کند) ———
  if (webhookReady) {
    app.get<{ Querystring: Record<string, unknown> }>('/instagram/webhook', async (req, reply) => {
      const q = req.query as { 'hub.mode'?: unknown; 'hub.verify_token'?: unknown; 'hub.challenge'?: unknown };
      if (q['hub.mode'] === 'subscribe'
        && typeof q['hub.verify_token'] === 'string'
        && q['hub.verify_token'] === env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN
        && typeof q['hub.challenge'] === 'string' && q['hub.challenge'].length > 0) {
        reply.type('text/plain').send(q['hub.challenge']);
        return;
      }
      throw new ForbiddenError('تأیید webhook اینستاگرام ناموفق بود.');
    });

    app.post('/instagram/webhook', async (req, reply) => {
      const header = req.headers['x-hub-signature-256'];
      const provided = Array.isArray(header) ? header[0] : header;
      const raw = req.rawBody ?? '';
      let valid = false;
      if (typeof provided === 'string' && provided.startsWith('sha256=')) {
        const expected = createHmac('sha256', env.INSTAGRAM_APP_SECRET ?? '').update(raw, 'utf8').digest('hex');
        const a = Buffer.from(provided.slice(7), 'utf8');
        const b = Buffer.from(expected, 'utf8');
        valid = a.length === b.length && timingSafeEqual(a, b);
      }
      if (!valid) throw new ForbiddenError('امضای webhook اینستاگرام معتبر نیست.');
      const events = parseWebhookPayload(req.body);
      let duplicates = 0;
      for (const evt of events) {
        try {
          const res = await processInboundEvent(evt);
          if (res.duplicate) duplicates += 1;
        } catch (err) {
          await repo.audit(OWNER, {
            action: 'engagement.webhook_failed', actor: 'webhook', outcome: 'failed',
            detail: { error: err instanceof Error ? err.message : String(err) },
          }).catch(() => {});
        }
      }
      // پاسخ همیشه ۲۰۰ تا متا ارسال تکراری نکند؛ خطاها در ممیزی ثبت شده‌اند.
      reply.send({ ok: true, ingested: events.length, duplicates });
    });
  }

  // ——— صندوق ———
  app.get<{ Querystring: Record<string, unknown> }>('/engagement/inbox', async (req) => {
    const q = req.query as Record<string, unknown>;
    const asString = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
    return repo.listConversations(OWNER, {
      q: asString(q.q),
      channel: asString(q.channel),
      status: asString(q.status),
      intent: asString(q.intent),
      unreadOnly: q.unread === 'true' || q.unread === '1',
      page: Number(q.page ?? 1),
      pageSize: Number(q.pageSize ?? 20),
    });
  });

  app.get<{ Params: { id: string } }>('/engagement/conversations/:id', async (req) => {
    return repo.getConversation(OWNER, req.params.id);
  });

  app.post<{ Params: { id: string } }>('/engagement/conversations/:id/read', async (req) => {
    return repo.markRead(OWNER, req.params.id);
  });

  app.post<{ Params: { id: string } }>('/engagement/conversations/:id/stage', async (req) => {
    const parsed = StageUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('به‌روزرسانی مرحله فروش نامعتبر است.', parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message));
    }
    const updated = await repo.setStage(OWNER, req.params.id, parsed.data.stage);
    await repo.audit(OWNER, {
      action: 'engagement.stage', actor: 'owner', conversationId: req.params.id,
      outcome: 'succeeded', detail: { stage: parsed.data.stage },
    });
    return updated;
  });

  app.post<{ Params: { id: string } }>('/engagement/conversations/:id/escalate', async (req) => {
    const parsed = EscalateSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('درخواست ارجاع نامعتبر است.');
    const updated = await repo.setEscalated(OWNER, req.params.id, parsed.data.escalated);
    await repo.audit(OWNER, {
      action: 'engagement.escalate', actor: 'owner', conversationId: req.params.id,
      outcome: 'succeeded', detail: { escalated: parsed.data.escalated },
    });
    return updated;
  });

  // ——— پیشنهاد پاسخ زمینه‌دار ———
  app.post<{ Params: { id: string } }>('/engagement/conversations/:id/suggest', async (req) => {
    const parsed = SuggestSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new ValidationError('درخواست پیشنهاد نامعتبر است.');
    const detail = await repo.getConversation(OWNER, req.params.id);
    const lastInbound = parsed.data.messageId !== undefined
      ? detail.messages.find((m) => m.id === parsed.data?.messageId && m.direction === 'inbound')
      : [...detail.messages].reverse().find((m) => m.direction === 'inbound');
    if (lastInbound === undefined) {
      throw new ConflictError('پیام ورودی برای پیشنهاد پاسخ یافت نشد.');
    }
    const cls = classifyIntent(lastInbound.text);
    const facts = await catalogFacts();
    const gen = await generateReplySuggestion({
      intent: cls.intent, text: lastInbound.text, products: facts,
      aiCfg, fetcher,
    });
    if (gen.candidate === null) {
      return { ok: true, action: 'no_action' as const, suggestion: null, versions: gen.versions };
    }
    const suggestion = await repo.createSuggestion(OWNER, {
      conversationId: req.params.id, messageId: lastInbound.id,
      text: gen.candidate.text, intent: cls.intent,
      needsHuman: gen.candidate.needsHuman, urgency: cls.urgency,
      groundedOn: gen.candidate.groundedOn, source: gen.source,
    });
    return { ok: true, action: 'suggested' as const, suggestion, dropped: gen.dropped, versions: gen.versions };
  });

  // ——— تأیید و ارسال پیشنهاد (پیش‌فرض: دست مالک) ———
  app.post<{ Params: { id: string } }>('/engagement/suggestions/:id/approve', async (req) => {
    const parsed = ApproveSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new ValidationError('درخواست تأیید نامعتبر است.');
    const suggestion = await repo.getSuggestion(OWNER, req.params.id);
    if (suggestion.status !== 'pending') {
      throw new ConflictError('این پیشنهاد قبلاً پردازش شده است.');
    }
    const detail = await repo.getConversation(OWNER, suggestion.conversationId);
    const conv = detail.conversation;
    if (!detail.messages.some((m) => m.direction === 'inbound')) {
      throw new ForbiddenError('گفت‌وگو پیام ورودی ندارد؛ ارسال خروجی مجاز نیست.');
    }
    const cfg = await repo.getAutomationConfig(OWNER);
    const recent = await repo.recentOutboundTexts(OWNER, conv.id, cfg.duplicateWindowMinutes);
    const norm = normalizeFa(suggestion.text);
    if (recent.some((t) => normalizeFa(t) === norm)) {
      await repo.audit(OWNER, {
        action: 'engagement.send', actor: 'owner', conversationId: conv.id,
        outcome: 'blocked', detail: { reason: 'duplicate_text', suggestionId: suggestion.id },
      });
      throw new ConflictError('متن مشابه اخیراً برای این گفت‌وگو ارسال شده است.');
    }
    try {
      const sent = await sendSuggestionText(conv, suggestion.text, parsed.data.channel);
      await repo.recordOutbound(OWNER, {
        conversationId: conv.id, channel: sent.channel, text: suggestion.text,
        sentBy: 'owner', intent: suggestion.intent as Intent | null,
      });
      await repo.updateSuggestion(OWNER, suggestion.id, { status: 'sent' });
      if (conv.escalated) await repo.setEscalated(OWNER, conv.id, false);
      await repo.audit(OWNER, {
        action: 'engagement.send', actor: 'owner', conversationId: conv.id, outcome: 'succeeded',
        detail: { suggestionId: suggestion.id, channel: sent.channel, messageId: sent.messageId },
      });
      return { ok: true, sent: true, channel: sent.channel, messageId: sent.messageId };
    } catch (err) {
      await repo.updateSuggestion(OWNER, suggestion.id, { status: 'failed' });
      await repo.audit(OWNER, {
        action: 'engagement.send', actor: 'owner', conversationId: conv.id, outcome: 'failed',
        detail: {
          suggestionId: suggestion.id,
          error: err instanceof Error ? ((err as { code?: unknown }).code ?? err.message) : 'unknown',
        },
      });
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>('/engagement/suggestions/:id/reject', async (req) => {
    const parsed = RejectSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('رد پیشنهاد نامعتبر است.', parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message));
    }
    const updated = await repo.updateSuggestion(OWNER, req.params.id, {
      status: 'rejected', rejectionReason: parsed.data.reason,
    });
    await repo.audit(OWNER, {
      action: 'engagement.suggestion_rejected', actor: 'owner',
      conversationId: updated.conversationId, outcome: 'succeeded',
      detail: { suggestionId: updated.id, reason: parsed.data.reason },
    });
    return updated;
  });

  // ——— پاسخ دستی مالک (حالت بازنویسی) ———
  app.post<{ Params: { id: string } }>('/engagement/conversations/:id/reply', async (req) => {
    const parsed = ReplySendSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('متن پاسخ نامعتبر است.', parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message));
    }
    const detail = await repo.getConversation(OWNER, req.params.id);
    const conv = detail.conversation;
    if (!detail.messages.some((m) => m.direction === 'inbound')) {
      throw new ForbiddenError('گفت‌وگو پیام ورودی ندارد؛ ارسال خروجی مجاز نیست.');
    }
    const cfg = await repo.getAutomationConfig(OWNER);
    const recent = await repo.recentOutboundTexts(OWNER, conv.id, cfg.duplicateWindowMinutes);
    if (recent.some((t) => normalizeFa(t) === normalizeFa(parsed.data.text))) {
      throw new ConflictError('متن مشابه اخیراً برای این گفت‌وگو ارسال شده است.');
    }
    try {
      const sent = await sendSuggestionText(conv, parsed.data.text);
      await repo.recordOutbound(OWNER, {
        conversationId: conv.id, channel: sent.channel, text: parsed.data.text,
        sentBy: 'owner', intent: conv.lastIntent,
      });
      await repo.audit(OWNER, {
        action: 'engagement.manual_reply', actor: 'owner', conversationId: conv.id,
        outcome: 'succeeded', detail: { channel: sent.channel },
      });
      return { ok: true, sent: true, channel: sent.channel, messageId: sent.messageId };
    } catch (err) {
      await repo.audit(OWNER, {
        action: 'engagement.manual_reply', actor: 'owner', conversationId: conv.id, outcome: 'failed',
        detail: { error: err instanceof Error ? ((err as { code?: unknown }).code ?? err.message) : 'unknown' },
      });
      throw err;
    }
  });

  // ——— پیکربندی خودکارسازی + کلید توقف فوری ———
  app.get('/engagement/automation', async () => {
    return repo.getAutomationConfig(OWNER);
  });

  app.put('/engagement/automation', async (req) => {
    const cfg = await repo.updateAutomationConfig(OWNER, req.body);
    await repo.audit(OWNER, {
      action: 'engagement.config_updated', actor: 'owner', outcome: 'succeeded',
      detail: { enabled: cfg.enabled, autoIntents: cfg.autoIntents },
    });
    return cfg;
  });

  app.post('/engagement/automation/disable', async () => {
    const cfg = await repo.getAutomationConfig(OWNER);
    const updated = await repo.updateAutomationConfig(OWNER, { ...cfg, enabled: false });
    await repo.audit(OWNER, {
      action: 'engagement.automation_disabled', actor: 'owner', outcome: 'succeeded',
      detail: {},
    });
    return updated;
  });

  app.get<{ Querystring: Record<string, unknown> }>('/engagement/audit', async (req) => {
    const q = req.query as { limit?: unknown };
    const limit = typeof q.limit === 'string' ? Number(q.limit) : 50;
    return { items: await repo.listAudit(OWNER, limit) };
  });
}
