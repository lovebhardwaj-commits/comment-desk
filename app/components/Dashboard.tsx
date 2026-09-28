"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Instagram, Facebook, RefreshCw, Store, Wallet, MessageCircle, ImageIcon, Megaphone, PlugZap, Inbox, Lock, LayoutList } from "lucide-react";
import { api, fmtDate } from "./api";
import Shell, { type View } from "./Shell";
import CommentsPanel, { type Target, type Src } from "./CommentsPanel";
import { cacheGet, cacheSet, setCacheNamespace } from "./cache";
import { ToastProvider, SelectPill, Empty, ListSkeleton } from "./ui";
import DateRange from "./DateRange";

type PageAcc = { id: string; name: string; instagram: { id: string; username: string } | null };
type Post = { id: string; text: string; time: string; permalink: string; comments: number; type: string; image?: string };
type AdAcc = { id: string; name: string; active: boolean };
type Ad = {
  id: string; name: string; status: string; created: string; image?: string | null; text?: string;
  instagram: { mediaId: string; owned: boolean; ownerUsername: string; brandUsername: string; comments: number | null; permalink: string | null; caption: string; image?: string; unreadable?: boolean; error?: string } | null;
  facebook: { postId: string; pageId: string; owned: boolean; comments: number | null; permalink: string | null; caption: string; image?: string; unreadable?: boolean; error?: string } | null;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const timeNow = () => new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }).toLowerCase();
const RECONNECT = "/api/auth/login?reconnect=1";

export default function Dashboard({ userName, userId }: { userName: string; userId?: string }) {
  setCacheNamespace(userId || "");
  return (
    <ToastProvider>
      <App userName={userName} />
    </ToastProvider>
  );
}

