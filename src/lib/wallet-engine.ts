// Wallet engine (wallet-id model). Server-only.
//
// Each wallet = one storage.json holding a Public AND a Private account, sealed
// under the wallet password. To run a command we open the sealed state into a
// temp home, run the CLI (CLI password on stdin), re-seal, and wipe.
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "./config";
import { deriveKek, seal, open, type Sealed } from "./crypto-vault";

const PROOF_MS = Math.max(config.proofTimeoutSeconds, 30) * 1000;
const FAST_MS = 60_000;

// Cap concurrent (heavy) proofs so private-send bursts can't exhaust the host.
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
  stdin: string,
  timeoutMs: number,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const env = { ...process.env, LEE_WALLET_HOME_DIR: homeDir };
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
    child.stdin.write(stdin);
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
    await rm(home, { recursive: true, force: true }).catch(() => {});
  }
}

function writeConfig(home: string): Promise<void> {
  return writeFile(
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
}

const ACCT_RE = /account_id\s+((?:Public|Private)\/[1-9A-HJ-NP-Za-km-z]+)/;
function parseAccountId(s: string): string | null {
  const m = s.match(ACCT_RE);
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

function check(r: RunResult, what: string): void {
  if (r.notInstalled) throw new EngineError("wallet CLI not installed", "WALLET_CLI_MISSING");
  if (r.timedOut) throw new EngineError(`${what} timed out`, "TIMEOUT");
  if (!r.ok) throw new EngineError(r.stderr || `${what} failed`, "CLI_FAILED");
}

function parseKeys(s: string): { npk: string; vpk: string } | null {
  const npk = (s.match(/npk\s+([0-9a-fA-F]{64})/) || [])[1];
  const vpk = (s.match(/vpk\s+([0-9a-fA-F]{66})/) || [])[1];
  return npk && vpk ? { npk, vpk } : null;
}

export interface CreatedPublic {
  publicAccountId: string;
  recoveryPhrase: string; // shown once, never stored
  sealedStorage: Sealed;
  sealedCliPw: Sealed;
}

/**
 * Create a wallet with ONLY a Public account (fast — no proof). A Private account
 * can be added later via addPrivateAccount (which pays the proof cost on demand).
 */
export async function createWalletPublicOnly(password: string, salt: Buffer): Promise<CreatedPublic> {
  const kek = await deriveKek(password, salt);
  const cliPw = randomBytes(24).toString("base64url");

  return withTempHome(async (home) => {
    await writeConfig(home);
    // First command triggers setup + prints the recovery phrase.
    const pub = await runWallet(home, ["account", "new", "public"], cliPw + "\n", FAST_MS);
    check(pub, "create public account");
    const publicAccountId = parseAccountId(pub.stdout);
    const recoveryPhrase = parseRecoveryPhrase(pub.stdout);
    if (!publicAccountId || !recoveryPhrase) {
      throw new EngineError("could not parse account creation output", "CLI_FAILED");
    }
    check(
      await runWallet(home, ["auth-transfer", "init", "--account-id", publicAccountId], cliPw + "\n", FAST_MS),
      "init public",
    );
    const storageBytes = await readFile(join(home, "storage.json"));
    return {
      publicAccountId,
      recoveryPhrase,
      sealedStorage: seal(kek, storageBytes),
      sealedCliPw: seal(kek, Buffer.from(cliPw, "utf8")),
    };
  });
}

export interface AddedPrivate {
  privateAccountId: string;
  npk: string;
  vpk: string;
  sealedStorage: Sealed;
}

/** Add + initialize a Private account on an existing wallet (slow — ZK proof). */
export async function addPrivateAccount(
  password: string,
  salt: Buffer,
  sealedStorage: Sealed,
  sealedCliPw: Sealed,
): Promise<AddedPrivate> {
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
    await writeConfig(home);

    const priv = await runWallet(home, ["account", "new", "private"], cliPw + "\n", FAST_MS);
    check(priv, "create private account");
    const privateAccountId = parseAccountId(priv.stdout);
    if (!privateAccountId) throw new EngineError("could not parse private account", "CLI_FAILED");

    await acquireProofSlot();
    let initPriv;
    try {
      initPriv = await runWallet(
        home,
        ["auth-transfer", "init", "--account-id", privateAccountId],
        cliPw + "\n",
        PROOF_MS,
      );
    } finally {
      releaseProofSlot();
    }
    check(initPriv, "init private");

    const keysOut = await runWallet(
      home,
      ["account", "get", "--account-id", privateAccountId, "--keys"],
      cliPw + "\n",
      FAST_MS,
    );
    const keys = parseKeys(keysOut.stdout);
    if (!keys) throw new EngineError("could not read private account keys", "CLI_FAILED");

    const newStorage = await readFile(join(home, "storage.json"));
    return {
      privateAccountId,
      npk: keys.npk,
      vpk: keys.vpk,
      sealedStorage: seal(kek, newStorage),
    };
  });
}

