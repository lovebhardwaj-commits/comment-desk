# Comment Pulse: project file

This file describes everything Comment Pulse does today, how it works, what's known to be missing, and what's planned next. **It is updated in the same change as every code update**, so it should always match the live app.

- **Live app:** https://comment-desk.vercel.app
- **Code:** https://github.com/lovebhardwaj-commits/comment-desk
- **Setup steps** (Meta app, Vercel, environment variables): see `README.md`
- **Last updated:** 29 Sept 2026

---

## 1. What it is

Comment Pulse is a tool for the Fastrr Ads team to handle comments on merchants' **Instagram and Facebook posts and ads** in one place. Every comment is sorted into **Enquiry, Positive or Negative** (negatives also get a type: complaint, criticism or spam), so the team can reply to buyers quickly and hide what shouldn't stay public.

Nothing happens automatically. Comments are only hidden or replied to when someone clicks the button.

---

## 2. What you can do today

### Viewing comments
- **Post comments** and **Ad comments** are separate sections in the sidebar.
- **Start screen:** Post comments → All comments. Clicking the **Comment Pulse logo** always returns here (it will point to the homepage once there is one).
- **Back:** an **← Back** button above the page title returns to the previous screen, and the browser's own Back/Forward buttons move between screens too, instead of leaving the app. Going back reuses the saved comments, so nothing is fetched again. Clicking through posts inside *By post / By ad* doesn't add Back steps. The screen is kept in the address (e.g. `?view=ads&mode=by-ad`), so reloading stays on it.
- Each has two views:
  - **All comments**: every comment in a time window across all posts (or all ads), newest first. This is the default.
  - **By post / By ad**: pick one post or ad and see all its comments.
- **Time window** (All comments): 24 hours, 7 days, 14 days, or a custom date range (up to 90 days back).
- **Ads filter:** *Active* (delivering, in review or with issues) or *+ Paused* (also ads paused directly or through their campaign or ad set).
- **Filters:** by category (the cards at the top), by platform (Instagram / Facebook), by search text, newest or oldest first, show or hide already-hidden comments, show or hide the brand's own replies.
- **Each comment shows** who wrote it, when, which post or ad it's on, its category, and tags like *Hidden*, *Brand replied*. Clicking the post opens exactly that post on the same platform in *By post / By ad*.
- **Names:** Instagram usernames always show. Facebook names only show when Meta provides them (see *Known limits*); otherwise the comment says "Facebook user".

### What the numbers mean
- **Open** = customer comments that are still visible. Hidden comments and the brand's own replies are not counted as open. The line under it only appears when it adds something: *"of 1,040 on Instagram"* for a single post, or *"12 hidden not counted"*.
- Under a post's header, a line adds everything up to Meta's own count, for example:
  *1,040 on Instagram = 557 open + 3 hidden + 478 brand replies + 2 not returned by Meta.*
  "Not returned by Meta" are comments Meta counts but doesn't give to apps (usually deleted, or from restricted or private accounts). It turns amber if it's large.
- **Enquiry / Positive / Negative / To review** cards show counts of open comments and their share.

### Acting on comments
- **Hide / Unhide** a single comment. Meta is asked to confirm each hide; confirmed ones show *Hidden · confirmed*. Hidden means hidden from the public: **the person who wrote the comment, their friends, and the Page's admins still see it** (admins see it greyed out). To check a hide, view the post logged out or from an unrelated account, or run the check in the Activity log.
- **Select several and hide** them together, with **Undo**.
- **Hide all negative**: hides every negative comment in view, in batches of 50, after a confirmation that shows the split (complaints, criticism, spam) and offers to skip complaints so they can be answered first.
- **Reply** (new): reply publicly as the brand to any comment.
  - Replies to a reply go into the same thread; on Instagram they start with @username automatically.
  - **Saved replies**: one-click ready answers you can edit before sending; add your own with *Save as quick reply*, remove with ×. Saved in this browser.
  - **Reply & hide** on negative comments: posts the reply, then hides the comment.
  - The reply appears under the comment straight away and the comment is tagged *Brand replied*.
- **Correct a category**: change it from the dropdown on the comment. The comment moves to its new category, and the built-in model learns from the correction.

### Downloading comments (CSV)
- **Download CSV** (next to Newest/Oldest) saves exactly the comments on screen: the chosen time window (24 hours, 7 days, 14 days or custom) and any category, platform or search filter. Brand replies are left out.
- **One row per comment**, with the people who commented most at the top. Columns: `commenter, platform, comments_by_this_person, date, comment, bucket, type, needs_review, post_or_ad, link, hidden, brand_replied, is_reply, replying_to`.
- *Bucket* is Enquiry, Positive or Negative; *type* is complaint, criticism or spam for negatives.
- Facebook commenters show as *"Facebook user (name not shared by Meta)"* until App Review is approved; they can't be counted per person.
- Opens correctly in Excel and Google Sheets (Hindi and emoji included). Comments that look like formulas are made safe.
- If the data on screen is incomplete (limits hit, comments withheld by Meta) or filtered, a **note on the last line** of the file says so.

