import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { logAiInteraction } from "@/lib/ai-logger";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-6";

type TimeBlock = "morning" | "afternoon" | "evening";

type ActivityFeedbackEntry = {
  activityName: string;
  feedbackType: "thumbs_up" | "chip_selected";
  chip?: { label: string; type: "hard_exclusion" | "soft_signal" };
};

function buildFeedbackSegment(feedback: ActivityFeedbackEntry[]): string {
  if (!feedback?.length) return "";

  const hardExclusions = feedback
    .filter((f) => f.feedbackType === "chip_selected" && f.chip?.type === "hard_exclusion")
    .map((f) => f.activityName);

  const softSignals = feedback
    .filter((f) => f.feedbackType === "chip_selected" && f.chip?.type === "soft_signal")
    .map((f) => `${f.activityName} (${f.chip!.label})`);

  const parts: string[] = [];

  if (hardExclusions.length) {
    parts.push(
      `IMPORTANT — Never include these activities in any form. The user has explicitly excluded them:\n` +
        hardExclusions.map((n) => `- ${n}`).join("\n")
    );
  }

  if (softSignals.length) {
    parts.push(
      `The user expressed hesitation about: ${softSignals.join("; ")}. ` +
        `You may include similar alternatives but avoid these specific activities.`
    );
  }

  return parts.length ? `\n\n${parts.join("\n\n")}` : "";
}

type ItineraryItem = {
  id: string;
  title: string;
  description: string;
  type: "activity" | "restaurant" | "transport" | "note";
  time_block: TimeBlock;
  status: "idea";
  source: "ai_generated";
};

type ItineraryDay = {
  date: string;
  day_number: number;
  items: ItineraryItem[];
};

export async function POST(req: NextRequest) {
  const { destination, departureDate, returnDate, travelCompany, travelerTypes, activityFeedback } =
    await req.json();

  if (!destination || !departureDate || !returnDate) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const nights = Math.round(
    (new Date(returnDate).getTime() - new Date(departureDate).getTime()) / 86_400_000
  );

  const days = Math.max(1, nights);
  const styleStr = travelerTypes?.length ? `Travel style: ${travelerTypes.join(", ")}.` : "";
  const companyStr = travelCompany ? `Travelling: ${travelCompany}.` : "";
  const feedbackSegment = buildFeedbackSegment(activityFeedback ?? []);

  const prompt = `You are a trip planning AI. Generate a structured day-by-day itinerary for a ${days}-day trip to ${destination}.
${companyStr}
${styleStr}${feedbackSegment}

Return ONLY a valid JSON array — no markdown, no explanation, no code fences. The array must have exactly ${days} elements, one per day.

Each day object:
{
  "date": "YYYY-MM-DD",   // starting from ${departureDate}
  "day_number": 1,         // 1-indexed
  "items": [...]
}

Each item object:
{
  "id": "unique-string-id",
  "title": "Activity name",
  "description": "One sentence. Be specific to ${destination}.",
  "type": "activity" | "restaurant" | "transport",
  "time_block": "morning" | "afternoon" | "evening",
  "status": "idea",
  "source": "ai_generated"
}

Rules:
- Cover morning, afternoon, and evening for each day (one item per slot minimum, max two)
- Mix types: include at least one restaurant per day
- Day 1 morning: arrival/orientation activity
- Final day evening: something easy near accommodation
- Be specific to ${destination} — no generic suggestions
- Keep descriptions under 20 words
- id must be unique across all days (e.g. "day1-morning-1")`;

  const startTime = Date.now();
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content[0].type === "text" ? response.content[0].text : "";
    // Strip markdown code fences with any amount of surrounding whitespace
    const jsonStr = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

    let days_data: ItineraryDay[];
    try {
      days_data = JSON.parse(jsonStr);
    } catch {
      console.error("[itinerary-generate] JSON parse failed. Raw output:\n", raw);
      return NextResponse.json(
        { error: "AI returned malformed JSON. Please try again." },
        { status: 500 }
      );
    }

    await logAiInteraction({
      feature: "itinerary-generate",
      model: MODEL,
      prompt,
      input: { destination, departureDate, returnDate, travelCompany, travelerTypes },
      output: jsonStr,
      latency_ms: Date.now() - startTime,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    });

    return NextResponse.json({ days: days_data });
  } catch (err) {
    console.error("[itinerary-generate]", err);
    return NextResponse.json({ error: "Failed to generate itinerary" }, { status: 500 });
  }
}
