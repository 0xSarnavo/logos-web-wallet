# Code Quality & Conventions

Snapshot of the quality gates and the language/framework best practices applied.

## Gates (all green)

| Check | Command | Status |
|---|---|---|
| Type check (strict) | `npm run typecheck` | ✅ clean |
| Lint | `npm run lint` (`next/core-web-vitals` + `next/typescript`) | ✅ 0 warnings/errors |
| Production build | `npm run build` | ✅ compiles |

`tsconfig.json` runs in `strict` mode.

## TypeScript
- **No `any`.** Catch clauses use `unknown` narrowed via `errMessage(e)`; Node
  spawn errors are typed `NodeJS.ErrnoException`.
- Typed error classes (`ApiError`, `NodeApiError`, `MentionError`) instead of
  string sniffing, so callers branch on `instanceof` + a `code`.
- Exported interfaces for every API payload (`ChainInfo`, `BalanceResult`, …).
- Path alias `@/*` → `src/*`.

## React / Next.js (App Router)
- **Server/client split is deliberate.** `src/lib/config.ts`, `node-api.ts`,
  `wallet-cli.ts` are server-only (they touch env, local binaries, internal
  hosts) and are never imported into client components.
- Client components marked `"use client"`; data fetching goes through `/api/*`
  route handlers, never directly to the node from the browser.
- Route handlers set `dynamic = "force-dynamic"` (no accidental caching of
  balances); the proof-generating transfer route sets `maxDuration = 600`.
- Polling effects (`StatusBar`) clean up their interval and guard against
  setting state after unmount (`live` flag).

## Robustness
- Every CLI call is timed out and `SIGKILL`ed on expiry (no zombie provers).
- Unknown balance keys degrade to `balance: 0` instead of throwing.
- Input validation at the trust boundary: 64-hex for keys, `assertSafeMention`
  for account ids, safe-integer for amounts.

## Dependency policy
- Stay on latest **patched** versions within the current majors (see
  [SECURITY.md](SECURITY.md) §8). Major migrations (Next 16 / React 19 /
  Tailwind 4 / TS 6) are tracked but deferred to keep the build verifiable.

## Known follow-ups
- Support string amounts for the full `u128` range (currently ≤ 2^53−1).
- Add a signing-confirmation step before transfers.
- Optional: unit tests for `assertSafeMention` / `parseAccountId` / `balanceOrZero`.
