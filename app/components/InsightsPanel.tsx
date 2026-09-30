"use client";
import { useEffect, useState } from "react";
import { Sparkles, RefreshCw, ChevronDown, ChevronUp, Lightbulb, Copy, Check, Instagram, Facebook } from "lucide-react";
import { api } from "./api";
import { cacheGet, cacheSet, ago } from "./cache";
import { logEvent } from "./log";

export type Bucket = "Enquiry" | "Positive" | "Negative";
type Theme = { title: string; explanation: string; count: number; share: number; commentIds: string[]; exampleIds: string[]; suggestion?: string };
type Result = {
  bucket: Bucket; summary: string; themes: Theme[]; analysed: number; total: number; sampled: boolean; unassigned: number;
  model: string; usage?: { prompt?: number; completion?: number; cost?: number }; at: string;
};
type Saved = { result: Result; basedOn: number };
export type InsightComment = { id: string; text: string; author: string; platform: "instagram" | "facebook"; post?: string; type?: string };

// Whether AI analysis is set up in Vercel. Asked once per page load.
let setupCheck: Promise<{ configured: boolean; model?: string; missing?: string[] }> | null = null;
const getSetup = () => (setupCheck ||= api<{ configured: boolean; model?: string; missing?: string[] }>("/api/insights").catch(() => ({ configured: false, missing: [] })));

const NOUN: Record<Bucket, string> = { Enquiry: "enquiries", Positive: "positive comments", Negative: "negative comments" };
const ASK: Record<Bucket, string> = { Enquiry: "What are people asking?", Positive: "Why are people happy?", Negative: "What's going wrong?" };

