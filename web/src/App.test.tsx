import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { App } from "./App";
import { Instagram } from "./screens/Instagram";
import { AiStudio } from "./screens/AiStudio";

describe("رندر پوسته فارسی RTL", () => {
  it("ناوبری هشت‌گانه و بنر حالت نمایشی رندر می‌شوند", () => {
    const html = renderToString(<App />);
    expect(html).toContain("داشبورد");
    expect(html).toContain("محصولات");
    expect(html).toContain("استودیوی محتوای هوشمند");
    expect(html).toContain("تقویم محتوا");
    expect(html).toContain("اتصال اینستاگرام");
    expect(html).toContain("تحلیل‌ها");
    expect(html).toContain("ربات تلگرام");
    expect(html).toContain("تنظیمات");
    expect(html).toContain("حالت نمایشی فعال است");
  });
});

describe("صفحه اتصال اینستاگرام", () => {
  it("حالت قطع اتصال بدون ادعای اتصال نمایش داده می‌شود", () => {
    const html = renderToString(<Instagram />);
    expect(html).toContain("متصل نیست");
    expect(html).not.toContain("اتصال برقرار است");
  });
});

describe("صفحه استودیوی محتوا", () => {
  it("رندر اولیه بدون فراخوانی شبکه و بدون ادعای تأیید زنده انجام می‌شود", () => {
    const html = renderToString(<AiStudio />);
    expect(html).toContain("تولید کپشن فارسی");
    expect(html).toContain("مقایسه و ویرایش گزینه‌ها");
    expect(html).toContain("پیش‌نویس‌ها");
    expect(html).not.toContain("تأیید زنده: انجام شد");
  });
});