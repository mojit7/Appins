import { z } from 'zod';

export const Provider = z.enum(['instagram', 'telegram']);
export type Provider = z.infer<typeof Provider>;

export const ConnectionStatus = z.enum(['connected', 'disconnected']);
export type ConnectionStatus = z.infer<typeof ConnectionStatus>;

export const ConnectionUpsertSchema = z
  .object({
    provider: Provider,
    status: ConnectionStatus,
    accountRef: z.string().trim().max(200).nullable().default(null),
  })
  .refine((c) => c.status !== 'connected' || c.accountRef !== null, {
    message: 'اتصال متصل باید شناسه حساب داشته باشد.',
  });
export type ConnectionUpsertInput = z.infer<typeof ConnectionUpsertSchema>;

/** هیچ رمز یا توکنی در این موجودیت ذخیره نمی‌شود؛ فقط فراداده وضعیت. */
export interface IntegrationConnection {
  id: string;
  provider: Provider;
  status: ConnectionStatus;
  accountRef: string | null;
  connectedAt: string | null;
  updatedAt: string;
}
