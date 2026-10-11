import { useEffect, useState } from 'react';
import { IconGrid, IconBox, IconSpark, IconCalendar, IconLink, IconChart, IconBot, IconGear, IconMenu, IconAlert, IconChat } from './components/icons';
import { Dashboard } from './screens/Dashboard';
import { Inbox } from './screens/Inbox';
import { Products } from './screens/Products';
import { AiStudio } from './screens/AiStudio';
import { ContentCalendar } from './screens/ContentCalendar';
import { Instagram } from './screens/Instagram';
import { Analytics } from './screens/Analytics';
import { TelegramSettings } from './screens/TelegramSettings';
import { Settings } from './screens/Settings';
import { ErrorBoundary } from './lib/errorBoundary';

const NAV = [
  { id: 'dashboard', label: 'داشبورد', Icon: IconGrid, Screen: Dashboard, sub: 'نمای کلی فروشگاه' },
  { id: 'inbox', label: 'صندوق گفت‌وگو', Icon: IconChat, Screen: Inbox, sub: 'پیام‌ها و نظرات اینستاگرام' },
  { id: 'products', label: 'محصولات', Icon: IconBox, Screen: Products, sub: 'مدیریت کاتالوگ محصول' },
  { id: 'studio', label: 'استودیوی محتوای هوشمند', Icon: IconSpark, Screen: AiStudio, sub: 'تولید کپشن فارسی' },
  { id: 'calendar', label: 'تقویم محتوا', Icon: IconCalendar, Screen: ContentCalendar, sub: 'برنامه انتشار هفته' },
  { id: 'instagram', label: 'اتصال اینستاگرام', Icon: IconLink, Screen: Instagram, sub: 'وضعیت اتصال و انتشار' },
  { id: 'analytics', label: 'تحلیل‌ها', Icon: IconChart, Screen: Analytics, sub: 'بینش‌های حساب' },
  { id: 'telegram', label: 'ربات تلگرام', Icon: IconBot, Screen: TelegramSettings, sub: 'تنظیمات و دستورها' },
  { id: 'settings', label: 'تنظیمات', Icon: IconGear, Screen: Settings, sub: 'تنظیمات عمومی فروشگاه' },
] as const;

type NavId = (typeof NAV)[number]['id'];
type Theme = 'auto' | 'light' | 'dark';

const DEFAULT_ID: NavId = 'dashboard';
const THEME_KEY = 'appins-theme';
const THEME_LABEL: Record<Theme, string> = { auto: 'خودکار', light: 'روشن', dark: 'تاریک' };

/** استخراج شناسه صفحه از هش نشانی — ناوبری با URL زنده است (back/refresh/لینک مستقیم کار می‌کند). */
function navIdFromHash(hash: string): NavId {
  const id = hash.replace(/^#\/?/, '').split('?')[0] as NavId;
  return NAV.some((n) => n.id === id) ? id : DEFAULT_ID;
}

export function App() {
  const [active, setActive] = useState<NavId>(DEFAULT_ID);
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>('auto');

  // مسیریابی هش — فقط در مرورگر (SSR-امن: رندر سرور اثر جانبی ندارد)
  useEffect(() => {
    setActive(navIdFromHash(window.location.hash));
    const onHash = () => {
      setActive(navIdFromHash(window.location.hash));
      setMenuOpen(false);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // تم ذخیره‌شده + اعمال روی ریشه سند
  useEffect(() => {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'auto') setTheme(saved);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') delete root.dataset.theme;
    else root.dataset.theme = theme;
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const go = (id: NavId) => {
    setActive(id);
    setMenuOpen(false);
    window.location.hash = '#/' + id;
  };

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
              aria-current={id === active ? 'page' : undefined}
              onClick={() => go(id)}>
              <Icon />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button
            type="button"
            className="theme-toggle"
            aria-label={`تم فعلی: ${THEME_LABEL[theme]} — برای تغییر کلیک کنید`}
            onClick={() => setTheme(theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto')}
          >
            <span aria-hidden="true">{theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🌓'}</span>
            تم: {THEME_LABEL[theme]}
          </button>
          <span>نسخه ۱٫۱ — گفت‌وگوی مشتری</span>
        </div>
      </aside>

      <main className="main" id="main">
        <div className="status-banner" role="status">
          <IconAlert />
          <span>داشبورد از داده‌های واقعی سرور تغذیه می‌شود؛ قابلیت‌های وابسته به سرویس‌های بیرونی تا پیکربندی اعتبارنامه‌ها به‌صورت صادقانه «در دسترس نیست» علامت می‌خورند.</span>
        </div>

        <div className="page-head">
          <div>
            <h1 className="page-title">{current.label}</h1>
            <p className="page-sub">{current.sub}</p>
          </div>
        </div>

        <ErrorBoundary key={active}>
          <Screen />
        </ErrorBoundary>
      </main>
    </div>
  );
}
