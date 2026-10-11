import type { Pool } from 'pg';
import { NotFoundError, ValidationError } from '../core/errors.js';
import { DraftCreateSchema, DraftUpdateSchema, type Draft, type DraftCreateInput, type DraftUpdateInput } from '../domain/draft.js';
import { clampPage, type Page } from '../domain/product.js';
import { assertActor, type ActorContext } from './context.js';
import { withDbErrors } from '../db/errors.js';

interface DraftRow {
  id: string;
  title: string;
  caption: string;
  product_id: string | null;
  status: Draft['status'];
  scheduled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function toDraft(r: DraftRow): Draft {
  return {
    id: r.id,
    title: r.title,
    caption: r.caption,
    productId: r.product_id,
    status: r.status,
    scheduledAt: r.scheduled_at ? r.scheduled_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export class DraftRepository {
  constructor(private readonly pool: Pool) {}

  async create(ctx: ActorContext | null | undefined, raw: unknown): Promise<Draft> {
    assertActor(ctx);
    const parsed = DraftCreateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError('پیش‌نویس نامعتبر است.', parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message));
    }
    const d: DraftCreateInput = parsed.data;
    return withDbErrors(async () => {
      const r = await this.pool.query<DraftRow>(
        'INSERT INTO content_drafts (title, caption, product_id, status, scheduled_at) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [d.title, d.caption, d.productId, d.status, d.scheduledAt],
      );
      const row = r.rows[0];
      if (!row) throw new Error('درج پیش‌نویس نتیجه‌ای برنگرداند.');
      return toDraft(row);
    });
  }

  async get(ctx: ActorContext | null | undefined, id: string): Promise<Draft> {
    assertActor(ctx);
    const r = await this.pool.query<DraftRow>('SELECT * FROM content_drafts WHERE id = $1', [id]);
    const row = r.rows[0];
    if (!row) throw new NotFoundError('پیش‌نویس یافت نشد.');
    return toDraft(row);
  }

  async list(ctx: ActorContext | null | undefined, page = 1, pageSize = 20): Promise<Page<Draft>> {
    assertActor(ctx);
    const { page: p, pageSize: ps } = clampPage(page, pageSize);
    const total = (await this.pool.query<{ c: number }>('SELECT count(*)::int AS c FROM content_drafts')).rows[0]?.c ?? 0;
    const r = await this.pool.query<DraftRow>(
      'SELECT * FROM content_drafts ORDER BY created_at DESC, id LIMIT $1 OFFSET $2',
      [ps, (p - 1) * ps],
    );
    return { items: r.rows.map(toDraft), total, page: p, pageSize: ps };
  }

  /** ویرایش/ذخیره — پس از اعتبارسنجی، قید زمان‌بندی روی مقدار ادغام‌شده چک می‌شود. */
  async update(ctx: ActorContext | null | undefined, id: string, raw: unknown): Promise<Draft> {
    assertActor(ctx);
    const parsed = DraftUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError('به‌روزرسانی پیش‌نویس نامعتبر است.', parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message));
    }
    const u: DraftUpdateInput = parsed.data;
    const current = await this.get(ctx, id);
    const next = {
      title: u.title ?? current.title,
      caption: u.caption ?? current.caption,
      productId: u.productId ?? current.productId,
      status: u.status ?? current.status,
      scheduledAt: u.scheduledAt !== undefined ? u.scheduledAt : current.scheduledAt,
    };
    if (next.status === 'scheduled' && next.scheduledAt === null) {
      throw new ValidationError('پیش‌نویس زمان‌بندی‌شده باید زمان انتشار داشته باشد.');
    }
    return withDbErrors(async () => {
      const r = await this.pool.query<DraftRow>(
        'UPDATE content_drafts SET title = $1, caption = $2, product_id = $3, status = $4, scheduled_at = $5, updated_at = now() WHERE id = $6 RETURNING *',
        [next.title, next.caption, next.productId, next.status, next.scheduledAt, id],
      );
      const row = r.rows[0];
      if (!row) throw new NotFoundError('پیش‌نویس یافت نشد.');
      return toDraft(row);
    });
  }

  /** کپی پیش‌نویس — عنوان با پسوند (کپی)، وضعیت پیش‌نویس، بدون زمان‌بندی. */
  async duplicate(ctx: ActorContext | null | undefined, id: string): Promise<Draft> {
    assertActor(ctx);
    const source = await this.get(ctx, id);
    const suffix = ' (کپی)';
    const title = (source.title.length + suffix.length <= 300) ? source.title + suffix : source.title.slice(0, 300 - suffix.length) + suffix;
    return this.create(ctx, {
      title,
      caption: source.caption,
      productId: source.productId,
      status: 'draft',
      scheduledAt: null,
    });
  }
}
