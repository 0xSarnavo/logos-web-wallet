import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { recoverWallet, EngineError } from "@/lib/wallet-engine";
import { createWalletRow, setPrivateAccount } from "@/lib/wallet-store";
import { audit } from "@/lib/db";
import { rateLimit, clientKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const WORDS = /^([a-z]+)(\s+[a-z]+){11,23}$/i;

// POST /api/wallet/recover { phrase, password, label? }
// Restores a wallet from its recovery phrase, re-sealed under a new password.
export async function POST(req: NextRequest) {
  const rl = rateLimit(`recover:${clientKey(req)}`, 5, 60 * 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too many attempts, try later" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  let phrase = "";
  let password = "";
  let label: string | null = null;
  try {
    const body = await req.json();
    phrase = String(body?.phrase ?? "").trim().replace(/\s+/g, " ");
    password = String(body?.password ?? "");
    label = body?.label ? String(body.label).slice(0, 64) : null;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!WORDS.test(phrase)) {
    return NextResponse.json(
      { error: "recovery phrase must be 12-24 lowercase words" },
      { status: 400 },
    );
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "password must be at least 8 characters" }, { status: 400 });
  }

  try {
    const salt = randomBytes(16);
    const w = await recoverWallet(phrase, password, salt);
    const id = await createWalletRow({
      label,
      kdfSalt: salt,
      publicAccountId: w.publicAccountId,
      sealedStorage: w.sealedStorage,
      sealedCliPw: w.sealedCliPw,
    });
    // If the restored wallet had a private account, attach it + its shareable keys.
    if (w.privateAccountId && w.npk && w.vpk) {
      await setPrivateAccount(id, w.privateAccountId, w.npk, w.vpk, w.sealedStorage);
    }
    await audit(id, "recover", true);
    return NextResponse.json({
      walletId: id,
      publicAccountId: w.publicAccountId,
      privateAccountId: w.privateAccountId,
    });
  } catch (e) {
    if (e instanceof EngineError) {
      const status = e.code === "WALLET_CLI_MISSING" ? 503 : e.code === "TIMEOUT" ? 504 : 500;
      return NextResponse.json({ error: e.message, code: e.code }, { status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "recover failed" },
      { status: 500 },
    );
  }
}
