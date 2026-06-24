# SPEC — Multi-User Custodial Logos Wallet

Technical contract. Each phase has **acceptance criteria** used for the per-phase
verification loop. A phase is "done" only when all its checks pass.

## Stack
- Next.js 14 (App Router) + TypeScript (existing app, extended).
- Postgres (Railway add-on; local via Docker for dev).
- `pg` for DB, `@node-rs/argon2` for Argon2id, `iron-session` for sessions,
  Node built-in `crypto` for AES-256-GCM.
- `wallet` CLI (LEZ) invoked per-user; node/sequencer over HTTP.

## Data model (Postgres)
```
users(
  id            uuid primary key,
  email         text unique not null,
  login_hash    text not null,         -- Argon2id(password) for login check
  kdf_salt      bytea not null,        -- salt for the KEK derivation
  created_at    timestamptz default now()
)
wallets(
  user_id       uuid primary key references users(id),
  account_id    text not null,         -- public "Public/..." id (not secret)
  enc_cli_pw    bytea not null,        -- AES-GCM ciphertext of the CLI password
  nonce         bytea not null,        -- AES-GCM nonce for enc_cli_pw
  storage_blob  bytea not null,        -- the CLI's storage.json (CLI-encrypted)
  updated_at    timestamptz default now()
)
audit_log(id, user_id, action, ok, detail, at)
```

## Crypto contract
- **Login:** `login_hash = argon2id(password)`; verify on login.
- **KEK:** `kek = argon2id(password + PEPPER, kdf_salt) → 32 bytes` (PEPPER from env).
  Never stored.
- **CLI password:** random 32 bytes per user; the CLI uses it to encrypt its own
  `storage.json`. We store only `enc_cli_pw = AES-256-GCM(kek, cli_pw)`.
- **At rest we hold:** `login_hash`, `kdf_salt`, `enc_cli_pw`+`nonce`, the
  CLI-encrypted `storage_blob`, and the **public** `account_id`. No plaintext key,
  no plaintext password, no recovery phrase.
- **Per operation:** materialize a temp wallet home from `storage_blob`, decrypt
  `cli_pw` with the request's `kek`, run the CLI feeding `cli_pw` on stdin, persist
  any changed `storage.json` back (re-encrypted by the CLI), wipe the temp home.

## Security rules
- Server binds localhost in dev; behind Railway TLS in prod.
- All write routes require a valid session; sends additionally require the password.
- Validate every CLI arg with `assertSafeMention` (no argument injection).
- Never log secrets/passwords/KEK; audit_log stores action + result only.
- Rate-limit auth + send.

---

## Phases & acceptance criteria

### Phase 1 — Auth + DB + sessions
- `users` table migrated. Sign up creates a user; duplicate email rejected.
- Passwords stored only as Argon2id hashes; login verifies; logout clears session.
- Protected route returns 401 without a session, 200 with one.
- **Checks:** register → login → access protected → logout → blocked. Wrong password rejected.

### Phase 2 — Key vault (crypto), no chain
- `encryptForUser` / `decryptForUser` round-trip (AES-256-GCM) with a KEK.
- Wrong password fails to decrypt (auth tag rejects).
- **Checks:** unit test: encrypt→decrypt returns original; tampered ciphertext throws; wrong KEK throws.

### Phase 3 — Per-user account creation
- Sign up also creates a LEZ account (CLI), stores `account_id` + encrypted
  `cli_pw` + `storage_blob`. Recovery phrase shown once, not stored.
- Logged-in user sees their own balance (node read) + receive QR.
- **Checks:** new user has a `Public/...` id; balance endpoint returns their data;
  DB holds no plaintext key; recovery phrase appears once in the signup response only.

### Phase 4 — Send (public, then private)
- `POST /api/wallet/send` requires session + password; unlocks, runs transfer, wipes.
- Public send works; private send (Private/ account) generates a proof.
- **Checks:** send between two test users updates balances; wrong password → 401, no
  spend; (private path verified when a matching sequencer is available).

### Phase 5 — Dockerize + Railway
- Engine image includes `wallet` CLI + circuits; compose runs ui + postgres + sequencer.
- Railway: services + Postgres + secrets (PEPPER, DB URL, node/sequencer URLs).
- **Checks:** `docker compose up` → register/login/balance work against the stack.

### Phase 6 — Harden + final E2E
- Rate limits, audit log, security headers, concurrency cap on proving.
- **Checks:** full journey green; re-audit deps; confirm every PRD success item +
  SPEC criterion met; list anything deferred.
