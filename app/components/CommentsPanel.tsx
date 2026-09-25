"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Instagram, Facebook, ExternalLink, Search, EyeOff, Eye, ChevronDown, CornerDownRight, ImageIcon, MessageCircle, BadgeCheck, Megaphone, ShieldCheck, ArrowRight, AlertTriangle, CheckCircle2, Inbox, ChevronRight, Info } from "lucide-react";
import { api, fmtDateTime } from "./api";
import { cacheGet, cacheSet, ago } from "./cache";
import { useToast, Empty, CommentSkeleton, initials, Modal } from "./ui";
import { logEvent } from "./log";

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
};
type InboxTarget = Src & { count: number };
export type InboxSpec = {
  key: string; cacheKey: string; scope: string; noun?: "post" | "ad"; targetsUrl: string;
  /** The window being shown, in milliseconds. */
  sinceMs: number; untilMs: number;
  /** "last 7 days" or "12 Sept – 20 Sept", and the same as a phrase: "in the last 7 days" / "between 12 Sept and 20 Sept". */
  label: string; phrase: string;
  refresh: number; onOpen?: (src: Src) => void; onFetched?: () => void;
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
};
type InboxCache = { byObj: Record<string, Comment[]>; counts: Record<string, number>; since: number; results: Record<string, Result> };
type PostCache = { count: number | null; comments: Comment[]; results: Record<string, Result> };

// When each view last checked Meta, for this browser tab. Switching views or tabs within 2 minutes reuses the
// result instead of asking Meta again; Refresh always asks.
const RECHECK_MS = 2 * 60 * 1000;
const lastChecked = new Map<string, { at: number; sync: Sync }>();

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
type Result = { category: Category; negative_type: string | null; needs_review: boolean; reason: string; label?: string };
type Filter = "All" | "Enquiry" | "Positive" | "Negative" | "Review";

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
  { key: "All", label: "All", color: "var(--violet)" },
  { key: "Enquiry", label: "Enquiry", color: "var(--enquiry)" },
  { key: "Positive", label: "Positive", color: "var(--positive)" },
  { key: "Negative", label: "Negative", color: "var(--negative)" },
  { key: "Review", label: "To review", color: "var(--warn)" },
];

const CHUNK = 100;

