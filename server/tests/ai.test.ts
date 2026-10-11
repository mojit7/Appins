import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/server/app.js";
import { loadEnv } from "../src/config/env.js";
import { runMigrations } from "../src/db/migrate.js";
import { OWNER } from "../src/data/context.js";
import { ProductRepository } from "../src/data/products.js";
import type { FetchLike } from "../src/integrations/ai/client.js";

const CONN = process.env.DATABASE_URL ?? "postgres://appins:test@localhost:5432/appins_test";

const env = loadEnv({
  NODE_ENV: "test",
  DATABASE_URL: CONN,
  SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  OWNER_PASSWORD: "test-owner-pass-123",
  LOG_LEVEL: "fatal",
  AI_PROVIDER_API_KEY: "test-ai-key",
  AI_PROVIDER_BASE_URL: "https://api.test/v1",
  AI_PROVIDER_MODEL: "test-model",
});

const envNoAi = loadEnv({
  NODE_ENV: "test",
  DATABASE_URL: CONN,
  SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  OWNER_PASSWORD: "test-owner-pass-123",
  LOG_LEVEL: "fatal",
});

type Handler = (url: string, init?: Record<string, unknown>) => { status: number; body: unknown } | null;

function makeFetcher(handlers: Handler[]): { fetcher: FetchLike; calls: Array<{ url: string; auth?: unknown }> } {
  const calls: Array<{ url: string; auth?: unknown }> = [];
  const fetcher: FetchLike = async (url, init) => {
    calls.push({ url, auth: ((init?.headers as Record<string, unknown> | undefined)?.authorization) });
    for (const h of handlers) {
      const r = h(url, init);
      if (r) return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  };
  return { fetcher, calls };
}

function chatBody(content: string, finishReason = "stop"): unknown {
  return { choices: [{ finish_reason: finishReason, message: { content } }] };
}

const VALID_CAPTION_1 = "کیف دوشی چرم طبیعی «رها» با دوخت دستی؛ برای دیدن رنگ‌ها دایرکت بدهید. #کیف_چرم";
const VALID_CAPTION_2 = "وقتی دوخت دستی با چرم طبیعی همراه می‌شود، نتیجه کیف «رها» است. #چرم_طبیعی";
const INVENTED_PRICE_CAPTION = "فقط ۹۹٬۰۰۰ تومان با تخفیف ویژه! همین امروز سفارش بدهید. #کیف";

const HAPPY_CONTENT = JSON.stringify({
  options: [
    { caption: VALID_CAPTION_1, factsUsed: ["نام محصول"], suggestions: [] },
    { caption: VALID_CAPTION_2, factsUsed: ["نام محصول"], suggestions: [] },
  ],
});

const MIXED_CONTENT = JSON.stringify({
  options: [
    { caption: VALID_CAPTION_1, factsUsed: ["نام محصول"], suggestions: [] },
    { caption: INVENTED_PRICE_CAPTION, factsUsed: [], suggestions: [] },
  ],
});

const REJECTED_CONTENT = JSON.stringify({
  options: [
    { caption: INVENTED_PRICE_CAPTION, factsUsed: [], suggestions: [] },
  ],
});

let pool: Pool;
let products: ProductRepository;

beforeAll(async () => {
  pool = new Pool({ connectionString: CONN });
  await runMigrations(pool);
  products = new ProductRepository(pool);
});

afterAll(async () => { await pool.end(); });

beforeEach(async () => {
  await pool.query("TRUNCATE products, content_drafts RESTART IDENTITY CASCADE");
});

async function login(app: FastifyInstance): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/auth/login", payload: { password: "test-owner-pass-123" } });
  const setCookie = res.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : (setCookie as string | undefined);
  expect(first).toBeTruthy();
  return (first as string).split(";")[0];
}

async function seedProduct(): Promise<string> {
  const p = await products.create(OWNER, {
    name: "کیف چرم دست‌دوز «رها»",
    description: "کیف دوشی چرم طبیعی با دوخت دستی.",
    priceToman: 1240000,
    stock: 3,
    sku: "BAG-14",
  });
  return p.id;
}

