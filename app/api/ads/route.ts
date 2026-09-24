import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { listAds } from "@/lib/ads";
import { requireToken } from "@/lib/session";

// Lists active and paused ads, and checks whether each ad's post sits on an account you manage.
// Partnership ads running from a creator's account are marked so the app doesn't try to read their comments.
export async function GET(req: NextRequest) {
  return handle(async () => {
    const q = req.nextUrl.searchParams;
    const statuses = q.get("status") === "active" ? ["ACTIVE"] : ["ACTIVE", "PAUSED"];
    return listAds(await requireToken(), q.get("adAccountId") || "", statuses, q.get("after") || undefined);
  });
}
