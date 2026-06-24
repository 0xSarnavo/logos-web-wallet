import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { getWallet } from "@/lib/wallet-store";
import { getAccount } from "@/lib/sequencer-rpc";

export const dynamic = "force-dynamic";

// GET /api/wallet/me → the logged-in user's account id + live balance.
// Balance is read from the sequencer by account id (no password needed).
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const wallet = await getWallet(user.userId);
  if (!wallet) {
    return NextResponse.json({ error: "no wallet for user" }, { status: 404 });
  }

  try {
    const acct = await getAccount(wallet.account_id);
    return NextResponse.json({
      accountId: wallet.account_id,
      pk: wallet.pk,
      balance: acct.balance,
      nonce: acct.nonce,
      initialized: acct.exists,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "balance read failed" },
      { status: 502 },
    );
  }
}
