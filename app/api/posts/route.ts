import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { graph, pageToken } from "@/lib/graph";
import { requireToken } from "@/lib/session";

// Lists posts in a date range. Meta sometimes ignores since/until on these endpoints,
// so posts are also checked against the range here, and paging stops once posts are older than the start date.
export async function GET(req: NextRequest) {
  return handle(async () => {
    const q = req.nextUrl.searchParams;
    const platform = q.get("platform");
    const id = q.get("accountId") || "";
    const sinceMs = q.get("since") ? Date.parse(q.get("since")! + "T00:00:00Z") : 0;
    const untilMs = q.get("until") ? Date.parse(q.get("until")! + "T23:59:59Z") : Date.now();
    const after = q.get("after") || undefined;
    const userToken = await requireToken();
    const range = { since: sinceMs ? Math.floor(sinceMs / 1000) : undefined, until: Math.floor(untilMs / 1000), limit: 25, after };

    let raw: any;
    let posts: any[];
    if (platform === "instagram") {
      raw = await graph(`${id}/media`, userToken, {
        ...range,
        fields: "id,caption,media_type,media_product_type,timestamp,permalink,comments_count,like_count,thumbnail_url,media_url",
      });
      posts = (raw.data || []).map((m: any) => ({
        id: m.id,
        text: m.caption || "",
        time: m.timestamp,
        permalink: m.permalink,
        comments: m.comments_count ?? 0,
        type: m.media_product_type === "REELS" ? "Reel" : m.media_type === "CAROUSEL_ALBUM" ? "Carousel" : m.media_type === "VIDEO" ? "Video" : "Image",
        image: m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url,
      }));
    } else {
      raw = await graph(`${id}/published_posts`, await pageToken(userToken, id), {
        ...range,
        fields: "id,message,created_time,permalink_url,full_picture,comments.limit(0).summary(true)",
      });
      posts = (raw.data || []).map((p: any) => ({
        id: p.id,
        text: p.message || "",
        time: p.created_time,
        permalink: p.permalink_url,
        comments: p.comments?.summary?.total_count ?? 0,
        type: "Post",
        image: p.full_picture,
      }));
    }

    const inRange = posts.filter((p) => {
      const t = Date.parse(p.time);
      return t >= sinceMs && t <= untilMs;
    });
    const reachedStart = posts.some((p) => Date.parse(p.time) < sinceMs);
    const next = !reachedStart && raw.paging?.next ? raw.paging?.cursors?.after || null : null;
    return { posts: inRange, next };
  });
}
