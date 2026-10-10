import { z } from 'zod';

export const ProductStatus = z.enum(['active', 'draft', 'archived']);
export type ProductStatus = z.infer<typeof ProductStatus>;

const PersianOrLatinText = z.string().trim().min(1).max(500);

export const ProductCreateSchema = z.object({
  name: PersianOrLatinText,
  description: z.string().trim().max(5000).default(''),
  priceToman: z.number().int().min(0),
  stock: z.number().int().min(0).default(0),
  sku: z.string().trim().regex(/^[A-Za-z0-9\-]+$/, 'کد کالا فقط حروف لاتین و رقم باشد.'),
  images: z.array(z.string().url()).max(10).default([]),
  status: ProductStatus.default('draft'),
});

export type ProductCreateInput = z.infer<typeof ProductCreateSchema>;

export interface Product extends ProductCreateInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}
