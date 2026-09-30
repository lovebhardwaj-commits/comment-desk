# Comment Desk

A web app for your team to review comments on merchants' Facebook and Instagram **posts and ads**, sorted into **Enquiry, Positive and Negative**, and hide or unhide them with one click.

Negative comments also carry a type (complaint, criticism, spam) so you can tell an unhappy customer from a bot before hiding.

Nothing is hidden automatically. The app only hides a comment when someone clicks **Hide**.

**Categorisation is free by default.** The app has a built-in model (in `lib/local/`) that runs on the server with no external service. It handles English, Hindi (Devanagari) and Hinglish, and was trained on comments about many product types (fashion, beauty, electronics, home, food, apps, services). In testing it got about 87–90% of comments right. If you need higher accuracy, you can switch to Claude (paid per comment) with one setting, see below.

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
| `CLASSIFIER` | Leave empty for the free built-in model. Set to `claude` to use Claude instead |
| `ANTHROPIC_API_KEY` | Only needed with `CLASSIFIER=claude`. From console.anthropic.com |
| `CLAUDE_MODEL` | Only with Claude: `claude-haiku-4-5-20251001` (cheaper) or `claude-sonnet-5` (stronger) |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Recommended: keeps your category corrections permanently (and caches Claude results) |
| `OPENROUTER_API_KEY` | Optional: switches on AI analysis ("Why are people saying this?"). From openrouter.ai/keys |
| `OPENROUTER_MODEL` | Needed with the key: the model to use, from openrouter.ai/models (e.g. a Grok model) |
| `OPENROUTER_BASE_URL` | Optional, leave empty. Only for testing against another OpenRouter-compatible server |

3. **Deploy.** Then make sure `APP_URL` and the redirect URI in step 1.2 match the final domain exactly.

**Upstash Redis (recommended):** in Vercel, **Storage / Marketplace → Upstash Redis → Create** (free tier is enough), and copy its REST URL and token into the two `UPSTASH_` variables. It stores the corrections your team makes so the built-in model keeps learning, and (with Claude) caches results so they aren't paid for twice. Without it, corrections are lost whenever the server restarts.

**AI analysis (optional):** the *Why are people saying this?* panel groups comments into themes using an AI model through OpenRouter. To switch it on:

1. In OpenRouter (openrouter.ai): create or pick a key under **Keys**, and **set a credit limit on it** so a mistake can't run up a bill.
2. In OpenRouter **Settings → Privacy**: turn off logging of prompts, and allow only providers that don't train on or keep your data. Comments are customers' words, so this matters.
3. In Vercel: **Project → Settings → Environment Variables**, add `OPENROUTER_API_KEY` (the key) and `OPENROUTER_MODEL` (the model's exact name as shown on openrouter.ai/models) for **Production** (and Preview if you use it).
4. **Redeploy** (Deployments → ⋯ → Redeploy). Vercel only picks up new variables on a new deployment.
5. Update your **privacy policy**: comments you choose to analyse are sent to OpenRouter and the AI provider it routes to.

To change the model later, edit `OPENROUTER_MODEL` and redeploy. To switch the feature off, remove `OPENROUTER_API_KEY` and redeploy; the panel then says it isn't set up.

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
- **Built-in model:** it can't use the parent comment for context, so replies like "Still not received" are harder for it; sarcasm and rare languages too. Comments it's unsure about are marked **Needs review**. The first request after a server starts takes about 2 seconds while it trains.
- **Corrections:** use the category dropdown on any comment to fix it. The model learns from your correction on the next categorise request (identical comments are always labelled as you corrected them, and similar ones improve too). Corrections are only kept permanently with Upstash Redis (see above).
- **Improving the built-in model:** add real comments with the correct label to `lib/local/examples.json` (format: `["comment text", "Enquiry"]`, labels: Enquiry, Positive, Complaint, Negative, Spam), then redeploy. Real comments from your pages improve it the most. Sentence patterns for any product are in `lib/local/templates.ts`.
- **Claude prompt:** in `lib/prompt.ts`. When you change it, bump `PROMPT_VERSION` so old cached results aren't reused.

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
app/api/classify             Categorisation (built-in model, or Claude)
app/api/label                Save a category correction (the built-in model learns from it)
app/api/hide                 Hide / unhide comments in batches, confirmed with Meta
app/api/reply                Reply publicly as the brand (Instagram and Facebook)
app/api/inbox/targets        "All comments": which posts/ads have comments, and coverage notes
app/api/inbox/comments       "All comments": comments for changed posts, streamed
app/api/diagnose/*           What Meta returns for one post (for troubleshooting)
app/api/insights             AI analysis: themes for a set of comments, checked against the real comments
lib/graph.ts                 Graph API helper (adds appsecret_proof)
lib/local/                   Built-in classifier: model, patterns, examples
lib/prompt.ts                Claude prompt (only with CLASSIFIER=claude)
lib/insights.ts              AI analysis through OpenRouter: sampling, prompt, and checking the answer
```
