import { describe, expect, it } from 'vitest';
import { ProductCreateSchema } from '../src/domain/product.js';

describe('ProductCreateSchema', () => {
  it('محصول معتبر پذیرفته می‌شود', () => {
    const r = ProductCreateSchema.safeParse({
      name: 'شال بهاری',
      priceToman: 250000,
      stock: 5,
      sku: 'SHL-01',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.status).toBe('draft');
      expect(r.data.images).toEqual([]);
    }
  });

  it('قیمت منفی رد می‌شود', () => {
    expect(ProductCreateSchema.safeParse({ name: 'x', priceToman: -1, sku: 'A-1' }).success).toBe(false);
  });

  it('sku غیرمجاز رد می‌شود', () => {
    expect(ProductCreateSchema.safeParse({ name: 'x', priceToman: 1, sku: 'کد فارسی' }).success).toBe(false);
  });
});
