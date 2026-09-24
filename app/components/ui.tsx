"use client";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, AlertCircle, ChevronDown } from "lucide-react";

/* ---------- Toasts ---------- */
type Toast = { id: number; kind: "ok" | "err"; msg: string; undo?: () => void };
const ToastCtx = createContext<(t: Omit<Toast, "id">) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const id = useRef(0);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const n = ++id.current;
    setToasts((all) => [...all.slice(-2), { ...t, id: n }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== n)), t.undo ? 7000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === "ok" ? <CheckCircle2 /> : <AlertCircle />}
            <span className="t-msg">{t.msg}</span>
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
export function SelectPill({ icon, label, value, onChange, children, disabled }: {
  icon?: ReactNode; label: string; value: string; onChange: (v: string) => void; children: ReactNode; disabled?: boolean;
}) {
  return (
    <label className="pill">
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
