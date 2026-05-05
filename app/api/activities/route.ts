import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-6";

export async function POST(req: NextRequest) {
  const { destination } = await req.json();

  if (!destination) {
    return NextResponse.json({ error: "destination required" }, { status: 400 });
  }

  const prompt = `Generate exactly 20 unique activity suggestions for travelers visiting ${destination}.

Return ONLY a valid JSON array — no markdown, no explanation, no code fences. Each object must have:
- id: number (1–20)
- name: string (activity name, max 40 chars)
- category: one of "Culture", "Food & Drink", "Nature", "Adventure", "Nightlife", "Shopping", "Art", "History", "Sports", "Relaxation"
- description: string (one sentence, max 90 chars)
- emoji: single emoji that fits the activity

Cover a wide variety of categories. Make suggestions specific to ${destination}.`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
    const activities = JSON.parse(cleaned);

    return NextResponse.json(activities);
  } catch (err) {
    console.error("[activities] Failed:", err);
    return NextResponse.json({ error: "Failed to generate activities." }, { status: 500 });
  }
}
