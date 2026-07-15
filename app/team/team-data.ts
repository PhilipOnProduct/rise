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

// ── Data helpers ───────────────────────────────────────────────────────────────
//
// These used to call Supabase directly from the browser with the anon key.
// The team tables now have RLS enabled with no policies (migration 0020),
// so all reads/writes go through the /api/team/* routes, which run on the
// service-role admin client behind the site-password perimeter.

async function apiJson<T>(
  label: string,
  input: string,
  init?: RequestInit
): Promise<T | null> {
  try {
    const res = await fetch(input, init);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      console.error(`[${label}] request failed`, res.status, body?.error ?? "");
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(`[${label}] request error`, err);
    return null;
  }
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export async function saveTeamConversation(problem: string, msgs: TeamMessages): Promise<string | null> {
  const data = await apiJson<{ id: string }>("team", "/api/team/conversations", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ type: "team", title: problem, messages: msgs }),
  });
  return data?.id ?? null;
}

export async function updateTeamPrd(id: string, prd: string): Promise<void> {
  await apiJson("team", "/api/team/conversations", {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ id, prd }),
  });
}

async function upsertConversation(
  type: "coach" | "pm",
  id: string | null,
  firstMessage: string,
  history: CoachMessage[]
): Promise<string | null> {
  if (id) {
    await apiJson(type, "/api/team/conversations", {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ id, messages: { history } }),
    });
    return id;
  }
  const data = await apiJson<{ id: string }>(type, "/api/team/conversations", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ type, title: firstMessage.slice(0, 60), messages: { history } }),
  });
  return data?.id ?? null;
}

export async function upsertCoachConversation(
  id: string | null,
  firstMessage: string,
  history: CoachMessage[]
): Promise<string | null> {
  return upsertConversation("coach", id, firstMessage, history);
}

export async function upsertPMConversation(
  id: string | null,
  firstMessage: string,
  history: CoachMessage[]
): Promise<string | null> {
  return upsertConversation("pm", id, firstMessage, history);
}

function normalizeObjective(row: Objective): Objective {
  return {
    ...row,
    card_type: row.card_type ?? "objective",
    discussions: row.discussions ?? [],
  };
}

export async function loadObjectives(): Promise<Objective[]> {
  const data = await apiJson<Objective[]>("objectives", "/api/team/objectives");
  return (data ?? []).map(normalizeObjective);
}

export async function loadObjective(id: string): Promise<Objective | null> {
  const data = await apiJson<Objective>(
    "objectives",
    `/api/team/objectives?id=${encodeURIComponent(id)}`
  );
  return data ? normalizeObjective(data) : null;
}

export async function saveObjectiveWithDetails(
  title: string,
  description: string | null,
  status: ObjectiveStatus,
  prd?: string | null,
  cardType?: CardType,
  pmSummary?: string | null,
): Promise<Objective | null> {
  const data = await apiJson<Objective>("objectives", "/api/team/objectives", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      title,
      description: description ?? null,
      status,
      prd: prd ?? null,
      card_type: cardType ?? "objective",
      pm_summary: pmSummary ?? null,
    }),
  });
  return data ? normalizeObjective(data) : null;
}

export async function updateObjectiveStatus(id: string, status: ObjectiveStatus): Promise<void> {
  await updateObjectiveField(id, { status });
}

export async function updateObjectivePrd(id: string, prd: string): Promise<void> {
  await updateObjectiveField(id, { prd, status: "refine" });
}

export async function updateObjectiveField(id: string, fields: Partial<Record<string, unknown>>): Promise<void> {
  await apiJson("objectives", "/api/team/objectives", {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ id, fields }),
  });
}

export async function deleteObjective(id: string): Promise<void> {
  await apiJson("objectives", `/api/team/objectives?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function loadConversations(type: "team" | "coach" | "pm"): Promise<ConversationRow[]> {
  const data = await apiJson<ConversationRow[]>(
    "conversations",
    `/api/team/conversations?type=${type}`
  );
  return data ?? [];
}

export async function loadSarahMemory(): Promise<string> {
  const data = await apiJson<{ content: string }>("memory", "/api/team/memory");
  return data?.content ?? "";
}

export async function saveSarahMemory(content: string): Promise<void> {
  await apiJson("memory", "/api/team/memory", {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({ content }),
  });
}

export async function savePrdFeedback(conversationId: string, feedback: string): Promise<void> {
  await apiJson("feedback", "/api/team/prd-feedback", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ conversationId, feedback }),
  });
}

export async function loadPrdFeedback(conversationId: string): Promise<PrdFeedback[]> {
  const data = await apiJson<PrdFeedback[]>(
    "feedback",
    `/api/team/prd-feedback?conversationId=${encodeURIComponent(conversationId)}`
  );
  return data ?? [];
}

export async function deleteConversation(id: string): Promise<void> {
  await apiJson("conversations", `/api/team/conversations?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
