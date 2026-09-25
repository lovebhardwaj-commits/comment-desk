import { getPages, graph, graphBatch } from "./graph";

/** Lists ads with the post behind each one, and whether that post sits on an account the person manages.
 *  Each ad's post is read in batches of 50 per Meta call (not one call per ad), so large accounts don't hit rate limits. */
export async function listAds(userToken: string, adAccountId: string, statuses: string[], after?: string, limit = 25, updatedSince?: number) {
  const pages = await getPages(userToken);
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const igById = new Map(pages.filter((p) => p.instagram_business_account).map((p) => [p.instagram_business_account!.id, p]));

  const raw: any = await graph(`${adAccountId}/ads`, userToken, {
    fields: "id,name,effective_status,created_time,updated_time,creative{id,effective_instagram_media_id,effective_object_story_id,thumbnail_url,image_url,title,body}",
    effective_status: JSON.stringify(statuses),
    limit,
    after,
    updated_since: updatedSince,
  });
  const rows: any[] = raw.data || [];

  // Instagram posts behind the ads: one batch call per 50.
  const mediaIds = [...new Set(rows.map((a) => a.creative?.effective_instagram_media_id).filter(Boolean))] as string[];
  const media = new Map<string, any>();
  if (mediaIds.length) {
    const res = await graphBatch(userToken, mediaIds.map((id) => ({ method: "GET", relative_url: `${id}?fields=id,caption,comments_count,permalink,timestamp,media_type,media_url,thumbnail_url,owner{id,username}` })));
    mediaIds.forEach((id, i) => media.set(id, res[i]));
  }

  // Facebook posts behind the ads, grouped by Page (each Page needs its own token).
  const postIds = [...new Set(rows.map((a) => a.creative?.effective_object_story_id).filter(Boolean))] as string[];
  const posts = new Map<string, any>();
  const byPage = new Map<string, string[]>();
  for (const id of postIds) {
    const pid = id.split("_")[0];
    if (pageById.has(pid)) byPage.set(pid, [...(byPage.get(pid) || []), id]);
  }
  for (const [pid, ids] of byPage) {
    const res = await graphBatch(pageById.get(pid)!.access_token, ids.map((id) => ({ method: "GET", relative_url: `${id}?fields=id,message,permalink_url,full_picture,comments.filter(stream).limit(0).summary(true)` })));
    ids.forEach((id, i) => posts.set(id, res[i]));
  }

  const ads = rows.map((ad: any) => {
    const c = ad.creative || {};
    let instagram: any = null;
    if (c.effective_instagram_media_id) {
      const mediaId = c.effective_instagram_media_id;
      const r = media.get(mediaId);
      if (r?.ok) {
        const m = r.body;
        const ownerPage = m.owner?.id ? igById.get(m.owner.id) : undefined;
        instagram = {
          mediaId, owned: !!ownerPage, ownerUsername: m.owner?.username || "",
          brandUsername: ownerPage?.instagram_business_account?.username || "",
          comments: m.comments_count ?? 0, permalink: m.permalink, caption: m.caption || "",
          image: m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url,
        };
      } else {
        instagram = { mediaId, owned: false, ownerUsername: "", brandUsername: "", comments: null, permalink: null, caption: "", unreadable: true, error: r?.error || "Unknown error" };
      }
    }
    let facebook: any = null;
    if (c.effective_object_story_id) {
      const postId = c.effective_object_story_id;
      const pageId = String(postId).split("_")[0];
      const owned = pageById.has(pageId);
      facebook = { postId, pageId, owned, comments: null, permalink: null, caption: "", unreadable: false, error: "" };
      const r = posts.get(postId);
      if (owned && r?.ok) {
        facebook.comments = r.body.comments?.summary?.total_count ?? 0;
        facebook.permalink = r.body.permalink_url;
        facebook.caption = r.body.message || "";
        facebook.image = r.body.full_picture;
      } else if (owned) {
        facebook.unreadable = true;
        facebook.error = r?.error || "Unknown error";
      }
    }
    return {
      id: ad.id, name: ad.name, status: ad.effective_status, created: ad.created_time,
      image: c.image_url || c.thumbnail_url || instagram?.image || facebook?.image || null,
      text: c.body || c.title || instagram?.caption || facebook?.caption || "",
      instagram, facebook,
    };
  });
  return { ads, next: raw.paging?.next ? (raw.paging?.cursors?.after as string) || null : null };
}
