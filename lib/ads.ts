import { graph, getPages } from "./graph";

/** Lists ads with the post behind each one, and whether that post sits on an account the person manages. */
export async function listAds(userToken: string, adAccountId: string, statuses: string[], after?: string, limit = 25) {
  const pages = await getPages(userToken);
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const igById = new Map(pages.filter((p) => p.instagram_business_account).map((p) => [p.instagram_business_account!.id, p]));

  const raw: any = await graph(`${adAccountId}/ads`, userToken, {
    fields: "id,name,effective_status,created_time,creative{id,effective_instagram_media_id,effective_object_story_id,thumbnail_url,image_url,title,body}",
    effective_status: JSON.stringify(statuses),
    limit,
    after,
  });

  const ads = await Promise.all(
    (raw.data || []).map(async (ad: any) => {
      const c = ad.creative || {};
      let instagram: any = null;
      if (c.effective_instagram_media_id) {
        const mediaId = c.effective_instagram_media_id;
        try {
          const m: any = await graph(mediaId, userToken, { fields: "id,caption,comments_count,permalink,timestamp,media_type,media_url,thumbnail_url,owner{id,username}" });
          const ownerPage = m.owner?.id ? igById.get(m.owner.id) : undefined;
          instagram = {
            mediaId,
            owned: !!ownerPage,
            ownerUsername: m.owner?.username || "",
            brandUsername: ownerPage?.instagram_business_account?.username || "",
            comments: m.comments_count ?? 0,
            permalink: m.permalink,
            caption: m.caption || "",
            image: m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url,
          };
        } catch (e: any) {
          instagram = { mediaId, owned: false, ownerUsername: "", brandUsername: "", comments: null, permalink: null, caption: "", unreadable: true, error: String(e?.message || "Unknown error") };
        }
      }
      let facebook: any = null;
      if (c.effective_object_story_id) {
        const postId = c.effective_object_story_id;
        const pageId = String(postId).split("_")[0];
        const page = pageById.get(pageId);
        facebook = { postId, pageId, owned: !!page, comments: null, permalink: null, caption: "", unreadable: false, error: "" };
        if (page) {
          try {
            const p: any = await graph(postId, page.access_token, { fields: "id,message,permalink_url,full_picture,comments.filter(stream).limit(0).summary(true)" });
            facebook.comments = p.comments?.summary?.total_count ?? 0;
            facebook.permalink = p.permalink_url;
            facebook.caption = p.message || "";
            facebook.image = p.full_picture;
          } catch (e: any) {
            facebook.unreadable = true;
            facebook.error = String(e?.message || "Unknown error");
          }
        }
      }
      return {
        id: ad.id, name: ad.name, status: ad.effective_status, created: ad.created_time,
        image: c.image_url || c.thumbnail_url || instagram?.image || facebook?.image || null,
        text: c.body || c.title || instagram?.caption || facebook?.caption || "",
        instagram, facebook,
      };
    })
  );
  return { ads, next: raw.paging?.next ? (raw.paging?.cursors?.after as string) || null : null };
}
