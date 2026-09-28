"use client";
import { useEffect, useRef, useState } from "react";
import { Send, X, Plus, EyeOff } from "lucide-react";

// Saved replies live in this browser (they're not private data), so they survive between sessions.
const KEY = "cp:saved-replies";
const DEFAULTS = [
  "Hi! Please check your DM 😊",
  "Thank you so much! 💜",
  "Sorry to hear this. Please DM us your order ID and we'll sort it out right away.",
  "Hi! You can order from the link in our bio.",
];
export function loadSaved(): string[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); return Array.isArray(v) ? v : DEFAULTS; } catch { return DEFAULTS; }
}
function storeSaved(list: string[]) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {} }

/** Inline box for a public reply. Enter sends, Shift+Enter adds a line. */
export default function ReplyBox({ to, platform, asName, max, negative, busy, onSend, onCancel }: {
  to: string; platform: "instagram" | "facebook"; asName: string; max: number; negative?: boolean; busy?: boolean;
  onSend: (text: string, alsoHide: boolean) => void; onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState<string[]>([]);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setSaved(loadSaved()); ref.current?.focus(); }, []);
  const clean = text.trim();
  const ok = !!clean && clean.length <= max && !busy;
  const send = (hide: boolean) => ok && onSend(clean, hide);
  const save = () => { if (!clean || saved.includes(clean)) return; const n = [clean, ...saved].slice(0, 12); setSaved(n); storeSaved(n); };
  const remove = (s: string) => { const n = saved.filter((x) => x !== s); setSaved(n); storeSaved(n); };

  return (
    <div className="reply-box">
      <div className="reply-to">Replying publicly to <b>{to}</b> as <b>{asName}</b> on {platform === "instagram" ? "Instagram" : "Facebook"}</div>
      <textarea ref={ref} value={text} rows={2} maxLength={max + 50} placeholder="Write a reply…" disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(false); }
          if (e.key === "Escape") onCancel();
        }} />
      {saved.length > 0 && (
        <div className="saved-replies" aria-label="Saved replies">
          {saved.map((s) => (
            <span key={s} className="saved-chip">
              <button type="button" onClick={() => { setText(s); ref.current?.focus(); }} title="Use this reply (you can edit it before sending)">{s}</button>
              <button type="button" className="x" onClick={() => remove(s)} aria-label="Remove saved reply"><X /></button>
            </span>
          ))}
        </div>
      )}
      <div className="reply-foot">
        <button type="button" className="linkish" onClick={save} disabled={!clean || saved.includes(clean)}><Plus />Save as quick reply</button>
        <span className={`reply-count${clean.length > max ? " over" : ""}`}>{clean.length}/{max}</span>
        <span className="spacer" />
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        {negative && <button type="button" className="btn btn-sm" onClick={() => send(true)} disabled={!ok} title="Post the reply, then hide the comment"><EyeOff />Reply &amp; hide</button>}
        <button type="button" className="btn btn-sm btn-primary" onClick={() => send(false)} disabled={!ok}><Send />{busy ? "Sending…" : "Reply"}</button>
      </div>
    </div>
  );
}
