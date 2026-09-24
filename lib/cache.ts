// Stores categorisation results so a comment is only categorised (and paid for) once.
// Uses Upstash Redis when configured; otherwise an in-memory map that lasts only while a server instance is warm.
const URL_ = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const memory = new Map<string, string>();
const TTL = 60 * 60 * 24 * 90; // 90 days

export async function cacheGet(keys: string[]): Promise<(string | null)[]> {
  if (!keys.length) return [];
  if (!URL_ || !TOKEN) return keys.map((k) => memory.get(k) ?? null);
  try {
    const res = await fetch(`${URL_}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify([["MGET", ...keys]]),
      cache: "no-store",
    });
    const data = await res.json();
    return data?.[0]?.result ?? keys.map(() => null);
  } catch {
    return keys.map(() => null);
  }
}

export async function cacheSet(entries: [string, string][]) {
  if (!entries.length) return;
  if (!URL_ || !TOKEN) {
    for (const [k, v] of entries) memory.set(k, v);
    return;
  }
  try {
    await fetch(`${URL_}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(entries.map(([k, v]) => ["SET", k, v, "EX", TTL])),
      cache: "no-store",
    });
  } catch {
    /* cache is best-effort */
  }
}
