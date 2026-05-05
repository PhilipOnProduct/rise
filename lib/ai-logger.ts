import { supabase } from "@/lib/supabase";

type LogEntry = {
  feature: string;
  model: string;
  prompt: string;
  input: object;
  output: string;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  // PHI-40: tag every Anthropic call with the rise_session_id cookie so
  // the cost-report script can group calls by trip. Optional — calls
  // without a session (e.g. internal evals) leave it unset.
  session_id?: string | null;
};

export async function logAiInteraction(entry: LogEntry): Promise<void> {
  const { error } = await supabase.from("ai_logs").insert(entry);
  if (error) {
    console.error("[ai-logger] Failed to log interaction:", error.message);
  }
}
