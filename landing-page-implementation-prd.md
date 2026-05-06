# Landing Page — Implementation PRD (Option A: Specificity-led)

**Author:** Sarah (PM), with copy from Noor, technical spec from Luca, usability spec from Maya, traveller-reality check from Elena
**Date:** 2026-05-06
**Status:** Ready for Refine → Implement
**Direction:** Option A from `landing-page-prd.md`. Locked.
**Linear card:** to be filed at `Refine`

---

## Summary

Replace the homepage's generic headline + three-pill structure with a specific, concrete claim and an inline destination input that becomes the first step of the wizard. Add three specimen-day cards as proof. Remove the feature pills. Keep the palette, the font, and the skyline. Pull the inline `LandmarkSkyline` SVG into its own component while we're in there.

---

## Copy — locked

All copy below is final. Engineering should not paraphrase. Any change requires a new PR with Sarah + Noor sign-off.

### Nav
- Logo text: `Rise`
- Right link: `Sign in` *(unchanged from current)*

### Hero

| Slot | Copy |
|---|---|
| Eyebrow | `AI-POWERED TRIP PLANNING` |
| Headline (line 1) | `Plan a trip that knows` |
| Headline (line 2) | `where you're going.` |
| Subhead | `Most travel apps guess. Rise asks where you're going, who's coming, and how you actually like to travel — then builds the day.` |

### Inline destination CTA
- Input placeholder: `Where to? Lisbon, Tokyo, Marrakech…`
- Button label: `Plan it →`
- Empty / invalid input state: button is disabled until the input has at least 2 non-whitespace characters. No toast, no error message.

### Specimen cards (supporting block)

Three cards below the CTA. Each card has a title in eyebrow style and three lines of itinerary excerpt.

**Card 1 — Lisbon**
- Title: `A RELAXED SATURDAY IN LISBON`
- Line 1: `Morning · Tile museum, then coffee in Alfama`
- Line 2: `Afternoon · Tram 28, long lunch at Time Out Market`
- Line 3: `Evening · Sunset at Miradouro da Senhora do Monte`

**Card 2 — Tokyo**
- Title: `THREE JET-LAGGED DAYS IN TOKYO`
- Line 1: `Day 1 · Slow walk through Yanaka, early sushi`
- Line 2: `Day 2 · teamLab Planets at opening, nap, izakaya at 7pm`
- Line 3: `Day 3 · Tsukiji breakfast, Shimokitazawa records`

**Card 3 — Rome**
- Title: `A FAMILY SUNDAY IN ROME`
- Line 1: `Morning · Villa Borghese playground, gelato`
- Line 2: `Afternoon · Pizza lunch, nap at the hotel`
- Line 3: `Evening · Trastevere stroll, 6:30pm dinner`

*Elena reviews these specimens before merge. Any change to specimen content requires her sign-off — they're load-bearing for the "this product actually understands travel" claim.*

### Removed
The three feature pills (`Personalised itinerary`, `Local insider tips`, `Smart transport advice`) are removed. The specimen cards do this work concretely.

### Skyline
Unchanged visually. Refactor only.

---

## Visual spec

### Palette *(unchanged from current)*
- Page background `#f8f6f1`
- Card background `#ffffff`
- Card border `#e8e4de`
- Primary text `#0e2a47`
- Secondary text `#4a6580`
- **Muted text `#5a6f7f`** — *darkened from current `#6a7f8f` to fix borderline contrast on small text*
- Accent teal `#1a6b7f`
- Eyebrow teal `#2a7f8f`

### Typography *(unchanged)*
- DM Sans throughout
- Headline: `clamp(36px, 5vw, 56px)`, weight 300, letter-spacing -1px, line-height 1.15
- Subhead: 18px desktop, 16px mobile, line-height 1.6
- Eyebrow: 11px, uppercase, letter-spacing 2px

### Layout

**Desktop (≥768px):**
- Nav, hero, CTA centred max-width 640px
- Specimen cards in a 3-column grid below CTA, max-width 1024px, 24px gap
- Skyline anchored to bottom, 30% of viewport height
- Page is a single screen at 1280×800 — no scroll required to see all four blocks

**Mobile (<768px):**
- Nav, hero, CTA stacked
- Specimen cards stacked vertically, full-width minus 24px page padding
- Subhead uses `text-base` (16px), not `text-lg` (18px), to prevent four-line wrap
- Page scrolls — skyline below the fold is acceptable on mobile

