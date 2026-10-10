import { useState } from 'react';

const NAV = [
  { id: 'products', label: 'محصولات' },
  { id: 'drafts', label: 'پیش‌نویس‌ها و کپشن' },
  { id: 'schedule', label: 'زمان‌بندی انتشار' },
  { id: 'insights', label: 'بینش‌های حساب' },
  { id: 'telegram', label: 'ربات تلگرام' },
] as const;

type NavId = (typeof NAV)[number]['id'];

const PLACEHOLDER: Record<NavId, string> = {
  products: 'مدیریت محصولات در مرحله ۳ فعال می‌شود.',
  drafts: 'پیش‌نویس محتوا و کپشن هوشمند در مرحله ۶.',
  schedule: 'زمان‌بندی در حد پشتیبانی رسمی API متا — مرحله ۸.',
  insights: 'بینش‌های حساب پس از اتصال رسمی — مرحله ۵.',
  telegram: 'گردش‌کار ربات تلگرام در مرحله ۷.',
};

export function App() {
  const [active, setActive] = useState<NavId>('products');

  return (
    <div className="shell">
      <aside className="sidebar">
        <h1 className="brand">فروشگاه‌یار</h1>
        <nav>
          {NAV.map((item) => (
            <button
              key={item.id}
              className={item.id === active ? 'active' : ''}
              onClick={() => setActive(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="content">
        <h2>{NAV.find((n) => n.id === active)?.label}</h2>
        <p className="placeholder">{PLACEHOLDER[active]}</p>
      </main>
    </div>
  );
}