### Staying informed
- **Status line** on every view: how fresh the data is, e.g. *Saved at 12:23 pm · press Refresh to check for new comments*, or how many posts were just updated.
- **Refresh button** (labelled) next to the date controls: the one-click way to get the latest comments.
- **Fetching overlay**: whenever the app is talking to Meta, the comments are dimmed and a card in the middle shows progress, so nobody acts on data that's about to change.
- **Coverage and notes** (All comments, ads): one line saying how many ads were checked and how many had comments on each platform. Anything missed sits behind one button, *"Some comments couldn't be loaded · N things to check"*; each note says what to do (e.g. which Page ID needs access or a role check).
- **Activity log** (sidebar): every failure, gap or refused request, with the post ID, Page ID and Meta's exact response. Each entry also has **Graph API checks** you can run yourself: an *Open in Graph API Explorer* link (pick the Page, press Submit) and a *Copy curl* command. Access tokens are never put in the log; the curl uses a placeholder. *Copy all* puts everything on the clipboard to send for a fix. Kept for 24 hours in this browser.
- **Diagnostic page** for one post: `/api/diagnose/comments?platform=facebook|instagram&objectId=…` shows exactly what Meta returns (counts, first page, whether names are included). Linked from gap warnings.

---

## 3. How it works (plain words)

1. **Login**: people log in with Facebook. The app only sees the Pages, Instagram accounts and ad accounts that person manages and ticked during login.
2. **Finding comments (All comments)**: the app first asks Meta which posts or ads have comments and how many (a quick check). It then downloads comments only for posts whose count changed since last time, and streams them in post by post.
3. **Saving in the browser**: fetched comments, categories, post lists and ad lists are saved in the browser (IndexedDB) for 24 hours and cleared on logout.
4. **When the app asks Meta** (and only then): when you pick a time window or dates, when you press **Refresh**, or when nothing is saved yet for that account. Switching pages, views or browser tabs, or reloading the page, shows the saved copy and says when it was saved.
5. **Checks against Meta's count**: if Meta says a post has comments but far fewer come back, the app doesn't trust the saved copy, fetches again, and warns if it's still short.
6. **Categorising**: a built-in model (free, runs on the server) sorts each comment. It understands English, Hindi and Hinglish. Corrections from the team are fed back in. It can be switched to Claude (paid) with a setting.
7. **Ads**: active ads are always read first, then paused ones. Each ad's post is read in batches of 50 per Meta call.

---

## 4. Known limits

| Limit | Why | What would fix it |
|---|---|---|
| Facebook commenter names often missing ("Facebook user") | Meta hides names from apps that haven't passed App Review | Meta App Review (Advanced Access) |
| No private replies (DMs) to commenters | Needs messaging permissions that require App Review | App Review for `instagram_manage_messages` / `pages_messaging` |
| Partnership (creator) ads' comments can't be read | The post belongs to the creator's account | Nothing on our side; creator must share access |
| Comments on posts older than ~60 days before the window aren't in *All comments* | Keeps the check fast | Visible in *By post* |
| Up to 80 posts/ads per check; ~1,000 Instagram comments per post in *All comments* | Vercel's 60-second limit | A note appears when the limit is hit |
| New comments only appear after Refresh (or picking a time window) | By design: the app doesn't re-fetch on its own when you switch pages or tabs | Refresh button; the status line shows when data was saved |
| Edits/deletes by others aren't noticed until a full Refresh or 24 h | The quick check only compares comment counts | Refresh button |
| Category corrections are lost when the server restarts | Needs Upstash Redis | Add Upstash Redis in Vercel |
| Only people with a role on the Meta app can log in; no webhooks | Meta app is in Development mode | Business Verification + App Review |
| Everything runs on each person's own Facebook login | No System User yet | System User token (planned) |

---

## 5. Decisions and principles

- **Show, don't hide, problems.** Anything the app couldn't read is reported in plain words and logged with IDs, never silently dropped.
- **Numbers must add up on screen.** Every total can be traced back to Meta's count.
- **Never trust a failed or partial fetch as the truth.** Short copies are refetched and flagged.
- **Humans decide.** No automatic hiding or replying.
- **Avoid identical bulk replies.** Meta treats them as spam and can restrict the account; replies are sent one by one.
- **Before every code push, GitHub's latest commit is checked** against the last known one, so nothing gets overwritten.

---

## 6. Roadmap (next up)

