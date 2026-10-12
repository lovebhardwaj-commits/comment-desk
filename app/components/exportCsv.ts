// Builds the comments CSV: one row per comment, people who commented most first.
// Written so it opens cleanly in Excel and Google Sheets (UTF-8 marker for Hindi/emoji, Windows line endings).

export type ExportRow = {
  commenter: string; platform: "instagram" | "facebook"; time: string; text: string;
  bucket: string; type: string; score: number | null; post: string; link: string;
  hidden: boolean; brandReplied: boolean; isReply: boolean; replyingTo: string;
};

const HEAD = ["commenter", "platform", "comments_by_this_person", "date", "comment", "bucket", "type", "score",
  "post_or_ad", "link", "hidden", "brand_replied", "is_reply", "replying_to"];

/** A cell that opens safely: quoted when needed, and never run as a formula by Excel/Sheets. */
function cell(v: unknown): string {
  let s = v == null ? "" : String(v);
  // A comment starting with = + - @ (or a tab/CR) would be treated as a formula when the file is opened.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const fmt = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function buildCsv(rows: ExportRow[], note?: string): string {
  // How many comments each person left in this export. Unnamed commenters ("Facebook user") can't be grouped.
  const byPerson = new Map<string, number>();
  const who = (r: ExportRow) => (r.commenter ? `${r.platform}:${r.commenter.toLowerCase()}` : "");
  for (const r of rows) if (who(r)) byPerson.set(who(r), (byPerson.get(who(r)) || 0) + 1);
  const count = (r: ExportRow) => (who(r) ? byPerson.get(who(r))! : 0);

  const sorted = [...rows].sort((a, b) =>
    count(b) - count(a) || who(a).localeCompare(who(b)) || Date.parse(b.time) - Date.parse(a.time));

  const lines = [HEAD.join(",")];
  for (const r of sorted) {
    lines.push([
      r.commenter || (r.platform === "facebook" ? "Facebook user (name not shared by Meta)" : "Instagram user"),
      r.platform === "instagram" ? "Instagram" : "Facebook",
      who(r) ? count(r) : "", fmt(r.time), r.text, r.bucket, r.type, r.score != null ? `${r.score}%` : "",
      r.post, r.link, r.hidden ? "yes" : "no", r.brandReplied ? "yes" : "no", r.isReply ? "yes" : "no", r.replyingTo,
    ].map(cell).join(","));
  }
  if (note) { lines.push(""); lines.push(cell(`Note: ${note}`)); }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

export function downloadCsv(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** e.g. "comments_klenzmo_ad-comments_last-7-days_2026-09-28.csv" */
export function csvName(parts: string[]) {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return ["comments", ...parts.map(slug).filter(Boolean), day].join("_") + ".csv";
}
