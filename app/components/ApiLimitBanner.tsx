"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

type ProviderStatus = {
  warningLevel: "ok" | "warning" | "exceeded";
  percentUsed: number;
  spentUsd: number;
  limitUsd: number;
};

export default function ApiLimitBanner() {
  const [status, setStatus] = useState<{ anthropic: ProviderStatus; google: ProviderStatus } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check if dismissed this session
    if (sessionStorage.getItem("rise_limit_banner_dismissed") === "true") {
      setDismissed(true);
      return;
    }

    fetch("/api/usage/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {}); // Silently fail — banner is non-critical
  }, []);

  if (dismissed || !status) return null;

  const warnings: { provider: string; level: "warning" | "exceeded"; pct: number }[] = [];
  if (status.anthropic.warningLevel === "exceeded") warnings.push({ provider: "Anthropic", level: "exceeded", pct: Math.round(status.anthropic.percentUsed) });
  else if (status.anthropic.warningLevel === "warning") warnings.push({ provider: "Anthropic", level: "warning", pct: Math.round(status.anthropic.percentUsed) });
  if (status.google.warningLevel === "exceeded") warnings.push({ provider: "Google", level: "exceeded", pct: Math.round(status.google.percentUsed) });
  else if (status.google.warningLevel === "warning") warnings.push({ provider: "Google", level: "warning", pct: Math.round(status.google.percentUsed) });

  if (warnings.length === 0) return null;

  const hasExceeded = warnings.some((w) => w.level === "exceeded");

  function handleDismiss() {
    sessionStorage.setItem("rise_limit_banner_dismissed", "true");
    setDismissed(true);
  }

  return (
    <div className={`w-full px-4 py-2.5 text-sm flex items-center justify-between gap-4 ${
      hasExceeded ? "bg-[#fde8e8] text-[#c0392b]" : "bg-[#fef3e2] text-[#ba7517]"
    }`}>
      <div className="flex items-center gap-2 flex-wrap">
        {warnings.map((w) => (
          <span key={w.provider}>
            {w.level === "exceeded"
              ? `${w.provider} API limit reached. AI features are paused.`
              : `You've used ${w.pct}% of your ${w.provider} budget this month.`}
          </span>
        ))}
        <Link href="/admin/usage" className="font-semibold underline underline-offset-2 whitespace-nowrap">
          Manage limits →
        </Link>
      </div>
      <button onClick={handleDismiss} className="shrink-0 opacity-60 hover:opacity-100 text-lg leading-none">×</button>
    </div>
  );
}
