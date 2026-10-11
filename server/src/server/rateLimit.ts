/** محدودساز نرخ درون-حافظه‌ای (پنجره لغزان) برای مسیرهای حساس.
 *  برای اپ تک‌کاربره کافی است؛ در استقرار چندنفره باید به فروشگاه مشترک منتقل شود.
 *  پاکسازی دوره‌ای کلیدهای کهنه، رشد بی‌کران حافظه (DoS حافظه) را متوقف می‌کند. */

const SWEEP_THRESHOLD = 1024;

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** true یعنی مجاز؛ false یعنی بیش از حد. */
  allow(key: string, now = Date.now()): boolean {
    const windowStart = now - this.windowMs;
    if (this.hits.size > SWEEP_THRESHOLD) this.sweep(windowStart);
    const prev = (this.hits.get(key) ?? []).filter((t) => t > windowStart);
    if (prev.length >= this.limit) {
      this.hits.set(key, prev);
      return false;
    }
    prev.push(now);
    this.hits.set(key, prev);
    return true;
  }

  reset(): void {
    this.hits.clear();
  }

  /** حذف کلیدهایی که دیگر هیچ ضربه تازه‌ای ندارند. */
  private sweep(windowStart: number): void {
    for (const [key, times] of this.hits) {
      const fresh = times.filter((t) => t > windowStart);
      if (fresh.length === 0) this.hits.delete(key);
      else this.hits.set(key, fresh);
    }
  }
}
