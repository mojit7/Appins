/** ثبت کارهای پس‌زمینه؛ زمان‌بندِ واقعی در مرحله ۸. */
export class JobRegistry {
    jobs = new Map();
    register(job) {
        this.jobs.set(job.name, job);
    }
    list() {
        return [...this.jobs.values()];
    }
}
