import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { logAiInteraction } from "@/lib/ai-logger";
import { supabase } from "@/lib/supabase";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-6";

export async function POST(req: NextRequest) {
  const {
    destination,
    departureDate,
    returnDate,
    travelCompany,
    travelerTypes,
    budgetTier,
    replacingRestaurant,
    cuisine,
    vibe,
    timeBlock,
    date,
    dayNumber,
    partySize,
  } = await req.json();

  if (!destination || !replacingRestaurant || !timeBlock || !date) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const styleStr = travelerTypes?.length ? travelerTypes.join(", ") : "no specific style";
  const budgetStr = budgetTier || "mid-range";
  const companyStr = travelCompany || "solo";
  const partySizeStr = partySize ? `Party size: ${partySize}.` : "";

  const prompt = `You are a restaurant recommendation AI for travellers. A user is planning a trip to ${destination} (${departureDate} to ${returnDate}) and needs an alternative restaurant.

Context:
- Destination: ${destination}
- Travel dates: ${departureDate} to ${returnDate}
- Date of this meal: ${date} (Day ${dayNumber})
- Time of day: ${timeBlock}
- Travel company: ${companyStr}
- Travel style / cuisine preferences: ${styleStr}
- Budget tier: ${budgetStr}
- ${partySizeStr}
- Restaurant being replaced: "${replacingRestaurant}"${cuisine ? `\n- Previous cuisine type: ${cuisine}` : ""}${vibe ? `\n- Previous vibe: ${vibe}` : ""}

The user wants a different restaurant for this slot. Generate ONE alternative restaurant that:
1. Is a real, specific restaurant in ${destination} — not a generic suggestion
2. Fits the ${timeBlock} time slot on ${date}
3. Matches the budget tier (${budgetStr})
4. Complements the travel style (${styleStr})
5. Is DIFFERENT from "${replacingRestaurant}" — different cuisine or different vibe, to give a genuinely fresh option
6. Consider that ${date} may be a high-demand period (weekend, holiday, festival season) — if so, suggest places more likely to have availability

Return ONLY valid JSON — no markdown, no code fences, no explanation.

{
  "id": "alt-${Date.now()}",
  "title": "Restaurant Name",
  "description": "One sentence, under 20 words, specific to ${destination}.",
  "type": "restaurant",
  "time_block": "${timeBlock}",
  "status": "idea",
  "source": "ai_generated",
  "cuisine": "Cuisine type",
  "vibe": "one-word vibe",
  "price_tier": "€€",
  "booking_meta": {
    "preferred_platform": "opentable" | "resy" | "thefork",
    "confidence": "high" | "medium" | "low",
    "search_query": "exact restaurant name city"
  }
}

For booking_meta.search_query: use the restaurant's commonly known name plus ${destination} — optimise for finding the correct restaurant on booking platforms.`;

  const startTime = Date.now();
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonStr = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

    let alternative;
    try {
      alternative = JSON.parse(jsonStr);
    } catch {
      console.error("[itinerary-alternative] JSON parse failed. Raw output:\n", raw);
      return NextResponse.json(
        { error: "AI returned malformed JSON. Please try again." },
        { status: 500 }
      );
    }

    // Persist to database immediately
    const { error: dbError } = await supabase.from("itinerary_items").insert({
      item_id: alternative.id,
      title: alternative.title,
      description: alternative.description,
      item_type: alternative.type,
      time_block: alternative.time_block,
      status: alternative.status,
      source: alternative.source,
      cuisine: alternative.cuisine,
      vibe: alternative.vibe,
      price_tier: alternative.price_tier,
      booking_meta: alternative.booking_meta,
      date,
      day_number: dayNumber,
      destination,
      replaced_restaurant: replacingRestaurant,
      is_alternative: true,
    });

    if (dbError) {
      console.error("[itinerary-alternative] DB insert failed:", dbError.message, dbError.code, dbError.details);
    }

    await logAiInteraction({
      feature: "itinerary-alternative",
      model: MODEL,
      prompt,
      input: { destination, replacingRestaurant, timeBlock, date, budgetTier, travelCompany, travelerTypes },
      output: jsonStr,
      latency_ms: Date.now() - startTime,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    });

    return NextResponse.json({ alternative });
  } catch (err) {
    console.error("[itinerary-alternative]", err);
    return NextResponse.json({ error: "Failed to generate alternative" }, { status: 500 });
  }
}
