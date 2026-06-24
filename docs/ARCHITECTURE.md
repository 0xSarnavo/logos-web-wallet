# Architecture

How the wallet is put together and how a request flows through it.

← back to [README](../README.md) · related: [SECURITY](SECURITY.md) · [DEPLOYMENT](DEPLOYMENT.md) · [NODE-AND-SEQUENCER](NODE-AND-SEQUENCER.md)

## What it is

A web wallet for the **Logos Execution Zone (LEZ)** native token. Users create an
account, check balances, receive, and send (public or private). It runs in two
shapes:

- **Single-user** — a personal UI over a local wallet (you hold your own keys).
- **Multi-user custodial** — a hosted site where many users sign up; the server
  holds each user's key **sealed with their password**.

## System overview

```mermaid
flowchart TB
  user["User browser"]

  subgraph app["Wallet app (Next.js) — one deployable"]
    ui["UI pages"]
    api["API routes /api/*"]
    engine["Wallet engine<br/>seal/unseal + run CLI"]
  end

  subgraph state["State"]
    pg[("Postgres<br/>users + sealed keys")]
    cli["wallet CLI<br/>(LEZ, per-user)"]
  end

  subgraph chain["Logos chain (external)"]
    seq["LEZ sequencer<br/>:3040 — submit tx + read balance"]
    node["Logos node<br/>:8080 — chain status"]
  end

  user -->|https| ui --> api
  api --> engine
  api -->|users, sealed keys| pg
  engine -->|spawn| cli
  cli -->|submit tx| seq
  api -->|getAccount JSON-RPC| seq
  api -->|chain info| node
```

**Key point:** the browser never touches keys or the prover. Everything sensitive
happens server-side; the chain (node + sequencer) is external and pluggable
(see [NODE-AND-SEQUENCER](NODE-AND-SEQUENCER.md)).

## Components

| Part | Role |
|---|---|
| **UI pages** | Login, dashboard, send/receive |
| **API routes** (`src/app/api/*`) | Auth, wallet read/write; the trust boundary (validation, rate limits) |
| **Wallet engine** (`src/lib/wallet-engine.ts`) | Derives the KEK, unseals the key into a temp home, runs the CLI, re-seals, wipes |
| **Crypto vault** (`src/lib/crypto-vault.ts`) | Argon2id KEK + AES-256-GCM seal/open |
| **Postgres** | `users` (Argon2id login hash), `wallets` (sealed key + storage), `audit_log` |
| **wallet CLI** | The real LEZ wallet — key gen, signing, proof generation |
| **Sequencer** | LEZ execution layer: accepts transactions, answers balance queries |
| **Node** | Logos blockchain node: chain height / status |

## How a read works (balance — no password)

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as API /api/wallet/me
  participant S as Sequencer :3040
  B->>A: GET (session cookie)
  A->>A: look up user's account_id
  A->>S: JSON-RPC getAccount(account_id)
  S-->>A: { balance, nonce }
  A-->>B: balance
```

## How a send works (password required every time)

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as API /api/wallet/send
  participant V as Crypto vault
  participant E as Engine (temp home)
  participant C as wallet CLI
  participant S as Sequencer
  B->>A: POST { to, amount, password }
  A->>V: deriveKEK(password + pepper + salt)
  V-->>A: KEK
  A->>E: open(sealed storage + cli pw) → temp home
  Note over E: wrong password → AES-GCM fails → 401, NO spend
  E->>C: wallet auth-transfer send --from --to --amount
  C->>S: submit signed tx (proof if private)
  S-->>C: tx hash
  E->>E: re-seal updated storage, WIPE temp home
  A-->>B: ok
```

## How the key stays safe

```mermaid
flowchart LR
  subgraph signup["At signup"]
    pw1["password"] --> kek1["KEK = Argon2id(pw + pepper, salt)"]
    cli1["new LEZ account<br/>storage.json + recovery phrase"]
    kek1 --> seal["AES-256-GCM seal"]
    cli1 --> seal
    seal --> store[("DB: ciphertext only")]
    cli1 -. shown once .-> phrase["recovery phrase<br/>NOT stored"]
  end
```

At rest the DB holds **only** ciphertext + the public `account_id`/`pk`. No
plaintext key, no password, no recovery phrase. Details in [SECURITY](SECURITY.md).
