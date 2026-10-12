"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Instagram, Facebook, ExternalLink, Search, EyeOff, Eye, CornerDownRight, ImageIcon, MessageCircle, BadgeCheck, Megaphone, ShieldCheck, ArrowRight, AlertTriangle, CheckCircle2, Inbox, ChevronRight, Info, Reply, Download, MoreHorizontal, Languages, Check } from "lucide-react";
import { api, fmtDateTime } from "./api";
import { cacheGet, cacheSet, ago } from "./cache";
import { useToast, Empty, CommentSkeleton, initials, Modal } from "./ui";
import { logEvent } from "./log";
import ReplyBox from "./ReplyBox";
import { commentChecks, pageCheck, postCheck, hiddenCheck } from "./graphDebug";
import { buildCsv, downloadCsv, csvName, type ExportRow } from "./exportCsv";
import InsightsPanel, { type InsightComment } from "./InsightsPanel";
import { foreignLanguage } from "./lang";
import { learnReplies, suggestionsFor } from "./learnReplies";

export type Target = {
  key: string; platform: "instagram" | "facebook"; objectId: string; pageId: string;
  brandUsername: string; title: string; caption: string; permalink: string; image?: string; kind?: "post" | "ad";
  /** Comment count Meta reported for this post. If it matches the cached copy, the cache is reused without fetching. */
  count?: number;
};
export type Src = {
  platform: "instagram" | "facebook"; pageId: string; objectId: string; brandUsername: string;
  caption: string; image?: string | null; permalink?: string | null; kind: "post" | "ad"; label: string; adId?: string;
};
type Comment = {
  id: string; text: string; time: string; author: string; hidden: boolean; canHide: boolean;
  parentId: string | null; parentText: string | null; isBrand: boolean; src?: Src;
  /** The same comment came back through this many ads/posts (ads that share engagement); shown once. */
  alsoOn?: number;
};

// Replies posted from this app, remembered so they always count as the brand's, even when Meta leaves out who wrote them.
const SENT_KEY = "cp:sent-replies";
const loadSent = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(SENT_KEY) || "[]")); } catch { return new Set(); } };
const rememberSent = (id: string) => {
  try { const ids = [...loadSent(), id].slice(-3000); localStorage.setItem(SENT_KEY, JSON.stringify(ids)); } catch { /* storage full or blocked */ }
};
type InboxTarget = Src & { count: number };
export type InboxSpec = {
  key: string; cacheKey: string; scope: string; noun?: "post" | "ad"; targetsUrl: string;
  /** The window being shown, in milliseconds. */
  sinceMs: number; untilMs: number;
  /** "last 7 days" or "12 Sept – 20 Sept", and the same as a phrase: "in the last 7 days" / "between 12 Sept and 20 Sept". */
  label: string; phrase: string;
  refresh: number; onOpen?: (src: Src) => void; onFetched?: () => void;
  /** Goes up each time the person picks a time window or dates: that (or Refresh) is when the app checks Meta. */
  checkReq: number;
  /** Ads only: "active" or "all", so notes don't suggest what's already selected. */
  status?: "active" | "all";
};
type Sync = {
  phase: "loading" | "checking" | "updating" | "ready" | "error";
  cachedAt?: number; checkedAt?: number; total?: number; loaded?: number; changed?: number; checked?: number;
  failed?: number; skipped?: number; withNew?: number; error?: string;
  stats?: {
    checked: number; unreadable: number; capped: boolean; withComments: number;
    ig?: { included: number; partner: number; unreadable: number; error?: string; noComments: number; reason?: string; unreadableIds?: string[] };
    fb?: { included: number; notConnected: number; unreadable: number; noComments: number; reason?: string; unreadableIds?: string[]; missingPages?: { id: string; name?: string; ads: number }[] };
  };
  /** Posts where Meta counts comments but returned none at all (withheld), by platform. */
  withheld?: { instagram: number; facebook: number };
  /** Plain-English reasons for posts whose comments failed to load. */
  failReasons?: string[];
  /** Meta's count vs what actually came back, when far apart (comments Meta counts but won't return). */
  gap?: { reported: number; got: number };
  /** Pages behind the posts where Meta withheld comments. */
  withheldPages?: string[];
  /** Shown from the browser's saved copy, without asking Meta. */
  fromCache?: boolean;
};
type InboxCache = { byObj: Record<string, Comment[]>; counts: Record<string, number>; since: number; results: Record<string, Result>; sync?: Sync };
type PostCache = { count: number | null; comments: Comment[]; results: Record<string, Result> };

// The app only asks Meta when the person picks a time window/dates, presses Refresh, or nothing is saved yet.
// This remembers which date selection each view has already been checked for, so switching pages or tabs
// shows the saved copy instead of fetching again.
const checkedFor = new Map<string, number>();

/** A saved copy with far fewer comments than Meta reports is not trustworthy (a failed or partial fetch). */
const looksIncomplete = (got: number, reported?: number | null) => !!reported && reported - got > 3 && got < reported * 0.5;

/** Reads an NDJSON stream line by line. */
async function readStream(url: string, body: unknown, onLine: (o: any) => void) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.status === 401) { window.location.href = "/?error=" + encodeURIComponent("Please log in again"); return; }
  if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onLine(JSON.parse(line));
    }
  }
}
type Category = "Enquiry" | "Positive" | "Negative" | "Unclassified";
type Result = { category: Category; negative_type: string | null; needs_review: boolean; reason: string; label?: string; score?: number };
type Filter = "All" | "Enquiry" | "Positive" | "Negative";
/** A comment in another language, translated to English (and re-scored from the translation). */
type Translated = { language: string; english: string };

// Options when correcting a comment. Values are the built-in model's labels.
const CHOICES: [string, string][] = [
  ["Enquiry", "Enquiry"],
  ["Positive", "Positive"],
  ["Complaint", "Negative · complaint"],
  ["Negative", "Negative · criticism"],
  ["Spam", "Negative · spam"],
];
const labelOf = (r: Result) =>
  r.label || (r.category === "Negative" ? (r.negative_type === "complaint" ? "Complaint" : r.negative_type === "spam" ? "Spam" : "Negative") : r.category);

const KPI: { key: Filter; label: string; color: string }[] = [
  { key: "All", label: "Open", color: "var(--violet)" },
  { key: "Enquiry", label: "Enquiry", color: "var(--enquiry)" },
  { key: "Positive", label: "Positive", color: "var(--positive)" },
  { key: "Negative", label: "Negative", color: "var(--negative)" },
];

const CHUNK = 100;
/** "All comments" reads comments in batches: this many posts/ads per request, this many requests at a time. */
const TARGETS_PER_BATCH = 20;
const BATCHES_AT_ONCE = 2;
/** Numbers the same way everywhere: 1,094 not 1094. */
const fmtN = (n: number) => n.toLocaleString("en-IN");

type HideResult = { id: string; ok: boolean; verified: boolean; hidden: boolean; error?: string };
// Translation uses the same OpenRouter setup as AI analysis; the Translate options only show when it's set up.
let aiReady: Promise<boolean> | null = null;
const aiAvailable = () => (aiReady ??= api<{ configured: boolean }>("/api/insights").then((d) => !!d.configured).catch(() => false));
const TRANSLATE_CHUNK = 50;
const BATCH = 50;

