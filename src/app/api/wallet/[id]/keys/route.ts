import { NextRequest, NextResponse } from "next/server";
import { getWalletRow, setPrivateKeys } from "@/lib/wallet-store";
import { readPrivateKeys, EngineError } from "@/lib/wallet-engine";

export const dynamic = "force-dynamic";

// GET  /api/wallet/[id]/keys → shareable npk/vpk for the private account (if cached)
// POST /api/wallet/[id]/keys { password } → fetch + cache keys for an older wallet
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const wallet = await getWalletRow(params.id);
  if (!wallet) return NextResponse.json({ error: "wallet not found" }, { status: 404 });
  if (!wallet.privateAccountId) {
    return NextResponse.json({ error: "wallet has no private account" }, { status: 404 });
  }
  if (wallet.privateNpk && wallet.privateVpk) {
    return NextResponse.json({
      privateAccountId: wallet.privateAccountId,
      npk: wallet.privateNpk,
      vpk: wallet.privateVpk,
    });
  }
  return NextResponse.json({ error: "keys not cached; POST with password", code: "NEED_PASSWORD" }, { status: 409 });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const wallet = await getWalletRow(params.id);
  if (!wallet) return NextResponse.json({ error: "wallet not found" }, { status: 404 });
  if (!wallet.privateAccountId) {
    return NextResponse.json({ error: "wallet has no private account" }, { status: 404 });
  }

  let password = "";
  try {
    password = String((await req.json())?.password ?? "");
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!password) return NextResponse.json({ error: "password is required" }, { status: 400 });

  try {
    const keys = await readPrivateKeys(
      password,
      wallet.kdfSalt,
      wallet.sealedStorage,
      wallet.sealedCliPw,
      wallet.privateAccountId,
    );
    await setPrivateKeys(wallet.id, keys.npk, keys.vpk);
    return NextResponse.json({ privateAccountId: wallet.privateAccountId, ...keys });
  } catch (e) {
    if (e instanceof EngineError && e.code === "BAD_PASSWORD") {
      return NextResponse.json({ error: "invalid password" }, { status: 401 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
