import { NextRequest } from "next/server";
import { handle, sameOrigin } from "@/lib/api";
import { classify, type Input } from "@/lib/classify";
import { requireToken } from "@/lib/session";

export const maxDuration = 60;

// Categorises up to 100 comments per request with the built-in model. The browser sends larger posts in several requests.
export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireToken();
    if (!sameOrigin(req)) throw new Error("Bad request origin");
    const body = await req.json();
    const items: Input[] = (body.comments || []).slice(0, 100).map((c: any) => ({
      id: String(c.id),
      comment: String(c.text || "").slice(0, 1000),
    }));
    return { results: await classify(items) };
  });
}
