/**
 * PHI-61: admin-gated CRUD for eval_results.
 *
 * GET    — list latest 50 results
 * POST   — insert a new result, returns { id }
 * PATCH  — update human_score / human_notes / llm_score / llm_reasoning by id
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminRequest, adminForbiddenResponse } from "@/lib/auth";

const ALLOWED_PATCH_FIELDS = new Set([
  "human_score",
  "human_notes",
  "llm_score",
  "llm_reasoning",
]);

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return adminForbiddenResponse();
  const { data, error } = await getSupabaseAdminClient()
    .from("eval_results")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return adminForbiddenResponse();
  const body = (await req.json()) as Record<string, unknown>;
  const insert: Record<string, unknown> = {};
  for (const k of [
    "test_case_id",
    "model",
    "prompt_used",
    "ai_output",
    "human_score",
    "human_notes",
    "llm_score",
    "llm_reasoning",
  ]) {
    if (k in body) insert[k] = body[k];
  }
  const { data, error } = await getSupabaseAdminClient()
    .from("eval_results")
    .insert(insert)
    .select("id")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  if (!isAdminRequest(req)) return adminForbiddenResponse();
  const body = (await req.json()) as Record<string, unknown>;
  const id = body.id as string | undefined;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === "id") continue;
    if (ALLOWED_PATCH_FIELDS.has(k)) updates[k] = v;
  }

  const { error } = await getSupabaseAdminClient()
    .from("eval_results")
    .update(updates)
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
