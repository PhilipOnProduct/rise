import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { logAiInteraction } from "@/lib/ai-logger";

const client = new Anthropic();
const MODEL = "claude-haiku-4-5-20251001";

export type Chip = {
  label: string;
  type: "hard_exclusion" | "soft_signal";
};

export async function POST(req: NextRequest) {
  const { activityName, activityCategory, travelCompany, styleTags, budgetTier } =
    await req.json();

  const companyLabel: Record<string, string> = {
    solo: "solo traveller",
    partner: "travelling with a partner",
    friends: "travelling with friends",
    family: "travelling with family",
  };

  const profileParts: string[] = [];
  if (travelCompany) profileParts.push(companyLabel[travelCompany] ?? travelCompany);
  if (styleTags?.length) profileParts.push(`travel style: ${(styleTags as string[]).join(", ")}`);
  if (budgetTier) profileParts.push(`budget tier: ${budgetTier}`);
  const profile = profileParts.length ? profileParts.join("; ") : "general traveller";

  const prompt =
    `The user is a ${profile}. They are considering skipping the activity: "${activityName}" (category: ${activityCategory}).\n\n` +
    `Generate 3 short, specific reasons this traveller might want to skip this particular activity. ` +
    `Each reason must be specific to the activity name and the traveller profile — not generic filler.\n\n` +
    `Good examples: "Too touristy for a solo trip", "Crowds won't suit your relaxed style", "Pricier than your budget tier"\n` +
    `Bad examples: "Not my thing", "Don't want to go", "Not interested"\n\n` +
    `Each chip: 3–6 words. Vary the phrasing — don't start all three the same way.`;

  const startTime = Date.now();

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      tools: [
        {
          name: "rejection_chips",
          description: "Structured list of rejection reason chips",
          input_schema: {
            type: "object" as const,
            properties: {
              chips: {
                type: "array",
                items: {
                  type: "object",
                  properties: { label: { type: "string" } },
                  required: ["label"],
                },
                minItems: 3,
                maxItems: 3,
              },
            },
            required: ["chips"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "rejection_chips" },
      messages: [{ role: "user", content: prompt }],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    const rawChips =
      toolUse && "input" in toolUse
        ? (toolUse.input as { chips: { label: string }[] }).chips
        : [];

    const softChips: Chip[] = rawChips
      .slice(0, 3)
      .map((c) => ({ label: c.label, type: "soft_signal" as const }));

    // "Done it before" is always the hard exclusion chip, prepended
    const chips: Chip[] = [
      { label: "Done it before", type: "hard_exclusion" },
      ...softChips,
    ];

    await logAiInteraction({
      feature: "activity-chips",
      model: MODEL,
      prompt,
      input: { activityName, activityCategory, travelCompany, styleTags, budgetTier },
      output: JSON.stringify(chips),
      latency_ms: Date.now() - startTime,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    });

    return NextResponse.json({ chips });
  } catch (err) {
    console.error("[activity-chips]", err);
    // Fallback chips so the UI is never blocked
    const fallback: Chip[] = [
      { label: "Done it before", type: "hard_exclusion" },
      { label: "Not my travel style", type: "soft_signal" },
      { label: "Doesn't fit the itinerary", type: "soft_signal" },
      { label: "Timing doesn't work", type: "soft_signal" },
    ];
    return NextResponse.json({ chips: fallback });
  }
}
