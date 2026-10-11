successfully downloaded text file (SHA: bcb93700406ca5fe08d7a9bc2b9c947495cf3559)import { useEffect, useState } from "react";
import { Card, Button, Field, LoadingPanel, ErrorState, EmptyState, Note } from "../components/ui";

interface Product {
  id: string;
  name: string;
  description: string;
  priceToman: number;
  stock: number;
  sku: string;
}

interface CaptionOption {
  caption: string;
  factsUsed: string[];
  suggestions: string[];
}

interface DroppedOption {
  caption: string;
  reasons: Array<{ rule: string; detail?: string }>;
}

interface GenerateResult {
  promptVersion: string;
  model: string;
  options: CaptionOption[];
  dropped: DroppedOption[];
  liveVerified: boolean;
}

interface DraftItem {
  id: string;
  title: string;
  caption: string;
  productId: string | null;
  status: string;
  scheduledAt: string | null;
}

const API = "/api";

const ERROR_FA: Record<string, string> = {
  AI_NOT_CONFIGURED: "ارائه‌دهنده هوش مصنوعی پیکربندی نشده است؛ متغیرهای AI_PROVIDER_* را روی سرور تنظیم کنید.",
  AI_TIMEOUT: "پاسخ سرویس در مهلت مقرر نرسید؛ دوباره تلاش کنید.",
  AI_RATE_LIMITED: "سرویس محدودیت نرخ اعمال کرده است؛ کمی بعد دوباره تلاش کنید.",
  AI_AUTH_FAILED: "اعتبارسنجی سرویس ناموفق بود؛ کلید پیکربندی‌شده را بررسی کنید.",
  AI_PROVIDER_ERROR: "سرویس هوش مصنوعی با خطا پاسخ داد.",
  AI_REFUSED: "سرویس از تولید این محتوا خودداری کرد.",
  AI_INCOMPLETE_OUTPUT: "پاسخ سرویس ناقص بود؛ دوباره تلاش کنید.",
  AI_MALFORMED_OUTPUT: "خروجی مدل با قرارداد JSON اعتبارسنجی نشد.",
  AI_OUTPUT_REJECTED: "هیچ گزینه تولیدی قواعد واقعیت را رعایت نکرد.",
  AI_INVALID_PRODUCT: "نام محصول برای تولید کپشن الزامی است.",
};

function toFaMessage(body: { code?: string; message?: string } | null, status: number): string {
  const fa = body?.code != null ? ERROR_FA[body.code] : undefined;
  if (fa !== undefined) return fa;
  if (body?.message != null) return body.message;
  return "خطای ناشناخته (کد " + status + ")";
}

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(API + path, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(toFaMessage(body as { code?: string; message?: string } | null, res.status));
  }
  return body;
}

const JSON_HEADERS = { "content-type": "application/json" };

