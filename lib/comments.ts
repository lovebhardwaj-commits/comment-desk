import { graph, graphAll, pageToken } from "./graph";

export type Src = {
  platform: "instagram" | "facebook"; pageId: string; objectId: string; brandUsername: string;
  caption: string; image?: string | null; permalink?: string | null; kind: "post" | "ad"; label: string; adId?: string;
};
export type C = {
  id: string; text: string; time: string; author: string; hidden: boolean; canHide: boolean;
  parentId: string | null; parentText: string | null; isBrand: boolean; src?: Src;
};

/** All comments and replies on one Instagram media or Facebook post, flattened, with the brand's own comments marked.
 *  With sinceMs, only comments newer than that are returned (replies keep their parent's text for context). */
export async function fetchComments(o: {
  platform: "instagram" | "facebook"; objectId: string; userToken: string; pageId?: string; brandUsername?: string; sinceMs?: number; maxPages?: number;
}): Promise<C[]> {
  const out: C[] = [];
  const since = o.sinceMs || 0;
  const recent = (t: string) => !since || Date.parse(t) >= since;

  if (o.platform === "instagram") {
    const brand = (o.brandUsername || "").toLowerCase();
    const isBrand = (u?: string) => !!brand && (u || "").toLowerCase() === brand;
    const rows = await graphAll<any>(`${o.objectId}/comments`, o.userToken, {
      fields: "id,text,timestamp,hidden,username,replies.limit(50){id,text,timestamp,hidden,username}",
      limit: 50,
    }, o.maxPages ?? 40);
    for (const r of rows) {
      if (recent(r.timestamp)) {
        out.push({ id: r.id, text: r.text || "", time: r.timestamp, author: r.username || "", hidden: !!r.hidden, canHide: !isBrand(r.username), parentId: null, parentText: null, isBrand: isBrand(r.username) });
      }
      for (const rep of r.replies?.data || []) {
        if (!recent(rep.timestamp)) continue;
        out.push({ id: rep.id, text: rep.text || "", time: rep.timestamp, author: rep.username || "", hidden: !!rep.hidden, canHide: !isBrand(rep.username), parentId: r.id, parentText: r.text || "", isBrand: isBrand(rep.username) });
      }
    }
    return out;
  }

  const pageId = o.pageId || o.objectId.split("_")[0];
  const token = await pageToken(o.userToken, pageId);
  const params = { filter: "stream", fields: "id,message,created_time,is_hidden,can_hide,from{id,name},parent{id,message}", limit: 100 };
  let rows: any[] = [];
  if (since) {
    // Newest first, and stop paging once comments are older than the window.
    let page: any = await graph(`${o.objectId}/comments`, token, { ...params, order: "reverse_chronological" });
    for (let i = 0; i < (o.maxPages ?? 20); i++) {
      const data = page.data || [];
      rows.push(...data.filter((r: any) => recent(r.created_time)));
      if (!page.paging?.next || data.some((r: any) => !recent(r.created_time))) break;
      page = await graph(page.paging.next, token);
    }
  } else {
    rows = await graphAll<any>(`${o.objectId}/comments`, token, { ...params, order: "chronological" }, o.maxPages ?? 20);
  }
  const textById = new Map(rows.map((r) => [r.id, r.message || ""]));
  for (const r of rows) {
    const isBrand = r.from?.id === pageId;
    out.push({
      id: r.id, text: r.message || "", time: r.created_time, author: r.from?.name || "Facebook user",
      hidden: !!r.is_hidden, canHide: !!r.can_hide && !isBrand, parentId: r.parent?.id || null,
      parentText: r.parent?.id ? textById.get(r.parent.id) ?? r.parent?.message ?? null : null, isBrand,
    });
  }
  return out;
}

/** Runs async work with at most `limit` tasks at a time. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }));
  return out;
}
