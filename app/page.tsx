import { getSession } from "@/lib/session";
import Dashboard from "./components/Dashboard";

export const dynamic = "force-dynamic";

function missingSettings() {
  const missing: string[] = [];
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) missing.push("SESSION_SECRET (must be at least 32 characters)");
  if (!process.env.META_APP_ID) missing.push("META_APP_ID");
  if (!process.env.META_APP_SECRET) missing.push("META_APP_SECRET");
  return missing;
}

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  const missing = missingSettings();
  if (missing.length) {
    return (
      <main className="login">
        <div className="login-card">
          <div className="brand-mark" aria-hidden>CD</div>
          <h1>Setup needed</h1>
          <p>These environment variables are missing or invalid in Vercel:</p>
          <ul>{missing.map((m) => <li key={m}><code>{m}</code></li>)}</ul>
          <p className="fine">Add them in Vercel → Project → Settings → Environment Variables, then redeploy.</p>
        </div>
      </main>
    );
  }

  const s = await getSession();
  const loggedIn = !!s.userToken && (!s.expiresAt || Date.now() < s.expiresAt);

  if (!loggedIn) {
    return (
      <main className="login">
        <div className="login-card">
          <div className="brand-mark" aria-hidden>CD</div>
          <h1>Comment Desk</h1>
          <p>See every comment on your merchants&apos; Facebook and Instagram posts and ads, sorted into Enquiry, Positive and Negative, and hide the ones that shouldn&apos;t be public.</p>
          {error && <p className="error" role="alert">{error}</p>}
          <a className="btn primary big" href="/api/auth/login">Continue with Facebook</a>
          <p className="fine">You&apos;ll see the Pages, Instagram accounts and ad accounts you manage. Tick every account you want to work on when Facebook asks.</p>
        </div>
      </main>
    );
  }
  return <Dashboard userName={s.userName || ""} />;
}
