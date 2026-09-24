import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { graph, getPages } from "@/lib/graph";
import { requireToken } from "@/lib/session";

// Lists active and paused ads, and checks whether each ad's post sits on an account you manage.
// Partnership ads running from a creator's account are marked so the app doesn't try to read their comments.
export async function GET(req: NextRequest) {
  return handle(async () => {
    const q = req.nextUrl.searchParams;
    const adAccountId = q.get("adAccountId") || "";
    const statuses = q.get("status") === "active" ? ["ACTIVE"] : ["ACTIVE", "PAUSED"];
    const userToken = await requireToken();
    const pages = await getPages(userToken);
    const pageById = new Map(pages.map((p) => [p.id, p]));
    const igById = new Map(pages.filter((p) => p.instagram_business_account).map((p) => [p.instagram_business_account!.id, p]));

    const raw: any = await graph(`${adAccountId}/ads`, userToken, {
      fields: "id,name,effective_status,created_time,creative{id,effective_instagram_media_id,effective_object_story_id,instagram_user_id,object_id}",
      effective_status: JSON.stringify(statuses),
      limit: 25,
      after: q.get("after") || undefined,
    });

    const ads = await Promise.all(
      (raw.data || []).map(async (ad: any) => {
        const c = ad.creative || {};
        let instagram: any = null;
        if (c.effective_instagram_media_id) {
          const mediaId = c.effective_instagram_media_id;
          try {
            const m: any = await graph(mediaId, userToken, { fields: "id,caption,comments_count,permalink,timestamp,owner{id,username}" });
            const ownerPage = m.owner?.id ? igById.get(m.owner.id) : undefined;
            instagram = {
              mediaId,
              owned: !!ownerPage,
              ownerUsername: m.owner?.username || "",
              brandUsername: ownerPage?.instagram_business_account?.username || "",
              comments: m.comments_count ?? 0,
              permalink: m.permalink,
              caption: m.caption || "",
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
              const p: any = await graph(postId, page.access_token, { fields: "id,message,permalink_url,comments.limit(0).summary(true)" });
              facebook.comments = p.comments?.summary?.total_count ?? 0;
              facebook.permalink = p.permalink_url;
              facebook.caption = p.message || "";
            } catch (e: any) {
              facebook.unreadable = true;
              facebook.error = String(e?.message || "Unknown error");
            }
          }
        }
        return { id: ad.id, name: ad.name, status: ad.effective_status, created: ad.created_time, instagram, facebook };
      })
    );
    return { ads, next: raw.paging?.next ? raw.paging?.cursors?.after || null : null };
  });
}
