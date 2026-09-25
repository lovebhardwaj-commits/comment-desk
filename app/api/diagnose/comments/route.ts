import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { graph, pageToken } from "@/lib/graph";
import { fetchComments } from "@/lib/comments";
import { requireToken } from "@/lib/session";

// Diagnostic: exactly what Meta returns for one post's comments, so missing comments or names can be traced.
// Open while logged in:
//   /api/diagnose/comments?platform=facebook&objectId=PAGEID_POSTID
//   /api/diagnose/comments?platform=instagram&objectId=MEDIA_ID
export async function GET(req: NextRequest) {
  return handle(async () => {
    const q = req.nextUrl.searchParams;
    const userToken = await requireToken();
    const platform = q.get("platform") === "instagram" ? "instagram" : "facebook";
    const objectId = q.get("objectId") || "";
    if (!objectId) throw new Error("Add ?platform=facebook|instagram&objectId=… to the address");
    const safe = <T,>(p: Promise<T>) => p.then((v) => ({ ok: true as const, v })).catch((e) => ({ ok: false as const, error: String(e?.message || e) }));

    if (platform === "facebook") {
      const pageId = q.get("pageId") || objectId.split("_")[0];
      const token = await pageToken(userToken, pageId);
      const count = await safe(graph<any>(objectId, token, { fields: "comments.filter(stream).limit(0).summary(true),comments.limit(0).summary(true).as(top_level)" }));
      const page = (order: string) => safe(graph<any>(`${objectId}/comments`, token, { filter: "stream", order, limit: 25, fields: "id,message,created_time,is_hidden,can_hide,from{id,name},parent{id}" }));
      const [newest, oldest] = await Promise.all([page("reverse_chronological"), page("chronological")]);
      const sum = (r: any) => r.ok ? { returned: r.v.data?.length || 0, withName: (r.v.data || []).filter((c: any) => c.from?.name).length, hasMore: !!r.v.paging?.next, sample: (r.v.data || []).slice(0, 3).map((c: any) => ({ time: c.created_time, from: c.from || null, text: String(c.message || "").slice(0, 60) })) } : { error: r.error };
      const all = await safe(fetchComments({ platform, objectId, userToken, pageId }));
      return {
        platform, objectId,
        metaReports: count.ok ? { allIncludingReplies: count.v.comments?.summary?.total_count ?? null, topLevel: count.v.top_level?.summary?.total_count ?? null } : { error: count.error },
        firstPageNewestFirst: sum(newest),
        firstPageOldestFirst: sum(oldest),
        appFetched: all.ok ? { total: all.v.length, withName: all.v.filter((c) => c.author).length } : { error: all.error },
      };
    }

    const media = await safe(graph<any>(objectId, userToken, { fields: "id,comments_count,owner{id,username},username,media_product_type" }));
    const first = await safe(graph<any>(`${objectId}/comments`, userToken, { limit: 25, fields: "id,text,timestamp,username,from{id,username},replies.limit(50){id}" }));
    const all = await safe(fetchComments({ platform, objectId, userToken }));
    return {
      platform, objectId,
      metaReports: media.ok ? { commentsCount: media.v.comments_count ?? null, owner: media.v.owner || null } : { error: media.error },
      firstPage: first.ok ? {
        returned: first.v.data?.length || 0,
        withUsername: (first.v.data || []).filter((c: any) => c.username || c.from?.username).length,
        hasMore: !!first.v.paging?.next,
        sample: (first.v.data || []).slice(0, 3).map((c: any) => ({ time: c.timestamp, username: c.username || null, from: c.from || null, text: String(c.text || "").slice(0, 60) })),
      } : { error: first.error },
      appFetched: all.ok ? { total: all.v.length, replies: all.v.filter((c) => c.parentId).length, withName: all.v.filter((c) => c.author).length } : { error: all.error },
    };
  });
}
