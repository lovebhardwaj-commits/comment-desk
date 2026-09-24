import crypto from "crypto";
import { AuthError } from "./session";

export const GRAPH_VERSION = process.env.GRAPH_VERSION || "v25.0";

export const SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_read_user_content",
  "pages_manage_engagement",
  "business_management",
  "instagram_basic",
  "instagram_manage_comments",
  "ads_read",
];

export class GraphError extends Error {
  code?: number;
  subcode?: number;
  constructor(message: string, code?: number, subcode?: number) {
    super(message);
    this.code = code;
    this.subcode = subcode;
  }
}

function proof(token: string) {
  const secret = process.env.META_APP_SECRET;
  return secret ? crypto.createHmac("sha256", secret).update(token).digest("hex") : undefined;
}

type Params = Record<string, string | number | boolean | undefined>;

/** Call the Graph API. `path` can be a relative path ("me/accounts") or a full paging URL. */
export async function graph<T = any>(path: string, token: string, params: Params = {}, method: "GET" | "POST" = "GET"): Promise<T> {
  const url = path.startsWith("https://") ? new URL(path) : new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path.replace(/^\//, "")}`);
  url.searchParams.delete("access_token");
  const body = new URLSearchParams();
  const target = method === "GET" ? url.searchParams : body;
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") target.set(k, String(v));
  const p = proof(token);
  if (p) target.set("appsecret_proof", p);

  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: method === "POST" ? body : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const e = data.error || {};
    if (e.code === 190) throw new AuthError("Your Facebook login has expired. Please log in again.");
    throw new GraphError(e.error_user_msg || e.message || `Graph API error (${res.status})`, e.code, e.error_subcode);
  }
  return data as T;
}

/** Follow `paging.next` until there is none or `maxPages` is reached. */
export async function graphAll<T = any>(path: string, token: string, params: Params = {}, maxPages = 20): Promise<T[]> {
  const out: T[] = [];
  let page: any = await graph(path, token, params);
  for (let i = 0; i < maxPages; i++) {
    out.push(...(page.data || []));
    const next = page.paging?.next;
    if (!next) break;
    page = await graph(next, token);
  }
  return out;
}

export type Page = {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string; profile_picture_url?: string };
};

const pageCache = new Map<string, { at: number; pages: Page[] }>();

/** Pages the logged-in person manages, with Page tokens. Cached for 5 minutes per instance. */
export async function getPages(userToken: string): Promise<Page[]> {
  const key = crypto.createHash("sha256").update(userToken).digest("hex");
  const hit = pageCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.pages;
  const pages = await graphAll<Page>("me/accounts", userToken, {
    fields: "id,name,access_token,instagram_business_account{id,username,profile_picture_url}",
    limit: 100,
  }, 10);
  pageCache.set(key, { at: Date.now(), pages });
  return pages;
}

export async function pageToken(userToken: string, pageId: string): Promise<string> {
  const page = (await getPages(userToken)).find((p) => p.id === pageId);
  if (!page) throw new GraphError("You don't manage this Facebook Page, or it wasn't selected when you logged in.");
  return page.access_token;
}
