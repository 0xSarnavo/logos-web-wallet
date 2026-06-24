// Auth logic: signup + login using Argon2id. Server-only.
import { randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { getPool, ensureSchema } from "./db";

// Argon2id parameters (OWASP-aligned baseline).
const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export interface UserRow {
  id: string;
  email: string;
  login_hash: string;
  kdf_salt: Buffer;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function validate(email: string, password: string) {
  if (!EMAIL_RE.test(email)) throw new AuthError("invalid email");
  if (password.length < 8) throw new AuthError("password must be at least 8 characters");
}

/**
 * Create a user. Returns the new user row + the freshly generated kdf_salt.
 * NOTE: this only creates the LOGIN identity. The wallet/key vault is created in
 * Phase 3 (createUserWallet) which also needs the plaintext password.
 */
export async function registerUser(
  email: string,
  password: string,
): Promise<UserRow> {
  validate(email, password);
  await ensureSchema();

  const loginHash = await hash(password, ARGON_OPTS);
  const kdfSalt = randomBytes(16);

  try {
    const { rows } = await getPool().query<UserRow>(
      `INSERT INTO users (email, login_hash, kdf_salt)
       VALUES ($1, $2, $3)
       RETURNING id, email, login_hash, kdf_salt`,
      [email.toLowerCase(), loginHash, kdfSalt],
    );
    return rows[0];
  } catch (e) {
    if (e instanceof Error && /duplicate key/.test(e.message)) {
      throw new AuthError("email already registered", 409);
    }
    throw e;
  }
}

/** Verify credentials; returns the user row on success, throws AuthError otherwise. */
export async function loginUser(email: string, password: string): Promise<UserRow> {
  if (!EMAIL_RE.test(email)) throw new AuthError("invalid credentials", 401);
  await ensureSchema();

  const { rows } = await getPool().query<UserRow>(
    "SELECT id, email, login_hash, kdf_salt FROM users WHERE email = $1",
    [email.toLowerCase()],
  );
  const user = rows[0];
  // Verify even when the user is missing? We skip (no dummy hash) but return a
  // generic error to avoid leaking which emails exist.
  if (!user) throw new AuthError("invalid credentials", 401);

  const ok = await verify(user.login_hash, password);
  if (!ok) throw new AuthError("invalid credentials", 401);
  return user;
}

export async function getUserById(id: string): Promise<UserRow | null> {
  await ensureSchema();
  const { rows } = await getPool().query<UserRow>(
    "SELECT id, email, login_hash, kdf_salt FROM users WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
}
