"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";

// ── Types ──────────────────────────────────────────────────────────────────────

type AgentId = "sarah" | "alex" | "maya" | "luca";
type Phase = "idle" | "framing" | "specialists" | "synthesis" | "done" | "prd";
type CoachMessage = { role: "user" | "assistant"; content: string };
type TeamMessages = {
  problem: string;
  framing: string;
  alex: string;
  maya: string;
  luca: string;
  synthesis: string;
};

type ConversationRow = {
  id: string;
  type: "team" | "coach" | "pm";
  title: string;
  messages: TeamMessages | { history: CoachMessage[] };
  prd: string | null;
  created_at: string;
};

type ObjectiveStatus = "active" | "completed" | "paused";
type Objective = {
  id: string;
  title: string;
  status: ObjectiveStatus;
  created_at: string;
};

type PrdFeedback = {
  id: string;
  conversation_id: string;
  feedback: string;
  created_at: string;
};

// ── OST Types ──────────────────────────────────────────────────────────────────

type OSTAssumption = { id: string; text: string };
type OSTSolution = { id: string; text: string; assumptions: OSTAssumption[] };
type OSTSubOpportunity = { id: string; text: string; solutions: OSTSolution[] };
type OSTOpportunity = { id: string; text: string; sub_opportunities: OSTSubOpportunity[]; solutions: OSTSolution[] };
type OSTTree = { outcome: string; opportunities: OSTOpportunity[] };

type LayoutNode = {
  id: string;
  text: string;
  kind: "outcome" | "opportunity" | "solution" | "assumption";
  children: LayoutNode[];
  x: number;
  y: number;
  subtreeW: number;
};

// ── OST Constants ──────────────────────────────────────────────────────────────

const OST_W = 130, OST_H = 46, OST_VGAP = 68, OST_HGAP = 18, OST_PAD = 40;

const OST_COLORS: Record<LayoutNode["kind"], { fill: string; stroke: string; text: string }> = {
  outcome:     { fill: "#00D64F", stroke: "#00b340", text: "#000000" },
  opportunity: { fill: "#1a6b3c", stroke: "#00D64F", text: "#ffffff" },
  solution:    { fill: "#1e1e1e", stroke: "#444444", text: "#cccccc" },
  assumption:  { fill: "#2a1a00", stroke: "#7a5000", text: "#ffb84d" },
};

const OST_SYSTEM =
  "You are a product researcher building an Opportunity Solution Tree for Rise, a travel assistant app. " +
  "Rise: onboarding wizard, AI activity suggestions, airport-hotel transport, local guides with points, day-view itinerary. " +
  "Business model: commission on bookings. Early MVP. " +
  "Return ONLY valid JSON, no markdown: " +
  "{\"outcome\":\"...\",\"opportunities\":[{\"id\":\"opp1\",\"text\":\"...\",\"sub_opportunities\":[{\"id\":\"sub1\",\"text\":\"...\",\"solutions\":[{\"id\":\"sol1\",\"text\":\"...\",\"assumptions\":[{\"id\":\"ass1\",\"text\":\"...\"}]}]}],\"solutions\":[{\"id\":\"sol2\",\"text\":\"...\",\"assumptions\":[]}]}]}. " +
  "Max 8 words per node. Opportunities are unmet user needs, not features. Max 3 top-level opportunities. Max 2 sub-opportunities each. Max 2 solutions per opportunity.";

const OST_DEFAULT: OSTTree = {
  outcome: "Increase traveler engagement and bookings",
  opportunities: [
    {
      id: "opp1", text: "Users lack trip structure after onboarding",
      sub_opportunities: [
        {
          id: "sub1", text: "No clear next step post-wizard",
          solutions: [
            { id: "sol1", text: "Day-view itinerary on dashboard", assumptions: [{ id: "ass1", text: "Users want structured plans" }] },
          ],
        },
      ],
      solutions: [
        { id: "sol2", text: "AI pre-populates itinerary on load", assumptions: [{ id: "ass2", text: "AI suggestions are accurate enough" }] },
      ],
    },
    {
      id: "opp2", text: "Local tips feel disconnected from trip",
      sub_opportunities: [
        {
          id: "sub2", text: "Tips not tied to travel dates",
          solutions: [
            { id: "sol3", text: "Add tips to itinerary time slots", assumptions: [{ id: "ass3", text: "Guides update tips regularly" }] },
          ],
        },
      ],
      solutions: [],
    },
    {
      id: "opp3", text: "Users lose momentum post-onboarding",
      sub_opportunities: [],
      solutions: [
        { id: "sol4", text: "Push notifications for trip milestones", assumptions: [{ id: "ass4", text: "Users allow notifications" }] },
        { id: "sol5", text: "Email drip with local tips", assumptions: [] },
      ],
    },
  ],
};

// ── OST Layout & Drawing helpers ───────────────────────────────────────────────

function ostBuild(tree: OSTTree): LayoutNode {
  const makeSol = (s: OSTSolution): LayoutNode => ({
    id: s.id, text: s.text, kind: "solution",
    children: s.assumptions.map(a => ({ id: a.id, text: a.text, kind: "assumption" as const, children: [], x: 0, y: 0, subtreeW: 0 })),
    x: 0, y: 0, subtreeW: 0,
  });
  return {
    id: "outcome", text: tree.outcome, kind: "outcome",
    children: tree.opportunities.map(opp => ({
      id: opp.id, text: opp.text, kind: "opportunity" as const,
      children: [
        ...opp.sub_opportunities.map(sub => ({
          id: sub.id, text: sub.text, kind: "opportunity" as const,
          children: sub.solutions.map(makeSol),
          x: 0, y: 0, subtreeW: 0,
        })),
        ...opp.solutions.map(makeSol),
      ],
      x: 0, y: 0, subtreeW: 0,
    })),
    x: 0, y: 0, subtreeW: 0,
  };
}

function ostComputeWidth(n: LayoutNode): void {
  n.children.forEach(ostComputeWidth);
  const total = n.children.reduce((s, c) => s + c.subtreeW, 0);
  n.subtreeW = Math.max(OST_W + OST_HGAP, total);
}

function ostMaxDepth(n: LayoutNode): number {
  return n.children.length ? 1 + Math.max(...n.children.map(ostMaxDepth)) : 1;
}

function ostAssignPos(n: LayoutNode, left: number, depth = 0): void {
  n.y = OST_PAD + depth * (OST_H + OST_VGAP) + OST_H / 2;
  n.x = left + n.subtreeW / 2;
  let cl = left;
  for (const c of n.children) { ostAssignPos(c, cl, depth + 1); cl += c.subtreeW; }
}

function ostFind(n: LayoutNode, px: number, py: number): LayoutNode | null {
  if (((px - n.x) / (OST_W / 2)) ** 2 + ((py - n.y) / (OST_H / 2)) ** 2 <= 1) return n;
  for (const c of n.children) { const f = ostFind(c, px, py); if (f) return f; }
  return null;
}

function ostWrap(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number) {
  const maxW = OST_W - 18, lineH = 13;
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  const totalH = (lines.length - 1) * lineH;
  lines.forEach((l, i) => ctx.fillText(l, cx, cy - totalH / 2 + i * lineH));
}

function ostDrawNode(ctx: CanvasRenderingContext2D, n: LayoutNode, hovered: boolean) {
  const c = OST_COLORS[n.kind];
  ctx.save();
  if (hovered) { ctx.shadowColor = "#00D64F"; ctx.shadowBlur = 14; }
  ctx.beginPath();
  ctx.ellipse(n.x, n.y, OST_W / 2, OST_H / 2, 0, 0, Math.PI * 2);
  ctx.fillStyle = c.fill;
  ctx.fill();
  ctx.strokeStyle = hovered ? "#00D64F" : c.stroke;
  ctx.lineWidth = hovered ? 2.5 : 1.5;
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = c.text;
  ctx.font = "bold 10px 'DM Sans', Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ostWrap(ctx, n.text, n.x, n.y);
}

