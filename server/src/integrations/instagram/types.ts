/** قرارداد لایه اینستاگرام — فقط بر پایه قابلیت‌های رسمی متا.
 *  تا مرحله ۴ هیچ فراخوانی واقعی انجام نمی‌شود و هیچ اتصالی ادعا نمی‌شود. */

export interface InstagramProfile {
  id: string;
  username: string;
  accountType: 'BUSINESS' | 'CREATOR';
  mediaCount: number;
}

export interface InstagramConnector {
  /** فقط پس از اتصال موفقِ اثبات‌شده مقدار برمی‌گرداند؛ در غیر این صورت خطا. */
  getProfile(): Promise<InstagramProfile>;
  /** انتشار محتوا تنها در صورت پشتیبانی رسمی API برای این حساب. */
  publishDraft(draftId: string): Promise<{ publishedMediaId: string }>;
}

export const NOT_IMPLEMENTED = 'قابلیت تا مرحله مربوطه پیاده‌سازی نشده است.';
