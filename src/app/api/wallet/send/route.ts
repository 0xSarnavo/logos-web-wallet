import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { getUserById } from "@/lib/auth";
import { getWallet, updateSealedStorage } from "@/lib/wallet-store";
import { runForUser, EngineError } from "@/lib/wallet-engine";
import { assertSafeMention, MentionError, isPrivateAccount } from "@/lib/wallet-cli";
import { audit } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

// Sends may generate a proof (private) — allow a long runtime.
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// POST /api/wallet/send  { to, amount, password }
// Requires a session AND the password (the KEK is never cached). Privacy is
// inferred from the account ids (a Private/ sender or recipient → proof).
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  // Throttle sends per user: 20 / 5 min.
  const rl = rateLimit(`send:${user.userId}`, 20, 5 * 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too many sends, slow down" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  let to = "";
  let amount: unknown;
  let password = "";
  try {
    const body = await req.json();
    to = String(body?.to ?? "");
    amount = body?.amount;
    password = String(body?.password ?? "");
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  let safeTo: string;
  try {
    safeTo = assertSafeMention(to);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof MentionError ? e.message : "invalid recipient" },
      { status: 400 },
    );
  }
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "amount must be a positive integer (≤ 2^53-1)" },
      { status: 400 },
    );
  }
  if (!password) {
    return NextResponse.json({ error: "password is required to send" }, { status: 400 });
  }

  const dbUser = await getUserById(user.userId);
  const wallet = await getWallet(user.userId);
  if (!dbUser || !wallet) {
    return NextResponse.json({ error: "no wallet for user" }, { status: 404 });
  }

  const isPrivate = isPrivateAccount(wallet.account_id) || isPrivateAccount(safeTo);
  const args = [
    "auth-transfer",
    "send",
    "--from",
    wallet.account_id,
    "--to",
    safeTo,
    "--amount",
    String(amount),
  ];

  try {
    const { stdout, sealedStorage } = await runForUser(
      password,
      dbUser.kdf_salt,
      wallet.sealedStorage,
      wallet.sealedCliPw,
      args,
      { proof: isPrivate },
    );
    // Persist the updated (re-sealed) wallet state.
    await updateSealedStorage(user.userId, sealedStorage);
    await audit(user.userId, isPrivate ? "send_private" : "send_public", true);
    return NextResponse.json({ ok: true, private: isPrivate, raw: stdout.trim() });
  } catch (e) {
    if (e instanceof EngineError) {
      const map: Record<string, number> = {
        BAD_PASSWORD: 401,
        WALLET_CLI_MISSING: 503,
        TIMEOUT: 504,
        CLI_FAILED: 502,
      };
      await audit(user.userId, "send", false, e.code);
      return NextResponse.json({ error: e.message, code: e.code }, { status: map[e.code] ?? 500 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "send failed" },
      { status: 500 },
    );
  }
}
