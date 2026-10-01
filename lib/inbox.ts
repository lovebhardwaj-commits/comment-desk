import { graph, graphAll, getPages, pageToken } from "./graph";
import { classify } from "./metaError";
import { listAds } from "./ads";
import { ACTIVE_STATUSES, PAUSED_STATUSES } from "./adStatus";
import { fmtShort } from "./format";
import type { Src } from "./comments";

export type InboxTarget = Src & { count: number };

const POST_LOOKBACK_DAYS = 60; // new comments usually land on posts from the last two months
// No fixed cap on posts/ads: every one with comments is returned, and the screen fetches their comments in batches
// (each batch is its own request, inside Vercel's 60-second limit). This is only a safety net for extreme accounts.
export const MAX_TARGETS = 3000;
// Reading the ad list itself happens in this one request, so it stops after this long and says how many were checked.
const LIST_BUDGET_MS = 40_000;

export type TargetStats = {
  checked: number; activeChecked: number; pausedChecked: number; unreadable: number;
  /** More posts/ads with comments existed than the inbox reads in one go. */
  capped: boolean; withComments: number;
  /** Instagram ad posts: how many were included, on creator accounts (partnership ads), or unreadable (with Meta's reason). */
  ig?: {
    included: number; partner: number; unreadable: number; error?: string; noComments: number;
    /** Plain-English reason for the unreadable ones, and a sample of their ids and Meta's raw message for the log. */
    reason?: string; unreadableIds?: string[];
  };
  fb?: {
    included: number; notConnected: number; unreadable: number; noComments: number; reason?: string; unreadableIds?: string[];
    /** The Pages behind ads that this login can't open, so the right Page can be connected. */
    missingPages?: { id: string; name?: string; ads: number }[];
  };
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
    const missing = new Map<string, number>();
    let fbError = "";
    const stats: TargetStats = {
      checked: 0, activeChecked: 0, pausedChecked: 0, unreadable: 0, capped: false, withComments: 0,
      ig: { included: 0, partner: 0, unreadable: 0, noComments: 0 }, fb: { included: 0, notConnected: 0, unreadable: 0, noComments: 0 },
    };
    // Active ads first, always, so they can never be crowded out by old paused ones. Then paused ads,
    // including ads paused at campaign or ad-set level.
    const passes: { statuses: string[]; pages: number; kind: "active" | "paused" }[] = [
      { statuses: ACTIVE_STATUSES, pages: 40, kind: "active" },
    ];
    if (q.status === "all") passes.push({ statuses: PAUSED_STATUSES, pages: 30, kind: "paused" });
    const listStarted = Date.now();
    for (const pass of passes) {
      let after: string | undefined;
      for (let i = 0; i < pass.pages; i++) {
        // Out of time for reading the ad list: stop here and say so (active ads were read first).
        if (Date.now() - listStarted > LIST_BUDGET_MS) { stats.capped = true; break; }
        const { ads, next } = await listAds(userToken, q.adAccountId || "", pass.statuses, after, 50);
        for (const ad of ads as any[]) {
          stats.checked++;
          pass.kind === "active" ? stats.activeChecked++ : stats.pausedChecked++;
          const label = ad.text || ad.name;
          const ig = ad.instagram, fb = ad.facebook;
          if (ig?.unreadable || fb?.unreadable) stats.unreadable++;
          if (ig) {
            if (ig.unreadable) {
              stats.ig!.unreadable++; stats.ig!.error ||= ig.error;
              if ((stats.ig!.unreadableIds ||= []).length < 20) stats.ig!.unreadableIds.push(ig.mediaId);
            }
            else if (!ig.owned) stats.ig!.partner++;
            else if (!(ig.comments > 0)) stats.ig!.noComments++;
          }
          if (fb) {
            if (!fb.owned) { stats.fb!.notConnected++; missing.set(fb.pageId, (missing.get(fb.pageId) || 0) + 1); }
            else if (fb.unreadable) {
              stats.fb!.unreadable++; fbError ||= fb.error;
              if ((stats.fb!.unreadableIds ||= []).length < 20) stats.fb!.unreadableIds.push(fb.postId);
            }
            else if (!(fb.comments > 0)) stats.fb!.noComments++;
          }
          if (ig?.owned && !ig.unreadable && ig.comments > 0 && !seen.has(ig.mediaId)) {
            stats.ig!.included++;
            seen.add(ig.mediaId);
            targets.push({ platform: "instagram", objectId: ig.mediaId, pageId: "", brandUsername: ig.brandUsername, brandId: ig.ownerId || undefined, caption: ig.caption || label, image: ad.image, permalink: ig.permalink, kind: "ad", label: ad.name, adId: ad.id, count: ig.comments });
          }
          if (fb?.owned && !fb.unreadable && fb.comments > 0 && !seen.has(fb.postId)) {
            stats.fb!.included++;
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
    if (stats.ig!.error) stats.ig!.reason = classify(stats.ig!.error).text;
    if (fbError) stats.fb!.reason = classify(fbError).text;
    if (missing.size) {
      // Look up the names of Pages this login can't manage (public Page names are usually readable).
      const ids = [...missing.keys()].slice(0, 10);
      const names: Record<string, any> = await graph<any>("", userToken, { ids: ids.join(","), fields: "name" }).catch(() => ({}));
      stats.fb!.missingPages = ids.map((id) => ({ id, name: names[id]?.name, ads: missing.get(id)! })).sort((a, b) => b.ads - a.ads);
    }
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
    ig ? graphAll<any>(`${ig.id}/media`, userToken, { fields: "id,caption,timestamp,permalink,comments_count,media_type,media_product_type,media_url,thumbnail_url", since: lookback, limit: 50 }, 10).catch(() => []) : Promise.resolve([]),
    pageToken(userToken, pageId).then((t) => graphAll<any>(`${pageId}/published_posts`, t, { fields: "id,message,created_time,permalink_url,full_picture,comments.filter(stream).limit(0).summary(true)", since: lookback, limit: 50 }, 10)).catch(() => []),
  ]);
  for (const m of media) {
    if (!(m.comments_count > 0) || Date.parse(m.timestamp) < lookbackMs) continue;
    const type = m.media_product_type === "REELS" ? "Reel" : m.media_type === "CAROUSEL_ALBUM" ? "Carousel" : m.media_type === "VIDEO" ? "Video" : "Post";
    targets.push({ platform: "instagram", objectId: m.id, pageId, brandUsername: ig?.username || "", brandId: ig?.id, caption: m.caption || "", image: m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url, permalink: m.permalink, kind: "post", label: `${type} · ${fmtShort(m.timestamp)}`, count: m.comments_count });
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
