import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

/** Trim and length-cap a client-supplied string field; anything else → null. */
function cleanStr(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, maxLen);
}

function cleanStrArray(value: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .map((v) => v.slice(0, maxLen))
    .slice(0, maxItems);
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  // PHI-61: profiles is a legacy table with no auth_user_id linkage. Writes
  // run without a session — use the service-role admin client.
  const { data, error } = await getSupabaseAdminClient()
    .from("profiles")
    .insert({
      name:           cleanStr(body.name, 100),
      destination:    cleanStr(body.destination, 200),
      traveler_types: cleanStrArray(body.travelerTypes, 20, 50),
      travel_company: cleanStr(body.travelCompany, 50),
      budget:         cleanStr(body.budget, 50),
      departure_date: cleanStr(body.departureDate, 10),
      return_date:    cleanStr(body.returnDate, 10),
      dietary_wishes: cleanStr(body.dietaryWishes, 500),
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
