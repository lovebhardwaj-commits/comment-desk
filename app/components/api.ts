import { logEvent } from "./log";

export async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  } catch (e: any) {
    logEvent({ level: "error", area: "network", message: `Couldn't reach the server for ${url.split("?")[0]}`, details: { url, error: String(e?.message || e) } });
    throw e;
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    window.location.href = "/?error=" + encodeURIComponent(data.error || "Please log in again");
    throw new Error(data.error || "Not logged in");
  }
  if (!res.ok) {
    logEvent({ level: "error", area: "request", message: `${url.split("?")[0]} failed (${res.status})`, details: { url, status: res.status, error: data.error, code: data.code } });
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const fmtDate = (s: string) =>
  s ? new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
export const fmtDateTime = (s: string) =>
  s ? new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