function App({ userName }: { userName: string }) {
  const [view, setView] = useState<View>("posts");
  const [target, setTarget] = useState<Target | null>(null);

  // Accounts
  const [pages, setPages] = useState<PageAcc[] | null>(null);
  const [missingPermissions, setMissingPermissions] = useState<string[]>([]);
  const [pageId, setPageId] = useState("");
  const [platform, setPlatform] = useState<"instagram" | "facebook">("instagram");
  const [since, setSince] = useState(iso(new Date(Date.now() - 30 * 864e5)));
  const [until, setUntil] = useState(iso(new Date()));

  // Posts
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [postsNext, setPostsNext] = useState<string | null>(null);
  const [postsBusy, setPostsBusy] = useState(false);
  const [postsError, setPostsError] = useState("");
  const [, setFetchedAt] = useState("");

  // Ads
  const [adAccounts, setAdAccounts] = useState<AdAcc[] | null>(null);
  const [adAccountId, setAdAccountId] = useState("");
  const [adStatus, setAdStatus] = useState<"all" | "active">("active");
  const [ads, setAds] = useState<Ad[] | null>(null);
  const [adsNext, setAdsNext] = useState<string | null>(null);
  const [adsBusy, setAdsBusy] = useState(false);
  const [adsError, setAdsError] = useState("");
  const [, setAdsFetchedAt] = useState("");
  const [adId, setAdId] = useState("");
  const [showLocked, setShowLocked] = useState(false);

  const [accountsError, setAccountsError] = useState("");

  // "All comments" is the default way in, so every comment can be handled in one pass.
  const [postsMode, setPostsMode] = useState<"inbox" | "list">("inbox");
  const [adsMode, setAdsMode] = useState<"inbox" | "list">("inbox");
  // Time window for "All comments": a preset (anchored to when it was picked or refreshed) or a custom date range.
  const [preset, setPreset] = useState<1 | 7 | 14 | "custom">(7);
  const [stamp, setStamp] = useState(() => Date.now());
  const [rangeFrom, setRangeFrom] = useState(iso(new Date(Date.now() - 7 * 864e5)));
  const [rangeTo, setRangeTo] = useState(iso(new Date()));
  const [inboxNonce, setInboxNonce] = useState(0);
  // Goes up when the person picks a time window or dates: the moment the app should check Meta again.
  const [checkReq, setCheckReq] = useState(0);
  const postsForce = useRef(false);
  const [panelNonce, setPanelNonce] = useState(0);
  const pendingTarget = useRef<Target | null>(null);

  useEffect(() => {
    api<{ pages: PageAcc[]; missingPermissions: string[] }>("/api/accounts")
      .then((d) => {
        setPages(d.pages);
        setMissingPermissions(d.missingPermissions || []);
        const first = d.pages.find((p) => p.instagram) || d.pages[0];
        if (first) {
          setPageId(first.id);
          setPlatform(first.instagram ? "instagram" : "facebook");
        }
      })
      .catch((e) => setAccountsError(e.message));
  }, []);

  useEffect(() => {
    if (view === "ads" && !adAccounts) {
      api<{ adAccounts: AdAcc[] }>("/api/adaccounts")
        .then((d) => {
          setAdAccounts(d.adAccounts);
          const first = d.adAccounts.find((a) => a.active) || d.adAccounts[0];
          if (first) setAdAccountId(first.id);
        })
        .catch((e) => setAdsError(e.message));
    }
  }, [view, adAccounts]);

  const page = useMemo(() => pages?.find((p) => p.id === pageId), [pages, pageId]);

  const win = useMemo(() => {
    if (preset !== "custom") {
      const label = preset === 1 ? "last 24 hours" : `last ${preset} days`;
      return { sinceMs: stamp - preset * 864e5, untilMs: stamp + 60_000, label, phrase: `in the ${label}`, id: `p${preset}` };
    }
    const from = new Date(`${rangeFrom}T00:00:00`).getTime();
    const to = Math.min(new Date(`${rangeTo}T23:59:59.999`).getTime(), Date.now() + 60_000);
    const f = (ms: number) => new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    return { sinceMs: from, untilMs: to, label: `${f(from)} – ${f(to)}`, phrase: `between ${f(from)} and ${f(to)}`, id: `c${rangeFrom}_${rangeTo}` };
  }, [preset, stamp, rangeFrom, rangeTo]);

  /** Loads posts. Shows the cached list straight away (if any), then replaces it with Meta's current list. */
  const loadPosts = useCallback(async (after?: string, force = false) => {
    if (!page) return;
    const accountId = platform === "instagram" ? page.instagram?.id : page.id;
    if (!accountId) return;
    setPostsBusy(true); setPostsError("");
    const key = `posts:${platform}:${accountId}:${since}:${until}`;
    let shown = false;
    const pickTarget = (list: Post[]) => {
      if (view !== "posts") return;
      if (pendingTarget.current) {
        setTarget(pendingTarget.current);
        pendingTarget.current = null;
        return;
      }
      setTarget((cur) => {
        // Keep the open post if it's still in the list, with its latest comment count.
        const still = cur && list.find((p) => `${platform}:${p.id}` === cur.key);
        if (still) {
          // New comments on the open post since it was cached: refresh it.
          if (cur!.count !== undefined && still.comments !== cur!.count) setPanelNonce((n) => n + 1);
          return { ...cur!, count: still.comments };
        }
        const first = list.find((p) => p.comments > 0) || list[0];
        return first ? postTarget(first, platform, page) : null;
      });
    };
    if (!after) {
      const c = await cacheGet<{ posts: Post[]; next: string | null }>(key);
      if (c) {
        setPosts(c.value.posts); setPostsNext(c.value.next); pickTarget(c.value.posts); shown = true;
        // Saved list is used as is. Meta is only asked on Refresh or when new dates are picked.
        if (!force) { setPostsBusy(false); return; }
      } else setPosts(null);
    }
    try {
      const qs = new URLSearchParams({ platform, accountId, since, until, ...(after ? { after } : {}) });
      const d = await api<{ posts: Post[]; next: string | null }>(`/api/posts?${qs}`);
      setPosts((prev) => (after && prev ? [...prev, ...d.posts] : d.posts));
      setPostsNext(d.next);
      setFetchedAt(timeNow());
      if (!after) { cacheSet(key, d); pickTarget(d.posts); }
    } catch (e: any) {
      if (!shown) { setPostsError(e.message); setPosts([]); }
    } finally { setPostsBusy(false); }
  }, [page, platform, since, until, view]);

  // Load posts automatically when the Page, platform or dates change.
  useEffect(() => {
    if (view !== "posts" || !page || postsMode !== "list") return;
    const force = postsForce.current;
    postsForce.current = false;
    const t = setTimeout(() => loadPosts(undefined, force), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, platform, since, until, view, pages, postsMode]);

  /** Loads ads. A saved list is used as is; Meta is asked when nothing is saved, or on Refresh. */
  const loadAds = useCallback(async (after?: string, force = false) => {
    if (!adAccountId) return;
    setAdsBusy(true); setAdsError("");
    const key = `ads:${adAccountId}:${adStatus}`;
    let shown = false;
    if (!after) {
      const c = await cacheGet<{ ads: Ad[]; next: string | null }>(key);
      if (c && !force) {
        // Saved list is used as is. Meta is only asked on Refresh.
        setAds(c.value.ads); setAdsNext(c.value.next); shown = true;
        setAdsFetchedAt(new Date(c.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }).toLowerCase()); setAdsBusy(false); return;
      } else if (!c) { setAds(null); setAdId(""); setTarget(null); }
    }
    try {
      const qs = new URLSearchParams({ adAccountId, status: adStatus, ...(after ? { after } : {}) });
      const d = await api<{ ads: Ad[]; next: string | null }>(`/api/ads?${qs}`);
      setAds((prev) => (after && prev ? [...prev, ...d.ads] : d.ads));
      setAdsNext(d.next);
      setAdsFetchedAt(timeNow());
      if (!after) cacheSet(key, d);
    } catch (e: any) {
      if (!shown) { setAdsError(e.message); setAds([]); }
    } finally { setAdsBusy(false); }
  }, [adAccountId, adStatus]);

  useEffect(() => {
    if (view === "ads" && adAccountId && adsMode === "list") loadAds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adAccountId, adStatus, view, adsMode]);

  function switchView(v: View) {
    setView(v);
    setTarget(null);
    setAdId("");
  }

  function openAd(ad: Ad, which: "instagram" | "facebook") {
    setAdId(ad.id);
    const title = `${statusLabel(ad.status)} ad · ${ad.name}`;
    if (which === "instagram" && ad.instagram) {
      setTarget({
        key: `instagram:${ad.instagram.mediaId}`, platform: "instagram", objectId: ad.instagram.mediaId, pageId: "",
        brandUsername: ad.instagram.brandUsername, title, caption: ad.instagram.caption || ad.text || ad.name, permalink: ad.instagram.permalink || "",
        image: ad.image || ad.instagram.image, kind: "ad", count: ad.instagram.comments ?? undefined,
      });
    } else if (which === "facebook" && ad.facebook) {
      setTarget({
        key: `facebook:${ad.facebook.postId}`, platform: "facebook", objectId: ad.facebook.postId, pageId: ad.facebook.pageId,
        brandUsername: "", title, caption: ad.facebook.caption || ad.text || ad.name, permalink: ad.facebook.permalink || "",
        image: ad.image || ad.facebook.image, kind: "ad", count: ad.facebook.comments ?? undefined,
      });
    }
  }

  /** Opens an ad on the placement with the most comments. */
  function openAdCard(ad: Ad) {
    const places = adPlacements(ad).sort((a, b) => (b.comments || 0) - (a.comments || 0));
    if (places[0]) openAd(ad, places[0].platform);
  }

  const readableAds = useMemo(() => (ads || []).filter((a) => adPlacements(a).length > 0)
    .sort((a, b) => adPlacements(b).reduce((n, p) => n + (p.comments || 0), 0) - adPlacements(a).reduce((n, p) => n + (p.comments || 0), 0)), [ads]);
  const lockedAds = useMemo(() => (ads || []).filter((a) => adPlacements(a).length === 0), [ads]);
  const shownAds = showLocked ? [...readableAds, ...lockedAds] : readableAds;
  const currentAd = ads?.find((a) => a.id === adId);

  // Open the ad with the most comments once ads load (or the ad chosen from the inbox).
  useEffect(() => {
    if (view === "ads" && adsMode === "list" && ads && pendingTarget.current) {
      const t = pendingTarget.current;
      pendingTarget.current = null;
      const ad = ads.find((a) => a.id === (t as any).adId);
      if (ad) { openAd(ad, t.platform); return; }
      // Not in the ads loaded so far: open the post the comment came from directly, on the same platform.
      setAdId("");
      setTarget(t);
      return;
    }
    if (view === "ads" && adsMode === "list" && ads && !adId && readableAds[0]) openAdCard(readableAds[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ads, view, adsMode]);

  /** Inbox specs: every comment in the chosen window, for the brand's posts or the ad account's ads. */
  const postsInbox = page ? {
    key: `inbox:posts:${page.id}:${win.id}`, cacheKey: `inbox:posts:${page.id}`, refresh: inboxNonce, checkReq,
    sinceMs: win.sinceMs, untilMs: win.untilMs, label: win.label, phrase: win.phrase,
    scope: `${page.name} · ${page.instagram ? "Instagram and Facebook" : "Facebook"} posts`,
    targetsUrl: `/api/inbox/targets?${new URLSearchParams({ source: "posts", pageId: page.id, since: String(win.sinceMs) })}`,
    onFetched: () => setFetchedAt(timeNow()),
    onOpen: (src: Src) => {
      // Jump to this post in the "By post" view.
      pendingTarget.current = { key: `${src.platform}:${src.objectId}`, platform: src.platform, objectId: src.objectId, pageId: page.id,
        brandUsername: src.brandUsername, title: src.label, caption: src.caption, permalink: src.permalink || "", image: src.image || undefined, kind: "post" };
      setPlatform(src.platform);
      setPostsMode("list");
    },
  } : undefined;
  const adAccountName = adAccounts?.find((a) => a.id === adAccountId)?.name || "";
  const adsInbox = adAccountId ? {
    key: `inbox:ads:${adAccountId}:${adStatus}:${win.id}`, cacheKey: `inbox:ads:${adAccountId}:${adStatus}`, noun: "ad" as const, refresh: inboxNonce, checkReq, status: adStatus,
    sinceMs: win.sinceMs, untilMs: win.untilMs, label: win.label, phrase: win.phrase,
    scope: `${adAccountName} · ${adStatus === "active" ? "active" : "active and paused"} ads on Instagram and Facebook`,
    targetsUrl: `/api/inbox/targets?${new URLSearchParams({ source: "ads", adAccountId, status: adStatus, since: String(win.sinceMs) })}`,
    onFetched: () => setAdsFetchedAt(timeNow()),
    onOpen: (src: Src) => {
      pendingTarget.current = { key: `${src.platform}:${src.objectId}`, platform: src.platform, objectId: src.objectId, pageId: src.pageId,
        brandUsername: src.brandUsername, title: `Ad · ${src.label}`, caption: src.caption, permalink: src.permalink || "", image: src.image || undefined, kind: "ad", ...( { adId: src.adId } as any) };
      setAdId("");
      setAdsMode("list");
    },
  } : undefined;

  const ModeTabs = ({ mode, setMode, listLabel }: { mode: "inbox" | "list"; setMode: (m: "inbox" | "list") => void; listLabel: string }) => (
    <div className="mode-tabs">
      <div className="seg" role="tablist" aria-label="View">
        <button role="tab" aria-pressed={mode === "inbox"} onClick={() => setMode("inbox")}><Inbox />All comments</button>
        <button role="tab" aria-pressed={mode === "list"} onClick={() => setMode("list")}><LayoutList />{listLabel}</button>
      </div>
    </div>
  );

  // Rendered as an element (not a component) so it keeps its state across renders.
  const daysSeg = (
    <div className="seg" role="group" aria-label="Time window">
      {([1, 7, 14] as const).map((d) => (
        <button key={d} aria-pressed={preset === d} onClick={() => { setPreset(d); setStamp(Date.now()); setCheckReq((n) => n + 1); }}>{d === 1 ? "24 hours" : `${d} days`}</button>
      ))}
    </div>
  );
  const customRange = (
    <DateRange from={rangeFrom} to={rangeTo} active={preset === "custom"}
      onApply={(f, t) => { setRangeFrom(f); setRangeTo(t); setPreset("custom"); setCheckReq((n) => n + 1); }} />
  );
  const refreshBtn = (busy: boolean, onClick: () => void) => (
    <button className="btn" onClick={onClick} disabled={busy} title="Check Meta for new comments">
      <RefreshCw className={busy ? "spin" : undefined} />Refresh
    </button>
  );

  const noPages = pages?.length === 0;

  return (
    <Shell view={view} onView={switchView} userName={userName}>
      {view === "posts" ? (
        <>
          <header className="page-head">
            <div>
              <h1 className="page-title">Post comments</h1>
              <p className="page-sub">{postsMode === "inbox" ? "Every new comment across your Instagram and Facebook posts, in one place." : "Every comment on your organic posts, sorted into Enquiry, Positive and Negative."}</p>
            </div>
            <div className="controls">
              <SelectPill icon={<Store />} label="Page" title={page?.name} value={pageId} disabled={!pages?.length}
                onChange={(v) => {
                  setPageId(v);
                  const p = pages?.find((x) => x.id === v);
                  setPlatform(p?.instagram ? platform : "facebook");
                }}>
                {!pages && <option>Loading Pages…</option>}
                {noPages && <option>No Pages connected</option>}
                {pages?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </SelectPill>
            </div>
          </header>

          <div className="filterbar">
            <ModeTabs mode={postsMode} setMode={(m) => { setPostsMode(m); if (m === "inbox") setTarget(null); }} listLabel="By post" />
            <span className="spacer" />
            {postsMode === "inbox" ? (<>{daysSeg}{customRange}</>) : (
              <DateRange from={since} to={until} active label="Dates" maxDaysBack={365}
                onApply={(f, t) => { postsForce.current = true; setSince(f); setUntil(t); if (f === since && t === until) loadPosts(undefined, true); }} />
            )}
            {refreshBtn(postsBusy || !page, () => { if (postsMode === "inbox") { setStamp(Date.now()); setInboxNonce((n) => n + 1); } else { loadPosts(undefined, true); setPanelNonce((n) => n + 1); } })}
          </div>

          <AccessCallout pages={pages} page={page} missingPermissions={missingPermissions} />
          {accountsError && <div className="callout danger"><div className="callout-main"><div className="callout-tag">Error</div><div className="callout-body">{accountsError}</div></div></div>}

          {noPages ? (
            <div className="card">
              <Empty icon={<PlugZap />} title="No Facebook Pages connected"
                action={<a className="btn btn-primary" href={RECONNECT}>Reconnect Facebook</a>}>
                Log in again and tick the merchant&apos;s Page, its Instagram account and your business in the Facebook pop-up.
              </Empty>
            </div>
          ) : postsMode === "inbox" ? (
            <div className="workspace single">
              <section className="detail" aria-label="All comments">
                {postsInbox ? <CommentsPanel key={postsInbox.key} inbox={postsInbox} /> : <div className="card"><Empty icon={<Inbox />} title="Loading Pages…" /></div>}
              </section>
            </div>
          ) : (
            <div className="workspace">
              <section className="card list-card" aria-label="Posts">
                <div className="list-head">
                  <h3>Posts <span className="count-pill">{posts ? `· ${posts.length}${postsNext ? "+" : ""}` : ""}</span></h3>
                  <div className="seg sm" role="group" aria-label="Platform">
                    <button aria-pressed={platform === "instagram"} disabled={!page?.instagram} onClick={() => setPlatform("instagram")}
                      title={page && !page.instagram ? "No Instagram account connected for this Page" : undefined}>
                      <Instagram />Instagram
                    </button>
                    <button aria-pressed={platform === "facebook"} onClick={() => setPlatform("facebook")}><Facebook />Facebook</button>
                  </div>
                </div>
                <div className="list-body">
                  {postsError && <div className="callout danger" style={{ margin: 4 }}><div className="callout-main"><div className="callout-tag">Couldn&apos;t load posts</div><div className="callout-body">{postsError}</div></div></div>}
                  {!posts && <ListSkeleton />}
                  {posts?.length === 0 && !postsError && (
                    <Empty small icon={<Inbox />} title="No posts in this range">Try a wider date range.</Empty>
                  )}
                  {posts?.map((p) => {
                    const key = `${platform}:${p.id}`;
                    return (
                      <button key={p.id} className="post" aria-current={target?.key === key} onClick={() => page && setTarget(postTarget(p, platform, page))}>
                        {p.image ? <img className="thumb" src={p.image} alt="" loading="lazy" /> : <span className="thumb"><ImageIcon /></span>}
                        <span className="post-body">
                          <span className="post-meta">
                            <span>{p.type}</span>·<span>{fmtDate(p.time)}</span>·
                            <span className="comment-count"><MessageCircle />{p.comments}</span>
                          </span>
                          <span className="post-text">{p.text || "No caption"}</span>
                        </span>
                      </button>
                    );
                  })}
                  {postsNext && <div className="more"><button className="btn" disabled={postsBusy} onClick={() => loadPosts(postsNext)}>{postsBusy ? "Loading…" : "Load more posts"}</button></div>}
                </div>
              </section>

              <section className="detail" aria-label="Comments">
                {target ? <CommentsPanel key={target.key} target={target} refresh={panelNonce} /> : (
                  posts && posts.length > 0 ? (
                    <div className="card"><Empty icon={<MessageCircle />} title="Pick a post">Choose a post on the left to see and moderate its comments.</Empty></div>
                  ) : posts ? null : <div className="card"><Empty icon={<MessageCircle />} title="Loading posts…" /></div>
                )}
              </section>
            </div>
          )}
        </>
      ) : (
        <>
          <header className="page-head">
            <div>
              <h1 className="page-title">Ad comments</h1>
              <p className="page-sub">{adsMode === "inbox" ? "Every new comment across all your ads, in one place." : "Comments on the posts behind your ads, where most complaints and spam land."}</p>
            </div>
            <div className="controls">
              <SelectPill icon={<Wallet />} label="Ad account" title={adAccounts?.find((a) => a.id === adAccountId)?.name} value={adAccountId} disabled={!adAccounts?.length} onChange={(v) => { setAdAccountId(v); setTarget(null); setAdId(""); }}>
                {!adAccounts && <option>Loading ad accounts…</option>}
                {adAccounts?.length === 0 && <option>No ad accounts connected</option>}
                {adAccounts?.map((a) => <option key={a.id} value={a.id}>{a.name}{a.active ? "" : " (inactive)"}</option>)}
              </SelectPill>
            </div>
          </header>

          <div className="filterbar">
            <ModeTabs mode={adsMode} setMode={(m) => { setAdsMode(m); if (m === "inbox") { setTarget(null); setAdId(""); } }} listLabel="By ad" />
            <span className="spacer" />
            <div className="seg" role="group" aria-label="Ad status">
              <button aria-pressed={adStatus === "active"} onClick={() => setAdStatus("active")} title="Delivering, in review or with issues">Active</button>
              <button aria-pressed={adStatus === "all"} onClick={() => setAdStatus("all")} title="Also ads paused directly or through their campaign or ad set">+ Paused</button>
            </div>
            {adsMode === "inbox" && (<>{daysSeg}{customRange}</>)}
            {refreshBtn(adsBusy || !adAccountId, () => { if (adsMode === "inbox") { setStamp(Date.now()); setInboxNonce((n) => n + 1); } else { loadAds(undefined, true); setPanelNonce((n) => n + 1); } })}
          </div>

          <AccessCallout pages={pages} page={undefined} missingPermissions={missingPermissions} />

          {adAccounts?.length === 0 ? (
            <div className="card">
              <Empty icon={<PlugZap />} title="No ad accounts connected" action={<a className="btn btn-primary" href={RECONNECT}>Reconnect Facebook</a>}>
                Your login doesn&apos;t include any ad accounts. Reconnect and allow access to the merchant&apos;s ad account.
              </Empty>
            </div>
          ) : adsMode === "inbox" ? (
            <div className="workspace single">
              <section className="detail" aria-label="All ad comments">
                {adsInbox ? <CommentsPanel key={adsInbox.key} inbox={adsInbox} /> : <div className="card"><Empty icon={<Inbox />} title="Loading ad accounts…" /></div>}
              </section>
            </div>
          ) : (
            <div className="workspace">
              <section className="card list-card" aria-label="Ads">
                <div className="list-head">
                  <h3>Ads <span className="count-pill">{ads ? `· ${readableAds.length}${adsNext ? "+" : ""}` : ""}</span></h3>
                </div>
                {ads && lockedAds.length > 0 && (
                  <div className="list-sub">
                    <span>{lockedAds.length} partner {lockedAds.length === 1 ? "ad" : "ads"} can&apos;t be read</span>
                    <label className="toggle">
                      <input type="checkbox" checked={showLocked} onChange={(e) => setShowLocked(e.target.checked)} />
                      <span className="track" />Show
                    </label>
                  </div>
                )}
                <div className="list-body">
                  {adsError && <div className="callout danger" style={{ margin: 4 }}><div className="callout-main"><div className="callout-tag">Couldn&apos;t load ads</div><div className="callout-body">{adsError}</div></div></div>}
                  {!ads && !adsError && <ListSkeleton />}
                  {ads && readableAds.length === 0 && !showLocked && !adsError && (
                    <Empty small icon={<Megaphone />} title={ads.length ? "No readable ads here" : "No ads with this status"}>
                      {ads.length ? "All ads in this list run from partner accounts. Turn on “Show” above to see why." : adStatus === "active" ? "Try “+ Paused”." : undefined}
                    </Empty>
                  )}
                  {shownAds.map((ad) => {
                    const locked = !adPlacements(ad).length;
                    const total = adPlacements(ad).reduce((n, p) => n + (p.comments || 0), 0);
                    return (
                      <button key={ad.id} className={`ad-card${locked ? " locked" : ""}`} aria-current={adId === ad.id}
                        onClick={() => !locked && openAdCard(ad)} title={locked ? lockReason(ad) : undefined} aria-disabled={locked}>
                        {ad.image ? <img className="thumb" src={ad.image} alt="" loading="lazy" /> : <span className="thumb"><Megaphone /></span>}
                        <span className="post-body">
                          <span className="post-meta">
                            <span className={`status ${statusKind(ad.status)}`} title={ad.status}>{statusLabel(ad.status)}</span>·
                            <span className="ad-places">
                              {ad.instagram && <Instagram />}{ad.facebook && <Facebook />}
                            </span>·
                            <span className="comment-count"><MessageCircle />{locked ? "–" : total}</span>
                          </span>
                          <span className="post-text">{ad.text || ad.name}</span>
                          {ad.text && <span className="ad-code" title={ad.name}>{ad.name}</span>}
                          {locked && <span className="lock-note"><Lock />{lockReason(ad)}</span>}
                        </span>
                      </button>
                    );
                  })}
                  {adsNext && <div className="more"><button className="btn" disabled={adsBusy} onClick={() => loadAds(adsNext)}>{adsBusy ? "Loading…" : "Load more ads"}</button></div>}
                </div>
              </section>
              <section className="detail" aria-label="Comments">
                {target && !currentAd ? (
                  <CommentsPanel key={target.key} target={target} refresh={panelNonce} />
                ) : target && currentAd ? (
                  <CommentsPanel key={target.key} target={target} refresh={panelNonce} headerExtra={adPlacements(currentAd).length > 1 ? (
                    <div className="seg sm" role="group" aria-label="Placement">
                      {adPlacements(currentAd).map((p) => (
                        <button key={p.platform} aria-pressed={target.platform === p.platform} onClick={() => openAd(currentAd, p.platform)}>
                          {p.platform === "instagram" ? <Instagram /> : <Facebook />}
                          {p.platform === "instagram" ? "Instagram" : "Facebook"} · {p.comments ?? 0}
                        </button>
                      ))}
                    </div>
                  ) : undefined} />
                ) : ads && readableAds.length > 0 ? (
                  <div className="card"><Empty icon={<Megaphone />} title="Pick an ad">Choose an ad on the left to see and moderate its comments.</Empty></div>
                ) : ads ? null : <div className="card"><Empty icon={<Megaphone />} title="Loading ads…" /></div>}
              </section>
            </div>
          )}
        </>
      )}
    </Shell>
  );
}

/** Plain-English ad status. "Campaign paused" etc. are ads Meta stopped because their campaign or ad set was paused. */
function statusLabel(s: string) {
  return ({ ACTIVE: "Active", WITH_ISSUES: "Active · issues", IN_PROCESS: "Processing", PENDING_REVIEW: "In review",
    PAUSED: "Paused", CAMPAIGN_PAUSED: "Campaign paused", ADSET_PAUSED: "Ad set paused" } as Record<string, string>)[s] || s.toLowerCase();
}
function statusKind(s: string) {
  return s === "ACTIVE" ? "ACTIVE" : s === "WITH_ISSUES" || s === "PENDING_REVIEW" || s === "IN_PROCESS" ? "WARN" : "";
}

type Placement = { platform: "instagram" | "facebook"; comments: number | null };

/** Placements of an ad whose comments this login can read. */
function adPlacements(ad: Ad): Placement[] {
  const out: Placement[] = [];
  if (ad.instagram && ad.instagram.owned && !ad.instagram.unreadable) out.push({ platform: "instagram", comments: ad.instagram.comments });
  if (ad.facebook && ad.facebook.owned && !ad.facebook.unreadable) out.push({ platform: "facebook", comments: ad.facebook.comments });
  return out;
}

function lockReason(ad: Ad) {
  if (ad.instagram?.error || ad.facebook?.error) return friendlyMetaError(ad.instagram?.error || ad.facebook?.error || "");
  if (ad.instagram && !ad.instagram.owned && ad.instagram.ownerUsername) return `Runs from @${ad.instagram.ownerUsername}'s account (partnership ad), so its comments belong to them.`;
  if (ad.facebook && !ad.facebook.owned) return "The Facebook Page behind this ad isn't connected. If it's the merchant's Page, reconnect and tick it.";
  return "No post found for this ad.";
}

/** Turns Meta's error messages into something a person can act on. */
function friendlyMetaError(msg: string) {
  if (/#10\b|#200\b|permission/i.test(msg)) return "Your login can't open this post. It's probably on the creator's account (partnership ad), or the merchant's Instagram wasn't ticked at login.";
  if (/#100\b|does not exist|nonexisting/i.test(msg)) return "Meta says this post no longer exists or was never published.";
  if (/#4\b|#17\b|#613\b|limit/i.test(msg)) return "Meta is rate-limiting requests. Wait a minute and refresh.";
  return `Meta: ${msg}`;
}

function postTarget(p: Post, platform: "instagram" | "facebook", page: PageAcc): Target {
  return {
    key: `${platform}:${p.id}`, platform, objectId: p.id, pageId: page.id,
    brandUsername: page.instagram?.username || "", title: `${p.type} · ${fmtDate(p.time)}`,
    caption: p.text, permalink: p.permalink, image: p.image, kind: "post", count: p.comments,
  };
}

const PERMISSION_PURPOSE: Record<string, string> = {
  pages_show_list: "list your Pages",
  pages_read_engagement: "read posts",
  pages_read_user_content: "read Facebook comments",
  pages_manage_engagement: "hide Facebook comments",
  business_management: "see accounts shared with your business",
  instagram_basic: "read Instagram posts",
  instagram_manage_comments: "read and hide Instagram comments",
  ads_read: "see ads and ad accounts",
};

/** Explains missing permissions, or a selected Page without Instagram, with a one-click fix. */
function AccessCallout({ pages, page, missingPermissions }: { pages: PageAcc[] | null; page?: PageAcc; missingPermissions: string[] }) {
  if (!pages) return null;
  if (missingPermissions.length) {
    return (
      <div className="callout warn">
        <div className="callout-main">
          <div className="callout-tag">Access</div>
          <div className="callout-title">Some access wasn&apos;t granted</div>
          <div className="callout-body">
            Comment Pulse can&apos;t {missingPermissions.map((p) => PERMISSION_PURPOSE[p] || p).join(", ")}.
            <div className="action">→ Reconnect and allow everything in the Facebook pop-up.</div>
          </div>
        </div>
        <a className="btn btn-sm" href={RECONNECT}>Reconnect</a>
      </div>
    );
  }
  if (page && !page.instagram) {
    return (
      <div className="callout warn">
        <div className="callout-main">
          <div className="callout-tag">Instagram</div>
          <div className="callout-title">No Instagram account for {page.name}</div>
          <div className="callout-body">
            Either this Page has no Instagram professional account linked, or it wasn&apos;t ticked when you logged in. Facebook posts still work.
            <div className="action">→ If the merchant has Instagram, reconnect and tick it.</div>
          </div>
        </div>
        <a className="btn btn-sm" href={RECONNECT}>Reconnect</a>
      </div>
    );
  }
  return null;
}
