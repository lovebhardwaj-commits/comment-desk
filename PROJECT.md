# Comment Pulse: project file

This file describes everything Comment Pulse does today, how it works, what's known to be missing, and what's planned next. **It is updated in the same change as every code update**, so it should always match the live app.

- **Live app:** https://comment-desk.vercel.app
- **Code:** https://github.com/lovebhardwaj-commits/comment-desk
- **Setup steps** (Meta app, Vercel, environment variables): see `README.md`
- **Last updated:** 1 Oct 2026

---

## 1. What it is

Comment Pulse is a tool for the Fastrr Ads team to handle comments on merchants' **Instagram and Facebook posts and ads** in one place. Every comment is sorted into **Enquiry, Positive or Negative** (negatives also get a type: complaint, criticism or spam), so the team can reply to buyers quickly and hide what shouldn't stay public.

Nothing happens automatically. Comments are only hidden or replied to when someone clicks the button.

---

## 2. What you can do today

### Viewing comments
- **Post comments** and **Ad comments** are separate sections in the sidebar.
- **Light or dark:** the sun / moon icon at the top right switches theme. The choice is remembered in this browser and applied before the page draws (no dark flash). Dark is the default. The login screen follows the saved choice.
- **Choosing a Page or ad account:** the picker at the top right has a **search box**. Type part of a name (or ID) to filter, use ↑ ↓ and Enter, or Esc to close. The current choice is ticked.
- **Start screen:** Post comments → All comments. Clicking the **Comment Pulse logo** always returns here (it will point to the homepage once there is one).
- **Back:** an **← Back** button above the page title returns to the previous screen, and the browser's own Back/Forward buttons move between screens too, instead of leaving the app. Going back reuses the saved comments, so nothing is fetched again. Clicking through posts inside *By post / By ad* doesn't add Back steps. The screen is kept in the address (e.g. `?view=ads&mode=by-ad`), so reloading stays on it.
- Each has two views:
  - **All comments**: every comment in a time window across all posts (or all ads), newest first. This is the default.
  - **By post / By ad**: pick one post or ad and see all its comments.
- **Time window** (All comments): 24 hours, 7 days, 14 days, or a custom date range (up to 90 days back).
- **Ads filter:** *Active* (delivering, in review or with issues) or *+ Paused* (also ads paused directly or through their campaign or ad set).
- **Filters:** by category (the cards at the top), by platform (Instagram / Facebook), by search text, newest or oldest first, show or hide already-hidden comments, show or hide the brand's own replies.
- **Brand replies** (toggle): shown right under the comment they answer, in every category and search, not only on *All*.
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

