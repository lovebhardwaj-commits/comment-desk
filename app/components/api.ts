export async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    window.location.href = "/?error=" + encodeURIComponent(data.error || "Please log in again");
    throw new Error(data.error || "Not logged in");
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

export const fmtDate = (s: string) =>
  s ? new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
export const fmtDateTime = (s: string) =>
  s ? new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
