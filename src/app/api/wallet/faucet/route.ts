import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { getUserById } from "@/lib/auth";
import { getWallet, updateSealedStorage } from "@/lib/wallet-store";
import { runForUser, EngineError } from "@/lib/wallet-engine";
import { audit } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

// POST /api/wallet/faucet  { password }  → claim faucet funds to the user's account.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  let password = "";
  try {
    password = String((await req.json())?.password ?? "");
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!password) {
    return NextResponse.json({ error: "password is required" }, { status: 400 });
  }

  const dbUser = await getUserById(user.userId);
  const wallet = await getWallet(user.userId);
  if (!dbUser || !wallet) {
    return NextResponse.json({ error: "no wallet for user" }, { status: 404 });
  }

  try {
    const { stdout, sealedStorage } = await runForUser(
      password,
      dbUser.kdf_salt,
      wallet.sealedStorage,
      wallet.sealedCliPw,
      ["pinata", "claim", "--to", wallet.account_id],
      { proof: false },
    );
    await updateSealedStorage(user.userId, sealedStorage);
    await audit(user.userId, "faucet", true);
    return NextResponse.json({ ok: true, raw: stdout.trim() });
  } catch (e) {
    if (e instanceof EngineError) {
      const map: Record<string, number> = {
        BAD_PASSWORD: 401,
        WALLET_CLI_MISSING: 503,
        TIMEOUT: 504,
        CLI_FAILED: 502,
      };
      await audit(user.userId, "faucet", false, e.code);
      return NextResponse.json({ error: e.message, code: e.code }, { status: map[e.code] ?? 500 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "faucet failed" },
      { status: 500 },
    );
  }
}
