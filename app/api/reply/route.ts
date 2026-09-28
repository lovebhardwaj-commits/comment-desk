import { NextRequest } from "next/server";
import { handle, sameOrigin } from "@/lib/api";
import { graph, pageToken, GraphError } from "@/lib/graph";
import { classify } from "@/lib/metaError";
import { requireToken, AuthError } from "@/lib/session";

// Posts a public reply as the brand.
// Body: { platform, pageId, commentId, message }
// commentId must be a top-level comment: Instagram only accepts replies there, and on Facebook a reply to a reply
// lands in the same thread anyway. The browser sends the top-level id and adds an @mention when answering a reply.
export async function POST(req: NextRequest) {
  return handle(async () => {
    const userToken = await requireToken();
    if (!sameOrigin(req)) throw new Error("Bad request origin");
    const { platform, pageId, commentId, message } = await req.json();
    const text = String(message || "").trim();
    if (!commentId) throw new Error("No comment given");
    if (!text) throw new Error("The reply is empty");
    const max = platform === "instagram" ? 2200 : 8000;
    if (text.length > max) throw new Error(`Replies can be at most ${max} characters`);

    try {
      if (platform === "instagram") {
        const r: any = await graph(`${commentId}/replies`, userToken, { message: text }, "POST");
        return { id: r.id, time: new Date().toISOString() };
      }
      const token = await pageToken(userToken, pageId || String(commentId).split("_")[0]);
      const r: any = await graph(`${commentId}/comments`, token, { message: text }, "POST");
      return { id: r.id, time: new Date().toISOString() };
    } catch (e: any) {
      if (e instanceof AuthError) throw e; // expired login: send the person to log in again
      const raw = e?.message || "error";
      console.error(`[reply] ${platform} ${commentId} failed: ${raw}`);
      // Plain-English reason first, Meta's words after, so the person knows what to do.
      const { text: why } = classify(raw);
      // A GraphError is reported as "Meta refused" (400), not as an app crash (500).
      throw new GraphError(`Couldn't post the reply (${why}). Meta said: ${raw}`, e?.code);
    }
  });
}
