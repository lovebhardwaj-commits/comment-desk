import { NextRequest } from "next/server";
import { handle, sameOrigin } from "@/lib/api";
import { requireToken } from "@/lib/session";
import { saveCorrection, LABELS, persistent, type Label } from "@/lib/local/corrections";
import { invalidateModel, toResult } from "@/lib/local";

// Saves a team member's correction. The built-in model retrains with it on the next categorise request.
export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireToken();
    if (!sameOrigin(req)) throw new Error("Bad request origin");
    const { text, label } = await req.json();
    if (!text || !LABELS.includes(label)) throw new Error("Missing comment text or invalid label");
    await saveCorrection(String(text), label as Label);
    // The model retrains on the next categorise request, so this reply is instant.
    invalidateModel();
    return { ok: true, persistent, result: toResult(label, 1, "Corrected by your team") };
  });
}

export async function GET() {
  return handle(async () => {
    await requireToken();
    return { persistent };
  });
}
