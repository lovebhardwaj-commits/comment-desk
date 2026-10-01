"use client";
import { Children, createContext, isValidElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, AlertCircle, ChevronDown, X, Search, Check } from "lucide-react";

/* ---------- Toasts ---------- */
type Toast = { id: number; kind: "ok" | "err"; msg: string; undo?: () => void; action?: { label: string; run: () => void } };
const ToastCtx = createContext<(t: Omit<Toast, "id">) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const id = useRef(0);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const n = ++id.current;
    setToasts((all) => [...all.slice(-2), { ...t, id: n }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== n)), t.undo || t.action ? 7000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === "ok" ? <CheckCircle2 /> : <AlertCircle />}
            <span className="t-msg">{t.msg}</span>
            {t.action && (
              <button className="undo" onClick={() => { t.action!.run(); setToasts((all) => all.filter((x) => x.id !== t.id)); }}>
                {t.action.label}
              </button>
            )}
            {t.undo && (
              <button className="undo" onClick={() => { t.undo!(); setToasts((all) => all.filter((x) => x.id !== t.id)); }}>
                Undo
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Text of an <option>'s children, e.g. ["Klenzmo", " (inactive)"] → "Klenzmo (inactive)". */
const textOf = (n: ReactNode): string => Children.toArray(n).map((c) => (typeof c === "string" || typeof c === "number" ? String(c) : "")).join("");

/**
 * A pill that opens a searchable list. Takes <option> children like a <select>, so callers don't change:
 * options with a value are choices; an option without one (e.g. "Loading Pages…") is shown as the placeholder.
 */
export function SelectPill({ icon, label, value, onChange, children, disabled, title }: {
  icon?: ReactNode; label: string; value: string; onChange: (v: string) => void; children: ReactNode; disabled?: boolean; title?: string;
}) {
  const opts = useMemo(() => Children.toArray(children).flatMap((ch) =>
    isValidElement(ch) && ch.type === "option"
      ? [{ value: (ch.props as any).value as string | undefined, text: textOf((ch.props as any).children).trim() }]
      : []), [children]);
  const choices = opts.filter((o) => o.value != null && o.value !== "");
  const current = choices.find((o) => String(o.value) === value);
  const placeholder = opts.find((o) => o.value == null)?.text;
  const plural = `${label.toLowerCase()}s`;

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
  const shown = useMemo(() => {
    const n = norm(q);
    return n ? choices.filter((o) => norm(`${o.text} ${o.value}`).includes(n)) : choices;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, choices]);

  // Open: focus the search and start on the current choice. Click outside closes.
  useEffect(() => {
    if (!open) return;
    setQ(""); setHi(Math.max(0, choices.findIndex((o) => String(o.value) === value)));
    const t = setTimeout(() => input.current?.focus(), 0);
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", away); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => { setHi(0); }, [q]);
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: "nearest" }); }, [hi, open]);

  function choose(v: string) {
    setOpen(false);
    if (v !== value) onChange(v);
    btn.current?.focus();
  }
  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((i) => Math.min(shown.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const o = shown[hi]; if (o) choose(String(o.value)); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); btn.current?.focus(); }
    else if (e.key === "Tab") setOpen(false);
  }

  return (
    <div className={`pill combo${open ? " open" : ""}`} ref={wrap} title={open ? undefined : title}>
      <button ref={btn} type="button" className="combo-btn" disabled={disabled || !choices.length} onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${current?.text || placeholder || "none"}`}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); } }}>
        {icon}
        <span className="combo-value">{current?.text || placeholder || `Choose ${label.toLowerCase()}`}</span>
        <ChevronDown className="chev" />
      </button>
      {open && (
        <div className="combo-pop">
          <label className="combo-search">
            <Search />
            <span className="sr">Search {plural}</span>
            <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
              placeholder={`Search ${choices.length.toLocaleString("en-IN")} ${plural}…`} role="combobox" aria-expanded aria-controls={`combo-${label}`} aria-autocomplete="list" />
          </label>
          <ul className="combo-list" role="listbox" id={`combo-${label}`} ref={list} aria-label={label}>
            {shown.map((o, i) => {
              const sel = String(o.value) === value;
              return (
                <li key={String(o.value)} data-i={i} role="option" aria-selected={sel} className={i === hi ? "hi" : undefined}
                  onMouseEnter={() => setHi(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(String(o.value))}>
                  <span className="combo-text">{o.text}</span>
                  {sel && <Check />}
                </li>
              );
            })}
            {!shown.length && <li className="combo-empty">No {plural} match &ldquo;{q}&rdquo;</li>}
          </ul>
          {q && shown.length > 0 && <div className="combo-count">{shown.length.toLocaleString("en-IN")} of {choices.length.toLocaleString("en-IN")}</div>}
        </div>
      )}
    </div>
  );
}

/* ---------- Empty state ---------- */
export function Empty({ icon, title, children, action, small }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode; small?: boolean }) {
  return (
    <div className={`empty${small ? " small" : ""}`}>
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/* ---------- Skeletons ---------- */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skel-row">
          <div className="skel" style={{ width: 56, height: 56, borderRadius: 10 }} />
          <div style={{ flex: 1, display: "grid", gap: 8, alignContent: "center" }}>
            <div className="skel" style={{ height: 10, width: "45%" }} />
            <div className="skel" style={{ height: 10, width: "85%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CommentSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="comments" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="skel skel-comment" />)}
    </div>
  );
}

export const initials = (name: string) =>
  (name || "?").replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

/* ---------- Modal ---------- */
export function Modal({ open, onClose, title, children, footer, busy }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; busy?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} disabled={busy} aria-label="Close"><X /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
