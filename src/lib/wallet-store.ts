// DB access for the wallet vault (wallet-id model). Server-only.
import { getPool, ensureSchema } from "./db";
import type { Sealed } from "./crypto-vault";

export interface WalletRow {
  id: string;
  label: string | null;
  kdfSalt: Buffer;
  publicAccountId: string;
  privateAccountId: string | null;
  privateNpk: string | null;
  privateVpk: string | null;
  sealedStorage: Sealed;
  sealedCliPw: Sealed;
}

export interface NewWallet {
  label: string | null;
  kdfSalt: Buffer;
  publicAccountId: string;
  sealedStorage: Sealed;
  sealedCliPw: Sealed;
}

export async function createWalletRow(w: NewWallet): Promise<string> {
  await ensureSchema();
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO wallets
       (label, kdf_salt, public_account_id, enc_cli_pw, cli_pw_nonce, storage_blob, storage_nonce)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id`,
    [
      w.label,
      w.kdfSalt,
      w.publicAccountId,
      w.sealedCliPw.ciphertext,
      w.sealedCliPw.nonce,
      w.sealedStorage.ciphertext,
      w.sealedStorage.nonce,
    ],
  );
  return rows[0].id;
}

export async function getWalletRow(id: string): Promise<WalletRow | null> {
  await ensureSchema();
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return null;
  const { rows } = await getPool().query(
    `SELECT id, label, kdf_salt, public_account_id, private_account_id,
            private_npk, private_vpk, enc_cli_pw, cli_pw_nonce, storage_blob, storage_nonce
       FROM wallets WHERE id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    label: r.label,
    kdfSalt: r.kdf_salt,
    publicAccountId: r.public_account_id,
    privateAccountId: r.private_account_id,
    privateNpk: r.private_npk,
    privateVpk: r.private_vpk,
    sealedStorage: { ciphertext: r.storage_blob, nonce: r.storage_nonce },
    sealedCliPw: { ciphertext: r.enc_cli_pw, nonce: r.cli_pw_nonce },
  };
}

export async function updateSealedStorage(id: string, sealedStorage: Sealed): Promise<void> {
  await getPool().query(
    `UPDATE wallets SET storage_blob = $2, storage_nonce = $3 WHERE id = $1`,
    [id, sealedStorage.ciphertext, sealedStorage.nonce],
  );
}

/** Attach a newly added private account (id + shareable keys + new sealed storage). */
export async function setPrivateAccount(
  id: string,
  privateAccountId: string,
  npk: string,
  vpk: string,
  sealedStorage: Sealed,
): Promise<void> {
  await getPool().query(
    `UPDATE wallets
       SET private_account_id = $2, private_npk = $3, private_vpk = $4,
           storage_blob = $5, storage_nonce = $6
     WHERE id = $1`,
    [id, privateAccountId, npk, vpk, sealedStorage.ciphertext, sealedStorage.nonce],
  );
}

/** Cache npk/vpk for an existing private account (backfill for older wallets). */
export async function setPrivateKeys(id: string, npk: string, vpk: string): Promise<void> {
  await getPool().query(`UPDATE wallets SET private_npk = $2, private_vpk = $3 WHERE id = $1`, [
    id,
    npk,
    vpk,
  ]);
}
