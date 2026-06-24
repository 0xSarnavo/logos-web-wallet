// Postgres access + idempotent schema migration. Server-only.
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
CREATE TABLE IF NOT EXISTS users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text UNIQUE NOT NULL,
  login_hash  text NOT NULL,
  kdf_salt    bytea NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallets (
  user_id        uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  account_id     text NOT NULL,
  pk             text NOT NULL,
  enc_cli_pw     bytea NOT NULL,
  cli_pw_nonce   bytea NOT NULL,
  storage_blob   bytea NOT NULL,
  storage_nonce  bytea NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id       bigserial PRIMARY KEY,
  user_id  uuid,
  action   text NOT NULL,
  ok       boolean NOT NULL,
  detail   text,
  at       timestamptz NOT NULL DEFAULT now()
);
`;

let migrated = false;
export async function ensureSchema(): Promise<void> {
  if (migrated) return;
  await getPool().query(SCHEMA_SQL);
  migrated = true;
}

export async function audit(
  userId: string | null,
  action: string,
  ok: boolean,
  detail?: string,
): Promise<void> {
  try {
    await getPool().query(
      "INSERT INTO audit_log (user_id, action, ok, detail) VALUES ($1,$2,$3,$4)",
      [userId, action, ok, detail ?? null],
    );
  } catch {
    // never let audit failure break a request
  }
}
