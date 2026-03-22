import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { logAiInteraction } from "@/lib/ai-logger";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-6";

type TimeBlock = "morning" | "afternoon" | "evening";

type ContextItem = {
  title: string;
  description: string;
  time_block: TimeBlock;
};

export async function POST(req: NextRequest) {
  const {
    mode,            // "swap" | "add"
    destination,
    dayNumber,
    date,
    block,           // time block being edited
    dayItems,        // all items on the day, excluding the slot being edited
    replacingItem,   // { title, description } of item being replaced (swap only)
    rejectedTitles,  // string[] — previously suggested titles to avoid
    travelCompany,
    travelerTypes,
    budgetTier,
  } = await req.json();

  // Build neighbor context from adjacent time blocks
  const blockOrder: TimeBlock[] = ["morning", "afternoon", "evening"];
  const blockIdx = blockOrder.indexOf(block as TimeBlock);
  const prevBlock = blockIdx > 0 ? blockOrder[blockIdx - 1] : null;
  const nextBlock = blockIdx < 2 ? blockOrder[blockIdx + 1] : null;

  const prevItems: ContextItem[] = prevBlock
    ? (dayItems as ContextItem[]).filter((it) => it.time_block === prevBlock)
    : [];
  const nextItems: ContextItem[] = nextBlock
    ? (dayItems as ContextItem[]).filter((it) => it.time_block === nextBlock)
    : [];
  const sameBlockItems: ContextItem[] = (dayItems as ContextItem[]).filter(
    (it) => it.time_block === block
  );

  const contextLines: string[] = [];
  if (prevItems.length)
    contextLines.push(`${prevBlock}: ${prevItems.map((it) => it.title).join(", ")}`);
  if (sameBlockItems.length)
    contextLines.push(
      `Other ${block} activities: ${sameBlockItems.map((it) => it.title).join(", ")}`
    );
  if (nextItems.length)
    contextLines.push(`${nextBlock}: ${nextItems.map((it) => it.title).join(", ")}`);

  const dayContext = contextLines.length
    ? `\nDay context:\n${contextLines.join("\n")}`
    : "";

  const companyLabel: Record<string, string> = {
    solo: "solo traveller",
    partner: "couple",
    friends: "group of friends",
    family: "family with children",
  };
  const profileParts: string[] = [];
  if (travelCompany) profileParts.push(companyLabel[travelCompany] ?? travelCompany);
  if (travelerTypes?.length)
    profileParts.push(`travel style: ${(travelerTypes as string[]).join(", ")}`);
  if (budgetTier) profileParts.push(`budget: ${budgetTier}`);
  const profile = profileParts.length ? profileParts.join("; ") : "traveller";

  const avoidClause =
    rejectedTitles?.length
      ? `\n\nDo not suggest any of these — the user already declined them: ${(rejectedTitles as string[]).join(", ")}.`
      : "";

  const dateFormatted = new Date(date).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  let prompt: string;
  if (mode === "swap") {
    prompt =
      `You are a travel planner helping a ${profile} in ${destination}.\n` +
      `Day ${dayNumber} — ${dateFormatted}, ${block} slot.\n` +
      `The user wants to replace: "${replacingItem.title}" — ${replacingItem.description}${dayContext}\n\n` +
      `Suggest one specific ${block} activity that fits this traveller, this destination, and the day's flow. ` +
      `It should be a confident, specific recommendation — not a generic tourist activity unless it's genuinely the best fit. ` +
      `It should feel like a natural alternative or upgrade to what it's replacing.` +
      avoidClause;
  } else {
    prompt =
      `You are a travel planner helping a ${profile} in ${destination}.\n` +
      `Day ${dayNumber} — ${dateFormatted}, ${block} has a free slot.${dayContext}\n\n` +
      `Suggest one specific ${block} activity that fits this traveller, this destination, and the day's flow. ` +
      `It should complement what's already planned and feel like it belongs in the itinerary.` +
      avoidClause;
  }

  const startTime = Date.now();

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      tools: [
        {
          name: "edit_itinerary_slot",
          description:
            "Return a structured activity suggestion and flag any scheduling issue on this day.",
          input_schema: {
            type: "object" as const,
            properties: {
              title: {
                type: "string",
                description:
                  "Activity name — short, specific, use proper nouns where possible.",
              },
              description: {
                type: "string",
                description:
                  "One sentence, under 20 words. Specific to the destination.",
              },
              type: {
                type: "string",
                enum: ["activity", "restaurant", "transport", "note"],
              },
              rationale: {
                type: "string",
                description:
                  "One sentence on why this fits this traveller and this slot in the day.",
              },
              conflict: {
                type: "string",
                description:
                  "Brief note about any sequencing or timing issue on this day after this change — e.g. two heavy meals back to back, no restaurant planned, activities too far apart. Empty string if none.",
              },
            },
            required: ["title", "description", "type", "rationale", "conflict"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "edit_itinerary_slot" },
      messages: [{ role: "user", content: prompt }],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || !("input" in toolUse)) {
      return NextResponse.json({ error: "No suggestion returned" }, { status: 500 });
    }

    const input = toolUse.input as {
      title: string;
      description: string;
      type: string;
      rationale: string;
      conflict: string;
    };

    const newItem = {
      id: `ai-edit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: input.title,
      description: input.description,
      type: (["activity", "restaurant", "transport", "note"].includes(input.type)
        ? input.type
        : "activity") as "activity" | "restaurant" | "transport" | "note",
      time_block: block as TimeBlock,
      status: "idea" as const,
      source: "ai_generated" as const,
    };

    await logAiInteraction({
      feature: "itinerary-edit",
      model: MODEL,
      prompt,
      input: {
        mode,
        destination,
        dayNumber,
        block,
        replacingTitle: replacingItem?.title ?? null,
        rejectedTitles,
        profile,
      },
      output: JSON.stringify(input),
      latency_ms: Date.now() - startTime,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    });

    return NextResponse.json({
      item: newItem,
      rationale: input.rationale,
      conflict: input.conflict || null,
    });
  } catch (err) {
    console.error("[itinerary-edit]", err);
    return NextResponse.json({ error: "Failed to generate suggestion" }, { status: 500 });
  }
}
