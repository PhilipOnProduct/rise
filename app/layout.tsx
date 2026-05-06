import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";
import Nav from "@/app/components/Nav";
import FeedbackButton from "@/app/components/FeedbackButton";
import ApiLimitBanner from "@/app/components/ApiLimitBanner";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-dm-sans",
});

export const metadata: Metadata = {
  title: "Rise — Your personal travel assistant",
  description: "AI-powered travel planning, tailored to you.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={dmSans.variable}>
      <body className="antialiased bg-[#f8f6f1] text-[#0e2a47]">
        <ApiLimitBanner />
        <Nav />
        {children}
        <FeedbackButton />
      </body>
    </html>
  );
}