### Specimen card styling
- `bg-[#f0ede8]`, `rounded-2xl`, `border border-[#e8e4de]`, padding 20px *(tinted background lifts cards off the cream page — design review 2026-05-06)*
- Title at 11px uppercase, letter-spacing 1.5px, colour `#2a7f8f`
- Lines at 14px, colour `#4a6580`, line-height 1.5
- 12px vertical gap between title and first line
- 6px between lines
- Hover (desktop only): subtle `border-[#1a6b7f]/30` and `shadow-sm` transition

### Inline CTA styling
- Single rounded container (`rounded-2xl`) at `bg-white`, `border border-[#e8e4de]`
- Input has no own border — visually merged with container
- Button: existing primary style — `bg-[#1a6b7f] text-white rounded-full`, padding 12×24
- Container max-width 480px desktop, full-width minus 24px mobile

---

## Component structure

```
app/
├── page.tsx                          # Server component. Composes the three blocks.
├── components/
│   ├── LandingHero.tsx               # NEW — "use client". PlacesAutocomplete + button + nav logic.
│   ├── SpecimenCards.tsx             # NEW — Server component. Static array, no client behavior.
│   └── LandmarkSkyline.tsx           # NEW — Extracted from current page.tsx. No behavior change.
```

### `LandingHero.tsx` interface

The PlacesAutocomplete contract must mirror Step 1's usage exactly — `theme="light"`, `types={["(cities)"]}`, `onSelect` strips comma suffixes. Without these, the dropdown styles wrong, returns hotels instead of cities, and double-encodes the URL.

```ts
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PlacesAutocomplete from "@/app/components/PlacesAutocomplete";

export default function LandingHero() {
  const [destination, setDestination] = useState("");
  const router = useRouter();
  const canSubmit = destination.trim().length >= 2;

  function handleSubmit() {
    if (!canSubmit) return;
    // PlacesAutocomplete returns "Tokyo, Japan"; strip suffix to match Step 1's handler
    const seed = destination.split(",")[0].trim();
    router.push(`/welcome?destination=${encodeURIComponent(seed)}`);
  }

  return (
    // ... hero copy ...
    <PlacesAutocomplete
      value={destination}
      onChange={setDestination}
      onSelect={setDestination}
      placeholder="Where to? Lisbon, Tokyo, Marrakech…"
      types={["(cities)"]}
      theme="light"
      onEnter={handleSubmit}
    />
    <button onClick={handleSubmit} disabled={!canSubmit}>Plan it →</button>
    // ...
  );
}
```

### `SpecimenCards.tsx` interface

```ts
const SPECIMENS = [
  { title: "A RELAXED SATURDAY IN LISBON", lines: [...] },
  { title: "THREE JET-LAGGED DAYS IN TOKYO", lines: [...] },
  { title: "A FAMILY SUNDAY IN ROME", lines: [...] },
] as const;
```

No props. Pure presentation.

---

## `/welcome` integration

`app/welcome/page.tsx` is already a `"use client"` component with a complex multi-step state machine. **Do not restructure it into a server wrapper + client child.** Add a one-time seed via `useSearchParams()` from `next/navigation`, guarded by a ref so navigating back doesn't re-seed.

```ts
// inside the existing welcome client component, alongside other useEffects
import { useSearchParams } from "next/navigation";

const searchParams = useSearchParams();
const seededFromUrlRef = useRef(false);

useEffect(() => {
  if (seededFromUrlRef.current) return;
  const seed = searchParams.get("destination")?.trim();
  if (seed) {
    handleDestinationSelect(seed); // existing handler around line 2128
    seededFromUrlRef.current = true;
  }
}, [searchParams]);
```

The `seededFromUrlRef` guard ensures navigating back from Step 2 doesn't re-trigger the seed. The user's edits to `destination` win after the initial seed — query-string is a one-time seed, not a controlled value.

---

## Telemetry

Add to existing `ai_logs`-style logging *(or to a new `events` table if one exists by implementation time — defer to engineering judgement):*

| Event | Payload |
|---|---|
| `landing_cta_click` | `{ destination_provided: boolean, viewport_width: number }` |
| `landing_specimen_view` | `{ specimen_index: 0\|1\|2 }` *(fire on visibility, debounced)* |

