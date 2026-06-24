// Key vault crypto. Server-only.
//
// We never store a user's secret in the clear. We derive a Key-Encryption-Key
// (KEK) from the user's password + a per-user salt + a server-wide pepper, using
// Argon2id, and use it to AES-256-GCM encrypt the secret. The KEK is computed per
// request and never persisted.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { hashRaw } from "@node-rs/argon2";

const KEK_LEN = 32; // AES-256
const GCM_NONCE_LEN = 12;
const GCM_TAG_LEN = 16;
const ARGON2ID = 2; // @node-rs/argon2 Algorithm.Argon2id (literal — const enum can't be imported under isolatedModules)

// Must match the login Argon2 cost so derivation is uniformly slow.
const ARGON = { algorithm: ARGON2ID, memoryCost: 19456, timeCost: 2, parallelism: 1 };

function pepper(): Buffer {
  const p = process.env.WALLET_PEPPER;
  if (!p || p.length < 32) {
    throw new Error("WALLET_PEPPER must be set and at least 32 characters");
  }
  return Buffer.from(p, "utf8");
}

/**
 * Derive the 32-byte KEK from password + per-user salt + server pepper.
 * Deterministic for a given (password, salt, pepper) — same inputs → same key.
 */
export async function deriveKek(password: string, salt: Buffer): Promise<Buffer> {
  // Bind the pepper into the secret so a DB-only leak (no pepper) can't derive keys.
  const secret = Buffer.concat([Buffer.from(password, "utf8"), pepper()]);
  return hashRaw(secret, { ...ARGON, salt, outputLen: KEK_LEN }) as Promise<Buffer>;
}

export interface Sealed {
  ciphertext: Buffer; // includes the GCM auth tag appended
  nonce: Buffer;
}

/** AES-256-GCM encrypt `plaintext` under `kek`. */
export function seal(kek: Buffer, plaintext: Buffer): Sealed {
  const nonce = randomBytes(GCM_NONCE_LEN);
  const cipher = createCipheriv("aes-256-gcm", kek, nonce);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([enc, tag]), nonce };
}

/** AES-256-GCM decrypt. Throws if the key is wrong or the data was tampered with. */
export function open(kek: Buffer, sealed: Sealed): Buffer {
  const { ciphertext, nonce } = sealed;
  if (ciphertext.length < GCM_TAG_LEN) throw new Error("ciphertext too short");
  const enc = ciphertext.subarray(0, ciphertext.length - GCM_TAG_LEN);
  const tag = ciphertext.subarray(ciphertext.length - GCM_TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", kek, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]); // throws on bad tag
}

/** Convenience: derive KEK from password and seal in one step. */
export async function sealForPassword(
  password: string,
  salt: Buffer,
  plaintext: Buffer,
): Promise<Sealed> {
  return seal(await deriveKek(password, salt), plaintext);
}

/** Convenience: derive KEK from password and open in one step. */
export async function openForPassword(
  password: string,
  salt: Buffer,
  sealed: Sealed,
): Promise<Buffer> {
  return open(await deriveKek(password, salt), sealed);
}
