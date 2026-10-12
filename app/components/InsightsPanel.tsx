"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Sparkles, RefreshCw, ChevronDown, ChevronUp, Lightbulb, Instagram, Facebook } from "lucide-react";
import { api } from "./api";
import { cacheGet, cacheSet, ago } from "./cache";
import { logEvent } from "./log";

export type Bucket = "Enquiry" | "Positive" | "Negative";
type Theme = { title: string; explanation: string; count: number; share: number; commentIds: string[]; exampleIds: string[]; suggestion?: string; other?: boolean };
type Usage = { prompt?: number; completion?: number; cost?: number };
type Result = {
  bucket: Bucket; summary: string; themes: Theme[]; analysed: number; total: number; sampled: boolean; unassigned: number;
  model: string; usage?: Usage; at: string;
  /** Batched runs: how many batches, and how many of them couldn't be analysed. */
  batches?: number; failedBatches?: number;
};
type Group = { title: string; explanation: string; suggestion?: string; members: string[] };

// Big sets are analysed in batches of up to BATCH comments (each batch is one request, well inside Vercel's 60 s),
// CONCURRENCY at a time, then the batch themes are combined. Above MAX_TOTAL an even sample is analysed.
const BATCH = 250;
const CONCURRENCY = 3;
const MAX_TOTAL = 3000;
const sampleEvenly = <T,>(list: T[], max: number) => list.length <= max ? list : Array.from({ length: max }, (_, i) => list[Math.floor((i * list.length) / max)]);
/** Rough time for a batched run: batches go CONCURRENCY at a time (~25 s each), then ~15 s to combine. */
const eta = (batches: number) => {
  const sec = Math.ceil(batches / CONCURRENCY) * 25 + 15;
  return sec < 90 ? `about ${Math.round(sec / 10) * 10} seconds` : `about ${Math.round(sec / 60)} minutes`;
};
const addUsage = (a: Usage | undefined, b: Usage | undefined): Usage | undefined => !b ? a : {
  prompt: (a?.prompt || 0) + (b.prompt || 0), completion: (a?.completion || 0) + (b.completion || 0),
  cost: a?.cost != null || b.cost != null ? (a?.cost || 0) + (b.cost || 0) : undefined,
};
type Saved = { result: Result; basedOn: number };
export type InsightComment = { id: string; text: string; author: string; platform: "instagram" | "facebook"; post?: string; type?: string };

// Whether AI analysis is set up in Vercel. Asked once per page load.
let setupCheck: Promise<{ configured: boolean; model?: string; missing?: string[] }> | null = null;
const getSetup = () => (setupCheck ||= api<{ configured: boolean; model?: string; missing?: string[] }>("/api/insights").catch(() => ({ configured: false, missing: [] })));

const NOUN: Record<Bucket, string> = { Enquiry: "enquiries", Positive: "positive comments", Negative: "negative comments" };
const ASK: Record<Bucket, string> = { Enquiry: "What are people asking?", Positive: "Why are people happy?", Negative: "What's going wrong?" };

