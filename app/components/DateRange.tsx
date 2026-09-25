"use client";
import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const nice = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/** A date-range button that opens a small pop-over, so picking dates never reflows the header. */
export default function DateRange({ from, to, active, onApply, label = "Custom", maxDaysBack = 90, onOpen }: {
  from: string; to: string; active: boolean; onApply: (from: string, to: string) => void;
  label?: string; maxDaysBack?: number; onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  const ref = useRef<HTMLDivElement>(null);
  const today = iso(new Date());
  const min = iso(new Date(Date.now() - maxDaysBack * 864e5));

  useEffect(() => { if (open) { setF(from); setT(to); } }, [open, from, to]);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", click);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", click); document.removeEventListener("keydown", key); };
  }, [open]);

  const quick = (days: number) => { setF(iso(new Date(Date.now() - days * 864e5))); setT(today); };
  const valid = f && t && f <= t;

  return (
    <div className="dr" ref={ref}>
      <button className={`dr-btn${active ? " on" : ""}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setOpen((o) => !o); onOpen?.(); }}>
        <CalendarDays />{active ? `${nice(from)} – ${nice(to)}` : label}<ChevronDown className="dr-chev" />
      </button>
      {open && (
        <div className="dr-pop" role="dialog" aria-label="Choose dates">
          <div className="dr-row">
            <label>From<input type="date" value={f} min={min} max={t || today} onChange={(e) => setF(e.target.value)} /></label>
            <label>To<input type="date" value={t} min={f || min} max={today} onChange={(e) => setT(e.target.value)} /></label>
          </div>
          <div className="dr-quick">
            {[3, 30, 60, 90].filter((d) => d <= maxDaysBack).map((d) => <button key={d} className="btn btn-sm btn-ghost" onClick={() => quick(d)}>Last {d} days</button>)}
          </div>
          <div className="dr-foot">
            <button className="btn btn-sm" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-sm btn-primary" disabled={!valid} onClick={() => { onApply(f, t); setOpen(false); }}>Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}
