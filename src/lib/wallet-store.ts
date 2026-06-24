// DB access for the per-user wallet vault. Server-only.
import { getPool, ensureSchema } from "./db";
import type { Sealed } from "./crypto-vault";

export interface WalletRow {
  user_id: string;
  account_id: string;
  pk: string;
  sealedStorage: Sealed;
  sealedCliPw: Sealed;
}

export async function saveWallet(
  userId: string,
  accountId: string,
  pk: string,
  sealedStorage: Sealed,
  sealedCliPw: Sealed,
): Promise<void> {
  await ensureSchema();
  await getPool().query(
    `INSERT INTO wallets
       (user_id, account_id, pk, enc_cli_pw, cli_pw_nonce, storage_blob, storage_nonce)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      userId,
      accountId,
      pk,
      sealedCliPw.ciphertext,
      sealedCliPw.nonce,
      sealedStorage.ciphertext,
      sealedStorage.nonce,
    ],
  );
}

export async function getWallet(userId: string): Promise<WalletRow | null> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT user_id, account_id, pk, enc_cli_pw, cli_pw_nonce, storage_blob, storage_nonce
       FROM wallets WHERE user_id = $1`,
    [userId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    user_id: r.user_id,
    account_id: r.account_id,
    pk: r.pk,
    sealedStorage: { ciphertext: r.storage_blob, nonce: r.storage_nonce },
    sealedCliPw: { ciphertext: r.enc_cli_pw, nonce: r.cli_pw_nonce },
  };
}

/** Persist updated sealed storage after an operation that changed wallet state. */
export async function updateSealedStorage(
  userId: string,
  sealedStorage: Sealed,
): Promise<void> {
  await getPool().query(
    `UPDATE wallets SET storage_blob = $2, storage_nonce = $3, updated_at = now()
       WHERE user_id = $1`,
    [userId, sealedStorage.ciphertext, sealedStorage.nonce],
  );
}
