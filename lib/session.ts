import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export type SessionData = {
  userToken?: string;
  userId?: string;
  userName?: string;
  expiresAt?: number;
};

export class AuthError extends Error {
  constructor(message = "Not logged in") {
    super(message);
  }
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET || "",
  cookieName: "cm_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
  },
};

export async function getSession() {
  if (!sessionOptions.password || String(sessionOptions.password).length < 32) {
    throw new Error("SESSION_SECRET must be set and at least 32 characters long");
  }
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}

export async function requireToken(): Promise<string> {
  const s = await getSession();
  if (!s.userToken) throw new AuthError();
  if (s.expiresAt && Date.now() > s.expiresAt) throw new AuthError("Login expired");
  return s.userToken;
}
