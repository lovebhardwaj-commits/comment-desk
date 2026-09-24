"use client";
import { useEffect, useMemo, useState } from "react";
import { api, fmtDate } from "./api";
import CommentsPanel, { type Target } from "./CommentsPanel";

type PageAcc = { id: string; name: string; instagram: { id: string; username: string } | null };
type Post = { id: string; text: string; time: string; permalink: string; comments: number; type: string; image?: string };
type AdAcc = { id: string; name: string; active: boolean };
type Ad = {
  id: string; name: string; status: string; created: string;
  instagram: { mediaId: string; owned: boolean; ownerUsername: string; brandUsername: string; comments: number | null; permalink: string | null; caption: string; unreadable?: boolean } | null;
  facebook: { postId: string; pageId: string; owned: boolean; comments: number | null; permalink: string | null; caption: string; unreadable?: boolean } | null;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function Dashboard({ userName }: { userName: string }) {
  const [tab, setTab] = useState<"posts" | "ads">("posts");
  const [target, setTarget] = useState<Target | null>(null);

  // Posts state
  const [pages, setPages] = useState<PageAcc[] | null>(null);
  const [pageId, setPageId] = useState("");
  const [platform, setPlatform] = useState<"instagram" | "facebook">("instagram");
  const [since, setSince] = useState(iso(new Date(Date.now() - 30 * 864e5)));
  const [until, setUntil] = useState(iso(new Date()));
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [postsNext, setPostsNext] = useState<string | null>(null);

  // Ads state
  const [adAccounts, setAdAccounts] = useState<AdAcc[] | null>(null);
  const [adAccountId, setAdAccountId] = useState("");
  const [adStatus, setAdStatus] = useState<"all" | "active">("all");
  const [ads, setAds] = useState<Ad[] | null>(null);
  const [adsNext, setAdsNext] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ pages: PageAcc[] }>("/api/accounts")
      .then((d) => {
        setPages(d.pages);
        if (d.pages[0]) {
          setPageId(d.pages[0].id);
          if (!d.pages[0].instagram) setPlatform("facebook");
        }
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (tab === "ads" && !adAccounts) {
      api<{ adAccounts: AdAcc[] }>("/api/adaccounts")
        .then((d) => {
          setAdAccounts(d.adAccounts);
          if (d.adAccounts[0]) setAdAccountId(d.adAccounts[0].id);
        })
        .catch((e) => setError(e.message));
    }
  }, [tab, adAccounts]);

  const page = useMemo(() => pages?.find((p) => p.id === pageId), [pages, pageId]);

  async function loadPosts(after?: string) {
    if (!page) return;
    const accountId = platform === "instagram" ? page.instagram?.id : page.id;
    if (!accountId) return;
    setBusy(true); setError("");
    try {
      const qs = new URLSearchParams({ platform, accountId, since, until, ...(after ? { after } : {}) });
      const d = await api<{ posts: Post[]; next: string | null }>(`/api/posts?${qs}`);
      setPosts((prev) => (after && prev ? [...prev, ...d.posts] : d.posts));
      setPostsNext(d.next);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function loadAds(after?: string) {
    if (!adAccountId) return;
    setBusy(true); setError("");
    try {
      const qs = new URLSearchParams({ adAccountId, status: adStatus, ...(after ? { after } : {}) });
      const d = await api<{ ads: Ad[]; next: string | null }>(`/api/ads?${qs}`);
      setAds((prev) => (after && prev ? [...prev, ...d.ads] : d.ads));
      setAdsNext(d.next);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  function openPost(p: Post) {
    if (!page) return;
    setTarget({
      key: `${platform}:${p.id}`, platform, objectId: p.id, pageId: page.id,
      brandUsername: page.instagram?.username || "", title: `${p.type} · ${fmtDate(p.time)}`,
      caption: p.text, permalink: p.permalink,
    });
  }

  function openAd(ad: Ad, which: "instagram" | "facebook") {
    if (which === "instagram" && ad.instagram) {
      setTarget({
        key: `instagram:${ad.instagram.mediaId}`, platform: "instagram", objectId: ad.instagram.mediaId, pageId: "",
        brandUsername: ad.instagram.brandUsername, title: `Ad · ${ad.name}`, caption: ad.instagram.caption, permalink: ad.instagram.permalink || "",
      });
    } else if (which === "facebook" && ad.facebook) {
      setTarget({
        key: `facebook:${ad.facebook.postId}`, platform: "facebook", objectId: ad.facebook.postId, pageId: ad.facebook.pageId,
        brandUsername: "", title: `Ad · ${ad.name}`, caption: ad.facebook.caption, permalink: ad.facebook.permalink || "",
      });
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="title"><span className="brand-mark" aria-hidden>CD</span>Comment Desk</div>
        <nav className="tabs" role="tablist">
          <button className="tab" role="tab" aria-selected={tab === "posts"} onClick={() => setTab("posts")}>Posts</button>
          <button className="tab" role="tab" aria-selected={tab === "ads"} onClick={() => setTab("ads")}>Ads</button>
        </nav>
        <div className="user">{userName}<button className="btn small" onClick={logout}>Log out</button></div>
      </header>

      <div className="body">
        <aside className="side">
          {tab === "posts" ? (
            <>
              <div className="controls">
                <div className="field">
                  <label htmlFor="page">Page</label>
                  <select id="page" value={pageId} onChange={(e) => {
                    setPageId(e.target.value); setPosts(null);
                    const p = pages?.find((x) => x.id === e.target.value);
                    if (!p?.instagram) setPlatform("facebook");
                  }}>
                    {!pages && <option>Loading…</option>}
                    {pages?.length === 0 && <option>No Pages found</option>}
                    {pages?.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}{p.instagram ? ` · @${p.instagram.username}` : ""}</option>
                    ))}
                  </select>
                </div>
                <div className="seg" role="group" aria-label="Platform">
                  <button aria-pressed={platform === "instagram"} disabled={!page?.instagram} onClick={() => { setPlatform("instagram"); setPosts(null); }}>Instagram</button>
                  <button aria-pressed={platform === "facebook"} onClick={() => { setPlatform("facebook"); setPosts(null); }}>Facebook</button>
                </div>
                <div className="row">
                  <div className="field"><label htmlFor="since">From</label><input id="since" type="date" value={since} max={until} onChange={(e) => setSince(e.target.value)} /></div>
                  <div className="field"><label htmlFor="until">To</label><input id="until" type="date" value={until} min={since} onChange={(e) => setUntil(e.target.value)} /></div>
                </div>
                <button className="btn primary" disabled={busy || !page} onClick={() => loadPosts()}>{busy ? "Loading…" : "Show posts"}</button>
              </div>
              <div className="list">
                {error && <div className="banner err">{error}</div>}
                {!posts && !error && <div className="empty">Choose a Page and date range, then Show posts.</div>}
                {posts?.length === 0 && <div className="empty">No posts in this date range.</div>}
                {posts?.map((p) => (
                  <button key={p.id} className="item" aria-current={target?.key === `${platform}:${p.id}`} onClick={() => openPost(p)}>
                    {p.image ? <img className="thumb" src={p.image} alt="" /> : <span className="thumb" />}
                    <span style={{ minWidth: 0 }}>
                      <span className="meta">{p.type} · {fmtDate(p.time)} · <span className="count">{p.comments}</span> comments</span>
                      <span className="text">{p.text || <em>No caption</em>}</span>
                    </span>
                  </button>
                ))}
                {postsNext && <div className="more"><button className="btn" disabled={busy} onClick={() => loadPosts(postsNext)}>Load more</button></div>}
              </div>
            </>
          ) : (
            <>
              <div className="controls">
                <div className="field">
                  <label htmlFor="adacc">Ad account</label>
                  <select id="adacc" value={adAccountId} onChange={(e) => { setAdAccountId(e.target.value); setAds(null); }}>
                    {!adAccounts && <option>Loading…</option>}
                    {adAccounts?.length === 0 && <option>No ad accounts found</option>}
                    {adAccounts?.map((a) => <option key={a.id} value={a.id}>{a.name}{a.active ? "" : " (inactive)"}</option>)}
                  </select>
                </div>
                <div className="seg" role="group" aria-label="Ad status">
                  <button aria-pressed={adStatus === "all"} onClick={() => { setAdStatus("all"); setAds(null); }}>Active + paused</button>
                  <button aria-pressed={adStatus === "active"} onClick={() => { setAdStatus("active"); setAds(null); }}>Active only</button>
                </div>
                <button className="btn primary" disabled={busy || !adAccountId} onClick={() => loadAds()}>{busy ? "Loading…" : "Show ads"}</button>
              </div>
              <div className="list">
                {error && <div className="banner err">{error}</div>}
                {!ads && !error && <div className="empty">Choose an ad account, then Show ads.</div>}
                {ads?.length === 0 && <div className="empty">No ads with this status.</div>}
                {ads?.map((ad) => (
                  <div key={ad.id} className="ad">
                    <div className={`status ${ad.status}`}>{ad.status.toLowerCase()} · {fmtDate(ad.created)}</div>
                    <div className="name">{ad.name}</div>
                    <div className="plats">
                      {ad.instagram && (ad.instagram.owned ? (
                        <button className="chip" aria-current={target?.key === `instagram:${ad.instagram.mediaId}`} onClick={() => openAd(ad, "instagram")}>Instagram · {ad.instagram.comments ?? "?"} comments</button>
                      ) : (
                        <span className="chip off" title="This ad's post is on another account, so its comments can't be read here">Instagram · on @{ad.instagram.ownerUsername || "another account"} (partner)</span>
                      ))}
                      {ad.facebook && (ad.facebook.owned ? (
                        <button className="chip" aria-current={target?.key === `facebook:${ad.facebook.postId}`} onClick={() => openAd(ad, "facebook")}>Facebook · {ad.facebook.comments ?? "?"} comments</button>
                      ) : (
                        <span className="chip off" title="This ad's post is on a Page you don't manage">Facebook · on another Page (partner)</span>
                      ))}
                      {!ad.instagram && !ad.facebook && <span className="chip off">No post found for this ad</span>}
                    </div>
                  </div>
                ))}
                {adsNext && <div className="more"><button className="btn" disabled={busy} onClick={() => loadAds(adsNext)}>Load more</button></div>}
              </div>
            </>
          )}
        </aside>

        <section className="main">
          {target ? <CommentsPanel key={target.key} target={target} /> : (
            <div className="placeholder">Pick a post or an ad to see its comments.</div>
          )}
        </section>
      </div>
    </div>
  );
}
