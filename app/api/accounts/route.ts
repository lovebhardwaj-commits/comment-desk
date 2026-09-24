import { handle } from "@/lib/api";
import { getPages } from "@/lib/graph";
import { requireToken } from "@/lib/session";

// Facebook Pages the person manages, with their linked Instagram accounts. Tokens are never sent to the browser.
export async function GET() {
  return handle(async () => {
    const pages = await getPages(await requireToken());
    return {
      pages: pages.map((p) => ({
        id: p.id,
        name: p.name,
        instagram: p.instagram_business_account
          ? { id: p.instagram_business_account.id, username: p.instagram_business_account.username || "" }
          : null,
      })),
    };
  });
}
