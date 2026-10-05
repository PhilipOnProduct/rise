/**
 * Server-only guide/tip DB helpers on the service-role admin client.
 *
 * The guide/tip tables (`guides`, `tips`, `tip_ratings`) have RLS enabled
 * with no policies (migration 0020) — the anon key can no longer touch
 * them, so every read/write goes through `getSupabaseAdminClient()`.
 * Never import this module from a client component; the shared types and
 * constants live in `lib/guides.ts`, which stays client-safe.
 */
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

/**
 * Award reputation points to a guide atomically via the
 * `increment_guide_points` RPC (db/migrations/0019_points_rpc.sql).
 *
 * Falls back to the legacy read-then-write pattern when the RPC doesn't
 * exist yet (migration not applied), so the routes keep working across
 * the deploy/migration window. The fallback is racy under concurrent
 * requests — same behaviour as before 0019, not worse.
 */
export async function awardGuidePoints(guideId: string, amount: number): Promise<void> {
  const db = getSupabaseAdminClient();
  const { error } = await db.rpc("increment_guide_points", {
    p_guide_id: guideId,
    p_amount: amount,
  });
  if (!error) return;

  const { data: guide } = await db.from("guides").select("points").eq("id", guideId).single();
  if (!guide) return;
  await db.from("guides").update({ points: guide.points + amount }).eq("id", guideId);
}

/**
 * Increment a tip's view counter atomically via `increment_tip_views`,
 * returning the new count (used for the 10-view milestone). Same
 * fallback contract as awardGuidePoints.
 */
export async function incrementTipViews(tipId: string, currentViews: number): Promise<number> {
  const db = getSupabaseAdminClient();
  const { data, error } = await db.rpc("increment_tip_views", { p_tip_id: tipId });
  if (!error && typeof data === "number") return data;

  const newViews = currentViews + 1;
  const { error: updateError } = await db.from("tips").update({ views: newViews }).eq("id", tipId);
  if (updateError) throw updateError;
  return newViews;
}
