/**
 * PHI-40 — multi-leg cost telemetry report
 *
 * Queries the ai_logs table grouped by session_id, computes Anthropic
 * cost per trip from input/output tokens × Sonnet 4.6 rates, and splits
 * the result into single-leg vs multi-leg buckets. Surfaces median +
 * p95 cost per bucket and the multi-leg / single-leg ratio.
 *
 * Run with:
 *   npm run report:multi-leg-cost
 *   npm run report:multi-leg-cost -- --days 30
 *
 * Decision rule (per CLAUDE.md): if the multi-leg / single-leg ratio
 * crosses 2.5×, surface it. No auto-rollback — this is on-demand
 * observability, not alerting infrastructure.
 *
 * No new dashboard, no new infra — just a script.
 */
import { createClient } from "@supabase/supabase-js";
import { calculateAnthropicCost } from "../lib/api-costs";

// ── CLI args ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function flag(name: string, defaultValue: number): number {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return defaultValue;
  const v = Number(args[i + 1]);
  return Number.isFinite(v) ? v : defaultValue;
}
const DAYS = flag("days", 30);
const RATIO_THRESHOLD = 2.5;

// ── Supabase client ──────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/NEXT_PUBLIC_SUPABASE_ANON_KEY in env."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Types ────────────────────────────────────────────────────────────────

type AiLogRow = {
  session_id: string | null;
  feature: string | null;
  model: string | null;
  input: Record<string, unknown> | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
};

type TripBucket = "single-leg" | "multi-leg";

type TripSummary = {
  sessionId: string;
  bucket: TripBucket;
  callCount: number;
  totalCostUsd: number;
  features: Set<string>;
};

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Decide if a single ai_logs row was for a multi-leg trip. The
 * activities-stream and itinerary-generate routes log `legs` in the
 * input JSONB when multi-leg; parse-trip and other features don't, so
 * we treat absence as single-leg by default.
 */
function rowIsMultiLeg(row: AiLogRow): boolean {
  const legs = row.input?.legs;
  return Array.isArray(legs) && legs.length >= 2;
}

/**
 * A trip is multi-leg if ANY of its calls saw a multi-leg input. (The
 * activities-stream call always sees the same legs[] the user accepted,
 * so this is a reliable trip-level signal.)
 */
function bucketForTrip(rows: AiLogRow[]): TripBucket {
  return rows.some(rowIsMultiLeg) ? "multi-leg" : "single-leg";
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function percentile(nums: number[], pct: number): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();
  console.log(`\nMulti-leg cost report — last ${DAYS} day${DAYS === 1 ? "" : "s"}\n`);

  // Pull every welcome-flow ai_logs row in the window. We filter to the
  // three relevant features so unrelated calls (admin, evals, etc.)
  // don't pollute the trip cost.
  const { data, error } = await supabase
    .from("ai_logs")
    .select("session_id, feature, model, input, input_tokens, output_tokens, created_at")
    .in("feature", ["parse-trip", "activities-stream", "itinerary-generate"])
    .not("session_id", "is", null)
    .gte("created_at", since);

  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }
  const rows: AiLogRow[] = (data ?? []) as AiLogRow[];
  console.log(`Loaded ${rows.length} ai_logs rows.\n`);

  // Group by session_id.
  const bySession = new Map<string, AiLogRow[]>();
  for (const row of rows) {
    if (!row.session_id) continue;
    const arr = bySession.get(row.session_id) ?? [];
    arr.push(row);
    bySession.set(row.session_id, arr);
  }

  // Summarise each trip.
  const trips: TripSummary[] = [];
  for (const [sessionId, sessionRows] of bySession.entries()) {
    let cost = 0;
    const features = new Set<string>();
    for (const r of sessionRows) {
      cost += calculateAnthropicCost(
        r.model ?? "claude-sonnet-4-6",
        r.input_tokens ?? 0,
        r.output_tokens ?? 0
      );
      if (r.feature) features.add(r.feature);
    }
    trips.push({
      sessionId,
      bucket: bucketForTrip(sessionRows),
      callCount: sessionRows.length,
      totalCostUsd: cost,
      features,
    });
  }

  if (trips.length === 0) {
    console.log("No trips with session_id in the window — nothing to report.");
    console.log(
      "If you expected data, confirm the welcome flow has been used since PHI-40 shipped."
    );
    return;
  }

  // Bucket + summarise.
  const single = trips.filter((t) => t.bucket === "single-leg");
  const multi = trips.filter((t) => t.bucket === "multi-leg");

  function summarise(label: string, ts: TripSummary[]) {
    const costs = ts.map((t) => t.totalCostUsd);
    console.log(`${label}`);
    console.log(`  trips:     ${ts.length}`);
    if (ts.length === 0) {
      console.log(`  median:    —`);
      console.log(`  p95:       —`);
      console.log(`  total:     $0`);
      return null;
    }
    const med = median(costs);
    const p95 = percentile(costs, 95);
    const total = costs.reduce((a, b) => a + b, 0);
    console.log(`  median:    ${fmtUsd(med)}`);
    console.log(`  p95:       ${fmtUsd(p95)}`);
    console.log(`  total:     ${fmtUsd(total)}`);
    return med;
  }

  console.log("──── Single-leg ────");
  const singleMed = summarise("Single-leg trips", single);
  console.log("\n──── Multi-leg ────");
  const multiMed = summarise("Multi-leg trips", multi);

  console.log("\n──── Ratio ────");
  if (singleMed && multiMed) {
    const ratio = multiMed / singleMed;
    const flag = ratio > RATIO_THRESHOLD ? "  ⚠ EXCEEDS THRESHOLD" : "";
    console.log(
      `Multi-leg / single-leg median cost ratio: ${ratio.toFixed(2)}× (threshold ${RATIO_THRESHOLD}×)${flag}`
    );
    if (ratio > RATIO_THRESHOLD) {
      console.log(
        "→ Action: revisit prompt-caching, smaller-model fallback, or per-leg parallel calls."
      );
    } else {
      console.log("→ Within budget.");
    }
  } else {
    console.log("Not enough data in both buckets to compute a ratio.");
  }

  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
