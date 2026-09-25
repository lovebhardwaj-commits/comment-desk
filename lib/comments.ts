import { graph, graphAll, pageToken } from "./graph";

export type Src = {
  platform: "instagram" | "facebook"; pageId: string; objectId: string; brandUsername: string;
  caption: string; image?: string | null; permalink?: string | null; kind: "post" | "ad"; label: string; adId?: string;
  /** Instagram account id of the post's owner, used to recognise the brand's own replies. */
  brandId?: string;
};
export type C = {
  id: string; text: string; time: string; author: string; hidden: boolean; canHide: boolean;
  parentId: string | null; parentText: string | null; isBrand: boolean; src?: Src;
};

/** All comments and replies on one Instagram media or Facebook post, flattened, with the brand's own comments marked.
 *  With sinceMs, only comments newer than that are returned (replies keep their parent's text for context). */
export async function fetchComments(o: {
  platform: "instagram" | "facebook"; objectId: string; userToken: string; pageId?: string; brandUsername?: string; brandId?: string; sinceMs?: number; maxPages?: number;
}): Promise<C[]> {
  const out: C[] = [];
  const since = o.sinceMs || 0;
  const recent = (t: string) => !since || Date.parse(t) >= since;

  if (o.platform === "instagram") {
    const brand = (o.brandUsername || "").toLowerCase();
    const isBrandName = (u?: string) => !!brand && (u || "").toLowerCase() === brand;
    const replyFields = "id,text,timestamp,hidden,username,from{id,username}";
    const rows = await graphAll<any>(`${o.objectId}/comments`, o.userToken, {
      fields: `id,text,timestamp,hidden,username,from{id,username},replies.limit(50){${replyFields}}`,
      limit: 50,
    }, o.maxPages ?? 40);
    // A comment's replies come 50 at a time: fetch the rest for comments that have more.
    const more = rows.filter((r) => r.replies?.paging?.next);
    await mapLimit(more, 4, async (r) => {
      try {
        let page: any = await graph(r.replies.paging.next, o.userToken);
        for (let i = 0; i < 20; i++) {
          r.replies.data.push(...(page.data || []));
          if (!page.paging?.next) break;
          page = await graph(page.paging.next, o.userToken);
        }
      } catch { /* keep the replies we have */ }
    });
    for (const r of rows) {
      r.username ||= r.from?.username || "";
      for (const rep of r.replies?.data || []) rep.username ||= rep.from?.username || "";
      // The brand's own comments: by account id when known (usernames can change), else by username.
      const isBrand = (x: any) => (!!o.brandId && x.from?.id === o.brandId) || isBrandName(x.username);
      if (recent(r.timestamp)) {
        out.push({ id: r.id, text: r.text || "", time: r.timestamp, author: r.username || "", hidden: !!r.hidden, canHide: !isBrand(r), parentId: null, parentText: null, isBrand: isBrand(r) });
      }
      for (const rep of r.replies?.data || []) {
        if (!recent(rep.timestamp)) continue;
        out.push({ id: rep.id, text: rep.text || "", time: rep.timestamp, author: rep.username || "", hidden: !!rep.hidden, canHide: !isBrand(rep), parentId: r.id, parentText: r.text || "", isBrand: isBrand(rep) });
      }
    }
    return out;
  }

  const pageId = o.pageId || o.objectId.split("_")[0];
  const token = await pageToken(o.userToken, pageId);
  const params = { filter: "stream", fields: "id,message,created_time,is_hidden,can_hide,from{id,name},parent{id,message}", limit: 100 };
  // Newest first in every view (the same request "All comments" uses), stopping at the window start if there is one.
  const rows: any[] = [];
  let page: any = await graph(`${o.objectId}/comments`, token, { ...params, order: "reverse_chronological" });
  for (let i = 0; i < (o.maxPages ?? 20); i++) {
    const data = page.data || [];
    rows.push(...data.filter((r: any) => recent(r.created_time)));
    if (!page.paging?.next || (since && data.some((r: any) => !recent(r.created_time)))) break;
    page = await graph(page.paging.next, token);
  }
  const textById = new Map(rows.map((r) => [r.id, r.message || ""]));
  for (const r of rows) {
    const isBrand = r.from?.id === pageId;
    out.push({
      // Meta may leave `from` out for Facebook commenters (e.g. before App Review). The screen then shows
      // "Facebook user" with an explanation, instead of a made-up name.
      id: r.id, text: r.message || "", time: r.created_time, author: r.from?.name || "",
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
