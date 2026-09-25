"use client";
import { useState } from "react";
import { ScrollText, Copy, Trash2, Check } from "lucide-react";
import { Modal } from "./ui";
import { useLog, clearLog, logText } from "./log";

/** Sidebar button + dialog showing the activity log. The badge counts errors and warnings since it was last opened. */
export default function LogPanel({ collapsed }: { collapsed?: boolean }) {
  const entries = useLog();
  const [open, setOpen] = useState(false);
  const [seenAt, setSeenAt] = useState(0);
  const [copied, setCopied] = useState(false);
  const fresh = entries.filter((e) => e.at > seenAt && e.level !== "info").length;

  const copy = async () => {
    try { await navigator.clipboard.writeText(logText(entries)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };

  return (
    <>
      <button className="nav-item" onClick={() => { setOpen(true); setSeenAt(Date.now()); }} title="Activity log">
        <ScrollText /><span className="nav-label">Activity log</span>
        {fresh > 0 && <span className="nav-badge log-badge">{fresh}</span>}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Activity log"
        footer={<>
          <button className="btn btn-sm btn-ghost" onClick={clearLog} disabled={!entries.length}><Trash2 />Clear</button>
          <button className="btn btn-sm" onClick={copy} disabled={!entries.length}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy all"}</button>
          <button className="btn btn-sm btn-primary" onClick={() => setOpen(false)}>Close</button>
        </>}>
        <div className="fine-note">Problems the app ran into in this browser over the last 24 hours, with the ids and Meta&apos;s exact response. Use &ldquo;Copy all&rdquo; to send it for a fix.</div>
        {!entries.length ? <div className="log-empty">Nothing has gone wrong. 🎉</div> : (
          <div className="log-list">
            {entries.map((e, i) => (
              <div key={i} className={`log-row ${e.level}`}>
                <div className="log-head">
                  <span className="log-level">{e.level}</span>
                  <span className="log-area">{e.area}</span>
                  <span className="log-time">{new Date(e.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{e.repeats ? ` · ×${e.repeats}` : ""}</span>
                </div>
                <div className="log-msg">{e.message}</div>
                {e.details && <pre className="log-details">{JSON.stringify(e.details, null, 1)}</pre>}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}
