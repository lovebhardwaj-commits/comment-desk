"use client";
import { useEffect, useMemo, useState } from "react";
import { api, fmtDateTime } from "./api";

export type Target = {
  key: string; platform: "instagram" | "facebook"; objectId: string; pageId: string;
  brandUsername: string; title: string; caption: string; permalink: string;
};
type Comment = {
  id: string; text: string; time: string; author: string; hidden: boolean; canHide: boolean;
  parentId: string | null; parentText: string | null; isBrand: boolean;
};
type Result = { category: "Enquiry" | "Positive" | "Negative" | "Unclassified"; negative_type: string | null; needs_review: boolean; reason: string };
type Filter = "All" | "Enquiry" | "Positive" | "Negative" | "Review";

const CHUNK = 100;

export default function CommentsPanel({ target }: { target: Target }) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [filter, setFilter] = useState<Filter>("All");
  const [showBrand, setShowBrand] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Record<string, boolean>>({});

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
        setError(`Categorising failed for some comments: ${e.message}`);
      }
      setProgress({ done: Math.min(i + CHUNK, todo.length), total: todo.length });
    }
    setProgress(null);
  }

  useEffect(() => {
    const qs = new URLSearchParams({ platform: target.platform, objectId: target.objectId, pageId: target.pageId, brandUsername: target.brandUsername });
    api<{ comments: Comment[] }>(`/api/comments?${qs}`)
      .then((d) => { setComments(d.comments); return categorise(d.comments); })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.key]);

  async function toggleHide(c: Comment) {
    setPending((p) => ({ ...p, [c.id]: true }));
    try {
      await api("/api/hide", { method: "POST", body: JSON.stringify({ platform: target.platform, commentId: c.id, pageId: target.pageId || c.id.split("_")[0], hide: !c.hidden }) });
      setComments((list) => list?.map((x) => (x.id === c.id ? { ...x, hidden: !c.hidden } : x)) || null);
    } catch (e: any) {
      setError(`Couldn't ${c.hidden ? "unhide" : "hide"} the comment: ${e.message}`);
    } finally {
      setPending((p) => ({ ...p, [c.id]: false }));
    }
  }

  const counts = useMemo(() => {
    const c = { All: 0, Enquiry: 0, Positive: 0, Negative: 0, Review: 0 };
    for (const x of comments || []) {
      if (x.isBrand) continue;
      c.All++;
      const r = results[x.id];
      if (r && r.category !== "Unclassified") c[r.category]++;
      if (r?.needs_review) c.Review++;
    }
    return c;
  }, [comments, results]);

  const visible = (comments || []).filter((c) => {
    if (c.isBrand) return showBrand && filter === "All";
    if (filter === "All") return true;
    const r = results[c.id];
    if (filter === "Review") return !!r?.needs_review;
    return r?.category === filter;
  });

  return (
    <div>
      <div className="panel-head">
        <h2>{target.title}</h2>
        {target.caption && <div className="caption">{target.caption}</div>}
        <div className="note">
          {target.platform === "instagram" ? "Instagram" : "Facebook"}
          {target.permalink && <> · <a href={target.permalink} target="_blank" rel="noreferrer">Open post</a></>}
        </div>
        <div className="filters" role="group" aria-label="Filter comments">
          {(["All", "Enquiry", "Positive", "Negative", "Review"] as Filter[]).map((f) => (
            <button key={f} className="filter" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === "Review" ? "Needs review" : f} {counts[f]}
            </button>
          ))}
          <span className="spacer" />
          <label className="check"><input type="checkbox" checked={showBrand} onChange={(e) => setShowBrand(e.target.checked)} /> Show brand replies</label>
          {comments && !progress && (
            <button className="btn small" onClick={() => { setResults({}); categorise(comments); }} title="Uses saved results where available">Re-run</button>
          )}
        </div>
        {progress && (
          <>
            <div className="progress"><i style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 100}%` }} /></div>
            <div className="note">Categorising {progress.done} of {progress.total} comments…</div>
          </>
        )}
      </div>

      {error && <div className="banner err" role="alert">{error}</div>}
      {!comments && !error && <div className="empty">Loading comments…</div>}
      {comments?.length === 0 && <div className="empty">No comments on this post yet.</div>}

      <div className="comments">
        {visible.map((c) => {
          const r = results[c.id];
          return (
            <article key={c.id} className={`comment${c.parentId ? " is-reply" : ""}${c.hidden ? " is-hidden" : ""}${c.isBrand ? " brand" : ""}`}>
              <div className="c-top">
                <span className="author">{c.author || "Unknown"}</span>
                <span>{fmtDateTime(c.time)}</span>
                {c.isBrand && <span className="badge brandb">Brand</span>}
                {c.hidden && <span className="badge hidden">Hidden</span>}
              </div>
              {c.parentId && c.parentText && <div className="c-parent">Replying to: {c.parentText.slice(0, 140)}</div>}
              <p className="c-text">{c.text || <em>(no text: sticker or image)</em>}</p>
              {!c.isBrand && (
                <div className="c-foot">
                  {r ? <span className={`badge ${r.category}`}>{r.category}</span> : c.text.trim() ? <span className="badge pending">…</span> : null}
                  {r?.negative_type && <span className="subtype">{r.negative_type}</span>}
                  {r?.needs_review && <span className="badge review">Needs review</span>}
                  <span className="reason">{r?.reason}</span>
                  {c.canHide ? (
                    <button className={`btn small${c.hidden ? "" : " danger"}`} disabled={!!pending[c.id]} onClick={() => toggleHide(c)}>
                      {pending[c.id] ? "…" : c.hidden ? "Unhide" : "Hide"}
                    </button>
                  ) : (
                    <span className="note" title="Meta doesn't allow hiding this comment">Can&apos;t hide</span>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
