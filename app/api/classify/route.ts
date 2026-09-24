import { NextRequest } from "next/server";
import { handle, sameOrigin } from "@/lib/api";
import { classify, type Input } from "@/lib/classify";
import { requireToken } from "@/lib/session";

export const maxDuration = 60;

// Categorises up to 100 comments per request. The browser sends larger posts in several requests.
export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireToken();
    if (!sameOrigin(req)) throw new Error("Bad request origin");
    const body = await req.json();
    const caption = String(body.caption || "").slice(0, 300);
    const items: Input[] = (body.comments || []).slice(0, 100).map((c: any) => ({
      id: String(c.id),
      comment: String(c.text || "").slice(0, 1000),
      ...(c.parentText ? { parent_comment: String(c.parentText).slice(0, 300) } : {}),
      ...(c.caption || caption ? { post_caption: String(c.caption || caption).slice(0, 300) } : {}),
    }));
    return { results: await classify(items) };
  });
}
