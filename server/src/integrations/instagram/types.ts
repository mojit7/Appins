/** قرارداد لایه اینستاگرام — فقط بر پایه قابلیت‌های رسمی متا (v25.0).
 *  وضعیت «تأیید زنده» جدا از پیاده‌سازی نگه داشته می‌شود. */

export interface InstagramProfile {
  id: string;
  username: string;
  accountType: 'BUSINESS' | 'MEDIA_CREATOR';
  followersCount: number;
  mediaCount: number;
}

/** برچسب وضعیت در پاسخ‌های API: همیشه false مگر بازرسی زنده واقعی انجام شده باشد. */
export const LIVE_VERIFIED = false as boolean;
