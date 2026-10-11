import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { AppError, ValidationError } from '../core/errors.js';
import type { Env } from '../config/env.js';
import { OWNER } from '../data/context.js';
import { DraftRepository } from '../data/drafts.js';
import { ProductRepository } from '../data/products.js';
import { generateCaptionOptions } from '../integrations/ai/pipeline.js';
import { PROMPT_VERSION, type CaptionGoal, type CaptionLength, type CaptionTone } from '../integrations/ai/prompt.js';
import type { AiProviderConfig, FetchLike } from '../integrations/ai/client.js';

/** مسیرهای استودیوی محتوا — پشت گارد نشست سراسری.
 *  وضعیت پیاده‌سازی از «تأیید زنده» جدا است: liveVerified همیشه false مگر آزمون واقعی. */

export interface AiDeps {
  env: Env;
  pool: Pool;
  fetcher?: FetchLike;
}

export function aiConfigFromEnv(env: Env): AiProviderConfig | null {
  if (!env.AI_PROVIDER_API_KEY || !env.AI_PROVIDER_BASE_URL || !env.AI_PROVIDER_MODEL) return null;
  return {
    baseUrl: env.AI_PROVIDER_BASE_URL,
    model: env.AI_PROVIDER_MODEL,
    apiKey: env.AI_PROVIDER_API_KEY,
    timeoutMs: env.AI_TIMEOUT_MS,
  };
}

const GenerateBodySchema = z.object({
  productId: z.string().uuid('شناسه محصول معتبر نیست.'),
  tone: z.enum(['friendly', 'formal', 'story']).default('friendly'),
  length: z.enum(['short', 'medium', 'long']).default('medium'),
  goal: z.enum(['awareness', 'sale', 'engagement']).default('awareness'),
}).strict();

const STUB_ROUTES: Array<{ method: 'GET' | 'POST' | 'PATCH'; url: string }> = [
  { method: 'GET', url: '/products' },
  { method: 'GET', url: '/drafts' },
  { method: 'POST', url: '/drafts' },
  { method: 'GET', url: '/drafts/:id' },
  { method: 'PATCH', url: '/drafts/:id' },
  { method: 'POST', url: '/drafts/:id/duplicate' },
  { method: 'POST', url: '/ai/caption/generate' },
];

export function registerAiRoutes(app: FastifyInstance, deps: AiDeps | undefined): void {
  if (!deps) {
    for (const r of STUB_ROUTES) {
      app.route({
        method: r.method,
        url: r.url,
        handler: async () => {
          throw new AppError('ماژول استودیوی محتوا در این فرآیند فعال نیست.', 'CONTENT_MODULE_NOT_CONFIGURED', 503);
        },
      });
    }
    return;
  }

  const { env, pool } = deps;
  const globalFetch = globalThis.fetch;
  const fetcher: FetchLike = deps.fetcher ?? ((url, init) => {
    const res = globalFetch(url as unknown as Parameters<typeof globalFetch>[0], init as unknown as Parameters<typeof globalFetch>[1]);
    return res.then((r) => ({ ok: r.ok, status: r.status, json: () => r.json() as Promise<unknown> }));
  });
  const products = new ProductRepository(pool);
  const drafts = new DraftRepository(pool);
  const cfg = aiConfigFromEnv(env);

  app.get<{ Querystring: { page?: unknown; pageSize?: unknown } }>('/products', async (req) => {
    const page = typeof req.query.page === 'number' ? req.query.page : 1;
    const pageSize = typeof req.query.pageSize === 'number' ? req.query.pageSize : 20;
    return products.list(OWNER, page, pageSize);
  });

  app.get<{ Querystring: { page?: unknown; pageSize?: unknown } }>('/drafts', async (req) => {
    const page = typeof req.query.page === 'number' ? req.query.page : 1;
    const pageSize = typeof req.query.pageSize === 'number' ? req.query.pageSize : 20;
    return drafts.list(OWNER, page, pageSize);
  });

  app.post('/drafts', async (req) => {
    return drafts.create(OWNER, req.body);
  });

  app.get<{ Params: { id: string } }>('/drafts/:id', async (req) => {
    return drafts.get(OWNER, req.params.id);
  });

  app.patch<{ Params: { id: string } }>('/drafts/:id', async (req) => {
    return drafts.update(OWNER, req.params.id, req.body);
  });

  app.post<{ Params: { id: string } }>('/drafts/:id/duplicate', async (req) => {
    return drafts.duplicate(OWNER, req.params.id);
  });

  app.post('/ai/caption/generate', async (req) => {
    if (!cfg) {
      throw new AppError('ارائه‌دهنده هوش مصنوعی پیکربندی نشده است (AI_PROVIDER_*).', 'AI_NOT_CONFIGURED', 503);
    }
    const parsed = GenerateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('درخواست تولید کپشن نامعتبر است.', parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message));
    }
    const b = parsed.data;
    const product = await products.get(OWNER, b.productId);
    const result = await generateCaptionOptions(cfg, {
      product: {
        name: product.name,
        description: product.description,
        priceToman: product.priceToman,
        stock: product.stock,
        sku: product.sku,
      },
      tone: b.tone as CaptionTone,
      length: b.length as CaptionLength,
      goal: b.goal as CaptionGoal,
    }, fetcher);
    return {
      promptVersion: PROMPT_VERSION,
      model: cfg.model,
      options: result.options,
      dropped: result.dropped,
      liveVerified: false,
    };
  });
}
