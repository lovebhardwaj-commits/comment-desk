import { handle } from "@/lib/api";
import { getPages, graph, SCOPES } from "@/lib/graph";
import { requireToken } from "@/lib/session";

// Facebook Pages the person manages, their linked Instagram accounts, and which permissions were granted.
// Tokens are never sent to the browser.
export async function GET() {
  return handle(async () => {
    const token = await requireToken();
    const [pages, perms] = await Promise.all([
      getPages(token),
      graph<{ data: { permission: string; status: string }[] }>("me/permissions", token).catch(() => ({ data: [] })),
    ]);
    const granted = new Set(perms.data.filter((p) => p.status === "granted").map((p) => p.permission));
    const missingPermissions = perms.data.length ? SCOPES.filter((s) => !granted.has(s)) : [];
    return {
      pages: pages.map((p) => ({
        id: p.id,
        name: p.name,
        instagram: p.instagram_business_account
          ? { id: p.instagram_business_account.id, username: p.instagram_business_account.username || "" }
          : null,
      })),
      missingPermissions,
    };
  });
}