1. **Audit log**: who hid, replied to or recategorised what, and when (shared, not per browser).
2. **Reply to several selected comments** one after another, with variations and a pause between sends (not identical bulk replies).
3. **Upstash Redis** so category corrections are kept permanently (setup step in Vercel).
4. **Merchant picker**: choose a merchant once to set both its Page and ad account; searchable lists.
5. **Link to the exact comment** on Instagram/Facebook, not just the post.
6. **Weekly summary** for merchants (the CSV export is done).
7. **Private replies** after App Review.
8. **Automated tests and a lockfile**, so updates can't silently break things.
9. **Meta App Review + System User**, then optional automation (e.g. auto-hide spam) in shadow mode first.

---

## 7. Change history

### 29 Sept 2026 (later)
- **New: Back.** An in-app **← Back** button, and the browser's Back/Forward now move between the app's screens instead of leaving the app. Reloading keeps you on the same screen.
- **The Comment Pulse logo** now takes you to the start screen.

### 29 Sept 2026
- **New: Download CSV** of the comments on screen (time window + filters), one row per comment, top commenters first, with bucket and type. Excel-ready, formula-safe, and marked when incomplete.

### 28 Sept 2026 (evening)
- **Fix: opening a comment's post** from *All comments* now always opens that exact ad and platform. Before, if the ad wasn't in the part of the ad list already loaded (common with 100+ ads), the top ad opened instead.
- **Fix: nothing spills out of its card:** long unbroken ad names and ID lists wrap; card subtitles are no longer cut off; the reply box fits on phones.
- **Messages moved to the bottom centre** so they never cover the Hide / Reply buttons on the right.
- **Every hide and unhide is logged** in the Activity log, with a Graph API check to confirm it with Meta, and the *Hidden · confirmed* tag explains who can still see a hidden comment.
- **Fix: the `#_=_` Facebook adds to the address after login** is removed.

### 28 Sept 2026 (later)
- **No more automatic re-fetching:** the app asks Meta only when you pick a time window or dates, press Refresh, or nothing is saved yet. Switching pages, views or tabs (and reloading) shows the saved copy, with when it was saved. Post and ad lists follow the same rule.
- **Refresh is now a labelled button.**
- **Open card:** no more "852 total" next to 852 open; the line under it only shows when it adds information.
- **Notes grouped:** one line, *"Some comments couldn't be loaded · N things to check"*, expands into short notes that each say what to do. Withheld Facebook comments now name the Page ID to check; the "switch to Active" tip only shows when you're on + Paused; long Page lists are shortened.
- **Activity log: Graph API checks** on every problem, as an *Open in Graph API Explorer* link and a *Copy curl* command (no tokens).

### 28 Sept 2026
- **New: Reply** to comments publicly as the brand (Instagram and Facebook), with saved replies, *Reply & hide* for negatives, and the reply shown instantly under the comment.
- **Fix:** replies Meta refuses are reported as a Meta error with the reason, not as an app crash; an expired login during a reply sends you to log in again.
- **Fix:** a malformed response while checking for new comments no longer breaks the view.
- Added this project file.

### 25 Sept 2026
- **Open vs total:** the first card is now *Open* with Meta's total under it, and a breakdown line adds up to Meta's count.
- **Activity log** in the sidebar, plus server-side error logging in Vercel.
- **Plain-English errors** (e.g. *due to missing permissions*); Pages this login can't open are named with their Page ID.
- **Withheld comments detected:** posts where Meta counts comments but returns none are reported instead of shown as zero.
- **Fetching overlay** on every trip to Meta.
- **Missed comments fixed:** every Instagram reply is fetched (not just the first 50); Facebook comments fetched newest-first everywhere; saved copies far short of Meta's count are refetched and flagged; comment diagnostic page added.
- **No needless re-checks** when switching views or tabs within 2 minutes.
- **Instagram ads:** posts from Instagram accounts connected to the ad account, and ad-only posts, are now included; coverage counts per platform; Instagram/Facebook filter; "Facebook user" / "Instagram user" when Meta withholds names.
- **Ads fixes:** ads paused through their campaign or ad set are included; active ads are always read first (also in *By ad*); ad posts read in batches of 50; limits reported on screen.
- **Hidden comments** no longer counted as open; *Hidden* toggle.
- **Header redesign:** account selector top right, one filter bar, custom dates in a pop-over.
- **Custom date range** for All comments; exact window shown; windows follow the clock.
- **Caching:** browser cache with change detection by comment count, streamed loading, cached categories; cleared on logout.
- **All comments** view (last 24 h / 7 / 14 days) for posts and ads.
- **Hide all negative** with confirmation and batching; hides confirmed by Meta; comments move when recategorised; ads view redesigned.

### Earlier
- App built and deployed: Facebook login, posts and ads, built-in classifier (English/Hindi/Hinglish) with learning from corrections, hide/unhide, Fastrr Ads styling.

---

## 8. How to update this file

With every change: add a dated entry to **Change history**, update **What you can do today** and **Known limits** if they changed, and move finished items off the **Roadmap**.
