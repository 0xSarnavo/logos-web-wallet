// Central config, read from env on the server only. Never import into client
// components — these may reference local binaries / internal hosts.

export const config = {
  nodeApi: process.env.NODE_API ?? "http://localhost:8080",
  sequencerApi: process.env.SEQUENCER_API ?? "http://localhost:3040",
  walletBackend: (process.env.WALLET_BACKEND ?? "cli") as "cli" | "sequencer",
  walletBin: process.env.WALLET_BIN ?? "wallet",
  walletHome: process.env.WALLET_HOME || undefined,
  walletHomesDir: process.env.WALLET_HOMES_DIR || undefined,
  proofTimeoutSeconds: Number(process.env.PROOF_TIMEOUT_SECONDS ?? "600"),
};

export type WalletBackend = typeof config.walletBackend;
