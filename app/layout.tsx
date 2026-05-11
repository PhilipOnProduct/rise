import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import Nav from "@/app/components/Nav";
import FeedbackButton from "@/app/components/FeedbackButton";
import ApiLimitBanner from "@/app/components/ApiLimitBanner";
import { isAdminFromCookies } from "@/lib/auth";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-dm-sans",
});

export const metadata: Metadata = {
  title: "Rise — Your personal travel assistant",
  description: "AI-powered travel planning, tailored to you.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // PHI-83: gate the Admin nav dropdown server-side. UX-only; the real
  // boundary stays on /admin/* via isAdminRequest. Fail-safe to hidden.
  const isAdmin = await isAdminFromCookies();
  return (
    <html lang="en" className={dmSans.variable}>
      <body className="antialiased bg-[#f8f6f1] text-[var(--text-primary)]">
        <ApiLimitBanner />
        <Nav isAdmin={isAdmin} />
        {children}
        <FeedbackButton />
        <Analytics />
      </body>
    </html>
  );
}
