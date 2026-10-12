import { NextRequest } from "next/server";
import { handle, sameOrigin } from "@/lib/api";
import { requireToken } from "@/lib/session";
import { InsightsError } from "@/lib/insights";
import { translate, MAX_TRANSLATE } from "@/lib/translate";
import { classifyLocal } from "@/lib/local";

export const maxDuration = 60;

// Translates up to 50 comments to English (OpenRouter) and scores the translation with the built-in model,
// so comments in other languages get a real category and score.
export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireToken();
    if (!sameOrigin(req)) throw new Error("Bad request origin");
    const body = await req.json();
    const items = (Array.isArray(body.comments) ? body.comments : []).slice(0, MAX_TRANSLATE)
      .map((c: any) => ({ id: String(c.id || ""), text: String(c.text || "") }))
      .filter((c: { id: string; text: string }) => c.id && c.text.trim());
    if (!items.length) return { results: {} };
    try {
      const translations = await translate(items);
      const scored = await classifyLocal(translations.map((t) => t.english));
      const results: Record<string, { language: string; english: string; result: (typeof scored)[number] }> = {};
      translations.forEach((t, i) => (results[t.id] = { language: t.language, english: t.english, result: scored[i] }));
      return { results };
    } catch (e: any) {
      if (e instanceof InsightsError) return { error: e.message, kind: e.kind, results: {} };
      throw e;
    }
  });
}
