import { NextRequest, NextResponse } from "next/server";
import { getWalletRow, setPrivateAccount } from "@/lib/wallet-store";
import { addPrivateAccount, EngineError } from "@/lib/wallet-engine";
import { audit } from "@/lib/db";

export const dynamic = "force-dynamic";
// Adding a private account initializes it on-chain (ZK proof) — can take minutes.
export const maxDuration = 600;

const STATUS: Record<EngineError["code"], number> = {
  BAD_PASSWORD: 401,
  WALLET_CLI_MISSING: 503,
  TIMEOUT: 504,
  CLI_FAILED: 502,
};

// POST /api/wallet/[id]/add-private { password } → create + init a Private account
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const wallet = await getWalletRow(params.id);
  if (!wallet) return NextResponse.json({ error: "wallet not found" }, { status: 404 });
  if (wallet.privateAccountId) {
    return NextResponse.json(
      { error: "wallet already has a private account", privateAccountId: wallet.privateAccountId },
      { status: 409 },
    );
  }

  let password = "";
  try {
    password = String((await req.json())?.password ?? "");
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!password) return NextResponse.json({ error: "password is required" }, { status: 400 });

  try {
    const r = await addPrivateAccount(password, wallet.kdfSalt, wallet.sealedStorage, wallet.sealedCliPw);
    await setPrivateAccount(wallet.id, r.privateAccountId, r.npk, r.vpk, r.sealedStorage);
    await audit(wallet.id, "add_private", true);
    return NextResponse.json({ privateAccountId: r.privateAccountId, npk: r.npk, vpk: r.vpk });
  } catch (e) {
    if (e instanceof EngineError) {
      await audit(wallet.id, "add_private", false, e.code);
      return NextResponse.json({ error: e.message, code: e.code }, { status: STATUS[e.code] });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
