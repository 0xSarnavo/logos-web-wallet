# Plan — Multi-User Wallet (custodial, password-protected) on Railway

Written in plain language. This is a **plan**, not built yet.

## What we are building

Right now the wallet is for **one person on their own computer**. We want a
website where **many people** can sign up, log in, and use a wallet — hosted by
you on **Railway**.

For now it is **custodial**: *you* (the server) hold each user's keys. To keep
them safe, each user's key is **locked with their password**. The server can only
unlock it when the user types their password.

> ⚠️ Be honest with yourself and users: custodial means **you are holding their
> money**. If your server is hacked, that is a serious problem. See "Risks" below.
> This is fine for a demo or a trusted group. For real public money, the safer
> design is non-custodial (users hold their own keys) — that's a later step.

## The pieces (simple parts list)

```
┌──────────────────────────────────────────────────────────┐
│  Browser (the user)                                        │
│   login · dashboard · send · receive                       │
└───────────────┬──────────────────────────────────────────┘
                │  https
┌───────────────▼──────────────────────────────────────────┐
│  Wallet website  (Next.js app — what we already have)      │
│   + login/signup    + sessions                             │
└───┬───────────────────────────┬──────────────────────────┘
    │ user + locked keys         │ run wallet per user
┌───▼─────────────┐      ┌───────▼───────────────────────────┐
│ Database         │      │ Wallet engine                      │
│ (Railway Postgres)│      │ the `wallet` CLI + circuits        │
│ • users          │      │ unlocks key → sends → wipes        │
│ • locked keys    │      └───────┬───────────────────────────┘
└──────────────────┘              │ talks to chain
                         ┌────────▼──────────┐  ┌──────────────┐
                         │ LEZ sequencer      │  │ Logos node    │
                         │ (:3040)            │  │ (:8080)       │
                         └────────────────────┘  └──────────────┘
```

On Railway each box is a **service**. Postgres is a Railway add-on.

## How a key stays safe (the important part)

We never store the key in plain form. We lock it with the user's password.

**When a user signs up:**
1. User picks a password.
2. Server mixes the password with a random "salt" using a slow, strong recipe
   (**Argon2id**). This gives two things:
   - a **login check** value → we save this (to verify the password next time).
   - an **unlock key** → we do **not** save this. It only exists for a moment.
3. Server creates a new Logos account for the user (the `wallet` CLI).
4. Server **locks** (encrypts with **AES-256-GCM**) the account's secret using
   the unlock key.
5. Server saves only the **locked** key + salt. Throws away the plain key and the
   unlock key.

**When a user sends money:**
1. User types their password.
2. Server re-makes the unlock key from password + salt.
3. Server **unlocks** the key into a temporary folder.
4. Server runs the `wallet` send (this is where the ZK proof is made — can take
   minutes for a private send).
5. Server **wipes** the temporary folder and the plain key from memory.

**Checking balance / receiving** needs no password — it's just a public read from
the node.

## What each user flow looks like

- **Sign up:** email + password → account created → locked key saved.
- **Log in:** email + password → password checked → session started.
- **Receive:** show the user's account id + QR. (no password)
- **Check balance:** read from the node. (no password)
- **Send:** enter recipient + amount + password → unlock → send → wipe → show result.

## Where it runs on Railway

| Railway service | What it is |
|---|---|
| `wallet-ui` | The website + the wallet engine (the `wallet` CLI lives in this image) |
| `postgres` | Users + locked keys (Railway add-on) |
| `sequencer` | The LEZ sequencer (must be the **same version** as the wallet CLI) |
| `node` *(optional)* | A Logos node, or point at an existing one |

**Secrets in Railway env vars:** a server-side extra secret ("pepper") added to
the password recipe, plus the database URL. Never put these in the code.

## Build steps (roadmap)

1. **Login system** — sign up, log in, sessions, Postgres `users` table. No money yet.
2. **Locked key vault** — Argon2id + AES-256-GCM; create + lock a key per user.
3. **Read features per user** — show each user their own balance / receive.
4. **Send (public)** — unlock → send → wipe. Then **send (private)** with proofs,
   with a limit on how many proofs run at once (they are heavy).
5. **Dockerize + deploy** — put the `wallet` CLI + circuits in the engine image,
   add Postgres + sequencer, set secrets, deploy on Railway.
6. **Harden** — rate limits, audit log, password-recovery policy, monitoring.

## Risks (read before going live)

- **You hold the money.** A server hack can be very bad. During a send the server
  briefly sees the plain key — a hacked server could steal it then.
- **Forgotten password = lost money** (unless you also store a recovery phrase,
  which lowers safety). **Decide a recovery policy.**
- **Holding others' funds may have legal/licensing duties** depending on where you
  and your users are.
- **Proofs are heavy** (minutes, ~2 GB RAM each). This costs money on Railway and
  needs a concurrency limit.
- The safer long-term answer is **non-custodial** (users hold keys; proving in the
  browser via Track C, or delegated via Track B) — see
  [RESEARCH-C-browser-proving.md](RESEARCH-C-browser-proving.md).

## Decisions needed before building

1. **Recovery:** if a user forgets their password, is losing the funds acceptable,
   or do we keep an encrypted recovery phrase escrow?
2. **Node + sequencer:** run them as Railway services, or point at existing ones?
3. **Password timing:** ask for the password on **every** send (safer), or remember
   the unlock key in the session for a few minutes (smoother)?
