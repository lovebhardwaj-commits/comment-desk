import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = { title: "Comment Desk", description: "Categorise and moderate Facebook and Instagram comments" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
