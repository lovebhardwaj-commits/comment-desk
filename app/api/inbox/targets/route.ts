import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { collectTargets } from "@/lib/inbox";
import { requireToken } from "@/lib/session";

export const maxDuration = 60;

// Step 1 of the inbox: which posts have comments, and how many. Cheap, so it runs on every open.
// GET ?source=posts&pageId=…   or   ?source=ads&adAccountId=…&status=active|all
export async function GET(req: NextRequest) {
  return handle(async () => {
    const q = req.nextUrl.searchParams;
    const targets = await collectTargets(await requireToken(), {
      source: q.get("source") || "posts", pageId: q.get("pageId") || "", adAccountId: q.get("adAccountId") || "", status: q.get("status") || "active",
    });
    return { targets };
  });
}