export function AiStudio() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productsError, setProductsError] = useState("");
  const [productId, setProductId] = useState("");
  const [tone, setTone] = useState("friendly");
  const [length, setLength] = useState("medium");
  const [goal, setGoal] = useState("awareness");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [draftsError, setDraftsError] = useState("");
  const [draftEdits, setDraftEdits] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");

  const loadProducts = async (): Promise<void> => {
    try {
      const body = await api("/products?page=1&pageSize=50");
      const r = body as { items: Product[] };
      setProducts(r.items ?? []);
      setProductsError("");
    } catch (err) {
      setProductsError(err instanceof Error ? err.message : "خطای ناشناخته");
    }
  };

  const loadDrafts = async (): Promise<void> => {
    try {
      const body = await api("/drafts?page=1&pageSize=20");
      const r = body as { items: DraftItem[] };
      setDrafts(r.items ?? []);
      setDraftsError("");
    } catch (err) {
      setDraftsError(err instanceof Error ? err.message : "خطای ناشناخته");
    }
  };

  useEffect(() => {
    void loadProducts();
    void loadDrafts();
  }, []);

  const generate = async (): Promise<void> => {
    if (productId === "") return;
    setGenerating(true);
    setGenError("");
    setNotice("");
    try {
      const body = await api("/ai/caption/generate", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ productId, tone, length, goal }),
      });
      const r = body as GenerateResult;
      setResult(r);
      const next: Record<number, string> = {};
      r.options.forEach((o, i) => { next[i] = o.caption; });
      setEdits(next);
    } catch (err) {
      setResult(null);
      setGenError(err instanceof Error ? err.message : "خطای ناشناخته");
    } finally {
      setGenerating(false);
    }
  };

  const saveOption = async (i: number): Promise<void> => {
    if (!result) return;
    const caption = edits[i] ?? result.options[i]?.caption ?? "";
    if (caption.trim().length === 0) return;
    const product = products.find((p) => p.id === productId);
    try {
      await api("/drafts", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          title: (product?.name ?? "کپشن") + " — گزینه " + (i + 1),
          caption,
          productId: product?.id ?? null,
          status: "draft",
        }),
      });
      setNotice("گزینه " + (i + 1) + " در پیش‌نویس‌ها ذخیره شد.");
      await loadDrafts();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "خطای ناشناخته");
    }
  };

  const saveDraft = async (d: DraftItem): Promise<void> => {
    try {
      await api("/drafts/" + d.id, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ caption: draftEdits[d.id] ?? d.caption }),
      });
      setNotice("پیش‌نویس «" + d.title + "» ذخیره شد.");
      await loadDrafts();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "خطای ناشناخته");
    }
  };

  const duplicateDraft = async (d: DraftItem): Promise<void> => {
    try {
      await api("/drafts/" + d.id + "/duplicate", { method: "POST", headers: JSON_HEADERS });
      setNotice("کپی پیش‌نویس ساخته شد.");
      await loadDrafts();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "خطای ناشناخته");
    }
  };

  const selectedProduct = products.find((p) => p.id === productId);

  return (
    <div className="card-grid">
      <Card title="تولید کپشن فارسی">
        {productsError !== "" && <ErrorState title="بارگذاری محصولات ناموفق بود" text={productsError} />}
        <div className="form-row">
          <Field label="محصول">
            <select className="select" value={productId} onChange={(e) => setProductId(e.target.value)} disabled={products.length === 0}>
              {products.length === 0 && <option value="">محصولی ثبت نشده است</option>}
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="لحن متن">
            <select className="select" value={tone} onChange={(e) => setTone(e.target.value)}>
              <option value="friendly">صمیمی و فروش‌محور</option>
              <option value="formal">رسمی و مینیمال</option>
              <option value="story">روایتی و داستانی</option>
            </select>
          </Field>
          <Field label="طول متن">
            <select className="select" value={length} onChange={(e) => setLength(e.target.value)}>
              <option value="short">کوتاه</option>
              <option value="medium">متوسط</option>
              <option value="long">بلند</option>
            </select>
          </Field>
          <Field label="هدف کمپین">
            <select className="select" value={goal} onChange={(e) => setGoal(e.target.value)}>
              <option value="awareness">معرفی و آگاهی</option>
              <option value="sale">فروش</option>
              <option value="engagement">تعامل</option>
            </select>
          </Field>
        </div>
        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <Button onClick={() => void generate()} disabled={generating || productId === ""}>
            {generating ? "در حال تولید…" : "تولید کپشن"}
          </Button>
        </div>
        {genError !== "" && <ErrorState title="تولید کپشن ناموفق بود" text={genError} />}
        {result !== null && (
          <Note tone="info">
            نسخه پرامپت {result.promptVersion} — مدل {result.model} — وضعیت تأیید زنده: انجام نشده است.
          </Note>
        )}
        {result !== null && result.dropped.length > 0 && (
          <Note tone="error">{result.dropped.length} گزینه به دلیل نقض قواعد واقعیت حذف شد.</Note>
        )}
      </Card>

      <Card title="مقایسه و ویرایش گزینه‌ها">
        {generating && <LoadingPanel rows={5} label="در حال تولید کپشن…" />}
        {!generating && result === null && (
          <EmptyState
            title="گزینه‌ای تولید نشده است"
            text={selectedProduct ? "محصول «" + selectedProduct.name + "» را انتخاب و دکمه تولید را بزنید." : "محصول را انتخاب و دکمه تولید را بزنید."}
          />
        )}
        {!generating && result !== null && (
          <div>
            {result.options.map((o, i) => (
              <div key={i} style={{ marginBottom: 16 }}>
                <div className="field-label">گزینه {i + 1}</div>
                <textarea
                  className="textarea"
                  rows={5}
                  style={{ width: "100%" }}
                  value={edits[i] ?? o.caption}
                  onChange={(e) => setEdits({ ...edits, [i]: e.target.value })}
                />
                {o.factsUsed.length > 0 && (
                  <p className="state-text">واقعیت‌های به‌کاررفته: {o.factsUsed.join("، ")}</p>
                )}
                {o.suggestions.length > 0 && (
                  <p className="state-text">پیشنهادها: {o.suggestions.join("؛ ")}</p>
                )}
                <Button onClick={() => void saveOption(i)}>ذخیره به‌عنوان پیش‌نویس</Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="پیش‌نویس‌ها">
        {notice !== "" && <Note tone="success">{notice}</Note>}
        {draftsError !== "" && <ErrorState title="بارگذاری پیش‌نویس‌ها ناموفق بود" text={draftsError} />}
        {drafts.length === 0 && draftsError === "" && (
          <EmptyState title="پیش‌نویسی ثبت نشده است" text="گزینه تولیدی را ذخیره کنید تا اینجا نمایش داده شود." />
        )}
        {drafts.map((d) => (
          <div key={d.id} style={{ marginBottom: 16 }}>
            <div className="field-label">{d.title} — وضعیت: {d.status}</div>
            <textarea
              className="textarea"
              rows={3}
              style={{ width: "100%" }}
              value={draftEdits[d.id] ?? d.caption}
              onChange={(e) => setDraftEdits({ ...draftEdits, [d.id]: e.target.value })}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <Button onClick={() => void saveDraft(d)}>ذخیرهٔ ویرایش</Button>
              <Button variant="ghost" onClick={() => void duplicateDraft(d)}>کپی</Button>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}