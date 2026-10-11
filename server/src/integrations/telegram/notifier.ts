import type { PublishingJob } from '../../domain/schedule.js';
import type { TelegramClient } from './client.js';

export type JobOutcome = 'succeeded' | 'failed_permanent' | 'failed_transient';

export interface OutcomeDetail {
  code?: string;
  message?: string;
  mediaId?: string;
}

/** اعلان نتیجه کار انتشار به مالک — شکست ارسال اعلان سرنوشت کار را عوض نمی‌کند
 *  و پس از یک تلاش رها می‌شود تا از ارسال تکراری بی‌سقف جلوگیری شود. */
export class TelegramOutcomeNotifier {
  constructor(
    private readonly client: TelegramClient,
    private readonly ownerChatId: string,
    private readonly warn: (msg: string) => void = () => {},
  ) {}

  async notify(job: PublishingJob, outcome: JobOutcome, detail: OutcomeDetail = {}): Promise<void> {
    if (outcome === 'failed_transient') return; // تلاش مجدد خودکار در جریان است؛ اسپم ارسال نمی‌شود
    const title = job.draftTitle || job.draftId;
    const text = outcome === 'succeeded'
      ? '✅ «' + title + '» در اینستاگرام منتشر و تأیید شد.'
      : '⚠️ انتشار «' + title + '» ناموفق بود (' + (detail.code ?? 'خطا') + '): ' + (detail.message ?? '');
    try {
      await this.client.sendMessage(this.ownerChatId, text);
    } catch {
      this.warn('اعلان تلگرام ارسال نشد و رها شد؛ از تکرار بی‌سقف پرهیز شد.');
    }
  }
}
