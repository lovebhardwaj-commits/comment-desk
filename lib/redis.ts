// Minimal Upstash Redis REST client. Returns null for every command when Upstash isn't configured.
const URL_ = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
export const redisConfigured = !!(URL_ && TOKEN);

export async function redis(commands: (string | number)[][]): Promise<any[] | null> {
  if (!redisConfigured) return null;
  try {
    const res = await fetch(`${URL_}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands),
      cache: "no-store",
    });
    const data = await res.json();
    return Array.isArray(data) ? data.map((d: any) => d?.result ?? null) : null;
  } catch {
    return null;
  }
}
