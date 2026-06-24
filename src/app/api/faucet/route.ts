import { NextRequest, NextResponse } from "next/server";
import { walletCli, assertSafeMention, MentionError } from "@/lib/wallet-cli";

export const dynamic = "force-dynamic";

// POST /api/faucet  { to }  → claim faucet funds to an account
export async function POST(req: NextRequest) {
  let to = "";
  try {
    to = (await req.json())?.to ?? "";
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  let safeTo: string;
  try {
    safeTo = assertSafeMention(to);
  } catch (e) {
    const msg = e instanceof MentionError ? e.message : "invalid account id";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const r = await walletCli.pinataClaim(safeTo);
  if (r.notInstalled) {
    return NextResponse.json(
      { error: "The `wallet` CLI is not installed.", code: "WALLET_CLI_MISSING" },
      { status: 503 },
    );
  }
  if (!r.ok) {
    return NextResponse.json(
      { error: r.stderr || "faucet claim failed", raw: r.stdout.trim() },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, raw: r.stdout.trim() });
}
