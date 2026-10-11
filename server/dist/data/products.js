import { NotFoundError, ValidationError } from '../core/errors.js';
import { ProductCreateSchema, ProductUpdateSchema, clampPage } from '../domain/product.js';
import { assertActor } from './context.js';
import { withDbErrors } from '../db/errors.js';
function toProduct(r) {
    return {
        id: r.id,
        name: r.name,
        description: r.description,
        priceToman: r.price_toman,
        stock: r.stock,
        sku: r.sku,
        images: r.images,
        status: r.status,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
    };
}
export class ProductRepository {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async create(ctx, raw) {
        assertActor(ctx);
        const parsed = ProductCreateSchema.safeParse(raw);
        if (!parsed.success) {
            throw new ValidationError('محصول نامعتبر است.', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
        }
        const p = parsed.data;
        return withDbErrors(async () => {
            const r = await this.pool.query('INSERT INTO products (name, description, price_toman, stock, sku, images, status) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *', [p.name, p.description, p.priceToman, p.stock, p.sku, JSON.stringify(p.images), p.status]);
            const row = r.rows[0];
            if (!row)
                throw new Error('درج محصول نتیجه‌ای برنگرداند.');
            return toProduct(row);
        });
    }
    async get(ctx, id) {
        assertActor(ctx);
        const r = await this.pool.query('SELECT * FROM products WHERE id = $1', [id]);
        const row = r.rows[0];
        if (!row)
            throw new NotFoundError('محصول یافت نشد.');
        return toProduct(row);
    }
    async list(ctx, page = 1, pageSize = 20) {
        assertActor(ctx);
        const { page: p, pageSize: ps } = clampPage(page, pageSize);
        const total = (await this.pool.query('SELECT count(*)::int AS c FROM products')).rows[0]?.c ?? 0;
        const r = await this.pool.query('SELECT * FROM products ORDER BY created_at DESC, id LIMIT $1 OFFSET $2', [ps, (p - 1) * ps]);
        return { items: r.rows.map(toProduct), total, page: p, pageSize: ps };
    }
    async update(ctx, id, raw) {
        assertActor(ctx);
        const parsed = ProductUpdateSchema.safeParse(raw);
        if (!parsed.success) {
            throw new ValidationError('به‌روزرسانی محصول نامعتبر است.', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
        }
        const u = parsed.data;
        const fields = [];
        const values = [];
        for (const key of ['name', 'description', 'priceToman', 'stock', 'images', 'status']) {
            if (u[key] !== undefined) {
                fields.push(key);
                values.push(u[key]);
            }
        }
        if (fields.length === 0)
            throw new ValidationError('هیچ فیلدی برای به‌روزرسانی داده نشده است.');
        const colFor = { name: 'name', description: 'description', priceToman: 'price_toman', stock: 'stock', images: 'images', status: 'status' };
        const assignments = fields.map((f, i) => {
            const cast = f === 'images' ? `${colFor[f]} = $${i + 1}::jsonb` : `${colFor[f]} = $${i + 1}`;
            return cast;
        }).join(', ');
        return withDbErrors(async () => {
            const r = await this.pool.query(`UPDATE products SET ${assignments}, updated_at = now() WHERE id = $${values.length + 1} RETURNING *`, [...values, id]);
            const row = r.rows[0];
            if (!row)
                throw new NotFoundError('محصول یافت نشد.');
            return toProduct(row);
        });
    }
    /** حذف؛ اگر پیش‌نویسی به محصول اشاره کند، قید RESTRICT جلوی حذف را می‌گیرد. */
    async delete(ctx, id) {
        assertActor(ctx);
        return withDbErrors(async () => {
            const r = await this.pool.query('DELETE FROM products WHERE id = $1', [id]);
            if (r.rowCount === 0)
                throw new NotFoundError('محصول یافت نشد.');
        });
    }
}