async function makeApp(fetcher: FetchLike, e = env): Promise<{ app: FastifyInstance; cookie: string }> {
  const app = buildApp({ env: e, ai: { env: e, pool, fetcher } });
  const cookie = await login(app);
  return { app, cookie };
}

describe("مسیرهای استودیوی محتوا", () => {
  it("بدون ماژول AI، مسیرها stub با 503 پاسخ می‌دهند", async () => {
    const app = buildApp({ env });
    try {
      const cookie = await login(app);
      const res = await app.inject({ method: "GET", url: "/drafts", headers: { cookie } });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe("CONTENT_MODULE_NOT_CONFIGURED");
    } finally { await app.close(); }
  });

  it("تولید بدون پیکربندی ارائه‌دهنده 503 می‌دهد", async () => {
    const { fetcher } = makeFetcher([]);
    const app = buildApp({ env: envNoAi, ai: { env: envNoAi, pool, fetcher } });
    try {
      const cookie = await login(app);
      const res = await app.inject({
        method: "POST",
        url: "/ai/caption/generate",
        payload: { productId: "00000000-0000-0000-0000-000000000000" },
        headers: { cookie },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe("AI_NOT_CONFIGURED");
    } finally { await app.close(); }
  });

  it("دسترسی بدون نشست 401 می‌دهد", async () => {
    const { fetcher } = makeFetcher([]);
    const app = buildApp({ env, ai: { env, pool, fetcher } });
    try {
      const res = await app.inject({ method: "GET", url: "/drafts" });
      expect(res.statusCode).toBe(401);
    } finally { await app.close(); }
  });

  it("بدنه نامعتبر 422 می‌دهد", async () => {
    const { fetcher } = makeFetcher([]);
    const { app, cookie } = await makeApp(fetcher);
    try {
      const res = await app.inject({ method: "POST", url: "/ai/caption/generate", payload: { productId: "not-a-uuid" }, headers: { cookie } });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("VALIDATION_ERROR");
    } finally { await app.close(); }
  });

  it("محصول ناموجود 404 می‌دهد", async () => {
    const { fetcher } = makeFetcher([]);
    const { app, cookie } = await makeApp(fetcher);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/ai/caption/generate",
        payload: { productId: "00000000-0000-0000-0000-000000000000" },
        headers: { cookie },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe("NOT_FOUND");
    } finally { await app.close(); }
  });

  it("تولید موفق: گزینه‌ها، تفکیک قواعد، کلید فقط سمت سرور، بدون ادعای زنده", async () => {
    const id = await seedProduct();
    const { fetcher, calls } = makeFetcher([
      (url) => url === "https://api.test/v1/chat/completions" ? { status: 200, body: chatBody(HAPPY_CONTENT) } : null,
    ]);
    const { app, cookie } = await makeApp(fetcher);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/ai/caption/generate",
        payload: { productId: id, tone: "formal", length: "short", goal: "sale" },
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.promptVersion).toBe("caption-fa-v1");
      expect(body.model).toBe("test-model");
      expect(body.liveVerified).toBe(false);
      expect(body.options.length).toBe(2);
      expect(body.dropped.length).toBe(0);
      expect(calls.length).toBe(1);
      expect(calls[0]?.url).toBe("https://api.test/v1/chat/completions");
      expect(calls[0]?.auth).toBe("Bearer test-ai-key");
    } finally { await app.close(); }
  });

  it("پاسخ غیر-JSON مدل 502 با کد AI_MALFORMED_OUTPUT می‌دهد", async () => {
    const id = await seedProduct();
    const { fetcher } = makeFetcher([
      (url) => url === "https://api.test/v1/chat/completions" ? { status: 200, body: chatBody("متنی بدون هیچ JSON") } : null,
    ]);
    const { app, cookie } = await makeApp(fetcher);
    try {
      const res = await app.inject({ method: "POST", url: "/ai/caption/generate", payload: { productId: id }, headers: { cookie } });
      expect(res.statusCode).toBe(502);
      expect(res.json().code).toBe("AI_MALFORMED_OUTPUT");
    } finally { await app.close(); }
  });

  it("گزینه نامعتبر تفکیک و گزینه معتبر برگردانده می‌شود", async () => {
    const id = await seedProduct();
    const { fetcher } = makeFetcher([
      (url) => url === "https://api.test/v1/chat/completions" ? { status: 200, body: chatBody(MIXED_CONTENT) } : null,
    ]);
    const { app, cookie } = await makeApp(fetcher);
    try {
      const res = await app.inject({ method: "POST", url: "/ai/caption/generate", payload: { productId: id }, headers: { cookie } });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.options.length).toBe(1);
      expect(body.dropped.length).toBe(1);
      const rules = body.dropped[0].reasons.map((r: { rule: string }) => r.rule);
      expect(rules).toContain("price-mismatch");
      expect(rules).toContain("discount-claim");
    } finally { await app.close(); }
  });

  it("اگر همه گزینه‌ها قواعد واقعیت را نقض کنند 502 با AI_OUTPUT_REJECTED می‌دهد", async () => {
    const id = await seedProduct();
    const { fetcher } = makeFetcher([
      (url) => url === "https://api.test/v1/chat/completions" ? { status: 200, body: chatBody(REJECTED_CONTENT) } : null,
    ]);
    const { app, cookie } = await makeApp(fetcher);
    try {
      const res = await app.inject({ method: "POST", url: "/ai/caption/generate", payload: { productId: id }, headers: { cookie } });
      expect(res.statusCode).toBe(502);
      expect(res.json().code).toBe("AI_OUTPUT_REJECTED");
      const details = res.json().details as Array<{ reasons: Array<{ rule: string }> }>;
      expect(Array.isArray(details)).toBe(true);
      const rules = (details ?? []).flatMap((d) => (d?.reasons ?? []).map((r) => r.rule));
      expect(rules).toContain("price-mismatch");
      expect(rules).toContain("discount-claim");
    } finally { await app.close(); }
  });
});

