import { NextRequest, NextResponse } from "next/server";
import { loginUser, AuthError } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { audit } from "@/lib/db";
import { rateLimit, clientKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// POST /api/auth/login  { email, password }
export async function POST(req: NextRequest) {
  // Blunt brute-force: 10 attempts / 5 min / IP.
  const rl = rateLimit(`login:${clientKey(req)}`, 10, 5 * 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too many attempts, slow down" },
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

  try {
    const user = await loginUser(email, password);
    const session = await getSession();
    session.userId = user.id;
    session.email = user.email;
    await session.save();
    await audit(user.id, "login", true);
    return NextResponse.json({ id: user.id, email: user.email });
  } catch (e) {
    if (e instanceof AuthError) {
      await audit(null, "login", false, email);
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "login failed" },
      { status: 500 },
    );
  }
}
