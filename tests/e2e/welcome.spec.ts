import { test, expect, Route } from "@playwright/test";

/**
 * /welcome step-5 visual snapshot + duplicate-text guard.
 *
 * This test exists primarily to prevent regression of PHI-25 (duplicate body
 * text on the "Save your trip plan" screen) and to give the team a place
 * to add more onboarding-flow tests as PHI-26..PHI-29 ship.
 *
 * Strategy:
 *  - Mock the AI / DB endpoints so the test is deterministic and fast and
 *    doesn't require Anthropic API keys, Supabase, or Google Maps.
 *  - Walk through steps 0–4, then assert step 5 renders correctly.
 *  - Two assertions on step 5: a DOM-count check that the description
 *    string appears exactly once (the PHI-25 regression guard), and a
 *    visual snapshot for broader regression coverage.
 */

// 3 activities in the exact format that parseActivities() expects:
//   **Name** — Category\nDescription\n*When: timing*
const MOCK_ACTIVITIES_STREAM = [
  "**Pastéis de Belém Tasting** — Food & Dining",
  "Original home of the pastel de nata, served since 1837.",
  "*When: morning, ~45 min*",
  "*Why: Picked because you flagged Food-led — this is Lisbon's most-cited pastry origin.*",
  "",
  "**Jerónimos Monastery** — Cultural/Historic",
  "UNESCO-listed Manueline monastery next door to Pastéis de Belém.",
  "*When: morning, ~90 min*",
  "*Why: Matches your Cultural style and sits 5 min walk from the pastry stop.*",
  "",
  "**Praia de Carcavelos** — Outdoor/Adventure",
  "The widest, flattest beach in the Lisbon region.",
  "*When: afternoon, ~3 hours*",
  "*Why: Wide, gentle beach — fits a Comfortable budget couple's break day.*",
  "",
].join("\n");

const STEP_5_DESCRIPTION =
  "Your activity plan, transport advice, and trip summary are ready.";

test.beforeEach(async ({ page }) => {
  // Stream the mock activities text as the response body.
  await page.route("**/api/activities-stream", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/plain; charset=utf-8",
      body: MOCK_ACTIVITIES_STREAM,
    });
  });

  // Chips endpoint returns a small fixed set so the rating UI works
  // (only relevant if the user clicks thumbs-down; thumbs-up doesn't fetch).
  await page.route("**/api/activity-chips", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        chips: [
          { label: "Done it before", type: "hard_exclusion" },
          { label: "Not really my thing", type: "soft_signal" },
        ],
      }),
    });
  });

  // No-op the analytics endpoint so it doesn't error.
  await page.route("**/api/activity-feedback", async (route: Route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  // PHI-31 Part 2 slice 2: mock the itinerary generator so step 5 can
  // render the preview without hitting Anthropic.
  await page.route("**/api/itinerary/generate", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        days: [
          {
            day_number: 1,
            date: "2026-06-15",
            items: [
              {
                id: "day1-morning",
                title: "Pastéis de Belém Tasting",
                description: "Custard tart pilgrimage at the original 1837 bakery.",
                type: "restaurant",
                time_block: "morning",
              },
              {
                id: "day1-afternoon",
                title: "Jerónimos Monastery",
                description: "UNESCO Manueline cloisters next door.",
                type: "activity",
                time_block: "afternoon",
              },
            ],
          },
          {
            day_number: 2,
            date: "2026-06-16",
            items: [
              {
                id: "day2-morning",
                title: "Praia de Carcavelos",
                description: "Wide flat beach 25 min by train.",
                type: "activity",
                time_block: "morning",
              },
            ],
          },
        ],
      }),
    });
  });

  // PHI-31 Part 2 slice 1: anonymous-session PATCH from step transitions.
  await page.route("**/api/anonymous-session", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "test-session-id" }),
    });
  });

  // Mock the partial-traveler write at step 3 advance.
  await page.route("**/api/travelers", async (route: Route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "test-traveler-id" }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
});

/**
 * PHI-30 / RISE-201 — destination disambiguation.
 *
 * Verifies the silent-override fix: typing without selecting from the
 * autocomplete dropdown does NOT advance the user. They must either pick
 * a suggestion or explicitly click "Use anyway".
 */
