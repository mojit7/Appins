import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // فایل‌های تست به‌صورت متوالی اجرا می‌شوند تا پایگاه داده مشترک آزمایشی بدون مسابقه بماند
    fileParallelism: false,
  },
});
