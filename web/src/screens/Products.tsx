import { useEffect, useMemo, useState } from 'react';
import { Badge, DataTable, EmptyState, ErrorState, LoadingPanel } from '../components/ui';
import { faNum, faToman } from '../lib/format';
import { fetchJson } from '../lib/api';

/** مدیریت کاتالوگ — داده‌ها فقط از API واقعی سرور (با تایم‌اوت اجباری)؛ هیچ داده نمایشی/جعلی وجود ندارد. */

interface ProductRow {
  id: string;
  name: string;
  sku: string;
  priceToman: number;
  stock: number;
  status: 'active' | 'draft' | 'archived';
}

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
  const [items, setItems] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loadState, setLoadState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    fetchJson<{ items?: ProductRow[]; total?: number }>('/api/products?page=1&pageSize=100')
      .then((page) => {
        if (!alive) return;
        const list = Array.isArray(page.items) ? page.items : [];
        setItems(list);
        setTotal(typeof page.total === 'number' && page.total >= 0 ? page.total : list.length);
        setLoadState('ready');
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setErrorMessage(err instanceof Error && err.message.length > 0 ? err.message : 'خطای ناشناخته');
        setLoadState('error');
      });
    return () => { alive = false; };
  }, []);

  const rows = useMemo(
    () => items
      .filter((p) => (filter === 'all' ? true : p.status === filter))
      .filter((p) => query.trim().length === 0 || p.name.includes(query) || p.sku.toLowerCase().includes(query.toLowerCase())),
    [items, filter, query],
  );

  return (
    <div>
      <div className="filter-bar form-row">
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

      {loadState === 'loading' && <LoadingPanel rows={4} label="در حال بارگذاری محصولات از سرور…" />}

      {loadState === 'error' && (
        <ErrorState
          title="محصولات در دسترس نیست"
          text={errorMessage}
        />
      )}

      {loadState === 'ready' && (
        <>
          <div className="count-line">
            <span>{faNum(rows.length)} محصول از {faNum(total)} محصول ثبت‌شده</span>
          </div>
          <DataTable
            headers={['محصول', 'کد', 'قیمت', 'موجودی', 'وضعیت']}
            rows={rows.map((p) => [
              p.name,
              <span className="num" dir="ltr" key="sku">{p.sku}</span>,
              <span className="num" key="price">{faToman(p.priceToman)}</span>,
              p.stock === 0 ? <Badge tone="danger" key="stock">ناموجود</Badge> : <span className="num" key="stock">{faNum(p.stock)}</span>,
              STATUS_BADGE[p.status],
            ])}
            empty={
              <EmptyState
                title="محصولی یافت نشد"
                text="با تغییر فیلتر یا عبارت جست‌وجو دوباره تلاش کنید."
              />
            }
          />
        </>
      )}
    </div>
  );
}
