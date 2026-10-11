import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import type { Pool } from 'pg';
import { assertActor, type ActorContext } from './context.js';
import { withDbErrors } from '../db/errors.js';

/** ذخیره رمزنگاری‌شده توکن اینستاگرام با AES-256-GCM؛ کلید از راز داده‌شده (INSTAGRAM_TOKEN_ENCRYPTION_KEY، یا SESSION_SECRET به‌عنوان برگشت سازگار) با scrypt مشتق می‌شود. */

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, 'appins-instagram-token', 32);
}

export function encryptToken(secret: string, token: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, deriveKey(secret), iv);
  const enc = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return iv.toString('base64') + '.' + enc.toString('base64') + '.' + tag.toString('base64');
}

export function decryptToken(secret: string, blob: string): string {
  const parts = blob.split('.');
  if (parts.length !== 3) throw new Error('قالب رمزنگاری توکن نامعتبر است.');
  const ivPart = parts[0];
  const encPart = parts[1];
  const tagPart = parts[2];
  if (ivPart === undefined || encPart === undefined || tagPart === undefined) {
    throw new Error('قالب رمزنگاری توکن نامعتبر است.');
  }
  const iv = Buffer.from(ivPart, 'base64');
  const decipher = createDecipheriv(ALGO, deriveKey(secret), iv);
  decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encPart, 'base64')), decipher.final()]).toString('utf8');
}

interface CredentialRow {
  token_ciphertext: string;
  token_expires_at: Date;
  permissions: string[];
  updated_at: Date;
}

export interface InstagramCredential {
  token: string;
  expiresAt: string;
  permissions: string[];
}

export class InstagramCredentialRepository {
  constructor(private readonly pool: Pool, private readonly secret: string) {}
                 
  async save(ctx: ActorContext | null | undefined, rec: { token: string; expiresAt: Date;
 permissions: string[] }): Promise<void> {
    assertActor(ctx);
    const ciphertext = encryptToken(this.secret, rec.token);
    await withDbErrors(() => this.pool.query(
      "INSERT INTO instagram_credentials (provider, token_ciphertext, token_expires_at, permissions, updated_at) VALUES ('instagram', $1, $2, $3, now()) ON CONFLICT (provider) DO UPDATE SET token_ciphertext = EXCLUDED.token_ciphertext, token_expires_at = EXCLUDED.token_expires_at, permissions = EXCLUDED.permissions, updated_at = now()",
      [ciphertext, rec.expiresAt, rec.permissions],
    ));
  }

  async get(ctx: ActorContext | null | undefined): Promise<InstagramCredential | null> {
    assertActor(ctx);
    const r = await this.pool.query<CredentialRow>(
      "SELECT token_ciphertext, token_expires_at, permissions, updated_at FROM instagram_credentials WHERE provider = 'instagram'",
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      token: decryptToken(this.secret, row.token_ciphertext),
      expiresAt: row.token_expires_at.toISOString(),
      permissions: row.permissions ?? [],
    };
  }

  async clear(ctx: ActorContext | null | undefined): Promise<void> {
    assertActor(ctx);
    await this.pool.query("DELETE FROM instagram_credentials WHERE provider = 'instagram'");
  }

  async getRawCiphertext(ctx: ActorContext | null | undefined): Promise<string | null> {
    assertActor(ctx);
    const r = await this.pool.query("SELECT token_ciphertext FROM instagram_credentials WHERE provider = 'instagram'");
    return r.rows[0]?.token_ciphertext ?? null;
  }
}
