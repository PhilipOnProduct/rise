# ADR 0001 — Replace Google Maps Platform with free geocoding + routing

- **Status:** Proposed
- **Author:** Luca (Tech Lead)
- **Date:** 2026-06-16
- **Deciders:** Philip
- **Supersedes:** —

## Context

Rise depends on Google Maps Platform across four distinct jobs, all keyed on
`NEXT_PUBLIC_GOOGLE_PLACES_KEY`:

| Job | Code | Google SKU |
|---|---|---|
| Hotel autocomplete (welcome step 2) | `app/components/PlacesAutocomplete.tsx` | Maps JS + Places Autocomplete (session-token) |
| Hotel rich payload (coords + neighbourhood) | `app/api/places/details/route.ts` | Places Details (New) |
| Parser place resolution (name → PlaceRef) | `app/api/resolve-place/route.ts` | Places Text Search (New) |
| Travel connectors (geocode + resolve + route) | `lib/travel-connectors.ts`, `app/api/itinerary/travel/route.ts` | Geocoding, Places Text Search, Routes API (WALK/TRANSIT/DRIVE) |

Google restructured its pricing in 2025: the recurring $200 monthly credit was
replaced with per-SKU free caps, with most calls billing ~$0.50/1,000 after the
shared credit pool. The largest per-request cost in Rise is Places Text Search
at $0.032/req; a full 5-day connector computation runs ~$0.70.

Rise has **no real-user traffic** — only Philip's own test walks. There is no
live cost fire today. The decision to migrate is about removing a paid
dependency and a billing ceiling **before** traffic arrives, framed as
readiness per the project's standing convention, not as cost recovery.

## Decision

Replace all four Google jobs with free-tier hosted APIs:

- **Geoapify** (free tier: ~3,000 req/day, 5 req/sec) for **autocomplete,
  geocoding, place resolution, and neighbourhood lookup**. OSM-backed.
- **OpenRouteService** (free tier: ~2,000 req/day, 40 req/min) for **walk and
  drive routing** between activities. OSM-backed.
- **Drop public-transit routing entirely.** No free OSM routing engine provides
  reliable multi-city public-transport directions. The `🚇 transit` segment is
  removed from the connector UI; `transit_seconds` / `transit_fare` columns are
  retained (always null) to avoid a destructive migration.

Both providers are proxied through our own Next API routes so the keys stay
server-side and every call flows through the existing `logApiUsage` /
`checkApiLimit` plumbing.

## Rationale

- **Truly $0 within caps.** Philip's test-walk volume is one to two orders of
  magnitude below the free ceilings. Caps become a real consideration only once
  traffic arrives — at which point this ADR gets revisited, not before.
- **Public-API stack, no servers.** Self-hosted OSM (Nominatim + Photon + OSRM)
  is free forever with no caps, but adds an ops burden we don't want at MVP.
  Rejected — see Alternatives.
- **Component contract stays locked.** `PlacesAutocomplete`'s `onSelect` /
  `onSelectRich` signatures don't change. Callers (Step2Hotel, the city pickers)
  are untouched. This mirrors the PHI-111 discipline: the public prop shape is
  the contract; the vendor behind it is swappable.
- **Transit was already the weakest signal.** Most Rise itineraries cluster
  activities into walkable neighbourhoods; the gap-flag logic keys off the
  *fastest* mode, which is almost always walk. Dropping transit removes a
  Google-only dependency at minimal product cost.

## Consequences

### Positive
- Zero marginal API cost at current and near-term volume.
- One fewer paid vendor; keys move fully server-side (autocomplete no longer
  needs a `NEXT_PUBLIC_` key).
- `checkApiLimit` / `api_usage` plumbing is preserved and now logs $0 rows —
  the readiness instrumentation stays intact for when traffic arrives.

### Negative / risks
- **POI coverage.** Geoapify (OSM) coverage of brand-new hotels or some small
  businesses can be thinner than Google. Acceptable at MVP; the no-coords
  fallback path already exists (skip-hotel behaviour) and absorbs misses.
- **Rate limits.** OpenRouteService is 40 req/min. The current connector
  compute fires routes for all pairs in a day via `Promise.all` and can burst
  past that on a dense day. **Mitigation:** throttle to a small concurrency
  (e.g. 5) and/or sequence per day. Required as part of implementation.
- **Transit feature loss** is user-visible: the `🚇` row and the header legend
  reference disappear. Documented and accepted.
- **Neighbourhood field** now comes from Geoapify's `suburb`/`district`/
  `quarter` properties instead of Google address components — label wording may
  shift slightly (still resident-recognisable).

## Alternatives considered

- **Keep Google for transit only** (the prior recommendation). Rejected by
  Philip in favour of a clean break to zero Google dependency.
- **Self-hosted OSM (Nominatim + Photon + OSRM).** Free forever, no caps, full
  control — but requires running and maintaining infrastructure plus regional
  OSM extract updates. Disproportionate for an MVP with no traffic. Revisit if
  Rise scales past the hosted free tiers.
- **Mapbox / HERE.** Generous free tiers but still commercial vendors with
  billing ceilings — same class of dependency we're trying to shed, so no net
  gain over Geoapify for our jobs.

## Follow-ups / revisit triggers

- Real traffic approaches **2,000 routing req/day or 3,000 geocoding req/day** →
  revisit self-hosting or a paid tier.
- If transit times prove missed by users once traffic exists → reconsider a
  transit-only Google fallback or a regional GTFS engine.
- Keep `lib/api-costs.ts` provider rates current; add `geoapify` /
  `openrouteservice` at $0, mirroring the Open-Meteo (PHI-53) pattern.
