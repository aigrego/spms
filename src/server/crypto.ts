import crypto from 'node:crypto';

/* AES-256-GCM encryption for sensitive config values stored in the DB
   (OAuth app secrets, storage backend credentials). Wire format:
   v1.<base64(iv)>.<base64(tag)>.<base64(cipher)> — the version prefix leaves
   room for future key rotation. The key comes from CONFIG_CRYPTO_KEY
   (64 hex chars = 32 bytes; generate with `openssl rand -hex 32`), read from
   process.env directly so scripts/*.ts can use this module under tsx without
   path aliases. A missing/invalid key only fails the encrypt/decrypt call
   sites — the rest of the app starts normally. */

const PREFIX = 'v1';

function key(): Buffer {
  const hex = process.env.CONFIG_CRYPTO_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('CONFIG_CRYPTO_KEY 缺失或非法（需要 64 位十六进制，`openssl rand -hex 32` 生成）');
  }
  return Buffer.from(hex, 'hex');
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [PREFIX, iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

export function decryptSecret(value: string): string {
  const [v, iv, tag, data] = value.split('.');
  if (v !== PREFIX || !iv || !tag || !data) throw new Error('密文格式非法');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

/* API responses must never carry plaintext secrets — only this flag. */
export function hasSecret(enc: string | null | undefined): boolean {
  return !!enc;
}
