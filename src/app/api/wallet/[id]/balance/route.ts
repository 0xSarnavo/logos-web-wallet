import { NextRequest, NextResponse } from "next/server";
import { getWalletRow } from "@/lib/wallet-store";
import { getAccount } from "@/lib/sequencer-rpc";

export const dynamic = "force-dynamic";

// GET /api/wallet/[id]/balance → both accounts' balances (read-only, no password)
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const wallet = await getWalletRow(params.id);
  if (!wallet) return NextResponse.json({ error: "wallet not found" }, { status: 404 });

  try {
    const pub = await getAccount(wallet.publicAccountId);
    const priv = wallet.privateAccountId ? await getAccount(wallet.privateAccountId) : null;
    return NextResponse.json({
      walletId: wallet.id,
      label: wallet.label,
      public: { accountId: wallet.publicAccountId, balance: pub.balance, initialized: pub.exists },
      private: wallet.privateAccountId
        ? { accountId: wallet.privateAccountId, balance: priv!.balance, initialized: priv!.exists }
        : null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "balance read failed" },
      { status: 502 },
    );
  }
}
