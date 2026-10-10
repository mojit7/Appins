import { describe, expect, it } from 'vitest';
import { faNum, faToman, faPercent, faDate, faDayMonth, faCompact } from './format';

describe('قالب‌بندی فارسی', () => {
  it('faNum اعداد را با رقم فارسی برمی‌گرداند', () => {
    expect(faNum(250)).toBe('۲۵۰');
  });

  it('faToman واحد تومان را اضافه می‌کند', () => {
    expect(faToman(145000)).toContain('تومان');
    expect(faToman(145000)).toContain('۱۴۵');
  });

  it('faPercent درصد فارسی می‌سازد', () => {
    expect(faPercent(0.12)).toBe('۱۲٪');
  });

  it('faDate تاریخ خورشیدی را شامل رقم فارسی می‌دهد', () => {
    const s = faDate(new Date(2026, 9, 10));
    expect(s.length).toBeGreaterThan(3);
    expect(s).toMatch(/[۰-۹]/);
  });

  it('faDayMonth روز و ماه را می‌دهد', () => {
    expect(faDayMonth(new Date(2026, 9, 10))).toMatch(/[۰-۹]/);
  });

  it('faCompact اعداد بزرگ را خلاصه می‌کند', () => {
    const s = faCompact(12400);
    expect(s).toBeTruthy();
    expect(s).not.toBe('۱۲۴۰۰');
  });
});
