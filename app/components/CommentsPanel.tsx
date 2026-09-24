"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Instagram, Facebook, ExternalLink, Search, EyeOff, Eye, ChevronDown, CornerDownRight, ImageIcon, MessageCircle, BadgeCheck, Megaphone, ShieldCheck, ArrowRight, AlertTriangle, CheckCircle2 } from "lucide-react";
import { api, fmtDateTime } from "./api";
import { useToast, Empty, CommentSkeleton, initials, Modal } from "./ui";

export type Target = {
  key: string; platform: "instagram" | "facebook"; objectId: string; pageId: string;
  brandUsername: string; title: string; caption: string; permalink: string; image?: string; kind?: "post" | "ad";
};
type Comment = {
  id: string; text: string; time: string; author: string; hidden: boolean; canHide: boolean;
  parentId: string | null; parentText: string | null; isBrand: boolean;
};
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

export default function CommentsPanel({ target, headerExtra }: { target: Target; headerExtra?: ReactNode }) {
  const toast = useToast();
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [filter, setFilter] = useState<Filter>("All");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [showBrand, setShowBrand] = useState(false);
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

  async function categorise(list: Comment[]) {
    const todo = list.filter((c) => !c.isBrand && c.text.trim());
    setProgress({ done: 0, total: todo.length });
    for (let i = 0; i < todo.length; i += CHUNK) {
      const chunk = todo.slice(i, i + CHUNK);
      try {
        const d = await api<{ results: Record<string, Result> }>("/api/classify", {
          method: "POST",
          body: JSON.stringify({ caption: target.caption, comments: chunk.map((c) => ({ id: c.id, text: c.text, parentText: c.parentText })) }),
        });
        setResults((r) => ({ ...r, ...d.results }));
      } catch (e: any) {
        toast({ kind: "err", msg: `Couldn't categorise some comments: ${e.message}` });
      }
      setProgress({ done: Math.min(i + CHUNK, todo.length), total: todo.length });
    }
    setProgress(null);
  }

  useEffect(() => {
    const qs = new URLSearchParams({ platform: target.platform, objectId: target.objectId, pageId: target.pageId, brandUsername: target.brandUsername });
    api<{ comments: Comment[] }>(`/api/comments?${qs}`)
      .then((d) => { setComments(d.comments); return categorise(d.comments); })
      .catch((e) => setLoadError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.key]);

  /** Hides or unhides comments in batches of 50. Meta confirms each one by reading it back. */
  async function setHidden(ids: string[], hide: boolean, onProgress?: (done: number) => void): Promise<HideResult[]> {
    const all: HideResult[] = [];
    setBusy((b) => ({ ...b, ...Object.fromEntries(ids.map((i) => [i, true])) }));
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      try {
        const d = await api<{ results: HideResult[] }>("/api/hide", {
          method: "POST",
          body: JSON.stringify({ platform: target.platform, pageId: target.pageId || chunk[0].split("_")[0], hide, commentIds: chunk }),
        });
        all.push(...d.results);
        const byId = new Map(d.results.map((r) => [r.id, r]));
        setComments((list) => list?.map((x) => (byId.has(x.id) ? { ...x, hidden: byId.get(x.id)!.hidden } : x)) || null);
        setVerified((v) => {
          const n = new Set(v);
          for (const r of d.results) (r.verified && hide ? n.add(r.id) : n.delete(r.id));
          return n;
        });
      } catch (e: any) {
        all.push(...chunk.map((id) => ({ id, ok: false, verified: false, hidden: !hide, error: e.message })));
      }
      onProgress?.(Math.min(i + BATCH, ids.length));
    }
    setBusy((b) => ({ ...b, ...Object.fromEntries(ids.map((i) => [i, false])) }));
    return all;
  }

  async function hideWithUndo(ids: string[]) {
    const res = await setHidden(ids, true);
    const done = res.filter((r) => r.ok).map((r) => r.id);
    const failed = res.filter((r) => !r.ok);
    setSelected(new Set());
    if (failed.length) toast({ kind: "err", msg: `${failed.length === res.length ? "Couldn't hide" : `${failed.length} couldn't be hidden`}: ${failed[0].error}` });
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
    setHideAllResult({ hidden: res.filter((r) => r.ok).map((r) => r.id), failed: res.filter((r) => !r.ok) });
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

  const customer = useMemo(() => (comments || []).filter((c) => !c.isBrand), [comments]);

  const counts = useMemo(() => {
    const c = { All: customer.length, Enquiry: 0, Positive: 0, Negative: 0, Review: 0 };
    for (const x of customer) {
      const r = results[x.id];
      if (r && r.category !== "Unclassified") c[r.category]++;
      if (r?.needs_review) c.Review++;
    }
    return c;
  }, [customer, results]);

  // Which comments the brand has already replied to.
  const replied = useMemo(() => {
    const s = new Set<string>();
    for (const c of comments || []) if (c.isBrand && c.parentId) s.add(c.parentId);
    return s;
  }, [comments]);

  const insight = useMemo(() => {
    if (progress || !customer.length) return null;
    const visible = customer.filter((c) => !c.hidden);
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
      tone: "info", tag: "Info", title: "Nothing needs action on this post",
      body: "No complaints, spam or unanswered enquiries.", action: "", button: null,
    };
  }, [customer, results, replied, progress]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (comments || []).filter((c) => {
      if (c.isBrand) return showBrand && filter === "All" && !q;
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
  }, [comments, results, filter, query, sort, showBrand, moving]);

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

  const PlatformIcon = target.platform === "instagram" ? Instagram : Facebook;

  return (
    <div>
      <div className="card post-hero">
        {target.image ? <img className="thumb" src={target.image} alt="" /> : <span className="thumb">{target.kind === "ad" ? <Megaphone /> : <ImageIcon />}</span>}
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2>{target.title}</h2>
          {target.caption && (
            <>
              <div className={`caption${captionOpen ? " open" : ""}`}>{target.caption}</div>
              {target.caption.length > 140 && <button className="linkish" onClick={() => setCaptionOpen((o) => !o)}>{captionOpen ? "Show less" : "Show more"}</button>}
            </>
          )}
          <div className="hero-meta">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><PlatformIcon />{target.platform === "instagram" ? "Instagram" : "Facebook"}{target.kind === "ad" ? " ad" : " post"}</span>
            {target.permalink && <a href={target.permalink} target="_blank" rel="noreferrer">Open on {target.platform === "instagram" ? "Instagram" : "Facebook"}<ExternalLink /></a>}
          </div>
          {headerExtra && <div className="hero-switch">{headerExtra}</div>}
        </div>
      </div>

      <div className="kpis" role="group" aria-label="Filter by category">
        {KPI.map((k) => {
          const n = counts[k.key];
          const share = counts.All ? Math.round((100 * n) / counts.All) : 0;
          return (
            <button key={k.key} className="kpi" aria-pressed={filter === k.key} onClick={() => setFilter(k.key)} style={{ ["--k" as any]: k.color }}>
              <div className="kpi-label"><i />{k.label}</div>
              <div className="kpi-value">{comments ? n : "–"}</div>
              <div className="kpi-sub">{k.key === "All" ? (progress ? "Categorising…" : "comments") : comments ? `${share}%` : " "}</div>
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
      {!comments && !loadError && <CommentSkeleton />}
      {comments && comments.length === 0 && <div className="card"><Empty icon={<MessageCircle />} title="No comments yet">When people comment on this {target.kind === "ad" ? "ad" : "post"}, they&apos;ll appear here.</Empty></div>}
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
                  <span className="c-author">{c.author || "Unknown"}</span>
                  <span>{fmtDateTime(c.time)}</span>
                  {c.isBrand && <span className="tag tag-brand">Brand</span>}
                  {c.hidden && (verified.has(c.id)
                    ? <span className="tag tag-verified" title="Meta confirmed this comment is hidden"><ShieldCheck />Hidden · confirmed</span>
                    : <span className="tag tag-hidden"><EyeOff />Hidden</span>)}
                  {moving[c.id] && <span className="moved-note"><ArrowRight />Moved to {moving[c.id]}</span>}
                  {!c.isBrand && replied.has(c.id) && <span className="tag tag-fixed"><CornerDownRight />Brand replied</span>}
                </div>
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
  );
}
