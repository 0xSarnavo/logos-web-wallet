// Multi-user custodial wallet engine. Server-only.
//
// Each user has their own LEZ wallet state (storage.json) which holds secret keys.
// We NEVER keep that state in the clear at rest: it is sealed with the user's KEK
// (derived from their password). To run a CLI command we:
//   1. derive KEK from the request password,
//   2. open the sealed storage.json + sealed CLI password into a temp home,
//   3. run the `wallet` CLI (feeding the CLI password on stdin),
//   4. re-seal the (possibly updated) storage.json,
//   5. wipe the temp home.
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "./config";
import { deriveKek, seal, open, type Sealed } from "./crypto-vault";

const PROOF_MS = Math.max(config.proofTimeoutSeconds, 30) * 1000;
const FAST_MS = 60_000;

// Proof generation is heavy (minutes, ~2 GB RAM). Cap how many run at once so a
// burst of private sends can't exhaust the host. Tune via PROOF_CONCURRENCY.
const PROOF_CONCURRENCY = Math.max(1, Number(process.env.PROOF_CONCURRENCY ?? "2"));
let activeProofs = 0;
const proofQueue: Array<() => void> = [];

async function acquireProofSlot(): Promise<void> {
  if (activeProofs < PROOF_CONCURRENCY) {
    activeProofs++;
    return;
  }
  await new Promise<void>((resolve) => proofQueue.push(resolve));
  activeProofs++;
}
function releaseProofSlot(): void {
  activeProofs--;
  const next = proofQueue.shift();
  if (next) next();
}

interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  notInstalled?: boolean;
  timedOut?: boolean;
}

function runWallet(
  homeDir: string,
  args: string[],
  cliPassword: string,
  timeoutMs: number,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const env = { ...process.env, NSSA_WALLET_HOME_DIR: homeDir };
    let child;
    try {
      child = spawn(config.walletBin, args, { env });
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      resolve({ ok: false, stdout: "", stderr: err.message, notInstalled: err.code === "ENOENT" });
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
      resolve({ ok: false, stdout, stderr: e.message, notInstalled: e.code === "ENOENT" });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, stdout, stderr, timedOut: timedOut || undefined });
    });
    // The CLI reads its password from stdin.
    child.stdin.write(cliPassword + "\n");
    child.stdin.end();
  });
}

async function withTempHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const base = config.walletHomesDir || tmpdir();
  await mkdir(base, { recursive: true }).catch(() => {});
  const home = await mkdtemp(join(base, "lwh-"));
  try {
    return await fn(home);
  } finally {
    // Wipe plaintext secrets from disk.
    await rm(home, { recursive: true, force: true }).catch(() => {});
  }
}

function parseAccountId(s: string): string | null {
  const m = s.match(/account_id\s+(Public\/[1-9A-HJ-NP-Za-km-z]+)/);
  return m ? m[1] : null;
}
function parsePk(s: string): string | null {
  const m = s.match(/\bpk\s+([0-9a-fA-F]{64})\b/);
  return m ? m[1] : null;
}
function parseRecoveryPhrase(s: string): string | null {
  const m = s.match(/Recovery phrase:\s*\n\s*([a-z]+(?:\s+[a-z]+){11,})/);
  return m ? m[1].trim().replace(/\s+/g, " ") : null;
}

export class EngineError extends Error {
  constructor(
    message: string,
    public code: "WALLET_CLI_MISSING" | "BAD_PASSWORD" | "TIMEOUT" | "CLI_FAILED",
  ) {
    super(message);
    this.name = "EngineError";
  }
}

export interface CreatedWallet {
  accountId: string;
  pk: string;
  recoveryPhrase: string; // shown ONCE to the user, never stored
  sealedStorage: Sealed;
  sealedCliPw: Sealed;
}

/**
 * Create a brand-new LEZ account for a user and seal its secrets under the user's
 * password. The recovery phrase is returned for one-time display and is NOT stored.
 */
