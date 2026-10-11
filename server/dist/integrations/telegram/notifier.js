/** اعلان نتیجه کار انتشار به مالک — شکست ارسال اعلان سرنوشت کار را عوض نمی‌کند
 *  و پس از یک تلاش رها می‌شود تا از ارسال تکراری بی‌سقف جلوگیری شود. */
export class TelegramOutcomeNotifier {
    client;
    ownerChatId;
    warn;
    constructor(client, ownerChatId, warn = () => { }) {
        this.client = client;
        this.ownerChatId = ownerChatId;
        this.warn = warn;
    }
    async notify(job, outcome, detail = {}) {
        if (outcome === 'failed_transient')
            return; // تلاش مجدد خودکار در جریان است؛ اسپم ارسال نمی‌شود
        const title = job.draftTitle || job.draftId;
        const text = outcome === 'succeeded'
            ? '✅ «' + title + '» در اینستاگرام منتشر و تأیید شد.'
            : '⚠️ انتشار «' + title + '» ناموفق بود (' + (detail.code ?? 'خطا') + '): ' + (detail.message ?? '');
        try {
            await this.client.sendMessage(this.ownerChatId, text);
        }
        catch {
            this.warn('اعلان تلگرام ارسال نشد و رها شد؛ از تکرار بی‌سقف پرهیز شد.');
        }
    }
}