### Why are people saying this? (AI analysis)
- On the **Enquiry, Positive or Negative** view, a panel groups the comments on screen into **3–6 themes**: *"What are people asking?"*, *"Why are people happy?"*, *"What's going wrong?"*. From the **All** view, a small bar offers the three categories.
- **Switching category:** the top of the panel has *All comments · Enquiries · Positive · Negative* (with counts). Each category keeps its own saved analysis, so switching back and forth doesn't run the AI again. The category cards at the top do the same.
- **Hide themes / Show N themes** collapses the analysis so the comments come back into view.
- Each theme shows **how many comments** it covers (and the share), a one-line explanation, **up to 3 real example comments** (click one to jump to it in the list), and for enquiries and negatives a **practical suggestion** (e.g. *"Mention delivery days and COD in the ad"*).
- **Nothing is invented:** the app sends each comment with a short reference and checks the answer. Themes or examples that don't point at real comments are dropped, and each comment is counted once. Example text is shown from the app's own copy of the comment, not from the AI's reply.
- **Only runs when you click** *Analyse*. Uses the **open** comments on screen in that category (the same ones the card counts; hidden comments are left out), with the same time window, platform and search as the list.
- **Every comment is counted:** each one lands in exactly one theme. Very short or general comments (emojis, "nice", a single word) go into a final **Other comments** theme, shown in a quieter style. The themes always add up to the number analysed.
- **Big sets are analysed in batches:** up to 250 comments per batch, 3 batches at a time, then one step that combines the batch themes. The AI only decides which batch themes are the same; the app adds up the comments, so counts stay exact. The panel shows progress (*"5 batches · 2 of 5 done"*) and a time estimate. Up to 3,000 comments per run; above that an even sample is analysed and the panel says so.
- **If a batch fails** it's retried once; if it still fails, the result shows without it and says how many comments are missing (*"868 of 1,085 enquiries"*). If the combining step fails, themes with the same name are grouped instead. If everything fails, the panel shows the reason (e.g. the key is out of credit).
- **Saved with the view**, so reopening it costs nothing; if new comments arrive, the panel says how many and offers **Re-run**. **Copy** puts the analysis on the clipboard as text.
- Every run (model, number of comments, tokens and cost if OpenRouter reports it) and every failure goes to the **Activity log**; the panel itself stays in plain language. If it isn't set up in Vercel, the panel says which settings are missing.

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
8. **AI analysis**: when you click *Analyse*, the screen sends the open comments in view in batches of up to 250 (each comment cut to 300 characters) to the server, which passes them to the model set in `OPENROUTER_MODEL` through OpenRouter. Batch themes are then combined in one more request. The model is told the comments are data, not instructions (so a comment can't hijack it). Its answer is checked against the comments sent before anything is shown. The key never reaches the browser.

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
| AI analysis reads up to 3,000 comments per run (an even sample of bigger sets), and its themes are the model's reading | Keeps each run within a few minutes and a few cents | Filter to a narrower set (e.g. one platform) for a closer look; counts and examples are always checked |

---

## 5. Vercel settings

Every environment variable the app uses, and when it was added. **After changing any of these, redeploy** (Vercel only applies them to new deployments).

| Variable | Needed? | What it does | Added |
|---|---|---|---|
| `META_APP_ID`, `META_APP_SECRET` | Required | The Meta app | From the start |
| `META_LOGIN_CONFIG_ID` | Optional | Facebook Login for Business configuration | From the start |
| `GRAPH_VERSION` | Required | Meta Graph API version (`v25.0`) | From the start |
| `APP_URL` | Required | The app's public address | From the start |
| `SESSION_SECRET` | Required | Encrypts the login cookie | From the start |
| `CLASSIFIER`, `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` | Optional | Use Claude instead of the built-in model for categorising | From the start |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Recommended | Keeps category corrections permanently | From the start |
| `OPENROUTER_API_KEY` | Optional | Switches on AI analysis ("Why are people saying this?") | 30 Sept 2026 |
| `OPENROUTER_MODEL` | With the key | Which AI model to use, as named on openrouter.ai/models (e.g. a Grok model) | 30 Sept 2026 |
| `OPENROUTER_BASE_URL` | No, leave empty | Only for testing against another server | 30 Sept 2026 |

**Also outside Vercel, for AI analysis:** set a credit limit on the OpenRouter key; in OpenRouter *Settings → Privacy*, turn off prompt logging and allow only providers that don't train on or keep data; and mention in the privacy policy that comments you choose to analyse are processed by OpenRouter and the AI provider it routes to.

---

## 6. Decisions and principles

- **Show, don't hide, problems.** Anything the app couldn't read is reported in plain words and logged with IDs, never silently dropped.
- **Numbers must add up on screen.** Every total can be traced back to Meta's count.
- **Never trust a failed or partial fetch as the truth.** Short copies are refetched and flagged.
- **Humans decide.** No automatic hiding or replying, and AI analysis only runs when someone clicks.
- **AI output is checked, not trusted.** Every theme must point at real comments; examples are shown from our own copy of the comments.
- **Avoid identical bulk replies.** Meta treats them as spam and can restrict the account; replies are sent one by one.
- **Before every code push, GitHub's latest commit is checked** against the last known one, so nothing gets overwritten.

---

## 7. Roadmap (next up)

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

## 8. Change history

### 1 Oct 2026 (later)
- **New: light theme**, switched with the sun / moon icon in the top bar; remembered per browser; dark stays the default. Built in `app/theme.css` as `:root[data-theme="light"]` overrides of the same tokens, in `── Name ──` sections (Surface / Background, Border, Text, Primary, Categories, Shadows, Component fixes), following the light-index-css-feature-section-map convention.
- **Every screen checked for readable contrast in both themes** (WCAG 4.5:1 for normal text), including text on gradients. Fixed: the selected sidebar item and the brightest text (selected buttons, picker choice) used white, which disappears on light; hidden comments in light now use the muted ink instead of half opacity.
- **Dark theme: small grey text made readable.** `--faint` was #5d5d78 (2.41:1 on the lightest dark panel, below the minimum); it's now #8989a7 and `--muted` #9a9ab6, both at least 4.5:1 on every dark background. Separators, counts and small labels look slightly brighter.
- AI panel footer uses the muted grey (the faint one was just under the minimum on the panel's tint).

### 1 Oct 2026
- **AI analysis: counts now add up.** Before, the AI could leave comments out of every theme (49 of 66 positives in one run), and hidden comments were analysed though the cards don't count them. Now every comment lands in exactly one theme (*Other comments* for the general ones), and only open comments are analysed, so the panel matches the card.
- **AI analysis: batches instead of a 400 cap.** Up to 3,000 comments per run, 250 per batch, 3 at a time, then combined; progress and time estimate shown; failed batches retried, and reported if still missing; the real reason shown when nothing works.
- **Fix: brand replies** now show under their comment in every category, not only on *All*.
- **New: search** in the Page and ad account pickers (also keyboard: ↑ ↓ Enter Esc).
- **Numbers formatted the same everywhere** (1,094, not 1094): category cards, platform counts, Download CSV, *Hide all negative*, *Hidden*, the callouts and the hide dialog.
- **Category cards** say what clicking them does; **Download CSV** says when hidden comments are included (which is why it can be higher than the card).

### 30 Sept 2026 (later)
- **AI analysis panel:** a category switcher (All comments · Enquiries · Positive · Negative) to move between analyses or back to all comments; each keeps its saved result.
- **Clearer wording:** the panel no longer mentions the AI model, Vercel or the cost per run (these stay in the Activity log); *Hide themes / Show N themes*; the category cards say what clicking them does.

### 30 Sept 2026
- **New: Why are people saying this? (AI analysis).** On the Enquiry, Positive or Negative view, groups the comments on screen into themes with counts, real example comments (click to jump to them) and suggestions. Runs through OpenRouter with the model set in Vercel; every answer is checked against the real comments; results are saved per view; runs and failures are logged.
- **Vercel:** new optional settings `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (and `OPENROUTER_BASE_URL`, for testing only). See *Vercel settings*.
- **New section in this file: Vercel settings**, listing every setting the app uses.

### 29 Sept 2026 (later)
- **New: Back.** An in-app **← Back** button, and the browser's Back/Forward now move between the app's screens instead of leaving the app. Reloading keeps you on the same screen.
- **The Comment Pulse logo** now takes you to the start screen.
- **Fix: Refresh in *By post*** now really fetches the latest posts from Meta (it could quietly reuse the saved list).
- **README corrected:** Upstash Redis is *recommended* (it keeps category corrections), not "only for Claude"; the file list includes the newer routes.

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

## 9. How to update this file

With every change: add a dated entry to **Change history**, update **What you can do today** and **Known limits** if they changed, add any new environment variable to **Vercel settings**, and move finished items off the **Roadmap**.
