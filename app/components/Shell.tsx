"use client";
import { useEffect, useState, type ReactNode } from "react";
import {
  MessagesSquare, Megaphone, PanelLeft, LogOut, Menu, Sun, Moon, Home, PenLine, Search, PieChart, TrendingUp, Clock, Users,
  RefreshCw, LayoutGrid, Sparkles, Pencil, Folder, Bell, Infinity as MetaIcon, MousePointer2, Rocket, FileText, FileBarChart,
  FileCheck, FileSearch, HelpCircle, type LucideIcon,
} from "lucide-react";
import { initials } from "./ui";
import { cacheClear } from "./cache";
import LogPanel from "./LogPanel";

export type View = "posts" | "ads";

/** "G" for Google Audit, as in the Fastrr Ads menu (lucide has no Google mark). */
const GoogleG = (() => { const G = (p: any) => <span className="g-mark" {...p}>G</span>; return G as unknown as LucideIcon; })();
type Item = { label: string; icon: LucideIcon; view?: View; badge?: string };
/** The Fastrr Ads sidebar, item for item. Headings are separators only. Only the Social items work here; the others
 *  are shown as in Fastrr Ads, without a link. */
const MENU: { heading?: string; items: Item[] }[] = [
  { items: [{ label: "Home", icon: Home }] },
  { heading: "Insights", items: [
    { label: "Creative Performance", icon: PenLine },
    { label: "Brand Analysis", icon: Search },
    { label: "Ads Analyzer", icon: PieChart },
  ] },
  { heading: "Meta Insights", items: [
    { label: "New Reach", icon: TrendingUp },
    { label: "Conversion Windows", icon: Clock },
    { label: "User Segments", icon: Users },
    { label: "Creative Churn", icon: RefreshCw },
    { label: "Frequency Report", icon: LayoutGrid },
  ] },
  { heading: "Social", items: [
    { label: "Ad comments", icon: Megaphone, view: "ads" },
    { label: "Post comments", icon: MessagesSquare, view: "posts" },
  ] },
  { heading: "Create", items: [
    { label: "Inspiration Hub", icon: Sparkles, badge: "Beta" },
    { label: "Create Ads", icon: Pencil },
    { label: "My Collection", icon: Folder },
  ] },
  { heading: "Monitor", items: [
    { label: "Alerts", icon: Bell },
    { label: "Rules", icon: LayoutGrid },
    { label: "Meta Audit", icon: MetaIcon },
    { label: "Google Audit", icon: GoogleG },
  ] },
  { heading: "Ad Launcher", items: [
    { label: "Ad Selection", icon: MousePointer2 },
    { label: "Ready to Launch", icon: Rocket },
    { label: "Ad Templates", icon: FileText },
  ] },
  { heading: "Reports", items: [
    { label: "Creative Performance", icon: FileBarChart },
    { label: "Audit Reports", icon: FileCheck },
    { label: "Brand Analysis", icon: FileSearch },
  ] },
];

/** The Fastrr Ads wordmark, as in the Fastrr Ads sidebar. */
export function BrandMark() {
  return (
    <span className="fastrr-mark" aria-hidden>
      <span className="fastrr-word"><i className="fastrr-lines" />fastrr</span>
      <span className="fastrr-sub">Ads</span>
    </span>
  );
}

/** Light / dark switch. The choice is stored in localStorage ("cp:theme") and applied before first paint by layout.tsx. */
function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => { setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark"); }, []);
  const flip = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    if (next === "light") document.documentElement.dataset.theme = "light"; else delete document.documentElement.dataset.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "light" ? "#faf5f1" : "#0d0d18");
    try { localStorage.setItem("cp:theme", next); } catch {}
  };
  const label = theme === "light" ? "Switch to dark theme" : "Switch to light theme";
  return (
    <button className="btn btn-ghost btn-icon btn-sm theme-toggle" onClick={flip} aria-label={label} title={label}>
      {theme === "light" ? <Moon /> : <Sun />}
    </button>
  );
}

/** The Activity log is for the internal team only: open the app once with ?debug=1 to show it (remembered in this
 *  browser), ?debug=0 to hide it again. Merchants never see it. */
function useDebug() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("debug");
      if (q === "1") localStorage.setItem("cp:debug", "1");
      if (q === "0") localStorage.removeItem("cp:debug");
      setOn(localStorage.getItem("cp:debug") === "1");
    } catch {}
  }, []);
  return on;
}

/** The app frame in the Fastrr Ads style: the full Fastrr Ads sidebar with a "Social" section (Ad comments, Post comments).
 *  Without userName (logged out) the same frame is shown around the login prompt, with no account footer. */
export default function Shell({ view, onView, onHome, userName, children }: { view: View; onView: (v: View) => void; onHome?: () => void; userName?: string; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const debug = useDebug();

  useEffect(() => {
    try { setCollapsed(localStorage.getItem("cp:sidebar") === "1"); } catch {}
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try { localStorage.setItem("cp:sidebar", c ? "0" : "1"); } catch {}
      return !c;
    });
  };
  const go = (v: View) => { onView(v); setMobileOpen(false); };

  async function logout() {
    await cacheClear(); // saved comments belong to this login only
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  const label = view === "posts" ? "Post comments" : "Ad comments";

  return (
    <div className={`shell fastrr${collapsed ? " collapsed" : ""}${mobileOpen ? " mobile-open" : ""}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar-top">
          <button className="brand brand-link" onClick={() => { onHome?.(); setMobileOpen(false); }} title="Go to the start screen" aria-label="Fastrr Ads: go to the start screen">
            <BrandMark />
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={toggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand" : "Collapse"}>
            <PanelLeft />
          </button>
        </div>

        <div className="nav-scroll">
          {MENU.map((group, gi) => (
            <div key={gi} className="nav-group">
              {group.heading && <div className="nav-section">{group.heading}</div>}
              <nav className="nav">
                {group.items.map((it) => {
                  const Icon = it.icon;
                  const inner = <><Icon /><span className="nav-label">{it.label}</span>{it.badge && <span className="nav-badge">{it.badge}</span>}</>;
                  return it.view ? (
                    <button key={it.label} className="nav-item" aria-current={view === it.view ? "page" : undefined} onClick={() => go(it.view!)} title={it.label}>{inner}</button>
                  ) : (
                    <span key={`${group.heading}-${it.label}`} className="nav-item nav-static" title={it.label}>{inner}</span>
                  );
                })}
              </nav>
            </div>
          ))}
        </div>

        {userName !== undefined && (
          <div className="sidebar-bottom">
            {debug && <nav className="nav"><LogPanel collapsed={collapsed} /></nav>}
            <div className="user" title={userName}>
              <span className="avatar">{initials(userName)}</span>
              <span className="user-name">{userName}</span>
              <span className="btn btn-ghost btn-icon btn-sm nav-static" aria-label="Help" title="Help"><HelpCircle /></span>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={logout} aria-label="Log out" title="Log out"><LogOut /></button>
            </div>
          </div>
        )}
      </aside>

      <div className="main">
        <div className="crumbs">
          <button className="btn btn-ghost btn-icon btn-sm mobile-menu" onClick={() => setMobileOpen((o) => !o)} aria-label="Open menu"><Menu /></button>
          <span className="mid">Fastrr Ads</span><span className="sep mid">/</span><strong>{label}</strong>
          <ThemeToggle />
        </div>
        <div className="page">{children}</div>
      </div>
    </div>
  );
}
