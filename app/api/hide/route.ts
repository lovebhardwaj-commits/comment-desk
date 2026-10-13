import { NextRequest } from "next/server";
import { handle, sameOrigin } from "@/lib/api";
import { graphBatch, pageToken } from "@/lib/graph";
import { requireToken } from "@/lib/session";

export const maxDuration = 60;

/** Meta's permission errors (#10, #200) in words a person can act on; other errors are passed through. */
function plainError(error: string | undefined, hide: boolean, ig: boolean) {
  if (error && /#10\b|#200\b|permission/i.test(error)) {
    return `You don't have permission to ${hide ? "hide" : "unhide"} this comment. Check your access to this ${ig ? "Instagram account" : "Facebook Page"}.`;
  }
  return error;
}

// Hides or unhides comments in batches of 50, then reads each one back from Meta to confirm it changed.
// Body: { platform, pageId, hide, commentIds: string[] }  (commentId is also accepted for a single comment)
export async function POST(req: NextRequest) {
  return handle(async () => {
    const userToken = await requireToken();
    if (!sameOrigin(req)) throw new Error("Bad request origin");
    const body = await req.json();
    const { platform, pageId } = body;
    const hide = !!body.hide;
    const ids: string[] = [...new Set<string>((body.commentIds || (body.commentId ? [body.commentId] : [])).map(String))].slice(0, 1000);
    if (!ids.length) throw new Error("No comments given");

    const ig = platform === "instagram";
    const token = ig ? userToken : await pageToken(userToken, pageId || ids[0].split("_")[0]);
    const param = ig ? `hide=${hide}` : `is_hidden=${hide}`;
    const field = ig ? "hidden" : "is_hidden";

    const writes = await graphBatch(token, ids.map((id) => ({ method: "POST", relative_url: `${id}?${param}` })));
    const reads = await graphBatch(token, ids.map((id) => ({ method: "GET", relative_url: `${id}?fields=id,${field}` })));

    const results = ids.map((id, i) => {
      const w = writes[i];
      const r = reads[i];
      const state = r?.ok && typeof r.body?.[field] === "boolean" ? (r.body[field] as boolean) : null;
      const verified = state === hide;
      return {
        id,
        ok: w.ok && state !== !hide,
        verified,
        hidden: state ?? (w.ok ? hide : !hide),
        error: !w.ok ? plainError(w.error, hide, ig) : state === !hide ? "Meta accepted the request but the comment didn't change" : undefined,
      };
    });
    return { results };
  });
}
