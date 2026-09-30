import { NextRequest, NextResponse } from "next/server";
import { sameOrigin } from "@/lib/api";
import { requireToken, AuthError } from "@/lib/session";
import { analyse, config, InsightsError, type Bucket } from "@/lib/insights";

export const maxDuration = 60;

// GET: is AI analysis set up? (Tells the screen whether to offer it, and which model it uses. Never returns the key.)
export async function GET() {
  try { await requireToken(); } catch (e: any) { return NextResponse.json({ error: e.message, auth: true }, { status: 401 }); }
  const c = config();
  return NextResponse.json({ configured: c.configured, model: c.configured ? c.model : undefined, missing: [!c.key && "OPENROUTER_API_KEY", !c.model && "OPENROUTER_MODEL"].filter(Boolean) });
}

// POST { bucket, context, comments: [{ id, text, platform?, post?, type? }] } → themes checked against the comments sent.
export async function POST(req: NextRequest) {
  try {
    await requireToken();
    if (!sameOrigin(req)) return NextResponse.json({ error: "Bad request origin" }, { status: 400 });
    const body = await req.json().catch(() => ({}));
    const bucket = body.bucket as Bucket;
    if (!["Enquiry", "Positive", "Negative"].includes(bucket)) return NextResponse.json({ error: "Pick Enquiry, Positive or Negative first." }, { status: 400 });
    const comments = Array.isArray(body.comments) ? body.comments.slice(0, 5000) : [];
    const result = await analyse(bucket, comments, String(body.context || "").slice(0, 300));
    console.log(`[insights] ${bucket}: ${result.analysed}/${result.total} comments, ${result.themes.length} themes, model ${result.model}${result.usage?.cost != null ? `, cost $${result.usage.cost}` : ""}`);
    return NextResponse.json(result);
  } catch (e: any) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message, auth: true }, { status: 401 });
    if (e instanceof InsightsError) {
      console.error(`[insights] ${e.kind}: ${e.message}`);
      return NextResponse.json({ error: e.message, kind: e.kind }, { status: e.kind === "not_configured" ? 503 : e.kind === "input" ? 400 : 502 });
    }
    console.error("[insights]", e);
    return NextResponse.json({ error: e?.message || "Something went wrong" }, { status: 500 });
  }
}
