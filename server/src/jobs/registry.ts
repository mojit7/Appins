export interface JobDefinition {
  name: string;
  /** بازه اجرا به میلی‌ثانیه. */
  intervalMs: number;
  handler: () => Promise<void>;
}

/** ثبت کارهای پس‌زمینه؛ زمان‌بندِ واقعی در مرحله ۸. */
export class JobRegistry {
  private readonly jobs = new Map<string, JobDefinition>();

  register(job: JobDefinition): void {
    this.jobs.set(job.name, job);
  }

  list(): JobDefinition[] {
    return [...this.jobs.values()];
  }
}
