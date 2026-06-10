import { dbErr } from "@/lib/db-utils";
import { supabase } from "@/lib/supabase";
import type {
  CardType,
  CoachMessage,
  ConversationRow,
  Objective,
  ObjectiveStatus,
  PrdFeedback,
  TeamMessages,
} from "./team-types";

// ── API error ──────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 529) {
    return "Anthropic is currently overloaded. Please wait a moment and try again.";
  }
  return "Something went wrong. Please try again.";
}

// ── API helper ─────────────────────────────────────────────────────────────────

export async function streamChat(
  model: string,
  system: string,
  messages: { role: string; content: string }[],
  maxTokens: number,
  onChunk: (text: string) => void
): Promise<void> {
  const res = await fetch("/api/team/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, system, messages, max_tokens: maxTokens }),
  });

  if (!res.ok) throw new ApiError(res.status, `Request failed: ${res.status}`);

  const data = await res.json();
  const text = data.content?.[0]?.text ?? "";
  if (text) onChunk(text);
}

// ── Supabase helpers ───────────────────────────────────────────────────────────

const OBJECTIVE_COLUMNS = "id, title, description, status, prd, card_type, pm_summary, claude_code_result, discussions, created_at";

export async function saveTeamConversation(problem: string, msgs: TeamMessages): Promise<string | null> {
  const { data, error } = await supabase
    .from("team_conversations")
    .insert({ type: "team", title: problem, messages: msgs })
    .select("id")
    .single();
  if (error) { console.error("[team] save error", dbErr(error)); return null; }
  return data.id as string;
}

export async function updateTeamPrd(id: string, prd: string): Promise<void> {
  const { error } = await supabase.from("team_conversations").update({ prd }).eq("id", id);
  if (error) console.error("[team] prd update error", dbErr(error));
}

export async function upsertCoachConversation(
  id: string | null,
  firstMessage: string,
  history: CoachMessage[]
): Promise<string | null> {
  if (id) {
    const { error } = await supabase
      .from("team_conversations")
      .update({ messages: { history } })
      .eq("id", id);
    if (error) console.error("[coach] update error", dbErr(error));
    return id;
  }
  const { data, error } = await supabase
    .from("team_conversations")
    .insert({ type: "coach", title: firstMessage.slice(0, 60), messages: { history } })
    .select("id")
    .single();
  if (error) { console.error("[coach] insert error", dbErr(error)); return null; }
  return data.id as string;
}

export async function upsertPMConversation(
  id: string | null,
  firstMessage: string,
  history: CoachMessage[]
): Promise<string | null> {
  if (id) {
    const { error } = await supabase
      .from("team_conversations")
      .update({ messages: { history } })
      .eq("id", id);
    if (error) console.error("[pm] update error", dbErr(error));
    return id;
  }
  const { data, error } = await supabase
    .from("team_conversations")
    .insert({ type: "pm", title: firstMessage.slice(0, 60), messages: { history } })
    .select("id")
    .single();
  if (error) { console.error("[pm] insert error", dbErr(error)); return null; }
  return data.id as string;
}

export async function loadObjectives(): Promise<Objective[]> {
  const { data, error } = await supabase
    .from("objectives")
    .select(OBJECTIVE_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) { console.error("[objectives] load error", dbErr(error)); return []; }
  return (data ?? []).map((row) => ({
    ...row,
    card_type: row.card_type ?? "objective",
    discussions: row.discussions ?? [],
  })) as Objective[];
}

export async function saveObjectiveWithDetails(
  title: string,
  description: string | null,
  status: ObjectiveStatus,
  prd?: string | null,
  cardType?: CardType,
  pmSummary?: string | null,
): Promise<Objective | null> {
  const { data, error } = await supabase
    .from("objectives")
    .insert({
      title,
      description: description ?? null,
      status,
      prd: prd ?? null,
      card_type: cardType ?? "objective",
      pm_summary: pmSummary ?? null,
    })
    .select(OBJECTIVE_COLUMNS)
    .single();
  if (error) { console.error("[objectives] save error", dbErr(error)); return null; }
  return { ...data, card_type: data.card_type ?? "objective", discussions: data.discussions ?? [] } as Objective;
}

export async function updateObjectiveStatus(id: string, status: ObjectiveStatus): Promise<void> {
  const { error } = await supabase.from("objectives").update({ status }).eq("id", id);
  if (error) console.error("[objectives] update error", dbErr(error));
}

export async function updateObjectivePrd(id: string, prd: string): Promise<void> {
  const { error } = await supabase
    .from("objectives")
    .update({ prd, status: "refine" })
    .eq("id", id);
  if (error) console.error("[objectives] prd update error", dbErr(error));
}

export async function updateObjectiveField(id: string, fields: Partial<Record<string, unknown>>): Promise<void> {
  const { error } = await supabase.from("objectives").update(fields).eq("id", id);
  if (error) console.error("[objectives] field update error", dbErr(error));
}

export async function deleteObjective(id: string): Promise<void> {
  const { error } = await supabase.from("objectives").delete().eq("id", id);
  if (error) console.error("[objectives] delete error", dbErr(error));
}


export async function loadConversations(type: "team" | "coach" | "pm"): Promise<ConversationRow[]> {
  const { data, error } = await supabase
    .from("team_conversations")
    .select("id, type, title, messages, prd, created_at")
    .eq("type", type)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) { console.error("[conversations] load error", dbErr(error)); return []; }
  return data as ConversationRow[];
}

export async function loadSarahMemory(): Promise<string> {
  const { data, error } = await supabase
    .from("agent_memory")
    .select("content")
    .eq("id", "sarah")
    .single();
  if (error) { console.error("[memory] load error", dbErr(error)); return ""; }
  return (data?.content as string) ?? "";
}

export async function saveSarahMemory(content: string): Promise<void> {
  const { error } = await supabase
    .from("agent_memory")
    .upsert({ id: "sarah", content })
    .eq("id", "sarah");
  if (error) console.error("[memory] save error", dbErr(error));
}

export async function savePrdFeedback(conversationId: string, feedback: string): Promise<void> {
  const { error } = await supabase
    .from("prd_feedback")
    .insert({ conversation_id: conversationId, feedback });
  if (error) console.error("[feedback] save error", dbErr(error));
}

export async function loadPrdFeedback(conversationId: string): Promise<PrdFeedback[]> {
  const { data, error } = await supabase
    .from("prd_feedback")
    .select("id, conversation_id, feedback, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) { console.error("[feedback] load error", dbErr(error)); return []; }
  return data as PrdFeedback[];
}

export async function deleteConversation(id: string): Promise<void> {
  const { error } = await supabase.from("team_conversations").delete().eq("id", id);
  if (error) console.error("[conversations] delete error", dbErr(error));
}
