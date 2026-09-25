import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { fetchComments } from "@/lib/comments";
import { requireToken } from "@/lib/session";

export const maxDuration = 60;

// Every comment and reply on one Instagram media or Facebook post (up to about 2,000).
export async function GET(req: NextRequest) {
  return handle(async () => {
    const q = req.nextUrl.searchParams;
    const platform = q.get("platform") === "instagram" ? "instagram" : "facebook";
    const comments = await fetchComments({
      platform, objectId: q.get("objectId") || "", userToken: await requireToken(),
      pageId: q.get("pageId") || undefined, brandUsername: q.get("brandUsername") || "", brandId: q.get("brandId") || undefined,
    });
    return { comments };
  });
}
