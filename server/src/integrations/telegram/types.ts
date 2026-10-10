/** قرارداد لایه تلگرام — Bot API رسمی. اتصال واقعی در مرحله ۷. */

export interface TelegramConnector {
  /** راه‌اندازی فقط با توکن معتبرِ اثبات‌شده. */
  start(): Promise<void>;
  stop(): Promise<void>;
}
