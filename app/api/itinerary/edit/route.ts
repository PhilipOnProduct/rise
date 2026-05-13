import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { logAiInteraction } from "@/lib/ai-logger";
import { logApiUsage, checkApiLimit } from "@/lib/log-api-usage";
import { buildCompositionSegment } from "@/lib/composition";
import { matchFranchise, buildAtlasAnchorSegment } from "@/lib/themed-atlas";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-6";

type TimeBlock = "morning" | "afternoon" | "evening";

type ContextItem = {
  title: string;
  description: string;
  time_block: TimeBlock;
};

// PHI-51: single-slot edit inspiration injection. Differs from the shared
// multi-item generator string in lib/activity-gen-prompt.ts because here
// the model is replacing ONE slot — original-category-first is the
// load-bearing rule (don't pivot a dinner to a museum just because the
// museum is more themed). Hallucination guard verbatim.
function buildInspirationEditInjection(inspiration: string): string {
  return `Inspiration: the traveller has stated '${inspiration}'. The replacement must match the original slot's category first and the inspiration second — don't pivot a dinner suggestion into a museum just because the museum is more themed. Only suggest theme-relevant items if a real, high-quality option exists. Apply the standard hallucination guard: never invent themed locations.`;
}

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
    travelerCount,
    childrenAges,
    // PHI-51: optional creative-inspiration soft bias from the free-form parser.
    inspiration,
  } = await req.json();

  // Hard limit check
  const limit = await checkApiLimit("anthropic");
  if (!limit.allowed) {
    return NextResponse.json({ error: "API limit exceeded", provider: "anthropic", spentUsd: limit.spentUsd, limitUsd: limit.limitUsd }, { status: 429 });
  }

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
  const composition = buildCompositionSegment(travelerCount, childrenAges);
  if (composition) profileParts.push(composition);
  const profile = profileParts.length ? profileParts.join("; ") : "traveller";

  const avoidClause =
    rejectedTitles?.length
      ? `\n\nDo not suggest any of these — the user already declined them: ${(rejectedTitles as string[]).join(", ")}.`
      : "";

  // PHI-99: flex-mode trips have no concrete date string for the day. The
  // client sends empty (or a non-ISO marker) and the prompt drops the date
  // suffix — "Day N, afternoon slot" instead of "Day N — Wed 5 Oct,
  // afternoon slot". new Date("") yields Invalid Date; guard explicitly so
  // we never feed "Invalid Date" into the prompt.
  const trimmedDate = typeof date === "string" ? date.trim() : "";
  const parsedDate = trimmedDate ? new Date(trimmedDate) : null;
  const dateFormatted =
    parsedDate && !Number.isNaN(parsedDate.getTime())
      ? parsedDate.toLocaleDateString("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long",
        })
      : "";

  const locationConstraint =
    `\n\nCRITICAL: The activity MUST be physically located in or immediately around ${destination}. ` +
    `Never suggest a place, venue, or attraction that is in a different city or country, even if it appears in the day context. ` +
    `If the item being replaced is from another city, ignore it — suggest something local to ${destination}.`;

  // PHI-51: single-slot soft-bias clause. Empty string when no inspiration set.
  const trimmedInspiration: string =
    typeof inspiration === "string" ? inspiration.trim() : "";
  const inspirationClause = trimmedInspiration.length
    ? `\n\n${buildInspirationEditInjection(trimmedInspiration)}`
    : "";

  // PHI-54: when the slot edit lands on an atlas-matched trip, inject
  // the deterministic anchor list for the destination alongside the
  // soft-bias clause. Hallucination guard remains.
  let atlasClause = "";
  if (trimmedInspiration.length && typeof destination === "string") {
    const franchise = matchFranchise(trimmedInspiration);
    if (franchise) {
      const seg = buildAtlasAnchorSegment(franchise, destination);
      if (seg) atlasClause = `\n\n${seg}`;
    }
  }

  // PHI-99: flex mode drops the date dash so the line reads cleanly.
  const dayHeader = dateFormatted
    ? `Day ${dayNumber} — ${dateFormatted}, ${block}`
    : `Day ${dayNumber}, ${block}`;
  let prompt: string;
  if (mode === "swap") {
    prompt =
      `You are a travel planner helping a ${profile} in ${destination}.\n` +
      `${dayHeader} slot.\n` +
      `The user wants to replace: "${replacingItem.title}" — ${replacingItem.description}${dayContext}\n\n` +
      `Suggest one specific ${block} activity in ${destination} that fits this traveller and the day's flow. ` +
      `It should be a confident, specific recommendation — not a generic tourist activity unless it's genuinely the best fit. ` +
      `It should feel like a natural alternative or upgrade to what it's replacing.` +
      locationConstraint +
      inspirationClause +
      atlasClause +
      avoidClause;
  } else {
    prompt =
      `You are a travel planner helping a ${profile} in ${destination}.\n` +
      `${dayHeader} has a free slot.${dayContext}\n\n` +
      `Suggest one specific ${block} activity in ${destination} that fits this traveller and the day's flow. ` +
      `It should complement what's already planned and feel like it belongs in the itinerary.` +
      locationConstraint +
      inspirationClause +
      atlasClause +
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
                  "Brief note about any issue on this day after this change — e.g. two heavy meals back to back, no restaurant planned, activities too far apart, or an activity that is not in the destination city. Empty string if none.",
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
        travelerCount: travelerCount ?? null,
        childrenAges: childrenAges ?? null,
      },
      output: JSON.stringify(input),
      latency_ms: Date.now() - startTime,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    });

    await logApiUsage({
      provider: "anthropic", apiType: "itinerary-edit", feature: "itinerary",
      model: MODEL, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens,
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
