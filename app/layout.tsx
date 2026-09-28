import "./globals.css";
import "./inbox.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Comment Pulse · Fastrr Ads",
  description: "Categorise and moderate Facebook and Instagram comments on posts and ads",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0d0d18" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
        {/* Facebook adds "#_=_" to the address after login. Remove it so the URL stays clean. */}
        <script dangerouslySetInnerHTML={{ __html: `if(location.hash==="#_=_"||location.hash==="#"){history.replaceState(null,"",location.pathname+location.search)}` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
