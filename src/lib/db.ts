// Postgres access + idempotent schema migration. Server-only.
//
// Wallet-id model (no email): each row is one wallet = one storage.json holding a
// Public AND a Private account, sealed under the wallet's password. The browser
// keeps the wallet id(s) in localStorage; the password protects the keys.
import { Pool } from "pg";

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    pool = new Pool({ connectionString, max: 10 });
  }
  return pool;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS wallets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label               text,
  kdf_salt            bytea NOT NULL,
  public_account_id   text NOT NULL,
  private_account_id  text,
  private_npk         text,
  private_vpk         text,
  enc_cli_pw          bytea NOT NULL,
  cli_pw_nonce        bytea NOT NULL,
  storage_blob        bytea NOT NULL,
  storage_nonce       bytea NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Evolve older tables (private account is now optional + add shareable keys).
ALTER TABLE wallets ALTER COLUMN private_account_id DROP NOT NULL;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS private_npk text;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS private_vpk text;

CREATE TABLE IF NOT EXISTS audit_log (
  id        bigserial PRIMARY KEY,
  wallet_id uuid,
  action    text NOT NULL,
  ok        boolean NOT NULL,
  detail    text,
  at        timestamptz NOT NULL DEFAULT now()
);
`;

let migrated = false;
export async function ensureSchema(): Promise<void> {
  if (migrated) return;
  await getPool().query(SCHEMA_SQL);
  migrated = true;
}

export async function audit(
  walletId: string | null,
  action: string,
  ok: boolean,
  detail?: string,
): Promise<void> {
  try {
    await getPool().query(
      "INSERT INTO audit_log (wallet_id, action, ok, detail) VALUES ($1,$2,$3,$4)",
      [walletId, action, ok, detail ?? null],
    );
  } catch {
    // never let audit failure break a request
  }
}
