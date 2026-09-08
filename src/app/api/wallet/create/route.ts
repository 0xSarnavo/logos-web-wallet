import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createWalletPublicOnly, EngineError } from "@/lib/wallet-engine";
import { createWalletRow } from "@/lib/wallet-store";
import { audit } from "@/lib/db";
import { rateLimit, clientKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
// Public-only create is fast (no proof). Still allow headroom for chain latency.
export const maxDuration = 120;

function engineStatus(code: EngineError["code"]): number {
  return code === "WALLET_CLI_MISSING" ? 503 : code === "TIMEOUT" ? 504 : 500;
}

// POST /api/wallet/create { password, label? }
// Creates a wallet (Public + Private account, both initialized on-chain), sealed
// under the password. Returns the wallet id + account ids + recovery phrase ONCE.
export async function POST(req: NextRequest) {
  const rl = rateLimit(`create:${clientKey(req)}`, 5, 60 * 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too many wallets created, try later" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  let password = "";
  let label: string | null = null;
  try {
    const body = await req.json();
    password = String(body?.password ?? "");
    label = body?.label ? String(body.label).slice(0, 64) : null;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "password must be at least 8 characters" }, { status: 400 });
  }

  try {
    const salt = randomBytes(16);
    const w = await createWalletPublicOnly(password, salt);
    const id = await createWalletRow({
      label,
      kdfSalt: salt,
      publicAccountId: w.publicAccountId,
      sealedStorage: w.sealedStorage,
      sealedCliPw: w.sealedCliPw,
    });
    await audit(id, "create", true);
    return NextResponse.json({
      walletId: id,
      publicAccountId: w.publicAccountId,
      privateAccountId: null,
      recoveryPhrase: w.recoveryPhrase, // store this yourself; we don't keep it
    });
  } catch (e) {
    if (e instanceof EngineError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: engineStatus(e.code) });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "create failed" },
      { status: 500 },
    );
  }
}
