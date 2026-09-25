import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { listAds } from "@/lib/ads";
import { ACTIVE_STATUSES, PAUSED_STATUSES } from "@/lib/adStatus";
import { requireToken } from "@/lib/session";

// Lists ads for the "By ad" view. With "Active + paused", active ads are listed first (all of them),
// then paused ones, so active ads are never buried behind old paused ads.
// The paging cursor records which part of the list it's in: "a:<cursor>" or "p:<cursor>".
export async function GET(req: NextRequest) {
  return handle(async () => {
    const q = req.nextUrl.searchParams;
    const token = await requireToken();
    const account = q.get("adAccountId") || "";
    const withPaused = q.get("status") !== "active";
    const raw = q.get("after") || "";
    const phase = raw.startsWith("p:") ? "p" : "a";
    const cursor = raw.slice(2) || undefined;

    const r = await listAds(token, account, phase === "a" ? ACTIVE_STATUSES : PAUSED_STATUSES, cursor, 25);
    let next: string | null = r.next ? `${phase}:${r.next}` : null;
    let ads = r.ads;
    if (!next && phase === "a" && withPaused) {
      // Active list finished: carry on straight into paused ads.
      if (ads.length < 25) {
        const p = await listAds(token, account, PAUSED_STATUSES, undefined, 25 - ads.length);
        ads = [...ads, ...p.ads];
        next = p.next ? `p:${p.next}` : null;
      } else next = "p:";
    }
    return { ads, next };
  });
}
