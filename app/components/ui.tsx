"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, AlertCircle, ChevronDown, X } from "lucide-react";

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

/* ---------- Select pill ---------- */
export function SelectPill({ icon, label, value, onChange, children, disabled, title }: {
  icon?: ReactNode; label: string; value: string; onChange: (v: string) => void; children: ReactNode; disabled?: boolean; title?: string;
}) {
  return (
    <label className="pill" title={title}>
      {icon}
      <span className="sr">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>{children}</select>
      <ChevronDown className="chev" />
    </label>
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
