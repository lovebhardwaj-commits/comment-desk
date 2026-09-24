import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { graphAll, pageToken } from "@/lib/graph";
import { requireToken } from "@/lib/session";

export const maxDuration = 60;

type C = {
  id: string; text: string; time: string; author: string; hidden: boolean; canHide: boolean;
  parentId: string | null; parentText: string | null; isBrand: boolean;
};

// Fetches every comment and reply on one Instagram media or Facebook post (up to about 2,000),
// flattened into one list, with the brand's own comments marked.
export async function GET(req: NextRequest) {
  return handle(async () => {
    const q = req.nextUrl.searchParams;
    const platform = q.get("platform");
    const objectId = q.get("objectId") || "";
    const userToken = await requireToken();
    const out: C[] = [];

    if (platform === "instagram") {
      const brand = (q.get("brandUsername") || "").toLowerCase();
      const rows = await graphAll<any>(`${objectId}/comments`, userToken, {
        fields: "id,text,timestamp,hidden,username,replies.limit(50){id,text,timestamp,hidden,username}",
        limit: 50,
      }, 40);
      for (const r of rows) {
        out.push({ id: r.id, text: r.text || "", time: r.timestamp, author: r.username || "", hidden: !!r.hidden, canHide: (r.username || "").toLowerCase() !== brand, parentId: null, parentText: null, isBrand: !!brand && (r.username || "").toLowerCase() === brand });
        for (const rep of r.replies?.data || []) {
          const isBrand = !!brand && (rep.username || "").toLowerCase() === brand;
          out.push({ id: rep.id, text: rep.text || "", time: rep.timestamp, author: rep.username || "", hidden: !!rep.hidden, canHide: !isBrand, parentId: r.id, parentText: r.text || "", isBrand });
        }
      }
    } else {
      const pageId = q.get("pageId") || objectId.split("_")[0];
      const token = await pageToken(userToken, pageId);
      const rows = await graphAll<any>(`${objectId}/comments`, token, {
        filter: "stream",
        order: "chronological",
        fields: "id,message,created_time,is_hidden,can_hide,from{id,name},parent{id}",
        limit: 100,
      }, 20);
      const textById = new Map(rows.map((r) => [r.id, r.message || ""]));
      for (const r of rows) {
        const isBrand = r.from?.id === pageId;
        out.push({
          id: r.id, text: r.message || "", time: r.created_time, author: r.from?.name || "Facebook user",
          hidden: !!r.is_hidden, canHide: !!r.can_hide && !isBrand, parentId: r.parent?.id || null,
          parentText: r.parent?.id ? textById.get(r.parent.id) ?? null : null, isBrand,
        });
      }
    }
    return { comments: out };
  });
}
