import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { graphAll, getPages, pageToken } from "@/lib/graph";
import { listAds } from "@/lib/ads";
import { fetchComments, mapLimit, type C, type Src } from "@/lib/comments";
import { requireToken } from "@/lib/session";
import { fmtShort } from "@/lib/format";

export const maxDuration = 60;

const POST_LOOKBACK_DAYS = 60; // new comments usually land on posts from the last two months
const MAX_TARGETS = 80;
const TIME_BUDGET_MS = 45_000;

// All comments from the last N days across a brand's posts (Instagram + Facebook), or across an ad account's ads.
// GET ?source=posts&pageId=…&days=7   or   ?source=ads&adAccountId=…&status=active|all&days=7
export async function GET(req: NextRequest) {
  return handle(async () => {
    const started = Date.now();
    const q = req.nextUrl.searchParams;
    const days = Math.min(30, Math.max(1, Number(q.get("days") || 7)));
    const sinceMs = Date.now() - days * 864e5;
    const userToken = await requireToken();
    const targets: Src[] = [];

    if (q.get("source") === "ads") {
      const statuses = q.get("status") === "all" ? ["ACTIVE", "PAUSED"] : ["ACTIVE"];
      const seen = new Set<string>();
      let after: string | undefined;
      for (let i = 0; i < 4; i++) {
        const { ads, next } = await listAds(userToken, q.get("adAccountId") || "", statuses, after, 25);
        for (const ad of ads as any[]) {
          const label = ad.text || ad.name;
          const ig = ad.instagram, fb = ad.facebook;
          if (ig?.owned && !ig.unreadable && ig.comments > 0 && !seen.has(ig.mediaId)) {
            seen.add(ig.mediaId);
            targets.push({ platform: "instagram", objectId: ig.mediaId, pageId: "", brandUsername: ig.brandUsername, caption: ig.caption || label, image: ad.image, permalink: ig.permalink, kind: "ad", label: ad.name, adId: ad.id });
          }
          if (fb?.owned && !fb.unreadable && fb.comments > 0 && !seen.has(fb.postId)) {
            seen.add(fb.postId);
            targets.push({ platform: "facebook", objectId: fb.postId, pageId: fb.pageId, brandUsername: "", caption: fb.caption || label, image: ad.image, permalink: fb.permalink, kind: "ad", label: ad.name, adId: ad.id });
          }
        }
        if (!next) break;
        after = next;
      }
    } else {
      const pageId = q.get("pageId") || "";
      const page = (await getPages(userToken)).find((p) => p.id === pageId);
      if (!page) throw new Error("This Page isn't connected. Reconnect Facebook and tick it.");
      const lookback = Math.floor((Date.now() - POST_LOOKBACK_DAYS * 864e5) / 1000);
      const ig = page.instagram_business_account;
      const [media, fbPosts] = await Promise.all([
        ig ? graphAll<any>(`${ig.id}/media`, userToken, { fields: "id,caption,timestamp,permalink,comments_count,media_type,media_product_type,media_url,thumbnail_url", since: lookback, limit: 50 }, 3).catch(() => []) : Promise.resolve([]),
        pageToken(userToken, pageId).then((t) => graphAll<any>(`${pageId}/published_posts`, t, { fields: "id,message,created_time,permalink_url,full_picture,comments.limit(0).summary(true)", since: lookback, limit: 50 }, 3)).catch(() => []),
      ]);
      for (const m of media) {
        if (!(m.comments_count > 0) || Date.parse(m.timestamp) < lookback * 1000) continue;
        const type = m.media_product_type === "REELS" ? "Reel" : m.media_type === "CAROUSEL_ALBUM" ? "Carousel" : m.media_type === "VIDEO" ? "Video" : "Post";
        targets.push({ platform: "instagram", objectId: m.id, pageId, brandUsername: ig?.username || "", caption: m.caption || "", image: m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url, permalink: m.permalink, kind: "post", label: `${type} · ${fmtShort(m.timestamp)}` });
      }
      for (const p of fbPosts) {
        if (!(p.comments?.summary?.total_count > 0) || Date.parse(p.created_time) < lookback * 1000) continue;
        targets.push({ platform: "facebook", objectId: p.id, pageId, brandUsername: "", caption: p.message || "", image: p.full_picture, permalink: p.permalink_url, kind: "post", label: `Post · ${fmtShort(p.created_time)}` });
      }
    }

    const scan = targets.slice(0, MAX_TARGETS);
    let skipped = targets.length - scan.length;
    const failed: string[] = [];
    const lists = await mapLimit(scan, 6, async (t) => {
      if (Date.now() - started > TIME_BUDGET_MS) { skipped++; return [] as C[]; }
      try {
        const cs = await fetchComments({ platform: t.platform, objectId: t.objectId, userToken, pageId: t.pageId, brandUsername: t.brandUsername, sinceMs, maxPages: 4 });
        return cs.map((c) => ({ ...c, src: t }));
      } catch (e: any) {
        failed.push(e?.message || "error");
        return [] as C[];
      }
    });
    const comments = lists.flat().sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
    return {
      comments,
      scanned: scan.length - failed.length,
      withNew: new Set(comments.map((c) => c.src!.objectId)).size,
      skipped,
      failed: failed.length,
      since: new Date(sinceMs).toISOString(),
    };
  });
}
