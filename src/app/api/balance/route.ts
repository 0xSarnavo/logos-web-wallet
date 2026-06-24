import { NextRequest, NextResponse } from "next/server";
import { balanceOrZero } from "@/lib/node-api";

export const dynamic = "force-dynamic";

const HEX64 = /^[0-9a-fA-F]{64}$/;

// GET /api/balance?key=<64-hex public account key>
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key")?.trim() ?? "";
  if (!HEX64.test(key)) {
    return NextResponse.json(
      { error: "key must be a 64-character hex public account id" },
      { status: 400 },
    );
  }
  try {
    const r = await balanceOrZero(key);
    return NextResponse.json({
      key,
      balance: r.balance,
      noteCount: Object.keys(r.notes).length,
      notes: r.notes,
      tip: r.tip,
      known: r.known,
    });
  } catch (e) {
    return NextResponse.json(
      { error: String(e instanceof Error ? e.message : e) },
      { status: 502 },
    );
  }
}
