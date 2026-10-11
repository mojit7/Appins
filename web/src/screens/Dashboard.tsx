import { useEffect, useState } from 'react';
import { Badge, Card, DataTable, EmptyState, ErrorState, Metric, Note, StatusDot } from '../components/ui';
import { faNum, faTime, faToman } from '../lib/format';
import { loadDashboard, type CountsSummary, type DashboardSnapshot, type Section } from '../lib/dashboard';

/** داشبورد داده‌محور — همه اعداد از API واقعی سرور خوانده می‌شوند.
 *  منبع و شیوه محاسبه هر متریک در docs/DASHBOARD_DATA.md مستند است.
 *  صفر، ناموجود، خطا و کهنه صریحاً از هم تفکیک می‌شوند؛ هیچ عددی بدون منبع نمایش داده نمی‌شود. */

function CountMetric({ label, section, value, delta }: {
  label: string;
  section: Section<CountsSummary>;
  value: string;
  delta?: string;
}) {
  if (section.state === 'ok' || section.state === 'stale') {
    return <Metric label={label} value={value} delta={delta} />;
  }
  if (section.state === 'zero') {
    return <Metric label={label} value={faNum(0)} delta="هنوز داده‌ای ثبت نشده است" />;
  }
  return <Metric label={label} value="—" delta={section.message} />;
}

export function Dashboard() {
  const [snap, setSnap] = useState<DashboardSnapshot | null>(null);

  useEffect(() => {
    let alive = true;
    void loadDashboard().then((s) => { if (alive) setSnap(s); });
    return () => { alive = false; };
  }, []);

  if (snap === null) {
    return (
      <div>
        <div role="status" aria-live="polite" className="note note-info" style={{ marginBottom: 16 }}>
          در حال بارگذاری داده‌ها از سرور…
        </div>
        <div className="metrics">
          <Metric label="محصولات فعال" value="…" />
          <Metric label="پیش‌نویس‌های محتوا" value="…" />
          <Metric label="انتشار در صف" value="…" />
          <Metric label="انتشار ناموفق" value="…" />
        </div>
      </div>
    );
  }

  const p = snap.products;
  const pReady = p.data !== null && (p.state === 'ok' || p.state === 'zero');
  const ig = snap.instagram;
  const igReady = ig.data !== null && (ig.state === 'ok' || ig.state === 'stale');

  return (
    <div>
      <div className="metrics" style={{ marginBottom: 24 }}>
        {pReady && p.data !== null ? (
          p.state === 'zero' ? (
            <Metric label="محصولات فعال" value={faNum(0)} delta="هنوز محصولی ثبت نشده است" />
          ) : (
            <Metric label="محصولات فعال" value={faNum(p.data.active)} delta={'از ' + faNum(p.data.total) + ' محصول ثبت‌شده'} />
          )
        ) : (
          <Metric label="محصولات فعال" value="—" delta={p.message} />
        )}
        <CountMetric label="پیش‌نویس‌های محتوا" section={snap.drafts} value={snap.drafts.data !== null ? faNum(snap.drafts.data.total) : '—'} />
        <CountMetric label="انتشار در صف" section={snap.pendingJobs} value={snap.pendingJobs.data !== null ? faNum(snap.pendingJobs.data.total) : '—'} />
        <CountMetric label="انتشار ناموفق" section={snap.failedJobs} value={snap.failedJobs.data !== null ? faNum(snap.failedJobs.data.total) : '—'} />
      </div>

      <div className="card-grid">
        <Card title="محصولات اخیر">
          {pReady && p.data !== null ? (
            p.state === 'zero' ? (
              <EmptyState title="هنوز محصولی ثبت نشده است" text="از صفحه «محصولات» اولین کاتالوگ خود را بسازید." />
            ) : (
              <>
                <DataTable
                  headers={['محصول', 'قیمت', 'موجودی']}
                  rows={p.data.items.slice(0, 5).map((pr) => [
                    pr.name,
                    <span className="num" key="price">{faToman(pr.priceToman)}</span>,
                    <span className="num" key="stock">{faNum(pr.stock)}</span>,
                  ])}
                />
                {p.data.partial && (
                  <Note tone="info">بیش از ۱۰۰ محصول ثبت شده؛ شمارش فعالان بر اساس ۱۰۰ مورد اخیر است.</Note>
                )}
              </>
            )
          ) : (
            <ErrorState title="محصولات در دسترس نیست" text={p.message} />
          )}
        </Card>

        <Card title="وضعیت اتصال اینستاگرام">
          {igReady && ig.data !== null ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <StatusDot on={ig.data.connected} />
                <span style={{ fontWeight: 700 }}>{ig.data.connected ? 'متصل' : 'قطع'}</span>
                {ig.data.connected ? <Badge tone="success">اتصال ثبت‌شده</Badge> : <Badge tone="danger">متصل نیست</Badge>}
              </div>
              {ig.state === 'stale' ? (
                <Note tone="error">توکن دسترسی منقضی یا نیازمند تازه‌سازی است؛ پیش از انتشار، اتصال را تازه یا از نو برقرار کنید.</Note>
              ) : ig.data.connected ? (
                <Note tone="info">وضعیت از مسیر رسمی سرور خوانده می‌شود؛ توکن هرگز به مرورگر نمی‌آید.</Note>
              ) : (
                <Note tone="info">حسابی متصل نیست؛ از صفحه «اتصال اینستاگرام» جریان رسمی متا را آغاز کنید.</Note>
              )}
            </div>
          ) : (
            <ErrorState title="وضعیت اتصال در دسترس نیست" text={ig.message} />
          )}
        </Card>

        <Card title="بینش‌های کسب‌وکار">
          <ErrorState
            title="بینش‌های کسب‌وکار در دسترس نیست"
            text="هیچ منبع داده‌ای برای فروش، بازدید یا دنبال‌کنندگان وجود ندارد؛ تا پیاده‌سازی مرحله ۵ و اتصال رسمی حساب، هیچ عددی نمایش داده نمی‌شود."
          />
        </Card>
      </div>

      <Note tone="info">
        {'داده‌ها یک‌باره هنگام ورود به صفحه از سرور خوانده می‌شوند (بدون درخواست دوره‌ای). آخرین به‌روزرسانی: ' + faTime(new Date(snap.fetchedAt))}
      </Note>
    </div>
  );
}
