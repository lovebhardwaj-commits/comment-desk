# Comment Desk

A web app for your team to review comments on merchants' Facebook and Instagram **posts and ads**, sorted into **Enquiry, Positive and Negative**, and hide or unhide them with one click.

Negative comments also carry a type (complaint, criticism, spam, abuse) so you can tell an unhappy customer from a bot before hiding.

Nothing is hidden automatically. The app only hides a comment when someone clicks **Hide**.

---

## 1. Meta app settings (once)

In developers.facebook.com, open your existing app:

1. **Add Facebook Login for Business** (Add product) if it isn't there.
2. **Facebook Login for Business → Settings → Valid OAuth Redirect URIs**, add:
   `https://YOUR-APP.vercel.app/api/auth/callback`
   (and `http://localhost:3000/api/auth/callback` if you'll run it locally).
3. **App settings → Basic → App domains**, add `YOUR-APP.vercel.app`.
4. **Permissions.** The app requests these at login:
   `pages_show_list, pages_read_engagement, pages_read_user_content, pages_manage_engagement, business_management, instagram_basic, instagram_manage_comments, ads_read`
   - Option A (simplest): leave `META_LOGIN_CONFIG_ID` empty and the app asks for them directly.
   - Option B: create a **Configuration** under Facebook Login for Business with the same permissions, and put its ID in `META_LOGIN_CONFIG_ID`.
5. **App roles:** while the app is in Development mode, only people with a role on the app (Admin, Developer, Tester) can log in. Add every team member who will use it.

## 2. Deploy on Vercel

1. In Vercel: **Add New → Project → Import** this repo. Framework is detected as Next.js.
2. Under **Environment Variables**, add everything from `.env.example`:

| Variable | Value |
|---|---|
| `META_APP_ID` | App Dashboard → App settings → Basic |
| `META_APP_SECRET` | Same page (click Show). Never commit this |
| `META_LOGIN_CONFIG_ID` | Optional, see step 1.4 |
| `GRAPH_VERSION` | `v25.0` |
| `APP_URL` | `https://YOUR-APP.vercel.app` (no trailing slash) |
| `SESSION_SECRET` | 32+ random characters, e.g. from `openssl rand -base64 32` |
| `ANTHROPIC_API_KEY` | From console.anthropic.com |
| `CLAUDE_MODEL` | `claude-haiku-4-5-20251001` (cheaper) or `claude-sonnet-5` (stronger) |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Optional but recommended, see below |

3. **Deploy.** Then make sure `APP_URL` and the redirect URI in step 1.2 match the final domain exactly.

**Cache (recommended):** in Vercel, **Storage / Marketplace → Upstash Redis → Create** (free tier is enough), and copy its REST URL and token into the two `UPSTASH_` variables. Without it, comments are re-categorised (and paid for) every time a post is opened on a fresh server instance.

## 3. Using it

1. **Continue with Facebook.** In the pop-up, **tick every Page, Instagram account and business** you want to work on. Anything left unticked won't show up.
2. **Posts tab:** pick a Page, choose Instagram or Facebook, set the date range, **Show posts**, then click a post.
3. **Ads tab:** pick an ad account, **Show ads**, then click the Instagram or Facebook chip on an ad. Partnership ads whose post sits on a creator's account are marked "partner" and can't be opened, because their comments belong to the creator.
4. Comments load and are categorised automatically. Filter by category, check **Needs review**, and click **Hide** / **Unhide**.

## Known limits

- **Facebook** calls (posts, ad posts, comments, hiding) follow Meta's documentation but weren't tested in Graph API Explorer the way the Instagram ones were. Test them on one Page first.
- **Date filter:** Meta sometimes ignores `since`/`until`, so the app also filters posts by date itself.
- **Large posts:** up to about 2,000 comments per post are loaded.
- **Login lasts about 60 days**, then Facebook asks again.
- **Prompt:** in `lib/prompt.ts`. When you change it, bump `PROMPT_VERSION` so old cached results aren't reused.

## Project layout

```
app/page.tsx                 Login screen / dashboard
app/components/              Dashboard (posts & ads lists) and CommentsPanel
app/api/auth/*               Facebook login, callback, logout
app/api/accounts             Pages + linked Instagram accounts
app/api/adaccounts           Ad accounts
app/api/posts                Posts in a date range (Instagram /media, Facebook /published_posts)
app/api/ads                  Ads + ownership check for each ad's post
app/api/comments             All comments and replies on one post
app/api/classify             Categorisation with Claude (cached)
app/api/hide                 Hide / unhide one comment
lib/graph.ts                 Graph API helper (adds appsecret_proof)
lib/prompt.ts                Classifier prompt
```