describe("چرخه پیش‌نویس‌ها", () => {
  it("ایجاد، خواندن، ویرایش ادغامی، زمان‌بندی و کپی", async () => {
    const id = await seedProduct();
    const { fetcher } = makeFetcher([]);
    const { app, cookie } = await makeApp(fetcher);
    try {
      const create = await app.inject({
        method: "POST",
        url: "/drafts",
        payload: { title: "کپشن یلدا", caption: "متن اولیه", productId: id, status: "draft" },
        headers: { cookie },
      });
      expect(create.statusCode).toBe(200);
      const d = create.json();
      expect(d.title).toBe("کپشن یلدا");
      expect(d.status).toBe("draft");

      const bad = await app.inject({
        method: "POST",
        url: "/drafts",
        payload: { title: "بدون زمان", status: "scheduled" },
        headers: { cookie },
      });
      expect(bad.statusCode).toBe(422);

      const list = await app.inject({ method: "GET", url: "/drafts", headers: { cookie } });
      expect(list.json().total).toBe(1);

      const patch = await app.inject({
        method: "PATCH",
        url: "/drafts/" + d.id,
        payload: { caption: "متن ویرایش‌شده" },
        headers: { cookie },
      });
      expect(patch.statusCode).toBe(200);
      expect(patch.json().title).toBe("کپشن یلدا");
      expect(patch.json().caption).toBe("متن ویرایش‌شده");

      const schedBad = await app.inject({
        method: "PATCH",
        url: "/drafts/" + d.id,
        payload: { status: "scheduled" },
        headers: { cookie },
      });
      expect(schedBad.statusCode).toBe(422);

      const sched = await app.inject({
        method: "PATCH",
        url: "/drafts/" + d.id,
        payload: { status: "scheduled", scheduledAt: "2026-12-01T08:00:00.000Z" },
        headers: { cookie },
      });
      expect(sched.statusCode).toBe(200);
      expect(sched.json().status).toBe("scheduled");
      expect(sched.json().scheduledAt).not.toBeNull();

      const dup = await app.inject({ method: "POST", url: "/drafts/" + d.id + "/duplicate", headers: { cookie } });
      expect(dup.statusCode).toBe(200);
      expect(dup.json().title).toBe("کپشن یلدا (کپی)");
      expect(dup.json().status).toBe("draft");
      expect(dup.json().scheduledAt).toBeNull();

      const after = await app.inject({ method: "GET", url: "/drafts", headers: { cookie } });
      expect(after.json().total).toBe(2);
    } finally { await app.close(); }
  });
});