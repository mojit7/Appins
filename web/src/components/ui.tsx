import { type ButtonHTMLAttributes, type ReactNode } from 'react';

/* ——— دکمه ——— */
type BtnVariant = 'primary' | 'ghost' | 'danger';
export function Button({
  variant = 'primary', children, disabled, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  return (
    <button className={`btn btn-${variant}`} disabled={disabled} {...rest}>
      {children}
    </button>
  );
}

/* ——— کارت ——— */
export function Card({ title, icon, children }: { title?: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {title != null && <h3 className="card-title">{icon}{title}</h3>}
      {children}
    </section>
  );
}

/* ——— نشان‌ها ——— */
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'demo' | 'success' | 'danger' | 'mint' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function DemoBadge() {
  return <Badge tone="demo">نمایشی</Badge>;
}

export function StatusDot({ on }: { on: boolean }) {
  return <span className={on ? 'status-dot on' : 'status-dot off'} aria-hidden="true" />;
}

/* ——— فرم ——— */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint != null && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, disabled, label }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label}
      aria-disabled={disabled} className="toggle"
      onClick={() => { if (!disabled) onChange(!checked); }}>
      <span className="toggle-track" />
      <span className="toggle-knob" />
    </button>
  );
}

/* ——— حالت‌ها ——— */
export function EmptyState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="state">
      <div className="state-icon neutral" aria-hidden="true">○</div>
      <div className="state-title">{title}</div>
      {text != null && <p className="state-text">{text}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="state">
      <div className="state-icon error" aria-hidden="true">!</div>
      <div className="state-title">{title}</div>
      {text != null && <p className="state-text">{text}</p>}
      {action}
    </div>
  );
}

export function SuccessState({ title, text }: { title: string; text?: string }) {
  return (
    <div className="state">
      <div className="state-icon success" aria-hidden="true">✓</div>
      <div className="state-title">{title}</div>
      {text != null && <p className="state-text">{text}</p>}
    </div>
  );
}

export function Skeleton({ h = 16, w }: { h?: number; w?: string }) {
  return <div className="skeleton" style={{ height: h, width: w }} aria-hidden="true" />;
}

export function LoadingPanel({ rows = 3, label = 'در حال بارگذاری…' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} h={20} w={`${100 - i * 18}%`} />
      ))}
      <span className="visually-hidden">{label}</span>
    </div>
  );
}

export function Note({ tone, children }: { tone: 'success' | 'error' | 'info'; children: ReactNode }) {
  return <div className={`note note-${tone}`}>{children}</div>;
}

/* ——— سنجه ——— */
export function Metric({ label, value, delta, direction }: {
  label: string; value: string; delta?: string; direction?: 'up' | 'down';
}) {
  return (
    <div className="card metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value num">{value}</div>
      {delta != null && (
        <div className={`metric-delta num ${direction === 'up' ? 'up' : direction === 'down' ? 'down' : ''}`}>
          {direction === 'up' ? '▲' : direction === 'down' ? '▼' : ''} {delta}
        </div>
      )}
    </div>
  );
}

/* ——— جدول ——— */
export function DataTable({ headers, rows, empty }: {
  headers: string[];
  rows: ReactNode[][];
  empty?: ReactNode;
}) {
  if (rows.length === 0 && empty != null) return <>{empty}</>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

export function SectionTitle({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h2 className="page-title">{children}</h2>
      </div>
      {extra}
    </div>
  );
}