test("welcome step 0 gates Start planning on verified destination", async ({
  page,
}) => {
  await page.goto("/welcome");
  // PHI-34: dual-CTA landing now shows the free-form parser by default.
  // Drop into the structured form for tests that walk the wizard.
  await page.getByTestId("use-structured-form").click();

  const input = page.getByPlaceholder("e.g. Tokyo, Japan");
  const startBtn = page.getByRole("button", { name: /Start planning/i });
  const useAnyway = page.getByTestId("use-destination-anyway");

  // Initial state: empty → button disabled
  await expect(startBtn).toBeDisabled();

  // Type a destination (no autocomplete in the test env)
  await input.fill("Lisbon, Portugal");

  // PHI-30: still disabled — no place verified
  await expect(startBtn).toBeDisabled();

  // The escape-hatch link appears
  await expect(useAnyway).toBeVisible();
  // The JSX uses smart quotes (&ldquo; / &rdquo;) for typography
  await expect(useAnyway).toContainText("Lisbon, Portugal");
  await expect(useAnyway).toContainText("anyway");

  // Pressing Enter does NOT advance (still on step 0)
  await input.press("Enter");
  await expect(startBtn).toBeVisible();

  // Click the escape — verified, button enabled
  await useAnyway.click();
  await expect(startBtn).toBeEnabled();

  // Editing the input again invalidates verification
  await input.fill("Madrid");
  await expect(startBtn).toBeDisabled();
  await expect(useAnyway).toBeVisible();
});

/**
 * PHI-26 / RISE-102 — persistent trip-type confirmation label.
 *
 * Walks to step 3 and verifies the label updates correctly across the
 * four key composition cases: ambiguous 2-adult, couple-picked, solo
 * (chip section hidden), and family (chip section hidden).
 */
