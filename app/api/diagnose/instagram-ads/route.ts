import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { graph, getPages } from "@/lib/graph";
import { listAds } from "@/lib/ads";
import { ACTIVE_STATUSES, PAUSED_STATUSES } from "@/lib/adStatus";
import { requireToken } from "@/lib/session";

// Diagnostic: for each ad, what Meta says about its Instagram post and whether Comment Pulse includes it.
// Open in the browser while logged in: /api/diagnose/instagram-ads?adAccountId=act_123&status=all
export async function GET(req: NextRequest) {
  return handle(async () => {
    const q = req.nextUrl.searchParams;
    const token = await requireToken();
    const adAccountId = q.get("adAccountId") || "";
    if (!adAccountId) throw new Error("Add ?adAccountId=act_… to the address");
    const statuses = q.get("status") === "all" ? [...ACTIVE_STATUSES, ...PAUSED_STATUSES] : ACTIVE_STATUSES;
    const pages = await getPages(token);
    const acct = await graph<any>(`${adAccountId}/instagram_accounts`, token, { fields: "id,username" }).catch((e) => ({ error: e.message }));
    const { ads } = await listAds(token, adAccountId, statuses, undefined, 50);
    const rows = (ads as any[]).map((a) => ({
      ad: a.name, status: a.status,
      instagram: a.instagram ? {
        mediaId: a.instagram.mediaId, included: !!(a.instagram.owned && !a.instagram.unreadable),
        reason: a.instagram.reason, ownerId: a.instagram.ownerId || null, ownerUsername: a.instagram.ownerUsername || null,
        comments: a.instagram.comments, error: a.instagram.error || null,
      } : "no Instagram placement",
      facebook: a.facebook ? { postId: a.facebook.postId, pageConnected: a.facebook.owned, comments: a.facebook.comments, error: a.facebook.error || null } : "no Facebook placement",
    }));
    const summary = {
      adsChecked: rows.length,
      instagramIncluded: rows.filter((r) => typeof r.instagram === "object" && r.instagram.included).length,
      instagramPartner: rows.filter((r) => typeof r.instagram === "object" && r.instagram.reason === "partner").length,
      instagramUnreadable: rows.filter((r) => typeof r.instagram === "object" && r.instagram.reason === "unreadable").length,
      noInstagramPlacement: rows.filter((r) => typeof r.instagram !== "object").length,
    };
    return {
      summary,
      brandInstagramAccounts: {
        linkedToPages: pages.filter((p) => p.instagram_business_account).map((p) => ({ page: p.name, id: p.instagram_business_account!.id, username: p.instagram_business_account!.username })),
        connectedToAdAccount: (acct as any).data || acct,
      },
      ads: rows,
    };
  });
}
