# Deploying the Multi-User Wallet on Railway

Plain steps to host the custodial wallet. Read [SECURITY.md](SECURITY.md) and
[PRD.md](PRD.md) first — you will be holding users' funds.

## What runs where

| Component | Where |
|---|---|
| Wallet UI + API (this app) | Railway service (Docker, this repo) |
| Postgres (users + sealed keys) | Railway Postgres add-on |
| Logos node | Existing one you run (set `NODE_API`) — "mix" per your choice |
| LEZ sequencer | Railway service **or** existing one (set `SEQUENCER_API`) |
| `wallet` CLI + circuits | Baked into the app image (see below) |

## The image must contain the `wallet` CLI + circuits

The app shells out to the `wallet` binary, which needs the RISC Zero circuits.
The lean `Dockerfile` here builds the **UI only**. For a deployable multi-user
image, extend it to also include a **Linux** `wallet` build + circuits:

```dockerfile
# (sketch — add to a builder stage)
# 1. install rust + rzup, clone logos-blockchain + logos-execution-zone,
#    run ./scripts/setup-logos-blockchain-circuits.sh,
#    cargo install --path lez/wallet --root /out
# 2. in the runner stage:
#    COPY --from=walletbuild /out/bin/wallet /usr/local/bin/wallet
#    COPY --from=walletbuild /root/.logos-blockchain-circuits /root/.logos-blockchain-circuits
```

> This stage is large and slow (the ZK toolchain). Build it once and cache it.
> **Pin the SAME commit your sequencer runs** or transfers fail with
> `InvalidSignature` (we hit exactly this). In local testing the working pair was
> the lez repo at commit **`cf3639d8`** (the wallet uses env var
> `NSSA_WALLET_HOME_DIR`). Confirm your sequencer's commit and match it.

## Steps

1. **Create the project & link the repo**
   ```bash
   railway init
   railway up         # builds via Dockerfile, deploys
   ```
2. **Add Postgres**: Railway dashboard → New → Database → PostgreSQL. Railway
   injects `DATABASE_URL` automatically.
3. **Set secrets** (Variables tab) — generate strong random values:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # x2
   ```
   - `SESSION_SECRET` — session cookie encryption (≥32 chars)
   - `WALLET_PEPPER` — KDF pepper (≥32 chars). **Never change after launch** —
     it would make every stored key undecryptable.
   - `NODE_API` — your Logos node URL
   - `SEQUENCER_API` — your sequencer URL
   - `WALLET_BIN=/usr/local/bin/wallet`, `WALLET_HOMES_DIR=/data/homes`
   - `PROOF_TIMEOUT_SECONDS=600`
4. **(Optional) sequencer service**: deploy the LEZ sequencer as its own Railway
   service from the matching commit; point `SEQUENCER_API` at its internal URL.
5. **Deploy & verify**: open the URL, register, log in, check balance.

## Operational notes
- **Proving is heavy** (minutes, ~2 GB RAM each). Give the service enough memory
  and cap concurrency; private sends are the expensive path.
- **Back up Postgres** — it holds the (sealed) keys. Losing it loses all wallets.
- **TLS**: Railway terminates TLS; the app may bind `0.0.0.0` inside the platform.
  Do not expose the raw port elsewhere without auth.
- **Recovery policy**: none by design. Users who lose password + recovery phrase
  lose funds. Make this explicit in your signup UI.
