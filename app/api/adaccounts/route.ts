import { handle } from "@/lib/api";
import { graphAll } from "@/lib/graph";
import { requireToken } from "@/lib/session";

export async function GET() {
  return handle(async () => {
    const rows = await graphAll<any>("me/adaccounts", await requireToken(), { fields: "id,name,account_status", limit: 100 }, 10);
    return { adAccounts: rows.map((a) => ({ id: a.id, name: a.name || a.id, active: a.account_status === 1 })) };
  });
}
