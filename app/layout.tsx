import "./globals.css";
import "./inbox.css";
import "./ai.css";
import "./select.css";
import "./theme.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Comment Pulse · Fastrr Ads",
  description: "Categorise and moderate Facebook and Instagram comments on posts and ads",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0d0d18" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
        {/* Facebook adds "#_=_" to the address after login. Remove it so the URL stays clean. */}
        <script dangerouslySetInnerHTML={{ __html: `if(location.hash==="#_=_"||location.hash==="#"){history.replaceState(null,"",location.pathname+location.search)}` }} />
        {/* Light theme, if chosen before: applied before the page draws so there's no dark flash. */}
        <script dangerouslySetInnerHTML={{ __html: `try{if(localStorage.getItem("cp:theme")==="light"){document.documentElement.dataset.theme="light";var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","#faf5f1")}}catch(e){}` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