export async function createWallet(password: string, salt: Buffer): Promise<CreatedWallet> {
  const kek = await deriveKek(password, salt);
  const cliPw = randomBytes(24).toString("base64url"); // strong per-user CLI password

  return withTempHome(async (home) => {
    const r = await runWallet(home, ["account", "new", "public"], cliPw, FAST_MS);
    if (r.notInstalled) throw new EngineError("wallet CLI not installed", "WALLET_CLI_MISSING");
    if (r.timedOut) throw new EngineError("account creation timed out", "TIMEOUT");
    if (!r.ok) throw new EngineError(r.stderr || "account creation failed", "CLI_FAILED");

    const accountId = parseAccountId(r.stdout);
    const pk = parsePk(r.stdout);
    const recoveryPhrase = parseRecoveryPhrase(r.stdout);
    if (!accountId || !pk || !recoveryPhrase) {
      throw new EngineError("could not parse CLI output", "CLI_FAILED");
    }

    // Initialize the account on-chain (under the authenticated-transfer program)
    // so it can receive funds. Done in the same home before sealing.
    const init = await runWallet(
      home,
      ["auth-transfer", "init", "--account-id", accountId],
      cliPw,
      FAST_MS,
    );
    if (init.timedOut) throw new EngineError("account init timed out", "TIMEOUT");
    if (!init.ok) throw new EngineError(init.stderr || "account init failed", "CLI_FAILED");

    const storageBytes = await readFile(join(home, "storage.json"));
    return {
      accountId,
      pk,
      recoveryPhrase,
      sealedStorage: seal(kek, storageBytes),
      sealedCliPw: seal(kek, Buffer.from(cliPw, "utf8")),
    };
  });
}

/**
 * Open a user's sealed state into a temp home, run a CLI command, re-seal the
 * (possibly changed) storage.json, and return stdout + the new sealed storage.
 * Throws BAD_PASSWORD if the KEK can't open the sealed data.
 */
export async function runForUser(
  password: string,
  salt: Buffer,
  sealedStorage: Sealed,
  sealedCliPw: Sealed,
  args: string[],
  opts: { proof?: boolean } = {},
): Promise<{ stdout: string; sealedStorage: Sealed }> {
  const kek = await deriveKek(password, salt);
  let cliPw: string;
  let storageBytes: Buffer;
  try {
    cliPw = open(kek, sealedCliPw).toString("utf8");
    storageBytes = open(kek, sealedStorage);
  } catch {
    throw new EngineError("invalid password", "BAD_PASSWORD");
  }

  return withTempHome(async (home) => {
    await writeFile(join(home, "storage.json"), storageBytes);
    // Point the wallet at the configured sequencer for chain operations.
    await writeFile(
      join(home, "wallet_config.json"),
      JSON.stringify({
        sequencer_addr: config.sequencerApi.endsWith("/")
          ? config.sequencerApi
          : config.sequencerApi + "/",
        seq_poll_timeout: "12s",
        seq_tx_poll_max_blocks: 5,
        seq_poll_max_retries: 5,
        seq_block_poll_max_amount: 100,
      }),
    );

    // Throttle proof-generating operations to protect host memory/CPU.
    if (opts.proof) await acquireProofSlot();
    let r;
    try {
      r = await runWallet(home, args, cliPw, opts.proof ? PROOF_MS : FAST_MS);
    } finally {
      if (opts.proof) releaseProofSlot();
    }
    if (r.notInstalled) throw new EngineError("wallet CLI not installed", "WALLET_CLI_MISSING");
    if (r.timedOut) throw new EngineError("operation timed out (proof?)", "TIMEOUT");
    if (!r.ok) throw new EngineError(r.stderr || "wallet command failed", "CLI_FAILED");

    const newStorage = await readFile(join(home, "storage.json"));
    return { stdout: r.stdout, sealedStorage: seal(kek, newStorage) };
  });
}
