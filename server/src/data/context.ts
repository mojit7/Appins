import { ForbiddenError } from '../core/errors.js';

export interface ActorContext {
  readonly userId: string;
  readonly role: 'owner';
}

/** مرز اعمال دسترسی: هر عملیات داده‌ای باید با زمینه کاربرِ احراز‌شده اجرا شود.
 *  اپلیکیشن تک‌کاربره است؛ تنها نقش 'owner' مجاز است و باید در لایه سرور ساخته شود. */
export function assertActor(ctx: ActorContext | null | undefined): asserts ctx {
  if (!ctx || typeof ctx.userId !== 'string' || ctx.userId.length === 0 || ctx.role !== 'owner') {
    throw new ForbiddenError();
  }
}

export const OWNER: ActorContext = { userId: 'owner', role: 'owner' };
