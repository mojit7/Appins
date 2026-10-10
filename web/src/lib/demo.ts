/** داده‌های نمایشی — صرفاً برای حالت دمو؛ این‌ها داده واقعی کسب‌وکار نیستند. */

export const DEMO = true as const;

export interface DemoProduct {
  id: string;
  name: string;
  sku: string;
  priceToman: number;
  stock: number;
  status: 'active' | 'draft' | 'archived';
}

export const demoProducts: DemoProduct[] = [
  { id: 'p1', name: 'شال حریر بهاره', sku: 'SHL-01', priceToman: 285000, stock: 12, status: 'active' },
  { id: 'p2', name: 'کیف چرم دست‌دوز «رها»', sku: 'BAG-14', priceToman: 1240000, stock: 3, status: 'active' },
  { id: 'p3', name: 'ست نقره «مهتاب»', sku: 'SLV-07', priceToman: 890000, stock: 0, status: 'draft' },
  { id: 'p4', name: 'پیراهن منچستری', sku: 'DRS-22', priceToman: 640000, stock: 25, status: 'active' },
  { id: 'p5', name: 'شمع عطردار یلدا', sku: 'CND-03', priceToman: 145000, stock: 48, status: 'archived' },
];

export interface DemoDraft {
  id: string;
  title: string;
  product: string;
  scheduledAt: Date;
  status: 'scheduled' | 'draft';
}

export const demoDrafts: DemoDraft[] = [
  { id: 'd1', title: 'رِیلز معرفی کیف «رها»', product: 'کیف چرم دست‌دوز «رها»', scheduledAt: new Date(2026, 9, 12, 18, 30), status: 'scheduled' },
  { id: 'd2', title: 'استوری شال حریر', product: 'شال حریر بهاره', scheduledAt: new Date(2026, 9, 13, 12, 0), status: 'scheduled' },
  { id: 'd3', title: 'پست ست نقره «مهتاب»', product: 'ست نقره «مهتاب»', scheduledAt: new Date(2026, 9, 15, 20, 0), status: 'draft' },
];

export const demoCaption = `✨ راز یک استایل بی‌نقص با «شال حریر بهاره»

رنگ‌های ملایم فصل، لطافت حریر و دوختی تمیز — همه در یک انتخاب.
محدود تولید شد؛ همین امروز از دایرکت سفارش بدهید.

#فروشگاه_یار #شال_حریر #استایل_بهاری`;

export const demoWeekVisits = [210, 340, 180, 460, 520, 610, 380];

export const demoCommands = [
  { cmd: '/start', desc: 'خوش‌آمدگویی و منوی اصلی' },
  { cmd: '/products', desc: 'فهرست محصولات موجود' },
  { cmd: '/order_،کد', desc: 'ثبت سفارش با کد محصول' },
  { cmd: '/support', desc: 'اتصال به پشتیبانی انسانی' },
];