/**
 * Read a PRIVATE account's real balance. Shielded balances aren't visible via the
 * sequencer RPC — the wallet must scan its notes. We sync then read account data.
 * Returns the balance + (re-sealed) storage, since syncing can update local state.
 */
export async function readPrivateBalance(
  password: string,
  salt: Buffer,
  sealedStorage: Sealed,
  sealedCliPw: Sealed,
  privateAccountId: string,
): Promise<{ balance: number; sealedStorage: Sealed }> {
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
    await writeConfig(home);
    // Scan for incoming shielded notes (best-effort), then read balance.
    await runWallet(home, ["account", "sync-private"], cliPw + "\n", PROOF_MS).catch(() => {});
    const out = await runWallet(
      home,
      ["account", "get", "--account-id", privateAccountId],
      cliPw + "\n",
      FAST_MS,
    );
    check(out, "read private balance");
    const m = out.stdout.match(/"balance"\s*:\s*(\d+)/);
    const balance = m ? Number(m[1]) : 0;
    const newStorage = await readFile(join(home, "storage.json"));
    return { balance, sealedStorage: seal(kek, newStorage) };
  });
}

/** Read a private account's shareable keys (npk/vpk) — for backfilling older wallets. */
export async function readPrivateKeys(
  password: string,
  salt: Buffer,
  sealedStorage: Sealed,
  sealedCliPw: Sealed,
  privateAccountId: string,
): Promise<{ npk: string; vpk: string }> {
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
    await writeConfig(home);
    const out = await runWallet(
      home,
      ["account", "get", "--account-id", privateAccountId, "--keys"],
      cliPw + "\n",
      FAST_MS,
    );
    const keys = parseKeys(out.stdout);
    if (!keys) throw new EngineError("could not read private account keys", "CLI_FAILED");
    return keys;
  });
}

export interface RecoveredWallet {
  publicAccountId: string;
  privateAccountId: string | null;
  npk: string | null;
  vpk: string | null;
  sealedStorage: Sealed;
  sealedCliPw: Sealed;
}

/** Restore a wallet from its recovery phrase; re-seal under a new password. */
export async function recoverWallet(
  phrase: string,
  password: string,
  salt: Buffer,
  depth = 5,
): Promise<RecoveredWallet> {
  const kek = await deriveKek(password, salt);
  const cliPw = randomBytes(24).toString("base64url");
  const cleanPhrase = phrase.trim().replace(/\s+/g, " ");

  return withTempHome(async (home) => {
    await writeConfig(home);
    // restore-keys: setup reads the password, then prompts for the recovery phrase.
    const r = await runWallet(
      home,
      ["restore-keys", "--depth", String(depth)],
      `${cliPw}\n${cleanPhrase}\n`,
      PROOF_MS,
    );
    check(r, "restore from phrase");

    const list = await runWallet(home, ["account", "list"], cliPw + "\n", FAST_MS);
    check(list, "list accounts");
    const publicAccountId = (list.stdout.match(/Public\/[1-9A-HJ-NP-Za-km-z]+/) || [])[0] ?? null;
    const privateAccountId = (list.stdout.match(/Private\/[1-9A-HJ-NP-Za-km-z]+/) || [])[0] ?? null;
    if (!publicAccountId) {
      throw new EngineError("restored wallet has no public account", "CLI_FAILED");
    }

    let npk: string | null = null;
    let vpk: string | null = null;
    if (privateAccountId) {
      const keysOut = await runWallet(
        home,
        ["account", "get", "--account-id", privateAccountId, "--keys"],
        cliPw + "\n",
        FAST_MS,
      );
      const k = parseKeys(keysOut.stdout);
      if (k) {
        npk = k.npk;
        vpk = k.vpk;
      }
    }

    const storageBytes = await readFile(join(home, "storage.json"));
    return {
      publicAccountId,
      privateAccountId,
      npk,
      vpk,
      sealedStorage: seal(kek, storageBytes),
      sealedCliPw: seal(kek, Buffer.from(cliPw, "utf8")),
    };
  });
}

/** Verify a wallet password by trying to open the sealed CLI password. */
export async function verifyPassword(
  password: string,
  salt: Buffer,
  sealedCliPw: Sealed,
): Promise<boolean> {
  try {
    const kek = await deriveKek(password, salt);
    open(kek, sealedCliPw);
    return true;
  } catch {
    return false;
  }
}

/** Open sealed state, run a command, re-seal, wipe. Throws BAD_PASSWORD on a bad key. */
export async function runForWallet(
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
    await writeConfig(home);

    if (opts.proof) await acquireProofSlot();
    let r;
    try {
      r = await runWallet(home, args, cliPw + "\n", opts.proof ? PROOF_MS : FAST_MS);
    } finally {
      if (opts.proof) releaseProofSlot();
    }
    check(r, "wallet command");

    const newStorage = await readFile(join(home, "storage.json"));
    return { stdout: r.stdout, sealedStorage: seal(kek, newStorage) };
  });
}
