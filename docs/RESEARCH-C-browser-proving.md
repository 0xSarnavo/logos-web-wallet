# Track C — In-browser ZK proof generation (research)

**Question:** Can the LEZ wallet generate its private-transfer ZK proof *fully in
the browser* (WASM), instead of via the native `wallet` CLI?

**Verdict (June 2026): Not viable today. Near-future at best. Use delegated/remote
proving (Track B) if you want a browser-only UX with real proofs.**

LEZ private transfers are proven with **RISC Zero** (`rzup` toolchain, circuits in
`~/.logos-blockchain-circuits`). So this question is specifically: *can the RISC
Zero prover run in browser WASM?*

---

## Why not viable now

### 1. The prover is not a supported browser/WASM target
RISC Zero compiles **verifiers** to `wasm32` (used for on-chain / edge
verification, e.g. `groth16_verifier.wasm` in smart contracts). The **prover** is
heavy native Rust — it relies on multithreading (Rayon) and hardware
acceleration (Metal/CUDA) and is not shipped as a browser-WASM target.
*Proving ≠ verifying;* verifying in WASM is the easy half and may be worth doing
client-side regardless.

### 2. Memory wall — confirmed by Logos's own benchmarks
Logos Vac Research's zkVM testing report (research.logos.co) benchmarked RISC0 on
server hardware **without GPU**:

| Workload | Proving time | Peak RAM |
|---|---|---|
| Stage 1 (basic arithmetic) | 9.73 s | **1.9 GB** |
| Stage 2 (memory ops) | 16.63 s | **2.3 GB** |

Proof size ~217 KB. Even the *trivial* case needs ~1.9 GB. Browser `wasm32`
linear memory historically caps ~2 GB (Memory64 raises it but with weaker browser
support). A real transfer circuit — the LEZ docs already say it "takes minutes"
natively — would be single-threaded and memory-bound in a tab, and likely OOM.

### 3. Browser execution constraints
- **Threads:** need `SharedArrayBuffer` → requires **cross-origin isolation**
  (`COOP: same-origin` + `COEP: require-corp`). *(Already set in `next.config.mjs`
  so we're ready if this ever becomes feasible.)*
- **No GPU** for this kind of compute (WebGPU exists, but RISC Zero's prover isn't
  built against it).
- Single-thread fallback makes a multi-minute proof dramatically worse.

---

## The realistic path: Track B (delegated / remote proving)

RISC Zero's recommended answer for clients that can't prove locally is **remote
proving**:

- **Bonsai SDK / Boundless network** — set `BONSAI_API_KEY` + `BONSAI_API_URL`;
  `default_prover()` routes proving jobs remotely. Boundless is a decentralized
  proving marketplace (provers stake ZKC, claim jobs, run CPU/GPU off-chain).
- **Current performance (Q1 2026):** a 10–50M-cycle computation proves in ~30 s
  to a few minutes depending on parallelization. Boundless explorer showed ~363
  active provers.
- RISC Zero also supports a **STARK→SNARK (Groth16) wrap** producing a small
  receipt that's cheap to verify on-chain / in-browser — good for the *verify*
  side even when proving is remote.

**Trust note:** to keep client-side guarantees with remote proving, generate the
witness/secrets client-side and send only the minimum to the prover, or let users
point at a **self-hosted** prover they control.

---

## Recommended architecture spectrum

```
Browser UI ──► proof location?
  ├─ (A) Local native prover  → browser → localhost wallet daemon (RISC Zero).  ✅ shipped here
  ├─ (B) Remote/delegated     → witness client-side, prove via Bonsai/Boundless. ⚠️ realistic browser-only path
  └─ (C) In-browser WASM      → compile RISC Zero prover to wasm32.              🔬 not viable now
```

**Do client-side *verification* in WASM regardless** — it's cheap and gives the
browser an independent check of any proof it receives.

---

## If we still want to spike Track C

1. Read the actual prover entry point in `logos-blockchain/logos-execution-zone`
   (the guest crate + host `prove()` call) — not yet inspected; the LEZ docs note
   no local checkout was examined.
2. Compile **just the verifier** to `wasm32-unknown-unknown` first (high chance of
   success, immediately useful).
3. Attempt the prover behind a feature flag with Memory64 + threads; measure RAM
   on the smallest possible circuit. Expect failure on a real transfer circuit.
4. Re-evaluate when RISC Zero ships its 2026 roadmap items (GPU accel, recursive
   proofs for ~1000× scaling, P2P provers).

---

## Sources
- RISC Zero zkVM docs — https://dev.risczero.com/api/zkvm/
- RISC Zero remote proving (Bonsai) — https://dev.risczero.com/api/generating-proofs/remote-proving
- Bonsai SDK — https://www.mintlify.com/risc0/risc0/proving/bonsai-sdk
- RISC Zero on GitHub — https://github.com/risc0/risc0
- Boundless testnet launch — https://blockworks.com/news/risc-zero-launches-boundless-testnet-base
- Logos Vac Research, zkVM Testing Report — https://research.logos.co/rlog/zkVM-testing/

*Compiled June 2026. Performance figures are version-specific and will move; re-verify before committing to an architecture.*
