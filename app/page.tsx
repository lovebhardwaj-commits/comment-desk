import { getSession } from "@/lib/session";
import Dashboard from "./components/Dashboard";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
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
