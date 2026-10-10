import { useState } from 'react';
import { IconGrid, IconBox, IconSpark, IconCalendar, IconLink, IconChart, IconBot, IconGear, IconMenu, IconAlert } from './components/icons';
import { Dashboard } from './screens/Dashboard';
import { Products } from './screens/Products';
import { AiStudio } from './screens/AiStudio';
import { ContentCalendar } from './screens/ContentCalendar';
import { Instagram } from './screens/Instagram';
import { Analytics } from './screens/Analytics';
import { TelegramSettings } from './screens/TelegramSettings';
import { Settings } from './screens/Settings';

const NAV = [
  { id: 'dashboard', label: 'داشبورد', Icon: IconGrid, Screen: Dashboard, sub: 'نمای کلی فروشگاه' },
  { id: 'products', label: 'محصولات', Icon: IconBox, Screen: Products, sub: 'مدیریت کاتالوگ محصول' },
  { id: 'studio', label: 'استودیوی محتوای هوشمند', Icon: IconSpark, Screen: AiStudio, sub: 'تولید کپشن فارسی' },
  { id: 'calendar', label: 'تقویم محتوا', Icon: IconCalendar, Screen: ContentCalendar, sub: 'برنامه انتشار هفته' },
  { id: 'instagram', label: 'اتصال اینستاگرام', Icon: IconLink, Screen: Instagram, sub: 'وضعیت اتصال و انتشار' },
  { id: 'analytics', label: 'تحلیل‌ها', Icon: IconChart, Screen: Analytics, sub: 'بینش‌های حساب' },
  { id: 'telegram', label: 'ربات تلگرام', Icon: IconBot, Screen: TelegramSettings, sub: 'تنظیمات و دستورها' },
  { id: 'settings', label: 'تنظیمات', Icon: IconGear, Screen: Settings, sub: 'تنظیمات عمومی فروشگاه' },
] as const;

type NavId = (typeof NAV)[number]['id'];

export function App() {
  const [active, setActive] = useState<NavId>('dashboard');
  const [menuOpen, setMenuOpen] = useState(false);
  const current = NAV.find((n) => n.id === active) ?? NAV[0];
  const Screen = current.Screen;

  return (
    <div className="app">
      <header className="topbar">
        <button className="menu-btn" aria-label="باز کردن منو" onClick={() => setMenuOpen(true)}>
          <IconMenu />
        </button>
        <span className="brand-text">فروشگاه‌یار</span>
      </header>

      {menuOpen && (
        <button className="scrim" aria-label="بستن منو" onClick={() => setMenuOpen(false)} />
      )}

      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">ف</span>
          <div>
            <div className="brand-text">فروشگاه‌یار</div>
            <div className="brand-sub">دستیار فروشگاه اینستاگرام</div>
          </div>
        </div>
        <nav aria-label="ناوبری اصلی">
          {NAV.map(({ id, label, Icon }) => (
            <button key={id} className={`nav-item ${id === active ? 'active' : ''}`}
              onClick={() => { setActive(id); setMenuOpen(false); }}>
              <Icon />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          نسخه ۰٫۲ — مرحله ۲ از ۱۰<br />ساخته‌شده برای مدیریت تک‌فروشگاه
        </div>
      </aside>

      <main className="main">
        <div className="demo-banner" role="status">
          <IconAlert />
          <span>حالت نمایشی فعال است — داده‌های نمایش‌داده‌شده نمونه‌اند و داده واقعی کسب‌وکار نیستند.</span>
        </div>

        <div className="page-head">
          <div>
            <h1 className="page-title">{current.label}</h1>
            <p className="page-sub">{current.sub}</p>
          </div>
        </div>

        <Screen />
      </main>
    </div>
  );
}
