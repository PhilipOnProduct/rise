"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

type ProviderStatus = {
  allowed: boolean;
  warningLevel: "ok" | "warning" | "exceeded";
  percentUsed: number;
  spentUsd: number;
  limitUsd: number;
};

type UsageRow = {
  id: string;
  provider: string;
  api_type: string;
  feature: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  request_count: number;
  estimated_cost_usd: string;
  created_at: string;
};

type LimitSettings = {
  monthly_limit_usd: number;
  warning_threshold_pct: number;
  hard_limit_enabled: boolean;
};

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function ProgressBar({ percent, level }: { percent: number; level: string }) {
  const clipped = Math.min(percent, 100);
  const color = level === "exceeded" ? "bg-[#c0392b]" : level === "warning" ? "bg-[#ba7517]" : "bg-[#1a6b7f]";
  return (
    <div className="w-full h-3 bg-[#f0ede8] rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${clipped}%` }} />
    </div>
  );
}

function ProviderCard({
  provider,
  status,
  settings,
  onSave,
}: {
  provider: string;
  status: ProviderStatus;
  settings: LimitSettings;
  onSave: (s: LimitSettings) => void;
}) {
  const [limit, setLimit] = useState(String(settings.monthly_limit_usd));
  const [threshold, setThreshold] = useState(String(settings.warning_threshold_pct));
  const [hardLimit, setHardLimit] = useState(settings.hard_limit_enabled);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Estimate month-end projection
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projection = dayOfMonth > 0 ? (status.spentUsd / dayOfMonth) * daysInMonth : 0;

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    const body = {
      provider,
      monthly_limit_usd: parseFloat(limit) || settings.monthly_limit_usd,
      warning_threshold_pct: parseInt(threshold) || settings.warning_threshold_pct,
      hard_limit_enabled: hardLimit,
    };
    await fetch("/api/usage/limits", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    onSave(body);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const levelColor = status.warningLevel === "exceeded" ? "text-[#c0392b]" : status.warningLevel === "warning" ? "text-[#ba7517]" : "text-[#1a6b7f]";
  const levelLabel = status.warningLevel === "exceeded" ? "Exceeded" : status.warningLevel === "warning" ? "Warning" : "OK";

  return (
    <div className="bg-white border border-[#e8e4de] rounded-2xl p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-[#0e2a47] capitalize">{provider}</h2>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
          status.warningLevel === "exceeded" ? "bg-[#fde8e8] text-[#c0392b]"
            : status.warningLevel === "warning" ? "bg-[#fef3e2] text-[#ba7517]"
            : "bg-[#eaf4ee] text-[#2d7a4f]"
        }`}>{levelLabel}</span>
      </div>

      <ProgressBar percent={status.percentUsed} level={status.warningLevel} />

      <div className="flex items-center justify-between text-sm">
        <span className="text-[#0e2a47] font-semibold">${status.spentUsd.toFixed(4)} <span className="text-[#6a7f8f] font-normal">/ ${status.limitUsd.toFixed(2)}</span></span>
        <span className={`font-semibold ${levelColor}`}>{Math.round(status.percentUsed)}%</span>
      </div>

      <p className="text-xs text-[#6a7f8f]">
        Projected month-end: <span className="font-semibold text-[#0e2a47]">${projection.toFixed(4)}</span>
      </p>

      {/* Editable settings */}
      <div className="border-t border-[#e8e4de] pt-4 flex flex-col gap-3">
        <p className="text-xs font-bold text-[#6a7f8f] uppercase tracking-widest">Limits</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-[#6a7f8f] mb-1">Monthly limit (USD)</label>
            <input
              type="number"
              step="1"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="w-full bg-[#f8f6f1] border border-[#d4cfc5] focus:border-[#1a6b7f] outline-none rounded-xl px-3 py-2 text-[#0e2a47] text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-[#6a7f8f] mb-1">Warning threshold (%)</label>
            <input
              type="number"
              step="5"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="w-full bg-[#f8f6f1] border border-[#d4cfc5] focus:border-[#1a6b7f] outline-none rounded-xl px-3 py-2 text-[#0e2a47] text-sm"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-[#0e2a47] cursor-pointer">
          <input
            type="checkbox"
            checked={hardLimit}
            onChange={(e) => setHardLimit(e.target.checked)}
            className="w-4 h-4 rounded accent-[#1a6b7f]"
          />
          Hard limit enabled (block API calls when exceeded)
        </label>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-xl bg-[#1a6b7f] text-white font-bold px-4 py-2 hover:bg-[#155a6b] transition-colors disabled:opacity-40 text-xs"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saved && <span className="text-xs text-[#1a6b7f]">Saved</span>}
        </div>
      </div>
    </div>
  );
}

export default function UsagePage() {
  const [status, setStatus] = useState<{ anthropic: ProviderStatus; google: ProviderStatus } | null>(null);
  const [anthropicSettings, setAnthropicSettings] = useState<LimitSettings>({ monthly_limit_usd: 20, warning_threshold_pct: 80, hard_limit_enabled: true });
  const [googleSettings, setGoogleSettings] = useState<LimitSettings>({ monthly_limit_usd: 10, warning_threshold_pct: 80, hard_limit_enabled: true });
  const [usageLog, setUsageLog] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"date" | "cost">("date");

  useEffect(() => {
    Promise.all([
      fetch("/api/usage/status").then((r) => r.json()),
      supabase.from("api_limits").select("*"),
      supabase.from("api_usage").select("*").order("created_at", { ascending: false }).limit(50),
    ]).then(([statusData, limitsRes, usageRes]) => {
      setStatus(statusData);
      for (const row of (limitsRes.data ?? []) as { provider: string; monthly_limit_usd: string; warning_threshold_pct: number; hard_limit_enabled: boolean }[]) {
        const s = { monthly_limit_usd: parseFloat(row.monthly_limit_usd), warning_threshold_pct: row.warning_threshold_pct, hard_limit_enabled: row.hard_limit_enabled };
        if (row.provider === "anthropic") setAnthropicSettings(s);
        if (row.provider === "google") setGoogleSettings(s);
      }
      setUsageLog((usageRes.data ?? []) as UsageRow[]);
      setLoading(false);
    });
  }, []);

  if (loading) return <main className="min-h-screen bg-[#f8f6f1] px-6 py-10"><p className="text-sm text-[#6a7f8f]">Loading…</p></main>;

  const sorted = [...usageLog].sort((a, b) => {
    if (sortBy === "cost") return parseFloat(b.estimated_cost_usd) - parseFloat(a.estimated_cost_usd);
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <main className="min-h-screen bg-[#f8f6f1] px-6 py-10">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-extrabold tracking-tight mb-2">API Usage</h1>
          <p className="text-[#4a6580]">Monitor spend, set limits, and track API calls.</p>
        </div>

        {/* Provider cards */}
        {status && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
            <ProviderCard
              provider="anthropic"
              status={status.anthropic}
              settings={anthropicSettings}
              onSave={setAnthropicSettings}
            />
            <ProviderCard
              provider="google"
              status={status.google}
              settings={googleSettings}
              onSave={setGoogleSettings}
            />
          </div>
        )}

        {/* Usage log */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-[#0e2a47]">Recent usage</h2>
            <div className="flex gap-2">
              {(["date", "cost"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSortBy(s)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                    sortBy === s
                      ? "bg-[#1a6b7f] text-white border-[#1a6b7f]"
                      : "bg-white text-[#6a7f8f] border-[#d4cfc5] hover:border-[#b8b3a9]"
                  }`}
                >
                  {s === "date" ? "By date" : "By cost"}
                </button>
              ))}
            </div>
          </div>

          {sorted.length === 0 ? (
            <p className="text-sm text-[#6a7f8f]">No usage logged yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-[#6a7f8f] uppercase tracking-widest border-b border-[#e8e4de]">
                    <th className="text-left py-3 px-2">Date</th>
                    <th className="text-left py-3 px-2">Provider</th>
                    <th className="text-left py-3 px-2">Type</th>
                    <th className="text-left py-3 px-2">Feature</th>
                    <th className="text-right py-3 px-2">Tokens / Reqs</th>
                    <th className="text-right py-3 px-2">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((row) => (
                    <tr key={row.id} className="border-b border-[#f0ede8] hover:bg-[#f0ede8] transition-colors">
                      <td className="py-2.5 px-2 text-[#6a7f8f] text-xs">{formatDate(row.created_at)}</td>
                      <td className="py-2.5 px-2 text-[#0e2a47] capitalize">{row.provider}</td>
                      <td className="py-2.5 px-2 text-[#4a6580]">{row.api_type}</td>
                      <td className="py-2.5 px-2 text-[#6a7f8f]">{row.feature ?? "—"}</td>
                      <td className="py-2.5 px-2 text-right text-[#4a6580] text-xs">
                        {row.provider === "anthropic"
                          ? `${(row.input_tokens ?? 0).toLocaleString()} in / ${(row.output_tokens ?? 0).toLocaleString()} out`
                          : `${row.request_count} req`}
                      </td>
                      <td className="py-2.5 px-2 text-right text-[#0e2a47] font-semibold">${parseFloat(row.estimated_cost_usd).toFixed(6)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
