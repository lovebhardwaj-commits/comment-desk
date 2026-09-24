import { getSession } from "@/lib/session";
import Dashboard from "./components/Dashboard";
import { BrandMark } from "./components/Shell";

export const dynamic = "force-dynamic";

function missingSettings() {
  const missing: string[] = [];
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) missing.push("SESSION_SECRET (at least 32 characters)");
  if (!process.env.META_APP_ID) missing.push("META_APP_ID");
  if (!process.env.META_APP_SECRET) missing.push("META_APP_SECRET");
  return missing;
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <main className="login">
      <div className="login-card">
        <div className="brand">
          <BrandMark />
          <div>
            <div className="brand-name">Comment Pulse</div>
            <div className="brand-sub">by Fastrr Ads</div>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  const missing = missingSettings();
  if (missing.length) {
    return (
      <Card>
        <h1>Setup needed</h1>
        <p>These environment variables are missing or invalid in Vercel:</p>
        <ul>{missing.map((m) => <li key={m}><code>{m}</code></li>)}</ul>
        <p className="fine">Add them in Vercel → Project → Settings → Environment Variables, then redeploy.</p>
      </Card>
    );
  }

  const s = await getSession();
  const loggedIn = !!s.userToken && (!s.expiresAt || Date.now() < s.expiresAt);
  if (loggedIn) return <Dashboard userName={s.userName || ""} userId={s.userId || ""} />;

  return (
    <Card>
      <h1>Know what customers are saying</h1>
      <p>Every comment on your merchants&apos; Facebook and Instagram posts and ads, sorted into Enquiry, Positive and Negative, so you can reply faster and hide what shouldn&apos;t be public.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <a className="btn btn-primary btn-lg" style={{ width: "100%" }} href="/api/auth/login">Continue with Facebook</a>
      <p className="fine">You&apos;ll see the Pages, Instagram accounts and ad accounts you manage. Tick every account you want to work on when Facebook asks.</p>
    </Card>
  );
}
