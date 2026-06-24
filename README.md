# Logos Wallet

A browser wallet for the **Logos Execution Zone (LEZ)**: create accounts, transfer
the native token, check balances (sent/received via UTXO notes), receive funds (QR),
and run **private transfers whose ZK proof is generated locally**.

> UI → **http://localhost:3344**

> **Disclaimer:** Independent, community-built. Not affiliated with or endorsed by
> the Logos / Nomos core dev team. Provided as-is.

---

## Architecture (Track A)

The browser UI never touches keys or the prover directly. It calls local Next.js
API routes, which (a) read the node's HTTP API for chain/balance data, and (b) drive
the local LEZ `wallet` CLI for account creation, transfers, and proof generation.

```
  Browser UI (:3344)
        │  fetch /api/*
        ▼
  Next.js API routes ──HTTP──► Logos node API (:8080)   [read: chain, balance, notes]
        │
        └── spawn ─────────────► `wallet` CLI ──► standalone sequencer (:3040)
                                  (LEZ, logos-execution-zone)
                                  • account new / get
                                  • auth-transfer send (public)
                                  • auth-transfer send --private  ← local ZK proof (minutes)
                                  • pinata claim (faucet)
```

**Proofs are generated on the user's machine, not in the browser.** True in-browser
WASM proving (Track C) is **not viable today** — see
[`docs/RESEARCH-C-browser-proving.md`](docs/RESEARCH-C-browser-proving.md). The
realistic browser-only path is delegated/remote proving (Track B, Bonsai/Boundless).

---

## Prerequisites

| For | You need |
|---|---|
| Read-only (balances, chain status) | A reachable Logos **node** on `:8080` |
| Create / transfer / faucet / proofs | The LEZ **`wallet` CLI** + a **sequencer** on `:3040` |

The app runs and shows balances **without** the CLI; account/transfer features show a
clear "CLI not installed" message until you set it up.

### Install the wallet CLI (for write features)

```bash
# circuits (one-time)
git clone https://github.com/logos-blockchain/logos-blockchain.git
cd logos-blockchain && ./scripts/setup-logos-blockchain-circuits.sh

# the wallet CLI
cd .. && git clone https://github.com/logos-blockchain/logos-execution-zone.git
cd logos-execution-zone && cargo install --path wallet --force
wallet help

# a local sequencer (separate terminal)
RUST_LOG=info cargo run --features standalone -p sequencer_runner \
  sequencer_runner/configs/debug    # listens on 0.0.0.0:3040
```

---

## Run

```bash
npm install
cp .env.example .env.local     # adjust NODE_API / SEQUENCER_API / WALLET_BIN if needed
npm run dev                    # → http://localhost:3344
```

Production: `npm run build && npm start`.

---

## Configuration (`.env.local`)

| Var | Default | Meaning |
|---|---|---|
| `NODE_API` | `http://localhost:8080` | Node HTTP API (read: chain, balance) |
| `SEQUENCER_API` | `http://localhost:3040` | Standalone sequencer |
| `WALLET_BACKEND` | `cli` | `cli` (shell out to `wallet`) or `sequencer` |
| `WALLET_BIN` | `wallet` | Path to the `wallet` binary |
| `WALLET_HOME` | _(unset)_ | Override wallet storage home |
| `PROOF_TIMEOUT_SECONDS` | `600` | Max wait for a proof-generating call |

---

## API routes

| Route | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Node reachability + wallet CLI availability |
| `/api/chain` | GET | Chain + network info |
| `/api/balance?key=<64hex>` | GET | Balance + UTXO notes for a public key |
| `/api/account` | POST | Create a new public account |
| `/api/account?id=…` | GET | Account detail |
| `/api/transfer` | POST | `{from,to,amount,private?}` — public or private transfer |
| `/api/faucet` | POST | `{to}` — faucet claim |

The node's `GET /wallet/{key}/balance` returns `{ tip, balance, notes }`, where
`notes` maps UTXO note ids → values. Unknown keys are treated as balance 0.

---

## Status

- ✅ Read path verified against a live node (`/api/health`, `/api/chain`, `/api/balance`).
- ✅ Write paths wired to the documented `wallet` CLI commands; surface a clear
  "CLI missing" state until the binary is installed.
- 🔬 Track C (in-browser proving) researched — not viable now; see the research doc.
