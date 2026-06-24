import { NextRequest, NextResponse } from "next/server";
import {
  walletCli,
  parseAccountId,
  assertSafeMention,
  MentionError,
} from "@/lib/wallet-cli";

export const dynamic = "force-dynamic";

function cliError(r: { notInstalled?: boolean; stderr: string }) {
  if (r.notInstalled) {
    return NextResponse.json(
      {
        error:
          "The `wallet` CLI is not installed. Install it from logos-execution-zone " +
          "(`cargo install --path wallet --force`) and set WALLET_BIN. " +
          "Account creation, transfers, and proof generation require it.",
        code: "WALLET_CLI_MISSING",
      },
      { status: 503 },
    );
  }
  return NextResponse.json({ error: r.stderr || "wallet CLI failed" }, { status: 500 });
}

// POST /api/account  { type?: "public" | "private" }  → create a new account
export async function POST(req: NextRequest) {
  let type: "public" | "private" = "public";
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.type === "private") type = "private";
  } catch {
    /* empty body is fine — defaults to public */
  }

  const r =
    type === "private"
      ? await walletCli.accountNewPrivate()
      : await walletCli.accountNewPublic();
  if (!r.ok) return cliError(r);
  const accountId = parseAccountId(r.stdout);
  return NextResponse.json({ type, accountId, raw: r.stdout.trim() });
}

// GET /api/account?id=Public/<id>  → account detail from the CLI
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")?.trim() ?? "";
  let safeId: string;
  try {
    safeId = assertSafeMention(id);
  } catch (e) {
    const msg = e instanceof MentionError ? e.message : "invalid account id";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const r = await walletCli.accountGet(safeId);
  if (!r.ok) return cliError(r);
  return NextResponse.json({ id, raw: r.stdout.trim() });
}
