import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Dashboard } from './Dashboard';

describe('داشبورد داده‌محور — رندر اولیه', () => {
  it('حالت بارگذاری بدون فراخوانی شبکه رندر می‌شود', () => {
    const html = renderToString(<Dashboard />);
    expect(html).toContain('در حال بارگذاری داده‌ها از سرور');
  });

  it('هیچ متریک جعلی (فروش/دنبال‌کننده/بازدید) نمایش داده نمی‌شود', () => {
    const html = renderToString(<Dashboard />);
    expect(html).not.toContain('فروش امروز');
    expect(html).not.toContain('دنبال‌کنندگان');
    expect(html).not.toContain('بازدید پروفایل');
  });

  it('کارت بینش‌های کسب‌وکار به‌صورت «در دسترس نیست» علامت می‌خورد، نه با عدد', () => {
    const html = renderToString(<Dashboard />);
    expect(html).toContain('بینش‌های کسب‌وکار در دسترس نیست');
  });
});
