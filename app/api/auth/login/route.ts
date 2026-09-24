import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { GRAPH_VERSION, SCOPES } from "@/lib/graph";

export async function GET(req: NextRequest) {
  const appUrl = process.env.APP_URL || req.nextUrl.origin;
  const state = crypto.randomBytes(16).toString("hex");
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID || "",
    redirect_uri: `${appUrl}/api/auth/callback`,
    state,
    response_type: "code",
  });
  if (process.env.META_LOGIN_CONFIG_ID) params.set("config_id", process.env.META_LOGIN_CONFIG_ID);
  else params.set("scope", SCOPES.join(","));
  // "Reconnect" asks again for permissions or accounts the person skipped last time.
  if (req.nextUrl.searchParams.get("reconnect")) params.set("auth_type", "rerequest");
  const res = NextResponse.redirect(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params}`);
  res.cookies.set("oauth_state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/" });
  return res;
}
