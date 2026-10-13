import { getSession } from "@/lib/session";
import Dashboard from "./components/Dashboard";
import { BrandMark } from "./components/Shell";
import LoginGate from "./components/LoginGate";

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

  return <LoginGate error={error} />;
}
