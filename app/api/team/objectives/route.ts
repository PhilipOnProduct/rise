/**
 * Kanban objectives API — server-side wrapper around `objectives`.
 *
 * Replaces the /team page's direct browser reads/writes on the anon
 * client now that RLS is enabled with no policies (migration 0020).
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { isUuid } from "@/lib/db-utils";

const OBJECTIVE_COLUMNS =
  "id, title, description, status, prd, card_type, pm_summary, claude_code_result, discussions, created_at";

const STATUSES = ["backlog", "refine", "implement", "done"] as const;
const CARD_TYPES = ["objective", "improvement", "bug"] as const;

// Only columns the /team UI legitimately edits are accepted on PATCH.
const PATCHABLE_FIELDS = new Set([
  "title",
  "description",
  "status",
  "prd",
  "card_type",
  "pm_summary",
  "claude_code_result",
  "discussions",
]);

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const db = getSupabaseAdminClient();

  if (id) {
    if (!isUuid(id)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });
    const { data, error } = await db
      .from("objectives")
      .select(OBJECTIVE_COLUMNS)
      .eq("id", id)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  const { data, error } = await db
    .from("objectives")
    .select(OBJECTIVE_COLUMNS)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const { title, description, status, prd, card_type, pm_summary } = await req.json();
  if (typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "title is required." }, { status: 400 });
  }
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }
  if (card_type != null && !CARD_TYPES.includes(card_type as (typeof CARD_TYPES)[number])) {
    return NextResponse.json({ error: "Invalid card_type." }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdminClient()
    .from("objectives")
    .insert({
      title,
      description: description ?? null,
      status,
      prd: prd ?? null,
      card_type: card_type ?? "objective",
      pm_summary: pm_summary ?? null,
    })
    .select(OBJECTIVE_COLUMNS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const { id, fields } = await req.json();
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Valid id is required." }, { status: 400 });
  }
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    return NextResponse.json({ error: "fields object is required." }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
    if (!PATCHABLE_FIELDS.has(key)) {
      return NextResponse.json({ error: `Field not allowed: ${key}` }, { status: 400 });
    }
    update[key] = value;
  }
  if (
    "status" in update &&
    !STATUSES.includes(update.status as (typeof STATUSES)[number])
  ) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { error } = await getSupabaseAdminClient()
    .from("objectives")
    .update(update)
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Valid id is required." }, { status: 400 });
  }

  const { error } = await getSupabaseAdminClient()
    .from("objectives")
    .delete()
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
