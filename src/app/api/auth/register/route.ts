import { NextRequest, NextResponse } from "next/server";
import { registerUser, AuthError } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { audit, getPool } from "@/lib/db";
import { createWallet, EngineError } from "@/lib/wallet-engine";
import { saveWallet } from "@/lib/wallet-store";
import { rateLimit, clientKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/auth/register  { email, password }
// Creates the login identity, provisions a LEZ wallet (sealed under the password),
// starts a session, and returns the recovery phrase ONCE (never stored).
export async function POST(req: NextRequest) {
  // Limit account creation: 5 / hour / IP.
  const rl = rateLimit(`register:${clientKey(req)}`, 5, 60 * 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too many signups, try later" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  let email = "";
  let password = "";
  try {
    const body = await req.json();
    email = String(body?.email ?? "");
    password = String(body?.password ?? "");
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  let userId: string | null = null;
  try {
    const user = await registerUser(email, password);
    userId = user.id;

    // Provision the wallet. If this fails, roll back the user so they can retry.
    const w = await createWallet(password, user.kdf_salt);
    await saveWallet(user.id, w.accountId, w.pk, w.sealedStorage, w.sealedCliPw);

    const session = await getSession();
    session.userId = user.id;
    session.email = user.email;
    await session.save();
    await audit(user.id, "register", true);

    return NextResponse.json({
      id: user.id,
      email: user.email,
      accountId: w.accountId,
      pk: w.pk,
      // Shown once. We do NOT store this. If the user loses it AND their password,
      // funds are unrecoverable (by design).
      recoveryPhrase: w.recoveryPhrase,
    });
  } catch (e) {
    // Roll back a half-created user (login row without a wallet).
    if (userId) {
      await getPool().query("DELETE FROM users WHERE id = $1", [userId]).catch(() => {});
    }
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof EngineError) {
      const status = e.code === "WALLET_CLI_MISSING" ? 503 : 500;
      return NextResponse.json({ error: e.message, code: e.code }, { status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "registration failed" },
      { status: 500 },
    );
  }
}
