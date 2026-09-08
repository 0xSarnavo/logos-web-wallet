import { NextRequest, NextResponse } from "next/server";
import { getWalletRow, updateSealedStorage } from "@/lib/wallet-store";
import { runForWallet, EngineError } from "@/lib/wallet-engine";
import { audit } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const STATUS: Record<EngineError["code"], number> = {
  BAD_PASSWORD: 401,
  WALLET_CLI_MISSING: 503,
  TIMEOUT: 504,
  CLI_FAILED: 502,
};

// POST /api/wallet/[id]/faucet { account: "public"|"private", password }
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const wallet = await getWalletRow(params.id);
  if (!wallet) return NextResponse.json({ error: "wallet not found" }, { status: 404 });

  let which = "public";
  let password = "";
  try {
    const body = await req.json();
    which = body?.account === "private" ? "private" : "public";
    password = String(body?.password ?? "");
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!password) return NextResponse.json({ error: "password is required" }, { status: 400 });

  if (which === "private" && !wallet.privateAccountId) {
    return NextResponse.json({ error: "wallet has no private account yet" }, { status: 400 });
  }
  const target = which === "private" ? wallet.privateAccountId! : wallet.publicAccountId;
  try {
    const { stdout, sealedStorage } = await runForWallet(
      password,
      wallet.kdfSalt,
      wallet.sealedStorage,
      wallet.sealedCliPw,
      ["pinata", "claim", "--to", target],
      // Claiming to a PRIVATE account produces a shielded output → ZK proof (slow).
      { proof: which === "private" },
    );
    await updateSealedStorage(wallet.id, sealedStorage);
    await audit(wallet.id, "faucet", true, which);
    return NextResponse.json({ ok: true, raw: stdout.trim() });
  } catch (e) {
    if (e instanceof EngineError) {
      await audit(wallet.id, "faucet", false, e.code);
      return NextResponse.json({ error: e.message, code: e.code }, { status: STATUS[e.code] });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "faucet failed" }, { status: 500 });
  }
}
