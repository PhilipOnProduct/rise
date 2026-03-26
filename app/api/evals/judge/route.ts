import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { logAiInteraction } from "@/lib/ai-logger";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-6";

export async function POST(req: NextRequest) {
  const { output, criteria, testCase } = await req.json();

  if (!output || !criteria?.length) {
    return NextResponse.json({ error: "Missing output or criteria" }, { status: 400 });
  }

  const prompt = `You are evaluating an AI-generated travel itinerary for quality and appropriateness.

Test case: ${testCase}

Evaluation criteria:
${criteria.map((c: string, i: number) => `${i + 1}. ${c}`).join("\n")}

AI-generated itinerary output:
${output}

Score the itinerary 1-5 against the criteria above:
- 5: Excellent — all criteria fully met
- 4: Good — most criteria met, minor gaps
- 3: Acceptable — some criteria met, notable gaps
- 2: Poor — few criteria met, significant issues
- 1: Failing — criteria largely unmet

Return ONLY valid JSON — no markdown, no code fences:
{
  "score": <number 1-5>,
  "reasoning": "<2-3 sentence overall assessment>",
  "criteria_results": [
    { "criterion": "<criterion text>", "pass": <boolean>, "note": "<brief note>" }
  ]
}`;

  const startTime = Date.now();
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonStr = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

    let result;
    try {
      result = JSON.parse(jsonStr);
    } catch {
      // Fallback: try extracting JSON between first { and last }
      const start = jsonStr.indexOf("{");
      const end = jsonStr.lastIndexOf("}");
      if (start !== -1 && end !== -1) {
        result = JSON.parse(jsonStr.slice(start, end + 1));
      } else {
        return NextResponse.json({ error: "Judge returned malformed JSON" }, { status: 500 });
      }
    }

    await logAiInteraction({
      feature: "eval-judge",
      model: MODEL,
      prompt,
      input: { testCase, criteriaCount: criteria.length },
      output: jsonStr,
      latency_ms: Date.now() - startTime,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[eval-judge]", err);
    return NextResponse.json({ error: "Failed to judge output" }, { status: 500 });
  }
}
