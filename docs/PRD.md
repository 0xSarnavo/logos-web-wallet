# PRD — Multi-User Custodial Logos Wallet

## Goal
A hosted website where many users sign up, log in, and use a Logos wallet. The
server custodies each user's key, **locked by the user's password**. Deployable on
Railway in Docker.

## Locked decisions
- **Recovery:** none. Password is the sole unlock. We show the LEZ recovery phrase
  **once at signup** (user backs it up themselves); we never store it. Forgotten
  password + lost phrase = funds unrecoverable. (Most secure.)
- **Infra:** point at an existing Logos **node**; **sequencer** URL is configurable
  (existing or a Railway service).
- **Password timing:** required on **every** send. The key-encryption key (KEK) is
  never cached in the session.

## Users & jobs
- *Visitor* → sign up (email + password) → gets a wallet account.
- *User* → log in → see balance, receive (QR), send (public or private).
- *Operator (you)* → deploy + run; hold only **locked** secrets.

## Non-goals (for now)
- Non-custodial / in-browser proving (tracked separately, Track B/C).
- Password reset / account recovery.
- Multi-account per user, tokens/AMM (native-token transfers only first).

## Success = a user can
1. Sign up and is shown a recovery phrase once.
2. Log in / log out.
3. See their balance and receive address/QR.
4. Send the native token (entering password each time).
5. Never have their plaintext key stored at rest.

## Top risks (accepted, mitigated)
- Custodial breach exposure → KEK from Argon2id, AES-256-GCM at rest, server pepper,
  least-privilege, audit log.
- Proof cost/load → concurrency cap on proving, long timeouts, public-send default.
- Sequencer/wallet version drift → pin both to the same checkout; health check.
