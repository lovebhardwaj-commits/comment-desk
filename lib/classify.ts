import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, PROMPT_VERSION } from "./prompt";
import { cacheGet, cacheSet } from "./cache";
import { classifyLocal } from "./local";

export type Category = "Enquiry" | "Positive" | "Negative";
export type Result = {
  category: Category | "Unclassified";
  negative_type: "complaint" | "criticism" | "spam" | "abuse" | null;
  needs_review: boolean;
  reason: string;
};
export type Input = { id: string; comment: string; parent_comment?: string; post_caption?: string };

const CATS = new Set(["Enquiry", "Positive", "Negative"]);
const TYPES = new Set(["complaint", "criticism", "spam", "abuse"]);
const BATCH = 25;
const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";

let client: Anthropic | null = null;
function anthropic() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  return (client ??= new Anthropic());
}

async function classifyBatch(batch: Input[]): Promise<Record<string, Result>> {
  const msg = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 4000,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: JSON.stringify(batch) }],
  });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").replace(/```json|```/g, "").trim();
  let arr: any[];
  try {
    arr = JSON.parse(text);
  } catch {
    return {};
  }
  const out: Record<string, Result> = {};
  for (const r of Array.isArray(arr) ? arr : []) {
    if (!r || !CATS.has(r.category)) continue;
    out[String(r.id)] = {
      category: r.category,
      negative_type: r.category === "Negative" && TYPES.has(r.negative_type) ? r.negative_type : null,
      needs_review: !!r.needs_review,
      reason: String(r.reason || "").slice(0, 200),
    };
  }
  return out;
}

const key = (id: string) => `cls:${PROMPT_VERSION}:${id}`;

/** Which engine to use: the free built-in model (default), or Claude when CLASSIFIER=claude and an API key is set. */
export const ENGINE = process.env.CLASSIFIER === "claude" && process.env.ANTHROPIC_API_KEY ? "claude" : "local";

/** Classify comments. Missing or invalid outputs come back as Unclassified. */
export async function classify(items: Input[]): Promise<Record<string, Result>> {
  const results: Record<string, Result> = {};
  if (ENGINE === "local") {
    for (const it of items) results[it.id] = classifyLocal(it.comment);
    return results;
  }
  const cached = await cacheGet(items.map((i) => key(i.id)));
  const todo: Input[] = [];
  items.forEach((it, i) => {
    const c = cached[i];
    if (c) {
      try {
        results[it.id] = JSON.parse(c);
        return;
      } catch {}
    }
    todo.push(it);
  });

  const batches: Input[][] = [];
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
  const fresh: Record<string, Result> = {};
  for (let i = 0; i < batches.length; i += 3) {
    const done = await Promise.all(batches.slice(i, i + 3).map((b) => classifyBatch(b).catch(() => ({}))));
    for (const d of done) Object.assign(fresh, d);
  }
  await cacheSet(Object.entries(fresh).map(([id, r]) => [key(id), JSON.stringify(r)]));
  Object.assign(results, fresh);

  for (const it of items) {
    results[it.id] ??= { category: "Unclassified", negative_type: null, needs_review: true, reason: "No valid result; try again" };
  }
  return results;
}
