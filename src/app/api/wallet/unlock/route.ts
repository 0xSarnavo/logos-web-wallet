import { NextRequest, NextResponse } from "next/server";
import { verifyPassword } from "@/lib/wallet-engine";
import { getWalletRow } from "@/lib/wallet-store";
import { audit } from "@/lib/db";
import { rateLimit, clientKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// POST /api/wallet/unlock { walletId, password }
// Verifies the password (by trying to open the sealed key). Stateless — the UI
// reveals the dashboard on ok; transactions still re-ask the password.
export async function POST(req: NextRequest) {
  const rl = rateLimit(`unlock:${clientKey(req)}`, 15, 5 * 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too many attempts, slow down" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  let walletId = "";
  let password = "";
  try {
    const body = await req.json();
    walletId = String(body?.walletId ?? "");
    password = String(body?.password ?? "");
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const wallet = await getWalletRow(walletId);
  if (!wallet) return NextResponse.json({ error: "wallet not found" }, { status: 404 });

  const ok = await verifyPassword(password, wallet.kdfSalt, wallet.sealedCliPw);
  await audit(walletId, "unlock", ok);
  if (!ok) return NextResponse.json({ error: "invalid password" }, { status: 401 });

  return NextResponse.json({
    ok: true,
    walletId: wallet.id,
    label: wallet.label,
    publicAccountId: wallet.publicAccountId,
    privateAccountId: wallet.privateAccountId,
  });
}
