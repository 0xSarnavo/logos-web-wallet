# Security Review — Logos Wallet

Scope: the Next.js app in this folder (UI + `/api/*` routes + `src/lib`). It does
**not** cover the upstream `wallet` CLI, sequencer, or node.

## Threat model (read this first)

This is a **local, single-user wallet UI**. The API routes drive a `wallet` CLI
that holds spending keys and read the node API. There is **no authentication** on
the write endpoints — by design, because the app is meant to run on `localhost`
for one operator. The security posture therefore rests on **not exposing the port**.

| Asset | Exposure if port is reachable by an attacker |
|---|---|
| Spending (transfers) | `POST /api/transfer` can move funds from any wallet account |
| Faucet | `POST /api/faucet` can drain faucet allowance |
| Account creation | `POST /api/account` can create accounts |

**Mitigation shipped:** `dev`/`start` bind to `127.0.0.1` only (`-H 127.0.0.1`),
so the server is not reachable from the LAN by default.

## Findings & status

### 1. Argument injection into the CLI — FIXED
`from`/`to`/faucet-`to`/account-`id` reach `spawn()` as CLI args.
- `spawn` is called **without `shell: true`**, so there is **no command
  injection** (no shell metacharacter evaluation). ✅ correct by construction.
- Residual risk was **argument injection**: a value like `--help` or
  `-X` would be parsed by clap as a flag. **Fixed** with `assertSafeMention()`
  (`src/lib/wallet-cli.ts`): rejects empty, leading `-`, over-long, and
  out-of-charset values (base58 + `Public/`/`Private/`/label chars). Applied in
  `/api/transfer`, `/api/faucet`, `/api/account`.

### 2. Amount precision / integer safety — FIXED
`amount` is `u128` on the CLI. JSON numbers are IEEE-754 doubles, so a large
value would silently lose precision before reaching the CLI. `/api/transfer` now
requires `Number.isSafeInteger(amount) && amount > 0` (≤ 2^53−1). For amounts
beyond that, accept a string and pass through verbatim (future work).

### 3. SSRF — NOT EXPLOITABLE
`NODE_API`/`SEQUENCER_API` are server-side config, not user input. The balance
endpoint validates the key as exactly 64 hex chars before interpolating it into
the node URL (`/api/balance`). No user-controlled host/path. ✅

### 4. Input validation on balance key — PRESENT
`/api/balance` enforces `^[0-9a-fA-F]{64}$` and URL-encodes. ✅

### 5. Error message leakage — ACCEPTED (low risk, local tool)
CLI `stderr` is returned to the client to aid debugging. On a localhost
single-user tool this is acceptable; it may reveal local paths. If ever exposed,
gate raw `stderr`/`raw` behind a debug flag.

### 6. No auth on write endpoints — ACCEPTED + MITIGATED
See threat model. Mitigated by localhost binding. **Do not** put this behind a
public reverse proxy without adding auth and CSRF protection first.

### 7. Process/timeout hygiene — PRESENT
Each CLI call has a timeout (`FAST` 30s; `PROOF` = `PROOF_TIMEOUT_SECONDS`,
default 600s) and is `SIGKILL`ed on expiry, preventing hung proof processes from
piling up. ✅

### 8. Dependency advisories — TRACKED (stay-stable policy)
- `next` on `14.2.35` (latest patched 14.x), `postcss` forced to `^8.5.15` via
  `overrides` — clears the postcss stringify-XSS (moderate).
- **4 remaining highs, all accepted for a localhost wallet:**
  - **Next.js advisories** — only fully fixed in Next 16 (breaking). Every one is
    in a feature this app does not expose on localhost: `next/image` optimizer,
    RSC request handling, middleware/proxy rewrites, i18n. Not reachable here.
  - **glob** (transitive, dev only) — command injection via the glob **CLI**
    `-c/--cmd`, which this project never invokes. No runtime exposure.
- Upgrade path to clear them: migrate to **Next 16 + React 19** (re-test required).
  Re-audit before any non-localhost deployment.

## Multi-user custodial mode (added)

The app also has a custodial multi-user mode (auth + per-user sealed keys). Its
security model:

- **Passwords:** Argon2id login hash; never stored in plaintext (verified at rest
  as `$argon2id$...`).
- **Key at rest:** each user's wallet `storage.json` + CLI password are sealed with
  **AES-256-GCM** under a **KEK = Argon2id(password + server PEPPER, per-user salt)**.
  The KEK is derived per request and never persisted. Verified: DB holds ciphertext
  only — no plaintext `sk`, no recovery phrase, no `recovery_phrase` column.
- **Recovery phrase:** shown once at signup, never stored (recovery = none by design).
- **Send requires the password every time** — the KEK is not cached in the session
  (session holds only user id/email). Wrong password → AES-GCM rejects → **no spend**.
- **Rate limiting:** login 10/5min/IP, register 5/hr/IP, send 20/5min/user (in-memory;
  move to Redis for multi-instance).
- **Proving throttle:** `PROOF_CONCURRENCY` caps concurrent (heavy) proofs.
- **Audit log:** every auth/wallet action recorded (no secrets).

**Residual custodial risk (inherent):** during a send the server briefly holds the
decrypted key in memory — a compromised server could capture it then. Custodial is
never as safe as non-custodial. `WALLET_PEPPER` must be kept secret and stable
(losing/changing it makes all stored keys undecryptable). See `docs/PRD.md`.

## Hardening checklist if you ever expose this beyond localhost
- [ ] Add authentication (at minimum a shared secret / session) to all `POST` routes.
- [ ] Add CSRF protection (the write routes are simple JSON POSTs).
- [ ] Rate-limit `/api/transfer` and `/api/faucet`.
- [ ] Hide raw `stderr` behind a debug flag.
- [ ] Support string amounts for full u128 range.
- [ ] Put a confirmation step (signing UX) before any transfer.

*Reviewed June 2026 against the code in this folder.*
