import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/auth/me  → current user, or 401. Used to gate protected UI/routes.
export async function GET() {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  return NextResponse.json({ id: user.userId, email: user.email });
}
