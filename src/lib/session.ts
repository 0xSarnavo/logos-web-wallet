// iron-session config — encrypted, http-only session cookie. Server-only.
// The session holds ONLY the user id/email. It never holds the password or the
// key-encryption key (KEK is re-derived from the password on every send).
import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  userId?: string;
  email?: string;
}

function sessionOptions(): SessionOptions {
  const password = process.env.SESSION_SECRET;
  if (!password || password.length < 32) {
    throw new Error("SESSION_SECRET must be set and at least 32 characters");
  }
  return {
    password,
    cookieName: "logos_wallet_session",
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    },
  };
}

export async function getSession() {
  return getIronSession<SessionData>(cookies(), sessionOptions());
}

/** Returns the session if logged in, else null. */
export async function requireUser(): Promise<{ userId: string; email: string } | null> {
  const s = await getSession();
  if (!s.userId || !s.email) return null;
  return { userId: s.userId, email: s.email };
}
