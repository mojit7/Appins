import { AppError } from '../../core/errors.js';
import { buildMessages, PROMPT_VERSION, type GenerateCaptionRequest } from './prompt.js';
import { CaptionResultSchema, type CaptionOption } from './schema.js';
import { extractJson, requestChatCompletion, type AiProviderConfig, type FetchLike } from './client.js';
import { validateCaptionOption, type ValidationReason } from './validator.js';

/** خط لوله کامل تولید — مشترک بین مسیر API و ارزیابی (eval) تا هر دو
 *  دقیقاً یک رفتار را بسنجند: درخواست ← استخراج JSON ← اعتبارسنجی ← تفکیک. */

export interface PipelineResult {
  promptVersion: string;
  options: CaptionOption[];
  dropped: Array<{ caption: string; reasons: ValidationReason[] }>;
}

export async function generateCaptionOptions(
  cfg: AiProviderConfig,
  req: GenerateCaptionRequest,
  fetcher: FetchLike,
): Promise<PipelineResult> {
  if (req.product.name.trim().length === 0) {
    throw new AppError('نام محصول برای تولید کپشن الزامی است.', 'AI_INVALID_PRODUCT', 422);
  }
  const messages = buildMessages(req);
  const completion = await requestChatCompletion(cfg, messages, fetcher);
  const raw = extractJson(completion.content);
  const parsed = CaptionResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('خروجی مدل با قرارداد JSON اعتبارسنجی نشد.', 'AI_MALFORMED_OUTPUT', 502,
      parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message));
  }
  const options = parsed.data.options;
  const valid: CaptionOption[] = [];
  const dropped: PipelineResult['dropped'] = [];
  for (const opt of options) {
    const reasons = validateCaptionOption(req.product, opt);
    if (reasons.length === 0) valid.push(opt);
    else dropped.push({ caption: opt.caption, reasons });
  }
  if (valid.length === 0) {
    throw new AppError('هیچ گزینه تولیدی قواعد واقعیت را رعایت نکرد.', 'AI_OUTPUT_REJECTED', 502, dropped);
  }
  return { promptVersion: PROMPT_VERSION, options: valid, dropped };
}
