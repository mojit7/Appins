/** موتور قواعد خودکارسازی — تصمیم قطعی و آزمون‌پذیر؛ ارسال خودکار فقط پس از همه گیت‌ها.
 *  گیت‌ها: فعال‌بودن، بدون‌نیاز به انسان، کانال مستقیم، نیت مجازشده، ساعات کاری (تهران)، ضدتکرار متن. */

import { normalizeFa } from '../integrations/ai/intent.js';
import type { AutomationConfig, BusinessHours, Intent } from '../domain/engagement.js';

export interface AutomationDecision {
  action: 'auto_reply' | 'none' | 'blocked';
  reason: string;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** زمان محلی تهران — مبنای ساعات کاری؛ با Intl بدون وابستگی کتابخانه زمانی. */
export function tehranParts(now: Date): { weekday: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tehran', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = new Map<string, string>();
  for (const p of fmt.formatToParts(now)) parts.set(p.type, p.value);
  const weekday = Math.max(0, WEEKDAYS.indexOf(parts.get('weekday') ?? ''));
  const hourRaw = Number(parts.get('hour') ?? '0');
  const hour = Number.isFinite(hourRaw) ? (hourRaw === 24 ? 0 : hourRaw) : 0;
  const minute = Number(parts.get('minute') ?? '0');
  return { weekday, minutes: hour * 60 + (Number.isFinite(minute) ? minute : 0) };
}

export function withinBusinessHours(bh: BusinessHours, parts: { weekday: number; minutes: number }): boolean {
  if (!Array.isArray(bh.days) || bh.days.length === 0) return false;
  if (!bh.days.includes(parts.weekday)) return false;
  const toMin = (hhmm: string): number => {
    const [h, m] = hhmm.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  return parts.minutes >= toMin(bh.start) && parts.minutes < toMin(bh.end);
}

export function evaluateAutomation(cfg: AutomationConfig, args: {
  intent: Intent;
  channel: 'direct' | 'comment';
  needsHuman: boolean;
  candidateText: string;
  recentOutbound: string[];
  now: Date;
}): AutomationDecision {
  if (!cfg.enabled) return { action: 'none', reason: 'automation_disabled' };
  if (args.needsHuman) return { action: 'none', reason: 'needs_human' };
  if (args.channel !== 'direct') return { action: 'none', reason: 'channel_requires_approval' };
  if (!cfg.autoIntents.some((i) => i === args.intent)) return { action: 'none', reason: 'intent_not_authorized' };
  if (!withinBusinessHours(cfg.businessHours, tehranParts(args.now))) {
    return { action: 'none', reason: 'outside_business_hours' };
  }
  const norm = normalizeFa(args.candidateText);
  if (args.recentOutbound.some((t) => normalizeFa(t) === norm)) {
    return { action: 'blocked', reason: 'duplicate_text' };
  }
  return { action: 'auto_reply', reason: 'ok' };
}