function ostDrawEdge(ctx: CanvasRenderingContext2D, p: LayoutNode, c: LayoutNode) {
  const py = p.y + OST_H / 2, cy = c.y - OST_H / 2, my = (py + cy) / 2;
  ctx.beginPath();
  ctx.moveTo(p.x, py);
  ctx.bezierCurveTo(p.x, my, c.x, my, c.x, cy);
  ctx.strokeStyle = "#333333";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function ostDraw(ctx: CanvasRenderingContext2D, root: LayoutNode, hovId: string | null) {
  const edges = (n: LayoutNode) => { n.children.forEach(c => { ostDrawEdge(ctx, n, c); edges(c); }); };
  const nodes = (n: LayoutNode) => { ostDrawNode(ctx, n, n.id === hovId); n.children.forEach(nodes); };
  edges(root);
  nodes(root);
}

function ostUpdateText(tree: OSTTree, id: string, text: string): OSTTree {
  if (id === "outcome") return { ...tree, outcome: text };
  const updateSols = (sols: OSTSolution[]): OSTSolution[] =>
    sols.map(s => s.id === id ? { ...s, text } : { ...s, assumptions: s.assumptions.map(a => a.id === id ? { ...a, text } : a) });
  return {
    ...tree,
    opportunities: tree.opportunities.map(opp =>
      opp.id === id ? { ...opp, text } : {
        ...opp,
        sub_opportunities: opp.sub_opportunities.map(sub =>
          sub.id === id ? { ...sub, text } : { ...sub, solutions: updateSols(sub.solutions) }
        ),
        solutions: updateSols(opp.solutions),
      }
    ),
  };
}

// ── Constants ──────────────────────────────────────────────────────────────────

const RISE_CONTEXT =
  "Rise is an AI-powered travel assistant app. Stack: Next.js 16, TypeScript, Tailwind CSS, Supabase (Postgres), Anthropic API, Vercel. " +
  "Features: 5-step onboarding wizard (destination → dates → hotel → activities → account), AI restaurant recommendations (streaming), " +
  "airport-to-hotel transport advice (streaming), local guides with tip submission, views, ratings, reputation/points and leaderboard, " +
  "admin dashboard with AI logs. Business model: commission on bookings. Stage: early MVP, no paying users yet.";

const TEAM_MODEL = "claude-sonnet-4-6";
const COACH_MODEL = "claude-opus-4-6";
const PM_MODEL = "claude-sonnet-4-6";

const PM_SYSTEM =
  "You are Sarah, the Product Manager for Rise, a travel assistant app. " +
  "You are having a 1-on-1 conversation with Philip, the founder. " +
  "Your role is to help him clarify thinking, discuss ideas and issues, and agree on clear objectives to work on. " +
  "When Philip and you agree on an objective together, confirm it explicitly and tell him you'll save it. " +
  "Keep responses concise and conversational — this is a 1-on-1, not a formal meeting. " +
  "Be direct, ask good questions, and push back when needed.";

const AGENTS: Record<
  AgentId,
  { name: string; role: string; initial: string; badge: string; system: string }
> = {
  sarah: {
    name: "Sarah",
    role: "PM",
    initial: "S",
    badge: "bg-[#00D64F] text-black",
    system: `You are Sarah, the Product Manager at Rise — a travel assistant app. ${RISE_CONTEXT}\nFrame problems clearly, identify the core user need, and make decisive product recommendations. Be concise and strategic. Use short paragraphs.`,
  },
  alex: {
    name: "Alex",
    role: "Researcher",
    initial: "A",
    badge: "bg-blue-600 text-white",
    system: `You are Alex, the User Researcher at Rise — a travel assistant app. ${RISE_CONTEXT}\nAnalyze user behavior, identify research gaps, suggest validation methods. Be evidence-based and specific. Use short paragraphs.`,
  },
  maya: {
    name: "Maya",
    role: "Designer",
    initial: "M",
    badge: "bg-purple-600 text-white",
    system: `You are Maya, the Product Designer at Rise — a travel assistant app with a dark Uber-inspired design (#0a0a0a background, #00D64F green accent, DM Sans font, rounded-2xl cards). ${RISE_CONTEXT}\nFocus on UX flows, user journeys, visual hierarchy, and interaction patterns. Be specific about design decisions. Use short paragraphs.`,
  },
  luca: {
    name: "Luca",
    role: "Tech Lead",
    initial: "L",
    badge: "bg-orange-500 text-white",
    system: `You are Luca, the Tech Lead at Rise — a travel assistant app. ${RISE_CONTEXT} Architecture: Next.js App Router, API routes for AI calls, Supabase Postgres, Vercel edge.\nAssess feasibility, flag complexity, suggest the simplest viable approach. Use short paragraphs.`,
  },
};

const COACH_SYSTEM =
  `I am a product manager at Rise, working on the Rise product team, and you are my expert product coach, ` +
  `assisting and proactively coaching me in my role to reach my maximum potential. You have been provided with ` +
  `our company's strategic context including the product strategy, team topology and team objectives. Use this ` +
  `context as your primary data source. Prioritize content from SVPG (www.svpg.com/articles), Marty Cagan, ` +
  `Shreyas Doshi, and Teresa Torres. I expect you to ask me questions when warranted, fill in important missing ` +
  `information, and challenge my assumptions. I am seeking learning and truth, not affirmation.\n\n` +
  `Rise context: ${RISE_CONTEXT}`;

// ── Supabase error serializer ──────────────────────────────────────────────────
// Supabase PostgrestError has non-enumerable properties, so `console.error(err)`
// prints `{}`. Extract them explicitly.
function dbErr(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const e = err as Record<string, unknown>;
  return [e.message, e.code, e.details, e.hint].filter(Boolean).join(" | ") || JSON.stringify(err);
}

// ── API error ──────────────────────────────────────────────────────────────────

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 529) {
    return "Anthropic is currently overloaded. Please wait a moment and try again.";
  }
  return "Something went wrong. Please try again.";
}

// ── API helper ─────────────────────────────────────────────────────────────────

