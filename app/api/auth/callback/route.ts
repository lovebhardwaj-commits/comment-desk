import { NextRequest, NextResponse } from "next/server";
import { graph, GRAPH_VERSION } from "@/lib/graph";
import { getSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const appUrl = process.env.APP_URL || req.nextUrl.origin;
  const fail = (msg: string) => NextResponse.redirect(`${appUrl}/?error=${encodeURIComponent(msg)}`);
  const q = req.nextUrl.searchParams;
  if (q.get("error")) return fail(q.get("error_description") || "Login was cancelled");
  const code = q.get("code");
  if (!code || q.get("state") !== req.cookies.get("oauth_state")?.value) return fail("Login check failed, please try again");

  try {
    const base = { client_id: process.env.META_APP_ID || "", client_secret: process.env.META_APP_SECRET || "" };
    const tokenUrl = `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?`;
    const short = await fetch(tokenUrl + new URLSearchParams({ ...base, redirect_uri: `${appUrl}/api/auth/callback`, code }), { cache: "no-store" }).then((r) => r.json());
    if (!short.access_token) return fail(short.error?.message || "Could not get an access token");

    // Exchange for a long-lived token (about 60 days).
    const long = await fetch(tokenUrl + new URLSearchParams({ ...base, grant_type: "fb_exchange_token", fb_exchange_token: short.access_token }), { cache: "no-store" }).then((r) => r.json());
    const token = long.access_token || short.access_token;
    const me = await graph<{ id: string; name: string }>("me", token, { fields: "id,name" });

    const s = await getSession();
    s.userToken = token;
    s.userId = me.id;
    s.userName = me.name;
    s.expiresAt = Date.now() + (long.expires_in ? long.expires_in * 1000 : 55 * 24 * 3600 * 1000);
    await s.save();
    const res = NextResponse.redirect(`${appUrl}/`);
    res.cookies.delete("oauth_state");
    return res;
  } catch (e: any) {
    return fail(e?.message || "Login failed");
  }
}
