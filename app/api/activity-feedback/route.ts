import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

function dbErr(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const e = err as Record<string, unknown>;
  return [e.message, e.code, e.details, e.hint].filter(Boolean).join(" | ") || JSON.stringify(err);
}

// PHI-45: anything not in this set goes into the metadata jsonb column,
// rather than being silently dropped. The welcome flow fires onboarding
// telemetry events (freeform_initiated, itinerary_viewed, etc.) through
// this endpoint with payloads like { length, dayCount, activityCount,
// hasActivityFeedback, clarifications, destinationCount, hadConstraints }.
// Without metadata persistence, we couldn't measure parser-funnel quality.
const KNOWN_FIELDS = new Set([
  "event",
  "activityId",
  "activityName",
  "activityCategory",
  "chipLabel",
  "chipType",
  "chipsSource",
  "firstChipLabel",
]);

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    event,
    activityId,
    activityName,
    activityCategory,
    chipLabel,
    chipType,
    chipsSource,
    firstChipLabel,
  } = body;

  if (!event) {
    return NextResponse.json({ error: "event is required" }, { status: 400 });
  }

  // PHI-45: harvest unrecognised fields into metadata. Empty object → null.
  const metadata: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!KNOWN_FIELDS.has(k)) metadata[k] = v;
  }
  const hasMetadata = Object.keys(metadata).length > 0;

  const { error } = await supabase.from("activity_feedback").insert({
    event,
    activity_id: activityId ?? null,
    activity_name: activityName ?? null,
    activity_category: activityCategory ?? null,
    chip_label: chipLabel ?? null,
    chip_type: chipType ?? null,
    chips_source: chipsSource ?? null,
    first_chip_label: firstChipLabel ?? null,
    ...(hasMetadata ? { metadata } : {}),
  });

  if (error) {
    console.error("[activity-feedback]", dbErr(error));
    return NextResponse.json({ error: dbErr(error) }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
