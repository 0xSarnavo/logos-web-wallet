import { NextRequest, NextResponse } from "next/server";
import { getWalletRow, updateSealedStorage } from "@/lib/wallet-store";
import { readPrivateBalance, EngineError } from "@/lib/wallet-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

// POST /api/wallet/[id]/private-balance { password }
// Scans shielded notes and returns the private account's real balance.
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
    const { balance, sealedStorage } = await readPrivateBalance(
      password,
      wallet.kdfSalt,
      wallet.sealedStorage,
      wallet.sealedCliPw,
      wallet.privateAccountId,
    );
    await updateSealedStorage(wallet.id, sealedStorage);
    return NextResponse.json({ balance });
  } catch (e) {
    if (e instanceof EngineError && e.code === "BAD_PASSWORD") {
      return NextResponse.json({ error: "invalid password" }, { status: 401 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
