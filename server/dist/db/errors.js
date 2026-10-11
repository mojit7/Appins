import { ConflictError, ValidationError } from '../core/errors.js';
/** ترجمه خطاهای شناخته‌شده PostgreSQL به خطاهای دامنه؛ بقیه بدون تغییر پرتاب می‌شوند.
 *  کدها مطابق مستندات رسمی PostgreSQL: 23505 unique_violation، 23503 foreign_key_violation، 23514 check_violation. */
export async function withDbErrors(fn) {
    try {
        return await fn();
    }
    catch (err) {
        const code = err?.code;
        if (code === '23505')
            throw new ConflictError('رکوردی با این مقدار یکتا از قبل موجود است.');
        if (code === '23503')
            throw new ConflictError('رکورد دیگری به این ردیف وابسته است؛ عملیات انجام نشد.');
        if (code === '23514')
            throw new ValidationError('مقدارها با قیدهای پایگاه داده سازگار نیست.');
        throw err;
    }
}