/** "Why are people saying this?" for one category: themes, counts, real example comments and suggestions. */
export default function InsightsPanel({ bucket, comments, context, saveKey, onJump, counts, onSwitch }: {
  bucket: Bucket; comments: InsightComment[]; context: string; saveKey: string; onJump: (id: string) => void;
  /** Open comments per category, for the switcher. */
  counts?: Record<Bucket, number>;
  /** Move to another category, or back to all comments (null). Without it, no switcher is shown. */
  onSwitch?: (b: Bucket | null) => void;
}) {
  const [setup, setSetup] = useState<{ configured: boolean; model?: string; missing?: string[] } | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [savedAt, setSavedAt] = useState<number>(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => { getSetup().then(setSetup); }, []);
  // A different category, window or filter has its own saved analysis.
  useEffect(() => {
    setSaved(null); setError(""); setOpen(true);
    cacheGet<Saved>(saveKey).then((c) => { if (c) { setSaved(c.value); setSavedAt(c.at); } });
  }, [saveKey]);

  const byId = new Map(comments.map((c) => [c.id, c]));
  const enough = comments.filter((c) => c.text.trim()).length >= 3;
  const newSince = saved ? comments.length - saved.basedOn : 0;

  async function run() {
    if (running) return;
    setRunning(true); setError("");
    try {
      const r = await api<Result>("/api/insights", {
        method: "POST",
        body: JSON.stringify({ bucket, context, comments: comments.map((c) => ({ id: c.id, text: c.text, platform: c.platform, post: c.post, type: c.type })) }),
      });
      const s = { result: r, basedOn: comments.length };
      setSaved(s); setSavedAt(Date.now()); setOpen(true);
      cacheSet(saveKey, s);
      logEvent({ level: "info", area: "ai analysis", message: `Analysed ${r.analysed} ${NOUN[bucket]}${r.sampled ? ` (sample of ${r.total})` : ""}: ${r.themes.length} themes`,
        details: { model: r.model, tokens: r.usage ? `${r.usage.prompt ?? "?"} in / ${r.usage.completion ?? "?"} out` : undefined, cost_usd: r.usage?.cost, view: context } });
    } catch (e: any) {
      setError(e.message);
      logEvent({ level: "error", area: "ai analysis", message: `Couldn't analyse ${NOUN[bucket]}: ${e.message}`, details: { view: context, comments: comments.length } });
    } finally { setRunning(false); }
  }

  async function copy() {
    if (!saved) return;
    const r = saved.result;
    const text = [`${ASK[bucket]} (${context}, ${r.analysed} ${NOUN[bucket]})`, r.summary, "",
      ...r.themes.flatMap((t) => [`• ${t.title} (${t.count}, ${t.share}%): ${t.explanation}`, ...(t.suggestion ? [`  → ${t.suggestion}`] : []),
        ...t.exampleIds.map((id) => byId.get(id)).filter(Boolean).map((c) => `  "${c!.text.slice(0, 140)}"`)])].join("\n");
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  }

  // Switch between categories (each keeps its own saved analysis) or go back to all comments.
  const switcher = onSwitch && counts && (
    <div className="ai-switch" role="group" aria-label="Analyse another category">
      <button onClick={() => onSwitch(null)} title="Back to all comments">All comments</button>
      {(["Enquiry", "Positive", "Negative"] as const).map((b) => (
        <button key={b} aria-pressed={b === bucket} onClick={() => b !== bucket && onSwitch(b)} disabled={running}>
          {b === "Enquiry" ? "Enquiries" : b} <span className="n">{counts[b].toLocaleString("en-IN")}</span>
        </button>
      ))}
    </div>
  );

  // ---------- Not set up ----------
  if (setup && !setup.configured) {
    return (
      <div className="ai-card ai-muted">
        {switcher}
        <div className="ai-head"><Sparkles /><strong>{ASK[bucket]}</strong></div>
        <div className="ai-note">AI analysis isn&apos;t switched on yet. Add {setup.missing?.length ? setup.missing.join(" and ") : "the OpenRouter settings"} in Vercel (Settings → Environment Variables), then redeploy. Steps are in the README.</div>
      </div>
    );
  }

  const r = saved?.result;
  return (
    <div className="ai-card">
      {switcher}
      <div className="ai-head">
        <Sparkles /><strong>{ASK[bucket]}</strong>
        {r && <span className="ai-meta">{r.analysed.toLocaleString("en-IN")} {NOUN[bucket]}{r.sampled ? ` (an even sample of ${r.total.toLocaleString("en-IN")})` : ""} · {ago(savedAt || Date.parse(r.at))}</span>}
        <span className="spacer" />
        {r && <button className="btn btn-sm btn-ghost" onClick={copy} title="Copy this analysis as text">{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}</button>}
        {r && <button className="btn btn-sm btn-ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? <ChevronUp /> : <ChevronDown />}{open ? "Hide themes" : `Show ${r.themes.length} themes`}</button>}
        <button className={`btn btn-sm${r ? "" : " btn-primary"}`} onClick={run} disabled={running || !enough || !setup}
          title={!enough ? "Needs at least 3 comments with text" : r ? "Analyse again with the comments shown now" : `Group these ${NOUN[bucket]} into themes with AI`}>
          {running ? <span className="spinner sm" aria-hidden /> : r ? <RefreshCw /> : <Sparkles />}
          {running ? "Analysing…" : r ? "Re-run" : `Analyse ${comments.length.toLocaleString("en-IN")} ${NOUN[bucket]}`}
        </button>
      </div>

      {!r && !running && !error && (
        <div className="ai-note">
          {enough ? <>Groups the {NOUN[bucket]} shown here into themes, with how many comments are in each and real examples.</>
            : <>Needs at least 3 {NOUN[bucket]} with text in this view. Try a longer time window.</>}
        </div>
      )}
      {running && <div className="ai-note">Reading {Math.min(comments.length, 400).toLocaleString("en-IN")} comments and grouping them into themes. This usually takes 10–30 seconds.</div>}
      {error && <div className="ai-error">{error}</div>}
      {r && newSince > 0 && !running && <div className="ai-note warn">{newSince} more {NOUN[bucket]} since this analysis. Re-run to include them.</div>}

      {r && open && (
        <>
          {r.summary && <p className="ai-summary">{r.summary}</p>}
          <div className="ai-themes">
            {r.themes.map((t, i) => (
              <div key={i} className="ai-theme">
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
          <div className="ai-foot">
            {r.unassigned > 0 && <span>{r.unassigned} comment{r.unassigned === 1 ? "" : "s"} didn&apos;t fit a theme. </span>}
            Counts and examples are checked against the real comments. Themes are written by AI, so read them as a guide.
          </div>
        </>
      )}
    </div>
  );
}
