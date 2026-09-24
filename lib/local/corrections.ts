import { redis, redisConfigured } from "../redis";
import { normalize } from "./model";

// Labels the team has corrected. Stored in Upstash Redis so every server instance learns from them.
// Without Upstash they are kept in memory only, and lost when the server restarts.
export const LABELS = ["Enquiry", "Positive", "Complaint", "Negative", "Spam"] as const;
export type Label = (typeof LABELS)[number];

const HASH = "cls:corrections";
const VERSION = "cls:corrections:version";
const memory = new Map<string, { text: string; label: Label }>();
let memoryVersion = 0;

export const persistent = redisConfigured;
export const keyFor = (text: string) => normalize(text).slice(0, 500);

export async function saveCorrection(text: string, label: Label) {
  const k = keyFor(text);
  const value = JSON.stringify({ text: text.slice(0, 1000), label });
  if (!redisConfigured) {
    memory.set(k, { text, label });
    memoryVersion++;
    return;
  }
  await redis([["HSET", HASH, k, value], ["INCR", VERSION]]);
}

export async function correctionsVersion(): Promise<number> {
  if (!redisConfigured) return memoryVersion;
  const r = await redis([["GET", VERSION]]);
  return Number(r?.[0] || 0);
}

export async function loadCorrections(): Promise<Map<string, { text: string; label: Label }>> {
  if (!redisConfigured) return new Map(memory);
  const r = await redis([["HGETALL", HASH]]);
  const flat: string[] = r?.[0] || [];
  const out = new Map<string, { text: string; label: Label }>();
  for (let i = 0; i + 1 < flat.length; i += 2) {
    try {
      const v = JSON.parse(flat[i + 1]);
      if (LABELS.includes(v.label)) out.set(flat[i], v);
    } catch {}
  }
  return out;
}
