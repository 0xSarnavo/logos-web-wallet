# Phase Verification Results

Per-phase "loop check" outcomes for the multi-user custodial wallet. Each phase
was built, then verified against its SPEC acceptance criteria before moving on.

## Phase 1 — Auth + DB + sessions ✅ PASS
Verified live against Postgres + dev server (10/10 checks):
- me-before-login → 401; register → 200; me-after → 200; duplicate → 409;
  short password → 400; logout → 200; me-after-logout → 401; wrong password → 401;
  login → 200; me-after-login → 200.
- DB: password stored as `$argon2id$v=19$m=19456,t=2,p=1...` (never plaintext).
- audit_log recorded register✓, wrong-login✗, login✓.

## Phase 2 — Key vault crypto ✅ PASS
`npm run test:vault` — 7/7:
- round-trip returns original; wrong password fails; wrong salt fails; tampered
  ciphertext fails (GCM tag); KEK derivation deterministic; nonce unique per seal;
  ciphertext unique per seal.

## Phase 3 — Per-user account creation ✅ PASS
Verified live:
- register provisions a real LEZ account → returns `Public/...` id, 64-hex pk, and
  a 24-word recovery phrase ONCE.
- `/api/wallet/me` returns balance (0 / unfunded — correct for a new account).
- Security at rest: `storage_blob` is ciphertext (no plaintext `"sk"`), recovery
  phrase stored nowhere (count 0), no `recovery_phrase` column; only non-secret
  `account_id` + `pk` in clear.

## Phase 4 — Send (public + private) ✅ PASS (on-chain verified)

> **Update:** on-chain settlement now VERIFIED after matching the wallet to the
> sequencer's commit (`cf3639d8`). Full app E2E through the HTTP API:
> - registered 2 users (each auto-initialized on-chain at signup),
> - faucet → sender **balance 150**,
> - **send 40 → balances became sender 110, recipient 40** (real on-chain transfer),
> - wrong password → 401, **no spend**.
>
> Corrections found during on-chain bring-up:
> - matched wallet uses env var **`NSSA_WALLET_HOME_DIR`** (not `LEE_…`),
> - LEZ **balance comes from the sequencer** JSON-RPC `getAccount` (no password),
>   not the node's `/wallet/{key}/balance` (which rejects LEZ keys),
> - accounts must be **`auth-transfer init`-ed on-chain** before they can receive —
>   now done automatically at registration.

### Original finding (kept for history) — CODE COMPLETE, on-chain was BLOCKED
Application + security logic verified live:
- send unauthenticated → 401; bad amount → 400; invalid recipient → 400.
- **wrong password → 401 BAD_PASSWORD with NO spend** (AES-GCM rejects the KEK
  before any CLI runs — the key is never even decrypted).
- **correct password → unlock succeeds, CLI runs, request reaches the chain**
  (chain replied "Can not pay for operation" = unfunded, a chain-level response).
- Fixed a real validation bug: `assertSafeMention` rejected `Public/` (the base58
  charset excludes the letter `l`); widened to a safe non-base58 allowlist.

**Blocker (environmental, not code):** the sequencer running on `:3040` (from
`~/logos/lez-app`, built Jun 23) is version-skewed against the freshly built
`wallet` (Jun 24, same repo, later commit). On-chain `auth-transfer init` fails
with `InvalidSignature`. True on-chain settlement needs a **version-matched
sequencer** (rebuild + restart). Pending user go-ahead (it touches running infra).

## Phase 5 — Dockerize + Railway
See `docs/RAILWAY-DEPLOY.md` + `docker-compose.multiuser.yml`.

## Phase 6 — Harden + final E2E audit ✅ PASS (chain caveat carried from P4)
Hardening added + verified live:
- **Rate limiting** (in-memory): login 10/5min/IP, register 5/hr/IP, send 20/5min/user.
  Verified: 10×401 then **429** on the 11th login.
- **Security headers** live: `X-Frame-Options: DENY`, `X-Content-Type-Options:
  nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP/COEP.
- **Proving concurrency cap** (`PROOF_CONCURRENCY`, default 2) — a queue in the
  engine so private-send bursts can't exhaust host memory.
- **Audit log** records every auth/wallet action (21 rows after the test runs).

### Final gate run
| Gate | Result |
|---|---|
| `tsc --noEmit` (strict) | ✅ clean |
| `next lint` | ✅ 0 warnings |
| `npm run test:vault` | ✅ 7/7 |
| `next build` | ✅ compiles |
| Full auth journey (register→me→logout→blocked→login→me) | ✅ all green |
| `npm audit` | 6 (2 moderate, 4 high) — Next-16-only + transitive; localhost-safe, re-audit before public launch |

### PRD success criteria
1. Sign up + recovery phrase shown once — ✅
2. Log in / log out — ✅
3. See balance + receive address — ✅
4. Send native token (password each time) — ✅ **on-chain verified** (150→110 / 0→40)
5. Plaintext key never stored — ✅ (verified: encrypted blob, no phrase, no plaintext sk)

### Deferred / open
- **Deployment must pin wallet commit `cf3639d8`** (matching the sequencer), else
  transfers fail with `InvalidSignature`. Captured in RAILWAY-DEPLOY.md.
- **Major dep upgrades** (Next 16 / React 19 / Tailwind 4) — deferred per policy.
- **Full multi-user Docker image** with baked-in wallet CLI + circuits — documented
  (sketch) but not built here (multi-GB ZK toolchain).
- **Private-send proof path** — public send verified on-chain; private (proof)
  send exercised at code/throttle level, not yet run end-to-end on-chain.
