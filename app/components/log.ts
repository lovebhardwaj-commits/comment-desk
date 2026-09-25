"use client";
// Activity log: every failure, gap or unreadable post the app runs into, with the ids and Meta's exact response,
// so problems can be traced (and copied to whoever is fixing them). Kept in this browser for 24 hours.
import { useEffect, useState } from "react";
import { cacheGet, cacheSet } from "./cache";

export type LogEntry = {
  at: number; level: "error" | "warn" | "info"; area: string; message: string;
  details?: Record<string, unknown>; repeats?: number;
};

const KEY = "activity-log";
const MAX = 300;
let entries: LogEntry[] = [];
let loaded = false;
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

const notify = () => listeners.forEach((l) => l());
const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => cacheSet(KEY, entries), 500); };

async function load() {
  if (loaded) return;
  loaded = true;
  const c = await cacheGet<LogEntry[]>(KEY);
  if (c?.value?.length) { entries = [...entries, ...c.value].slice(0, MAX); notify(); }
}

/** Adds an entry. The same problem seen again within 10 minutes bumps a counter instead of adding a new line. */
export function logEvent(e: Omit<LogEntry, "at" | "repeats">) {
  const now = Date.now();
  const same = entries.find((x) => x.area === e.area && x.message === e.message && now - x.at < 10 * 60 * 1000);
  if (same) { same.repeats = (same.repeats || 1) + 1; same.at = now; same.details = e.details ?? same.details; }
  else entries = [{ ...e, at: now }, ...entries].slice(0, MAX);
  if (e.level === "error") console.error(`[${e.area}] ${e.message}`, e.details || "");
  save();
  notify();
}

export function clearLog() { entries = []; save(); notify(); }

export function useLog() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    load();
    return () => { listeners.delete(l); };
  }, []);
  return entries;
}

/** Plain-text version of the log, for pasting into a message. */
export function logText(list: LogEntry[]) {
  return list.map((e) => {
    const t = new Date(e.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return `${t} ${e.level.toUpperCase()} [${e.area}] ${e.message}${e.repeats ? ` (x${e.repeats})` : ""}${e.details ? `\n    ${JSON.stringify(e.details)}` : ""}`;
  }).join("\n");
}
