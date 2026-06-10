import { AGENTS, CARD_TYPE_STYLES, TEAM_MODEL, getModeInstruction } from "./team-constants";
import { streamChat } from "./team-data";
import type { Objective } from "./team-types";

// ── Download PRD ───────────────────────────────────────────────────────────────

export async function fetchPrdSlug(problem: string, prdContent: string): Promise<string> {
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


export function downloadConversationFile(
  problem: string,
  agents: typeof AGENTS,
  buildMode: boolean,
  sarahMemory: string,
  sarahFrame: string,
  alexContent: string,
  mayaContent: string,
  lucaContent: string,
  elenaContent: string,
  synthesis: string,
  prd: string,
): void {
  const date = new Date().toISOString().slice(0, 10);
  const slug = problem.trim().split(/\s+/).slice(0, 5).join("-").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const mode = getModeInstruction(buildMode);

  const sarahSystem = sarahMemory
    ? `${agents.sarah.system}\n\n${mode}\n\nHere is your memory of past product discussions for Rise:\n${sarahMemory}\n\nUse this to inform your framing — reference relevant past decisions, avoid repeating ground already covered, and build on what the team has already learned.`
    : `${agents.sarah.system}\n\n${mode}`;

  const specialistInput = `Problem: ${problem}\n\nSarah's framing: ${sarahFrame}\n\nShare your expert perspective.`;
  const synthesisInput =
    `Problem: ${problem}\n\nYour framing:\n${sarahFrame}\n\n` +
    `Team input:\nAlex (Research): ${alexContent}\nMaya (Design): ${mayaContent}\nLuca (Tech): ${lucaContent}\nElena (Travel Expert): ${elenaContent}\n\n` +
    `Synthesize the key insights and give a clear product recommendation.`;
  const prdInput =
    `Based on this product discussion, write a structured PRD.\n\nProblem: ${problem}\nFraming: ${sarahFrame}\n` +
    `Research (Alex): ${alexContent}\nDesign (Maya): ${mayaContent}\nTech (Luca): ${lucaContent}\nTravel Expert (Elena): ${elenaContent}\n` +
    `Synthesis: ${synthesis}`;

  function section(name: string, role: string, system: string, input: string, response: string) {
    return [
      `## ${name} — ${role}`,
      ``,
      `<details>`,
      `<summary>System prompt</summary>`,
      ``,
      system,
      ``,
      `</details>`,
      ``,
      `**Input**`,
      ``,
      input,
      ``,
      `**Response**`,
      ``,
      response,
    ].join("\n");
  }

  const parts = [
    `# ${problem}`,
    ``,
    `_${date} · Contributors: Sarah (PM)${alexContent ? ", Alex (Researcher)" : ""}, Maya (Designer), Luca (Tech Lead), Elena (Travel Expert)_`,
    ``,
    `---`,
    ``,
    section("Sarah", "Framing", sarahSystem, `Frame this problem for the product team:\n\n${problem}`, sarahFrame),
    ...(alexContent ? [``, `---`, ``, section("Alex", "Research", `${agents.alex.system}\n\n${mode}`, specialistInput, alexContent)] : []),
    ``, `---`, ``,
    section("Maya", "Design", `${agents.maya.system}\n\n${mode}`, specialistInput, mayaContent),
    ``, `---`, ``,
    section("Luca", "Tech", `${agents.luca.system}\n\n${mode}`, specialistInput, lucaContent),
    ``, `---`, ``,
    section("Elena", "Travel Expert", `${agents.elena.system}\n\n${mode}`, specialistInput, elenaContent),
    ``, `---`, ``,
    section("Sarah", "Synthesis", sarahSystem, synthesisInput, synthesis),
  ];

  if (prd) {
    parts.push(``, `---`, ``, section("Sarah", "PRD", sarahSystem, prdInput, prd));
  }

  const blob = new Blob([parts.join("\n")], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${date}-${slug}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function fetchKanbanTitle(problem: string, prdContent: string): Promise<string> {
  const fallback = problem.trim().split(/\s+/).slice(0, 6).join(" ");
  try {
    let title = "";
    await streamChat(
      TEAM_MODEL,
      "You generate concise kanban card titles. Reply with ONLY the title — no quotes, no punctuation at end.",
      [{
        role: "user",
        content:
          `Summarize this product feature in max 8 words as a kanban card title.\n\n` +
          `Problem: ${problem}\n\nPRD summary (first 300 chars): ${prdContent.slice(0, 300)}`,
      }],
      20,
      (chunk) => { title += chunk; }
    );
    const clean = title.trim().replace(/^["']|["']$/g, "").replace(/\.$/g, "");
    return clean.length >= 3 ? clean : fallback;
  } catch {
    return fallback;
  }
}

// ── Card context builder (for injecting into agent prompts) ─────────────────

export function buildCardContext(obj: Objective): string {
  const parts = [`Card: ${obj.title} (${CARD_TYPE_STYLES[obj.card_type].label})`];
  if (obj.description) parts.push(`Description: ${obj.description}`);
  if (obj.pm_summary) parts.push(`PM conversation summary: ${obj.pm_summary}`);
  if (obj.discussions.length > 0) {
    parts.push("Previous discussions:");
    obj.discussions.forEach((d, i) => {
      parts.push(`  Discussion ${i + 1} (${d.date}): ${d.summary}`);
    });
  }
  if (obj.prd) parts.push(`Existing PRD:\n${obj.prd}`);
  if (obj.claude_code_result) parts.push(`Claude Code result:\n${obj.claude_code_result}`);
  return parts.join("\n");
}
