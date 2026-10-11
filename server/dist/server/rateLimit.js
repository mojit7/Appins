/** محدودساز نرخ درون-حافظه‌ای (پنجره لغزان) برای مسیرهای حساس.
 *  برای اپ تک‌کاربره کافی است؛ در استقرار چندنفره باید به فروشگاه مشترک منتقل شود. */
export class SlidingWindowRateLimiter {
    limit;
    windowMs;
    hits = new Map();
    constructor(limit, windowMs) {
        this.limit = limit;
        this.windowMs = windowMs;
    }
    /** true یعنی مجاز؛ false یعنی بیش از حد. */
    allow(key, now = Date.now()) {
        const windowStart = now - this.windowMs;
        const prev = (this.hits.get(key) ?? []).filter((t) => t > windowStart);
        if (prev.length >= this.limit) {
            this.hits.set(key, prev);
            return false;
        }
        prev.push(now);
        this.hits.set(key, prev);
        return true;
    }
    reset() {
        this.hits.clear();
    }
}
