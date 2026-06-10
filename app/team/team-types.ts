// ── Types ──────────────────────────────────────────────────────────────────────

export type AgentId = "sarah" | "alex" | "maya" | "luca" | "elena";
export type Phase = "idle" | "framing" | "specialists" | "synthesis" | "done" | "prd";
export type CoachMessage = { role: "user" | "assistant"; content: string };
export type TeamMessages = {
  problem: string;
  framing: string;
  alex: string;
  maya: string;
  luca: string;
  elena: string;
  synthesis: string;
};

export type ConversationRow = {
  id: string;
  type: "team" | "coach" | "pm";
  title: string;
  messages: TeamMessages | { history: CoachMessage[] };
  prd: string | null;
  created_at: string;
};

export type ObjectiveStatus = "backlog" | "refine" | "implement" | "done";
export type CardType = "objective" | "improvement" | "bug";
export type Discussion = {
  date: string;
  summary: string;
  transcript: TeamMessages;
  prd: string | null;
};

export type Objective = {
  id: string;
  title: string;
  description: string | null;
  status: ObjectiveStatus;
  prd: string | null;
  card_type: CardType;
  pm_summary: string | null;
  claude_code_result: string | null;
  discussions: Discussion[];
  created_at: string;
};

export type PrdFeedback = {
  id: string;
  conversation_id: string;
  feedback: string;
  created_at: string;
};
