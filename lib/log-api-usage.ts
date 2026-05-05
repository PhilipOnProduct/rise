import { supabase } from "@/lib/supabase";
import { calculateAnthropicCost, calculateGoogleCost } from "@/lib/api-costs";

type LogParams = {
  provider: "anthropic" | "google";
  apiType: string;
  feature?: string;
  inputTokens?: number;
  outputTokens?: number;
  requestCount?: number;
  model?: string;
};

type LimitCheck = {
  allowed: boolean;
  warningLevel: "ok" | "warning" | "exceeded";
  percentUsed: number;
  spentUsd: number;
  limitUsd: number;
};

export async function logApiUsage(params: LogParams): Promise<{ allowed: boolean; warningLevel: "ok" | "warning" | "exceeded" }> {
  const cost =
    params.provider === "anthropic"
      ? calculateAnthropicCost(params.model ?? "claude-sonnet-4-6", params.inputTokens ?? 0, params.outputTokens ?? 0)
      : calculateGoogleCost(params.apiType);

  // Insert usage row (fire-and-forget style — don't block the response)
  const { error } = await supabase.from("api_usage").insert({
    provider: params.provider,
    api_type: params.apiType,
    feature: params.feature ?? null,
    input_tokens: params.inputTokens ?? null,
    output_tokens: params.outputTokens ?? null,
    request_count: params.requestCount ?? 1,
    estimated_cost_usd: cost,
  });
  if (error) console.error("[api-usage] log error:", error.message);

  // Check limit
  const check = await checkApiLimit(params.provider);
  return { allowed: check.allowed, warningLevel: check.warningLevel };
}

export async function checkApiLimit(provider: string): Promise<LimitCheck> {
  // Get current month spend
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const { data: usageData, error: usageErr } = await supabase
    .from("api_usage")
    .select("estimated_cost_usd")
    .eq("provider", provider)
    .gte("created_at", monthStart);

  if (usageErr) console.error("[api-usage] query error:", usageErr.message);

  const spentUsd = (usageData ?? []).reduce(
    (sum, row) => sum + (parseFloat(row.estimated_cost_usd) || 0),
    0,
  );

  // Get limit
  const { data: limitData } = await supabase
    .from("api_limits")
    .select("monthly_limit_usd, warning_threshold_pct, hard_limit_enabled")
    .eq("provider", provider)
    .single();

  if (!limitData) {
    return { allowed: true, warningLevel: "ok", percentUsed: 0, spentUsd, limitUsd: 999 };
  }

  const limitUsd = parseFloat(String(limitData.monthly_limit_usd));
  const thresholdPct = limitData.warning_threshold_pct ?? 80;
  const hardLimit = limitData.hard_limit_enabled ?? true;
  const percentUsed = limitUsd > 0 ? (spentUsd / limitUsd) * 100 : 0;

  let warningLevel: "ok" | "warning" | "exceeded" = "ok";
  if (percentUsed >= 100) warningLevel = "exceeded";
  else if (percentUsed >= thresholdPct) warningLevel = "warning";

  const allowed = !(warningLevel === "exceeded" && hardLimit);

  return { allowed, warningLevel, percentUsed, spentUsd, limitUsd };
}
