import { z } from 'zod';

export const LogLevel = z.enum(['debug', 'info', 'warn', 'error']);
export type LogLevel = z.infer<typeof LogLevel>;

export const LogAppendSchema = z.object({
  level: LogLevel,
  event: z.string().trim().min(1).max(200),
  // zod 4: z.record نیازمند اسکیمای کلید صریح است
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type LogAppendInput = z.infer<typeof LogAppendSchema>;

export interface OperationalLog {
  id: number;
  level: LogLevel;
  event: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
