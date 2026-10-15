import { classifyLocal, type LocalResult } from "./local";

/** One comment to categorise. */
export type Input = { id: string; comment: string };
export type Result = LocalResult;

/** Categorises comments with the built-in model in lib/local. No external service is called. */
export async function classify(items: Input[]): Promise<Record<string, Result>> {
  const results = await classifyLocal(items.map((i) => i.comment));
  return Object.fromEntries(items.map((it, i) => [it.id, results[i]]));
}
