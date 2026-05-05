import { NextRequest, NextResponse } from "next/server";
import { logApiUsage } from "@/lib/log-api-usage";
import type { PlaceRef, PlaceType } from "@/lib/trip-schema";

/**
 * Follow-up #4 — place resolution wiring on parser output
 *
 * Resolves a free-text place name to a {@link PlaceRef} via Google Places
 * Text Search (New). Used after the PHI-34 free-form parser returns a list
 * of destination names ("Lisbon", "Madrid") so the persisted leg can carry
 * id / lat / lng / type — not just a string. Improves multi-leg quality
 * and downstream activity-gen via PHI-30's place-aware codepaths.
 *
 * Conservative behaviour:
 * - Returns 200 with `{ resolved: null }` when the API is unconfigured or
 *   no result was found. The caller should fall back to the raw name and
 *   set `unverified: true` on the leg's place.
 * - Never throws — every error path returns 200 with a null result so the
 *   onboarding flow doesn't break on flaky network or quota issues.
 *
 * The endpoint is intentionally minimal — a single name in, a single
 * PlaceRef out — so the welcome page can fire it in parallel for each
 * parsed destination without coupling to the autocomplete component.
 */

// Map Google place type strings to our narrower PlaceType enum.
function inferPlaceType(types: string[] | undefined): PlaceType | undefined {
  if (!types?.length) return undefined;
  const set = new Set(types);
  if (set.has("country")) return "country";
  if (set.has("administrative_area_level_1") || set.has("administrative_area_level_2"))
    return "region";
  if (set.has("locality") || set.has("postal_town")) return "locality";
  if (set.has("tourist_attraction") || set.has("point_of_interest")) return "poi";
  return "place";
}

export async function POST(req: NextRequest) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body" },
      { status: 400 }
    );
  }
  const { name, hint } = (payload ?? {}) as { name?: string; hint?: string };
  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json(
      { error: "name is required" },
      { status: 400 }
    );
  }

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_KEY;
  if (!apiKey) {
    // Soft-degrade: caller will fall back to the raw name.
    return NextResponse.json({ resolved: null, reason: "no_api_key" }, { status: 200 });
  }

  // Compose the query — when the parser hands us a kind hint ("country",
  // "region", "locality") we just use the bare name. Google's text search
  // is good enough at disambiguating. We avoid hard-coded biases here to
  // keep the endpoint generic.
  const textQuery = name.trim();

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        // Minimum field mask — id, displayName, location, types are enough
        // to populate a PlaceRef without paying for SKUs we don't need.
        "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.types",
      },
      body: JSON.stringify({
        textQuery,
        maxResultCount: 1,
      }),
    });

    if (!res.ok) {
      // Soft-degrade: log and return null so the onboarding flow continues.
      console.error(
        "[resolve-place] Places Text Search error:",
        res.status,
        await res.text().catch(() => "")
      );
      return NextResponse.json(
        { resolved: null, reason: "places_api_error", status: res.status },
        { status: 200 }
      );
    }

    const data = (await res.json()) as {
      places?: {
        id?: string;
        displayName?: { text?: string };
        location?: { latitude?: number; longitude?: number };
        types?: string[];
      }[];
    };

    const top = data.places?.[0];
    if (!top || top.location?.latitude == null || top.location?.longitude == null) {
      return NextResponse.json({ resolved: null, reason: "no_match" }, { status: 200 });
    }

    void logApiUsage({
      provider: "google",
      apiType: "places-text-search",
      feature: "resolve-place",
    });

    // Hint comes through verbatim if the parser supplied one, else inferred.
    const inferredType =
      (typeof hint === "string" && (["place", "region", "country", "locality", "poi"] as const).includes(hint as PlaceType)
        ? (hint as PlaceType)
        : undefined) ?? inferPlaceType(top.types);

    const resolved: PlaceRef = {
      // Display the user's original phrasing — they typed "Lisbon" not
      // "Lisbon, Portugal", so we don't surprise them with a swapped name.
      name,
      ...(top.id && { id: top.id }),
      lat: top.location.latitude,
      lng: top.location.longitude,
      ...(inferredType && { type: inferredType }),
    };

    return NextResponse.json({ resolved }, { status: 200 });
  } catch (err) {
    console.error("[resolve-place] exception:", err);
    return NextResponse.json(
      { resolved: null, reason: "exception" },
      { status: 200 }
    );
  }
}
