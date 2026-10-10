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

export const ProductUpdateSchema = z
  .object({
    name: PersianOrLatinText.optional(),
    description: z.string().trim().max(5000).optional(),
    priceToman: z.number().int().min(0).optional(),
    stock: z.number().int().min(0).optional(),
    images: z.array(z.string().url()).max(10).optional(),
    status: ProductStatus.optional(),
  })
  .strict();

export type ProductUpdateInput = z.infer<typeof ProductUpdateSchema>;

export interface Product extends z.infer<typeof ProductCreateSchema> {
  id: string;
  createdAt: string;
  updatedAt: string;
}

/** صفحه‌بندی استاندارد مخازن. */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function clampPage(page: number, pageSize: number): { page: number; pageSize: number } {
  return { page: Math.max(1, Math.floor(page) || 1), pageSize: Math.min(100, Math.max(1, Math.floor(pageSize) || 20)) };
}
