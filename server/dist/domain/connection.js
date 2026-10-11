import { z } from 'zod';
export const Provider = z.enum(['instagram', 'telegram']);
export const ConnectionStatus = z.enum(['connected', 'disconnected']);
export const ConnectionUpsertSchema = z
    .object({
    provider: Provider,
    status: ConnectionStatus,
    accountRef: z.string().trim().max(200).nullable().default(null),
})
    .refine((c) => c.status !== 'connected' || c.accountRef !== null, {
    message: 'اتصال متصل باید شناسه حساب داشته باشد.',
});
