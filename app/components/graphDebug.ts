// Ready-made Graph API checks for the activity log, so a problem can be re-tried by hand.
// Tokens are never included: the log is meant to be copied and shared, and a Page token lets anyone act as the Page.
// The Graph API Explorer link is the easy way: pick the Page (or your user for Instagram) and press Submit.
const VERSION = "v25.0";

export type GraphCheck = { label: string; curl: string; explorer: string; token: "page" | "user" };

function check(label: string, path: string, params: Record<string, string>, token: "page" | "user"): GraphCheck {
  const qs = new URLSearchParams(params).toString();
  const tokenName = token === "page" ? "<PAGE_ACCESS_TOKEN>" : "<USER_ACCESS_TOKEN>";
  const curl = `curl -G "https://graph.facebook.com/${VERSION}/${path}" ${Object.entries(params).map(([k, v]) => `--data-urlencode "${k}=${v}"`).join(" ")} --data-urlencode "access_token=${tokenName}"`;
  const explorer = `https://developers.facebook.com/tools/explorer/?method=GET&path=${encodeURIComponent(`${path}?${qs}`)}&version=${VERSION}`;
  return { label, curl, explorer, token };
}

/** Checks for "Meta counts comments on this post but returns none / too few". */
export function commentChecks(platform: "instagram" | "facebook", objectId: string): GraphCheck[] {
  if (platform === "facebook") return [
    check("How many comments Meta counts", objectId, { fields: "comments.filter(stream).limit(0).summary(true)" }, "page"),
    check("The comments themselves (newest first)", `${objectId}/comments`, { filter: "stream", order: "reverse_chronological", limit: "25", fields: "id,message,created_time,from,can_hide,is_hidden" }, "page"),
  ];
  return [
    check("How many comments Meta counts", objectId, { fields: "comments_count,owner{id,username}" }, "user"),
    check("The comments themselves", `${objectId}/comments`, { limit: "25", fields: "id,text,timestamp,username,from{id,username},hidden" }, "user"),
  ];
}

/** Check whether this login can open a Page (and so read its ads' comments). */
export function pageCheck(pageId: string): GraphCheck[] {
  return [
    check(`Pages you can manage (if ${pageId} isn't in the list, this login has no access to it)`, "me/accounts", { fields: "id,name,tasks", limit: "200" }, "user"),
    check("The Page itself", pageId, { fields: "id,name" }, "user"),
  ];
}

/** Check a post Meta refused to open. */
export function postCheck(platform: "instagram" | "facebook", objectId: string): GraphCheck {
  return platform === "instagram"
    ? check("Can this login open the post?", objectId, { fields: "id,comments_count,owner{id,username},permalink" }, "user")
    : check("Can this login open the post?", objectId, { fields: "id,permalink_url,comments.filter(stream).limit(0).summary(true)" }, "page");
}