test("welcome step 3 shows persistent trip-type label across compositions", async ({
  page,
}) => {
  await page.goto("/welcome");
  // PHI-34: dual-CTA landing — drop into structured form for the wizard walk.
  await page.getByTestId("use-structured-form").click();

  // Walk to step 3
  await page.getByPlaceholder("e.g. Tokyo, Japan").fill("Lisbon");
  // PHI-30: Enter only advances when destination is verified. In the test
  // environment we have no Google Maps API key, so the autocomplete
  // dropdown won't appear — use the "Use anyway" escape hatch.
  await page.getByTestId("use-destination-anyway").click();
  await page.getByRole("button", { name: /Start planning/i }).click();
  await page.locator('input[type="date"]').first().fill("2026-06-15");
  await page.locator('input[type="date"]').nth(1).fill("2026-06-22");
  await page.getByRole("button", { name: /Continue/i }).click();
  await page.getByRole("button", { name: /haven't booked yet/i }).click();

  const label = page.getByTestId("trip-type-label");

  // Default: 2 adults, 0 children, no chip picked → neutral prompt
  await expect(label).toHaveText("Planning a trip for two");

  // Pick Couple chip → couple's trip
  await page.getByRole("button", { name: /Couple/i }).click();
  await expect(label).toHaveText("Planning a couple's trip");

  // Pick Friend group → trip for two friends
  await page.getByRole("button", { name: /Friend group/i }).click();
  await expect(label).toHaveText("Planning a trip for two friends");

  // Decrement adults to 1 → Solo. The Trip Type chip section disappears.
  // The "Adults" label sits in the same column as the +/- stepper buttons,
  // so target by the column structure rather than by global button names.
  const adultsCol = page.locator("span").filter({ hasText: /^Adults$/ }).locator("..");
  await adultsCol.getByRole("button", { name: "−" }).click();
  await expect(label).toHaveText("Planning a solo trip");
  // Chip section should be gone (no Couple chip visible to the user)
  await expect(page.getByRole("button", { name: /Couple/i })).toHaveCount(0);

  // Bump back to 2 adults, then add 2 children
  await adultsCol.getByRole("button", { name: "+" }).click();
  const childrenCol = page.locator("span").filter({ hasText: /^Children$/ }).locator("..");
  await childrenCol.getByRole("button", { name: "+" }).click();
  await childrenCol.getByRole("button", { name: "+" }).click();

  // PHI-27: children no longer default to "Under 2". The label should
  // prompt the user to pick ages for each child.
  await expect(label).toHaveText(
    "Planning a family trip with 2 children — pick an age range for each"
  );

  // Change child 1 to 5–8, child 2 to 9–12
  const child1Row = page.locator('text="Child 1"').locator("..");
  await child1Row.getByRole("button", { name: "5–8" }).click();
  const child2Row = page.locator('text="Child 2"').locator("..");
  await child2Row.getByRole("button", { name: "9–12" }).click();

  await expect(label).toHaveText(
    "Planning a family trip with 2 children (5–8, 9–12)"
  );
});

/**
 * PHI-27 / RISE-103 — 13–17 age bucket + Continue gating + Teen-friendly chip.
 */
test("welcome step 3 supports teen ages and gates Continue on age picks", async ({
  page,
}) => {
  await page.goto("/welcome");
  // PHI-34: dual-CTA landing — drop into structured form for the wizard walk.
  await page.getByTestId("use-structured-form").click();

  // Walk to step 3
  await page.getByPlaceholder("e.g. Tokyo, Japan").fill("Lisbon");
  // PHI-30: Enter only advances when destination is verified. In the test
  // environment we have no Google Maps API key, so the autocomplete
  // dropdown won't appear — use the "Use anyway" escape hatch.
  await page.getByTestId("use-destination-anyway").click();
  await page.getByRole("button", { name: /Start planning/i }).click();
  await page.locator('input[type="date"]').first().fill("2026-06-15");
  await page.locator('input[type="date"]').nth(1).fill("2026-06-22");
  await page.getByRole("button", { name: /Continue/i }).click();
  await page.getByRole("button", { name: /haven't booked yet/i }).click();

  // Add a child
  const childrenCol = page.locator("span").filter({ hasText: /^Children$/ }).locator("..");
  await childrenCol.getByRole("button", { name: "+" }).click();

  // Continue button should be disabled — no age picked yet
  const continueBtn = page.getByRole("button", { name: /^Continue/i });
  await expect(continueBtn).toBeDisabled();

  // The 13–17 bucket should exist as a fifth option
  const child1Row = page.locator('text="Child 1"').locator("..");
  await expect(child1Row.getByRole("button", { name: "13–17" })).toBeVisible();

  // Pick 13–17 → Continue still gated by trip type? family is auto-set
  // (childrenAges.length > 0) so travelCompany should already be "family".
  await child1Row.getByRole("button", { name: "13–17" }).click();

  // Label reflects teen age
  await expect(page.getByTestId("trip-type-label")).toHaveText(
    "Planning a family trip with 1 child (13–17)"
  );

  // Continue is enabled now
  await expect(continueBtn).toBeEnabled();

  // Teen-friendly chip should be in the travel-style options for family
  await expect(
    page.getByRole("button", { name: "Teen-friendly", exact: true })
  ).toBeVisible();
});

/**
 * PHI-28 / RISE-104 — rating button hit area + Skip affordance.
 */
test("welcome step 4 supports Skip as a distinct rating signal", async ({ page }) => {
  await page.goto("/welcome");
  // PHI-34: dual-CTA landing — drop into structured form for the wizard walk.
  await page.getByTestId("use-structured-form").click();

  // Walk to step 4
  await page.getByPlaceholder("e.g. Tokyo, Japan").fill("Lisbon");
  // PHI-30: Enter only advances when destination is verified. In the test
  // environment we have no Google Maps API key, so the autocomplete
  // dropdown won't appear — use the "Use anyway" escape hatch.
  await page.getByTestId("use-destination-anyway").click();
  await page.getByRole("button", { name: /Start planning/i }).click();
  await page.locator('input[type="date"]').first().fill("2026-06-15");
  await page.locator('input[type="date"]').nth(1).fill("2026-06-22");
  await page.getByRole("button", { name: /Continue/i }).click();
  await page.getByRole("button", { name: /haven't booked yet/i }).click();
  await page.getByRole("button", { name: /Couple/i }).click();
  await page.getByRole("button", { name: "Cultural", exact: true }).click();
  await page.getByRole("button", { name: "Comfortable" }).click();
  await page.getByRole("button", { name: /Continue/i }).click();

  // Wait for first card
  await expect(page.getByText("Pastéis de Belém Tasting", { exact: false })).toBeVisible({
    timeout: 10_000,
  });

  // Skip affordance must be visible on each card
  const skipButtons = page.getByRole("button", { name: /Skip/i });
  await expect(skipButtons.first()).toBeVisible();

  // Verify thumbs buttons are at least 44px (PHI-28 hit-area requirement).
  // w-12 h-12 = 48px which exceeds the 44px floor.
  const interestedBtn = page.locator('button[title="Interested"]').first();
  const box = await interestedBtn.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);

  // Click Skip on the first card
  await skipButtons.first().click();

  // The skipped state should show its own muted note
  await expect(page.getByText(/Skipped — no preference recorded/i)).toBeVisible();

  // The counter should reflect the skipped card as a rated entry
  await expect(page.getByText(/1 of \d+ rated/i)).toBeVisible();

  // Continue button is enabled — Skip counts as a rating
  await expect(page.getByRole("button", { name: /Continue with 1 rated/i })).toBeEnabled();
});

/**
 * PHI-35 / RISE-302 — constraint expression.
 */
test("welcome step 3 captures constraints (chips + free text) and forwards them", async ({
  page,
}) => {
  // Capture the activities-stream POST body to assert constraints are sent
  let capturedBody: any = null;
  await page.route("**/api/activities-stream", async (route) => {
    try {
      const post = route.request().postData();
      capturedBody = post ? JSON.parse(post) : null;
    } catch {}
    await route.fulfill({
      status: 200,
      contentType: "text/plain; charset=utf-8",
      body: MOCK_ACTIVITIES_STREAM,
    });
  });

  await page.goto("/welcome");
  // PHI-34: dual-CTA landing — drop into structured form for the wizard walk.
  await page.getByTestId("use-structured-form").click();

  // Walk to step 3
  await page.getByPlaceholder("e.g. Tokyo, Japan").fill("Lisbon");
  await page.getByTestId("use-destination-anyway").click();
  await page.getByRole("button", { name: /Start planning/i }).click();
  await page.locator('input[type="date"]').first().fill("2026-06-15");
  await page.locator('input[type="date"]').nth(1).fill("2026-06-22");
  await page.getByRole("button", { name: /Continue/i }).click();
  await page.getByRole("button", { name: /haven't booked yet/i }).click();
  await page.getByRole("button", { name: /Couple/i }).click();
  await page.getByRole("button", { name: "Cultural", exact: true }).click();
  await page.getByRole("button", { name: "Comfortable" }).click();

  // The constraint section is present and optional
  const textarea = page.getByTestId("constraint-textarea");
  await expect(textarea).toBeVisible();

  // Pick two chips and add free text
  await page.getByRole("button", { name: "Severe allergy", exact: true }).click();
  await page.getByRole("button", { name: "No long walks", exact: true }).click();
  await textarea.fill("knee surgery last year, taking it easy");

  // The chips reflect aria-pressed
  await expect(
    page.getByRole("button", { name: "Severe allergy", exact: true })
  ).toHaveAttribute("aria-pressed", "true");

  // Continue → activities-stream call
  await page.getByRole("button", { name: /Continue/i }).click();
  await expect(page.getByText("Pastéis de Belém Tasting", { exact: false })).toBeVisible({
    timeout: 10_000,
  });

  // Confirm constraints made it to the API payload
  expect(capturedBody?.constraintTags).toEqual(
    expect.arrayContaining(["Severe allergy", "No long walks"])
  );
  expect(capturedBody?.constraintText).toBe("knee surgery last year, taking it easy");
});

/**
 * PHI-32 / RISE-203 — per-activity "Why this" rationale.
 *
 * The model output now includes a *Why: ...* line per activity. The card
 * has a collapsed "Why this →" affordance that expands to show the rationale.
 */
test("welcome step 4 cards show expandable Why this rationale", async ({ page }) => {
  await page.goto("/welcome");
  // PHI-34: dual-CTA landing — drop into structured form for the wizard walk.
  await page.getByTestId("use-structured-form").click();

  // Walk to step 4
  await page.getByPlaceholder("e.g. Tokyo, Japan").fill("Lisbon");
  await page.getByTestId("use-destination-anyway").click();
  await page.getByRole("button", { name: /Start planning/i }).click();
  await page.locator('input[type="date"]').first().fill("2026-06-15");
  await page.locator('input[type="date"]').nth(1).fill("2026-06-22");
  await page.getByRole("button", { name: /Continue/i }).click();
  await page.getByRole("button", { name: /haven't booked yet/i }).click();
  await page.getByRole("button", { name: /Couple/i }).click();
  await page.getByRole("button", { name: "Cultural", exact: true }).click();
  await page.getByRole("button", { name: "Comfortable" }).click();
  await page.getByRole("button", { name: /Continue/i }).click();

  await expect(page.getByText("Pastéis de Belém Tasting", { exact: false })).toBeVisible({
    timeout: 10_000,
  });

  // The first card has a "Why this" affordance
  const whyThis = page.getByTestId("why-this-act-0");
  await expect(whyThis).toBeVisible();
  await expect(whyThis).toHaveText("Why this →");

  // The rationale is NOT visible yet (collapsed by default)
  await expect(page.getByText(/Picked because you flagged Food-led/i)).toHaveCount(0);

  // Expand
  await whyThis.click();
  await expect(page.getByText(/Picked because you flagged Food-led/i)).toBeVisible();
  await expect(whyThis).toHaveText("Hide why ↑");

  // The rationale region has aria-live polite for screen readers
  const rationaleRegion = page.locator("#rationale-act-0");
  await expect(rationaleRegion).toHaveAttribute("aria-live", "polite");
  await expect(rationaleRegion).toHaveAttribute("role", "region");

  // Collapse
  await whyThis.click();
  await expect(page.getByText(/Picked because you flagged Food-led/i)).toHaveCount(0);
});

/**
 * PHI-31 Part 2 slice 2 — itinerary preview before signup.
 *
 * Step 5 now renders the day-by-day itinerary FIRST, with the signup form
 * below as a "Save your trip" card. This is the activation lever per the
 * team review.
 */
test("welcome step 5 shows itinerary preview before signup form", async ({ page }) => {
  await page.goto("/welcome");
  // PHI-34: dual-CTA landing — drop into structured form for the wizard walk.
  await page.getByTestId("use-structured-form").click();

  // Walk to step 5 with the standard happy path
  const destinationInput = page.getByPlaceholder("e.g. Tokyo, Japan");
  await destinationInput.fill("Lisbon");
  await page.getByTestId("use-destination-anyway").click();
  await page.getByRole("button", { name: /Start planning/i }).click();
  await page.locator('input[type="date"]').first().fill("2026-06-15");
  await page.locator('input[type="date"]').nth(1).fill("2026-06-22");
  await page.getByRole("button", { name: /Continue/i }).click();
  await page.getByRole("button", { name: /haven't booked yet/i }).click();
  await page.getByRole("button", { name: /Couple/i }).click();
  await page.getByRole("button", { name: "Cultural", exact: true }).click();
  await page.getByRole("button", { name: "Comfortable" }).click();
  await page.getByRole("button", { name: /Continue/i }).click();
  await expect(page.getByText("Pastéis de Belém Tasting", { exact: false })).toBeVisible({
    timeout: 10_000,
  });
  await page.locator('button[title="Interested"]').first().click();
  await page.getByRole("button", { name: /Continue with/i }).click();

  // Step 5 — preview must be visible
  const preview = page.getByTestId("itinerary-preview");
  await expect(preview).toBeVisible({ timeout: 10_000 });

  // The preview shows the generated trip
  await expect(page.getByText(/Day 1/i).first()).toBeVisible();
  await expect(
    page.getByText(/Custard tart pilgrimage|Pastéis de Belém Tasting/i).first()
  ).toBeVisible();

  // Save Trip CTA is below the preview
  await expect(page.getByText(/Save your trip to keep it/i)).toBeVisible();
  // Email + name inputs still present so users can sign up
  await expect(page.getByPlaceholder("Your name")).toBeVisible();
  await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
});

/**
 * PHI-34 UI — dual-CTA landing + free-form parse + confirmation chips.
 */
test("welcome dual-CTA: free-form input parses and pre-fills the wizard", async ({
  page,
}) => {
  // Mock /api/parse-trip so we don't hit Anthropic in tests.
  await page.route("**/api/parse-trip", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        intent: {
          destinations: [{ name: "Lisbon", kind: "place" }],
          dates: { durationNights: 4 },
          party: { adults: 1 },
          styleTags: ["Food-led"],
          budgetTier: "comfortable",
          constraintTags: [],
          constraintText: "no nightlife",
          clarifications: ["What dates work for the 4 nights?"],
        },
        tokensIn: 500,
        tokensOut: 200,
      }),
    });
  });

  await page.goto("/welcome");

  // Dual-CTA landing is the default
  const textarea = page.getByTestId("parser-textarea");
  await expect(textarea).toBeVisible();
  await expect(page.getByTestId("parser-submit")).toBeDisabled();
  await expect(page.getByTestId("use-structured-form")).toBeVisible();

  // Type and submit
  await textarea.fill("Solo trip, Lisbon, 4 nights, food-led, no nightlife");
  await expect(page.getByTestId("parser-submit")).toBeEnabled();
  await page.getByTestId("parser-submit").click();

  // Confirmation chips appear
  const chips = page.getByTestId("confirm-chips");
  await expect(chips).toBeVisible();
  await expect(chips).toContainText("Lisbon");
  await expect(chips).toContainText("4 nights");
  await expect(chips).toContainText("Food-led");

  // Clarification surfaces in its own block
  await expect(page.getByText(/What dates work for the 4 nights/i)).toBeVisible();

  // Looks right → advances into the structured wizard
  await page.getByRole("button", { name: /Looks right/i }).click();
  // Now on step 1 (dates) with destination pre-filled
  await expect(page.getByText("Great choice. Now let's lock in the dates")).toBeVisible({
    timeout: 5_000,
  });
});

/**
 * Follow-up #4 — place resolution wiring on parser output.
 *
 * After the free-form parser confirms a destination, the welcome page
 * fires /api/resolve-place in the background to enrich the leg's
 * PlaceRef with lat/lng/id/type. On accept, the POST to /api/travelers
 * (and the PATCH to /api/anonymous-session) carry those resolved fields.
 */
test("welcome parser enriches destination with resolved PlaceRef on save", async ({
  page,
}) => {
  // Mock the parser response — single destination, simple intent.
  await page.route("**/api/parse-trip", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        intent: {
          destinations: [{ name: "Lisbon", kind: "place" }],
          dates: { departure: "2026-06-15", return: "2026-06-22" },
          party: { adults: 2 },
          styleTags: ["Cultural"],
          budgetTier: "comfortable",
          constraintTags: [],
          clarifications: [],
        },
        tokensIn: 100,
        tokensOut: 50,
      }),
    });
  });

  // Mock the resolve-place response — a Lisbon PlaceRef.
  let resolveCallCount = 0;
  let resolveRequestedNames: string[] = [];
  await page.route("**/api/resolve-place", async (route) => {
    resolveCallCount++;
    try {
      const body = JSON.parse(route.request().postData() ?? "{}");
      if (body.name) resolveRequestedNames.push(body.name);
    } catch {}
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        resolved: {
          name: "Lisbon",
          id: "ChIJ-Lisbon-Test",
          lat: 38.7223,
          lng: -9.1393,
          type: "locality",
        },
      }),
    });
  });

  // Capture the /api/travelers POST body so we can assert the resolved
  // place fields land on the wire.
  let capturedTravelersPost: Record<string, unknown> | null = null;
  await page.route("**/api/travelers", async (route) => {
    if (route.request().method() === "POST") {
      try {
        capturedTravelersPost = JSON.parse(route.request().postData() ?? "{}");
      } catch {}
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "test-traveler-id" }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("/welcome");

  // Submit the parser
  await page.getByTestId("parser-textarea").fill(
    "Cultural trip to Lisbon, 2 adults, June 15–22, comfortable budget"
  );
  await page.getByTestId("parser-submit").click();

  // Confirmation chips appear; resolve-place should have been called.
  await expect(page.getByTestId("confirm-chips")).toBeVisible();
  // Give the background fetch a beat to settle.
  await page.waitForTimeout(100);
  expect(resolveCallCount).toBeGreaterThanOrEqual(1);
  expect(resolveRequestedNames).toContain("Lisbon");

  // Accept and walk to step 5.
  await page.getByRole("button", { name: /Looks right/i }).click();
  // Step 1 (dates) — keep parsed dates and continue.
  await page.getByRole("button", { name: /Continue/i }).click();
  // Step 2 (hotel) — skip.
  await page.getByRole("button", { name: /haven't booked yet/i }).click();
  // Step 3 (profile) — must pick Couple chip explicitly; style + budget
  // come from the parsed intent so we don't re-pick them.
  await page.getByRole("button", { name: /Couple/i }).click();
  await page.getByRole("button", { name: /Continue/i }).click();
  // Step 4 (activities) — wait for first card and thumbs up.
  await expect(page.getByText("Pastéis de Belém Tasting", { exact: false })).toBeVisible({
    timeout: 10_000,
  });
  await page.locator('button[title="Interested"]').first().click();
  await page.getByRole("button", { name: /Continue with/i }).click();

  // Sign up — fills name + email and clicks the step-5 finish CTA
  // ("Let's go →"), which calls handleFinish() and POSTs /api/travelers.
  await page.getByPlaceholder("Your name").fill("Mira");
  await page.getByPlaceholder("you@example.com").fill("mira@example.com");
  await page.getByRole("button", { name: /Let's go/i }).click();

  // Wait until the travelers POST landed.
  await expect.poll(() => capturedTravelersPost).not.toBeNull();

  // The resolved place fields must have flowed through to the API.
  expect(capturedTravelersPost).toMatchObject({
    destination: "Lisbon",
    destinationPlaceId: "ChIJ-Lisbon-Test",
    destinationLat: 38.7223,
    destinationLng: -9.1393,
    destinationPlaceType: "locality",
  });
});

test("welcome step 5 renders with description shown exactly once", async ({ page }) => {
  await page.goto("/welcome");
  // PHI-34: dual-CTA landing — drop into structured form for the wizard walk.
  await page.getByTestId("use-structured-form").click();

  // ── Step 0: Landing — type destination, press Enter ────────────────────
  const destinationInput = page.getByPlaceholder("e.g. Tokyo, Japan");
  await destinationInput.fill("Lisbon");
  // PHI-30: explicit verification escape (no Google Maps in test env).
  await page.getByTestId("use-destination-anyway").click();
  await page.getByRole("button", { name: /Start planning/i }).click();

  // ── Step 1: Dates ─────────────────────────────────────────────────────
  // The destination input is editable here too; we leave it as-is.
  const departureInput = page.locator('input[type="date"]').first();
  const returnInput = page.locator('input[type="date"]').nth(1);
  await departureInput.fill("2026-06-15");
  await returnInput.fill("2026-06-22");
  await page.getByRole("button", { name: /Continue/i }).click();

  // ── Step 2: Hotel — click skip ────────────────────────────────────────
  await page.getByRole("button", { name: /haven't booked yet/i }).click();

  // ── Step 3: Profile — pick partner trip type (default 2 adults), one style, budget ─
  // Default adult count is 2, default children is 0 → trip type chips visible.
  await page.getByRole("button", { name: /Couple/i }).click();
  await page.getByRole("button", { name: "Cultural", exact: true }).click();
  await page.getByRole("button", { name: "Comfortable" }).click();
  await page.getByRole("button", { name: /Continue/i }).click();

  // ── Step 4: Activities — wait for cards, thumbs-up the first one ──────
  // Cards stream in via the mocked route; first card title is Pastéis de Belém.
  const firstCard = page.getByText("Pastéis de Belém Tasting", { exact: false });
  await expect(firstCard).toBeVisible({ timeout: 10_000 });

  // Find the thumbs-up button on the first card and click.
  // Buttons have title="Interested" set in the JSX.
  const interestedButtons = page.locator('button[title="Interested"]');
  await expect(interestedButtons.first()).toBeVisible();
  await interestedButtons.first().click();

  // Continue with 1 rated.
  await page.getByRole("button", { name: /Continue with/i }).click();

  // ── Step 5: Save your trip plan ───────────────────────────────────────
  // The headline confirms we're on the right step.
  await expect(
    page.getByRole("heading", { name: "Save your trip plan." })
  ).toBeVisible();

  // PHI-25 regression guard: the description string must appear EXACTLY ONCE.
  // Before the fix, this screen rendered the description twice — once via
  // the centralized subs[5] body slot, and once hardcoded as a smaller grey
  // paragraph below the Skipped activities panel.
  const descriptionMatches = await page
    .getByText(STEP_5_DESCRIPTION, { exact: false })
    .count();
  expect(descriptionMatches, "description should appear exactly once").toBe(1);

  // Broader visual regression: snapshot the step-5 viewport.
  // Maintained via `npm run test:e2e -- --update-snapshots`.
  await expect(page).toHaveScreenshot("welcome-step-5.png", {
    // Mask the date-dependent destination header if any future revision
    // includes dynamic timestamps; not currently needed but cheap to add.
    fullPage: false,
  });
});
