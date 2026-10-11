import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyIntent, CLASSIFIER_VERSION } from '../src/integrations/ai/intent.js';
import { CRITICAL_INTENTS, EVAL_THRESHOLDS, INTENTS, type Intent } from '../src/domain/engagement.js';

interface DatasetItem { id: string; expected: string; text: string }
const dataset = JSON.parse(
  readFileSync(new URL('../src/integrations/ai/eval/intent-dataset.json', import.meta.url), 'utf8'),
) as { datasetVersion: string; items: DatasetItem[] };

interface IntentMetrics { precision: number; recall: number; f1: number; tp: number; fp: number; fn: number }

function evaluate(items: DatasetItem[]): { perIntent: Record<string, IntentMetrics>; accuracy: number; macroF1: number } {
  const tp: Record<string, number> = {};
  const fp: Record<string, number> = {};
  const fn: Record<string, number> = {};
  for (const intent of INTENTS) {
    tp[intent] = 0; fp[intent] = 0; fn[intent] = 0;
  }
  let correct = 0;
  for (const item of items) {
    const predicted = classifyIntent(item.text).intent;
    if (predicted === item.expected) {
      correct += 1;
      tp[predicted] = (tp[predicted] ?? 0) + 1;
    } else {
      fp[predicted] = (fp[predicted] ?? 0) + 1;
      fn[item.expected] = (fn[item.expected] ?? 0) + 1;
    }
  }
  const perIntent: Record<string, IntentMetrics> = {};
  const f1s: number[] = [];
  for (const intent of INTENTS) {
    const p = (tp[intent] ?? 0) + (fp[intent] ?? 0) === 0 ? 0 : (tp[intent] ?? 0) / ((tp[intent] ?? 0) + (fp[intent] ?? 0));
    const r = (tp[intent] ?? 0) + (fn[intent] ?? 0) === 0 ? 0 : (tp[intent] ?? 0) / ((tp[intent] ?? 0) + (fn[intent] ?? 0));
    const f1 = p + r === 0 ? 0 : (2 * p * r) / (p + r);
    perIntent[intent] = { precision: p, recall: r, f1, tp: tp[intent] ?? 0, fp: fp[intent] ?? 0, fn: fn[intent] ?? 0 };
    f1s.push(f1);
  }
  const macroF1 = f1s.reduce((a, b) => a + b, 0) / f1s.length;
  return { perIntent, accuracy: items.length === 0 ? 0 : correct / items.length, macroF1 };
}

describe('ارزیابی دسته‌بندی نیت فارسی — مجموعه ' + dataset.datasetVersion, () => {
  it('مجموعه داده معتبر است: همه نیت‌ها پوشیده و آیتم کافی دارد', () => {
    expect(dataset.items.length).toBeGreaterThanOrEqual(40);
    const covered = new Set(dataset.items.map((i) => i.expected));
    for (const intent of INTENTS) expect(covered.has(intent)).toBe(true);
  });

  it('آستانه‌های پذیرش برآورده می‌شوند', () => {
    const { perIntent, accuracy, macroF1 } = evaluate(dataset.items);
    // گزارش کامل معیارها برای بازبینی انسانی
    const report = Object.entries(perIntent).map(([intent, m]) =>
      intent + ': P=' + m.precision.toFixed(2) + ' R=' + m.recall.toFixed(2) + ' F1=' + m.f1.toFixed(2),
    ).join(' | ');
    console.log('[intent-eval] accuracy=' + accuracy.toFixed(3) + ' macroF1=' + macroF1.toFixed(3) + ' :: ' + report);
    expect(accuracy).toBeGreaterThanOrEqual(EVAL_THRESHOLDS.accuracy);
    expect(macroF1).toBeGreaterThanOrEqual(EVAL_THRESHOLDS.macroF1);
    for (const intent of CRITICAL_INTENTS as readonly Intent[]) {
      expect(perIntent[intent]?.recall ?? 0).toBeGreaterThanOrEqual(EVAL_THRESHOLDS.criticalRecall);
    }
  });

  it('نسخه دسته‌بندی و مجموعه داده ثبت می‌شوند (ردیابی رگرسیون)', () => {
    expect(CLASSIFIER_VERSION).toBe('fa-intent-lex-v1');
    expect(dataset.datasetVersion).toBe('intent-fa-v1');
  });
});
