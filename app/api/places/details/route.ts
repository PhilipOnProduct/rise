/**
 * PHI-111 — Places Details lookup for hotel rich-payload capture.
 *
 * Welcome step 2's `PlacesAutocomplete` calls this route after the user
 * picks a hotel suggestion so the rich lat/lng/neighbourhood payload lands
 * on the traveler row (and per-leg in the legs JSONB) for downstream
 * features like PHI-105 hotel-context anchor resolution and PHI-102
 * neighbourhood-weighted popular picks.
 *
 * The route is server-side so:
 *   - `checkApiLimit("google")` gates billing,
 *   - `logApiUsage({ provider: "google", apiType: "places-details" })`
 *     records spend in `api_usage`,
 *   - the API key never has to round-trip via the browser. (We still use
 *     `NEXT_PUBLIC_GOOGLE_PLACES_KEY` since the same key is already public
 *     for autocomplete; nothing here introduces a new secret.)
 *
 * On limit-exceeded the route returns 429. The client's PlacesAutocomplete
 * silently swallows that — the user already saw `onSelect(description)`
 * fire, so the hotel name is captured. Only the rich fields are skipped,
 * and downstream consumers handle missing coords as "no hotel" (same path
 * as the explicit skip-hotel affordance on welcome step 2).
 */

import { NextRequest, NextResponse } from "next/server";
import { logApiUsage, checkApiLimit } from "@/lib/log-api-usage";

const FIELD_MASK = "id,location,addressComponents";

type AddressComponent = {
  longText?: string;
  shortText?: string;
  types?: string[];
};

type PlaceDetailsResponse = {
  id?: string;
  location?: { latitude?: number; longitude?: number };
  addressComponents?: AddressComponent[];
};

/** Pick the most-specific neighbourhood-like label from the address components.
 *  Google returns several layers (neighborhood < sublocality_level_1 <
 *  sublocality < locality). We prefer the most local one so cards reflect
 *  what a resident would actually call the area. */
function pickNeighborhood(components: AddressComponent[] | undefined): string | null {
  if (!Array.isArray(components)) return null;
  const preference = [
    "neighborhood",
    "sublocality_level_1",
    "sublocality_level_2",
    "sublocality",
    "administrative_area_level_2",
  ];
  for (const t of preference) {
    const hit = components.find((c) => Array.isArray(c.types) && c.types.includes(t));
    if (hit?.longText) return hit.longText;
    if (hit?.shortText) return hit.shortText;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const { placeId } = (await req.json()) as { placeId?: string };
  if (typeof placeId !== "string" || placeId.trim().length === 0) {
    return NextResponse.json({ error: "placeId required" }, { status: 400 });
  }

  // Hard limit check before the billable call. On limit-exceeded the
  // welcome page's onSelect already fired, so the hotel name is captured —
  // we just skip the rich payload and stay null on the row.
  const limit = await checkApiLimit("google");
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: "API limit exceeded",
        provider: "google",
        spentUsd: limit.spentUsd,
        limitUsd: limit.limitUsd,
      },
      { status: 429 },
    );
  }

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "places key missing" }, { status: 500 });
  }

  try {
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      {
        method: "GET",
        headers: {
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": FIELD_MASK,
        },
      },
    );
    if (!res.ok) {
      console.warn("[places-details] upstream", res.status, await res.text().catch(() => ""));
      return NextResponse.json({ error: "places upstream error" }, { status: 502 });
    }
    const data = (await res.json()) as PlaceDetailsResponse;

    await logApiUsage({
      provider: "google",
      apiType: "places-details",
      feature: "hotel-coordinates",
    });

    const lat = data.location?.latitude;
    const lng = data.location?.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") {
      return NextResponse.json({ error: "no location" }, { status: 422 });
    }

    return NextResponse.json({
      placeId: data.id ?? placeId,
      lat,
      lng,
      neighborhood: pickNeighborhood(data.addressComponents),
    });
  } catch (err) {
    console.error("[places-details]", err);
    return NextResponse.json({ error: "places details failed" }, { status: 500 });
  }
}
