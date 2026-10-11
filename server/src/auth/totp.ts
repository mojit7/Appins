import { createHmac } from 'node:crypto';

/** تولید/راستی‌آزمایی کد TOTP (RFC 6238، HMAC-SHA1، گام ۳۰ ثانیه).
 *  دومرحله‌ای اختیاری مالک: با تنظیم TOTP_SECRET (base32) ورود علاوه بر رمز نیازمند کد است.
 *  مرجع: datatracker.ietf.org/doc/html/rfc6238 و tools.ietf.org/html/rfc4226 */

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** رمزگشایی Base32 (RFC 4648) — بدون وابستگی بیرونی. */
export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('نویسه نامعتبر در رشته base32.');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** HOTP طبق RFC 4226 — کات دینامیک و سپس mod 10^digits. */
export function hotp(key: Buffer, counter: number, digits = 6): string {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter % 0x100000000, 4);
  const digest = createHmac('sha1', key).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const bin =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export interface TotpOptions {
  stepSeconds?: number;
  digits?: number;
  /** پنجره پذیرش ±گام (برای جابه‌جایی ساعت) */
  window?: number;
}

/** کد TOTP برای زمان داده‌شده — برای آزمون و ابزار. */
export function generateTotp(secretBase32: string, nowMs: number = Date.now(), options: TotpOptions = {}): string {
  const { stepSeconds = 30, digits = 6 } = options;
  const key = base32Decode(secretBase32);
  return hotp(key, Math.floor(nowMs / 1000 / stepSeconds), digits);
}

/** راستی‌آزمایی زمان-ثابت — کد باید دقیقاً به تعداد ارقام و عددی باشد. */
export function verifyTotp(secretBase32: string, code: string, nowMs: number = Date.now(), options: TotpOptions = {}): boolean {
  const { stepSeconds = 30, digits = 6, window = 1 } = options;
  if (typeof code !== 'string' || !new RegExp('^\\d{' + digits + '}$').test(code)) return false;
  const key = base32Decode(secretBase32);
  const counter = Math.floor(nowMs / 1000 / stepSeconds);
  for (let i = -window; i <= window; i++) {
    const expected = hotp(key, counter + i, digits);
    if (timingSafeEqualStrings(expected, code)) return true;
  }
  return false;
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
