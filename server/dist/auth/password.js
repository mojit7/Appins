import { createHash, timingSafeEqual } from 'node:crypto';
/** مقایسه زمان-ثابت مقدار دریافتی با مقدار مورد انتظار (هر دو sha256 می‌شوند تا طول یکسان شود). */
export function safeEqual(a, b) {
    const da = createHash('sha256').update(a, 'utf8').digest();
    const db = createHash('sha256').update(b, 'utf8').digest();
    return timingSafeEqual(da, db);
}