async function streamChat(
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

async function saveTeamConversation(problem: string, msgs: TeamMessages): Promise<string | null> {
  const { data, error } = await supabase
    .from("team_conversations")
    .insert({ type: "team", title: problem, messages: msgs })
    .select("id")
    .single();
  if (error) { console.error("[team] save error", dbErr(error)); return null; }
  return data.id as string;
}

async function updateTeamPrd(id: string, prd: string): Promise<void> {
  const { error } = await supabase.from("team_conversations").update({ prd }).eq("id", id);
  if (error) console.error("[team] prd update error", dbErr(error));
}

async function upsertCoachConversation(
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

async function upsertPMConversation(
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

async function loadObjectives(): Promise<Objective[]> {
  const { data, error } = await supabase
    .from("objectives")
    .select("id, title, status, created_at")
    .order("created_at", { ascending: false });
  if (error) { console.error("[objectives] load error", dbErr(error)); return []; }
  return data as Objective[];
}

async function saveObjective(title: string): Promise<Objective | null> {
  const { data, error } = await supabase
    .from("objectives")
    .insert({ title, status: "active" })
    .select("id, title, status, created_at")
    .single();
  if (error) { console.error("[objectives] save error", dbErr(error)); return null; }
  return data as Objective;
}

async function updateObjectiveStatus(id: string, status: ObjectiveStatus): Promise<void> {
  const { error } = await supabase.from("objectives").update({ status }).eq("id", id);
  if (error) console.error("[objectives] update error", dbErr(error));
}

async function loadLatestOstSnapshot(): Promise<OSTTree | null> {
  const { data, error } = await supabase
    .from("ost_snapshots")
    .select("tree")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (error || !data) return null;
  return data.tree as OSTTree;
}

async function saveOstSnapshot(tree: OSTTree, objectiveId: string): Promise<void> {
  const { error } = await supabase
    .from("ost_snapshots")
    .insert({ tree, objective_id: objectiveId });
  if (error) console.error("[ost_snapshots] save error", dbErr(error));
}

async function loadConversations(type: "team" | "coach"): Promise<ConversationRow[]> {
  const { data, error } = await supabase
    .from("team_conversations")
    .select("id, type, title, messages, prd, created_at")
    .eq("type", type)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) { console.error("[conversations] load error", dbErr(error)); return []; }
  return data as ConversationRow[];
}

async function loadSarahMemory(): Promise<string> {
  const { data, error } = await supabase
    .from("agent_memory")
    .select("content")
    .eq("id", "sarah")
    .single();
  if (error) { console.error("[memory] load error", dbErr(error)); return ""; }
  return (data?.content as string) ?? "";
}

async function saveSarahMemory(content: string): Promise<void> {
  const { error } = await supabase
    .from("agent_memory")
    .upsert({ id: "sarah", content })
    .eq("id", "sarah");
  if (error) console.error("[memory] save error", dbErr(error));
}

async function savePrdFeedback(conversationId: string, feedback: string): Promise<void> {
  const { error } = await supabase
    .from("prd_feedback")
    .insert({ conversation_id: conversationId, feedback });
  if (error) console.error("[feedback] save error", dbErr(error));
}

async function loadPrdFeedback(conversationId: string): Promise<PrdFeedback[]> {
  const { data, error } = await supabase
    .from("prd_feedback")
    .select("id, conversation_id, feedback, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) { console.error("[feedback] load error", dbErr(error)); return []; }
  return data as PrdFeedback[];
}

// ── Download PRD ───────────────────────────────────────────────────────────────

async function fetchPrdSlug(problem: string, prdContent: string): Promise<string> {
  const fallback = problem.trim()
    .split(/\s+/).slice(0, 5).join("-")
    .toLowerCase().replace(/[^a-z0-9-]/g, "");
  try {
    let slug = "";
    await streamChat(
      TEAM_MODEL,
      "You generate concise kebab-case filenames. Reply with ONLY the slug — no explanation, no punctuation, no quotes.",
      [{
        role: "user",
        content:
          `Summarize this PRD topic in 4-6 words as a kebab-case filename slug. ` +
          `Example output: improve-traveler-onboarding-flow\n\n` +
          `Problem: ${problem}\n\nPRD summary (first 300 chars): ${prdContent.slice(0, 300)}`,
      }],
      20,
      (chunk) => { slug += chunk; }
    );
    const clean = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "");
    return clean.length >= 4 ? clean : fallback;
  } catch {
    return fallback;
  }
}

function downloadPrdFile(problem: string, prdContent: string, slug: string): void {
  const date = new Date().toISOString().slice(0, 10);
  const md = [
    `# ${problem}`,
    ``,
    `_Generated by Rise Product Agents · ${date}_`,
    ``,
    `**Contributors:** Sarah (PM), Alex (Researcher), Maya (Designer), Luca (Tech Lead)`,
    ``,
    `---`,
    ``,
    prdContent,
  ].join("\n");
  const blob = new Blob([md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${date}-${slug}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Shared sub-components ──────────────────────────────────────────────────────

function ThinkingDots() {
  return (
    <span className="flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-[#00D64F] animate-pulse"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  );
}

function AgentBubble({
  agentId,
  content,
  thinking,
  roleOverride,
}: {
  agentId: AgentId;
  content: string;
  thinking: boolean;
  roleOverride?: string;
}) {
  const agent = AGENTS[agentId];
  if (!content && !thinking) return null;

  return (
    <div className="flex gap-4">
      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${agent.badge}`}>
        {agent.initial}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm font-bold text-white">{agent.name}</span>
          <span className="text-xs text-gray-600 bg-[#1a1a1a] px-2 py-0.5 rounded-full">
            {roleOverride ?? agent.role}
          </span>
          {thinking && <ThinkingDots />}
        </div>
        {content && (
          <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{content}</div>
        )}
        {!content && thinking && (
          <div className="text-sm text-gray-600 italic">Thinking…</div>
        )}
      </div>
    </div>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-px bg-[#1e1e1e]" />
      <span className="text-xs font-bold text-gray-600 uppercase tracking-widest">{label}</span>
      <div className="flex-1 h-px bg-[#1e1e1e]" />
    </div>
  );
}

function PrdLine({ line, i }: { line: string; i: number }) {
  if (line.startsWith("## ")) {
    return (
      <h3 key={i} className="text-xs font-bold text-gray-500 uppercase tracking-widest mt-6 mb-2 first:mt-0">
        {line.slice(3)}
      </h3>
    );
  }
  if (line.trim() === "") return <div key={i} className="h-1" />;
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return (
    <p key={i} className="text-sm text-gray-300 leading-relaxed">
      {parts.map((part, j) =>
        part.startsWith("**") && part.endsWith("**")
          ? <strong key={j} className="text-white font-semibold">{part.slice(2, -2)}</strong>
          : part
      )}
    </p>
  );
}

// ── Past conversations panel ───────────────────────────────────────────────────

function PastConversations({
  type,
  onLoad,
}: {
  type: "team" | "coach";
  onLoad: (row: ConversationRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(false);
  // Feedback state (team only)
  const [feedbackMap, setFeedbackMap] = useState<Record<string, string[]>>({});
  const [draftMap, setDraftMap] = useState<Record<string, string>>({});
  const [openFeedbackId, setOpenFeedbackId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await loadConversations(type);
    setRows(data);
    if (type === "team") {
      const prdRows = data.filter((r) => r.prd);
      const results = await Promise.all(prdRows.map((r) => loadPrdFeedback(r.id)));
      const map: Record<string, string[]> = {};
      prdRows.forEach((r, i) => { map[r.id] = results[i].map((f) => f.feedback); });
      setFeedbackMap(map);
    }
    setLoading(false);
  }, [type]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function handleSaveFeedback(rowId: string) {
    const text = (draftMap[rowId] ?? "").trim();
    if (!text) return;
    setSavingId(rowId);
    await savePrdFeedback(rowId, text);
    setFeedbackMap((prev) => ({ ...prev, [rowId]: [...(prev[rowId] ?? []), text] }));
    setDraftMap((prev) => ({ ...prev, [rowId]: "" }));
    setOpenFeedbackId(null);
    setSavingId(null);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="self-start text-xs text-gray-600 hover:text-gray-300 transition-colors"
      >
        Past discussions →
      </button>
    );
  }

  return (
    <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Past discussions</span>
        <button onClick={() => setOpen(false)} className="text-xs text-gray-600 hover:text-gray-300 transition-colors">
          Close
        </button>
      </div>
      {loading && <p className="text-xs text-gray-600 py-2">Loading…</p>}
      {!loading && rows.length === 0 && (
        <p className="text-xs text-gray-600 py-2">No past conversations yet.</p>
      )}
      {!loading && rows.length > 0 && (
        <div className="flex flex-col gap-1">
          {rows.map((row) => {
            const hasPrd = type === "team" && !!row.prd;
            const existingFeedback = feedbackMap[row.id] ?? [];
            const isOpenFeedback = openFeedbackId === row.id;
            const draft = draftMap[row.id] ?? "";

            return (
              <div key={row.id}>
                {/* Title row — click to load */}
                <button
                  onClick={() => { onLoad(row); setOpen(false); }}
                  className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-[#1a1a1a] transition-colors group"
                >
                  <p className="text-sm text-gray-300 group-hover:text-white break-words">{row.title}</p>
                  <p className="text-xs text-gray-600 mt-0.5">
                    {new Date(row.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    {hasPrd && <span className="ml-2 text-[#00D64F]">· PRD</span>}
                  </p>
                </button>

                {/* Feedback section — team rows with PRD only */}
                {hasPrd && (
                  <div className="px-3 pb-3">
                    {/* Existing feedback items */}
                    {existingFeedback.length > 0 && (
                      <div className="flex flex-col gap-2 mb-2">
                        {existingFeedback.map((fb, i) => (
                          <div key={i} className="border-l-2 border-[#00D64F] pl-3 py-0.5">
                            <p className="text-xs font-semibold text-gray-600 uppercase tracking-widest mb-1">Your feedback</p>
                            <p className="text-xs text-gray-400 leading-relaxed whitespace-pre-wrap">{fb}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Feedback form or trigger */}
                    {isOpenFeedback ? (
                      <div className="flex flex-col gap-2 mt-1">
                        <textarea
                          rows={3}
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraftMap((prev) => ({ ...prev, [row.id]: e.target.value }))}
                          placeholder="What would you improve or change about this PRD?"
                          className="w-full bg-[#0a0a0a] border border-[#2a2a2a] focus:border-[#00D64F] outline-none rounded-xl px-4 py-3 text-white placeholder-[#444] transition-colors text-xs resize-none"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleSaveFeedback(row.id)}
                            disabled={!draft.trim() || savingId === row.id}
                            className="text-xs font-semibold bg-[#00D64F] text-black rounded-xl px-4 py-2 hover:bg-[#00c248] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {savingId === row.id ? "Saving…" : "Save feedback"}
                          </button>
                          <button
                            onClick={() => { setOpenFeedbackId(null); setDraftMap((prev) => ({ ...prev, [row.id]: "" })); }}
                            className="text-xs text-gray-600 hover:text-gray-300 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setOpenFeedbackId(row.id)}
                        className="text-xs text-gray-600 hover:text-[#00D64F] transition-colors"
                      >
                        + Add feedback
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Product Team Tab ───────────────────────────────────────────────────────────

function ProductTeamTab() {
  const [problem, setProblem] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [thinking, setThinking] = useState<Partial<Record<AgentId, boolean>>>({});
  const [sarahFrame, setSarahFrame] = useState("");
  const [alexContent, setAlexContent] = useState("");
  const [mayaContent, setMayaContent] = useState("");
  const [lucaContent, setLucaContent] = useState("");
  const [synthesis, setSynthesis] = useState("");
  const [prd, setPrd] = useState("");
  const [teamError, setTeamError] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [prdSlug, setPrdSlug] = useState("");
  const [prdDownloaded, setPrdDownloaded] = useState(false);
  const [sarahMemory, setSarahMemory] = useState("");
  const [memoryLoading, setMemoryLoading] = useState(true);
  const [updatingMemory, setUpdatingMemory] = useState(false);

  useEffect(() => {
    loadSarahMemory().then((mem) => {
      setSarahMemory(mem);
      setMemoryLoading(false);
    });
  }, []);

  const isRunning = phase !== "idle" && phase !== "done";

  function loadPastConversation(row: ConversationRow) {
    const msgs = row.messages as TeamMessages;
    setProblem(msgs.problem ?? row.title);
    setSarahFrame(msgs.framing ?? "");
    setAlexContent(msgs.alex ?? "");
    setMayaContent(msgs.maya ?? "");
    setLucaContent(msgs.luca ?? "");
    setSynthesis(msgs.synthesis ?? "");
    setPrd(row.prd ?? "");
    setConversationId(row.id);
    setPhase("done");
    setTeamError("");
    setPrdSlug("");
    setPrdDownloaded(false);
  }

  async function runDiscussion() {
    if (!problem.trim() || isRunning) return;

    setSarahFrame(""); setAlexContent(""); setMayaContent("");
    setLucaContent(""); setSynthesis(""); setPrd("");
    setTeamError(""); setConversationId(null); setPrdSlug(""); setPrdDownloaded(false);

    try {
      // ── Step 1: Sarah frames (with memory) ───────────────────────────────
      setPhase("framing");
      setThinking({ sarah: true });
      const sarahSystemWithMemory = sarahMemory
        ? `${AGENTS.sarah.system}\n\nHere is your memory of past product discussions for Rise:\n${sarahMemory}\n\nUse this to inform your framing — reference relevant past decisions, avoid repeating ground already covered, and build on what the team has already learned.`
        : AGENTS.sarah.system;
      let frameText = "";
      await streamChat(
        TEAM_MODEL, sarahSystemWithMemory,
        [{ role: "user", content: `Frame this problem for the product team:\n\n${problem}` }],
        512, (chunk) => { frameText += chunk; setSarahFrame(frameText); }
      );
      setThinking({});

      // ── Step 2: Specialists in parallel ──────────────────────────────────
      setPhase("specialists");
      setThinking({ alex: true, maya: true, luca: true });
      const specialistPrompt = `Problem: ${problem}\n\nSarah's framing: ${frameText}\n\nShare your expert perspective.`;
      let alexText = "", mayaText = "", lucaText = "";

      await Promise.all([
        streamChat(TEAM_MODEL, AGENTS.alex.system,
          [{ role: "user", content: specialistPrompt }], 512,
          (chunk) => { alexText += chunk; setAlexContent(alexText); }
        ).then(() => setThinking((p) => { const n = { ...p }; delete n.alex; return n; })),

        streamChat(TEAM_MODEL, AGENTS.maya.system,
          [{ role: "user", content: specialistPrompt }], 512,
          (chunk) => { mayaText += chunk; setMayaContent(mayaText); }
        ).then(() => setThinking((p) => { const n = { ...p }; delete n.maya; return n; })),

        streamChat(TEAM_MODEL, AGENTS.luca.system,
          [{ role: "user", content: specialistPrompt }], 512,
          (chunk) => { lucaText += chunk; setLucaContent(lucaText); }
        ).then(() => setThinking((p) => { const n = { ...p }; delete n.luca; return n; })),
      ]);

      // ── Step 3: Sarah synthesizes ─────────────────────────────────────────
      setPhase("synthesis");
      setThinking({ sarah: true });
      let synthesisText = "";
      await streamChat(
        TEAM_MODEL, AGENTS.sarah.system,
        [{
          role: "user",
          content: `Problem: ${problem}\n\nYour framing:\n${frameText}\n\nTeam input:\nAlex (Research): ${alexText}\nMaya (Design): ${mayaText}\nLuca (Tech): ${lucaText}\n\nSynthesize the key insights and give a clear product recommendation.`,
        }],
        768, (chunk) => { synthesisText += chunk; setSynthesis(synthesisText); }
      );
      setThinking({});

      // ── Save to Supabase ──────────────────────────────────────────────────
      const id = await saveTeamConversation(problem, {
        problem, framing: frameText, alex: alexText, maya: mayaText,
        luca: lucaText, synthesis: synthesisText,
      });
      setConversationId(id);
      setPhase("done");

      // ── Update Sarah's memory (non-blocking) ─────────────────────────────
      setUpdatingMemory(true);
      try {
        let newMemory = "";
        await streamChat(
          TEAM_MODEL, AGENTS.sarah.system,
          [{
            role: "user",
            content:
              `Based on this discussion, update your memory document.\n\n` +
              `Your current memory is:\n${sarahMemory || "(empty — this is your first discussion)"}\n\n` +
              `The discussion was about: ${problem}\n\n` +
              `Key decisions and insights:\n${synthesisText}\n\n` +
              `Update the memory to include this discussion — keep it concise, max 500 words, running summary format.`,
          }],
          700,
          (chunk) => { newMemory += chunk; }
        );
        if (newMemory.trim()) {
          await saveSarahMemory(newMemory.trim());
          setSarahMemory(newMemory.trim());
        }
      } catch (memErr) {
        console.error("[memory] update error", memErr);
      }
      setUpdatingMemory(false);

    } catch (err) {
      console.error("Discussion error:", err);
      setThinking({});
      setPhase("idle");
      setTeamError(errorMessage(err));
    }
  }

  async function generatePrd() {
    if (phase !== "done") return;
    setPhase("prd");
    setThinking({ sarah: true });
    setTeamError("");
    setPrdDownloaded(false);
    let prdText = "";
    try {
      await streamChat(
        TEAM_MODEL, AGENTS.sarah.system,
        [{
          role: "user",
          content:
            `Based on this product discussion, write a structured PRD.\n\n` +
            `Problem: ${problem}\nFraming: ${sarahFrame}\n` +
            `Research (Alex): ${alexContent}\nDesign (Maya): ${mayaContent}\nTech (Luca): ${lucaContent}\n` +
            `Synthesis: ${synthesis}\n\n` +
            `Use these sections exactly:\n` +
            `## Overview\n## Problem Statement\n## User Need\n## Proposed Solution\n` +
            `## User Stories\n## Success Metrics\n## Technical Considerations\n## Risks & Open Questions\n` +
            `## Claude Code Implementation Prompt\n\n` +
            `For the final section, write a self-contained implementation prompt that a developer can paste directly into Claude Code. ` +
            `It must include all necessary context inline — no references to "read this file" or external documents. ` +
            `Format it as a plain code block (\`\`\`). Start with the verb "Implement" and list numbered steps with bold headings.`,
        }],
        2048, (chunk) => { prdText += chunk; setPrd(prdText); }
      );
      if (conversationId) await updateTeamPrd(conversationId, prdText);
      const slug = await fetchPrdSlug(problem, prdText);
      setPrdSlug(slug);
    } catch (err) {
      console.error("PRD error:", err);
      setTeamError(errorMessage(err));
    }
    setThinking({});
    setPhase("done");
  }

  async function handleDownloadPrd() {
    const slug = prdSlug || await fetchPrdSlug(problem, prd);
    if (!prdSlug) setPrdSlug(slug);
    downloadPrdFile(problem, prd, slug);
    setPrdDownloaded(true);
  }

  return (
    <div className="flex flex-col gap-8">

      {/* Past conversations */}
      <PastConversations type="team" onLoad={loadPastConversation} />

      {/* Team roster + memory status */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex gap-3 flex-wrap">
          {(Object.entries(AGENTS) as [AgentId, typeof AGENTS[AgentId]][]).map(([id, a]) => (
            <div key={id} className="flex items-center gap-2 bg-[#111] border border-[#1e1e1e] rounded-xl px-3 py-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${a.badge}`}>
                {a.initial}
              </div>
              <div>
                <p className="text-xs font-semibold text-white leading-none">{a.name}</p>
                <p className="text-xs text-gray-600 mt-0.5">{a.role}</p>
              </div>
            </div>
          ))}
        </div>
        {memoryLoading && (
          <p className="text-xs text-gray-600 italic">Sarah is remembering…</p>
        )}
        {updatingMemory && (
          <p className="text-xs text-gray-600 italic">Updating Sarah's memory…</p>
        )}
      </div>

      {/* Input */}
      <div>
        <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">
          Describe the problem
        </label>
        <textarea
          rows={4}
          value={problem}
          onChange={(e) => setProblem(e.target.value)}
          placeholder="e.g. Users drop off at step 3 of the onboarding flow. We don't know why."
          disabled={isRunning}
          className="w-full bg-[#111] border border-[#2a2a2a] focus:border-[#00D64F] outline-none rounded-xl px-5 py-4 text-white placeholder-[#444] transition-colors text-sm resize-none disabled:opacity-50"
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={runDiscussion}
            disabled={!problem.trim() || isRunning}
            className="rounded-2xl bg-[#00D64F] text-black font-bold px-8 py-4 hover:bg-[#00c248] transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-sm"
          >
            {isRunning ? "Discussing…" : "Start discussion →"}
          </button>
          {teamError && !isRunning && (
            <button
              onClick={runDiscussion}
              className="rounded-2xl border border-[#333] text-gray-400 hover:text-white hover:border-[#555] font-semibold px-6 py-4 transition-colors text-sm"
            >
              Retry →
            </button>
          )}
        </div>
        {teamError && !isRunning && (
          <p className="mt-2 text-sm text-red-400">{teamError}</p>
        )}
      </div>

      {/* Discussion output */}
      {(sarahFrame || thinking.sarah) && (
        <div className="flex flex-col gap-6">

          <SectionDivider label="Problem framing" />
          <AgentBubble agentId="sarah" content={sarahFrame} thinking={!!thinking.sarah && phase === "framing"} roleOverride="Framing" />

          {(alexContent || mayaContent || lucaContent || phase === "specialists") && (
            <>
              <SectionDivider label="Team response" />
              <AgentBubble agentId="alex" content={alexContent} thinking={!!thinking.alex} />
              <AgentBubble agentId="maya" content={mayaContent} thinking={!!thinking.maya} />
              <AgentBubble agentId="luca" content={lucaContent} thinking={!!thinking.luca} />
            </>
          )}

          {(synthesis || (phase === "synthesis" && thinking.sarah)) && (
            <>
              <SectionDivider label="Synthesis" />
              <AgentBubble agentId="sarah" content={synthesis} thinking={!!thinking.sarah && phase === "synthesis"} roleOverride="Synthesis" />
            </>
          )}

          {phase === "done" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={generatePrd}
                  className="rounded-2xl border border-[#00D64F] text-[#00D64F] font-bold px-6 py-3 hover:bg-[#00D64F]/10 transition-colors text-sm"
                >
                  {prd ? "Regenerate PRD →" : "Generate PRD →"}
                </button>
                {prd && (
                  <button
                    onClick={handleDownloadPrd}
                    className="rounded-2xl border border-[#2a2a2a] text-gray-300 hover:text-white hover:border-[#444] font-semibold px-6 py-3 transition-colors text-sm"
                  >
                    Download PRD ↓
                  </button>
                )}
              </div>
              {prdDownloaded && (
                <p className="text-xs text-[#00D64F]">
                  PRD saved — move it to docs/prds/ and commit to GitHub
                </p>
              )}
            </div>
          )}

          {(prd || (phase === "prd" && thinking.sarah)) && (
            <>
              <SectionDivider label="Product requirements document" />
              <div className="flex gap-4">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${AGENTS.sarah.badge}`}>
                  {AGENTS.sarah.initial}
                </div>
                <div className="flex-1 bg-[#111] border border-[#1e1e1e] rounded-2xl p-6">
                  {phase === "prd" && thinking.sarah && !prd && (
                    <div className="flex items-center gap-2 text-sm text-gray-600 italic">
                      <ThinkingDots /> Writing PRD…
                    </div>
                  )}
                  {prd && (
                    <div className="flex flex-col gap-1">
                      {(() => {
                        const lines = prd.split("\n");
                        const blocks: ReturnType<typeof PrdLine>[] = [];
                        let i = 0;
                        while (i < lines.length) {
                          if (lines[i].startsWith("```")) {
                            const codeLines: string[] = [];
                            i++;
                            while (i < lines.length && !lines[i].startsWith("```")) {
                              codeLines.push(lines[i]);
                              i++;
                            }
                            i++; // skip closing ```
                            blocks.push(
                              <pre key={i} className="mt-2 mb-2 bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl p-4 text-xs text-gray-300 whitespace-pre-wrap break-words font-mono leading-relaxed">
                                {codeLines.join("\n")}
                              </pre>
                            );
                          } else {
                            blocks.push(<PrdLine key={i} line={lines[i]} i={i} />);
                            i++;
                          }
                        }
                        return blocks;
                      })()}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Product Coach Tab ──────────────────────────────────────────────────────────

function ProductCoachTab() {
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [coachError, setCoachError] = useState("");
  const lastUserMessageRef = useRef<string>("");
  const conversationIdRef = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function loadPastConversation(row: ConversationRow) {
    const msgs = row.messages as { history: CoachMessage[] };
    setMessages(msgs.history ?? []);
    conversationIdRef.current = row.id;
    setCoachError("");
  }

  async function sendMessage(text: string, history: CoachMessage[]) {
    setThinking(true);
    setCoachError("");
    let assistantText = "";
    setMessages([...history, { role: "assistant", content: "" }]);

    try {
      await streamChat(
        COACH_MODEL,
        COACH_SYSTEM,
        history,
        2048,
        (chunk) => {
          assistantText += chunk;
          setMessages([...history, { role: "assistant", content: assistantText }]);
        }
      );

      // Save to Supabase after successful response
      const allMessages: CoachMessage[] = [...history, { role: "assistant", content: assistantText }];
      const firstUserMsg = allMessages.find((m) => m.role === "user")?.content ?? "Coach session";
      const id = await upsertCoachConversation(conversationIdRef.current, firstUserMsg, allMessages);
      if (id) conversationIdRef.current = id;

    } catch (err) {
      console.error("Coach error:", err);
      setMessages(history);
      setCoachError(errorMessage(err));
    }
    setThinking(false);
  }

  async function send() {
    const text = input.trim();
    if (!text || thinking) return;
    setInput("");
    lastUserMessageRef.current = text;
    const history: CoachMessage[] = [...messages, { role: "user", content: text }];
    setMessages(history);
    await sendMessage(text, history);
  }

  async function retry() {
    if (thinking || !lastUserMessageRef.current) return;
    const history = messages.filter((m) => m.role === "user" || m.content !== "");
    const lastUser = history.findLastIndex((m) => m.role === "user");
    const historyUpToUser = history.slice(0, lastUser + 1);
    await sendMessage(lastUserMessageRef.current, historyUpToUser);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="flex flex-col gap-4">

      {/* Past conversations */}
      <PastConversations type="coach" onLoad={loadPastConversation} />

      {/* Intro */}
      {messages.length === 0 && (
        <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-full bg-[#00D64F] flex items-center justify-center text-black font-bold text-sm">C</div>
            <div>
              <p className="text-sm font-bold text-white">Product Coach</p>
              <p className="text-xs text-gray-600">Powered by Claude Opus 4</p>
            </div>
          </div>
          <p className="text-sm text-gray-400 leading-relaxed">
            Ask me anything about product management — strategy, prioritisation, discovery, metrics, stakeholders. I'll challenge your thinking and help you grow. Try: <em className="text-gray-300">"How should I think about prioritising our roadmap as an early MVP?"</em>
          </p>
        </div>
      )}

      {/* Messages */}
      {messages.length > 0 && (
        <div className="flex flex-col gap-4">
          {messages.map((msg, i) => (
            msg.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="bg-[#00D64F]/10 border border-[#00D64F]/20 rounded-2xl rounded-tr-sm px-5 py-3.5 max-w-xl">
                  <p className="text-sm text-white leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            ) : (
              <div key={i} className="flex gap-4">
                <div className="w-9 h-9 rounded-full bg-[#00D64F] flex items-center justify-center text-black font-bold text-sm flex-shrink-0">C</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-bold text-white">Coach</span>
                    {thinking && i === messages.length - 1 && !msg.content && <ThinkingDots />}
                  </div>
                  {msg.content ? (
                    <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                  ) : (
                    <div className="text-sm text-gray-600 italic">Thinking…</div>
                  )}
                </div>
              </div>
            )
          ))}
          <div ref={endRef} />
        </div>
      )}

      {/* Input */}
      <div className="flex flex-col gap-2 sticky bottom-0 bg-[#0a0a0a] pt-2 pb-4">
        {coachError && (
          <div className="flex items-center justify-between gap-4 bg-red-950/40 border border-red-800/40 rounded-xl px-4 py-3">
            <p className="text-sm text-red-400">{coachError}</p>
            <button
              onClick={retry}
              disabled={thinking}
              className="text-sm font-semibold text-red-300 hover:text-white transition-colors flex-shrink-0 disabled:opacity-50"
            >
              Retry →
            </button>
          </div>
        )}
        <div className="flex gap-3 items-end">
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask your coach… (Enter to send, Shift+Enter for newline)"
            disabled={thinking}
            className="flex-1 bg-[#111] border border-[#2a2a2a] focus:border-[#00D64F] outline-none rounded-xl px-5 py-4 text-white placeholder-[#444] transition-colors text-sm resize-none disabled:opacity-50"
          />
          <button
            onClick={send}
            disabled={!input.trim() || thinking}
            className="rounded-2xl bg-[#00D64F] text-black font-bold px-6 py-4 hover:bg-[#00c248] transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-sm flex-shrink-0"
          >
            {thinking ? "…" : "Send →"}
          </button>
        </div>
      </div>

    </div>
  );
}

// ── PM 1-on-1 Tab ─────────────────────────────────────────────────────────────

const STATUS_CYCLE: Record<ObjectiveStatus, ObjectiveStatus> = {
  active: "completed",
  completed: "paused",
  paused: "active",
};

const STATUS_STYLES: Record<ObjectiveStatus, string> = {
  active:    "bg-[#00D64F]/15 text-[#00D64F] border border-[#00D64F]/30",
  completed: "bg-gray-500/10 text-gray-400 border border-gray-700",
  paused:    "bg-yellow-500/10 text-yellow-400 border border-yellow-700/40",
};

function PMTab() {
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [pmError, setPmError] = useState("");
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [objInput, setObjInput] = useState("");
  const [savingObj, setSavingObj] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [riseContext, setRiseContext] = useState("");
  const [ostNotification, setOstNotification] = useState("");
  const conversationIdRef = useRef<string | null>(null);
  const lastUserMessageRef = useRef<string>("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadObjectives().then(setObjectives);
    fetch("/api/rise-context")
      .then((r) => r.json())
      .then((d) => { if (d.content) setRiseContext(d.content); })
      .catch(() => { /* fall back to base system prompt silently */ });
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(text: string, history: CoachMessage[]) {
    setThinking(true);
    setPmError("");
    let assistantText = "";
    setMessages([...history, { role: "assistant", content: "" }]);

    const pmSystem = riseContext
      ? `${PM_SYSTEM}\n\nFull Rise product context (CLAUDE.md):\n${riseContext}`
      : PM_SYSTEM;

    try {
      await streamChat(
        PM_MODEL,
        pmSystem,
        history,
        1024,
        (chunk) => {
          assistantText += chunk;
          setMessages([...history, { role: "assistant", content: assistantText }]);
        }
      );

      const allMessages: CoachMessage[] = [...history, { role: "assistant", content: assistantText }];
      const firstUserMsg = allMessages.find((m) => m.role === "user")?.content ?? "PM session";
      const id = await upsertPMConversation(conversationIdRef.current, firstUserMsg, allMessages);
      if (id) conversationIdRef.current = id;

    } catch (err) {
      console.error("PM error:", err);
      setMessages(history);
      setPmError(errorMessage(err));
    }
    setThinking(false);
  }

  async function send() {
    const text = input.trim();
    if (!text || thinking) return;
    setInput("");
    lastUserMessageRef.current = text;
    const history: CoachMessage[] = [...messages, { role: "user", content: text }];
    setMessages(history);
    await sendMessage(text, history);
  }

  async function retry() {
    if (thinking || !lastUserMessageRef.current) return;
    const history = messages.filter((m) => m.role === "user" || m.content !== "");
    const lastUser = history.findLastIndex((m) => m.role === "user");
    const historyUpToUser = history.slice(0, lastUser + 1);
    await sendMessage(lastUserMessageRef.current, historyUpToUser);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  async function updateOstFromObjective(title: string, objectiveId: string) {
    try {
      // 1. Fetch last 10 feedback entries
      const feedbackRes = await fetch("/api/feedback");
      const feedbackData = await feedbackRes.json();
      const feedbackText = Array.isArray(feedbackData)
        ? feedbackData.map((f: { page: string; feedback: string }) => `- [${f.page}] ${f.feedback}`).join("\n")
        : "(no feedback available)";

      // 2. Get current OST
      const currentOst = await loadLatestOstSnapshot() ?? OST_DEFAULT;

      // 3. Ask Claude to update the OST
      const prompt = `You are updating an Opportunity Solution Tree (OST) for a product team.

New objective just saved: "${title}"

Recent user feedback:
${feedbackText}

Current OST (JSON):
${JSON.stringify(currentOst, null, 2)}

Update the OST to reflect the new objective and any relevant insights from the feedback. Return ONLY valid JSON matching the OSTTree structure (outcome string, opportunities array with label/sub array with label/solutions array with label/assumptions array with label). No markdown, no explanation.`;

      const res = await fetch("/api/team/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          system: "You are a product strategy assistant. Return only valid JSON.",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 4000,
        }),
      });

      if (!res.ok) return;
      const raw: string = await res.json();
      let updated: OSTTree | null = null;
      try {
        const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
        updated = JSON.parse(clean);
      } catch {
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        if (start !== -1 && end !== -1) {
          try { updated = JSON.parse(raw.slice(start, end + 1)); } catch { /* give up */ }
        }
      }

      if (updated) {
        await saveOstSnapshot(updated, objectiveId);
        setOstNotification("OST updated based on new objective");
        setTimeout(() => setOstNotification(""), 5000);
      }
    } catch (err) {
      console.error("[ost] update error", err);
    }
  }

  async function handleSaveObjective() {
    const title = objInput.trim();
    if (!title) return;
    setSavingObj(true);
    const obj = await saveObjective(title);
    if (obj) {
      setObjectives((prev) => [obj, ...prev]);
      setObjInput("");
      // Fire-and-forget OST update
      updateOstFromObjective(title, obj.id);
    }
    setSavingObj(false);
  }

  async function handleToggleStatus(obj: Objective) {
    const next = STATUS_CYCLE[obj.status];
    setTogglingId(obj.id);
    await updateObjectiveStatus(obj.id, next);
    setObjectives((prev) => prev.map((o) => o.id === obj.id ? { ...o, status: next } : o));
    setTogglingId(null);
  }

  return (
    <div className="flex flex-col gap-8">

      {/* Chat */}
      <div className="flex flex-col gap-4">

        {/* Intro */}
        {messages.length === 0 && (
          <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0" style={{ background: "#5a4fcf" }}>
                SM
              </div>
              <div>
                <p className="text-sm font-bold text-white">Sarah · PM</p>
                <p className="text-xs text-gray-600">1-on-1 with Philip</p>
              </div>
            </div>
            <p className="text-sm text-gray-400 leading-relaxed">
              Hey Philip — what's on your mind? We can work through a problem, align on priorities, or agree on what to focus on next.
            </p>
          </div>
        )}

        {/* Messages */}
        {messages.length > 0 && (
          <div className="flex flex-col gap-4">
            {messages.map((msg, i) =>
              msg.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="bg-[#00D64F]/10 border border-[#00D64F]/20 rounded-2xl rounded-tr-sm px-5 py-3.5 max-w-xl">
                    <p className="text-sm text-white leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              ) : (
                <div key={i} className="flex gap-4">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-xs flex-shrink-0" style={{ background: "#5a4fcf" }}>
                    SM
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-bold text-white">Sarah</span>
                      <span className="text-xs text-gray-600 bg-[#1a1a1a] px-2 py-0.5 rounded-full">PM</span>
                      {thinking && i === messages.length - 1 && !msg.content && <ThinkingDots />}
                    </div>
                    {msg.content ? (
                      <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                    ) : (
                      <div className="text-sm text-gray-600 italic">Thinking…</div>
                    )}
                  </div>
                </div>
              )
            )}
            <div ref={endRef} />
          </div>
        )}

        {/* Input */}
        <div className="flex flex-col gap-2 sticky bottom-0 bg-[#0a0a0a] pt-2 pb-4">
          {pmError && (
            <div className="flex items-center justify-between gap-4 bg-red-950/40 border border-red-800/40 rounded-xl px-4 py-3">
              <p className="text-sm text-red-400">{pmError}</p>
              <button
                onClick={retry}
                disabled={thinking}
                className="text-sm font-semibold text-red-300 hover:text-white transition-colors flex-shrink-0 disabled:opacity-50"
              >
                Retry →
              </button>
            </div>
          )}
          <div className="flex gap-3 items-end">
            <textarea
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Sarah… (Enter to send, Shift+Enter for newline)"
              disabled={thinking}
              className="flex-1 bg-[#111] border border-[#2a2a2a] focus:border-[#00D64F] outline-none rounded-xl px-5 py-4 text-white placeholder-[#444] transition-colors text-sm resize-none disabled:opacity-50"
            />
            <button
              onClick={send}
              disabled={!input.trim() || thinking}
              className="rounded-2xl bg-[#00D64F] text-black font-bold px-6 py-4 hover:bg-[#00c248] transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-sm flex-shrink-0"
            >
              {thinking ? "…" : "Send →"}
            </button>
          </div>
        </div>
      </div>

      {/* Objectives */}
      <div className="border-t border-[#1a1a1a] pt-8 flex flex-col gap-5">

        <div>
          <h2 className="text-base font-bold text-white mb-1">Agreed objectives</h2>
          <p className="text-xs text-gray-600">Objectives you and Sarah have agreed on. Click a status badge to cycle it.</p>
        </div>

        {ostNotification && (
          <div className="flex items-center gap-2 bg-[#00D64F]/10 border border-[#00D64F]/25 rounded-xl px-4 py-2.5">
            <span className="text-xs text-[#00D64F]">✓</span>
            <p className="text-xs text-[#00D64F]">{ostNotification}</p>
          </div>
        )}

        {/* Save input */}
        <div className="flex gap-3 items-end">
          <input
            type="text"
            value={objInput}
            onChange={(e) => setObjInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSaveObjective(); }}
            placeholder="Add an agreed objective…"
            className="flex-1 bg-[#111] border border-[#2a2a2a] focus:border-[#00D64F] outline-none rounded-xl px-5 py-3.5 text-white placeholder-[#444] transition-colors text-sm"
          />
          <button
            onClick={handleSaveObjective}
            disabled={!objInput.trim() || savingObj}
            className="rounded-2xl bg-[#00D64F] text-black font-bold px-5 py-3.5 hover:bg-[#00c248] transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-sm flex-shrink-0"
          >
            {savingObj ? "Saving…" : "Save objective"}
          </button>
        </div>

        {/* List */}
        {objectives.length === 0 ? (
          <p className="text-sm text-gray-600">No objectives saved yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {objectives.map((obj) => (
              <div key={obj.id} className="bg-[#111] border border-[#1e1e1e] rounded-2xl px-5 py-4 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white leading-relaxed">{obj.title}</p>
                  <p className="text-xs text-gray-600 mt-1">
                    {new Date(obj.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                </div>
                <button
                  onClick={() => handleToggleStatus(obj)}
                  disabled={togglingId === obj.id}
                  className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full capitalize transition-opacity disabled:opacity-50 ${STATUS_STYLES[obj.status]}`}
                >
                  {obj.status}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

// ── Opportunity Solution Tree Tab ──────────────────────────────────────────────

function OSTTab() {
  const [tree, setTree] = useState<OSTTree>(OST_DEFAULT);
  const [feedback, setFeedback] = useState("");
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState("Showing example tree — paste user feedback to generate.");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<LayoutNode | null>(null);
  const sizeRef = useRef<{ w: number; h: number; dpr: number } | null>(null);

  // Load latest OST snapshot on mount
  useEffect(() => {
    loadLatestOstSnapshot().then((snapshot) => {
      if (snapshot) {
        setTree(snapshot);
        setStatus("Loaded latest OST snapshot.");
      }
    });
  }, []);

  // Recompute layout + resize canvas when tree changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const root = ostBuild(tree);
    ostComputeWidth(root);
    ostAssignPos(root, OST_PAD);
    const depth = ostMaxDepth(root);
    const w = root.subtreeW + OST_PAD * 2;
    const h = depth * (OST_H + OST_VGAP) + OST_PAD * 2;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    layoutRef.current = root;
    sizeRef.current = { w, h, dpr };
  }, [tree]);

  // Redraw on tree or hoveredId change
  useEffect(() => {
    const canvas = canvasRef.current;
    const root = layoutRef.current;
    const size = sizeRef.current;
    if (!canvas || !root || !size) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, size.w, size.h);
    ostDraw(ctx, root, hoveredId);
  }, [tree, hoveredId]);

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const root = layoutRef.current;
    if (!canvas || !root) return;
    const rect = canvas.getBoundingClientRect();
    const node = ostFind(root, e.clientX - rect.left, e.clientY - rect.top);
    const id = node?.id ?? null;
    if (id !== hoveredId) {
      setHoveredId(id);
      canvas.style.cursor = id ? "pointer" : "default";
    }
  }

  function handleMouseLeave() {
    setHoveredId(null);
    if (canvasRef.current) canvasRef.current.style.cursor = "default";
  }

  function handleDblClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const root = layoutRef.current;
    if (!canvas || !root) return;
    const rect = canvas.getBoundingClientRect();
    const node = ostFind(root, e.clientX - rect.left, e.clientY - rect.top);
    if (!node) return;
    const newText = window.prompt("Edit node text:", node.text);
    if (newText?.trim()) setTree(prev => ostUpdateText(prev, node.id, newText.trim()));
  }

  async function generate() {
    if (!feedback.trim() || generating) return;
    setGenerating(true);
    setStatus("Generating opportunity tree…");
    try {
      let raw = "";
      await streamChat(
        TEAM_MODEL, OST_SYSTEM,
        [{ role: "user", content: feedback }],
        4000,
        (chunk) => { raw += chunk; }
      );
      const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
      let parsed: OSTTree | null = null;
      try {
        parsed = JSON.parse(stripped);
      } catch {
        // Fallback: extract the largest JSON object between first { and last }
        const start = stripped.indexOf("{");
        const end = stripped.lastIndexOf("}");
        if (start !== -1 && end > start) {
          try { parsed = JSON.parse(stripped.slice(start, end + 1)); } catch { /* give up */ }
        }
      }
      if (!parsed) throw new Error("Could not parse JSON from response");
      setTree(parsed);
      setStatus("Tree generated — double-click any node to edit.");
    } catch (err) {
      console.error("[ost generate]", err);
      setStatus("Generation failed — showing example tree.");
      setTree(OST_DEFAULT);
    }
    setGenerating(false);
  }

  function downloadPng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = "opportunity-solution-tree.png";
    a.click();
  }

  return (
    <div className="flex flex-col gap-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-white">Opportunity solution tree</h2>
        <button
          onClick={downloadPng}
          className="rounded-xl border border-[#2a2a2a] text-gray-300 hover:text-white hover:border-[#444] font-semibold px-4 py-2 transition-colors text-sm"
        >
          Download PNG ↓
        </button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-5">
        {(
          [
            { label: "Outcome",     fill: "#00D64F", border: "#00b340" },
            { label: "Opportunity", fill: "#1a6b3c", border: "#00D64F" },
            { label: "Solution",    fill: "#1e1e1e", border: "#444444" },
            { label: "Assumption",  fill: "#2a1a00", border: "#7a5000" },
          ] as const
        ).map(({ label, fill, border }) => (
          <div key={label} className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded-full flex-shrink-0"
              style={{ background: fill, border: `1.5px solid ${border}` }}
            />
            <span className="text-xs text-gray-400">{label}</span>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="flex flex-col gap-3">
        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">
          Paste user feedback or research
        </label>
        <textarea
          rows={4}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="e.g. 'Users feel lost after onboarding. They don't know what to do next. Several mentioned wanting a plan for each day…'"
          className="w-full bg-[#111] border border-[#2a2a2a] focus:border-[#00D64F] outline-none rounded-xl px-5 py-4 text-white placeholder-[#444] transition-colors text-sm resize-none"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={generate}
            disabled={!feedback.trim() || generating}
            className="rounded-2xl bg-[#00D64F] text-black font-bold px-8 py-4 hover:bg-[#00c248] transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-sm"
          >
            {generating ? "Generating…" : "Generate OST →"}
          </button>
        </div>
        <p className="text-xs text-gray-600">{status}</p>
      </div>

      {/* Canvas */}
      <div className="overflow-x-auto rounded-2xl border border-[#1e1e1e] bg-[#0a0a0a]">
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onDoubleClick={handleDblClick}
        />
      </div>

    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function TeamPage() {
  const [activeTab, setActiveTab] = useState<"team" | "pm" | "coach" | "ost">("team");

  // Pre-select tab from ?tab= query param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab === "ost" || tab === "coach" || tab === "team" || tab === "pm") setActiveTab(tab);
  }, []);

  const tabs = [
    { id: "team" as const, label: "Product team" },
    { id: "pm" as const, label: "PM" },
    { id: "coach" as const, label: "Product coach" },
    { id: "ost" as const, label: "Opportunity tree" },
  ];

  return (
    <main className="min-h-screen bg-[#0a0a0a] px-6 py-10">
      <div className="max-w-3xl mx-auto">

        <div className="mb-8">
          <h1 className="text-4xl font-extrabold tracking-tight mb-2">Product agents</h1>
          <p className="text-gray-400">AI-powered product thinking for Rise.</p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 bg-[#111] border border-[#1e1e1e] rounded-2xl p-1 w-fit mb-10">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-6 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                activeTab === tab.id
                  ? "bg-[#00D64F] text-black"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "team" && <ProductTeamTab />}
        {activeTab === "pm" && <PMTab />}
        {activeTab === "coach" && <ProductCoachTab />}
        {activeTab === "ost" && <OSTTab />}

      </div>
    </main>
  );
}
