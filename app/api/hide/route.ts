import { NextRequest } from "next/server";
import { handle, sameOrigin } from "@/lib/api";
import { graph, pageToken } from "@/lib/graph";
import { requireToken } from "@/lib/session";

// Hides or unhides one comment. Only runs when a person clicks the button.
export async function POST(req: NextRequest) {
  return handle(async () => {
    const userToken = await requireToken();
    if (!sameOrigin(req)) throw new Error("Bad request origin");
    const { platform, commentId, pageId, hide } = await req.json();
    if (!commentId) throw new Error("Missing comment ID");
    if (platform === "instagram") {
      await graph(commentId, userToken, { hide: hide ? "true" : "false" }, "POST");
    } else {
      await graph(commentId, await pageToken(userToken, pageId), { is_hidden: hide ? "true" : "false" }, "POST");
    }
    return { ok: true, hidden: !!hide };
  });
}
