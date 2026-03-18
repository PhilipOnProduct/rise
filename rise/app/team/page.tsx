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
  type: "team" | "coach";
  title: string;
  messages: TeamMessages | { history: CoachMessage[] };
  prd: string | null;
  created_at: string;
};

// ── Constants ──────────────────────────────────────────────────────────────────

const RISE_CONTEXT =
  "Rise is an AI-powered travel concierge app. Stack: Next.js 16, TypeScript, Tailwind CSS, Supabase (Postgres), Anthropic API, Vercel. " +
  "Features: 5-step onboarding wizard (destination → dates → hotel → activities → account), AI restaurant recommendations (streaming), " +
  "airport-to-hotel transport advice (streaming), local guides with tip submission, views, ratings, reputation/points and leaderboard, " +
  "admin dashboard with AI logs. Business model: commission on bookings. Stage: early MVP, no paying users yet.";

const TEAM_MODEL = "claude-sonnet-4-6";
const COACH_MODEL = "claude-opus-4-6";

const AGENTS: Record<
  AgentId,
  { name: string; role: string; initial: string; badge: string; system: string }
> = {
  sarah: {
    name: "Sarah",
    role: "PM",
    initial: "S",
    badge: "bg-[#00D64F] text-black",
    system: `You are Sarah, the Product Manager at Rise — a travel concierge app. ${RISE_CONTEXT}\nFrame problems clearly, identify the core user need, and make decisive product recommendations. Be concise and strategic. Use short paragraphs.`,
  },
  alex: {
    name: "Alex",
    role: "Researcher",
    initial: "A",
    badge: "bg-blue-600 text-white",
    system: `You are Alex, the User Researcher at Rise — a travel concierge app. ${RISE_CONTEXT}\nAnalyze user behavior, identify research gaps, suggest validation methods. Be evidence-based and specific. Use short paragraphs.`,
  },
  maya: {
    name: "Maya",
    role: "Designer",
    initial: "M",
    badge: "bg-purple-600 text-white",
    system: `You are Maya, the Product Designer at Rise — a travel concierge app with a dark Uber-inspired design (#0a0a0a background, #00D64F green accent, DM Sans font, rounded-2xl cards). ${RISE_CONTEXT}\nFocus on UX flows, user journeys, visual hierarchy, and interaction patterns. Be specific about design decisions. Use short paragraphs.`,
  },
  luca: {
    name: "Luca",
    role: "Tech Lead",
    initial: "L",
    badge: "bg-orange-500 text-white",
    system: `You are Luca, the Tech Lead at Rise — a travel concierge app. ${RISE_CONTEXT} Architecture: Next.js App Router, API routes for AI calls, Supabase Postgres, Vercel edge.\nAssess feasibility, flag complexity, suggest the simplest viable approach. Use short paragraphs.`,
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
    .insert({ type: "team", title: problem.slice(0, 60), messages: msgs })
    .select("id")
    .single();
  if (error) { console.error("[team] save error", error); return null; }
  return data.id as string;
}

async function updateTeamPrd(id: string, prd: string): Promise<void> {
  const { error } = await supabase.from("team_conversations").update({ prd }).eq("id", id);
  if (error) console.error("[team] prd update error", error);
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
    if (error) console.error("[coach] update error", error);
    return id;
  }
  const { data, error } = await supabase
    .from("team_conversations")
    .insert({ type: "coach", title: firstMessage.slice(0, 60), messages: { history } })
    .select("id")
    .single();
  if (error) { console.error("[coach] insert error", error); return null; }
  return data.id as string;
}

async function loadConversations(type: "team" | "coach"): Promise<ConversationRow[]> {
  const { data, error } = await supabase
    .from("team_conversations")
    .select("id, type, title, messages, prd, created_at")
    .eq("type", type)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) { console.error("[conversations] load error", error); return []; }
  return data as ConversationRow[];
}

// ── Download PRD ───────────────────────────────────────────────────────────────

function downloadPrdFile(problem: string, prdContent: string): void {
  const date = new Date().toISOString().slice(0, 10);
  const slug = problem.trim()
    .split(/\s+/).slice(0, 5).join("-")
    .toLowerCase().replace(/[^a-z0-9-]/g, "");
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

  const load = useCallback(async () => {
    setLoading(true);
    const data = await loadConversations(type);
    setRows(data);
    setLoading(false);
  }, [type]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

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
        <div className="flex flex-col gap-0.5">
          {rows.map((row) => (
            <button
              key={row.id}
              onClick={() => { onLoad(row); setOpen(false); }}
              className="text-left px-3 py-2.5 rounded-xl hover:bg-[#1a1a1a] transition-colors group"
            >
              <p className="text-sm text-gray-300 group-hover:text-white truncate">{row.title}</p>
              <p className="text-xs text-gray-600 mt-0.5">
                {new Date(row.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                {row.prd && <span className="ml-2 text-[#00D64F]">· PRD</span>}
              </p>
            </button>
          ))}
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
  const [prdDownloaded, setPrdDownloaded] = useState(false);

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
    setPrdDownloaded(false);
  }

  async function runDiscussion() {
    if (!problem.trim() || isRunning) return;

    setSarahFrame(""); setAlexContent(""); setMayaContent("");
    setLucaContent(""); setSynthesis(""); setPrd("");
    setTeamError(""); setConversationId(null); setPrdDownloaded(false);

    try {
      // ── Step 1: Sarah frames ──────────────────────────────────────────────
      setPhase("framing");
      setThinking({ sarah: true });
      let frameText = "";
      await streamChat(
        TEAM_MODEL, AGENTS.sarah.system,
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
            `## User Stories\n## Success Metrics\n## Technical Considerations\n## Risks & Open Questions`,
        }],
        2048, (chunk) => { prdText += chunk; setPrd(prdText); }
      );
      if (conversationId) await updateTeamPrd(conversationId, prdText);
    } catch (err) {
      console.error("PRD error:", err);
      setTeamError(errorMessage(err));
    }
    setThinking({});
    setPhase("done");
  }

  function handleDownloadPrd() {
    downloadPrdFile(problem, prd);
    setPrdDownloaded(true);
  }

  return (
    <div className="flex flex-col gap-8">

      {/* Past conversations */}
      <PastConversations type="team" onLoad={loadPastConversation} />

      {/* Team roster */}
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
                      {prd.split("\n").map((line, i) => <PrdLine key={i} line={line} i={i} />)}
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

// ── Page ───────────────────────────────────────────────────────────────────────

export default function TeamPage() {
  const [activeTab, setActiveTab] = useState<"team" | "coach">("team");

  const tabs = [
    { id: "team" as const, label: "Product team" },
    { id: "coach" as const, label: "Product coach" },
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

        {activeTab === "team" ? <ProductTeamTab /> : <ProductCoachTab />}

      </div>
    </main>
  );
}
