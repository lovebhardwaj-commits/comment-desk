import { NextRequest } from "next/server";
import { fetchComments, mapLimit, type Src } from "@/lib/comments";
import { requireToken } from "@/lib/session";
import { graph, pageToken } from "@/lib/graph";
import { classify } from "@/lib/metaError";
import { AuthError } from "@/lib/session";

export const maxDuration = 60;
const TIME_BUDGET_MS = 50_000;

// Step 2 of the inbox: comments for the posts whose count changed, streamed one post at a time (NDJSON),
// so the browser can show them as they arrive instead of waiting for all of them.
// Body: { targets: Src[], since, until }  (milliseconds; `days` is still accepted)
export async function POST(req: NextRequest) {
  let token: string;
  try {
    token = await requireToken();
  } catch (e: any) {
    return Response.json({ error: e.message, auth: e instanceof AuthError }, { status: 401 });
  }
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return Response.json({ error: "Bad request origin" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const now = Date.now();
  const sinceMs = Math.max(now - 120 * 864e5, Number(body.since) || now - Math.min(30, Math.max(1, Number(body.days || 7))) * 864e5);
  const untilMs = Math.min(now, Number(body.until) || now) + 60_000;
  const targets: (Src & { count?: number })[] = (Array.isArray(body.targets) ? body.targets : []).slice(0, 100);
  const started = Date.now();
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (o: unknown) => ctrl.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      await mapLimit(targets, 6, async (t) => {
        if (Date.now() - started > TIME_BUDGET_MS) return send({ type: "skipped", objectId: t.objectId });
        try {
          const comments = await fetchComments({ platform: t.platform, objectId: t.objectId, userToken: token, pageId: t.pageId, brandUsername: t.brandUsername, brandId: t.brandId, sinceMs, maxPages: t.platform === "instagram" ? 20 : 10 });
          const inWindow = comments.filter((c) => Date.parse(c.time) <= untilMs);
          // Meta counts comments on this post, yet none came back. Could just be that they're all older than the
          // window, so look at the newest comment regardless of date: if Meta returns nothing at all, it is
          // withholding them (usually a Page role or permission issue), and that must be reported, not shown as 0.
          let withheld = false;
          if (!comments.length && (t.count || 0) > 0) {
            const probe: any = t.platform === "facebook"
              ? await graph(`${t.objectId}/comments`, await pageToken(token, t.pageId || t.objectId.split("_")[0]), { filter: "stream", order: "reverse_chronological", limit: 1, fields: "id" }).catch(() => null)
              : await graph(`${t.objectId}/comments`, token, { limit: 1, fields: "id" }).catch(() => null);
            withheld = !!probe && !(probe.data || []).length;
            if (withheld) console.warn(`[inbox] ${t.platform} ${t.objectId}: Meta reports ${t.count} comments but returns none`);
          }
          send(withheld
            ? { type: "withheld", objectId: t.objectId, reported: t.count }
            : { type: "comments", objectId: t.objectId, comments: inWindow });
        } catch (e: any) {
          const raw = e?.message || "error";
          console.error(`[inbox] ${t.platform} ${t.objectId} failed: ${raw}`);
          send({ type: "failed", objectId: t.objectId, platform: t.platform, reason: classify(raw).text, error: raw });
        }
      });
      send({ type: "done" });
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
