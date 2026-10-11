import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AppError } from "../src/core/errors.js";
import { generateCaptionOptions } from "../src/integrations/ai/pipeline.js";
import { PROMPT_VERSION } from "../src/integrations/ai/prompt.js";
import type { AiProviderConfig, FetchLike } from "../src/integrations/ai/client.js";

/** ارزیابی تکرارپذیر — مجموعه داده نسخه‌پذیر همراه کد؛ پس از هر تغییر پرامپت/اعتبارسنجی
 *  همین موارد باید بازاجرا و سبز شوند. کیفیت زنده مدل نیازمند کلید واقعی و بازبینی انسانی است. */

interface EvalCase {
  id: string;
  category: string;
  product: { name: string; description: string; priceToman: number | null; stock: number | null; sku: string };
  request: { tone: "friendly" | "formal" | "story"; length: "short" | "medium" | "long"; goal: "awareness" | "sale" | "engagement" };
  responseKind: "chat" | "http-error" | "hang";
  response: { status: number; body: unknown };
  expect: { outcome: "ok" | "error"; minValidOptions?: number; code?: string; rulesInclude?: string };
}

const dataset = JSON.parse(
  readFileSync(new URL("../src/integrations/ai/eval/dataset.json", import.meta.url), "utf8"),
) as { datasetVersion: number; promptVersion: string; cases: EvalCase[] };

const baseCfg: AiProviderConfig = {
  baseUrl: "https://api.eval.test/v1",
  model: "eval-model",
  apiKey: "eval-key",
  timeoutMs: 5000,
};

function fetcherFor(c: EvalCase): FetchLike {
  if (c.responseKind === "hang") {
    return () => new Promise<never>(() => {});
  }
  const status = c.response.status;
  const body = c.response.body;
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
}

describe("ارزیابی تکرارپذیر کپشن فارسی", () => {
  it("نسخه مجموعه داده با نسخه پرامپت هماهنگ است", () => {
    expect(dataset.datasetVersion).toBe(1);
    expect(dataset.promptVersion).toBe(PROMPT_VERSION);
  });

  it("همه هفت دسته الزامی پوشش داده شده‌اند", () => {
    const cats = new Set(dataset.cases.map((c) => c.category));
    const required = [
      "complete-product-info",
      "missing-price-or-stock",
      "conflicting-product-facts",
      "persian-punctuation-mixed-text",
      "empty-or-invalid-input",
      "malformed-incomplete-refused",
      "provider-failure",
    ];
    for (const r of required) expect(cats.has(r)).toBe(true);
    expect(dataset.cases.length).toBeGreaterThanOrEqual(16);
  });

  for (const c of dataset.cases) {
    it(c.id + " — " + c.category, async () => {
      const cfg = { ...baseCfg, timeoutMs: c.responseKind === "hang" ? 50 : 5000 };
      let result: Awaited<ReturnType<typeof generateCaptionOptions>> | null = null;
      let err: unknown = null;
      try {
        result = await generateCaptionOptions(
          cfg,
          { product: c.product, tone: c.request.tone, length: c.request.length, goal: c.request.goal },
          fetcherFor(c),
        );
      } catch (e) {
        err = e;
      }

      if (c.expect.outcome === "ok") {
        expect(err).toBeNull();
        expect(result).not.toBeNull();
        expect(result?.promptVersion).toBe(PROMPT_VERSION);
        expect(result?.options.length).toBeGreaterThanOrEqual(c.expect.minValidOptions ?? 1);
        expect(result?.options.every((o) => o.caption.length > 0)).toBe(true);
      } else {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.code).toBe(c.expect.code);
        if (c.expect.rulesInclude) {
          const dropped = appErr.details as Array<{ reasons: Array<{ rule: string }> }> | undefined;
          expect(Array.isArray(dropped)).toBe(true);
          const rules = (dropped ?? []).flatMap((d) => (d?.reasons ?? []).map((r) => r.rule));
          expect(rules).toContain(c.expect.rulesInclude);
        }
      }
    });
  }
});