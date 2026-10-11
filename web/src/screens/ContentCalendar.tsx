import { useEffect, useState } from 'react';
import { Card, Button, Field, EmptyState, ErrorState, Badge, Note } from '../components/ui';
import { faDayMonth, faWeekday, faTime, faDate } from '../lib/format';

interface DraftItem {
  id: string;
  title: string;
  caption: string;
  status: string;
  scheduledAt: string | null;
}

interface JobItem {
  id: string;
  draftId: string;
  draftTitle: string;
  state: 'scheduled' | 'processing' | 'published' | 'failed' | 'cancelled';
  scheduledAt: string;
  attempt: number;
  maxAttempts: number;
  publishedMediaId: string | null;
  providerConfirmed: boolean;
  errorCode: string | null;
  errorMessage: string | null;
}

const API = '/api';
const JSON_HEADERS = { 'content-type': 'application/json' };

const STATE_FA: Record<JobItem['state'], string> = {
  scheduled: 'زمان‌بندی‌شده',
  processing: 'در حال پردازش',
  published: 'منتشرشده',
  failed: 'ناموفق',
  cancelled: 'لغوشده',
};

const STATE_TONE: Record<JobItem['state'], 'mint' | 'neutral' | 'success' | 'danger' | 'demo'> = {
  scheduled: 'mint',
  processing: 'demo',
  published: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(API + path, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const b = body as { code?: string; message?: string } | null;
    if (b?.code === 'CONTENT_MODULE_NOT_CONFIGURED') throw new Error('ماژول زمان‌بندی در این فرآیند فعال نیست.');
    throw new Error(b?.message ?? 'خطای ناشناخته (کد ' + res.status + ')');
  }
  return body;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function ContentCalendar() {
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [selected, setSelected] = useState(0);
  const [draftId, setDraftId] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);
  const [rescheduleAt, setRescheduleAt] = useState<Record<string, string>>({});

  const today = new Date();
  const weekDays = Array.from({ length: 7 }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + i));
  const day = weekDays[selected] as Date;
  const dayJobs = jobs.filter((j) => sameDay(new Date(j.scheduledAt), day));

  const load = async (): Promise<void> => {
    try {
      const dr = await api('/drafts?page=1&pageSize=50') as { items: DraftItem[] };
      const jr = await api('/schedule/jobs?page=1&pageSize=50') as { items: JobItem[] };
      setDrafts(dr.items ?? []);
      setJobs(jr.items ?? []);
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'خطای ناشناخته');
    }
  };

  useEffect(() => { void load(); }, []);

  const schedule = async (): Promise<void> => {
    if (draftId === '' || when === '') return;
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      const scheduledAt = new Date(when).toISOString();
      await api('/schedule/jobs', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ draftId, imageUrl, scheduledAt }),
      });
      setNotice('زمان‌بندی ثبت شد؛ کار در زمان مقرر به‌صورت خودکار اجرا می‌شود.');
      setWhen('');
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'خطای ناشناخته');
    } finally {
      setBusy(false);
    }
  };

  const act = async (path: string, body?: unknown): Promise<void> => {
    setActionError('');
    setNotice('');
    try {
      await api(path, { method: 'POST', headers: JSON_HEADERS, body: body === undefined ? undefined : JSON.stringify(body) });
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'خطای ناشناخته');
    }
  };

  return (
    <div>
      <div className='week-strip' role='tablist' aria-label='روزهای هفته'>
        {weekDays.map((d, i) => {
          const count = jobs.filter((j) => sameDay(new Date(j.scheduledAt), d)).length;
          return (
            <button key={i} role='tab' aria-selected={i === selected}
              className={i === selected ? 'day-chip selected' : 'day-chip'}
              onClick={() => setSelected(i)}>
              <div className='m'>{faWeekday(d)}</div>
              <div className='d num'>{faDayMonth(d)}</div>
              <div className='count'>{count > 0 ? count + ' مورد' : ''}</div>
            </button>
          );
        })}
      </div>

      <Card title={'برنامه روز — ' + faDate(day)}>
        {loadError !== '' && <ErrorState title='بارگذاری ناموفق بود' text={loadError} />}
        {notice !== '' && <Note tone='success'>{notice}</Note>}
        {dayJobs.length === 0 && loadError === '' && (
          <EmptyState
            title='برای این روز برنامه‌ای نیست'
            text='از فرم پایین یک پیش‌نویس را روی این روز زمان‌بندی کنید.'
          />
        )}
        {dayJobs.map((j) => (
          <div className='timeline-item' key={j.id}>
            <div className='timeline-time num'>{faTime(new Date(j.scheduledAt))}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{j.draftTitle}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {j.state === 'published'
                  ? (j.providerConfirmed ? 'انتشار توسط ارائه‌دهنده تأیید شد' : 'در صف ارائه‌دهنده')
                  : 'تلاش ' + j.attempt + ' از ' + j.maxAttempts}
              </div>
              {j.state === 'failed' && j.errorMessage !== null && (
                <div style={{ fontSize: 12, color: 'var(--danger)' }}>{j.errorCode} — {j.errorMessage}</div>
              )}
            </div>
            <Badge tone={STATE_TONE[j.state]}>{STATE_FA[j.state]}</Badge>
            {j.state === 'scheduled' && (
              <Button variant='ghost' onClick={() => void act('/schedule/jobs/' + j.id + '/cancel')}>لغو</Button>
            )}
            {j.state === 'failed' && (
              <Button onClick={() => void act('/schedule/jobs/' + j.id + '/retry')}>تلاش مجدد</Button>
            )}
          </div>
        ))}
      </Card>

      <Card title='زمان‌بندی انتشار جدید'>
        {actionError !== '' && <ErrorState title='عملیات ناموفق بود' text={actionError} />}
        <div className='form-row'>
          <Field label='پیش‌نویس'>
            <select className='select' value={draftId} onChange={(e) => setDraftId(e.target.value)} disabled={drafts.length === 0}>
              {drafts.length === 0 && <option value=''>پیش‌نویسی موجود نیست</option>}
              {drafts.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
          </Field>
          <Field label='نشانی تصویر (http/https)'>
            <input className='input' value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder='https://cdn.example.com/photo.jpg' />
          </Field>
          <Field label='زمان انتشار' hint='زمان بر اساس منطقه زمانی دستگاه شما تفسیر و به‌صورت آگاه ذخیره می‌شود.'>
            <input className='input' type='datetime-local' value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <Button onClick={() => void schedule()} disabled={busy || draftId === '' || when === '' || imageUrl === ''}>
            {busy ? 'در حال ثبت…' : 'ثبت زمان‌بندی'}
          </Button>
        </div>
        <Note tone='info'>
          اجرای کارها به‌صورت ماندگار روی سرور انجام می‌شود؛ بستن مرورگر اثری روی اجرا ندارد.
          «منتشرشده» فقط با تأیید ارائه‌دهنده ثبت می‌شود.
        </Note>
      </Card>
    </div>
  );
}