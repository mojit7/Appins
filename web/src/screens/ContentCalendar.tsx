import { useState } from 'react';
import { Card, Button, EmptyState, Badge, DemoBadge } from '../components/ui';
import { faDayMonth, faWeekday, faTime, faDate } from '../lib/format';
import { demoDrafts } from '../lib/demo';

const weekDays = Array.from({ length: 7 }, (_, i) => new Date(2026, 9, 9 + i));

export function ContentCalendar() {
  const [selected, setSelected] = useState(2);
  const day = weekDays[selected] as Date;
  const dayDrafts = demoDrafts.filter((d) => d.scheduledAt.getDate() === day.getDate());

  return (
    <div>
      <div className="week-strip" role="tablist" aria-label="روزهای هفته">
        {weekDays.map((d, i) => {
          const count = demoDrafts.filter((x) => x.scheduledAt.getDate() === d.getDate()).length;
          return (
            <button key={i} role="tab" aria-selected={i === selected}
              className={`day-chip ${i === selected ? 'selected' : ''}`}
              onClick={() => setSelected(i)}>
              <div className="m">{faWeekday(d)}</div>
              <div className="d num">{faDayMonth(d)}</div>
              <div className="count">{count > 0 ? `${count} مورد` : ''}</div>
            </button>
          );
        })}
      </div>

      <Card title={`برنامه روز — ${faDate(day)}`}>
        {dayDrafts.length === 0 ? (
          <EmptyState
            title="برای این روز برنامه‌ای نیست"
            text="از استودیوی محتوا یک پیش‌نویس بسازید و آن را روی این روز زمان‌بندی کنید."
            action={<Button variant="ghost">ساخت پیش‌نویس جدید</Button>}
          />
        ) : (
          dayDrafts.map((d) => (
            <div className="timeline-item" key={d.id}>
              <div className="timeline-time num">{faTime(d.scheduledAt)}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{d.title}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{d.product}</div>
              </div>
              {d.status === 'scheduled'
                ? <Badge tone="mint">زمان‌بندی‌شده <DemoBadge /></Badge>
                : <Badge tone="neutral">پیش‌نویس</Badge>}
              <Button variant="ghost" disabled>انتشار (اتصال برقرار نیست)</Button>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