export default function CommentsPanel({ target, inbox, headerExtra, refresh = 0 }: { target?: Target; inbox?: InboxSpec; headerExtra?: ReactNode; refresh?: number }) {
  const loadKey = inbox?.key || target?.key || "";
  const [sync, setSync] = useState<Sync>({ phase: "loading" });
  const toast = useToast();
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [filter, setFilter] = useState<Filter>("All");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [showBrand, setShowBrand] = useState(false);
  const [showHidden, setShowHidden] = useState(true);
  const [plat, setPlat] = useState<"all" | "instagram" | "facebook">("all");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [captionOpen, setCaptionOpen] = useState(false);
  const [verified, setVerified] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState<Record<string, string>>({});
  const movingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Replying: which comment has the reply box open, which reply is being sent, and replies sent from here.
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<Record<string, string>>({});
  // Hide-all dialog
  const [hideAllOpen, setHideAllOpen] = useState(false);
  const [skipComplaints, setSkipComplaints] = useState(false);
  const [hideAllRun, setHideAllRun] = useState<{ done: number; total: number } | null>(null);
  const [hideAllResult, setHideAllResult] = useState<{ hidden: string[]; failed: HideResult[] } | null>(null);
  // Translations of comments in other languages (saved in the browser), and whether translation is available.
  const [translations, setTranslations] = useState<Record<string, Translated>>({});
  const [translating, setTranslating] = useState(false);
  const [translateOn, setTranslateOn] = useState(false);
  useEffect(() => {
    aiAvailable().then(setTranslateOn);
    cacheGet<Record<string, Translated>>("translations").then((c) => { if (c) setTranslations(c.value); });
  }, []);

  // Categorising runs in the background as comments arrive; results already cached are skipped.
  const resultsRef = useRef<Record<string, Result>>({});
  const commentsRef = useRef<Comment[] | null>(null);
  useEffect(() => { resultsRef.current = results; }, [results]);
  useEffect(() => { commentsRef.current = comments; }, [comments]);
  const queue = useRef<{ total: number; done: number; running: Promise<void> }>({ total: 0, done: 0, running: Promise.resolve() });

  function categorise(list: Comment[]) {
    const todo = list.filter((c) => !c.isBrand && c.text.trim() && !resultsRef.current[c.id]);
    if (!todo.length) return queue.current.running;
    const q = queue.current;
    q.total += todo.length;
    setProgress({ done: q.done, total: q.total });
    q.running = q.running.then(async () => {
      for (let i = 0; i < todo.length; i += CHUNK) {
        const chunk = todo.slice(i, i + CHUNK);
        try {
          const d = await api<{ results: Record<string, Result> }>("/api/classify", {
            method: "POST",
            body: JSON.stringify({ caption: target?.caption || "", comments: chunk.map((c) => ({ id: c.id, text: c.text, parentText: c.parentText, caption: c.src?.caption })) }),
          });
          resultsRef.current = { ...resultsRef.current, ...d.results };
          setResults((r) => ({ ...r, ...d.results }));
        } catch (e: any) {
          toast({ kind: "err", msg: `Couldn't categorise some comments: ${e.message}` });
        }
        q.done += chunk.length;
        setProgress({ done: q.done, total: q.total });
      }
      if (q.done >= q.total) { q.done = 0; q.total = 0; setProgress(null); persistSoon(); }
    });
    return q.running;
  }

  // ---------- Caching ----------
  const byObj = useRef<Record<string, Comment[]>>({});
  const objCounts = useRef<Record<string, number>>({});
  // Earliest moment the cached comments cover. If the window starts earlier, everything is refetched.
  const cachedSince = useRef(Number.MAX_SAFE_INTEGER);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const incomplete = useRef(false);
  const syncRef = useRef<Sync>({ phase: "loading" });
  useEffect(() => { syncRef.current = sync; }, [sync]);
  const cacheKey = inbox ? inbox.cacheKey : target ? `obj:${target.platform}:${target.objectId}` : "";

  /** Saves what's on screen (comments, hidden state, categories) to the browser cache, debounced. */
  function persistSoon() {
    clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      const list = commentsRef.current;
      if (!list || !cacheKey) return;
      const results = Object.fromEntries(list.filter((c) => resultsRef.current[c.id]).map((c) => [c.id, resultsRef.current[c.id]]));
      if (inbox) {
        const grouped: Record<string, Comment[]> = {};
        for (const k of Object.keys(byObj.current)) grouped[k] = [];
        for (const c of list) if (c.src) (grouped[c.src.objectId] ||= []).push(c);
        const { phase, ...lastSync } = syncRef.current;
        cacheSet(cacheKey, { byObj: grouped, counts: objCounts.current, since: cachedSince.current, results, sync: phase === "ready" ? { ...lastSync, phase: "ready" } : undefined } satisfies InboxCache);
      } else {
        // An incomplete copy is saved without Meta's count, so the next open fetches again instead of trusting it.
        cacheSet(cacheKey, { count: incomplete.current ? null : target?.count ?? null, comments: list, results } satisfies PostCache);
      }
    }, 600);
  }

  const flat = () => normalize(Object.values(byObj.current).flat()).sort((a, b) => Date.parse(b.time) - Date.parse(a.time));

  /** One card per comment: drops repeated ids, merges the same comment returned through several ads (same author,
   *  text and time), and marks replies sent from this app as the brand's. Merges are counted for the Activity log. */
  // Ids merged away in this check (a Set: the list is re-tidied as each post arrives, so each id must count once).
  const merges = useRef<Set<string>>(new Set());
  function normalize(list: Comment[]): Comment[] {
    const sentIds = loadSent();
    const byId = new Map<string, Comment>();
    for (const c of list) if (!byId.has(c.id)) byId.set(c.id, c); else noteMerge(c.id);
    const bySig = new Map<string, Comment>();
    const out: Comment[] = [];
    for (const raw of byId.values()) {
      const c = sentIds.has(raw.id) && !raw.isBrand ? { ...raw, isBrand: true, canHide: false } : { ...raw, alsoOn: undefined };
      const plat = c.src?.platform || target?.platform || "";
      const sig = c.text.trim() ? `${plat}|${c.author}|${c.time}|${c.parentText || ""}|${c.text.trim()}` : "";
      const kept = sig ? bySig.get(sig) : undefined;
      if (kept) { kept.alsoOn = (kept.alsoOn || 1) + 1; noteMerge(c.id); continue; }
      if (sig) bySig.set(sig, c);
      out.push(c);
    }
    return out;
  }
  function noteMerge(id: string) { merges.current.add(id); }

  async function runInbox(full: boolean, first: boolean) {
    const spec = inbox!;
    let hadCache = !!commentsRef.current;
    if (first) {
      const c = await cacheGet<InboxCache>(spec.cacheKey);
      if (c) {
        byObj.current = c.value.byObj; objCounts.current = c.value.counts; cachedSince.current = c.value.since ?? Number.MAX_SAFE_INTEGER;
        resultsRef.current = c.value.results; setResults(c.value.results);
        setComments(flat());
        hadCache = true;
        // Saved copy covers this window and this date selection was already checked: show it, don't ask Meta.
        const alreadyChecked = (checkedFor.get(spec.key) ?? -1) >= spec.checkReq;
        if (!full && cachedSince.current <= spec.sinceMs + 60_000 && (alreadyChecked || spec.checkReq === 0)) {
          checkedFor.set(spec.key, spec.checkReq);
          setSync({ ...(c.value.sync || { phase: "ready" }), phase: "ready", fromCache: true, cachedAt: c.at });
          categorise(flat());
          return;
        }
        setSync({ phase: "checking", cachedAt: c.at });
      }
    }
    if (!first || !hadCache) setSync((s) => ({ ...s, phase: hadCache ? "checking" : "loading" }));
    try {
      const res = await api<{ targets?: InboxTarget[]; stats?: Sync["stats"] }>(spec.targetsUrl);
      const targets = Array.isArray(res?.targets) ? res.targets : [];
      const stats = res?.stats;
      const byId = new Map(targets.map((t) => [t.objectId, t]));
      for (const k of Object.keys(byObj.current)) if (!byId.has(k)) delete byObj.current[k];
      const needLonger = cachedSince.current > spec.sinceMs + 60_000;
      const changed = targets.filter((t) => full || needLonger || objCounts.current[t.objectId] !== t.count || !byObj.current[t.objectId]);
      const base = { checked: targets.length, checkedAt: Date.now(), stats, fromCache: false };
      checkedFor.set(spec.key, spec.checkReq);
      if (stats?.ig?.unreadable) logEvent({ level: "warn", area: "instagram ads", message: `${stats.ig.unreadable} Instagram ad posts couldn't be read (${stats.ig.reason || "unknown reason"})`, details: { mediaIds: stats.ig.unreadableIds, meta: stats.ig.error, checks: stats.ig.unreadableIds?.[0] ? [postCheck("instagram", stats.ig.unreadableIds[0])] : undefined } });
      if (stats?.fb?.unreadable) logEvent({ level: "warn", area: "facebook ads", message: `${stats.fb.unreadable} Facebook ad posts couldn't be read (${stats.fb.reason || "unknown reason"})`, details: { postIds: stats.fb.unreadableIds, checks: stats.fb.unreadableIds?.[0] ? [postCheck("facebook", stats.fb.unreadableIds[0])] : undefined } });
      if (stats?.fb?.missingPages?.length) logEvent({ level: "warn", area: "facebook ads", message: `${stats.fb.notConnected} Facebook ad posts are on Pages this login can't open`, details: { pages: stats.fb.missingPages, checks: pageCheck(stats.fb.missingPages[0].id) } });
      if (!changed.length) {
        // Nothing needed fetching, so the saved copy covers the whole window.
        if (full || needLonger) cachedSince.current = spec.sinceMs;
        setComments(flat());
        setSync((s) => ({ ...s, ...base, phase: "ready", changed: 0, withNew: Object.values(byObj.current).filter((l) => l.length).length }));
        categorise(flat());
        spec.onFetched?.();
        persistSoon();
        return;
      }
      let loaded = 0, failed = 0, skipped = 0;
      const withheld = { instagram: 0, facebook: 0 };
      const failReasons = new Set<string>();
      const withheldPages = new Set<string>();
      setSync((s) => ({ ...s, ...base, phase: hadCache ? "updating" : "loading", total: changed.length, loaded: 0 }));
      if (!hadCache) setComments([]);
      const sinceArg = Math.min(spec.sinceMs, needLonger || full ? spec.sinceMs : cachedSince.current);
      const reported = new Set<string>();
      const onLine = (m: any) => {
        if (m.objectId) reported.add(m.objectId);
        if (m.type === "comments") {
          const t = byId.get(m.objectId)!;
          const { count, ...src } = t;
          const fresh: Comment[] = m.comments.map((c: Comment) => ({ ...c, src }));
          byObj.current[m.objectId] = fresh;
          objCounts.current[m.objectId] = count;
          loaded++;
          setComments(flat());
          categorise(fresh);
        } else if (m.type === "withheld") {
          const t = byId.get(m.objectId)!;
          withheld[t.platform]++; loaded++;
          if (t.pageId) withheldPages.add(t.pageId);
          byObj.current[m.objectId] = [];
          objCounts.current[m.objectId] = -1; // not a real count, so the next check tries again
          logEvent({ level: "error", area: `${t.platform} comments`, message: `Meta reports ${m.reported} comments on a ${t.platform === "facebook" ? "Facebook" : "Instagram"} ${t.kind} but returned none`, details: { objectId: t.objectId, pageId: t.pageId || undefined, ad: t.label, diagnose: `/api/diagnose/comments?platform=${t.platform}&objectId=${t.objectId}`, checks: commentChecks(t.platform, t.objectId) } });
        } else if (m.type === "failed") {
          failed++; loaded++;
          if (m.reason) failReasons.add(m.reason);
          const t = byId.get(m.objectId);
          logEvent({ level: "error", area: `${m.platform || t?.platform || ""} comments`, message: `Couldn't load comments (${m.reason || "error"})`, details: { objectId: m.objectId, ad: t?.label, meta: m.error, checks: t ? commentChecks(t.platform, t.objectId) : undefined } });
        }
        else if (m.type === "skipped") { skipped++; loaded++; }
        if (m.type !== "done") setSync((s) => ({ ...s, loaded, failed, skipped }));
      };
      // Batches of TARGETS_PER_BATCH posts/ads, BATCHES_AT_ONCE at a time: each batch is its own request, inside
      // Vercel's 60-second limit, so there's no cap on how many posts can be read.
      const batches: InboxTarget[][] = [];
      for (let i = 0; i < changed.length; i += TARGETS_PER_BATCH) batches.push(changed.slice(i, i + TARGETS_PER_BATCH));
      let nextBatch = 0;
      await Promise.all(Array.from({ length: Math.min(BATCHES_AT_ONCE, batches.length) }, async () => {
        while (nextBatch < batches.length) {
          const batch = batches[nextBatch++];
          try {
            await readStream("/api/inbox/comments", { targets: batch, since: sinceArg, until: Date.now() }, onLine);
          } catch (e: any) {
            // This batch failed as a whole: its posts count as not loaded (with the reason); the other batches carry on.
            const missed = batch.filter((t) => !reported.has(t.objectId));
            failed += missed.length; loaded += missed.length;
            failReasons.add(e.message);
            missed.forEach((t) => reported.add(t.objectId));
            logEvent({ level: "error", area: "inbox", message: `Couldn't load comments for ${missed.length} ${spec.noun || "post"}${missed.length === 1 ? "" : "s"} (one batch): ${e.message}`, details: { objectIds: missed.slice(0, 20).map((t) => t.objectId) } });
            setSync((s) => ({ ...s, loaded, failed, skipped }));
          }
        }
      }));
      if (full || needLonger) cachedSince.current = spec.sinceMs;
      setSync((s) => ({ ...s, phase: "ready", changed: changed.length - failed - skipped - withheld.instagram - withheld.facebook, failed, skipped, withheld, withheldPages: [...withheldPages], failReasons: [...failReasons], checkedAt: Date.now(), withNew: Object.values(byObj.current).filter((l) => l.length).length }));
      setComments(flat());
      if (merges.current.size) {
        const n = merges.current.size;
        logEvent({ level: "warn", area: "duplicates", message: `${n} repeated comment${n === 1 ? "" : "s"} merged (Meta returned the same comment more than once, or through several ads); each is shown once`, details: { sampleCommentIds: [...merges.current].slice(0, 10) } });
        merges.current = new Set();
      }
      spec.onFetched?.();
      persistSoon();
    } catch (e: any) {
      logEvent({ level: "error", area: "inbox", message: `Couldn't check for new comments: ${e.message}`, details: { view: spec.key } });
      if (commentsRef.current) {
        setSync((s) => ({ ...s, phase: "error", error: e.message }));
        toast({ kind: "err", msg: `Couldn't check for new comments, showing saved ones: ${e.message}` });
      } else setLoadError(e.message);
    }
  }

  async function runTarget(full: boolean, first: boolean) {
    const t = target!;
    let hadCache = false;
    if (first && !full) {
      const c = await cacheGet<PostCache>(cacheKey);
      if (c) {
        hadCache = true;
        resultsRef.current = c.value.results; setResults(c.value.results);
        setComments(normalize(c.value.comments));
        // Reuse the saved copy only if Meta's count hasn't moved AND the copy isn't suspiciously short.
        const same = t.count != null && c.value.count === t.count && !looksIncomplete(c.value.comments.length, t.count);
        setSync({ phase: same ? "ready" : "checking", cachedAt: c.at, checkedAt: same ? c.at : undefined, changed: 0, fromCache: same });
        if (same) { categorise(c.value.comments); return; }
      }
    }
    setSync((s) => ({ ...s, phase: hadCache || commentsRef.current ? "checking" : "loading" }));
    try {
      const d = await api<{ comments: Comment[] }>(`/api/comments?${new URLSearchParams({ platform: t.platform, objectId: t.objectId, pageId: t.pageId, brandUsername: t.brandUsername })}`);
      const clean = normalize(d.comments);
      setComments(clean);
      commentsRef.current = clean;
      const gap = looksIncomplete(d.comments.length, t.count) ? { reported: t.count!, got: d.comments.length } : undefined;
      incomplete.current = !!gap;
      if (gap) logEvent({ level: "error", area: `${t.platform} comments`, message: `Meta reports ${gap.reported} comments on this ${t.kind || "post"} but returned ${gap.got}`, details: { objectId: t.objectId, pageId: t.pageId || undefined, title: t.title, diagnose: `/api/diagnose/comments?platform=${t.platform}&objectId=${t.objectId}`, checks: commentChecks(t.platform, t.objectId) } });
      setSync({ phase: "ready", checkedAt: Date.now(), changed: 1, gap });
      categorise(d.comments);
      persistSoon();
    } catch (e: any) {
      if (commentsRef.current) toast({ kind: "err", msg: `Couldn't refresh, showing saved comments: ${e.message}` });
      else setLoadError(e.message);
    }
  }

  // First load: show the cached copy straight away, then fetch only what changed.
  useEffect(() => {
    (inbox ? runInbox(false, true) : runTarget(false, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadKey]);

  // The person picked a time window or dates while this view was open: check Meta for new comments.
  const firstCheckReq = useRef(inbox?.checkReq);
  useEffect(() => {
    if (!inbox || inbox.checkReq === firstCheckReq.current) return;
    firstCheckReq.current = inbox.checkReq;
    runInbox(false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inbox?.checkReq]);

  // Refresh button: refetch everything, but keep showing the current comments meanwhile.
  const firstRefresh = useRef(inbox ? inbox.refresh : refresh);
  useEffect(() => {
    const r = inbox ? inbox.refresh : refresh;
    if (r === firstRefresh.current) return;
    firstRefresh.current = r;
    (inbox ? runInbox(true, false) : runTarget(true, false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inbox?.refresh, refresh]);

  /** Where a comment lives: its own source in the inbox, or the open post. */
  const whereIs = (c: Comment) => c.src
    ? { platform: c.src.platform, pageId: c.src.pageId || c.id.split("_")[0] }
    : { platform: target!.platform, pageId: target!.pageId || c.id.split("_")[0] };

  /** Hides or unhides comments in batches of 50. Meta confirms each one by reading it back. */
  async function setHidden(ids: string[], hide: boolean, onProgress?: (done: number) => void): Promise<HideResult[]> {
    const all: HideResult[] = [];
    setBusy((b) => ({ ...b, ...Object.fromEntries(ids.map((i) => [i, true])) }));
    // Group by platform and Page, because each group needs its own access token on the server.
    const groups = new Map<string, { platform: string; pageId: string; ids: string[] }>();
    for (const id of ids) {
      const c = comments?.find((x) => x.id === id);
      if (!c) continue;
      const w = whereIs(c);
      const k = w.platform === "instagram" ? "instagram" : `facebook:${w.pageId}`;
      if (!groups.has(k)) groups.set(k, { ...w, ids: [] });
      groups.get(k)!.ids.push(id);
    }
    const chunks: { platform: string; pageId: string; ids: string[] }[] = [];
    for (const g of groups.values()) for (let i = 0; i < g.ids.length; i += BATCH) chunks.push({ ...g, ids: g.ids.slice(i, i + BATCH) });
    let done = 0;
    for (const ch of chunks) {
      const chunk = ch.ids;
      try {
        const d = await api<{ results: HideResult[] }>("/api/hide", {
          method: "POST",
          body: JSON.stringify({ platform: ch.platform, pageId: ch.pageId, hide, commentIds: chunk }),
        });
        all.push(...d.results);
        const byId = new Map(d.results.map((r) => [r.id, r]));
        const okIds = d.results.filter((r) => r.ok).map((r) => r.id);
        if (okIds.length) logEvent({
          level: "info", area: hide ? "hide" : "unhide",
          message: `${okIds.length} ${ch.platform === "instagram" ? "Instagram" : "Facebook"} comment${okIds.length === 1 ? "" : "s"} ${hide ? "hidden" : "unhidden"}${d.results.every((r) => !r.ok || r.verified) ? ", confirmed by Meta" : ""}`,
          details: { commentIds: okIds.slice(0, 20), note: hide ? "Hidden comments stay visible to the person who wrote them, their friends, and the Page's admins (shown greyed out). To check, view the post logged out or from an unrelated account." : undefined, checks: [hiddenCheck(ch.platform as "instagram" | "facebook", okIds[0])] },
        });
        setComments((list) => list?.map((x) => (byId.has(x.id) ? { ...x, hidden: byId.get(x.id)!.hidden } : x)) || null);
        persistSoon();
        setVerified((v) => {
          const n = new Set(v);
          for (const r of d.results) (r.verified && hide ? n.add(r.id) : n.delete(r.id));
          return n;
        });
      } catch (e: any) {
        all.push(...chunk.map((id) => ({ id, ok: false, verified: false, hidden: !hide, error: e.message })));
      }
      done += chunk.length;
      onProgress?.(done);
    }
    setBusy((b) => ({ ...b, ...Object.fromEntries(ids.map((i) => [i, false])) }));
    return all;
  }

  async function hideWithUndo(ids: string[]) {
    const res = await setHidden(ids, true);
    const done = res.filter((r) => r.ok).map((r) => r.id);
    const failed = res.filter((r) => !r.ok);
    setSelected(new Set());
    if (failed.length) {
      toast({ kind: "err", msg: `${failed.length === res.length ? "Couldn't hide" : `${failed.length} couldn't be hidden`}: ${failed[0].error}` });
      logEvent({ level: "error", area: "hide", message: `${failed.length} comment${failed.length === 1 ? "" : "s"} couldn't be hidden`, details: { failures: failed.slice(0, 20).map((f) => ({ id: f.id, error: f.error })) } });
    }
    if (!done.length) return;
    const allVerified = res.filter((r) => r.ok).every((r) => r.verified);
    toast({
      kind: "ok",
      msg: `${done.length === 1 ? "Comment hidden" : `${done.length} comments hidden`}${allVerified ? " and confirmed by Meta" : ""}. The writer and their friends can still see ${done.length === 1 ? "it" : "them"}.`,
      undo: () => unhideMany(done),
    });
  }

  async function unhideMany(ids: string[]) {
    const res = await setHidden(ids, false);
    const ok = res.filter((r) => r.ok).length;
    if (ok) toast({ kind: "ok", msg: ok === 1 ? "Comment is visible again." : `${ok} comments are visible again.` });
    const failed = res.filter((r) => !r.ok);
    if (failed.length) toast({ kind: "err", msg: `${failed.length} couldn't be unhidden: ${failed[0].error}` });
  }

  async function unhide(c: Comment) {
    await unhideMany([c.id]);
  }

  async function runHideAll() {
    const ids = negativeTargets.filter((c) => !(skipComplaints && results[c.id]?.negative_type === "complaint")).map((c) => c.id);
    if (!ids.length) return;
    setHideAllResult(null);
    setHideAllRun({ done: 0, total: ids.length });
    const res = await setHidden(ids, true, (done) => setHideAllRun({ done, total: ids.length }));
    setHideAllRun(null);
    const bad = res.filter((r) => !r.ok);
    if (bad.length) logEvent({ level: "error", area: "hide", message: `Hide all negative: ${bad.length} of ${res.length} couldn't be hidden`, details: { failures: bad.slice(0, 20).map((f) => ({ id: f.id, error: f.error })) } });
    setHideAllResult({ hidden: res.filter((r) => r.ok).map((r) => r.id), failed: bad });
    setSelected(new Set());
  }

  function closeHideAll() {
    if (hideAllRun) return;
    setHideAllOpen(false);
    setHideAllResult(null);
  }

  /** The name the brand replies under, for the reply box. */
  const brandName = (c: Comment) => {
    const u = c.src?.brandUsername || target?.brandUsername;
    return u ? `@${u}` : platOf(c) === "facebook" ? "your Page" : "the brand";
  };

  /** Posts a public reply as the brand, shows it under the comment straight away, and optionally hides the comment. */
  async function sendReply(c: Comment, text: string, alsoHide: boolean) {
    if (sending) return;
    const w = whereIs(c);
    // Instagram only takes replies on top-level comments, so a reply to a reply goes into the same thread with an @mention.
    const top = c.parentId || c.id;
    const message = c.parentId && w.platform === "instagram" && c.author && !text.startsWith("@") ? `@${c.author} ${text}` : text;
    setSending(true);
    try {
      const d = await api<{ id: string; time: string }>("/api/reply", {
        method: "POST",
        body: JSON.stringify({ platform: w.platform, pageId: w.pageId, commentId: top, message }),
      });
      if (d.id) rememberSent(d.id);
      const parent = (comments || []).find((x) => x.id === top);
      const reply: Comment = {
        id: d.id || `local-${Date.now()}`, text: message, time: d.time || new Date().toISOString(),
        author: (c.src?.brandUsername || target?.brandUsername || "").trim(), hidden: false, canHide: false,
        parentId: top, parentText: parent?.text ?? c.text, isBrand: true, src: c.src,
      };
      if (c.src) (byObj.current[c.src.objectId] ||= []).push(reply);
      setComments((list) => [...(list || []), reply]);
      setSent((m) => ({ ...m, [c.id]: message }));
      setReplyingTo(null);
      persistSoon();
      toast({ kind: "ok", msg: `Reply posted on ${w.platform === "instagram" ? "Instagram" : "Facebook"}.` });
      if (alsoHide && c.canHide && !c.hidden) await hideWithUndo([c.id]);
    } catch (e: any) {
      toast({ kind: "err", msg: e.message });
      logEvent({ level: "error", area: "reply", message: `Couldn't post a reply on ${w.platform}`, details: { commentId: top, error: e.message } });
    } finally {
      setSending(false);
    }
  }

  /** Translates comments in other languages to English and re-scores them from the translation (50 per request). */
  async function translateMany(list: Comment[]) {
    const todo = list.filter((c) => !translations[c.id] && foreignLanguage(c.text));
    if (!todo.length || translating) return;
    setTranslating(true);
    const fresh: Record<string, Translated> = {};
    const freshResults: Record<string, Result> = {};
    try {
      for (let i = 0; i < todo.length; i += TRANSLATE_CHUNK) {
        const chunk = todo.slice(i, i + TRANSLATE_CHUNK);
        const d = await api<{ results: Record<string, { language: string; english: string; result: Result }>; error?: string }>("/api/translate", {
          method: "POST", body: JSON.stringify({ comments: chunk.map((c) => ({ id: c.id, text: c.text })) }),
        });
        if (d.error) throw new Error(d.error);
        for (const [id, v] of Object.entries(d.results || {})) {
          fresh[id] = { language: v.language, english: v.english };
          freshResults[id] = { ...v.result, reason: `Translated from ${v.language}` };
        }
      }
    } catch (e: any) {
      toast({ kind: "err", msg: `Couldn't translate${Object.keys(fresh).length ? " all of them" : ""}: ${e.message}` });
      logEvent({ level: "error", area: "translate", message: `Translation failed: ${e.message}`, details: { comments: todo.length } });
    } finally {
      const n = Object.keys(fresh).length;
      if (n) {
        setTranslations((t) => {
          const all = Object.entries({ ...t, ...fresh });
          const kept = Object.fromEntries(all.slice(-3000));
          cacheSet("translations", kept);
          return kept;
        });
        resultsRef.current = { ...resultsRef.current, ...freshResults };
        setResults((r) => ({ ...r, ...freshResults }));
        persistSoon();
        // Comments whose new category isn't the one in view would vanish with their translation: keep them on screen
        // for a few seconds with a "Moved to …" note, so the person sees the translation and where it went.
        const moved = filter === "All" ? [] : Object.entries(freshResults).filter(([, r]) => r.category !== filter);
        if (moved.length) {
          setMoving((m) => ({ ...m, ...Object.fromEntries(moved.map(([id, r]) => [id, r.category])) }));
          for (const [id] of moved) {
            clearTimeout(movingTimers.current[id]);
            movingTimers.current[id] = setTimeout(() => setMoving((m) => { const x = { ...m }; delete x[id]; return x; }), 8000);
          }
        }
        const top = moved.length ? Object.entries(moved.reduce((a, [, r]) => ({ ...a, [r.category]: (a[r.category] || 0) + 1 }), {} as Record<string, number>)).sort((a, b) => b[1] - a[1])[0][0] : "";
        toast({
          kind: "ok",
          msg: `Translated ${fmtN(n)} comment${n === 1 ? "" : "s"}.${moved.length ? ` ${fmtN(moved.length)} moved to another category.` : ""}`,
          action: top ? { label: `View ${top}`, run: () => setFilter(top as Filter) } : undefined,
        });
      }
      setTranslating(false);
    }
  }

  // Comments inside the chosen time window (the cache may hold a longer window).
  const sinceMs = inbox ? inbox.sinceMs : 0;
  const untilMs = inbox ? inbox.untilMs : 0;
  const platOf = (c: Comment) => c.src?.platform || target?.platform || "facebook";
  const inWin = (c: Comment) => {
    if (plat !== "all" && platOf(c) !== plat) return false;
    if (!inbox) return true;
    const t = Date.parse(c.time);
    return t >= sinceMs && t <= untilMs;
  };
  // Every customer comment in the window, and the ones still public ("open"). KPIs count open comments only:
  // a hidden comment has already been dealt with.
  const allCustomer = useMemo(() => (comments || []).filter((c) => !c.isBrand && inWin(c)), [comments, sinceMs, untilMs, plat]);
  const customer = useMemo(() => allCustomer.filter((c) => !c.hidden), [allCustomer]);

  const counts = useMemo(() => {
    const c = { All: customer.length, Enquiry: 0, Positive: 0, Negative: 0 };
    for (const x of customer) {
      const r = results[x.id];
      if (r && r.category !== "Unclassified") c[r.category]++;
    }
    return c;
  }, [customer, results]);
  const hiddenCounts = useMemo(() => {
    const c = { All: 0, Enquiry: 0, Positive: 0, Negative: 0 };
    for (const x of allCustomer) {
      if (!x.hidden) continue;
      c.All++;
      const r = results[x.id];
      if (r && r.category !== "Unclassified") c[r.category]++;
    }
    return c;
  }, [allCustomer, results]);

  // How the comments in view add up: open (customer, still visible) + hidden + the brand's own replies.
  // For a single post this is compared with Meta's own count, so the numbers always reconcile on screen.
  const tally = useMemo(() => {
    const inView = (comments || []).filter(inWin);
    const brand = inView.filter((c) => c.isBrand).length;
    const hidden = inView.filter((c) => !c.isBrand && c.hidden).length;
    const open = inView.length - brand - hidden;
    return { loaded: inView.length, open, hidden, brand };
  }, [comments, sinceMs, untilMs, plat]);

  // Open comments per platform in the window, so it's obvious whether Instagram and Facebook are both there.
  const platCounts = useMemo(() => {
    const c = { instagram: 0, facebook: 0 };
    if (!inbox) return c;
    for (const x of comments || []) {
      if (x.isBrand || x.hidden) continue;
      const t = Date.parse(x.time);
      if (t < sinceMs || t > untilMs) continue;
      c[platOf(x)]++;
    }
    return c;
  }, [comments, sinceMs, untilMs]);

  // Which comments the brand has already replied to.
  const replied = useMemo(() => {
    const s = new Set<string>();
    for (const c of comments || []) if (c.isBrand && c.parentId) s.add(c.parentId);
    for (const id of Object.keys(sent)) s.add(id);
    return s;
  }, [comments, sent]);

  // Only what needs action in the category being looked at: Negative → complaints, then spam; Enquiry → unanswered
  // enquiries; All → the most urgent of those; Positive → nothing to act on, so no box.
  const insight = useMemo(() => {
    if (progress || !customer.length || filter === "Positive") return null;
    const visible = customer;
    const complaints = filter === "Enquiry" ? [] : visible.filter((c) => results[c.id]?.negative_type === "complaint");
    const openEnq = filter === "Negative" ? [] : visible.filter((c) => results[c.id]?.category === "Enquiry" && !c.parentId && !replied.has(c.id));
    const spam = filter === "Enquiry" ? [] : visible.filter((c) => results[c.id]?.negative_type === "spam" && c.canHide);
    if (complaints.length) return {
      tone: "danger", tag: "Needs attention",
      title: `${fmtN(complaints.length)} ${complaints.length === 1 ? "customer has" : "customers have"} an order or product problem`,
      button: filter === "Negative" ? null : { label: "Show negatives", run: () => setFilter("Negative") },
    };
    if (spam.length) return {
      tone: "info", tag: "Info",
      title: `${fmtN(spam.length)} spam ${spam.length === 1 ? "comment" : "comments"} can be hidden`,
      button: { label: "Select spam", run: () => { setFilter("Negative"); setSelected(new Set(spam.map((c) => c.id))); } },
    };
    if (openEnq.length) return {
      tone: "info", tag: "Info",
      title: `${fmtN(openEnq.length)} ${openEnq.length === 1 ? "enquiry has" : "enquiries have"} no reply from the brand`,
      button: filter === "Enquiry" ? null : { label: "Show enquiries", run: () => setFilter("Enquiry") },
    };
    return null;
  }, [customer, results, replied, progress, filter]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (comments || []).filter((c) => {
      if (!inWin(c)) return false;
      if (c.isBrand) return false; // added below, under the comment they answer
      if (c.hidden && !showHidden) return false;
      if (q && !c.text.toLowerCase().includes(q) && !c.author.toLowerCase().includes(q)) return false;
      if (filter === "All") return true;
      if (moving[c.id]) return true;
      return results[c.id]?.category === filter;
    });
    // Brand replies (toggle on): under any comment in view, whatever the category or search. On "All" without a search,
    // brand comments that don't answer anyone are shown too.
    if (showBrand) {
      const shown = new Set(list.map((c) => c.id));
      for (const c of comments || []) {
        if (!c.isBrand || !inWin(c)) continue;
        if (c.parentId ? shown.has(c.parentId) : filter === "All" && !q) list.push(c);
      }
    }
    // Keep replies under their parent comment; sort top-level comments.
    const top = list.filter((c) => !c.parentId || !list.some((p) => p.id === c.parentId));
    top.sort((a, b) => (sort === "newest" ? 1 : -1) * (Date.parse(b.time) - Date.parse(a.time)));
    const out: Comment[] = [];
    for (const t of top) {
      out.push(t);
      for (const r of list) if (r.parentId === t.id) out.push(r);
    }
    return out;
  }, [comments, results, filter, query, sort, showBrand, showHidden, moving, sinceMs, untilMs, plat]);

  // ---------- CSV download: exactly the customer comments in view (window + filters), brand replies left out ----------
  const exportable = visible.filter((c) => !c.isBrand);
  const BUCKET: Record<string, string> = { Enquiry: "Enquiry", Positive: "Positive", Negative: "Negative" };
  function exportCsv() {
    const byId = new Map((comments || []).map((c) => [c.id, c]));
    const rows: ExportRow[] = exportable.map((c) => {
      const r = results[c.id];
      const src = c.src;
      return {
        commenter: c.author, platform: platOf(c), time: c.time, text: c.text || "(sticker or image)",
        bucket: r ? BUCKET[r.category] || "Not categorised" : "Not categorised",
        type: r?.category === "Negative" ? (r.negative_type === "abuse" ? "criticism" : r.negative_type || "") : "",
        score: r?.score != null ? Math.round(r.score * 100) : null,
        post: src ? `${src.kind === "ad" ? "Ad · " : ""}${src.label || src.caption}` : target?.title || "",
        link: (src ? src.permalink : target?.permalink) || "",
        hidden: c.hidden, brandReplied: replied.has(c.id), isReply: !!c.parentId,
        replyingTo: c.parentId ? byId.get(c.parentId)?.text || c.parentText || "" : "",
      };
    });
    // Say so in the file when it's not the complete picture.
    const s = sync.stats;
    const gaps: string[] = [];
    if (s?.capped) gaps.push("there were more posts/ads than could be listed in one check");
    if (sync.withheld?.facebook || sync.withheld?.instagram) gaps.push("Meta withheld comments on some posts");
    if (sync.failed) gaps.push(`${sync.failed} could not be loaded`);
    if (sync.skipped) gaps.push(`${sync.skipped} were skipped for time`);
    if (sync.gap) gaps.push(`Meta counts ${sync.gap.reported} comments on this post but returned ${sync.gap.got}`);
    const filters = [filter !== "All" ? `category: ${filter}` : "", plat !== "all" ? `platform: ${plat}` : "", query.trim() ? `search: "${query.trim()}"` : "", !showHidden ? "hidden comments left out" : ""].filter(Boolean);
    const note = [gaps.length ? `This file may be incomplete: ${gaps.join("; ")}.` : "", filters.length ? `Filtered by ${filters.join(", ")}.` : ""].filter(Boolean).join(" ");
    const scope = inbox ? [inbox.scope.split(" · ")[0], inbox.noun === "ad" ? "ad comments" : "post comments", inbox.label] : [target?.kind === "ad" ? "ad" : "post", target?.title || ""];
    downloadCsv(buildCsv(rows, note || undefined), csvName([...scope, filter !== "All" ? filter : ""]));
    toast({ kind: "ok", msg: `Downloaded ${rows.length} comment${rows.length === 1 ? "" : "s"}${note ? ". " + note : "."}` });
  }

  // ---------- AI analysis: the customer comments in view, for the chosen category ----------
  const aiBucket = filter === "Enquiry" || filter === "Positive" || filter === "Negative" ? filter : null;
  const aiComments: InsightComment[] = aiBucket ? exportable.filter((c) => !c.hidden && c.text.trim()).map((c) => ({
    id: c.id, text: c.text, author: c.author, platform: platOf(c),
    post: c.src ? c.src.caption || c.src.label : target?.caption || "", type: results[c.id]?.negative_type || undefined,
  })) : [];
  const aiContext = inbox ? `${inbox.scope}, ${inbox.label}` : `${target?.kind === "ad" ? "Ad" : "Post"}: ${(target?.caption || target?.title || "").slice(0, 120)}`;
  const aiKey = `insights:${cacheKey}:${inbox ? inbox.key : target?.key}:${filter}:${plat}:${query.trim().toLowerCase()}`;
  /** Scrolls to a comment in the list and highlights it briefly. */
  function jumpTo(id: string) {
    const el = document.querySelector(`article.comment[data-cid="${CSS.escape(id)}"]`);
    if (!el) { toast({ kind: "err", msg: "That comment isn't in the list right now (a filter may be hiding it)." }); return; }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1600);
  }

  // The brand's usual replies per kind of comment, learned from its own past replies once comments are categorised.
  const learned = useMemo(() => learnReplies(comments || [], (id) => (results[id] ? labelOf(results[id]) : null)), [comments, results]);
  // Comments in a language the built-in model can't read, still untranslated, in this view.
  const foreign = translateOn ? visible.filter((c) => !c.isBrand && !translations[c.id] && foreignLanguage(c.text)) : [];
  const foreignLangs = [...new Set(foreign.map((c) => foreignLanguage(c.text)!))];

  const hideable = visible.filter((c) => c.canHide && !c.hidden);
  const negativeTargets = customer.filter((c) => c.canHide && !c.hidden && results[c.id]?.category === "Negative");
  const negBreakdown = {
    complaint: negativeTargets.filter((c) => results[c.id]?.negative_type === "complaint").length,
    criticism: negativeTargets.filter((c) => results[c.id]?.negative_type === "criticism" || results[c.id]?.negative_type === "abuse").length,
    spam: negativeTargets.filter((c) => results[c.id]?.negative_type === "spam").length,
  };
  const hideAllCount = negativeTargets.length - (skipComplaints ? negBreakdown.complaint : 0);
  const selectedHideable = [...selected].filter((id) => hideable.some((c) => c.id === id));
  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = hideable.length > 0 && hideable.every((c) => selected.has(c.id));
  // Per-comment checkboxes only show once a selection has started (Select all / Select spam); one comment = its Hide button.
  const selecting = selected.size > 0;

  // Fetching overlay: whenever the app is talking to Meta (checking or loading), the list is dimmed and can't be acted
  // on, and a card in the middle says what's happening. Views checked in the last 2 minutes aren't re-checked at all.
  const busyNow = sync.phase === "updating" || sync.phase === "loading" || sync.phase === "checking";
  const nounOf = inbox?.noun || "post";
  const busyTitle = "Getting the latest comments…";
  const busyDetail = sync.total ? `${sync.loaded || 0} of ${sync.total} ${nounOf}${sync.total === 1 ? "" : "s"}` : "";

  const PlatformIcon = target?.platform === "instagram" ? Instagram : Facebook;
  const windowLabel = inbox ? inbox.label : "";

  return (
    <div>
      {inbox ? (
        <div className="card inbox-line">
          <span className="inbox-scope">{inbox.scope} · {windowLabel}</span>
          <Refreshed sync={sync} />
        </div>
      ) : target ? (
      <div className="card post-hero">
        {target!.image ? <img className="thumb" src={target!.image} alt="" /> : <span className="thumb">{target!.kind === "ad" ? <Megaphone /> : <ImageIcon />}</span>}
        <div style={{ minWidth: 0, flex: 1 }}>
          {target!.caption && (
            <>
              <div className={`caption${captionOpen ? " open" : ""}`}>{target!.caption}</div>
              {target!.caption.length > 140 && <button className="linkish" onClick={() => setCaptionOpen((o) => !o)}>{captionOpen ? "Show less" : "Show more"}</button>}
            </>
          )}
          <div className="hero-meta">
            {target!.permalink && <a href={target!.permalink} target="_blank" rel="noreferrer"><PlatformIcon />See on {target!.platform === "instagram" ? "Instagram" : "Facebook"}<ExternalLink /></a>}
            <Refreshed sync={sync} />
          </div>
          {headerExtra && <div className="hero-switch">{headerExtra}</div>}
        </div>
      </div>
      ) : null}

      <div className="panel-body" aria-busy={busyNow}>
      {busyNow && (
        <div className="busy-overlay" role="status" aria-live="polite">
          <div className="busy-card">
            <span className="spinner" aria-hidden />
            <strong>{busyTitle}</strong>
            {busyDetail && <span>{busyDetail}</span>}
            {!!sync.total && <div className="progress"><i style={{ width: `${(100 * (sync.loaded || 0)) / sync.total}%` }} /></div>}
          </div>
        </div>
      )}
      <div className="panel-content" inert={busyNow || undefined}>
      <div className="kpis" role="group" aria-label="Filter by category">
        {KPI.map((k) => {
          const n = counts[k.key];
          const share = counts.All ? Math.round((100 * n) / counts.All) : 0;
          return (
            <button key={k.key} className="kpi" aria-pressed={filter === k.key} onClick={() => setFilter(k.key)} style={{ ["--k" as any]: k.color }}
              title={k.key === "All" ? "Show all comments" : `Show only ${k.label.toLowerCase()} comments`}>
              <div className="kpi-label" title={k.key === "All" ? "Customer comments that are still visible on Instagram or Facebook. Hidden comments and the brand's own replies aren't counted." : undefined}><i />{k.label}</div>
              <div className="kpi-value">{comments ? n.toLocaleString("en-IN") : "–"}</div>
              <div className="kpi-sub">
                {k.key === "All" ? (progress ? "Categorising…" : "still visible") : comments ? `${share}%` : " "}
              </div>
              {k.key !== "All" && <span className="kpi-bar" style={{ width: `${share}%` }} />}
            </button>
          );
        })}
      </div>

      {progress && <div className="progress" aria-label="Categorising"><i style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 100}%` }} /></div>}

      {insight && (
        <div className={`callout${insight.tone === "danger" ? " danger" : ""}`}>
          <div className="callout-main">
            <div className="callout-tag">{insight.tag}</div>
            <div className="callout-title">{insight.title}</div>
          </div>
          {insight.button && <button className="btn btn-sm" onClick={insight.button.run}>{insight.button.label}</button>}
        </div>
      )}

      {/* Only when there's something to analyse: it needs at least 3 comments with text in this category. */}
      {aiBucket && aiComments.length >= 3 && <InsightsPanel bucket={aiBucket} comments={aiComments} context={aiContext} saveKey={aiKey} onJump={jumpTo} />}

      <div className="toolbar">
        <label className="search">
          <Search />
          <span className="sr">Search comments</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search comments…" />
        </label>
        {inbox && (
          <div className="seg" role="group" aria-label="Platform">
            <button aria-pressed={plat === "all"} onClick={() => setPlat("all")}>All</button>
            <button aria-pressed={plat === "instagram"} onClick={() => setPlat("instagram")}><Instagram />{platCounts.instagram.toLocaleString("en-IN")}</button>
            <button aria-pressed={plat === "facebook"} onClick={() => setPlat("facebook")}><Facebook />{platCounts.facebook.toLocaleString("en-IN")}</button>
          </div>
        )}
        <div className="seg" role="group" aria-label="Sort">
          <button aria-pressed={sort === "newest"} onClick={() => setSort("newest")}>Newest</button>
          <button aria-pressed={sort === "oldest"} onClick={() => setSort("oldest")}>Oldest</button>
        </div>
        <span className="spacer" />
        {filter === "Negative" && negativeTargets.length > 0 && !progress && (
          <button className="btn btn-sm btn-danger" onClick={() => { setHideAllResult(null); setHideAllOpen(true); }}>
            <EyeOff />Hide all negative ({fmtN(negativeTargets.length)})
          </button>
        )}
        <label className="toggle" title="Show the brand's own replies under the comments they answer">
          <input type="checkbox" checked={showBrand} onChange={(e) => setShowBrand(e.target.checked)} />
          <span className="track" />Brand replies
        </label>
        <MoreMenu>
          <button role="menuitem" data-close onClick={exportCsv} disabled={!exportable.length || !!progress || busyNow}
            title={progress ? "Wait until every comment is categorised" : undefined}>
            <Download />{progress ? "Download CSV (categorising…)" : `Download CSV (${fmtN(exportable.length)})`}
          </button>
          {hiddenCounts.All > 0 && (
            <button role="menuitemcheckbox" aria-checked={showHidden} onClick={() => setShowHidden((v) => !v)}>
              {showHidden ? <Check /> : <span className="mm-box" />}Show hidden comments ({fmtN(hiddenCounts.All)})
            </button>
          )}
        </MoreMenu>
      </div>

      {foreign.length > 0 && (
        <div className="translate-bar">
          <Languages />
          <span>{fmtN(foreign.length)} comment{foreign.length === 1 ? " is" : "s are"} in {foreignLangs.slice(0, 3).join(", ")}{foreignLangs.length > 3 ? " and more" : ""}. Translate for an accurate category.</span>
          <button className="btn btn-sm" disabled={translating} onClick={() => translateMany(foreign)}>
            <Languages />{translating ? "Translating…" : foreign.length === 1 ? "Translate" : `Translate all ${fmtN(foreign.length)}`}
          </button>
        </div>
      )}

      {/* Bulk selection is for clearing negatives and spam; everywhere else one comment = its Hide button. */}
      {filter === "Negative" && hideable.length > 0 && (
        <label className="select-all">
          <input type="checkbox" className="check" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(hideable.map((c) => c.id)))} />
          Select all {fmtN(hideable.length)}
        </label>
      )}

      {selectedHideable.length > 0 && (
        <div className="bulkbar" role="region" aria-label="Bulk actions">
          <strong>{fmtN(selectedHideable.length)} selected</strong>
          <span className="spacer" />
          <button className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())}>Clear</button>
          <button className="btn btn-sm btn-primary" onClick={() => hideWithUndo(selectedHideable)}><EyeOff />Hide {fmtN(selectedHideable.length)}</button>
        </div>
      )}

      {loadError && <div className="callout danger"><div className="callout-main"><div className="callout-tag">Couldn&apos;t load comments</div><div className="callout-body">{loadError}</div></div></div>}
      {(!comments || (comments.length === 0 && sync.phase === "loading")) && !loadError && <CommentSkeleton />}
      {comments && comments.length === 0 && sync.phase !== "loading" && (inbox
        ? <div className="card"><Empty icon={<Inbox />} title={`No comments ${inbox.phrase}`}>You&apos;re all caught up. Try a longer window if you expected more.</Empty></div>
        : <div className="card"><Empty icon={<MessageCircle />} title="No comments yet">When people comment on this {target?.kind === "ad" ? "ad" : "post"}, they&apos;ll appear here.</Empty></div>)}
      {comments && comments.length > 0 && visible.length === 0 && (
        <div className="card">{filter !== "All" && !query.trim()
          ? <Empty small icon={<MessageCircle />} title={`No ${filter === "Enquiry" ? "enquiries" : `${filter.toLowerCase()} comments`} here`}>{inbox ? `None ${inbox.phrase}.` : `None on this ${target?.kind === "ad" ? "ad" : "post"}.`}</Empty>
          : <Empty small icon={<Search />} title="Nothing matches">Try another search{filter !== "All" ? " or category" : ""}.</Empty>}</div>
      )}

      <Modal open={hideAllOpen} onClose={closeHideAll} busy={!!hideAllRun}
        title={hideAllResult ? "Done" : `Hide ${fmtN(hideAllCount)} negative ${hideAllCount === 1 ? "comment" : "comments"}?`}
        footer={hideAllResult ? (
          <>
            {hideAllResult.hidden.length > 0 && (
              <button className="btn" onClick={async () => { const ids = hideAllResult.hidden; closeHideAll(); await unhideMany(ids); }}>Undo, unhide {hideAllResult.hidden.length}</button>
            )}
            <button className="btn btn-primary" onClick={closeHideAll}>Close</button>
          </>
        ) : (
          <>
            <button className="btn" onClick={closeHideAll} disabled={!!hideAllRun}>Cancel</button>
            <button className="btn btn-primary" onClick={runHideAll} disabled={!!hideAllRun || hideAllCount === 0}>
              <EyeOff />{hideAllRun ? `Hiding ${fmtN(hideAllRun.done)} of ${fmtN(hideAllRun.total)}…` : `Hide ${fmtN(hideAllCount)}`}
            </button>
          </>
        )}>
        {hideAllResult ? (
          <>
            <div className="big-stat">
              <span className={`ok-icon${hideAllResult.hidden.length ? "" : " err"}`}>{hideAllResult.hidden.length ? <CheckCircle2 /> : <AlertTriangle />}</span>
              <div>
                <strong>{hideAllResult.hidden.length} {hideAllResult.hidden.length === 1 ? "comment" : "comments"} hidden</strong>
                {hideAllResult.hidden.length > 0 && <span className="fine-note">Meta confirmed each one after hiding.</span>}
              </div>
            </div>
            {hideAllResult.failed.length > 0 && (
              <>
                <div><strong style={{ color: "var(--negative)" }}>{hideAllResult.failed.length} couldn&apos;t be hidden</strong></div>
                <div className="result-list">
                  {hideAllResult.failed.map((f) => {
                    const c = comments?.find((x) => x.id === f.id);
                    return <div key={f.id}><b>{c?.author || "Comment"}</b><span>{f.error}</span></div>;
                  })}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <div className="breakdown">
              {negBreakdown.complaint > 0 && <span>{negBreakdown.complaint} complaint{negBreakdown.complaint === 1 ? "" : "s"}</span>}
              {negBreakdown.criticism > 0 && <span>{negBreakdown.criticism} criticism</span>}
              {negBreakdown.spam > 0 && <span>{negBreakdown.spam} spam</span>}
            </div>
            {negBreakdown.complaint > 0 && (
              <label className="checkrow">
                <input type="checkbox" className="check" checked={skipComplaints} onChange={(e) => setSkipComplaints(e.target.checked)} disabled={!!hideAllRun} />
                <span>Skip complaints
                  <small>Customers with an order problem can still see their own comment. Reply to them first, then hide.</small>
                </span>
              </label>
            )}
            <div className="fine-note">Comments are hidden in batches of 50 and each one is checked with Meta afterwards. Hidden comments stay visible to the person who wrote them and their friends. You can unhide them any time.</div>
            {hideAllRun && <div className="progress"><i style={{ width: `${(100 * hideAllRun.done) / hideAllRun.total}%` }} /></div>}
          </>
        )}
      </Modal>

      <div className="comments">
        {visible.map((c, i) => {
          const r = results[c.id];
          const isSel = selected.has(c.id);
          // Shown directly under the comment it answers (same thread): the post and the quote would only repeat it.
          const inThread = !!c.parentId && visible.slice(0, i).some((p) => p.id === c.parentId);
          return (
            <article key={c.id} data-cid={c.id} className={`comment${c.parentId ? " is-reply" : ""}${inThread ? " in-thread" : ""}${c.hidden ? " is-hidden" : ""}${c.isBrand ? " brand" : ""}${isSel ? " selected" : ""}${moving[c.id] ? " moving" : ""}`}>
              <div className="c-side">
                <span className="avatar">{c.isBrand ? <BadgeCheck size={15} /> : initials(c.author)}</span>
                {selecting && c.canHide && !c.hidden && (
                  <input type="checkbox" className="check" checked={isSel} onChange={() => toggleSel(c.id)} aria-label={`Select comment by ${c.author}`} />
                )}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="c-top">
                  {c.author ? <span className="c-author">{c.author}</span> : (
                    <span className="c-author anon" title={platOf(c) === "facebook"
                      ? "Meta didn't say who wrote this Facebook comment. This usually means the app hasn't passed Meta's App Review yet; until then Meta only names people who have a role on the app."
                      : "Meta didn't return a username for this comment."}>
                      {platOf(c) === "facebook" ? "Facebook user" : "Instagram user"}<Info />
                    </span>
                  )}
                  <span>{fmtDateTime(c.time)}</span>
                  {c.isBrand && <span className="tag tag-brand">Brand</span>}
                  {c.hidden && (verified.has(c.id)
                    ? <span className="tag tag-verified" title="Meta confirmed this comment is hidden from the public. The person who wrote it and their friends can still see it, and the Page's admins see it greyed out."><ShieldCheck />Hidden · confirmed</span>
                    : <span className="tag tag-hidden"><EyeOff />Hidden</span>)}
                  {moving[c.id] && <span className="moved-note"><ArrowRight />Moved to {moving[c.id]}</span>}
                  {!c.isBrand && replied.has(c.id) && <span className="tag tag-fixed"><CornerDownRight />Brand replied</span>}
                  {inThread && <span className="reply-mark"><CornerDownRight />Reply</span>}
                  {(c.alsoOn || 0) > 1 && <span className="tag" title="Meta returned this same comment through several ads (ads that share a post's engagement). It's shown and counted once.">On {c.alsoOn} ads</span>}
                </div>
                {c.src && !inThread && (
                  <button className="c-src" onClick={() => inbox?.onOpen?.(c.src!)} title="Open this post with all its comments">
                    {c.src.image ? <img src={c.src.image} alt="" loading="lazy" /> : <span className="c-src-ph">{c.src.kind === "ad" ? <Megaphone /> : <ImageIcon />}</span>}
                    {c.src.platform === "instagram" ? <Instagram /> : <Facebook />}
                    <span className="c-src-text">{c.src.kind === "ad" ? "Ad · " : ""}{c.src.caption || c.src.label}</span>
                    <ChevronRight />
                  </button>
                )}
                {c.parentId && c.parentText && !inThread && <div className="c-parent">Replying to: {c.parentText}</div>}
                <p className="c-text">{c.text || <em style={{ color: "var(--muted)" }}>Sticker or image</em>}</p>
                {translations[c.id] && <p className="c-translation"><Languages /><span><span className="tr-label">Translated from {translations[c.id].language || "another language"}:</span>{translations[c.id].english}</span></p>}
                {!c.isBrand && (
                  <div className="c-foot">
                    {r && r.category !== "Unclassified" ? (
                      <span className={`cat-chip cat-${r.category}`}>{CHOICES.find(([v]) => v === labelOf(r))?.[1] || r.category}</span>
                    ) : c.text.trim() ? <span className="skel cat-pending" aria-label="Categorising" /> : null}
                    {r?.score != null && <span className="score" title="How sure the app is about this category">{Math.round(r.score * 100)}%</span>}
                    {translateOn && !translations[c.id] && foreignLanguage(c.text) && (
                      <button className="linkish translate" disabled={translating} onClick={() => translateMany([c])}>
                        <Languages />{foreignLanguage(c.text)} · Translate
                      </button>
                    )}
                    <span className="c-actions">
                      <button className="btn btn-sm btn-ghost" onClick={() => setReplyingTo(replyingTo === c.id ? null : c.id)} aria-expanded={replyingTo === c.id}><Reply />Reply</button>
                      {c.canHide ? (
                        c.hidden ? (
                          <button className="btn btn-sm" disabled={!!busy[c.id]} onClick={() => unhide(c)}><Eye />{busy[c.id] ? "…" : "Unhide"}</button>
                        ) : (
                          <button className={`btn btn-sm${r?.category === "Negative" ? " btn-danger" : " btn-ghost"}`} disabled={!!busy[c.id]} onClick={() => hideWithUndo([c.id])}><EyeOff />{busy[c.id] ? "…" : "Hide"}</button>
                        )
                      ) : (
                        <span className="c-reason" title="Meta doesn't allow hiding this comment">Can&apos;t be hidden</span>
                      )}
                    </span>
                  </div>
                )}
                {sent[c.id] && <div className="sent-reply"><b>You replied</b>{sent[c.id]}</div>}
                {replyingTo === c.id && !c.isBrand && (
                  <ReplyBox to={c.author ? (platOf(c) === "instagram" ? `@${c.author}` : c.author) : platOf(c) === "facebook" ? "this Facebook user" : "this comment"}
                    platform={platOf(c)} asName={brandName(c)} max={platOf(c) === "instagram" ? 2200 : 8000}
                    suggestions={suggestionsFor(learned, r ? labelOf(r) : null)}
                    negative={r?.category === "Negative" && c.canHide && !c.hidden} busy={sending}
                    onSend={(t, hide) => sendReply(c, t, hide)} onCancel={() => setReplyingTo(null)} />
                )}
              </div>
            </article>
          );
        })}
      </div>
      </div>
      </div>
    </div>
  );
}

/** The only status shown: when the comments were last refreshed (or that a refresh is running / failed). */
function Refreshed({ sync }: { sync: Sync }) {
  const live = sync.phase === "loading" || sync.phase === "checking" || sync.phase === "updating";
  const at = sync.checkedAt || sync.cachedAt;
  const when = at ? new Date(at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
  const text = live ? "Refreshing…" : sync.phase === "error" ? `Couldn't refresh. Showing comments from ${when || "earlier"}.` : when ? `Refreshed ${when}` : "";
  if (!text) return null;
  return <span className={`sync${live ? " live" : ""}${sync.phase === "error" ? " err" : ""}`}>{text}</span>;
}

/** The ⋯ menu above the comments: Download CSV and the show/hide options. Closes on click outside or Esc. */
function MoreMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="more" ref={ref}>
      <button className="btn btn-sm btn-ghost btn-icon" aria-label="More options" aria-haspopup="menu" aria-expanded={open} title="More options" onClick={() => setOpen((o) => !o)}>
        <MoreHorizontal />
      </button>
      {open && (
        <div className="more-menu" role="menu" onClick={(e) => { if ((e.target as HTMLElement).closest("[data-close]")) setOpen(false); }}>
          {children}
        </div>
      )}
    </div>
  );
}
