"use client";
import { useEffect, useState } from "react";
import { MessagesSquare, Megaphone } from "lucide-react";
import Shell, { type View } from "./Shell";

/** Logged out: the Fastrr Ads frame with the shared login prompt. The sidebar works, so the prompt names what
 *  each section will show; both lead to the same Facebook login. */
export default function LoginGate({ error }: { error?: string }) {
  const [view, setView] = useState<View>("ads");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") === "posts") setView("posts");
  }, []);
  const ads = view === "ads";
  return (
    <Shell view={view} onView={setView} onHome={() => setView("ads")}>
      <section className="login-prompt">
        <h1>What are people saying about your {ads ? "ads" : "posts"}?</h1>
        <span className="login-prompt-icon" aria-hidden>{ads ? <Megaphone /> : <MessagesSquare />}</span>
        <p>
          Connect your Facebook account to see every comment on your Instagram and Facebook {ads ? "ads" : "posts"},
          sorted into Enquiry, Positive and Negative, and reply or hide them in one place.
        </p>
        {error && <p className="error" role="alert">{error}</p>}
        <a className="btn btn-primary btn-lg login-prompt-btn" href="/api/auth/login">Login with Facebook</a>
      </section>
    </Shell>
  );
}
