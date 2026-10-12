// Learns the brand's usual replies from its own past replies: each brand reply is filed under the category of the
// comment it answered (from the built-in model), near-identical replies are grouped, and the most used come first.
type C = { id: string; text: string; author: string; parentId: string | null; isBrand: boolean };

const display = (t: string) => t.replace(/^\s*(@[\w.]+[\s,:]*)+/, "").replace(/\s+/g, " ").trim();
// Same reply apart from @names, punctuation, emojis and spacing.
const key = (t: string) => display(t).replace(/@[\w.]+/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export type Learned = { byLabel: Map<string, string[]>; all: string[] };

export function learnReplies(comments: C[], labelFor: (commentId: string) => string | null, perLabel = 4): Learned {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const groups = new Map<string, Map<string, { n: number; variants: Map<string, number> }>>();
  const overall = new Map<string, { n: number; variants: Map<string, number> }>();
  const add = (bucket: Map<string, { n: number; variants: Map<string, number> }>, k: string, shown: string) => {
    const g = bucket.get(k) || { n: 0, variants: new Map() };
    g.n++; g.variants.set(shown, (g.variants.get(shown) || 0) + 1);
    bucket.set(k, g);
  };
  for (const c of comments) {
    if (!c.isBrand || !c.parentId) continue;
    const parent = byId.get(c.parentId);
    if (!parent || parent.isBrand) continue;
    const shown = display(c.text);
    const k = key(c.text);
    if (k.length < 2 || shown.length > 400) continue;
    const label = labelFor(parent.id) || "Other";
    if (!groups.has(label)) groups.set(label, new Map());
    add(groups.get(label)!, k, shown);
    add(overall, k, shown);
  }
  const top = (bucket: Map<string, { n: number; variants: Map<string, number> }>, n: number) =>
    [...bucket.values()].sort((a, b) => b.n - a.n).slice(0, n)
      .map((g) => [...g.variants.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  const byLabel = new Map<string, string[]>();
  for (const [label, bucket] of groups) byLabel.set(label, top(bucket, perLabel));
  return { byLabel, all: top(overall, perLabel) };
}

/** The brand's usual replies for a comment with this label: same label first, then other negative types for a
 *  negative comment. Never across categories (a thank-you is never offered for a complaint, nor an apology for praise). */
export function suggestionsFor(learned: Learned, label: string | null, max = 4): string[] {
  const negatives = ["Complaint", "Negative", "Spam"];
  const order = [label || "", ...(negatives.includes(label || "") ? negatives : [])];
  const out: string[] = [];
  for (const l of order) {
    for (const s of learned.byLabel.get(l) || []) {
      if (!out.includes(s)) out.push(s);
      if (out.length >= max) return out;
    }
  }
  return out;
}
