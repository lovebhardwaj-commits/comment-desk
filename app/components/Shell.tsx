"use client";
import { useEffect, useState, type ReactNode } from "react";
import { MessagesSquare, Megaphone, PanelLeft, LogOut, Menu, Activity } from "lucide-react";
import { initials } from "./ui";
import { cacheClear } from "./cache";

export type View = "posts" | "ads";

export function BrandMark() {
  return <span className="brand-mark" aria-hidden><Activity /></span>;
}

export default function Shell({ view, onView, userName, children }: { view: View; onView: (v: View) => void; userName: string; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

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
    <div className={`shell${collapsed ? " collapsed" : ""}${mobileOpen ? " mobile-open" : ""}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar-top">
          <div className="brand">
            <BrandMark />
            <div className="brand-text">
              <div className="brand-name">Comment Pulse</div>
              <div className="brand-sub">by Fastrr Ads</div>
            </div>
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={toggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand" : "Collapse"}>
            <PanelLeft />
          </button>
        </div>

        <div className="nav-section">Monitor</div>
        <nav className="nav">
          <button className="nav-item" aria-current={view === "posts" ? "page" : undefined} onClick={() => go("posts")} title="Post comments">
            <MessagesSquare /><span className="nav-label">Post comments</span>
          </button>
          <button className="nav-item" aria-current={view === "ads" ? "page" : undefined} onClick={() => go("ads")} title="Ad comments">
            <Megaphone /><span className="nav-label">Ad comments</span>
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="user" title={userName}>
            <span className="avatar">{initials(userName)}</span>
            <span className="user-name">{userName}</span>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={logout} aria-label="Log out" title="Log out"><LogOut /></button>
          </div>
        </div>
      </aside>

      <div className="main">
        <div className="crumbs">
          <button className="btn btn-ghost btn-icon btn-sm mobile-menu" onClick={() => setMobileOpen((o) => !o)} aria-label="Open menu"><Menu /></button>
          <span className="mid">Fastrr Ads</span><span className="sep mid">/</span><span>Comment Pulse</span><span className="sep">/</span><strong>{label}</strong>
        </div>
        <div className="page">{children}</div>
      </div>
    </div>
  );
}
