import { Card, Metric, DataTable, DemoBadge } from '../components/ui';
import { faNum, faCompact, faToman, faDayMonth } from '../lib/format';
import { demoProducts, demoWeekVisits } from '../lib/demo';

const days = demoWeekVisits.map((_, i) => new Date(2026, 9, 5 + i));

export function Dashboard() {
  const max = Math.max(...demoWeekVisits);
  return (
    <div>
      <div className="metrics" style={{ marginBottom: 24 }}>
        <Metric label="فروش امروز" value={faToman(3_420_000)} delta="۱۲٪ نسبت به دیروز" direction="up" />
        <Metric label="دنبال‌کنندگان" value={faCompact(12400)} delta="۸۶ دنبال‌کننده جدید این هفته" direction="up" />
        <Metric label="بازدید پروفایل (۷ روز)" value={faNum(2700)} delta="۴٪ کمتر از هفته قبل" direction="down" />
        <Metric label="پست‌های برنامه‌ریزی‌شده" value={faNum(3)} delta="هفته جاری" />
      </div>

      <div className="card-grid">
        <Card title="بازدید روزانه این هفته" icon={<DemoBadge />}>
          <div className="bars">
            {demoWeekVisits.map((v, i) => (
              <div className="bar-col" key={i}>
                <div className={`bar ${i === 5 ? 'bar-accent' : ''}`} style={{ height: `${(v / max) * 100}%` }} title={faNum(v)} />
                <div className="bar-label">{faDayMonth(days[i] as Date)}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="پرفروش‌ترین محصولات">
          <DataTable
            headers={['محصول', 'قیمت', 'موجودی']}
            rows={demoProducts.slice(0, 3).map((p) => [
              p.name,
              <span className="num">{faToman(p.priceToman)}</span>,
              <span className="num">{faNum(p.stock)}</span>,
            ])}
          />
        </Card>
      </div>
    </div>
  );
}
