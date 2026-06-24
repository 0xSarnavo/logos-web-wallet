import { NextRequest, NextResponse } from "next/server";
import {
  walletCli,
  isPrivateAccount,
  assertSafeMention,
  MentionError,
} from "@/lib/wallet-cli";

// Proof generation (private transfers) can take minutes — let the route run long.
export const dynamic = "force-dynamic";
export const maxDuration = 600;

interface TransferBody {
  from?: string;
  to?: string;
  amount?: number;
}

// POST /api/transfer  { from, to, amount }
// Privacy is NOT a flag — it is inferred from the account ids. Sending from (or
// to) a `Private/` account makes the CLI generate a ZK proof locally.
export async function POST(req: NextRequest) {
  let body: TransferBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { from, to, amount } = body;

  let safeFrom: string;
  let safeTo: string;
  try {
    safeFrom = assertSafeMention(from ?? "");
    safeTo = assertSafeMention(to ?? "");
  } catch (e) {
    const msg = e instanceof MentionError ? e.message : "invalid account id";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Amount is u128 on the CLI; in JSON we only accept a positive SAFE integer to
  // avoid float precision loss silently corrupting the value sent.
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "amount must be a positive integer (≤ 2^53-1)" },
      { status: 400 },
    );
  }

  const isPrivate = isPrivateAccount(safeFrom) || isPrivateAccount(safeTo);
  const r = await walletCli.authTransferSend(safeFrom, safeTo, amount);

  if (r.notInstalled) {
    return NextResponse.json(
      {
        error:
          "The `wallet` CLI is not installed; transfers and proof generation require it.",
        code: "WALLET_CLI_MISSING",
      },
      { status: 503 },
    );
  }
  if (r.timedOut) {
    return NextResponse.json(
      {
        error:
          "Transfer timed out. Private transfers generate a ZK proof locally and " +
          "can take minutes — increase PROOF_TIMEOUT_SECONDS.",
        code: "PROOF_TIMEOUT",
      },
      { status: 504 },
    );
  }
  if (!r.ok) {
    return NextResponse.json(
      { error: r.stderr || "transfer failed", raw: r.stdout.trim() },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    private: isPrivate,
    raw: r.stdout.trim(),
  });
}
