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
};

export async function logAiInteraction(entry: LogEntry): Promise<void> {
  const { error } = await supabase.from("ai_logs").insert(entry);
  if (error) {
    console.error("[ai-logger] Failed to log interaction:", error.message);
  }
}
