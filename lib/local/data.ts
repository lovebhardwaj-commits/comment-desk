import examples from "./examples.json";
import extra from "./examples-extra.json";
import { PRODUCTS, COL, CITY, ATTR, DAYS, TEMPLATES, SPAM } from "./templates";

type Row = { text: string; label: string };

/** Builds the full training set: hand-written examples plus expanded patterns. Deterministic (fixed seed). */
export function buildTrainingData(): Row[] {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const nums = ["500", "1000", "2000", "5000", "300", "99"];
  const fill = (t: string, lang: "en" | "hl" | "hi") => {
    const p = pick(PRODUCTS);
    const name = lang === "en" ? p[0] : lang === "hl" ? p[1] : p[2];
    return t.replace(/\{p\}/g, name).replace(/\{c\}/g, pick(COL)).replace(/\{city\}/g, pick(CITY))
      .replace(/\{a\}/g, pick(ATTR)).replace(/\{d\}/g, pick(DAYS)).replace(/\{n\}/g, pick(nums));
  };
  const out: Row[] = [];
  for (const [label, langs] of Object.entries(TEMPLATES)) {
    for (const [lang, temps] of Object.entries(langs) as ["en" | "hl" | "hi", string[]][]) {
      for (const t of temps) for (let i = 0; i < (lang === "hi" ? 5 : 4); i++) out.push({ text: fill(t, lang), label });
    }
  }
  for (const t of SPAM) for (let i = 0; i < 6; i++) out.push({ text: fill(t, /Ghar|Mere|chahiye|karo/.test(t) ? "hl" : "en"), label: "Spam" });
  // Noisy copies: lower case, no question mark, extra words, as people really type.
  const base = out.slice();
  for (let i = 0; i < 600; i++) {
    const r = pick(base);
    const v = [r.text.toLowerCase(), r.text.replace(/\?/g, ""), r.text + " " + pick(["🙏", "😊", "!!", "plz", "pls", ""]), r.text.replace(/the /g, "")];
    out.push({ text: pick(v), label: r.label });
  }
  for (const [text, label] of [...examples, ...extra] as [string, string][]) out.push({ text, label });
  const seen = new Map<string, Row>();
  for (const r of out) if (!seen.has(r.text)) seen.set(r.text, r);
  return [...seen.values()];
}
