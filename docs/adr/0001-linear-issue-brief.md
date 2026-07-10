# Linear issue — Migrate Google Maps Platform → Geoapify + OpenRouteService (free)

**Team:** Philip On Product · **Type:** Improvement · **Status on file:** Backlog

---

## Problem

Rise depends on Google Maps Platform (autocomplete, place details, place
resolution, geocoding, routing) on a paid, metered key. We're moving to free
OSM-backed providers before traffic arrives, to remove the paid dependency and
billing ceiling. Decision recorded in `docs/adr/0001-google-to-free-geocoding-routing.md`.

## Decision (from ADR 0001)

- **Geoapify** (free tier) → autocomplete, geocoding, place resolution, neighbourhood.
- **OpenRouteService** (free tier) → walk + drive routing.
- **Drop public transit** — no free engine does it reliably. Remove the `🚇`
  segment from the UI; keep the DB columns null.
- Proxy both providers through server routes so keys stay server-side and every
  call flows through `logApiUsage` / `checkApiLimit`.

## Scope — per surface

1. **`app/components/PlacesAutocomplete.tsx`** — replace the Google Maps JS SDK
   (`ensureMapsLoaded`, `AutocompleteSuggestion`, session tokens) with calls to
   a new server route `POST /api/places/autocomplete` backed by Geoapify
   Autocomplete. **Keep `onSelect` / `onSelectRich` prop signatures byte-for-byte
   identical** — callers must not change. Geoapify returns lat/lon + address
   parts inline, so `onSelectRich` can be satisfied from the autocomplete
   result or a follow-up Geoapify Place Details call.

2. **`app/api/places/details/route.ts`** — re-point from Google Places Details to
   Geoapify (or fold into the autocomplete result). Preserve the response shape
   `{ placeId, lat, lng, neighborhood }`. Map neighbourhood from Geoapify
   `suburb` / `district` / `quarter` properties. Keep `enforceApiLimit` +
   `logApiUsage`.

3. **`app/api/resolve-place/route.ts`** — replace Places Text Search with
   Geoapify Geocoding/Search. Preserve the `{ resolved: PlaceRef | null }`
   contract and the soft-degrade-to-200 behaviour. Map result types to our
   `PlaceType` enum.

4. **`lib/travel-connectors.ts`**
   - `geocodeCity` → Geoapify Geocoding.
   - `resolveCoordinates` → Geoapify Geocoding/Search with location bias.
   - `computeRoute` → OpenRouteService Directions. Support `WALK`
     (`foot-walking`) and `DRIVE` (`driving-car`) only. **Remove the `TRANSIT`
     branch.** Drop `fare_text`.

5. **`app/api/itinerary/travel/route.ts`** — remove the `TRANSIT` calls from both
   `handleFullCompute` and `handleRefresh`. **Throttle routing concurrency**
   (max ~5 in flight, or sequence per day) to stay under OpenRouteService's
   40 req/min limit.

6. **Connector display** — `app/itinerary/TravelConnectorRow.tsx` (drop the
   `🚇` segment) and `app/itinerary/ItineraryHeader.tsx` (legend `🚶 walk · 🚕
   drive`, remove transit).

7. **`lib/api-costs.ts`** — add `geoapify` / `openrouteservice` providers at $0
   (mirror the Open-Meteo PHI-53 pattern). Leave Google entries for historical
   rows.

8. **Env / config** — introduce `GEOAPIFY_KEY` and `OPENROUTESERVICE_KEY`
   (server-side, **no** `NEXT_PUBLIC_` prefix). Remove the client-side reliance
   on `NEXT_PUBLIC_GOOGLE_PLACES_KEY` from PlacesAutocomplete. Update
   `.env.local`, Vercel, `next.config.ts` (drop the Google Maps script origin if
   pinned), and the Environment Variables section of `CLAUDE.md`.

## Hard constraints

- `PlacesAutocomplete` public prop contract (`onSelect`, `onSelectRich`,
  `PlaceRichSelection`) is locked — no caller edits.
- Every external call stays behind a server route with `logApiUsage` +
  `checkApiLimit("google")` (or a renamed provider gate) so the readiness
  instrumentation is preserved.
- No destructive DB migration: `transit_seconds` / `transit_fare` stay as
  nullable columns, always written null.
- Soft-degrade everywhere a Google path previously soft-degraded (resolve-place
  returns 200 + null, autocomplete falls back to plain text input, rich payload
  silently skipped on failure).

## Out of scope

- Self-hosting OSM. Paid tiers. Transit replacement. Re-tuning the gap-flag
  thresholds (walk-only flagging already works off the fastest mode).

## Verification (Claude Code)

- `npm run build` clean, zero prerender errors (App Router hooks gap — build,
  not just dev).
- Manual: welcome step-2 hotel autocomplete returns suggestions + persists
  coords/neighbourhood; `/itinerary` "Calculate travel times" produces walk +
  drive rows with no `🚇`; a swap triggers a scoped refresh under the rate cap.
- Confirm no remaining `googleapis.com` fetch or `NEXT_PUBLIC_GOOGLE_PLACES_KEY`
  reference outside historical comments.
- Cowork runs Elena's archetype walks before Done per KANBAN.