type HideResult = { id: string; ok: boolean; verified: boolean; hidden: boolean; error?: string };
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
  const [warnedNotSaved, setWarnedNotSaved] = useState(false);
  const [verified, setVerified] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState<Record<string, string>>({});
  const movingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Hide-all dialog
  const [hideAllOpen, setHideAllOpen] = useState(false);
  const [skipComplaints, setSkipComplaints] = useState(false);
  const [hideAllRun, setHideAllRun] = useState<{ done: number; total: number } | null>(null);
  const [hideAllResult, setHideAllResult] = useState<{ hidden: string[]; failed: HideResult[] } | null>(null);

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
        cacheSet(cacheKey, { byObj: grouped, counts: objCounts.current, since: cachedSince.current, results } satisfies InboxCache);
      } else {
        // An incomplete copy is saved without Meta's count, so the next open fetches again instead of trusting it.
        cacheSet(cacheKey, { count: incomplete.current ? null : target?.count ?? null, comments: list, results } satisfies PostCache);
      }
    }, 600);
  }

  const flat = () => Object.values(byObj.current).flat().sort((a, b) => Date.parse(b.time) - Date.parse(a.time));

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
        const recent = lastChecked.get(spec.key);
        if (!full && recent && Date.now() - recent.at < RECHECK_MS && cachedSince.current <= spec.sinceMs + 60_000) {
          setSync({ ...recent.sync, cachedAt: c.at });
          categorise(flat());
          return;
        }
        setSync({ phase: "checking", cachedAt: c.at });
      }
    }
    if (!first || !hadCache) setSync((s) => ({ ...s, phase: hadCache ? "checking" : "loading" }));
    try {
      const { targets, stats } = await api<{ targets: InboxTarget[]; stats?: Sync["stats"] }>(spec.targetsUrl);
      const byId = new Map(targets.map((t) => [t.objectId, t]));
      for (const k of Object.keys(byObj.current)) if (!byId.has(k)) delete byObj.current[k];
      const needLonger = cachedSince.current > spec.sinceMs + 60_000;
      const changed = targets.filter((t) => full || needLonger || objCounts.current[t.objectId] !== t.count || !byObj.current[t.objectId]);
      const base = { checked: targets.length, checkedAt: Date.now(), stats };
      if (stats?.ig?.unreadable) logEvent({ level: "warn", area: "instagram ads", message: `${stats.ig.unreadable} Instagram ad posts couldn't be read (${stats.ig.reason || "unknown reason"})`, details: { mediaIds: stats.ig.unreadableIds, meta: stats.ig.error } });
      if (stats?.fb?.unreadable) logEvent({ level: "warn", area: "facebook ads", message: `${stats.fb.unreadable} Facebook ad posts couldn't be read (${stats.fb.reason || "unknown reason"})`, details: { postIds: stats.fb.unreadableIds } });
      if (stats?.fb?.missingPages?.length) logEvent({ level: "warn", area: "facebook ads", message: `${stats.fb.notConnected} Facebook ad posts are on Pages this login can't open`, details: { pages: stats.fb.missingPages } });
      if (!changed.length) {
        // Nothing needed fetching, so the saved copy covers the whole window.
        if (full || needLonger) cachedSince.current = spec.sinceMs;
        setComments(flat());
        setSync((s) => {
          const n: Sync = { ...s, ...base, phase: "ready", changed: 0, withNew: Object.values(byObj.current).filter((l) => l.length).length };
          lastChecked.set(spec.key, { at: Date.now(), sync: n });
          return n;
        });
        categorise(flat());
        spec.onFetched?.();
        persistSoon();
        return;
      }
      let loaded = 0, failed = 0, skipped = 0;
      const withheld = { instagram: 0, facebook: 0 };
      const failReasons = new Set<string>();
      setSync((s) => ({ ...s, ...base, phase: hadCache ? "updating" : "loading", total: changed.length, loaded: 0 }));
      if (!hadCache) setComments([]);
      await readStream("/api/inbox/comments", { targets: changed, since: Math.min(spec.sinceMs, needLonger || full ? spec.sinceMs : cachedSince.current), until: Date.now() }, (m) => {
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
          byObj.current[m.objectId] = [];
          objCounts.current[m.objectId] = -1; // not a real count, so the next check tries again
          logEvent({ level: "error", area: `${t.platform} comments`, message: `Meta reports ${m.reported} comments on a ${t.platform === "facebook" ? "Facebook" : "Instagram"} ${t.kind} but returned none`, details: { objectId: t.objectId, pageId: t.pageId || undefined, ad: t.label, diagnose: `/api/diagnose/comments?platform=${t.platform}&objectId=${t.objectId}` } });
        } else if (m.type === "failed") {
          failed++; loaded++;
          if (m.reason) failReasons.add(m.reason);
          const t = byId.get(m.objectId);
          logEvent({ level: "error", area: `${m.platform || t?.platform || ""} comments`, message: `Couldn't load comments (${m.reason || "error"})`, details: { objectId: m.objectId, ad: t?.label, meta: m.error } });
        }
        else if (m.type === "skipped") { skipped++; loaded++; }
        if (m.type !== "done") setSync((s) => ({ ...s, loaded, failed, skipped }));
      });
      if (full || needLonger) cachedSince.current = spec.sinceMs;
      setSync((s) => {
        const n: Sync = { ...s, phase: "ready", changed: changed.length - failed - skipped - withheld.instagram - withheld.facebook, failed, skipped, withheld, failReasons: [...failReasons], checkedAt: Date.now(), withNew: Object.values(byObj.current).filter((l) => l.length).length };
        lastChecked.set(spec.key, { at: Date.now(), sync: n });
        return n;
      });
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
        setComments(c.value.comments);
        // Reuse the saved copy only if Meta's count hasn't moved AND the copy isn't suspiciously short.
        const same = t.count != null && c.value.count === t.count && !looksIncomplete(c.value.comments.length, t.count);
        setSync({ phase: same ? "ready" : "checking", cachedAt: c.at, checkedAt: same ? c.at : undefined, changed: 0 });
        if (same) { categorise(c.value.comments); return; }
      }
    }
    setSync((s) => ({ ...s, phase: hadCache || commentsRef.current ? "checking" : "loading" }));
    try {
      const d = await api<{ comments: Comment[] }>(`/api/comments?${new URLSearchParams({ platform: t.platform, objectId: t.objectId, pageId: t.pageId, brandUsername: t.brandUsername })}`);
      setComments(d.comments);
      commentsRef.current = d.comments;
      const gap = looksIncomplete(d.comments.length, t.count) ? { reported: t.count!, got: d.comments.length } : undefined;
      incomplete.current = !!gap;
      if (gap) logEvent({ level: "error", area: `${t.platform} comments`, message: `Meta reports ${gap.reported} comments on this ${t.kind || "post"} but returned ${gap.got}`, details: { objectId: t.objectId, pageId: t.pageId || undefined, title: t.title, diagnose: `/api/diagnose/comments?platform=${t.platform}&objectId=${t.objectId}` } });
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

  // When "last 24 hours" etc. moves forward (tab returned after a while), check for new comments.
  const lastSince = useRef(inbox?.sinceMs);
  useEffect(() => {
    if (!inbox || lastSince.current === undefined) return;
    if (Math.abs(inbox.sinceMs - lastSince.current) > 60_000) { lastSince.current = inbox.sinceMs; runInbox(false, false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inbox?.sinceMs]);

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

  const resultFor = (label: string): Result => ({
    category: label === "Enquiry" || label === "Positive" ? (label as Category) : "Negative",
    negative_type: label === "Complaint" ? "complaint" : label === "Spam" ? "spam" : label === "Negative" ? "criticism" : null,
    needs_review: false, reason: "Corrected by your team", label,
  });

  /** Changes a comment's category straight away, saves it in the background, and puts it back if saving fails. */
  async function correct(c: Comment, label: string) {
    const same = (x: Comment) => x.text.trim().toLowerCase() === c.text.trim().toLowerCase();
    const ids = (comments || []).filter(same).map((x) => x.id);
    const before = Object.fromEntries(ids.map((id) => [id, results[id]]));
    const next = resultFor(label);
    setResults((r) => ({ ...r, ...Object.fromEntries(ids.map((id) => [id, next])) }));
    resultsRef.current = { ...resultsRef.current, ...Object.fromEntries(ids.map((id) => [id, next])) };
    persistSoon();

    const name = CHOICES.find(([v]) => v === label)?.[1] || label;
    const newCat = next.category;
    const leaves = filter !== "All" && filter !== "Review" && newCat !== filter;
    if (leaves) {
      // Keep it on screen briefly so the person sees where it went, then let it leave this view.
      clearTimeout(movingTimers.current[c.id]);
      setMoving((m) => ({ ...m, [c.id]: newCat }));
      movingTimers.current[c.id] = setTimeout(() => setMoving((m) => { const n = { ...m }; delete n[c.id]; return n; }), 1600);
    }
    toast({ kind: "ok", msg: `Moved to ${name}.`, action: leaves ? { label: `View ${newCat}`, run: () => setFilter(newCat as Filter) } : undefined });

    try {
      const d = await api<{ persistent: boolean }>("/api/label", { method: "POST", body: JSON.stringify({ text: c.text, label }) });
      if (!d.persistent && !warnedNotSaved) {
        setWarnedNotSaved(true);
        toast({ kind: "err", msg: "Corrections aren't stored permanently yet: add Upstash Redis in Vercel (see README)." });
      }
    } catch (e: any) {
      setResults((r) => ({ ...r, ...before }));
      setMoving((m) => { const n = { ...m }; delete n[c.id]; return n; });
      toast({ kind: "err", msg: `Couldn't save the correction, so it was put back: ${e.message}` });
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
    const c = { All: customer.length, Enquiry: 0, Positive: 0, Negative: 0, Review: 0 };
    for (const x of customer) {
      const r = results[x.id];
      if (r && r.category !== "Unclassified") c[r.category]++;
      if (r?.needs_review) c.Review++;
    }
    return c;
  }, [customer, results]);
  const hiddenCounts = useMemo(() => {
    const c = { All: 0, Enquiry: 0, Positive: 0, Negative: 0, Review: 0 };
    for (const x of allCustomer) {
      if (!x.hidden) continue;
      c.All++;
      const r = results[x.id];
      if (r && r.category !== "Unclassified") c[r.category]++;
    }
    return c;
  }, [allCustomer, results]);

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
    return s;
  }, [comments]);

  const insight = useMemo(() => {
    if (progress || !customer.length) return null;
    const visible = customer;
    const complaints = visible.filter((c) => results[c.id]?.negative_type === "complaint");
    const openEnq = visible.filter((c) => results[c.id]?.category === "Enquiry" && !c.parentId && !replied.has(c.id));
    const spam = visible.filter((c) => results[c.id]?.negative_type === "spam" && c.canHide);
    if (complaints.length) return {
      tone: "danger", tag: "Needs attention",
      title: `${complaints.length} ${complaints.length === 1 ? "customer has" : "customers have"} an order or product problem`,
      body: "Hiding a complaint doesn't remove it for the customer: they and their friends can still see it.",
      action: "→ Reply or send a DM first, then hide if it's still public.",
      button: { label: "Show negatives", run: () => setFilter("Negative") },
    };
    if (spam.length) return {
      tone: "info", tag: "Info",
      title: `${spam.length} spam ${spam.length === 1 ? "comment" : "comments"} can be hidden`,
      body: "Promotions, scams and bots make real questions harder to find.",
      action: "→ Review and hide them in one go.",
      button: { label: "Select spam", run: () => { setFilter("Negative"); setSelected(new Set(spam.map((c) => c.id))); } },
    };
    if (openEnq.length) return {
      tone: "info", tag: "Info",
      title: `${openEnq.length} ${openEnq.length === 1 ? "enquiry has" : "enquiries have"} no reply from the brand`,
      body: "People asking about price, sizes or delivery are the closest to buying.",
      action: "→ Reply while interest is fresh.",
      button: { label: "Show enquiries", run: () => setFilter("Enquiry") },
    };
    return {
      tone: "info", tag: "Info", title: inbox ? `Nothing needs action ${inbox.phrase}` : "Nothing needs action on this post",
      body: "No complaints, spam or unanswered enquiries.", action: "", button: null,
    };
  }, [customer, results, replied, progress]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (comments || []).filter((c) => {
      if (!inWin(c)) return false;
      if (c.isBrand) return showBrand && filter === "All" && !q;
      if (c.hidden && !showHidden) return false;
      if (q && !c.text.toLowerCase().includes(q) && !c.author.toLowerCase().includes(q)) return false;
      if (filter === "All") return true;
      if (moving[c.id]) return true;
      const r = results[c.id];
      if (filter === "Review") return !!r?.needs_review;
      return r?.category === filter;
    });
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

  // Fetching overlay: whenever the app is talking to Meta (checking or loading), the list is dimmed and can't be acted
  // on, and a card in the middle says what's happening. Views checked in the last 2 minutes aren't re-checked at all.
  const busyNow = sync.phase === "updating" || sync.phase === "loading" || sync.phase === "checking";
  const nounOf = inbox?.noun || "post";
  const busyTitle = sync.phase === "checking" ? "Checking Meta for new comments…" : "Fetching comments from Meta…";
  const busyDetail = sync.phase === "checking"
    ? (sync.cachedAt ? `Saved copy from ${ago(sync.cachedAt)} shown underneath` : "This takes a few seconds")
    : sync.total ? `${sync.loaded || 0} of ${sync.total} ${nounOf}${sync.total === 1 ? "" : "s"} done` : "Almost there";

  const PlatformIcon = target?.platform === "instagram" ? Instagram : Facebook;
  const windowLabel = inbox ? inbox.label : "";
  const fmtRange = (ms: number) => new Date(ms).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  return (
    <div>
      {inbox ? (
        <div className="card post-hero inbox-hero">
          <span className="thumb inbox-icon"><Inbox /></span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2>All comments · {windowLabel}</h2>
            <div className="caption">{inbox.scope}</div>
            <div className="range-line">Showing comments from <b>{fmtRange(inbox.sinceMs)}</b> to <b>{inbox.untilMs >= Date.now() - 120_000 ? "now" : fmtRange(inbox.untilMs)}</b></div>
            <div className="hero-meta">
              <SyncLine sync={sync} noun={inbox.noun || "post"} />
            </div>
            <LimitNotes sync={sync} noun={inbox.noun || "post"} />
          </div>
        </div>
      ) : target ? (
      <div className="card post-hero">
        {target!.image ? <img className="thumb" src={target!.image} alt="" /> : <span className="thumb">{target!.kind === "ad" ? <Megaphone /> : <ImageIcon />}</span>}
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2>{target!.title}</h2>
          {target!.caption && (
            <>
              <div className={`caption${captionOpen ? " open" : ""}`}>{target!.caption}</div>
              {target!.caption.length > 140 && <button className="linkish" onClick={() => setCaptionOpen((o) => !o)}>{captionOpen ? "Show less" : "Show more"}</button>}
            </>
          )}
          <div className="hero-meta">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><PlatformIcon />{target!.platform === "instagram" ? "Instagram" : "Facebook"}{target!.kind === "ad" ? " ad" : " post"}</span>
            {target!.permalink && <a href={target!.permalink} target="_blank" rel="noreferrer">Open on {target!.platform === "instagram" ? "Instagram" : "Facebook"}<ExternalLink /></a>}
            <SyncLine sync={sync} noun="post" single />
          </div>
          {sync.gap && (
            <div className="limit-notes">
              <div className="limit-note"><Info />
                <span>Meta reports {sync.gap.reported} comments on this {target!.kind === "ad" ? "ad" : "post"}, but only {sync.gap.got} came back.{" "}
                  <a href={`/api/diagnose/comments?${new URLSearchParams({ platform: target!.platform, objectId: target!.objectId, pageId: target!.pageId })}`} target="_blank" rel="noreferrer">See what Meta returned</a>
                </span>
              </div>
            </div>
          )}
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
            <span>{busyDetail}</span>
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
            <button key={k.key} className="kpi" aria-pressed={filter === k.key} onClick={() => setFilter(k.key)} style={{ ["--k" as any]: k.color }}>
              <div className="kpi-label"><i />{k.label}</div>
              <div className="kpi-value">{comments ? n : "–"}</div>
              <div className="kpi-sub">
                {k.key === "All" ? (progress ? "Categorising…" : "open comments") : comments ? `${share}%` : " "}
                {k.key !== "Review" && hiddenCounts[k.key] > 0 && <span className="hid"> · {hiddenCounts[k.key]} hidden</span>}
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
            <div className="callout-body">
              {insight.body}
              {insight.action && <div className="action">{insight.action}</div>}
            </div>
          </div>
          {insight.button && <button className="btn btn-sm" onClick={insight.button.run}>{insight.button.label}</button>}
        </div>
      )}

      <div className="toolbar">
        <label className="search">
          <Search />
          <span className="sr">Search comments</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search comments…" />
        </label>
        {inbox && (
          <div className="seg" role="group" aria-label="Platform">
            <button aria-pressed={plat === "all"} onClick={() => setPlat("all")}>All</button>
            <button aria-pressed={plat === "instagram"} onClick={() => setPlat("instagram")}><Instagram />{platCounts.instagram}</button>
            <button aria-pressed={plat === "facebook"} onClick={() => setPlat("facebook")}><Facebook />{platCounts.facebook}</button>
          </div>
        )}
        <div className="seg" role="group" aria-label="Sort">
          <button aria-pressed={sort === "newest"} onClick={() => setSort("newest")}>Newest</button>
          <button aria-pressed={sort === "oldest"} onClick={() => setSort("oldest")}>Oldest</button>
        </div>
        <span className="spacer" />
        {negativeTargets.length > 0 && !progress && (
          <button className="btn btn-sm btn-danger" onClick={() => { setHideAllResult(null); setHideAllOpen(true); }}>
            <EyeOff />Hide all negative ({negativeTargets.length})
          </button>
        )}
        {hiddenCounts.All > 0 && (
          <label className="toggle" title="Comments already hidden on Instagram or Facebook">
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
            <span className="track" />Hidden ({hiddenCounts.All})
          </label>
        )}
        <label className="toggle">
          <input type="checkbox" checked={showBrand} onChange={(e) => setShowBrand(e.target.checked)} />
          <span className="track" />Brand replies
        </label>
        {hideable.length > 0 && (
          <label className="toggle" title="Select every comment that can be hidden in this view">
            <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(hideable.map((c) => c.id)))} />
            <span className="track" />Select all
          </label>
        )}
      </div>

      {selectedHideable.length > 0 && (
        <div className="bulkbar" role="region" aria-label="Bulk actions">
          <strong>{selectedHideable.length} selected</strong>
          <span className="spacer" />
          <button className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())}>Clear</button>
          <button className="btn btn-sm btn-primary" onClick={() => hideWithUndo(selectedHideable)}><EyeOff />Hide {selectedHideable.length}</button>
        </div>
      )}

      {loadError && <div className="callout danger"><div className="callout-main"><div className="callout-tag">Couldn&apos;t load comments</div><div className="callout-body">{loadError}</div></div></div>}
      {(!comments || (comments.length === 0 && sync.phase === "loading")) && !loadError && <CommentSkeleton />}
      {comments && comments.length === 0 && sync.phase !== "loading" && (inbox
        ? <div className="card"><Empty icon={<Inbox />} title={`No comments ${inbox.phrase}`}>You&apos;re all caught up. Try a longer window if you expected more.</Empty></div>
        : <div className="card"><Empty icon={<MessageCircle />} title="No comments yet">When people comment on this {target?.kind === "ad" ? "ad" : "post"}, they&apos;ll appear here.</Empty></div>)}
      {comments && comments.length > 0 && visible.length === 0 && (
        <div className="card"><Empty small icon={<Search />} title="Nothing matches">Try another filter or search.</Empty></div>
      )}

      <Modal open={hideAllOpen} onClose={closeHideAll} busy={!!hideAllRun}
        title={hideAllResult ? "Done" : `Hide ${hideAllCount} negative ${hideAllCount === 1 ? "comment" : "comments"}?`}
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
              <EyeOff />{hideAllRun ? `Hiding ${hideAllRun.done} of ${hideAllRun.total}…` : `Hide ${hideAllCount}`}
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
        {visible.map((c) => {
          const r = results[c.id];
          const isSel = selected.has(c.id);
          return (
            <article key={c.id} className={`comment${c.parentId ? " is-reply" : ""}${c.hidden ? " is-hidden" : ""}${c.isBrand ? " brand" : ""}${isSel ? " selected" : ""}${moving[c.id] ? " moving" : ""}`}>
              <div className="c-side">
                <span className="avatar">{c.isBrand ? <BadgeCheck size={15} /> : initials(c.author)}</span>
                {c.canHide && !c.hidden && (
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
                    ? <span className="tag tag-verified" title="Meta confirmed this comment is hidden"><ShieldCheck />Hidden · confirmed</span>
                    : <span className="tag tag-hidden"><EyeOff />Hidden</span>)}
                  {moving[c.id] && <span className="moved-note"><ArrowRight />Moved to {moving[c.id]}</span>}
                  {!c.isBrand && replied.has(c.id) && <span className="tag tag-fixed"><CornerDownRight />Brand replied</span>}
                </div>
                {c.src && (
                  <button className="c-src" onClick={() => inbox?.onOpen?.(c.src!)} title="Open this post with all its comments">
                    {c.src.image ? <img src={c.src.image} alt="" loading="lazy" /> : <span className="c-src-ph">{c.src.kind === "ad" ? <Megaphone /> : <ImageIcon />}</span>}
                    {c.src.platform === "instagram" ? <Instagram /> : <Facebook />}
                    <span className="c-src-text">{c.src.kind === "ad" ? "Ad · " : ""}{c.src.caption || c.src.label}</span>
                    <ChevronRight />
                  </button>
                )}
                {c.parentId && c.parentText && <div className="c-parent">Replying to: {c.parentText}</div>}
                <p className="c-text">{c.text || <em style={{ color: "var(--muted)" }}>Sticker or image</em>}</p>
                {!c.isBrand && (
                  <div className="c-foot">
                    {r && r.category !== "Unclassified" ? (
                      <span className={`catsel cat-${r.category}`}>
                        <select aria-label="Category (change to correct it)" title="Wrong? Change it and Comment Pulse learns from it"
                          value={labelOf(r)} disabled={!!busy[`fix:${c.id}`]} onChange={(e) => correct(c, e.target.value)}>
                          {CHOICES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                        </select>
                        <ChevronDown />
                      </span>
                    ) : c.text.trim() ? <span className="skel cat-pending" aria-label="Categorising" /> : null}
                    {r?.needs_review && <span className="tag tag-review">Needs review</span>}
                    <span className="c-reason">{r?.reason}</span>
                    <span className="c-actions">
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

/** Warns when the inbox had to stop early, or couldn't read some posts or ads. */
function LimitNotes({ sync, noun }: { sync: Sync; noun: string }) {
  const s = sync.stats;
  if (!s || sync.phase !== "ready") return null;
  const notes: string[] = [];
  if (s.capped) notes.push(`${s.withComments} ${noun}s have comments, more than can be read at once: only ${sync.checked} were read${noun === "post" ? " (those with the most comments)" : " (active ads first)"}. Narrow the time window${noun === "ad" ? " or switch to Active only" : ""} to cover the rest.`);
  if (s.ig && s.ig.partner) notes.push(`${s.ig.partner} Instagram ad post${s.ig.partner === 1 ? " is" : "s are"} on a creator's account (partnership ads), so Meta doesn't let the brand read ${s.ig.partner === 1 ? "its" : "their"} comments.`);
  if (s.ig && s.ig.unreadable) notes.push(`${s.ig.unreadable} Instagram ad post${s.ig.unreadable === 1 ? "" : "s"} couldn't be read due to ${s.ig.reason || "an error from Meta"}. Details in the Activity log.`);
  if (s.fb && s.fb.unreadable) notes.push(`${s.fb.unreadable} Facebook ad post${s.fb.unreadable === 1 ? "" : "s"} couldn't be read due to ${s.fb.reason || "an error from Meta"}. Details in the Activity log.`);
  if (s.fb && s.fb.notConnected) {
    const pages = (s.fb.missingPages || []).map((p) => (p.name ? `${p.name} (Page ID ${p.id})` : `Page ID ${p.id}`)).join(", ");
    notes.push(`${s.fb.notConnected} Facebook ad post${s.fb.notConnected === 1 ? " is" : "s are"} on ${(s.fb.missingPages?.length || 1) === 1 ? "a Page" : "Pages"} this login can't open${pages ? `: ${pages}` : ""}. Get access to ${(s.fb.missingPages?.length || 1) === 1 ? "that Page" : "those Pages"}, then reconnect and tick ${(s.fb.missingPages?.length || 1) === 1 ? "it" : "them"}.`);
  }
  const w = sync.withheld;
  if (w?.facebook) notes.push(`Meta counts comments on ${w.facebook} Facebook ad post${w.facebook === 1 ? "" : "s"} but returned none. This usually means this login's role on the Page doesn't include reading comments. Details in the Activity log.`);
  if (w?.instagram) notes.push(`Meta counts comments on ${w.instagram} Instagram post${w.instagram === 1 ? "" : "s"} but returned none. Details in the Activity log.`);
  if (sync.failed) notes.push(`${sync.failed} ${noun}${sync.failed === 1 ? "" : "s"} couldn't be loaded${sync.failReasons?.length ? ` due to ${sync.failReasons.join(", ")}` : ""}. Details in the Activity log.`);
  if (sync.skipped) notes.push(`${sync.skipped} ${noun}${sync.skipped === 1 ? " was" : "s were"} skipped to stay within the time limit. Press refresh to load ${sync.skipped === 1 ? "it" : "them"}.`);
  // A plain statement of what was covered, so "are Instagram ads included?" never needs guessing.
  const coverage = s.ig && s.fb
    ? `Checked ${s.checked} ads: ${s.ig.included} Instagram and ${s.fb.included} Facebook ad post${s.fb.included === 1 ? "" : "s"} have comments${(w?.instagram || w?.facebook) ? `, of which Meta withheld ${[w?.instagram ? `${w.instagram} Instagram` : "", w?.facebook ? `${w.facebook} Facebook` : ""].filter(Boolean).join(" and ")}` : ""}.`
    : "";
  if (!notes.length && !coverage) return null;
  return (
    <div className="limit-notes">
      {coverage && <div className="coverage-note">{coverage}</div>}
      {notes.map((n) => <div key={n} className="limit-note"><Info />{n}</div>)}
    </div>
  );
}

/** One line saying how fresh the data is: saved copy, checking, updating, or up to date. */
function SyncLine({ sync, noun, single }: { sync: Sync; noun: string; single?: boolean }) {
  const plural = (n: number) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  const time = sync.checkedAt ? new Date(sync.checkedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }).toLowerCase() : "";
  let text = "";
  if (sync.phase === "loading") text = single ? "Loading comments…" : sync.total ? `Loading comments from ${sync.loaded || 0} of ${plural(sync.total)}…` : `Checking every ${noun} for new comments…`;
  else if (sync.phase === "checking") text = `Showing saved comments from ${ago(sync.cachedAt || Date.now())} · checking for new ones…`;
  else if (sync.phase === "updating") text = `Updating ${sync.loaded || 0} of ${plural(sync.total || 0)} with new comments…`;
  else if (sync.phase === "error") text = `Showing saved comments · couldn't check for new ones`;
  else if (single) text = sync.changed ? `Up to date · fetched ${time}` : `Up to date · saved ${ago(sync.cachedAt || Date.now())}, no new comments`;
  else text = `${sync.changed ? `Updated ${plural(Math.max(0, sync.changed))} with new comments` : "Up to date, nothing new"} · checked ${plural(sync.stats?.checked ?? sync.checked ?? 0)} at ${time}`
    + (sync.skipped ? ` · ${sync.skipped} skipped to stay fast` : "") + (sync.failed ? ` · ${sync.failed} couldn't be read` : "");
  const live = sync.phase === "loading" || sync.phase === "checking" || sync.phase === "updating";
  return <span className={`sync${live ? " live" : ""}${sync.phase === "error" ? " err" : ""}`}>{text}</span>;
}
