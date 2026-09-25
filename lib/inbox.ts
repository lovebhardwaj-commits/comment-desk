import { graphAll, getPages, pageToken } from "./graph";
import { listAds } from "./ads";
import { ACTIVE_STATUSES, PAUSED_STATUSES } from "./adStatus";
import { fmtShort } from "./format";
import type { Src } from "./comments";

export type InboxTarget = Src & { count: number };

const POST_LOOKBACK_DAYS = 60; // new comments usually land on posts from the last two months
export const MAX_TARGETS = 80;

export type TargetStats = {
  checked: number; activeChecked: number; pausedChecked: number; unreadable: number;
  /** More posts/ads with comments existed than the inbox reads in one go. */
  capped: boolean; withComments: number;
};

/** The posts (or ad posts) that have comments, with their current comment count.
 *  The count is a cheap change signal: if it hasn't moved, the browser's cached comments are still current.
 *  sinceMs is the start of the window the person is looking at. */
export async function collectTargets(
  userToken: string,
  q: { source: string; pageId?: string; adAccountId?: string; status?: string; sinceMs?: number },
): Promise<{ targets: InboxTarget[]; stats?: TargetStats }> {
  const targets: InboxTarget[] = [];
  const sinceMs = q.sinceMs || Date.now() - 7 * 864e5;

  if (q.source === "ads") {
    const seen = new Set<string>();
    const stats: TargetStats = { checked: 0, activeChecked: 0, pausedChecked: 0, unreadable: 0, capped: false, withComments: 0 };
    // Active ads first, always, so they can never be crowded out by old paused ones. Then paused ads,
    // including ads paused at campaign or ad-set level.
    const passes: { statuses: string[]; pages: number; kind: "active" | "paused" }[] = [
      { statuses: ACTIVE_STATUSES, pages: 8, kind: "active" },
    ];
    if (q.status === "all") passes.push({ statuses: PAUSED_STATUSES, pages: 6, kind: "paused" });
    for (const pass of passes) {
      let after: string | undefined;
      for (let i = 0; i < pass.pages; i++) {
        const { ads, next } = await listAds(userToken, q.adAccountId || "", pass.statuses, after, 50);
        for (const ad of ads as any[]) {
          stats.checked++;
          pass.kind === "active" ? stats.activeChecked++ : stats.pausedChecked++;
          const label = ad.text || ad.name;
          const ig = ad.instagram, fb = ad.facebook;
          if (ig?.unreadable || fb?.unreadable) stats.unreadable++;
          if (ig?.owned && !ig.unreadable && ig.comments > 0 && !seen.has(ig.mediaId)) {
            seen.add(ig.mediaId);
            targets.push({ platform: "instagram", objectId: ig.mediaId, pageId: "", brandUsername: ig.brandUsername, caption: ig.caption || label, image: ad.image, permalink: ig.permalink, kind: "ad", label: ad.name, adId: ad.id, count: ig.comments });
          }
          if (fb?.owned && !fb.unreadable && fb.comments > 0 && !seen.has(fb.postId)) {
            seen.add(fb.postId);
            targets.push({ platform: "facebook", objectId: fb.postId, pageId: fb.pageId, brandUsername: "", caption: fb.caption || label, image: ad.image, permalink: fb.permalink, kind: "ad", label: ad.name, adId: ad.id, count: fb.comments });
          }
        }
        if (!next) break;
        if (i === pass.pages - 1) stats.capped = true;
        after = next;
      }
    }
    stats.withComments = targets.length;
    if (targets.length > MAX_TARGETS) stats.capped = true;
    return { targets: targets.slice(0, MAX_TARGETS), stats };
  }

  const pageId = q.pageId || "";
  const page = (await getPages(userToken)).find((p) => p.id === pageId);
  if (!page) throw new Error("This Page isn't connected. Reconnect Facebook and tick it.");
  // Posts from well before the window can still get comments inside it, so look back further than the window.
  const lookbackMs = Math.min(Date.now() - POST_LOOKBACK_DAYS * 864e5, sinceMs - 30 * 864e5);
  const lookback = Math.floor(lookbackMs / 1000);
  const ig = page.instagram_business_account;
  const [media, fbPosts] = await Promise.all([
    ig ? graphAll<any>(`${ig.id}/media`, userToken, { fields: "id,caption,timestamp,permalink,comments_count,media_type,media_product_type,media_url,thumbnail_url", since: lookback, limit: 50 }, 4).catch(() => []) : Promise.resolve([]),
    pageToken(userToken, pageId).then((t) => graphAll<any>(`${pageId}/published_posts`, t, { fields: "id,message,created_time,permalink_url,full_picture,comments.filter(stream).limit(0).summary(true)", since: lookback, limit: 50 }, 4)).catch(() => []),
  ]);
  for (const m of media) {
    if (!(m.comments_count > 0) || Date.parse(m.timestamp) < lookbackMs) continue;
    const type = m.media_product_type === "REELS" ? "Reel" : m.media_type === "CAROUSEL_ALBUM" ? "Carousel" : m.media_type === "VIDEO" ? "Video" : "Post";
    targets.push({ platform: "instagram", objectId: m.id, pageId, brandUsername: ig?.username || "", caption: m.caption || "", image: m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url, permalink: m.permalink, kind: "post", label: `${type} · ${fmtShort(m.timestamp)}`, count: m.comments_count });
  }
  for (const p of fbPosts) {
    const n = p.comments?.summary?.total_count || 0;
    if (!(n > 0) || Date.parse(p.created_time) < lookbackMs) continue;
    targets.push({ platform: "facebook", objectId: p.id, pageId, brandUsername: "", caption: p.message || "", image: p.full_picture, permalink: p.permalink_url, kind: "post", label: `Post · ${fmtShort(p.created_time)}`, count: n });
  }
  targets.sort((a, b) => b.count - a.count);
  return {
    targets: targets.slice(0, MAX_TARGETS),
    stats: { checked: media.length + fbPosts.length, activeChecked: 0, pausedChecked: 0, unreadable: 0, capped: targets.length > MAX_TARGETS, withComments: targets.length },
  };
}
