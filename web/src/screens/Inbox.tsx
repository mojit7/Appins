import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, EmptyState, Note } from '../components/ui';
import {
  approveSuggestion, CHANNEL_LABELS, disableAutomation, intentLabel, loadAutomation,
  loadConversation, loadInbox, markConversationRead, rejectSuggestion, setEscalated,
  suggestReply, updateStage, STAGE_LABELS,
  type ApiFailure, type AutomationSettings, type ConversationDetail, type InboxItem,
} from '../lib/engagement';

function errMessage(err: unknown): string {
  return err instanceof Error && err.message.length > 0 ? err.message : 'خطای ناشناخته';
}

export function Inbox() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [items, setItems] = useState<InboxItem[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [channel, setChannel] = useState('');
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [automation, setAutomation] = useState<AutomationSettings | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const page = await loadInbox({ q, channel: channel === 'all' ? '' : channel });
      setItems(page.items);
      setTotal(page.total);
    } catch (err) {
      setError(errMessage(err));
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [q, channel]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    loadAutomation().then(setAutomation).catch(() => setAutomation(null));
  }, []);

  const select = async (id: string): Promise<void> => {
    setBusy(true);
    setNote('');
    try {
      const d = await loadConversation(id);
      setDetail(d);
      if (d.conversation.unreadCount > 0) {
        await markConversationRead(id).catch(() => {});
      }
    } catch (err) {
      setNote(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const run = async (fn: () => Promise<string>): Promise<void> => {
    setBusy(true);
    setNote('');
    try {
      setNote(await fn());
      await refresh();
      if (detail !== null) {
        try { setDetail(await loadConversation(detail.conversation.id)); } catch { /* مثل قبل می‌ماند */ }
      }
    } catch (err) {
      const failure = err as Partial<ApiFailure>;
      setNote(errMessage(err) + (failure.code !== undefined && failure.code.length > 0 ? ' (کد ' + failure.code + ')' : ''));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="form-row" style={{ marginBottom: 16 }}>
        <label className="field">
          <span className="field-label">جست‌وجو</span>
          <input className="input" placeholder="نام مشتری یا متن پیام…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="field">
          <span className="field-label">کانال</span>
          <select className="select" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="all">همه</option>
            <option value="direct">پیام مستقیم</option>
            <option value="comment">نظر پست</option>
          </select>
        </div>
        <div className="field" style={{ alignSelf: 'end' }}>
          <Button onClick={() => { void refresh(); }}>به‌روزرسانی</Button>
        </div>
      </div>

      {note.length > 0 && <Note tone="success">{note}</Note>}
      {error.length > 0 && <Note tone="danger">{error}</Note>}
      {loading && <p role="status">در حال بارگذاری گفت‌وگوها…</p>}

      <AutomationPanel settings={automation} onDisable={() => void run(async () => {
        const cfg = await disableAutomation();
        setAutomation(cfg);
        return 'خودکارسازی خاموش شد.';
      })} />

      <div className="form-row" style={{ marginTop: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <InboxView items={items} total={total} onSelect={(id) => { void select(id); }} />
        </div>
        <div style={{ flex: 1.4, minWidth: 300 }}>
          {detail === null
            ? <EmptyState title="گفت‌وگویی انتخاب نشده" text="از فهرست، یک گفت‌وگو را برای دیدن تاریخچه و پاسخ‌ها انتخاب کنید." />
            : <ConversationPanel detail={detail} busy={busy}
                onAction={run}
                onReload={async () => { setDetail(await loadConversation(detail.conversation.id)); }} />}
        </div>
      </div>
    </div>
  );
}

export function InboxView({ items, total, onSelect }: { items: InboxItem[]; total: number; onSelect: (id: string) => void }) {
  if (items.length === 0) {
    return <EmptyState title="گفت‌وگویی یافت نشد" text="با تغییر فیلتر یا جست‌وجو دوباره تلاش کنید." />;
  }
  return (
    <div>
      <p style={{ marginBottom: 8 }}>{total} گفت‌وگو</p>
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
        {items.map((c) => (
          <li key={c.id}>
            <button
              className="nav-item"
              style={{ width: '100%', textAlign: 'start', display: 'block', border: '1px solid var(--border, #ccc)', borderRadius: 8, padding: '8px 12px' }}
              onClick={() => onSelect(c.id)}
            >
              <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Badge tone={c.channel === 'direct' ? 'success' : 'neutral'}>{CHANNEL_LABELS[c.channel] ?? c.channel}</Badge>
                <strong>{c.customerUsername.length > 0 ? '@' + c.customerUsername : 'مشتری'}</strong>
                {c.unreadCount > 0 && <Badge tone="danger">خوانده‌نشده: {c.unreadCount}</Badge>}
                {c.escalated && <Badge tone="danger">ارجاع به انسان</Badge>}
                <span>{intentLabel(c.lastIntent)}</span>
              </span>
              <span style={{ display: 'block', marginTop: 4, opacity: 0.8 }}>{c.subject}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ConversationPanel({ detail, busy, onAction, onReload }: {
  detail: ConversationDetail;
  busy: boolean;
  onAction: (fn: () => Promise<string>) => Promise<void>;
  onReload: () => Promise<void>;
}) {
  const conv = detail.conversation;
  const pending = detail.suggestions.filter((s) => s.status === 'pending');
  const processed = detail.suggestions.filter((s) => s.status !== 'pending');
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <strong>{conv.customerUsername.length > 0 ? '@' + conv.customerUsername : 'مشتری'}</strong>
        <Badge tone="neutral">{CHANNEL_LABELS[conv.channel] ?? conv.channel}</Badge>
        <Badge tone={conv.escalated ? 'danger' : 'neutral'}>{conv.escalated ? 'ارجاع‌شده' : STAGE_LABELS[conv.salesStage] ?? conv.salesStage}</Badge>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button disabled={busy} onClick={() => { void onAction(async () => { await suggestReply(conv.id); await onReload(); return 'پیشنهاد پاسخ ساخته شد.'; }) }}>
          پیشنهاد پاسخ
        </Button>
        <label className="field">
          <span className="field-label">مرحله فروش</span>
          <select className="select" defaultValue={conv.salesStage} onChange={(e) => { void onAction(async () => { await updateStage(conv.id, e.target.value); return 'مرحله فروش به‌روز شد.'; }) }}>
            {Object.entries(STAGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <Button disabled={busy} onClick={() => { void onAction(async () => { await setEscalated(conv.id, !conv.escalated); await onReload(); return conv.escalated ? 'ارجاع برداشته شد.' : 'به انسان ارجاع شد.'; }) }}>
          {conv.escalated ? 'برداشتن ارجاع' : 'ارجاع به انسان'}
        </Button>
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        {detail.messages.map((m) => (
          <div key={m.id} style={{
            justifySelf: m.direction === 'inbound' ? 'start' : 'end',
            background: 'rgba(127,127,127,0.08)', borderRadius: 8, padding: '6px 10px', maxWidth: '80%',
          }}>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {m.direction === 'inbound' ? 'مشتری' : (m.sentBy === 'automation' ? 'خودکار' : 'فروشگاه')}
              {m.intent !== null && ' — ' + intentLabel(m.intent)}
              {m.needsHuman && ' — نیازمند انسان'}
            </div>
            <div>{m.text}</div>
          </div>
        ))}
        {detail.messages.length === 0 && <p>پیامی ثبت نشده است.</p>}
      </div>

      {pending.map((s) => (
        <div key={s.id} style={{ border: '1px solid var(--border, #ccc)', borderRadius: 8, padding: 10, display: 'grid', gap: 8 }}>
          <strong>پیشنهاد پاسخ ({s.source === 'ai_generated' ? 'بازنویسی هوشمند' : 'قالب قانون‌محور'})</strong>
          <p>{s.text}</p>
          {s.needsHuman && <Note tone="success">این پیشنهاد پیش از ارسال نیازمند تأیید شماست.</Note>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button disabled={busy} onClick={() => { void onAction(async () => {
              await approveSuggestion(s.id);
              await onReload();
              return 'پاسخ ارسال شد.';
            }) }}>تأیید و ارسال</Button>
            <Button disabled={busy} onClick={() => { void onAction(async () => {
              await rejectSuggestion(s.id, 'بازبینی اپراتور');
              await onReload();
              return 'پیشنهاد رد شد.';
            }) }}>رد پیشنهاد</Button>
          </div>
        </div>
      ))}

      {processed.length > 0 && (
        <div style={{ display: 'grid', gap: 4 }}>
          {processed.map((s) => (
            <div key={s.id} style={{ fontSize: 12, opacity: 0.75 }}>
              پیشنهاد پیشین: {s.status === 'sent' ? 'ارسال‌شده' : s.status === 'rejected' ? 'ردشده' : s.status === 'failed' ? 'ناموفق (اتصال اینستاگرام لازم است)' : s.status}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AutomationPanel({ settings, onDisable }: { settings: AutomationSettings | null; onDisable: () => void }) {
  return (
    <div style={{ border: '1px solid var(--border, #ccc)', borderRadius: 8, padding: '8px 12px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {settings === null
        ? <span>وضعیت خودکارسازی: در دسترس نیست (ماژول فعال نیست)</span>
        : <>
          <Badge tone={settings.enabled ? 'success' : 'neutral'}>{settings.enabled ? 'خودکارسازی روشن است' : 'خودکارسازی خاموش است'}</Badge>
          <span>نیت‌های مجاز: {settings.autoIntents.length === 0 ? 'هیچ' : settings.autoIntents.map((i) => intentLabel(i)).join('، ')}</span>
        </>}
      <Button onClick={onDisable}>توقف فوری خودکارسازی</Button>
    </div>
  );
}