These two events let us answer the two questions that matter post-launch: did the inline CTA do its job, and which specimen got attention.

---

## Acceptance criteria

1. Page renders at 360px wide with no horizontal scroll. Hero, CTA, and specimen cards all reachable.
2. Page renders at 1280×800 with hero + CTA + 3 specimen cards + skyline visible without scroll.
3. PlacesAutocomplete dropdown does not open on mount when navigating back from `/welcome`.
4. Submitting with a valid destination navigates to `/welcome?destination=Lisbon` and Step 1 input is pre-populated with `Lisbon`.
5. Submitting with empty / 1-character input: button is disabled, no navigation occurs.
6. All text passes WCAG 2.1 AA contrast at the rendered size — verified with the muted text token bumped to `#5a6f7f`.
7. Tab order: logo → Sign in → destination input → Plan it button → first specimen card. Enter in the input submits.
8. No console errors in dev or prod build. No new npm dependencies. No new env vars. No DB migrations.
9. Manual archetype walkthrough by Elena passes: the Bergmans see "A FAMILY SUNDAY IN ROME" and the Lisbon card and the page reads as understanding family travel.
10. `LandmarkSkyline` extracted to its own file. `app/page.tsx` is under 60 lines.
11. `LandmarkSkyline` carries `role="img"` and a meaningful `aria-label` *(decorative SVG must announce itself to screen readers)*.
12. Skyline shrinks on short viewports (<700px tall) so it doesn't crop monuments — use a fluid max-height, not the current fixed `flex: 3 1 0%`.
13. "Plan it →" button disables on submit so a double-click doesn't fire two navigations *(no spinner — sub-second router.push doesn't warrant one)*.

---

## Out of scope

- A/B testing copy variants — pick this and ship it.
- New OG image or meta description.
- Welcome wizard redesign — only the destination pre-fill behavior changes.
- Changes to dashboard, itinerary, profile, or any other route.
- Localisation or i18n.

---

## Success thresholds *(first two weeks post-launch)*

- **Landing → /welcome navigation rate** improves by ≥30% vs current baseline.
- **/welcome Step 1 → Step 5 completion rate** holds or improves *(must not regress)*.
- **Median time on landing page** decreases — proxy for "the page made the user move."
- **Qualitative:** at least one archetype walkthrough by Elena returns a "this gets us" reaction.

If any of the first three regress for two consecutive weeks, revisit copy with Noor before considering a roll-back.

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Specimen card copy misrepresents the product | Medium | Elena reviews copy before merge; specimens kept in a single static array so they're easy to revise without code changes |
| PlacesAutocomplete cost on every homepage visitor with typing | Low | At ~$0.017/req we're well inside the $10/mo Google budget; monitor `api_usage` in week 1 |
| `/welcome` Step 1 pre-fill collides with user's later edit | Low | Treat `searchParams.destination` as a one-time seed for initial state, not a controlled prop |
| Mobile viewport hides specimen cards below the fold | Medium *(by design)* | Acceptable — mobile users are expected to scroll; the hero + CTA must be above the fold and they are |

---

## Implementation checklist *(for engineering)*

1. Create `app/components/LandmarkSkyline.tsx` from existing inline SVG. No behavior change.
2. Create `app/components/LandingHero.tsx` *("use client")* with `PlacesAutocomplete` + button + `useRouter` navigation.
3. Create `app/components/SpecimenCards.tsx` from the static array in this PRD.
4. Rewrite `app/page.tsx` to compose the three components. Target ≤60 lines.
5. Update `app/welcome/page.tsx` to read `searchParams.destination` and pass to the wizard as `initialDestination`.
6. Verify Step 1 of the wizard accepts and renders the seeded destination.
7. Add `landing_cta_click` and `landing_specimen_view` telemetry calls.
8. Bump muted text token from `#6a7f8f` → `#5a6f7f` (search and replace where used in landing scope only).
9. Manual test at 360px and 1280px. Run Maya's archetype walkthrough on the deployed preview before merging.
10. Pre-deploy: confirm no new env var, no DB migration, no new dependency.

Estimated engineering effort: 1 day for an experienced Next.js engineer, 2 days with manual testing and copy review.

---

## Mock

See `mocks/landing-page-mock.html` — desktop (1280px) and mobile (360px) renderings side by side. Open in a browser. The mock uses real CSS — copy and palette are identical to this PRD; layout structure is the spec.
