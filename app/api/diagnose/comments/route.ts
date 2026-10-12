import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { graph, pageToken, getPages } from "@/lib/graph";
import { fetchComments } from "@/lib/comments";
import { requireToken } from "@/lib/session";

// Diagnostic: exactly what Meta returns for one post's comments, so missing comments or names can be traced.
// Open while logged in:
//   /api/diagnose/comments?platform=facebook&objectId=PAGEID_POSTID
//   /api/diagnose/comments?platform=instagram&objectId=MEDIA_ID
// The "login" section shows which Meta app this login belongs to and which permissions it holds for which
// Pages / Instagram accounts (from Meta's debug_token), since missing names usually come down to those.
export async function GET(req: NextRequest) {
  return handle(async () => {
    const q = req.nextUrl.searchParams;
    const userToken = await requireToken();
    const platform = q.get("platform") === "instagram" ? "instagram" : "facebook";
    const objectId = q.get("objectId") || "";
    const safe = <T,>(p: Promise<T>) => p.then((v) => ({ ok: true as const, v })).catch((e) => ({ ok: false as const, error: String(e?.message || e) }));
    const login = await loginInfo(userToken, safe);
    if (!objectId) return { login, hint: "Add ?platform=facebook|instagram&objectId=… to see one post's comments too." };

    if (platform === "facebook") {
      const pageId = q.get("pageId") || objectId.split("_")[0];
      const token = await pageToken(userToken, pageId);
      const count = await safe(graph<any>(objectId, token, { fields: "comments.filter(stream).limit(0).summary(true),comments.limit(0).summary(true).as(top_level)" }));
      const page = (order: string) => safe(graph<any>(`${objectId}/comments`, token, { filter: "stream", order, limit: 25, fields: "id,message,created_time,is_hidden,can_hide,from{id,name},parent{id}" }));
      const [newest, oldest] = await Promise.all([page("reverse_chronological"), page("chronological")]);
      const sum = (r: any) => r.ok ? { returned: r.v.data?.length || 0, withName: (r.v.data || []).filter((c: any) => c.from?.name).length, hasMore: !!r.v.paging?.next, sample: (r.v.data || []).slice(0, 3).map((c: any) => ({ time: c.created_time, from: c.from || null, text: String(c.message || "").slice(0, 60) })) } : { error: r.error };
      const all = await safe(fetchComments({ platform, objectId, userToken, pageId }));
      return {
        login, platform, objectId,
        metaReports: count.ok ? { allIncludingReplies: count.v.comments?.summary?.total_count ?? null, topLevel: count.v.top_level?.summary?.total_count ?? null } : { error: count.error },
        firstPageNewestFirst: sum(newest),
        firstPageOldestFirst: sum(oldest),
        appFetched: all.ok ? { total: all.v.length, withName: all.v.filter((c) => c.author).length } : { error: all.error },
      };
    }

    const media = await safe(graph<any>(objectId, userToken, { fields: "id,comments_count,owner{id,username},username,media_product_type" }));
    const first = await safe(graph<any>(`${objectId}/comments`, userToken, { limit: 25, fields: "id,text,timestamp,username,from{id,username},user,replies.limit(50){id,text,timestamp,username,from{id,username},user}" }));
    const owner = media.ok ? media.v.owner || null : null;
    const all = await safe(fetchComments({ platform, objectId, userToken, brandUsername: owner?.username || media.ok && media.v.username || "", brandId: owner?.id }));
    return {
      login, platform, objectId,
      metaReports: media.ok ? { commentsCount: media.v.comments_count ?? null, owner } : { error: media.error },
      firstPage: first.ok ? {
        returned: first.v.data?.length || 0,
        withUsername: (first.v.data || []).filter((c: any) => c.username || c.from?.username).length,
        hasMore: !!first.v.paging?.next,
        // What Meta says about who wrote each comment and reply: `user` is set only for the brand's own comments.
        sample: (first.v.data || []).slice(0, 5).map((c: any) => ({ time: c.timestamp, username: c.username || null, from: c.from || null, user: c.user || null, text: String(c.text || "").slice(0, 60),
          replies: (c.replies?.data || []).slice(0, 3).map((r: any) => ({ username: r.username || null, from: r.from || null, user: r.user || null, text: String(r.text || "").slice(0, 60) })) })),
      } : { error: first.error },
      appFetched: all.ok ? { total: all.v.length, replies: all.v.filter((c) => c.parentId).length, withName: all.v.filter((c) => c.author).length } : { error: all.error },
    };
  });
}

/** Which Meta app this login belongs to, and which permissions it holds for which Pages / Instagram accounts. */
async function loginInfo(userToken: string, safe: <T>(p: Promise<T>) => Promise<{ ok: true; v: T } | { ok: false; error: string }>) {
  const appId = process.env.META_APP_ID || "";
  const secret = process.env.META_APP_SECRET || "";
  if (!appId || !secret) return { error: "META_APP_ID / META_APP_SECRET aren't set, so the login can't be inspected." };
  const [dbg, pages, app] = await Promise.all([
    safe(graph<any>("debug_token", `${appId}|${secret}`, { input_token: userToken })),
    safe(getPages(userToken)),
    safe(graph<any>(appId, `${appId}|${secret}`, { fields: "id,name" })),
  ]);
  if (!dbg.ok) return { error: `Meta's debug_token failed: ${dbg.error}` };
  const d = dbg.v?.data || {};
  // Names for the ids Meta lists against each permission.
  const names = new Map<string, string>();
  if (pages.ok) for (const p of pages.v) {
    names.set(p.id, `${p.name} (Facebook Page)`);
    if (p.instagram_business_account) names.set(p.instagram_business_account.id, `@${p.instagram_business_account.username || p.instagram_business_account.id} (Instagram)`);
  }
  return {
    appId: d.app_id || null,
    appName: d.application || (app.ok ? app.v.name : null),
    sameAsServerApp: d.app_id ? String(d.app_id) === appId : null,
    valid: !!d.is_valid,
    type: d.type || null,
    expires: d.expires_at ? new Date(d.expires_at * 1000).toISOString() : "never",
    permissions: d.scopes || [],
    // Per-permission list of the accounts it was granted for. A permission without targets applies to all of them.
    perAccount: (d.granular_scopes || []).map((g: any) => ({
      permission: g.scope,
      accounts: g.target_ids ? g.target_ids.map((id: string) => names.get(id) || id) : "all",
    })),
  };
}
