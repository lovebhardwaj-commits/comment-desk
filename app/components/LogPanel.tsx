"use client";
import { useState } from "react";
import { ScrollText, Copy, Trash2, Check, ExternalLink } from "lucide-react";
import { Modal } from "./ui";
import { useLog, clearLog, logText } from "./log";
import type { GraphCheck } from "./graphDebug";

function CopyBtn({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="btn btn-sm btn-ghost" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch {} }}>
      {done ? <Check /> : <Copy />}{done ? "Copied" : label}
    </button>
  );
}

/** Sidebar button + dialog showing the activity log. The badge counts errors and warnings since it was last opened. */
export default function LogPanel({ collapsed }: { collapsed?: boolean }) {
  const entries = useLog();
  const [open, setOpen] = useState(false);
  const [seenAt, setSeenAt] = useState(0);
  const fresh = entries.filter((e) => e.at > seenAt && e.level !== "info").length;

  return (
    <>
      <button className="nav-item" onClick={() => { setOpen(true); setSeenAt(Date.now()); }} title="Activity log">
        <ScrollText /><span className="nav-label">Activity log</span>
        {fresh > 0 && <span className="nav-badge log-badge">{fresh}</span>}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Activity log"
        footer={<>
          <button className="btn btn-sm btn-ghost" onClick={clearLog} disabled={!entries.length}><Trash2 />Clear</button>
          <CopyBtn text={logText(entries)} label="Copy all" />
          <button className="btn btn-sm btn-primary" onClick={() => setOpen(false)}>Close</button>
        </>}>
        <div className="fine-note">
          Problems the app ran into in this browser over the last 24 hours. Each one lists the IDs, Meta&apos;s exact response and a Graph API check you can run yourself:
          open it in <b>Graph API Explorer</b>, choose the Page (or your own login for Instagram) under &ldquo;User or Page&rdquo;, and press Submit.
          Access tokens are never put in the log.
        </div>
        {!entries.length ? <div className="log-empty">Nothing has gone wrong. 🎉</div> : (
          <div className="log-list">
            {entries.map((e, i) => {
              const { checks, ...rest } = (e.details || {}) as { checks?: GraphCheck[] } & Record<string, unknown>;
              return (
                <div key={i} className={`log-row ${e.level}`}>
                  <div className="log-head">
                    <span className="log-level">{e.level}</span>
                    <span className="log-area">{e.area}</span>
                    <span className="log-time">{new Date(e.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{e.repeats ? ` · ×${e.repeats}` : ""}</span>
                  </div>
                  <div className="log-msg">{e.message}</div>
                  {Object.keys(rest).length > 0 && <pre className="log-details">{JSON.stringify(rest, null, 1)}</pre>}
                  {checks?.map((c) => (
                    <div key={c.curl} className="log-check">
                      <div className="log-check-head">
                        <span>{c.label} <em>({c.token === "page" ? "needs the Page's token" : "needs your login's token"})</em></span>
                        <a className="btn btn-sm" href={c.explorer} target="_blank" rel="noreferrer"><ExternalLink />Open in Graph API Explorer</a>
                        <CopyBtn text={c.curl} label="Copy curl" />
                      </div>
                      <pre className="log-curl">{c.curl}</pre>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </Modal>
    </>
  );
}
