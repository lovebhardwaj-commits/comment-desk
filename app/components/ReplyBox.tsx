"use client";
import { useEffect, useRef, useState } from "react";
import { Send, EyeOff } from "lucide-react";

// Used only when the brand has no past replies to learn from yet.
export const STARTERS = [
  "Hi! Please check your DM 😊",
  "Thank you so much! 💜",
  "Sorry to hear this. Please DM us your order ID and we'll sort it out right away.",
  "Hi! You can order from the link in our bio.",
];

/** Inline box for a public reply. Enter sends, Shift+Enter adds a line.
 *  `suggestions` are the brand's own most-used replies to this kind of comment (learned from its past replies). */
export default function ReplyBox({ to, platform, asName, max, negative, busy, suggestions, onSend, onCancel }: {
  to: string; platform: "instagram" | "facebook"; asName: string; max: number; negative?: boolean; busy?: boolean;
  suggestions: string[]; onSend: (text: string, alsoHide: boolean) => void; onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const clean = text.trim();
  const ok = !!clean && clean.length <= max && !busy;
  const send = (hide: boolean) => ok && onSend(clean, hide);
  const learned = suggestions.length > 0;
  const chips = learned ? suggestions : STARTERS;

  return (
    <div className="reply-box">
      <div className="reply-to">Replying publicly to <b>{to}</b> as <b>{asName}</b> on {platform === "instagram" ? "Instagram" : "Facebook"}</div>
      <textarea ref={ref} value={text} rows={2} maxLength={max + 50} placeholder="Write a reply…" disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(false); }
          if (e.key === "Escape") onCancel();
        }} />
      <div className="saved-replies" aria-label={learned ? "Your most-used replies to comments like this" : "Starter replies"}>
        <span className="saved-label">{learned ? "Your usual replies" : "Quick replies"}</span>
        {chips.map((s) => (
          <span key={s} className="saved-chip">
            <button type="button" onClick={() => { setText(s); ref.current?.focus(); }} title="Use this reply (you can edit it before sending)">{s}</button>
          </span>
        ))}
      </div>
      <div className="reply-foot">
        <span className={`reply-count${clean.length > max ? " over" : ""}`}>{clean.length}/{max}</span>
        <span className="spacer" />
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        {negative && <button type="button" className="btn btn-sm" onClick={() => send(true)} disabled={!ok} title="Post the reply, then hide the comment"><EyeOff />Reply &amp; hide</button>}
        <button type="button" className="btn btn-sm btn-primary" onClick={() => send(false)} disabled={!ok}><Send />{busy ? "Sending…" : "Reply"}</button>
      </div>
    </div>
  );
}