/** "Why are people saying this?" for one category: themes, counts, real example comments and suggestions. */
export default function InsightsPanel({ bucket, comments, context, saveKey, onJump, lead }: {
  bucket: Bucket; comments: InsightComment[]; context: string; saveKey: string; onJump: (id: string) => void;
  /** One line about this category (e.g. "24 look like complaints · 8 criticism · 4 spam"), shown under the title. */
  lead?: ReactNode;
}) {
  const [setup, setSetup] = useState<{ configured: boolean; model?: string; missing?: string[] } | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [savedAt, setSavedAt] = useState<number>(0);
  const [running, setRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(true);

  useEffect(() => { getSetup().then(setSetup); }, []);
  // A different category, window or filter has its own saved analysis.
  useEffect(() => {
    setSaved(null); setError(""); setOpen(true);
    cacheGet<Saved>(saveKey).then((c) => { if (c) { setSaved(c.value); setSavedAt(c.at); } });
  }, [saveKey]);


  const byId = new Map(comments.map((c) => [c.id, c]));
  const enough = comments.filter((c) => c.text.trim()).length >= 3;
  const newSince = saved ? comments.length - saved.basedOn : 0;

  const post = <T,>(body: unknown) => api<T>("/api/insights", { method: "POST", body: JSON.stringify(body) });
  const toSend = (list: InsightComment[]) => list.map((c) => ({ id: c.id, text: c.text, platform: c.platform, post: c.post, type: c.type }));

  /** Analyses every comment in view: one request for small sets, otherwise batches that are then combined. */
  async function analyseAll(): Promise<Result> {
    const withText = comments.filter((c) => c.text.trim());
    const pool = sampleEvenly(withText, MAX_TOTAL);
    if (pool.length <= BATCH) {
      const r = await post<Result>({ bucket, context, comments: toSend(pool) });
      return { ...r, total: withText.length, sampled: withText.length > pool.length };
    }
    // Interleave, so every batch spans the whole time window and the batch themes are comparable.
    const n = Math.ceil(pool.length / BATCH);
    const batches = Array.from({ length: n }, (_, b) => pool.filter((_, i) => i % n === b));
    const results: (Result | null)[] = new Array(n).fill(null);
    let done = 0, next = 0, lastError = "";
    setBatchProgress({ done: 0, total: n });
    const worker = async () => {
      while (next < n) {
        const b = next++;
        for (let attempt = 0; attempt < 2 && !results[b]; attempt++) {
          try { results[b] = await post<Result>({ bucket, context, comments: toSend(batches[b]) }); }
          catch (e: any) { lastError = e.message; if (attempt === 1) logEvent({ level: "warn", area: "ai analysis", message: `Batch ${b + 1} of ${n} couldn't be analysed: ${e.message}`, details: { view: context, comments: batches[b].length } }); }
        }
        done++; setBatchProgress({ done, total: n });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, n) }, worker));
    const ok = results.filter((r): r is Result => !!r);
    if (!ok.length) throw new Error(lastError || "None of the batches could be analysed. Try Re-run in a minute.");
    let usage: Usage | undefined;
    ok.forEach((r) => (usage = addUsage(usage, r.usage)));

    // Combine: the AI only says which batch themes are the same; the app adds up the comments.
    const parts: { key: string; title: string; explanation: string; suggestion?: string; count: number; theme: Theme }[] = [];
    const otherIds: string[] = [];
    const otherExamples: string[] = [];
    ok.forEach((r, b) => r.themes.forEach((t, j) => {
      if (t.other) { otherIds.push(...t.commentIds); otherExamples.push(...t.exampleIds); }
      else parts.push({ key: `b${b + 1}t${j + 1}`, title: t.title, explanation: t.explanation, suggestion: t.suggestion, count: t.count, theme: t });
    }));
    const byKey = new Map(parts.map((p) => [p.key, p]));
    let groups: Group[];
    let summary = "";
    try {
      const m = await post<{ summary: string; groups: Group[]; usage?: Usage }>({ mode: "merge", bucket, context, parts: parts.map(({ theme, ...p }) => p) });
      groups = m.groups; summary = m.summary; usage = addUsage(usage, m.usage);
    } catch (e: any) {
      // Couldn't combine: group batch themes with the same title instead, and say so in the log.
      logEvent({ level: "warn", area: "ai analysis", message: `Couldn't combine the batch themes (${e.message}); themes with the same name were grouped instead`, details: { view: context } });
      const byTitle = new Map<string, Group>();
      for (const p of parts) {
        const k = p.title.trim().toLowerCase();
        if (!byTitle.has(k)) byTitle.set(k, { title: p.title, explanation: p.explanation, suggestion: p.suggestion, members: [] });
        byTitle.get(k)!.members.push(p.key);
      }
      groups = [...byTitle.values()];
      summary = ok[0].summary;
    }
    const analysed = ok.reduce((n2, r) => n2 + r.analysed, 0);
    const themes: Theme[] = groups.map((g) => {
      const members = g.members.map((k) => byKey.get(k)!).filter(Boolean).sort((a, b) => b.count - a.count);
      const commentIds = members.flatMap((m) => m.theme.commentIds);
      return { title: g.title, explanation: g.explanation, suggestion: g.suggestion, count: commentIds.length, share: 0, commentIds,
        exampleIds: members.flatMap((m) => m.theme.exampleIds).slice(0, 3) };
    }).filter((t) => t.count > 0);
    if (otherIds.length) themes.push({ title: "Other comments", explanation: "Short or general comments that don't fit a clear theme.", count: otherIds.length, share: 0, commentIds: otherIds, exampleIds: otherExamples.slice(0, 3), other: true });
    themes.sort((a, b) => Number(!!a.other) - Number(!!b.other) || b.count - a.count);
    for (const t of themes) t.share = Math.round((100 * t.count) / analysed);
    return {
      bucket, summary, themes, analysed, total: withText.length, sampled: withText.length > pool.length, unassigned: 0,
      model: ok[0].model, usage, at: new Date().toISOString(), batches: n, failedBatches: n - ok.length,
    };
  }

  async function run() {
    if (running) return;
    setRunning(true); setError("");
    try {
      const r = await analyseAll();
      const s = { result: r, basedOn: comments.length };
      setSaved(s); setSavedAt(Date.now()); setOpen(true);
      cacheSet(saveKey, s);
      logEvent({ level: "info", area: "ai analysis", message: `Analysed ${r.analysed} ${NOUN[bucket]}${r.sampled ? ` (sample of ${r.total})` : ""}${r.batches ? ` in ${r.batches} batches` : ""}: ${r.themes.length} themes`,
        details: { model: r.model, tokens: r.usage ? `${r.usage.prompt ?? "?"} in / ${r.usage.completion ?? "?"} out` : undefined, cost_usd: r.usage?.cost, failed_batches: r.failedBatches || undefined, view: context } });
    } catch (e: any) {
      setError(e.message);
      logEvent({ level: "error", area: "ai analysis", message: `Couldn't analyse ${NOUN[bucket]}: ${e.message}`, details: { view: context, comments: comments.length } });
    } finally { setRunning(false); setBatchProgress(null); }
  }



  // ---------- Not set up ----------
  if (setup && !setup.configured) {
    return (
      <div className="ai-card ai-muted">
        <div className="ai-head"><Sparkles /><strong>{ASK[bucket]}</strong></div>
        {lead ? <div className="ai-lead">{lead}</div> : <div className="ai-note">AI analysis isn&apos;t available yet.</div>}
      </div>
    );
  }

  const r = saved?.result;
  return (
    <div className="ai-card">
      <div className="ai-head">
        <Sparkles /><strong>{ASK[bucket]}</strong>
        {r && <span className="ai-meta">{r.failedBatches ? `${r.analysed.toLocaleString("en-IN")} of ${r.total.toLocaleString("en-IN")}` : r.analysed.toLocaleString("en-IN")} {NOUN[bucket]}{r.sampled && !r.failedBatches ? ` (an even sample of ${r.total.toLocaleString("en-IN")})` : ""} · {ago(savedAt || Date.parse(r.at))}</span>}
        <span className="spacer" />
        {r && <button className="btn btn-sm btn-ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? <ChevronUp /> : <ChevronDown />}{open ? "Collapse" : "Expand"}</button>}
        <button className={`btn btn-sm${r ? "" : " btn-primary"}`} onClick={run} disabled={running || !enough || !setup}
          title={!enough ? "Needs at least 3 comments with text" : r ? "Analyse again with the comments shown now" : `Group these ${NOUN[bucket]} into themes with AI`}>
          {running ? <span className="spinner sm" aria-hidden /> : r ? <RefreshCw /> : <Sparkles />}
          {running ? "Analysing…" : r ? "Re-run" : `Analyse ${comments.length.toLocaleString("en-IN")} ${NOUN[bucket]}`}
        </button>
      </div>

      {lead && <div className="ai-lead">{lead}</div>}
      {!r && !running && !error && !lead && (
        <div className="ai-note">
          {enough ? <>Groups the {NOUN[bucket]} shown here into themes, with how many comments are in each and real examples.</>
            : <>Needs at least 3 {NOUN[bucket]} with text in this view. Try a longer time window.</>}
        </div>
      )}
      {running && (() => {
        const n = Math.min(comments.length, MAX_TOTAL);
        const batches = Math.ceil(n / BATCH);
        return (
          <div className="ai-run">
            <div className="ai-note">
              {batches > 1
                ? <>Reading {n.toLocaleString("en-IN")} {NOUN[bucket]} in {batches} batches{batchProgress ? ` · ${batchProgress.done} of ${batchProgress.total} done` : ""}{batchProgress && batchProgress.done === batchProgress.total ? " · combining themes…" : ""}. This takes {eta(batches)}.</>
                : <>Reading {n.toLocaleString("en-IN")} {NOUN[bucket]} and grouping them into themes. This usually takes 10–30 seconds.</>}
            </div>
            {batches > 1 && <div className="progress"><i style={{ width: `${batchProgress ? (100 * batchProgress.done) / batchProgress.total : 2}%` }} /></div>}
          </div>
        );
      })()}
      {error && <div className="ai-error">{error}</div>}
      {r && newSince > 0 && !running && <div className="ai-note warn">{newSince} more {NOUN[bucket]} since this analysis. Re-run to include them.</div>}

      {r && open && (
        <>
          {r.summary && <p className="ai-summary">{r.summary}</p>}
          <div className="ai-themes">
            {r.themes.map((t, i) => (
              <div key={i} className={`ai-theme${t.other ? " other" : ""}`}>
                <div className="ai-theme-head">
                  <b>{t.title}</b>
                  <span className="ai-count">{t.count.toLocaleString("en-IN")} · {t.share}%</span>
                </div>
                <div className="ai-bar"><i style={{ width: `${Math.max(3, t.share)}%` }} /></div>
                {t.explanation && <div className="ai-expl">{t.explanation}</div>}
                {t.suggestion && <div className="ai-sugg"><Lightbulb />{t.suggestion}</div>}
                <div className="ai-examples">
                  {t.exampleIds.map((id) => byId.get(id)).filter(Boolean).map((c) => (
                    <button key={c!.id} className="ai-example" onClick={() => onJump(c!.id)} title="Show this comment in the list">
                      {c!.platform === "instagram" ? <Instagram /> : <Facebook />}
                      <span className="ai-ex-text">&ldquo;{c!.text.length > 160 ? c!.text.slice(0, 160) + "…" : c!.text}&rdquo;</span>
                      <span className="ai-ex-who">{c!.author || (c!.platform === "facebook" ? "Facebook user" : "Instagram user")}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {r.failedBatches ? (
            <div className="ai-foot"><span className="warn">{(r.total - r.analysed).toLocaleString("en-IN")} comments couldn&apos;t be analysed. Re-run to try again.</span></div>
          ) : null}
        </>
      )}
    </div>
  );
}
