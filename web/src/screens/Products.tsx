import { useMemo, useState } from 'react';
import { Button, DataTable, EmptyState, Badge, DemoBadge, Note } from '../components/ui';
import { faNum, faToman } from '../lib/format';
import { demoProducts } from '../lib/demo';

type Filter = 'all' | 'active' | 'draft' | 'archived';

const FILTER_LABELS: Record<Filter, string> = {
  all: 'همه', active: 'فعال', draft: 'پیش‌نویس', archived: 'بایگانی',
};

const STATUS_BADGE = {
  active: <Badge tone="success">فعال</Badge>,
  draft: <Badge tone="neutral">پیش‌نویس</Badge>,
  archived: <Badge tone="neutral">بایگانی</Badge>,
} as const;

export function Products() {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [justSaved, setJustSaved] = useState(false);

  const rows = useMemo(
    () => demoProducts
      .filter((p) => (filter === 'all' ? true : p.status === filter))
      .filter((p) => p.name.includes(query) || p.sku.toLowerCase().includes(query.toLowerCase())),
    [filter, query],
  );

  return (
    <div>
      <div className="form-row" style={{ marginBottom: 16 }}>
        <label className="field">
          <span className="field-label">جست‌وجو</span>
          <input className="input" placeholder="نام یا کد محصول…" value={query}
            onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="field">
          <span className="field-label">وضعیت</span>
          <select className="select" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
              <option key={f} value={f}>{FILTER_LABELS[f]}</option>
            ))}
          </select>
        </div>
      </div>

      {justSaved && <Note tone="success">محصول با موفقیت ذخیره شد. <DemoBadge /></Note>}

      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <span><DemoBadge /> {faNum(rows.length)} محصول</span>
        <Button onClick={() => setJustSaved(true)}>
          افزودن محصول
        </Button>
      </div>

      <DataTable
        headers={['محصول', 'کد', 'قیمت', 'موجودی', 'وضعیت']}
        rows={rows.map((p) => [
          p.name,
          <span className="num" dir="ltr">{p.sku}</span>,
          <span className="num">{faToman(p.priceToman)}</span>,
          p.stock === 0 ? <Badge tone="danger">ناموجود</Badge> : <span className="num">{faNum(p.stock)}</span>,
          STATUS_BADGE[p.status],
        ])}
        empty={
          <EmptyState
            title="محصولی یافت نشد"
            text="با تغییر فیلتر یا عبارت جست‌وجو دوباره تلاش کنید، یا محصول جدیدی اضافه کنید."
          />
        }
      />
    </div>
  );
}
