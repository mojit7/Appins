/** محدودساز نرخ درون-حافظه‌ای (پنجره لغزان) برای مسیرهای حساس.
 *  برای اپ تک‌کاربره کافی است؛ در استقرار چندنفره باید به فروشگاه مشترک منتقل شود. */

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** true یعنی مجاز؛ false یعنی بیش از حد. */
  allow(key: string, now = Date.now()): boolean {
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

  reset(): void {
    this.hits.clear();
  }
}
