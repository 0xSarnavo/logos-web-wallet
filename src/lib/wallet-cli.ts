// Server-side wrapper around the LEZ `wallet` CLI (logos-execution-zone).
//
// Commands are grounded in the documented LEZ wallet flows:
//   wallet check-health
//   wallet account new public                         → create account, returns Public/<id>
//   wallet account get --account-id Public/<id>
//   wallet auth-transfer init --account-id Public/<id>
//   wallet auth-transfer send --from Public/<a> --to Public/<b> --amount <n>
//   wallet pinata claim --to Public/<id>              → faucet
//   wallet token send --from <acct> --to <acct> --amount <n>
//
// PRIVATE transfers generate a ZK proof locally (RISC Zero) and may take
// MINUTES — that's why proof-generating calls get the long PROOF_TIMEOUT.
//
// This module NEVER throws raw child_process noise to the client; it returns a
// typed Result so the API layer can surface clean errors (incl. "CLI missing").

import { spawn } from "node:child_process";
import { config } from "./config";

export interface CliResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  /** Set when the failure is "the `wallet` binary isn't installed". */
  notInstalled?: boolean;
  /** Set when the call exceeded its timeout (likely a long proof). */
  timedOut?: boolean;
}

function run(args: string[], timeoutMs: number): Promise<CliResult> {
  return new Promise((resolve) => {
    const env = { ...process.env };
    if (config.walletHome) env.NSSA_WALLET_HOME = config.walletHome;

    let child;
    try {
      child = spawn(config.walletBin, args, { env });
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      resolve({
        ok: false,
        stdout: "",
        stderr: err.message ?? String(e),
        notInstalled: err.code === "ENOENT",
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        stdout,
        stderr: e.message ?? String(e),
        notInstalled: e.code === "ENOENT",
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        stdout,
        stderr,
        timedOut: timedOut || undefined,
      });
    });
  });
}

const FAST = 30_000;
const PROOF = Math.max(config.proofTimeoutSeconds, 30) * 1000;

export const walletCli = {
  available: async (): Promise<boolean> => {
    const r = await run(["help"], FAST);
    return r.ok || !r.notInstalled;
  },

  checkHealth: () => run(["check-health"], FAST),

  // `account new public` / `account new private`. Verified against the real CLI
  // (lez/wallet/src/cli/account.rs: AccountSubcommand::New(NewSubcommand)).
  accountNewPublic: () => run(["account", "new", "public"], FAST),
  accountNewPrivate: () => run(["account", "new", "private"], FAST),

  accountGet: (accountId: string) =>
    run(["account", "get", "--account-id", accountId], FAST),

  authTransferInit: (accountId: string) =>
    run(["auth-transfer", "init", "--account-id", accountId], PROOF),

  /**
   * Send the native token. There is ONE send command — privacy is NOT a flag;
   * it is a property of the accounts. When `from` (or `to`) is a `Private/`
   * account the CLI generates a ZK proof locally, which can take minutes, hence
   * the long PROOF timeout for all sends.
   * (lez/wallet/src/cli/programs/native_token_transfer.rs: AuthTransferSubcommand::Send)
   */
  authTransferSend: (from: string, to: string, amount: number) =>
    run(
      ["auth-transfer", "send", "--from", from, "--to", to, "--amount", String(amount)],
      PROOF,
    ),

  /** Faucet drip. */
  pinataClaim: (to: string) => run(["pinata", "claim", "--to", to], FAST),
};

/** True when an account id denotes a privacy-preserving (proof-generating) account. */
export function isPrivateAccount(accountId: string): boolean {
  return /^Private\//i.test(accountId.trim());
}

/**
 * Validate a value before it is passed as a CLI argument.
 *
 * `spawn` is invoked WITHOUT a shell, so there is no command-injection vector.
 * The residual risk is ARGUMENT injection: a value like "--foo" would be parsed
 * by clap as a flag rather than a positional/option value. We therefore reject
 * leading dashes and constrain the charset to what a real account mention can be
 * (base58 + "Public/"/"Private/" prefix, or a label/BIP-32 path).
 */
export function assertSafeMention(value: string): string {
  const v = value.trim();
  if (!v) throw new MentionError("account id is required");
  if (v.length > 256) throw new MentionError("account id is too long");
  if (v.startsWith("-")) throw new MentionError("account id may not start with '-'");
  // base58, slashes (privacy prefix / key path), word chars, dot/colon for labels.
  if (!/^[1-9A-HJ-NP-Za-km-z/_.:-]+$/.test(v)) {
    throw new MentionError("account id contains invalid characters");
  }
  return v;
}

export class MentionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MentionError";
  }
}

/**
 * Parse a "Public/<base58>" or "Private/<base58>" account id out of CLI stdout.
 * Account ids are base58 (NOT hex) with a privacy prefix
 * (lez/wallet: CliAccountMention / AccountIdWithPrivacy). Returns the first match.
 */
export function parseAccountId(stdout: string): string | null {
  const m = stdout.match(/(?:Public|Private)\/[1-9A-HJ-NP-Za-km-z]+/);
  return m ? m[0] : null;
}
