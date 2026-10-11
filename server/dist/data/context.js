import { ForbiddenError } from '../core/errors.js';
/** مرز اعمال دسترسی: هر عملیات داده‌ای باید با زمینه کاربرِ احراز‌شده اجرا شود.
 *  اپلیکیشن تک‌کاربره است؛ تنها نقش 'owner' مجاز است و باید در لایه سرور ساخته شود. */
export function assertActor(ctx) {
    if (!ctx || typeof ctx.userId !== 'string' || ctx.userId.length === 0 || ctx.role !== 'owner') {
        throw new ForbiddenError();
    }
}
export const OWNER = { userId: 'owner', role: 'owner' };
