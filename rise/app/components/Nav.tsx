"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";

type NavSection = {
  label: string;
  links: { href: string; label: string }[];
};

const sections: NavSection[] = [
  {
    label: "Traveller",
    links: [
      { href: "/dashboard", label: "My trip" },
      { href: "/transport", label: "Airport → Hotel" },
      { href: "/welcome", label: "Plan a new trip" },
    ],
  },
  {
    label: "Local Guide",
    links: [
      { href: "/guides", label: "Browse guides" },
      { href: "/guides/add", label: "Submit a tip" },
      { href: "/guides/leaderboard", label: "Leaderboard" },
    ],
  },
  {
    label: "Admin",
    links: [
      { href: "/admin", label: "AI Logs" },
      { href: "/team", label: "Team" },
      { href: "/team?tab=ost", label: "Opportunity tree" },
    ],
  },
];

function getActiveSection(pathname: string): string | null {
  if (pathname.startsWith("/dashboard") || pathname.startsWith("/transport") || pathname.startsWith("/welcome") || pathname.startsWith("/profile")) return "Traveller";
  if (pathname.startsWith("/guides") || pathname.startsWith("/guides/add") || pathname.startsWith("/guides/leaderboard")) return "Local Guide";
  if (pathname.startsWith("/admin") || pathname.startsWith("/team")) return "Admin";
  return null;
}

export default function Nav() {
  const pathname = usePathname();
  const activeSection = getActiveSection(pathname);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);

  // Close dropdown when the route changes (link was clicked successfully)
  useEffect(() => {
    setOpenSection(null);
    setMobileOpen(false);
  }, [pathname]);

  // Close dropdown when clicking outside the nav
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenSection(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function toggleSection(label: string) {
    setOpenSection((prev) => (prev === label ? null : label));
  }

  // Don't show nav on welcome/onboarding
  if (pathname === "/welcome") return null;

  return (
    <nav ref={navRef} className="sticky top-0 z-50 w-full bg-[#0a0a0a] border-b border-[#1a1a1a]">
      <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">

        {/* Logo */}
        <Link
          href="/"
          className="text-[#00D64F] font-extrabold text-lg tracking-tight hover:opacity-80 transition-opacity"
        >
          Rise
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-1">
          {sections.map((section) => {
            const isActive = activeSection === section.label;
            const isOpen = openSection === section.label;

            return (
              <div key={section.label} className="relative">
                <button
                  onClick={() => toggleSection(section.label)}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                    isActive
                      ? "text-[#00D64F] bg-[#00D64F]/10"
                      : "text-gray-400 hover:text-white hover:bg-[#111]"
                  }`}
                >
                  {section.label}
                  <svg
                    className={`w-3.5 h-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    viewBox="0 0 16 16"
                    fill="none"
                  >
                    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>

                {isOpen && (
                  <div className="absolute top-full right-0 mt-2 w-48 bg-[#111] border border-[#2a2a2a] rounded-2xl overflow-hidden shadow-2xl py-1">
                    {section.links.map((link) => {
                      const isLinkActive = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href));
                      return (
                        <Link
                          key={link.href}
                          href={link.href}
                          className={`block px-4 py-3 text-sm transition-colors ${
                            isLinkActive
                              ? "text-[#00D64F] bg-[#00D64F]/10 font-semibold"
                              : "text-gray-300 hover:text-white hover:bg-[#1a1a1a]"
                          }`}
                        >
                          {link.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden flex flex-col gap-1.5 p-2"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          <span className={`block w-5 h-0.5 bg-white transition-transform origin-center ${mobileOpen ? "rotate-45 translate-y-2" : ""}`} />
          <span className={`block w-5 h-0.5 bg-white transition-opacity ${mobileOpen ? "opacity-0" : ""}`} />
          <span className={`block w-5 h-0.5 bg-white transition-transform origin-center ${mobileOpen ? "-rotate-45 -translate-y-2" : ""}`} />
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-[#1a1a1a] bg-[#0a0a0a] px-6 pb-4">
          {sections.map((section) => {
            const isActive = activeSection === section.label;
            return (
              <div key={section.label} className="mt-4">
                <p className={`text-xs font-bold uppercase tracking-widest mb-2 ${isActive ? "text-[#00D64F]" : "text-gray-600"}`}>
                  {section.label}
                </p>
                <div className="flex flex-col gap-1">
                  {section.links.map((link) => {
                    const isLinkActive = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href));
                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={() => setMobileOpen(false)}
                        className={`block px-3 py-2.5 rounded-xl text-sm transition-colors ${
                          isLinkActive
                            ? "text-[#00D64F] bg-[#00D64F]/10 font-semibold"
                            : "text-gray-300 hover:text-white hover:bg-[#111]"
                        }`}
                      >
                        {link.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </nav>
  );
}
