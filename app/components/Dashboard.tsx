"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Instagram, Facebook, CalendarDays, RefreshCw, Store, Wallet, MessageCircle, ImageIcon, Megaphone, PlugZap, Inbox } from "lucide-react";
import { api, fmtDate } from "./api";
import Shell, { type View } from "./Shell";
import CommentsPanel, { type Target } from "./CommentsPanel";
import { ToastProvider, SelectPill, Empty, ListSkeleton } from "./ui";

type PageAcc = { id: string; name: string; instagram: { id: string; username: string } | null };
type Post = { id: string; text: string; time: string; permalink: string; comments: number; type: string; image?: string };
type AdAcc = { id: string; name: string; active: boolean };
type Ad = {
  id: string; name: string; status: string; created: string;
  instagram: { mediaId: string; owned: boolean; ownerUsername: string; brandUsername: string; comments: number | null; permalink: string | null; caption: string; unreadable?: boolean; error?: string } | null;
  facebook: { postId: string; pageId: string; owned: boolean; comments: number | null; permalink: string | null; caption: string; unreadable?: boolean; error?: string } | null;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const timeNow = () => new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }).toLowerCase();
const RECONNECT = "/api/auth/login?reconnect=1";

export default function Dashboard({ userName }: { userName: string }) {
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
  const [fetchedAt, setFetchedAt] = useState("");

  // Ads
  const [adAccounts, setAdAccounts] = useState<AdAcc[] | null>(null);
  const [adAccountId, setAdAccountId] = useState("");
  const [adStatus, setAdStatus] = useState<"all" | "active">("all");
  const [ads, setAds] = useState<Ad[] | null>(null);
  const [adsNext, setAdsNext] = useState<string | null>(null);
  const [adsBusy, setAdsBusy] = useState(false);
  const [adsError, setAdsError] = useState("");
  const [adsFetchedAt, setAdsFetchedAt] = useState("");

  const [accountsError, setAccountsError] = useState("");

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

  const loadPosts = useCallback(async (after?: string) => {
    if (!page) return;
    const accountId = platform === "instagram" ? page.instagram?.id : page.id;
    if (!accountId) return;
    setPostsBusy(true); setPostsError("");
    if (!after) setPosts(null);
    try {
      const qs = new URLSearchParams({ platform, accountId, since, until, ...(after ? { after } : {}) });
      const d = await api<{ posts: Post[]; next: string | null }>(`/api/posts?${qs}`);
      setPosts((prev) => (after && prev ? [...prev, ...d.posts] : d.posts));
      setPostsNext(d.next);
      setFetchedAt(timeNow());
      if (!after && view === "posts") {
        const first = d.posts.find((p) => p.comments > 0) || d.posts[0];
        setTarget(first ? postTarget(first, platform, page) : null);
      }
    } catch (e: any) {
      setPostsError(e.message);
      setPosts([]);
    } finally { setPostsBusy(false); }
  }, [page, platform, since, until, view]);

  // Load posts automatically when the Page, platform or dates change.
  useEffect(() => {
    if (view !== "posts" || !page) return;
    const t = setTimeout(() => loadPosts(), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, platform, since, until, view, pages]);

  const loadAds = useCallback(async (after?: string) => {
    if (!adAccountId) return;
    setAdsBusy(true); setAdsError("");
    if (!after) setAds(null);
    try {
      const qs = new URLSearchParams({ adAccountId, status: adStatus, ...(after ? { after } : {}) });
      const d = await api<{ ads: Ad[]; next: string | null }>(`/api/ads?${qs}`);
      setAds((prev) => (after && prev ? [...prev, ...d.ads] : d.ads));
      setAdsNext(d.next);
      setAdsFetchedAt(timeNow());
    } catch (e: any) {
      setAdsError(e.message);
      setAds([]);
    } finally { setAdsBusy(false); }
  }, [adAccountId, adStatus]);

  useEffect(() => {
    if (view === "ads" && adAccountId) loadAds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adAccountId, adStatus, view]);

  function switchView(v: View) {
    setView(v);
    setTarget(null);
  }

  function openAd(ad: Ad, which: "instagram" | "facebook") {
    if (which === "instagram" && ad.instagram) {
      setTarget({
        key: `instagram:${ad.instagram.mediaId}`, platform: "instagram", objectId: ad.instagram.mediaId, pageId: "",
        brandUsername: ad.instagram.brandUsername, title: ad.name, caption: ad.instagram.caption, permalink: ad.instagram.permalink || "", kind: "ad",
      });
    } else if (which === "facebook" && ad.facebook) {
      setTarget({
        key: `facebook:${ad.facebook.postId}`, platform: "facebook", objectId: ad.facebook.postId, pageId: ad.facebook.pageId,
        brandUsername: "", title: ad.name, caption: ad.facebook.caption, permalink: ad.facebook.permalink || "", kind: "ad",
      });
    }
  }

  const noPages = pages?.length === 0;

  return (
    <Shell view={view} onView={switchView} userName={userName}>
      {view === "posts" ? (
        <>
          <header className="page-head">
            <div>
              <h1 className="page-title">Post comments</h1>
              <p className="page-sub">Every comment on your organic posts, sorted into Enquiry, Positive and Negative.</p>
              {fetchedAt && <div className="page-meta"><span className="live-dot" />Live from Meta · fetched at {fetchedAt}</div>}
            </div>
            <div className="controls">
              <SelectPill icon={<Store />} label="Page" value={pageId} disabled={!pages?.length}
                onChange={(v) => {
                  setPageId(v);
                  const p = pages?.find((x) => x.id === v);
                  setPlatform(p?.instagram ? platform : "facebook");
                }}>
                {!pages && <option>Loading Pages…</option>}
                {noPages && <option>No Pages connected</option>}
                {pages?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </SelectPill>
              <div className="seg" role="group" aria-label="Platform">
                <button aria-pressed={platform === "instagram"} disabled={!page?.instagram} onClick={() => setPlatform("instagram")}
                  title={page && !page.instagram ? "No Instagram account connected for this Page" : undefined}>
                  <Instagram />Instagram
                </button>
                <button aria-pressed={platform === "facebook"} onClick={() => setPlatform("facebook")}><Facebook />Facebook</button>
              </div>
              <label className="pill dates" aria-label="Date range">
                <CalendarDays />
                <input type="date" value={since} max={until} onChange={(e) => e.target.value && setSince(e.target.value)} aria-label="From" />
                <span className="dash">–</span>
                <input type="date" value={until} min={since} max={iso(new Date())} onChange={(e) => e.target.value && setUntil(e.target.value)} aria-label="To" />
              </label>
              <button className="btn btn-icon" onClick={() => loadPosts()} disabled={postsBusy || !page} aria-label="Refresh" title="Refresh from Meta">
                <RefreshCw className={postsBusy ? "spin" : undefined} />
              </button>
            </div>
          </header>

          <AccessCallout pages={pages} page={page} missingPermissions={missingPermissions} />
          {accountsError && <div className="callout danger"><div className="callout-main"><div className="callout-tag">Error</div><div className="callout-body">{accountsError}</div></div></div>}

          {noPages ? (
            <div className="card">
              <Empty icon={<PlugZap />} title="No Facebook Pages connected"
                action={<a className="btn btn-primary" href={RECONNECT}>Reconnect Facebook</a>}>
                Log in again and tick the merchant&apos;s Page, its Instagram account and your business in the Facebook pop-up.
              </Empty>
            </div>
          ) : (
            <div className="workspace">
              <section className="card list-card" aria-label="Posts">
                <div className="list-head">
                  <h3>Posts</h3>
                  <span className="count-pill">{posts ? `${posts.length}${postsNext ? "+" : ""} in range` : ""}</span>
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
                {target ? <CommentsPanel key={target.key} target={target} /> : (
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
              <p className="page-sub">Comments on the posts behind your ads, where most complaints and spam land.</p>
              {adsFetchedAt && <div className="page-meta"><span className="live-dot" />Live from Meta · fetched at {adsFetchedAt}</div>}
            </div>
            <div className="controls">
              <SelectPill icon={<Wallet />} label="Ad account" value={adAccountId} disabled={!adAccounts?.length} onChange={(v) => { setAdAccountId(v); setTarget(null); }}>
                {!adAccounts && <option>Loading ad accounts…</option>}
                {adAccounts?.length === 0 && <option>No ad accounts connected</option>}
                {adAccounts?.map((a) => <option key={a.id} value={a.id}>{a.name}{a.active ? "" : " (inactive)"}</option>)}
              </SelectPill>
              <div className="seg" role="group" aria-label="Ad status">
                <button aria-pressed={adStatus === "all"} onClick={() => setAdStatus("all")}>Active + paused</button>
                <button aria-pressed={adStatus === "active"} onClick={() => setAdStatus("active")}>Active only</button>
              </div>
              <button className="btn btn-icon" onClick={() => loadAds()} disabled={adsBusy || !adAccountId} aria-label="Refresh" title="Refresh from Meta">
                <RefreshCw className={adsBusy ? "spin" : undefined} />
              </button>
            </div>
          </header>

          <AccessCallout pages={pages} page={undefined} missingPermissions={missingPermissions} />

          {adAccounts?.length === 0 ? (
            <div className="card">
              <Empty icon={<PlugZap />} title="No ad accounts connected" action={<a className="btn btn-primary" href={RECONNECT}>Reconnect Facebook</a>}>
                Your login doesn&apos;t include any ad accounts. Reconnect and allow access to the merchant&apos;s ad account.
              </Empty>
            </div>
          ) : (
            <div className="workspace">
              <section className="card list-card" aria-label="Ads">
                <div className="list-head">
                  <h3>Ads</h3>
                  <span className="count-pill">{ads ? `${ads.length}${adsNext ? "+" : ""} ${adStatus === "active" ? "active" : "active or paused"}` : ""}</span>
                </div>
                <div className="list-body">
                  {adsError && <div className="callout danger" style={{ margin: 4 }}><div className="callout-main"><div className="callout-tag">Couldn&apos;t load ads</div><div className="callout-body">{adsError}</div></div></div>}
                  {!ads && !adsError && <ListSkeleton />}
                  {ads?.length === 0 && !adsError && <Empty small icon={<Megaphone />} title="No ads with this status" />}
                  {ads?.map((ad) => {
                    const current = target?.key === `instagram:${ad.instagram?.mediaId}` || target?.key === `facebook:${ad.facebook?.postId}`;
                    return (
                      <div key={ad.id} className={`ad-item${current ? " current" : ""}`}>
                        <div className={`status ${ad.status}`}>{ad.status.toLowerCase()} · {fmtDate(ad.created)}</div>
                        <div className="ad-name">{ad.name}</div>
                        <div className="plats">
                          {ad.instagram && (ad.instagram.unreadable ? (
                            <span className="chip off" title={ad.instagram.error}><Instagram />Can&apos;t read post</span>
                          ) : ad.instagram.owned ? (
                            <button className="chip" aria-current={target?.key === `instagram:${ad.instagram.mediaId}`} onClick={() => openAd(ad, "instagram")}>
                              <Instagram />{ad.instagram.comments ?? 0} comments
                            </button>
                          ) : (
                            <span className="chip off" title="The post belongs to the creator's Instagram account, so its comments can't be read here."><Instagram />On @{ad.instagram.ownerUsername} · partner</span>
                          ))}
                          {ad.facebook && (ad.facebook.owned ? (
                            <button className="chip" aria-current={target?.key === `facebook:${ad.facebook.postId}`} onClick={() => openAd(ad, "facebook")}>
                              <Facebook />{ad.facebook.comments ?? 0} comments
                            </button>
                          ) : (
                            <span className="chip off" title="If this is the merchant's own Page, reconnect and tick it. If it's the creator's Page, its comments can't be read."><Facebook />Page not connected</span>
                          ))}
                          {!ad.instagram && !ad.facebook && <span className="chip off">No post found</span>}
                        </div>
                        {(ad.instagram?.error || ad.facebook?.error) && <div className="ad-note" title={ad.instagram?.error || ad.facebook?.error}>{friendlyMetaError(ad.instagram?.error || ad.facebook?.error || "")}</div>}
                      </div>
                    );
                  })}
                  {adsNext && <div className="more"><button className="btn" disabled={adsBusy} onClick={() => loadAds(adsNext)}>{adsBusy ? "Loading…" : "Load more ads"}</button></div>}
                </div>
              </section>
              <section className="detail" aria-label="Comments">
                {target ? <CommentsPanel key={target.key} target={target} /> : (
                  <div className="card"><Empty icon={<Megaphone />} title="Pick an ad">Choose the Instagram or Facebook chip on an ad to see its comments.</Empty></div>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </Shell>
  );
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
    caption: p.text, permalink: p.permalink, image: p.image, kind: "post",
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
